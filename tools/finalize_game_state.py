from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    assert count == 1, f"{path}: expected one match, got {count}: {old[:120]!r}"
    p.write_text(text.replace(old, new, 1))


# Shared controller-copy semantics must preserve GAME state in one-phone mode.
replace_once(
    "sim/control_semantics.mjs",
    'export function copyControls(c){return{roll:+c.roll||0,pitch:+c.pitch||0,yaw:+c.yaw||0,throttle:+c.throttle||0,arm:Boolean(c.arm)};}',
    '''export function copyControls(c){
  const groundClearance=Number(c?.groundClearance),lookPitch=Number(c?.lookPitch);
  return{
    roll:+c?.roll||0,pitch:+c?.pitch||0,yaw:+c?.yaw||0,throttle:+c?.throttle||0,arm:Boolean(c?.arm),
    gameMode:Boolean(c?.gameMode),
    groundClearance:Number.isFinite(groundClearance)?clampControl(groundClearance,.5,5):2,
    lookPitch:Number.isFinite(lookPitch)?clampControl(lookPitch,-1,1):0,
  };
}''',
)

# GAME must be inert until the authoritative inner production arm state is armed.
# This prevents any measured drift / held intent from fighting the existing arm gate.
state_path = "esp32/Arondight45_StateControl.hpp"
state_marker = '''        const float measured_right = -s * nav.velocity_world_mps.x + c * nav.velocity_world_mps.y;

        const float forward_error = intent.forward_mps - measured_forward;'''
state_replacement = '''        const float measured_right = -s * nav.velocity_world_mps.x + c * nav.velocity_world_mps.y;

        if (!inner_armed) {
            target_yaw_deg_ = wrap_degrees(yaw_deg);
            out.ch[FC_SBUS_ROLL] = centered_raw(0.0f);
            out.ch[FC_SBUS_PITCH] = centered_raw(0.0f);
            out.ch[FC_SBUS_THROTTLE] = throttle_raw(0.0f);
            out.ch[FC_SBUS_YAW] = centered_raw(0.0f);
            debug_ = {intent.forward_mps, measured_forward,
                      intent.right_mps, measured_right,
                      target_yaw_deg_, yaw_deg,
                      intent.clearance_m, nav.agl_m,
                      0.0f, 0.0f, 0.0f, 0.0f, 0.0f};
            return out;
        }

        const float forward_error = intent.forward_mps - measured_forward;'''
replace_once(state_path, state_marker, state_replacement)

sim = "sim/simulator.mjs"
replace_once(
    sim,
    'import {neutralControls,copyControls,armReady as sharedArmReady,normalizedPointer,applyStick,releaseStick,knobAxes,knobPercent} from "./control_semantics.mjs";',
    'import {neutralControls,copyControls,armReady as sharedArmReady,normalizedPointer,endPointerDrag,applyStick,releaseStick,knobAxes,knobPercent,phoneAxis,inversePhoneAxis} from "./control_semantics.mjs";',
)

# Real simulated range sensor: sampled/noisy, but its source is a Box3D collision-world ray.
replace_once(
    sim,
    '''    const position=model.position(),down=model.worldVector([0,0,-1]),verticalProjection=-down[2];
    let valid=verticalProjection>.55,agl=0;
    if(valid){const slant=Math.max(0,position[2])/verticalProjection;valid=slant>=.015&&slant<=12;if(valid){const measuredSlant=Math.max(0,slant+this.noise.gaussian()*.004);agl=measuredSlant*verticalProjection;}}''',
    '''    const range=model.groundRange(12);
    let valid=range.valid,agl=0;
    if(valid){const measuredSlant=Math.max(0,range.slant+this.noise.gaussian()*.004);agl=measuredSlant*range.verticalProjection;}''',
)
replace_once(
    sim,
    '''  rotation(){return b3.b3Body_GetRotation([0,0,0,1],this.body);}
  imuRaw(dt=DT){''',
    '''  rotation(){return b3.b3Body_GetRotation([0,0,0,1],this.body);}
  groundRange(maxRange=12){
    const range=clamp(Number(maxRange)||12,.05,50),origin=this.worldPoint([0,0,-.018]),down=this.worldVector([0,0,-1]),verticalProjection=-down[2];
    if(!(verticalProjection>.55))return{valid:false,slant:0,agl:0,verticalProjection};
    const filter=b3.b3DefaultQueryFilter(),hit=b3.b3World_CastRayClosest(this.world,origin,scale(down,range),filter),fraction=Number(hit?.fraction);
    if(!hit?.hit||!Number.isFinite(fraction)||fraction<0||fraction>1)return{valid:false,slant:0,agl:0,verticalProjection};
    const slant=fraction*range,agl=slant*verticalProjection;
    return{valid:slant>=.001&&slant<=range&&Number.isFinite(agl),slant,agl,verticalProjection};
  }
  imuRaw(dt=DT){''',
)

