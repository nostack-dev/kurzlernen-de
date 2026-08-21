import puppeteer from "puppeteer-core";

const input=process.argv[2]||"http://127.0.0.1:4174/drone_simulator.html",inputUrl=new URL(input,"http://127.0.0.1:4174"),url=inputUrl.pathname.endsWith("/drone_simulator.html")?new URL(inputUrl.href):new URL("/drone_simulator.html",inputUrl.origin),executablePath=process.env.CHROME_BIN;
if(process.env.GITHUB_SHA)url.searchParams.set("ci",process.env.GITHUB_SHA);if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");
const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader","--autoplay-policy=no-user-gesture-required"]}),page=await browser.newPage(),cdp=await page.createCDPSession();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
  await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1");
  await page.setViewport({width:844,height:390,deviceScaleFactor:1,hasTouch:true,isMobile:true});
  await page.goto(url.href,{waitUntil:"load",timeout:30000});
  await page.waitForFunction(()=>document.querySelector("#status")?.textContent?.includes("SIM ready")&&globalThis.__arondightWalkMode&&globalThis.__arondightPlayerVehicleRuntime&&document.querySelector("#playerModeButton"),{timeout:30000});
  await page.waitForFunction(()=>globalThis.__arondightVehicleRuntime&&document.querySelector("#viewport")?.dataset.droneVehicleRuntime==="box3d-reset-v2",{timeout:8000});

  await page.click("#playerModeButton");
  await page.waitForFunction(()=>{const v=document.querySelector("#viewport");return v?.dataset.playerMode==="foot"&&v.dataset.playerVehicleMode==="human"&&v.dataset.droneVehicleState==="stowed"&&v.dataset.droneAudioSuppressed==="1"&&v.dataset.droneAudioHardMuted==="1"&&document.querySelector("#footLookZone");},{timeout:5000});
  const footState=await page.evaluate(()=>{const b=globalThis.__arondightRealWorld,v=document.querySelector("#viewport");let air=null;b?.threeScene?.traverse?.(node=>{if(!air&&node.userData?.arondightAirframe)air=node;});const self=b?.threeScene?.getObjectByName?.("LOCAL_HUMAN_VR");return{profile:v.dataset.walkControlProfile,look:v.dataset.walkLookModel,owner:v.dataset.walkControlProfileOwner,collision:v.dataset.walkCollisionProfile,pistol:v.dataset.walkPistolSound,airVisible:air?.visible,hardMute:v.dataset.droneAudioHardMuted,audio:v.dataset.droneAudioSuppressed,selfVisible:self?.visible??false,perf:v.dataset.walkPerfProfile};});
  if(footState.profile!=="cod-full-viewport-v6"||footState.look!=="cod-full-viewport-delta-v6"||footState.owner!=="walk-profile-contract-v1"||footState.collision!=="spatial-grid-cached-v2"||footState.pistol!=="procedural-synced-v2"||footState.airVisible!==false||footState.hardMute!=="1"||footState.audio!=="1"||footState.selfVisible||footState.perf!=="cached-spatial-no-frame-traverse-v2")throw new Error(`human V2 contract failed: ${JSON.stringify(footState)}`);

  // Mobile blank-viewport look is true touch-drag, not a synthetic mouse proxy.
  const yawBefore=Number(await page.$eval("#viewport",v=>v.dataset.walkYaw||0)),lookBox=await page.$eval("#footLookZone",el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};});
  const lx=lookBox.x+lookBox.w*.32,ly=lookBox.y+lookBox.h*.30;
  await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:lx,y:ly,id:818,radiusX:2,radiusY:2,force:1}]});await sleep(30);
  await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:lx+90,y:ly,id:818,radiusX:2,radiusY:2,force:1}]});await sleep(30);
  await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});await sleep(100);
  const yawAfterDrag=Number(await page.$eval("#viewport",v=>v.dataset.walkYaw||0));if(yawAfterDrag-yawBefore<.25)throw new Error(`mobile touch-drag look too weak: ${yawBefore} -> ${yawAfterDrag}`);

  // The visible LOOK control is an analog rate stick: edge hold keeps turning,
  // release stops it. This is intentionally different from free touch-drag.
  const stickBox=await page.$eval("#footLook",el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};}),sx=stickBox.x+stickBox.w*.84,sy=stickBox.y+stickBox.h*.50;
  await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:sx,y:sy,id:819,radiusX:2,radiusY:2,force:1}]});await sleep(160);
  const yawHoldA=Number(await page.$eval("#viewport",v=>v.dataset.walkYaw||0));await sleep(260);const yawHoldB=Number(await page.$eval("#viewport",v=>v.dataset.walkYaw||0));
  if(yawHoldB-yawHoldA<.25)throw new Error(`LOOK stick did not continue turning while held at edge: ${yawHoldA} -> ${yawHoldB}`);
  const stickMode=await page.$eval("#viewport",v=>v.dataset.walkAimStickMode||"");if(stickMode!=="rate-edge-hold-v2")throw new Error(`LOOK stick rate contract missing: ${stickMode}`);
  await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});await sleep(90);const yawReleaseA=Number(await page.$eval("#viewport",v=>v.dataset.walkYaw||0));await sleep(180);const yawReleaseB=Number(await page.$eval("#viewport",v=>v.dataset.walkYaw||0));if(Math.abs(yawReleaseB-yawReleaseA)>.08)throw new Error(`LOOK stick kept turning after release: ${yawReleaseA} -> ${yawReleaseB}`);
  await page.evaluate(()=>document.exitPointerLock?.());

  const beforeMove=await page.$eval("#viewport",v=>v.dataset.walkPosition||""),moveBox=await page.$eval("#footMove",el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};});
  await page.mouse.move(moveBox.x+moveBox.w/2,moveBox.y+moveBox.h/2);await page.mouse.down();await page.mouse.move(moveBox.x+moveBox.w/2,moveBox.y+moveBox.h*.13,{steps:4});await sleep(330);await page.mouse.up();const afterMove=await page.$eval("#viewport",v=>v.dataset.walkPosition||"");if(!beforeMove||beforeMove===afterMove)throw new Error(`human did not move: ${beforeMove} -> ${afterMove}`);

  const fps=await page.evaluate(()=>new Promise(resolve=>{let n=0,start=performance.now(),last=start;const tick=t=>{n++;last=t;if(t-start>=1400)resolve(n*1000/(last-start));else requestAnimationFrame(tick);};requestAnimationFrame(tick);}));if(fps<10)throw new Error(`WALK presentation regressed toward 1 FPS: ${fps.toFixed(1)} fps`);
  const runtimeFps=Number(await page.$eval("#viewport",v=>v.dataset.walkRuntimeFps||0));if(runtimeFps&&runtimeFps<10)throw new Error(`WALK runtime FPS contract failed: ${runtimeFps}`);

  const shotBefore=await page.evaluate(()=>({shots:Number(document.querySelector("#viewport")?.dataset.walkShots||0),sounds:Number(document.querySelector("#viewport")?.dataset.walkShotSoundEvents||0)}));await page.click("#footFire");await page.waitForFunction(before=>{const v=document.querySelector("#viewport");return Number(v?.dataset.walkShots||0)>before.shots&&Number(v?.dataset.walkShotSoundEvents||0)>before.sounds&&v?.dataset.walkShotAudioVisualSync==="muzzle+recoil+sound";},{timeout:3000},shotBefore);
  const humanBeforeDeploy=await page.evaluate(()=>{const p=globalThis.__arondightWalkMode.position;return{x:p.x,y:p.y,yaw:Number(document.querySelector("#viewport")?.dataset.walkYaw)||0};});

  await page.click("#playerModeButton");
  await page.waitForFunction(()=>{const v=document.querySelector("#viewport"),self=globalThis.__arondightRealWorld?.threeScene?.getObjectByName?.("LOCAL_HUMAN_VR");return v?.dataset.playerMode==="drone"&&v.dataset.playerVehicleMode==="drone"&&v.dataset.droneVehicleState==="deployed"&&v.dataset.droneAudioSuppressed==="0"&&v.dataset.droneAudioHardMuted==="0"&&v.dataset.localHumanAvatarVisible==="1"&&v.dataset.localHumanVr==="1"&&self?.visible;},{timeout:5000});
  const deployed=await page.evaluate(()=>{const b=globalThis.__arondightRealWorld,v=document.querySelector("#viewport"),anchor=globalThis.__arondightPlayerVehicleRuntime.humanAnchor,self=b.threeScene.getObjectByName("LOCAL_HUMAN_VR");let air=null;b.threeScene.traverse(node=>{if(!air&&node.userData?.arondightAirframe)air=node;});const headset=self.children.find(x=>x.geometry?.type==="BoxGeometry"&&Math.abs(x.position.z-1.61)<.02);return{anchor,self:{x:self.position.x,y:self.position.y,visible:self.visible,headset:Boolean(headset?.visible)},air:air?{x:air.position.x,y:air.position.y,z:air.position.z,visible:air.visible}:null,offset:Number(v.dataset.droneLaunchOffsetM||0),replication:v.dataset.playerVehicleReplication};});
  if(!deployed.air?.visible||!deployed.self.visible||!deployed.self.headset||deployed.replication!=="human+drone+audio+fx-v2"||Math.hypot(deployed.self.x-humanBeforeDeploy.x,deployed.self.y-humanBeforeDeploy.y)>.08||deployed.offset<.6||Math.hypot(deployed.air.x-deployed.anchor.x,deployed.air.y-deployed.anchor.y)<.55)throw new Error(`local standing VR human / drone launch contract failed: ${JSON.stringify({humanBeforeDeploy,deployed})}`);

  await page.evaluate(()=>{const p=globalThis.__arondightPlayerVehicleRuntime.humanAnchor,pose={p:[p.x+3,p.y,.04],q:[0,0,0,1],v:[0,0,0],t:performance.now(),f:"local-metric",pm:"drone",av:[p.x+2,p.y+1,0],ay:.35,avv:[0,0,0],vr:1};dispatchEvent(new CustomEvent("arondight45:vs-pose",{detail:{peerId:"vehicle-smoke-peer",pose}}));});
  await page.waitForFunction(()=>globalThis.__arondightRealWorld?.threeScene?.getObjectByName?.("VS_HUMAN_vehicle-smoke-peer")?.visible,{timeout:3000});
  const remote=await page.evaluate(()=>{const a=globalThis.__arondightRealWorld.threeScene.getObjectByName("VS_HUMAN_vehicle-smoke-peer"),headset=a.children.find(x=>x.geometry?.type==="BoxGeometry"&&Math.abs(x.position.z-1.61)<.02),hit=a.children.find(x=>x.userData?.vsPeerHitProxy);return{visible:a.visible,headset:Boolean(headset?.visible),hitId:hit?.userData?.vsPlayerId};});if(!remote.visible||!remote.headset||remote.hitId!=="vehicle-smoke-peer")throw new Error(`remote VR human missing: ${JSON.stringify(remote)}`);

  await page.click("#playerModeButton");await page.waitForFunction(()=>{const v=document.querySelector("#viewport"),self=globalThis.__arondightRealWorld?.threeScene?.getObjectByName?.("LOCAL_HUMAN_VR");return v?.dataset.playerMode==="foot"&&v.dataset.droneVehicleState==="stowed"&&v.dataset.droneAudioSuppressed==="1"&&v.dataset.droneAudioHardMuted==="1"&&self?.visible===false;},{timeout:5000});
  console.log(`Player vehicle V2 smoke passed: real mobile touch-drag look, rate-based LOOK edge hold/release, cached spatial collisions, >10 FPS anti-regression, synchronized pistol sound, hard drone-audio isolation, visible local VR human while drone flies, physical launch offset, multiplayer VR avatar: ${JSON.stringify({fps,runtimeFps,yawBefore,yawAfterDrag,yawHoldA,yawHoldB,yawReleaseA,yawReleaseB,beforeMove,afterMove,deployed,remote})}`);
}finally{await browser.close();}
