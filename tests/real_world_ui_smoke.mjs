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
if(!bootstrapSource.includes("WORLD_MAP_FRAME_MS=1000/30")||!bootstrapSource.includes("pixelRatio:Math.min(devicePixelRatio||1,WORLD_MAP_PIXEL_RATIO)")||!bootstrapSource.includes("setSky({\"sky-color\":\"#0a2845\""))throw new Error("WORLD mobile render/contrast budget missing");
if(!simulatorSource.includes("MAX_GAME_CLEARANCE_M")||!simulatorSource.includes("NAV_AGL_RAY_MAX_M = 60")||!simulatorSource.includes("TorusGeometry(.15"))throw new Error("WORLD range/visual acquisition cues missing");

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
    bearing:viewport?.dataset.worldMapBearing||""
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
    note:document.querySelector('[data-world-settings="openfreemap-osm-3d"]')?.textContent||""
  }));
  if(!config.section||config.key||config.forget||config.use!=="USE MY GPS LOCATION"||config.training!=="TRAINING RANGE"||config.grid!==true||config.keepLook!==false||!config.note.includes("No account, API key, billing setup, backend or proxy"))throw new Error(`REAL WORLD settings incomplete: ${JSON.stringify(config)}`);
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
      grid:viewport?.dataset.worldGridEnabled||"",keepLook:viewport?.dataset.worldLookKeepEnabled||"",lookHud:getComputedStyle(document.querySelector("#worldLookHud")).display,legend:getComputedStyle(document.querySelector("#worldMapLegend")).display,perfMode:viewport?.dataset.worldPerfMode||"",flightFps:Number(viewport?.dataset.worldFlightFps||0),paletteLayers:Number(viewport?.dataset.worldPaletteLayers||0)
    };
  });
  if(live.button!=="WORLD ✓"||live.active!=="1"||live.provider!=="openfreemap")throw new Error(`WORLD did not become live: ${JSON.stringify(live)}`);
  if(live.path!=="shared-three-renderer"||live.frames<=5||!live.mapCreated||!live.hasSharedRenderer||live.hasLegacyOverlay||!live.rendererVisible||!live.alpha)throw new Error(`shared real-world THREE renderer contract failed: ${JSON.stringify(live)}`);
  if(!(live.mapUpdates>0&&live.mapUpdates<live.frames)||![15,20,30].includes(live.mapFpsCap)||live.mapPixelRatio!==1||live.flightPixelRatio>1.25||!live.geoBackground.includes("gradient")||live.grid!=="1"||live.keepLook!=="0"||live.lookHud==="none"||live.legend==="none"||!["nominal","constrained","critical"].includes(live.perfMode)||live.paletteLayers<1)throw new Error(`WORLD render budget/contrast failed: ${JSON.stringify(live)}`);
  if(live.canvasCount!==2)throw new Error(`REAL WORLD must use exactly MapLibre + the existing flight canvas, got ${live.canvasCount}`);
  if(providerRequests.length!==1)throw new Error(`expected one deterministic OpenFreeMap style request, got ${JSON.stringify(providerRequests)}`);

  const lookBox=await page.$eval("#worldLookHud",element=>{const r=element.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};});
  await page.mouse.move(lookBox.x+lookBox.w/2,lookBox.y+lookBox.h/2);await page.mouse.down();await page.mouse.move(lookBox.x+lookBox.w*.82,lookBox.y+lookBox.h*.30,{steps:5});await page.mouse.up();
  await page.waitForFunction(()=>Math.abs(Number(document.querySelector("#viewport")?.dataset.worldLookYaw||0))>8,{timeout:3000});
  await page.waitForFunction(()=>Math.abs(Number(document.querySelector("#viewport")?.dataset.worldLookYaw||0))<1&&Math.abs(Number(document.querySelector("#viewport")?.dataset.worldLookPitch||0))<1,{timeout:3000});
  await page.click("#soloTopbar .phone-settings-button");await page.waitForFunction(()=>document.querySelector(".phone-settings-dialog")?.open,{timeout:5000});await page.click(".phone-settings-dialog [data-world-keep-look]");await page.click(".phone-settings-dialog [data-close]");
  await page.mouse.move(lookBox.x+lookBox.w/2,lookBox.y+lookBox.h/2);await page.mouse.down();await page.mouse.move(lookBox.x+lookBox.w*.80,lookBox.y+lookBox.h*.58,{steps:5});await page.mouse.up();await page.waitForFunction(()=>Math.abs(Number(document.querySelector("#viewport")?.dataset.worldLookYaw||0))>8,{timeout:3000});
  await new Promise(resolve=>setTimeout(resolve,450));const keptLook=await page.$eval("#viewport",element=>({yaw:Number(element.dataset.worldLookYaw||0),keep:element.dataset.worldLookKeepEnabled||""}));if(Math.abs(keptLook.yaw)<8||keptLook.keep!=="1")throw new Error(`WORLD KEEP look did not persist after release: ${JSON.stringify(keptLook)}`);

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

  const framesBefore=live.frames;
  await page.waitForFunction(before=>Number(document.querySelector("#viewport")?.dataset.worldThreeFrames||0)>before+3,{timeout:5000},framesBefore);

  await page.click("#soloWorld");
  await page.waitForFunction(()=>document.querySelector("#viewport")?.dataset.worldMode==="training",{timeout:5000});
  const fallback=await page.evaluate(()=>{
    const viewport=document.querySelector("#viewport"),bridge=globalThis.__arondightRealWorld;
    return{text:document.querySelector("#soloWorld")?.textContent||"",active:document.querySelector("#soloWorld")?.dataset.active||"",provider:viewport?.dataset.worldProvider||"",path:viewport?.dataset.worldRenderPath||"",rendererVisible:bridge?.threeRenderer?getComputedStyle(bridge.threeRenderer.domElement).visibility!=="hidden":false};
  });
  if(fallback.text!=="WORLD"||fallback.active!=="0"||fallback.provider||fallback.path||!fallback.rendererVisible)throw new Error(`WORLD training fallback failed: ${JSON.stringify(fallback)}`);

  console.log("REAL WORLD explicit shared-frame smoke passed: 50m range, validated 5m/s shared FC envelope, grid toggle, SNAP/KEEP 360 look HUD, semantic map palette/legend, stripped symbol clutter, adaptive 15/20/30Hz map budget, live camera sync, clean fallback.");
}finally{
  await browser.close();
}
