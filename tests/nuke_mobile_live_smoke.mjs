import puppeteer from "puppeteer-core";
import {mkdir} from "node:fs/promises";

const VISUAL_CONTRACT="world-anchored-volumetric-ground-burst-nuke-v21-depth-tested";
const input=process.argv[2]||"https://kurzlernen.de/drone_simulator.html";
const url=new URL(input);
const executablePath=process.env.CHROME_BIN;
if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");

const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader"]});
const page=await browser.newPage();
await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1");
const pause=ms=>page.evaluate(delay=>new Promise(resolve=>setTimeout(resolve,delay)),ms);

async function armDroneAtomically(){
  const deadline=Date.now()+15000;
  while(Date.now()<deadline){
    const state=await page.evaluate(()=>{const button=document.querySelector("#soloArm"),fc=(document.querySelector("#soloState")?.textContent||"").trim(),canDeploy=Boolean(globalThis.__arondightDroneDamageModel?.canDeploy);if(fc==="ARMED")return{armed:true,clicked:false,disabled:Boolean(button?.disabled),fc,canDeploy};if(button&&!button.disabled&&button.textContent.trim()==="ARM"&&canDeploy){button.click();return{armed:false,clicked:true,disabled:false,fc,canDeploy};}return{armed:false,clicked:false,disabled:Boolean(button?.disabled),fc,canDeploy};});
    if(state.armed)return state;
    if(state.clicked){try{await page.waitForFunction(()=>document.querySelector("#soloState")?.textContent?.trim()==="ARMED"&&document.querySelector("#viewport")?.dataset.fireArmed==="1",{timeout:9000});return await page.evaluate(()=>({armed:true,clicked:true,disabled:Boolean(document.querySelector("#soloArm")?.disabled),fc:document.querySelector("#soloState")?.textContent?.trim(),canDeploy:Boolean(globalThis.__arondightDroneDamageModel?.canDeploy)}));}catch{}}
    await pause(120);
  }
  throw new Error(`could not atomically arm healthy drone for NUKE: ${JSON.stringify(await page.evaluate(()=>({destroyed:Boolean(globalThis.__arondightDroneDamageModel?.destroyed),canDeploy:Boolean(globalThis.__arondightDroneDamageModel?.canDeploy),disabled:Boolean(document.querySelector("#soloArm")?.disabled),button:document.querySelector("#soloArm")?.textContent?.trim(),fc:document.querySelector("#soloState")?.textContent?.trim(),mode:globalThis.__arondightWalkMode?.mode})))}`);
}

