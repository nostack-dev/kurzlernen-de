from pathlib import Path

def replace_once(path, old, new):
    p=Path(path); text=p.read_text(); count=text.count(old)
    if count!=1: raise SystemExit(f'{path}: expected one target, found {count}: {old[:120]!r}')
    p.write_text(text.replace(old,new,1))

replace_once('esp32/Arondight45_StateControl.hpp',
'''        const float target_vz = agl_valid\n            ? clamp(kAglToVerticalSpeed * agl_error, -kMaxVerticalSpeedMps, kMaxVerticalSpeedMps)\n            : 0.0f;''',
'''        // Climb and descent need asymmetric envelopes. High upward authority is\n        // useful for takeoff/recovery, while allowing the same 30 m/s target on\n        // descent builds downward momentum that cannot be removed before a low\n        // AGL target. Keep the historically validated 2 m/s descent envelope and\n        // retain the modern high climb ceiling.\n        const float target_vz = agl_valid\n            ? clamp(kAglToVerticalSpeed * agl_error, -kMaxVerticalDescentSpeedMps, kMaxVerticalSpeedMps)\n            : 0.0f;''')

replace_once('esp32/Arondight45_StateControl.hpp',
'''        const float requested_vertical_accel = clamp(vertical_velocity_gain * vz_error,\n                                                     -kMaxVerticalAccelerationMps2,\n                                                     kMaxVerticalAccelerationMps2);''',
'''        // Downward acceleration is separately bounded so the aircraft never\n        // trades away the motor/attitude reserve merely to chase a falling AGL\n        // target. Positive braking/recovery acceleration keeps the full ceiling.\n        const float requested_vertical_accel = clamp(vertical_velocity_gain * vz_error,\n                                                     -kMaxVerticalDescentAccelerationMps2,\n                                                     kMaxVerticalAccelerationMps2);''')

replace_once('esp32/Arondight45_StateControl.hpp',
'''    static constexpr float kMaxVerticalSpeedMps = 30.0f;\n    static constexpr float kVerticalVelocityGain = 4.0f;\n    static constexpr float kVerticalDescentVelocityGain = 8.0f;\n    static constexpr float kMaxVerticalAccelerationMps2 = 50.0f;''',
'''    static constexpr float kMaxVerticalSpeedMps = 30.0f;\n    static constexpr float kMaxVerticalDescentSpeedMps = 2.0f;\n    static constexpr float kVerticalVelocityGain = 4.0f;\n    static constexpr float kVerticalDescentVelocityGain = 8.0f;\n    static constexpr float kMaxVerticalAccelerationMps2 = 50.0f;\n    static constexpr float kMaxVerticalDescentAccelerationMps2 = 4.0f;''')

replace_once('tests/state_control_test.cpp',
'''    CHECK(controller.debug().vertical_accel_mps2 < -49.9f);\n    // At the restored 4 m/s² collective reserve, tan(25°) permits at most\n    // ~1.865 m/s² automatic horizontal correction while preserving attitude torque.\n    CHECK(descent_horizontal_accel < 1.87f);''',
'''    CHECK(controller.debug().target_vz_mps < -1.99f && controller.debug().target_vz_mps > -2.01f);\n    CHECK(controller.debug().vertical_accel_mps2 < -3.99f && controller.debug().vertical_accel_mps2 > -4.01f);\n    // With descent acceleration bounded to 4 m/s², the vertical specific-force\n    // component stays around 5.8 m/s² before any extra safety floor. The 25°\n    // translation envelope therefore permits at most ~2.71 m/s² automatically.\n    CHECK(descent_horizontal_accel < 2.71f);''')

for path in ['.github/stabilize-vertical-descent.py','.github/stabilize-vertical-descent-trigger']:
    p=Path(path)
    if p.exists(): p.unlink()
print('vertical descent envelope stabilized')