# One-phone UI and controls use the same GAME/STATE contract as the second phone.
replace_once(
    sim,
    '''  <div id="soloLeft" class="solo-stick"><div class="solo-ring"></div><div class="solo-knob"></div><span>THR / YAW</span></div>
  <div id="soloRight" class="solo-stick"><div class="solo-ring"></div><div class="solo-knob"></div><span>PITCH / ROLL</span></div>''',
    '''  <div id="soloLeft" class="solo-stick"><div class="solo-ring"></div><div class="solo-knob"></div><span>FWD / STRAFE</span></div>
  <div id="soloClearance"><small>GROUND CLEARANCE</small><strong id="soloClearanceValue">2.0 m</strong><div class="solo-range-shell"><input id="soloClearanceSlider" type="range" min="0.5" max="5" step="0.1"></div><span id="soloRangeStatus">AGL —</span></div>
  <div id="soloRight" class="solo-stick"><div class="solo-ring"></div><div class="solo-knob"></div><span>TURN / LOOK</span></div>''',
)
css_marker = '  .solo-stick span{position:absolute;left:50%;bottom:-18px;transform:translateX(-50%);font-size:10px;font-weight:800;letter-spacing:.08em;text-shadow:0 2px 5px #000;white-space:nowrap}\n'
css_add = css_marker + '''  #soloClearance{position:absolute;left:50%;bottom:max(96px,calc(env(safe-area-inset-bottom) + 80px));transform:translateX(-50%);width:66px;height:176px;display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:8px 5px;border:1px solid #ffffff55;border-radius:13px;background:#0b1826c9;backdrop-filter:blur(8px);pointer-events:auto;box-shadow:0 6px 22px #0005}
  #soloClearance small{font-size:8px;font-weight:850;line-height:1.05;text-align:center;letter-spacing:.06em}#soloClearance strong{font:900 13px ui-monospace,SFMono-Regular,Menlo,monospace;color:#6be4b0;white-space:nowrap}#soloClearance span{font-size:8px;font-weight:850;color:#ffd06d;white-space:nowrap}
  .solo-range-shell{height:98px;width:36px;display:grid;place-items:center;overflow:visible}.solo-range-shell input{width:98px;transform:rotate(-90deg);accent-color:#6be4b0}
'''
replace_once(sim, css_marker, css_add)

