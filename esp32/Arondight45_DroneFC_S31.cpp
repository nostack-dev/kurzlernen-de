/*
 * Arondight45 DroneFC — ESP32-S31 / ESP-IDF production hardware adapter.
 *
 * The flight-control state machine, calibration, filters, attitude estimator,
 * arming, PID, mixer, limits and fault policy live in
 * Arondight45_DroneFC_Core.hpp and are shared verbatim by Production, HIL and SIL.
 * This file contains only physical ESP32-S31 / ICM-42688-P / SBUS / MCPWM glue
 * plus hardware-only watchdog, kill and deadline supervision.
 */

#include "Arondight45_DroneFC_Core.hpp"

#include <array>
#include <atomic>
#include <cstdint>
#include <cstring>
#include <limits>

extern "C" {
#include "sdkconfig.h"
#include "driver/gpio.h"
#include "driver/mcpwm_prelude.h"
#include "driver/spi_master.h"
#include "driver/uart.h"
#include "esp_attr.h"
#include "esp_err.h"
#include "esp_log.h"
#include "esp_system.h"
#include "esp_task_wdt.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
}

#ifndef CONFIG_IDF_TARGET_ESP32S31
#error Build with: idf.py set-target esp32s31
#endif

#ifndef FC_PIN_IMU_MOSI
#define FC_PIN_IMU_MOSI 11
#endif
#ifndef FC_PIN_IMU_MISO
#define FC_PIN_IMU_MISO 12
#endif
#ifndef FC_PIN_IMU_SCLK
#define FC_PIN_IMU_SCLK 13
#endif
#ifndef FC_PIN_IMU_CS
#define FC_PIN_IMU_CS 10
#endif
#ifndef FC_PIN_IMU_DRDY
#define FC_PIN_IMU_DRDY 9
#endif
#ifndef FC_PIN_SBUS
#define FC_PIN_SBUS 8
#endif
#ifndef FC_PIN_M1
#define FC_PIN_M1 4
#endif
#ifndef FC_PIN_M2
#define FC_PIN_M2 5
#endif
#ifndef FC_PIN_M3
#define FC_PIN_M3 6
#endif
#ifndef FC_PIN_M4
#define FC_PIN_M4 7
#endif
#ifndef FC_PIN_KILL
#define FC_PIN_KILL -1
#endif
#ifndef FC_IMU_ROTATION
#define FC_IMU_ROTATION 0
#endif
#ifndef FC_IMU_FLIPPED
#define FC_IMU_FLIPPED 0
#endif

static_assert(FC_IMU_ROTATION == 0 || FC_IMU_ROTATION == 90 ||
              FC_IMU_ROTATION == 180 || FC_IMU_ROTATION == 270);

namespace hw {

constexpr char kTag[] = "Arondight45-FC";
constexpr auto kSpiHost = SPI2_HOST;
constexpr auto kUart = UART_NUM_1;

TaskHandle_t flight_task_handle{};
portMUX_TYPE rc_mux = portMUX_INITIALIZER_UNLOCKED;
fc::RC rc_snapshot{};
spi_device_handle_t imu{};
mcpwm_timer_handle_t motor_timer{};
std::array<mcpwm_cmpr_handle_t, 4> motor_comparators{};
std::array<mcpwm_gen_handle_t, 4> motor_generators{};
std::atomic<bool> armed{false};
std::atomic<bool> killed{false};
std::atomic<uint32_t> heartbeat_us32{0};

#define HW_TRY(expr, label) do { \
    const esp_err_t _error = (expr); \
    if (_error != ESP_OK) { \
        ESP_LOGE(kTag, "%s: %s", label, esp_err_to_name(_error)); \
        return _error; \
    } \
} while (0)

uint64_t now_us64() {
    return static_cast<uint64_t>(esp_timer_get_time());
}

uint32_t now_us32() {
    return static_cast<uint32_t>(esp_timer_get_time());
}

void hard_kill() {
    if (killed.exchange(true)) return;
    armed.store(false, std::memory_order_release);
    for (auto generator : motor_generators) {
        if (generator) (void)mcpwm_generator_set_force_level(generator, 0, true);
    }
}

[[noreturn]] void fatal(const char* reason) {
    hard_kill();
    ESP_EARLY_LOGE(kTag, "FATAL %s", reason);
    esp_restart();
    for (;;) {}
}

