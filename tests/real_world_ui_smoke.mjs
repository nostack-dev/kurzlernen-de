import puppeteer from "puppeteer-core";
import {readFileSync} from "node:fs";
import {installDeterministicWorldFixture} from "./world_browser_fixture.mjs";

const base=process.argv[2]||"http://127.0.0.1:4174";
const executablePath=process.env.CHROME_BIN;
if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");

const bootstrap=readFileSync("sim/real_world_bootstrap.mjs","utf8");
const autoStart=readFileSync("sim/auto_flight_start.mjs","utf8");
const simulator=readFileSync("sim/simulator.mjs","utf8");
const settings=readFileSync("sim/control_settings.mjs","utf8");
const cameraSettings=readFileSync("sim/camera_settings.mjs","utf8");
const fireFx=readFileSync("sim/flight_fire_fx.mjs","utf8");
const logbook=readFileSync("sim/flight_logbook.mjs","utf8");

for(const marker of ["calculateCameraOptionsFromTo","worldMapEyeElevation","MINIMAP · N↑ · TOP","toggleMinimapExpanded","setCameraFovDeg","addVisualShotImpact","WORLD_MINIMAP_AXIS_LOCK_STORAGE","worldMinimapProjection=\"topdown\"","worldMinimapHeightMode=\"flat-footprints\"","setMinimapAxisLocked","WORLD_IMAGERY_TILE_URL","WORLD_IMAGERY_STORAGE","addWorldImagery","drawMinimapImagery","setImageryEnabled"])
  if(!bootstrap.includes(marker))throw new Error(`WORLD camera/minimap contract missing: ${marker}`);
for(const marker of ["requestStartupLocation","navigator.onLine===false","launchDefaultFlight","camFpv","camSolo","autoFlightStart"])
  if(!autoStart.includes(marker))throw new Error(`automatic flight-start contract missing: ${marker}`);
if(settings.includes("MINIMAP FOLLOWS 360° CAMERA")||bootstrap.includes("WORLD_MINIMAP_FOLLOW_STORAGE"))throw new Error("obsolete camera-rotating minimap remains");
for(const forbidden of ["rotateX(","world-look-plane",'worldMinimapProjection=expanded?"topdown":"perspective"',"*(expanded?1:.60)"])
  if(bootstrap.includes(forbidden))throw new Error(`minimap perspective artifact remains: ${forbidden}`);
for(const marker of ["VIEW FOV","CAMERA_SETTINGS_EVENT","setCameraFovDeg"])
  if(!cameraSettings.includes(marker))throw new Error(`shared camera FOV contract missing: ${marker}`);
for(const marker of ["THREE.Raycaster","SHOT_INTERVAL_MS","BLOCKED_SELECTOR","DECAL_POOL_SIZE=32","fireDecalPoolSize","touch-action:none","setPointerCapture","flightFireDecal","clientX:event.clientX","fireAimX"])
  if(!fireFx.includes(marker))throw new Error(`presentation fire FX missing: ${marker}`);
for(const forbidden of ["applyForces(","b3Body_ApplyForce","motorOmega","StateController","fc::Runtime","flightFireReticle","fire-knob"])
  if(fireFx.includes(forbidden))throw new Error(`fire FX contains forbidden authority/aim UI: ${forbidden}`);
for(const marker of ["FLIGHT_LOGBOOK_KEY","EXPORT JSON","maxForwardMps","maxRightMps"])
  if(!logbook.includes(marker))throw new Error(`flight logbook contract missing: ${marker}`);
for(const marker of ["-webkit-user-select:none","-webkit-touch-callout:none","selectstart","contextmenu"])
  if(!simulator.includes(marker))throw new Error(`mobile flight-surface suppression missing: ${marker}`);
for(const marker of ["#086a9d","#ffd34f","#dbe4e9","AERIAL","ROADS","3D BUILDINGS","Imagery © Esri"])
  if(!bootstrap.includes(marker))throw new Error(`WORLD semantic palette/legend marker missing: ${marker}`);

const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader"]});
const page=await browser.newPage();
const failed=[];
const consoleErrors=[];
page.on("requestfailed",request=>failed.push(`${request.failure()?.errorText||"FAILED"} ${request.url()}`));
page.on("pageerror",error=>consoleErrors.push(`PAGEERROR ${error.message}`));
page.on("console",message=>{if(message.type()==="error"||message.type()==="warning")consoleErrors.push(`${message.type().toUpperCase()} ${message.text()}`);});
await installDeterministicWorldFixture(page,{base,styleName:"Arondight45 deterministic WORLD UI fixture",latitude:39.5696,longitude:2.6502});

