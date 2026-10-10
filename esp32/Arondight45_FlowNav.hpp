#pragma once

// Arondight45 FlowNav — the on-board NAV1 producer for the real drone.
//
// GAME mode (velocity hold, height hold, landing) needs a NAV solution: world velocity,
// height above ground (AGL) and an absolute heading (StateRuntime refuses horizontal hold on a
// drifting gyro yaw). On the bench/in the browser that comes from the simulator; on the real
// drone it comes from here, built from three cheap sensors:
//
//   * a downward optical-flow + ToF/lidar module speaking MSP v2 (MicoAir MTF-01 / MTF-01P,
//     Matek 3901-L0X; iNav "MSP" output): MSP2_SENSOR_OPTIC_FLOW 0x1F02 and
//     MSP2_SENSOR_RANGEFINDER 0x1F01 on the NAV UART (the same RX pin as an external NAV1
//     module; both framings are recognised on one stream),
//   * a QMC5883L (0x0D) or QMC5883P (0x2C) magnetometer on I2C (the compass of a GPS module),
//   * the flight controller's own gyro and attitude.
//
// Physics:
//   * flow over ground: the image moves by an angular rate ω = v/h plus the body's own rotation.
//     A pure rotation over still ground is measured to learn the sensor's scale, orientation
//     and mirroring (2×2 matrix K: flow = K·ω_gyro). With K, flow is turned into the
//     "equivalent body rotation" K⁻¹·flow, the real rotation (gyro) is removed and the rest
//     times the height is velocity. In this FC's Euler convention (positive pitch = nose up,
//     the controller tilts to −atan(a/g)), translating forward looks like a positive pitch
//     rate and translating right like a positive roll rate, so
//         forward = h·(K⁻¹f − ω)_pitch,   right = h·(K⁻¹f − ω)_roll.
//   * height: lidar range × cos(roll)·cos(pitch); vertical speed = d(AGL)/dt (low-passed).
//   * heading: hard/soft-iron corrected field, tilt compensated with the FC attitude, clockwise
//     from magnetic north + declination; its sense is matched to the gyro yaw automatically
//     (a compass that turns the wrong way would make the yaw hold run away — it is never used).
//   * world velocity is projected with exactly the heading that is sent, in the convention
//     StateController inverts (forward = −c·vx − s·vy, right = −s·vx + c·vy).
//
// Safety: velocity is valid only with a calibrated flow matrix, a good flow quality and a valid
// height (below FC_FLOW_MAX_AGL); heading only after the compass calibration covered all axes
// and its yaw sense was confirmed. Calibrations happen while disarmed (hand-held: rock the drone
// over a textured floor, then turn it once around every axis) and are kept in flash.
//
// Pure C++17 (no ESP-IDF): the same code runs in the firmware and in tests/flow_nav_test.cpp.

#include "Arondight45_HardwareSensors.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>

#ifndef FC_FLOW_MIN_QUALITY
#define FC_FLOW_MIN_QUALITY 60          // of 255 (MSP quality byte)
#endif
#ifndef FC_FLOW_MAX_AGL_CM
#define FC_FLOW_MAX_AGL_CM 600          // flow velocity is trusted up to 6 m
#endif
#ifndef FC_RANGE_MAX_CM
#define FC_RANGE_MAX_CM 780             // MTF-01: 8 m; MTF-01P: set 1150
#endif
#ifndef FC_LANDED_AGL_CM
#define FC_LANDED_AGL_CM 12             // lidar reading (tilt corrected) of the drone standing on its feet + margin
#endif
#ifndef FC_MAG_DECLINATION_CDEG
#define FC_MAG_DECLINATION_CDEG 350     // Lake Constance 2026 ≈ +3.5°
#endif

