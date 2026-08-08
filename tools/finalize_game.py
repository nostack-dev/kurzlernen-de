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


def replace_one_of(path: str, olds: tuple[str, ...], new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if new in text:
        return
    matches = [(old, text.count(old)) for old in olds if text.count(old)]
    if len(matches) != 1 or matches[0][1] != 1:
        raise RuntimeError(f"{path}: expected exactly one source variant, got {matches}")
    p.write_text(text.replace(matches[0][0], new, 1))


# Measured minimum: 100 deg/s produced 3.1 deg in the unchanged 220 ms gate;
# 140 deg/s produced 4.4 deg. Keep translation law, inner PID and gate untouched.
replace_one_of(
    "esp32/Arondight45_StateControl.hpp",
    (
        "constexpr float kStateMaxYawRateDps = 100.0f;",
        "constexpr float kStateMaxYawRateDps = 180.0f;",
    ),
    "constexpr float kStateMaxYawRateDps = 140.0f;",
)

replace_one_of(
    "sim/controller.mjs",
    (
        "yawRate:stateShape(quantizedCentered(controls.yaw),.045,.20)*100",
        "yawRate:stateShape(quantizedCentered(controls.yaw),.045,.20)*180",
    ),
    "yawRate:stateShape(quantizedCentered(controls.yaw),.045,.20)*140",
)

replace_one_of(
    "tests/state_control_test.cpp",
    (
        "CHECK(controller.debug().target_yaw_deg > 90.0f);",
        "CHECK(controller.debug().target_yaw_deg > 170.0f);",
    ),
    "CHECK(controller.debug().target_yaw_deg > 135.0f && controller.debug().target_yaw_deg < 145.0f);",
)

replace_once(
    "sim/simulator.mjs",
    'function exportSession(){downloadJson(`arondight45-${mode}-${new Date().toISOString().replace(/[:.]/g,"-")}.json`,{schema:"arondight45-flight-log-v1",mode,samples:sessionLog,physics:defaultParams()});}',
    '''function exportSession(){
  if((latest.state&STATE_ARMED)&&inputSource==="remote"){
    setStatus("Disarm before exporting a full flight log during P2P control.","warn");
    return;
  }
  downloadJson(`arondight45-${mode}-${new Date().toISOString().replace(/[:.]/g,"-")}.json`,{schema:"arondight45-flight-log-v1",mode,samples:sessionLog,physics:defaultParams()});
}''',
)

replace_once(
    "tests/dual_phone_smoke.mjs",
    'const args=["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader","--use-fake-ui-for-media-stream","--use-fake-device-for-media-stream"];',
    'const args=["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader","--use-fake-ui-for-media-stream","--use-fake-device-for-media-stream","--disable-background-timer-throttling","--disable-backgrounding-occluded-windows","--disable-renderer-backgrounding","--disable-features=CalculateNativeWinOcclusion"];',
)

replace_once(
    "tests/dual_phone_smoke.mjs",
    '''  // Stale-arm latch requires an explicit low before a new ARM request.
  await controller.click("#kill");
  const rearmStart=await simTime(view);await clickWhenEnabled(controller,"#arm","ARM",15000);
  await view.waitForFunction(()=>document.querySelector("#fcState")?.textContent==="ARMED",{timeout:65000});
  const rearmDuration=(await simTime(view))-rearmStart;
  if(rearmDuration>1.5)throw new Error(`same-session GAME re-arm too slow: ${rearmDuration.toFixed(3)}s`);
  console.log("Serverless P2P E2E: transient stale-control fail-safe recovered on the same session with explicit re-arm and zero re-pairing.");
''',
    '''  // A real 350 ms stale-control event removes thrust. From a 2 m hover the
  // airframe can hit the ground before the sender recovers, so an in-place re-arm
  // would be physically unsafe and can correctly be blocked by invalid AGL/tilt.
  // Prove the intended recovery contract instead: explicit ARM low, safe upright
  // simulator reset, then re-arm over the exact same P2P session with no re-pair.
  await controller.click("#kill");
  await view.waitForFunction(()=>document.querySelector("#armSwitch")?.textContent==="OFF",{timeout:10000});
  await view.click("#reset");
  await waitSim(view,2.2,60000);
  await view.waitForFunction(()=>document.querySelector("#fcState")?.textContent==="DISARMED",{timeout:30000});
  await waitText(view,"#remoteStatus","P2P LINKED",10000);
  await waitText(controller,"#connection","P2P LINKED",10000);
  // Synchronize on post-reset controller telemetry, not stale pre-reset DOM text.
  // updateArm() is driven by peer.onTelemetry, so this proves the controller has
  // received the new safe FC state before testing whether ARM becomes available.
  await waitText(controller,"#fcState","DISARMED",15000);
  await controller.waitForFunction(()=>document.querySelector("#gameSensorStatus")?.textContent?.includes("AGL"),{timeout:15000});
  const rearmStart=await simTime(view);await clickWhenEnabled(controller,"#arm","ARM",15000);
  await view.waitForFunction(()=>document.querySelector("#fcState")?.textContent==="ARMED",{timeout:65000});
  const rearmDuration=(await simTime(view))-rearmStart;
  if(rearmDuration>1.5)throw new Error(`same-session GAME re-arm too slow after safe reset: ${rearmDuration.toFixed(3)}s`);
  console.log("Serverless P2P E2E: stale-control fail-safe recovered after safe reset on the same session with zero re-pairing.");
''',
)

# Lock the measured yaw authority and recovery semantics into the permanent
# architecture checks, without weakening the physical E2E threshold.
architecture = Path("tests/architecture_invariants.mjs")
arch = architecture.read_text()
anchor = '''requireText("tests/dual_phone_smoke.mjs","rcx+rr*.65",\n            "yaw E2E stimulus must make the unchanged four-degree physical rotation gate reachable after phone/C++ shaping");\n'''
if 'requireText("esp32/Arondight45_StateControl.hpp","kStateMaxYawRateDps = 140.0f"' not in arch:
    if anchor not in arch:
        raise RuntimeError("architecture yaw anchor missing")
    arch = arch.replace(
        anchor,
        anchor + '''requireText("esp32/Arondight45_StateControl.hpp","kStateMaxYawRateDps = 140.0f",\n            "GAME yaw authority must remain at the measured minimum that clears the strict physical gate");\nrequireText("sim/controller.mjs","yawRate:stateShape(quantizedCentered(controls.yaw),.045,.20)*140",\n            "controller state-vector debug must report the same GAME yaw authority as the flight controller");\nrequireText("tests/dual_phone_smoke.mjs",'await view.click("#reset")',\n            "stale-control recovery must prove same-session re-arm only after restoring a safe upright simulator state");\nrequireText("tests/dual_phone_smoke.mjs",'waitText(controller,"#fcState","DISARMED",15000)',\n            "same-session recovery must wait for fresh post-reset controller telemetry before re-arm");\n''',
        1,
    )
architecture.write_text(arch)

# Hard invariants for the exact candidate already proven in physical browser runs.
state = Path("esp32/Arondight45_StateControl.hpp").read_text()
assert "kHorizontalVelocityGain = 0.80f" in state
assert "kHorizontalAccelerationDamping = 0.55f" in state
assert "const float measured_right = s * nav.velocity_world_mps.x - c * nav.velocity_world_mps.y;" in state
core = Path("esp32/Arondight45_DroneFC_Core.hpp").read_text()
assert "2.0f * kPi * 0.02f" in core
p2p = Path("sim/p2p_link.mjs").read_text()
assert "CONTROL_STALE_MS = 350" in p2p

test = Path("tests/dual_phone_smoke.mjs").read_text()
assert 'await controller.mouse.move(rcx+rr*.65,rcy,{steps:4});' in test
assert 'const turnStart=await simTime(view);await waitSim(view,turnStart+.22,25000);await controller.mouse.up();' in test
assert 'if(Math.abs(yawDelta)<4)' in test
assert '--disable-background-timer-throttling' in test
assert 'waitText(controller,"#fcState","DISARMED",15000)' in test
armed = test[test.index('const left=await stickBox(controller,"#leftStick")'):test.index('const stall=controller.evaluate')]
assert "flightSamples(view)" not in armed
assert "latestFlightSample(view)" not in armed
assert 'await view.click("#reset")' in test
