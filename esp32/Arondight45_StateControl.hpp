#pragma once

#include "Arondight45_DroneFC_Core.hpp"

#include <cmath>
#include <cstdint>

namespace fc {

// GAME / STATE control deliberately sits above the existing production attitude/rate
// controller. The user commands a desired motion state; this outer loop turns the
// measured state error into ordinary roll/pitch/throttle/yaw commands. The existing
// fc::Runtime remains the only motor mixer / attitude / rate execution layer.
//
// A quadrotor is under-actuated: independent x/y/z translation plus independent
// roll/pitch/yaw orientation cannot all be chosen simultaneously. Therefore roll and
// pitch are internal solution variables used to realize x/y velocity. Yaw remains an
// independently commanded heading. No force, position or attitude is ever written
// directly into the aircraft state.

constexpr int kStateClearanceChannel = 5;
constexpr int kStateModeChannel = 6;
constexpr uint16_t kStateNavigationValid = 1u << 5;
constexpr uint16_t kStateGameMode = 1u << 6;

constexpr float kStateMaxHorizontalSpeedMps = 5.0f;
constexpr float kStateMaxYawRateDps = 100.0f;
constexpr float kStateMinClearanceM = 0.50f;
constexpr float kStateMaxClearanceM = 5.00f;

struct NavigationState {
    V3 velocity_world_mps{};
    float agl_m{};
    bool valid{};
};

inline bool finite(const NavigationState& n) {
    return n.valid && finite(n.velocity_world_mps) && std::isfinite(n.agl_m) &&
           n.agl_m >= 0.0f && n.agl_m < 1000.0f;
}

inline uint16_t centered_raw(float value) {
    const float v = clamp(value, -1.0f, 1.0f);
    return static_cast<uint16_t>(clamp(std::lround(992.0f + 820.0f * v), 172l, 1811l));
}

inline uint16_t throttle_raw(float value) {
    const float v = clamp(value, 0.0f, 1.0f);
    return static_cast<uint16_t>(clamp(std::lround(172.0f + 1639.0f * v), 172l, 1811l));
}

inline float wrap_degrees(float value) {
    while (value > 180.0f) value -= 360.0f;
    while (value < -180.0f) value += 360.0f;
    return value;
}

struct StateIntent {
    float right_mps{};
    float forward_mps{};
    float yaw_rate_dps{};
    float clearance_m{2.0f};
    bool arm{};
    bool game_mode{};
};

inline StateIntent state_intent(const RC& rc) {
    const float clearance01 = throttle(rc.ch[kStateClearanceChannel]);
    return {
        shape(centered(rc.ch[FC_SBUS_ROLL]), 0.035f, 0.25f) * kStateMaxHorizontalSpeedMps,
        shape(centered(rc.ch[FC_SBUS_PITCH]), 0.035f, 0.25f) * kStateMaxHorizontalSpeedMps,
        shape(centered(rc.ch[FC_SBUS_YAW]), 0.045f, 0.20f) * kStateMaxYawRateDps,
        kStateMinClearanceM + clearance01 * (kStateMaxClearanceM - kStateMinClearanceM),
        rc.ch[FC_SBUS_ARM] > 1300,
        rc.ch[kStateModeChannel] > 1300,
    };
}

struct StateControllerDebug {
    float desired_forward_mps{};
    float measured_forward_mps{};
    float desired_right_mps{};
    float measured_right_mps{};
    float target_yaw_deg{};
    float measured_yaw_deg{};
    float target_agl_m{};
    float measured_agl_m{};
    float target_vz_mps{};
    float throttle{};
    float roll_command{};
    float pitch_channel_command{};
    float yaw_command{};
};

class StateController {
public:
    void reset() {
        active_ = false;
        target_yaw_deg_ = 0.0f;
        hover_trim_ = kInitialHoverThrottle;
        debug_ = {};
    }

    void leave_mode() {
        active_ = false;
        debug_ = {};
    }

    // Compatibility overload used by low-level tests that intentionally isolate the
    // velocity law from measured roll/pitch. StateRuntime always uses the full measured
    // attitude overload below.
    RC transform(const RC& original, const NavigationState& nav, float yaw_deg,
                 bool inner_armed, float dt) {
        return transform(original, nav, 0.0f, 0.0f, yaw_deg, inner_armed, dt);
    }

