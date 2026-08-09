#include "../esp32/Arondight45_StateControl.hpp"

#include <cmath>
#include <cstdio>
#include <cstdlib>

namespace {

#define CHECK(expr) do { \
    if (!(expr)) { \
        std::fprintf(stderr, "STATE CONTROL TEST FAIL line %d: %s\n", __LINE__, #expr); \
        std::exit(1); \
    } \
} while (0)

uint16_t centered_raw(float value) {
    return static_cast<uint16_t>(fc::clamp(std::lround(992.0f + 820.0f * fc::clamp(value, -1.0f, 1.0f)), 172l, 1811l));
}

uint16_t throttle_raw(float value) {
    return static_cast<uint16_t>(fc::clamp(std::lround(172.0f + 1639.0f * fc::clamp(value, 0.0f, 1.0f)), 172l, 1811l));
}

fc::RC base_rc(bool arm = false) {
    fc::RC rc{};
    rc.valid = true;
    rc.ch.fill(992);
    rc.ch[FC_SBUS_THROTTLE] = 172;
    rc.ch[FC_SBUS_ARM] = arm ? 1811 : 172;
    rc.ch[fc::kStateModeChannel] = 1811;
    rc.ch[fc::kStateBodyPitchChannel] = centered_raw(0.0f);
    const float clearance01 = (2.0f - fc::kStateMinClearanceM) /
                              (fc::kStateMaxClearanceM - fc::kStateMinClearanceM);
    rc.ch[fc::kStateClearanceChannel] = throttle_raw(clearance01);
    return rc;
}

fc::RuntimeInput stationary_input(uint64_t now_us) {
    fc::RuntimeInput input{};
    input.raw = {{0.0f, 0.0f, 1.0f}, {0.0f, 0.0f, 0.0f}};
    input.now_us = now_us;
    input.dt_us = 1000;
    input.imu_valid = true;
    input.rc_fresh = true;
    input.rc = base_rc(false);
    return input;
}

}  // namespace

