import puppeteer from "puppeteer-core";

const input=process.argv[2]||"http://127.0.0.1:4174/drone_simulator.html";
const url=new URL(input,"http://127.0.0.1:4174");
const executablePath=process.env.CHROME_BIN;
if(process.env.GITHUB_SHA)url.searchParams.set("ci",process.env.GITHUB_SHA);
if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");

const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader"]});
const page=await browser.newPage();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
  await page.setViewport({width:844,height:390,deviceScaleFactor:1});
  await page.goto(url.href,{waitUntil:"load",timeout:30000});
  await page.waitForFunction(()=>document.querySelector("#status")?.textContent?.includes("SIM ready")&&document.body.classList.contains("solo-flight"),{timeout:30000});

  const contract=await page.$eval("#viewport",v=>({mode:v.dataset.fireHitMode,pool:v.dataset.fireProjectilePoolSize,crosshair:v.dataset.fireCrosshairMode}));
  if(contract.mode!=="box3d-raycast-hitscan"||contract.pool!=="0"||contract.crosshair!=="center-fixed")throw new Error(`hitscan runtime contract missing: ${JSON.stringify(contract)}`);

  await page.evaluate(()=>{const b=globalThis.__arondightRealWorld,v=document.querySelector("#viewport");v.dataset.worldMode="real";b.active=true;b.originLon=9;b.originLat=47;});
  const required=["__gameplayPolishLiteWrapper","__realityDamageTop","__worldLivelinessWrapper","__playerVehicleHitRouterV2","__proceduralPopulationProvider"];
  await page.waitForFunction(required=>{const v=document.querySelector("#viewport"),markers=String(v?.dataset.combatHitStackWorldMarkers||"");return v?.dataset.worldProceduralPopulation==="1"&&v?.dataset.combatHitStackRegistry==="marker-union-v3"&&v?.dataset.combatTargetGuard==="exception-isolated-v1"&&required.every(marker=>markers.includes(marker))&&Number(v?.dataset.combatHitStackStableFrames||0)>=12;},{timeout:10000},required);

  const stack=await page.evaluate(async()=>{const wait=ms=>new Promise(r=>setTimeout(r,ms)),b=globalThis.__arondightRealWorld,v=document.querySelector("#viewport"),world=b?.registerWorldPopulationHit,assignments=Number(v?.dataset.combatHitStackAssignments||0);await wait(350);return{worldStable:world===b?.registerWorldPopulationHit,assignmentsBefore:assignments,assignmentsAfter:Number(v?.dataset.combatHitStackAssignments||0),markers:String(v?.dataset.combatHitStackWorldMarkers||"")};});
  if(!stack.worldStable||stack.assignmentsAfter!==stack.assignmentsBefore||required.some(marker=>!stack.markers.includes(marker)))throw new Error(`target hit stack still mutates: ${JSON.stringify(stack)}`);

  const stressBefore=await page.evaluate(async()=>{
    const wait=ms=>new Promise(r=>setTimeout(r,ms)),b=globalThis.__arondightRealWorld,v=document.querySelector("#viewport"),scene=b?.threeScene,camera=b?.threeCamera;
    if(!scene||!camera)throw Error("target fire stress needs scene and camera");
    let source=null;scene.traverse(node=>{const type=String(node?.geometry?.type||"");if(!source&&node?.isMesh&&node.geometry&&!node.userData?.arondightAirframe&&(type.includes("Box")||type.includes("Sphere")))source=node;});
    if(!source)throw Error("target fire stress needs one box/sphere mesh");
    b.active=false;
    scene.traverse(node=>{if(node?.isMesh)node.userData.flightFireIgnore=true;});
    const target=source.clone(false),dir=camera.position.clone();camera.getWorldDirection(dir);
    target.name="TARGET_FIRE_STRESS";target.userData={worldPopulationKind:"person",worldPopulationId:"target-fire-stress",flightFireIgnore:false};
    target.position.copy(camera.position).addScaledVector(dir,3);target.quaternion.copy(camera.quaternion);target.scale.setScalar(8);target.visible=true;target.frustumCulled=false;scene.add(target);scene.updateMatrixWorld(true);target.updateMatrixWorld(true);
    const base=b.registerWorldPopulationHit;let hits=0;
    b.registerWorldPopulationHit=hit=>{if(hit?.object===target){hits++;v.dataset.testTargetHitCalls=String(hits);return true;}return Boolean(base(hit));};
    await wait(250);
    const installed=b.registerWorldPopulationHit,assignments=Number(v.dataset.combatHitStackAssignments||0),r=v.getBoundingClientRect(),clientX=r.left+r.width/2,clientY=r.top+r.height/2;
    globalThis.__targetFireStress={installed,pointerId:88,clientX,clientY};
    const before={shots:Number(v.dataset.fireShots||0),rays:Number(v.dataset.fireRaycastShots||0),targetHits:Number(v.dataset.testTargetHitCalls||0),assignments,errors:Number(v.dataset.combatTargetErrors||0)};
    v.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,cancelable:true,pointerId:88,pointerType:"touch",clientX,clientY,button:0,buttons:1,isPrimary:true}));
    return before;
  });

  for(let i=0;i<16;i++){
    await sleep(90);
    await page.evaluate(i=>{const s=globalThis.__targetFireStress,v=document.querySelector("#viewport");if(!s)return;const dx=(i%3-1)*4,dy=((i+1)%3-1)*3;v.dispatchEvent(new PointerEvent("pointermove",{bubbles:true,cancelable:true,pointerId:s.pointerId,pointerType:"touch",clientX:s.clientX+dx,clientY:s.clientY+dy,button:-1,buttons:1,isPrimary:true}));},i);
  }
  await sleep(180);

  const stressAfter=await page.evaluate(()=>{const b=globalThis.__arondightRealWorld,v=document.querySelector("#viewport"),s=globalThis.__targetFireStress;return{shots:Number(v.dataset.fireShots||0),rays:Number(v.dataset.fireRaycastShots||0),targetHits:Number(v.dataset.testTargetHitCalls||0),assignments:Number(v.dataset.combatHitStackAssignments||0),errors:Number(v.dataset.combatTargetErrors||0),source:v.dataset.fireInputSource,handlerStable:s?.installed===b?.registerWorldPopulationHit};});
  await page.evaluate(()=>{const s=globalThis.__targetFireStress,v=document.querySelector("#viewport");if(s)v.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,cancelable:true,pointerId:s.pointerId,pointerType:"touch",clientX:s.clientX,clientY:s.clientY,button:0,buttons:0,isPrimary:true}));});

  const delta={shots:stressAfter.shots-stressBefore.shots,rays:stressAfter.rays-stressBefore.rays,targetHits:stressAfter.targetHits-stressBefore.targetHits};
  if(delta.shots<12||delta.rays<12||delta.targetHits<12||stressAfter.assignments!==stressBefore.assignments||stressAfter.errors!==stressBefore.errors||!stressAfter.handlerStable)throw new Error(`sustained drag target fire regressed: ${JSON.stringify({stressBefore,stressAfter,delta})}`);

  const feedback=await page.evaluate(()=>{dispatchEvent(new CustomEvent("arondight:combat-damage",{detail:{damage:25,hp:75}}));dispatchEvent(new CustomEvent("arondight:combat-hit-confirm",{detail:{hp:75}}));return{damage:document.querySelector(".combat-damage-vignette")?.classList.contains("active"),hit:document.querySelector(".xbox-crosshair")?.classList.contains("hit-confirm")};});
  if(!feedback.damage||!feedback.hit)throw new Error(`combat feedback missing: ${JSON.stringify(feedback)}`);

  console.log(`Hitscan browser smoke passed: stable target router and sustained drag fire (${delta.shots} shots / ${delta.targetHits} target hits) without handler growth.`);
}finally{await browser.close();}
