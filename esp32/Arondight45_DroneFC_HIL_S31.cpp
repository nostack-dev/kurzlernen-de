/*
 * Arondight45 DroneFC hardware-in-the-loop adapter for ESP32-S31.
 *
 * ZERO-DIVERGENCE RULE:
 * This translation unit includes the production Arondight45_DroneFC_S31.cpp
 * directly and executes its fc:: filters, attitude estimator, arming state
 * machine, PID controllers, mixer and pulse mapping on the physical S31.
 * There is no browser-side flight-controller implementation.
 *
 * Build as the only component source:
 *   idf_component_register(
 *     SRCS "Arondight45_DroneFC_HIL_S31.cpp"
 *     INCLUDE_DIRS ".")
 *   idf.py set-target esp32s31
 *   idf.py build flash
 *
 * The browser supplies raw ICM-42688-P register bytes plus a complete 25-byte
 * SBUS frame over USB Serial/JTAG. The S31 returns the actual production
 * controller's four PWM pulse widths. Props/ESCs are not required and no motor
 * GPIO is driven by this HIL adapter.
 */

#define FC_HOST_TEST 1
#define main arondight45_embedded_core_selftest
#include "Arondight45_DroneFC_S31.cpp"
#undef main
#undef FC_HOST_TEST
#ifdef CK
#undef CK
#endif

#include <array>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <limits>

