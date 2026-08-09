from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    s = p.read_text()
    assert s.count(old) == 1, (path, s.count(old), old[:120])
    p.write_text(s.replace(old, new, 1))


Path("sim/camera_settings.mjs").write_text(r'''export const CAMERA_SETTINGS_KEY="arondight45CameraSettingsV1";
export const DEFAULT_CAMERA_SETTINGS=Object.freeze({fpvTiltDeg:30,fpvFovDeg:84,thirdDistanceM:2.5});
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
export function normalizeCameraSettings(value={}){
  return{
    fpvTiltDeg:clamp(Number.isFinite(+value.fpvTiltDeg)?+value.fpvTiltDeg:DEFAULT_CAMERA_SETTINGS.fpvTiltDeg,-15,50),
    fpvFovDeg:clamp(Number.isFinite(+value.fpvFovDeg)?+value.fpvFovDeg:DEFAULT_CAMERA_SETTINGS.fpvFovDeg,50,120),
    thirdDistanceM:clamp(Number.isFinite(+value.thirdDistanceM)?+value.thirdDistanceM:DEFAULT_CAMERA_SETTINGS.thirdDistanceM,1.5,6),
  };
}
export function loadCameraSettings(){
  try{const raw=localStorage.getItem(CAMERA_SETTINGS_KEY);return normalizeCameraSettings(raw?JSON.parse(raw):DEFAULT_CAMERA_SETTINGS);}catch{return normalizeCameraSettings(DEFAULT_CAMERA_SETTINGS);}
}
export function saveCameraSettings(settings){const next=normalizeCameraSettings(settings);try{localStorage.setItem(CAMERA_SETTINGS_KEY,JSON.stringify(next));}catch{}return next;}
export function mountCameraSettings({dialog,onChange=()=>{}}={}){
  if(!dialog)throw Error("camera settings dialog required");
  let settings=loadCameraSettings();
  const section=document.createElement("section");section.className="camera-settings-section";
  section.innerHTML=`
    <h4>CAMERA</h4>
    <div class="phone-settings-row"><label>FPV VERTICAL TILT</label><output data-camera-out="tilt"></output><input data-camera-slider="tilt" type="range" min="-15" max="50" step="1"><div class="phone-settings-scale"><span>DOWN</span><span>UP</span></div></div>
    <div class="phone-settings-row"><label>FPV FOV</label><output data-camera-out="fov"></output><input data-camera-slider="fov" type="range" min="50" max="120" step="1"><div class="phone-settings-scale"><span>NARROW</span><span>WIDE</span></div></div>
    <div class="phone-settings-row"><label>THIRD PERSON DISTANCE</label><output data-camera-out="third"></output><input data-camera-slider="third" type="range" min="1.5" max="6" step="0.1"><div class="phone-settings-scale"><span>NEAR</span><span>FAR</span></div></div>
    <p class="phone-settings-note">Camera-only optics. These values never alter aircraft attitude, motor commands, flight-controller code or physics.</p>`;
  const actions=dialog.querySelector(".phone-settings-actions");dialog.insertBefore(section,actions);
  const tilt=section.querySelector('[data-camera-slider="tilt"]'),fov=section.querySelector('[data-camera-slider="fov"]'),third=section.querySelector('[data-camera-slider="third"]');
  const tiltOut=section.querySelector('[data-camera-out="tilt"]'),fovOut=section.querySelector('[data-camera-out="fov"]'),thirdOut=section.querySelector('[data-camera-out="third"]');
  const render=()=>{tilt.value=String(settings.fpvTiltDeg);fov.value=String(settings.fpvFovDeg);third.value=String(settings.thirdDistanceM);tiltOut.value=`${Math.round(settings.fpvTiltDeg)}°`;fovOut.value=`${Math.round(settings.fpvFovDeg)}°`;thirdOut.value=`${settings.thirdDistanceM.toFixed(1)} m`;};
  const apply=()=>{settings=saveCameraSettings({fpvTiltDeg:+tilt.value,fpvFovDeg:+fov.value,thirdDistanceM:+third.value});render();onChange({...settings});};
  for(const input of [tilt,fov,third])input.addEventListener("input",apply);
  dialog.querySelector("[data-reset]")?.addEventListener("click",()=>{settings=saveCameraSettings(DEFAULT_CAMERA_SETTINGS);render();onChange({...settings});});
  render();onChange({...settings});
  return{section,get settings(){return{...settings};},reload(){settings=loadCameraSettings();render();onChange({...settings});return{...settings};}};
}
''')

