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
     !boot.controller.includes("shared fc::Runtime / WASM")||boot.canvasCount<1||boot.mode!=="SIM")
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
    // Dirty V1/V2/V3 mappings must not leak into the clean V4 controller model.
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
  }));
  if(!Object.values({hud:soloUi.hud,reset:soloUi.reset,lap:soloUi.lap,settings:soloUi.settings}).every(Boolean))
    throw new Error(`solo HUD incomplete: ${JSON.stringify(soloUi)}`);
  if(soloUi.throttle!==0||soloUi.leftTop<90)throw new Error(`solo neutral wrong: ${JSON.stringify(soloUi)}`);

  await page.click("#soloTopbar .phone-settings-button");
  await page.waitForFunction(()=>document.querySelector(".phone-settings-dialog")?.open,{timeout:5000});
  const defaults=await page.evaluate(()=>({
    left:document.querySelector('.phone-settings-dialog [data-slider="left"]')?.value,
    right:document.querySelector('.phone-settings-dialog [data-slider="right"]')?.value,
    lock:document.querySelector('.phone-settings-dialog [data-lock-horizontal]')?.checked,
    v1:localStorage.getItem("arondight45PhoneControlSettingsV1"),
    v2:localStorage.getItem("arondight45PhoneControlSettingsV2"),
    v3:localStorage.getItem("arondight45PhoneControlSettingsV3"),
  }));
  if(defaults.left!=="7"||defaults.right!=="10"||defaults.lock!==false)
    throw new Error(`clean V4 defaults wrong: ${JSON.stringify(defaults)}`);
  if(defaults.v1!==null||defaults.v2!==null||defaults.v3!==null)
    throw new Error(`obsolete phone settings not wiped: ${JSON.stringify(defaults)}`);

  await page.click('.phone-settings-dialog [data-lock-horizontal]');
  let stored=await page.evaluate(()=>JSON.parse(localStorage.getItem("arondight45PhoneControlSettingsV4")||"{}"));
  if(stored.lockRightHorizontal!==true)throw new Error(`horizontal lock did not persist: ${JSON.stringify(stored)}`);
  await page.click('.phone-settings-dialog [data-lock-horizontal]');
  stored=await page.evaluate(()=>JSON.parse(localStorage.getItem("arondight45PhoneControlSettingsV4")||"{}"));
  if(stored.lockRightHorizontal!==false)throw new Error(`horizontal unlock did not persist: ${JSON.stringify(stored)}`);
  await page.click('.phone-settings-dialog [data-close]');

  await waitForSimTime(2.2,60000);
  let state=await page.$eval("#fcState",e=>e.textContent||"");
  if(state!=="DISARMED")throw new Error(`solo calibration failed: ${JSON.stringify(await snapshot())}`);

  // Critical touch regression: touching the retained-throttle stick at screen
  // centre must NOT teleport throttle from 0 to 50%.
  const down=await pointerDownOnly("#soloLeft");
  await wait(100);
  const afterTouch=await page.$eval("#throttle",e=>parseFloat(e.textContent||"0"));
  if(afterTouch>0.5)throw new Error(`throttle teleported on re-touch: ${afterTouch}%`);

  // Move upward by half a gimbal radius -> 25% throttle, then release. Throttle
  // stays there while yaw springs to centre.
  await page.mouse.move(down.cx+down.r*.25,down.cy-down.r*.5,{steps:6});
  await wait(100);await page.mouse.up();await wait(100);
  const retained=await page.evaluate(()=>({
    throttle:parseFloat(document.querySelector("#throttle")?.textContent||"0"),
    left:parseFloat(document.querySelector("#soloLeft .solo-knob")?.style.left||"0"),
    armDisabled:document.querySelector("#soloArm")?.disabled,
  }));
  if(Math.abs(retained.throttle-25)>1.5||Math.abs(retained.left-50)>1||!retained.armDisabled)
    throw new Error(`relative throttle/yaw release failed: ${JSON.stringify(retained)}`);

  // Re-touch at centre still keeps 25%; moving down half-radius returns to 0.
  const down2=await pointerDownOnly("#soloLeft");await wait(80);
  const retainedOnRetouch=await page.$eval("#throttle",e=>parseFloat(e.textContent||"0"));
  if(Math.abs(retainedOnRetouch-25)>1.5)throw new Error(`retained throttle jumped on re-touch: ${retainedOnRetouch}%`);
  await page.mouse.move(down2.cx,down2.cy+down2.r*.5,{steps:6});await page.mouse.up();await wait(100);
  const neutralAgain=await page.evaluate(()=>({
    throttle:parseFloat(document.querySelector("#throttle")?.textContent||"0"),
    armDisabled:document.querySelector("#soloArm")?.disabled,
  }));
  if(neutralAgain.throttle>0.5||neutralAgain.armDisabled)throw new Error(`throttle return/ARM gate failed: ${JSON.stringify(neutralAgain)}`);

  // Right stick must visibly retain full physical travel even at max fineness.
  const right=await pointerDownOnly("#soloRight");
  await page.mouse.move(right.cx-right.r*.8,right.cy-right.r*.2,{steps:6});await wait(80);
  const rightKnob=await page.evaluate(()=>({
    left:parseFloat(document.querySelector("#soloRight .solo-knob")?.style.left||"50"),
    top:parseFloat(document.querySelector("#soloRight .solo-knob")?.style.top||"50"),
  }));
  if(Math.abs(rightKnob.left-16.4)>4||Math.abs(rightKnob.top-41.6)>4)throw new Error(`right stick did not track physical finger travel: ${JSON.stringify(rightKnob)}`);
  await page.mouse.up();

  const armStart=await simTime();await page.click("#soloArm");await waitForSimTime(armStart+1.1,45000);
  state=await page.$eval("#fcState",e=>e.textContent||"");
  if(state!=="ARMED")throw new Error(`solo ARM failed: ${JSON.stringify(await snapshot())}`);
  const idle=await page.$eval("#motors",e=>(e.textContent||"").trim().split(/\s+/).map(Number));
  if(!idle.every(v=>v===1050))throw new Error(`armed idle wrong: ${idle.join(" ")}`);

  await page.click("#soloKill");await wait(100);
  state=await page.$eval("#fcState",e=>e.textContent||"");
  const killed=await page.$eval("#motors",e=>(e.textContent||"").trim().split(/\s+/).map(Number));
  if(state!=="DISARMED"||!killed.every(v=>v===1000))throw new Error(`KILL failed: ${JSON.stringify(await snapshot())}`);

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
  console.log("Browser SIL E2E passed: shared WASM FC, FPV tilt, V4 phone settings, no throttle teleport, live right gimbal, race/reset, ARM/KILL, local fallback and responsive layout.");
}finally{await browser.close();}
