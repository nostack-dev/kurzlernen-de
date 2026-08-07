#pragma once

#include "Arondight45_DroneFC_Core.hpp"

#include <cmath>
#include <cstdint>

namespace fc {

// GAME control is a state-vector feedback controller.
//
// User intent defines the target state:
//   - body-forward velocity
//   - body-right velocity
//   - ground clearance
//   - yaw / yaw-rate
//
// Navigation + IMU provide the measured state. The controller subtracts measured
// motion from desired motion, converts that velocity error into a desired physical
// acceleration vector, adds gravity, and geometrically derives the thrust direction
// and magnitude required from the quadrotor. Roll/pitch are therefore only internal
// actuator coordinates used to point the thrust vector; they are not user targets.
// The existing fc::Runtime remains the sole attitude/rate/motor execution layer.

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
    float right = shape(centered(rc.ch[FC_SBUS_ROLL]), 0.035f, 0.25f);
    float forward = shape(centered(rc.ch[FC_SBUS_PITCH]), 0.035f, 0.25f);

    // The two translational stick axes are one desired velocity vector. Direction
    // comes from (forward,right), and vector length is speed. Even a square-corner
    // transmitter input therefore cannot create sqrt(2) extra speed authority.
    const float magnitude = std::sqrt(forward * forward + right * right);
    if (magnitude > 1.0f) {
        forward /= magnitude;
        right /= magnitude;
    }

    const float clearance01 = throttle(rc.ch[kStateClearanceChannel]);
    return {
        right * kStateMaxHorizontalSpeedMps,
        forward * kStateMaxHorizontalSpeedMps,
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
        debug_ = {};
    }

    void leave_mode() {
        active_ = false;
        debug_ = {};
    }

    RC transform(const RC& original, const NavigationState& nav, float yaw_deg,
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
        const float c = std::cos(yaw_rad);
        const float s = std::sin(yaw_rad);

        // Airframe/world convention: +Z is up, body-forward is -X and body-right
        // is -Y at yaw=0. Project measured world velocity onto those yaw-rotated
        // body axes so target and measurement live in exactly the same vector space.
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
                      0.0f, 0.0f, 0.0f, 0.0f, 0.0f,
                      0.0f, 0.0f, 0.0f};
            return out;
        }

        // Z is also state feedback: the clearance error creates a desired vertical
        // speed, and vertical-speed error creates the requested vertical acceleration.
        const float agl_error = intent.clearance_m - nav.agl_m;
        const float target_vz = clamp(kAglToVerticalSpeed * agl_error,
                                      -kMaxVerticalSpeedMps, kMaxVerticalSpeedMps);
        const float vz_error = target_vz - nav.velocity_world_mps.z;
        const float vertical_accel = clamp(kVerticalVelocityGain * vz_error,
                                           -kMaxVerticalAccelerationMps2,
                                           kMaxVerticalAccelerationMps2);
        const float specific_up = clamp(kGravityMps2 + vertical_accel,
                                        kMinSpecificUpMps2, kMaxSpecificUpMps2);

        // XY is the same equation: velocity target minus measured velocity gives
        // acceleration demand. Limit the acceleration vector as a vector, not each
        // axis separately. The second limit is the exact horizontal acceleration
        // available at the permitted maximum tilt for the requested vertical force.
        float forward_accel = kHorizontalVelocityGain * (intent.forward_mps - measured_forward);
        float right_accel = kHorizontalVelocityGain * (intent.right_mps - measured_right);
        const float horizontal_accel = std::sqrt(forward_accel * forward_accel +
                                                 right_accel * right_accel);
        const float tilt_limited_accel = specific_up * kMaxTiltTangent;
        const float allowed_horizontal_accel = std::min(kMaxHorizontalAccelerationMps2,
                                                        tilt_limited_accel);
        if (horizontal_accel > allowed_horizontal_accel && horizontal_accel > 1.0e-6f) {
            const float scale = allowed_horizontal_accel / horizontal_accel;
            forward_accel *= scale;
            right_accel *= scale;
        }

        // Desired specific force = desired acceleration + gravity. Geometry of that
        // one vector yields both the direction (roll/pitch) and magnitude (throttle).
        // No measured-attitude lead term is needed: the inner IMU feedback controller
        // simply tracks this physically required thrust direction.
        const float pitch_target_deg = -std::atan2(forward_accel, specific_up) * 180.0f / kPi;
        const float roll_target_deg = std::atan2(
            right_accel, std::sqrt(specific_up * specific_up + forward_accel * forward_accel)) *
            180.0f / kPi;
        const float roll_command = clamp(roll_target_deg / kInnerAttitudeRangeDeg,
                                         -kMaxAttitudeCommand, kMaxAttitudeCommand);
        // command() in the inner runtime intentionally inverts the pitch SBUS channel.
        const float pitch_channel = clamp(-pitch_target_deg / kInnerAttitudeRangeDeg,
                                          -kMaxAttitudeCommand, kMaxAttitudeCommand);

        const float yaw_error = wrap_degrees(target_yaw_deg_ - yaw_deg);
        const float desired_yaw_rate = clamp(intent.yaw_rate_dps + kHeadingKp * yaw_error,
                                             -180.0f, 180.0f);
        const float yaw_command = desired_yaw_rate / 180.0f;

        // The actuator-to-thrust scale is aircraft-specific, so hover collective cannot
        // be guessed from simulator constants or assumed hardware. Treat hover_trim_
        // as the slow integral/feed-forward state of the same vertical feedback loop.
        // Every armed, navigation-valid tick integrates vz target minus measured vz.
        // If collective is initially insufficient to leave the ground, the requested
        // motor command therefore rises until the real measured vertical state responds.
        hover_trim_ = clamp(hover_trim_ + kHoverAdapt * vz_error * dt,
                            kMinHoverTrim, kMaxHoverTrim);
        const float required_specific_force = std::sqrt(
            forward_accel * forward_accel + right_accel * right_accel +
            specific_up * specific_up);
        // Propeller thrust is approximately proportional to rotor speed squared.
        // Runtime throttle maps linearly onto the ESC pulse above idle, which is
        // much closer to rotor-speed command than to thrust. Convert the required
        // specific-force ratio through sqrt() before commanding the actuator; a
        // linear force->throttle map over-commands transients and excites Z ringing.
        const float thrust_ratio = required_specific_force / kGravityMps2;
        const float hover_motor_command = kEscCommandOffset + kEscCommandScale * hover_trim_;
        const float required_motor_command = hover_motor_command * std::sqrt(thrust_ratio);
        const float throttle_command = clamp(
            (required_motor_command - kEscCommandOffset) / kEscCommandScale,
            kMinFlightThrottle, kMaxFlightThrottle);

        out.ch[FC_SBUS_ROLL] = centered_raw(roll_command);
        out.ch[FC_SBUS_PITCH] = centered_raw(pitch_channel);
        out.ch[FC_SBUS_THROTTLE] = throttle_raw(throttle_command);
        out.ch[FC_SBUS_YAW] = centered_raw(yaw_command);

        debug_ = {intent.forward_mps, measured_forward,
                  intent.right_mps, measured_right,
                  target_yaw_deg_, yaw_deg,
                  intent.clearance_m, nav.agl_m,
                  target_vz, throttle_command,
                  roll_command, pitch_channel, yaw_command,
                  forward_accel, right_accel, vertical_accel};
        return out;
    }

    const StateControllerDebug& debug() const { return debug_; }
    float hover_trim() const { return hover_trim_; }