namespace hil {

constexpr uint32_t kInputMagic = 0x314C4948u;   // "HIL1" little-endian
constexpr uint32_t kOutputMagic = 0x314F4C48u;  // "HLO1" little-endian
constexpr uint16_t kProtocolVersion = 1;
constexpr uint8_t kFlagImuValid = 1u << 0;
constexpr uint8_t kFlagReset = 1u << 1;

enum StateBits : uint16_t {
    kStateArmed = 1u << 0,
    kStateCalibrating = 1u << 1,
    kStateFault = 1u << 2,
    kStateRcValid = 1u << 3,
    kStateImuValid = 1u << 4,
};

enum FaultCode : uint8_t {
    kFaultNone = 0,
    kFaultProtocol = 1,
    kFaultImu = 2,
    kFaultTiming = 3,
    kFaultRate = 4,
    kFaultTilt = 5,
};

#pragma pack(push, 1)
struct InputPacket {
    uint32_t magic;
    uint32_t sequence;
    uint32_t dt_us;
    uint8_t imu_registers[14];
    uint8_t sbus[25];
    uint8_t flags;
    uint8_t reserved[8];
    uint32_t crc32;
};
struct OutputPacket {
    uint32_t magic;
    uint32_t sequence;
    uint16_t motor_us[4];
    int16_t attitude_cdeg[3];
    uint16_t state;
    uint32_t processing_us;
    uint32_t crc32;
};
#pragma pack(pop)

static_assert(sizeof(InputPacket) == 64, "HIL input packet must be 64 bytes");
static_assert(sizeof(OutputPacket) == 32, "HIL output packet must be 32 bytes");

uint32_t crc32(const void* data, size_t length) {
    const auto* p = static_cast<const uint8_t*>(data);
    uint32_t crc = 0xFFFFFFFFu;
    for (size_t i = 0; i < length; ++i) {
        crc ^= p[i];
        for (unsigned bit = 0; bit < 8; ++bit) {
            crc = (crc >> 1) ^ (0xEDB88320u & (0u - (crc & 1u)));
        }
    }
    return ~crc;
}

int16_t read_be_i16(const uint8_t* p) {
    return static_cast<int16_t>((static_cast<uint16_t>(p[0]) << 8) | p[1]);
}

bool decode_imu_registers(const uint8_t raw[14], fc::Imu& out) {
    const int16_t bad = std::numeric_limits<int16_t>::min();
    const int16_t ax = read_be_i16(raw + 2);
    const int16_t ay = read_be_i16(raw + 4);
    const int16_t az = read_be_i16(raw + 6);
    const int16_t gx = read_be_i16(raw + 8);
    const int16_t gy = read_be_i16(raw + 10);
    const int16_t gz = read_be_i16(raw + 12);
    if (ax == bad || ay == bad || az == bad ||
        gx == bad || gy == bad || gz == bad) {
        return false;
    }
    out.a = {ax / 2048.0f, ay / 2048.0f, az / 2048.0f};
    out.g = {gx / 16.4f, gy / 16.4f, gz / 16.4f};
    return fc::finite(out.a) && fc::finite(out.g);
}

class Runtime {
public:
    OutputPacket process(const InputPacket& in, uint32_t processing_us = 0) {
        if ((in.flags & kFlagReset) != 0) reset();

        OutputPacket out{};
        out.magic = kOutputMagic;
        out.sequence = in.sequence;
        out.processing_us = processing_us;
        for (auto& pulse : out.motor_us) pulse = 1000;

        const bool packet_ok =
            in.magic == kInputMagic &&
            crc32(&in, offsetof(InputPacket, crc32)) == in.crc32;
        if (!packet_ok) {
            set_fault(kFaultProtocol);
            finalize(out, false, false);
            return out;
        }

        const uint32_t dt_us = in.dt_us;
        if (dt_us < 600 || dt_us > 1600) {
            if (++bad_timing_ >= 5) set_fault(kFaultTiming);
        } else {
            bad_timing_ = 0;
        }
        sim_us_ += dt_us;
        const float dt = static_cast<float>(dt_us) * 1.0e-6f;

        fc::Imu raw{};
        const bool imu_ok =
            (in.flags & kFlagImuValid) != 0 &&
            decode_imu_registers(in.imu_registers, raw);

        fc::RC rc{};
        const bool sbus_ok = fc::decode(in.sbus, rc);
        rc.us = sim_us_;
        const bool rc_ok = sbus_ok && rc.valid;

        if (!imu_ok) {
            set_fault(kFaultImu);
            finalize(out, rc_ok, false);
            return out;
        }

        if (!calibrated_) {
            calibrate(raw);
            out.state |= kStateCalibrating;
            finalize(out, rc_ok, true);
            return out;
        }

        raw.g.x -= gyro_bias_.x;
        raw.g.y -= gyro_bias_.y;
        raw.g.z -= gyro_bias_.z;

        const fc::Imu imu = filters_.run(raw, dt);
        if (!fc::finite(imu.a) || !fc::finite(imu.g) ||
            std::fabs(imu.g.x) > 1750.0f ||
            std::fabs(imu.g.y) > 1750.0f ||
            std::fabs(imu.g.z) > 1750.0f) {
            set_fault(kFaultRate);
        }

        const fc::Cmd cmd = fc::command(rc);
        controller_.att.run(imu, dt);
        const auto arm_result = arm_.run(
            sim_us_, rc_ok, cmd,
            fc::mag(imu.a) > 0.7f && fc::mag(imu.a) < 1.3f,
            controller_.att.r, controller_.att.p);

        if (!arm_result.armed || fault_ != kFaultNone) controller_.reset();

        if (arm_result.armed && fault_ == kFaultNone) {
            if (std::fabs(controller_.att.r) > 68.0f ||
                std::fabs(controller_.att.p) > 68.0f) {
                set_fault(kFaultTilt);
            } else {
                fc::Mix mix{};
                if (cmd.t <= 0.02f) {
                    controller_.reset();
                } else {
                    mix = controller_.run(imu, cmd, dt, cmd.t > 0.05f);
                }
                for (size_t i = 0; i < 4; ++i) {
                    out.motor_us[i] = fc::pulse(mix.m[i], true, 1050, 2000);
                }
                armed_ = true;
            }
        } else {
            armed_ = false;
        }

        out.attitude_cdeg[0] = to_cdeg(controller_.att.r);
        out.attitude_cdeg[1] = to_cdeg(controller_.att.p);
        out.attitude_cdeg[2] = to_cdeg(controller_.att.y);
        finalize(out, rc_ok, true);
        return out;
    }

    void reset() {
        filters_ = fc::Filters{};
        controller_ = fc::Control{};
        arm_ = fc::Arm{};
        sim_us_ = 0;
        calibrated_ = false;
        calibration_count_ = 0;
        gyro_sum_ = {};
        accel_sum_ = {};
        gyro_bias_ = {};
        bad_timing_ = 0;
        fault_ = kFaultNone;
        armed_ = false;
    }

private:
    static int16_t to_cdeg(float degrees) {
        const float v = fc::clamp(degrees * 100.0f, -32767.0f, 32767.0f);
        return static_cast<int16_t>(std::lround(v));
    }

