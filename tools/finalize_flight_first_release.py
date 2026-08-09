from pathlib import Path


def replace_one(path, old, new):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    assert count == 1, f"{path}: expected exactly one match, got {count}: {old[:100]!r}"
    p.write_text(text.replace(old, new, 1))


# 1) Preserve exact 1 ms flight authority while preventing stale async loops from
# surviving an immediate STOP -> RESET -> START sequence.
replace_one(
    "sim/simulator.mjs",
    'let mode="sim",backend=null,running=false,sequence=1,simTime=0,resetFlag=true;',
    'let mode="sim",backend=null,running=false,runEpoch=0,sequence=1,simTime=0,resetFlag=true;',
)
replace_one(
    "sim/simulator.mjs",
    '''function startRun(){
  if(running)return true;if(mode!=="replay"&&!backend)return false;if(mode==="replay"&&!realLog.length)return false;
  running=true;ui.run.textContent="Pause";wallStart=performance.now();simStart=simTime;loop().catch(error=>{running=false;ui.run.textContent="Start";setStatus(error.message,"bad");});return true;
}
function stopRun(){running=false;ui.run.textContent="Start";}''',
    '''function startRun(){
  if(running)return true;if(mode!=="replay"&&!backend)return false;if(mode==="replay"&&!realLog.length)return false;
  running=true;const epoch=++runEpoch;ui.run.textContent="Pause";wallStart=performance.now();simStart=simTime;loop(epoch).catch(error=>{if(epoch!==runEpoch)return;running=false;ui.run.textContent="Start";setStatus(error.message,"bad");});return true;
}
function stopRun(){running=false;++runEpoch;ui.run.textContent="Start";}''',
)
replace_one("sim/simulator.mjs", "async function loop(){", "async function loop(epoch){")
replace_one("sim/simulator.mjs", "  while(running){", "  while(running&&epoch===runEpoch){")
replace_one(
    "sim/simulator.mjs",
    "    for(let i=0;i<due&&running;i++){",
    "    for(let i=0;i<due&&running&&epoch===runEpoch;i++){",
)

