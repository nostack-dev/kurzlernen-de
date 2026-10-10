/*
 * Arondight45 DroneFC — ESP32-S31 / ESP-IDF production hardware adapter.
 *
 * The flight-control state machine, calibration, filters, attitude estimator,
 * arming, PID, mixer, limits and fault policy live in
 * Arondight45_DroneFC_Core.hpp and are shared verbatim by Production, HIL and SIL.
 * This file contains only physical ESP32-S31 / ICM-42688-P / SBUS / MCPWM glue
 * plus hardware-only watchdog, kill and deadline supervision.
 */

#include "Arondight45_FirmwareRuntime.hpp"
#include "Arondight45_FlowNav.hpp"

#include <array>
#include <atomic>
#include <cstdint>
#include <cstring>
#include <limits>

extern "C" {
#include "sdkconfig.h"
#include "driver/gpio.h"
#include "driver/i2c_master.h"
#include "nvs.h"
#include "nvs_flash.h"
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
#ifndef FC_PIN_NAV_RX
// Real navigation-module byte stream. GAME mode remains fail-closed unless a
// physical NAV1 producer is connected. Override these for the target PCB.
#define FC_PIN_NAV_RX 18
#endif
#ifndef FC_NAV_UART_BAUD
#define FC_NAV_UART_BAUD 230400
#endif
#ifndef FC_NAV_UART_NUM
#define FC_NAV_UART_NUM UART_NUM_0
#endif
#ifndef FC_PIN_MAG_SDA
// Compass of the GPS module (QMC5883L 0x0D or QMC5883P 0x2C). -1 = no compass: on-board
// FlowNav then never reports a heading and GAME stays fail-closed unless a NAV1 module is used.
#define FC_PIN_MAG_SDA 14
#endif
#ifndef FC_PIN_MAG_SCL
#define FC_PIN_MAG_SCL 15
#endif
#ifndef FC_FLOWNAV_RESET
#define FC_FLOWNAV_RESET 0   // 1: forget the stored flow/compass calibration at boot
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
constexpr auto kSbusUart = UART_NUM_1;
constexpr auto kNavUart = FC_NAV_UART_NUM;

TaskHandle_t flight_task_handle{};
portMUX_TYPE wire_mux = portMUX_INITIALIZER_UNLOCKED;
std::array<uint8_t, 25> sbus_frame_snapshot{};
uint32_t sbus_generation{};
hwcontract::NavigationWireFrame navigation_frame_snapshot{};
uint32_t navigation_generation{};
// On-board FlowNav inputs (MSP v2 flow + range on the NAV UART, compass on I2C). Flow
// displacement is summed until the flight task takes it, so no sample's motion is lost.
struct PendingFlow { int32_t dx{}, dy{}; uint8_t quality{255}; uint64_t us{}; bool any{}; };
PendingFlow pending_flow{};
flownav::RangeSample range_snapshot{};
uint32_t range_generation{};
flownav::V3f mag_snapshot{};
uint64_t mag_us{};
uint32_t mag_generation{};
i2c_master_dev_handle_t mag_dev{};
bool mag_is_p{};
// calibration handed from the flight task to the (slow) flash writer
struct StoredFlowNav { uint32_t magic{0x31564e46u}; uint16_t version{1}; flownav::FlowCalibration flow{}; flownav::MagCalibration mag{}; int32_t sense{}; };
StoredFlowNav store_pending{};
std::atomic<bool> store_dirty{false};
StoredFlowNav store_loaded{};
bool store_valid{};
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

esp_err_t sample_imu_registers(std::array<uint8_t, 14>& sample) {
    return imu_read(reg::kTempData1, sample.data(), sample.size());
}

esp_err_t sbus_init() {
    uart_config_t config{};
    config.baud_rate = 100000;
    config.data_bits = UART_DATA_8_BITS;
    config.parity = UART_PARITY_EVEN;
    config.stop_bits = UART_STOP_BITS_2;
    config.flow_ctrl = UART_HW_FLOWCTRL_DISABLE;
    config.source_clk = UART_SCLK_DEFAULT;
    HW_TRY(uart_driver_install(kSbusUart, 1024, 0, 0, nullptr, 0), "sbus uart driver");
    HW_TRY(uart_param_config(kSbusUart, &config), "sbus uart config");
    HW_TRY(uart_set_pin(kSbusUart, UART_PIN_NO_CHANGE, FC_PIN_SBUS, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE), "sbus pin");
    HW_TRY(uart_set_line_inverse(kSbusUart, UART_SIGNAL_RXD_INV), "sbus inversion");
    return uart_flush_input(kSbusUart);
}

void sbus_task(void*) {
    hwcontract::SbusWireParser parser;
    std::array<uint8_t, 25> frame{};
    uint8_t bytes[64];
    for (;;) {
        const int count = uart_read_bytes(kSbusUart, bytes, sizeof(bytes), pdMS_TO_TICKS(20));
        for (int i = 0; i < count; ++i) {
            if (!parser.feed(bytes[i], now_us64(), frame)) continue;
            portENTER_CRITICAL(&wire_mux);
            sbus_frame_snapshot = frame;
            ++sbus_generation;
            portEXIT_CRITICAL(&wire_mux);
        }
    }
}

esp_err_t navigation_init() {
#if FC_PIN_NAV_RX >= 0
    uart_config_t config{};
    config.baud_rate = FC_NAV_UART_BAUD;
    config.data_bits = UART_DATA_8_BITS;
    config.parity = UART_PARITY_DISABLE;
    config.stop_bits = UART_STOP_BITS_1;
    config.flow_ctrl = UART_HW_FLOWCTRL_DISABLE;
    config.source_clk = UART_SCLK_DEFAULT;
    HW_TRY(uart_driver_install(kNavUart, 1024, 0, 0, nullptr, 0), "nav uart driver");
    HW_TRY(uart_param_config(kNavUart, &config), "nav uart config");
    HW_TRY(uart_set_pin(kNavUart, UART_PIN_NO_CHANGE, FC_PIN_NAV_RX, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE), "nav uart pin");
    return uart_flush_input(kNavUart);
#else
    return ESP_OK;
#endif
}

void navigation_task(void*) {
#if FC_PIN_NAV_RX >= 0
    hwcontract::NavigationWireParser parser;
    hwcontract::NavigationWireFrame frame{};
    flownav::MspV2Parser msp;
    flownav::MspFrame msp_frame{};
    uint8_t bytes[64];
    for (;;) {
        const int count = uart_read_bytes(kNavUart, bytes, sizeof(bytes), pdMS_TO_TICKS(20));
        for (int i = 0; i < count; ++i) {
            if (msp.feed(bytes[i], msp_frame)) {
                const uint64_t t = now_us64();
                flownav::FlowSample flow{};
                flownav::RangeSample range{};
                if (flownav::decode_flow(msp_frame, t, flow)) {
                    portENTER_CRITICAL(&wire_mux);
                    pending_flow.dx += flow.dx; pending_flow.dy += flow.dy;
                    pending_flow.quality = std::min(pending_flow.quality, flow.quality);
                    pending_flow.us = t; pending_flow.any = true;
                    portEXIT_CRITICAL(&wire_mux);
                } else if (flownav::decode_range(msp_frame, t, range)) {
                    portENTER_CRITICAL(&wire_mux);
                    range_snapshot = range; ++range_generation;
                    portEXIT_CRITICAL(&wire_mux);
                }
            }
            if (!parser.feed(bytes[i], frame)) continue;
            // Do not decode here. Bad CRC/version/sequence must reach exactly the
            // same FirmwareRuntime validation path as browser SIL and S31 HIL.
            portENTER_CRITICAL(&wire_mux);
            navigation_frame_snapshot = frame;
            ++navigation_generation;
            portEXIT_CRITICAL(&wire_mux);
        }
    }
#else
    vTaskDelete(nullptr);
#endif
}

esp_err_t mag_init() {
#if FC_PIN_MAG_SDA >= 0 && FC_PIN_MAG_SCL >= 0
    i2c_master_bus_config_t bus{};
    bus.i2c_port = I2C_NUM_0;
    bus.sda_io_num = static_cast<gpio_num_t>(FC_PIN_MAG_SDA);
    bus.scl_io_num = static_cast<gpio_num_t>(FC_PIN_MAG_SCL);
    bus.clk_source = I2C_CLK_SRC_DEFAULT;
    bus.glitch_ignore_cnt = 7;
    bus.flags.enable_internal_pullup = true;
    i2c_master_bus_handle_t handle{};
    HW_TRY(i2c_new_master_bus(&bus, &handle), "mag i2c bus");
    for (const uint8_t address : {flownav::kQmc5883lAddress, flownav::kQmc5883pAddress}) {
        if (i2c_master_probe(handle, address, 20) != ESP_OK) continue;
        i2c_device_config_t dev{};
        dev.dev_addr_length = I2C_ADDR_BIT_LEN_7;
        dev.device_address = address;
        dev.scl_speed_hz = 400000;
        HW_TRY(i2c_master_bus_add_device(handle, &dev, &mag_dev), "mag device");
        mag_is_p = address == flownav::kQmc5883pAddress;
        if (mag_is_p) {
            const uint8_t mode[2] = {0x0A, 0xCF};   // continuous, 200 Hz, OSR 8 / 8
            const uint8_t cfg[2] = {0x0B, 0x08};    // set/reset on, ±8 G
            HW_TRY(i2c_master_transmit(mag_dev, cfg, 2, 20), "qmc5883p config");
            HW_TRY(i2c_master_transmit(mag_dev, mode, 2, 20), "qmc5883p mode");
        } else {
            const uint8_t period[2] = {0x0B, 0x01};  // set/reset period
            const uint8_t ctrl[2] = {0x09, 0x1D};    // continuous, 200 Hz, ±8 G, OSR 512
            HW_TRY(i2c_master_transmit(mag_dev, period, 2, 20), "qmc5883l period");
            HW_TRY(i2c_master_transmit(mag_dev, ctrl, 2, 20), "qmc5883l control");
        }
        ESP_LOGI(kTag, "compass QMC5883%c at 0x%02x", mag_is_p ? 'P' : 'L', address);
        return ESP_OK;
    }
    ESP_LOGW(kTag, "no compass found: on-board FlowNav reports no heading (GAME needs a NAV1 module)");
#endif
    return ESP_OK;
}

void mag_task(void*) {
    for (;;) {
        if (mag_dev) {
            const uint8_t reg = mag_is_p ? 0x01 : 0x00;
            uint8_t raw[6]{};
            flownav::V3f m{};
            if (i2c_master_transmit_receive(mag_dev, &reg, 1, raw, sizeof(raw), 10) == ESP_OK && flownav::decode_qmc(raw, m)) {
                portENTER_CRITICAL(&wire_mux);
                mag_snapshot = m; mag_us = now_us64(); ++mag_generation;
                portEXIT_CRITICAL(&wire_mux);
            }
        }
        vTaskDelay(pdMS_TO_TICKS(10));
    }
}

void load_flownav_store() {
    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        (void)nvs_flash_erase();
        err = nvs_flash_init();
    }
    if (err != ESP_OK) return;
    nvs_handle_t handle{};
    if (nvs_open("flownav", NVS_READWRITE, &handle) != ESP_OK) return;
#if FC_FLOWNAV_RESET
    (void)nvs_erase_key(handle, "cal");
    (void)nvs_commit(handle);
#else
    StoredFlowNav stored{};
    size_t size = sizeof(stored);
    if (nvs_get_blob(handle, "cal", &stored, &size) == ESP_OK && size == sizeof(stored) &&
        stored.magic == StoredFlowNav{}.magic && stored.version == StoredFlowNav{}.version) {
        store_loaded = stored;
        store_valid = true;
        ESP_LOGI(kTag, "FlowNav calibration loaded: flow=%d compass=%d sense=%d",
                 stored.flow.ready, stored.mag.ready, static_cast<int>(stored.sense));
    }
#endif
    nvs_close(handle);
}

