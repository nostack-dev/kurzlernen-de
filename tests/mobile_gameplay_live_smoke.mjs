import puppeteer from "puppeteer-core";
import {mkdir} from "node:fs/promises";

const input=process.argv[2]||"https://kurzlernen.de/drone_simulator.html",url=new URL(input),executablePath=process.env.CHROME_BIN;
if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");
const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader"]}),page=await browser.newPage(),cdp=await page.createCDPSession();
await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1");
const pause=ms=>page.evaluate(delay=>new Promise(resolve=>setTimeout(resolve,delay)),ms);
const touch=p=>({x:p.x,y:p.y,radiusX:2,radiusY:2,force:1,id:1});
async function drag(selector,screenDirection,scale=.45,holdMs=120){const points=await page.$eval(selector,(el,args)=>{const r=el.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2,span=Math.min(r.width,r.height)*args.scale;return{start:{x:cx,y:cy},end:args.dir==="up"?{x:cx+span,y:cy}:args.dir==="right"?{x:cx,y:cy+span}:{x:cx,y:cy}};},{dir:screenDirection,scale});await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[touch(points.start)]});await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[touch(points.end)]});await pause(holdMs);const snapshot=await page.$eval("#viewport",v=>({move:v.dataset.walkMove,yaw:Number(v.dataset.walkYaw),pitch:Number(v.dataset.walkPitch),contract:v.dataset.walkTouchContract,semantics:v.dataset.walkStickSemantics}));await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});await pause(60);return snapshot;}

