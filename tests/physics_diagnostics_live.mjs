import puppeteer from "puppeteer-core";
import {mkdir,writeFile} from "node:fs/promises";

// Physics + world-integrity diagnostics of the LIVE build in a real city (fixed GPS, Konstanz).
// Checks what players reported and what cannot be reproduced without real map data:
//   * vehicles: body drawn together with its wheels (no "wheels only"), finite transforms, wheels under the body,
//   * terrain: rendered ground vs Box3D ground vs road surface (hills/valleys at roads),
//   * buildings: a destroyed house loses its Box3D collider,
//   * relocation / streaming / explosions / driving do not leave broken vehicles behind.
// Writes artifacts/physics/report.json + screenshots; the workflow publishes them on ci-diagnostics.
const input=process.argv[2]||"https://kurzlernen.de/drone_simulator.html",executablePath=process.env.CHROME_BIN;
if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");
const OUT="artifacts/physics",report={url:input,steps:[],errors:[]};await mkdir(OUT,{recursive:true});
const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader","--autoplay-policy=no-user-gesture-required"]});
const page=await browser.newPage(),pause=ms=>new Promise(r=>setTimeout(r,ms));
page.on("pageerror",e=>report.errors.push(String(e.message||e).slice(0,300)));
page.on("console",m=>{if(m.type()==="error"&&!/Failed to load resource/.test(m.text()))report.errors.push(`${m.type()}: ${m.text().slice(0,240)}`);});
const url=new URL(input);url.searchParams.set("menu","1");
await browser.defaultBrowserContext().overridePermissions(url.origin,["geolocation"]);
await page.setViewport({width:844,height:390,deviceScaleFactor:1,isMobile:true,hasTouch:true});
const LAT=Number(process.env.DIAG_LAT||47.66033),LON=Number(process.env.DIAG_LON||9.17582);
await page.setGeolocation({latitude:LAT,longitude:LON,accuracy:5});
let shot=0;const snap=async name=>{try{await page.screenshot({path:`${OUT}/${String(shot++).padStart(2,"0")}-${name}.png`});}catch{}};
async function step(name,fn){const t=Date.now();let error=null;try{await fn();}catch(e){error=String(e.message||e).slice(0,300);}report.steps.push({name,ms:Date.now()-t,error});console.log("step",name,Date.now()-t,"ms",error||"");}

const scanVehicles=()=>page.evaluate(()=>{const P=globalThis.__arondightProceduralPopulation,list=P?.diagVehicles?.()||[],cam=globalThis.__arondightRealWorld?.presentedCamera?.();
  const bad=list.filter(v=>v.shown&&(!v.finite||v.meshesVisible===0||!v.inScene||v.geoVerts===0||(v.wheelCenterDist!=null&&v.wheelCenterDist>2)||(v.wheels===4&&!v.pose)));
  const near=cam?list.filter(v=>v.shown&&Math.hypot(v.pos[0]-cam.position.x,v.pos[1]-cam.position.y)<60).length:null;
  return{total:list.length,shown:list.filter(v=>v.shown).length,registered:list.filter(v=>v.registered).length,near,bad:bad.slice(0,12),badCount:bad.length};});
// every rendered house near the player must have a collider: a ray from above at a point inside the
// house must stop on its roof (well above the ground), and a ray across it at chest height must hit it
const coverageProbe=()=>page.evaluate(()=>{const T=globalThis.__terrain,R=globalThis.__arondightWorldRigidBodies,W=globalThis.__arondightWalkMode,at=globalThis.__arondightBuildingAt;if(!T||!R||!W?.position||!at)return{error:"apis missing"};
  const px=W.position.x,py=W.position.y,out={inside:0,roofHit:0,missing:[]};
  for(let i=-12;i<=12;i++)for(let j=-12;j<=12;j++){const x=px+i*9,y=py+j*9;if(!at(x,y)||!at(x+1.5,y)||!at(x-1.5,y)||!at(x,y+1.5)||!at(x,y-1.5))continue;out.inside++;const g=T.groundHeightAt(x,y),hit=R.raycast([x,y,g+80],[.0002,.0003,-1],100,{categoryBits:8n,maskBits:1n});const h=hit?.point?hit.point[2]-g:null;if(h!=null&&h>1.5)out.roofHit++;else if(out.missing.length<10)out.missing.push({x:+(x-px).toFixed(0),y:+(y-py).toFixed(0),h:h==null?null:+h.toFixed(2)});}
  out.missingCount=out.inside-out.roofHit;const st=R.buildingState;out.box3dHulls=st?.shapeCount??null;out.failedHulls=st?.failedHulls??null;const snap=globalThis.__arondightRealWorld?.buildingCollisionSnapshot;out.footprints=snap?.footprintCount;out.prisms=snap?.prismCount;let far=0;for(const p of snap?.prisms||[])for(const q of p.points)far=Math.max(far,Math.hypot(q[0]-px,q[1]-py));out.coveredRadiusM=Math.round(far);return out;});
