#pragma once

#include "Arondight45_StateControl.hpp"

#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <limits>

#ifndef FC_IMU_ROTATION
#define FC_IMU_ROTATION 0
#endif
#ifndef FC_IMU_FLIPPED
#define FC_IMU_FLIPPED 0
#endif

static_assert(FC_IMU_ROTATION == 0 || FC_IMU_ROTATION == 90 ||
              FC_IMU_ROTATION == 180 || FC_IMU_ROTATION == 270,
              "FC_IMU_ROTATION must be 0/90/180/270 degrees");

namespace hwcontract {

constexpr uint32_t kNavigationMagic = 0x3156414eu;  // "NAV1" little-endian.
constexpr uint16_t kNavigationVersion = 1;
constexpr uint16_t kNavigationValid = 1u << 0;
constexpr uint32_t kNavigationTimeoutUs = 60000;
constexpr size_t kNavigationFrameBytes = 20;

#pragma pack(push, 1)
struct NavigationWireFrame {
    uint32_t magic{kNavigationMagic};
    uint16_t version{kNavigationVersion};
    uint16_t sequence{};
    int16_t vx_cms{};
    int16_t vy_cms{};
    int16_t vz_cms{};
    uint16_t agl_mm{};
    uint16_t flags{};
    uint16_t crc16{};
};
#pragma pack(pop)

static_assert(sizeof(NavigationWireFrame) == kNavigationFrameBytes,
              "NAV1 wire frame must remain 20 bytes");

inline uint16_t crc16_ccitt(const void* data, size_t length) {
    const auto* bytes = static_cast<const uint8_t*>(data);
    uint16_t crc = 0xffffu;
    for (size_t i = 0; i < length; ++i) {
        crc ^= static_cast<uint16_t>(bytes[i]) << 8;
        for (unsigned bit = 0; bit < 8; ++bit)
            crc = static_cast<uint16_t>((crc << 1) ^ ((crc & 0x8000u) ? 0x1021u : 0u));
    }
    return crc;
}

inline int16_t read_be_i16(const uint8_t* p) {
    return static_cast<int16_t>((static_cast<uint16_t>(p[0]) << 8) | p[1]);
}

inline fc::V3 orient_target(fc::V3 value) {
    fc::V3 out{};
#if FC_IMU_ROTATION == 0
    out = value;
#elif FC_IMU_ROTATION == 90
    out = {-value.y, value.x, value.z};
#elif FC_IMU_ROTATION == 180
    out = {-value.x, -value.y, value.z};
#else
    out = {value.y, -value.x, value.z};
#endif
#if FC_IMU_FLIPPED
    out.y = -out.y;
    out.z = -out.z;
#endif
    return out;
}

// This is the one ICM-42688-P register decoder used by production, physical HIL
// and browser SIL. The simulator emits the same 14 register bytes that SPI reads.
inline bool decode_icm42688_registers(const uint8_t raw[14], fc::Imu& out) {
    if (!raw) return false;
    const int16_t bad = std::numeric_limits<int16_t>::min();
    const int16_t ax = read_be_i16(raw + 2);
    const int16_t ay = read_be_i16(raw + 4);
    const int16_t az = read_be_i16(raw + 6);
    const int16_t gx = read_be_i16(raw + 8);
    const int16_t gy = read_be_i16(raw + 10);
    const int16_t gz = read_be_i16(raw + 12);
    if (ax == bad || ay == bad || az == bad || gx == bad || gy == bad || gz == bad) return false;
    out.a = orient_target({ax / 2048.0f, ay / 2048.0f, az / 2048.0f});
    out.g = orient_target({gx / 16.4f, gy / 16.4f, gz / 16.4f});
    return fc::finite(out.a) && fc::finite(out.g);
}

inline bool decode_navigation_wire(const NavigationWireFrame& frame, fc::NavigationState& out) {
    if (frame.magic != kNavigationMagic || frame.version != kNavigationVersion) return false;
    if (crc16_ccitt(&frame, offsetof(NavigationWireFrame, crc16)) != frame.crc16) return false;
    out.velocity_world_mps = {frame.vx_cms * 0.01f,
                              frame.vy_cms * 0.01f,
                              frame.vz_cms * 0.01f};
    out.agl_m = frame.agl_mm * 0.001f;
    out.valid = (frame.flags & kNavigationValid) != 0;
    return !out.valid || fc::finite(out);
}

inline NavigationWireFrame encode_navigation_wire(uint16_t sequence,
                                                  float vx_mps, float vy_mps, float vz_mps,
                                                  float agl_m, bool valid) {
    auto s16 = [](float value) {
        const long rounded = std::lround(value * 100.0f);
        return static_cast<int16_t>(fc::clamp<long>(rounded, -32767l, 32767l));
    };
    NavigationWireFrame frame{};
    frame.sequence = sequence;
    frame.vx_cms = s16(vx_mps);
    frame.vy_cms = s16(vy_mps);
    frame.vz_cms = s16(vz_mps);
    const long mm = std::lround(std::max(0.0f, agl_m) * 1000.0f);
    frame.agl_mm = static_cast<uint16_t>(fc::clamp<long>(mm, 0l, 65535l));
    frame.flags = valid ? kNavigationValid : 0u;
    frame.crc16 = crc16_ccitt(&frame, offsetof(NavigationWireFrame, crc16));
    return frame;
}

class NavigationWireParser {
public:
    bool feed(uint8_t byte, NavigationWireFrame& out) {
        constexpr uint8_t magic[4] = {'N', 'A', 'V', '1'};
        if (size_ < 4) {
            if (byte == magic[size_]) buffer_[size_++] = byte;
            else {
                size_ = byte == magic[0] ? 1u : 0u;
                if (size_ == 1) buffer_[0] = byte;
            }
            return false;
        }
        buffer_[size_++] = byte;
        if (size_ < buffer_.size()) return false;
        std::memcpy(&out, buffer_.data(), sizeof(out));
        size_ = 0;
        if (out.magic == kNavigationMagic) return true;
        return false;
    }
private:
    std::array<uint8_t, kNavigationFrameBytes> buffer_{};
    size_t size_{};
};

class SbusWireParser {
public:
    bool feed(uint8_t byte, uint64_t us, std::array<uint8_t, 25>& frame) {
        if (size_ && us > last_us_ && us - last_us_ > 3000) size_ = 0;
        last_us_ = us;
        if (!size_) {
            if (byte != 0x0f) return false;
            buffer_[size_++] = byte;
            return false;
        }
        buffer_[size_++] = byte;
        if (size_ < buffer_.size()) return false;
        size_ = 0;
        fc::RC decoded{};
        if (fc::decode_sbus(buffer_.data(), decoded)) {
            frame = buffer_;
            return true;
        }
        for (size_t i = 1; i < buffer_.size(); ++i) {
            if (buffer_[i] == 0x0f) {
                const size_t keep = buffer_.size() - i;
                std::memmove(buffer_.data(), buffer_.data() + i, keep);
                size_ = keep;
                break;
            }
        }
        return false;
    }
private:
    std::array<uint8_t, 25> buffer_{};
    size_t size_{};
    uint64_t last_us_{};
};

}  // namespace hwcontract