    void calibrate(const fc::Imu& sample) {
        gyro_sum_.x += sample.g.x;
        gyro_sum_.y += sample.g.y;
        gyro_sum_.z += sample.g.z;
        accel_sum_.x += sample.a.x;
        accel_sum_.y += sample.a.y;
        accel_sum_.z += sample.a.z;
        ++calibration_count_;
        if (calibration_count_ >= 2000) {
            const float k = 1.0f / static_cast<float>(calibration_count_);
            gyro_bias_ = {gyro_sum_.x * k, gyro_sum_.y * k, gyro_sum_.z * k};
            const fc::V3 accel_mean{
                accel_sum_.x * k, accel_sum_.y * k, accel_sum_.z * k};
            if (std::fabs(gyro_bias_.x) > 15.0f ||
                std::fabs(gyro_bias_.y) > 15.0f ||
                std::fabs(gyro_bias_.z) > 15.0f ||
                fc::mag(accel_mean) < 0.85f ||
                fc::mag(accel_mean) > 1.15f) {
                set_fault(kFaultImu);
                return;
            }
            controller_.att.reset(accel_mean);
            calibrated_ = true;
        }
    }

    void set_fault(FaultCode fault) {
        if (fault_ == kFaultNone) fault_ = fault;
        armed_ = false;
    }

    void finalize(OutputPacket& out, bool rc_ok, bool imu_ok) const {
        if (armed_) out.state |= kStateArmed;
        if (!calibrated_) out.state |= kStateCalibrating;
        if (fault_ != kFaultNone) {
            out.state |= kStateFault;
            out.state |= static_cast<uint16_t>(fault_) << 8;
        }
        if (rc_ok) out.state |= kStateRcValid;
        if (imu_ok) out.state |= kStateImuValid;
        out.crc32 = crc32(&out, offsetof(OutputPacket, crc32));
    }

    fc::Filters filters_{};
    fc::Control controller_{};
    fc::Arm arm_{};
    uint64_t sim_us_{};
    bool calibrated_{};
    uint32_t calibration_count_{};
    fc::V3 gyro_sum_{};
    fc::V3 accel_sum_{};
    fc::V3 gyro_bias_{};
    uint32_t bad_timing_{};
    FaultCode fault_{kFaultNone};
    bool armed_{};
};

class PacketParser {
public:
    bool feed(uint8_t byte, InputPacket& packet) {
        const uint8_t magic[4] = {'H', 'I', 'L', '1'};
        if (size_ < 4) {
            if (byte == magic[size_]) {
                buffer_[size_++] = byte;
            } else {
                size_ = byte == magic[0] ? 1 : 0;
                if (size_ == 1) buffer_[0] = byte;
            }
            return false;
        }
        buffer_[size_++] = byte;
        if (size_ != sizeof(InputPacket)) return false;
        std::memcpy(&packet, buffer_.data(), sizeof(packet));
        size_ = 0;
        return true;
    }

private:
    std::array<uint8_t, sizeof(InputPacket)> buffer_{};
    size_t size_{};
};

}  // namespace hil

#ifdef HIL_HOST_TEST

#include <cstdio>
#include <cstdlib>

#define HIL_CHECK(x) do { \
    if (!(x)) { \
        std::fprintf(stderr, "HIL FAIL line %d: %s\n", __LINE__, #x); \
        std::exit(1); \
    } \
} while (0)

static void encode_sbus(const std::array<uint16_t, 16>& channels, uint8_t* p) {
    std::memset(p, 0, 25);
    p[0] = 0x0F;
    p[24] = 0x00;
    for (int c = 0; c < 16; ++c) {
        for (int bit = 0; bit < 11; ++bit) {
            if ((channels[c] & (1u << bit)) != 0) {
                const int k = 8 + c * 11 + bit;
                p[k / 8] |= static_cast<uint8_t>(1u << (k % 8));
            }
        }
    }
}

