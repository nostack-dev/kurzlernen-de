import os
import re
from pathlib import Path

# This validator is intentionally idempotent. Production may already contain the
# measured-state PD outer loop; the matrix only varies its damping while optionally
# applying the still-experimental exact ZYX Euler-rate -> body-rate command mapping.

damping = os.environ["DAMPING"]

core = Path("esp32/Arondight45_DroneFC_Core.hpp")
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

if old in s:
    s = s.replace(old, new, 1)
elif new not in s:
    raise AssertionError("controller command block is neither baseline nor exact-kinematics form")
core.write_text(s)

state = Path("esp32/Arondight45_StateControl.hpp")
s = state.read_text()
required_markers = (
    "update_acceleration_estimator(nav.velocity_world_mps, dt);",
    "measured_acceleration_world_mps2_",
    "kMeasuredAccelerationFilterTauS",
)
for marker in required_markers:
    if marker not in s:
        raise AssertionError(f"measured-state PD controller marker missing: {marker}")

pattern = r"static constexpr float kHorizontalAccelerationDamping = [0-9.]+f;"
s, count = re.subn(
    pattern,
    f"static constexpr float kHorizontalAccelerationDamping = {damping};",
    s,
    count=1,
)
if count != 1:
    raise AssertionError(("horizontal damping constant", count))
state.write_text(s)