    RC transform(const RC& original, const NavigationState& nav,
                 float roll_deg, float pitch_deg, float yaw_deg,
                 bool inner_armed, float dt) {
        RC out = original;
        const StateIntent intent = state_intent(original);
        if (!active_) {
            target_yaw_deg_ = wrap_degrees(yaw_deg);
            active_ = true;
        }

        dt = clamp(dt, 0.0002f, 0.02f);
        target_yaw_deg_ = wrap_degrees(target_yaw_deg_ + intent.yaw_rate_dps * dt);

        const float yaw_rad = yaw_deg * kPi / 180.0f;
        // Airframe/world convention is right-handed with +Z up and body forward
        // along -X. Therefore body-right is -Y at yaw=0. Rotating those basis
        // vectors by yaw gives forward=(-c,-s) and right=(s,-c).
        const float c = std::cos(yaw_rad);
        const float s = std::sin(yaw_rad);
        const float measured_forward = -c * nav.velocity_world_mps.x - s * nav.velocity_world_mps.y;
        const float measured_right = s * nav.velocity_world_mps.x - c * nav.velocity_world_mps.y;

        if (!inner_armed) {
            target_yaw_deg_ = wrap_degrees(yaw_deg);
            out.ch[FC_SBUS_ROLL] = centered_raw(0.0f);
            out.ch[FC_SBUS_PITCH] = centered_raw(0.0f);
            out.ch[FC_SBUS_THROTTLE] = throttle_raw(0.0f);
            out.ch[FC_SBUS_YAW] = centered_raw(0.0f);
            debug_ = {intent.forward_mps, measured_forward,
                      intent.right_mps, measured_right,
                      target_yaw_deg_, yaw_deg,
                      intent.clearance_m, nav.agl_m,
                      0.0f, 0.0f, 0.0f, 0.0f, 0.0f};
            return out;
        }

        const float forward_error = intent.forward_mps - measured_forward;
        const float right_error = intent.right_mps - measured_right;

        // The inner controller is an attitude->rate->motor cascade, so the velocity
        // loop must remain slower than its real attitude dynamics. Pure velocity P
        // can otherwise keep asking for forward tilt while the aircraft is already
        // strongly tilted, then require a large reversal when the stick is released.
        // Feed the *measured* attitude back into the desired-attitude calculation:
        // existing tilt progressively unloads the velocity command and, after a
        // velocity-target reversal, immediately increases the opposing target. This
        // is state feedback only; fc::Runtime still owns all attitude/rate execution.
        // Pitch channel sign is inverted by command(), while roll is not.
        const float bounded_roll_deg = clamp(roll_deg, -45.0f, 45.0f);
        const float bounded_pitch_deg = clamp(pitch_deg, -45.0f, 45.0f);
        const float pitch_channel = clamp(kVelocityToAttitude * forward_error +
                                              kAttitudeLead * bounded_pitch_deg / 32.0f,
                                          -kMaxAttitudeCommand, kMaxAttitudeCommand);
        const float roll_command = clamp(kVelocityToAttitude * right_error -
                                             kAttitudeLead * bounded_roll_deg / 32.0f,
                                         -kMaxAttitudeCommand, kMaxAttitudeCommand);

        const float yaw_error = wrap_degrees(target_yaw_deg_ - yaw_deg);
        const float desired_yaw_rate = clamp(intent.yaw_rate_dps + kHeadingKp * yaw_error,
                                             -180.0f, 180.0f);
        const float yaw_command = desired_yaw_rate / 180.0f;

        const float agl_error = intent.clearance_m - nav.agl_m;
        const float target_vz = clamp(kAglToVerticalSpeed * agl_error,
                                      -kMaxVerticalSpeedMps, kMaxVerticalSpeedMps);
        const float vz_error = target_vz - nav.velocity_world_mps.z;

        float throttle_command = 0.0f;
        if (inner_armed) {
            // Integral adaptation learns the actual hover command instead of assuming
            // a simulator-only mass/prop constant. It is intentionally slow and bounded.
            hover_trim_ = clamp(hover_trim_ + kHoverAdapt * vz_error * dt,
                                kMinHoverTrim, kMaxHoverTrim);
            throttle_command = clamp(hover_trim_ + kVerticalSpeedKp * vz_error +
                                     kAglDirectKp * agl_error,
                                     kMinFlightThrottle, kMaxFlightThrottle);
        }

        out.ch[FC_SBUS_ROLL] = centered_raw(roll_command);
        out.ch[FC_SBUS_PITCH] = centered_raw(pitch_channel);
        out.ch[FC_SBUS_THROTTLE] = throttle_raw(throttle_command);
        out.ch[FC_SBUS_YAW] = centered_raw(yaw_command);
        // ARM, mode and clearance channels remain exactly as received.

        debug_ = {intent.forward_mps, measured_forward,
                  intent.right_mps, measured_right,
                  target_yaw_deg_, yaw_deg,
                  intent.clearance_m, nav.agl_m,
                  target_vz, throttle_command,
                  roll_command, pitch_channel, yaw_command};
        return out;
    }

