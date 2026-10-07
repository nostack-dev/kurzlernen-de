import puppeteer from "puppeteer-core";
import {mkdir,writeFile} from "node:fs/promises";

// Visual + performance diagnostics of the LIVE build on a phone-sized
// viewport with a real city (fixed GPS). Writes screenshots and metrics to
// artifacts/diag/ — the workflow publishes them on the ci-diagnostics branch.
const input=process.argv[2]||"https://kurzlernen.de/drone_simulator.html",executablePath=process.env.CHROME_BIN;
if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");
const OUT="artifacts/diag",report={url:input,steps:[],errors:[]};await mkdir(OUT,{recursive:true});
const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader","--autoplay-policy=no-user-gesture-required"]});
const page=await browser.newPage(),pause=ms=>new Promise(r=>setTimeout(r,ms));
page.on("pageerror",e=>report.errors.push(String(e.message||e).slice(0,300)));
page.on("console",m=>{if(m.type()==="error"||m.type()==="warning")report.errors.push(`${m.type()}: ${m.text().slice(0,240)}`);});
const url=new URL(input);url.searchParams.set("menu","1");url.searchParams.set("hq","1");
await browser.defaultBrowserContext().overridePermissions(url.origin,["geolocation"]);
await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1");
await page.setViewport({width:844,height:390,deviceScaleFactor:1,isMobile:true,hasTouch:true});
await page.setGeolocation({latitude:52.5208,longitude:13.4094,accuracy:5});
const metrics=()=>page.evaluate(async()=>{const v=document.querySelector("#viewport")||{dataset:{}},d=v.dataset;
  const fps=await new Promise(res=>{let n=0;const t0=performance.now();const f=()=>{n++;if(performance.now()-t0<2000)requestAnimationFrame(f);else res(n/((performance.now()-t0)/1000));};requestAnimationFrame(f);});
  const r=globalThis.__arondightRealWorld?.threeRenderer?.info;
  return{fps:+fps.toFixed(1),drawCalls:r?.render?.calls,triangles:r?.render?.triangles,lines:r?.render?.lines,programs:r?.programs?.length,programNames:(r?.programs||[]).map(p=>`${p.name||"?"}#${String(p.cacheKey||"").slice(0,24)}`),status:document.querySelector("#status")?.textContent,worldMode:d.worldMode,mapSync:d.worldMapSyncMode,cityBuildings:d.worldCityBuildings,water:`${d.worldWaterCells||0}/${d.worldWaterBasins||0}/${d.worldWaterBridges||0}`,ground:d.worldGroundSource,roads:d.worldCityRoads,bloom:d.neonBloom,style:d.visualStyle,collisionPrisms:d.worldBuildingCollisionPrisms,neonMeshes:d.neonStyledMeshes,terrainShapes:d.terrainShapes,nukeDebris:d.nukeDebrisAlive,nukeFlung:d.nukeFlungActors,nukeBuildings:d.nukeDestructionBuildings,nukeActors:d.nukeDestructionActors,droneHp:d.droneHp,footTouch:d.footTouch,walkMode:globalThis.__arondightWalkMode?.mode,menuHidden:document.getElementById("gameMenu")?.hidden};});
async function step(name,fn){const t=Date.now();try{await fn?.();}catch(e){report.errors.push(`${name}: ${String(e.message||e).slice(0,300)}`);}let m={};try{m=await metrics();}catch(e){m={error:String(e).slice(0,200)};}try{await page.screenshot({path:`${OUT}/${String(report.steps.length).padStart(2,"0")}-${name}.png`});}catch{}report.steps.push({name,ms:Date.now()-t,...m});}
async function armDroneAtomically(){
  const deadline=Date.now()+15000;
  while(Date.now()<deadline){
    const state=await page.evaluate(()=>{const button=document.querySelector("#soloArm"),fc=(document.querySelector("#soloState")?.textContent||"").trim(),canDeploy=Boolean(globalThis.__arondightDroneDamageModel?.canDeploy);if(fc==="ARMED")return{armed:true,clicked:false,disabled:Boolean(button?.disabled),fc,canDeploy};if(button&&!button.disabled&&button.textContent.trim()==="ARM"&&canDeploy){button.click();return{armed:false,clicked:true,disabled:false,fc,canDeploy};}return{armed:false,clicked:false,disabled:Boolean(button?.disabled),fc,canDeploy};});
    if(state.armed)return state;
    if(state.clicked){try{await page.waitForFunction(()=>document.querySelector("#soloState")?.textContent?.trim()==="ARMED"&&document.querySelector("#viewport")?.dataset.fireArmed==="1",{timeout:9000});return await page.evaluate(()=>({armed:true,clicked:true,disabled:Boolean(document.querySelector("#soloArm")?.disabled),fc:document.querySelector("#soloState")?.textContent?.trim(),canDeploy:Boolean(globalThis.__arondightDroneDamageModel?.canDeploy)}));}catch{}}
    await pause(120);
  }
  throw new Error(`could not atomically arm healthy drone for NUKE: ${JSON.stringify(await page.evaluate(()=>({destroyed:Boolean(globalThis.__arondightDroneDamageModel?.destroyed),canDeploy:Boolean(globalThis.__arondightDroneDamageModel?.canDeploy),disabled:Boolean(document.querySelector("#soloArm")?.disabled),button:document.querySelector("#soloArm")?.textContent?.trim(),fc:document.querySelector("#soloState")?.textContent?.trim(),mode:globalThis.__arondightWalkMode?.mode})))}`);
}