old_solo = '''let soloMode=false,soloPreviousInputSource="remote",soloControls=neutralControls(),phoneSettings=loadPhoneControlSettings();
function updateSoloSticks(){
  for(const [id,kind] of [["soloLeft","left"],["soloRight","right"]]){const axes=knobAxes(soloControls,kind,phoneSettings),knob=$(id).querySelector(".solo-knob");knob.style.left=`${knobPercent(axes.x)}%`;knob.style.top=`${knobPercent(axes.y)}%`;}
}
function soloStick(el,kind){
  let pointer=null;
  const apply=e=>{applyStick(soloControls,kind,normalizedPointer(el,e),phoneSettings);updateSoloSticks();e.preventDefault();};
  el.addEventListener("pointerdown",e=>{pointer=e.pointerId;el.setPointerCapture(pointer);apply(e);});
  el.addEventListener("pointermove",e=>{if(e.pointerId===pointer)apply(e);});
  const release=e=>{if(e.pointerId!==pointer)return;pointer=null;releaseStick(soloControls,kind);updateSoloSticks();e.preventDefault();};
  el.addEventListener("pointerup",release);el.addEventListener("pointercancel",release);
}
soloStick($("soloLeft"),"left");soloStick($("soloRight"),"right");updateSoloSticks();'''
new_solo = '''let soloMode=false,soloPreviousInputSource="remote",phoneSettings=loadPhoneControlSettings();
let soloGroundClearance=clamp(Number(localStorage.getItem("arondight45GroundClearance"))||2,.5,5);
function neutralSoloControls(){return{...neutralControls(),gameMode:true,groundClearance:soloGroundClearance,lookPitch:0};}
let soloControls=neutralSoloControls();
const soloClearanceSlider=$("soloClearanceSlider"),soloClearanceValue=$("soloClearanceValue"),soloRangeStatus=$("soloRangeStatus");soloClearanceSlider.value=String(soloGroundClearance);
function updateSoloSticks(){
  const left={x:phoneSettings.lockLeftHorizontal?0:inversePhoneAxis(soloControls.roll,phoneSettings.leftFineness),y:-inversePhoneAxis(soloControls.pitch,phoneSettings.leftFineness)};
  const right={x:inversePhoneAxis(soloControls.yaw,phoneSettings.rightFineness),y:phoneSettings.lockRightHorizontal?0:-inversePhoneAxis(soloControls.lookPitch||0,phoneSettings.rightFineness)};
  for(const [id,axes] of [["soloLeft",left],["soloRight",right]]){const knob=$(id).querySelector(".solo-knob");knob.style.left=`${knobPercent(axes.x)}%`;knob.style.top=`${knobPercent(axes.y)}%`;}
  soloClearanceValue.textContent=`${soloGroundClearance.toFixed(1)} m`;
}
function soloStick(el,kind){
  let pointer=null;
  const apply=e=>{const point=normalizedPointer(el,e);if(kind==="left"){soloControls.roll=phoneSettings.lockLeftHorizontal?0:phoneAxis(point.x,phoneSettings.leftFineness);soloControls.pitch=phoneAxis(-point.y,phoneSettings.leftFineness);soloControls.throttle=0;}else{soloControls.yaw=phoneAxis(point.x,phoneSettings.rightFineness);soloControls.lookPitch=phoneSettings.lockRightHorizontal?0:phoneAxis(-point.y,phoneSettings.rightFineness);}updateSoloSticks();e.preventDefault();};
  el.addEventListener("pointerdown",e=>{pointer=e.pointerId;el.setPointerCapture(pointer);apply(e);});
  el.addEventListener("pointermove",e=>{if(e.pointerId===pointer)apply(e);});
  const release=e=>{if(e.pointerId!==pointer)return;endPointerDrag(el,e.pointerId);pointer=null;if(kind==="left"){soloControls.roll=0;soloControls.pitch=0;soloControls.throttle=0;}else{soloControls.yaw=0;soloControls.lookPitch=0;}updateSoloSticks();e.preventDefault();};
  el.addEventListener("pointerup",release);el.addEventListener("pointercancel",release);
}
soloClearanceSlider.oninput=()=>{soloGroundClearance=clamp(Number(soloClearanceSlider.value),.5,5);localStorage.setItem("arondight45GroundClearance",String(soloGroundClearance));soloControls.groundClearance=soloGroundClearance;updateSoloSticks();};
soloStick($("soloLeft"),"left");soloStick($("soloRight"),"right");updateSoloSticks();'''
replace_once(sim, old_solo, new_solo)

