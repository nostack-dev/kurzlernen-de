from pathlib import Path

sim = Path("sim/simulator.mjs")
s = sim.read_text()
old = 'function exportSession(){downloadJson(`arondight45-${mode}-${new Date().toISOString().replace(/[:.]/g,"-")}.json`,{schema:"arondight45-flight-log-v1",mode,samples:sessionLog,physics:defaultParams()});}'
new = '''function exportSession(){
  if((latest.state&STATE_ARMED)&&inputSource==="remote"){
    setStatus("Disarm before exporting a full flight log during P2P control.","warn");
    return;
  }
  downloadJson(`arondight45-${mode}-${new Date().toISOString().replace(/[:.]/g,"-")}.json`,{schema:"arondight45-flight-log-v1",mode,samples:sessionLog,physics:defaultParams()});
}'''
if new not in s:
    assert s.count(old) == 1, s.count(old)
    s = s.replace(old, new, 1)
sim.write_text(s)

test = Path("tests/dual_phone_smoke.mjs")
s = test.read_text()
helper = '''async function liveMotion(view,controller){
  const ist=await controller.$eval("#stateVectorDebug [data-vector-ist-text]",element=>element.textContent||"");
  const match=ist.match(/v\\[F\\s*([+-]?\\d+(?:\\.\\d+)?)\\s*\\|\\s*R\\s*([+-]?\\d+(?:\\.\\d+)?)\\s*\\|\\s*Z\\s*([+-]?\\d+(?:\\.\\d+)?)\\]\\s*m\\/s.*?AGL\\s*([+-]?\\d+(?:\\.\\d+)?)\\s*m\\s*R\\/P\\/Y\\s*([+-]?\\d+(?:\\.\\d+)?)\\s*\\/\\s*([+-]?\\d+(?:\\.\\d+)?)\\s*\\/\\s*([+-]?\\d+(?:\\.\\d+)?)°/);
  if(!match)throw new Error(`cannot parse live measured-state telemetry: ${ist}`);
  const viewState=await view.evaluate(()=>({
    altitude:parseFloat(document.querySelector("#altitude")?.textContent||"NaN"),
    speed:parseFloat(document.querySelector("#velocity")?.textContent||"NaN"),
    state:document.querySelector("#fcState")?.textContent||"",
    motors:(document.querySelector("#motors")?.textContent||"").trim().split(/\\s+/).map(Number),
  }));
  const forward=Number(match[1]),right=Number(match[2]),vertical=Number(match[3]);
  return{forward,right,horizontal:Math.hypot(forward,right),vertical,speed:viewState.speed,altitude:viewState.altitude,roll:Number(match[5]),pitch:Number(match[6]),yaw:Number(match[7]),state:viewState.state,motors:viewState.motors};
}
async function liveTrace(view,controller,start,offsets,timeout=90000){
  const trace=[];
  for(const offset of offsets){await waitSim(view,start+offset,timeout);trace.push({offset,...await liveMotion(view,controller)});}
  return trace;
}
'''
if "async function liveMotion(view,controller)" not in s:
    marker = "function traceAtOffsets(samples,start,offsets){"
    assert s.count(marker) == 1, s.count(marker)
    s = s.replace(marker, helper + marker, 1)

replacements = [
    ("const hold=bodyMotion(await latestFlightSample(view));", "const hold=await liveMotion(view,controller);"),
    ("const clearanceRise=bodyMotion(await latestFlightSample(view));", "const clearanceRise=await liveMotion(view,controller);"),
    ("const moving=bodyMotion(await latestFlightSample(view));", "const moving=await liveMotion(view,controller);"),
]
for old, new in replacements:
    if new not in s:
        assert s.count(old) == 1, (old, s.count(old))
        s = s.replace(old, new, 1)

old = '''  const brakeStart=await simTime(view);await waitSim(view,brakeStart+4.0,90000);
  const samples=await flightSamples(view),trace=traceAtOffsets(samples,brakeStart,[0,.4,.8,1.2,1.6,2.4,3.2,4.0]);
'''
new = '''  const brakeStart=await simTime(view);
  const trace=await liveTrace(view,controller,brakeStart,[0,.4,.8,1.2,1.6,2.4,3.2,4.0]);
'''
if new not in s:
    assert s.count(old) == 1, s.count(old)
    s = s.replace(old, new, 1)

old = '''  const strafeStart=await simTime(view);await waitSim(view,strafeStart+1.0,45000);
  const strafeCommandSamples=await flightSamples(view),strafeCommandTrace=traceAtOffsets(strafeCommandSamples,strafeStart,[0,.1,.2,.35,.5,.65,.8,1.0]);
  const strafing=strafeCommandTrace[strafeCommandTrace.length-1];
'''
new = '''  const strafeStart=await simTime(view);
  const strafeCommandTrace=await liveTrace(view,controller,strafeStart,[0,.1,.2,.35,.5,.65,.8,1.0],45000);
  const strafing=strafeCommandTrace[strafeCommandTrace.length-1];
'''
if new not in s:
    assert s.count(old) == 1, s.count(old)
    s = s.replace(old, new, 1)

old = '''  const strafeBrakeStart=await simTime(view);await waitSim(view,strafeBrakeStart+4.0,90000);
  const strafeSamples=await flightSamples(view),strafeTrace=traceAtOffsets(strafeSamples,strafeBrakeStart,[0,.4,.8,1.2,1.6,2.4,3.2,4.0]),strafeBraked=strafeTrace[strafeTrace.length-1];
'''
new = '''  const strafeBrakeStart=await simTime(view);
  const strafeTrace=await liveTrace(view,controller,strafeBrakeStart,[0,.4,.8,1.2,1.6,2.4,3.2,4.0]),strafeBraked=strafeTrace[strafeTrace.length-1];
'''
if new not in s:
    assert s.count(old) == 1, s.count(old)
    s = s.replace(old, new, 1)

armed = s[s.index('const left=await stickBox(controller,"#leftStick")'):s.index('const stall=controller.evaluate')]
assert "flightSamples(view)" not in armed, armed
assert "latestFlightSample(view)" not in armed, armed
assert "liveTrace(view,controller" in armed

test.write_text(s)
