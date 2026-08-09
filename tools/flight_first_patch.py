from pathlib import Path
import subprocess


def one(path, old, new, label):
    p = Path(path)
    s = p.read_text()
    n = s.count(old)
    assert n == 1, f"{label}: expected one occurrence, got {n}"
    p.write_text(s.replace(old, new, 1))


workflow = Path(".github/workflows/one-shot-flight-first-presentation.yml")
assert workflow.exists()
workflow.unlink()
Path("tools/flight_first_patch.py").unlink()

p = Path("sim/simulator.mjs")
s = p.read_text()

constants_old = '''const SIM_WORK_SLICE_MS = 6;
const SIM_AUX_INTERVAL_S = .01;
'''
constants_new = '''const SIM_WORK_SLICE_MS = 6;
const SIM_AUX_INTERVAL_S = .01;

// Presentation is explicitly subordinate to the 1 kHz digital-twin clock.
// These budgets may skip visual work; they never skip FC/sensor/motor/Box3D ticks.
const PRESENTATION_HUD_INTERVAL_MS = 50;
const PRESENTATION_AUDIO_INTERVAL_MS = 33;
const PRESENTATION_SHADOW_INTERVAL_MS = 100;
const PRESENTATION_MAX_DRAW_GAP_MS = 50;
const PRESENTATION_SOFT_BACKLOG_MS = 1.5;
const PRESENTATION_CONSTRAINED_BACKLOG_MS = 4;
const PRESENTATION_HARD_BACKLOG_MS = 8;
const PRESENTATION_SKIP_DRAW_BACKLOG_MS = 12;
const PRESENTATION_SHADOW_BACKLOG_MS = 3;
'''
assert s.count(constants_old) == 1
s = s.replace(constants_old, constants_new, 1)

shadow_old = 'renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;'
shadow_new = 'renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=true;'
assert s.count(shadow_old) == 1
s = s.replace(shadow_old, shadow_new, 1)

loop_start = s.index('async function loop(){')
loop_end = s.index('\nasync function replayStep(){', loop_start)
loop_new = '''let simulationBacklogMs=0;
async function loop(){
  let schedulerWallMs=performance.now(),accumulatorMs=0,auxAccumulatorS=0;
  while(running){
    if(mode==="replay"){simulationBacklogMs=0;await replayStep();schedulerWallMs=performance.now();continue;}
    const now=performance.now(),elapsedMs=clamp(now-schedulerWallMs,0,SIM_MAX_CATCHUP_MS);schedulerWallMs=now;
    accumulatorMs=Math.min(accumulatorMs+elapsedMs,SIM_MAX_CATCHUP_MS);simulationBacklogMs=accumulatorMs;
    if(accumulatorMs<SIM_FIXED_STEP_MS){await new Promise(requestAnimationFrame);continue;}
    const sliceStart=performance.now(),due=Math.min(Math.floor(accumulatorMs/SIM_FIXED_STEP_MS),SIM_MAX_STEPS_PER_SLICE),wasmFastPath=mode==="sim"&&backend instanceof WasmBackend;
    for(let i=0;i<due&&running;i++){
      latest=wasmFastPath?controllerStepSync():await controllerStep();physics.step(latest.motors,DT);simTime+=DT;auxAccumulatorS+=DT;accumulatorMs-=SIM_FIXED_STEP_MS;
      if(auxAccumulatorS+1e-12>=SIM_AUX_INTERVAL_S){auxAccumulatorS-=SIM_AUX_INTERVAL_S;raceTrack.update(physics.position(),simTime,Boolean(latest.state&STATE_ARMED));recordSession();}
      if(performance.now()-sliceStart>=SIM_WORK_SLICE_MS)break;
    }
    const afterWork=performance.now(),workElapsedMs=clamp(afterWork-schedulerWallMs,0,SIM_MAX_CATCHUP_MS);schedulerWallMs=afterWork;
    accumulatorMs=Math.min(accumulatorMs+workElapsedMs,SIM_MAX_CATCHUP_MS);simulationBacklogMs=accumulatorMs;
    if(accumulatorMs>=SIM_FIXED_STEP_MS)await yieldToBrowser();else await new Promise(requestAnimationFrame);
  }
}
'''
s = s[:loop_start] + loop_new + s[loop_end:]

