import puppeteer from "puppeteer-core";
import {readFileSync} from "node:fs";

const base=process.argv[2]||"http://127.0.0.1:4174";
const executablePath=process.env.CHROME_BIN;
if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");

const bootstrap=readFileSync("sim/real_world_bootstrap.mjs","utf8");
const fireFx=readFileSync("sim/flight_fire_fx.mjs","utf8");
for(const marker of ["worldShotPoint","worldShotNormal","queryRenderedFeatures([qx,qy]","pointInRing","groundT=-o.z/d.z"])
  if(!bootstrap.includes(marker))throw new Error(`WORLD shot geometry contract missing: ${marker}`);
if(bootstrap.includes("arondight45-shot-impacts")||bootstrap.includes("refreshShotImpacts"))
  throw new Error("legacy MapLibre shot-impact layer returned; WORLD must use the shared THREE decal pool");
for(const marker of ["worldBridge?.addVisualShotImpact","if(worldHit)addThreeDecal(worldHit)","flightFireWorld=Boolean(hasWorldNormal)","DECAL_POOL_SIZE=32"])
  if(!fireFx.includes(marker))throw new Error(`shared WORLD decal-pool contract missing: ${marker}`);

const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader"]});
const page=await browser.newPage();
const OPENFREEMAP_STYLE="https://tiles.openfreemap.org/styles/liberty";
const fixtureStyle={version:8,name:"WORLD shot geometry fixture",sources:{},layers:[{id:"background",type:"background",paint:{"background-color":"#243440"}}]};
await browser.defaultBrowserContext().overridePermissions(base,["geolocation"]);
await page.setGeolocation({latitude:39.569600,longitude:2.650200,accuracy:4});
await page.setRequestInterception(true);
page.on("request",request=>{
  const url=request.url(),parsed=new URL(url);
  if(["data:","blob:","about:"].includes(parsed.protocol)||["127.0.0.1","localhost"].includes(parsed.hostname)){request.continue();return;}
  if(url.startsWith(OPENFREEMAP_STYLE)){request.respond({status:200,contentType:"application/json",headers:{"access-control-allow-origin":"*","cache-control":"no-store"},body:JSON.stringify(fixtureStyle)});return;}
  request.abort();
});

try{
  await page.setViewport({width:844,height:390,deviceScaleFactor:1});
  await page.goto(`${base}/drone_simulator.html`,{waitUntil:"load",timeout:30000});
  await page.waitForFunction(()=>document.querySelector("#status")?.textContent.includes("SIM ready"),{timeout:30000});
  await page.click("#camSolo");
  await page.waitForFunction(()=>document.body.classList.contains("solo-flight"),{timeout:5000});
  await page.click("#soloWorld");
  await page.waitForFunction(()=>{const v=document.querySelector("#viewport");return v?.dataset.worldMode==="real"&&globalThis.__arondightRealWorld?.map;},{timeout:20000});

  const geometry=await page.evaluate(()=>{
    const b=globalThis.__arondightRealWorld,v=document.querySelector("#viewport"),rect=v.getBoundingClientRect(),map=b.map;
    const originalGetLayer=map.getLayer.bind(map),originalQuery=map.queryRenderedFeatures.bind(map);
    const R=6378137,cosLat=Math.max(.01,Math.cos(b.originLat*Math.PI/180));
    const ll=(east,north)=>[
      b.originLon+(east/(R*cosLat))*180/Math.PI,
      b.originLat+(north/R)*180/Math.PI,
    ];
    const ring=[ll(-5,-5),ll(5,-5),ll(5,5),ll(-5,5),ll(-5,-5)];
    const building={properties:{render_height:10,render_min_height:0},geometry:{type:"Polygon",coordinates:[ring]}};
    const snap=hit=>hit?{point:{x:hit.point.x,y:hit.point.y,z:hit.point.z},normal:{x:hit.worldNormal.x,y:hit.worldNormal.y,z:hit.worldNormal.z}}:null;
    try{
      map.getLayer=id=>id==="arondight45-buildings-3d"?{id}:originalGetLayer(id);
      map.queryRenderedFeatures=()=>[building];
      const wall=snap(b.addVisualShotImpact(100,100,rect,{origin:{x:0,y:-12,z:5},direction:{x:0,y:1,z:0}}));
      const roof=snap(b.addVisualShotImpact(100,100,rect,{origin:{x:0,y:0,z:20},direction:{x:0,y:0,z:-1}}));
      map.getLayer=id=>id==="arondight45-buildings-3d"?null:originalGetLayer(id);
      map.queryRenderedFeatures=()=>[];
      const first=b.addVisualShotImpact(100,100,rect,{origin:{x:2,y:3,z:12},direction:{x:0,y:0,z:-1}}),firstRef=first;
      const ground=snap(first);
      const second=b.addVisualShotImpact(100,100,rect,{origin:{x:-1,y:4,z:7},direction:{x:0,y:0,z:-1}});
      return{wall,roof,ground,reusedHitObject:firstRef===second,queries:Number(v.dataset.worldShotQueries||0)};
    }finally{
      map.getLayer=originalGetLayer;
      map.queryRenderedFeatures=originalQuery;
    }
  });

  const near=(a,b,eps)=>Math.abs(a-b)<=eps;
  if(!geometry.wall||!near(geometry.wall.point.x,0,.03)||!near(geometry.wall.point.y,-5,.03)||!near(geometry.wall.point.z,5,.03)||geometry.wall.normal.y>-.98)
    throw new Error(`WORLD building-wall ray registration failed: ${JSON.stringify(geometry)}`);
  if(!geometry.roof||!near(geometry.roof.point.x,0,.03)||!near(geometry.roof.point.y,0,.03)||!near(geometry.roof.point.z,10,.03)||geometry.roof.normal.z<.98)
    throw new Error(`WORLD building-roof ray registration failed: ${JSON.stringify(geometry)}`);
  if(!geometry.ground||!near(geometry.ground.point.x,2,.01)||!near(geometry.ground.point.y,3,.01)||!near(geometry.ground.point.z,0,.01)||geometry.ground.normal.z<.98)
    throw new Error(`WORLD ground ray registration failed: ${JSON.stringify(geometry)}`);
  if(!geometry.reusedHitObject)throw new Error(`WORLD impact result allocates per hit instead of reusing the hit object: ${JSON.stringify(geometry)}`);
  if(geometry.queries<2)throw new Error(`WORLD building-hit queries were not exercised: ${JSON.stringify(geometry)}`);

  console.log(`WORLD pooled decal geometry passed: wall/roof/ground ray hits registered in local ENU with reused hit storage: ${JSON.stringify(geometry)}`);
}finally{await browser.close();}
