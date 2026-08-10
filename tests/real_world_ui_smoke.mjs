import puppeteer from "puppeteer-core";
import {readFileSync} from "node:fs";

const base=process.argv[2]||"http://127.0.0.1:4174";
const executablePath=process.env.CHROME_BIN;
if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");

const bootstrapSource=readFileSync("sim/real_world_bootstrap.mjs","utf8");
const simulatorSource=readFileSync("sim/simulator.mjs","utf8");
if(bootstrapSource.includes("WebGLRenderer.prototype.render"))throw new Error("REAL WORLD must not monkey-patch THREE.WebGLRenderer.prototype.render");
if(!bootstrapSource.includes("renderFrame(renderer,scene,camera)"))throw new Error("REAL WORLD explicit renderFrame bridge is missing");
if(!simulatorSource.includes("__arondightRealWorld?.renderFrame?.(renderer,scene,camera)"))throw new Error("simulator render loop does not explicitly call the REAL WORLD frame bridge");
if(!bootstrapSource.includes("WORLD_MAP_FRAME_MS=1000/30")||!bootstrapSource.includes("pixelRatio:Math.min(devicePixelRatio||1,WORLD_MAP_PIXEL_RATIO)")||!bootstrapSource.includes("setSky({\"sky-color\":\"#071b2e\""))throw new Error("WORLD mobile render/contrast budget missing");
if(!bootstrapSource.includes('fpvTargetDistanceMeters(this.originLat,height,verticalFov,WORLD_MAP_MAX_ZOOM)')||!bootstrapSource.includes('setVerticalFieldOfView(verticalFov)')||!bootstrapSource.includes('elevation:fpv?target.z:0'))throw new Error("WORLD FPV stable 3D camera model missing");
if(!simulatorSource.includes("MAX_GAME_CLEARANCE_M")||!simulatorSource.includes("NAV_AGL_RAY_MAX_M = 60")||!simulatorSource.includes("TorusGeometry(.15")||!simulatorSource.includes("worldHaloBack")||!simulatorSource.includes("worldHeadingCue"))throw new Error("WORLD range/visual acquisition cues missing");
for(const marker of ["#086a9d","#2f7044","#ffd34f","#dbe4e9","WATER","GREEN","ROADS","BUILDINGS"])
  if(!bootstrapSource.includes(marker))throw new Error(`WORLD semantic palette/legend marker missing: ${marker}`);

const browser=await puppeteer.launch({
  headless:true,
  executablePath,
  args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader"]
});
const page=await browser.newPage();
const external=[];
const providerRequests=[];
const OPENFREEMAP_STYLE="https://tiles.openfreemap.org/styles/liberty";
const fixtureStyle={
  version:8,
  name:"Arondight45 CI world fixture",
  sources:{},
  layers:[{id:"background",type:"background",paint:{"background-color":"#d8d4cc"}}]
};

await browser.defaultBrowserContext().overridePermissions(base,["geolocation"]);
await page.setGeolocation({latitude:39.569600,longitude:2.650200,accuracy:4});
await page.setRequestInterception(true);
page.on("request",request=>{
  const url=request.url();
  const parsed=new URL(url);
  if(["data:","blob:","about:"].includes(parsed.protocol)||["127.0.0.1","localhost"].includes(parsed.hostname)){
    request.continue();
    return;
  }
  external.push(url);
  if(url.startsWith(OPENFREEMAP_STYLE)){
    providerRequests.push(url);
    request.respond({
      status:200,
      contentType:"application/json",
      headers:{"access-control-allow-origin":"*","cache-control":"no-store"},
      body:JSON.stringify(fixtureStyle)
    });
    return;
  }
  request.abort();
});