bool set_motor_pulses(const std::array<uint16_t, 4>& pulses) {
    if (killed.load(std::memory_order_acquire)) return false;
    for (size_t i = 0; i < pulses.size(); ++i) {
        const uint32_t pulse = fc::clamp<uint32_t>(pulses[i], fc::kEscMinUs, fc::kEscMaxUs);
        if (mcpwm_comparator_set_compare_value(motor_comparators[i], pulse) != ESP_OK) return false;
    }
    return true;
}

bool disarm_motors() {
    return set_motor_pulses({fc::kEscMinUs, fc::kEscMinUs, fc::kEscMinUs, fc::kEscMinUs});
}

esp_err_t motor_init() {
    const int pins[4] = {FC_PIN_M1, FC_PIN_M2, FC_PIN_M3, FC_PIN_M4};
    mcpwm_timer_config_t timer_config{};
    timer_config.group_id = 0;
    timer_config.clk_src = MCPWM_TIMER_CLK_SRC_DEFAULT;
    timer_config.resolution_hz = 1000000;
    timer_config.period_ticks = 2500;
    timer_config.count_mode = MCPWM_TIMER_COUNT_MODE_UP;
    HW_TRY(mcpwm_new_timer(&timer_config, &motor_timer), "motor timer");

    for (int operator_index = 0; operator_index < 2; ++operator_index) {
        mcpwm_oper_handle_t oper{};
        mcpwm_operator_config_t operator_config{};
        operator_config.group_id = 0;
        HW_TRY(mcpwm_new_operator(&operator_config, &oper), "motor operator");
        HW_TRY(mcpwm_operator_connect_timer(oper, motor_timer), "motor connect");

        for (int local = 0; local < 2; ++local) {
            const int i = operator_index * 2 + local;
            mcpwm_comparator_config_t comparator_config{};
            comparator_config.flags.update_cmp_on_tez = true;
            HW_TRY(mcpwm_new_comparator(oper, &comparator_config, &motor_comparators[i]), "motor comparator");

            mcpwm_generator_config_t generator_config{};
            generator_config.gen_gpio_num = pins[i];
            HW_TRY(mcpwm_new_generator(oper, &generator_config, &motor_generators[i]), "motor generator");
            HW_TRY(mcpwm_comparator_set_compare_value(motor_comparators[i], fc::kEscMinUs), "motor compare");
            HW_TRY(mcpwm_generator_set_action_on_timer_event(
                       motor_generators[i],
                       MCPWM_GEN_TIMER_EVENT_ACTION(MCPWM_TIMER_DIRECTION_UP,
                                                    MCPWM_TIMER_EVENT_EMPTY,
                                                    MCPWM_GEN_ACTION_HIGH)),
                   "motor timer action");
            HW_TRY(mcpwm_generator_set_action_on_compare_event(
                       motor_generators[i],
                       MCPWM_GEN_COMPARE_EVENT_ACTION(MCPWM_TIMER_DIRECTION_UP,
                                                      motor_comparators[i],
                                                      MCPWM_GEN_ACTION_LOW)),
                   "motor compare action");
        }
    }

    HW_TRY(mcpwm_timer_enable(motor_timer), "motor enable");
    HW_TRY(mcpwm_timer_start_stop(motor_timer, MCPWM_TIMER_START_NO_STOP), "motor start");
    return disarm_motors() ? ESP_OK : ESP_FAIL;
}

namespace reg {
constexpr uint8_t kDeviceConfig = 0x11;
constexpr uint8_t kIntConfig = 0x14;
constexpr uint8_t kTempData1 = 0x1d;
constexpr uint8_t kInterfaceConfig = 0x4c;
constexpr uint8_t kPowerManagement = 0x4e;
constexpr uint8_t kGyroConfig = 0x4f;
constexpr uint8_t kAccelConfig = 0x50;
constexpr uint8_t kIntClear = 0x63;
constexpr uint8_t kIntSource = 0x65;
constexpr uint8_t kWhoAmI = 0x75;
}  // namespace reg

