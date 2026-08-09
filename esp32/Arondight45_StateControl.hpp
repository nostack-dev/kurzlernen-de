#pragma once

#include "Arondight45_DroneFC_Core.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace fc {

// GAME control is a state-vector feedback controller. Receiver channels are
// decoded once into user intent; the outer loop then produces a physical Command
// directly for fc::Runtime. No synthetic SBUS frames exist inside the controller.
constexpr int kStateClearanceChannel = 5;
constexpr int kStateModeChannel = 6;
constexpr int kStateBodyPitchChannel = 7;
constexpr uint16_t kStateNavigationValid = 1u << 5;
constexpr uint16_t kStateGameMode = 1u << 6;

constexpr float kStateMaxHorizontalSpeedMps = 5.0f;
constexpr float kStateMaxYawRateDps = 140.0f;
constexpr float kStateMaxBodyPitchDeg = 25.0f;
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

inline float wrap_degrees(float value) {
    while (value > 180.0f) value -= 360.0f;
    while (value < -180.0f) value += 360.0f;
    return value;
}

struct StateIntent {
    float right_mps{};
    float forward_mps{};
    float yaw_rate_dps{};
    float body_pitch_deg{};
    float clearance_m{2.0f};
    bool arm{};
    bool game_mode{};
};

inline StateIntent state_intent(const RC& rc) {
    float right = shape(centered(rc.ch[FC_SBUS_ROLL]), 0.035f, 0.25f);
    float forward = shape(centered(rc.ch[FC_SBUS_PITCH]), 0.035f, 0.25f);
    const float magnitude = std::sqrt(forward * forward + right * right);
    if (magnitude > 1.0f) {
        forward /= magnitude;
        right /= magnitude;
    }

    const float clearance01 = throttle(rc.ch[kStateClearanceChannel]);
    // GAME right-stick Y is a real aircraft-attitude input. Positive input is
    // physical nose-up pitch in the same Euler convention reported by the FC.
    const float body_pitch_deg =
        shape(centered(rc.ch[kStateBodyPitchChannel]), 0.045f, 0.20f) *
        kStateMaxBodyPitchDeg;
    return {
        right * kStateMaxHorizontalSpeedMps,
        forward * kStateMaxHorizontalSpeedMps,
        shape(centered(rc.ch[FC_SBUS_YAW]), 0.045f, 0.20f) * kStateMaxYawRateDps,
        body_pitch_deg,
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
    float pitch_command{};
    float yaw_command{};
    float forward_accel_mps2{};
    float right_accel_mps2{};
    float vertical_accel_mps2{};
};

class StateController {
public:
    void reset() {
        active_ = false;
        target_yaw_deg_ = 0.0f;
        hover_trim_ = kInitialHoverThrottle;
        reset_acceleration_estimator();
        debug_ = {};
    }

    void leave_mode() {
        active_ = false;
        reset_acceleration_estimator();
        debug_ = {};
    }

    Command run(const RC& receiver, const NavigationState& nav, float yaw_deg,
                bool inner_armed, float dt) {
        const StateIntent intent = state_intent(receiver);
        if (!active_) {
            target_yaw_deg_ = wrap_degrees(yaw_deg);
            active_ = true;
        }

        dt = clamp(dt, 0.0002f, 0.02f);
        target_yaw_deg_ = wrap_degrees(target_yaw_deg_ + intent.yaw_rate_dps * dt);

        const float yaw_rad = yaw_deg * kPi / 180.0f;
        const float c = std::cos(yaw_rad);
        const float s = std::sin(yaw_rad);
        const float measured_forward = -c * nav.velocity_world_mps.x - s * nav.velocity_world_mps.y;
        // Body forward is -X. With +Z up, physical body-right is forward × up,
        // i.e. (-sin(yaw), +cos(yaw)). Keep GAME D/right in that real frame.
        const float measured_right = -s * nav.velocity_world_mps.x + c * nav.velocity_world_mps.y;

        if (!inner_armed) {
            reset_acceleration_estimator();
            target_yaw_deg_ = wrap_degrees(yaw_deg);
            debug_ = {intent.forward_mps, measured_forward,
                      intent.right_mps, measured_right,
                      target_yaw_deg_, yaw_deg,
                      intent.clearance_m, nav.agl_m,
                      0.0f, 0.0f, 0.0f, 0.0f, 0.0f,
                      0.0f, 0.0f, 0.0f};
            return Command{0.0f, 0.0f, 0.0f, 0.0f, intent.arm};
        }

        update_acceleration_estimator(nav.velocity_world_mps, dt);
        const float measured_forward_accel =
            -c * measured_acceleration_world_mps2_.x - s * measured_acceleration_world_mps2_.y;
        const float measured_right_accel =
            -s * measured_acceleration_world_mps2_.x + c * measured_acceleration_world_mps2_.y;

        const float agl_error = intent.clearance_m - nav.agl_m;
        const float target_vz = clamp(kAglToVerticalSpeed * agl_error,
                                      -kMaxVerticalSpeedMps, kMaxVerticalSpeedMps);
        const float vz_error = target_vz - nav.velocity_world_mps.z;
        const float vertical_accel = clamp(kVerticalVelocityGain * vz_error,
                                           -kMaxVerticalAccelerationMps2,
                                           kMaxVerticalAccelerationMps2);
        const float specific_up = clamp(kGravityMps2 + vertical_accel,
                                        kMinSpecificUpMps2, kMaxSpecificUpMps2);

        float forward_accel =
            kHorizontalVelocityGain * (intent.forward_mps - measured_forward) -
            kHorizontalAccelerationDamping * measured_forward_accel;
        float right_accel =
            kHorizontalVelocityGain * (intent.right_mps - measured_right) -
            kHorizontalAccelerationDamping * measured_right_accel;

        const float horizontal_accel = std::sqrt(forward_accel * forward_accel +
                                                 right_accel * right_accel);
        const float allowed_horizontal_accel = std::min(kMaxHorizontalAccelerationMps2,
                                                        specific_up * kMaxTiltTangent);
        if (horizontal_accel > allowed_horizontal_accel && horizontal_accel > 1.0e-6f) {
            const float vector_scale = allowed_horizontal_accel / horizontal_accel;
            forward_accel *= vector_scale;
            right_accel *= vector_scale;
        }

        const float auto_pitch_target_deg =
            -std::atan2(forward_accel, specific_up) * 180.0f / kPi;
        // The right-stick body-pitch request is an actual attitude bias, added at
        // the physical attitude-target layer. Left-stick forward/reverse remains
        // the velocity-state request; the two inputs combine at the one real pitch
        // degree of freedom instead of abusing camera state or simulator truth.
        const float pitch_target_deg = clamp(auto_pitch_target_deg + intent.body_pitch_deg,
                                             -kMaxTiltDeg, kMaxTiltDeg);
        // Positive Euler roll is about body +X, which points toward the tail because
        // this airframe's nose is -X. A physical rightward (+body-Y) acceleration
        // therefore requires negative roll.
        const float roll_target_deg = -std::atan2(
            right_accel, std::sqrt(specific_up * specific_up + forward_accel * forward_accel)) *
            180.0f / kPi;
        const float roll_command = clamp(roll_target_deg / kInnerAttitudeRangeDeg,
                                         -kMaxAttitudeCommand, kMaxAttitudeCommand);
        const float pitch_command = clamp(pitch_target_deg / kInnerAttitudeRangeDeg,
                                          -kMaxAttitudeCommand, kMaxAttitudeCommand);

        const float yaw_error = wrap_degrees(target_yaw_deg_ - yaw_deg);
        const float desired_yaw_rate = clamp(intent.yaw_rate_dps + kHeadingKp * yaw_error,
                                             -180.0f, 180.0f);
        const float yaw_command = desired_yaw_rate / 180.0f;

        hover_trim_ = clamp(hover_trim_ + kHoverAdapt * vz_error * dt,
                            kMinHoverTrim, kMaxHoverTrim);
        // Compensate thrust from the final commanded body attitude, including the
        // manual pitch bias. This keeps AGL control physical instead of letting a
        // body-pitch command masquerade as an altitude loss in the outer loop.
        const float roll_rad = roll_target_deg * kPi / 180.0f;
        const float pitch_rad = pitch_target_deg * kPi / 180.0f;
        const float vertical_thrust_fraction =
            std::max(0.35f, std::cos(roll_rad) * std::cos(pitch_rad));
        const float required_specific_force = specific_up / vertical_thrust_fraction;
        const float thrust_ratio = required_specific_force / kGravityMps2;
        const float hover_motor_command = kEscCommandOffset + kEscCommandScale * hover_trim_;
        const float required_motor_command = hover_motor_command * std::sqrt(thrust_ratio);
        const float throttle_command = clamp(
            (required_motor_command - kEscCommandOffset) / kEscCommandScale,
            kMinFlightThrottle, kMaxFlightThrottle);

        debug_ = {intent.forward_mps, measured_forward,
                  intent.right_mps, measured_right,
                  target_yaw_deg_, yaw_deg,
                  intent.clearance_m, nav.agl_m,
                  target_vz, throttle_command,
                  roll_command, pitch_command, yaw_command,
                  forward_accel, right_accel, vertical_accel};
        return sanitize(Command{roll_command, pitch_command, throttle_command, yaw_command, intent.arm});
    }

    const StateControllerDebug& debug() const { return debug_; }
    float hover_trim() const { return hover_trim_; }

private:
    static constexpr float kGravityMps2 = 9.80665f;
    static constexpr float kInnerAttitudeRangeDeg = 32.0f;
    static constexpr float kMaxTiltDeg = 25.0f;
    static constexpr float kMaxTiltTangent = 0.46630766f;
    static constexpr float kMaxAttitudeCommand = kMaxTiltDeg / kInnerAttitudeRangeDeg;

    // Preserve the previously validated small-signal velocity loop gain. The
    // responsiveness change comes only from removing the old 2 m/s^2 authority
    // bottleneck, so simulator and hardware run the same controller without an
    // unmeasured gain change hidden inside the tuning pass.
    static constexpr float kHorizontalVelocityGain = 0.80f;
    static constexpr float kHorizontalAccelerationDamping = 0.55f;
    static constexpr float kMeasuredAccelerationFilterTauS = 0.06f;
    static constexpr float kMaxNavigationAccelSampleMps2 = 15.0f;
    // 25 deg permits g*tan(25 deg) ~= 4.57 m/s^2 at level hover. Keep margin for
    // thrust reserve, battery sag and attitude tracking instead of commanding the
    // geometric limit itself. This is a controller envelope, not simulated force.
    static constexpr float kMaxHorizontalAccelerationMps2 = 4.0f;

    static constexpr float kAglToVerticalSpeed = 1.30f;
    static constexpr float kMaxVerticalSpeedMps = 2.0f;
    static constexpr float kVerticalVelocityGain = 2.0f;
    static constexpr float kMaxVerticalAccelerationMps2 = 4.0f;
    static constexpr float kMinSpecificUpMps2 = 4.0f;
    static constexpr float kMaxSpecificUpMps2 = 14.0f;

    static constexpr float kEscCommandOffset =
        static_cast<float>(kEscIdleUs - kEscMinUs) / static_cast<float>(kEscMaxUs - kEscMinUs);
    static constexpr float kEscCommandScale =
        static_cast<float>(kEscMaxUs - kEscIdleUs) / static_cast<float>(kEscMaxUs - kEscMinUs);

    static constexpr float kHeadingKp = 2.2f;
    static constexpr float kHoverAdapt = 0.050f;
    static constexpr float kInitialHoverThrottle = 0.39f;
    static constexpr float kMinHoverTrim = 0.25f;
    static constexpr float kMaxHoverTrim = 0.65f;
    static constexpr float kMinFlightThrottle = 0.08f;
    static constexpr float kMaxFlightThrottle = 0.85f;

    void reset_acceleration_estimator() {
        acceleration_estimator_valid_ = false;
        acceleration_sample_dt_s_ = 0.0f;
        previous_velocity_world_mps_ = {};
        measured_acceleration_world_mps2_ = {};
    }

    void update_acceleration_estimator(V3 velocity_world_mps, float dt) {
        if (!acceleration_estimator_valid_) {
            previous_velocity_world_mps_ = velocity_world_mps;
            acceleration_estimator_valid_ = true;
            acceleration_sample_dt_s_ = 0.0f;
            return;
        }

        acceleration_sample_dt_s_ = std::min(acceleration_sample_dt_s_ + dt, 0.05f);
        const float dx = velocity_world_mps.x - previous_velocity_world_mps_.x;
        const float dy = velocity_world_mps.y - previous_velocity_world_mps_.y;
        const float dz = velocity_world_mps.z - previous_velocity_world_mps_.z;
        if (dx * dx + dy * dy + dz * dz < 1.0e-10f || acceleration_sample_dt_s_ < 0.002f)
            return;

        const float sample_dt = acceleration_sample_dt_s_;
        const float inv_dt = 1.0f / sample_dt;
        const V3 sample{dx * inv_dt, dy * inv_dt, dz * inv_dt};
        previous_velocity_world_mps_ = velocity_world_mps;
        acceleration_sample_dt_s_ = 0.0f;

        const float horizontal_sample = std::sqrt(sample.x * sample.x + sample.y * sample.y);
        if (!finite(sample) || horizontal_sample > kMaxNavigationAccelSampleMps2) {
            measured_acceleration_world_mps2_ = {};
            return;
        }

        const float alpha = clamp(sample_dt / (kMeasuredAccelerationFilterTauS + sample_dt),
                                  0.0f, 1.0f);
        measured_acceleration_world_mps2_.x +=
            alpha * (sample.x - measured_acceleration_world_mps2_.x);
        measured_acceleration_world_mps2_.y +=
            alpha * (sample.y - measured_acceleration_world_mps2_.y);
        measured_acceleration_world_mps2_.z +=
            alpha * (sample.z - measured_acceleration_world_mps2_.z);
    }

    bool active_{};
    bool acceleration_estimator_valid_{};
    float acceleration_sample_dt_s_{};
    V3 previous_velocity_world_mps_{};
    V3 measured_acceleration_world_mps2_{};
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
        const bool receiver_valid = input.flight.rc.valid && input.flight.rc_fresh;
        if (!receiver_valid || !finite(input.navigation)) {
            state_controller_.leave_mode();
            RuntimeOutput out = runtime_.step_command(input.flight, Command{}, false);
            out.state |= kStateGameMode;
            update_attitude(out);
            return out;
        }

        const float dt = (input.flight.dt_us > 0 && input.flight.dt_us < 100000)
                             ? static_cast<float>(input.flight.dt_us) * 1.0e-6f
                             : 0.001f;
        const Command physical_command = state_controller_.run(
            input.flight.rc, input.navigation, last_yaw_deg_, runtime_.armed(), dt);
        RuntimeOutput out = runtime_.step_command(input.flight, physical_command, true);
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
        last_yaw_deg_ = static_cast<float>(out.attitude_cdeg[2]) * 0.01f;
    }

    Runtime runtime_{};
    StateController state_controller_{};
    float last_yaw_deg_{};
    bool game_active_{};
};

}  // namespace fc