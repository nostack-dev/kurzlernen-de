import puppeteer from "puppeteer-core";

const executablePath=process.env.CHROME_BIN;
if(!executablePath)throw Error("CHROME_BIN required");
const url=new URL(process.argv[2]||"https://kurzlernen.de/drone_simulator.html");
url.searchParams.set("target-fire-root-cause",String(Date.now()));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader"]});
const page=await browser.newPage(),pageErrors=[];
page.on("pageerror",error=>pageErrors.push(String(error?.stack||error)));
const snap=()=>page.evaluate(()=>{const v=document.querySelector("#viewport"),wanted=globalThis.__arondightWantedSystem?.state||{},player=globalThis.__arondightPlayerDamageModel,drone=globalThis.__arondightDroneDamageModel;return{shots:Number(v?.dataset.fireShots||0),rays:Number(v?.dataset.fireRaycastShots||0),source:v?.dataset.fireInputSource||"",locked:v?.dataset.fireCombatLocked||"",lockReason:v?.dataset.fireLockReason||"",armed:v?.dataset.fireArmed||"",wantedHeat:Number(v?.dataset.wantedHeat||wanted.heat||0),wantedStars:Number(v?.dataset.wantedStars||wanted.stars||0),policeActive:Number(v?.dataset.wantedPoliceActive||wanted.policeActive||0),policeShots:Number(v?.dataset.wantedPoliceShots||0),playerHp:Number(player?.hp??v?.dataset.playerHp??0),playerDead:Boolean(player?.dead)||v?.dataset.playerDead==="1",droneHp:Number(drone?.hp??v?.dataset.droneHp??0),droneDestroyed:Boolean(drone?.destroyed)||v?.dataset.droneDestroyed==="1",populationHits:Number(v?.dataset.worldPopulationHits||0),ragdollSpawns:Number(v?.dataset.worldRagdollSpawns||0),ragdollPool:Number(v?.dataset.worldRagdollPool||0),assignments:Number(v?.dataset.combatHitStackAssignments||0),registry:v?.dataset.combatHitStackRegistry||""};});
try{
  await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148");
  await page.setViewport({width:844,height:390,deviceScaleFactor:1});
  await page.goto(url.href,{waitUntil:"load",timeout:30000});
  await page.waitForFunction(()=>document.querySelector("#status")?.textContent?.includes("SIM ready")&&document.body.classList.contains("solo-flight")&&globalThis.__arondightRealWorld?.threeScene,{timeout:30000});
  await page.waitForFunction(()=>{const button=document.querySelector("#soloArm");return button&&!button.disabled&&button.textContent.trim()==="ARM";},{timeout:20000});
  await page.click("#soloArm");
  await page.waitForFunction(()=>document.querySelector("#fcState")?.textContent==="ARMED"&&document.querySelector("#viewport")?.dataset.fireArmed==="1",{timeout:65000});
  await page.evaluate(()=>{const b=globalThis.__arondightRealWorld,v=document.querySelector("#viewport");v.dataset.worldMode="real";b.active=true;b.originLon=9;b.originLat=47;});
  await page.waitForFunction(()=>document.querySelector("#viewport")?.dataset.worldProceduralPopulation==="1",{timeout:12000});
  const setup=await page.evaluate(()=>{const b=globalThis.__arondightRealWorld,scene=b.threeScene,v=document.querySelector("#viewport"),seen=new Map();scene.traverse(node=>{if(node?.isMesh)node.raycast=()=>{};const id=String(node?.userData?.worldPopulationId||""),kind=String(node?.userData?.worldPopulationKind||"");if(node?.isMesh&&id&&kind==="person"&&!seen.has(id))seen.set(id,{id,kind,mesh:node});});const sequence=[...seen.values()].slice(0,18);if(sequence.length<12)throw Error(`insufficient people: ${sequence.length}`);globalThis.__targetFireRootDiag={sequence,current:null,moveTimer:0};b.active=false;const r=v.getBoundingClientRect(),rotated=v.dataset.soloOrientation==="css-landscape",aimX=v.clientWidth/2,aimY=v.clientHeight/2,client=rotated?{x:r.right-aimY,y:r.top+aimX}:{x:r.left+aimX,y:r.top+aimY};return{client,count:sequence.length};});
  const selectTarget=async index=>page.evaluate(index=>{const d=globalThis.__targetFireRootDiag,v=document.querySelector("#viewport"),rec=d.sequence[index];if(!rec)throw Error(`missing target ${index}`);if(d.current)d.current.mesh.raycast=()=>{};rec.mesh.userData.flightFireIgnore=false;rec.mesh.visible=true;rec.mesh.raycast=function(raycaster,intersections){const distance=.02,point=raycaster.ray.origin.clone().addScaledVector(raycaster.ray.direction,distance);intersections.push({distance,point,object:this,face:null,faceIndex:0});};d.current=rec;return{id:rec.id,before:Number(v.dataset.worldRagdollSpawns||0)};},index);
  await page.evaluate(({x,y})=>{const v=document.querySelector("#viewport"),d=globalThis.__targetFireRootDiag;v.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,cancelable:true,pointerId:191,pointerType:"touch",clientX:x,clientY:y,button:0,buttons:1,isPrimary:true}));let step=0;d.moveTimer=setInterval(()=>{step++;v.dispatchEvent(new PointerEvent("pointermove",{bubbles:true,cancelable:true,pointerId:191,pointerType:"touch",clientX:x+(step%5)-2,clientY:y+((step*2)%5)-2,button:-1,buttons:1,isPrimary:true}));},31);},setup.client);
  let previousShots=(await snap()).shots;
  for(let index=0;index<Math.min(14,setup.count);index++){
    const target=await selectTarget(index);
    await page.waitForFunction(before=>{const v=document.querySelector("#viewport");return Number(v?.dataset.worldRagdollSpawns||0)>before||v?.dataset.fireCombatLocked==="1";},{timeout:2500},target.before).catch(()=>{});
    await sleep(650);
    const state=await snap();
    console.log(`KILL_STEP ${index+1} ${JSON.stringify(state)}`);
    if(state.locked==="1"||state.playerDead||state.droneDestroyed){throw Error(`ROOT_CAUSE_FIRE_LOCK_AT_TARGET_${index+1}: ${JSON.stringify(state)} pageErrors=${JSON.stringify(pageErrors.slice(-3))}`);}
    if(state.ragdollSpawns<=target.before)throw Error(`TARGET_${index+1}_NOT_KILLED: ${JSON.stringify(state)} pageErrors=${JSON.stringify(pageErrors.slice(-3))}`);
    if(state.shots<=previousShots)throw Error(`TARGET_${index+1}_NO_NEW_SHOT: ${JSON.stringify(state)}`);
    previousShots=state.shots;
  }
  for(let second=1;second<=12;second++){
    await sleep(1000);const state=await snap();console.log(`POST_KILLS_${second}s ${JSON.stringify(state)}`);
    if(state.locked==="1"||state.playerDead||state.droneDestroyed)throw Error(`ROOT_CAUSE_FIRE_LOCK_AFTER_KILLS_${second}s: ${JSON.stringify(state)} pageErrors=${JSON.stringify(pageErrors.slice(-3))}`);
  }
  throw Error(`NO_FIRE_LOCK_REPRODUCED: ${JSON.stringify(await snap())} pageErrors=${JSON.stringify(pageErrors.slice(-3))}`);
}finally{
  try{await page.evaluate(()=>{const d=globalThis.__targetFireRootDiag,v=document.querySelector("#viewport");if(d?.moveTimer)clearInterval(d.moveTimer);v?.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,cancelable:true,pointerId:191,pointerType:"touch",button:0,buttons:0,isPrimary:true}));});}catch{}
  await browser.close();
}