for old, new in [
    ('onChange:next=>{phoneSettings=next;soloControls=neutralControls();updateSoloSticks();arm=false;throttle=0;},', 'onChange:next=>{phoneSettings=next;soloControls=neutralSoloControls();updateSoloSticks();arm=false;throttle=0;},'),
    ('soloMode=true;soloPreviousInputSource=inputSource;phoneSettings=loadPhoneControlSettings();soloControls=neutralControls();updateSoloSticks();', 'soloMode=true;soloPreviousInputSource=inputSource;phoneSettings=loadPhoneControlSettings();soloGroundClearance=clamp(Number(localStorage.getItem("arondight45GroundClearance"))||soloGroundClearance,.5,5);soloClearanceSlider.value=String(soloGroundClearance);soloControls=neutralSoloControls();updateSoloSticks();'),
    ('soloControls=neutralControls();updateSoloSticks();localArm=false;arm=false;localThrottle=0;inputSource=soloPreviousInputSource;', 'soloControls=neutralSoloControls();updateSoloSticks();localArm=false;arm=false;localThrottle=0;inputSource=soloPreviousInputSource;'),
    ('$("soloArm").onclick=()=>{if(soloControls.arm){soloControls.arm=false;return;}if(sharedArmReady(currentFcStateText(),soloControls,true,phoneSettings))soloControls.arm=true;};', '$("soloArm").onclick=()=>{if(soloControls.arm){soloControls.arm=false;return;}if((latest.state&STATE_NAVIGATION_VALID)&&sharedArmReady(currentFcStateText(),soloControls,true,phoneSettings))soloControls.arm=true;};'),
    ('$("soloKill").onclick=()=>{soloControls=neutralControls();updateSoloSticks();arm=false;throttle=0;};', '$("soloKill").onclick=()=>{soloControls=neutralSoloControls();updateSoloSticks();arm=false;throttle=0;};'),
    ('soloControls=neutralControls();updateSoloSticks();localThrottle=throttle=0;', 'soloControls=neutralSoloControls();updateSoloSticks();localThrottle=throttle=0;'),
]:
    replace_once(sim, old, new)

replace_once(
    sim,
    '$("soloAlt").textContent=Math.max(0,state.z).toFixed(1)+" m";',
    '$("soloAlt").textContent=`AGL ${latestNavigation.valid?latestNavigation.agl.toFixed(1):"—"} m`;soloRangeStatus.textContent=latestNavigation.valid?`AGL ${latestNavigation.agl.toFixed(1)} m`:"NAV INVALID";soloRangeStatus.style.color=latestNavigation.valid?"#64e0ae":"#ffd06d";',
)
replace_once(
    sim,
    'soloArm.disabled=!soloControls.arm&&!sharedArmReady(stateText,soloControls,true,phoneSettings);',
    'soloArm.disabled=!soloControls.arm&&(!(fcState&STATE_NAVIGATION_VALID)||!sharedArmReady(stateText,soloControls,true,phoneSettings));',
)

# Remote GAME honors the existing optional horizontal locks as input-device locks.
controller = "sim/controller.mjs"
replace_once(controller, 'left={x:inversePhoneAxis(controls.roll,phoneSettings.leftFineness),y:-inversePhoneAxis(controls.pitch,phoneSettings.leftFineness)};', 'left={x:phoneSettings.lockLeftHorizontal?0:inversePhoneAxis(controls.roll,phoneSettings.leftFineness),y:-inversePhoneAxis(controls.pitch,phoneSettings.leftFineness)};')
replace_once(controller, 'right={x:inversePhoneAxis(controls.yaw,phoneSettings.rightFineness),y:-inversePhoneAxis(controls.lookPitch||0,phoneSettings.rightFineness)};', 'right={x:inversePhoneAxis(controls.yaw,phoneSettings.rightFineness),y:phoneSettings.lockRightHorizontal?0:-inversePhoneAxis(controls.lookPitch||0,phoneSettings.rightFineness)};')
replace_once(controller, 'controls.roll=phoneAxis(point.x,phoneSettings.leftFineness);', 'controls.roll=phoneSettings.lockLeftHorizontal?0:phoneAxis(point.x,phoneSettings.leftFineness);')
replace_once(controller, 'controls.lookPitch=phoneAxis(-point.y,phoneSettings.rightFineness);', 'controls.lookPitch=phoneSettings.lockRightHorizontal?0:phoneAxis(-point.y,phoneSettings.rightFineness);')

