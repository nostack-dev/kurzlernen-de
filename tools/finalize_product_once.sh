#!/usr/bin/env bash
set -euxo pipefail
python3 - <<'PY'
from pathlib import Path
src=Path('tools/finalize_product_core.sh').read_text()
# 1) Horizontal release fix leaves this old local dead; remove it from the patch script.
old="""new='''        const float target_horizontal_speed = std::sqrt(commanded_forward_mps_ * commanded_forward_mps_ +
                                                        commanded_right_mps_ * commanded_right_mps_);
        const float pilot_horizontal_speed = std::sqrt(intent.forward_mps * intent.forward_mps +"""
new="""new='''        const float pilot_horizontal_speed = std::sqrt(intent.forward_mps * intent.forward_mps +"""
if src.count(old)!=1:
    raise SystemExit(f'expected one dead release-target declaration, got {src.count(old)}')
src=src.replace(old,new,1)

# 2) Do NOT jerk-limit vertical authority. The user-visible bug is the horizontal
# release kick; climb/descent must retain the exact direct 30 m/s / 50 m/s^2 path.
marker='# Source/architecture gates.'
if src.count(marker)!=1:
    raise SystemExit('source gate marker missing')
vertical_restore=r'''python3 - <<'PY2'
from pathlib import Path
p=Path('esp32/Arondight45_StateControl.hpp'); s=p.read_text()
old='''        const float requested_vertical_accel = clamp(kVerticalVelocityGain * vz_error,
                                                     -kMaxVerticalAccelerationMps2,
                                                     kMaxVerticalAccelerationMps2);
        const float vertical_accel = limit_vertical_accel_jerk(requested_vertical_accel, dt);'''
new='''        const float vertical_accel = clamp(kVerticalVelocityGain * vz_error,
                                           -kMaxVerticalAccelerationMps2,
                                           kMaxVerticalAccelerationMps2);'''
if s.count(old)!=1: raise SystemExit(f'vertical accel patch mismatch: {s.count(old)}')
s=s.replace(old,new,1)
s=s.replace('    static constexpr float kVerticalJerkLimitMps3 = 1200.0f;\n','')
s=s.replace('        vertical_accel_initialized_ = false;\n        vertical_accel_state_mps2_ = 0.0f;\n','')
fn='''    float limit_vertical_accel_jerk(float requested, float dt) {
        if (!vertical_accel_initialized_) {
            vertical_accel_state_mps2_ = requested;
            vertical_accel_initialized_ = true;
            return vertical_accel_state_mps2_;
        }
        const float max_step = kVerticalJerkLimitMps3 * dt;
        vertical_accel_state_mps2_ += clamp(requested - vertical_accel_state_mps2_, -max_step, max_step);
        return vertical_accel_state_mps2_;
    }

'''
if s.count(fn)!=1: raise SystemExit(f'vertical jerk function mismatch: {s.count(fn)}')
s=s.replace(fn,'',1)
s=s.replace('    bool vertical_accel_initialized_{};\n','')
s=s.replace('    float vertical_accel_state_mps2_{};\n','')
p.write_text(s)

p=Path('tests/architecture_invariants.mjs'); a=p.read_text();a=a.replace('requireText("esp32/Arondight45_StateControl.hpp","kVerticalJerkLimitMps3 = 1200.0f");\n','');p.write_text(a)

p=Path('tests/state_control_test.cpp'); t=p.read_text()
start=t.find('    // Once airborne, an AGL-target reversal may use the full 50 m/s^2 envelope,')
end_marker='    controller.reset();\n    nav = {{0.0f, 0.0f, 0.0f}, 2.0f, true};'
if start<0: raise SystemExit('vertical jerk regression block start missing')
end=t.find(end_marker,start)
if end<0: raise SystemExit('vertical jerk regression block end missing')
t=t[:start]+t[end:]
p.write_text(t)
PY2

'''
src=src.replace(marker,vertical_restore+marker,1)
Path('/tmp/finalize_product_core.sh').write_text(src)
PY
rm -f tools/finalize_product_once.sh tools/finalize_product_core.sh
exec bash /tmp/finalize_product_core.sh
