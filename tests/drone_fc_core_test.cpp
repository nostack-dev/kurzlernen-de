#include "../esp32/Arondight45_DroneFC_Core.hpp"

#include <array>
#include <cstdio>
#include <cstdlib>
#include <cstring>

namespace {

#define CHECK(expr) do { \
    if (!(expr)) { \
        std::fprintf(stderr, "CORE TEST FAIL line %d: %s\n", __LINE__, #expr); \
        std::exit(1); \
    } \
} while (0)

void encode_sbus(const std::array<uint16_t, 16>& channels, uint8_t* p) {
    std::memset(p, 0, 25);
    p[0] = 0x0f;
    p[24] = 0x00;
    for (int channel = 0; channel < 16; ++channel) {
        for (int bit = 0; bit < 11; ++bit) {
            if ((channels[channel] & (1u << bit)) != 0) {
                const int k = 8 + channel * 11 + bit;
                p[k / 8] |= static_cast<uint8_t>(1u << (k % 8));
            }
        }
    }
}

fc::RuntimeInput stationary_input(uint64_t now_us, uint32_t dt_us = 1000) {
    fc::RuntimeInput input{};
    input.raw = {{0.0f, 0.0f, 1.0f}, {0.0f, 0.0f, 0.0f}};
    input.now_us = now_us;
    input.dt_us = dt_us;
    input.imu_valid = true;
    input.rc_fresh = true;
    input.rc.valid = true;
    input.rc.ch.fill(992);
    input.rc.ch[2] = 172;
    input.rc.ch[4] = 172;
    return input;
}

void calibrate(fc::Runtime& runtime, uint64_t& now_us) {
    for (uint32_t i = 0; i < fc::kCalibrationSamples; ++i) {
        now_us += 1000;
        const auto out = runtime.step(stationary_input(now_us));
        CHECK(out.fault == fc::kFaultNone);
    }
    const auto out = runtime.step(stationary_input(now_us += 1000));
    CHECK((out.state & fc::kStateCalibrating) == 0);
    CHECK((out.state & fc::kStateFault) == 0);
}

void arm_runtime(fc::Runtime& runtime, uint64_t& now_us) {
    auto low = stationary_input(now_us += 1000);
    low.rc.ch[4] = 172;
    CHECK(!runtime.step(low).armed);

    fc::RuntimeOutput out{};
    for (int i = 0; i < 1002; ++i) {
        auto high = stationary_input(now_us += 1000);
        high.rc.ch[4] = 1811;
        out = runtime.step(high);
    }
    CHECK(out.armed);
    for (auto pulse : out.motor_us) CHECK(pulse == fc::kEscIdleUs);
}

}  // namespace

