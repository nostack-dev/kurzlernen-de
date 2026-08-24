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

  await page.waitForFunction(()=>Number(document.querySelector("#viewport")?.dataset.combatHitStackStableFrames||0)>=8,{timeout:4000});
  const stack=await page.evaluate(async()=>{const wait=ms=>new Promise(r=>setTimeout(r,ms)),b=globalThis.__arondightRealWorld,v=document.querySelector("#viewport"),world=b?.registerWorldPopulationHit,vs=b?.registerVsHit,wraps=Number(v?.dataset.combatHitStackWraps||0);await wait(350);return{guard:v?.dataset.combatHitStackGuard||"",worldStable:world===b?.registerWorldPopulationHit,vsStable:vs===b?.registerVsHit,wrapsBefore:wraps,wrapsAfter:Number(v?.dataset.combatHitStackWraps||0)};});
  if(stack.guard!=="stable-v1"||!stack.worldStable||!stack.vsStable||stack.wrapsAfter!==stack.wrapsBefore)throw new Error(`target hit stack still grows over time: ${JSON.stringify(stack)}`);

  const stressBefore=await page.evaluate(async()=>{const wait=ms=>new Promise(r=>setTimeout(r,ms)),b=globalThis.__arondightRealWorld,v=document.querySelector("#viewport"),scene=b?.threeScene,camera=b?.threeCamera;let source=null;scene?.traverse?.(node=>{if(!source&&node?.isMesh&&node.geometry&&!node.userData?.flightFireDecal&&!node.userData?.flightFireTracer)source=node;});if(!source||!camera)throw Error("target fire stress needs one scene mesh and camera");const target=source.clone(false);target.name="TARGET_FIRE_STRESS";target.userData={...target.userData,worldPopulationKind:"person",worldPopulationId:"target-fire-stress",flightFireIgnore:false,arondightAirframe:false};target.raycast=source.raycast;const dir=camera.position.clone();camera.getWorldDirection(dir);target.position.copy(camera.position).addScaledVector(dir,5);target.scale.setScalar(4);target.updateMatrixWorld(true);scene.add(target);b.registerWorldPopulationHit=()=>{throw Error("synthetic target-hit failure");};await wait(120);const r=v.getBoundingClientRect(),clientX=r.left+r.width/2,clientY=r.top+r.height/2,before={shots:Number(v.dataset.fireShots||0),rays:Number(v.dataset.fireRaycastShots||0),errors:Number(v.dataset.combatHitStackErrors||0)};v.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,cancelable:true,pointerId:88,pointerType:"touch",clientX,clientY,button:0}));return before;});
  await sleep(1350);
  const stressAfter=await page.$eval("#viewport",v=>({shots:Number(v.dataset.fireShots||0),rays:Number(v.dataset.fireRaycastShots||0),errors:Number(v.dataset.combatHitStackErrors||0),source:v.dataset.fireInputSource,guard:v.dataset.combatHitStackGuard}));
  await page.evaluate(()=>document.querySelector("#viewport").dispatchEvent(new PointerEvent("pointerup",{bubbles:true,cancelable:true,pointerId:88,pointerType:"touch",button:0})));
  if(stressAfter.shots-stressBefore.shots<10||stressAfter.rays-stressBefore.rays<10||stressAfter.errors<=stressBefore.errors||stressAfter.guard!=="stable-v1")throw new Error(`target handler stopped sustained fire: ${JSON.stringify({stressBefore,stressAfter})}`);

  const feedback=await page.evaluate(()=>{
    dispatchEvent(new CustomEvent("arondight:combat-damage",{detail:{damage:25,hp:75}}));
    dispatchEvent(new CustomEvent("arondight:combat-hit-confirm",{detail:{hp:75}}));
    return{damage:document.querySelector(".combat-damage-vignette")?.classList.contains("active"),hit:document.querySelector(".xbox-crosshair")?.classList.contains("hit-confirm")};
  });
  if(!feedback.damage||!feedback.hit)throw new Error(`combat feedback missing: ${JSON.stringify(feedback)}`);

  console.log("Hitscan browser smoke passed: zero projectile pool, immediate raycast shot, 1:1 touch aim, stable target-hit wrapper stack, sustained fire survives target-handler failures, recoil and combat feedback.");
}finally{await browser.close();}