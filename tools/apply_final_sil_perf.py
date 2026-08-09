from pathlib import Path
import subprocess


def one(path, old, new):
    p = Path(path)
    s = p.read_text()
    n = s.count(old)
    if n != 1:
        raise RuntimeError(f"{path}: expected one match, got {n}: {old[:140]!r}")
    p.write_text(s.replace(old, new, 1))


# Remove transaction scaffolding before architecture validation and commit.
Path('.github/workflows/one-shot-apply-final-sil-perf.yml').unlink(missing_ok=True)
Path('tools/apply_final_sil_perf.py').unlink(missing_ok=True)

# Browser SIL executes the exact compiled FirmwareRuntime synchronously. Physical
# HIL remains asynchronous. This removes JS Promise/microtask overhead only.
one(
    'sim/simulator.mjs',
    '''  async exchange(packet){
    if(!this.ready) throw Error("WASM flight core not ready");
    this.module.HEAPU8.set(packet,this.inPtr);
    this.module._fc_process();
    return parseOutput(this.module.HEAPU8.slice(this.outPtr,this.outPtr+OUTPUT_BYTES));
  }
''',
    '''  exchangeSync(packet){
    if(!this.ready) throw Error("WASM flight core not ready");
    this.module.HEAPU8.set(packet,this.inPtr);
    this.module._fc_process();
    return parseOutput(this.module.HEAPU8.subarray(this.outPtr,this.outPtr+OUTPUT_BYTES));
  }
  async exchange(packet){return this.exchangeSync(packet);}
'''
)

# Keep the raw ICM/SBUS/NAV1 boundary identical; avoid DOM-backed parameter reads
# and RTT DOM writes inside the 1 kHz authority loop.
one(
    'sim/simulator.mjs',
    '''async function controllerStep(){
  const params=defaultParams(),seq=sequence++,navigationFrame=navigationSensors.sampleFrame(physics,DT),sbusFrame=sbusReceiver.sample(controls,DT);
  latestNavigation=navigationSensors.last;
  let flags=(params.imuValid?FLAG_IMU_PRESENT:0)|(resetFlag?FLAG_RESET:0);if(sbusFrame)flags|=FLAG_SBUS_PRESENT;if(navigationFrame)flags|=FLAG_NAVIGATION_PRESENT;
  const packet=makeInput(seq,physics.imuRaw(DT),sbusFrame,flags,1000,navigationFrame,0);resetFlag=false;
  const started=performance.now(),out=await backend.exchange(packet,seq);ui.rtt.textContent=(performance.now()-started).toFixed(2)+" ms";return out;
}
''',
    '''let latestControllerRttMs=0;
function prepareControllerStep(){
  const seq=sequence++,navigationFrame=navigationSensors.sampleFrame(physics,DT),sbusFrame=sbusReceiver.sample(controls,DT);
  latestNavigation=navigationSensors.last;
  let flags=(physics.p.imuValid?FLAG_IMU_PRESENT:0)|(resetFlag?FLAG_RESET:0);if(sbusFrame)flags|=FLAG_SBUS_PRESENT;if(navigationFrame)flags|=FLAG_NAVIGATION_PRESENT;
  const packet=makeInput(seq,physics.imuRaw(DT),sbusFrame,flags,1000,navigationFrame,0);resetFlag=false;return{seq,packet};
}
function controllerStepSync(){
  const {packet}=prepareControllerStep(),started=performance.now(),out=backend.exchangeSync(packet);latestControllerRttMs=performance.now()-started;return out;
}
async function controllerStep(){
  const {seq,packet}=prepareControllerStep(),started=performance.now(),out=await backend.exchange(packet,seq);latestControllerRttMs=performance.now()-started;return out;
}
'''
)

one(
    'sim/simulator.mjs',
    '''    const due=Math.min(Math.floor(accumulatorMs/SIM_FIXED_STEP_MS),SIM_MAX_STEPS_PER_FRAME);
    for(let i=0;i<due&&running;i++){
      latest=await controllerStep();physics.step(latest.motors,DT);simTime+=DT;raceTrack.update(physics.position(),simTime,Boolean(latest.state&STATE_ARMED));recordSession();accumulatorMs-=SIM_FIXED_STEP_MS;
    }
''',
    '''    const due=Math.min(Math.floor(accumulatorMs/SIM_FIXED_STEP_MS),SIM_MAX_STEPS_PER_FRAME),wasmFastPath=mode==="sim"&&backend instanceof WasmBackend;
    for(let i=0;i<due&&running;i++){
      latest=wasmFastPath?controllerStepSync():await controllerStep();physics.step(latest.motors,DT);simTime+=DT;raceTrack.update(physics.position(),simTime,Boolean(latest.state&STATE_ARMED));recordSession();accumulatorMs-=SIM_FIXED_STEP_MS;
    }
'''
)