replace_once(
    "sim/control_settings.mjs",
    '.phone-settings-dialog{width:min(92vw,390px)!important;border:1px solid #ffffff44!important;border-radius:14px!important;background:#0b1420f4!important;color:#fff!important;padding:16px!important;box-shadow:0 20px 70px #000a!important}',
    '.phone-settings-dialog{width:min(92vw,390px)!important;max-height:90dvh!important;overflow:auto!important;border:1px solid #ffffff44!important;border-radius:14px!important;background:#0b1420f4!important;color:#fff!important;padding:16px!important;box-shadow:0 20px 70px #000a!important}',
)
replace_once(
    "sim/control_settings.mjs",
    '  .phone-settings-dialog h3{margin:0 0 5px;font:800 17px system-ui,-apple-system,sans-serif}\n',
    '  .phone-settings-dialog h3{margin:0 0 5px;font:800 17px system-ui,-apple-system,sans-serif}\n  .camera-settings-section{margin-top:18px;padding-top:4px;border-top:2px solid #ffffff2b}\n  .camera-settings-section h4{margin:12px 0 4px;font:850 14px system-ui,-apple-system,sans-serif;letter-spacing:.08em;color:#6be4b0}\n',
)

replace_once(
    "sim/simulator.mjs",
    'import {loadPhoneControlSettings,mountPhoneControlSettings} from "./control_settings.mjs";\n',
    'import {loadPhoneControlSettings,mountPhoneControlSettings} from "./control_settings.mjs";\nimport {loadCameraSettings,mountCameraSettings} from "./camera_settings.mjs";\n',
)
replace_once(
    "sim/simulator.mjs",
    'let cameraMode=["follow","fpv","third"].includes(savedCameraMode)?savedCameraMode:"follow",cameraFollowInitialized=false;\nconst followHeading=new THREE.Vector3(-1,0,0),thirdHeading=new THREE.Vector3(-1,0,0);\nconst FPV_CAMERA_UPTILT_DEG=30,FPV_CAMERA_UPTILT_RAD=FPV_CAMERA_UPTILT_DEG*Math.PI/180;\n$("viewport").dataset.fpvTiltDeg=String(FPV_CAMERA_UPTILT_DEG);\n',
    'let cameraMode=["follow","fpv","third"].includes(savedCameraMode)?savedCameraMode:"follow",cameraFollowInitialized=false;\nconst followHeading=new THREE.Vector3(-1,0,0),thirdHeading=new THREE.Vector3(-1,0,0);\nlet cameraSettings=loadCameraSettings();\nfunction applyCameraSettings(next){cameraSettings=next;cameraFollowInitialized=false;$("viewport").dataset.fpvTiltDeg=String(cameraSettings.fpvTiltDeg);$("viewport").dataset.fpvFovDeg=String(cameraSettings.fpvFovDeg);$("viewport").dataset.thirdCameraDistanceM=String(cameraSettings.thirdDistanceM);}\napplyCameraSettings(cameraSettings);\n',
)
replace_once(
    "sim/simulator.mjs",
    '    const c=Math.cos(FPV_CAMERA_UPTILT_RAD),si=Math.sin(FPV_CAMERA_UPTILT_RAD);\n',
    '    const fpvTiltRad=cameraSettings.fpvTiltDeg*Math.PI/180,c=Math.cos(fpvTiltRad),si=Math.sin(fpvTiltRad);\n',
)
replace_once(
    "sim/simulator.mjs",
    '    if(camera.fov!==84){camera.fov=84;camera.updateProjectionMatrix();}\n    return;\n',
    '    if(camera.fov!==cameraSettings.fpvFovDeg){camera.fov=cameraSettings.fpvFovDeg;camera.updateProjectionMatrix();}\n    $("viewport").dataset.cameraFov=String(camera.fov);$("viewport").dataset.cameraTiltDeg=String(cameraSettings.fpvTiltDeg);$("viewport").dataset.cameraDistanceM="0";\n    return;\n',
)
replace_once(
    "sim/simulator.mjs",
    '    const desired=position.clone().addScaledVector(thirdHeading,-2.25);desired.z+=1.05;\n    const look=position.clone().addScaledVector(thirdHeading,.55);look.z+=.18;\n',
    '    const thirdBaseLength=Math.hypot(2.25,1.05),thirdBack=cameraSettings.thirdDistanceM*(2.25/thirdBaseLength),thirdUp=cameraSettings.thirdDistanceM*(1.05/thirdBaseLength);\n    const desired=position.clone().addScaledVector(thirdHeading,-thirdBack);desired.z+=thirdUp;\n    const look=position.clone().addScaledVector(thirdHeading,.55);look.z+=.18;\n',
)
replace_once(
    "sim/simulator.mjs",
    '    if(camera.fov!==62){camera.fov=62;camera.updateProjectionMatrix();}\n    return;\n',
    '    if(camera.fov!==62){camera.fov=62;camera.updateProjectionMatrix();}\n    $("viewport").dataset.cameraFov=String(camera.fov);$("viewport").dataset.cameraTiltDeg="0";$("viewport").dataset.cameraDistanceM=String(camera.position.distanceTo(position));\n    return;\n',
)
replace_once(
    "sim/simulator.mjs",
    'mountPhoneControlSettings({\n  parent:$("soloTopbar"),\n  buttonText:"SETTINGS",\n  onChange:next=>{phoneSettings=next;const keepArm=soloControls.arm;soloControls=neutralSoloControls();soloControls.arm=keepArm;updateSoloSticks();arm=keepArm;throttle=0;},\n});\n',
    'const soloSettingsMount=mountPhoneControlSettings({\n  parent:$("soloTopbar"),\n  buttonText:"SETTINGS",\n  onChange:next=>{phoneSettings=next;const keepArm=soloControls.arm;soloControls=neutralSoloControls();soloControls.arm=keepArm;updateSoloSticks();arm=keepArm;throttle=0;},\n});\nmountCameraSettings({dialog:soloSettingsMount.dialog,onChange:applyCameraSettings});\n',
)

