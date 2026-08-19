from pathlib import Path

def replace_once(path, old, new):
    p=Path(path); text=p.read_text(); count=text.count(old)
    if count!=1: raise SystemExit(f'{path}: expected one target, found {count}: {old[:100]!r}')
    p.write_text(text.replace(old,new,1))

replace_once('esp32/Arondight45_StateControl.hpp',
'''        const float allowed_horizontal_accel = std::min(kStableHorizontalAccelerationMps2,\n                                                        specific_up * kMaxTiltTangent);''',
'''        // Automatic translation gets the previously validated 25 deg attitude\n        // envelope even while vertical specific force is intentionally reduced for\n        // descent. Scaling horizontal acceleration by the *available* up component\n        // keeps atan2(horizontal, specific_up) bounded instead of turning a tiny\n        // drift correction into a 35-40 deg bank during a pure altitude command.\n        // The separate 40 deg hard attitude ceiling remains available for combined\n        // pilot body-pitch + translation authority.\n        const float allowed_horizontal_accel = std::min(kStableHorizontalAccelerationMps2,\n                                                        specific_up * kMaxAutoTranslationTiltTangent);''')

replace_once('esp32/Arondight45_StateControl.hpp',
'''    static constexpr float kMaxTiltDeg = 40.0f;\n    static constexpr float kMaxTiltTangent = 0.83909963f;\n    static constexpr float kMaxAttitudeCommand = kMaxTiltDeg / kInnerAttitudeRangeDeg;''',
'''    static constexpr float kMaxTiltDeg = 40.0f;\n    static constexpr float kMaxAutoTranslationTiltDeg = 25.0f;\n    static constexpr float kMaxAutoTranslationTiltTangent = 0.46630766f;\n    static constexpr float kMaxAttitudeCommand = kMaxTiltDeg / kInnerAttitudeRangeDeg;''')

# The named angle constant is used by the regression contract as documentation and
# compile-time intent. Tie the tangent to it with a static assertion tolerance.
replace_once('esp32/Arondight45_StateControl.hpp',
'''    static constexpr float kDegradedMaxTiltDeg = 12.0f;''',
'''    static_assert(kMaxAutoTranslationTiltDeg == 25.0f, "automatic GAME translation tilt envelope must stay at the validated 25 deg");\n    static constexpr float kDegradedMaxTiltDeg = 12.0f;''')

anchor='''    controller.reset();\n    rc = base_rc(true);\n    nav = {{0.0f, 0.0f, 0.0f}, 0.05f, true};\n    cmd = controller.run(rc, nav, 0.0f, true, 0.001f);\n    const float bootstrap_throttle = cmd.throttle;'''
regression='''    // Regression: a pure aggressive descent used to reduce specific_up to 0.5\n    // m/s^2 while leaving the auto-translation limiter at tan(40 deg). Even a\n    // modest 1 m/s horizontal drift then requested ~40 deg attitude. Automatic\n    // drift correction must stay inside the validated 25 deg translation envelope\n    // regardless of vertical specific-force demand.\n    controller.reset();\n    rc = base_rc(true);\n    nav = {{-1.0f, 0.0f, 0.0f}, 8.0f, true};\n    cmd = controller.run(rc, nav, 0.0f, true, 0.001f);\n    const float descent_auto_pitch_deg = std::fabs(cmd.pitch * fc::kInnerMaxAttitudeDeg);\n    const float descent_auto_roll_deg = std::fabs(cmd.roll * fc::kInnerMaxAttitudeDeg);\n    const float descent_horizontal_accel = std::hypot(controller.debug().forward_accel_mps2,\n                                                       controller.debug().right_accel_mps2);\n    CHECK(controller.debug().vertical_accel_mps2 < -49.9f);\n    CHECK(descent_horizontal_accel < 0.235f);\n    CHECK(descent_auto_pitch_deg <= 25.05f);\n    CHECK(descent_auto_roll_deg <= 25.05f);\n\n    controller.reset();\n    rc = base_rc(true);\n    nav = {{0.0f, 0.0f, 0.0f}, 0.05f, true};\n    cmd = controller.run(rc, nav, 0.0f, true, 0.001f);\n    const float bootstrap_throttle = cmd.throttle;'''
replace_once('tests/state_control_test.cpp',anchor,regression)

for path in ['.github/fix-descent-auto-tilt.py','.github/fix-descent-auto-tilt-trigger']:
    p=Path(path)
    if p.exists(): p.unlink()
print('descent auto-tilt fix applied')
