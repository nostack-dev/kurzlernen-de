import {deflateSync} from "node:zlib";

const OPENFREEMAP_STYLE="https://tiles.openfreemap.org/styles/liberty";
const VECTOR_HOST="tiles.openfreemap.org";
const DEM_HOST="tiles.mapterhorn.com";
const WORLD_IMAGERY_PREFIX="https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/";
const imageryTile=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=","base64");
const vectorTile=Buffer.from("1a0f0a086275696c64696e672880207802","hex");

function crc32(buffer){let crc=0xffffffff;for(const byte of buffer){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return(crc^0xffffffff)>>>0;}
function pngChunk(type,data){const typeBuffer=Buffer.from(type,"ascii"),length=Buffer.alloc(4),checksum=Buffer.alloc(4);length.writeUInt32BE(data.length);checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer,data])));return Buffer.concat([length,typeBuffer,data,checksum]);}
function solidRgbaPng(width,height,r,g,b,a=255){
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;
  const row=Buffer.alloc(1+width*4);row[0]=0;for(let x=0;x<width;x++){const i=1+x*4;row[i]=r;row[i+1]=g;row[i+2]=b;row[i+3]=a;}
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk("IHDR",ihdr),pngChunk("IDAT",deflateSync(Buffer.concat(Array.from({length:height},()=>row)))),pngChunk("IEND",Buffer.alloc(0))]);
}

// Terrarium RGB 128,0,0 = exactly 0 m MSL. Keep provider reachability in the
// separate live-terrain smoke; browser behavior tests should not depend on WAN.
const demTile=solidRgbaPng(512,512,128,0,0,255);

export async function installDeterministicWorldFixture(page,{base,styleName="Arondight45 deterministic WORLD fixture",latitude=39.569600,longitude=2.650200}={}){
  if(!base)throw new Error("deterministic WORLD fixture requires base URL");
  const fixtureStyle={version:8,name:styleName,sources:{"fixture-vector":{type:"vector",tiles:["https://tiles.openfreemap.org/ci/{z}/{x}/{y}.pbf"],minzoom:0,maxzoom:14}},layers:[{id:"background",type:"background",paint:{"background-color":"#243440"}}]};
  await page.browser().defaultBrowserContext().overridePermissions(base,["geolocation"]);
  await page.setGeolocation({latitude,longitude,accuracy:4});
  await page.setRequestInterception(true);
  page.on("request",request=>{
    const url=request.url(),parsed=new URL(url);
    if(["data:","blob:","about:"].includes(parsed.protocol)||["127.0.0.1","localhost"].includes(parsed.hostname)){request.continue();return;}
    if(url.startsWith(OPENFREEMAP_STYLE)){request.respond({status:200,contentType:"application/json",headers:{"access-control-allow-origin":"*","cache-control":"no-store"},body:JSON.stringify(fixtureStyle)});return;}
    if(parsed.hostname===VECTOR_HOST&&parsed.pathname.endsWith(".pbf")){request.respond({status:200,contentType:"application/x-protobuf",headers:{"access-control-allow-origin":"*","cache-control":"no-store"},body:vectorTile});return;}
    if(parsed.hostname===DEM_HOST){request.respond({status:200,contentType:"image/png",headers:{"access-control-allow-origin":"*","cache-control":"no-store"},body:demTile});return;}
    if(url.startsWith(WORLD_IMAGERY_PREFIX)){request.respond({status:200,contentType:"image/png",headers:{"access-control-allow-origin":"*","cache-control":"no-store"},body:imageryTile});return;}
    request.abort();
  });
}

async function worldStartupDiagnostics(page){
  return page.evaluate(()=>{const v=document.querySelector("#viewport"),b=globalThis.__arondightRealWorld;return{status:document.querySelector("#status")?.textContent||"",realWorldStatus:document.querySelector("#realWorldStatus")?.textContent||"",bodyClass:document.body.className,cameraMode:v?.dataset.cameraMode||"",autoWorldLocationSource:v?.dataset.autoWorldLocationSource||"",worldMode:v?.dataset.worldMode||"",worldProvider:v?.dataset.worldProvider||"",terrainStatus:v?.dataset.worldTerrainStatus||"",terrainTriangles:v?.dataset.worldTerrainTriangles||"",terrainSource:v?.dataset.worldTerrainSource||"",buildingStatus:v?.dataset.worldBuildingCollisionStatus||"",map:Boolean(b?.map),mapLoaded:Boolean(b?.map?.loaded?.()),active:Boolean(b?.active),loading:Boolean(b?.loading),terrainSnapshot:Boolean(b?.terrainSnapshot),renderer:Boolean(b?.threeRenderer),origin:[b?.originLon,b?.originLat],originElevation:b?.terrainOriginElevationM,worldFrames:Number(v?.dataset.worldThreeFrames||0),presentationDraws:Number(v?.dataset.presentationDraws||0),presentationCadence:v?.dataset.presentationCadence||"",presentationQuality:v?.dataset.presentationQualityMode||""};});
}

// A WORLD browser gate is allowed to exercise product behavior only after the
// asynchronous GPS -> DEM -> Box3D -> MapLibre/THREE activation has completed.
// Centralizing this predicate prevents individual tests from accepting an
// intermediate worldMode/terrain state whose map or renderer can still vanish.
export async function waitForCompletedWorldStartup(page,{timeout=45000,cameraMode=null,minWorldFrames=1,minPresentationDraws=10}={}){
  const expected={cameraMode,minWorldFrames,minPresentationDraws};
  try{
    await page.waitForFunction(({cameraMode,minWorldFrames,minPresentationDraws})=>{
      const v=document.querySelector("#viewport"),b=globalThis.__arondightRealWorld;
      return document.body.classList.contains("solo-flight")
        &&(!cameraMode||v?.dataset.cameraMode===cameraMode)
        &&v?.dataset.autoWorldLocationSource==="startup-gps"
        &&v?.dataset.worldMode==="real"
        &&v?.dataset.worldProvider==="openfreemap-esri-mapterhorn-dem"
        &&v?.dataset.worldTerrainStatus==="box3d-active"
        &&b?.active===true&&b?.loading===false
        &&Boolean(b?.map)&&Boolean(b?.terrainSnapshot)&&Boolean(b?.threeRenderer)
        &&Number(v?.dataset.worldThreeFrames||0)>=minWorldFrames
        &&Number(v?.dataset.presentationDraws||0)>=minPresentationDraws;
    },{timeout},expected);
  }catch(error){
    const diagnostics=await worldStartupDiagnostics(page);
    throw new Error(`WORLD completed-startup timeout: ${JSON.stringify({expected,diagnostics})}`,{cause:error});
  }
  return worldStartupDiagnostics(page);
}