try{
  await page.setViewport({width:844,height:390,deviceScaleFactor:1,isMobile:true,hasTouch:true});
  await page.goto(url.href,{waitUntil:"load",timeout:45000});
  await page.waitForFunction(()=>document.querySelector("#status")?.textContent?.includes("SIM ready")&&globalThis.__arondightDroneWeapons&&document.querySelector("#mobileGameplayDock"),{timeout:45000});
  await page.evaluate(()=>{globalThis.__arondightDroneDamageModel?.reset?.();globalThis.__arondightPlayerDamageModel?.reset?.();globalThis.__arondightWalkMode?.setMode?.("drone",{persist:false,reason:"nuke-live-regression"});globalThis.__arondightDroneWeapons?.setMode?.("nuke");});
  await page.waitForFunction(()=>document.querySelector("#mobileGameplayMode")?.textContent==="DRONE"&&document.querySelector("#mobileGameplayWeapon")?.textContent?.trim()==="WEAPON · NUKE"&&globalThis.__arondightDroneDamageModel?.canDeploy===true,{timeout:15000});
  const armPrep=await armDroneAtomically();

  const beforeShot=await page.$eval("#viewport",v=>({nukeLaunches:Number(v.dataset.nukeLaunches)||0,legacyMissiles:Number(v.dataset.droneMissiles)||0}));
  const tapPoint=await page.$eval("#viewport",v=>{const r=v.getBoundingClientRect();return{x:r.left+r.width*.50,y:r.top+r.height*.32};});
  await page.touchscreen.tap(tapPoint.x,tapPoint.y);
  await page.waitForFunction(before=>Number(document.querySelector("#viewport")?.dataset.nukeLaunches)>before,{timeout:3000},beforeShot.nukeLaunches);

  const shot=await page.evaluate(before=>{const v=document.querySelector("#viewport"),api=globalThis.__arondightDroneWeapons,target=String(v.dataset.nukeTarget||"").split(",").map(Number),camera=globalThis.__arondightRealWorld?.threeCamera;let targetDistance=0;if(camera&&target.length===3&&target.every(Number.isFinite)){const cam=camera.position.clone();camera.getWorldPosition(cam);const p=cam.clone().set(target[0],target[1],target[2]);targetDistance=cam.distanceTo(p);}return{fired:Number(v.dataset.nukeLaunches)>before.nukeLaunches,mode:api.displayMode||api.mode,selected:v.dataset.nukeSelected,contract:v.dataset.nukeContract,targetResolver:v.dataset.nukeTargetResolver,target:v.dataset.nukeTarget,targetXYZ:target,targetDistance,inputRoute:v.dataset.nukeInputRoute,routeFired:v.dataset.nukeInputRouteFired,legacyBypass:v.dataset.nukeLegacyMissileBypass,legacyMissilesBefore:before.legacyMissiles,legacyMissilesAfter:Number(v.dataset.droneMissiles)||0};},beforeShot);
  if(!(shot.fired&&shot.mode==="nuke"&&shot.selected==="1"&&shot.contract==="drone-targeted-fixed-impact-v2"&&shot.targetResolver==="ground-burst-xy-v1"&&shot.targetXYZ.length===3&&shot.targetXYZ.every(Number.isFinite)&&Math.abs(shot.targetXYZ[2])<.05&&shot.targetDistance>20&&shot.inputRoute==="window-capture-fireNuke-v1"&&shot.routeFired==="1"&&shot.legacyBypass==="blocked-v1"&&shot.legacyMissilesAfter===shot.legacyMissilesBefore))throw new Error(`real screen tap did not route exclusively to a ground-burst NUKE: ${JSON.stringify(shot)}`);

  await page.waitForFunction(()=>{const v=document.querySelector("#viewport");return Number(v?.dataset.nukeImpacts)>=1&&v.dataset.nukeOverkill==="world-anchored-nuclear-v5"&&v.dataset.nukeOverkillComposition==="world-space-impact-locked-v4"&&v.dataset.nukeScreenCloud==="removed-v2"&&v.dataset.nukeVisibleRenderer==="world-space-3d-v5"&&v.dataset.nukeVolumetricCloud==="sculpted-mushroom-v3"&&v.dataset.nukeVolumetricScreenSpace==="none"&&v.dataset.nukeVisibilityPolicy==="cinematic-depth-priority-v1"&&v.dataset.nukeVolumetricVisibility==="depth-tested-v4";},{timeout:6000});
  await page.waitForFunction(()=>{const v=document.querySelector("#viewport");return Number(v.dataset.nukeOverkillShockM)>250&&Number(v.dataset.nukeVolumetricProgress)>.55&&Number(v.dataset.nukeVolumetricHeat)>.35&&v.dataset.nukeOverkillPhase!=="whiteout";},{timeout:6500});
  await pause(550);

  const impact=await page.evaluate(()=>{
    const v=document.querySelector("#viewport"),scene=globalThis.__arondightRealWorld?.threeScene,camera=globalThis.__arondightRealWorld?.threeCamera,target=String(v.dataset.nukeTarget||"").split(",").map(Number),anchor=String(v.dataset.nukeOverkillAnchor||"").split(",").map(Number),volAnchor=String(v.dataset.nukeVolumetricAnchor||"").split(",").map(Number);
    const err=(a,b)=>a.length===3&&b.length===3&&a.every(Number.isFinite)&&b.every(Number.isFinite)?Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]):Infinity;
    const worldAnchorError=err(target,anchor),volumetricAnchorError=err(target,volAnchor);
    let visible3dSmoke=0,maxPixelRadius=0,totalOverkillParts=0,visibleCrown=0,visibleVolumetric=0,visibleVolumetricCrown=0,visibleReadableCrown=0,visibleHotCrown=0,visibleHotPlume=0,maxVolumetricPixelRadius=0,totalVolumetric=0,depthPriorityVolumetric=0,depthPriorityOverkill=0;
    if(scene&&camera){
      camera.updateMatrixWorld?.(true);const cam=camera.position.clone();camera.getWorldPosition(cam);const height=Math.max(1,v.clientHeight),fov=(camera.fov||60)*Math.PI/180;
      scene.traverse?.(node=>{
        if(node.visible===false)return;
        const role=String(node.userData?.nukeOverkillRole||"");
        if(node.userData?.nukeOverkillPart)totalOverkillParts++;
        if(node.userData?.nukeVolumetricPart)totalVolumetric++;
        if(!node.isMesh)return;
        const mats=(Array.isArray(node.material)?node.material:[node.material]).filter(Boolean),depthPriority=mats.length>0&&mats.every(material=>material.depthTest===false&&material.depthWrite===false);
        if(node.userData?.nukeVolumetricPart&&depthPriority)depthPriorityVolumetric++;
        if(node.userData?.nukeOverkillPart&&!node.userData?.nukeVolumetricPart&&depthPriority)depthPriorityOverkill++;
        const p=node.position.clone();node.getWorldPosition(p);const projected=p.clone().project(camera);
        if(Math.abs(projected.x)>1.15||Math.abs(projected.y)>1.15||projected.z<-1||projected.z>1)return;
        node.geometry?.computeBoundingSphere?.();const scale=node.scale.clone();node.getWorldScale(scale);const radius=(node.geometry?.boundingSphere?.radius||1)*Math.max(scale.x,scale.y,scale.z),distance=Math.max(.1,cam.distanceTo(p)),px=radius/distance*(height/(2*Math.tan(fov/2)));
        if(node.userData?.nukeOverkillPart&&(role.startsWith("plume-")||role.startsWith("crown-")||role==="crown-core"||role==="crown-lower")){visible3dSmoke++;if(role.startsWith("crown-")||role==="crown-core"||role==="crown-lower")visibleCrown++;maxPixelRadius=Math.max(maxPixelRadius,px);}
        if(node.userData?.nukeVolumetricPart){visibleVolumetric++;if(role.startsWith("crown-"))visibleVolumetricCrown++;if(role.startsWith("crown-visible-"))visibleReadableCrown++;if(role.startsWith("hot-crown-visible-"))visibleHotCrown++;if(role.startsWith("hot-plume-visible-"))visibleHotPlume++;maxVolumetricPixelRadius=Math.max(maxVolumetricPixelRadius,px);}
      });
    }
    const respawn=document.querySelector("#respawnOverlay"),destroyed=Boolean(globalThis.__arondightDroneDamageModel?.destroyed)||Boolean(respawn&&getComputedStyle(respawn).display!=="none"&&getComputedStyle(respawn).visibility!=="hidden"),screenCloudRemoved=!document.getElementById("nukeCinematicScreenCloud")&&!document.getElementById("nukeOverkillShockScreen");
    return{worldAnchorError,volumetricAnchorError,visible3dSmoke,visibleCrown,maxPixelRadius,totalOverkillParts,visibleVolumetric,visibleVolumetricCrown,visibleReadableCrown,visibleHotCrown,visibleHotPlume,maxVolumetricPixelRadius,totalVolumetric,depthPriorityVolumetric,depthPriorityOverkill,screenCloudRemoved,destroyed,overkill:v.dataset.nukeOverkill,composition:v.dataset.nukeOverkillComposition,renderer:v.dataset.nukeVisibleRenderer,cloudShape:v.dataset.nukeCloudShape,formation:v.dataset.nukeMushroomFormation,visibilityPolicy:v.dataset.nukeVisibilityPolicy,mushroomM:Number(v.dataset.nukeOverkillMushroomM)||0,fireballM:Number(v.dataset.nukeOverkillFireballM)||0,cloud:Number(v.dataset.nukeOverkillCloud)||0,shock:Number(v.dataset.nukeOverkillShockM)||0,phase:v.dataset.nukeOverkillPhase,volumetric:v.dataset.nukeVolumetricCloud,volumetricParts:Number(v.dataset.nukeVolumetricParts)||0,hotParts:Number(v.dataset.nukeVolumetricHotParts)||0,volumetricProgress:Number(v.dataset.nukeVolumetricProgress)||0,volumetricHeat:Number(v.dataset.nukeVolumetricHeat)||0,volumetricScreenSpace:v.dataset.nukeVolumetricScreenSpace,volumetricVisibility:v.dataset.nukeVolumetricVisibility,readableCrown:v.dataset.nukeVolumetricReadableCrown,silhouette:v.dataset.nukeVolumetricSilhouette,mode:globalThis.__arondightDroneWeapons?.displayMode||globalThis.__arondightDroneWeapons?.mode};
  });

  await mkdir("artifacts",{recursive:true});
  await page.screenshot({path:"artifacts/nuke-cinematic.png",captureBeyondViewport:false});
  if(!(impact.worldAnchorError<1&&impact.volumetricAnchorError<1&&impact.screenCloudRemoved&&impact.visibleVolumetric>=8&&impact.visibleVolumetricCrown>=1&&impact.visibleHotPlume>=1&&(impact.visibleReadableCrown>=1||impact.visibleHotCrown>=1||impact.visibleHotPlume>=2)&&impact.maxVolumetricPixelRadius>=35&&impact.totalVolumetric>=20&&impact.volumetricParts>=20&&impact.hotParts>=3&&impact.depthPriorityOverkill>=4&&impact.visibilityPolicy==="cinematic-depth-priority-v1"&&impact.volumetricVisibility==="depth-tested-v4"&&impact.volumetricHeat>.35&&impact.volumetric==="sculpted-mushroom-v3"&&impact.volumetricProgress>.55&&impact.volumetricScreenSpace==="none"&&impact.totalOverkillParts>=20&&impact.overkill==="world-anchored-nuclear-v5"&&impact.composition==="world-space-impact-locked-v4"&&impact.renderer==="world-space-3d-v5"&&impact.fireballM>=140&&impact.shock>250&&!impact.destroyed&&impact.mode==="nuke"))throw new Error(`volumetric ground-burst nuclear silhouette is incomplete or unreadable: ${JSON.stringify({shot,impact,armPrep})}`);
  console.log(`${VISUAL_CONTRACT} passed. ${JSON.stringify({shot,impact,armPrep})}`);
}finally{await browser.close();}