int main() {
    HIL_CHECK(sizeof(hil::InputPacket) == 64);
    HIL_CHECK(sizeof(hil::OutputPacket) == 32);
    HIL_CHECK(hil::crc32("123456789", 9) == 0xCBF43926u);

    hil::Runtime runtime;
    hil::InputPacket input{};
    input.magic = hil::kInputMagic;
    input.dt_us = 1000;
    input.flags = hil::kFlagImuValid | hil::kFlagReset;
    input.imu_registers[6] = 0x08;
    std::array<uint16_t, 16> channels{};
    channels.fill(992);
    channels[2] = 172;
    channels[4] = 172;
    encode_sbus(channels, input.sbus);

    hil::OutputPacket out{};
    for (uint32_t i = 0; i < 2100; ++i) {
        input.sequence = i;
        input.flags = hil::kFlagImuValid | (i == 0 ? hil::kFlagReset : 0);
        input.crc32 = hil::crc32(&input, offsetof(hil::InputPacket, crc32));
        out = runtime.process(input);
        HIL_CHECK(out.magic == hil::kOutputMagic);
        HIL_CHECK(out.sequence == i);
        HIL_CHECK(hil::crc32(&out, offsetof(hil::OutputPacket, crc32)) == out.crc32);
        for (auto pulse : out.motor_us) HIL_CHECK(pulse == 1000);
    }
    HIL_CHECK((out.state & hil::kStateCalibrating) == 0);

    channels[4] = 172;
    encode_sbus(channels, input.sbus);
    input.sequence++;
    input.crc32 = hil::crc32(&input, offsetof(hil::InputPacket, crc32));
    out = runtime.process(input);
    HIL_CHECK((out.state & hil::kStateArmed) == 0);

    channels[4] = 1811;
    encode_sbus(channels, input.sbus);
    for (uint32_t i = 0; i < 1002; ++i) {
        input.sequence++;
        input.crc32 = hil::crc32(&input, offsetof(hil::InputPacket, crc32));
        out = runtime.process(input);
    }
    HIL_CHECK((out.state & hil::kStateArmed) != 0);
    for (auto pulse : out.motor_us) HIL_CHECK(pulse == 1050);

    channels[2] = 700;
    encode_sbus(channels, input.sbus);
    input.sequence++;
    input.crc32 = hil::crc32(&input, offsetof(hil::InputPacket, crc32));
    out = runtime.process(input);
    HIL_CHECK((out.state & hil::kStateArmed) != 0);
    for (auto pulse : out.motor_us) HIL_CHECK(pulse > 1050);

    std::puts("All Arondight45 S31 HIL protocol tests passed.");
    return 0;
}

#else

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
    hil::Runtime runtime;
    hil::PacketParser parser;
    hil::InputPacket input{};
    uint8_t buffer[256];

    for (;;) {
        const int count = usb_serial_jtag_read_bytes(
            buffer, sizeof(buffer), pdMS_TO_TICKS(100));
        for (int i = 0; i < count; ++i) {
            if (!parser.feed(buffer[i], input)) continue;

            const int64_t start = esp_timer_get_time();
            hil::OutputPacket output = runtime.process(input);
            output.processing_us = processing_us_since(start);
            output.crc32 = hil::crc32(
                &output, offsetof(hil::OutputPacket, crc32));

            const int written = usb_serial_jtag_write_bytes(
                &output, sizeof(output), pdMS_TO_TICKS(100));
            if (written != static_cast<int>(sizeof(output))) {
                ESP_LOGE(kTag, "short USB write: %d", written);
            }
        }
    }
}

}  // namespace

extern "C" void app_main() {
    usb_serial_jtag_driver_config_t config =
        USB_SERIAL_JTAG_DRIVER_CONFIG_DEFAULT();
    config.rx_buffer_size = 4096;
    config.tx_buffer_size = 4096;
    ESP_ERROR_CHECK(usb_serial_jtag_driver_install(&config));

#if CONFIG_FREERTOS_NUMBER_OF_CORES > 1
    constexpr BaseType_t kCore = 1;
#else
    constexpr BaseType_t kCore = tskNO_AFFINITY;
#endif

    const BaseType_t result = xTaskCreatePinnedToCore(
        hil_task, "drone_hil", 12288, nullptr,
        configMAX_PRIORITIES - 2, nullptr, kCore);
    ESP_ERROR_CHECK(result == pdPASS ? ESP_OK : ESP_ERR_NO_MEM);
}

#endif