// writes a new calibration to flash outside the flight loop (a flash write stalls for ms)
void store_task(void*) {
    for (;;) {
        vTaskDelay(pdMS_TO_TICKS(500));
        if (!store_dirty.exchange(false) || armed.load(std::memory_order_acquire)) continue;
        StoredFlowNav copy{};
        portENTER_CRITICAL(&wire_mux);
        copy = store_pending;
        portEXIT_CRITICAL(&wire_mux);
        nvs_handle_t handle{};
        if (nvs_open("flownav", NVS_READWRITE, &handle) != ESP_OK) continue;
        if (nvs_set_blob(handle, "cal", &copy, sizeof(copy)) == ESP_OK) (void)nvs_commit(handle);
        nvs_close(handle);
        ESP_LOGI(kTag, "FlowNav calibration stored: flow=%d compass=%d sense=%d",
                 copy.flow.ready, copy.mag.ready, static_cast<int>(copy.sense));
    }
}

void snapshot_wire(std::array<uint8_t, 25>& sbus, uint32_t& sbus_gen,
                   hwcontract::NavigationWireFrame& navigation, uint32_t& nav_gen) {
    portENTER_CRITICAL(&wire_mux);
    sbus = sbus_frame_snapshot;
    sbus_gen = sbus_generation;
    navigation = navigation_frame_snapshot;
    nav_gen = navigation_generation;
    portEXIT_CRITICAL(&wire_mux);
}