replace_once(
    "sim/simulator.mjs",
    'this.viewport.dataset.motorAudioArmEvent="idle";}\n',
    'this.viewport.dataset.motorAudioArmEvent="idle";this.viewport.dataset.motorAudioEscToneCount="0";}\n',
)
replace_once(
    "sim/simulator.mjs",
    '    const start=this.ctx.currentTime+Math.max(0,offsetSec),stop=start+Math.max(.025,durationSec);\n',
    '    const start=this.ctx.currentTime+Math.max(0,offsetSec),stop=start+Math.max(.025,durationSec);this.viewport.dataset.motorAudioEscToneCount=String((Number(this.viewport.dataset.motorAudioEscToneCount)||0)+1);\n',
)

replace_once(
    "tests/browser_sim_smoke.mjs",
    "  await page.click('.phone-settings-dialog [data-close]');\n\n  await waitForSimTime(2.2,60000);\n",
    '''  await page.$eval('.phone-settings-dialog [data-camera-slider="tilt"]',e=>{e.value="18";e.dispatchEvent(new Event("input",{bubbles:true}));});
  await page.$eval('.phone-settings-dialog [data-camera-slider="fov"]',e=>{e.value="101";e.dispatchEvent(new Event("input",{bubbles:true}));});
  await page.$eval('.phone-settings-dialog [data-camera-slider="third"]',e=>{e.value="3.6";e.dispatchEvent(new Event("input",{bubbles:true}));});
  const storedCamera=await page.evaluate(()=>JSON.parse(localStorage.getItem("arondight45CameraSettingsV1")||"{}"));
  if(storedCamera.fpvTiltDeg!==18||storedCamera.fpvFovDeg!==101||Math.abs(storedCamera.thirdDistanceM-3.6)>.001)throw new Error(`camera settings did not persist: ${JSON.stringify(storedCamera)}`);
  await page.click('.phone-settings-dialog [data-close]');

  await waitForSimTime(2.2,60000);
''',
)
replace_once(
    "tests/browser_sim_smoke.mjs",
    '  const armStart=await simTime();await page.click("#soloArm");await waitForSimTime(armStart+1.25,50000);\n',
    '  const escToneStart=await page.$eval("#viewport",e=>Number(e.dataset.motorAudioEscToneCount)||0);\n  const armStart=await simTime();await page.click("#soloArm");await waitForSimTime(armStart+1.25,50000);\n',
)
replace_once(
    "tests/browser_sim_smoke.mjs",
    '  const audioDrive=await page.$eval("#viewport",e=>({source:e.dataset.motorAudioSource,hz:Number(e.dataset.motorAudioHz),power:Number(e.dataset.motorAudioPowerW)}));\n  if(audioDrive.source!=="motorOmega+motorTorque+propTorque"||!(audioDrive.hz>20)||!(audioDrive.power>0))throw new Error(`motor sound is not driven by live rotor physics: ${JSON.stringify(audioDrive)}`);\n',
    '''  const audioDrive=await page.$eval("#viewport",e=>({source:e.dataset.motorAudioSource,hz:Number(e.dataset.motorAudioHz),power:Number(e.dataset.motorAudioPowerW),gain:Number(e.dataset.motorAudioGain),context:e.dataset.motorAudioContextState,armEvent:e.dataset.motorAudioArmEvent,escTones:Number(e.dataset.motorAudioEscToneCount)||0}));
  if(audioDrive.source!=="motorOmega+motorTorque+propTorque:2bladeBPF"||!(audioDrive.hz>20)||!(audioDrive.power>0)||!(audioDrive.gain>0)||audioDrive.context!=="running"||audioDrive.armEvent!=="armed"||audioDrive.escTones<escToneStart+4)throw new Error(`physics/ESC audio runtime failed: ${JSON.stringify(audioDrive)}`);
  await page.click("#soloCamera");await page.click("#soloCamera");
  await page.waitForFunction(()=>document.querySelector("#viewport")?.dataset.cameraMode==="fpv",{timeout:5000});
  const fpvOptics=await page.$eval("#viewport",e=>({fov:Number(e.dataset.cameraFov),tilt:Number(e.dataset.cameraTiltDeg)}));
  if(fpvOptics.fov!==101||fpvOptics.tilt!==18)throw new Error(`FPV optics settings not applied: ${JSON.stringify(fpvOptics)}`);
  await page.click("#soloCamera");await page.click("#soloCamera");
  await page.waitForFunction(()=>document.querySelector("#viewport")?.dataset.cameraMode==="third",{timeout:5000});
  const thirdDistance=await page.$eval("#viewport",e=>Number(e.dataset.cameraDistanceM));
  if(!(thirdDistance>3.45&&thirdDistance<3.75))throw new Error(`third-person camera distance not applied: ${thirdDistance}`);
''',
)
replace_once(
    "tests/browser_sim_smoke.mjs",
    '  if(state!=="DISARMED"||!killed.every(v=>v===1000))throw new Error(`solo GAME KILL failed: ${JSON.stringify(await snapshot())}`);\n\n',
    '  if(state!=="DISARMED"||!killed.every(v=>v===1000))throw new Error(`solo GAME KILL failed: ${JSON.stringify(await snapshot())}`);\n  await page.waitForFunction(()=>document.querySelector("#viewport")?.dataset.motorAudioArmEvent==="disarmed",{timeout:5000});\n  const killAudio=await page.$eval("#viewport",e=>({event:e.dataset.motorAudioArmEvent,escTones:Number(e.dataset.motorAudioEscToneCount)||0}));\n  if(killAudio.event!=="disarmed"||killAudio.escTones<audioDrive.escTones+2)throw new Error(`ESC disarm tones did not fire: ${JSON.stringify(killAudio)}`);\n\n',
)
replace_once(
    "tests/browser_sim_smoke.mjs",
    '  console.log("Browser SIL E2E passed: shared WASM GAME/STATE FC, raycast AGL slider, one-phone forward/strafe/braking, real nose-up body-pitch + heading control, both right-axis inversions, both axis locks, FC-authoritative arming, race/reset, local fallback and responsive layout.");\n',
    '  console.log("Browser SIL E2E passed: shared WASM GAME/STATE FC, raycast AGL slider, one-phone forward/strafe/braking, real nose-up body-pitch + heading control, persisted FPV tilt/FOV + third-person distance, live rotor-physics audio, FC-driven ESC arm/disarm tones, axis settings, FC-authoritative arming, race/reset, local fallback and responsive layout.");\n',
)

