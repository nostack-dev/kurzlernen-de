/*
 * Arondight45 DroneFC functional hardware-in-the-loop adapter for ESP32-S31.
 *
 * The physical S31 executes the exact fc::Runtime used by production firmware.
 * Browser/host supplies HIL1 sensor + SBUS packets and receives HLO1 motor pulses.
 * This validates controller execution on the real MCU. It deliberately does not
 * claim to reproduce the production IMU-DRDY scheduling path; that remains a
 * separate physical timing/bench validation concern.
 */

#include "Arondight45_HIL_Protocol.hpp"

#include <cstddef>
#include <cstdint>

extern "C" {
#include "sdkconfig.h"
#include "driver/usb_serial_jtag.h"
#include "esp_err.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
}

#ifndef CONFIG_IDF_TARGET_ESP32S31
#error Build this HIL adapter with: idf.py set-target esp32s31
#endif

namespace {

constexpr char kTag[] = "Arondight45-HIL";

uint32_t processing_us_since(int64_t start) {
    const int64_t elapsed = esp_timer_get_time() - start;
    return elapsed > 0 ? static_cast<uint32_t>(elapsed) : 0;
}

void hil_task(void*) {
    hil::RuntimeAdapter runtime;
    hil::PacketParser parser;
    hil::InputPacket input{};
    uint8_t buffer[256];

    for (;;) {
        const int count = usb_serial_jtag_read_bytes(buffer, sizeof(buffer), pdMS_TO_TICKS(100));
        for (int i = 0; i < count; ++i) {
            if (!parser.feed(buffer[i], input)) continue;

            const int64_t start = esp_timer_get_time();
            hil::OutputPacket output = runtime.process(input);
            output.processing_us = processing_us_since(start);
            output.crc32 = hil::crc32(&output, offsetof(hil::OutputPacket, crc32));

            const int written = usb_serial_jtag_write_bytes(&output, sizeof(output), pdMS_TO_TICKS(100));
            if (written != static_cast<int>(sizeof(output))) {
                ESP_LOGE(kTag, "short USB write: %d", written);
            }
        }
    }
}

}  // namespace

extern "C" void app_main() {
    usb_serial_jtag_driver_config_t config = USB_SERIAL_JTAG_DRIVER_CONFIG_DEFAULT();
    config.rx_buffer_size = 4096;
    config.tx_buffer_size = 4096;
    ESP_ERROR_CHECK(usb_serial_jtag_driver_install(&config));

#if CONFIG_FREERTOS_NUMBER_OF_CORES > 1
    constexpr BaseType_t kCore = 1;
#else
    constexpr BaseType_t kCore = tskNO_AFFINITY;
#endif

    const BaseType_t created = xTaskCreatePinnedToCore(
        hil_task, "drone_hil", 12288, nullptr,
        configMAX_PRIORITIES - 2, nullptr, kCore);
    ESP_ERROR_CHECK(created == pdPASS ? ESP_OK : ESP_ERR_NO_MEM);
}