int main() {
    std::array<uint16_t, 16> channels{};
    for (size_t i = 0; i < channels.size(); ++i) channels[i] = static_cast<uint16_t>(172 + i * 97);
    uint8_t sbus[25]{};
    encode_sbus(channels, sbus);
    fc::RC decoded{};
    CHECK(fc::decode_sbus(sbus, decoded));
    for (size_t i = 0; i < channels.size(); ++i) CHECK(decoded.ch[i] == channels[i]);
    sbus[24] = 0xff;
    CHECK(!fc::decode_sbus(sbus, decoded));

    fc::PT1 filter(100.0f);
    float filtered = 0.0f;
    for (int i = 0; i < 1000; ++i) filtered = filter.run(1.0f, 0.001f);
    CHECK(filtered > 0.999f && filtered <= 1.0f);

    fc::PID pid({0.01f, 0.1f, 0.0001f, 0.2f, 0.5f, 50.0f});
    for (int i = 0; i < 10000; ++i) {
        const float output = pid.run(100.0f, 0.0f, 0.001f, true);
        CHECK(std::isfinite(output));
        CHECK(std::fabs(output) <= 0.5f);
    }
    CHECK(pid.integral() <= 0.2001f);

    // Gyro measurements are body rates p/q/r, not Euler angle rates. At a
    // tilted attitude a pure body-z rate must therefore change roll and pitch
    // Euler angles as well as yaw. Disable accelerometer correction here so the
    // test isolates the exact ZYX kinematic transformation.
    fc::Attitude coupled_attitude{};
    coupled_attitude.roll = 30.0f;
    coupled_attitude.pitch = 20.0f;
    coupled_attitude.yaw = 10.0f;
    coupled_attitude.run(fc::Imu{{0.0f, 0.0f, 2.0f}, {0.0f, 0.0f, 90.0f}}, 0.01f);
    CHECK(coupled_attitude.roll > 30.20f && coupled_attitude.roll < 30.40f);
    CHECK(coupled_attitude.pitch > 19.45f && coupled_attitude.pitch < 19.65f);
    CHECK(coupled_attitude.yaw > 10.75f && coupled_attitude.yaw < 10.90f);

    // A banked accelerating quad can still measure ~1 g almost entirely on
    // body Z. That is not evidence that the aircraft is level. Accelerometer
    // fusion must therefore be far slower than flight-attitude dynamics while
    // remaining a real long-term drift anchor rather than being disabled.
    fc::Attitude translating_attitude{};
    translating_attitude.roll = 20.0f;
    for (int i = 0; i < 1000; ++i)
        translating_attitude.run(fc::Imu{{0.0f, 0.0f, 1.0f}, {0.0f, 0.0f, 0.0f}}, 0.001f);
    CHECK(translating_attitude.roll > 17.0f && translating_attitude.roll < 20.0f);

    const auto mixed = fc::mix(0.9f, 0.4f, -0.3f, 0.3f);
    for (float value : mixed.motor) CHECK(value >= 0.0f && value <= 1.0f);
    CHECK(fc::pulse(0.0f, false) == fc::kEscMinUs);
    CHECK(fc::pulse(0.0f, true) == fc::kEscIdleUs);
    CHECK(fc::pulse(1.0f, true) == fc::kEscMaxUs);

    // Expanding the inner physical attitude range for GAME must not make MANUAL
    // full-stick more aggressive. MANUAL remains exactly the established 32°.
    fc::RC full_manual{};
    full_manual.ch.fill(992);
    full_manual.ch[FC_SBUS_ROLL] = 1811;
    full_manual.ch[FC_SBUS_PITCH] = 1811;
    const fc::Command manual_command = fc::command(full_manual);
    const float old_manual_roll_deg =
        fc::shape(fc::centered(full_manual.ch[FC_SBUS_ROLL]), 0.035f, 0.3f) * fc::kManualMaxAttitudeDeg;
    const float old_manual_pitch_deg =
        -fc::shape(fc::centered(full_manual.ch[FC_SBUS_PITCH]), 0.035f, 0.3f) * fc::kManualMaxAttitudeDeg;
    CHECK(std::fabs(manual_command.roll * fc::kInnerMaxAttitudeDeg - old_manual_roll_deg) < 0.001f);
    CHECK(std::fabs(manual_command.pitch * fc::kInnerMaxAttitudeDeg - old_manual_pitch_deg) < 0.001f);

    // A 25-degree physical pitch request must create immediate differential
    // motor authority in the real inner loop. This guards responsiveness at the
    // motor-command layer without changing airframe or propulsion physics.
    fc::Controller responsive_controller;
    const auto responsive_mix = responsive_controller.run(
        fc::Imu{{0.0f, 0.0f, 1.0f}, {0.0f, 0.0f, 0.0f}},
        fc::Command{0.0f, 25.0f / fc::kInnerMaxAttitudeDeg, 0.50f, 0.0f, false}, 0.001f, false);
    CHECK(responsive_mix.motor[0] > 0.80f);
    CHECK(responsive_mix.motor[1] > 0.80f);
    CHECK(responsive_mix.motor[2] < 0.20f);
    CHECK(responsive_mix.motor[3] < 0.20f);

    fc::Runtime calibration_low_runtime;
    uint64_t calibration_low_us = 0;
    for (uint32_t i = 0; i < fc::kCalibrationSamples; ++i) {
        auto low = stationary_input(calibration_low_us += 1000);
        low.rc.ch[4] = 172;
        CHECK(!calibration_low_runtime.step(low).armed);
    }
    fc::RuntimeOutput immediate_arm{};
    for (int i = 0; i < 1002; ++i) {
        auto high = stationary_input(calibration_low_us += 1000);
        high.rc.ch[4] = 1811;
        immediate_arm = calibration_low_runtime.step(high);
    }
    CHECK(immediate_arm.armed);

    fc::Runtime runtime;
    uint64_t now_us = 0;
    calibrate(runtime, now_us);
    arm_runtime(runtime, now_us);

    auto throttle = stationary_input(now_us += 1000);
    throttle.rc.ch[4] = 1811;
    throttle.rc.ch[2] = 700;
    const auto throttle_out = runtime.step(throttle);
    CHECK(throttle_out.armed);
    for (auto pulse : throttle_out.motor_us) CHECK(pulse > fc::kEscIdleUs);

    auto lost_rc = stationary_input(now_us += 1000);
    lost_rc.rc_fresh = false;
    lost_rc.rc.valid = false;
    const auto disarmed = runtime.step(lost_rc);
    CHECK(!disarmed.armed);
    for (auto pulse : disarmed.motor_us) CHECK(pulse == fc::kEscMinUs);

    fc::Runtime timing_runtime;
    now_us = 0;
    calibrate(timing_runtime, now_us);
    arm_runtime(timing_runtime, now_us);
    fc::RuntimeOutput timing_out{};
    for (int i = 0; i < 5; ++i) {
        auto bad = stationary_input(now_us += 2500, 2500);
        bad.rc.ch[4] = 1811;
        timing_out = timing_runtime.step(bad);
    }
    CHECK(timing_out.fault == fc::kFaultTiming);
    CHECK((timing_out.state & fc::kStateFault) != 0);
    CHECK(!timing_out.armed);

    // A large in-flight attitude is recoverable state. With a valid RC/ARM command
    // and a physically plausible sub-rate-limit rotation, crossing 68 degrees must
    // keep the FC armed and all four motors active instead of forcing free fall.
    fc::Runtime recovery_runtime;
    now_us = 0;
    calibrate(recovery_runtime, now_us);
    arm_runtime(recovery_runtime, now_us);
    fc::RuntimeOutput recovery_out{};
    for (int i = 0; i < 450; ++i) {
        auto rolling = stationary_input(now_us += 1000);
        rolling.rc.ch[4] = 1811;
        rolling.rc.ch[2] = 700;
        rolling.raw.g.x = 200.0f;
        recovery_out = recovery_runtime.step(rolling);
        CHECK(recovery_out.fault == fc::kFaultNone);
        CHECK(recovery_out.armed);
        for (auto pulse : recovery_out.motor_us) CHECK(pulse > fc::kEscMinUs);
    }
    CHECK(std::fabs(static_cast<float>(recovery_out.attitude_cdeg[0]) * 0.01f) > 68.0f);

    // A single raw gyro spike is intentionally attenuated by the 100 Hz gyro
    // filter; a sustained physically impossible rotation must cross the 1750
    // deg/s filtered safety limit and latch kFaultRate.
    fc::Runtime rate_runtime;
    now_us = 0;
    calibrate(rate_runtime, now_us);
    fc::RuntimeOutput rate_out{};
    for (int i = 0; i < 12 && rate_out.fault == fc::kFaultNone; ++i) {
        auto rate = stationary_input(now_us += 1000);
        rate.raw.g.x = 2000.0f;
        rate_out = rate_runtime.step(rate);
    }
    CHECK(rate_out.fault == fc::kFaultRate);
    CHECK((rate_out.state & fc::kStateFault) != 0);

    fc::Runtime moving_calibration;
    now_us = 0;
    fc::RuntimeOutput moving_out{};
    for (uint32_t i = 0; i < fc::kCalibrationSamples; ++i) {
        auto moving = stationary_input(now_us += 1000);
        moving.raw.g.x = (i & 1u) ? 2.0f : -2.0f;
        moving_out = moving_calibration.step(moving);
    }
    CHECK(moving_out.fault == fc::kFaultImu);

    std::puts("All shared DroneFC runtime tests passed.");
    return 0;
}
