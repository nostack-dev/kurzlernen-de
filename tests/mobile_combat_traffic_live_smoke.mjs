import puppeteer from "puppeteer-core";

const input=process.argv[2]||"https://kurzlernen.de/drone_simulator.html",url=new URL(input),executablePath=process.env.CHROME_BIN;
// This smoke covers the drone start; the game itself starts on foot by default.
if(!url.searchParams.has("start"))url.searchParams.set("start","drone");
if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");
const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader"]}),page=await browser.newPage(),cdp=await page.createCDPSession();
await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1");
await page.setViewport({width:390,height:844,deviceScaleFactor:1,isMobile:true,hasTouch:true});
const pause=ms=>page.evaluate(delay=>new Promise(resolve=>setTimeout(resolve,delay)),ms),touch=(p,id=1)=>({x:p.x,y:p.y,radiusX:2,radiusY:2,force:1,id});
const wrap=a=>{let x=Number(a)||0;while(x>Math.PI)x-=Math.PI*2;while(x<-Math.PI)x+=Math.PI*2;return x;};

try{
  await page.goto(url.href,{waitUntil:"load",timeout:45000});
  await page.waitForFunction(()=>document.querySelector("#status")?.textContent?.includes("SIM ready")&&globalThis.__arondightWalkMode&&globalThis.__arondightFootWeapons&&document.querySelector("#mobileGameplayDock"),{timeout:90000});
  await page.waitForFunction(()=>document.querySelector("#viewport")?.dataset.worldTrafficMotion==="forward-collinear-v2"&&document.querySelector("#viewport")?.dataset.worldCrowdDensity==="persistent-pedestrian-agents-v2",{timeout:12000});

  await page.click("#mobileGameplayMode");
  await page.waitForFunction(()=>document.querySelector("#viewport")?.dataset.playerMode==="foot"&&document.body.classList.contains("on-foot-mode"),{timeout:8000});
  const modeFoot=await page.$eval("#viewport",v=>({route:v.dataset.mobilePlayerModeRoute,mode:v.dataset.playerMode,button:document.querySelector("#mobileGameplayMode")?.textContent?.trim()}));
  if(modeFoot.route!=="walk-api-direct-v1"||modeFoot.mode!=="foot")throw new Error(`mobile first-person direct route failed: ${JSON.stringify(modeFoot)}`);

  await page.evaluate(()=>globalThis.__arondightFootWeapons.setMode("smg"));
  await page.waitForFunction(()=>globalThis.__arondightFootWeapons?.mode==="smg",{timeout:3000});
  const firePoint=await page.$eval("#viewport",v=>{const r=v.getBoundingClientRect();return{x:r.left+r.width*.53,y:r.top+r.height*.43};});
  const beforeShots=await page.$eval("#viewport",v=>Number(v.dataset.walkEnhancedShots)||0);
  await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[touch(firePoint,21)]});
  await pause(470);
  const held=await page.$eval("#viewport",v=>({shots:Number(v.dataset.walkEnhancedShots)||0,active:v.dataset.walkFirePointerActive,hold:v.dataset.walkHoldFire,api:v.dataset.walkFireApi,alignment:v.dataset.walkWeaponGeometryAlignment,error:Number(v.dataset.walkWeaponAimErrorDeg),drift:Number(v.dataset.walkWeaponGripAnchorDriftM),grip:v.dataset.walkWeaponGripAnchor,vector:v.dataset.walkWeaponGeometryVector,target:v.dataset.walkWeaponAimTarget}));
  await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});await pause(100);
  const released=await page.$eval("#viewport",v=>({shots:Number(v.dataset.walkEnhancedShots)||0,active:v.dataset.walkFirePointerActive,release:v.dataset.walkFirePointerRelease,tail:Number(v.dataset.walkBurstTailSuppressed)||0}));
  const delta=held.shots-beforeShots;
  if(delta<4)throw new Error(`SMG hold must fire continuously beyond a three-round burst: ${JSON.stringify({beforeShots,held,released,delta})}`);
  if(!(held.active==="1"&&held.hold==="screen-pointer-owned-smg-v1"&&held.api==="single-shot-per-call-v2"&&released.active==="0"))throw new Error(`SMG pointer ownership/timer-isolated single-shot API failed: ${JSON.stringify({held,released})}`);
  if(!(held.alignment==="grip-anchor-to-resolved-shot-v6"&&Number.isFinite(held.error)&&held.error<.5&&Number.isFinite(held.drift)&&held.drift<.003&&held.grip==="grip-world-fixed-v2"&&held.vector==="grip-to-muzzle-to-shot-point-v1"&&held.target))throw new Error(`weapon geometry is not grip-anchored to resolved shot point: ${JSON.stringify(held)}`);

  const crowd=await page.evaluate(()=>{const v=document.querySelector("#viewport"),root=globalThis.__arondightRealWorld?.threeScene?.getObjectByName?.("WORLD_CROWD_EXTRAS");return{contract:v?.dataset.worldCrowdDensity,extra:Number(v?.dataset.worldCrowdExtraCount)||0,native:Number(v?.dataset.worldCrowdNativePeople)||0,visible:Number(v?.dataset.worldCrowdVisibleExtras)||0,spawn:v?.dataset.worldCrowdSpawnRule,children:root?.children?.length||0};});
  if(!(crowd.contract==="persistent-pedestrian-agents-v2"&&crowd.extra>=12&&crowd.spawn==="out-of-view-arrivals-v2"))throw new Error(`crowd density contract missing: ${JSON.stringify(crowd)}`);

  let traffic=null;
  for(let attempt=0;attempt<12;attempt++){
    traffic=await page.evaluate(()=>{const v=document.querySelector("#viewport"),physics=globalThis.__arondightWorldRigidBodies,scene=globalThis.__arondightRealWorld?.threeScene,samples=[];scene?.traverse?.(node=>{if(!node?.isGroup||node.visible===false||node.userData?.playerDriven)return;const kind=String(node.userData?.worldPopulationKind||""),id=String(node.userData?.worldPopulationId||node.userData?.worldProceduralId||"");if(kind!=="car"&&kind!=="bus")return;const pose=physics?.pose?.(id);if(!pose?.velocity)return;const vx=Number(pose.velocity[0])||0,vy=Number(pose.velocity[1])||0,speed=Math.hypot(vx,vy);if(speed<1.8)return;const heading=Math.atan2(vy,vx),yaw=Number(pose.yaw)||0;let slip=heading-yaw;while(slip>Math.PI)slip-=Math.PI*2;while(slip<-Math.PI)slip+=Math.PI*2;samples.push({id,kind,speed,slip:Math.abs(slip)});});return{motion:v?.dataset.worldTrafficMotion,lane:v?.dataset.worldTrafficLaneContinuity,uturn:Number(v?.dataset.worldTrafficUturnCorrections)||0,headingFixes:Number(v?.dataset.worldTrafficHeadingFixes)||0,samples};});
    if(traffic.samples.length)break;await pause(500);
  }
  if(traffic?.motion!=="forward-collinear-v2"||traffic?.lane!=="no-cross-lane-u-turn-v2")throw new Error(`traffic motion guard missing: ${JSON.stringify(traffic)}`);
  if(traffic.samples.length&&Math.max(...traffic.samples.map(x=>x.slip))>.22)throw new Error(`visible traffic is still sliding sideways relative to heading: ${JSON.stringify(traffic)}`);

  await page.click("#mobileGameplayMode");
  await page.waitForFunction(()=>document.querySelector("#viewport")?.dataset.playerMode==="drone"&&document.querySelector("#viewport")?.dataset.cameraMode==="fpv"&&document.querySelector("#camFpv")?.dataset.active==="1",{timeout:10000});
  const modeDrone=await page.$eval("#viewport",v=>({mode:v.dataset.playerMode,camera:v.dataset.cameraMode,fpv:document.querySelector("#camFpv")?.dataset.active,route:v.dataset.mobileDroneCameraRoute,requested:v.dataset.mobileDroneCameraRequested}));
  if(!(modeDrone.mode==="drone"&&modeDrone.camera==="fpv"&&modeDrone.fpv==="1"&&modeDrone.route==="fpv-direct-v1"))throw new Error(`mobile drone/FPV restore failed: ${JSON.stringify(modeDrone)}`);

  await page.evaluate(()=>{const api=globalThis.__arondightWantedSystem;api?.clear?.("reset");api?.reportCrime?.({id:"mobile-emp-ci",kind:"bus",severity:5});});
  await page.waitForFunction(()=>Number(document.querySelector("#viewport")?.dataset.wantedStars||0)>0&&!document.querySelector("#wantedEmpButton")?.hidden,{timeout:5000});
  const empPoint=await page.$eval("#wantedEmpButton",b=>{const r=b.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};});
  await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[touch(empPoint,31)]});await pause(60);await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});await pause(100);
  const emp=await page.$eval("#viewport",v=>({route:v.dataset.mobileEmpRoute,result:v.dataset.mobileEmpResult,affected:Number(v.dataset.mobileEmpAffected)||0,wanted:v.dataset.wantedEmp,stars:Number(v.dataset.wantedStars)||0}));
  if(emp.route!=="wanted-api-direct-v1"||!emp.result)throw new Error(`mobile EMP direct route failed: ${JSON.stringify(emp)}`);

  console.log(`Mobile combat/traffic regression passed. ${JSON.stringify({modeFoot,fullAuto:{beforeShots,delta,held,released},crowd,traffic,modeDrone,emp})}`);
}finally{await browser.close();}