try{
  await page.setViewport({width:390,height:844,deviceScaleFactor:1,isMobile:true,hasTouch:true});
  await page.goto(url.href,{waitUntil:"load",timeout:45000});
  await page.waitForFunction(()=>document.querySelector("#status")?.textContent?.includes("SIM ready")&&globalThis.__arondightWalkMode&&document.querySelector("#mobileGameplayDock"),{timeout:45000});
  await page.waitForFunction(()=>document.querySelector("#soloArm")&&!document.querySelector("#soloArm").disabled,{timeout:30000});
  await page.evaluate(()=>globalThis.__arondightWalkMode.setMode("foot",{persist:false}));
  await page.waitForFunction(()=>{const v=document.querySelector("#viewport");return v?.dataset.playerMode==="foot"&&v.dataset.soloOrientation==="css-landscape"&&v.dataset.mobileGameplayUi==="flight-first-v1"&&v.dataset.walkTouchContract==="drone-normalized-pointer-origin-v2"&&document.querySelector("#footMove")&&document.querySelector("#footLook");},{timeout:8000});

  const up=await drag("#footMove","up"),right=await drag("#footMove","right"),parse=value=>String(value||"").split(",").map(Number),upMove=parse(up.move),rightMove=parse(right.move);
  if(!(upMove[1]<-.45&&Math.abs(upMove[0])<.22))throw new Error(`visual UP must be FPV forward: ${JSON.stringify({up,upMove})}`);
  if(!(rightMove[0]>.45&&Math.abs(rightMove[1])<.22))throw new Error(`visual RIGHT must be FPV strafe-right: ${JSON.stringify({right,rightMove})}`);
  if(up.semantics!=="drone-normalizedPointer-v1"||right.semantics!=="drone-normalizedPointer-v1")throw new Error(`FPV left stick is not using drone pointer semantics: ${JSON.stringify({up,right})}`);

  await page.evaluate(()=>globalThis.__arondightWalkMode.setPose({yaw:0,pitch:0}));
  const look=await drag("#footLook","right",.72,260);
  if(!(look.yaw>.08&&Math.abs(look.pitch)<.08))throw new Error(`right-stick visual RIGHT must yaw right without pitching: ${JSON.stringify(look)}`);
  if(look.semantics!=="drone-normalizedPointer-v1")throw new Error(`FPV right stick is not using drone pointer semantics: ${JSON.stringify(look)}`);

  const before=await page.$eval("#viewport",v=>({yaw:Number(v.dataset.walkYaw),pitch:Number(v.dataset.walkPitch),shots:Number(v.dataset.walkEnhancedShots)||0}));
  const centre=await page.$eval("#viewport",v=>{const r=v.getBoundingClientRect();return{x:r.left+r.width*.52,y:r.top+r.height*.46};});
  await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[touch(centre)]});await pause(40);await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});await pause(140);
  const after=await page.$eval("#viewport",v=>({yaw:Number(v.dataset.walkYaw),pitch:Number(v.dataset.walkPitch),shots:Number(v.dataset.walkEnhancedShots)||0,screen:v.dataset.walkScreenTouch,fireVector:v.dataset.walkWeaponFireVector,aimSource:v.dataset.walkWeaponAimSource,touchVector:v.dataset.walkWeaponTouchVector}));
  if(Math.abs(after.yaw-before.yaw)>.015||Math.abs(after.pitch-before.pitch)>.015)throw new Error(`screen touch outside sticks moved camera: ${JSON.stringify({before,after})}`);
  if(!(after.shots>before.shots&&after.screen==="fire-only-v1"&&after.fireVector==="touch-screen-ray-v4"&&after.aimSource==="screen-touch"&&after.touchVector==="screen-ray+hand-anchor-v1"))throw new Error(`screen touch did not use the authoritative shot/vector path: ${JSON.stringify({before,after})}`);

  const fpvUi=await page.evaluate(()=>{const contract=getComputedStyle(document.querySelector("#gameplayContractHud"));return{fire:getComputedStyle(document.querySelector("#footFire")).display,lookZone:getComputedStyle(document.querySelector("#footLookZone")).display,contractVisibility:contract.visibility,contractOpacity:contract.opacity,score:getComputedStyle(document.querySelector("#gameplayScorePill")).display,dock:[...document.querySelectorAll("#mobileGameplayDock button")].map(b=>b.textContent.trim())};});
  if(fpvUi.fire!=="none"||fpvUi.lookZone!=="none"||fpvUi.contractVisibility!=="hidden"||Number(fpvUi.contractOpacity)!==0||fpvUi.score!=="none")throw new Error(`flight-first FPV overlays still visible: ${JSON.stringify(fpvUi)}`);
  if(fpvUi.dock.length!==3||!fpvUi.dock.includes("SETTINGS")||fpvUi.dock.some(x=>x==="MENU"||x==="START"))throw new Error(`mobile dock is not mode/weapon/settings only: ${JSON.stringify(fpvUi.dock)}`);

  await page.click("#mobileGameplaySettings");await page.waitForFunction(()=>document.querySelector("dialog.phone-settings-dialog[open]"),{timeout:3000});
  const settings=await page.$eval("dialog.phone-settings-dialog[open]",d=>{const start=d.scrollTop;d.scrollTop=d.scrollHeight;return{clientHeight:d.clientHeight,scrollHeight:d.scrollHeight,scrollTop:d.scrollTop,overflowY:getComputedStyle(d).overflowY,touchAction:getComputedStyle(d).touchAction,start};});
  if(!(settings.clientHeight>120&&settings.scrollHeight>=settings.clientHeight&&settings.overflowY==="auto"&&settings.touchAction.includes("pan-y")&&(settings.scrollHeight===settings.clientHeight||settings.scrollTop>0)))throw new Error(`landscape settings are not fully scrollable: ${JSON.stringify(settings)}`);
  await page.$eval("dialog.phone-settings-dialog[open]",d=>d.close());

  await page.evaluate(()=>globalThis.__arondightWalkMode.setMode("drone",{persist:false}));
  await page.setViewport({width:844,height:390,deviceScaleFactor:1,isMobile:true,hasTouch:true});await pause(300);
  await page.waitForFunction(()=>document.querySelector("#viewport")?.dataset.playerMode==="drone"&&document.querySelector("#mobileGameplayMode")?.textContent==="DRONE"&&!document.querySelector("#soloArm")?.disabled,{timeout:10000});
  const droneUi=await page.evaluate(()=>{const contract=getComputedStyle(document.querySelector("#gameplayContractHud"));return{topbar:getComputedStyle(document.querySelector("#soloTopbar")).display,arm:getComputedStyle(document.querySelector("#soloArm")).display,armText:document.querySelector("#soloArm")?.textContent?.trim(),contractVisibility:contract.visibility,contractOpacity:contract.opacity,buttons:[...document.querySelectorAll("#mobileGameplayDock button")].map(b=>b.textContent.trim()),cameraExtra:document.querySelector("#viewport")?.dataset.fpvViewExtraUpOffsetM||null};});
  if(droneUi.topbar!=="none"||droneUi.arm==="none"||droneUi.contractVisibility!=="hidden"||Number(droneUi.contractOpacity)!==0||droneUi.buttons.length!==3)throw new Error(`drone HUD is not flight-first: ${JSON.stringify(droneUi)}`);
  await page.click("#soloArm");await page.waitForFunction(()=>document.querySelector("#soloState")?.textContent?.trim()==="ARMED",{timeout:10000});await pause(250);
  await mkdir("artifacts",{recursive:true});await page.screenshot({path:"artifacts/mobile-gameplay.png",captureBeyondViewport:false});
  console.log(`Flight-first mobile regression passed. ${JSON.stringify({upMove,rightMove,look,before,after,fpvUi,settings,droneUi})}`);
}finally{await browser.close();}