const cameraSnapshot=()=>page.evaluate(()=>{
  const viewport=document.querySelector("#viewport");
  return{
    mode:viewport?.dataset.cameraMode||"",
    worldCameraMode:viewport?.dataset.worldCameraMode||"",
    center:viewport?.dataset.worldMapCenter||"",
    zoom:viewport?.dataset.worldMapZoom||"",
    pitch:viewport?.dataset.worldMapPitch||"",
    bearing:viewport?.dataset.worldMapBearing||"",
    targetElevation:viewport?.dataset.worldMapTargetElevation||"",
    syncMode:viewport?.dataset.worldMapSyncMode||""
  };
});

try{
  await page.setViewport({width:844,height:390,deviceScaleFactor:1});
  await page.goto(`${base}/drone_simulator.html`,{waitUntil:"load",timeout:30000});
  await page.waitForFunction(()=>document.querySelector("#status")?.textContent.includes("SIM ready"),{timeout:30000});
  await page.click("#camSolo");
  await page.waitForFunction(()=>document.body.classList.contains("solo-flight"),{timeout:5000});

  const entry=await page.evaluate(()=>{
    const button=document.querySelector("#soloWorld"),settings=document.querySelector("#soloTopbar .phone-settings-button"),viewport=document.querySelector("#viewport"),bridge=globalThis.__arondightRealWorld;
    return{world:!!button,worldText:button?.textContent||"",worldVisible:!!button&&getComputedStyle(button).display!=="none",settings:!!settings,worldMode:viewport?.dataset.worldMode||"",provider:viewport?.dataset.worldProvider||"",mapCreated:Boolean(bridge?.map)};
  });
  if(!entry.world||!entry.worldVisible||entry.worldText!=="WORLD"||!entry.settings)throw new Error(`REAL WORLD solo entry missing: ${JSON.stringify(entry)}`);
  if(entry.worldMode!=="training"||entry.provider||entry.mapCreated)throw new Error(`REAL WORLD provider must stay lazy until explicit user activation: ${JSON.stringify(entry)}`);

  await page.click("#soloTopbar .phone-settings-button");
  await page.waitForFunction(()=>document.querySelector(".phone-settings-dialog")?.open,{timeout:5000});
  const config=await page.evaluate(()=>({
    section:!!document.querySelector('[data-world-settings="openfreemap-osm-3d"]'),
    key:!!document.querySelector("[data-world-key]"),
    forget:!!document.querySelector("[data-world-forget]"),
    use:document.querySelector("[data-world-use]")?.textContent?.trim()||"",
    training:document.querySelector("[data-world-training]")?.textContent?.trim()||"",
    grid:document.querySelector('.phone-settings-dialog [data-world-grid]')?.checked,
    keepLook:document.querySelector('.phone-settings-dialog [data-world-keep-look]')?.checked,
    minimapFollow:document.querySelector('.phone-settings-dialog [data-world-minimap-follow]')?.checked,
    note:document.querySelector('[data-world-settings="openfreemap-osm-3d"]')?.textContent||""
  }));
  if(!config.section||config.key||config.forget||config.use!=="USE MY GPS LOCATION"||config.training!=="TRAINING RANGE"||config.grid!==true||config.keepLook!==false||config.minimapFollow!==true||!config.note.includes("No account, API key, billing setup, backend or proxy"))throw new Error(`REAL WORLD settings incomplete: ${JSON.stringify(config)}`);
  if(external.length)throw new Error(`training/settings path triggered external network: ${JSON.stringify(external)}`);
  await page.click('.phone-settings-dialog [data-close]');

  // Exercise the actual bridge with browser-granted GPS and the explicitly
  // registered production flight renderer. Only the public style response is
  // replaced by a deterministic source-free fixture; MapLibre's own blob/data
  // workers remain intact and no public map tiles are fetched in CI.
  await page.click("#soloWorld");
  try{
    await page.waitForFunction(()=>{
      const viewport=document.querySelector("#viewport");
      return viewport?.dataset.worldMode==="real"&&viewport?.dataset.worldProvider==="openfreemap"&&Number(viewport?.dataset.worldThreeFrames||0)>5;
    },{timeout:20000});
  }catch(error){
    const debug=await page.evaluate(()=>{
      const viewport=document.querySelector("#viewport"),bridge=globalThis.__arondightRealWorld;
      return{worldMode:viewport?.dataset.worldMode||"",provider:viewport?.dataset.worldProvider||"",path:viewport?.dataset.worldRenderPath||"",frames:viewport?.dataset.worldThreeFrames||"",status:document.querySelector("#realWorldStatus")?.textContent||"",active:Boolean(bridge?.active),loading:Boolean(bridge?.loading),map:Boolean(bridge?.map),renderer:Boolean(bridge?.threeRenderer)};
    });
    throw new Error(`REAL WORLD activation timeout: ${JSON.stringify({debug,external,providerRequests,cause:String(error)})}`);
  }

  const live=await page.evaluate(()=>{
    const viewport=document.querySelector("#viewport"),bridge=globalThis.__arondightRealWorld;
    const renderer=bridge?.threeRenderer,style=renderer?.domElement?getComputedStyle(renderer.domElement):null;
    return{
      button:document.querySelector("#soloWorld")?.textContent||"",
      active:document.querySelector("#soloWorld")?.dataset.active||"",
      provider:viewport?.dataset.worldProvider||"",
      path:viewport?.dataset.worldRenderPath||"",
      frames:Number(viewport?.dataset.worldThreeFrames||0),
      canvasCount:document.querySelectorAll("#viewport canvas").length,
      mapCreated:Boolean(bridge?.map),
      hasSharedRenderer:Boolean(renderer),
      hasLegacyOverlay:Boolean(bridge&&"overlayRenderer" in bridge&&bridge.overlayRenderer),
      rendererVisible:style?.visibility!=="hidden"&&style?.display!=="none",
      alpha:Boolean(renderer?.getContext?.().getContextAttributes?.()?.alpha),
      mapUpdates:Number(viewport?.dataset.worldMapUpdates||0),
      mapFpsCap:Number(viewport?.dataset.worldMapFpsCap||0),
      mapPixelRatio:Number(viewport?.dataset.worldMapPixelRatio||0),
      flightPixelRatio:Number(viewport?.dataset.worldFlightPixelRatio||0),
      geoBackground:getComputedStyle(document.querySelector("#geoViewport")).backgroundImage,
      grid:viewport?.dataset.worldGridEnabled||"",keepLook:viewport?.dataset.worldLookKeepEnabled||"",lookHud:getComputedStyle(document.querySelector("#worldLookHud")).display,minimapCanvas:!!document.querySelector("#worldLookHud .world-mini-canvas"),minimapMode:viewport?.dataset.worldMinimapMode||"",minimapFollow:viewport?.dataset.worldMinimapFollow||"",legend:getComputedStyle(document.querySelector("#worldMapLegend")).display,perfMode:viewport?.dataset.worldPerfMode||"",flightFps:Number(viewport?.dataset.worldFlightFps||0),paletteLayers:Number(viewport?.dataset.worldPaletteLayers||0)
    };
  });
  if(live.button!=="WORLD ✓"||live.active!=="1"||live.provider!=="openfreemap")throw new Error(`WORLD did not become live: ${JSON.stringify(live)}`);
  if(live.path!=="shared-three-renderer"||live.frames<=5||!live.mapCreated||!live.hasSharedRenderer||live.hasLegacyOverlay||!live.rendererVisible||!live.alpha)throw new Error(`shared real-world THREE renderer contract failed: ${JSON.stringify(live)}`);
  if(!(live.mapUpdates>0&&live.mapUpdates<live.frames)||![15,20,30].includes(live.mapFpsCap)||live.mapPixelRatio!==1||live.flightPixelRatio>1.25||!live.geoBackground.includes("gradient")||live.grid!=="1"||live.keepLook!=="0"||live.lookHud==="none"||!live.minimapCanvas||live.minimapMode!=="camera"||live.minimapFollow!=="1"||live.legend==="none"||!["nominal","constrained","critical"].includes(live.perfMode)||live.paletteLayers<1)throw new Error(`WORLD render budget/contrast failed: ${JSON.stringify(live)}`);
  if(live.canvasCount!==3)throw new Error(`REAL WORLD must use MapLibre + existing flight canvas + one lightweight cached mini-map canvas, got ${live.canvasCount}`);
  if(providerRequests.length!==1)throw new Error(`expected one deterministic OpenFreeMap style request, got ${JSON.stringify(providerRequests)}`);

  const miniFixture=await page.evaluate(()=>{
    const bridge=globalThis.__arondightRealWorld,lat=bridge.originLat,lon=bridge.originLon,d=.00012;bridge.minimapLayerIds=["fixture"];bridge.map.queryRenderedFeatures=()=>[
      {sourceLayer:"water",layer:{id:"water",type:"fill"},geometry:{type:"Polygon",coordinates:[[[lon-d,lat-d],[lon+d,lat-d],[lon+d,lat],[lon-d,lat-d]]]},properties:{}},
      {sourceLayer:"transportation",layer:{id:"road-primary",type:"line"},geometry:{type:"LineString",coordinates:[[lon-d,lat],[lon+d,lat]]},properties:{}},
      {sourceLayer:"landcover",layer:{id:"park",type:"fill"},geometry:{type:"Polygon",coordinates:[[[lon-d,lat],[lon,lat],[lon,lat+d],[lon-d,lat]]]},properties:{}},
      {sourceLayer:"building",layer:{id:"arondight45-buildings-3d",type:"fill-extrusion"},geometry:{type:"Polygon",coordinates:[[[lon,lat],[lon+d,lat],[lon+d,lat+d],[lon,lat]]]},properties:{render_height:14}}
    ];bridge.minimapLastQueryMs=-Infinity;bridge.minimapLastDrawMs=-Infinity;bridge.drawMinimap(performance.now());return{count:bridge.minimapFeatures.length,kinds:bridge.minimapFeatures.map(f=>f.kind).sort(),queries:bridge.minimapQueries,mode:document.querySelector("#viewport")?.dataset.worldMinimapMode||""};
  });
  if(miniFixture.count!==4||miniFixture.kinds.join(",")!=="building,green,road,water"||miniFixture.queries<1||miniFixture.mode!=="camera")throw new Error(`cached mini-map semantic projection failed: ${JSON.stringify(miniFixture)}`);

  await page.click("#soloTopbar .phone-settings-button");
  await page.waitForFunction(()=>document.querySelector(".phone-settings-dialog")?.open,{timeout:5000});
  await page.click('.phone-settings-dialog [data-world-grid]');
  await page.click('.phone-settings-dialog [data-close]');
  await page.waitForFunction(()=>document.querySelector("#viewport")?.dataset.worldGridEnabled==="0",{timeout:3000});
  let gridPersist=await page.evaluate(()=>localStorage.getItem("arondight45WorldGridV1"));
  if(gridPersist!=="0")throw new Error(`WORLD GRID off did not persist: ${gridPersist}`);
  await page.click("#soloTopbar .phone-settings-button");
  await page.waitForFunction(()=>document.querySelector(".phone-settings-dialog")?.open,{timeout:5000});
  await page.click('.phone-settings-dialog [data-world-grid]');
  await page.click('.phone-settings-dialog [data-close]');
  await page.waitForFunction(()=>document.querySelector("#viewport")?.dataset.worldGridEnabled==="1",{timeout:3000});
  gridPersist=await page.evaluate(()=>localStorage.getItem("arondight45WorldGridV1"));
  if(gridPersist!=="1")throw new Error(`WORLD GRID on did not persist: ${gridPersist}`);

  await page.mouse.move(250,145);await page.mouse.down();await page.mouse.move(330,125,{steps:5});await page.mouse.up();
  await page.waitForFunction(()=>Math.abs(Number(document.querySelector("#viewport")?.dataset.worldLookYaw||0))>8,{timeout:3000});
  await page.waitForFunction(()=>Math.abs(Number(document.querySelector("#viewport")?.dataset.worldLookYaw||0))<1,{timeout:3000});
  const lookBox=await page.$eval("#worldLookHud",element=>{const r=element.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};});
  await page.mouse.move(lookBox.x+lookBox.w/2,lookBox.y+lookBox.h/2);await page.mouse.down();await page.mouse.move(lookBox.x+lookBox.w*.82,lookBox.y+lookBox.h*.30,{steps:5});await page.mouse.up();
  await page.waitForFunction(()=>Math.abs(Number(document.querySelector("#viewport")?.dataset.worldLookYaw||0))>8,{timeout:3000});
  await page.waitForFunction(()=>Math.abs(Number(document.querySelector("#viewport")?.dataset.worldLookYaw||0))<1&&Math.abs(Number(document.querySelector("#viewport")?.dataset.worldLookPitch||0))<1,{timeout:3000});
  await page.click("#soloTopbar .phone-settings-button");await page.waitForFunction(()=>document.querySelector(".phone-settings-dialog")?.open,{timeout:5000});await page.click(".phone-settings-dialog [data-world-keep-look]");await page.click(".phone-settings-dialog [data-close]");
  await page.mouse.move(lookBox.x+lookBox.w/2,lookBox.y+lookBox.h/2);await page.mouse.down();await page.mouse.move(lookBox.x+lookBox.w*.80,lookBox.y+lookBox.h*.58,{steps:5});await page.mouse.up();await page.waitForFunction(()=>Math.abs(Number(document.querySelector("#viewport")?.dataset.worldLookYaw||0))>8,{timeout:3000});
  await new Promise(resolve=>setTimeout(resolve,450));const keptLook=await page.$eval("#viewport",element=>({yaw:Number(element.dataset.worldLookYaw||0),keep:element.dataset.worldLookKeepEnabled||""}));if(Math.abs(keptLook.yaw)<8||keptLook.keep!=="1")throw new Error(`WORLD KEEP look did not persist after release: ${JSON.stringify(keptLook)}`);

  await page.click("#soloTopbar .phone-settings-button");await page.waitForFunction(()=>document.querySelector(".phone-settings-dialog")?.open,{timeout:5000});await page.click(".phone-settings-dialog [data-world-minimap-follow]");await page.click(".phone-settings-dialog [data-close]");await page.waitForFunction(()=>document.querySelector("#viewport")?.dataset.worldMinimapMode==="north",{timeout:3000});const northMini=await page.$eval("#viewport",e=>Number(e.dataset.worldMinimapBearing||99));if(Math.abs(northMini)>.01)throw new Error(`north-up mini-map failed: ${northMini}`);
  await page.click("#soloTopbar .phone-settings-button");await page.waitForFunction(()=>document.querySelector(".phone-settings-dialog")?.open,{timeout:5000});await page.click(".phone-settings-dialog [data-world-minimap-follow]");await page.click(".phone-settings-dialog [data-close]");

  const follow=await cameraSnapshot();
  if(follow.mode!=="follow"||follow.worldCameraMode!=="follow"||!follow.center||!follow.zoom)throw new Error(`FOLLOW world-camera sync missing: ${JSON.stringify(follow)}`);

  await page.click("#soloCamera");
  await page.waitForFunction(()=>document.querySelector("#viewport")?.dataset.worldCameraMode==="third",{timeout:5000});
  const third=await cameraSnapshot();
  if(third.mode!=="third"||third.worldCameraMode!=="third")throw new Error(`THIRD camera mode did not propagate to WORLD: ${JSON.stringify(third)}`);
  if(third.center===follow.center&&third.zoom===follow.zoom&&third.pitch===follow.pitch&&third.bearing===follow.bearing)throw new Error(`THIRD geospatial camera stayed frozen: ${JSON.stringify({follow,third})}`);

  await page.click("#soloCamera");
  await page.waitForFunction(()=>document.querySelector("#viewport")?.dataset.worldCameraMode==="fpv",{timeout:5000});
  const fpv=await cameraSnapshot();
  if(fpv.mode!=="fpv"||fpv.worldCameraMode!=="fpv")throw new Error(`FPV camera mode did not propagate to WORLD: ${JSON.stringify(fpv)}`);
  if(fpv.center===third.center&&fpv.zoom===third.zoom&&fpv.pitch===third.pitch&&fpv.bearing===third.bearing)throw new Error(`FPV geospatial camera stayed frozen: ${JSON.stringify({third,fpv})}`);
  if(fpv.syncMode!=="rigid-3d-target"||!Number.isFinite(Number(fpv.targetElevation)))throw new Error(`FPV WORLD camera did not use stable elevated 3D target: ${JSON.stringify(fpv)}`);
  const fpvSyncStart=await page.$eval("#viewport",e=>({frames:Number(e.dataset.worldThreeFrames||0),updates:Number(e.dataset.worldMapUpdates||0)}));
  await page.waitForFunction(start=>Number(document.querySelector("#viewport")?.dataset.worldThreeFrames||0)>start+6,{timeout:5000},fpvSyncStart.frames);
  const fpvSyncEnd=await page.$eval("#viewport",e=>({frames:Number(e.dataset.worldThreeFrames||0),updates:Number(e.dataset.worldMapUpdates||0),mode:e.dataset.worldMapSyncMode||""}));
  const fpvFrameDelta=fpvSyncEnd.frames-fpvSyncStart.frames,fpvMapDelta=fpvSyncEnd.updates-fpvSyncStart.updates;if(fpvSyncEnd.mode!=="rigid-3d-target"||fpvMapDelta<fpvFrameDelta-1)throw new Error(`FPV WORLD map did not stay locked to visible camera frames: ${JSON.stringify({fpvSyncStart,fpvSyncEnd,fpvFrameDelta,fpvMapDelta})}`);
  const fpvLookBefore=await page.$eval("#viewport",e=>Number(e.dataset.worldLookYaw||0));await page.mouse.move(250,145);await page.mouse.down();await page.mouse.move(350,120,{steps:5});await page.mouse.up();await new Promise(resolve=>setTimeout(resolve,180));const fpvLookAfter=await page.$eval("#viewport",e=>Number(e.dataset.worldLookYaw||0));if(Math.abs(fpvLookAfter-fpvLookBefore)>.1)throw new Error(`rigid FPV was virtually panned: ${JSON.stringify({fpvLookBefore,fpvLookAfter})}`);

  const framesBefore=live.frames;
  await page.waitForFunction(before=>Number(document.querySelector("#viewport")?.dataset.worldThreeFrames||0)>before+3,{timeout:5000},framesBefore);

  await page.click("#soloWorld");
  await page.waitForFunction(()=>document.querySelector("#viewport")?.dataset.worldMode==="training",{timeout:5000});
  const fallback=await page.evaluate(()=>{
    const viewport=document.querySelector("#viewport"),bridge=globalThis.__arondightRealWorld;
    return{text:document.querySelector("#soloWorld")?.textContent||"",active:document.querySelector("#soloWorld")?.dataset.active||"",provider:viewport?.dataset.worldProvider||"",path:viewport?.dataset.worldRenderPath||"",rendererVisible:bridge?.threeRenderer?getComputedStyle(bridge.threeRenderer.domElement).visibility!=="hidden":false};
  });
  if(fallback.text!=="WORLD"||fallback.active!=="0"||fallback.provider||fallback.path||!fallback.rendererVisible)throw new Error(`WORLD training fallback failed: ${JSON.stringify(fallback)}`);

  console.log("REAL WORLD explicit shared-frame smoke passed: 50m range, validated 5m/s shared FC envelope, grid toggle, SNAP/KEEP 360 look HUD, semantic map palette/legend, stripped symbol clutter, adaptive 15/20/30Hz FOLLOW/THIRD map budget, rigid elevated FPV camera target, semantic depth palette, clean fallback.");
}finally{
  await browser.close();
}
