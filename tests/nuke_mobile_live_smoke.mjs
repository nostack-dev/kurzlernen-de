import puppeteer from "puppeteer-core";
import {mkdir} from "node:fs/promises";

const VISUAL_CONTRACT="world-anchored-3d-nuke-v12";
const input=process.argv[2]||"https://kurzlernen.de/drone_simulator.html";
const url=new URL(input);
const executablePath=process.env.CHROME_BIN;
if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");

const browser=await puppeteer.launch({
  headless:true,
  executablePath,
  args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader"]
});
const page=await browser.newPage();
await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1");
const pause=ms=>page.evaluate(delay=>new Promise(resolve=>setTimeout(resolve,delay)),ms);

async function armDroneAtomically(){
  const deadline=Date.now()+15000;
  while(Date.now()<deadline){
    const state=await page.evaluate(()=>{
      const button=document.querySelector("#soloArm");
      const fc=(document.querySelector("#soloState")?.textContent||"").trim();
      const canDeploy=Boolean(globalThis.__arondightDroneDamageModel?.canDeploy);
      if(fc==="ARMED")return{armed:true,clicked:false,disabled:Boolean(button?.disabled),fc,canDeploy};
      if(button&&!button.disabled&&button.textContent.trim()==="ARM"&&canDeploy){button.click();return{armed:false,clicked:true,disabled:false,fc,canDeploy};}
      return{armed:false,clicked:false,disabled:Boolean(button?.disabled),fc,canDeploy};
    });
    if(state.armed)return state;
    if(state.clicked){
      try{
        await page.waitForFunction(()=>document.querySelector("#soloState")?.textContent?.trim()==="ARMED"&&document.querySelector("#viewport")?.dataset.fireArmed==="1",{timeout:9000});
        return await page.evaluate(()=>({armed:true,clicked:true,disabled:Boolean(document.querySelector("#soloArm")?.disabled),fc:document.querySelector("#soloState")?.textContent?.trim(),canDeploy:Boolean(globalThis.__arondightDroneDamageModel?.canDeploy)}));
      }catch{}
    }
    await pause(120);
  }
  throw new Error(`could not atomically arm healthy drone for NUKE: ${JSON.stringify(await page.evaluate(()=>({destroyed:Boolean(globalThis.__arondightDroneDamageModel?.destroyed),canDeploy:Boolean(globalThis.__arondightDroneDamageModel?.canDeploy),disabled:Boolean(document.querySelector("#soloArm")?.disabled),button:document.querySelector("#soloArm")?.textContent?.trim(),fc:document.querySelector("#soloState")?.textContent?.trim(),mode:globalThis.__arondightWalkMode?.mode})))}`);
}