void flight_task(void*) {
    if (esp_task_wdt_add(nullptr) != ESP_OK) fatal("flight watchdog registration");
    if (imu_init() != ESP_OK) fatal("imu init");

    fc::FirmwareRuntime runtime;
    uint64_t last_us = 0;
    uint32_t consumed_sbus_generation = 0;
    uint32_t consumed_navigation_generation = 0;
    // On-board NAV1 producer (flow + lidar + compass). An external NAV1 module, when it
    // talks, always wins; FlowNav only fills in while none has been heard for 0.5 s.
    flownav::FlowNav flow_nav;
    if (store_valid) {
        if (store_loaded.flow.ready) flow_nav.set_flow_calibration(store_loaded.flow);
        if (store_loaded.mag.ready) flow_nav.set_mag_calibration(store_loaded.mag);
        if (store_loaded.sense == 1 || store_loaded.sense == -1) flow_nav.set_heading_sense(store_loaded.sense);
    }
    uint64_t external_nav_us = 0, last_cal_check_us = 0;
    uint32_t consumed_range_generation = 0, consumed_mag_generation = 0;
    std::array<int16_t, 3> attitude_cdeg{};
    bool stored_flow = store_valid && store_loaded.flow.ready, stored_mag = store_valid && store_loaded.mag.ready,
         stored_sense = store_valid && store_loaded.sense != 0;

    for (;;) {
        const uint32_t notifications = ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(5));
        if (!notifications) fatal("imu timeout");

        const uint64_t now = now_us64();
        std::array<uint8_t, 14> imu_registers{};
        if (sample_imu_registers(imu_registers) != ESP_OK) fatal("imu data");
        const uint32_t dt_us = last_us ? static_cast<uint32_t>(now - last_us) : fc::kNominalDtUs;
        last_us = now;

#if FC_PIN_KILL >= 0
        if (!gpio_get_level(static_cast<gpio_num_t>(FC_PIN_KILL))) fatal("kill switch");
#endif

        std::array<uint8_t, 25> sbus_frame{};
        hwcontract::NavigationWireFrame navigation_frame{};
        uint32_t sbus_gen = 0, nav_gen = 0;
        snapshot_wire(sbus_frame, sbus_gen, navigation_frame, nav_gen);

        fc::HardwareFrame hardware{};
        hardware.now_us = now;
        hardware.dt_us = dt_us;
        hardware.missed_samples = notifications > 1 ? notifications - 1 : 0;
        hardware.imu_registers = imu_registers;
        hardware.imu_present = true;
        if (sbus_gen != consumed_sbus_generation) {
            hardware.sbus_frame = sbus_frame;
            hardware.sbus_present = true;
            consumed_sbus_generation = sbus_gen;
        }
        if (nav_gen != consumed_navigation_generation) {
            hardware.navigation_frame = navigation_frame;
            hardware.navigation_present = true;
            consumed_navigation_generation = nav_gen;
            external_nav_us = now;
        }

        // ---- on-board FlowNav (only while no external NAV1 module is talking)
        {
            const bool disarmed = !armed.load(std::memory_order_acquire);
            fc::Imu imu{};
            if (hwcontract::decode_icm42688_registers(imu_registers.data(), imu))
                flow_nav.add_gyro(imu.g.x, imu.g.y, dt_us * 1e-6f, attitude_cdeg[0] * 0.01f,
                                  attitude_cdeg[1] * 0.01f, attitude_cdeg[2] * 0.01f);
            PendingFlow flow{};
            flownav::RangeSample range{};
            flownav::V3f mag{};
            uint64_t mag_t = 0;
            uint32_t range_gen = 0, mag_gen = 0;
            portENTER_CRITICAL(&wire_mux);
            flow = pending_flow; pending_flow = PendingFlow{};
            range = range_snapshot; range_gen = range_generation;
            mag = mag_snapshot; mag_t = mag_us; mag_gen = mag_generation;
            portEXIT_CRITICAL(&wire_mux);
            bool fresh = false;
            if (range_gen != consumed_range_generation) { flow_nav.add_range(range); consumed_range_generation = range_gen; fresh = true; }
            if (flow.any) { flow_nav.add_flow(flownav::FlowSample{flow.quality, flow.dx, flow.dy, flow.us}, disarmed); fresh = true; }
            if (mag_gen != consumed_mag_generation) { flow_nav.add_mag(mag, mag_t, disarmed); consumed_mag_generation = mag_gen; }
            if (fresh && (!external_nav_us || now - external_nav_us > 500000)) {
                hwcontract::NavigationWireFrame produced{};
                if (flow_nav.build(now, produced)) {
                    hardware.navigation_frame = produced;
                    hardware.navigation_present = true;
                }
            }
            // learn and keep the calibrations (hand-held, disarmed), once a second
            if (disarmed && now - last_cal_check_us > 1000000) {
                last_cal_check_us = now;
                if (!flow_nav.flow_calibration().ready) (void)flow_nav.try_flow_calibration();
                const bool f = flow_nav.flow_calibration().ready, m = flow_nav.mag_calibration().ready, h = flow_nav.heading_sense() != 0;
                if ((f && !stored_flow) || (m && !stored_mag) || (h && !stored_sense)) {
                    StoredFlowNav next{};
                    next.flow = flow_nav.flow_calibration(); next.mag = flow_nav.mag_calibration(); next.sense = flow_nav.heading_sense();
                    portENTER_CRITICAL(&wire_mux);
                    store_pending = next;
                    portEXIT_CRITICAL(&wire_mux);
                    store_dirty.store(true);
                    stored_flow = f; stored_mag = m; stored_sense = h;
                }
            }
        }

        const fc::RuntimeOutput output = runtime.step(hardware);
        attitude_cdeg = output.attitude_cdeg;

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
    ESP_ERROR_CHECK(hw::navigation_init());
    hw::load_flownav_store();
    ESP_ERROR_CHECK(hw::mag_init());

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
    created = xTaskCreatePinnedToCore(hw::navigation_task, "nav", 4096, nullptr,
                                     11, nullptr, kServiceCore);
    ESP_ERROR_CHECK(created == pdPASS ? ESP_OK : ESP_ERR_NO_MEM);
    created = xTaskCreatePinnedToCore(hw::mag_task, "mag", 3072, nullptr,
                                     9, nullptr, kServiceCore);
    ESP_ERROR_CHECK(created == pdPASS ? ESP_OK : ESP_ERR_NO_MEM);
    created = xTaskCreatePinnedToCore(hw::store_task, "store", 4096, nullptr,
                                     2, nullptr, kServiceCore);
    ESP_ERROR_CHECK(created == pdPASS ? ESP_OK : ESP_ERR_NO_MEM);
}