const terrainProbe=()=>page.evaluate(()=>{const T=globalThis.__terrain,R=globalThis.__arondightWorldRigidBodies,W=globalThis.__arondightWalkMode,b=globalThis.__arondightRealWorld,scene=b?.threeScene;if(!T||!R||!W?.position)return{error:"apis missing"};
  const roads=scene?.getObjectByName("WORLD_CITY_ROADS");const THREE_=scene?.constructor;const out={phys:[],road:[]};const px=W.position.x,py=W.position.y;
  const rc=roads&&globalThis.__diagRaycaster?globalThis.__diagRaycaster:null;
  const inHouse=globalThis.__arondightBuildingAt||(()=>false);out.skippedInHouse=0;for(let i=-7;i<=7;i++)for(let j=-7;j<=7;j++){const x=px+i*16,y=py+j*16,g=T.groundHeightAt(x,y);if(inHouse(x,y)||inHouse(x+2,y)||inHouse(x-2,y)||inHouse(x,y+2)||inHouse(x,y-2)){out.skippedInHouse++;continue;}const hit=R.raycast([x+.01,y+.01,g+40],[.0003,.0002,-1],90,{categoryBits:8n,maskBits:1n});if(hit?.point){const d=+(hit.point[2]-g).toFixed(2);out.phys.push(d);if(Math.abs(d)>.5)(out.worst??=[]).length<8&&out.worst.push({x:+(x-px).toFixed(0),y:+(y-py).toFixed(0),d});}}
  const st=a=>{if(!a.length)return null;const s=[...a].sort((p,q)=>p-q),abs=a.map(Math.abs).sort((p,q)=>p-q);return{n:a.length,min:s[0],max:s[s.length-1],medianAbs:abs[abs.length>>1],p95Abs:abs[Math.floor(abs.length*.95)],over50cm:abs.filter(v=>v>.5).length};};
  // road surface vs rendered ground under it (vertices of the road mesh)
  const rd=[];if(roads){roads.updateMatrixWorld(true);roads.traverse(o=>{if(!o.isMesh||rd.length>4000)return;const pos=o.geometry?.attributes?.position;if(!pos)return;const e=o.matrixWorld.elements;for(let k=0;k<pos.count&&rd.length<4000;k+=7){const x=pos.getX(k),y=pos.getY(k),z=pos.getZ(k),wx=e[0]*x+e[4]*y+e[8]*z+e[12],wy=e[1]*x+e[5]*y+e[9]*z+e[13],wz=e[2]*x+e[6]*y+e[10]*z+e[14];if(Math.hypot(wx-px,wy-py)>180)continue;rd.push(+(wz-T.groundHeightAt(wx,wy)).toFixed(2));}});}
  return{physicsMinusRender:st(out.phys),skippedInHouse:out.skippedInHouse,worst:out.worst,roadMinusGround:st(rd),roadSamples:rd.length};});
const buildingProbe=()=>page.evaluate(async()=>{const b=globalThis.__arondightRealWorld,R=globalThis.__arondightWorldRigidBodies,W=globalThis.__arondightWalkMode,T=globalThis.__terrain;const pr=b?.buildingCollisionSnapshot?.prisms||[];if(!pr.length||!W?.position)return{error:"no prisms",prisms:pr.length};
  const px=W.position.x,py=W.position.y;let best=null,bd=1e9;for(const p of pr){const c=p.points.reduce((a,q)=>[a[0]+q[0]/p.points.length,a[1]+q[1]/p.points.length],[0,0]);const d=Math.hypot(c[0]-px,c[1]-py);if(d>25&&d<bd&&(p.top-p.base)>4){bd=d;best={p,c};}}if(!best)return{error:"no building"};
  const key=best.p.buildingKey,c=best.c,g=T.groundHeightAt(c[0],c[1]);const ray=()=>{const from=[c[0]-30,c[1],g+2],hit=R.raycast(from,[1,0,0],60,{categoryBits:8n,maskBits:1n});return hit?.point?+Math.hypot(hit.point[0]-from[0],hit.point[1]-from[1]).toFixed(2):null;};
  const before={ray:ray(),prismsOfKey:pr.filter(p=>p.buildingKey===key).length};
  for(let k=0;k<6;k++){window.dispatchEvent(new CustomEvent("arondight:world-explosion",{detail:{position:[c[0]+(k%3-1)*3,c[1]+(k>2?3:-3),g+2],radiusM:14,maxDamage:400,kind:"diag",id:`diag-${k}`,playerAction:true}}));await new Promise(r=>setTimeout(r,500));}
  await new Promise(r=>setTimeout(r,6000));const pr2=b.buildingCollisionSnapshot?.prisms||[];const after={ray:ray(),prismsOfKey:pr2.filter(p=>p.buildingKey===key).length,renderedIntact:Boolean(globalThis.__arondightBuildingDamage?.intact?.(key))};return{key,distance:+bd.toFixed(1),before,after};});

