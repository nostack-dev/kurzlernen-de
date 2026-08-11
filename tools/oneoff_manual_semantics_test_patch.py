from pathlib import Path

p = Path("tests/drone_fc_core_test.cpp")
s = p.read_text()
old = """    const fc::Command manual_command = fc::command(full_manual);
    CHECK(std::fabs(manual_command.roll * fc::kInnerMaxAttitudeDeg - fc::kManualMaxAttitudeDeg) < 0.05f);
    CHECK(std::fabs(manual_command.pitch * fc::kInnerMaxAttitudeDeg + fc::kManualMaxAttitudeDeg) < 0.05f);
"""
new = """    const fc::Command manual_command = fc::command(full_manual);
    const float old_manual_roll_deg =
        fc::shape(fc::centered(full_manual.ch[FC_SBUS_ROLL]), 0.035f, 0.3f) * fc::kManualMaxAttitudeDeg;
    const float old_manual_pitch_deg =
        -fc::shape(fc::centered(full_manual.ch[FC_SBUS_PITCH]), 0.035f, 0.3f) * fc::kManualMaxAttitudeDeg;
    CHECK(std::fabs(manual_command.roll * fc::kInnerMaxAttitudeDeg - old_manual_roll_deg) < 0.001f);
    CHECK(std::fabs(manual_command.pitch * fc::kInnerMaxAttitudeDeg - old_manual_pitch_deg) < 0.001f);
"""
if s.count(old) != 1:
    raise SystemExit(f"expected one MANUAL test block, got {s.count(old)}")
p.write_text(s.replace(old, new))
