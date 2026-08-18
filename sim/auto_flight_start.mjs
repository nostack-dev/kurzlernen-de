import {findClearBuildingLaunchPoint} from "./world_building_collision_physics.mjs";

const $=id=>document.getElementById(id);
const EARTH_RADIUS_M=6378137;

function requestStartupLocation(){
  if(!navigator.geolocation)return Promise.resolve({fix:null,error:Error("Geolocation is not available in this browser")});
  return new Promise(resolve=>navigator.geolocation.getCurrentPosition(
    fix=>resolve({fix,error:null}),
    error=>resolve({fix:null,error:Error(error.message||"Location permission failed")}),
    {enableHighAccuracy:true,timeout:20000,maximumAge:0},
  ));
}

// Surface the browser GPS permission immediately. Flight startup never waits for
// this promise, so denied GPS or an offline network cannot block local SIM.
// Release validation proves long-range NAV, realtime catch-up and visual cadence.
// This comment intentionally triggers the final exact-SHA Deploy + S31 gate.
const startupLocation=requestStartupLocation();

async function waitForBridge(timeoutMs=30000){
  const started=performance.now();
  while(performance.now()-started<timeoutMs){
    const bridge=globalThis.__arondightRealWorld,status=$("status")?.textContent||"";
    if(bridge&&$("camFpv")&&$("camSolo")&&status.includes("SIM ready"))return bridge;
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  throw Error("Simulator/WORLD bridge did not become ready");
}

const bridge=await waitForBridge();

function markWorldStartup(source){const viewport=$("viewport");if(viewport)viewport.dataset.autoWorldLocationSource=source;}

function syncWorldButton(){
  const button=$("soloWorld");
  if(!button||!bridge)return;
  button.dataset.active=bridge.active?"1":"0";
  button.dataset.loading=bridge.loading?"1":"0";
  button.textContent=bridge.loading?"WORLD…":bridge.active?"WORLD ✓":"WORLD";
}

function launchDefaultFlight(){
  // Reuse the exact existing UI paths so automatic startup cannot diverge from
  // a human selecting FPV and START SIM manually.
  $("camFpv")?.click();
  const cameraButton=$("soloCamera");if(cameraButton)cameraButton.textContent="FPV";
  $("camSolo")?.click();
  const viewport=$("viewport");if(viewport)viewport.dataset.autoFlightStart="fpv";
}

function discardFailedWorldMap(){
  try{bridge?.map?.remove?.();}catch{}
  bridge.map=null;bridge.geoContainer?.remove?.();bridge.geoContainer=null;
}

function trainingFallback(message){
  bridge.deactivate();
  discardFailedWorldMap();
  bridge.status(message,"warn");
  markWorldStartup("sim-fallback");
  syncWorldButton();
}

function offsetLngLat(originLon,originLat,eastM,northM){
  const latRad=originLat*Math.PI/180;
  return[
    originLon+(eastM/(EARTH_RADIUS_M*Math.max(.01,Math.cos(latRad))))*180/Math.PI,
    originLat+(northM/EARTH_RADIUS_M)*180/Math.PI,
  ];
}

async function snapWorldLaunchOutsideBuildings(timeoutMs=7000){
  const viewport=$("viewport");if(!bridge.active||bridge.vsWorldFromMate||bridge.vsSession||bridge.vsStarting)return false;
  const started=performance.now();
  while(bridge.active&&performance.now()-started<timeoutMs){
    const airframe=bridge.airframeFor?.(bridge.threeScene),position=airframe?.position;
    if(position&&(Math.hypot(Number(position.x)||0,Number(position.y)||0)>.35||(Number(position.z)||0)>.20)){
      if(viewport)viewport.dataset.worldLaunchSnap="skipped-airborne";return false;
    }
    bridge.syncBuildingCollisions?.(true);
    const snapshot=bridge.buildingCollisionSnapshot;
    if(snapshot?.prismCount>0){
      const safe=findClearBuildingLaunchPoint(snapshot,{point:[0,0],clearanceM:.75,maxSearchM:80}),east=Number(safe?.[0])||0,north=Number(safe?.[1])||0,offset=Math.hypot(east,north);
      if(offset<.01){if(viewport){viewport.dataset.worldLaunchSnap="clear";viewport.dataset.worldLaunchOffsetM="0.00";}return true;}
      const oldLon=Number(bridge.originLon),oldLat=Number(bridge.originLat);if(!Number.isFinite(oldLon)||!Number.isFinite(oldLat))return false;
      const[newLon,newLat]=offsetLngLat(oldLon,oldLat,east,north);
      bridge.originLon=newLon;bridge.originLat=newLat;bridge.lastMapSyncMs=-Infinity;bridge.lastMapView=null;bridge.lastMapSyncFrameSerial=-1;bridge.lastViewportSize="";bridge.buildingCollisionLastCenter=[Infinity,Infinity];
      bridge.clearBuildingCollisions?.();bridge.map?.jumpTo?.({center:[newLon,newLat]});bridge.buildingCollisionDirty=true;bridge.syncBuildingCollisions?.(true);
      if(viewport){viewport.dataset.worldLaunchSnap="safe";viewport.dataset.worldLaunchOffsetM=offset.toFixed(2);viewport.dataset.worldGpsLatitude=String(oldLat);viewport.dataset.worldGpsLongitude=String(oldLon);viewport.dataset.worldLatitude=String(newLat);viewport.dataset.worldLongitude=String(newLon);}
      bridge.status?.(`REAL WORLD LIVE · SAFE LAUNCH ${offset.toFixed(1)} m FROM GPS · outside building footprint`,"good");return true;
    }
    if(viewport?.dataset.worldBuildingCollisionStatus==="no-nearby-buildings"){viewport.dataset.worldLaunchSnap="clear";viewport.dataset.worldLaunchOffsetM="0.00";return true;}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  if(viewport)viewport.dataset.worldLaunchSnap="tiles-timeout";return false;
}

// WORLD may be activated automatically at startup or manually later. Wrap the
// existing bridge entry point once so every local-GPS activation gets the same
// launch rule: while still on the ground at local (0,0), move the geospatial
// origin to the nearest point with real building clearance. Physics remains at
// the exact local spawn pose; the map/collision frame is rebased around it.
const activateWorld=bridge.activate.bind(bridge);
bridge.activate=async(...args)=>{
  const sharedOrigin=Boolean(args[0]?.vsSharedOrigin),result=await activateWorld(...args);
  if(!sharedOrigin)await snapWorldLaunchOutsideBuildings();
  return result;
};

async function autoWorld(locationResultPromise){
  const {fix,error}=await locationResultPromise;
  if(fix)bridge.lastLocation=fix;
  if(error){trainingFallback(`TRAINING RANGE · GPS unavailable · ${error.message}`);return;}
  if(navigator.onLine===false){trainingFallback("TRAINING RANGE · offline · GPS permission ready");return;}
  try{
    // The permission prompt's high-accuracy fix is the WORLD origin. Do not ask
    // the platform for a second fix during startup; manual WORLD activation still
    // acquires a fresh position when no startup fix is supplied.
    const pending=bridge.activate(fix);syncWorldButton();await pending;markWorldStartup("startup-gps");syncWorldButton();
  }catch(error){trainingFallback(`TRAINING RANGE · WORLD unavailable · ${error?.message||error}`);}
}

launchDefaultFlight();
void autoWorld(startupLocation);