try{
  await page.goto(url.href,{waitUntil:"domcontentloaded",timeout:90000});
  await step("menu",()=>page.waitForFunction(()=>document.getElementById("gameMenuStart")?.textContent?.trim()==="START",{timeout:120000,polling:500}));
  await step("start",async()=>{await page.click("#gameMenuStart");await page.waitForFunction(()=>document.getElementById("gameMenu")?.hidden===true,{timeout:120000,polling:500});});
  await step("city",async()=>{await page.waitForFunction(()=>Number(document.querySelector("#viewport")?.dataset.worldCityBuildings)>20,{timeout:60000,polling:500}).catch(()=>{});await page.evaluate(()=>globalThis.__arondightWalkMode?.setMode?.("foot",{persist:false,reason:"diag"}));await pause(8000);});
  report.world=await page.evaluate(()=>{const v=document.getElementById("viewport").dataset;return{mode:v.worldMode,buildings:v.worldCityBuildings,roads:v.worldCityRoads,elevation:v.terrainElevation,collision:v.worldBuildingCollisionStatus,prisms:v.worldBuildingCollisionPrisms};});
  await snap("foot");
  report.terrain=await terrainProbe().catch(e=>({error:String(e)}));report.coverage=await coverageProbe().catch(e=>({error:String(e)}));
  report.scans=[];for(let i=0;i<6;i++){report.scans.push({phase:"idle",...await scanVehicles()});await pause(2500);}
  // look at the nearest car and screenshot it
  await page.evaluate(()=>{const W=globalThis.__arondightWalkMode,list=globalThis.__arondightProceduralPopulation?.diagVehicles?.()||[];let best=null,bd=1e9;for(const v of list){if(!v.shown)continue;const d=Math.hypot(v.pos[0]-W.position.x,v.pos[1]-W.position.y);if(d<bd){bd=d;best=v;}}if(best&&bd<120){W.setPose({x:best.pos[0]-8,y:best.pos[1]-8,yaw:Math.PI/4,pitch:-.15});}});await pause(2500);await snap("near-car");
  report.scans.push({phase:"near-car",...await scanVehicles()});
  await step("drive",async()=>{await page.evaluate(()=>{const W=globalThis.__arondightWalkMode,list=globalThis.__arondightProceduralPopulation?.diagVehicles?.()||[];let best=null,bd=1e9;for(const v of list){if(!v.shown)continue;const d=Math.hypot(v.pos[0]-W.position.x,v.pos[1]-W.position.y);if(d<bd){bd=d;best=v;}}if(best)W.setPose({x:best.pos[0]-2.6,y:best.pos[1],yaw:Math.PI/2,pitch:0});});await pause(900);const ok=await page.evaluate(()=>String(globalThis.__arondightVehicleDrive?.enterNearest?.()));report.driveEnter=ok;const track=async(label,ms)=>{const out=[];const end=Date.now()+ms;while(Date.now()<end){out.push(await page.evaluate(()=>{const d=globalThis.__arondightVehicleDrive,p=d?.pose?.position;globalThis.__pdFrames??=0;if(!globalThis.__pdRaf){globalThis.__pdRaf=1;const f=()=>{globalThis.__pdFrames++;requestAnimationFrame(f);};requestAnimationFrame(f);}return{t:+(performance.now()/1000).toFixed(2),frames:globalThis.__pdFrames,thr:d?.throttle,speed:+(d?.speedMps||0).toFixed(2),pos:p?p.map(v=>+v.toFixed(2)):null};}));await pause(500);}(report.driveTrack??={})[label]=out;};
    await page.keyboard.down("KeyW");await track("w",5000);await page.keyboard.down("KeyA");await track("wa",1500);await page.keyboard.up("KeyA");await track("w2",2500);await page.keyboard.up("KeyW");await snap("driving");report.driveState=await page.evaluate(()=>{const d=globalThis.__arondightVehicleDrive,p=d?.pose?.position;return{active:Boolean(d?.active),speed:d?.speedMps,pos:p?p.map(v=>+v.toFixed(1)):null,inHouse:p?Boolean(globalThis.__arondightBuildingAt?.(p[0],p[1])):null};});
    // ram the nearest wall at speed: the car must stop at it, never end up inside the house
    report.wallRam=await page.evaluate(async()=>{const d=globalThis.__arondightVehicleDrive,b=globalThis.__arondightRealWorld;if(!d?.active)return{error:"not driving"};const p=d.pose.position,pr=b.buildingCollisionSnapshot?.prisms||[];let best=null,bd=1e9;for(const q of pr)for(const v of q.points){const dd=Math.hypot(v[0]-p[0],v[1]-p[1]);if(dd>8&&dd<bd){bd=dd;best=v;}}if(!best)return{error:"no wall"};const yaw=Math.atan2(best[1]-p[1],best[0]-p[0]);globalThis.__arondightWorldRigidBodies?.setPose?.(d.vehicleId||d.id||d.record?.id,{position:[p[0],p[1],p[2]+.2],yaw});return{target:best.map(v=>+v.toFixed(1)),dist:+bd.toFixed(1),yaw:+yaw.toFixed(2),id:d.vehicleId||d.id||null};});
    await page.keyboard.down("KeyW");await track("ram",6000);await page.keyboard.up("KeyW");await snap("wall-ram");
    report.wallRamAfter=await page.evaluate(()=>{const d=globalThis.__arondightVehicleDrive,p=d?.pose?.position;return p?{pos:p.map(v=>+v.toFixed(1)),speed:d.speedMps,inHouse:Boolean(globalThis.__arondightBuildingAt?.(p[0],p[1]))}:null;});
    await page.evaluate(()=>globalThis.__arondightVehicleDrive?.exit?.());await pause(2500);});
  for(let i=0;i<3;i++){report.scans.push({phase:"after-drive",...await scanVehicles()});await pause(2000);}
  await step("explode-cars",async()=>{report.exploded=await page.evaluate(()=>{const W=globalThis.__arondightWalkMode,list=(globalThis.__arondightProceduralPopulation?.diagVehicles?.()||[]).filter(v=>v.shown).sort((a,b)=>Math.hypot(a.pos[0]-W.position.x,a.pos[1]-W.position.y)-Math.hypot(b.pos[0]-W.position.x,b.pos[1]-W.position.y)).slice(0,4);for(const v of list)window.dispatchEvent(new CustomEvent("arondight:world-explosion",{detail:{position:[v.pos[0],v.pos[1],v.pos[2]+.6],radiusM:5,maxDamage:300,kind:"diag",id:`diag-car-${v.id}`,playerAction:true}}));return list.map(v=>v.id);});await pause(3000);await snap("after-explosions");});
  for(let i=0;i<10;i++){report.scans.push({phase:"after-explosions",...await scanVehicles()});await pause(2500);}
  await step("relocate",async()=>{await page.evaluate(()=>{const W=globalThis.__arondightWalkMode;globalThis.__diagHome={...W.position};W.setPose({x:W.position.x+450,y:W.position.y+120,yaw:0,pitch:0});});await pause(9000);report.scans.push({phase:"far",...await scanVehicles()});await page.evaluate(()=>{const h=globalThis.__diagHome,W=globalThis.__arondightWalkMode;W.setPose({x:h.x,y:h.y,yaw:0,pitch:0});});await pause(9000);});
  for(let i=0;i<4;i++){report.scans.push({phase:"back",...await scanVehicles()});await pause(2500);}
  await snap("back-home");
  report.coverageBack=await coverageProbe().catch(e=>({error:String(e)}));
  report.building=await buildingProbe().catch(e=>({error:String(e)}));
  await snap("after-building");
  report.terrainAfter=await terrainProbe().catch(e=>({error:String(e)}));
  report.summary={maxBad:Math.max(0,...report.scans.map(s=>s.badCount||0)),badPhases:report.scans.filter(s=>s.badCount).map(s=>s.phase)};
}finally{
  await writeFile(`${OUT}/report.json`,JSON.stringify(report,null,1));console.log(JSON.stringify(report,null,1).slice(0,12000));await browser.close();
}
