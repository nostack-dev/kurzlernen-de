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


# Expose only the monotonic accepted telemetry sequence as a DOM dataset marker.
# This lets the browser E2E prove it is observing telemetry generated after reset,
# rather than matching a visually identical DISARMED/AGL state from before reset.
replace_once(
    "sim/controller.mjs",
    '''peer.onTelemetry=message=>{
  lastTelemetry=message;
  ui.fcState.textContent=message.fc_state||"—";''',
    '''peer.onTelemetry=message=>{
  lastTelemetry=message;
  document.body.dataset.telemetrySequence=String(message.telemetrySequence??"");
  ui.fcState.textContent=message.fc_state||"—";''',
)

replace_once(
    "tests/dual_phone_smoke.mjs",
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
  // Synchronize on ordered post-reset controller telemetry. updateArm() is driven
  // by peer.onTelemetry, so DISARMED + AGL proves a fresh safe FC state arrived.
  await waitText(controller,"#fcState","DISARMED",15000);
  await controller.waitForFunction(()=>document.querySelector("#gameSensorStatus")?.textContent?.includes("AGL"),{timeout:15000});
  const rearmStart=await simTime(view);await clickWhenEnabled(controller,"#arm","ARM",15000);
  await view.waitForFunction(()=>document.querySelector("#fcState")?.textContent==="ARMED",{timeout:65000});
  const rearmDuration=(await simTime(view))-rearmStart;
  if(rearmDuration>1.5)throw new Error(`same-session GAME re-arm too slow after safe reset: ${rearmDuration.toFixed(3)}s`);
  console.log("Serverless P2P E2E: stale-control fail-safe recovered after safe reset on the same session with zero re-pairing.");
''',
    '''  // A real 350 ms stale-control event removes thrust. From a 2 m hover the
  // airframe can hit the ground before the sender recovers, so an in-place re-arm
  // would be physically unsafe and can correctly be blocked by invalid AGL/tilt.
  // Prove the intended recovery contract instead: explicit ARM low, safe upright
  // simulator reset, then re-arm over the exact same P2P session with no re-pair.
  await controller.click("#kill");
  await view.waitForFunction(()=>document.querySelector("#armSwitch")?.textContent==="OFF",{timeout:10000});
  const preResetTelemetrySequence=await controller.$eval("body",body=>Number(body.dataset.telemetrySequence||-1));
  await view.click("#reset");
  await waitSim(view,2.2,60000);
  await view.waitForFunction(()=>document.querySelector("#fcState")?.textContent==="DISARMED",{timeout:30000});
  // All recovery predicates must become true together on a telemetry packet that
  // was accepted strictly after reset. This avoids stale-DOM and cross-predicate
  // races while preserving every FC-side arming and 350 ms freshness gate.
  try{
    await controller.waitForFunction(before=>{
      const sequence=Number(document.body.dataset.telemetrySequence||-1);
      const fc=document.querySelector("#fcState")?.textContent?.trim();
      const sensor=document.querySelector("#gameSensorStatus")?.textContent||"";
      const connection=document.querySelector("#connection")?.textContent||"";
      const arm=document.querySelector("#arm");
      return sequence>before&&fc==="DISARMED"&&sensor.includes("AGL")&&connection.includes("P2P LINKED")&&arm&&!arm.disabled&&arm.textContent.trim()==="ARM";
    },{timeout:30000},preResetTelemetrySequence);
  }catch(error){
    const recovery=await controller.evaluate(()=>({
      sequence:Number(document.body.dataset.telemetrySequence||-1),
      fc:document.querySelector("#fcState")?.textContent||"",
      sensor:document.querySelector("#gameSensorStatus")?.textContent||"",
      connection:document.querySelector("#connection")?.textContent||"",
      armText:document.querySelector("#arm")?.textContent||"",
      armDisabled:Boolean(document.querySelector("#arm")?.disabled),
    }));
    throw new Error(`same-session recovery never reached atomic arm-ready state after reset: before=${preResetTelemetrySequence} now=${JSON.stringify(recovery)}; ${error.message}`);
  }
  const rearmStart=await simTime(view);await clickWhenEnabled(controller,"#arm","ARM",5000);
  await view.waitForFunction(()=>document.querySelector("#fcState")?.textContent==="ARMED",{timeout:65000});
  const rearmDuration=(await simTime(view))-rearmStart;
  if(rearmDuration>1.5)throw new Error(`same-session GAME re-arm too slow after safe reset: ${rearmDuration.toFixed(3)}s`);
  console.log("Serverless P2P E2E: stale-control fail-safe recovered after safe reset on fresh post-reset telemetry with zero re-pairing.");
''',
)

# Keep the telemetry marker as an explicit architecture contract for future tests.
architecture=Path("tests/architecture_invariants.mjs")
text=architecture.read_text()
anchor='''requireText("sim/p2p_link.mjs","newerSequence(sequence,this.lastTelemetrySequence)",\n            "out-of-order telemetry must never overwrite fresher flight state");\n'''
addition='''requireText("sim/controller.mjs","dataset.telemetrySequence",\n            "controller must expose the newest accepted telemetry sequence for deterministic recovery validation");\n'''
if addition not in text:
    if anchor not in text:
        raise RuntimeError("telemetry ordering architecture anchor missing")
    text=text.replace(anchor,anchor+addition,1)
architecture.write_text(text)
