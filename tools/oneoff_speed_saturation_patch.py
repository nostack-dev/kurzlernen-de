from pathlib import Path


def replace_one(path, old, new):
    p = Path(path)
    s = p.read_text()
    n = s.count(old)
    if n != 1:
        raise SystemExit(f"{path}: expected one match, got {n}: {old!r}")
    p.write_text(s.replace(old, new))


core = "esp32/Arondight45_DroneFC_Core.hpp"
replace_one(
    core,
    """inline Command command(const RC& r) {
    return {shape(centered(r.ch[FC_SBUS_ROLL]), 0.035f, 0.3f),
            -shape(centered(r.ch[FC_SBUS_PITCH]), 0.035f, 0.3f),""",
    """constexpr float kManualMaxAttitudeDeg = 32.0f;
constexpr float kInnerMaxAttitudeDeg = 40.0f;
constexpr float kManualAttitudeCommandScale = kManualMaxAttitudeDeg / kInnerMaxAttitudeDeg;

inline Command command(const RC& r) {
    return {shape(centered(r.ch[FC_SBUS_ROLL]), 0.035f, 0.3f) * kManualAttitudeCommandScale,
            -shape(centered(r.ch[FC_SBUS_PITCH]), 0.035f, 0.3f) * kManualAttitudeCommandScale,""",
)
replace_one(
    core,
    """const float roll_rate = clamp((cmd.roll * 32.0f - attitude.roll) * kAngleToRate, -240.0f, 240.0f);
        const float pitch_rate = clamp((cmd.pitch * 32.0f - attitude.pitch) * kAngleToRate, -240.0f, 240.0f);""",
    """const float roll_rate = clamp((cmd.roll * kInnerMaxAttitudeDeg - attitude.roll) * kAngleToRate, -240.0f, 240.0f);
        const float pitch_rate = clamp((cmd.pitch * kInnerMaxAttitudeDeg - attitude.pitch) * kAngleToRate, -240.0f, 240.0f);""",
)

state = "esp32/Arondight45_StateControl.hpp"
replace_one(state, "still under the same 6.0 m/s²\n        // and 32° physical envelopes.", "still under the same 7.5 m/s²\n        // and 40° physical envelopes.")
replace_one(state, "static constexpr float kInnerAttitudeRangeDeg = 32.0f;", "static constexpr float kInnerAttitudeRangeDeg = kInnerMaxAttitudeDeg;")
replace_one(state, "static constexpr float kMaxTiltDeg = 32.0f;", "static constexpr float kMaxTiltDeg = 40.0f;")
replace_one(state, "static constexpr float kMaxTiltTangent = 0.62486935f;", "static constexpr float kMaxTiltTangent = 0.83909963f;")
replace_one(state, "static constexpr float kHorizontalIntegralLimitMps2 = 4.0f;", "static constexpr float kHorizontalIntegralLimitMps2 = 7.0f;")
replace_one(state, "static constexpr float kMaxHorizontalAccelerationMps2 = 6.0f;", "static constexpr float kMaxHorizontalAccelerationMps2 = 7.5f;")

state_test = "tests/state_control_test.cpp"
p = Path(state_test)
s = p.read_text()
for old, new in {
    "CHECK(controller.debug().forward_accel_mps2 > 5.9f);": "CHECK(controller.debug().forward_accel_mps2 > 7.4f);",
    "// Nominal hover plus the full 6.0 m/s^2 horizontal request must still leave": "// Nominal hover plus the full 7.5 m/s^2 horizontal request must still leave",
    "CHECK(cmd.pitch > 0.77f);": "CHECK(cmd.pitch > 0.60f);\n    CHECK(cmd.pitch * fc::kInnerMaxAttitudeDeg > 24.9f);",
    "CHECK(cmd.pitch < -0.77f);": "CHECK(cmd.pitch < -0.60f);\n    CHECK(cmd.pitch * fc::kInnerMaxAttitudeDeg < -24.9f);",
    "CHECK(accel_norm > 5.9f && accel_norm < 6.1f);": "CHECK(accel_norm > 7.4f && accel_norm < 7.6f);",
    "CHECK(controller.debug().right_accel_mps2 > 5.9f);": "CHECK(controller.debug().right_accel_mps2 > 7.4f);",
}.items():
    n = s.count(old)
    if n != 1:
        raise SystemExit(f"{state_test}: expected one match, got {n}: {old!r}")
    s = s.replace(old, new)
p.write_text(s)

