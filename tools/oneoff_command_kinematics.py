import os
from pathlib import Path

# Complete the 3-D kinematics in both directions while keeping the proven,
# conservative inner-loop gains.
core = Path('esp32/Arondight45_DroneFC_Core.hpp')
s = core.read_text()
old = '''        constexpr float kAngleToRate = 1.9f;
        const float roll_rate = clamp((cmd.roll * 32.0f - attitude.roll) * kAngleToRate, -240.0f, 240.0f);
        const float pitch_rate = clamp((cmd.pitch * 32.0f - attitude.pitch) * kAngleToRate, -240.0f, 240.0f);
        const float yaw_rate = cmd.yaw * 180.0f;
        return mix(cmd.throttle,
                   roll_pid_.run(roll_rate, s.g.x, dt, integrate),
                   pitch_pid_.run(pitch_rate, s.g.y, dt, integrate),
                   yaw_pid_.run(yaw_rate, s.g.z, dt, integrate));'''
new = '''        constexpr float kAngleToRate = 1.9f;
        // The angle loops live in ZYX Euler coordinates while the gyro rate
        // loops live in body p/q/r. Convert the desired Euler rates through the
        // exact inverse Jacobian; Attitude::run() performs the forward mapping.
        const float roll_euler_rate = clamp((cmd.roll * 32.0f - attitude.roll) * kAngleToRate, -240.0f, 240.0f);
        const float pitch_euler_rate = clamp((cmd.pitch * 32.0f - attitude.pitch) * kAngleToRate, -240.0f, 240.0f);
        const float yaw_euler_rate = cmd.yaw * 180.0f;
        const float phi = attitude.roll * kPi / 180.0f;
        const float theta = attitude.pitch * kPi / 180.0f;
        const float sin_phi = std::sin(phi);
        const float cos_phi = std::cos(phi);
        const float sin_theta = std::sin(theta);
        const float cos_theta = std::cos(theta);
        const float p_target = roll_euler_rate - yaw_euler_rate * sin_theta;
        const float q_target = pitch_euler_rate * cos_phi + yaw_euler_rate * sin_phi * cos_theta;
        const float r_target = -pitch_euler_rate * sin_phi + yaw_euler_rate * cos_phi * cos_theta;
        return mix(cmd.throttle,
                   roll_pid_.run(p_target, s.g.x, dt, integrate),
                   pitch_pid_.run(q_target, s.g.y, dt, integrate),
                   yaw_pid_.run(r_target, s.g.z, dt, integrate));'''
assert s.count(old) == 1, ('core command block', s.count(old))
core.write_text(s.replace(old, new, 1))

# Make the outer horizontal loop a true measured-state PD law:
# a* = Kv(v* - v) - Kd(dv/dt).  dv/dt is derived from the same quantized
# navigation samples that form IST; no attitude proxy and no simulator truth.
p = Path('esp32/Arondight45_StateControl.hpp')
s = p.read_text()
old = '''    void reset() {
        active_ = false;
        target_yaw_deg_ = 0.0f;
        hover_trim_ = kInitialHoverThrottle;
        debug_ = {};
    }

    void leave_mode() {
        active_ = false;
        debug_ = {};
    }'''
new = '''    void reset() {
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
    }'''
assert s.count(old) == 1, ('reset', s.count(old)); s = s.replace(old,new,1)

old = '''        RC out = original;
        const StateIntent intent = state_intent(original);'''
new = '''        (void)roll_deg;
        (void)pitch_deg;
        RC out = original;
        const StateIntent intent = state_intent(original);'''
assert s.count(old) == 1, ('transform', s.count(old)); s = s.replace(old,new,1)

old = '''        if (!inner_armed) {
            target_yaw_deg_ = wrap_degrees(yaw_deg);'''
new = '''        if (!inner_armed) {
            reset_acceleration_estimator();
            target_yaw_deg_ = wrap_degrees(yaw_deg);'''
assert s.count(old) == 1, ('unarmed', s.count(old)); s = s.replace(old,new,1)

old = '''        // The velocity error produces the desired horizontal acceleration vector.
        float forward_accel = kHorizontalVelocityGain * (intent.forward_mps - measured_forward);
        float right_accel = kHorizontalVelocityGain * (intent.right_mps - measured_right);

        // A velocity target alone is not an equilibrium if the aircraft is still
        // tilted and therefore still accelerating. Use measured IMU attitude to
        // estimate the horizontal acceleration already being produced by the thrust
        // vector, then subtract that measured acceleration as pure derivative damping.
        // When measured acceleration is zero, the original a*=Kv(v*-v) law is exactly
        // unchanged. This is identical on forward/right and has no release/brake branch.
        const float roll_rad = clamp(roll_deg, -kMaxAttitudeFeedbackDeg,
                                     kMaxAttitudeFeedbackDeg) * kPi / 180.0f;
        const float pitch_rad = clamp(pitch_deg, -kMaxAttitudeFeedbackDeg,
                                      kMaxAttitudeFeedbackDeg) * kPi / 180.0f;
        const float cos_pitch = std::max(0.25f, std::cos(pitch_rad));
        const float measured_forward_accel = -std::tan(pitch_rad) * specific_up;
        const float measured_right_accel = std::tan(roll_rad) / cos_pitch * specific_up;
        forward_accel -= kHorizontalAccelerationDamping * measured_forward_accel;
        right_accel -= kHorizontalAccelerationDamping * measured_right_accel;'''
