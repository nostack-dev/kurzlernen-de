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

architecture = Path("tests/architecture_invariants.mjs")
arch = architecture.read_text()
needle = '''requireText("sim/controller.mjs","yawRate:stateShape(quantizedCentered(controls.yaw),.045,.20)*140",\n            "controller state-vector debug must report the same GAME yaw authority as the flight controller");\n'''
addition = '''requireText("sim/controller.mjs",'previousFcState==="ARMED"&&message.fc_state!=="ARMED"&&controls.arm',\n            "FC-authoritative disarm must clear any controller-side ARM request before re-arm");\n'''
if addition not in arch:
    if needle not in arch:
        raise RuntimeError("architecture controller-yaw anchor missing")
    arch = arch.replace(needle, needle + addition, 1)
architecture.write_text(arch)

controller = Path("sim/controller.mjs").read_text()
assert 'previousFcState==="ARMED"&&message.fc_state!=="ARMED"&&controls.arm' in controller
assert 'controls.arm=false;\n    publish();' in controller
