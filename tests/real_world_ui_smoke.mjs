import puppeteer from "puppeteer-core";
import {readFileSync} from "node:fs";

const base=process.argv[2]||"http://127.0.0.1:4174";
const executablePath=process.env.CHROME_BIN;
if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");

const bootstrap=readFileSync("sim/real_world_bootstrap.mjs","utf8");
const simulator=readFileSync("sim/simulator.mjs","utf8");
const settings=readFileSync("sim/control_settings.mjs","utf8");
const cameraSettings=readFileSync("sim/camera_settings.mjs","utf8");
const fireFx=readFileSync("sim/flight_fire_fx.mjs","utf8");
const logbook=readFileSync("sim/flight_logbook.mjs","utf8");
for(const marker of ["calculateCameraOptionsFromTo","worldMapEyeElevation","MINIMAP · N↑","toggleMinimapExpanded","setCameraFovDeg","addVisualShotImpact"])
  if(!bootstrap.includes(marker))throw new Error(`WORLD camera/minimap contract missing: ${marker}`);
if(settings.includes("MINIMAP FOLLOWS 360° CAMERA")||bootstrap.includes("WORLD_MINIMAP_FOLLOW_STORAGE"))throw new Error("obsolete camera-rotating minimap remains");
for(const marker of ["VIEW FOV","CAMERA_SETTINGS_EVENT","setCameraFovDeg"])
  if(!cameraSettings.includes(marker))throw new Error(`shared camera FOV contract missing: ${marker}`);
for(const marker of ["THREE.Raycaster","SHOT_INTERVAL_MS","BLOCKED_SELECTOR"])
  if(!fireFx.includes(marker))throw new Error(`presentation fire FX missing: ${marker}`);
for(const forbidden of ["applyForces(","b3Body_ApplyForce","motorOmega","StateController","fc::Runtime"])
  if(fireFx.includes(forbidden))throw new Error(`fire FX gained flight authority: ${forbidden}`);
for(const marker of ["FLIGHT_LOGBOOK_KEY","EXPORT JSON","maxForwardMps","maxRightMps"])
  if(!logbook.includes(marker))throw new Error(`flight logbook contract missing: ${marker}`);
for(const marker of ["-webkit-user-select:none","-webkit-touch-callout:none","selectstart","contextmenu"])
  if(!simulator.includes(marker))throw new Error(`mobile flight-surface suppression missing: ${marker}`);

for(const marker of ["#086a9d","#2f7044","#ffd34f","#dbe4e9","WATER","GREEN","ROADS","BUILDINGS"])
  if(!bootstrap.includes(marker))throw new Error(`WORLD semantic palette/legend marker missing: ${marker}`);

const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader"]});
const page=await browser.newPage();
const OPENFREEMAP_STYLE="https://tiles.openfreemap.org/styles/liberty";
const providerRequests=[];
const external=[];
const fixtureStyle={version:8,name:"Arondight45 CI world fixture",sources:{},layers:[{id:"background",type:"background",paint:{"background-color":"#243440"}}]};
await browser.defaultBrowserContext().overridePermissions(base,["geolocation"]);
await page.setGeolocation({latitude:39.569600,longitude:2.650200,accuracy:4});
await page.setRequestInterception(true);
page.on("request",request=>{
  const url=request.url(),parsed=new URL(url);
  if(["data:","blob:","about:"].includes(parsed.protocol)||["127.0.0.1","localhost"].includes(parsed.hostname)){request.continue();return;}
  external.push(url);
  if(url.startsWith(OPENFREEMAP_STYLE)){providerRequests.push(url);request.respond({status:200,contentType:"application/json",headers:{"access-control-allow-origin":"*","cache-control":"no-store"},body:JSON.stringify(fixtureStyle)});return;}
  request.abort();
});

