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
    CHECK(std::fabs(fc::kStateMaxHorizontalSpeedMps - 25.0f) < 0.001f);
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
    const float climb_accel = controller.debug().vertical_accel_mps2;
    CHECK(controller.debug().target_vz_mps > 2.9f);
    CHECK(climb_accel > 11.9f);
    CHECK(climb_throttle > 0.58f && climb_throttle < 0.65f);

    // A sudden measured-height reversal must no longer command an impossible
    // +12 -> -12 m/s^2 acceleration step in one millisecond. 1200 m/s^3 allows
    // at most 1.2 m/s^2 per 1 ms controller tick, while still reaching a clear
    // descent command within a few tens of milliseconds.
    nav.agl_m = 3.5f;
    cmd = controller.run(rc, nav, 0.0f, true, 0.001f);
    const float first_reverse_accel = controller.debug().vertical_accel_mps2;
    CHECK(first_reverse_accel > 0.0f);
    CHECK(climb_accel - first_reverse_accel > 1.0f);
    CHECK(climb_accel - first_reverse_accel < 1.3f);
    for (int i = 0; i < 24; ++i) cmd = controller.run(rc, nav, 0.0f, true, 0.001f);
    const float descend_throttle = cmd.throttle;
    CHECK(controller.debug().vertical_accel_mps2 < -3.0f);
    CHECK(descend_throttle < climb_throttle);
    CHECK(descend_throttle >= 0.0f);

    // Vertical controller ceilings are deliberately above nominal plant authority.
    // Full-clearance error must be able to saturate the physical motor path rather
    // than an old 2 m/s / 4 m/s^2 camera-drone software envelope.
    controller.reset();
    auto high_clearance = base_rc(true);high_clearance.ch[fc::kStateClearanceChannel] = 1811;
    nav = {{0.0f,0.0f,0.0f},0.5f,true};cmd=controller.run(high_clearance,nav,0.0f,true,0.001f);
    CHECK(controller.debug().target_vz_mps > 29.9f);CHECK(controller.debug().vertical_accel_mps2 > 49.9f);CHECK(cmd.throttle > 0.99f);

    // Regression: a pure aggressive descent used to reduce specific_up to 0.5
    // m/s^2 while leaving the auto-translation limiter at tan(40 deg). Even a
    // modest 1 m/s horizontal drift then requested ~40 deg attitude. Automatic
    // drift correction must stay inside the validated 25 deg translation envelope
    // regardless of vertical specific-force demand.
    controller.reset();
    rc = base_rc(true);
    nav = {{-1.0f, 0.0f, 0.0f}, 8.0f, true};
    cmd = controller.run(rc, nav, 0.0f, true, 0.001f);
    const float descent_auto_pitch_deg = std::fabs(cmd.pitch * fc::kInnerMaxAttitudeDeg);
    const float descent_auto_roll_deg = std::fabs(cmd.roll * fc::kInnerMaxAttitudeDeg);
    const float descent_horizontal_accel = std::hypot(controller.debug().forward_accel_mps2,
                                                       controller.debug().right_accel_mps2);
    CHECK(controller.debug().vertical_accel_mps2 < -49.9f);
    // At the restored 4 m/s² collective reserve, tan(25°) permits at most
    // ~1.865 m/s² automatic horizontal correction while preserving attitude torque.
    CHECK(descent_horizontal_accel < 1.87f);
    CHECK(cmd.throttle > 0.10f);
    CHECK(descent_auto_pitch_deg <= 25.05f);
    CHECK(descent_auto_roll_deg <= 25.05f);

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
    CHECK(controller.debug().forward_accel_mps2 > 3.9f && controller.debug().forward_accel_mps2 < 4.1f);
    CHECK(cmd.pitch < -0.50f);
    CHECK(std::fabs(cmd.pitch - controller.debug().pitch_command) < 0.0001f);
    // The plant retains higher hard authority, while normal GAME translation is
    // deliberately capped at the earlier stable 4.0 m/s^2 command envelope.
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

    // Releasing a translation stick while already travelling at the commanded
    // velocity must not flip immediately to full reverse acceleration. The cruise
    // integrator clears at once, while the velocity target ramps down at 4 m/s^2.
    auto released = base_rc(true);
    cmd = controller.run(released, nav, 0.0f, true, 0.001f);
    CHECK(controller.debug().desired_forward_mps > desired_forward - 0.01f);
    CHECK(controller.debug().forward_accel_mps2 < 0.0f);
    CHECK(controller.debug().forward_accel_mps2 > -0.05f);
    for (int i = 0; i < 249; ++i) cmd = controller.run(released, nav, 0.0f, true, 0.001f);
    CHECK(controller.debug().desired_forward_mps < desired_forward - 0.95f);
    CHECK(controller.debug().desired_forward_mps > desired_forward - 1.05f);
    CHECK(controller.debug().forward_accel_mps2 > -1.0f);

    controller.reset();
    nav = {{0.0f, 0.0f, 0.0f}, 2.0f, true};
    rc = base_rc(true);
    rc.ch[fc::kStateBodyPitchChannel] = centered_raw(1.0f);
    const auto pitch_up_intent = fc::state_intent(rc);
    CHECK(pitch_up_intent.body_pitch_deg > 24.9f);
    cmd = controller.run(rc, nav, 0.0f, true, 0.001f);
    CHECK(cmd.pitch > 0.60f);
    CHECK(cmd.pitch * fc::kInnerMaxAttitudeDeg > 24.9f);
    CHECK(cmd.throttle > 0.40f);
    CHECK(std::fabs(controller.debug().forward_accel_mps2) < 0.001f);

    controller.reset();
    rc.ch[fc::kStateBodyPitchChannel] = centered_raw(-1.0f);
    const auto pitch_down_intent = fc::state_intent(rc);
    CHECK(pitch_down_intent.body_pitch_deg < -24.9f);
    cmd = controller.run(rc, nav, 0.0f, true, 0.001f);
    CHECK(cmd.pitch < -0.60f);
    CHECK(cmd.pitch * fc::kInnerMaxAttitudeDeg < -24.9f);
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
    CHECK(controller.debug().forward_accel_mps2 < 0.0f);
    CHECK(controller.debug().forward_accel_mps2 > -0.10f);
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
    CHECK(controller.debug().right_accel_mps2 > 3.9f && controller.debug().right_accel_mps2 < 4.1f);
    CHECK(cmd.roll < -0.50f);

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

    // Absolute NAV heading, when present, is the physical world/body frame
    // reference. A drifting 6-DoF IMU yaw must not rotate velocity axes.
    controller.reset();
    rc = base_rc(true);
    rc.ch[FC_SBUS_PITCH] = centered_raw(1.0f);
    nav = {{0.0f, -10.0f, 0.0f}, 2.0f, true, true, true, 90.0f, true};
    cmd = controller.run(rc, nav, 12.0f, true, 0.001f);
    CHECK(std::fabs(controller.debug().measured_yaw_deg - 90.0f) < 0.001f);
    CHECK(controller.debug().measured_forward_mps > 9.99f);
    CHECK(std::fabs(controller.debug().measured_right_mps) < 0.01f);

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

    // In-flight AGL loss must degrade, never cut motors. Velocity remains real,
    // so vertical control switches to vz=0 while horizontal state control remains active.
    {
        fc::StateRuntime state_runtime;
        uint64_t t = 0;
        fc::StateRuntimeInput in{};
        for (uint32_t i = 0; i < fc::kCalibrationSamples + 10; ++i) {
            in.flight = stationary_input(t += 1000);
            in.flight.rc = base_rc(false);
            in.navigation = {{0.0f, 0.0f, 0.0f}, 2.0f, true, true, true, 0.0f, true};
            state_runtime.step(in);
        }
        for (int i = 0; i < 1100; ++i) {
            in.flight = stationary_input(t += 1000);
            in.flight.rc = base_rc(true);
            in.navigation = {{0.0f, 0.0f, 0.0f}, 2.0f, true, true, true, 0.0f, true};
            state_runtime.step(in);
        }
        CHECK(state_runtime.inner().armed());
        in.flight = stationary_input(t += 1000);
        in.flight.rc = base_rc(true);
        in.navigation = {{0.0f, 0.0f, 0.35f}, 0.0f, false, true, false, 0.0f, true};
        auto degraded = state_runtime.step(in);
        CHECK(degraded.armed);
        CHECK((degraded.state & fc::kStateNavigationDegraded) != 0);
        CHECK((degraded.state & fc::kStateNavigationValid) == 0);
        CHECK(state_runtime.state_controller().debug().target_vz_mps == 0.0f);
        CHECK(degraded.motor_us[0] > fc::kEscMinUs);

        // If all NAV is lost, an already-airborne craft falls back to bounded
        // IMU attitude/hover control. It still obeys a real ARM-low immediately.
        in.flight = stationary_input(t += 1000);
        in.flight.rc = base_rc(true);
        in.navigation = {{}, 0.0f, false, false, false};
        degraded = state_runtime.step(in);
        CHECK(degraded.armed);
        CHECK((degraded.state & fc::kStateNavigationDegraded) != 0);
        CHECK(degraded.motor_us[0] > fc::kEscMinUs);
        in.flight.rc = base_rc(false);
        degraded = state_runtime.step(in);
        CHECK(!degraded.armed);
        for (auto pulse : degraded.motor_us) CHECK(pulse == fc::kEscMinUs);
    }

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