async function worldDiagnostics(){
  return page.evaluate(()=>{const v=document.querySelector("#viewport"),b=globalThis.__arondightRealWorld;return{
    status:document.querySelector("#status")?.textContent||"",realWorldStatus:document.querySelector("#realWorldStatus")?.textContent||"",bodyClass:document.body.className,
    autoWorldLocationSource:v?.dataset.autoWorldLocationSource||"",worldMode:v?.dataset.worldMode||"",provider:v?.dataset.worldProvider||"",terrain:v?.dataset.worldTerrainStatus||"",terrainTriangles:v?.dataset.worldTerrainTriangles||"",
    imageryLayer:v?.dataset.worldImageryLayer||"",imageryEnabled:v?.dataset.worldImageryEnabled||"",minimapTiles:v?.dataset.worldMinimapImageryTiles||"",active:Boolean(b?.active),loading:Boolean(b?.loading),map:Boolean(b?.map),renderer:Boolean(b?.threeRenderer),
    worldFrames:v?.dataset.worldThreeFrames||"",presentationDraws:v?.dataset.presentationDraws||"",presentationBacklogMs:v?.dataset.presentationBacklogMs||"",mapStyle:b?.map?.getStyle?.()?.name||""
  };});
}

try{
  await page.setViewport({width:844,height:390,deviceScaleFactor:1});
  await page.goto(`${base}/drone_simulator.html`,{waitUntil:"load",timeout:30000});
  await page.waitForFunction(()=>document.querySelector("#status")?.textContent.includes("SIM ready"),{timeout:30000});
  await page.waitForFunction(()=>document.body.classList.contains("solo-flight"),{timeout:10000});
  try{
    await page.waitForFunction(()=>{const v=document.querySelector("#viewport"),b=globalThis.__arondightRealWorld;return v?.dataset.autoWorldLocationSource==="startup-gps"&&v?.dataset.worldMode==="real"&&v?.dataset.worldProvider==="openfreemap-esri-mapterhorn-dem"&&v?.dataset.worldTerrainStatus==="box3d-active"&&v?.dataset.worldImageryLayer==="ready"&&b?.active===true&&b?.loading===false&&b?.map&&b?.threeRenderer&&Number(v?.dataset.worldThreeFrames||0)>=1&&Number(v?.dataset.presentationDraws||0)>=10;},{timeout:45000});
  }catch(error){throw new Error(`WORLD UI completed-startup timeout: ${JSON.stringify({diagnostics:await worldDiagnostics(),failed:failed.slice(-20),consoleErrors:consoleErrors.slice(-20)})}`,{cause:error});}

  const startup=await page.evaluate(()=>({camera:document.querySelector("#viewport")?.dataset.cameraMode,auto:document.querySelector("#viewport")?.dataset.autoFlightStart,button:document.querySelector("#soloCamera")?.textContent?.trim(),panel:getComputedStyle(document.querySelector(".panel")).display}));
  if(startup.camera!=="fpv"||startup.auto!=="fpv"||startup.button!=="FPV"||startup.panel!=="none")throw new Error(`automatic FPV/Solo startup failed: ${JSON.stringify(startup)}`);

  const mobileUx=await page.evaluate(()=>{const viewport=document.querySelector("#viewport"),s=getComputedStyle(viewport);return{select:s.userSelect,webkitSelect:s.webkitUserSelect,touchAction:s.touchAction,logbook:!!document.querySelector("#soloLogbook"),aimUi:!!document.querySelector("#flightFireStick,#flightFireReticle"),decalPool:Number(viewport?.dataset.fireDecalPoolSize||0)};});
  if(mobileUx.select!=="none"&&mobileUx.webkitSelect!=="none")throw new Error(`flight viewport remains selectable: ${JSON.stringify(mobileUx)}`);
  if(mobileUx.touchAction!=="none")throw new Error(`flight viewport can still hand drag-fire to browser gestures: ${JSON.stringify(mobileUx)}`);
  if(!mobileUx.logbook||mobileUx.aimUi||mobileUx.decalPool!==32)throw new Error(`solo logbook/direct-fire/decal-pool UI contract failed: ${JSON.stringify(mobileUx)}`);

  await page.click("#soloTopbar .phone-settings-button");
  await page.waitForFunction(()=>document.querySelector(".phone-settings-dialog")?.open,{timeout:10000});
  const config=await page.evaluate(()=>({section:!!document.querySelector('[data-world-settings="openfreemap-osm-3d"]'),imagery:document.querySelector('[data-world-imagery]')?.checked,grid:document.querySelector('[data-world-grid]')?.checked,keep:document.querySelector('[data-world-keep-look]')?.checked,axis:document.querySelector('[data-world-minimap-axis-lock]')?.checked,fov:[...document.querySelectorAll('.camera-settings-section label')].some(x=>x.textContent.includes('VIEW FOV')),speed:Number(document.querySelector('[data-slider="speed"]')?.value),speedText:document.querySelector('[data-out="speed"]')?.value||""}));
  if(!config.section||config.imagery!==true||config.grid!==true||config.keep!==false||config.axis!==true||!config.fov||config.speed!==36||!config.speedText.includes("36 km/h"))throw new Error(`WORLD/settings contract failed: ${JSON.stringify(config)}`);

  await page.$eval('[data-slider="speed"]',el=>{el.value="42";el.dispatchEvent(new Event("input",{bubbles:true}));});
  const speedPersist=await page.evaluate(()=>JSON.parse(localStorage.getItem("arondight45PhoneControlSettingsV5")||"{}").maxHorizontalSpeedKmh);
  if(speedPersist!==42)throw new Error(`horizontal speed did not persist to Local Storage: ${speedPersist}`);
  await page.$eval('[data-slider="speed"]',el=>{el.value="36";el.dispatchEvent(new Event("input",{bubbles:true}));});

  await page.click('[data-world-grid]');
  await page.waitForFunction(()=>localStorage.getItem("arondight45WorldGridV1")==="0",{timeout:5000});
  if(await page.evaluate(()=>localStorage.getItem("arondight45WorldGridV1"))!=="0")throw new Error("WORLD GRID off did not persist");
  await page.click('[data-world-grid]');
  await page.waitForFunction(()=>localStorage.getItem("arondight45WorldGridV1")==="1",{timeout:5000});

  await page.click('[data-world-minimap-axis-lock]');
  await page.waitForFunction(()=>localStorage.getItem("arondight45WorldMinimapAxisLockV1")==="0",{timeout:5000});
  const unlocked=await page.evaluate(()=>{const b=globalThis.__arondightRealWorld,v=document.querySelector("#viewport");b.lookYawDeg=37;b.lookPitchDeg=18;b.minimapLastDrawMs=-Infinity;b.renderLookHud();b.drawMinimap(performance.now());return{bearing:Number(v.dataset.worldMinimapBearing),mode:v.dataset.worldMinimapMode,projection:v.dataset.worldMinimapProjection,applied:v.dataset.worldMinimapAxisLockApplied};});
  if(Math.abs(unlocked.bearing-37)>.1||unlocked.mode!=="look"||unlocked.projection!=="topdown"||unlocked.applied!=="0")throw new Error(`minimap axis unlock failed: ${JSON.stringify(unlocked)}`);
  await page.click('[data-world-minimap-axis-lock]');
  await page.waitForFunction(()=>localStorage.getItem("arondight45WorldMinimapAxisLockV1")==="1",{timeout:5000});
  const relocked=await page.evaluate(()=>{const b=globalThis.__arondightRealWorld,v=document.querySelector("#viewport");b.minimapLastDrawMs=-Infinity;b.drawMinimap(performance.now());return{bearing:Number(v.dataset.worldMinimapBearing),mode:v.dataset.worldMinimapMode,projection:v.dataset.worldMinimapProjection,applied:v.dataset.worldMinimapAxisLockApplied};});
  if(Math.abs(relocked.bearing)>.1||relocked.mode!=="north"||relocked.projection!=="topdown"||relocked.applied!=="1")throw new Error(`minimap axis relock failed: ${JSON.stringify(relocked)}`);

  await page.click('[data-world-imagery]');
  await page.waitForFunction(()=>localStorage.getItem("arondight45WorldImageryV1")==="0",{timeout:5000});
  const imageryOff=await page.evaluate(()=>{const b=globalThis.__arondightRealWorld,v=document.querySelector("#viewport");b.minimapLastDrawMs=-Infinity;b.drawMinimap(performance.now());return{enabled:v.dataset.worldImageryEnabled,visible:b.map.getLayoutProperty("arondight45-world-imagery-raster","visibility"),mini:Number(v.dataset.worldMinimapImageryTiles||0)};});
  if(imageryOff.enabled!=="0"||imageryOff.visible!=="none"||imageryOff.mini!==0)throw new Error(`imagery OFF did not apply to map + minimap: ${JSON.stringify(imageryOff)}`);
  await page.click('[data-world-imagery]');
  await page.waitForFunction(()=>localStorage.getItem("arondight45WorldImageryV1")==="1",{timeout:5000});
  await page.click('.phone-settings-dialog [data-close]');
  await page.waitForFunction(()=>Number(document.querySelector("#viewport")?.dataset.worldMinimapImageryTiles||0)>0,{timeout:15000});

  const live=await page.evaluate(()=>{const v=document.querySelector("#viewport"),b=globalThis.__arondightRealWorld;return{button:document.querySelector("#soloWorld")?.textContent||"",mode:v?.dataset.worldMode,provider:v?.dataset.worldProvider,terrain:v?.dataset.worldTerrainStatus,terrainTriangles:Number(v?.dataset.worldTerrainTriangles||0),map:Boolean(b?.map),renderer:Boolean(b?.threeRenderer),imagery:v?.dataset.worldImageryEnabled,imageryLayer:v?.dataset.worldImageryLayer,imageryVisible:b?.map?.getLayoutProperty("arondight45-world-imagery-raster","visibility"),miniTiles:Number(v?.dataset.worldMinimapImageryTiles||0),minimap:v?.dataset.worldMinimapMode,bearing:Number(v?.dataset.worldMinimapBearing||99),projection:v?.dataset.worldMinimapProjection,pitch:Number(v?.dataset.worldMinimapPitch),roll:Number(v?.dataset.worldMinimapRoll),heightMode:v?.dataset.worldMinimapHeightMode,legend:getComputedStyle(document.querySelector("#worldMapLegend")).display,palette:Number(v?.dataset.worldPaletteLayers||0),canvasCount:document.querySelectorAll("#viewport canvas").length};});
  if(live.button!=="WORLD ✓"||live.mode!=="real"||live.provider!=="openfreemap-esri-mapterhorn-dem"||live.terrain!=="box3d-active"||live.terrainTriangles<1||!live.map||!live.renderer||live.imagery!=="1"||live.imageryLayer!=="ready"||live.imageryVisible!=="visible"||live.miniTiles<1||live.minimap!=="north"||Math.abs(live.bearing)>.1||live.projection!=="topdown"||live.pitch!==0||live.roll!==0||live.heightMode!=="flat-footprints"||live.legend==="none"||live.palette<1||live.canvasCount!==3)throw new Error(`WORLD live contract failed: ${JSON.stringify(live)}`);

  for(const expected of ["fpv","follow","third"]){
    await page.waitForFunction(mode=>document.querySelector("#viewport")?.dataset.cameraMode===mode,{timeout:5000},expected);
    await page.click("#soloCamera");
  }
  await page.waitForFunction(()=>document.querySelector("#viewport")?.dataset.cameraMode==="fpv",{timeout:5000});

  const fire=await page.evaluate(async()=>{const v=document.querySelector("#viewport"),r=v.getBoundingClientRect(),x=r.left+r.width*.55,y=r.top+r.height*.55,before=Number(v.dataset.fireShots||0),send=type=>v.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:81,pointerType:"touch",clientX:x,clientY:y,button:0}));send("pointerdown");await new Promise(resolve=>setTimeout(resolve,260));send("pointerup");return{before,after:Number(v.dataset.fireShots||0),pool:Number(v.dataset.fireDecalPoolSize||0),aimUi:Boolean(document.querySelector("#flightFireStick,#flightFireReticle"))};});
  if(fire.after<=fire.before||fire.pool!==32||fire.aimUi)throw new Error(`direct touch fire UI contract failed: ${JSON.stringify(fire)}`);

  const log=await page.evaluate(()=>{const l=globalThis.__arondightFlightLogbook;l.clear();l.observe({simTime:1,armed:true,x:0,y:0,z:2,vx:0,vy:0,vz:0,yawDeg:0,speed:0,agl:2,aglValid:true,batteryV:16.7,worldMode:"real"});l.observe({simTime:3,armed:true,x:2,y:0,z:2,vx:-1,vy:0,vz:0,yawDeg:0,speed:1,agl:2,aglValid:true,batteryV:16.4,worldMode:"real"});l.observe({simTime:4,armed:false,disarmReason:"TEST_END",x:2,y:0,z:2,vx:0,vy:0,vz:0,yawDeg:0,speed:0,agl:2,aglValid:true,batteryV:16.3,worldMode:"real"});const snap=l.snapshot();return{count:snap.entries.length,entry:snap.entries[0],stored:JSON.parse(localStorage.getItem("arondight45FlightLogbookV1")||"[]").length};});
  if(log.count!==1||log.stored!==1||log.entry.endReason!=="TEST_END"||log.entry.distanceM<1.9||log.entry.maxForwardMps<.9)throw new Error(`flight logbook session failed: ${JSON.stringify(log)}`);

  console.log(`REAL WORLD UI E2E passed with shared valid DEM fixture: automatic FPV/Solo, mandatory DEM/Box3D WORLD, settings persistence, strict top-down minimap, imagery toggle, camera cycle, direct touch fire and logbook.`);
}finally{await browser.close();}