try{
  const t0=Date.now();await page.goto(url.href,{waitUntil:"domcontentloaded",timeout:60000});report.domContentLoadedMs=Date.now()-t0;
  page.evaluate(()=>new Promise(r=>document.readyState==="complete"?r():addEventListener("load",r,{once:true}))).then(()=>{report.loadEventMs=Date.now()-t0;}).catch(()=>{});
  await step("boot-5s",()=>pause(5000));
  report.boot=await page.evaluate(()=>({readyState:document.readyState,status:document.querySelector("#status")?.textContent,pendingResources:performance.getEntriesByType("resource").filter(e=>!e.responseEnd).map(e=>e.name).slice(0,10),resources:performance.getEntriesByType("resource").map(e=>({n:e.name.slice(-60),ms:Math.round(e.duration),kb:Math.round((e.transferSize||0)/1024)})).slice(0,40)})).catch(e=>({error:String(e)}));
  await step("menu",()=>page.waitForFunction(()=>document.getElementById("gameMenuStart")?.textContent?.trim()==="START",{timeout:45000}));
  await step("started",async()=>{await page.click("#gameMenuStart");await page.waitForFunction(()=>document.getElementById("gameMenu")?.hidden===true,{timeout:60000});await pause(4000);});
  await step("city-drone",async()=>{await page.waitForFunction(()=>Number(document.querySelector("#viewport")?.dataset.worldCityBuildings)>20,{timeout:30000}).catch(()=>{});await pause(1500);});
  report.mapProbe=await page.evaluate(()=>{const b=globalThis.__arondightRealWorld,out={source:b?.buildingSourceId,cam:b?.threeCamera?[+b.threeCamera.position.x.toFixed(1),+b.threeCamera.position.y.toFixed(1)]:null,layers:{}};
    for(const layer of["transportation","water","waterway","park","landcover","landuse","building"]){try{const f=b.map.querySourceFeatures(b.buildingSourceId,{sourceLayer:layer});const g=f[0]?.geometry,c=g?.coordinates;let first=null;try{first=g?.type==="Polygon"?c[0][0]:g?.type==="LineString"?c[0]:g?.type==="MultiLineString"?c[0][0]:g?.type==="MultiPolygon"?c[0][0][0]:null;}catch{}out.layers[layer]={n:f.length,type:g?.type,cls:f[0]?.properties?.class,first,proj:first?b.projectLngLat(first[0],first[1]).map(v=>+v.toFixed(1)):null};}catch(e){out.layers[layer]={error:String(e.message||e)};}}
    const v=document.getElementById("viewport");out.roads=v?.dataset.worldCityRoads;out.water=[v?.dataset.worldWaterCells,v?.dataset.worldWaterBasins,v?.dataset.worldWaterBridges];out.waterState=v?.dataset.worldWaterState;out.waterStats=v?.dataset.worldWaterStats;out.minimapGuard=v?.dataset.minimapGuard||"ok";const mh=document.getElementById("worldLookHud");if(mh){const r=mh.getBoundingClientRect(),cs=getComputedStyle(mh);out.minimap={x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height),display:cs.display,vis:cs.visibility,op:cs.opacity,z:cs.zIndex};}out.font=getComputedStyle(document.body).fontFamily;return out;});
  // Cost attribution: frame rate with individual layers switched off.
  report.attribution=await page.evaluate(async()=>{
    const fps=()=>new Promise(res=>{let n=0;const t0=performance.now();const f=()=>{n++;if(performance.now()-t0<2500)requestAnimationFrame(f);else res(+(n/((performance.now()-t0)/1000)).toFixed(1));};requestAnimationFrame(f);});
    const scene=globalThis.__arondightRealWorld?.threeScene,out={};if(!scene)return out;
    const byName=n=>scene.getObjectByName(n),edges=[];scene.traverse(o=>{if(o.userData?.neonEdge)edges.push(o);});
    const geo=document.getElementById("geoViewport");
    const trial=async(name,off,on)=>{off();await new Promise(r=>setTimeout(r,400));out[name]=await fps();on();};
    out.baseline=await fps();
    await trial("noCitySolids",()=>{const m=byName("WORLD_CITY_SOLIDS");if(m)m.visible=false;},()=>{const m=byName("WORLD_CITY_SOLIDS");if(m)m.visible=true;});
    await trial("noCityEdges",()=>{const m=byName("WORLD_CITY_EDGES");if(m)m.visible=false;},()=>{const m=byName("WORLD_CITY_EDGES");if(m)m.visible=true;});
    await trial("noObjectEdges",()=>edges.forEach(e=>e.visible=false),()=>edges.forEach(e=>e.visible=true));
    await trial("noGrid",()=>{const m=byName("NEON_GROUND_GRID");if(m)m.visible=false;},()=>{const m=byName("NEON_GROUND_GRID");if(m)m.visible=true;});
    await trial("noMapCanvas",()=>{if(geo)geo.style.display="none";},()=>{if(geo)geo.style.display="";});
    out.objectEdges=edges.length;return out;
  }).catch(e=>({error:String(e)}));
  await step("minimap-expanded",async()=>{await page.evaluate(()=>globalThis.__arondightRealWorld?.toggleMinimapExpanded?.());await pause(800);});
  await page.evaluate(()=>globalThis.__arondightRealWorld?.toggleMinimapExpanded?.());
  await step("on-foot",async()=>{await page.evaluate(()=>globalThis.__arondightWalkMode?.setMode?.("foot",{persist:false,reason:"diag"}));await pause(2500);});
  await step("foot-touch-move",async()=>{const r=await page.$eval("#footMove",e=>{const b=e.getBoundingClientRect();return{x:b.left+b.width/2,y:b.top+b.height/2,w:b.width};}).catch(()=>null);if(!r)throw new Error("no #footMove");const before=await page.evaluate(()=>({...globalThis.__arondightWalkMode.position}));const t=page.touchscreen;await t.touchStart(r.x,r.y);for(let i=1;i<=10;i++){await t.touchMove(r.x,r.y-r.w*.05*i);await pause(60);}await pause(1500);const after=await page.evaluate(()=>({...globalThis.__arondightWalkMode.position}));await t.touchEnd();report.walkMoved=Math.hypot(after.x-before.x,after.y-before.y);report.walkSprint=await page.$eval("#viewport",v=>v.dataset.walkTouchSprint);});
  await page.evaluate(()=>globalThis.__arondightWalkMode?.setMode?.("drone",{persist:false,reason:"diag"}));await pause(1500);
  await page.evaluate(()=>{globalThis.__arondightDroneDamageModel?.reset?.();globalThis.__arondightDroneWeapons?.setMode?.("nuke");});
  report.arm=await armDroneAtomically().catch(e=>({error:String(e.message||e).slice(0,200)}));
  // A real tap-fired nuke lands close (drone sits in its crater); for a
  // readable view of the cloud the diagnostic also drops one 450 m ahead
  // through the multiplayer entry point (exercises the remote path too).
  await step("nuke-fired",async()=>{report.nukeRemote=await page.evaluate(()=>{const c=globalThis.__arondightRealWorld?.threeCamera;if(!c)return null;const d=c.getWorldDirection(c.position.clone());d.z=0;d.normalize();const p=[c.position.x+d.x*450,c.position.y+d.y*450,0];window.dispatchEvent(new CustomEvent("arondight:remote-nuke",{detail:{position:p}}));return p;});await pause(1500);});
  await step("nuke-3s",()=>pause(1500));
  await step("nuke-8s",()=>pause(5000));
  await step("nuke-16s",()=>pause(8000));
  await step("nuke-30s",()=>pause(14000));
}finally{
  await writeFile(`${OUT}/diag.json`,JSON.stringify(report,null,1));console.log(JSON.stringify(report,null,1).slice(0,6000));await browser.close();
}
