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
    // 2.0 m within [0.5, 5.0].
    const float clearance01 = (2.0f - fc::kStateMinClearanceM) /
                              (fc::kStateMaxClearanceM - fc::kStateMinClearanceM);
    rc.ch[fc::kStateClearanceChannel] = fc::throttle_raw(clearance01);
    return rc;
}

float raw_centered(uint16_t value) {
    return fc::centered(value);
}

float raw_throttle(uint16_t value) {
    return fc::throttle(value);
}

}  // namespace

int main() {
    fc::StateController controller;
    fc::NavigationState nav{{0.0f, 0.0f, 0.0f}, 2.0f, true};

    // Neutral desired state at the target clearance: no tilt, no yaw, and while
    // the inner runtime is not armed the outer loop must keep throttle at zero so
    // the existing arming gate remains authoritative.
    auto rc = base_rc(false);
    auto transformed = controller.transform(rc, nav, 0.0f, false, 0.001f);
    CHECK(std::fabs(raw_centered(transformed.ch[FC_SBUS_ROLL])) < 0.01f);
    CHECK(std::fabs(raw_centered(transformed.ch[FC_SBUS_PITCH])) < 0.01f);
    CHECK(std::fabs(raw_centered(transformed.ch[FC_SBUS_YAW])) < 0.01f);
    CHECK(raw_throttle(transformed.ch[FC_SBUS_THROTTLE]) < 0.001f);

    // Below requested ground clearance must command climb thrust once armed.
    nav.agl_m = 0.5f;
    transformed = controller.transform(rc, nav, 0.0f, true, 0.001f);
    CHECK(raw_throttle(transformed.ch[FC_SBUS_THROTTLE]) > 0.50f);

    // Above requested clearance must command less thrust than the below-ground
    // case, never a negative/nonphysical thrust command.
    const float climb_throttle = raw_throttle(transformed.ch[FC_SBUS_THROTTLE]);
    nav.agl_m = 3.5f;
    transformed = controller.transform(rc, nav, 0.0f, true, 0.001f);
    const float descend_throttle = raw_throttle(transformed.ch[FC_SBUS_THROTTLE]);
    CHECK(descend_throttle < climb_throttle);
    CHECK(descend_throttle >= 0.0f);

    // Forward intent with zero measured velocity must request forward tilt.
    nav = {{0.0f, 0.0f, 0.0f}, 2.0f, true};
    rc = base_rc(true);
    rc.ch[FC_SBUS_PITCH] = fc::centered_raw(1.0f);
    transformed = controller.transform(rc, nav, 0.0f, true, 0.001f);
    CHECK(raw_centered(transformed.ch[FC_SBUS_PITCH]) > 0.5f);

    // Once actual forward velocity approaches the requested 5 m/s, the required
    // tilt error collapses toward zero instead of continuing to accelerate.
    nav.velocity_world_mps = {-5.0f, 0.0f, 0.0f};
    transformed = controller.transform(rc, nav, 0.0f, true, 0.001f);
    CHECK(std::fabs(raw_centered(transformed.ch[FC_SBUS_PITCH])) < 0.05f);

    // Right strafe is solved through roll, not by directly moving the rigid body.
    rc = base_rc(true);
    rc.ch[FC_SBUS_ROLL] = fc::centered_raw(1.0f);
    nav.velocity_world_mps = {0.0f, 0.0f, 0.0f};
    transformed = controller.transform(rc, nav, 0.0f, true, 0.001f);
    CHECK(raw_centered(transformed.ch[FC_SBUS_ROLL]) > 0.5f);

    // Heading input integrates a heading target. Releasing the stick leaves a
    // heading error command until measured yaw catches up: true heading hold.
    controller.reset();
    rc = base_rc(true);
    rc.ch[FC_SBUS_YAW] = fc::centered_raw(1.0f);
    for (int i = 0; i < 100; ++i)
        transformed = controller.transform(rc, nav, 0.0f, true, 0.01f);
    CHECK(controller.debug().target_yaw_deg > 90.0f);
    rc.ch[FC_SBUS_YAW] = fc::centered_raw(0.0f);
    transformed = controller.transform(rc, nav, 0.0f, true, 0.01f);
    CHECK(raw_centered(transformed.ch[FC_SBUS_YAW]) > 0.5f);

    // Full rotational path: the inner production controller must generate the
    // correct physical motor moment for each independent body axis. This is the
    // rotational half of the 6-DoF state controller; roll/pitch remain the
    // under-actuated solution variables for x/y translation, yaw is independent.
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

    // All three measured angular-rate axes p/q/r must feed back into motor torque.
    // A positive measured rate with zero requested rate produces a counter-torque
    // on the corresponding axis, proving the controller is not angle-only.
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

    // GAME arming remains governed by the production Runtime. Measured drift
    // before take-off must not manufacture attitude commands that block arming.
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

    // GAME runtime must fail closed if navigation measurements disappear.
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

    std::puts("All state-vector control tests passed.");
    return 0;
}