esp_err_t imu_write(uint8_t address, uint8_t value) {
    uint8_t bytes[2] = {static_cast<uint8_t>(address & 0x7f), value};
    spi_transaction_t transaction{};
    transaction.length = 16;
    transaction.tx_buffer = bytes;
    return spi_device_polling_transmit(imu, &transaction);
}

esp_err_t imu_read(uint8_t address, uint8_t* output, size_t count) {
    if (!output || !count || count > 31) return ESP_ERR_INVALID_ARG;
    uint8_t tx[32]{};
    uint8_t rx[32]{};
    tx[0] = address | 0x80;
    spi_transaction_t transaction{};
    transaction.length = static_cast<uint32_t>((count + 1) * 8);
    transaction.tx_buffer = tx;
    transaction.rx_buffer = rx;
    HW_TRY(spi_device_polling_transmit(imu, &transaction), "imu read");
    std::memcpy(output, rx + 1, count);
    return ESP_OK;
}

esp_err_t imu_write_verified(uint8_t address, uint8_t value) {
    HW_TRY(imu_write(address, value), "imu write");
    uint8_t readback{};
    HW_TRY(imu_read(address, &readback, 1), "imu verify read");
    return readback == value ? ESP_OK : ESP_ERR_INVALID_RESPONSE;
}

void IRAM_ATTR imu_data_ready_isr(void*) {
    BaseType_t higher_priority_woken = pdFALSE;
    if (flight_task_handle) vTaskNotifyGiveFromISR(flight_task_handle, &higher_priority_woken);
    if (higher_priority_woken) portYIELD_FROM_ISR();
}

esp_err_t imu_init() {
    spi_bus_config_t bus_config{};
    bus_config.mosi_io_num = FC_PIN_IMU_MOSI;
    bus_config.miso_io_num = FC_PIN_IMU_MISO;
    bus_config.sclk_io_num = FC_PIN_IMU_SCLK;
    bus_config.quadwp_io_num = -1;
    bus_config.quadhd_io_num = -1;
    bus_config.max_transfer_sz = 32;
    HW_TRY(spi_bus_initialize(kSpiHost, &bus_config, SPI_DMA_CH_AUTO), "spi bus");

    spi_device_interface_config_t device_config{};
    device_config.clock_speed_hz = 10000000;
    device_config.mode = 0;
    device_config.spics_io_num = FC_PIN_IMU_CS;
    device_config.queue_size = 1;
    HW_TRY(spi_bus_add_device(kSpiHost, &device_config, &imu), "spi device");

    HW_TRY(imu_write(reg::kDeviceConfig, 1), "imu reset");
    vTaskDelay(pdMS_TO_TICKS(10));

    uint8_t value{};
    HW_TRY(imu_read(reg::kWhoAmI, &value, 1), "imu whoami");
    if (value != 0x47) return ESP_ERR_INVALID_RESPONSE;

    HW_TRY(imu_read(reg::kInterfaceConfig, &value, 1), "imu interface read");
    HW_TRY(imu_write_verified(reg::kInterfaceConfig, static_cast<uint8_t>((value & 0xf0) | 3)), "imu disable i2c");
    HW_TRY(imu_write_verified(reg::kGyroConfig, 6), "imu gyro config");
    HW_TRY(imu_write_verified(reg::kAccelConfig, 6), "imu accel config");
    HW_TRY(imu_write_verified(reg::kPowerManagement, 0x0f), "imu power");
    vTaskDelay(pdMS_TO_TICKS(50));
    HW_TRY(imu_write_verified(reg::kIntConfig, 3), "imu interrupt pin");
    HW_TRY(imu_write_verified(reg::kIntClear, 0x20), "imu interrupt clear");
    HW_TRY(imu_write_verified(reg::kIntSource, 8), "imu data-ready source");

    gpio_config_t gpio{};
    gpio.pin_bit_mask = 1ULL << FC_PIN_IMU_DRDY;
    gpio.mode = GPIO_MODE_INPUT;
    gpio.pull_down_en = GPIO_PULLDOWN_ENABLE;
    gpio.intr_type = GPIO_INTR_POSEDGE;
    HW_TRY(gpio_config(&gpio), "imu drdy gpio");
    const esp_err_t service = gpio_install_isr_service(ESP_INTR_FLAG_IRAM);
    if (service != ESP_OK && service != ESP_ERR_INVALID_STATE) return service;
    return gpio_isr_handler_add(static_cast<gpio_num_t>(FC_PIN_IMU_DRDY), imu_data_ready_isr, nullptr);
}

