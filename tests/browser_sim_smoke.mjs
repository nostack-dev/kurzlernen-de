import puppeteer from "puppeteer-core";

const url=process.argv[2]||"http://127.0.0.1:4173/drone_simulator.html";
const executablePath=process.env.CHROME_BIN;
if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");

const browser=await puppeteer.launch({
  headless:true,executablePath,
  args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader"],
});
const page=await browser.newPage(),errors=[],externalRequests=[];
page.on("pageerror",e=>errors.push(`pageerror: ${e.message}`));
page.on("console",m=>{if(m.type()==="error")errors.push(`console: ${m.text()}`);});
page.on("request",request=>{
  const u=new URL(request.url());
  if(u.hostname!=="127.0.0.1"&&u.hostname!=="localhost")externalRequests.push(request.url());
});
// This broad SIL test is the deterministic no-GPS/no-WORLD startup path. The
// dedicated WORLD tests grant a real fixture location and validate auto-WORLD.
await page.evaluateOnNewDocument(()=>{
  Object.defineProperty(navigator,"geolocation",{configurable:true,value:{
    getCurrentPosition(_success,error){queueMicrotask(()=>error?.({code:1,message:"CI geolocation denied"}));},
  }});
});

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitForSimTime(target,timeout=60000){
  await page.waitForFunction(t=>parseFloat(document.querySelector("#simTime")?.textContent||"0")>=t,{timeout},target);
}
async function simTime(){return page.$eval("#simTime",e=>parseFloat(e.textContent||"0"));}
async function snapshot(){return page.evaluate(()=>({
  simTime:document.querySelector("#simTime")?.textContent||"",
  state:document.querySelector("#fcState")?.textContent||"",
  motors:document.querySelector("#motors")?.textContent||"",
  attitude:document.querySelector("#attitude")?.textContent||"",
  throttle:document.querySelector("#throttle")?.textContent||"",
}));}
async function stickGeometry(selector){
  return page.$eval(selector,e=>{const r=e.getBoundingClientRect();return{x:r.left,y:r.top,width:r.width,height:r.height};});
}
async function dragDelta(selector,dx,dy,{holdMs=0}={}){
  const b=await stickGeometry(selector),r=Math.min(b.width,b.height)*.42,cx=b.x+b.width/2,cy=b.y+b.height/2;
  await page.mouse.move(cx,cy);await page.mouse.down();await page.mouse.move(cx+r*dx,cy+r*dy,{steps:6});
  if(holdMs)await wait(holdMs);
  await page.mouse.up();
}
async function pointerDownOnly(selector){
  const b=await stickGeometry(selector),cx=b.x+b.width/2,cy=b.y+b.height/2;
  await page.mouse.move(cx,cy);await page.mouse.down();return{cx,cy,r:Math.min(b.width,b.height)*.42};
}

async function latestFlightSample(){
  return page.evaluate(async()=>{
    const original=URL.createObjectURL;let captured=null;
    URL.createObjectURL=blob=>{captured=blob;return original.call(URL,blob);};
    try{document.querySelector("#exportLog")?.click();await new Promise(resolve=>setTimeout(resolve,0));if(!captured)throw new Error("flight log blob was not captured");const log=JSON.parse(await captured.text()),samples=log?.samples||[];if(!samples.length)throw new Error("flight log has no samples");return samples[samples.length-1];}
    finally{URL.createObjectURL=original;}
  });
}
function bodyMotion(sample){
  const yawRad=(Number(sample.yaw_deg)||0)*Math.PI/180,c=Math.cos(yawRad),s=Math.sin(yawRad),vx=Number(sample.vx)||0,vy=Number(sample.vy)||0,vz=Number(sample.vz)||0;
  return{forward:-c*vx-s*vy,right:-s*vx+c*vy,horizontal:Math.hypot(vx,vy),vertical:vz,altitude:Number(sample.z)||0,yaw:Number(sample.yaw_deg)||0,pitch:Number(sample.pitch_deg)||0};
}