int main() {
    CHECK(std::fabs(fc::kStateMaxHorizontalSpeedMps - 5.0f) < 0.001f);
    fc::StateController controller;
    fc::NavigationState nav{{0.0f, 0.0f, 0.0f}, 2.0f, true};

    auto rc = base_rc(false);
    auto cmd = controller.run(rc, nav, 0.0f, false, 0.001f);
    CHECK(std::fabs(cmd.roll) < 0.001f);
    CHECK(std::fabs(cmd.pitch) < 0.001f);
    CHECK(std::fabs(cmd.yaw) < 0.001f);
    CHECK(cmd.throttle < 0.001f);
    CHECK(!cmd.arm);

    rc = base_rc(true);
    rc.ch[FC_SBUS_ROLL] = centered_raw(1.0f);
    rc.ch[FC_SBUS_PITCH] = centered_raw(-1.0f);
    rc.ch[FC_SBUS_YAW] = centered_raw(1.0f);
    rc.ch[fc::kStateBodyPitchChannel] = centered_raw(1.0f);
    nav = {{1.5f, -1.2f, 0.8f}, 0.25f, true};
    cmd = controller.run(rc, nav, 37.0f, false, 0.001f);
    CHECK(std::fabs(cmd.roll) < 0.001f);
    CHECK(std::fabs(cmd.pitch) < 0.001f);
    CHECK(std::fabs(cmd.yaw) < 0.001f);
    CHECK(cmd.throttle < 0.001f);
    CHECK(cmd.arm);

    controller.reset();
    nav = {{0.0f, 0.0f, 0.0f}, 0.5f, true};
    rc = base_rc(true);
    cmd = controller.run(rc, nav, 0.0f, true, 0.001f);
    const float climb_throttle = cmd.throttle;
    CHECK(controller.debug().vertical_accel_mps2 > 3.0f);
    CHECK(climb_throttle > 0.43f && climb_throttle < 0.50f);

    nav.agl_m = 3.5f;
    cmd = controller.run(rc, nav, 0.0f, true, 0.001f);
    const float descend_throttle = cmd.throttle;
    CHECK(controller.debug().vertical_accel_mps2 < -3.0f);
    CHECK(descend_throttle < climb_throttle);
    CHECK(descend_throttle >= 0.0f);

    controller.reset();
    rc = base_rc(true);
    nav = {{0.0f, 0.0f, 0.0f}, 0.05f, true};
    cmd = controller.run(rc, nav, 0.0f, true, 0.001f);
    const float bootstrap_throttle = cmd.throttle;
    for (int i = 0; i < 1500; ++i) cmd = controller.run(rc, nav, 0.0f, true, 0.001f);
    CHECK(controller.hover_trim() > 0.53f);
    CHECK(cmd.throttle > bootstrap_throttle + 0.10f);

    {
        auto high = base_rc(true);
        high.ch[fc::kStateClearanceChannel] = 1811;
        const auto intent = fc::state_intent(high);
        CHECK(std::fabs(intent.clearance_m - 50.0f) < 0.02f);
    }

    {
        auto diagonal = base_rc(true);
        diagonal.ch[FC_SBUS_ROLL] = centered_raw(1.0f);
        diagonal.ch[FC_SBUS_PITCH] = centered_raw(1.0f);
        const auto intent = fc::state_intent(diagonal);
        const float desired_speed = std::hypot(intent.forward_mps, intent.right_mps);
        CHECK(std::fabs(desired_speed - fc::kStateMaxHorizontalSpeedMps) < 0.01f);
        CHECK(std::fabs(intent.forward_mps - intent.right_mps) < 0.01f);
    }

    controller.reset();
    nav = {{0.0f, 0.0f, 0.0f}, 2.0f, true};
    rc = base_rc(true);
    rc.ch[FC_SBUS_PITCH] = centered_raw(1.0f);
    cmd = controller.run(rc, nav, 0.0f, true, 0.001f);
    CHECK(controller.debug().forward_accel_mps2 > 3.9f);
    CHECK(cmd.pitch < -0.60f);
    CHECK(std::fabs(cmd.pitch - controller.debug().pitch_command) < 0.0001f);
    // Nominal hover plus the full 4 m/s^2 horizontal request must still leave
    // actuator headroom in the real mixer/control path; no simulator force is used.
    {
        const fc::Imu level{{0.0f, 0.0f, 1.0f}, {0.0f, 0.0f, 0.0f}};
        fc::Controller inner;
        const fc::Mix mixed = inner.run(level, cmd, 0.001f, true);
        for (const float motor : mixed.motor) CHECK(motor > 0.02f && motor < 0.98f);
    }

    const float desired_forward = fc::state_intent(rc).forward_mps;
    controller.reset();
    nav.velocity_world_mps = {-desired_forward, 0.0f, 0.0f};
    cmd = controller.run(rc, nav, 0.0f, true, 0.001f);
    CHECK(std::fabs(controller.debug().forward_accel_mps2) < 0.001f);
    CHECK(std::fabs(controller.debug().right_accel_mps2) < 0.001f);
    CHECK(std::fabs(cmd.pitch) < 0.01f);

    controller.reset();
    nav = {{0.0f, 0.0f, 0.0f}, 2.0f, true};
    rc = base_rc(true);
    rc.ch[fc::kStateBodyPitchChannel] = centered_raw(1.0f);
    const auto pitch_up_intent = fc::state_intent(rc);
    CHECK(pitch_up_intent.body_pitch_deg > 24.9f);
    cmd = controller.run(rc, nav, 0.0f, true, 0.001f);
    CHECK(cmd.pitch > 0.77f);
    CHECK(cmd.throttle > 0.40f);
    CHECK(std::fabs(controller.debug().forward_accel_mps2) < 0.001f);

    controller.reset();
    rc.ch[fc::kStateBodyPitchChannel] = centered_raw(-1.0f);
    const auto pitch_down_intent = fc::state_intent(rc);
    CHECK(pitch_down_intent.body_pitch_deg < -24.9f);
    cmd = controller.run(rc, nav, 0.0f, true, 0.001f);
    CHECK(cmd.pitch < -0.77f);
    CHECK(cmd.throttle > 0.40f);

    controller.reset();
    rc = base_rc(true);
    nav.velocity_world_mps = {-1.0f, 0.0f, 0.0f};
    cmd = controller.run(rc, nav, 0.0f, true, 0.001f);
    CHECK(controller.debug().measured_forward_mps > 0.99f);
    CHECK(controller.debug().forward_accel_mps2 < -0.75f && controller.debug().forward_accel_mps2 > -0.85f);
    CHECK(cmd.pitch > 0.08f);

    controller.reset();
    rc = base_rc(true);
    nav.velocity_world_mps = {0.0f, 0.0f, 0.0f};
    for (int i = 0; i < 10; ++i) cmd = controller.run(rc, nav, 0.0f, true, 0.001f);
    nav.velocity_world_mps = {-0.01f, 0.0f, 0.0f};
    cmd = controller.run(rc, nav, 0.0f, true, 0.001f);
    CHECK(controller.debug().measured_forward_mps > 0.009f);
    CHECK(controller.debug().forward_accel_mps2 < -0.08f);
    CHECK(cmd.pitch > 0.0f);

    controller.reset();
    rc = base_rc(true);
    rc.ch[FC_SBUS_ROLL] = centered_raw(1.0f);
    rc.ch[FC_SBUS_PITCH] = centered_raw(1.0f);
    nav.velocity_world_mps = {0.0f, 0.0f, 0.0f};
    cmd = controller.run(rc, nav, 0.0f, true, 0.001f);
    const float accel_norm = std::hypot(controller.debug().forward_accel_mps2,
                                        controller.debug().right_accel_mps2);
    CHECK(accel_norm > 3.9f && accel_norm < 4.1f);
    CHECK(cmd.pitch < -0.20f);
    CHECK(cmd.roll < -0.20f);

    controller.reset();
    rc = base_rc(true);
    rc.ch[FC_SBUS_ROLL] = centered_raw(1.0f);
    nav.velocity_world_mps = {0.0f, 0.0f, 0.0f};
    cmd = controller.run(rc, nav, 0.0f, true, 0.001f);
    CHECK(controller.debug().right_accel_mps2 > 3.9f);
    CHECK(cmd.roll < -0.60f);

    const float desired_right = fc::state_intent(rc).right_mps;
    controller.reset();
    nav.velocity_world_mps = {0.0f, desired_right, 0.0f};
    cmd = controller.run(rc, nav, 0.0f, true, 0.001f);
    CHECK(std::fabs(controller.debug().measured_right_mps - desired_right) < 0.001f);
    CHECK(std::fabs(controller.debug().right_accel_mps2) < 0.001f);
    CHECK(std::fabs(cmd.roll) < 0.01f);

    controller.reset();
    rc = base_rc(true);
    nav.velocity_world_mps = {0.0f, 1.0f, 0.0f};
    cmd = controller.run(rc, nav, 0.0f, true, 0.001f);
    CHECK(controller.debug().measured_right_mps > 0.99f);
    CHECK(controller.debug().right_accel_mps2 < -0.75f && controller.debug().right_accel_mps2 > -0.85f);
    CHECK(cmd.roll > 0.08f);

    controller.reset();
    nav.velocity_world_mps = {0.0f, -1.0f, 0.0f};
    cmd = controller.run(rc, nav, 0.0f, true, 0.001f);
    CHECK(controller.debug().measured_right_mps < -0.99f);
    CHECK(controller.debug().right_accel_mps2 > 0.75f && controller.debug().right_accel_mps2 < 0.85f);
    CHECK(cmd.roll < -0.08f);

    controller.reset();
    rc = base_rc(true);
    nav = {{0.0f, 0.0f, 0.0f}, 2.0f, true};
    rc.ch[FC_SBUS_YAW] = centered_raw(1.0f);
    for (int i = 0; i < 100; ++i) cmd = controller.run(rc, nav, 0.0f, true, 0.01f);
    CHECK(controller.debug().target_yaw_deg > 135.0f && controller.debug().target_yaw_deg < 145.0f);
    CHECK(std::fabs(cmd.yaw - controller.debug().yaw_command) < 0.0001f);
    rc.ch[FC_SBUS_YAW] = centered_raw(0.0f);
    cmd = controller.run(rc, nav, 0.0f, true, 0.01f);
    CHECK(cmd.yaw > 0.50f);

    const fc::Imu still{{0.0f, 0.0f, 1.0f}, {0.0f, 0.0f, 0.0f}};
    {
        fc::Controller attitude;
        const fc::Mix m = attitude.run(still, fc::Command{0.50f, 0.0f, 0.50f, 0.0f, false}, 0.001f, true);
        CHECK(m.motor[1] > m.motor[0]);
        CHECK(m.motor[2] > m.motor[3]);
    }
    {
        fc::Controller attitude;
        const fc::Mix m = attitude.run(still, fc::Command{0.0f, 0.50f, 0.50f, 0.0f, false}, 0.001f, true);
        CHECK(m.motor[0] > m.motor[2]);
        CHECK(m.motor[1] > m.motor[3]);
    }
    {
        fc::Controller attitude;
        const fc::Mix m = attitude.run(still, fc::Command{0.0f, 0.0f, 0.50f, 0.50f, false}, 0.001f, true);
        CHECK(m.motor[1] > m.motor[0]);
        CHECK(m.motor[3] > m.motor[2]);
    }
    {
        fc::Controller rate;
        fc::Imu imu = still;
        imu.g.x = 100.0f;
        const fc::Mix m = rate.run(imu, fc::Command{0.0f, 0.0f, 0.50f, 0.0f, false}, 0.001f, true);
        CHECK(m.motor[0] > m.motor[1]);
        CHECK(m.motor[3] > m.motor[2]);
    }

    fc::Runtime runtime;
    uint64_t now = 0;
    for (uint32_t i = 0; i < fc::kCalibrationSamples + 1; ++i) {
        auto input = stationary_input(now += 1000);
        const auto out = runtime.step_command(input, fc::Command{}, true);
        CHECK(out.fault == fc::kFaultNone);
    }
    for (int i = 0; i < 1002; ++i) {
        auto input = stationary_input(now += 1000);
        const auto out = runtime.step_command(input, fc::Command{0,0,0,0,true}, true);
        if (i == 1001) CHECK(out.armed);
    }
    auto input = stationary_input(now += 1000);
    const auto thrust = runtime.step_command(input, fc::Command{0,0,0.35f,0,true}, true);
    CHECK(thrust.armed);
    for (auto pulse : thrust.motor_us) CHECK(pulse > fc::kEscIdleUs);

    const auto invalid = runtime.step_command(input, fc::Command{}, false);
    CHECK(!invalid.armed);
    for (auto pulse : invalid.motor_us) CHECK(pulse == fc::kEscMinUs);

    std::puts("All direct state-vector control tests passed.");
    return 0;
}