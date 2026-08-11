import puppeteer from "puppeteer-core";
import {readFileSync} from "node:fs";

const base=process.argv[2]||"http://127.0.0.1:4174";
const executablePath=process.env.CHROME_BIN;
if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");

const source=readFileSync("sim/real_world_bootstrap.mjs","utf8");
for(const marker of ["WORLD_FPV_DIRECT_DEDUP_MS","presentationFrameSerial","lastFpvSyncFrameSerial","syncMapCamera(camera,frameSerial=null)","syncMapCamera(camera,this.presentationFrameSerial)","if(fpv){","frameSerial===this.lastFpvSyncFrameSerial","}else if(!forceMode&&now-this.lastMapSyncMs<this.mapFrameMs)return;"])
  if(!source.includes(marker))throw new Error(`FPV frame-lock/non-FPV budget source contract missing: ${marker}`);

const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader"]});
const page=await browser.newPage();
const OPENFREEMAP_STYLE="https://tiles.openfreemap.org/styles/liberty";
const fixtureStyle={version:8,name:"Arondight45 FPV frame-lock fixture",sources:{},layers:[{id:"background",type:"background",paint:{"background-color":"#243440"}}]};
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
  await page.waitForFunction(()=>document.body.classList.contains("solo-flight")&&document.querySelector("#viewport")?.dataset.cameraMode==="fpv",{timeout:5000});
  await page.waitForFunction(()=>{const v=document.querySelector("#viewport");return v?.dataset.worldMode==="real"&&v?.dataset.worldProvider==="openfreemap"&&globalThis.__arondightRealWorld?.map;},{timeout:20000});

  const result=await page.evaluate(async()=>{
    const b=globalThis.__arondightRealWorld,v=document.querySelector("#viewport"),camera=b.threeCamera.clone();
    const EARTH_RADIUS_M=6378137,latRad=b.originLat*Math.PI/180,cosLat=Math.max(.01,Math.cos(latRad)),DEG=180/Math.PI;
    const saved={renderReal:b.renderReal,mode:v.dataset.cameraMode,worldMode:v.dataset.worldCameraMode,last:b.lastMapSyncMs,lastView:b.lastMapView,serial:b.presentationFrameSerial,lastSerial:b.lastFpvSyncFrameSerial};
    b.renderReal=()=>{};
    v.dataset.cameraMode="fpv";v.dataset.worldCameraMode="fpv";
    camera.fov=b.threeCamera.fov;camera.aspect=b.threeCamera.aspect;camera.near=b.threeCamera.near;camera.far=b.threeCamera.far;camera.updateProjectionMatrix();
    const toMeters=(lon,lat)=>({east:(lon-b.originLon)*Math.PI/180*EARTH_RADIUS_M*cosLat,north:(lat-b.originLat)*Math.PI/180*EARTH_RADIUS_M});
    const toLngLat=(east,north)=>[b.originLon+(east/(EARTH_RADIUS_M*cosLat))*DEG,b.originLat+(north/EARTH_RADIUS_M)*DEG];
    const angular=(a,b)=>Math.abs((((a-b)+540)%360)-180);
    const percentile95=values=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.floor(sorted.length*.95)];};
    const run=async everyFrame=>{
      const eyeLag=[],pixelLag=[],bearingLag=[];const updates0=b.mapUpdates;let calls=0;
      b.lastMapSyncMs=-Infinity;b.lastMapView=null;b.lastFpvSyncFrameSerial=-1;
      for(let i=0;i<72;i++){
        await new Promise(requestAnimationFrame);
        const t=i/60;
        camera.position.set(-8+24*t,2+4*t,18+Math.sin(t*.8)*1.5);
        const aim=camera.position.clone();aim.x+=Math.sin(t*.55)*12;aim.y+=110;aim.z-=16;camera.up.set(0,0,1);camera.lookAt(aim);camera.updateMatrixWorld(true);
        const shouldSync=everyFrame||(i%2===0);
        if(shouldSync){b.syncMapCamera(camera,i+1);calls++;}
        const eye=(v.dataset.worldMapEye||"").split(",").map(Number),zoom=Number(v.dataset.worldMapZoom),bearing=Number(v.dataset.worldMapBearing);
        if(eye.length!==2||eye.some(x=>!Number.isFinite(x))||!Number.isFinite(zoom)||!Number.isFinite(bearing))throw new Error(`missing FPV map telemetry at frame ${i}`);
        const mapped=toMeters(eye[0],eye[1]),lag=Math.hypot(mapped.east-camera.position.x,mapped.north-camera.position.y),mpp=156543.03392804097*cosLat/(2**zoom);
        const dir=camera.position.clone().set(0,0,-1).applyQuaternion(camera.quaternion).normalize(),expectedBearing=Math.atan2(dir.x,dir.y)*180/Math.PI;
        eyeLag.push(lag);pixelLag.push(lag/Math.max(.0001,mpp));bearingLag.push(angular(bearing,expectedBearing));
      }
      return{calls,updates:b.mapUpdates-updates0,p95EyeM:percentile95(eyeLag),p95Pixel:percentile95(pixelLag),p95BearingDeg:percentile95(bearingLag)};
    };
    const screenRun=async everyFrame=>{
      const errors=[];const rect=v.getBoundingClientRect(),height=Math.max(1,rect.height),fov=Math.max(1,Math.min(179,camera.fov))*Math.PI/180,mpp20=156543.03392804097*cosLat/(2**20),distance=Math.max(2,mpp20*height/(2*Math.tan(fov/2)));
      b.lastMapSyncMs=-Infinity;b.lastMapView=null;b.lastFpvSyncFrameSerial=-1;
      for(let i=0;i<60;i++){
        await new Promise(requestAnimationFrame);
        const t=i/59,z=4.2+.35*Math.sin(t*Math.PI*2),yaw=-.42+.84*t,vz=-z/distance,horizontal=Math.sqrt(Math.max(0,1-vz*vz)),dx=Math.sin(yaw)*horizontal,dy=Math.cos(yaw)*horizontal;
        camera.position.set(-5+10*t,-3+6*t,z);const dir=camera.position.clone().set(dx,dy,vz),aim=camera.position.clone().addScaledVector(dir,10);camera.up.set(0,0,1);camera.lookAt(aim);camera.updateMatrixWorld(true);
        if(everyFrame||(i%2===0))b.syncMapCamera(camera,1000+i);
        const target=camera.position.clone().addScaledVector(dir,distance),samples=[[target.x,target.y],[target.x+2.5,target.y],[target.x-2.5,target.y],[target.x,target.y+2.5],[target.x,target.y-2.5]];
        for(const [east,north] of samples){
          const mapPoint=b.map.project(toLngLat(east,north)),ndc=camera.position.clone().set(east,north,0).project(camera),threeX=(ndc.x+1)*rect.width/2,threeY=(1-ndc.y)*rect.height/2;
          if(Number.isFinite(mapPoint.x)&&Number.isFinite(mapPoint.y)&&Number.isFinite(threeX)&&Number.isFinite(threeY))errors.push(Math.hypot(mapPoint.x-threeX,mapPoint.y-threeY));
        }
      }
      return{samples:errors.length,p95ScreenPx:percentile95(errors),maxScreenPx:Math.max(...errors)};
    };
    const locked=await run(true),halfRate=await run(false),screenLocked=await screenRun(true),screenHalfRate=await screenRun(false);
    b.renderReal=saved.renderReal;v.dataset.cameraMode=saved.mode;if(saved.worldMode===undefined)delete v.dataset.worldCameraMode;else v.dataset.worldCameraMode=saved.worldMode;b.lastMapSyncMs=saved.last;b.lastMapView=saved.lastView;b.presentationFrameSerial=saved.serial;b.lastFpvSyncFrameSerial=saved.lastSerial;
    return{locked,halfRate,screenLocked,screenHalfRate};
  });

  const {locked,halfRate,screenLocked,screenHalfRate}=result;
  if(locked.updates<68)throw new Error(`FPV is not frame-locked to presentation frames: ${JSON.stringify(result)}`);
  if(locked.p95EyeM>.08||locked.p95Pixel>.8||locked.p95BearingDeg>.08)throw new Error(`FPV camera registration exceeds sub-pixel/sub-decimeter budget: ${JSON.stringify(result)}`);
  if(!(halfRate.p95EyeM>locked.p95EyeM+.18&&halfRate.p95Pixel>locked.p95Pixel+1.2))throw new Error(`quantitative probe cannot distinguish frame-lock from half-rate jitter: ${JSON.stringify(result)}`);
  if(screenLocked.samples<250||screenLocked.p95ScreenPx>1)throw new Error(`FPV MapLibre/THREE screen-space registration exceeds 1px p95: ${JSON.stringify(result)}`);
  if(!(screenHalfRate.p95ScreenPx>screenLocked.p95ScreenPx+1))throw new Error(`screen-space probe cannot distinguish frame-lock from half-rate jitter: ${JSON.stringify(result)}`);
  console.log(`WORLD FPV frame-lock passed from automatic FPV/WORLD startup: ${JSON.stringify(result)}`);
}finally{await browser.close();}