private:
    static constexpr float kGravityMps2 = 9.80665f;
    static constexpr float kInnerAttitudeRangeDeg = 32.0f;
    static constexpr float kMaxTiltDeg = 25.0f;
    static constexpr float kMaxTiltTangent = 0.46630766f;  // tan(25 deg)
    static constexpr float kMaxAttitudeCommand = kMaxTiltDeg / kInnerAttitudeRangeDeg;

    // Velocity error -> acceleration. Large vector errors still hit the 2 m/s²
    // physical acceleration ceiling, so full-stick authority is unchanged. Around
    // the zero-velocity target the lower slope keeps the outer velocity loop slower
    // than the attitude/rate cascade and removes the brake-through/reverse limit cycle.
    static constexpr float kHorizontalVelocityGain = 0.60f;  // 1/s
    // GAME commands a velocity vector, not an instantaneous attitude step. Bound
    // dv/dt so target-vector reversals stay inside achievable rigid-body/rotor
    // response. Velocity authority remains 5 m/s; only physical acceleration is limited.
    static constexpr float kMaxHorizontalAccelerationMps2 = 2.0f;

    static constexpr float kAglToVerticalSpeed = 1.30f;      // 1/s
    static constexpr float kMaxVerticalSpeedMps = 2.0f;
    static constexpr float kVerticalVelocityGain = 2.0f;     // 1/s
    static constexpr float kMaxVerticalAccelerationMps2 = 4.0f;
    static constexpr float kMinSpecificUpMps2 = 4.0f;
    static constexpr float kMaxSpecificUpMps2 = 14.0f;

    // pulse() maps Runtime throttle t to 1050 + 950*t us. Expressed on the
    // ESC's 1000..2000 us command interval that is 0.05 + 0.95*t.
    static constexpr float kEscCommandOffset =
        static_cast<float>(kEscIdleUs - kEscMinUs) / static_cast<float>(kEscMaxUs - kEscMinUs);
    static constexpr float kEscCommandScale =
        static_cast<float>(kEscMaxUs - kEscIdleUs) / static_cast<float>(kEscMaxUs - kEscMinUs);

    static constexpr float kHeadingKp = 2.2f;                // deg/s per deg heading error
    static constexpr float kHoverAdapt = 0.050f;
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
                                                       last_yaw_deg_, runtime_.armed(), dt);
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
        last_yaw_deg_ = static_cast<float>(out.attitude_cdeg[2]) * 0.01f;
    }

    Runtime runtime_{};
    StateController state_controller_{};
    float last_yaw_deg_{};
    bool game_active_{};
};

}  // namespace fc
