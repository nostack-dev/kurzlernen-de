import puppeteer from "puppeteer-core";

const input=process.argv[2]||"http://127.0.0.1:4174/drone_simulator.html";
const url=new URL(input,"http://127.0.0.1:4174");
const executablePath=process.env.CHROME_BIN;if(!executablePath)throw Error("CHROME_BIN required");
if(process.env.GITHUB_SHA)url.searchParams.set("ci",process.env.GITHUB_SHA);url.searchParams.set("fps-target-drag-smoke",String(Date.now()));
const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader"]});
const page=await browser.newPage(),pageErrors=[];page.on("pageerror",e=>pageErrors.push(String(e?.stack||e)));
const snap=()=>page.evaluate(()=>{const v=document.querySelector("#viewport");return{shots:Number(v?.dataset.walkEnhancedShots||0),populationHits:Number(v?.dataset.worldPopulationHits||0),ragdolls:Number(v?.dataset.worldRagdollSpawns||0),ragdollPool:Number(v?.dataset.worldRagdollPool||0),stars:Number(v?.dataset.wantedStars||0),wantedPhase:v?.dataset.wantedPhase||"",playerHp:Number(v?.dataset.playerHp||v?.dataset.selfHp||100),walkDead:!!globalThis.__arondightWalkMode?.dead,screenAim:v?.dataset.walkScreenAimActive||"",screenPointer:v?.dataset.walkScreenAimPointer||"",capture:v?.dataset.walkScreenAimCaptureState||"",assignments:Number(v?.dataset.combatHitStackAssignments||0),stableFrames:Number(v?.dataset.combatHitStackStableFrames||0)};});
try{
  await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148");await page.setViewport({width:844,height:390,deviceScaleFactor:1,hasTouch:true});
  await page.goto(url.href,{waitUntil:"load",timeout:30000});
  await page.waitForFunction(()=>document.querySelector("#status")?.textContent?.includes("SIM ready")&&globalThis.__arondightRealWorld?.threeScene&&globalThis.__arondightWalkMode&&globalThis.__arondightFootWeapons,{timeout:30000});
  await page.evaluate(()=>{const b=globalThis.__arondightRealWorld,v=document.querySelector("#viewport");v.dataset.worldMode="real";b.active=true;b.originLon=9;b.originLat=47;globalThis.__arondightWalkMode.setMode("foot",{persist:false});globalThis.__arondightFootWeapons.setMode("pistol");});
  await page.waitForFunction(()=>document.querySelector("#viewport")?.dataset.worldProceduralPopulation==="1"&&globalThis.__arondightWalkMode?.mode==="foot"&&document.querySelector("#footLookZone"),{timeout:10000});
  await page.waitForFunction(()=>document.querySelector("#viewport")?.dataset.combatHitStackRegistry==="marker-union-v2"&&Number(document.querySelector("#viewport")?.dataset.combatHitStackStableFrames||0)>=12,{timeout:5000});

  const setup=await page.evaluate(()=>{const b=globalThis.__arondightRealWorld,scene=b.threeScene,v=document.querySelector("#viewport"),seen=new Map();scene.traverse(node=>{if(node?.isMesh)node.raycast=()=>{};const id=String(node?.userData?.worldPopulationId||""),kind=String(node?.userData?.worldPopulationKind||"");if(node?.isMesh&&id&&kind==="person"&&!seen.has(id))seen.set(id,{id,mesh:node});});const sequence=[...seen.values()].slice(0,12);if(sequence.length!==12)throw Error(`insufficient people: ${sequence.length}`);globalThis.__fpsRealTargetSmoke={sequence,current:null};b.active=false;const zone=document.querySelector("#footLookZone"),r=zone.getBoundingClientRect();return{x:r.left+r.width*.52,y:r.top+r.height*.48};});
  const arm=async index=>page.evaluate(index=>{const d=globalThis.__fpsRealTargetSmoke,v=document.querySelector("#viewport"),rec=d.sequence[index];if(!rec)throw Error(`missing target ${index}`);if(d.current)d.current.mesh.raycast=()=>{};const mesh=rec.mesh;mesh.userData.flightFireIgnore=false;mesh.visible=true;mesh.raycast=function(raycaster,intersections){const distance=.02,point=raycaster.ray.origin.clone().addScaledVector(raycaster.ray.direction,distance);intersections.push({distance,point,object:this,face:null,faceIndex:0});};d.current=rec;return{id:rec.id,before:Number(v.dataset.worldRagdollSpawns||0)};},index);

  let current=await arm(0),lastShots=(await snap()).shots;
  await page.evaluate(({x,y})=>{const zone=document.querySelector("#footLookZone");zone.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,cancelable:true,pointerId:991,pointerType:"touch",clientX:x,clientY:y,button:0,buttons:1,isPrimary:true}));},setup);
  for(let n=0;n<12;n++){
    if(n)current=await arm(n);
    try{await page.waitForFunction(before=>Number(document.querySelector("#viewport")?.dataset.worldRagdollSpawns||0)>before,{timeout:1800},current.before);}catch{const state=await snap();throw Error(`FPS drag target fire stopped at kill ${n+1}/12 id=${current.id}: ${JSON.stringify(state)} pageErrors=${JSON.stringify(pageErrors.slice(-4))}`);}
    const state=await snap();if(state.shots<=lastShots)throw Error(`FPS target ${n+1} died without new shot: ${JSON.stringify(state)}`);if(state.walkDead)throw Error(`FPS player died during target stress at ${n+1}: ${JSON.stringify(state)}`);lastShots=state.shots;
  }
  const finalState=await snap();
  if(finalState.ragdolls<12||finalState.populationHits<12||finalState.ragdollPool!==6||finalState.screenAim!=="1"||pageErrors.length)throw Error(`FPS target drag stress incomplete: ${JSON.stringify(finalState)} pageErrors=${JSON.stringify(pageErrors.slice(-6))}`);
  console.log(`FPS target drag passed: ${finalState.shots} shots, ${finalState.populationHits} population hits, 12 kills, ragdoll pool recycled, wanted=${finalState.stars}★ ${finalState.wantedPhase}.`);
}finally{try{await page.evaluate(()=>{const zone=document.querySelector("#footLookZone");zone?.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,cancelable:true,pointerId:991,pointerType:"touch",button:0,buttons:0,isPrimary:true}));});}catch{}await browser.close();}