# Runtime regression: deliberate measured drift may not block GAME arming.
test = "tests/state_control_test.cpp"
marker = '    // GAME runtime must fail closed if navigation measurements disappear.\n'
insertion = '''    // GAME arming remains governed by the production Runtime. Measured drift
    // before take-off must not manufacture attitude commands that block arming.
    fc::StateRuntime arming_runtime;
    fc::StateRuntimeInput arming_input{};
    arming_input.flight.raw = {{0.0f, 0.0f, 1.0f}, {0.0f, 0.0f, 0.0f}};
    arming_input.flight.rc = base_rc(false);
    arming_input.flight.rc.valid = true;
    arming_input.flight.rc_fresh = true;
    arming_input.flight.imu_valid = true;
    arming_input.flight.dt_us = 1000;
    arming_input.navigation = {{1.5f, -1.2f, 0.0f}, 0.03f, true};
    fc::RuntimeOutput arm_out{};
    uint64_t arm_time_us = 0;
    for (uint32_t i = 0; i < fc::kCalibrationSamples + 50; ++i) {
        arm_time_us += 1000;
        arming_input.flight.now_us = arm_time_us;
        arm_out = arming_runtime.step(arming_input);
    }
    CHECK((arm_out.state & fc::kStateCalibrating) == 0);
    arming_input.flight.rc = base_rc(true);
    for (int i = 0; i < 1100; ++i) {
        arm_time_us += 1000;
        arming_input.flight.now_us = arm_time_us;
        arm_out = arming_runtime.step(arming_input);
    }
    CHECK(arm_out.armed);
    CHECK((arm_out.state & fc::kStateArmed) != 0);
    CHECK((arm_out.state & fc::kStateGameMode) != 0);
    CHECK((arm_out.state & fc::kStateNavigationValid) != 0);

    // GAME runtime must fail closed if navigation measurements disappear.
'''
replace_once(test, marker, insertion)

# Architecture invariants codify collision-world AGL + same GAME path for Solo.
replace_once(
    "tests/architecture_invariants.mjs",
    'requireText("sim/simulator.mjs","class SimNavigationSensors");\nrequireText("sim/simulator.mjs","FLAG_NAVIGATION_VALID");',
    'requireText("sim/simulator.mjs","class SimNavigationSensors");\nrequireText("sim/simulator.mjs","b3World_CastRayClosest");\nrequireText("sim/simulator.mjs","groundRange(12)");\nrequireText("sim/simulator.mjs","neutralSoloControls");\nrequireText("sim/simulator.mjs","soloClearanceSlider");\nrequireText("sim/simulator.mjs","FLAG_NAVIGATION_VALID");',
)

# Standalone/one-phone browser E2E now validates GAME rather than legacy throttle.
browser = Path("tests/browser_sim_smoke.mjs")
s = browser.read_text()
old_ui = '''    throttle:parseFloat(document.querySelector("#throttle")?.textContent||"0"),
    leftTop:parseFloat(document.querySelector("#soloLeft .solo-knob")?.style.top||"0"),
  }));'''
new_ui = '''    throttle:parseFloat(document.querySelector("#throttle")?.textContent||"0"),
    leftTop:parseFloat(document.querySelector("#soloLeft .solo-knob")?.style.top||"0"),
    clearance:!!document.querySelector("#soloClearanceSlider"),
    clearanceValue:Number(document.querySelector("#soloClearanceSlider")?.value||0),
  }));'''
assert s.count(old_ui) == 1
s = s.replace(old_ui, new_ui, 1)
old_check = '''  if(!Object.values({hud:soloUi.hud,reset:soloUi.reset,lap:soloUi.lap,settings:soloUi.settings}).every(Boolean))
    throw new Error(`solo HUD incomplete: ${JSON.stringify(soloUi)}`);
  if(soloUi.throttle!==0||soloUi.leftTop<90)throw new Error(`solo neutral wrong: ${JSON.stringify(soloUi)}`);'''
new_check = '''  if(!Object.values({hud:soloUi.hud,reset:soloUi.reset,lap:soloUi.lap,settings:soloUi.settings,clearance:soloUi.clearance}).every(Boolean))
    throw new Error(`solo HUD incomplete: ${JSON.stringify(soloUi)}`);
  if(soloUi.throttle!==0||Math.abs(soloUi.leftTop-50)>1||Math.abs(soloUi.clearanceValue-2)>.01)throw new Error(`solo GAME neutral wrong: ${JSON.stringify(soloUi)}`);'''
