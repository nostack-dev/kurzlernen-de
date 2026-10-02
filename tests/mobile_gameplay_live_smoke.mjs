import puppeteer from "puppeteer-core";
import {mkdir} from "node:fs/promises";

const input=process.argv[2]||"https://kurzlernen.de/drone_simulator.html",url=new URL(input),executablePath=process.env.CHROME_BIN;
if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");
const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader"]}),page=await browser.newPage(),cdp=await page.createCDPSession();
await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1");
await page.evaluateOnNewDocument(()=>{const state={axes:[0,0,0,0],buttons:Array(17).fill(0)},pad={id:"Xbox Wireless Controller (Vendor: 045e Product: 0b13)",index:0,mapping:"standard",connected:true,timestamp:0,get axes(){return state.axes;},get buttons(){return state.buttons.map(value=>({pressed:value>.5,touched:value>0,value}));}};Object.defineProperty(navigator,"getGamepads",{configurable:true,value:()=>[pad]});globalThis.__mobilePad={axis(index,value){state.axes[index]=Math.max(-1,Math.min(1,Number(value)||0));},reset(){state.axes.fill(0);state.buttons.fill(0);}};});
const pause=ms=>page.evaluate(delay=>new Promise(resolve=>setTimeout(resolve,delay)),ms);
const setAxis=(index,value)=>page.evaluate((i,v)=>globalThis.__mobilePad.axis(i,v),index,value);
const resetPad=()=>page.evaluate(()=>globalThis.__mobilePad.reset());
function overlap(a,b){return Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));}
async function droneReadySnapshot(){return page.evaluate(()=>{const v=document.querySelector("#viewport"),start=document.querySelector("#mobileGameplayStart"),arm=document.querySelector("#soloArm"),toolbar=document.querySelector("#soloArmToolbar");return{fcState:document.querySelector("#soloState")?.textContent?.trim(),start:start?.textContent?.trim(),startDisabled:start?.disabled,startState:start?.dataset.state,arm:arm?.textContent?.trim(),armDisabled:arm?.disabled,toolbar:toolbar?.textContent?.trim(),toolbarDisabled:toolbar?.disabled,toolbarState:toolbar?.dataset.state,playerMode:v?.dataset.playerMode,controlSource:v?.dataset.controlSource,gamepadEnabled:v?.dataset.gamepadEnabled,gamepadConnected:v?.dataset.gamepadConnected,stowDisarm:v?.dataset.droneStowDisarm,stowEmergencyKill:v?.dataset.droneStowEmergencyKill};});}

