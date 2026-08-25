import puppeteer from "puppeteer-core";

const input=process.argv[2]||"https://kurzlernen.de/drone_simulator.html",url=new URL(input),executablePath=process.env.CHROME_BIN;
if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");
const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader"]});
const page=await browser.newPage(),cdp=await page.createCDPSession();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
  await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1");
  await page.setViewport({width:844,height:390,deviceScaleFactor:1,hasTouch:true,isMobile:true});
  try{await browser.defaultBrowserContext().overridePermissions(url.origin,["geolocation"]);await page.setGeolocation({latitude:39.5696,longitude:2.6502,accuracy:4});}catch{}
  await page.goto(url.href,{waitUntil:"load",timeout:40000});
  await page.waitForFunction(()=>document.querySelector("#status")?.textContent?.includes("SIM ready")&&globalThis.__arondightWalkMode&&globalThis.__arondightVehicleDrive&&globalThis.__arondightWorldRigidBodies,{timeout:40000});
  if(await page.evaluate(()=>globalThis.__arondightWalkMode?.mode!=="foot"))await page.click("#playerModeButton");
  await page.waitForFunction(()=>globalThis.__arondightWalkMode?.mode==="foot",{timeout:8000});
  const positioned=await page.evaluate(()=>{const scene=globalThis.__arondightRealWorld?.threeScene,physics=globalThis.__arondightWorldRigidBodies,walk=globalThis.__arondightWalkMode;if(!scene||!physics||!walk)return null;let chosen=null;scene.traverse(node=>{if(chosen||!node?.isGroup||node.visible===false||node.userData?.worldPopulationKind!=="car")return;const id=String(node.userData?.worldPopulationId||node.userData?.worldProceduralId||"");const pose=id?physics.pose?.(id):null;if(id&&pose?.position)chosen={id,position:[...pose.position],parked:Boolean(node.userData?.worldParked)};});if(!chosen)return null;walk.setPose?.({x:chosen.position[0],y:chosen.position[1],yaw:0,pitch:0});return chosen;});
  if(!positioned)throw new Error("no physical car available for mobile touch smoke");
  await sleep(350);
  const entered=await page.evaluate(()=>globalThis.__arondightVehicleDrive?.enterNearest?.()===true);
  if(!entered)throw new Error(`could not enter nearest physical car: ${JSON.stringify(positioned)}`);
  await page.waitForFunction(()=>document.body.classList.contains("player-driving")&&getComputedStyle(document.querySelector("#vehicleHud")).display!=="none"&&document.querySelector("#vehicleGas")&&document.querySelector("#vehicleSteer"),{timeout:5000});
  const boxes=await page.evaluate(()=>{const pack=id=>{const r=document.getElementById(id)?.getBoundingClientRect();return r?{x:r.x,y:r.y,w:r.width,h:r.height}:null;};return{gas:pack("vehicleGas"),steer:pack("vehicleSteer"),hudZ:getComputedStyle(document.getElementById("vehicleHud")).zIndex,controller:document.querySelector("#viewport")?.dataset.vehicleDriveController,touch:document.querySelector("#viewport")?.dataset.vehicleTouchControls};});
  if(!boxes.gas||!boxes.steer||Number(boxes.hudZ)<1000)throw new Error(`vehicle touch HUD is not interactable/topmost: ${JSON.stringify(boxes)}`);
  const beforePose=await page.evaluate(()=>globalThis.__arondightVehicleDrive?.physicsPose||null);
  const gas={x:boxes.gas.x+boxes.gas.w*.5,y:boxes.gas.y+boxes.gas.h*.5,id:901,radiusX:3,radiusY:3,force:1};
  const steer={x:boxes.steer.x+boxes.steer.w*.84,y:boxes.steer.y+boxes.steer.h*.5,id:902,radiusX:3,radiusY:3,force:1};
  await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[gas,steer]});
  await sleep(1200);
  const during=await page.evaluate(()=>{const v=document.querySelector("#viewport"),d=globalThis.__arondightVehicleDrive,p=d?.physicsPose;return{throttle:Number(v?.dataset.vehicleDriveThrottle||0),steer:Number(v?.dataset.vehicleDriveSteer||0),touchThrottle:v?.dataset.vehicleTouchThrottle||"",touchSteer:v?.dataset.vehicleTouchSteer||"",speedKmh:Number(v?.dataset.vehicleDriveSpeedKmh||0),active:Boolean(d?.active),gasHeld:document.getElementById("vehicleGas")?.classList.contains("held"),bodyYaw:Number(p?.yaw),headingSource:v?.dataset.vehicleDriveHeadingSource||"",steeringPhysics:v?.dataset.vehicleDriveSteeringPhysics||""};});
  const yaw0=Number(beforePose?.yaw),yawDelta=Math.atan2(Math.sin(during.bodyYaw-yaw0),Math.cos(during.bodyYaw-yaw0));
  await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});await sleep(120);
  const released=await page.evaluate(()=>({throttle:document.querySelector("#viewport")?.dataset.vehicleTouchThrottle,steer:document.querySelector("#viewport")?.dataset.vehicleTouchSteer,gasHeld:document.getElementById("vehicleGas")?.classList.contains("held")}));
  if(!during.active||during.throttle<.45||during.steer<.2||during.speedKmh<=0||!during.gasHeld||!Number.isFinite(yaw0)||!Number.isFinite(during.bodyYaw)||yawDelta>-.035||during.headingSource!=="box3d-body-yaw-v1"||during.steeringPhysics!=="box3d-bicycle-yaw-rate-v1")throw new Error(`right touch steer did not rotate the real Box3D car clockwise: ${JSON.stringify({positioned,boxes,beforePose,during,yawDelta})}`);
  if(released.throttle!=="0"||Math.abs(Number(released.steer||0))>.02||released.gasHeld)throw new Error(`vehicle touch input stuck after release: ${JSON.stringify(released)}`);
  console.log(`Mobile car touch smoke passed: ${during.speedKmh.toFixed(1)} km/h, right-steer=${during.steer.toFixed(2)}, clockwise physicalYawDelta=${yawDelta.toFixed(3)} rad, parkedSource=${positioned.parked}.`);
}finally{await browser.close();}
