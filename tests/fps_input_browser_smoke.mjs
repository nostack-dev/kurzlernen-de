import puppeteer from "puppeteer-core";

const input=process.argv[2]||"http://127.0.0.1:4174/drone_simulator.html",url=new URL(input,"http://127.0.0.1:4174"),executablePath=process.env.CHROME_BIN;
if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");if(process.env.GITHUB_SHA)url.searchParams.set("ci",process.env.GITHUB_SHA);
const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader"]}),page=await browser.newPage();
const pause=ms=>page.evaluate(delay=>new Promise(resolve=>setTimeout(resolve,delay)),ms);
try{
  await page.setViewport({width:960,height:540,deviceScaleFactor:1,hasTouch:true});await page.goto(url.href,{waitUntil:"load",timeout:30000});
  await page.waitForFunction(()=>document.querySelector("#status")?.textContent?.includes("SIM ready")&&globalThis.__arondightWalkMode&&globalThis.__arondightPlayerVehicleRuntime,{timeout:30000});
  await page.evaluate(()=>{globalThis.__arondightPlayerDamageModel?.reset?.();globalThis.__arondightWalkMode.setMode("foot",{persist:false});});
  await page.waitForFunction(()=>{const v=document.querySelector("#viewport");return v?.dataset.playerMode==="foot"&&document.querySelector("#footMove")&&document.querySelector("#footLookZone")&&v.dataset.walkCollisionResolution==="substep+building-edge-tangent-v1";},{timeout:5000});

  const movePoint=await page.$eval("#footMove",el=>{const r=el.getBoundingClientRect(),id=773,center={x:r.left+r.width/2,y:r.top+r.height/2},edge={x:r.right-2,y:r.top+r.height/2};el.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,cancelable:true,pointerId:id,pointerType:"touch",button:0,buttons:1,clientX:center.x,clientY:center.y}));el.dispatchEvent(new PointerEvent("pointermove",{bubbles:true,cancelable:true,pointerId:id,pointerType:"touch",button:0,buttons:1,clientX:edge.x,clientY:edge.y}));return edge;});await pause(80);
  const initial=await page.$eval("#viewport",v=>({move:v.dataset.walkMove,owner:v.dataset.walkMoveStickOwner,magnitude:Number(v.dataset.walkMoveStickMagnitude||0)}));
  if(initial.owner!=="773"||initial.magnitude<.94||String(initial.move||"").startsWith("0.000,0.000"))throw new Error(`left move pointer failed: ${JSON.stringify(initial)}`);

  await page.$eval("#footLook",el=>el.dispatchEvent(new PointerEvent("lostpointercapture",{bubbles:true,cancelable:false,pointerId:991,pointerType:"touch"})));await pause(60);
  const foreign=await page.$eval("#viewport",v=>({owner:v.dataset.walkMoveStickOwner,foreign:v.dataset.walkMoveStickForeignCapture}));if(foreign.owner!=="773"||foreign.foreign!=="991")throw new Error(`foreign capture stole move ownership: ${JSON.stringify(foreign)}`);
  await page.evaluate(({x,y})=>window.dispatchEvent(new PointerEvent("pointermove",{bubbles:true,cancelable:true,pointerId:773,pointerType:"touch",button:0,buttons:1,clientX:x,clientY:y})),movePoint);await pause(60);
  const resumed=await page.$eval("#viewport",v=>({move:v.dataset.walkMove,owner:v.dataset.walkMoveStickOwner}));if(resumed.owner!=="773"||String(resumed.move||"").startsWith("0.000,0.000"))throw new Error(`owned move did not resume after foreign capture: ${JSON.stringify(resumed)}`);

  const shotsBefore=Number(await page.$eval("#viewport",v=>v.dataset.walkEnhancedShots||0));
  await page.$eval("#footLookZone",el=>{const r=el.getBoundingClientRect(),id=992,x=r.left+r.width*.68,y=r.top+r.height*.40;el.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,cancelable:true,pointerId:id,pointerType:"touch",button:0,buttons:1,clientX:x,clientY:y}));el.dispatchEvent(new PointerEvent("pointermove",{bubbles:true,cancelable:true,pointerId:id,pointerType:"touch",button:0,buttons:1,clientX:x-70,clientY:y+45}));el.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,cancelable:true,pointerId:id,pointerType:"touch",button:0,buttons:0,clientX:x-70,clientY:y+45}));});
  await page.waitForFunction(before=>Number(document.querySelector("#viewport")?.dataset.walkEnhancedShots||0)>before,{timeout:2500},shotsBefore);await pause(80);
  const afterFire=await page.$eval("#viewport",v=>({move:v.dataset.walkMove,owner:v.dataset.walkMoveStickOwner,ownership:v.dataset.walkTouchOwnership,hud:v.dataset.mobileLandscapeHud,collision:v.dataset.walkCollisionResolution,shots:Number(v.dataset.walkEnhancedShots||0),dead:v.dataset.playerDead}));
  if(afterFire.owner!=="773"||String(afterFire.move||"").startsWith("0.000,0.000")||afterFire.ownership!=="left-move+right-look+screen-fire-no-drag-v2"||afterFire.hud!=="compact-real-estate-v2"||afterFire.collision!=="substep+building-edge-tangent-v1"||afterFire.dead==="1")throw new Error(`screen drag interrupted FPS input: ${JSON.stringify(afterFire)}`);

  await page.evaluate(()=>window.dispatchEvent(new Event("blur")));await page.waitForFunction(()=>{const v=document.querySelector("#viewport");return v?.dataset.walkMoveStickOwner==="none"&&String(v.dataset.walkMove||"").startsWith("0.000,0.000");},{timeout:2000});
  console.log(`Focused FPS input smoke passed: full-range move, foreign capture isolation, resumed owner input, screen-drag fire without move theft, current compact HUD, and wall-tangent collision owner: ${JSON.stringify({initial,foreign,resumed,afterFire})}`);
}finally{await browser.close();}
