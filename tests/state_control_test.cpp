#include "../esp32/Arondight45_StateControl.hpp"

#include <array>
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

fc::RC base_rc(bool arm = false) {
    fc::RC rc{};
    rc.valid = true;
    rc.ch.fill(992);
    rc.ch[FC_SBUS_THROTTLE] = 172;
    rc.ch[FC_SBUS_ARM] = arm ? 1811 : 172;
    rc.ch[fc::kStateModeChannel] = 1811;
    const float clearance01 = (2.0f - fc::kStateMinClearanceM) /
                              (fc::kStateMaxClearanceM - fc::kStateMinClearanceM);
    rc.ch[fc::kStateClearanceChannel] = fc::throttle_raw(clearance01);
    return rc;
}

float raw_centered(uint16_t value) { return fc::centered(value); }
float raw_throttle(uint16_t value) { return fc::throttle(value); }

}  // namespace

int main() {
    fc::StateController controller;
    fc::NavigationState nav{{0.0f, 0.0f, 0.0f}, 2.0f, true};

    // No inner arm = no actuator request. Production Runtime remains authoritative.
    auto rc = base_rc(false);
    auto transformed = controller.transform(rc, nav, 0.0f, false, 0.001f);
    CHECK(std::fabs(raw_centered(transformed.ch[FC_SBUS_ROLL])) < 0.01f);
    CHECK(std::fabs(raw_centered(transformed.ch[FC_SBUS_PITCH])) < 0.01f);
    CHECK(std::fabs(raw_centered(transformed.ch[FC_SBUS_YAW])) < 0.01f);
    CHECK(raw_throttle(transformed.ch[FC_SBUS_THROTTLE]) < 0.001f);

    rc = base_rc(true);
    rc.ch[FC_SBUS_ROLL] = fc::centered_raw(1.0f);
    rc.ch[FC_SBUS_PITCH] = fc::centered_raw(-1.0f);
    rc.ch[FC_SBUS_YAW] = fc::centered_raw(1.0f);
    nav = {{1.5f, -1.2f, 0.8f}, 0.25f, true};
    transformed = controller.transform(rc, nav, 37.0f, false, 0.001f);
    CHECK(std::fabs(raw_centered(transformed.ch[FC_SBUS_ROLL])) < 0.01f);
    CHECK(std::fabs(raw_centered(transformed.ch[FC_SBUS_PITCH])) < 0.01f);
    CHECK(std::fabs(raw_centered(transformed.ch[FC_SBUS_YAW])) < 0.01f);
    CHECK(raw_throttle(transformed.ch[FC_SBUS_THROTTLE]) < 0.001f);

    // Clearance target is simply the Z component of the desired state.
    nav = {{0.0f, 0.0f, 0.0f}, 0.5f, true};
    rc = base_rc(false);
    transformed = controller.transform(rc, nav, 0.0f, true, 0.001f);
    const float climb_throttle = raw_throttle(transformed.ch[FC_SBUS_THROTTLE]);
    CHECK(controller.debug().vertical_accel_mps2 > 3.0f);
    CHECK(climb_throttle > 0.50f);

    nav.agl_m = 3.5f;
    transformed = controller.transform(rc, nav, 0.0f, true, 0.001f);
    const float descend_throttle = raw_throttle(transformed.ch[FC_SBUS_THROTTLE]);
    CHECK(controller.debug().vertical_accel_mps2 < -3.0f);
    CHECK(descend_throttle < climb_throttle);
    CHECK(descend_throttle >= 0.0f);

    // Desired velocity minus measured velocity directly creates acceleration.
    // Forward is -world-X at yaw=0; physical forward tilt is negative pitch, whose
    // SBUS channel is positive because command() performs the established inversion.
    nav = {{0.0f, 0.0f, 0.0f}, 2.0f, true};
    rc = base_rc(true);
    rc.ch[FC_SBUS_PITCH] = fc::centered_raw(1.0f);
    transformed = controller.transform(rc, nav, 0.0f, true, 0.001f);
    CHECK(controller.debug().forward_accel_mps2 > 4.0f);
    CHECK(raw_centered(transformed.ch[FC_SBUS_PITCH]) > 0.50f);

    // If measured velocity equals the desired vector, horizontal error, requested
    // acceleration and tilt all collapse to zero. No attitude-lead special case.
    nav.velocity_world_mps = {-5.0f, 0.0f, 0.0f};
    transformed = controller.transform(rc, nav, 0.0f, true, 0.001f);
    CHECK(std::fabs(controller.debug().forward_accel_mps2) < 0.01f);
    CHECK(std::fabs(controller.debug().right_accel_mps2) < 0.01f);
    CHECK(std::fabs(raw_centered(transformed.ch[FC_SBUS_PITCH])) < 0.02f);

    // Releasing to zero target while still moving forward produces acceleration
    // directly opposite the measured velocity vector and therefore reverse tilt.
    rc = base_rc(true);
    nav.velocity_world_mps = {-1.0f, 0.0f, 0.0f};
    transformed = controller.transform(rc, nav, 0.0f, true, 0.001f);
    CHECK(controller.debug().measured_forward_mps > 0.99f);
    CHECK(controller.debug().forward_accel_mps2 < -1.9f);
    CHECK(raw_centered(transformed.ch[FC_SBUS_PITCH]) < -0.15f);

    // Diagonal requests are limited as one physical acceleration vector, not by
    // independently clipping axes and accidentally granting sqrt(2) more authority.
    rc = base_rc(true);
    rc.ch[FC_SBUS_ROLL] = fc::centered_raw(1.0f);
    rc.ch[FC_SBUS_PITCH] = fc::centered_raw(1.0f);
    nav.velocity_world_mps = {0.0f, 0.0f, 0.0f};
    transformed = controller.transform(rc, nav, 0.0f, true, 0.001f);
    const float accel_norm = std::sqrt(
        controller.debug().forward_accel_mps2 * controller.debug().forward_accel_mps2 +
        controller.debug().right_accel_mps2 * controller.debug().right_accel_mps2);
    CHECK(accel_norm > 4.3f && accel_norm < 4.6f);
    CHECK(raw_centered(transformed.ch[FC_SBUS_PITCH]) > 0.20f);
    CHECK(raw_centered(transformed.ch[FC_SBUS_ROLL]) > 0.20f);

    // Body-right is -world-Y at yaw=0.
    rc = base_rc(true);
    rc.ch[FC_SBUS_ROLL] = fc::centered_raw(1.0f);
    nav.velocity_world_mps = {0.0f, 0.0f, 0.0f};
    transformed = controller.transform(rc, nav, 0.0f, true, 0.001f);
    CHECK(controller.debug().right_accel_mps2 > 4.0f);
    CHECK(raw_centered(transformed.ch[FC_SBUS_ROLL]) > 0.50f);

    nav.velocity_world_mps = {0.0f, -5.0f, 0.0f};
    transformed = controller.transform(rc, nav, 0.0f, true, 0.001f);
    CHECK(std::fabs(controller.debug().measured_right_mps - 5.0f) < 0.01f);
    CHECK(std::fabs(controller.debug().right_accel_mps2) < 0.01f);
    CHECK(std::fabs(raw_centered(transformed.ch[FC_SBUS_ROLL])) < 0.02f);

    // With zero right target, either-direction drift must receive an acceleration
    // request exactly opposite that drift.
    rc = base_rc(true);
    nav.velocity_world_mps = {0.0f, 1.0f, 0.0f};
    transformed = controller.transform(rc, nav, 0.0f, true, 0.001f);
    CHECK(controller.debug().measured_right_mps < -0.99f);
    CHECK(controller.debug().right_accel_mps2 > 1.9f);
    CHECK(raw_centered(transformed.ch[FC_SBUS_ROLL]) > 0.15f);
    nav.velocity_world_mps = {0.0f, -1.0f, 0.0f};
    transformed = controller.transform(rc, nav, 0.0f, true, 0.001f);
    CHECK(controller.debug().measured_right_mps > 0.99f);
    CHECK(controller.debug().right_accel_mps2 < -1.9f);
    CHECK(raw_centered(transformed.ch[FC_SBUS_ROLL]) < -0.15f);

    // Yaw is the rotational component of the target state. Stick input integrates
    // target heading; releasing it retains heading error feedback.
    controller.reset();
    rc = base_rc(true);
    nav = {{0.0f, 0.0f, 0.0f}, 2.0f, true};
    rc.ch[FC_SBUS_YAW] = fc::centered_raw(1.0f);
    for (int i = 0; i < 100; ++i)
        transformed = controller.transform(rc, nav, 0.0f, true, 0.01f);
    CHECK(controller.debug().target_yaw_deg > 90.0f);
    rc.ch[FC_SBUS_YAW] = fc::centered_raw(0.0f);
    transformed = controller.transform(rc, nav, 0.0f, true, 0.01f);
    CHECK(raw_centered(transformed.ch[FC_SBUS_YAW]) > 0.50f);

    // Inner production attitude/rate control is still the motor authority.
    const fc::Imu still{{0.0f, 0.0f, 1.0f}, {0.0f, 0.0f, 0.0f}};
    {
        fc::Controller attitude;
        const fc::Mix m = attitude.run(still, fc::Command{0.50f, 0.0f, 0.50f, 0.0f, false},
                                       0.001f, true);
        CHECK(m.motor[1] > m.motor[0]);
        CHECK(m.motor[2] > m.motor[3]);
    }
    {
        fc::Controller attitude;
        const fc::Mix m = attitude.run(still, fc::Command{0.0f, 0.50f, 0.50f, 0.0f, false},
                                       0.001f, true);
        CHECK(m.motor[0] > m.motor[2]);
        CHECK(m.motor[1] > m.motor[3]);
    }
    {
        fc::Controller attitude;
        const fc::Mix m = attitude.run(still, fc::Command{0.0f, 0.0f, 0.50f, 0.50f, false},
                                       0.001f, true);
        CHECK(m.motor[1] > m.motor[0]);
        CHECK(m.motor[3] > m.motor[2]);
    }

    // Gyro p/q/r remain direct feedback in the inner motor loop.
    {
        fc::Controller rate;
        fc::Imu imu = still;
        imu.g.x = 100.0f;
        const fc::Mix m = rate.run(imu, fc::Command{0.0f, 0.0f, 0.50f, 0.0f, false},
                                   0.001f, true);
        CHECK(m.motor[0] > m.motor[1]);
        CHECK(m.motor[3] > m.motor[2]);
    }
    {
        fc::Controller rate;
        fc::Imu imu = still;
        imu.g.y = 100.0f;
        const fc::Mix m = rate.run(imu, fc::Command{0.0f, 0.0f, 0.50f, 0.0f, false},
                                   0.001f, true);
        CHECK(m.motor[2] > m.motor[0]);
        CHECK(m.motor[3] > m.motor[1]);
    }
    {
        fc::Controller rate;
        fc::Imu imu = still;
        imu.g.z = 100.0f;
        const fc::Mix m = rate.run(imu, fc::Command{0.0f, 0.0f, 0.50f, 0.0f, false},
                                   0.001f, true);
        CHECK(m.motor[0] > m.motor[1]);
        CHECK(m.motor[2] > m.motor[3]);
    }

    // GAME arming is still exclusively governed by production Runtime.
    fc::StateRuntime arming_runtime;
    fc::StateRuntimeInput arming_input{};
    arming_input.flight.raw = {{0.0f, 0.0f, 1.0f}, {0.0f, 0.0f, 0.0f}};
    arming_input.flight.rc = base_rc(false);
    arming_input.flight.rc.valid = true;
    arming_input.flight.rc_fresh = true;
    arming_input.flight.imu_valid = true;
    arming_input.flight.dt_us = 1000;
    arming_input.navigation = {{1.5f, -1.2f, 0.0f}, 0.03f, true};
    fc::RuntimeOutput arm_out{};
    uint64_t arm_time_us = 0;
    for (uint32_t i = 0; i < fc::kCalibrationSamples + 50; ++i) {
        arm_time_us += 1000;
        arming_input.flight.now_us = arm_time_us;
        arm_out = arming_runtime.step(arming_input);
    }
    CHECK((arm_out.state & fc::kStateCalibrating) == 0);
    arming_input.flight.rc = base_rc(true);
    for (int i = 0; i < 1100; ++i) {
        arm_time_us += 1000;
        arming_input.flight.now_us = arm_time_us;
        arm_out = arming_runtime.step(arming_input);
    }
    CHECK(arm_out.armed);
    CHECK((arm_out.state & fc::kStateArmed) != 0);
    CHECK((arm_out.state & fc::kStateGameMode) != 0);
    CHECK((arm_out.state & fc::kStateNavigationValid) != 0);

    // Navigation loss fails closed; no fabricated state vector is allowed.
    fc::StateRuntime runtime;
    fc::StateRuntimeInput input{};
    input.flight.raw = {{0.0f, 0.0f, 1.0f}, {0.0f, 0.0f, 0.0f}};
    input.flight.rc = base_rc(false);
    input.flight.rc.valid = true;
    input.flight.rc_fresh = true;
    input.flight.imu_valid = true;
    input.flight.dt_us = 1000;
    input.navigation.valid = false;
    const auto unavailable = runtime.step(input);
    CHECK((unavailable.state & fc::kStateGameMode) != 0);
    CHECK((unavailable.state & fc::kStateNavigationValid) == 0);
    CHECK(!unavailable.armed);
    for (auto pulse : unavailable.motor_us) CHECK(pulse == fc::kEscMinUs);

    std::puts("All desired-state vector control tests passed.\n");
    return 0;
}