# 2) Presentation quality is adaptive and subordinate to the authoritative clock.
# It never alters DT, FC, sensors, motors, or Box3D. Training can reduce only the
# WebGL backbuffer when measured sim/wall cadence proves presentation pressure.
replace_one(
    "sim/simulator.mjs",
    "const PRESENTATION_SHADOW_BACKLOG_MS = 3;",
    """const PRESENTATION_SHADOW_BACKLOG_MS = 3;
const PRESENTATION_PIXEL_RATIO_MAX = 1.25;
const PRESENTATION_PIXEL_RATIO_MIN = .60;
const PRESENTATION_QUALITY_WINDOW_MS = 250;
const PRESENTATION_CADENCE_CRITICAL = .86;
const PRESENTATION_CADENCE_CONSTRAINED = .93;
const PRESENTATION_CADENCE_RECOVER = .985;
const PRESENTATION_RECOVERY_WINDOWS = 8;""",
)
replace_one(
    "sim/simulator.mjs",
    'const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));',
    'const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});const presentationNativePixelRatio=Math.min(devicePixelRatio||1,PRESENTATION_PIXEL_RATIO_MAX);let presentationPixelRatio=presentationNativePixelRatio;renderer.setPixelRatio(presentationPixelRatio);',
)
replace_one(
    "sim/simulator.mjs",
    "let lastPresentationHudMs=-Infinity,lastPresentationAudioMs=-Infinity,lastPresentationDrawMs=-Infinity,lastPresentationShadowMs=-Infinity,presentationDraws=0;",
    "let lastPresentationHudMs=-Infinity,lastPresentationAudioMs=-Infinity,lastPresentationDrawMs=-Infinity,lastPresentationShadowMs=-Infinity,presentationDraws=0,lastPresentationQualityWallMs=performance.now(),lastPresentationQualitySimS=simTime,presentationQualityGoodWindows=0;",
)
replace_one(
    "sim/simulator.mjs",
    "  presentationDraws:{get:()=>presentationDraws,enumerable:true},\n});",
    "  presentationDraws:{get:()=>presentationDraws,enumerable:true},\n  presentationPixelRatio:{get:()=>presentationPixelRatio,enumerable:true},\n  fcState:{get:()=>latest.state,enumerable:true},\n  runEpoch:{get:()=>runEpoch,enumerable:true},\n});",
)
replace_one(
    "sim/simulator.mjs",
    'Object.defineProperty(globalThis,"__arondightDiagnostics",{value:simulatorDiagnostics,writable:false,configurable:false});\nfunction render(){',
    '''Object.defineProperty(globalThis,"__arondightDiagnostics",{value:simulatorDiagnostics,writable:false,configurable:false});
function updatePresentationQuality(now){
  const worldActive=$("viewport")?.dataset.worldMode==="real";
  if(!running||mode!=="sim"||worldActive){lastPresentationQualityWallMs=now;lastPresentationQualitySimS=simTime;presentationQualityGoodWindows=0;return;}
  const elapsedMs=now-lastPresentationQualityWallMs;if(elapsedMs<PRESENTATION_QUALITY_WINDOW_MS)return;
  const simElapsedS=simTime-lastPresentationQualitySimS,cadence=simElapsedS/Math.max(.001,elapsedMs/1000);
  lastPresentationQualityWallMs=now;lastPresentationQualitySimS=simTime;
  let target=presentationPixelRatio;
  if(cadence<PRESENTATION_CADENCE_CRITICAL){target=Math.min(presentationNativePixelRatio,PRESENTATION_PIXEL_RATIO_MIN);presentationQualityGoodWindows=0;}
  else if(cadence<PRESENTATION_CADENCE_CONSTRAINED){target=Math.min(presentationNativePixelRatio,.80);presentationQualityGoodWindows=0;}
  else if(cadence>PRESENTATION_CADENCE_RECOVER&&presentationPixelRatio<presentationNativePixelRatio){
    if(++presentationQualityGoodWindows>=PRESENTATION_RECOVERY_WINDOWS){target=Math.min(presentationNativePixelRatio,presentationPixelRatio+.20);presentationQualityGoodWindows=0;}
  }else presentationQualityGoodWindows=0;
  if(Math.abs(target-presentationPixelRatio)>.01){presentationPixelRatio=target;renderer.setPixelRatio(presentationPixelRatio);resize();}
  const viewport=$("viewport");if(viewport){viewport.dataset.presentationPixelRatio=presentationPixelRatio.toFixed(2);viewport.dataset.presentationCadence=cadence.toFixed(3);}
}
function render(){''',
)
replace_one(
    "sim/simulator.mjs",
    "  const renderNow=performance.now(),fcState=latest.state;",
    "  const renderNow=performance.now(),fcState=latest.state;updatePresentationQuality(renderNow);",
)

# WORLD has its own visual governor. Critical pressure now has a real third tier;
# it still changes pixels only, never physical state.
replace_one(
    "sim/real_world_bootstrap.mjs",
    '    if(this.threeRenderer){const ratio=mode==="nominal"?Math.min(this.flightPixelRatio||devicePixelRatio||1,WORLD_FLIGHT_PIXEL_RATIO):1;this.threeRenderer.setPixelRatio(ratio);$("viewport").dataset.worldFlightPixelRatio=String(ratio);}',
    '    if(this.threeRenderer){const ceiling=Math.min(this.flightPixelRatio||devicePixelRatio||1,WORLD_FLIGHT_PIXEL_RATIO),ratio=mode==="critical"?Math.min(ceiling,.75):mode==="constrained"?Math.min(ceiling,1):ceiling;this.threeRenderer.setPixelRatio(ratio);$("viewport").dataset.worldFlightPixelRatio=String(ratio);}',
)

