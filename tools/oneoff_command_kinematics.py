from pathlib import Path

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
new = '''        constexpr float kAngleToRate = 4.4f;
        // Angle control is expressed in ZYX Euler coordinates, while the IMU
        // measures body p/q/r. Convert desired Euler rates through the exact
        // inverse kinematic Jacobian before closing the three gyro-rate loops.
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
assert s.count(old) == 1, s.count(old)
s = s.replace(old, new, 1)
s = s.replace('PID roll_pid_{Gains{0.0030f, 0.0007f, 0.000010f, 0.18f, 0.38f, 55.0f}};',
              'PID roll_pid_{Gains{0.0088f, 0.0007f, 0.000022f, 0.18f, 0.38f, 55.0f}};', 1)
s = s.replace('PID pitch_pid_{Gains{0.0030f, 0.0007f, 0.000010f, 0.18f, 0.38f, 55.0f}};',
              'PID pitch_pid_{Gains{0.0088f, 0.0007f, 0.000022f, 0.18f, 0.38f, 55.0f}};', 1)
assert 'PID roll_pid_{Gains{0.0088f, 0.0007f, 0.000022f' in s
assert 'PID pitch_pid_{Gains{0.0088f, 0.0007f, 0.000022f' in s
core.write_text(s)

outer = Path('esp32/Arondight45_StateControl.hpp')
o = outer.read_text()
old_d = 'static constexpr float kHorizontalAccelerationDamping = 0.75f;'
assert o.count(old_d) == 1, o.count(old_d)
o = o.replace(old_d, 'static constexpr float kHorizontalAccelerationDamping = 0.0f;', 1)
outer.write_text(o)
