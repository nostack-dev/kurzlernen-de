import puppeteer from "puppeteer-core";

const input=process.argv[2]||"http://127.0.0.1:4174/drone_simulator.html",inputUrl=new URL(input,"http://127.0.0.1:4174"),url=inputUrl.pathname.endsWith("/drone_simulator.html")?new URL(inputUrl.href):new URL("/drone_simulator.html",inputUrl.origin),executablePath=process.env.CHROME_BIN;
if(process.env.GITHUB_SHA)url.searchParams.set("ci",process.env.GITHUB_SHA);if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");
const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader","--autoplay-policy=no-user-gesture-required"]}),page=await browser.newPage();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
  await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1");
  await page.setViewport({width:844,height:390,deviceScaleFactor:1});
  await page.goto(url.href,{waitUntil:"load",timeout:30000});
  await page.waitForFunction(()=>document.querySelector("#status")?.textContent?.includes("SIM ready")&&globalThis.__arondightWalkMode&&globalThis.__arondightPlayerVehicleRuntime&&document.querySelector("#playerModeButton"),{timeout:30000});
  await page.waitForFunction(()=>globalThis.__arondightVehicleRuntime&&document.querySelector("#viewport")?.dataset.droneVehicleRuntime==="box3d-reset-v1",{timeout:8000});

  await page.click("#playerModeButton");
  await page.waitForFunction(()=>{const v=document.querySelector("#viewport");return v?.dataset.playerMode==="foot"&&v.dataset.playerVehicleMode==="human"&&v.dataset.droneVehicleState==="stowed"&&v.dataset.droneAudioSuppressed==="1"&&document.querySelector("#footLookZone");},{timeout:5000});
  const footState=await page.evaluate(()=>{const b=globalThis.__arondightRealWorld,v=document.querySelector("#viewport");let air=null;b?.threeScene?.traverse?.(node=>{if(!air&&node.userData?.arondightAirframe)air=node;});return{profile:v.dataset.walkControlProfile,look:v.dataset.walkLookSurface,radius:v.dataset.walkCollisionRadiusM,pistol:v.dataset.walkPistolSound,airVisible:air?.visible,motorVolume:v.dataset.motorAudioVolumePct,audio:v.dataset.droneAudioSuppressed};});
  if(footState.profile!=="fps-drag-radius-slide-v4"||footState.look!=="drag+stick"||Number(footState.radius)<.25||footState.pistol!=="procedural-synced-v1"||footState.airVisible!==false||footState.audio!=="1")throw new Error(`human vehicle mode contract failed: ${JSON.stringify(footState)}`);

  const yawBefore=Number(await page.$eval("#viewport",v=>v.dataset.walkYaw||0));
  await page.evaluate(()=>{const z=document.querySelector("#footLookZone");for(const [type,x,y] of [["pointerdown",560,190],["pointermove",650,190],["pointerup",650,190]])z.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:91,pointerType:"touch",clientX:x,clientY:y,buttons:type==="pointerup"?0:1}));});
  await sleep(100);
  const yawAfter=Number(await page.$eval("#viewport",v=>v.dataset.walkYaw||0));
  if(yawAfter-yawBefore<.30)throw new Error(`FPS drag-look did not rotate view enough: ${yawBefore} -> ${yawAfter}`);

  const beforeMove=await page.$eval("#viewport",v=>v.dataset.walkPosition||"");
  const moveBox=await page.$eval("#footMove",el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};});
  await page.mouse.move(moveBox.x+moveBox.w/2,moveBox.y+moveBox.h/2);await page.mouse.down();await page.mouse.move(moveBox.x+moveBox.w/2,moveBox.y+moveBox.h*.13,{steps:4});await sleep(330);await page.mouse.up();
  const afterMove=await page.$eval("#viewport",v=>v.dataset.walkPosition||"");if(!beforeMove||beforeMove===afterMove)throw new Error(`human did not move: ${beforeMove} -> ${afterMove}`);

  const shotBefore=await page.evaluate(()=>({shots:Number(document.querySelector("#viewport")?.dataset.walkShots||0),sounds:Number(document.querySelector("#viewport")?.dataset.walkShotSoundEvents||0)}));
  await page.click("#footFire");
  await page.waitForFunction(before=>{const v=document.querySelector("#viewport");return Number(v?.dataset.walkShots||0)>before.shots&&Number(v?.dataset.walkShotSoundEvents||0)>before.sounds&&v?.dataset.walkShotAudioVisualSync==="muzzle+recoil+sound";},{timeout:3000},shotBefore);
  const humanBeforeDeploy=await page.evaluate(()=>{const p=globalThis.__arondightWalkMode.position;return{x:p.x,y:p.y,yaw:Number(document.querySelector("#viewport")?.dataset.walkYaw)||0};});

  await page.click("#playerModeButton");
  await page.waitForFunction(()=>{const v=document.querySelector("#viewport");return v?.dataset.playerMode==="drone"&&v.dataset.playerVehicleMode==="drone"&&v.dataset.droneVehicleState==="deployed"&&v.dataset.droneAudioSuppressed==="0"&&v.dataset.droneLaunchFromHuman==="1";},{timeout:5000});
  const deployed=await page.evaluate(()=>{const b=globalThis.__arondightRealWorld,anchor=globalThis.__arondightPlayerVehicleRuntime.humanAnchor;let air=null;b?.threeScene?.traverse?.(node=>{if(!air&&node.userData?.arondightAirframe)air=node;});return{anchor,air:air?{x:air.position.x,y:air.position.y,z:air.position.z,visible:air.visible}:null,state:globalThis.__arondightVehicleRuntime.getState?.(),vr:document.querySelector("#viewport")?.dataset.humanVrHeadset};});
  if(!deployed.air||!deployed.air.visible||deployed.vr!=="1"||Math.hypot(deployed.air.x-humanBeforeDeploy.x,deployed.air.y-humanBeforeDeploy.y)>.22||Math.hypot(deployed.anchor.x-humanBeforeDeploy.x,deployed.anchor.y-humanBeforeDeploy.y)>.08)throw new Error(`drone did not physically deploy from human: ${JSON.stringify({humanBeforeDeploy,deployed})}`);

  await page.evaluate(()=>{const b=globalThis.__arondightRealWorld,p=globalThis.__arondightPlayerVehicleRuntime.humanAnchor,pose={p:[p.x+3,p.y,.04],q:[0,0,0,1],v:[0,0,0],t:performance.now(),f:"local-metric",pm:"drone",av:[p.x+2,p.y+1,0],ay:.35,avv:[0,0,0],vr:1};dispatchEvent(new CustomEvent("arondight45:vs-pose",{detail:{peerId:"vehicle-smoke-peer",pose}}));});
  await page.waitForFunction(()=>{const a=globalThis.__arondightRealWorld?.threeScene?.getObjectByName?.("VS_HUMAN_vehicle-smoke-peer");return a?.visible&&a.children.some(x=>x.userData?.vsPlayerId==="vehicle-smoke-peer"&&x.visible);},{timeout:3000});
  const vrAvatar=await page.evaluate(()=>{const a=globalThis.__arondightRealWorld.threeScene.getObjectByName("VS_HUMAN_vehicle-smoke-peer");const headset=a.children.find(x=>x.geometry?.type==="BoxGeometry"&&Math.abs(x.position.z-1.61)<.02);const hit=a.children.find(x=>x.userData?.vsPeerHitProxy);return{visible:a.visible,headset:Boolean(headset?.visible),hitId:hit?.userData?.vsPlayerId,kind:hit?.userData?.worldPopulationKind};});
  if(!vrAvatar.visible||!vrAvatar.headset||vrAvatar.hitId!=="vehicle-smoke-peer"||vrAvatar.kind!=="vs-player")throw new Error(`remote VR human avatar contract failed: ${JSON.stringify(vrAvatar)}`);

  await page.evaluate(()=>{const p=globalThis.__arondightPlayerVehicleRuntime.humanAnchor,pose={p:[p.x+2,p.y+1,.04],q:[0,0,0,1],v:[1,0,0],t:performance.now()+33,f:"local-metric",pm:"foot",av:[p.x+2.5,p.y+1.2,0],ay:.45,avv:[1.3,.2,0],vr:0};dispatchEvent(new CustomEvent("arondight45:vs-pose",{detail:{peerId:"vehicle-smoke-peer",pose}}));});
  await sleep(120);
  const walkingAvatar=await page.evaluate(()=>{const a=globalThis.__arondightRealWorld.threeScene.getObjectByName("VS_HUMAN_vehicle-smoke-peer"),v=document.querySelector("#viewport");const headset=a.children.find(x=>x.geometry?.type==="BoxGeometry"&&Math.abs(x.position.z-1.61)<.02);let drone=null;globalThis.__arondightRealWorld.threeScene.traverse(node=>{if(!drone&&node.userData?.vsPlayerId==="vehicle-smoke-peer"&&(node.userData?.vsMultiplayerPeer||node.userData?.vsPeer))drone=node;});return{visible:a.visible,headset:Boolean(headset?.visible),droneVisible:drone?.visible??false,avatars:v.dataset.vsHumanAvatars,events:v.dataset.vsHumanPoseEvents};});
  if(!walkingAvatar.visible||walkingAvatar.headset||walkingAvatar.droneVisible||Number(walkingAvatar.avatars)<1||Number(walkingAvatar.events)<2)throw new Error(`remote WALK avatar/drone-stow replication failed: ${JSON.stringify(walkingAvatar)}`);

  await page.click("#playerModeButton");
  await page.waitForFunction(()=>{const v=document.querySelector("#viewport");return v?.dataset.playerMode==="foot"&&v.dataset.droneVehicleState==="stowed"&&v.dataset.droneAudioSuppressed==="1";},{timeout:5000});
  const returned=await page.evaluate(()=>{const p=globalThis.__arondightWalkMode.position,a=globalThis.__arondightPlayerVehicleRuntime.humanAnchor;let air=null;globalThis.__arondightRealWorld?.threeScene?.traverse?.(node=>{if(!air&&node.userData?.arondightAirframe)air=node;});return{p:{x:p.x,y:p.y},a,airVisible:air?.visible,replication:document.querySelector("#viewport")?.dataset.playerVehicleReplication};});
  if(returned.airVisible!==false||returned.replication!=="human+drone+audio+fx-v1"||Math.hypot(returned.p.x-returned.a.x,returned.p.y-returned.a.y)>.08)throw new Error(`return-to-human vehicle contract failed: ${JSON.stringify(returned)}`);
  console.log(`Player vehicle browser smoke passed: FPS drag-look, radius/slide collision contract, synchronized pistol audio, hard drone-audio isolation, physical drone launch from human, stow/return, replicated WALK/VR human avatar and multiplayer hitbox: ${JSON.stringify({yawBefore,yawAfter,beforeMove,afterMove,humanBeforeDeploy,deployed:{anchor:deployed.anchor,air:deployed.air},vrAvatar,walkingAvatar,returned})}`);
}finally{await browser.close();}