namespace flownav {

constexpr float kPi = 3.14159265358979323846f;
constexpr float kDeg = kPi / 180.0f;
constexpr uint16_t kMspRangefinder = 0x1F01;
constexpr uint16_t kMspOpticFlow = 0x1F02;
constexpr uint8_t kQmc5883lAddress = 0x0D;
constexpr uint8_t kQmc5883pAddress = 0x2C;

inline float clampf(float v, float a, float b) { return v < a ? a : (v > b ? b : v); }
inline float wrap180(float d) { while (d > 180.0f) d -= 360.0f; while (d < -180.0f) d += 360.0f; return d; }

// ------------------------------------------------------------------ MSP v2
inline uint8_t crc8_dvb_s2(uint8_t crc, uint8_t byte) {
    crc ^= byte;
    for (int i = 0; i < 8; ++i) crc = (crc & 0x80u) ? static_cast<uint8_t>((crc << 1) ^ 0xD5u) : static_cast<uint8_t>(crc << 1);
    return crc;
}

struct MspFrame {
    uint16_t command{};
    uint16_t size{};
    std::array<uint8_t, 64> payload{};
};

// '$' 'X' dir flag cmdLo cmdHi lenLo lenHi payload… crc8(flag..payload)
class MspV2Parser {
public:
    bool feed(uint8_t b, MspFrame& out) {
        switch (state_) {
        case 0: state_ = b == '$' ? 1 : 0; return false;
        case 1: state_ = b == 'X' ? 2 : (b == '$' ? 1 : 0); return false;
        case 2: if (b == '<' || b == '>' || b == '!') { state_ = 3; } else state_ = b == '$' ? 1 : 0; return false;
        case 3: crc_ = crc8_dvb_s2(0, b); state_ = 4; return false;                                // flag
        case 4: frame_.command = b; crc_ = crc8_dvb_s2(crc_, b); state_ = 5; return false;
        case 5: frame_.command |= static_cast<uint16_t>(b) << 8; crc_ = crc8_dvb_s2(crc_, b); state_ = 6; return false;
        case 6: frame_.size = b; crc_ = crc8_dvb_s2(crc_, b); state_ = 7; return false;
        case 7:
            frame_.size |= static_cast<uint16_t>(b) << 8; crc_ = crc8_dvb_s2(crc_, b); index_ = 0;
            if (frame_.size > frame_.payload.size()) { state_ = 0; ++errors_; return false; }
            state_ = frame_.size ? 8 : 9; return false;
        case 8: frame_.payload[index_++] = b; crc_ = crc8_dvb_s2(crc_, b); if (index_ >= frame_.size) state_ = 9; return false;
        case 9:
            state_ = 0;
            if (b != crc_) { ++errors_; return false; }
            out = frame_; ++frames_; return true;
        default: state_ = 0; return false;
        }
    }
    uint32_t frames() const { return frames_; }
    uint32_t errors() const { return errors_; }
private:
    MspFrame frame_{};
    uint8_t state_{}, crc_{};
    uint16_t index_{};
    uint32_t frames_{}, errors_{};
};

inline int32_t le_i32(const uint8_t* p) {
    return static_cast<int32_t>(static_cast<uint32_t>(p[0]) | (static_cast<uint32_t>(p[1]) << 8) |
                                (static_cast<uint32_t>(p[2]) << 16) | (static_cast<uint32_t>(p[3]) << 24));
}

struct FlowSample { uint8_t quality{}; int32_t dx{}, dy{}; uint64_t us{}; };
struct RangeSample { uint8_t quality{}; int32_t mm{-1}; uint64_t us{}; };

inline bool decode_flow(const MspFrame& f, uint64_t us, FlowSample& out) {
    if (f.command != kMspOpticFlow || f.size < 9) return false;
    out.quality = f.payload[0]; out.dx = le_i32(&f.payload[1]); out.dy = le_i32(&f.payload[5]); out.us = us; return true;
}
inline bool decode_range(const MspFrame& f, uint64_t us, RangeSample& out) {
    if (f.command != kMspRangefinder || f.size < 5) return false;
    out.quality = f.payload[0]; out.mm = le_i32(&f.payload[1]); out.us = us; return true;
}
// for tests and bench tools: the frame a sensor sends
inline size_t encode_msp_v2(uint16_t command, const uint8_t* payload, uint16_t size, uint8_t* out, size_t cap) {
    if (cap < static_cast<size_t>(9 + size)) return 0;
    out[0] = '$'; out[1] = 'X'; out[2] = '<'; out[3] = 0;
    out[4] = static_cast<uint8_t>(command); out[5] = static_cast<uint8_t>(command >> 8);
    out[6] = static_cast<uint8_t>(size); out[7] = static_cast<uint8_t>(size >> 8);
    if (size) std::memcpy(out + 8, payload, size);
    uint8_t crc = 0;
    for (size_t i = 3; i < static_cast<size_t>(8 + size); ++i) crc = crc8_dvb_s2(crc, out[i]);
    out[8 + size] = crc;
    return 9 + size;
}

// ------------------------------------------------------------------ magnetometer
struct V3f { float x{}, y{}, z{}; };
inline V3f sub(V3f a, V3f b) { return {a.x - b.x, a.y - b.y, a.z - b.z}; }
inline V3f scale(V3f a, float k) { return {a.x * k, a.y * k, a.z * k}; }
inline float dot(V3f a, V3f b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
inline V3f cross(V3f a, V3f b) { return {a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x}; }
inline float norm(V3f a) { return std::sqrt(dot(a, a)); }

// both QMC chips: six bytes X,Y,Z little-endian int16 (QMC5883L from reg 0x00, QMC5883P from 0x01)
inline bool decode_qmc(const uint8_t raw[6], V3f& out) {
    const auto rd = [&](int i) { return static_cast<int16_t>(static_cast<uint16_t>(raw[i]) | (static_cast<uint16_t>(raw[i + 1]) << 8)); };
    const int16_t x = rd(0), y = rd(2), z = rd(4);
    if (x == -32768 || y == -32768 || z == -32768) return false;
    out = {static_cast<float>(x), static_cast<float>(y), static_cast<float>(z)};
    return !(x == 0 && y == 0 && z == 0);
}

// mounting of the compass relative to the FC body axes (the IMU's frame after FC_IMU_ROTATION)
#ifndef FC_MAG_ROTATION
#define FC_MAG_ROTATION 0
#endif
#ifndef FC_MAG_FLIPPED
#define FC_MAG_FLIPPED 0
#endif
inline V3f orient_mag(V3f v) {
    V3f o{};
#if FC_MAG_ROTATION == 0
    o = v;
#elif FC_MAG_ROTATION == 90
    o = {-v.y, v.x, v.z};
#elif FC_MAG_ROTATION == 180
    o = {-v.x, -v.y, v.z};
#else
    o = {v.y, -v.x, v.z};
#endif
#if FC_MAG_FLIPPED
    o.y = -o.y; o.z = -o.z;
#endif
    return o;
}

// hard iron (offset) + soft iron (per-axis scale) from the field's extent while the drone is
// turned around every axis; ready once all three axes span a sphere.
struct MagCalibration {
    V3f offset{}, gain{1.0f, 1.0f, 1.0f};
    bool ready{};
};
class MagCalibrator {
public:
    void reset() { *this = MagCalibrator{}; }
    void add(V3f m) {
        if (!n_) { lo_ = hi_ = m; }
        lo_ = {std::min(lo_.x, m.x), std::min(lo_.y, m.y), std::min(lo_.z, m.z)};
        hi_ = {std::max(hi_.x, m.x), std::max(hi_.y, m.y), std::max(hi_.z, m.z)};
        ++n_;
    }
    bool solve(MagCalibration& out) const {
        if (n_ < 300) return false;
        const V3f span = sub(hi_, lo_);
        const float mean = (span.x + span.y + span.z) / 3.0f;
        if (!(mean > 50.0f)) return false;
        // every axis must have been swept (the other two at least 60 % of the mean)
        if (span.x < 0.6f * mean || span.y < 0.6f * mean || span.z < 0.6f * mean) return false;
        out.offset = scale({hi_.x + lo_.x, hi_.y + lo_.y, hi_.z + lo_.z}, 0.5f);
        out.gain = {mean / span.x, mean / span.y, mean / span.z};
        out.ready = true;
        return true;
    }
    uint32_t samples() const { return n_; }
private:
    V3f lo_{}, hi_{};
    uint32_t n_{};
};

// the "up" unit vector in body axes from this FC's roll/pitch (Attitude::reset convention)
inline V3f body_up(float roll_deg, float pitch_deg) {
    const float r = roll_deg * kDeg, p = pitch_deg * kDeg;
    return {-std::sin(p), std::cos(p) * std::sin(r), std::cos(p) * std::cos(r)};
}
// heading of the body forward axis (+x), clockwise from (magnetic) north, degrees [-180, 180)
inline bool tilt_compensated_heading(V3f m, float roll_deg, float pitch_deg, float& heading_deg) {
    const V3f u = body_up(roll_deg, pitch_deg);
    const V3f mh = sub(m, scale(u, dot(m, u)));
    const V3f x{1.0f, 0.0f, 0.0f};
    const V3f fh = sub(x, scale(u, dot(x, u)));
    const float nm = norm(mh), nf = norm(fh);
    if (!(nm > 1e-3f) || !(nf > 1e-3f)) return false;
    const V3f n = scale(mh, 1.0f / nm), e = cross(n, u);
    heading_deg = wrap180(std::atan2(dot(fh, e), dot(fh, n)) / kDeg);
    return std::isfinite(heading_deg);
}

// Does the compass turn with the gyro yaw? Collects (Δcompass, Δyaw) pairs while the drone is
// turned by hand; the sense (+1/−1) and a ratio near 1 confirm it. Never trusted otherwise.
class HeadingSenseCheck {
public:
    void reset() { *this = HeadingSenseCheck{}; }
    // one pair per compass sample: how far the compass and the gyro yaw turned in between
    void add(float d_compass_deg, float d_yaw_deg) {
        if (std::fabs(d_yaw_deg) < 0.4f || std::fabs(d_yaw_deg) > 60.0f) return;
        ++pairs_;
        const float r = d_compass_deg / d_yaw_deg;
        if (std::fabs(r) < 0.75f || std::fabs(r) > 1.33f) return;    // disturbance / jump: not counted for either sense
        if (r > 0.0f) { ++same_; turned_same_ += std::fabs(d_yaw_deg); }
        else { ++opposite_; turned_opposite_ += std::fabs(d_yaw_deg); }
    }
    // +1 / −1 once ≥ 300° of turning agree on one sense (≥ 90 % of the agreeing pairs, and the
    // agreeing pairs are ≥ 70 % of all turning pairs), else 0
    int sense() const {
        const uint32_t agree = same_ + opposite_;
        if (agree < 40 || agree * 10u < pairs_ * 7u) return 0;
        if (same_ * 10u >= agree * 9u && turned_same_ >= 300.0f) return 1;
        if (opposite_ * 10u >= agree * 9u && turned_opposite_ >= 300.0f) return -1;
        return 0;
    }
    float turned_deg() const { return turned_same_ + turned_opposite_; }
private:
    uint32_t pairs_{}, same_{}, opposite_{};
    float turned_same_{}, turned_opposite_{};
};

// ------------------------------------------------------------------ flow calibration (2×2)
struct FlowCalibration {
    // flow (rad/s after FC_FLOW_SCALE) = K · gyro (rad/s, roll/pitch)
    float k00{1.0f}, k01{0.0f}, k10{0.0f}, k11{1.0f};
    bool ready{};
};
class FlowCalibrator {
public:
    void reset() { *this = FlowCalibrator{}; }
    // a rotation over still ground: ω big enough, quality good, height known
    void add(float fx, float fy, float gx, float gy) {
        if (std::hypot(gx, gy) < 0.35f || std::hypot(gx, gy) > 6.0f) return;
        sfg_[0] += fx * gx; sfg_[1] += fx * gy; sfg_[2] += fy * gx; sfg_[3] += fy * gy;
        sgg_[0] += gx * gx; sgg_[1] += gx * gy; sgg_[3] += gy * gy; ++n_;
    }
    bool solve(FlowCalibration& out) const {
        if (n_ < 250) return false;
        const float a = sgg_[0], b = sgg_[1], d = sgg_[3], det = a * d - b * b;
        if (!(det > 1e-6f) || std::fabs(det) < 0.05f * a * d) return false;   // both axes excited, not one diagonal line
        const float i00 = d / det, i01 = -b / det, i11 = a / det;
        FlowCalibration k{};
        k.k00 = sfg_[0] * i00 + sfg_[1] * i01; k.k01 = sfg_[0] * i01 + sfg_[1] * i11;
        k.k10 = sfg_[2] * i00 + sfg_[3] * i01; k.k11 = sfg_[2] * i01 + sfg_[3] * i11;
        // a real camera is a scaled rotation/mirror: both columns about as long, about orthogonal
        const float c0 = std::hypot(k.k00, k.k10), c1 = std::hypot(k.k01, k.k11);
        if (!(c0 > 0.2f) || !(c1 > 0.2f) || c0 / c1 > 1.35f || c1 / c0 > 1.35f) return false;
        if (std::fabs(k.k00 * k.k01 + k.k10 * k.k11) > 0.3f * c0 * c1) return false;
        k.ready = true; out = k; return true;
    }
    uint32_t samples() const { return n_; }
private:
    float sfg_[4]{}, sgg_[4]{};
    uint32_t n_{};
};

// ------------------------------------------------------------------ the estimator
#ifndef FC_FLOW_SCALE
#define FC_FLOW_SCALE 10.5f   // iNav opflow_scale default: raw counts per radian of the MSP flow integral
#endif

struct FlowNavStatus {
    bool flow_calibrated{}, mag_calibrated{}, heading_sense_ok{};
    bool velocity_valid{}, agl_valid{}, heading_valid{};
    float forward_mps{}, right_mps{}, vz_mps{}, agl_m{}, heading_deg{};
    uint8_t flow_quality{};
};

class FlowNav {
public:
    void set_flow_calibration(const FlowCalibration& k) { k_ = k; }
    void set_mag_calibration(const MagCalibration& m) { mag_cal_ = m; }
    void set_heading_sense(int s) { sense_ = s; }
    const FlowCalibration& flow_calibration() const { return k_; }
    const MagCalibration& mag_calibration() const { return mag_cal_; }
    int heading_sense() const { return sense_; }
    FlowCalibrator& flow_calibrator() { return flow_cal_; }
    MagCalibrator& mag_calibrator() { return mag_calibrator_; }
    const FlowNavStatus& status() const { return st_; }

    // every IMU sample: body rates (deg/s) accumulate between flow samples, attitude is kept
    void add_gyro(float gx_dps, float gy_dps, float dt_s, float roll_deg, float pitch_deg, float yaw_deg) {
        gyro_int_x_ += gx_dps * kDeg * dt_s; gyro_int_y_ += gy_dps * kDeg * dt_s; gyro_t_ += dt_s;
        roll_ = roll_deg; pitch_ = pitch_deg;
        if (have_yaw_) yaw_turn_ += wrap180(yaw_deg - last_yaw_);
        last_yaw_ = yaw_deg; have_yaw_ = true;
    }
    void add_range(const RangeSample& r) {
        const float cos_tilt = std::cos(roll_ * kDeg) * std::cos(pitch_ * kDeg);
        const bool ok = r.quality > 0 && r.mm >= 20 && r.mm <= FC_RANGE_MAX_CM * 10 && cos_tilt > 0.6f;
        if (!ok) { range_ok_ = false; range_us_ = r.us; return; }
        const float agl = r.mm * 0.001f * cos_tilt;
        if (range_ok_ && r.us > range_us_) {
            const float dt = (r.us - range_us_) * 1e-6f;
            if (dt > 0.002f && dt < 0.25f) vz_ += ((agl - agl_) / dt - vz_) * clampf(dt / (0.08f + dt), 0.0f, 1.0f);
        } else vz_ = 0.0f;
        agl_ = agl; range_ok_ = true; range_us_ = r.us;
    }
    // flow sample: derotate with the gyro accumulated since the last one, scale by height
    void add_flow(const FlowSample& f, bool disarmed) {
        if (!flow_us_ || f.us <= flow_us_) { flow_us_ = f.us; gyro_int_x_ = gyro_int_y_ = gyro_t_ = 0.0f; return; }
        const float dt = (f.us - flow_us_) * 1e-6f; flow_us_ = f.us;
        const float gt = gyro_t_ > 1e-4f ? gyro_t_ : dt;
        const float wx = gyro_int_x_ / gt, wy = gyro_int_y_ / gt; gyro_int_x_ = gyro_int_y_ = gyro_t_ = 0.0f;
        quality_ = f.quality;
        if (!(dt > 0.002f && dt < 0.2f)) { flow_ok_ = false; return; }
        const float fx = static_cast<float>(f.dx) / FC_FLOW_SCALE / dt, fy = static_cast<float>(f.dy) / FC_FLOW_SCALE / dt;
        const bool good = f.quality >= FC_FLOW_MIN_QUALITY && std::isfinite(fx) && std::isfinite(fy);
        if (disarmed && good && range_ok_ && agl_ > 0.15f) flow_cal_.add(fx, fy, wx, wy);
        if (!k_.ready) { flow_ok_ = false; return; }
        const float det = k_.k00 * k_.k11 - k_.k01 * k_.k10;
        if (!good || std::fabs(det) < 1e-4f) { flow_ok_ = false; return; }
        // equivalent body rotation of the measured flow, minus the real rotation
        const float ex = (k_.k11 * fx - k_.k01 * fy) / det - wx, ey = (-k_.k10 * fx + k_.k00 * fy) / det - wy;
        const float h = std::max(agl_, 0.05f);
        const float right = ex * h, forward = ey * h;
        const float a = clampf(dt / (0.05f + dt), 0.0f, 1.0f);
        if (!flow_ok_) { fwd_ = forward; right_ = right; } else { fwd_ += (forward - fwd_) * a; right_ += (right - right_) * a; }
        flow_ok_ = true; flow_ok_us_ = f.us;
    }
    // compass sample (raw counts, chip axes): calibrate while disarmed, check its sense, heading
    void add_mag(V3f raw_chip, uint64_t us, bool disarmed) {
        const V3f m = orient_mag(raw_chip);
        if (disarmed) mag_calibrator_.add(m);
        if (!mag_cal_.ready) { mag_calibrator_.solve(mag_cal_); }
        if (!mag_cal_.ready) { heading_ok_ = false; return; }
        const V3f c = {(m.x - mag_cal_.offset.x) * mag_cal_.gain.x, (m.y - mag_cal_.offset.y) * mag_cal_.gain.y, (m.z - mag_cal_.offset.z) * mag_cal_.gain.z};
        float h = 0.0f;
        if (!tilt_compensated_heading(c, roll_, pitch_, h)) { heading_ok_ = false; return; }
        h = wrap180(h + FC_MAG_DECLINATION_CDEG * 0.01f);
        if (have_heading_ && disarmed) sense_check_.add(wrap180(h - last_heading_), yaw_turn_);
        yaw_turn_ = 0.0f; last_heading_ = h; have_heading_ = true;
        if (!sense_) sense_ = sense_check_.sense();
        heading_cw_ = h; heading_ok_ = sense_ != 0; mag_us_ = us;
    }
    // the NAV1 frame for FirmwareRuntime (split validity, heading in the FC's yaw sense)
    bool build(uint64_t now_us, hwcontract::NavigationWireFrame& out) {
        const bool agl_valid = range_ok_ && now_us - range_us_ < 100000;
        const bool landed = agl_valid && agl_ < FC_LANDED_AGL_CM * 0.01f;   // on its feet: nothing moves sideways
        const bool vel_valid = agl_valid && (landed || (flow_ok_ && now_us - flow_ok_us_ < 60000 && agl_ <= FC_FLOW_MAX_AGL_CM * 0.01f));
        const bool head_valid = heading_ok_ && now_us - mag_us_ < 250000;
        const float heading_fc = wrap180(static_cast<float>(sense_) * heading_cw_);
        const float c = std::cos(heading_fc * kDeg), s = std::sin(heading_fc * kDeg);
        const float f = landed ? 0.0f : fwd_, r = landed ? 0.0f : right_;
        // StateController: forward = −c·vx − s·vy, right = −s·vx + c·vy (its own inverse)
        const float vx = -c * f - s * r, vy = -s * f + c * r;
        out = hwcontract::NavigationWireFrame{};
        out.sequence = ++sequence_;
        out.vx_cms = static_cast<int16_t>(clampf(vx * 100.0f, -32000.0f, 32000.0f));
        out.vy_cms = static_cast<int16_t>(clampf(vy * 100.0f, -32000.0f, 32000.0f));
        out.vz_cms = static_cast<int16_t>(clampf((agl_valid ? vz_ : 0.0f) * 100.0f, -32000.0f, 32000.0f));
        out.agl_mm = static_cast<uint16_t>(clampf(agl_valid ? agl_ * 1000.0f : 0.0f, 0.0f, 65000.0f));
        uint16_t flags = hwcontract::kNavigationSplitValidity;
        if (vel_valid && head_valid) flags |= hwcontract::kNavigationVelocityValid;   // world velocity needs the heading it was projected with
        if (agl_valid) flags |= hwcontract::kNavigationAglValid;
        if (head_valid) {
            float code = heading_fc < 0.0f ? heading_fc + 360.0f : heading_fc;
            uint16_t q = static_cast<uint16_t>(code * 10.0f + 0.5f);
            if (q >= 3600u) q = 0;
            flags |= hwcontract::kNavigationHeadingValid | static_cast<uint16_t>(q << hwcontract::kNavigationHeadingShift);
        }
        out.flags = flags;
        out.crc16 = hwcontract::crc16_ccitt(&out, offsetof(hwcontract::NavigationWireFrame, crc16));
        st_ = FlowNavStatus{k_.ready, mag_cal_.ready, sense_ != 0, vel_valid && head_valid, agl_valid, head_valid, f, r, vz_, agl_, heading_fc, quality_};
        return true;
    }
    // learn the flow matrix from the hand-held rocking (call while disarmed, e.g. once a second)
    bool try_flow_calibration() { FlowCalibration k{}; if (!flow_cal_.solve(k)) return false; k_ = k; return true; }

private:
    FlowCalibration k_{};
    MagCalibration mag_cal_{};
    FlowCalibrator flow_cal_{};
    MagCalibrator mag_calibrator_{};
    HeadingSenseCheck sense_check_{};
    FlowNavStatus st_{};
    float gyro_int_x_{}, gyro_int_y_{}, gyro_t_{};
    float roll_{}, pitch_{}, last_yaw_{}, yaw_turn_{};
    bool have_yaw_{};
    float agl_{}, vz_{}, fwd_{}, right_{};
    bool range_ok_{}, flow_ok_{}, heading_ok_{}, have_heading_{};
    uint64_t range_us_{}, flow_us_{}, flow_ok_us_{}, mag_us_{};
    float heading_cw_{}, last_heading_{};
    int sense_{};
    uint8_t quality_{};
    uint16_t sequence_{};
};

}  // namespace flownav
