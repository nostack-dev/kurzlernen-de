import puppeteer from "puppeteer-core";
import {spawn} from "node:child_process";

const chrome=process.env.CHROME_BIN||process.env.CHROMIUM_BIN||"";
if(!chrome)throw new Error("CHROME_BIN or CHROMIUM_BIN is required");
const target=process.argv[2]||"http://127.0.0.1:4174/drone_simulator.html";
const browser=await puppeteer.launch({executablePath:chrome,headless:true,args:["--no-sandbox","--disable-dev-shm-usage","--use-gl=swiftshader","--disable-gpu-sandbox"]});
const page=await browser.newPage();
const errors=[];page.on("pageerror",error=>errors.push(String(error)));page.on("console",msg=>{if(msg.type()==="error")errors.push(msg.text());});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const simTime=()=>page.$eval("#simTime",e=>parseFloat(e.textContent||"0"));
async function waitForSimTime(targetValue,timeout=20000){const started=Date.now();while(Date.now()-started<timeout){if(await simTime()>=targetValue)return;await wait(20);}throw new Error(`sim time did not reach ${targetValue}`);}
const snapshot=()=>page.evaluate(()=>({simTime:document.querySelector("#simTime")?.textContent,state:document.querySelector("#fcState")?.textContent,motors:document.querySelector("#motors")?.textContent,attitude:document.querySelector("#attitude")?.textContent,throttle:document.querySelector("#throttle")?.textContent}));
const latestFlightSample=()=>page.evaluate(()=>globalThis.__arondightFlightLogbook?.samples?.at?.(-1)||globalThis.__arondightFlightLogbook?.snapshot?.()?.samples?.at?.(-1)||null);
const bodyMotion=sample=>({roll:Number(sample?.roll_deg)||0,pitch:Number(sample?.pitch_deg)||0,yaw:Number(sample?.yaw_deg)||0});
async function pointerDownOnly(selector){const box=await page.$eval(selector,e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};});const cx=box.x+box.w/2,cy=box.y+box.h/2,r=Math.min(box.w,box.h)/2;await page.mouse.move(cx,cy);await page.mouse.down();return{cx,cy,r};}

try{
  await page.setViewport({width:844,height:390,deviceScaleFactor:1});
  await page.goto(target,{waitUntil:"load",timeout:30000});
  await page.waitForFunction(()=>document.querySelector("#status")?.textContent.includes("SIM ready"),{timeout:30000});
  await page.waitForFunction(()=>document.body.classList.contains("solo-flight")&&document.querySelector("#viewport")?.dataset.cameraMode==="fpv",{timeout:5000});

  const startup=await page.evaluate(()=>({solo:document.body.classList.contains("solo-flight"),camera:document.querySelector("#viewport")?.dataset.cameraMode,auto:document.querySelector("#viewport")?.dataset.autoFlightStart,panel:getComputedStyle(document.querySelector(".panel")).display}));
  if(!startup.solo||startup.camera!=="fpv"||startup.auto!=="fpv"||startup.panel!=="none")throw new Error(`direct FPV startup failed: ${JSON.stringify(startup)}`);

  await page.waitForFunction(()=>parseFloat(document.querySelector("#simTime")?.textContent||"0")>2.1,{timeout:60000});
  let state=await page.$eval("#fcState",e=>e.textContent||"");
  if(state!=="DISARMED")throw new Error(`initial calibration failed: ${JSON.stringify(await snapshot())}`);

  const cadenceStart=await page.evaluate(()=>({wall:performance.now(),sim:globalThis.__arondightDiagnostics?.simTime||0,draws:globalThis.__arondightDiagnostics?.presentationDraws||0}));
  await wait(2000);
  const cadenceEnd=await page.evaluate(()=>({wall:performance.now(),sim:globalThis.__arondightDiagnostics?.simTime||0,draws:globalThis.__arondightDiagnostics?.presentationDraws||0,ratio:globalThis.__arondightDiagnostics?.presentationPixelRatio||0,backlog:globalThis.__arondightDiagnostics?.simulationBacklogMs||0}));
  const cadence=(cadenceEnd.sim-cadenceStart.sim)/Math.max(.001,(cadenceEnd.wall-cadenceStart.wall)/1000),drawDelta=cadenceEnd.draws-cadenceStart.draws;
  const hudLag=Math.max(0,cadenceEnd.sim-parseFloat(await page.$eval("#simTime",e=>e.textContent||"0")));
  console.log(`Realtime fixed-step cadence: ${cadence.toFixed(3)}x · presentation draws ${drawDelta} · pixel ratio ${cadenceEnd.ratio.toFixed(2)} · backlog ${cadenceEnd.backlog.toFixed(2)} ms · HUD lag ${hudLag.toFixed(3)} s`);
  if(!(cadence>.90&&cadence<1.10))throw new Error(`realtime cadence outside release envelope: ${cadence.toFixed(3)}x`);
  if(!(cadenceEnd.backlog<80))throw new Error(`simulation backlog failed to recover: ${cadenceEnd.backlog.toFixed(2)} ms`);

  await page.waitForFunction(()=>document.querySelector("#soloArm")&&!document.querySelector("#soloArm").disabled,{timeout:10000});
  await page.click("#soloArm");
  const armStart=await simTime();await waitForSimTime(armStart+1.1,45000);
  state=await page.$eval("#fcState",e=>e.textContent||"");
  if(state!=="ARMED")throw new Error(`solo GAME ARM failed: ${JSON.stringify(await snapshot())}`);

  const audioDrive=await page.$eval("#viewport",e=>({event:e.dataset.motorAudioArmEvent,escTones:Number(e.dataset.motorAudioEscToneCount)||0}));
  if(audioDrive.event!=="armed"||audioDrive.escTones<1)throw new Error(`ESC arm tones did not fire: ${JSON.stringify(audioDrive)}`);

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

  // Verify the desktop Space shortcut independently from physical arming. Focused
  // controls can affect native key activation timing, so the shortcut contract is
  // simply that it toggles the same ARM request state as the visible control.
  await page.keyboard.press("Space");
  let armText=await page.$eval("#touchArm",e=>e.textContent||"");
  if(!armText.includes("ON"))throw new Error(`Space did not set local ARM request ON: ${armText}`);
  await page.keyboard.press("Space");
  armText=await page.$eval("#touchArm",e=>e.textContent||"");
  if(!armText.includes("OFF"))throw new Error(`Space did not set local ARM request OFF: ${armText}`);

  // Exercise the actual visible local-fallback ARM control through the same real
  // SBUS -> FirmwareRuntime -> ArmState path. Keep the real 1 s low-throttle dwell.
  await page.click("#touchArm");
  armText=await page.$eval("#touchArm",e=>e.textContent||"");
  if(!armText.includes("ON"))throw new Error(`local ARM button did not set request ON: ${armText}`);
  const localArmStart=await simTime();await waitForSimTime(localArmStart+1.2,45000);
  state=await page.$eval("#fcState",e=>e.textContent||"");
  if(state!=="ARMED")throw new Error(`local fallback ARM failed through visible ARM control: ${JSON.stringify(await snapshot())}`);

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
  console.log("Standalone browser SIL E2E passed: direct FPV startup, fixed-step realtime scheduler, shared C++ flight core, physical GAME arming/motion, local fallback ARM/throttle, and responsive layout.");
}finally{
  await browser.close();
}
