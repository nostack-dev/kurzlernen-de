from pathlib import Path

def replace_once(path, old, new):
    p=Path(path); text=p.read_text(); count=text.count(old)
    if count!=1: raise SystemExit(f'{path}: expected one target, found {count}: {old[:120]!r}')
    p.write_text(text.replace(old,new,1))

replace_once('esp32/Arondight45_StateControl.hpp',
'''    static constexpr float kMinSpecificUpMps2 = 0.5f;''',
'''    // Keep enough collective thrust during aggressive descent for the inner
    // attitude loop to retain real motor/torque authority. 0.5 m/s² was nearly
    // free-fall and allowed the physical airframe to tumble well beyond the
    // bounded attitude target. 4.0 m/s² is the previously validated reserve.
    static constexpr float kMinSpecificUpMps2 = 4.0f;''')

replace_once('tests/state_control_test.cpp',
'''    CHECK(descent_horizontal_accel < 0.235f);\n    CHECK(descent_auto_pitch_deg <= 25.05f);\n    CHECK(descent_auto_roll_deg <= 25.05f);''',
'''    // At the restored 4 m/s² collective reserve, tan(25°) permits at most
    // ~1.865 m/s² automatic horizontal correction while preserving attitude torque.
    CHECK(descent_horizontal_accel < 1.87f);\n    CHECK(cmd.throttle > 0.10f);\n    CHECK(descent_auto_pitch_deg <= 25.05f);\n    CHECK(descent_auto_roll_deg <= 25.05f);''')

for path in ['.github/restore-descent-thrust-reserve.py','.github/restore-descent-thrust-reserve-trigger']:
    p=Path(path)
    if p.exists(): p.unlink()
print('descent thrust reserve restored')
