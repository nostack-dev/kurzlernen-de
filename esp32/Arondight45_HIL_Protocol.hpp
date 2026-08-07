#pragma once

#include "Arondight45_StateControl.hpp"

#include <array>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <limits>

namespace hil {

constexpr uint32_t kInputMagic = 0x314C4948u;   // HIL1 little-endian
constexpr uint32_t kOutputMagic = 0x314F4C48u;  // HLO1 little-endian
constexpr uint16_t kProtocolVersion = 2;
constexpr uint8_t kFlagImuValid = 1u << 0;
constexpr uint8_t kFlagReset = 1u << 1;
constexpr uint8_t kFlagNavigationValid = 1u << 2;

#pragma pack(push, 1)
struct InputPacket {
    uint32_t magic;
    uint32_t sequence;
    uint32_t dt_us;
    uint8_t imu_registers[14];
    uint8_t sbus[25];
    uint8_t flags;
    // Protocol v2 uses the original 8 reserved bytes for actual navigation-sensor
    // measurements. Packet size and transport framing stay unchanged.
    int16_t nav_vx_cms;
    int16_t nav_vy_cms;
    int16_t nav_vz_cms;
    uint16_t nav_agl_mm;
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

inline uint32_t crc32(const void* data, size_t length) {
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

inline int16_t read_be_i16(const uint8_t* p) {
    return static_cast<int16_t>((static_cast<uint16_t>(p[0]) << 8) | p[1]);
}

inline bool decode_imu_registers(const uint8_t raw[14], fc::Imu& out) {
    const int16_t bad = std::numeric_limits<int16_t>::min();
    const int16_t ax = read_be_i16(raw + 2);
    const int16_t ay = read_be_i16(raw + 4);
    const int16_t az = read_be_i16(raw + 6);
    const int16_t gx = read_be_i16(raw + 8);
    const int16_t gy = read_be_i16(raw + 10);
    const int16_t gz = read_be_i16(raw + 12);
    if (ax == bad || ay == bad || az == bad || gx == bad || gy == bad || gz == bad) return false;
    out.a = {ax / 2048.0f, ay / 2048.0f, az / 2048.0f};
    out.g = {gx / 16.4f, gy / 16.4f, gz / 16.4f};
    return fc::finite(out.a) && fc::finite(out.g);
}

inline fc::NavigationState decode_navigation(const InputPacket& in) {
    fc::NavigationState nav{};
    nav.valid = (in.flags & kFlagNavigationValid) != 0;
    nav.velocity_world_mps = {in.nav_vx_cms * 0.01f,
                              in.nav_vy_cms * 0.01f,
                              in.nav_vz_cms * 0.01f};
    nav.agl_m = in.nav_agl_mm * 0.001f;
    nav.valid = fc::finite(nav);
    return nav;
}

class RuntimeAdapter {
public:
    void reset() {
        runtime_.reset();
        sim_us_ = 0;
    }

    OutputPacket process(const InputPacket& in, uint32_t processing_us = 0) {
        if ((in.flags & kFlagReset) != 0) reset();

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

        sim_us_ += in.dt_us;
        fc::Imu imu{};
        const bool imu_ok = (in.flags & kFlagImuValid) != 0 && decode_imu_registers(in.imu_registers, imu);
        fc::RC rc{};
        const bool sbus_ok = fc::decode_sbus(in.sbus, rc);
        rc.us = sim_us_;

        fc::StateRuntimeInput state_input{};
        state_input.flight.raw = imu;
        state_input.flight.rc = rc;
        state_input.flight.now_us = sim_us_;
        state_input.flight.dt_us = in.dt_us;
        state_input.flight.missed_samples = 0;
        state_input.flight.imu_valid = imu_ok;
        state_input.flight.rc_fresh = sbus_ok && rc.valid;
        state_input.navigation = decode_navigation(in);

        const fc::RuntimeOutput result = runtime_.step(state_input);
        for (size_t i = 0; i < 4; ++i) out.motor_us[i] = result.motor_us[i];
        for (size_t i = 0; i < 3; ++i) out.attitude_cdeg[i] = result.attitude_cdeg[i];
        out.state = result.state;
        out.crc32 = crc32(&out, offsetof(OutputPacket, crc32));
        return out;
    }

    fc::StateRuntime& runtime() { return runtime_; }
    const fc::StateRuntime& runtime() const { return runtime_; }

private:
    fc::StateRuntime runtime_{};
    uint64_t sim_us_{};
};

class PacketParser {
public:
    bool feed(uint8_t byte, InputPacket& packet) {
        constexpr uint8_t magic[4] = {'H', 'I', 'L', '1'};
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
        if (size_ < sizeof(InputPacket)) return false;
        if (size_ > sizeof(InputPacket)) {
            size_ = 0;
            return false;
        }
        std::memcpy(&packet, buffer_.data(), sizeof(packet));
        size_ = 0;
        return true;
    }

private:
    std::array<uint8_t, sizeof(InputPacket)> buffer_{};
    size_t size_{};
};

}  // namespace hil