try{
  await page.setViewport({width:844,height:390,deviceScaleFactor:1,isMobile:true,hasTouch:true});
  await page.goto(url.href,{waitUntil:"load",timeout:45000});
  await page.waitForFunction(()=>document.querySelector("#status")?.textContent?.includes("SIM ready")&&globalThis.__arondightDroneWeapons&&document.querySelector("#mobileGameplayDock"),{timeout:45000});

  await page.evaluate(()=>{
    globalThis.__arondightDroneDamageModel?.reset?.();
    globalThis.__arondightPlayerDamageModel?.reset?.();
    globalThis.__arondightWalkMode?.setMode?.("drone",{persist:false,reason:"nuke-live-regression"});
    globalThis.__arondightDroneWeapons?.setMode?.("nuke");
  });
  await page.waitForFunction(()=>document.querySelector("#mobileGameplayMode")?.textContent==="DRONE"&&document.querySelector("#mobileGameplayWeapon")?.textContent?.trim()==="WEAPON · NUKE"&&globalThis.__arondightDroneDamageModel?.canDeploy===true,{timeout:15000});
  const armPrep=await armDroneAtomically();

  const beforeShot=await page.$eval("#viewport",v=>({nukeLaunches:Number(v.dataset.nukeLaunches)||0,legacyMissiles:Number(v.dataset.droneMissiles)||0}));
  const tapPoint=await page.$eval("#viewport",v=>{const r=v.getBoundingClientRect();return{x:r.left+r.width*.50,y:r.top+r.height*.32};});
  await page.touchscreen.tap(tapPoint.x,tapPoint.y);
  await page.waitForFunction(before=>Number(document.querySelector("#viewport")?.dataset.nukeLaunches)>before,{timeout:3000},beforeShot.nukeLaunches);

  const shot=await page.evaluate(before=>{
    const v=document.querySelector("#viewport"),api=globalThis.__arondightDroneWeapons;
    const target=String(v.dataset.nukeTarget||"").split(",").map(Number),camera=globalThis.__arondightRealWorld?.threeCamera;
    let targetDistance=0;
    if(camera&&target.length===3&&target.every(Number.isFinite)){
      const cam=camera.position.clone();camera.getWorldPosition(cam);
      const p=cam.clone().set(target[0],target[1],target[2]);targetDistance=cam.distanceTo(p);
    }
    return{fired:Number(v.dataset.nukeLaunches)>before.nukeLaunches,mode:api.displayMode||api.mode,selected:v.dataset.nukeSelected,contract:v.dataset.nukeContract,target:v.dataset.nukeTarget,targetDistance,inputRoute:v.dataset.nukeInputRoute,routeFired:v.dataset.nukeInputRouteFired,legacyBypass:v.dataset.nukeLegacyMissileBypass,legacyMissilesBefore:before.legacyMissiles,legacyMissilesAfter:Number(v.dataset.droneMissiles)||0};
  },beforeShot);
  if(!(shot.fired&&shot.mode==="nuke"&&shot.selected==="1"&&shot.contract==="drone-targeted-fixed-impact-v2"&&shot.targetDistance>20&&shot.inputRoute==="window-capture-fireNuke-v1"&&shot.routeFired==="1"&&shot.legacyBypass==="blocked-v1"&&shot.legacyMissilesAfter===shot.legacyMissilesBefore))throw new Error(`real screen tap did not route exclusively to NUKE: ${JSON.stringify(shot)}`);

  await page.waitForFunction(()=>{const v=document.querySelector("#viewport");return Number(v?.dataset.nukeImpacts)>=1&&v.dataset.nukeOverkill==="world-anchored-nuclear-v4"&&v.dataset.nukeOverkillComposition==="world-space-impact-locked-v4"&&v.dataset.nukeScreenCloud==="removed-v2"&&v.dataset.nukeVisibleRenderer==="world-space-3d-v4";},{timeout:6000});
  await page.waitForFunction(()=>{const v=document.querySelector("#viewport");return Number(v?.dataset.nukeOverkillCloud)>.18&&Number(v.dataset.nukeOverkillShockM)>70;},{timeout:5000});
  await page.waitForFunction(()=>document.querySelector("#viewport")?.dataset.nukeCameraShake==="shockwave-arrival-v3",{timeout:5000});
  await pause(650);

  const impact=await page.evaluate(()=>{
    const v=document.querySelector("#viewport"),scene=globalThis.__arondightRealWorld?.threeScene,camera=globalThis.__arondightRealWorld?.threeCamera;
    const target=String(v.dataset.nukeTarget||"").split(",").map(Number),anchor=String(v.dataset.nukeOverkillAnchor||"").split(",").map(Number);
    let worldAnchorError=Infinity;
    if(target.length===3&&anchor.length===3&&target.every(Number.isFinite)&&anchor.every(Number.isFinite))worldAnchorError=Math.hypot(target[0]-anchor[0],target[1]-anchor[1],target[2]-anchor[2]);
    let visible3dSmoke=0,maxPixelRadius=0,totalOverkillParts=0;
    if(scene&&camera){
      camera.updateMatrixWorld?.(true);const cam=camera.position.clone();camera.getWorldPosition(cam);const height=Math.max(1,v.clientHeight),fov=(camera.fov||60)*Math.PI/180;
      scene.traverse?.(node=>{
        if(node.visible===false||!node.userData?.nukeOverkillPart)return;
        totalOverkillParts++;
        const role=String(node.userData?.nukeOverkillRole||"");
        if(!node.isMesh||(!role.startsWith("plume-")&&!role.startsWith("crown-")&&role!=="crown-core"))return;
        const p=node.position.clone();node.getWorldPosition(p);const projected=p.clone().project(camera);
        if(Math.abs(projected.x)>1.15||Math.abs(projected.y)>1.15||projected.z<-1||projected.z>1)return;
        node.geometry?.computeBoundingSphere?.();const scale=node.scale.clone();node.getWorldScale(scale);
        const radius=(node.geometry?.boundingSphere?.radius||1)*Math.max(scale.x,scale.y,scale.z),distance=Math.max(.1,cam.distanceTo(p)),px=radius/distance*(height/(2*Math.tan(fov/2)));
        visible3dSmoke++;maxPixelRadius=Math.max(maxPixelRadius,px);
      });
    }
    const respawn=document.querySelector("#respawnOverlay");
    const destroyed=Boolean(globalThis.__arondightDroneDamageModel?.destroyed)||Boolean(respawn&&getComputedStyle(respawn).display!=="none"&&getComputedStyle(respawn).visibility!=="hidden");
    const screenCloudRemoved=!document.getElementById("nukeCinematicScreenCloud")&&!document.getElementById("nukeOverkillShockScreen");
    return{worldAnchorError,visible3dSmoke,maxPixelRadius,totalOverkillParts,screenCloudRemoved,destroyed,overkill:v.dataset.nukeOverkill,composition:v.dataset.nukeOverkillComposition,renderer:v.dataset.nukeVisibleRenderer,cloudShape:v.dataset.nukeCloudShape,mushroomM:Number(v.dataset.nukeOverkillMushroomM)||0,fireballM:Number(v.dataset.nukeOverkillFireballM)||0,cloud:Number(v.dataset.nukeOverkillCloud)||0,shock:Number(v.dataset.nukeOverkillShockM)||0,mode:globalThis.__arondightDroneWeapons?.displayMode||globalThis.__arondightDroneWeapons?.mode};
  });

  await mkdir("artifacts",{recursive:true});
  await page.screenshot({path:"artifacts/nuke-cinematic.png",captureBeyondViewport:false});

  if(!(impact.worldAnchorError<1&&impact.screenCloudRemoved&&impact.visible3dSmoke>=3&&impact.maxPixelRadius>=18&&impact.totalOverkillParts>=55&&impact.overkill==="world-anchored-nuclear-v4"&&impact.composition==="world-space-impact-locked-v4"&&impact.renderer==="world-space-3d-v4"&&impact.cloudShape==="3d-world-mushroom-v4"&&impact.mushroomM>=120&&impact.fireballM>=140&&impact.cloud>.18&&impact.shock>70&&!impact.destroyed&&impact.mode==="nuke"))throw new Error(`world-anchored 3D nuclear effect is incomplete: ${JSON.stringify({shot,impact,armPrep})}`);
  console.log(`${VISUAL_CONTRACT} passed. ${JSON.stringify({shot,impact,armPrep})}`);
}finally{
  await browser.close();
}