one(
    'sim/simulator.mjs',
    'ui.processing.textContent=latest.processingUs+" μs";ui.armSwitch.textContent=arm?"ON":"OFF";',
    'ui.processing.textContent=latest.processingUs+" μs";ui.rtt.textContent=latestControllerRttMs.toFixed(2)+" ms";ui.armSwitch.textContent=arm?"ON":"OFF";'
)

# Lock the performance boundary and the full 50 m P2P altitude contract.
p = Path('tests/architecture_invariants.mjs')
s = p.read_text()
anchor = '''requireText("sim/simulator.mjs","Math.floor(accumulatorMs/SIM_FIXED_STEP_MS)");
forbidText("sim/simulator.mjs","(sequence&7)===0", "simulator fixed-step cadence must not be display-Hz divided");
'''
replacement = '''requireText("sim/simulator.mjs","Math.floor(accumulatorMs/SIM_FIXED_STEP_MS)");
requireText("sim/simulator.mjs","exchangeSync(packet)");
requireText("sim/simulator.mjs","backend instanceof WasmBackend");
requireText("sim/simulator.mjs","physics.p.imuValid");
forbidText("sim/simulator.mjs","(sequence&7)===0", "simulator fixed-step cadence must not be display-Hz divided");
const controllerStepStart=simulatorSource.indexOf("function prepareControllerStep(){"),controllerStepEnd=simulatorSource.indexOf("function recordSession(){",controllerStepStart);
if(controllerStepStart<0||controllerStepEnd<=controllerStepStart)fail("cannot isolate simulator controller-step boundary");
const controllerStepSource=simulatorSource.slice(controllerStepStart,controllerStepEnd);
if(controllerStepSource.includes("defaultParams()"))fail("1 kHz controller step re-reads DOM-backed physical parameters");
if(controllerStepSource.includes("ui.rtt.textContent"))fail("1 kHz controller step mutates RTT DOM");
'''
if s.count(anchor) != 1:
    raise RuntimeError('fixed-step invariant anchor missing')
s = s.replace(anchor, replacement, 1)
p2p_anchor = 'requireText("sim/p2p_link.mjs","P2P_PROTOCOL = 5");'
if s.count(p2p_anchor) != 1:
    raise RuntimeError('P2P invariant anchor missing')
s = s.replace(
    p2p_anchor,
    p2p_anchor + '\nrequireText("sim/p2p_link.mjs","P2P_MAX_GROUND_CLEARANCE_M = 50");\nrequireText("sim/p2p_link.mjs","clamp(groundClearance,.5,P2P_MAX_GROUND_CLEARANCE_M)");',
    1,
)
p.write_text(s)

p = Path('REAL_WORLD_DIGITAL_TWIN.md')
doc = p.read_text().rstrip()
note = '''

The browser SIL fast path executes the exact same compiled `fc::FirmwareRuntime` synchronously instead of inserting a JavaScript Promise/microtask boundary at every 1 ms tick. Physical HIL remains asynchronous. Active physical parameters come from the live `PhysicsModel` rather than repeated DOM reads at 1 kHz, and RTT DOM updates are render-rate only. Sensor bytes, controller execution, motor pulses, 1 ms integration, model constants and control authority are unchanged.

The P2P control transport carries the same 0.5–50 m GAME AGL target envelope as one-phone control and the production `StateController`; it no longer contains the obsolete 5 m transport clamp.
'''
if 'Promise/microtask boundary at every 1 ms tick' not in doc:
    doc += note
p.write_text(doc)

for path in [
    'sim/simulator.mjs',
    'sim/p2p_link.mjs',
    'tests/architecture_invariants.mjs',
]:
    subprocess.run(['node', '--check', path], check=True)
subprocess.run(['node', 'tests/control_semantics_test.mjs'], check=True)
subprocess.run(['node', 'tests/architecture_invariants.mjs'], check=True)
subprocess.run([
    'g++', '-std=c++17', '-O2', '-Wall', '-Wextra', '-Wpedantic', '-Werror',
    '-Iesp32', 'tests/state_control_test.cpp', '-o', '/tmp/state-control'
], check=True)
subprocess.run(['/tmp/state-control'], check=True)
subprocess.run(['git', 'diff', '--check'], check=True)