new = '''        // Desired-minus-measured velocity is the P term.  The D term is the
        // measured derivative of that same navigation velocity vector.  This keeps
        // the entire horizontal controller in the user's SOLL/IST state space.
        float forward_accel = kHorizontalVelocityGain * (intent.forward_mps - measured_forward);
        float right_accel = kHorizontalVelocityGain * (intent.right_mps - measured_right);
        update_acceleration_estimator(nav.velocity_world_mps, dt);
        const float measured_forward_accel =
            -c * measured_acceleration_world_mps2_.x - s * measured_acceleration_world_mps2_.y;
        const float measured_right_accel =
            s * measured_acceleration_world_mps2_.x - c * measured_acceleration_world_mps2_.y;
        forward_accel -= kHorizontalAccelerationDamping * measured_forward_accel;
        right_accel -= kHorizontalAccelerationDamping * measured_right_accel;'''
assert s.count(old) == 1, ('damping block', s.count(old)); s = s.replace(old,new,1)

old = '''    static constexpr float kMaxAttitudeCommand = kMaxTiltDeg / kInnerAttitudeRangeDeg;
    static constexpr float kMaxAttitudeFeedbackDeg = 45.0f;'''
new = '''    static constexpr float kMaxAttitudeCommand = kMaxTiltDeg / kInnerAttitudeRangeDeg;'''
assert s.count(old) == 1, ('feedback constant', s.count(old)); s = s.replace(old,new,1)

old = '''    // Pure acceleration damping provides phase margin against attitude/rotor lag
    // without changing the velocity-error gain when current acceleration is zero.
    static constexpr float kHorizontalAccelerationDamping = 0.75f;
    static constexpr float kMaxHorizontalAccelerationMps2 = 2.0f;'''
new = f'''    // Damping comes from the measured navigation-state derivative itself.
    static constexpr float kHorizontalAccelerationDamping = {os.environ['DAMPING']};
    static constexpr float kMeasuredAccelerationFilterTauS = 0.08f;
    static constexpr float kMaxNavigationAccelSampleMps2 = 12.0f;
    static constexpr float kMaxHorizontalAccelerationMps2 = 2.0f;'''
assert s.count(old) == 1, ('constants', s.count(old)); s = s.replace(old,new,1)

old = '''    bool active_{};
    float target_yaw_deg_{};
    float hover_trim_{kInitialHoverThrottle};
    StateControllerDebug debug_{};'''
new = '''    void reset_acceleration_estimator() {
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
        acceleration_sample_dt_s_ += dt;
        const float dvx = velocity_world_mps.x - previous_velocity_world_mps_.x;
        const float dvy = velocity_world_mps.y - previous_velocity_world_mps_.y;
        const float dvz = velocity_world_mps.z - previous_velocity_world_mps_.z;
        if (dvx * dvx + dvy * dvy + dvz * dvz < 1.0e-10f ||
            acceleration_sample_dt_s_ < 0.002f) return;
        const float sample_dt = acceleration_sample_dt_s_;
        const V3 sample{dvx / sample_dt, dvy / sample_dt, dvz / sample_dt};
        previous_velocity_world_mps_ = velocity_world_mps;
        acceleration_sample_dt_s_ = 0.0f;
        const float horizontal_sample = std::sqrt(sample.x * sample.x + sample.y * sample.y);
        if (!finite(sample) || horizontal_sample > kMaxNavigationAccelSampleMps2) return;
        const float alpha = clamp(sample_dt / (kMeasuredAccelerationFilterTauS + sample_dt), 0.0f, 1.0f);
        measured_acceleration_world_mps2_.x += alpha * (sample.x - measured_acceleration_world_mps2_.x);
        measured_acceleration_world_mps2_.y += alpha * (sample.y - measured_acceleration_world_mps2_.y);
        measured_acceleration_world_mps2_.z += alpha * (sample.z - measured_acceleration_world_mps2_.z);
    }

    bool active_{};
    bool acceleration_estimator_valid_{};
    float acceleration_sample_dt_s_{};
    V3 previous_velocity_world_mps_{};
    V3 measured_acceleration_world_mps2_{};
    float target_yaw_deg_{};
    float hover_trim_{kInitialHoverThrottle};
    StateControllerDebug debug_{};'''
assert s.count(old) == 1, ('members', s.count(old)); s = s.replace(old,new,1)
p.write_text(s)