render_start = s.index('function render(){')
render_end = s.index('\n}\nrender();', render_start) + 2
old_render = s[render_start:render_end]
head = '''function render(){
  requestAnimationFrame(render);const renderNow=performance.now();physics.render();updateCamera();const fcState=latest.state;motorSound.syncFcState(fcState,arm);motorSound.update(physics,camera.position);const state=physics.state();
'''
assert old_render.startswith(head), old_render[:300]
draw = 'if(!globalThis.__arondightRealWorld?.renderFrame?.(renderer,scene,camera))renderer.render(scene,camera);'
assert old_render.count(draw) == 1
middle = old_render[len(head):]
assert middle.endswith(draw + '\n}'), middle[-300:]
hud_body = middle[:-(len(draw) + 2)]
new_render = '''let lastPresentationHudMs=-Infinity,lastPresentationAudioMs=-Infinity,lastPresentationDrawMs=-Infinity,lastPresentationShadowMs=-Infinity,presentationDraws=0;
function render(){
  requestAnimationFrame(render);
  const renderNow=performance.now(),fcState=latest.state;
  motorSound.syncFcState(fcState,arm);
  if(renderNow-lastPresentationAudioMs>=PRESENTATION_AUDIO_INTERVAL_MS){
    lastPresentationAudioMs=renderNow;
    motorSound.update(physics,camera.position);
  }
  if(renderNow-lastPresentationHudMs>=PRESENTATION_HUD_INTERVAL_MS){
    lastPresentationHudMs=renderNow;
    const state=physics.state();
''' + hud_body + '''
  }
  const backlog=Math.max(0,simulationBacklogMs);
  const sinceDraw=renderNow-lastPresentationDrawMs;
  const minDrawInterval=backlog>=PRESENTATION_HARD_BACKLOG_MS?PRESENTATION_MAX_DRAW_GAP_MS:
    backlog>=PRESENTATION_CONSTRAINED_BACKLOG_MS?33:
    backlog>=PRESENTATION_SOFT_BACKLOG_MS?22:0;
  const forceDraw=sinceDraw>=PRESENTATION_MAX_DRAW_GAP_MS;
  const drawDue=forceDraw||(backlog<PRESENTATION_SKIP_DRAW_BACKLOG_MS&&sinceDraw>=minDrawInterval);
  if(drawDue){
    lastPresentationDrawMs=renderNow;
    physics.render();
    updateCamera();
    if(renderer.shadowMap.enabled&&renderNow-lastPresentationShadowMs>=PRESENTATION_SHADOW_INTERVAL_MS&&backlog<PRESENTATION_SHADOW_BACKLOG_MS){
      lastPresentationShadowMs=renderNow;
      renderer.shadowMap.needsUpdate=true;
    }
    presentationDraws++;
    const viewport=$("viewport");
    if(viewport){viewport.dataset.presentationDraws=String(presentationDraws);viewport.dataset.presentationBacklogMs=backlog.toFixed(2);}
    ''' + draw + '''
  }
}'''
s = s[:render_start] + new_render + s[render_end:]
p.write_text(s)

p = Path("tests/browser_sim_smoke.mjs")
t = p.read_text()
old = '''  const cadenceStart=await page.evaluate(()=>({wall:performance.now(),sim:parseFloat(document.querySelector("#simTime")?.textContent||"0")}));
  await wait(1200);
  const cadenceEnd=await page.evaluate(()=>({wall:performance.now(),sim:parseFloat(document.querySelector("#simTime")?.textContent||"0")}));
  const cadenceRatio=(cadenceEnd.sim-cadenceStart.sim)/Math.max(.001,(cadenceEnd.wall-cadenceStart.wall)/1000);
  console.log(`Realtime fixed-step cadence: ${cadenceRatio.toFixed(3)}x`);
  if(!(cadenceRatio>.90&&cadenceRatio<1.10))throw new Error(`fixed-step simulation is not tracking wall time closely enough: ${cadenceRatio.toFixed(3)}x`);
'''
new = '''  await wait(700); // exclude layout/solo-transition startup from the steady-state clock proof
  const cadenceStart=await page.evaluate(()=>({wall:performance.now(),sim:parseFloat(document.querySelector("#simTime")?.textContent||"0"),draws:Number(document.querySelector("#viewport")?.dataset.presentationDraws||0)}));
  await wait(2500);
  const cadenceEnd=await page.evaluate(()=>({wall:performance.now(),sim:parseFloat(document.querySelector("#simTime")?.textContent||"0"),draws:Number(document.querySelector("#viewport")?.dataset.presentationDraws||0),backlog:Number(document.querySelector("#viewport")?.dataset.presentationBacklogMs||0)}));
  const cadenceRatio=(cadenceEnd.sim-cadenceStart.sim)/Math.max(.001,(cadenceEnd.wall-cadenceStart.wall)/1000),presentationDraws=cadenceEnd.draws-cadenceStart.draws;
  console.log(`Realtime fixed-step cadence: ${cadenceRatio.toFixed(3)}x · presentation draws ${presentationDraws} · backlog ${cadenceEnd.backlog.toFixed(2)} ms`);
  if(!(cadenceRatio>.90&&cadenceRatio<1.10))throw new Error(`fixed-step simulation is not tracking wall time closely enough: ${cadenceRatio.toFixed(3)}x`);
  if(presentationDraws<35)throw new Error(`flight-first presentation starved visual output: only ${presentationDraws} draws in 2.5s`);
'''
assert t.count(old) == 1
p.write_text(t.replace(old, new, 1))

