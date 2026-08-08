from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if new in text:
        return
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one source pattern, found {count}")
    p.write_text(text.replace(old, new, 1))


# The FC owns arming state. If it drops from ARMED for any reason (stale control,
# sensor fault, kill, etc.), a controller-side arm request must not remain latched
# high. Clear it and immediately publish ARM low so any stale-arm latch is released
# only by an explicit new user click.
replace_once(
    "sim/controller.mjs",
    '''peer.onTelemetry=message=>{\n  lastTelemetry=message;''',
    '''peer.onTelemetry=message=>{\n  const previousFcState=lastTelemetry.fc_state;\n  lastTelemetry=message;\n  if(previousFcState==="ARMED"&&message.fc_state!=="ARMED"&&controls.arm){\n    controls.arm=false;\n    publish();\n  }''',
)

# ARM-low is a safety interlock, not a post-calibration timing trick. Runtime used
# to return from the calibration branch before ArmState saw RC at all. A controller
# that raised ARM immediately after the first DISARMED telemetry could therefore
# leave saw_low_ false forever. Observe the real low/high input during calibration;
# a high request still cannot arm because imu_ok is deliberately false here.
replace_once(
    "esp32/Arondight45_DroneFC_Core.hpp",
    '''        if (!calibrated_) {\n            calibrate(input.raw);\n            return finalize(out, input.rc_fresh, true);\n        }''',
    '''        if (!calibrated_) {\n            calibrate(input.raw);\n            RC calibration_rc = input.rc;\n            calibration_rc.valid = calibration_rc.valid && input.rc_fresh;\n            const Command calibration_cmd = command(calibration_rc);\n            (void)arm_.run(input.now_us, calibration_rc.valid, calibration_cmd, false, 0.0f, 0.0f);\n            return finalize(out, input.rc_fresh, true);\n        }''',
)

# Regression: low throughout calibration must satisfy the low-seen interlock so an
# immediate post-calibration high request can complete the normal one-second hold.
test = Path("tests/drone_fc_core_test.cpp")
source = test.read_text()
anchor = '''    fc::Runtime runtime;\n    uint64_t now_us = 0;\n    calibrate(runtime, now_us);\n    arm_runtime(runtime, now_us);\n'''
addition = '''    fc::Runtime calibration_low_runtime;\n    uint64_t calibration_low_us = 0;\n    for (uint32_t i = 0; i < fc::kCalibrationSamples; ++i) {\n        auto low = stationary_input(calibration_low_us += 1000);\n        low.rc.ch[4] = 172;\n        CHECK(!calibration_low_runtime.step(low).armed);\n    }\n    fc::RuntimeOutput immediate_arm{};\n    for (int i = 0; i < 1002; ++i) {\n        auto high = stationary_input(calibration_low_us += 1000);\n        high.rc.ch[4] = 1811;\n        immediate_arm = calibration_low_runtime.step(high);\n    }\n    CHECK(immediate_arm.armed);\n\n'''
if addition not in source:
    if anchor not in source:
        raise RuntimeError("core arming-test anchor missing")
    test.write_text(source.replace(anchor, addition + anchor, 1))

architecture = Path("tests/architecture_invariants.mjs")
arch = architecture.read_text()
needle = '''requireText("sim/controller.mjs","yawRate:stateShape(quantizedCentered(controls.yaw),.045,.20)*140",\n            "controller state-vector debug must report the same GAME yaw authority as the flight controller");\n'''
addition = '''requireText("sim/controller.mjs",'previousFcState==="ARMED"&&message.fc_state!=="ARMED"&&controls.arm',\n            "FC-authoritative disarm must clear any controller-side ARM request before re-arm");\nrequireText("esp32/Arondight45_DroneFC_Core.hpp","const Command calibration_cmd = command(calibration_rc)",\n            "ARM-low safety interlock must observe receiver state during calibration");\n'''
if addition not in arch:
    if needle not in arch:
        raise RuntimeError("architecture controller-yaw anchor missing")
    arch = arch.replace(needle, needle + addition, 1)
architecture.write_text(arch)

controller = Path("sim/controller.mjs").read_text()
assert 'previousFcState==="ARMED"&&message.fc_state!=="ARMED"&&controls.arm' in controller
assert 'controls.arm=false;\n    publish();' in controller
core = Path("esp32/Arondight45_DroneFC_Core.hpp").read_text()
assert "const Command calibration_cmd = command(calibration_rc);" in core
assert "arm_.run(input.now_us, calibration_rc.valid, calibration_cmd, false" in core
