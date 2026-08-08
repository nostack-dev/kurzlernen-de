#pragma once

#include "Arondight45_FirmwareRuntime.hpp"

#include <array>
#include <cstddef>
#include <cstdint>
#include <cstring>

namespace hil {

constexpr uint32_t kInputMagic = 0x314C4948u;   // HIL1 little-endian
constexpr uint32_t kOutputMagic = 0x314F4C48u;  // HLO1 little-endian
constexpr uint16_t kProtocolVersion = 3;
constexpr uint16_t kFlagImuPresent = 1u << 0;
constexpr uint16_t kFlagReset = 1u << 1;
constexpr uint16_t kFlagSbusPresent = 1u << 2;
constexpr uint16_t kFlagNavigationPresent = 1u << 3;

#pragma pack(push, 1)
struct InputPacket {
    uint32_t magic;
    uint32_t sequence;
    uint32_t dt_us;
    uint16_t missed_samples;
    uint16_t flags;
    uint8_t imu_registers[14];
    uint8_t sbus[25];
    uint8_t navigation_frame[hwcontract::kNavigationFrameBytes];
    uint8_t reserved;
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

static_assert(sizeof(InputPacket) == 80, "HIL v3 input packet must be 80 bytes");
static_assert(sizeof(OutputPacket) == 32, "HIL output packet must be 32 bytes");

inline uint32_t crc32(const void* data, size_t length) {
    const auto* p = static_cast<const uint8_t*>(data);
    uint32_t crc = 0xFFFFFFFFu;
    for (size_t i = 0; i < length; ++i) {
        crc ^= p[i];
        for (unsigned bit = 0; bit < 8; ++bit)
            crc = (crc >> 1) ^ (0xEDB88320u & (0u - (crc & 1u)));
    }
    return ~crc;
}

class RuntimeAdapter {
public:
    void reset() {
        runtime_.reset();
        sim_us_ = 0;
    }

    OutputPacket process(const InputPacket& in, uint32_t processing_us = 0) {
        OutputPacket out{};
        out.magic = kOutputMagic;
        out.sequence = in.sequence;
        out.processing_us = processing_us;
        for (auto& pulse : out.motor_us) pulse = fc::kEscMinUs;

        const bool packet_ok = in.magic == kInputMagic &&
            crc32(&in, offsetof(InputPacket, crc32)) == in.crc32;
        if (!packet_ok) {
            out.state = fc::kStateFault | (static_cast<uint16_t>(fc::kFaultProtocol) << 8);
            out.crc32 = crc32(&out, offsetof(OutputPacket, crc32));
            return out;
        }
        if ((in.flags & kFlagReset) != 0) reset();

        sim_us_ += in.dt_us;
        fc::HardwareFrame frame{};
        frame.now_us = sim_us_;
        frame.dt_us = in.dt_us;
        frame.missed_samples = in.missed_samples;
        frame.imu_present = (in.flags & kFlagImuPresent) != 0;
        frame.sbus_present = (in.flags & kFlagSbusPresent) != 0;
        frame.navigation_present = (in.flags & kFlagNavigationPresent) != 0;
        std::memcpy(frame.imu_registers.data(), in.imu_registers, frame.imu_registers.size());
        std::memcpy(frame.sbus_frame.data(), in.sbus, frame.sbus_frame.size());
        std::memcpy(&frame.navigation_frame, in.navigation_frame, sizeof(frame.navigation_frame));

        const fc::RuntimeOutput result = runtime_.step(frame);
        for (size_t i = 0; i < 4; ++i) out.motor_us[i] = result.motor_us[i];
        for (size_t i = 0; i < 3; ++i) out.attitude_cdeg[i] = result.attitude_cdeg[i];
        out.state = result.state;
        out.crc32 = crc32(&out, offsetof(OutputPacket, crc32));
        return out;
    }

    fc::FirmwareRuntime& runtime() { return runtime_; }
    const fc::FirmwareRuntime& runtime() const { return runtime_; }

private:
    fc::FirmwareRuntime runtime_{};
    uint64_t sim_us_{};
};

class PacketParser {
public:
    bool feed(uint8_t byte, InputPacket& packet) {
        constexpr uint8_t magic[4] = {'H', 'I', 'L', '1'};
        if (size_ < 4) {
            if (byte == magic[size_]) buffer_[size_++] = byte;
            else {
                size_ = byte == magic[0] ? 1u : 0u;
                if (size_ == 1) buffer_[0] = byte;
            }
            return false;
        }
        buffer_[size_++] = byte;
        if (size_ < sizeof(InputPacket)) return false;
        std::memcpy(&packet, buffer_.data(), sizeof(packet));
        size_ = 0;
        return true;
    }
private:
    std::array<uint8_t, sizeof(InputPacket)> buffer_{};
    size_t size_{};
};

}  // namespace hil
