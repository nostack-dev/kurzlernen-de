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

  const boot=await page.evaluate(()=>({
    title:document.title,status:document.querySelector("#status")?.textContent||"",
    controller:document.querySelector("#tController")?.textContent||"",
    canvasCount:document.querySelectorAll("canvas").length,
    mode:document.querySelector("#tMode")?.textContent||"",
    externalScripts:[...document.scripts].filter(s=>s.src).map(s=>s.src),
  }));
  if(boot.title!=="Arondight45 Drone Digital Twin"||!boot.status.includes("SIM ready")||
     !boot.controller.includes("shared fc::StateRuntime → fc::Runtime / WASM")||boot.canvasCount<1||boot.mode!=="SIM")
    throw new Error(`boot mismatch: ${JSON.stringify(boot)}`);
  if(boot.externalScripts.length||externalRequests.length)throw new Error("self-contained build made external requests");

  const cameraBoot=await page.evaluate(()=>({
    mode:document.querySelector("#viewport")?.dataset.cameraMode||"",
    follow:document.querySelector("#camFollow")?.dataset.active||"",
  }));
  if(cameraBoot.mode!=="follow"||cameraBoot.follow!=="1")throw new Error(`FOLLOW camera default failed: ${JSON.stringify(cameraBoot)}`);
  await page.click("#camFpv");
  const fpv=await page.$eval("#viewport",e=>({mode:e.dataset.cameraMode||"",tilt:e.dataset.fpvTiltDeg||""}));
  if(fpv.mode!=="fpv"||fpv.tilt!=="30")throw new Error(`FPV camera failed: ${JSON.stringify(fpv)}`);
  await page.click("#camFollow");

  await page.setViewport({width:844,height:390,deviceScaleFactor:1});
  await page.evaluate(()=>{
    localStorage.setItem("arondight45PhoneControlSettingsV1",JSON.stringify({leftSensitivity:1,rightSensitivity:1}));
    localStorage.setItem("arondight45PhoneControlSettingsV2",JSON.stringify({leftSensitivity:.02,rightSensitivity:.02}));
    localStorage.setItem("arondight45PhoneControlSettingsV3",JSON.stringify({leftSensitivity:.25,rightSensitivity:.25}));
    localStorage.removeItem("arondight45PhoneControlSettingsV4");
  });
  await page.click("#camSolo");
  await page.waitForFunction(()=>document.body.classList.contains("solo-flight"),{timeout:5000});
  const soloUi=await page.evaluate(()=>({
    hud:!document.querySelector("#soloHud")?.hidden,
    reset:!!document.querySelector("#soloReset"),
    lap:!!document.querySelector("#soloLap"),
    settings:!!document.querySelector("#soloTopbar .phone-settings-button"),
    throttle:parseFloat(document.querySelector("#throttle")?.textContent||"0"),
    leftTop:parseFloat(document.querySelector("#soloLeft .solo-knob")?.style.top||"0"),
    clearance:!!document.querySelector("#soloClearanceSlider"),
    clearanceValue:Number(document.querySelector("#soloClearanceSlider")?.value||0),
    rightLabel:document.querySelector("#soloRight span")?.textContent||"",
  }));
  if(!Object.values({hud:soloUi.hud,reset:soloUi.reset,lap:soloUi.lap,settings:soloUi.settings,clearance:soloUi.clearance}).every(Boolean))
    throw new Error(`solo HUD incomplete: ${JSON.stringify(soloUi)}`);
  if(soloUi.throttle!==0||Math.abs(soloUi.leftTop-50)>1||Math.abs(soloUi.clearanceValue-2)>.01||!soloUi.rightLabel.includes("PITCH"))throw new Error(`solo GAME neutral/labels wrong: ${JSON.stringify(soloUi)}`);

  await page.click("#soloTopbar .phone-settings-button");
  await page.waitForFunction(()=>document.querySelector(".phone-settings-dialog")?.open,{timeout:5000});
  const defaults=await page.evaluate(()=>({
    left:document.querySelector('.phone-settings-dialog [data-slider="left"]')?.value,
    right:document.querySelector('.phone-settings-dialog [data-slider="right"]')?.value,
    lock:document.querySelector('.phone-settings-dialog [data-lock-horizontal]')?.checked,
    lockLeft:document.querySelector('.phone-settings-dialog [data-lock-left-horizontal]')?.checked,
    invertLeft:document.querySelector('.phone-settings-dialog [data-invert-left-horizontal]')?.checked,
    invertX:document.querySelector('.phone-settings-dialog [data-invert-right-horizontal]')?.checked,
    invertY:document.querySelector('.phone-settings-dialog [data-invert-right-vertical]')?.checked,
    rightLockLabel:document.querySelector('.phone-settings-dialog [data-lock-horizontal]')?.parentElement?.textContent||"",
    v1:localStorage.getItem("arondight45PhoneControlSettingsV1"),
    v2:localStorage.getItem("arondight45PhoneControlSettingsV2"),
    v3:localStorage.getItem("arondight45PhoneControlSettingsV3"),
  }));
  if(defaults.left!=="7"||defaults.right!=="10"||defaults.lock!==false||defaults.lockLeft!==false||defaults.invertLeft!==false||defaults.invertX!==false||defaults.invertY!==false||!defaults.rightLockLabel.includes("VERTICAL AXIS"))
    throw new Error(`clean V4 defaults/settings labels wrong: ${JSON.stringify(defaults)}`);
  if(defaults.v1!==null||defaults.v2!==null||defaults.v3!==null)
    throw new Error(`obsolete phone settings not wiped: ${JSON.stringify(defaults)}`);

  await page.click('.phone-settings-dialog [data-invert-left-horizontal]');
  let stored=await page.evaluate(()=>JSON.parse(localStorage.getItem("arondight45PhoneControlSettingsV4")||"{}"));
  if(stored.invertLeftHorizontal!==true)throw new Error(`left horizontal invert did not persist live: ${JSON.stringify(stored)}`);
  await page.click('.phone-settings-dialog [data-invert-left-horizontal]');
  stored=await page.evaluate(()=>JSON.parse(localStorage.getItem("arondight45PhoneControlSettingsV4")||"{}"));
  if(stored.invertLeftHorizontal!==false)throw new Error(`left horizontal invert restore failed: ${JSON.stringify(stored)}`);

  await page.click('.phone-settings-dialog [data-invert-right-horizontal]');
  stored=await page.evaluate(()=>JSON.parse(localStorage.getItem("arondight45PhoneControlSettingsV4")||"{}"));
  if(stored.invertRightHorizontal!==true)throw new Error(`right horizontal invert did not persist: ${JSON.stringify(stored)}`);
  await page.click('.phone-settings-dialog [data-invert-right-horizontal]');
  await page.click('.phone-settings-dialog [data-invert-right-vertical]');
  stored=await page.evaluate(()=>JSON.parse(localStorage.getItem("arondight45PhoneControlSettingsV4")||"{}"));
  if(stored.invertRightVertical!==true)throw new Error(`right vertical invert did not persist: ${JSON.stringify(stored)}`);
  await page.click('.phone-settings-dialog [data-invert-right-vertical]');
  stored=await page.evaluate(()=>JSON.parse(localStorage.getItem("arondight45PhoneControlSettingsV4")||"{}"));
  if(stored.invertRightHorizontal!==false||stored.invertRightVertical!==false)throw new Error(`right-axis invert restore failed: ${JSON.stringify(stored)}`);
  await page.click('.phone-settings-dialog [data-lock-left-horizontal]');
  stored=await page.evaluate(()=>JSON.parse(localStorage.getItem("arondight45PhoneControlSettingsV4")||"{}"));
  if(stored.lockLeftHorizontal!==true)throw new Error(`left horizontal lock did not persist: ${JSON.stringify(stored)}`);
  await page.click('.phone-settings-dialog [data-lock-left-horizontal]');
  stored=await page.evaluate(()=>JSON.parse(localStorage.getItem("arondight45PhoneControlSettingsV4")||"{}"));
  if(stored.lockLeftHorizontal!==false)throw new Error(`left horizontal unlock did not persist: ${JSON.stringify(stored)}`);
  await page.click('.phone-settings-dialog [data-lock-horizontal]');
  stored=await page.evaluate(()=>JSON.parse(localStorage.getItem("arondight45PhoneControlSettingsV4")||"{}"));
  if(stored.lockRightHorizontal!==true)throw new Error(`right vertical lock did not persist: ${JSON.stringify(stored)}`);
  await page.click('.phone-settings-dialog [data-lock-horizontal]');
  stored=await page.evaluate(()=>JSON.parse(localStorage.getItem("arondight45PhoneControlSettingsV4")||"{}"));
  if(stored.lockRightHorizontal!==false)throw new Error(`right vertical unlock did not persist: ${JSON.stringify(stored)}`);
  await page.click('.phone-settings-dialog [data-close]');

  await waitForSimTime(2.2,60000);
  let state=await page.$eval("#fcState",e=>e.textContent||"");
  if(state!=="DISARMED")throw new Error(`solo calibration failed: ${JSON.stringify(await snapshot())}`);

  await page.waitForFunction(()=>document.querySelector("#soloRangeStatus")?.textContent?.includes("AGL"),{timeout:15000});
  await page.waitForFunction(()=>{const b=document.querySelector("#soloArm");return b&&!b.disabled&&b.textContent.trim()==="ARM";},{timeout:15000});
  const armStart=await simTime();await page.click("#soloArm");await waitForSimTime(armStart+1.25,50000);
  state=await page.$eval("#fcState",e=>e.textContent||"");
  if(state!=="ARMED")throw new Error(`solo GAME ARM failed: ${JSON.stringify(await snapshot())}`);
  await page.waitForFunction(()=>{const z=parseFloat(document.querySelector("#altitude")?.textContent||"0"),v=parseFloat(document.querySelector("#velocity")?.textContent||"99");return z>1.5&&z<2.5&&v<.70;},{timeout:90000});
  const holdStart=await simTime();await waitForSimTime(holdStart+.35,25000);
  const hold=bodyMotion(await latestFlightSample());
  if(!(hold.altitude>1.35&&hold.altitude<2.65&&Math.abs(hold.vertical)<.80))throw new Error(`solo 2m AGL hold failed: ${JSON.stringify(hold)}`);
  const audioDrive=await page.$eval("#viewport",e=>({source:e.dataset.motorAudioSource,hz:Number(e.dataset.motorAudioHz),power:Number(e.dataset.motorAudioPowerW)}));
  if(audioDrive.source!=="motorOmega+motorTorque+propTorque"||!(audioDrive.hz>20)||!(audioDrive.power>0))throw new Error(`motor sound is not driven by live rotor physics: ${JSON.stringify(audioDrive)}`);

  await page.$eval("#soloClearanceSlider",e=>{e.value="2.7";e.dispatchEvent(new Event("input",{bubbles:true}));});
  await page.waitForFunction(()=>document.querySelector("#soloClearanceValue")?.textContent?.includes("2.7 m"),{timeout:5000});
  const clearanceStart=await simTime();await waitForSimTime(clearanceStart+.50,30000);
  const clearanceRise=bodyMotion(await latestFlightSample());
  if(!(clearanceRise.altitude>hold.altitude+.07||clearanceRise.vertical>.16))throw new Error(`solo clearance slider did not command climb: before=${JSON.stringify(hold)}, after=${JSON.stringify(clearanceRise)}`);
  await page.$eval("#soloClearanceSlider",e=>{e.value="2";e.dispatchEvent(new Event("input",{bubbles:true}));});
  await page.waitForFunction(()=>{const z=parseFloat(document.querySelector("#altitude")?.textContent||"0"),v=parseFloat(document.querySelector("#velocity")?.textContent||"99");return z>1.5&&z<2.5&&v<.75;},{timeout:90000});

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
  await page.mouse.move(pitchStick.cx,pitchStick.cy-pitchStick.r*.85,{steps:6});
  const pitchStart=await simTime();await waitForSimTime(pitchStart+.45,30000);
  const pitched=bodyMotion(await latestFlightSample());
  if(!(pitched.pitch>pitchBefore.pitch+4.0))throw new Error(`body-pitch command did not rotate aircraft nose-up: before=${JSON.stringify(pitchBefore)}, after=${JSON.stringify(pitched)}`);
  if(Math.abs(pitched.yaw-pitchBefore.yaw)>4.0)throw new Error(`body-pitch command leaked into yaw: before=${JSON.stringify(pitchBefore)}, after=${JSON.stringify(pitched)}`);
  await page.mouse.up();

  const yawBefore=await page.$eval("#attitude",e=>Number(((e.textContent||"").match(/-?\d+(?:\.\d+)?/g)||[])[2]||0));
  const right=await pointerDownOnly("#soloRight");
  await page.mouse.move(right.cx+right.r*.65,right.cy,{steps:5});
  const turnStart=await simTime();await waitForSimTime(turnStart+.22,25000);await page.mouse.up();
  const yawAfter=await page.$eval("#attitude",e=>Number(((e.textContent||"").match(/-?\d+(?:\.\d+)?/g)||[])[2]||0));
  let yawDelta=(yawAfter-yawBefore)%360;if(yawDelta>180)yawDelta-=360;if(yawDelta<-180)yawDelta+=360;
  if(Math.abs(yawDelta)<4)throw new Error(`solo heading control failed: ${yawBefore} -> ${yawAfter}`);

  const killStart=await simTime();await page.click("#soloKill");await waitForSimTime(killStart+.03,10000);
  state=await page.$eval("#fcState",e=>e.textContent||"");
  const killed=await page.$eval("#motors",e=>(e.textContent||"").trim().split(/\s+/).map(Number));
  if(state!=="DISARMED"||!killed.every(v=>v===1000))throw new Error(`solo GAME KILL failed: ${JSON.stringify(await snapshot())}`);

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

  const localArmStart=await simTime();await page.keyboard.press("Space");await waitForSimTime(localArmStart+1.1,45000);
  state=await page.$eval("#fcState",e=>e.textContent||"");
  if(state!=="ARMED")throw new Error(`local fallback ARM failed: ${JSON.stringify(await snapshot())}`);

  await page.$eval("#touchThrottle",e=>{e.value=".25";});
  const throttleStart=await simTime();await waitForSimTime(throttleStart+.1,15000);
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
  console.log("Browser SIL E2E passed: shared WASM GAME/STATE FC, raycast AGL slider, one-phone forward/strafe/braking, real nose-up body-pitch + heading control, both right-axis inversions, both axis locks, FC-authoritative arming, race/reset, local fallback and responsive layout.");
}finally{await browser.close();}
