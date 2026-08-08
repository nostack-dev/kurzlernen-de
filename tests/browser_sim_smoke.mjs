import puppeteer from "puppeteer-core";

const url=process.argv[2]||"http://127.0.0.1:4174/drone_simulator.html";
const executablePath=process.env.CHROME_BIN;
if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");
const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader","--use-fake-ui-for-media-stream","--use-fake-device-for-media-stream","--disable-background-timer-throttling","--disable-backgrounding-occluded-windows","--disable-renderer-backgrounding","--disable-features=CalculateNativeWinOcclusion"],protocolTimeout:120000});
const page=await browser.newPage(),errors=[],externalRequests=[];
page.on("console",m=>{if(m.type()==="error")errors.push(`console: ${m.text()}`);});
page.on("pageerror",e=>errors.push(`pageerror: ${e.message}`));
page.on("request",request=>{try{const u=new URL(request.url());if(u.protocol.startsWith("http")&&u.hostname!=="127.0.0.1"&&u.hostname!=="localhost")externalRequests.push(request.url());}catch{}});

async function waitForSimTime(target,timeout=60000){await page.waitForFunction(t=>Number(document.querySelector("#simTime")?.textContent?.replace(" s","")||0)>=t,{timeout},target);}
async function simTime(){return page.$eval("#simTime",e=>Number(e.textContent?.replace(" s","")||0));}
async function pointerDownOnly(selector){const box=await page.$eval(selector,e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};});const cx=box.x+box.w/2,cy=box.y+box.h/2,r=Math.min(box.w,box.h)*.42;await page.mouse.move(cx,cy);await page.mouse.down();return{cx,cy,r};}
async function dragStick(selector,x,y,hold=.3){const stick=await pointerDownOnly(selector);await page.mouse.move(stick.cx+x*stick.r,stick.cy+y*stick.r,{steps:5});const start=await simTime();await waitForSimTime(start+hold,30000);await page.mouse.up();}
async function waitState(state,timeout=50000){await page.waitForFunction(s=>document.querySelector("#fcState")?.textContent===s,{timeout},state);}
async function armSolo(){await page.waitForFunction(()=>!document.querySelector("#soloArm")?.disabled,{timeout:30000});await page.click("#soloArm");await waitState("ARMED",50000);}
async function bodyMotion(){return page.evaluate(()=>{const samples=window.__arondight45Debug?.flightSamples?.()||[],sample=samples.at(-1);if(!sample)return null;const yaw=(Number(sample.yaw_deg)||0)*Math.PI/180,c=Math.cos(yaw),s=Math.sin(yaw),vx=Number(sample.vx)||0,vy=Number(sample.vy)||0,vz=Number(sample.vz)||0;return{forward:-c*vx-s*vy,right:s*vx-c*vy,horizontal:Math.hypot(vx,vy),vertical:vz,altitude:Number(sample.z)||0,yaw:Number(sample.yaw_deg)||0};});}

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
     !boot.controller.includes("raw sensor wire → shared fc::FirmwareRuntime → StateRuntime → Runtime / WASM")||boot.canvasCount<1||boot.mode!=="SIM")
    throw new Error(`boot mismatch: ${JSON.stringify(boot)}`);
  if(boot.externalScripts.length||externalRequests.length)throw new Error("self-contained build made external requests");

  const cameraBoot=await page.evaluate(()=>({mode:document.querySelector("#viewport")?.dataset.cameraMode||"",follow:document.querySelector("#camFollow")?.dataset.active||""}));
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
  });
  await page.click("#camSolo");
  await page.waitForFunction(()=>document.body.classList.contains("solo-flight"),{timeout:10000});
  const soloSettings=await page.evaluate(()=>({
    left:document.querySelector("#soloLeft")?.getAttribute("aria-label")||"",
    right:document.querySelector("#soloRight")?.getAttribute("aria-label")||"",
    game:document.body.dataset.soloGameMode||"",
  }));
  if(soloSettings.game!=="1")throw new Error(`1 PHONE did not enter GAME mode: ${JSON.stringify(soloSettings)}`);

  await waitState("DISARMED",30000);
  await armSolo();
  const armedAt=await simTime();await waitForSimTime(armedAt+2.4,60000);
  let motion=await bodyMotion();
  if(!motion||motion.altitude<.8)throw new Error(`solo clearance controller failed: ${JSON.stringify(motion)}`);

  await dragStick("#soloLeft",0,-.65,.65);
  const moveAt=await simTime();await waitForSimTime(moveAt+.35,30000);motion=await bodyMotion();
  if(!motion||motion.forward<.25)throw new Error(`solo forward state control failed: ${JSON.stringify(motion)}`);

  const yawBefore=await page.$eval("#attitude",e=>Number(((e.textContent||"").match(/-?\d+(?:\.\d+)?/g)||[])[2]||0));
  const right=await pointerDownOnly("#soloRight");
  await page.mouse.move(right.cx+right.r*.65,right.cy,{steps:5});
  const turnStart=await simTime();await waitForSimTime(turnStart+.22,25000);await page.mouse.up();
  const yawAfter=await page.$eval("#attitude",e=>Number(((e.textContent||"").match(/-?\d+(?:\.\d+)?/g)||[])[2]||0));
  let yawDelta=(yawAfter-yawBefore)%360;if(yawDelta>180)yawDelta-=360;if(yawDelta<-180)yawDelta+=360;
  if(Math.abs(yawDelta)<4)throw new Error(`solo heading control failed: ${yawBefore} -> ${yawAfter}`);

  await page.click("#soloKill");await waitState("DISARMED",10000);
  console.log("Standalone GAME browser smoke passed: raw-hardware FirmwareRuntime boot, self-contained page, cameras, 1 PHONE flight, AGL, translation, heading and kill.");
  if(errors.length)throw new Error(errors.join("\n"));
}finally{await browser.close();}