core_test = "tests/drone_fc_core_test.cpp"
replace_one(
    core_test,
    "fc::Command{0.0f, 25.0f / 32.0f, 0.50f, 0.0f, false}, 0.001f, false);",
    "fc::Command{0.0f, 25.0f / fc::kInnerMaxAttitudeDeg, 0.50f, 0.0f, false}, 0.001f, false);",
)
p = Path(core_test)
s = p.read_text()
anchor = """    CHECK(fc::pulse(1.0f, true) == fc::kEscMaxUs);

    // A 25-degree physical pitch request"""
addition = """    CHECK(fc::pulse(1.0f, true) == fc::kEscMaxUs);

    // Expanding the inner physical attitude range for GAME must not make MANUAL
    // full-stick more aggressive. MANUAL remains exactly the established 32°.
    fc::RC full_manual{};
    full_manual.ch.fill(992);
    full_manual.ch[FC_SBUS_ROLL] = 1811;
    full_manual.ch[FC_SBUS_PITCH] = 1811;
    const fc::Command manual_command = fc::command(full_manual);
    CHECK(std::fabs(manual_command.roll * fc::kInnerMaxAttitudeDeg - fc::kManualMaxAttitudeDeg) < 0.05f);
    CHECK(std::fabs(manual_command.pitch * fc::kInnerMaxAttitudeDeg + fc::kManualMaxAttitudeDeg) < 0.05f);

    // A 25-degree physical pitch request"""
if s.count(anchor) != 1:
    raise SystemExit("core test insert anchor mismatch")
p.write_text(s.replace(anchor, addition))

arch = "tests/architecture_invariants.mjs"
p = Path(arch)
s = p.read_text()
for old, new in {
    'requireText("esp32/Arondight45_StateControl.hpp","kInnerAttitudeRangeDeg = 32.0f");': 'requireText("esp32/Arondight45_DroneFC_Core.hpp","kManualMaxAttitudeDeg = 32.0f");\nrequireText("esp32/Arondight45_DroneFC_Core.hpp","kInnerMaxAttitudeDeg = 40.0f");\nrequireText("esp32/Arondight45_DroneFC_Core.hpp","kManualAttitudeCommandScale = kManualMaxAttitudeDeg / kInnerMaxAttitudeDeg");\nrequireText("esp32/Arondight45_StateControl.hpp","kInnerAttitudeRangeDeg = kInnerMaxAttitudeDeg");',
    'requireText("esp32/Arondight45_StateControl.hpp","kMaxTiltDeg = 32.0f");': 'requireText("esp32/Arondight45_StateControl.hpp","kMaxTiltDeg = 40.0f");',
    'requireText("esp32/Arondight45_StateControl.hpp","kMaxHorizontalAccelerationMps2 = 6.0f");': 'requireText("esp32/Arondight45_StateControl.hpp","kMaxHorizontalAccelerationMps2 = 7.5f");\nrequireText("esp32/Arondight45_StateControl.hpp","kHorizontalIntegralLimitMps2 = 7.0f");',
    'forbidText("esp32/Arondight45_StateControl.hpp","kMaxTiltDeg = 30.0f", "GAME must retain the full physically representable 32-degree inner-loop attitude authority");': 'forbidText("esp32/Arondight45_DroneFC_Core.hpp","cmd.roll * 32.0f", "inner attitude range must not silently cap GAME at the MANUAL 32-degree envelope");',
}.items():
    n = s.count(old)
    if n != 1:
        raise SystemExit(f"{arch}: expected one match, got {n}: {old!r}")
    s = s.replace(old, new)
p.write_text(s)

speed_test = "tests/game_speed_envelope_smoke.mjs"
p = Path(speed_test)
s = p.read_text()
old = """  const result={name:direction.name,average,orthogonal,vertical,t90:Number.isFinite(t90)?t90:null};
  if(!(average>=minSteadyMps&&average<=maxSteadyMps))"""
new = """  const result={name:direction.name,average,orthogonal,vertical,t90:Number.isFinite(t90)?t90:null};
  console.log(`GAME speed sample ${label} ${direction.name}: ${(average*3.6).toFixed(2)} km/h · cross ${orthogonal.toFixed(3)} m/s · |vz| ${vertical.toFixed(3)} m/s · t90 ${result.t90}`);
  if(!(average>=minSteadyMps&&average<=maxSteadyMps))"""
if s.count(old) != 1:
    raise SystemExit("speed diagnostic anchor mismatch")
p.write_text(s.replace(old, new))
