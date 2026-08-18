import puppeteer from "puppeteer-core";
import {readFileSync} from "node:fs";

const base=process.argv[2]||"http://127.0.0.1:4174";
const executablePath=process.env.CHROME_BIN;
if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");

const bootstrap=readFileSync("sim/real_world_bootstrap.mjs","utf8");
const fireFx=readFileSync("sim/flight_fire_fx.mjs","utf8");
for(const marker of ["worldShotPoint","worldShotNormal","buildingCollisionSnapshot?.prisms","raycastTerrainSnapshot(this.terrainSnapshot","pointInRing"])
  if(!bootstrap.includes(marker))throw new Error(`WORLD shot physical geometry contract missing: ${marker}`);
if(bootstrap.includes("arondight45-shot-impacts")||bootstrap.includes("refreshShotImpacts"))
  throw new Error("legacy MapLibre shot-impact layer returned; WORLD must use the shared THREE decal pool");
for(const marker of ["worldBridge?.addVisualShotImpact","if(worldHit)addThreeDecal(worldHit)","flightFireWorld=Boolean(hasWorldNormal)","DECAL_POOL_SIZE=32"])
  if(!fireFx.includes(marker))throw new Error(`shared WORLD decal-pool contract missing: ${marker}`);

const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader"]});
const page=await browser.newPage();
try{
  await page.setViewport({width:844,height:390,deviceScaleFactor:1});
  await page.goto(`${base}/drone_simulator.html`,{waitUntil:"load",timeout:30000});
  await page.waitForFunction(()=>document.querySelector("#status")?.textContent.includes("SIM ready"),{timeout:30000});

  const geometry=await page.evaluate(()=>{
    const b=globalThis.__arondightRealWorld,v=document.querySelector("#viewport"),rect=v.getBoundingClientRect();
    if(!b?.addVisualShotImpact)throw new Error("WORLD bridge shot API missing");
    const priorActive=b.active,priorBuildings=b.buildingCollisionSnapshot,priorTerrain=b.terrainSnapshot;
    const building=Object.freeze({buildingKey:"shot-fixture",base:0,top:10,points:Object.freeze([[-5,-5],[5,-5],[5,5],[-5,5]])});
    const size=3,half=20,step=20,positions=new Float32Array(size*size*3),elevations=new Float64Array(size*size),indices=new Uint32Array([0,1,4,0,4,3,1,2,5,1,5,4,3,4,7,3,7,6,4,5,8,4,8,7]);
    for(let row=0;row<size;row++)for(let col=0;col<size;col++){const index=row*size+col,offset=index*3;positions[offset]=-half+col*step;positions[offset+1]=-half+row*step;positions[offset+2]=0;elevations[index]=0;}
    const terrain=Object.freeze({hash:"shot-flat-dem",originElevationM:0,center:Object.freeze([0,0]),halfExtentM:half,gridSize:size,stepM:step,minZ:0,maxZ:0,positions,indices,elevations});
    const snap=hit=>hit?{point:{x:hit.point.x,y:hit.point.y,z:hit.point.z},normal:{x:hit.worldNormal.x,y:hit.worldNormal.y,z:hit.worldNormal.z}}:null;
    try{
      b.active=true;b.buildingCollisionSnapshot=Object.freeze({hash:"shot-buildings",footprintCount:1,prismCount:1,prisms:Object.freeze([building])});b.terrainSnapshot=terrain;
      const wall=snap(b.addVisualShotImpact(100,100,rect,{origin:{x:0,y:-12,z:5},direction:{x:0,y:1,z:0}}));
      const roof=snap(b.addVisualShotImpact(100,100,rect,{origin:{x:0,y:0,z:20},direction:{x:0,y:0,z:-1}}));
      b.buildingCollisionSnapshot=Object.freeze({hash:"shot-empty",footprintCount:0,prismCount:0,prisms:Object.freeze([])});
      const first=b.addVisualShotImpact(100,100,rect,{origin:{x:2,y:3,z:12},direction:{x:0,y:0,z:-1}}),firstRef=first;
      const ground=snap(first);
      const second=b.addVisualShotImpact(100,100,rect,{origin:{x:-1,y:4,z:7},direction:{x:0,y:0,z:-1}});
      return{wall,roof,ground,reusedHitObject:firstRef===second,queries:Number(v.dataset.worldShotQueries||0)};
    }finally{b.active=priorActive;b.buildingCollisionSnapshot=priorBuildings;b.terrainSnapshot=priorTerrain;}
  });

  const near=(a,b,eps)=>Math.abs(a-b)<=eps;
  if(!geometry.wall||!near(geometry.wall.point.x,0,.03)||!near(geometry.wall.point.y,-5,.03)||!near(geometry.wall.point.z,5,.03)||geometry.wall.normal.y>-.98)
    throw new Error(`WORLD building-wall ray registration failed: ${JSON.stringify(geometry)}`);
  if(!geometry.roof||!near(geometry.roof.point.x,0,.03)||!near(geometry.roof.point.y,0,.03)||!near(geometry.roof.point.z,10,.03)||geometry.roof.normal.z<.98)
    throw new Error(`WORLD building-roof ray registration failed: ${JSON.stringify(geometry)}`);
  if(!geometry.ground||!near(geometry.ground.point.x,2,.02)||!near(geometry.ground.point.y,3,.02)||!near(geometry.ground.point.z,0,.02)||geometry.ground.normal.z<.98)
    throw new Error(`WORLD DEM-ground ray registration failed: ${JSON.stringify(geometry)}`);
  if(!geometry.reusedHitObject)throw new Error(`WORLD impact result allocates per hit instead of reusing the hit object: ${JSON.stringify(geometry)}`);
  if(geometry.queries<4)throw new Error(`WORLD physical shot queries were not exercised: ${JSON.stringify(geometry)}`);

  console.log(`WORLD pooled decal geometry passed against physical collision snapshots: wall/roof prisms + DEM terrain in local ENU with reused hit storage: ${JSON.stringify(geometry)}`);
}finally{await browser.close();}