int16_t read_be_i16(const uint8_t* p) {
    return static_cast<int16_t>((static_cast<uint16_t>(p[0]) << 8) | p[1]);
}

fc::V3 orient(fc::V3 v) {
    fc::V3 out{};
#if FC_IMU_ROTATION == 0
    out = v;
#elif FC_IMU_ROTATION == 90
    out = {-v.y, v.x, v.z};
#elif FC_IMU_ROTATION == 180
    out = {-v.x, -v.y, v.z};
#else
    out = {v.y, -v.x, v.z};
#endif
#if FC_IMU_FLIPPED
    out.y = -out.y;
    out.z = -out.z;
#endif
    return out;
}

esp_err_t sample_imu(fc::Imu& sample) {
    uint8_t bytes[14]{};
    HW_TRY(imu_read(reg::kTempData1, bytes, sizeof(bytes)), "imu sample");
    const int16_t ax = read_be_i16(bytes + 2);
    const int16_t ay = read_be_i16(bytes + 4);
    const int16_t az = read_be_i16(bytes + 6);
    const int16_t gx = read_be_i16(bytes + 8);
    const int16_t gy = read_be_i16(bytes + 10);
    const int16_t gz = read_be_i16(bytes + 12);
    const int16_t bad = std::numeric_limits<int16_t>::min();
    if (ax == bad || ay == bad || az == bad || gx == bad || gy == bad || gz == bad) return ESP_ERR_INVALID_RESPONSE;
    sample.a = orient({ax / 2048.0f, ay / 2048.0f, az / 2048.0f});
    sample.g = orient({gx / 16.4f, gy / 16.4f, gz / 16.4f});
    return fc::finite(sample.a) && fc::finite(sample.g) ? ESP_OK : ESP_ERR_INVALID_RESPONSE;
}

esp_err_t sbus_init() {
    uart_config_t config{};
    config.baud_rate = 100000;
    config.data_bits = UART_DATA_8_BITS;
    config.parity = UART_PARITY_EVEN;
    config.stop_bits = UART_STOP_BITS_2;
    config.flow_ctrl = UART_HW_FLOWCTRL_DISABLE;
    config.source_clk = UART_SCLK_DEFAULT;
    HW_TRY(uart_driver_install(kUart, 1024, 0, 0, nullptr, 0), "sbus uart driver");
    HW_TRY(uart_param_config(kUart, &config), "sbus uart config");
    HW_TRY(uart_set_pin(kUart, UART_PIN_NO_CHANGE, FC_PIN_SBUS, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE), "sbus pin");
    HW_TRY(uart_set_line_inverse(kUart, UART_SIGNAL_RXD_INV), "sbus inversion");
    return uart_flush_input(kUart);
}

void sbus_task(void*) {
    fc::SbusParser parser;
    uint8_t bytes[64];
    for (;;) {
        const int count = uart_read_bytes(kUart, bytes, sizeof(bytes), pdMS_TO_TICKS(20));
        for (int i = 0; i < count; ++i) {
            fc::RC decoded;
            if (parser.feed(bytes[i], now_us64(), decoded)) {
                portENTER_CRITICAL(&rc_mux);
                rc_snapshot = decoded;
                portEXIT_CRITICAL(&rc_mux);
            }
        }
    }
}

fc::RC get_rc_snapshot() {
    fc::RC value;
    portENTER_CRITICAL(&rc_mux);
    value = rc_snapshot;
    portEXIT_CRITICAL(&rc_mux);
    return value;
}

