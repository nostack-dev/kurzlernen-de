#pragma once

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <limits>

#ifndef FC_SBUS_ROLL
#define FC_SBUS_ROLL 0
#endif
#ifndef FC_SBUS_PITCH
#define FC_SBUS_PITCH 1
#endif
#ifndef FC_SBUS_THROTTLE
#define FC_SBUS_THROTTLE 2
#endif
#ifndef FC_SBUS_YAW
#define FC_SBUS_YAW 3
#endif
#ifndef FC_SBUS_ARM
#define FC_SBUS_ARM 4
#endif

namespace fc {

static_assert(FC_SBUS_ROLL >= 0 && FC_SBUS_ROLL < 16 &&
              FC_SBUS_PITCH >= 0 && FC_SBUS_PITCH < 16 &&
              FC_SBUS_THROTTLE >= 0 && FC_SBUS_THROTTLE < 16 &&
              FC_SBUS_YAW >= 0 && FC_SBUS_YAW < 16 &&
              FC_SBUS_ARM >= 0 && FC_SBUS_ARM < 16);

constexpr float kPi = 3.14159265358979323846f;
constexpr uint16_t kEscMinUs = 1000;
constexpr uint16_t kEscIdleUs = 1050;
constexpr uint16_t kEscMaxUs = 2000;
constexpr uint32_t kNominalDtUs = 1000;
constexpr uint32_t kMinDtUs = 600;
constexpr uint32_t kMaxDtUs = 1600;
constexpr uint32_t kRcTimeoutUs = 100000;
constexpr uint32_t kCalibrationSamples = 2000;

template <class T>
constexpr T clamp(T v, T lo, T hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}

struct V3 {
    float x{}, y{}, z{};
};

inline float mag(V3 v) {
    return std::sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

inline bool finite(V3 v) {
    return std::isfinite(v.x) && std::isfinite(v.y) && std::isfinite(v.z);
}

struct Imu {
    V3 a{}, g{};
};

class PT1 {
public:
    explicit PT1(float cutoff_hz) : cutoff_hz_(cutoff_hz) {}

    float run(float x, float dt) {
        if (!initialized_ || !(dt > 0.0f) || !std::isfinite(dt)) {
            y_ = x;
            initialized_ = true;
            return y_;
        }
        const float rc = 1.0f / (2.0f * kPi * cutoff_hz_);
        const float k = clamp(dt / (rc + dt), 0.0f, 1.0f);
        y_ += k * (x - y_);
        return y_;
    }

    void reset() {
        y_ = 0.0f;
        initialized_ = false;
    }

private:
    float cutoff_hz_;
    float y_{};
    bool initialized_{};
};

struct Filters {
    std::array<PT1, 3> gyro{PT1(100.0f), PT1(100.0f), PT1(100.0f)};
    std::array<PT1, 3> accel{PT1(30.0f), PT1(30.0f), PT1(30.0f)};

    Imu run(Imu s, float dt) {
        return {{accel[0].run(s.a.x, dt), accel[1].run(s.a.y, dt), accel[2].run(s.a.z, dt)},
                {gyro[0].run(s.g.x, dt), gyro[1].run(s.g.y, dt), gyro[2].run(s.g.z, dt)}};
    }
};

struct Attitude {
    float roll{}, pitch{}, yaw{};

    void reset(V3 a) {
        roll = std::atan2(a.y, a.z) * 180.0f / kPi;
        pitch = std::atan2(-a.x, std::sqrt(a.y * a.y + a.z * a.z)) * 180.0f / kPi;
        yaw = 0.0f;
    }

    void run(Imu s, float dt) {
        roll += s.g.x * dt;
        pitch += s.g.y * dt;
        yaw += s.g.z * dt;
        if (yaw > 180.0f) yaw -= 360.0f;
        if (yaw < -180.0f) yaw += 360.0f;

        const float n = mag(s.a);
        if (n > 0.8f && n < 1.2f) {
            const float accel_roll = std::atan2(s.a.y, s.a.z) * 180.0f / kPi;
            const float accel_pitch = std::atan2(-s.a.x, std::sqrt(s.a.y * s.a.y + s.a.z * s.a.z)) * 180.0f / kPi;
            const float tau = 1.0f / (2.0f * kPi * 1.4f);
            const float k = clamp(dt / (tau + dt), 0.0f, 0.02f);
            roll += k * (accel_roll - roll);
            pitch += k * (accel_pitch - pitch);
        }
    }
};

struct Gains {
    float kp, ki, kd, integral_limit, output_limit, d_cutoff_hz;
};

class PID {
public:
    explicit PID(Gains gains) : gains_(gains), d_filter_(gains.d_cutoff_hz) {}

    float run(float setpoint, float measurement, float dt, bool integrate) {
        if (!(dt > 0.0f) || !std::isfinite(setpoint) || !std::isfinite(measurement)) return 0.0f;
        const float error = setpoint - measurement;
        float derivative = have_previous_ ? -(measurement - previous_) / dt : 0.0f;
        previous_ = measurement;
        have_previous_ = true;
        derivative = d_filter_.run(derivative, dt);

        const float pre = gains_.kp * error + integral_ + gains_.kd * derivative;
        if (integrate && !((pre >= gains_.output_limit && error > 0.0f) ||
                           (pre <= -gains_.output_limit && error < 0.0f))) {
            integral_ = clamp(integral_ + gains_.ki * error * dt,
                              -gains_.integral_limit, gains_.integral_limit);
        }
        return clamp(gains_.kp * error + integral_ + gains_.kd * derivative,
                     -gains_.output_limit, gains_.output_limit);
    }

    void reset() {
        integral_ = 0.0f;
        previous_ = 0.0f;
        have_previous_ = false;
        d_filter_.reset();
    }

    float integral() const { return integral_; }

private:
    Gains gains_;
    PT1 d_filter_;
    float integral_{};
    float previous_{};
    bool have_previous_{};
};

struct RC {
    std::array<uint16_t, 16> ch{};
    bool lost{}, failsafe{}, valid{};
    uint64_t us{};
};

inline bool sbus_end(uint8_t b) {
    return b == 0x00 || b == 0x04 || b == 0x14 || b == 0x24 || b == 0x34;
}

inline bool decode_sbus(const uint8_t* p, RC& out) {
    if (!p || p[0] != 0x0f || !sbus_end(p[24])) return false;
    out.ch[0] = (p[1] | p[2] << 8) & 0x7ff;
    out.ch[1] = (p[2] >> 3 | p[3] << 5) & 0x7ff;
    out.ch[2] = (p[3] >> 6 | p[4] << 2 | p[5] << 10) & 0x7ff;
    out.ch[3] = (p[5] >> 1 | p[6] << 7) & 0x7ff;
    out.ch[4] = (p[6] >> 4 | p[7] << 4) & 0x7ff;
    out.ch[5] = (p[7] >> 7 | p[8] << 1 | p[9] << 9) & 0x7ff;
    out.ch[6] = (p[9] >> 2 | p[10] << 6) & 0x7ff;
    out.ch[7] = (p[10] >> 5 | p[11] << 3) & 0x7ff;
    out.ch[8] = (p[12] | p[13] << 8) & 0x7ff;
    out.ch[9] = (p[13] >> 3 | p[14] << 5) & 0x7ff;
    out.ch[10] = (p[14] >> 6 | p[15] << 2 | p[16] << 10) & 0x7ff;
    out.ch[11] = (p[16] >> 1 | p[17] << 7) & 0x7ff;
    out.ch[12] = (p[17] >> 4 | p[18] << 4) & 0x7ff;
    out.ch[13] = (p[18] >> 7 | p[19] << 1 | p[20] << 9) & 0x7ff;
    out.ch[14] = (p[20] >> 2 | p[21] << 6) & 0x7ff;
    out.ch[15] = (p[21] >> 5 | p[22] << 3) & 0x7ff;
    out.lost = (p[23] & 0x04) != 0;
    out.failsafe = (p[23] & 0x08) != 0;
    out.valid = !out.lost && !out.failsafe;
    return true;
}

class SbusParser {
public:
    bool feed(uint8_t byte, uint64_t us, RC& out) {
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
        if (decode_sbus(buffer_.data(), out)) {
            out.us = us;
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

inline float centered(uint16_t v) {
    return clamp((static_cast<float>(v) - 992.0f) / 820.0f, -1.0f, 1.0f);
}

inline float throttle(uint16_t v) {
    return clamp((static_cast<float>(v) - 172.0f) / (1811.0f - 172.0f), 0.0f, 1.0f);
}

inline float shape(float x, float deadband, float expo) {
    const float a = std::fabs(x);
    if (a <= deadband) return 0.0f;
    const float t = (a - deadband) / (1.0f - deadband);
    const float v = t * (1.0f - expo) + t * t * t * expo;
    return std::copysign(clamp(v, 0.0f, 1.0f), x);
}

struct Command {
    float roll{}, pitch{}, throttle{}, yaw{};
    bool arm{};
};

inline Command command(const RC& r) {
    // High-resolution SBUS/touch input: no artificial centre deadband. Keep a
    // single canonical expo in the real FC so SIM, HIL and hardware respond
    // continuously from zero and share exactly the same command curve.
    return {shape(centered(r.ch[FC_SBUS_ROLL]), 0.0f, 0.3f),
            -shape(centered(r.ch[FC_SBUS_PITCH]), 0.0f, 0.3f),
            throttle(r.ch[FC_SBUS_THROTTLE]),
            shape(centered(r.ch[FC_SBUS_YAW]), 0.0f, 0.2f),
            r.ch[FC_SBUS_ARM] > 1300};
}

struct Mix {
    std::array<float, 4> motor{};
};

inline Mix mix(float t, float roll, float pitch, float yaw) {
    t = clamp(t, 0.0f, 1.0f);
    std::array<float, 4> correction{{pitch - roll - 0.65f * yaw,
                                      pitch + roll + 0.65f * yaw,
                                      -pitch + roll - 0.65f * yaw,
                                      -pitch - roll + 0.65f * yaw}};
    float scale_factor = 1.0f;
    for (float v : correction) {
        if (v > 0.0f) scale_factor = std::min(scale_factor, (1.0f - t) / v);
        else if (v < 0.0f) scale_factor = std::min(scale_factor, t / -v);
    }
    scale_factor = clamp(scale_factor, 0.0f, 1.0f);
    Mix out;
    for (size_t i = 0; i < 4; ++i) out.motor[i] = clamp(t + scale_factor * correction[i], 0.0f, 1.0f);
    return out;
}

constexpr uint16_t pulse(float value, bool armed) {
    return armed ? static_cast<uint16_t>(kEscIdleUs + clamp(value, 0.0f, 1.0f) * (kEscMaxUs - kEscIdleUs) + 0.5f)
                 : kEscMinUs;
}

class ArmState {
public:
    struct Result {
        bool armed{}, armed_now{}, disarmed_now{};
    };

    Result run(uint64_t us, bool rc_valid, Command cmd, bool imu_ok, float roll, float pitch) {
        Result result{armed_, false, false};
        if (!rc_valid) {
            result.disarmed_now = armed_;
            armed_ = false;
            saw_low_ = false;
            since_us_ = 0;
            result.armed = false;
            return result;
        }
        if (!cmd.arm) {
            saw_low_ = true;
            since_us_ = 0;
            result.disarmed_now = armed_;
            armed_ = false;
            result.armed = false;
            return result;
        }
        if (armed_) return result;

        const bool ok = saw_low_ && cmd.throttle <= 0.035f &&
                        std::fabs(cmd.roll) < 0.12f && std::fabs(cmd.pitch) < 0.12f &&
                        std::fabs(cmd.yaw) < 0.15f && std::fabs(roll) < 20.0f &&
                        std::fabs(pitch) < 20.0f && imu_ok;
        if (!ok) {
            since_us_ = 0;
            return result;
        }
        if (!since_us_) since_us_ = us;
        if (us - since_us_ >= 1000000) {
            armed_ = true;
            result.armed = true;
            result.armed_now = true;
        }
        return result;
    }

private:
    bool armed_{};
    bool saw_low_{};
    uint64_t since_us_{};
};

class Controller {
public:
    Attitude attitude;

    void reset() {
        roll_pid_.reset();
        pitch_pid_.reset();
        yaw_pid_.reset();
    }

    Mix run(Imu s, Command cmd, float dt, bool integrate) {
        const float roll_rate = clamp((cmd.roll * 32.0f - attitude.roll) * 5.2f, -240.0f, 240.0f);
        const float pitch_rate = clamp((cmd.pitch * 32.0f - attitude.pitch) * 5.2f, -240.0f, 240.0f);
        const float yaw_rate = cmd.yaw * 180.0f;
        return mix(cmd.throttle,
                   roll_pid_.run(roll_rate, s.g.x, dt, integrate),
                   pitch_pid_.run(pitch_rate, s.g.y, dt, integrate),
                   yaw_pid_.run(yaw_rate, s.g.z, dt, integrate));
    }

private:
    PID roll_pid_{Gains{0.0018f, 0.0009f, 0.0000035f, 0.18f, 0.38f, 55.0f}};
    PID pitch_pid_{Gains{0.0018f, 0.0009f, 0.0000035f, 0.18f, 0.38f, 55.0f}};
    PID yaw_pid_{Gains{0.0015f, 0.0007f, 0.0f, 0.14f, 0.28f, 40.0f}};
};

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

struct RuntimeInput {
    Imu raw{};
    RC rc{};
    uint64_t now_us{};
    uint32_t dt_us{kNominalDtUs};
    uint32_t missed_samples{};
    bool imu_valid{true};
    bool rc_fresh{};
};

struct RuntimeOutput {
    std::array<uint16_t, 4> motor_us{kEscMinUs, kEscMinUs, kEscMinUs, kEscMinUs};
    std::array<int16_t, 3> attitude_cdeg{};
    uint16_t state{};
    FaultCode fault{kFaultNone};
    bool armed{};
};

class Runtime {
public:
    Runtime() { reset(); }

    void reset() {
        filters_ = Filters{};
        controller_ = Controller{};
        arm_ = ArmState{};
        calibrated_ = false;
        calibration_count_ = 0;
        gyro_sum_ = {};
        gyro_sq_sum_ = {};
        accel_sum_ = {};
        gyro_bias_ = {};
        bad_timing_ = 0;
        fault_ = kFaultNone;
        armed_ = false;
    }

    RuntimeOutput step(const RuntimeInput& input) {
        RuntimeOutput out;
        if (fault_ != kFaultNone) return finalize(out, false, false);

        if (!input.imu_valid || !finite(input.raw.a) || !finite(input.raw.g)) {
            set_fault(kFaultImu);
            return finalize(out, input.rc_fresh, false);
        }

        const float dt = (input.dt_us > 0 && input.dt_us < 100000)
                             ? static_cast<float>(input.dt_us) * 1.0e-6f
                             : 0.001f;

        if (!calibrated_) {
            calibrate(input.raw);
            return finalize(out, input.rc_fresh, true);
        }

        if (armed_) {
            if (input.dt_us < kMinDtUs || input.dt_us > kMaxDtUs || input.missed_samples > 2) {
                ++bad_timing_;
                if (bad_timing_ >= 5) set_fault(kFaultTiming);
            } else {
                bad_timing_ = 0;
            }
        } else {
            bad_timing_ = 0;
        }
        if (fault_ != kFaultNone) return finalize(out, input.rc_fresh, true);

        Imu corrected = input.raw;
        corrected.g.x -= gyro_bias_.x;
        corrected.g.y -= gyro_bias_.y;
        corrected.g.z -= gyro_bias_.z;
        const Imu imu = filters_.run(corrected, dt);
        if (!finite(imu.a) || !finite(imu.g) ||
            std::fabs(imu.g.x) > 1750.0f || std::fabs(imu.g.y) > 1750.0f ||
            std::fabs(imu.g.z) > 1750.0f) {
            set_fault(kFaultRate);
            return finalize(out, input.rc_fresh, true);
        }

        RC rc = input.rc;
        rc.valid = rc.valid && input.rc_fresh;
        const Command cmd = command(rc);
        controller_.attitude.run(imu, dt);
        const bool accel_ok = mag(imu.a) > 0.7f && mag(imu.a) < 1.3f;
        const auto arm_result = arm_.run(input.now_us, rc.valid, cmd, accel_ok,
                                         controller_.attitude.roll, controller_.attitude.pitch);
        armed_ = arm_result.armed;

        if (!armed_) controller_.reset();
        if (armed_) {
            if (std::fabs(controller_.attitude.roll) > 68.0f ||
                std::fabs(controller_.attitude.pitch) > 68.0f) {
                set_fault(kFaultTilt);
                armed_ = false;
                controller_.reset();
            } else {
                Mix mixed{};
                if (cmd.throttle <= 0.02f) {
                    controller_.reset();
                } else {
                    mixed = controller_.run(imu, cmd, dt, cmd.throttle > 0.05f);
                }
                for (size_t i = 0; i < 4; ++i) out.motor_us[i] = pulse(mixed.motor[i], true);
            }
        }

        return finalize(out, input.rc_fresh, true);
    }

    bool calibrated() const { return calibrated_; }
    bool armed() const { return armed_; }
    FaultCode fault() const { return fault_; }

    static const char* fault_name(FaultCode fault) {
        switch (fault) {
            case kFaultNone: return "none";
            case kFaultProtocol: return "protocol";
            case kFaultImu: return "imu";
            case kFaultTiming: return "deadline";
            case kFaultRate: return "rate";
            case kFaultTilt: return "tilt";
        }
        return "unknown";
    }

private:
    void calibrate(const Imu& sample) {
        gyro_sum_.x += sample.g.x;
        gyro_sum_.y += sample.g.y;
        gyro_sum_.z += sample.g.z;
        gyro_sq_sum_.x += sample.g.x * sample.g.x;
        gyro_sq_sum_.y += sample.g.y * sample.g.y;
        gyro_sq_sum_.z += sample.g.z * sample.g.z;
        accel_sum_.x += sample.a.x;
        accel_sum_.y += sample.a.y;
        accel_sum_.z += sample.a.z;
        ++calibration_count_;
        if (calibration_count_ < kCalibrationSamples) return;

        const float k = 1.0f / static_cast<float>(calibration_count_);
        gyro_bias_ = {gyro_sum_.x * k, gyro_sum_.y * k, gyro_sum_.z * k};
        const V3 accel_mean{accel_sum_.x * k, accel_sum_.y * k, accel_sum_.z * k};
        const V3 gyro_sd{
            std::sqrt(std::max(0.0f, gyro_sq_sum_.x * k - gyro_bias_.x * gyro_bias_.x)),
            std::sqrt(std::max(0.0f, gyro_sq_sum_.y * k - gyro_bias_.y * gyro_bias_.y)),
            std::sqrt(std::max(0.0f, gyro_sq_sum_.z * k - gyro_bias_.z * gyro_bias_.z))};

        const bool still = std::fabs(gyro_bias_.x) < 15.0f &&
                           std::fabs(gyro_bias_.y) < 15.0f &&
                           std::fabs(gyro_bias_.z) < 15.0f &&
                           gyro_sd.x < 0.8f && gyro_sd.y < 0.8f && gyro_sd.z < 0.8f &&
                           mag(accel_mean) > 0.85f && mag(accel_mean) < 1.15f;
        if (!still) {
            set_fault(kFaultImu);
            return;
        }
        filters_ = Filters{};
        controller_ = Controller{};
        controller_.attitude.reset(accel_mean);
        calibrated_ = true;
    }

    void set_fault(FaultCode fault) {
        if (fault_ == kFaultNone) fault_ = fault;
        armed_ = false;
    }

    static int16_t to_cdeg(float degrees) {
        const float value = clamp(degrees * 100.0f, -32767.0f, 32767.0f);
        return static_cast<int16_t>(std::lround(value));
    }

    RuntimeOutput finalize(RuntimeOutput out, bool rc_ok, bool imu_ok) const {
        out.armed = armed_ && fault_ == kFaultNone;
        out.fault = fault_;
        if (out.armed) out.state |= kStateArmed;
        if (!calibrated_) out.state |= kStateCalibrating;
        if (fault_ != kFaultNone) {
            out.state |= kStateFault;
            out.state |= static_cast<uint16_t>(fault_) << 8;
            out.motor_us = {kEscMinUs, kEscMinUs, kEscMinUs, kEscMinUs};
        }
        if (rc_ok) out.state |= kStateRcValid;
        if (imu_ok) out.state |= kStateImuValid;
        out.attitude_cdeg = {to_cdeg(controller_.attitude.roll),
                             to_cdeg(controller_.attitude.pitch),
                             to_cdeg(controller_.attitude.yaw)};
        return out;
    }

    Filters filters_{};
    Controller controller_{};
    ArmState arm_{};
    bool calibrated_{};
    uint32_t calibration_count_{};
    V3 gyro_sum_{};
    V3 gyro_sq_sum_{};
    V3 accel_sum_{};
    V3 gyro_bias_{};
    uint32_t bad_timing_{};
    FaultCode fault_{kFaultNone};
    bool armed_{};
};

}  // namespace fc