p = Path("tests/architecture_invariants.mjs")
a = p.read_text()
anchor = '''requireText("sim/simulator.mjs","physics.p.imuValid");
forbidText("sim/simulator.mjs","(sequence&7)===0", "simulator fixed-step cadence must not be display-Hz divided");
'''
extra = '''requireText("sim/simulator.mjs","physics.p.imuValid");
requireText("sim/simulator.mjs","PRESENTATION_HUD_INTERVAL_MS = 50");
requireText("sim/simulator.mjs","PRESENTATION_AUDIO_INTERVAL_MS = 33");
requireText("sim/simulator.mjs","PRESENTATION_MAX_DRAW_GAP_MS = 50");
requireText("sim/simulator.mjs","simulationBacklogMs=accumulatorMs");
requireText("sim/simulator.mjs","renderer.shadowMap.autoUpdate=false");
requireText("sim/simulator.mjs","viewport.dataset.presentationDraws");
forbidText("sim/simulator.mjs","(sequence&7)===0", "simulator fixed-step cadence must not be display-Hz divided");
const presentationStart=simulatorSource.indexOf("function render(){"),presentationEnd=simulatorSource.indexOf("\\n}\\nrender();",presentationStart);
if(presentationStart<0||presentationEnd<=presentationStart)fail("cannot isolate presentation boundary");
const presentationSource=simulatorSource.slice(presentationStart,presentationEnd);
for(const forbidden of ["physics.step(","backend.exchangeSync(","navigationSensors.sampleFrame(","b3.b3World_Step("])
  if(presentationSource.includes(forbidden))fail(`presentation path gained flight authority: ${forbidden}`);
'''
assert a.count(anchor) == 1
p.write_text(a.replace(anchor, extra, 1))

p = Path("REAL_WORLD_DIGITAL_TWIN.md")
doc = p.read_text().rstrip()
note = '''

### Flight-first presentation budget

Browser SIL treats visual work as an observer with an explicit CPU/GPU budget. The authoritative path remains exact 1 ms raw-sensor → `fc::FirmwareRuntime` → motor-pulse → motor/prop → Box3D execution. HUD refresh is capped at 20 Hz, continuous motor-audio parameter refresh at about 30 Hz, and shadow-map refresh at 10 Hz while the normal image renderer remains adaptive. When measured simulation backlog grows, presentation frames are skipped before any physical tick is skipped; a 50 ms maximum draw gap prevents the UI from disappearing under severe load. On hardware with headroom the renderer still runs at display cadence. Neither the presentation governor nor WORLD rendering changes `DT`, controller constants, sensor cadence, motor outputs, mass/inertia/drag, or Box3D integration.
'''
if "### Flight-first presentation budget" not in doc:
    p.write_text(doc + note + "\n")

for path in ["sim/simulator.mjs", "tests/browser_sim_smoke.mjs", "tests/architecture_invariants.mjs"]:
    subprocess.run(["node", "--check", path], check=True)
subprocess.run(["node", "tests/control_semantics_test.mjs"], check=True)
subprocess.run(["node", "tests/architecture_invariants.mjs"], check=True)
subprocess.run(["g++", "-std=c++17", "-O2", "-Wall", "-Wextra", "-Wpedantic", "-Werror", "-Iesp32", "tests/state_control_test.cpp", "-o", "/tmp/state-control-presentation"], check=True)
subprocess.run(["/tmp/state-control-presentation"], check=True)
subprocess.run(["git", "diff", "--check"], check=True)