void flight_task(void*) {
    if (esp_task_wdt_add(nullptr) != ESP_OK) fatal("flight watchdog registration");
    if (imu_init() != ESP_OK) fatal("imu init");

    fc::Runtime runtime;
    uint64_t last_us = 0;

    for (;;) {
        const uint32_t notifications = ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(5));
        if (!notifications) fatal("imu timeout");

        const uint64_t now = now_us64();
        fc::Imu raw;
        if (sample_imu(raw) != ESP_OK) fatal("imu data");
        const uint32_t dt_us = last_us ? static_cast<uint32_t>(now - last_us) : fc::kNominalDtUs;
        last_us = now;

        const fc::RC rc = get_rc_snapshot();
        const bool rc_fresh = rc.valid && now >= rc.us && now - rc.us <= fc::kRcTimeoutUs;

#if FC_PIN_KILL >= 0
        if (!gpio_get_level(static_cast<gpio_num_t>(FC_PIN_KILL))) fatal("kill switch");
#endif

        fc::RuntimeInput input{};
        input.raw = raw;
        input.rc = rc;
        input.now_us = now;
        input.dt_us = dt_us;
        input.missed_samples = notifications > 1 ? notifications - 1 : 0;
        input.imu_valid = true;
        input.rc_fresh = rc_fresh;
        const fc::RuntimeOutput output = runtime.step(input);

        if (output.fault != fc::kFaultNone) fatal(fc::Runtime::fault_name(output.fault));
        armed.store(output.armed, std::memory_order_release);
        if (!set_motor_pulses(output.motor_us)) fatal("motor output");

        heartbeat_us32.store(now_us32(), std::memory_order_release);
        if (esp_task_wdt_reset() != ESP_OK) fatal("flight watchdog");
    }
}

void safety_task(void*) {
    if (esp_task_wdt_add(nullptr) != ESP_OK) fatal("safety watchdog registration");
    for (;;) {
        if (armed.load(std::memory_order_acquire)) {
            const uint32_t heartbeat = heartbeat_us32.load(std::memory_order_acquire);
            if (heartbeat && static_cast<uint32_t>(now_us32() - heartbeat) > 30000) fatal("heartbeat");
#if FC_PIN_KILL >= 0
            if (!gpio_get_level(static_cast<gpio_num_t>(FC_PIN_KILL))) fatal("kill switch");
#endif
        }
        if (esp_task_wdt_reset() != ESP_OK) fatal("safety watchdog");
        vTaskDelay(pdMS_TO_TICKS(5));
    }
}

esp_err_t setup_kill_switch() {
#if FC_PIN_KILL >= 0
    gpio_config_t config{};
    config.pin_bit_mask = 1ULL << FC_PIN_KILL;
    config.mode = GPIO_MODE_INPUT;
    config.pull_up_en = GPIO_PULLUP_ENABLE;
    return gpio_config(&config);
#else
    return ESP_OK;
#endif
}

esp_err_t setup_watchdog() {
    esp_task_wdt_config_t config{};
    config.timeout_ms = 500;
    config.trigger_panic = true;
    const esp_err_t reconfigure = esp_task_wdt_reconfigure(&config);
    return reconfigure == ESP_ERR_INVALID_STATE ? esp_task_wdt_init(&config) : reconfigure;
}

}  // namespace hw

extern "C" void app_main() {
    ESP_ERROR_CHECK(hw::setup_watchdog());
    ESP_ERROR_CHECK(hw::setup_kill_switch());
    ESP_ERROR_CHECK(hw::motor_init());
    ESP_ERROR_CHECK(hw::sbus_init());

#if CONFIG_FREERTOS_NUMBER_OF_CORES > 1
    constexpr BaseType_t kFlightCore = 1;
    constexpr BaseType_t kServiceCore = 0;
#else
    constexpr BaseType_t kFlightCore = tskNO_AFFINITY;
    constexpr BaseType_t kServiceCore = tskNO_AFFINITY;
#endif

    BaseType_t created = xTaskCreatePinnedToCore(hw::flight_task, "flight", 8192, nullptr,
                                                 configMAX_PRIORITIES - 2,
                                                 &hw::flight_task_handle, kFlightCore);
    ESP_ERROR_CHECK(created == pdPASS ? ESP_OK : ESP_ERR_NO_MEM);
    created = xTaskCreatePinnedToCore(hw::safety_task, "safety", 4096, nullptr,
                                     configMAX_PRIORITIES - 3, nullptr, kServiceCore);
    ESP_ERROR_CHECK(created == pdPASS ? ESP_OK : ESP_ERR_NO_MEM);
    created = xTaskCreatePinnedToCore(hw::sbus_task, "sbus", 4096, nullptr,
                                     12, nullptr, kServiceCore);
    ESP_ERROR_CHECK(created == pdPASS ? ESP_OK : ESP_ERR_NO_MEM);
}