try{
  await page.setViewport({width:1280,height:900,deviceScaleFactor:1});
  await page.goto(url,{waitUntil:"load",timeout:30000});
  await page.waitForFunction(()=>document.querySelector("#status")?.textContent.includes("SIM ready"),{timeout:30000});
  await page.waitForFunction(()=>document.body.classList.contains("solo-flight")&&document.querySelector("#viewport")?.dataset.cameraMode==="fpv",{timeout:5000});

  const boot=await page.evaluate(()=>({
    title:document.title,status:document.querySelector("#status")?.textContent||"",
    controller:document.querySelector("#tController")?.textContent||"",
    canvasCount:document.querySelectorAll("canvas").length,
    mode:document.querySelector("#tMode")?.textContent||"",
    scripts:[...document.scripts].filter(s=>s.src).map(s=>s.src),
    modelValidation:document.querySelector("#modelValidationStatus")?.dataset.validation||"",
    modelValidationText:document.querySelector("#modelValidationStatus")?.textContent||"",
  }));
  if(boot.title!=="Arondight45 Drone Digital Twin"||!boot.status.includes("SIM ready")||
     !boot.controller.includes("shared fc::StateRuntime → fc::Runtime / WASM")||boot.canvasCount<1||boot.mode!=="SIM"||boot.modelValidation!=="unvalidated"||!boot.modelValidationText.includes("UNVALIDATED"))
    throw new Error(`boot mismatch: ${JSON.stringify(boot)}`);
  const remoteScripts=boot.scripts.filter(src=>{const u=new URL(src);return u.hostname!=="127.0.0.1"&&u.hostname!=="localhost";});
  if(remoteScripts.length||externalRequests.length)throw new Error(`self-contained fallback made external requests: scripts=${JSON.stringify(remoteScripts)} requests=${JSON.stringify(externalRequests)}`);

  const cameraBoot=await page.evaluate(()=>({
    mode:document.querySelector("#viewport")?.dataset.cameraMode||"",
    fpv:document.querySelector("#camFpv")?.dataset.active||"",
    tilt:document.querySelector("#viewport")?.dataset.fpvTiltDeg||"",
    auto:document.querySelector("#viewport")?.dataset.autoFlightStart||"",
    soloCamera:document.querySelector("#soloCamera")?.textContent?.trim()||"",
    fpvCameraUp:Number(document.querySelector("#viewport")?.dataset.fpvCameraUpOffsetM),
    initialGroundPose:document.querySelector("#viewport")?.dataset.initialAirframeGroundPose||"",
    initialVisualBottom:Number(document.querySelector("#viewport")?.dataset.initialAirframeVisualBottomM),
    panel:getComputedStyle(document.querySelector(".panel")).display,
  }));
  if(cameraBoot.mode!=="fpv"||cameraBoot.fpv!=="1"||cameraBoot.tilt!=="-15"||cameraBoot.auto!=="fpv"||cameraBoot.soloCamera!=="FPV"||cameraBoot.fpvCameraUp!==.060||cameraBoot.initialGroundPose!=="1"||cameraBoot.initialVisualBottom<0||cameraBoot.panel!=="none")
    throw new Error(`direct FPV startup failed: ${JSON.stringify(cameraBoot)}`);

  // Re-enter once through the now-hidden main UI path so the legacy-settings
  // migration assertions below still begin from a deliberately clean V5 state.
  await page.click("#soloExit");
  await page.waitForFunction(()=>!document.body.classList.contains("solo-flight"),{timeout:5000});
  await page.setViewport({width:844,height:390,deviceScaleFactor:1});
  await page.evaluate(()=>{
    localStorage.setItem("arondight45PhoneControlSettingsV1",JSON.stringify({leftSensitivity:1,rightSensitivity:1}));
    localStorage.setItem("arondight45PhoneControlSettingsV2",JSON.stringify({leftSensitivity:.02,rightSensitivity:.02}));
    localStorage.setItem("arondight45PhoneControlSettingsV3",JSON.stringify({leftSensitivity:.25,rightSensitivity:.25}));
    localStorage.setItem("arondight45PhoneControlSettingsV4",JSON.stringify({leftFineness:7,rightFineness:10}));
    localStorage.removeItem("arondight45PhoneControlSettingsV5");
  });
  await page.click("#camSolo");
  await page.waitForFunction(()=>document.body.classList.contains("solo-flight"),{timeout:5000});
  await wait(700); // exclude layout/solo-transition startup from the steady-state clock proof
  const cadenceStart=await page.evaluate(()=>{const d=globalThis.__arondightDiagnostics;return{wall:performance.now(),sim:Number(d?.simTime),draws:Number(d?.presentationDraws||0),uiSim:parseFloat(document.querySelector("#simTime")?.textContent||"0")};});
  await wait(4000);
  const cadenceEnd=await page.evaluate(()=>{const d=globalThis.__arondightDiagnostics;return{wall:performance.now(),sim:Number(d?.simTime),draws:Number(d?.presentationDraws||0),backlog:Number(d?.simulationBacklogMs||0),pixelRatio:Number(d?.presentationPixelRatio||0),software:Boolean(d?.presentationSoftwareRaster),timing:d?.presentationTiming,discontinuity:Number(d?.simulationTimingDiscontinuityMs||0),uiSim:parseFloat(document.querySelector("#simTime")?.textContent||"0")};});
  if(!Number.isFinite(cadenceStart.sim)||!Number.isFinite(cadenceEnd.sim))throw new Error("authoritative simulator clock diagnostic unavailable");
  const cadenceWindowS=Math.max(.001,(cadenceEnd.wall-cadenceStart.wall)/1000),cadenceRatio=(cadenceEnd.sim-cadenceStart.sim)/cadenceWindowS,presentationDraws=cadenceEnd.draws-cadenceStart.draws,presentationFps=presentationDraws/cadenceWindowS,uiClockLag=Math.abs(cadenceEnd.sim-cadenceEnd.uiSim);
  console.log(`Realtime fixed-step cadence: ${cadenceRatio.toFixed(3)}x · presentation ${presentationFps.toFixed(1)} fps · p50 ${Number(cadenceEnd.timing?.p50Ms||0).toFixed(1)} ms · pixel ratio ${cadenceEnd.pixelRatio.toFixed(2)} · backlog ${cadenceEnd.backlog.toFixed(2)} ms · HUD lag ${uiClockLag.toFixed(3)} s`);
  if(!(cadenceRatio>.97&&cadenceRatio<1.03))throw new Error(`fixed-step simulation is not tracking wall time closely enough: ${cadenceRatio.toFixed(3)}x`);
  // SwiftShader is an intentionally non-production fallback and can be paused
  // externally by the headless runner. Its anti-jank gate is median pacing plus
  // absence of the old source-level cap; real hardware WebGL still gates 45 fps.
  const minimumPresentationFps=cadenceEnd.software?6:45;
  if(presentationFps<minimumPresentationFps)throw new Error(`presentation pacing too slow for ${cadenceEnd.software?"software":"hardware"} WebGL: ${presentationFps.toFixed(1)} fps`);
  if(cadenceEnd.timing?.samples>=20&&cadenceEnd.timing.p50Ms>(cadenceEnd.software?55:30))throw new Error(`median presentation interval is visibly jerky: ${cadenceEnd.timing.p50Ms.toFixed(1)} ms`);
  if(cadenceEnd.discontinuity!==0)throw new Error(`scheduler silently lost ${cadenceEnd.discontinuity.toFixed(2)} ms of wall time`);
  if(!(uiClockLag<.12))throw new Error(`20 Hz HUD fell too far behind authoritative simulation clock: ${uiClockLag.toFixed(3)} s`);
  const stallStart=await page.evaluate(()=>({wall:performance.now(),sim:Number(globalThis.__arondightDiagnostics?.simTime)}));
  await page.evaluate(()=>{const until=performance.now()+400;while(performance.now()<until){};});
  await wait(1000);
  const stallEnd=await page.evaluate(()=>({wall:performance.now(),sim:Number(globalThis.__arondightDiagnostics?.simTime),drop:Number(globalThis.__arondightDiagnostics?.simulationTimingDiscontinuityMs||0),backlog:Number(globalThis.__arondightDiagnostics?.simulationBacklogMs||0)}));
  const stallCadence=(stallEnd.sim-stallStart.sim)/Math.max(.001,(stallEnd.wall-stallStart.wall)/1000);
  if(stallCadence<.95||stallEnd.drop!==0||stallEnd.backlog>8)throw new Error(`400 ms compositor stall erased physical time instead of catching up: cadence=${stallCadence.toFixed(3)} drop=${stallEnd.drop.toFixed(2)} backlog=${stallEnd.backlog.toFixed(2)}`);
  const soloUi=await page.evaluate(()=>({
    hud:!document.querySelector("#soloHud")?.hidden,
    reset:!!document.querySelector("#soloReset"),
    lap:!!document.querySelector("#soloLap"),
    settings:!!document.querySelector("#soloTopbar .phone-settings-button"),
    throttle:parseFloat(document.querySelector("#throttle")?.textContent||"0"),
    leftTop:parseFloat(document.querySelector("#soloLeft .solo-knob")?.style.top||"0"),
    clearance:!!document.querySelector("#soloHeightPad"),
    clearanceValue:Number(document.querySelector("#soloClearance")?.dataset.targetAglM||0),
    clearanceMax:50,
    rightLabel:document.querySelector("#soloRight span")?.textContent||"",
  }));
  if(!Object.values({hud:soloUi.hud,reset:soloUi.reset,lap:soloUi.lap,settings:soloUi.settings,clearance:soloUi.clearance}).every(Boolean))
    throw new Error(`solo HUD incomplete: ${JSON.stringify(soloUi)}`);
  if(soloUi.throttle!==0||Math.abs(soloUi.leftTop-50)>1||Math.abs(soloUi.clearanceValue-1.2)>.01||soloUi.clearanceMax!==50||!soloUi.rightLabel.includes("PITCH"))throw new Error(`solo GAME neutral/labels wrong: ${JSON.stringify(soloUi)}`);

  await page.click("#soloTopbar .phone-settings-button");
  await page.waitForFunction(()=>document.querySelector(".phone-settings-dialog")?.open,{timeout:5000});
  const defaults=await page.evaluate(()=>({
    left:document.querySelector('.phone-settings-dialog [data-slider="left"]')?.value,
    right:document.querySelector('.phone-settings-dialog [data-slider="right"]')?.value,
    debugGrid:document.querySelector('.phone-settings-dialog [data-debug-grid]')?.checked,
    debugGridRuntime:document.querySelector("#viewport")?.dataset.debugGridEnabled,
    lock:document.querySelector('.phone-settings-dialog [data-lock-horizontal]')?.checked,
    lockLeft:document.querySelector('.phone-settings-dialog [data-lock-left-horizontal]')?.checked,
    invertLeft:document.querySelector('.phone-settings-dialog [data-invert-left-horizontal]')?.checked,
    invertX:document.querySelector('.phone-settings-dialog [data-invert-right-horizontal]')?.checked,
    invertY:document.querySelector('.phone-settings-dialog [data-invert-right-vertical]')?.checked,
    xbox:document.querySelector('.phone-settings-dialog [data-xbox-controller]')?.checked,
    rightLockLabel:document.querySelector('.phone-settings-dialog [data-lock-horizontal]')?.parentElement?.textContent||"",
    hover:document.querySelector('.phone-settings-dialog [data-slider="hover"]')?.value,
    hoverMax:document.querySelector('.phone-settings-dialog [data-slider="hover"]')?.max,
    cameraTilt:document.querySelector('.phone-settings-dialog [data-camera-slider="tilt"]')?.value,
    cameraFov:document.querySelector('.phone-settings-dialog [data-camera-slider="fov"]')?.value,
    cameraThird:document.querySelector('.phone-settings-dialog [data-camera-slider="third"]')?.value,
    v1:localStorage.getItem("arondight45PhoneControlSettingsV1"),
    v2:localStorage.getItem("arondight45PhoneControlSettingsV2"),
    v3:localStorage.getItem("arondight45PhoneControlSettingsV3"),
    v4:localStorage.getItem("arondight45PhoneControlSettingsV4"),
  }));
  if(defaults.left!=="10"||defaults.right!=="10"||defaults.debugGrid!==false||defaults.debugGridRuntime!=="0"||defaults.hover!=="1.2"||defaults.hoverMax!=="50"||defaults.lock!==false||defaults.lockLeft!==false||defaults.invertLeft!==false||defaults.invertX!==false||defaults.invertY!==true||defaults.xbox!==false||defaults.cameraTilt!=="-15"||defaults.cameraFov!=="105"||defaults.cameraThird!=="1.5"||!defaults.rightLockLabel.includes("VERTICAL AXIS"))
    throw new Error(`clean V5 requested defaults/settings labels wrong: ${JSON.stringify(defaults)}`);
  if(defaults.v1!==null||defaults.v2!==null||defaults.v3!==null||defaults.v4!==null)
    throw new Error(`obsolete phone settings V1-V4 not wiped: ${JSON.stringify(defaults)}`);

  await page.click('.phone-settings-dialog [data-invert-left-horizontal]');
  let stored=await page.evaluate(()=>JSON.parse(localStorage.getItem("arondight45PhoneControlSettingsV5")||"{}"));
  if(stored.invertLeftHorizontal!==true)throw new Error(`left horizontal invert did not persist live: ${JSON.stringify(stored)}`);
  await page.click('.phone-settings-dialog [data-invert-left-horizontal]');
  stored=await page.evaluate(()=>JSON.parse(localStorage.getItem("arondight45PhoneControlSettingsV5")||"{}"));
  if(stored.invertLeftHorizontal!==false)throw new Error(`left horizontal invert restore failed: ${JSON.stringify(stored)}`);

  await page.click('.phone-settings-dialog [data-invert-right-horizontal]');
  stored=await page.evaluate(()=>JSON.parse(localStorage.getItem("arondight45PhoneControlSettingsV5")||"{}"));
  if(stored.invertRightHorizontal!==true)throw new Error(`right horizontal invert did not persist: ${JSON.stringify(stored)}`);
  await page.click('.phone-settings-dialog [data-invert-right-horizontal]');
  await page.click('.phone-settings-dialog [data-invert-right-vertical]');
  stored=await page.evaluate(()=>JSON.parse(localStorage.getItem("arondight45PhoneControlSettingsV5")||"{}"));
  if(stored.invertRightVertical!==false)throw new Error(`right vertical invert disable did not persist: ${JSON.stringify(stored)}`);
  await page.click('.phone-settings-dialog [data-invert-right-vertical]');
  stored=await page.evaluate(()=>JSON.parse(localStorage.getItem("arondight45PhoneControlSettingsV5")||"{}"));
  if(stored.invertRightHorizontal!==false||stored.invertRightVertical!==true)throw new Error(`right-axis invert default restore failed: ${JSON.stringify(stored)}`);
  await page.click('.phone-settings-dialog [data-lock-left-horizontal]');
  stored=await page.evaluate(()=>JSON.parse(localStorage.getItem("arondight45PhoneControlSettingsV5")||"{}"));
  if(stored.lockLeftHorizontal!==true)throw new Error(`left horizontal lock did not persist: ${JSON.stringify(stored)}`);
  await page.click('.phone-settings-dialog [data-lock-left-horizontal]');
  stored=await page.evaluate(()=>JSON.parse(localStorage.getItem("arondight45PhoneControlSettingsV5")||"{}"));
  if(stored.lockLeftHorizontal!==false)throw new Error(`left horizontal unlock did not persist: ${JSON.stringify(stored)}`);
  await page.click('.phone-settings-dialog [data-lock-horizontal]');
  stored=await page.evaluate(()=>JSON.parse(localStorage.getItem("arondight45PhoneControlSettingsV5")||"{}"));
  if(stored.lockRightHorizontal!==true)throw new Error(`right vertical lock did not persist: ${JSON.stringify(stored)}`);
  await page.click('.phone-settings-dialog [data-lock-horizontal]');
  stored=await page.evaluate(()=>JSON.parse(localStorage.getItem("arondight45PhoneControlSettingsV5")||"{}"));
  if(stored.lockRightHorizontal!==false)throw new Error(`right vertical unlock did not persist: ${JSON.stringify(stored)}`);
  await page.$eval('.phone-settings-dialog [data-slider="hover"]',e=>{e.value="2.2";e.dispatchEvent(new Event("input",{bubbles:true}));});
  stored=await page.evaluate(()=>JSON.parse(localStorage.getItem("arondight45PhoneControlSettingsV5")||"{}"));
  if(Math.abs(stored.defaultHoverAgl-2.2)>.001)throw new Error(`default hover AGL did not persist: ${JSON.stringify(stored)}`);
  await page.$eval('.phone-settings-dialog [data-camera-slider="tilt"]',e=>{e.value="18";e.dispatchEvent(new Event("input",{bubbles:true}));});
  await page.$eval('.phone-settings-dialog [data-camera-slider="fov"]',e=>{e.value="101";e.dispatchEvent(new Event("input",{bubbles:true}));});
  await page.$eval('.phone-settings-dialog [data-camera-slider="third"]',e=>{e.value="3.6";e.dispatchEvent(new Event("input",{bubbles:true}));});
  const storedCamera=await page.evaluate(()=>JSON.parse(localStorage.getItem("arondight45CameraSettingsV1")||"{}"));
  if(storedCamera.fpvTiltDeg!==18||storedCamera.fpvFovDeg!==101||Math.abs(storedCamera.thirdDistanceM-3.6)>.001)throw new Error(`camera settings did not persist: ${JSON.stringify(storedCamera)}`);
  await page.click('.phone-settings-dialog [data-close]');
  const resetEpochBefore=await page.evaluate(()=>Number(globalThis.__arondightDiagnostics?.runEpoch)||0);
  await page.click("#soloReset");
  await page.waitForFunction(prev=>Number(globalThis.__arondightDiagnostics?.runEpoch)>prev,{timeout:5000},resetEpochBefore);
  await page.waitForFunction(()=>document.querySelector("#soloClearanceValue")?.textContent?.includes("2.2 m"),{timeout:5000});
  await page.waitForFunction(()=>Number(globalThis.__arondightDiagnostics?.simTime)>=2.2,{timeout:60000});
  const calibrated=await page.evaluate(()=>({sim:Number(globalThis.__arondightDiagnostics?.simTime),fc:Number(globalThis.__arondightDiagnostics?.fcState)||0,epoch:Number(globalThis.__arondightDiagnostics?.runEpoch)||0}));
  if((calibrated.fc&2)||(calibrated.fc&4)||(calibrated.fc&1))throw new Error(`solo authoritative calibration failed: ${JSON.stringify(calibrated)} snapshot=${JSON.stringify(await snapshot())}`);
  await page.waitForFunction(()=>document.querySelector("#fcState")?.textContent==="DISARMED",{timeout:1500});
  let state="DISARMED";

  await page.waitForFunction(()=>document.querySelector("#soloRangeStatus")?.textContent?.includes("AGL"),{timeout:15000});
  await page.waitForFunction(()=>{const b=document.querySelector("#soloArm");return b&&!b.disabled&&b.textContent.trim()==="ARM";},{timeout:15000});
  const escToneStart=await page.$eval("#viewport",e=>Number(e.dataset.motorAudioEscToneCount)||0);
  const armStart=await page.evaluate(()=>Number(globalThis.__arondightDiagnostics?.simTime));await page.click("#soloArm");
  await page.waitForFunction(({start,limit})=>{const d=globalThis.__arondightDiagnostics,sim=Number(d?.simTime),fc=Number(d?.fcState)||0;return Boolean(fc&1)||(Number.isFinite(sim)&&sim>=start+limit);},{timeout:15000},{start:armStart,limit:1.5});
  const armReached=await page.evaluate(()=>({sim:Number(globalThis.__arondightDiagnostics?.simTime),fc:Number(globalThis.__arondightDiagnostics?.fcState)||0}));
  if(!(armReached.fc&1)||armReached.sim-armStart>1.5)throw new Error(`solo GAME ARM authority failed: start=${armStart} reached=${JSON.stringify(armReached)} snapshot=${JSON.stringify(await snapshot())}`);
  await page.waitForFunction(()=>document.querySelector("#fcState")?.textContent==="ARMED",{timeout:1500});state="ARMED";
  const fullscreenDropStart=await page.evaluate(()=>Number(globalThis.__arondightDiagnostics?.simTime));
  await page.evaluate(async()=>{if(document.fullscreenElement&&document.exitFullscreen){try{await document.exitFullscreen();}catch{}}else document.dispatchEvent(new Event("fullscreenchange"));});
  await page.waitForFunction(start=>Number(globalThis.__arondightDiagnostics?.simTime)>=start+.30,{timeout:5000},fullscreenDropStart);
  const afterFullscreenDrop=await page.evaluate(()=>({fc:Number(globalThis.__arondightDiagnostics?.fcState)||0,solo:document.body.classList.contains("solo-flight"),armText:document.querySelector("#soloArm")?.textContent||""}));
  if(!(afterFullscreenDrop.fc&1)||!afterFullscreenDrop.solo)throw new Error(`fullscreen presentation loss disarmed/exited flight: ${JSON.stringify(afterFullscreenDrop)}`);
  await page.waitForFunction(()=>{const z=parseFloat(document.querySelector("#altitude")?.textContent||"0"),v=parseFloat(document.querySelector("#velocity")?.textContent||"99");return z>1.5&&z<2.5&&v<.70;},{timeout:90000});
  const holdStart=await simTime();await waitForSimTime(holdStart+.35,25000);
  const hold=bodyMotion(await latestFlightSample());
  if(!(hold.altitude>1.35&&hold.altitude<2.65&&Math.abs(hold.vertical)<.80))throw new Error(`solo 2m AGL hold failed: ${JSON.stringify(hold)}`);
  const audioDrive=await page.$eval("#viewport",e=>({source:e.dataset.motorAudioSource,hz:Number(e.dataset.motorAudioHz),power:Number(e.dataset.motorAudioPowerW),gain:Number(e.dataset.motorAudioGain),context:e.dataset.motorAudioContextState,armEvent:e.dataset.motorAudioArmEvent,escTones:Number(e.dataset.motorAudioEscToneCount)||0}));
  if(audioDrive.source!=="motorOmega+motorTorque+propTorque+tipSpeed:hybridBladeMotor"||!(audioDrive.hz>20)||!(audioDrive.power>0)||!(audioDrive.gain>0)||audioDrive.context!=="running"||audioDrive.armEvent!=="armed"||audioDrive.escTones<escToneStart+4)throw new Error(`physics/ESC audio runtime failed: ${JSON.stringify(audioDrive)}`);
  await page.$eval("#camFpv",e=>e.click());
  await page.waitForFunction(()=>{const v=document.querySelector("#viewport");return v?.dataset.cameraMode==="fpv"&&Number(v.dataset.cameraFov)===101&&Number(v.dataset.cameraTiltDeg)===18&&v.dataset.cameraRigMode==="rigid-airframe";},{timeout:5000});
  const fpvOptics=await page.$eval("#viewport",e=>({fov:Number(e.dataset.cameraFov),tilt:Number(e.dataset.cameraTiltDeg),rig:e.dataset.cameraRigMode,lag:Number(e.dataset.cameraRigLagM),interpolation:Number(e.dataset.presentationPoseInterpolation)}));
  if(fpvOptics.fov!==101||fpvOptics.tilt!==18||fpvOptics.rig!=="rigid-airframe"||fpvOptics.lag!==0||!(fpvOptics.interpolation>=0&&fpvOptics.interpolation<=1))throw new Error(`FPV optics/presentation pose not applied: ${JSON.stringify(fpvOptics)}`);
  await page.$eval("#camThird",e=>e.click());
  await page.waitForFunction(()=>{const v=document.querySelector("#viewport"),d=Number(v?.dataset.cameraDistanceM),lag=Number(v?.dataset.cameraRigLagM);return v?.dataset.cameraMode==="third"&&v.dataset.cameraRigMode==="stabilized-inertial-anchor"&&d>3.35&&d<3.90&&lag>=0&&lag<=.261;},{timeout:5000});
  const thirdRig=await page.$eval("#viewport",e=>({distance:Number(e.dataset.cameraDistanceM),mode:e.dataset.cameraRigMode,lag:Number(e.dataset.cameraRigLagM),anchor:e.dataset.cameraRigAnchor}));
  if(!(thirdRig.distance>3.35&&thirdRig.distance<3.90)||thirdRig.mode!=="stabilized-inertial-anchor"||!(thirdRig.lag>=0&&thirdRig.lag<=.261)||!thirdRig.anchor)throw new Error(`third-person stabilized camera not applied: ${JSON.stringify(thirdRig)}`);

  await page.$eval("#camFollow",e=>e.click());
  await page.waitForFunction(()=>{const v=document.querySelector("#viewport"),lag=Number(v?.dataset.cameraRigLagM);return v?.dataset.cameraMode==="follow"&&v.dataset.cameraRigMode==="stabilized-inertial-anchor"&&lag>=0&&lag<=.181;},{timeout:5000});

  const heightPad=await stickGeometry("#soloHeightPad"),heightX=heightPad.x+heightPad.width/2,heightY=heightPad.y+heightPad.height/2,heightSpan=heightPad.height*.40;
  const heightTargetBefore=await page.$eval("#soloClearance",e=>Number(e.dataset.targetAglM));
  await page.mouse.move(heightX,heightY);await page.mouse.down();await page.mouse.move(heightX,heightY-heightSpan,{steps:4});await wait(220);await page.mouse.up();
  const heightTargetAfter=await page.$eval("#soloClearance",e=>Number(e.dataset.targetAglM));if(!(heightTargetAfter>heightTargetBefore+.45))throw new Error(`solo spring height control did not slew target up: ${heightTargetBefore} -> ${heightTargetAfter}`);
  const clearanceStart=await simTime();await waitForSimTime(clearanceStart+.50,30000);const clearanceRise=bodyMotion(await latestFlightSample());
  if(!(clearanceRise.altitude>hold.altitude+.07||clearanceRise.vertical>.16))throw new Error(`solo height target did not command physical climb: before=${JSON.stringify(hold)}, after=${JSON.stringify(clearanceRise)}`);
  await page.mouse.move(heightX,heightY);await page.mouse.down();await page.mouse.move(heightX,heightY+heightSpan,{steps:4});await wait(220);await page.mouse.up();
  await page.waitForFunction(()=>{const z=parseFloat(document.querySelector("#altitude")?.textContent||"0"),v=parseFloat(document.querySelector("#velocity")?.textContent||"99");return z>1.5&&z<3.0&&v<.85;},{timeout:90000});

  const left=await pointerDownOnly("#soloLeft");
  await page.mouse.move(left.cx,left.cy-left.r*.65,{steps:6});
  const moveStart=await simTime();await waitForSimTime(moveStart+1.0,45000);
  const moving=bodyMotion(await latestFlightSample());
  if(moving.forward<.40)throw new Error(`solo desired forward vector did not accelerate correctly: ${JSON.stringify(moving)}`);
  await page.mouse.up();
  const brakeStart=await simTime();await waitForSimTime(brakeStart+4.0,90000);
  const braked=bodyMotion(await latestFlightSample());
  if(braked.horizontal>Math.max(.55,moving.horizontal*.80))throw new Error(`solo forward zero-vector braking failed: before=${JSON.stringify(moving)}, after=${JSON.stringify(braked)}`);

  const strafe=await pointerDownOnly("#soloLeft");
  await page.mouse.move(strafe.cx+strafe.r*.62,strafe.cy,{steps:6});
  const strafeStart=await simTime();await waitForSimTime(strafeStart+1.0,45000);
  const strafing=bodyMotion(await latestFlightSample());
  if(strafing.right<.32)throw new Error(`solo strafe vector sign/response wrong: ${JSON.stringify(strafing)}`);
  await page.mouse.up();
  const strafeBrakeStart=await simTime();await waitForSimTime(strafeBrakeStart+4.0,90000);
  const strafeBraked=bodyMotion(await latestFlightSample());
  if(strafeBraked.horizontal>Math.max(.60,strafing.horizontal*.82))throw new Error(`solo strafe braking failed: before=${JSON.stringify(strafing)}, after=${JSON.stringify(strafeBraked)}`);

  await page.click("#soloCamera");
  await page.waitForFunction(()=>document.querySelector("#viewport")?.dataset.cameraMode==="third",{timeout:5000});
  const pitchBefore=bodyMotion(await latestFlightSample()),pitchStick=await pointerDownOnly("#soloRight");
  await page.mouse.move(pitchStick.cx,pitchStick.cy+pitchStick.r*.85,{steps:6});
  const pitchStart=await simTime();await waitForSimTime(pitchStart+.45,30000);
  const pitched=bodyMotion(await latestFlightSample());
  if(!(pitched.pitch>pitchBefore.pitch+4.0))throw new Error(`body-pitch command did not rotate aircraft nose-up: before=${JSON.stringify(pitchBefore)}, after=${JSON.stringify(pitched)}`);
  if(Math.abs(pitched.yaw-pitchBefore.yaw)>4.0)throw new Error(`body-pitch command leaked into yaw: before=${JSON.stringify(pitchBefore)}, after=${JSON.stringify(pitched)}`);
  await page.mouse.up();

  const yawBefore=await page.$eval("#attitude",e=>Number(((e.textContent||"").match(/-?\d+(?:\.\d+)?/g)||[])[2]||0));
  const right=await pointerDownOnly("#soloRight");
  await page.mouse.move(right.cx+right.r*.65,right.cy,{steps:5});
  const turnStart=await simTime();await waitForSimTime(turnStart+.30,25000);await page.mouse.up();
  const yawAfter=await page.$eval("#attitude",e=>Number(((e.textContent||"").match(/-?\d+(?:\.\d+)?/g)||[])[2]||0));
  let yawDelta=(yawAfter-yawBefore)%360;if(yawDelta>180)yawDelta-=360;if(yawDelta<-180)yawDelta+=360;
  if(Math.abs(yawDelta)<4)throw new Error(`solo heading control failed: ${yawBefore} -> ${yawAfter}`);

  await page.click("#soloKill");
  await page.waitForFunction(()=>{
    const state=(document.querySelector("#fcState")?.textContent||"").trim();
    const motors=(document.querySelector("#motors")?.textContent||"").trim().split(/\s+/).map(Number);
    return state==="DISARMED"&&motors.length===4&&motors.every(v=>v===1000);
  },{timeout:10000});
  state=await page.$eval("#fcState",e=>e.textContent||"");
  const killed=await page.$eval("#motors",e=>(e.textContent||"").trim().split(/\s+/).map(Number));
  if(state!=="DISARMED"||!killed.every(v=>v===1000))throw new Error(`solo GAME KILL failed: ${JSON.stringify(await snapshot())}`);
  await page.waitForFunction(()=>document.querySelector("#viewport")?.dataset.motorAudioArmEvent==="disarmed",{timeout:5000});
  const killAudio=await page.$eval("#viewport",e=>({event:e.dataset.motorAudioArmEvent,escTones:Number(e.dataset.motorAudioEscToneCount)||0}));
  if(killAudio.event!=="disarmed"||killAudio.escTones<audioDrive.escTones+2)throw new Error(`ESC disarm tones did not fire: ${JSON.stringify(killAudio)}`);

  const beforeReset=await simTime();if(beforeReset<3)throw new Error(`sim too short before reset: ${beforeReset}`);
  await page.click("#soloReset");
  await page.waitForFunction(()=>parseFloat(document.querySelector("#simTime")?.textContent||"99")<.25,{timeout:5000});
  const reset=await page.evaluate(()=>({
    solo:document.body.classList.contains("solo-flight"),
    lap:document.querySelector("#soloLap")?.textContent||"",
    raceTime:document.querySelector("#soloRaceTime")?.textContent||"",
    gate:document.querySelector("#soloGate")?.textContent||"",
    motors:(document.querySelector("#motors")?.textContent||"").trim().split(/\s+/).map(Number),
  }));
  if(!reset.solo||!reset.lap.includes("READY")||reset.raceTime!=="00:00.000"||!reset.gate.includes("START / FINISH")||!reset.motors.every(v=>v===1000))
    throw new Error(`fullscreen reset/race reset failed: ${JSON.stringify(reset)}`);

  await waitForSimTime(2.2,60000);
  state=await page.$eval("#fcState",e=>e.textContent||"");
  if(state!=="DISARMED")throw new Error(`recalibration after reset failed: ${JSON.stringify(await snapshot())}`);

  await page.evaluate(()=>document.querySelector("#soloExit")?.click());
  await page.waitForFunction(()=>!document.body.classList.contains("solo-flight"),{timeout:5000});
  await page.click("#reset");await page.setViewport({width:1280,height:900,deviceScaleFactor:1});
  await page.select("#inputSource","local");
  await page.$eval("#inputSource",e=>e.dispatchEvent(new Event("change",{bubbles:true})));
  await page.click("#run");await waitForSimTime(2.2,60000);
  state=await page.$eval("#fcState",e=>e.textContent||"");
  if(state!=="DISARMED")throw new Error(`local fallback calibration failed: ${JSON.stringify(await snapshot())}`);

  // Space must arm through the same local SBUS -> FirmwareRuntime -> ArmState path.
  // Use the authoritative FC state bit for arming completion; #fcState is a
  // deliberately rate-limited 20 Hz presentation surface and may lag one frame.
  const localArmStart=await simTime();await page.keyboard.press("Space");
  await page.waitForFunction(({start,limit})=>{const d=globalThis.__arondightDiagnostics,sim=Number(d?.simTime),fc=Number(d?.fcState)||0;return Boolean(fc&1)||(Number.isFinite(sim)&&sim>=start+limit);},{timeout:15000},{start:localArmStart,limit:1.25});
  const localArmReached=await page.evaluate(()=>({sim:Number(globalThis.__arondightDiagnostics?.simTime),fc:Number(globalThis.__arondightDiagnostics?.fcState)||0}));
  if(!(localArmReached.fc&1)||localArmReached.sim-localArmStart>1.25)throw new Error(`local fallback ARM authority failed: start=${localArmStart} reached=${JSON.stringify(localArmReached)} snapshot=${JSON.stringify(await snapshot())}`);
  await page.waitForFunction(()=>document.querySelector("#fcState")?.textContent==="ARMED",{timeout:1500});
  state=await page.$eval("#fcState",e=>e.textContent||"");

  await page.$eval("#touchThrottle",e=>{e.value=".25";});
  const throttleStart=await simTime();await waitForSimTime(throttleStart+.1,15000);
  await page.waitForFunction(()=>{const values=(document.querySelector("#motors")?.textContent||"").trim().split(/\s+/).map(Number);return values.length===4&&values.every(v=>Number.isFinite(v)&&v>1050);},{timeout:2000});
  const throttleMotors=await page.$eval("#motors",e=>(e.textContent||"").trim().split(/\s+/).map(Number));
  if(!throttleMotors.every(v=>Number.isFinite(v)&&v>1050))throw new Error(`local throttle failed: ${throttleMotors.join(" ")}`);

  await page.setViewport({width:390,height:844,deviceScaleFactor:1});await wait(250);
  const mobile=await page.evaluate(()=>{
    const p=document.querySelector(".panel").getBoundingClientRect(),t=document.querySelector(".telemetry").getBoundingClientRect();
    return{panelBottom:p.bottom,telemetryTop:t.top,scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth,overflow:getComputedStyle(document.body).overflowY};
  });
  if(mobile.telemetryTop<mobile.panelBottom-1||mobile.scrollWidth>mobile.clientWidth+1||mobile.overflow==="hidden")
    throw new Error(`mobile layout failed: ${JSON.stringify(mobile)}`);

  if(errors.length)throw new Error(errors.join("\n"));
  console.log("Browser SIL E2E passed: direct FPV/Solo fallback startup, shared WASM GAME/STATE FC, spring-centred AGL target, wall-clock 1 kHz pacing, one-phone forward/strafe/braking, real nose-up body-pitch + heading control, persisted FPV tilt/FOV + third-person distance, live rotor-physics audio, FC-driven ESC arm/disarm tones, axis settings, FC-authoritative arming, race/reset, local fallback and responsive layout.");
}finally{await browser.close();}