try{
  await page.setViewport({width:390,height:844,deviceScaleFactor:1,isMobile:true,hasTouch:true});
  await page.goto(url.href,{waitUntil:"load",timeout:45000});
  await page.waitForFunction(()=>document.querySelector("#status")?.textContent?.includes("SIM ready")&&globalThis.__arondightWalkMode&&document.querySelector("#mobileGameplayDock"),{timeout:45000});
  await page.waitForFunction(()=>{const arm=document.querySelector("#soloArm"),start=document.querySelector("#mobileGameplayStart");return arm&&start&&!arm.disabled&&!start.disabled&&arm.textContent.trim()==="ARM"&&start.textContent.trim()==="START";},{timeout:30000});
  const initialReady=await droneReadySnapshot();
  await page.evaluate(()=>globalThis.__arondightWalkMode.setMode("foot",{persist:false}));
  await page.waitForFunction(()=>{const v=document.querySelector("#viewport");return v?.dataset.playerMode==="foot"&&v.dataset.soloOrientation==="css-landscape"&&v.dataset.mobileGameplayUi==="compact-actions-v1"&&document.querySelector("#footMove")&&document.querySelector("#footLookZone");},{timeout:8000});

  const touchMove=async(direction)=>{
    const point=await page.$eval("#footMove",(el,dir)=>{const r=el.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2,span=Math.min(r.width,r.height)*.32;return dir==="up"?{start:{x:cx,y:cy},end:{x:cx+span,y:cy}}:{start:{x:cx,y:cy},end:{x:cx,y:cy+span}};},direction);
    const touch=(p,id=1)=>({x:p.x,y:p.y,radiusX:2,radiusY:2,force:1,id});
    await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[touch(point.start)]});
    await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[touch(point.end)]});
    await pause(100);
    const value=await page.$eval("#viewport",v=>({move:v.dataset.walkMove,guard:v.dataset.walkPortraitInput,raw:v.dataset.walkMoveStickRaw}));
    await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
    await pause(50);return value;
  };
  const up=await touchMove("up"),right=await touchMove("right");
  const parse=value=>String(value||"").split(",").map(Number),upMove=parse(up.move),rightMove=parse(right.move);
  if(!(up.guard==="screen-to-logical-quarter-turn-v1"&&upMove[1]<-.45&&Math.abs(upMove[0])<.22))throw new Error(`portrait visual UP did not map to FPS forward: ${JSON.stringify({up,upMove})}`);
  if(!(rightMove[0]>.45&&Math.abs(rightMove[1])<.22))throw new Error(`portrait visual RIGHT did not map to FPS strafe-right: ${JSON.stringify({right,rightMove})}`);

  await page.evaluate(()=>globalThis.__arondightWalkMode.setPose?.({yaw:0,pitch:0}));await resetPad();await setAxis(2,.72);await pause(220);let pose=await page.$eval("#viewport",v=>({yaw:Number(v.dataset.walkYaw),pitch:Number(v.dataset.walkPitch)}));if(!(pose.yaw>.08))throw new Error(`Xbox RS right must turn right: ${JSON.stringify(pose)}`);
  await page.evaluate(()=>globalThis.__arondightWalkMode.setPose?.({yaw:0,pitch:0}));await resetPad();await setAxis(3,-.72);await pause(220);pose=await page.$eval("#viewport",v=>({yaw:Number(v.dataset.walkYaw),pitch:Number(v.dataset.walkPitch)}));if(!(pose.pitch>.07))throw new Error(`Xbox RS up must look up: ${JSON.stringify(pose)}`);await resetPad();

  await page.setViewport({width:844,height:390,deviceScaleFactor:1,isMobile:true,hasTouch:true});await pause(250);
  await page.waitForFunction(()=>document.querySelector("#viewport")?.dataset.soloOrientation==="native-landscape",{timeout:5000});
  const layout=await page.evaluate(()=>{const rect=selector=>{const el=document.querySelector(selector);if(!el)return null;const r=el.getBoundingClientRect(),s=getComputedStyle(el);return{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height,display:s.display,visibility:s.visibility};};return{dock:rect("#mobileGameplayDock"),move:rect("#footMove"),look:rect("#footLook"),fire:rect("#footFire"),status:rect("#soloTopbarStatus"),legacyWeapon:rect("#footWeaponToggle"),actions:rect("#soloTopbarActions"),mode:document.querySelector("#mobileGameplayMode")?.textContent,startHidden:document.querySelector("#mobileGameplayStart")?.hidden,weapon:document.querySelector("#mobileGameplayWeapon")?.textContent,ui:document.querySelector("#viewport")?.dataset.mobileGameplayUi};});
  if(!layout.dock||layout.dock.display==="none"||layout.ui!=="compact-actions-v1"||layout.mode!=="ON FOOT"||layout.startHidden!==true||!String(layout.weapon).startsWith("WEAPON ·"))throw new Error(`mobile gameplay dock contract failed: ${JSON.stringify(layout)}`);
  for(const [name,rect] of[["move",layout.move],["look",layout.look],["fire",layout.fire]])if(rect&&overlap(layout.dock,rect)>1)throw new Error(`mobile dock overlaps ${name}: ${JSON.stringify({dock:layout.dock,rect})}`);
  if(layout.legacyWeapon&&layout.legacyWeapon.display!=="none")throw new Error(`legacy foot weapon button still visible under compact dock: ${JSON.stringify(layout.legacyWeapon)}`);
  if(layout.actions&&layout.actions.display!=="none")throw new Error(`expanded legacy toolbar visible by default: ${JSON.stringify(layout.actions)}`);

  await page.evaluate(()=>globalThis.__arondightWalkMode.setMode("drone",{persist:false}));
  await page.waitForFunction(()=>document.querySelector("#viewport")?.dataset.playerMode==="drone"&&document.querySelector("#mobileGameplayMode")?.textContent==="DRONE"&&!document.querySelector("#mobileGameplayStart")?.hidden,{timeout:5000});
  try{await page.waitForFunction(()=>{const start=document.querySelector("#mobileGameplayStart"),arm=document.querySelector("#soloArm");return start&&arm&&!start.disabled&&!arm.disabled&&start.textContent.trim()==="START";},{timeout:20000});}catch(error){throw new Error(`drone did not return to START-ready state: ${JSON.stringify({initialReady,afterReturn:await droneReadySnapshot()})}`);}
  const droneLayout=await page.evaluate(()=>({mode:document.querySelector("#mobileGameplayMode")?.textContent,start:document.querySelector("#mobileGameplayStart")?.textContent,startHidden:document.querySelector("#mobileGameplayStart")?.hidden,startDisabled:document.querySelector("#mobileGameplayStart")?.disabled,weapon:document.querySelector("#mobileGameplayWeapon")?.textContent,actions:getComputedStyle(document.querySelector("#soloTopbarActions")).display,compact:document.body.classList.contains("mobile-gameplay-compact")}));
  if(droneLayout.mode!=="DRONE"||droneLayout.startHidden||droneLayout.startDisabled||!droneLayout.compact||droneLayout.actions!=="none"||!String(droneLayout.weapon).startsWith("WEAPON ·"))throw new Error(`compact drone HUD contract failed: ${JSON.stringify(droneLayout)}`);
  await page.click("#mobileGameplayStart");
  await page.waitForFunction(()=>{const start=document.querySelector("#mobileGameplayStart"),state=document.querySelector("#soloState")?.textContent?.trim();return start?.dataset.state==="armed"&&start.textContent.trim()==="DISARM"&&state==="ARMED";},{timeout:10000});
  await pause(300);
  const started=await page.evaluate(()=>({start:document.querySelector("#mobileGameplayStart")?.textContent,state:document.querySelector("#soloState")?.textContent?.trim(),armed:document.querySelector("#mobileGameplayStart")?.dataset.state,actions:getComputedStyle(document.querySelector("#soloTopbarActions")).display,emergencyStop:document.querySelector("#soloKill")?.textContent?.trim()}));
  if(started.start!=="DISARM"||started.state!=="ARMED"||started.armed!=="armed"||started.actions!=="none"||started.emergencyStop!=="EMERGENCY STOP")throw new Error(`mobile START did not launch drone cleanly: ${JSON.stringify(started)}`);
  await mkdir("artifacts",{recursive:true});await page.screenshot({path:"artifacts/mobile-gameplay.png",captureBeyondViewport:false});
  console.log(`Mobile gameplay regression passed: portrait touch axes, conventional Xbox look directions, compact HUD, graceful mode transition and real START→ARMED flow. ${JSON.stringify({initialReady,upMove,rightMove,pose,layout,droneLayout,started})}`);
}finally{await browser.close();}