    const StateControllerDebug& debug() const { return debug_; }
    float hover_trim() const { return hover_trim_; }

private:
    // 32 degrees is the inner attitude controller's full command. Limit the outer
    // loop to about 25 degrees so vertical authority remains available.
    static constexpr float kMaxAttitudeCommand = 25.0f / 32.0f;
    static constexpr float kVelocityToAttitude = 0.16f;  // normalized attitude / (m/s error)
    static constexpr float kAttitudeLead = 1.00f;         // measured-tilt damping of outer velocity loop
    static constexpr float kHeadingKp = 2.2f;             // deg/s per deg heading error
    static constexpr float kAglToVerticalSpeed = 1.30f;
    static constexpr float kMaxVerticalSpeedMps = 2.0f;
    static constexpr float kVerticalSpeedKp = 0.12f;
    static constexpr float kAglDirectKp = 0.020f;
    static constexpr float kHoverAdapt = 0.060f;
    static constexpr float kInitialHoverThrottle = 0.39f;
    static constexpr float kMinHoverTrim = 0.25f;
    static constexpr float kMaxHoverTrim = 0.65f;
    static constexpr float kMinFlightThrottle = 0.08f;
    static constexpr float kMaxFlightThrottle = 0.85f;

    bool active_{};
    float target_yaw_deg_{};
    float hover_trim_{kInitialHoverThrottle};
    StateControllerDebug debug_{};
};

struct StateRuntimeInput {
    RuntimeInput flight{};
    NavigationState navigation{};
};

class StateRuntime {
public:
    StateRuntime() { reset(); }

    void reset() {
        runtime_.reset();
        state_controller_.reset();
        last_roll_deg_ = 0.0f;
        last_pitch_deg_ = 0.0f;
        last_yaw_deg_ = 0.0f;
        game_active_ = false;
    }

    RuntimeOutput step(StateRuntimeInput input) {
        const StateIntent intent = state_intent(input.flight.rc);
        if (!intent.game_mode) {
            if (game_active_) state_controller_.leave_mode();
            game_active_ = false;
            RuntimeOutput out = runtime_.step(input.flight);
            update_attitude(out);
            return out;
        }

        game_active_ = true;
        if (!finite(input.navigation)) {
            // No fabricated navigation state. GAME mode fails closed: make the RC
            // unavailable to the inner runtime so its existing failsafe disarms.
            input.flight.rc.valid = false;
            input.flight.rc_fresh = false;
            RuntimeOutput out = runtime_.step(input.flight);
            out.state |= kStateGameMode;
            update_attitude(out);
            return out;
        }

        const float dt = (input.flight.dt_us > 0 && input.flight.dt_us < 100000)
                             ? static_cast<float>(input.flight.dt_us) * 1.0e-6f
                             : 0.001f;
        input.flight.rc = state_controller_.transform(input.flight.rc, input.navigation,
                                                       last_roll_deg_, last_pitch_deg_, last_yaw_deg_,
                                                       runtime_.armed(), dt);
        RuntimeOutput out = runtime_.step(input.flight);
        out.state |= kStateGameMode | kStateNavigationValid;
        update_attitude(out);
        return out;
    }

    Runtime& inner() { return runtime_; }
    const Runtime& inner() const { return runtime_; }
    const StateController& state_controller() const { return state_controller_; }
    bool game_active() const { return game_active_; }

private:
    void update_attitude(const RuntimeOutput& out) {
        last_roll_deg_ = static_cast<float>(out.attitude_cdeg[0]) * 0.01f;
        last_pitch_deg_ = static_cast<float>(out.attitude_cdeg[1]) * 0.01f;
        last_yaw_deg_ = static_cast<float>(out.attitude_cdeg[2]) * 0.01f;
    }

    Runtime runtime_{};
    StateController state_controller_{};
    float last_roll_deg_{};
    float last_pitch_deg_{};
    float last_yaw_deg_{};
    bool game_active_{};
};

}  // namespace fc