replace_once(
    "tests/architecture_invariants.mjs",
    'for(const marker of ["class MotorSound","model.motorOmega","model.motorTorque","model.propTorque","motorAudioPowerW","escWindingTone","armToneSequence","motorAudioArmEvent","motorSound.syncFcState(fcState,arm)"])requireText("sim/simulator.mjs",marker);\n',
    'for(const marker of ["class MotorSound","model.motorOmega","model.motorTorque","model.propTorque","motorAudioPowerW","escWindingTone","armToneSequence","motorAudioArmEvent","motorAudioEscToneCount","motorSound.syncFcState(fcState,arm)"])requireText("sim/simulator.mjs",marker);\nfor(const marker of ["loadCameraSettings","mountCameraSettings","cameraSettings.fpvTiltDeg","cameraSettings.fpvFovDeg","cameraSettings.thirdDistanceM","camera.position.distanceTo(position)"])requireText("sim/simulator.mjs",marker);\nfor(const marker of ["FPV VERTICAL TILT","FPV FOV","THIRD PERSON DISTANCE","arondight45CameraSettingsV1"])requireText("sim/camera_settings.mjs",marker);\n',
)

replace_once(".github/workflows/deploy.yml", "  cancel-in-progress: false\n", "  cancel-in-progress: true\n")
replace_once(
    ".github/workflows/deploy.yml",
    "          node --check sim/control_settings.mjs\n          node --check sim/solo_layout.mjs\n",
    "          node --check sim/control_settings.mjs\n          node --check sim/camera_settings.mjs\n          node --check sim/solo_layout.mjs\n",
)
