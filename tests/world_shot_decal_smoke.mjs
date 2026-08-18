import puppeteer from "puppeteer-core";
import {readFileSync} from "node:fs";
import {installDeterministicWorldFixture,waitForCompletedWorldStartup} from "./world_browser_fixture.mjs";

const base=process.argv[2]||"http://127.0.0.1:4174";
const executablePath=process.env.CHROME_BIN;
if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");

const bootstrap=readFileSync("sim/real_world_bootstrap.mjs","utf8");
const fireFx=readFileSync("sim/flight_fire_fx.mjs","utf8");
for(const marker of ["worldShotPoint","worldShotNormal","buildingCollisionSnapshot?.prisms","raycastTerrainSnapshot(this.terrainSnapshot","pointInRing","this.worldShotQueries++"])
  if(!bootstrap.includes(marker))throw new Error(`WORLD shot geometry contract missing: ${marker}`);
if(bootstrap.includes("arondight45-shot-impacts")||bootstrap.includes("refreshShotImpacts"))
  throw new Error("legacy MapLibre shot-impact layer returned; WORLD must use the shared THREE decal pool");
for(const marker of ["worldBridge?.addVisualShotImpact","if(worldHit)addThreeDecal(worldHit)","flightFireWorld=Boolean(hasWorldNormal)","DECAL_POOL_SIZE=32"])
  if(!fireFx.includes(marker))throw new Error(`shared WORLD decal-pool contract missing: ${marker}`);

const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader"]});
const page=await browser.newPage();
await installDeterministicWorldFixture(page,{base,styleName:"WORLD shot geometry fixture"});

try{
  await page.setViewport({width:844,height:390,deviceScaleFactor:1});
  await page.goto(`${base}/drone_simulator.html`,{waitUntil:"load",timeout:30000});
  await page.waitForFunction(()=>document.querySelector("#status")?.textContent.includes("SIM ready"),{timeout:30000});
  await waitForCompletedWorldStartup(page,{timeout:45000,cameraMode:"fpv"});

  const geometry=await page.evaluate(()=>{
    const b=globalThis.__arondightRealWorld,v=document.querySelector("#viewport"),rect=v.getBoundingClientRect();
    const originalSnapshot=b.buildingCollisionSnapshot;
    const ring=[[-5,-5],[5,-5],[5,5],[-5,5]];
    const snap=hit=>hit?{point:{x:hit.point.x,y:hit.point.y,z:hit.point.z},normal:{x:hit.worldNormal.x,y:hit.worldNormal.y,z:hit.worldNormal.z}}:null;
    try{
      b.buildingCollisionSnapshot={hash:"shot-fixture",footprintCount:1,prismCount:1,prisms:[{points:ring,base:0,top:10}]};
      const wall=snap(b.addVisualShotImpact(100,100,rect,{origin:{x:0,y:-12,z:5},direction:{x:0,y:1,z:0}}));
      const roof=snap(b.addVisualShotImpact(100,100,rect,{origin:{x:0,y:0,z:20},direction:{x:0,y:0,z:-1}}));
      b.buildingCollisionSnapshot={hash:"",footprintCount:0,prismCount:0,prisms:[]};
      const first=b.addVisualShotImpact(100,100,rect,{origin:{x:2,y:3,z:12},direction:{x:0,y:0,z:-1}}),firstRef=first;
      const ground=snap(first);
      const second=b.addVisualShotImpact(100,100,rect,{origin:{x:-1,y:4,z:7},direction:{x:0,y:0,z:-1}});
      return{wall,roof,ground,reusedHitObject:firstRef===second,queries:Number(v.dataset.worldShotQueries||0),terrain:v.dataset.worldTerrainStatus};
    }finally{b.buildingCollisionSnapshot=originalSnapshot;}
  });

  const near=(a,b,eps)=>Math.abs(a-b)<=eps;
  if(!geometry.wall||!near(geometry.wall.point.x,0,.03)||!near(geometry.wall.point.y,-5,.03)||!near(geometry.wall.point.z,5,.03)||geometry.wall.normal.y>-.98)
    throw new Error(`WORLD building-wall ray registration failed: ${JSON.stringify(geometry)}`);
  if(!geometry.roof||!near(geometry.roof.point.x,0,.03)||!near(geometry.roof.point.y,0,.03)||!near(geometry.roof.point.z,10,.03)||geometry.roof.normal.z<.98)
    throw new Error(`WORLD building-roof ray registration failed: ${JSON.stringify(geometry)}`);
  if(!geometry.ground||!near(geometry.ground.point.x,2,.01)||!near(geometry.ground.point.y,3,.01)||!near(geometry.ground.point.z,0,.01)||geometry.ground.normal.z<.98)
    throw new Error(`WORLD DEM-ground ray registration failed: ${JSON.stringify(geometry)}`);
  if(!geometry.reusedHitObject)throw new Error(`WORLD impact result allocates per hit instead of reusing the hit object: ${JSON.stringify(geometry)}`);
  if(geometry.queries<4)throw new Error(`WORLD physical shot queries were not exercised: ${JSON.stringify(geometry)}`);
  if(geometry.terrain!=="box3d-active")throw new Error(`WORLD shot test ran without DEM-backed physics: ${JSON.stringify(geometry)}`);

  console.log(`WORLD pooled decal geometry passed from mandatory DEM WORLD startup: wall/roof use synchronized building prisms, ground uses the shared DEM terrain snapshot, and hit storage is reused: ${JSON.stringify(geometry)}`);
}finally{await browser.close();}