assert s.count(old_check) == 1
s = s.replace(old_check, new_check, 1)
start = s.index('  // Critical touch regression: touching the retained-throttle stick at screen')
end = s.index('  const beforeReset=await simTime();', start)
replacement = '''  // One-phone mode uses exactly the same GAME/STATE contract as two-phone mode.
  await page.waitForFunction(()=>document.querySelector("#soloRangeStatus")?.textContent?.includes("AGL"),{timeout:15000});
  await page.waitForFunction(()=>{const b=document.querySelector("#soloArm");return b&&!b.disabled&&b.textContent.trim()==="ARM";},{timeout:15000});
  const armStart=await simTime();await page.click("#soloArm");await waitForSimTime(armStart+1.25,50000);
  state=await page.$eval("#fcState",e=>e.textContent||"");
  if(state!=="ARMED")throw new Error(`solo GAME ARM failed: ${JSON.stringify(await snapshot())}`);
  await page.waitForFunction(()=>{const z=parseFloat(document.querySelector("#altitude")?.textContent||"0");return z>1.5&&z<2.5;},{timeout:60000});
  const holdStart=await simTime();await waitForSimTime(holdStart+.6,35000);
  const holdAltitude=await page.$eval("#altitude",e=>parseFloat(e.textContent||"0"));
  if(!(holdAltitude>1.3&&holdAltitude<2.7))throw new Error(`solo 2m AGL hold failed: ${holdAltitude}`);

  const left=await pointerDownOnly("#soloLeft");
  await page.mouse.move(left.cx,left.cy-left.r*.65,{steps:6});
  const moveStart=await simTime();await waitForSimTime(moveStart+.55,30000);
  const moving=await page.$eval("#velocity",e=>parseFloat(e.textContent||"0"));
  if(moving<.55)throw new Error(`solo desired forward vector did not accelerate: ${moving}`);
  await page.mouse.up();
  const brakeStart=await simTime();await waitForSimTime(brakeStart+1.5,50000);
  const braked=await page.$eval("#velocity",e=>parseFloat(e.textContent||"0"));
  if(braked>Math.max(.8,moving*.75))throw new Error(`solo zero-vector braking failed: moving=${moving}, after=${braked}`);

  const yawBefore=await page.$eval("#attitude",e=>Number(((e.textContent||"").match(/-?\\d+(?:\\.\\d+)?/g)||[])[2]||0));
  const right=await pointerDownOnly("#soloRight");
  await page.mouse.move(right.cx+right.r*.45,right.cy-right.r*.2,{steps:5});
  const turnStart=await simTime();await waitForSimTime(turnStart+.25,25000);await page.mouse.up();
  const yawAfter=await page.$eval("#attitude",e=>Number(((e.textContent||"").match(/-?\\d+(?:\\.\\d+)?/g)||[])[2]||0));
  let yawDelta=(yawAfter-yawBefore)%360;if(yawDelta>180)yawDelta-=360;if(yawDelta<-180)yawDelta+=360;
  if(Math.abs(yawDelta)<4)throw new Error(`solo heading control failed: ${yawBefore} -> ${yawAfter}`);

  const killStart=await simTime();await page.click("#soloKill");await waitForSimTime(killStart+.03,10000);
  state=await page.$eval("#fcState",e=>e.textContent||"");
  const killed=await page.$eval("#motors",e=>(e.textContent||"").trim().split(/\\s+/).map(Number));
  if(state!=="DISARMED"||!killed.every(v=>v===1000))throw new Error(`solo GAME KILL failed: ${JSON.stringify(await snapshot())}`);

'''
s = s[:start] + replacement + s[end:]
s = s.replace(
    'Browser SIL E2E passed: shared WASM FC, FC-authoritative arming gates, FPV tilt, V4 phone settings, no throttle teleport, live right gimbal, race/reset, ARM/KILL, local fallback and responsive layout.',
    'Browser SIL E2E passed: shared WASM GAME/STATE FC, raycast AGL, one-phone vector/heading control, FC-authoritative arming, race/reset, local fallback and responsive layout.',
)
browser.write_text(s)