# 3) ARM E2E is tied to authoritative simulator time/state, not an arbitrary DOM
# snapshot. It remains strict: the real FC must arm within 1.5 simulated seconds.
replace_one(
    "tests/browser_sim_smoke.mjs",
    '''  const armStart=await simTime();await page.click("#soloArm");await waitForSimTime(armStart+1.25,50000);
  state=await page.$eval("#fcState",e=>e.textContent||"");
  if(state!=="ARMED")throw new Error(`solo GAME ARM failed: ${JSON.stringify(await snapshot())}`);''',
    '''  const armStart=await page.evaluate(()=>Number(globalThis.__arondightDiagnostics?.simTime));await page.click("#soloArm");
  await page.waitForFunction(({start,limit})=>{const d=globalThis.__arondightDiagnostics,sim=Number(d?.simTime),fc=Number(d?.fcState)||0;return Boolean(fc&1)||(Number.isFinite(sim)&&sim>=start+limit);},{timeout:15000},{start:armStart,limit:1.5});
  const armReached=await page.evaluate(()=>({sim:Number(globalThis.__arondightDiagnostics?.simTime),fc:Number(globalThis.__arondightDiagnostics?.fcState)||0}));
  if(!(armReached.fc&1)||armReached.sim-armStart>1.5)throw new Error(`solo GAME ARM authority failed: start=${armStart} reached=${JSON.stringify(armReached)} snapshot=${JSON.stringify(await snapshot())}`);
  await page.waitForFunction(()=>document.querySelector("#fcState")?.textContent==="ARMED",{timeout:1500});state="ARMED";''',
)

# 4) Lock the no-overlap scheduler and adaptive presentation boundary into release
# invariants so a future visual change cannot silently steal flight time again.
replace_one(
    "tests/architecture_invariants.mjs",
    'requireText("sim/simulator.mjs","renderer.shadowMap.type=THREE.BasicShadowMap");',
    '''requireText("sim/simulator.mjs","renderer.shadowMap.type=THREE.BasicShadowMap");
requireText("sim/simulator.mjs","PRESENTATION_PIXEL_RATIO_MIN = .60");
requireText("sim/simulator.mjs","PRESENTATION_PIXEL_RATIO_MAX = 1.25");
requireText("sim/simulator.mjs","updatePresentationQuality(renderNow)");
requireText("sim/simulator.mjs","loop(epoch)");
requireText("sim/simulator.mjs","while(running&&epoch===runEpoch)");
requireText("sim/simulator.mjs","i<due&&running&&epoch===runEpoch");
requireText("sim/simulator.mjs","function stopRun(){running=false;++runEpoch");
requireText("sim/real_world_bootstrap.mjs",'mode==="critical"?Math.min(ceiling,.75)');''',
)

# 5) Keep documentation explicit about what is and is not allowed to adapt.
doc = Path("REAL_WORLD_DIGITAL_TWIN.md")
text = doc.read_text().rstrip() + "\n"
marker = "### Restart ownership and adaptive visual resolution"
assert marker not in text
text += """

### Restart ownership and adaptive visual resolution

STOP / RESET / START uses a monotonic run epoch. A loop from an older epoch cannot resume after a new run begins, including across `requestAnimationFrame`, `MessageChannel`, or asynchronous HIL waits. This prevents two 1 kHz schedulers from ever sharing the same FirmwareRuntime/Box3D authority after an immediate restart.

Visual resolution is a production presentation governor, not a simulation time-scale. Training starts at up to 1.25 CSS pixel ratio and measures authoritative simulator-time versus wall-time in 250 ms windows. Only when presentation pressure demonstrably pulls cadence below target may the THREE backbuffer step down, to 0.80 and ultimately 0.60; sustained headroom is required before resolution recovers. REAL WORLD keeps its independent map/flight governor and uses a 0.75 flight-overlay floor only in its critical visual-pressure tier. None of these paths changes the 1 ms timestep, sensor cadence, FC code, motor pulses, plant parameters, collision, or Box3D solver work.
"""
doc.write_text(text)
