import puppeteer from "puppeteer-core";
import {readFileSync} from "node:fs";
import {deflateSync} from "node:zlib";

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

function crc32(buffer){let crc=0xffffffff;for(const byte of buffer){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return(crc^0xffffffff)>>>0;}
function pngChunk(type,data){const typeBuffer=Buffer.from(type,"ascii"),length=Buffer.alloc(4),checksum=Buffer.alloc(4);length.writeUInt32BE(data.length);checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer,data])));return Buffer.concat([length,typeBuffer,data,checksum]);}
function solidRgbaPng(width,height,r,g,b,a=255){
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;
  const row=Buffer.alloc(1+width*4);row[0]=0;for(let x=0;x<width;x++){const i=1+x*4;row[i]=r;row[i+1]=g;row[i+2]=b;row[i+3]=a;}
  const raw=Buffer.concat(Array.from({length:height},()=>row));
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk("IHDR",ihdr),pngChunk("IDAT",deflateSync(raw)),pngChunk("IEND",Buffer.alloc(0))]);
}

const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader"]});
const page=await browser.newPage();
const OPENFREEMAP_STYLE="https://tiles.openfreemap.org/styles/liberty";
const VECTOR_HOST="tiles.openfreemap.org";
const DEM_HOST="tiles.mapterhorn.com";
const WORLD_IMAGERY_PREFIX="https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/";
const imageryTile=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=","base64");
const vectorTile=Buffer.from("1a0f0a086275696c64696e672880207802","hex");
// Terrarium RGB 128,0,0 decodes to exactly 0 m MSL. A full 512 px tile
// exercises the production DEM decoder while keeping shot geometry deterministic.
const demTile=solidRgbaPng(512,512,128,0,0,255);
const fixtureStyle={version:8,name:"WORLD shot geometry fixture",sources:{"fixture-vector":{type:"vector",tiles:["https://tiles.openfreemap.org/ci/{z}/{x}/{y}.pbf"],minzoom:0,maxzoom:14}},layers:[{id:"background",type:"background",paint:{"background-color":"#243440"}}]};
await browser.defaultBrowserContext().overridePermissions(base,["geolocation"]);
await page.setGeolocation({latitude:39.569600,longitude:2.650200,accuracy:4});
await page.setRequestInterception(true);
page.on("request",request=>{
  const url=request.url(),parsed=new URL(url);
  if(["data:","blob:","about:"].includes(parsed.protocol)||["127.0.0.1","localhost"].includes(parsed.hostname)){request.continue();return;}
  if(url.startsWith(OPENFREEMAP_STYLE)){request.respond({status:200,contentType:"application/json",headers:{"access-control-allow-origin":"*","cache-control":"no-store"},body:JSON.stringify(fixtureStyle)});return;}
  if(parsed.hostname===VECTOR_HOST&&parsed.pathname.endsWith(".pbf")){request.respond({status:200,contentType:"application/x-protobuf",headers:{"access-control-allow-origin":"*","cache-control":"no-store"},body:vectorTile});return;}
  if(parsed.hostname===DEM_HOST){request.respond({status:200,contentType:"image/png",headers:{"access-control-allow-origin":"*","cache-control":"no-store"},body:demTile});return;}
  if(url.startsWith(WORLD_IMAGERY_PREFIX)){request.respond({status:200,contentType:"image/png",headers:{"access-control-allow-origin":"*","cache-control":"public,max-age=3600"},body:imageryTile});return;}
  request.abort();
});

try{
  await page.setViewport({width:844,height:390,deviceScaleFactor:1});
  await page.goto(`${base}/drone_simulator.html`,{waitUntil:"load",timeout:30000});
  await page.waitForFunction(()=>document.querySelector("#status")?.textContent.includes("SIM ready"),{timeout:30000});
  await page.waitForFunction(()=>{const v=document.querySelector("#viewport"),b=globalThis.__arondightRealWorld;return document.body.classList.contains("solo-flight")&&v?.dataset.cameraMode==="fpv"&&v?.dataset.autoWorldLocationSource==="startup-gps"&&v?.dataset.worldMode==="real"&&v?.dataset.worldTerrainStatus==="box3d-active"&&b?.active===true&&b?.loading===false&&b?.map&&b?.terrainSnapshot&&b?.threeRenderer&&Number(v.dataset.worldThreeFrames||0)>=1&&Number(v.dataset.presentationDraws||0)>=10;},{timeout:30000});

  const geometry=await page.evaluate(()=>{
    const b=globalThis.__arondightRealWorld,v=document.querySelector("#viewport"),rect=v.getBoundingClientRect();
    const originalSnapshot=b.buildingCollisionSnapshot;
    const ring=[[-5,-5],[5,-5],[5,5],[-5,5]];
    const snap=hit=>hit?{point:{x:hit.point.x,y:hit.point.y,z:hit.point.z},normal:{x:hit.worldNormal.x,y:hit.worldNormal.y,z:hit.worldNormal.z}}:null;
    try{
      // Shots consume the already-synchronized physical collision snapshot. They
      // must not re-query MapLibre geometry on every trigger event.
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