const waitWorld=()=>page.waitForFunction(()=>{const v=document.querySelector("#viewport");return v?.dataset.worldMode==="real"&&v?.dataset.worldProvider==="openfreemap"&&Number(v?.dataset.worldThreeFrames||0)>4;},{timeout:20000});
const minimapBox=()=>page.$eval("#worldLookHud",el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};});

try{
  await page.setViewport({width:844,height:390,deviceScaleFactor:1});
  await page.goto(`${base}/drone_simulator.html`,{waitUntil:"load",timeout:30000});
  await page.waitForFunction(()=>document.querySelector("#status")?.textContent.includes("SIM ready"),{timeout:30000});
  await page.click("#camSolo");await page.waitForFunction(()=>document.body.classList.contains("solo-flight"),{timeout:5000});

  const mobileUx=await page.evaluate(()=>{const viewport=document.querySelector("#viewport"),s=getComputedStyle(viewport);return{select:s.userSelect,webkitSelect:s.webkitUserSelect,callout:s.webkitTouchCallout||"none",logbook:!!document.querySelector("#soloLogbook"),fire:!!document.querySelector("#flightFireStick")};});
  if(mobileUx.select!=="none"&&mobileUx.webkitSelect!=="none")throw new Error(`flight viewport remains selectable: ${JSON.stringify(mobileUx)}`);
  if(!mobileUx.logbook||!mobileUx.fire)throw new Error(`solo logbook/fire UI missing: ${JSON.stringify(mobileUx)}`);

  await page.click("#soloTopbar .phone-settings-button");await page.waitForFunction(()=>document.querySelector(".phone-settings-dialog")?.open,{timeout:5000});
  const config=await page.evaluate(()=>({section:!!document.querySelector('[data-world-settings="openfreemap-osm-3d"]'),grid:document.querySelector('[data-world-grid]')?.checked,keep:document.querySelector('[data-world-keep-look]')?.checked,obsolete:!!document.querySelector('[data-world-minimap-follow]'),fovLabel:[...document.querySelectorAll('.camera-settings-section label')].some(x=>x.textContent.includes('VIEW FOV')),note:document.querySelector('[data-world-settings="openfreemap-osm-3d"]')?.textContent||""}));
  if(!config.section||config.grid!==true||config.keep!==false||config.obsolete||!config.fovLabel||!config.note.includes("No account, API key, billing setup, backend or proxy"))throw new Error(`WORLD settings contract failed: ${JSON.stringify(config)}`);
  if(external.length)throw new Error(`settings path triggered external network: ${JSON.stringify(external)}`);
  await page.click('.phone-settings-dialog [data-close]');

  await page.click("#soloWorld");await waitWorld();
  const live=await page.evaluate(()=>{const v=document.querySelector("#viewport"),b=globalThis.__arondightRealWorld;return{button:document.querySelector("#soloWorld")?.textContent||"",mode:v?.dataset.worldMode,provider:v?.dataset.worldProvider,map:Boolean(b?.map),renderer:Boolean(b?.threeRenderer),minimap:v?.dataset.worldMinimapMode,miniBearing:v?.dataset.worldMinimapBearing,legend:getComputedStyle(document.querySelector("#worldMapLegend")).display,palette:Number(v?.dataset.worldPaletteLayers||0),canvasCount:document.querySelectorAll("#viewport canvas").length};});
  if(live.button!=="WORLD ✓"||live.mode!=="real"||live.provider!=="openfreemap"||!live.map||!live.renderer||live.minimap!=="north"||Number(live.miniBearing)!==0||live.legend==="none"||live.palette<1||live.canvasCount!==3)throw new Error(`WORLD live contract failed: ${JSON.stringify(live)}`);
  if(providerRequests.length!==1)throw new Error(`expected one OpenFreeMap style request, got ${providerRequests.length}`);

  // The old altitude bug reconstructed a low camera from target+zoom. Exercise the
  // real adapter directly with two eye altitudes: MapLibre must receive the exact
  // THREE eye altitude, not a ground-derived approximation.
  const eyeHeights=await page.evaluate(()=>{
    const b=globalThis.__arondightRealWorld,c=b.threeCamera,v=document.querySelector("#viewport"),saved={p:c.position.clone(),q:c.quaternion.clone(),u:c.up.clone(),mode:v.dataset.cameraMode};
    const run=z=>{v.dataset.cameraMode="fpv";c.position.set(12,-7,z);c.quaternion.set(0,0,0,1);c.up.set(0,1,0);b.lastMapSyncMs=-Infinity;b.syncMapCamera(c);return{eye:Number(v.dataset.worldMapEyeElevation),target:Number(v.dataset.worldMapTargetElevation),sync:v.dataset.worldMapSyncMode};};
    const low=run(5),high=run(50);c.position.copy(saved.p);c.quaternion.copy(saved.q);c.up.copy(saved.u);v.dataset.cameraMode=saved.mode;b.lastMapSyncMs=-Infinity;return{low,high};
  });
  if(Math.abs(eyeHeights.low.eye-5)>.01||Math.abs(eyeHeights.high.eye-50)>.01||eyeHeights.low.sync!=="rigid-eye-target"||eyeHeights.high.sync!=="rigid-eye-target"||eyeHeights.high.eye-eyeHeights.low.eye<44.9)throw new Error(`FPV eye altitude not preserved: ${JSON.stringify(eyeHeights)}`);

  // Same north-up minimap and same 360-look input in every camera mode.
  for(const expected of ["follow","third","fpv"]){
    await page.waitForFunction(mode=>document.querySelector("#viewport")?.dataset.cameraMode===mode,{timeout:3000},expected);
    const before=await page.evaluate(()=>Number(document.querySelector("#viewport")?.dataset.worldLookYaw||0));
    const box=await minimapBox();await page.mouse.move(box.x+box.w*.45,box.y+box.h*.58);await page.mouse.down();await page.mouse.move(box.x+box.w*.72,box.y+box.h*.46,{steps:4});await page.mouse.up();
    await page.waitForFunction(start=>Math.abs(Number(document.querySelector("#viewport")?.dataset.worldLookYaw||0)-start)>5,{timeout:3000},before);
    const mode=await page.evaluate(()=>({camera:document.querySelector("#viewport")?.dataset.cameraMode,mini:document.querySelector("#viewport")?.dataset.worldMinimapMode,bearing:Number(document.querySelector("#viewport")?.dataset.worldMinimapBearing||99)}));
    if(mode.camera!==expected||mode.mini!=="north"||Math.abs(mode.bearing)>.01)throw new Error(`${expected} changed minimap contract: ${JSON.stringify(mode)}`);
    await page.evaluate(()=>globalThis.__arondightRealWorld.resetLook(true));
    await page.click("#soloCamera");
  }

  // Pinch the minimap: it updates the one persisted VIEW FOV, which Settings reads.
  const fov=await page.evaluate(()=>{
    const hud=document.querySelector("#worldLookHud"),r=hud.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2,send=(type,id,x,y)=>hud.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:id,pointerType:"touch",clientX:x,clientY:y,button:0}));
    const before=JSON.parse(localStorage.getItem("arondight45CameraSettingsV1")||"{}").fpvFovDeg||105;send("pointerdown",41,cx-18,cy);send("pointerdown",42,cx+18,cy);send("pointermove",42,cx+44,cy);send("pointerup",42,cx+44,cy);send("pointerup",41,cx-18,cy);const after=JSON.parse(localStorage.getItem("arondight45CameraSettingsV1")||"{}").fpvFovDeg;return{before,after};
  });
  if(!(Number.isFinite(fov.after)&&Math.abs(fov.after-fov.before)>2))throw new Error(`minimap pinch did not update shared FOV: ${JSON.stringify(fov)}`);
  await page.click("#soloTopbar .phone-settings-button");await page.waitForFunction(()=>document.querySelector(".phone-settings-dialog")?.open,{timeout:5000});
  const sliderFov=await page.$eval('[data-camera-slider="fov"]',el=>Number(el.value));if(Math.abs(sliderFov-fov.after)>.6)throw new Error(`Settings FOV is not synchronized with minimap pinch: ${sliderFov} vs ${fov.after}`);await page.click('.phone-settings-dialog [data-close]');

  // Double-tap expands the same NORTH-UP minimap; orientation must not change.
  const box=await minimapBox();await page.mouse.click(box.x+box.w/2,box.y+box.h/2);await new Promise(r=>setTimeout(r,120));await page.mouse.click(box.x+box.w/2,box.y+box.h/2);await page.waitForFunction(()=>document.querySelector("#worldLookHud")?.classList.contains("expanded"),{timeout:2000});
  const expanded=await page.evaluate(()=>{const h=document.querySelector("#worldLookHud"),r=h.getBoundingClientRect(),v=document.querySelector("#viewport");return{w:r.width,h:r.height,mode:v.dataset.worldMinimapMode,bearing:Number(v.dataset.worldMinimapBearing||99)};});if(expanded.w<250||expanded.h<200||expanded.mode!=="north"||Math.abs(expanded.bearing)>.01)throw new Error(`expanded minimap contract failed: ${JSON.stringify(expanded)}`);

  // Free flight surface creates only presentation fire FX. Minimap/menu/sticks are excluded.
  const viewportRect=await page.$eval("#viewport",el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};});
  const shots0=await page.evaluate(()=>Number(document.querySelector("#viewport")?.dataset.fireShots||0));await page.mouse.move(viewportRect.x+viewportRect.w*.50,viewportRect.y+viewportRect.h*.48);await page.mouse.down();await new Promise(r=>setTimeout(r,240));await page.mouse.up();await page.waitForFunction(n=>Number(document.querySelector("#viewport")?.dataset.fireShots||0)>n,{timeout:2000},shots0);const shots1=await page.evaluate(()=>Number(document.querySelector("#viewport")?.dataset.fireShots||0));
  const mini=await minimapBox();await page.mouse.move(mini.x+mini.w*.4,mini.y+mini.h*.5);await page.mouse.down();await new Promise(r=>setTimeout(r,220));await page.mouse.up();const shots2=await page.evaluate(()=>Number(document.querySelector("#viewport")?.dataset.fireShots||0));if(shots2!==shots1)throw new Error(`minimap touch leaked into fire control: ${shots1} -> ${shots2}`);

  // Logbook persistence is local telemetry only. Exercise its public session API.
  const log=await page.evaluate(()=>{const l=globalThis.__arondightFlightLogbook;l.clear();l.observe({simTime:1,armed:true,x:0,y:0,z:2,vx:0,vy:0,vz:0,yawDeg:0,speed:0,agl:2,aglValid:true,batteryV:16.7,worldMode:"real"});l.observe({simTime:3,armed:true,x:2,y:0,z:2,vx:-1,vy:0,vz:0,yawDeg:0,speed:1,agl:2,aglValid:true,batteryV:16.4,worldMode:"real"});l.observe({simTime:4,armed:false,disarmReason:"TEST_END",x:2,y:0,z:2,vx:0,vy:0,vz:0,yawDeg:0,speed:0,agl:2,aglValid:true,batteryV:16.3,worldMode:"real"});const snap=l.snapshot();return{count:snap.entries.length,entry:snap.entries[0],stored:JSON.parse(localStorage.getItem("arondight45FlightLogbookV1")||"[]").length};});if(log.count!==1||log.stored!==1||log.entry.endReason!=="TEST_END"||log.entry.distanceM<1.9||log.entry.maxForwardMps<.9)throw new Error(`flight logbook session failed: ${JSON.stringify(log)}`);

  console.log(`REAL WORLD E2E passed: exact 5/50m FPV eye pose, shared north-up minimap, pinch FOV, double-tap expansion, mobile-safe fire FX and local flight logbook.`);
}finally{await browser.close();}
