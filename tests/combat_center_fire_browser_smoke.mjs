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

  const before=await page.$eval("#viewport",v=>({shots:Number(v.dataset.fireShots||0),rays:Number(v.dataset.fireRaycastShots||0),recoil:Number(v.dataset.fireRecoilImpulses||0)}));
  await page.evaluate(()=>{
    const v=document.querySelector("#viewport"),r=v.getBoundingClientRect(),clientX=r.left+r.width*.23,clientY=r.top+r.height*.31,rotated=v.dataset.soloOrientation==="css-landscape";
    v.dataset.testExpectedFireX=String(Math.max(0,Math.min(v.clientWidth,rotated?clientY-r.top:clientX-r.left)));
    v.dataset.testExpectedFireY=String(Math.max(0,Math.min(v.clientHeight,rotated?r.right-clientX:clientY-r.top)));
    v.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,cancelable:true,pointerId:77,pointerType:"touch",clientX,clientY,button:0}));
  });
  await page.waitForFunction(({shots,rays})=>{const v=document.querySelector("#viewport");return Number(v?.dataset.fireShots||0)>shots&&Number(v?.dataset.fireRaycastShots||0)>rays;},{timeout:3000},before);
  const fired=await page.$eval("#viewport",v=>({x:Number(v.dataset.fireAimX),y:Number(v.dataset.fireAimY),expectedX:Number(v.dataset.testExpectedFireX),expectedY:Number(v.dataset.testExpectedFireY),mode:v.dataset.fireAimMode,recoil:Number(v.dataset.fireRecoilImpulses||0)}));
  if(fired.mode!=="touch-1to1"||Math.abs(fired.x-fired.expectedX)>1||Math.abs(fired.y-fired.expectedY)>1||fired.recoil<=before.recoil)throw new Error(`touch hitscan not 1:1/recoiling: ${JSON.stringify(fired)}`);
  await page.evaluate(()=>document.querySelector("#viewport").dispatchEvent(new PointerEvent("pointerup",{bubbles:true,cancelable:true,pointerId:77,pointerType:"touch",button:0})));

  await page.evaluate(()=>{const b=globalThis.__arondightRealWorld,v=document.querySelector("#viewport");v.dataset.worldMode="real";b.active=true;b.originLon=9;b.originLat=47;});
  const required=["__gameplayPolishLiteWrapper","__realityDamageTop","__worldLivelinessWrapper","__playerVehicleHitRouterV2","__proceduralPopulationProvider"];
  await page.waitForFunction(required=>{const v=document.querySelector("#viewport"),markers=String(v?.dataset.combatHitStackWorldMarkers||"");return v?.dataset.worldProceduralPopulation==="1"&&v?.dataset.combatHitStackRegistry==="marker-union-v2"&&required.every(marker=>markers.includes(marker))&&Number(v?.dataset.combatHitStackStableFrames||0)>=12;},{timeout:8000},required);
  const stack=await page.evaluate(async()=>{const wait=ms=>new Promise(r=>setTimeout(r,ms)),b=globalThis.__arondightRealWorld,v=document.querySelector("#viewport"),world=b?.registerWorldPopulationHit,assignments=Number(v?.dataset.combatHitStackAssignments||0),markers=String(v?.dataset.combatHitStackWorldMarkers||"");await wait(450);return{registry:v?.dataset.combatHitStackRegistry||"",worldStable:world===b?.registerWorldPopulationHit,assignmentsBefore:assignments,assignmentsAfter:Number(v?.dataset.combatHitStackAssignments||0),markers,stableFrames:Number(v?.dataset.combatHitStackStableFrames||0)};});
  if(stack.registry!=="marker-union-v2"||!stack.worldStable||stack.assignmentsAfter!==stack.assignmentsBefore||required.some(marker=>!stack.markers.includes(marker)))throw new Error(`target hit stack still mutates over time: ${JSON.stringify(stack)}`);

  const stressBefore=await page.evaluate(async()=>{const wait=ms=>new Promise(r=>setTimeout(r,ms)),b=globalThis.__arondightRealWorld,v=document.querySelector("#viewport"),scene=b?.threeScene,camera=b?.threeCamera;let source=null;scene?.traverse?.(node=>{if(!source&&node?.isMesh&&node.geometry&&!node.userData?.flightFireDecal&&!node.userData?.flightFireTracer&&!node.userData?.arondightAirframe)source=node;});if(!source||!camera)throw Error("target fire stress needs one scene mesh and camera");b.active=false;const target=source.clone(false),dir=camera.position.clone();camera.getWorldDirection(dir);target.name="TARGET_FIRE_STRESS";target.userData={worldPopulationKind:"person",worldPopulationId:"target-fire-stress",flightFireIgnore:false};target.position.copy(camera.position).addScaledVector(dir,4);target.scale.setScalar(10);target.visible=true;target.frustumCulled=false;target.updateMatrixWorld(true);scene.add(target);const base=b.registerWorldPopulationHit;let calls=0;const probe=hit=>{if(hit?.object===target){calls++;v.dataset.testTargetHitCalls=String(calls);return true;}return Boolean(base(hit));};b.registerWorldPopulationHit=probe;await wait(300);if(b.registerWorldPopulationHit!==probe)throw Error("target handler changed again after probe install");const r=v.getBoundingClientRect(),clientX=r.left+r.width/2,clientY=r.top+r.height/2,before={shots:Number(v.dataset.fireShots||0),rays:Number(v.dataset.fireRaycastShots||0),targetHits:Number(v.dataset.testTargetHitCalls||0),assignments:Number(v.dataset.combatHitStackAssignments||0)};v.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,cancelable:true,pointerId:88,pointerType:"touch",clientX,clientY,button:0}));return before;});
  await sleep(1350);
  const stressAfter=await page.$eval("#viewport",v=>({shots:Number(v.dataset.fireShots||0),rays:Number(v.dataset.fireRaycastShots||0),targetHits:Number(v.dataset.testTargetHitCalls||0),assignments:Number(v.dataset.combatHitStackAssignments||0),source:v.dataset.fireInputSource}));
  await page.evaluate(()=>document.querySelector("#viewport").dispatchEvent(new PointerEvent("pointerup",{bubbles:true,cancelable:true,pointerId:88,pointerType:"touch",button:0})));
  if(stressAfter.shots-stressBefore.shots<10||stressAfter.rays-stressBefore.rays<10||stressAfter.targetHits-stressBefore.targetHits<10||stressAfter.assignments!==stressBefore.assignments)throw new Error(`sustained target fire regressed: ${JSON.stringify({stressBefore,stressAfter})}`);

  const feedback=await page.evaluate(()=>{
    dispatchEvent(new CustomEvent("arondight:combat-damage",{detail:{damage:25,hp:75}}));
    dispatchEvent(new CustomEvent("arondight:combat-hit-confirm",{detail:{hp:75}}));
    return{damage:document.querySelector(".combat-damage-vignette")?.classList.contains("active"),hit:document.querySelector(".xbox-crosshair")?.classList.contains("hit-confirm")};
  });
  if(!feedback.damage||!feedback.hit)throw new Error(`combat feedback missing: ${JSON.stringify(feedback)}`);

  console.log("Hitscan browser smoke passed: full WORLD/procedural target stack converges across startup order, stays stable and sustains center-target fire without handler growth.");
}finally{await browser.close();}