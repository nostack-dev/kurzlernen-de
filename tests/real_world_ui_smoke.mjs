import puppeteer from "puppeteer-core";
import {readFileSync} from "node:fs";

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
const OPENFREEMAP_STYLE="https://tiles.openfreemap.org/styles/liberty";
const WORLD_IMAGERY_PREFIX="https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/";
const fixtureTile=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=","base64");
const providerRequests=[];
const imageryRequests=[];
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
  if(url.startsWith(WORLD_IMAGERY_PREFIX)){imageryRequests.push(url);request.respond({status:200,contentType:"image/png",headers:{"access-control-allow-origin":"*","cache-control":"public,max-age=3600"},body:fixtureTile});return;}
  request.abort();
});

const waitWorld=()=>page.waitForFunction(()=>{const v=document.querySelector("#viewport");return v?.dataset.worldMode==="real"&&v?.dataset.worldProvider==="openfreemap-esri-imagery"&&v?.dataset.worldImageryLayer==="ready"&&Number(v?.dataset.worldMinimapImageryTiles||0)>0&&Number(v?.dataset.worldThreeFrames||0)>4;},{timeout:20000});

try{
  await page.setViewport({width:844,height:390,deviceScaleFactor:1});
  await page.goto(`${base}/drone_simulator.html`,{waitUntil:"load",timeout:30000});
  await page.waitForFunction(()=>document.querySelector("#status")?.textContent.includes("SIM ready"),{timeout:30000});
  await page.waitForFunction(()=>document.body.classList.contains("solo-flight"),{timeout:5000});
  await waitWorld();
  const startup=await page.evaluate(()=>({camera:document.querySelector("#viewport")?.dataset.cameraMode,auto:document.querySelector("#viewport")?.dataset.autoFlightStart,button:document.querySelector("#soloCamera")?.textContent?.trim(),panel:getComputedStyle(document.querySelector(".panel")).display}));
  if(startup.camera!=="fpv"||startup.auto!=="fpv"||startup.button!=="FPV"||startup.panel!=="none")throw new Error(`automatic FPV/Solo startup failed: ${JSON.stringify(startup)}`);
  const externalAfterAutoWorld=external.length;

  const mobileUx=await page.evaluate(()=>{const viewport=document.querySelector("#viewport"),s=getComputedStyle(viewport);return{select:s.userSelect,webkitSelect:s.webkitUserSelect,callout:s.webkitTouchCallout||"none",touchAction:s.touchAction,logbook:!!document.querySelector("#soloLogbook"),aimUi:!!document.querySelector("#flightFireStick,#flightFireReticle"),decalPool:Number(viewport?.dataset.fireDecalPoolSize||0)};});
  if(mobileUx.select!=="none"&&mobileUx.webkitSelect!=="none")throw new Error(`flight viewport remains selectable: ${JSON.stringify(mobileUx)}`);
  if(mobileUx.touchAction!=="none")throw new Error(`flight viewport can still hand drag-fire to browser gestures: ${JSON.stringify(mobileUx)}`);
  if(!mobileUx.logbook||mobileUx.aimUi||mobileUx.decalPool!==32)throw new Error(`solo logbook/direct-fire/decal-pool UI contract failed: ${JSON.stringify(mobileUx)}`);

  await page.click("#soloTopbar .phone-settings-button");await page.waitForFunction(()=>document.querySelector(".phone-settings-dialog")?.open,{timeout:5000});
  const config=await page.evaluate(()=>({section:!!document.querySelector('[data-world-settings="openfreemap-osm-3d"]'),imagery:document.querySelector('[data-world-imagery]')?.checked,grid:document.querySelector('[data-world-grid]')?.checked,keep:document.querySelector('[data-world-keep-look]')?.checked,axis:document.querySelector('.phone-settings-dialog input[data-world-minimap-axis-lock]')?.checked,axisDisabled:document.querySelector('.phone-settings-dialog input[data-world-minimap-axis-lock]')?.disabled,obsolete:!!document.querySelector('[data-world-minimap-follow]'),fovLabel:[...document.querySelectorAll('.camera-settings-section label')].some(x=>x.textContent.includes('VIEW FOV')),speed:Number(document.querySelector('[data-slider="speed"]')?.value),speedText:document.querySelector('[data-out="speed"]')?.value||"",note:document.querySelector('[data-world-settings="openfreemap-osm-3d"]')?.textContent||""}));
  if(!config.section||config.imagery!==true||config.grid!==true||config.keep!==false||config.axis!==true||config.axisDisabled!==Boolean(await page.evaluate(()=>document.fullscreenElement))||config.obsolete||!config.fovLabel||config.speed!==36||!config.speedText.includes("36 km/h")||!config.note.includes("No account, API key, billing setup, backend or proxy")||!config.note.includes("ON by default"))throw new Error(`WORLD/settings contract failed: ${JSON.stringify(config)}`);
  const unexpectedSettingsNetwork=external.slice(externalAfterAutoWorld).filter(url=>!url.startsWith(WORLD_IMAGERY_PREFIX));if(unexpectedSettingsNetwork.length)throw new Error(`settings path triggered unexpected external network: ${JSON.stringify(unexpectedSettingsNetwork)}`);
  const speedPersist=await page.evaluate(()=>{const slider=document.querySelector('[data-slider="speed"]');slider.value="42";slider.dispatchEvent(new Event("input",{bubbles:true}));return JSON.parse(localStorage.getItem("arondight45PhoneControlSettingsV5")||"{}").maxHorizontalSpeedKmh;});
  if(speedPersist!==42)throw new Error(`horizontal speed did not persist to Local Storage: ${speedPersist}`);
  await page.evaluate(()=>{const slider=document.querySelector('[data-slider="speed"]');slider.value="36";slider.dispatchEvent(new Event("input",{bubbles:true}));});
  await page.click('.phone-settings-dialog [data-close]');

  await page.click("#soloTopbar .phone-settings-button");await page.waitForFunction(()=>document.querySelector(".phone-settings-dialog")?.open,{timeout:5000});
  await page.click('.phone-settings-dialog [data-world-grid]');await page.click('.phone-settings-dialog [data-close]');await page.waitForFunction(()=>localStorage.getItem("arondight45WorldGridV1")==="0",{timeout:3000});
  const gridOff=await page.evaluate(()=>localStorage.getItem("arondight45WorldGridV1"));if(gridOff!=="0")throw new Error(`WORLD GRID off did not persist: ${gridOff}`);
  await page.click("#soloTopbar .phone-settings-button");await page.waitForFunction(()=>document.querySelector(".phone-settings-dialog")?.open,{timeout:5000});
  await page.click('.phone-settings-dialog [data-world-grid]');await page.click('.phone-settings-dialog [data-close]');await page.waitForFunction(()=>localStorage.getItem("arondight45WorldGridV1")==="1",{timeout:3000});
  const gridOn=await page.evaluate(()=>localStorage.getItem("arondight45WorldGridV1"));if(gridOn!=="1")throw new Error(`WORLD GRID on did not persist: ${gridOn}`);

  const live=await page.evaluate(()=>{const v=document.querySelector("#viewport"),b=globalThis.__arondightRealWorld;return{button:document.querySelector("#soloWorld")?.textContent||"",mode:v?.dataset.worldMode,provider:v?.dataset.worldProvider,map:Boolean(b?.map),renderer:Boolean(b?.threeRenderer),imagery:v?.dataset.worldImageryEnabled,imageryLayer:v?.dataset.worldImageryLayer,imagerySource:Boolean(b?.map?.getSource("arondight45-world-imagery")),imageryVisible:b?.map?.getLayoutProperty("arondight45-world-imagery-raster","visibility"),miniTiles:Number(v?.dataset.worldMinimapImageryTiles||0),minimap:v?.dataset.worldMinimapMode,miniBearing:v?.dataset.worldMinimapBearing,projection:v?.dataset.worldMinimapProjection,pitch:Number(v?.dataset.worldMinimapPitch),roll:Number(v?.dataset.worldMinimapRoll),heightMode:v?.dataset.worldMinimapHeightMode,axis:v?.dataset.worldMinimapAxisLock,axisApplied:v?.dataset.worldMinimapAxisLockApplied,fullscreen:Boolean(document.fullscreenElement),legend:getComputedStyle(document.querySelector("#worldMapLegend")).display,palette:Number(v?.dataset.worldPaletteLayers||0),canvasCount:document.querySelectorAll("#viewport canvas").length};});
  if(live.button!=="WORLD ✓"||live.mode!=="real"||live.provider!=="openfreemap-esri-imagery"||!live.map||!live.renderer||live.imagery!=="1"||live.imageryLayer!=="ready"||!live.imagerySource||live.imageryVisible!=="visible"||live.miniTiles<1||live.minimap!=="north"||Number(live.miniBearing)!==0||live.projection!=="topdown"||live.pitch!==0||live.roll!==0||live.heightMode!=="flat-footprints"||live.axis!=="1"||live.axisApplied!==(live.fullscreen?"0":"1")||live.legend==="none"||live.palette<1||live.canvasCount!==3)throw new Error(`WORLD live contract failed: ${JSON.stringify(live)}`);
  if(providerRequests.length!==1)throw new Error(`expected one OpenFreeMap style request, got ${providerRequests.length}`);
  if(imageryRequests.length<1)throw new Error("real imagery source was never requested");

  await page.click("#soloTopbar .phone-settings-button");await page.waitForFunction(()=>document.querySelector(".phone-settings-dialog")?.open,{timeout:5000});await page.click('.phone-settings-dialog [data-world-imagery]');await page.click('.phone-settings-dialog [data-close]');
  const imageryOff=await page.evaluate(()=>{const b=globalThis.__arondightRealWorld,v=document.querySelector("#viewport");b.minimapLastDrawMs=-Infinity;b.drawMinimap(performance.now());return{stored:localStorage.getItem("arondight45WorldImageryV1"),enabled:v.dataset.worldImageryEnabled,visible:b.map.getLayoutProperty("arondight45-world-imagery-raster","visibility"),miniTiles:Number(v.dataset.worldMinimapImageryTiles||0)};});
  if(imageryOff.stored!=="0"||imageryOff.enabled!=="0"||imageryOff.visible!=="none"||imageryOff.miniTiles!==0)throw new Error(`imagery OFF did not apply to map + minimap: ${JSON.stringify(imageryOff)}`);
  await page.click("#soloTopbar .phone-settings-button");await page.waitForFunction(()=>document.querySelector(".phone-settings-dialog")?.open,{timeout:5000});await page.click('.phone-settings-dialog [data-world-imagery]');await page.click('.phone-settings-dialog [data-close]');
  const imageryOn=await page.evaluate(()=>{const b=globalThis.__arondightRealWorld,v=document.querySelector("#viewport");b.minimapLastDrawMs=-Infinity;b.drawMinimap(performance.now());return{stored:localStorage.getItem("arondight45WorldImageryV1"),enabled:v.dataset.worldImageryEnabled,visible:b.map.getLayoutProperty("arondight45-world-imagery-raster","visibility"),miniTiles:Number(v.dataset.worldMinimapImageryTiles||0)};});
  if(imageryOn.stored!=="1"||imageryOn.enabled!=="1"||imageryOn.visible!=="visible"||imageryOn.miniTiles<1)throw new Error(`imagery ON did not restore map + minimap: ${JSON.stringify(imageryOn)}`);

  const eyeHeights=await page.evaluate(()=>{
    const b=globalThis.__arondightRealWorld,c=b.threeCamera,v=document.querySelector("#viewport"),saved={p:c.position.clone(),q:c.quaternion.clone(),u:c.up.clone(),mode:v.dataset.cameraMode};
    const run=z=>{v.dataset.cameraMode="fpv";c.position.set(12,-7,z);c.quaternion.set(0,0,0,1);c.up.set(0,1,0);b.lastMapSyncMs=-Infinity;b.syncMapCamera(c);return{eye:Number(v.dataset.worldMapEyeElevation),target:Number(v.dataset.worldMapTargetElevation),sync:v.dataset.worldMapSyncMode};};
    const low=run(5),high=run(50);c.position.copy(saved.p);c.quaternion.copy(saved.q);c.up.copy(saved.u);v.dataset.cameraMode=saved.mode;b.lastMapSyncMs=-Infinity;return{low,high};
  });
  if(Math.abs(eyeHeights.low.eye-5)>.01||Math.abs(eyeHeights.high.eye-50)>.01||eyeHeights.low.sync!=="rigid-eye-target"||eyeHeights.high.sync!=="rigid-eye-target"||eyeHeights.high.eye-eyeHeights.low.eye<44.9)throw new Error(`FPV eye altitude not preserved: ${JSON.stringify(eyeHeights)}`);

  const verticalWorldRange=await page.evaluate(()=>{
    const b=globalThis.__arondightRealWorld,c=b.threeCamera,v=document.querySelector("#viewport"),saved={p:c.position.clone(),q:c.quaternion.clone(),u:c.up.clone(),mode:v.dataset.cameraMode,worldMode:v.dataset.worldCameraMode,lastSerial:b.lastMapSyncFrameSerial};
    const run=pitch=>{const target=c.position.clone(),cp=Math.cos(pitch);target.y+=cp;target.z+=Math.sin(pitch);c.up.set(0,0,1);c.lookAt(target);v.dataset.cameraMode="follow";v.dataset.worldCameraMode="follow";b.lastMapSyncMs=-Infinity;b.lastMapSyncFrameSerial=-1;b.syncMapCamera(c);return{reported:Number(v.dataset.worldMapPitch),actual:Number(b.map.getPitch()),contract:v.dataset.worldMapPitchContract,max:Number(v.dataset.worldMapMaxPitchDeg)};};
    c.position.set(12,-7,1.68);const up=run(89.3*Math.PI/180),down=run(-89.3*Math.PI/180);c.position.copy(saved.p);c.quaternion.copy(saved.q);c.up.copy(saved.u);v.dataset.cameraMode=saved.mode;if(saved.worldMode===undefined)delete v.dataset.worldCameraMode;else v.dataset.worldCameraMode=saved.worldMode;b.lastMapSyncMs=-Infinity;b.lastMapSyncFrameSerial=saved.lastSerial;return{up,down};
  });
  if(verticalWorldRange.up.actual<178||verticalWorldRange.up.reported<178||verticalWorldRange.down.actual>2||verticalWorldRange.down.reported>2||verticalWorldRange.up.contract!=="fps-display-near-vertical-v1"||verticalWorldRange.down.contract!=="fps-display-near-vertical-v1"||verticalWorldRange.up.max<179.5||verticalWorldRange.up.max>=180)throw new Error(`WORLD background clipped first-person vertical range: ${JSON.stringify(verticalWorldRange)}`);

  const cameraCadence=await page.evaluate(()=>{
    const b=globalThis.__arondightRealWorld,c=b.threeCamera,v=document.querySelector("#viewport"),saved={p:c.position.clone(),q:c.quaternion.clone(),u:c.up.clone(),mode:v.dataset.cameraMode,worldMode:v.dataset.worldCameraMode,lastSerial:b.lastMapSyncFrameSerial};
    c.position.set(12,-7,18);c.quaternion.set(0,0,0,1);c.up.set(0,1,0);const modes={};let serial=400;
    for(const mode of ["fpv","follow","third"]){v.dataset.cameraMode=mode;v.dataset.worldCameraMode=mode;b.lastMapSyncMs=-Infinity;b.lastMapSyncFrameSerial=-1;const before=b.mapUpdates;b.syncMapCamera(c,serial);const first=b.mapUpdates;for(let i=0;i<20;i++)b.syncMapCamera(c,serial);const duplicate=b.mapUpdates;b.syncMapCamera(c,++serial);const next=b.mapUpdates;modes[mode]={before,first,duplicate,next,sync:v.dataset.worldMapSyncMode};serial+=100;}
    c.position.copy(saved.p);c.quaternion.copy(saved.q);c.up.copy(saved.u);v.dataset.cameraMode=saved.mode;if(saved.worldMode===undefined)delete v.dataset.worldCameraMode;else v.dataset.worldCameraMode=saved.worldMode;b.lastMapSyncMs=-Infinity;b.lastMapSyncFrameSerial=saved.lastSerial;return{modes,fpsCap:v.dataset.worldMapFpsCap};
  });
  for(const [mode,cadence] of Object.entries(cameraCadence.modes)){const expected=mode==="fpv"?"rigid-eye-target":"stabilized-eye-target";if(cadence.first!==cadence.before+1||cadence.duplicate!==cadence.first||cadence.next!==cadence.first+1||cadence.sync!==expected)throw new Error(`${mode} MapLibre presentation-frame cadence regression: ${JSON.stringify(cameraCadence)}`);}if(cameraCadence.fpsCap!=="presentation")throw new Error(`WORLD map is not locked to the presentation clock: ${JSON.stringify(cameraCadence)}`);

  for(const expected of ["fpv","follow","third"]){
    await page.waitForFunction(mode=>document.querySelector("#viewport")?.dataset.cameraMode===mode,{timeout:3000},expected);
    const look=await page.evaluate(()=>{const hud=document.querySelector("#worldLookHud"),v=document.querySelector("#viewport"),r=hud.getBoundingClientRect(),sx=r.left+r.width*.45,sy=r.top+r.height*.58,send=(type,x,y)=>hud.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:31,pointerType:"touch",clientX:x,clientY:y,button:0})),before=Number(v?.dataset.worldLookYaw||0);send("pointerdown",sx,sy);send("pointermove",r.left+r.width*.72,r.top+r.height*.46);send("pointerup",r.left+r.width*.72,r.top+r.height*.46);return{before,after:Number(v?.dataset.worldLookYaw||0)};});
    if(Math.abs(look.after-look.before)<=5)throw new Error(`${expected} minimap look gesture did not move camera orientation: ${JSON.stringify(look)}`);
    const mode=await page.evaluate(()=>{const v=document.querySelector("#viewport");return{camera:v?.dataset.cameraMode,mini:v?.dataset.worldMinimapMode,bearing:Number(v?.dataset.worldMinimapBearing||99),projection:v?.dataset.worldMinimapProjection,pitch:Number(v?.dataset.worldMinimapPitch),roll:Number(v?.dataset.worldMinimapRoll),heightMode:v?.dataset.worldMinimapHeightMode};});
    if(mode.camera!==expected||mode.mini!=="north"||Math.abs(mode.bearing)>.01||mode.projection!=="topdown"||mode.pitch!==0||mode.roll!==0||mode.heightMode!=="flat-footprints")throw new Error(`${expected} changed strict top-down minimap contract: ${JSON.stringify(mode)}`);
    await page.evaluate(()=>globalThis.__arondightRealWorld.resetLook(true));
    await page.click("#soloCamera");
  }

  if(!await page.evaluate(()=>Boolean(document.fullscreenElement))){
    await page.click("#soloTopbar .phone-settings-button");await page.waitForFunction(()=>document.querySelector(".phone-settings-dialog")?.open,{timeout:5000});
    await page.click('.phone-settings-dialog [data-world-minimap-axis-lock]');await page.click('.phone-settings-dialog [data-close]');
    const unlocked=await page.evaluate(()=>{const b=globalThis.__arondightRealWorld,v=document.querySelector("#viewport");b.lookYawDeg=37;b.lookPitchDeg=22;b.minimapLastDrawMs=-Infinity;b.renderLookHud();b.drawMinimap(performance.now());return{stored:localStorage.getItem("arondight45WorldMinimapAxisLockV1"),bearing:Number(v.dataset.worldMinimapBearing),mode:v.dataset.worldMinimapMode,projection:v.dataset.worldMinimapProjection,pitch:Number(v.dataset.worldMinimapPitch),roll:Number(v.dataset.worldMinimapRoll),heightMode:v.dataset.worldMinimapHeightMode,applied:v.dataset.worldMinimapAxisLockApplied};});
    if(unlocked.stored!=="0"||Math.abs(unlocked.bearing-37)>.01||unlocked.mode!=="look"||unlocked.projection!=="topdown"||unlocked.pitch!==0||unlocked.roll!==0||unlocked.heightMode!=="flat-footprints"||unlocked.applied!=="0")throw new Error(`non-fullscreen minimap axis unlock failed without preserving top-down projection: ${JSON.stringify(unlocked)}`);
    await page.click("#soloTopbar .phone-settings-button");await page.waitForFunction(()=>document.querySelector(".phone-settings-dialog")?.open,{timeout:5000});
    await page.click('.phone-settings-dialog [data-world-minimap-axis-lock]');await page.click('.phone-settings-dialog [data-close]');
    const relocked=await page.evaluate(()=>{const b=globalThis.__arondightRealWorld,v=document.querySelector("#viewport");b.minimapLastDrawMs=-Infinity;b.drawMinimap(performance.now());return{stored:localStorage.getItem("arondight45WorldMinimapAxisLockV1"),bearing:Number(v.dataset.worldMinimapBearing),mode:v.dataset.worldMinimapMode,projection:v.dataset.worldMinimapProjection,applied:v.dataset.worldMinimapAxisLockApplied};});
    if(relocked.stored!=="1"||Math.abs(relocked.bearing)>.01||relocked.mode!=="north"||relocked.projection!=="topdown"||relocked.applied!=="1")throw new Error(`default minimap vertical-axis lock did not restore fixed horizontal: ${JSON.stringify(relocked)}`);
    await page.evaluate(()=>globalThis.__arondightRealWorld.resetLook(true));
  }

  const fov=await page.evaluate(()=>{
    const hud=document.querySelector("#worldLookHud"),r=hud.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2,send=(type,id,x,y)=>hud.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:id,pointerType:"touch",clientX:x,clientY:y,button:0}));
    const before=JSON.parse(localStorage.getItem("arondight45CameraSettingsV1")||"{}").fpvFovDeg||105;send("pointerdown",41,cx-18,cy);send("pointerdown",42,cx+18,cy);send("pointermove",42,cx+44,cy);send("pointerup",42,cx+44,cy);send("pointerup",41,cx-18,cy);const after=JSON.parse(localStorage.getItem("arondight45CameraSettingsV1")||"{}").fpvFovDeg;return{before,after};
  });
  if(!(Number.isFinite(fov.after)&&Math.abs(fov.after-fov.before)>2))throw new Error(`minimap pinch did not update shared FOV: ${JSON.stringify(fov)}`);
  await page.click("#soloTopbar .phone-settings-button");await page.waitForFunction(()=>document.querySelector(".phone-settings-dialog")?.open,{timeout:5000});
  const sliderFov=await page.$eval('[data-camera-slider="fov"]',el=>Number(el.value));if(Math.abs(sliderFov-fov.after)>.6)throw new Error(`Settings FOV is not synchronized with minimap pinch: ${sliderFov} vs ${fov.after}`);await page.click('.phone-settings-dialog [data-close]');

  const expandedByTouch=await page.evaluate(async()=>{const hud=document.querySelector("#worldLookHud"),r=hud.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,send=(type,id)=>hud.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:id,pointerType:"touch",clientX:x,clientY:y,button:0}));send("pointerdown",71);send("pointerup",71);await new Promise(resolve=>setTimeout(resolve,120));send("pointerdown",72);send("pointerup",72);return hud.classList.contains("expanded");});if(!expandedByTouch)throw new Error("double-tap touch sequence did not expand minimap");
  const expanded=await page.evaluate(()=>{const h=document.querySelector("#worldLookHud"),r=h.getBoundingClientRect(),v=document.querySelector("#viewport");return{w:r.width,h:r.height,mode:v.dataset.worldMinimapMode,bearing:Number(v.dataset.worldMinimapBearing||99),projection:v.dataset.worldMinimapProjection,pitch:Number(v.dataset.worldMinimapPitch),roll:Number(v.dataset.worldMinimapRoll),heightMode:v.dataset.worldMinimapHeightMode};});if(expanded.w<250||expanded.h<200||expanded.mode!=="north"||Math.abs(expanded.bearing)>.01||expanded.projection!=="topdown"||expanded.pitch!==0||expanded.roll!==0||expanded.heightMode!=="flat-footprints")throw new Error(`expanded minimap contract failed: ${JSON.stringify(expanded)}`);
  const expandedZoom=await page.evaluate(()=>{const h=document.querySelector("#worldLookHud"),r=h.getBoundingClientRect(),v=document.querySelector("#viewport"),cx=r.left+r.width/2,cy=r.top+r.height/2,send=(type,id,x,y)=>h.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:id,pointerType:"touch",clientX:x,clientY:y,button:0})),fov0=Number(v.dataset.worldMinimapFov),zoom0=Number(v.dataset.worldMinimapZoom||1);send("pointerdown",91,cx-25,cy);send("pointerdown",92,cx+25,cy);send("pointermove",92,cx+85,cy);send("pointerup",92,cx+85,cy);send("pointerup",91,cx-25,cy);globalThis.__arondightRealWorld.drawMinimap(performance.now());return{fov0,fov1:Number(v.dataset.worldMinimapFov),zoom0,zoom1:Number(v.dataset.worldMinimapZoom),projection:v.dataset.worldMinimapProjection};});if(expandedZoom.projection!=="topdown"||Math.abs(expandedZoom.fov1-expandedZoom.fov0)>.01||expandedZoom.zoom1-expandedZoom.zoom0<.5)throw new Error(`expanded minimap pinch did not zoom map independently: ${JSON.stringify(expandedZoom)}`);

  // Touch coordinate is the aim coordinate. Drag moves that coordinate 1:1 while
  // automatic fire continues until pointerup. No virtual stick or reticle exists.
  const dragFire=await page.evaluate(async()=>{const v=document.querySelector("#viewport"),r=v.getBoundingClientRect(),sx=r.left+r.width*.50,sy=r.top+r.height*.48,ex=sx+34,ey=sy+28,send=(type,x,y)=>v.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:81,pointerType:"touch",clientX:x,clientY:y,button:0})),before=Number(v.dataset.fireShots||0),writes0=Number(v.dataset.fireDecalWrites||0);send("pointerdown",sx,sy);await new Promise(resolve=>setTimeout(resolve,125));send("pointermove",ex,ey);await new Promise(resolve=>setTimeout(resolve,360));const during=Number(v.dataset.fireShots||0),writes=Number(v.dataset.fireDecalWrites||0),aimX=Number(v.dataset.fireAimX),aimY=Number(v.dataset.fireAimY),expectedX=ex-r.left,expectedY=ey-r.top,aimUi=Boolean(document.querySelector("#flightFireStick,#flightFireReticle"));send("pointerup",ex,ey);let worldDecals=0;globalThis.__arondightRealWorld?.threeScene?.traverse?.(node=>{if(node.userData?.flightFireDecal&&node.userData?.flightFireWorld)worldDecals++;});return{before,during,writes0,writes,worldDecals,aimX,aimY,expectedX,expectedY,aimUi,pool:Number(v.dataset.fireDecalPoolSize||0)};});
  if(dragFire.during-dragFire.before<4||dragFire.pool!==32||dragFire.writes<=dragFire.writes0||dragFire.worldDecals<1||dragFire.aimUi||Math.abs(dragFire.aimX-dragFire.expectedX)>1||Math.abs(dragFire.aimY-dragFire.expectedY)>1)throw new Error(`WORLD touch coordinate did not map 1:1 to sustained fire/decal aim: ${JSON.stringify(dragFire)}`);
  const shots1=dragFire.during;
  await page.evaluate(async()=>{const h=document.querySelector("#worldLookHud"),r=h.getBoundingClientRect(),x=r.left+r.width*.4,y=r.top+r.height*.5,send=type=>h.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:82,pointerType:"touch",clientX:x,clientY:y,button:0}));send("pointerdown");await new Promise(resolve=>setTimeout(resolve,220));send("pointerup");});const shots2=await page.evaluate(()=>Number(document.querySelector("#viewport")?.dataset.fireShots||0));if(shots2!==shots1)throw new Error(`minimap touch leaked into fire control: ${shots1} -> ${shots2}`);

  // Stress beyond all 32 physical mesh slots and require more than 32 actual decal
  // writes. Mesh count must stay exactly 32: this proves recycling, not merely capping.
  await page.click("#soloWorld");await page.waitForFunction(()=>document.querySelector("#viewport")?.dataset.worldMode==="training",{timeout:5000});
  const pooledDecals=await page.evaluate(async()=>{const v=document.querySelector("#viewport"),r=v.getBoundingClientRect(),sx=r.left+r.width*.50,sy=r.top+r.height*.58,ex=sx,ey=sy+34,send=(type,x,y)=>v.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:83,pointerType:"touch",clientX:x,clientY:y,button:0})),writes0=Number(v.dataset.fireDecalWrites||0);send("pointerdown",sx,sy);send("pointermove",ex,ey);await new Promise(resolve=>setTimeout(resolve,4200));send("pointerup",ex,ey);let meshes=0,visible=0;globalThis.__arondightRealWorld?.threeScene?.traverse?.(node=>{if(node.userData?.flightFireDecal){meshes++;if(node.visible)visible++;}});return{writes0,writes:Number(v.dataset.fireDecalWrites||0),meshes,visible,pool:Number(v.dataset.fireDecalPoolSize||0)};});
  if(pooledDecals.pool!==32||pooledDecals.meshes!==32||pooledDecals.visible>32||pooledDecals.writes-pooledDecals.writes0<=32)throw new Error(`THREE decal pool did not recycle beyond all 32 slots: ${JSON.stringify(pooledDecals)}`);

  const log=await page.evaluate(()=>{const l=globalThis.__arondightFlightLogbook;l.clear();l.observe({simTime:1,armed:true,x:0,y:0,z:2,vx:0,vy:0,vz:0,yawDeg:0,speed:0,agl:2,aglValid:true,batteryV:16.7,worldMode:"real"});l.observe({simTime:3,armed:true,x:2,y:0,z:2,vx:-1,vy:0,vz:0,yawDeg:0,speed:1,agl:2,aglValid:true,batteryV:16.4,worldMode:"real"});l.observe({simTime:4,armed:false,disarmReason:"TEST_END",x:2,y:0,z:2,vx:0,vy:0,vz:0,yawDeg:0,speed:0,agl:2,aglValid:true,batteryV:16.3,worldMode:"real"});const snap=l.snapshot();return{count:snap.entries.length,entry:snap.entries[0],stored:JSON.parse(localStorage.getItem("arondight45FlightLogbookV1")||"[]").length};});if(log.count!==1||log.stored!==1||log.entry.endReason!=="TEST_END"||log.entry.distanceM<1.9||log.entry.maxForwardMps<.9)throw new Error(`flight logbook session failed: ${JSON.stringify(log)}`);

  console.log(`REAL WORLD E2E passed: automatic FPV/Solo + GPS WORLD startup, real aerial/satellite imagery in flight view + strict orthographic top-down minimap, persisted imagery/axis/grid settings, exact FPV camera registration, 5-90 km/h GAME speed, 1:1 touch-coordinate firing, and one recycled 32-mesh THREE decal pool across WORLD/TRAINING.`);
}finally{await browser.close();}
