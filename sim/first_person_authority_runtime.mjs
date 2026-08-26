const EYE_Z=1.68;
const HUMAN_RADIUS=.28;
const POSE_MOVING_MS=66;
const POSE_IDLE_MS=250;
const SPAWN_RECHECK_MS=120;
const SPAWN_RECHECK_WINDOW_MS=2400;
const MAX_SPAWN_RADIUS_M=12;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number(v)||0));

let installed=false,lastPoseAt=-Infinity,lastSpawnCheck=-Infinity,spawnCheckUntil=-Infinity,lastCollisionHash="",txSequence=0,lastLocalSample=null;

function viewport(){return document.getElementById("viewport");}
function bridge(){return globalThis.__arondightRealWorld||null;}
function walk(){return globalThis.__arondightWalkMode||null;}
function drive(){return globalThis.__arondightVehicleDrive||null;}
function playerRuntime(){return globalThis.__arondightPlayerVehicleRuntime||null;}
function session(){return bridge()?.vsSession||null;}
function activeFoot(){return walk()?.mode==="foot"&&!drive()?.active;}
function pointInPolygon(x,y,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j],cross=(a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/((b[1]-a[1])||1e-12)+a[0];if(cross)inside=!inside;}return inside;}
function pointSegmentDistance(x,y,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],l=dx*dx+dy*dy;if(l<1e-10)return Math.hypot(x-a[0],y-a[1]);const t=clamp(((x-a[0])*dx+(y-a[1])*dy)/l,0,1),qx=a[0]+dx*t,qy=a[1]+dy*t;return Math.hypot(x-qx,y-qy);}
function fallbackBuildingBlocked(x,y){const prisms=bridge()?.buildingCollisionSnapshot?.prisms||[];for(const prism of prisms){const ring=prism?.points;if(!Array.isArray(ring)||ring.length<3)continue;if(pointInPolygon(x,y,ring))return true;for(let i=0;i<ring.length;i++)if(pointSegmentDistance(x,y,ring[i],ring[(i+1)%ring.length])<HUMAN_RADIUS)return true;}return false;}
function canOccupy(x,y){const runtime=playerRuntime();if(typeof runtime?.canOccupyWalkPoint==="function")return Boolean(runtime.canOccupyWalkPoint(x,y));return!fallbackBuildingBlocked(x,y);}
function nearestClearPoint(x,y,yaw=0){
  x=Number(x)||0;y=Number(y)||0;if(canOccupy(x,y))return{x,y,moved:false,distance:0};
  const angularStep=Math.PI/12;
  for(let radius=.35;radius<=MAX_SPAWN_RADIUS_M+1e-6;radius+=.35){
    const samples=Math.max(24,Math.ceil(Math.PI*2*radius/.34));
    for(let i=0;i<samples;i++){
      const phase=i===0?0:(i&1?Math.ceil(i/2):-Math.ceil(i/2))*angularStep,angle=yaw+phase+(Math.floor(i/25)*Math.PI*2/samples),px=x+Math.sin(angle)*radius,py=y+Math.cos(angle)*radius;
      if(canOccupy(px,py))return{x:px,y:py,moved:true,distance:radius};
    }
  }
  return{x,y,moved:false,distance:0,unresolved:true};
}
function ensureClearSpawn(reason="runtime",now=performance.now()){
  if(!activeFoot()||now-lastSpawnCheck<SPAWN_RECHECK_MS)return false;lastSpawnCheck=now;const w=walk(),p=w?.position;if(!p)return false;
  const resolved=nearestClearPoint(p.x,p.y,Number(w.yaw)||0),v=viewport();
  if(resolved.moved){w.setPose?.({x:resolved.x,y:resolved.y,yaw:Number(w.yaw)||0,pitch:Number(w.pitch)||0});lastLocalSample=null;if(v){v.dataset.walkSpawnResolution="nearest-free-collision-authority-v1";v.dataset.walkSpawnResolutionReason=reason;v.dataset.walkSpawnRelocatedM=resolved.distance.toFixed(2);v.dataset.walkSpawnBlocked="0";}return true;}
  if(v){v.dataset.walkSpawnResolution="nearest-free-collision-authority-v1";v.dataset.walkSpawnResolutionReason=reason;v.dataset.walkSpawnBlocked=resolved.unresolved?"1":"0";if(!resolved.unresolved)v.dataset.walkSpawnRelocatedM="0.00";}
  return false;
}
function localOffset(){const b=bridge(),o=b?.__vsRespawnLocalOffset;return !b?.active&&Array.isArray(o)&&o.length===2?[Number(o[0])||0,Number(o[1])||0]:[0,0];}
function localToCanonical(p){const o=localOffset();return[(Number(p?.[0])||0)+o[0],(Number(p?.[1])||0)+o[1],Number(p?.[2])||0];}
function metersToLngLat(originLon,originLat,east,north){const earth=6378137,latRad=originLat*Math.PI/180;return[originLon+east/(earth*Math.max(.01,Math.cos(latRad)))*180/Math.PI,originLat+north/earth*180/Math.PI];}
function yawQuaternion(yaw){const half=-(Number(yaw)||0)/2;return[0,0,Math.sin(half),Math.cos(half)];}
function weaponMode(){return String(globalThis.__arondightFootWeapons?.mode||viewport()?.dataset.walkWeapon||"pistol")==="smg"?"smg":"pistol";}
function playerDead(){const model=globalThis.__arondightPlayerDamageModel,w=walk();return Boolean(w?.dead||model?.dead||Number(model?.hp)<=0);}
function authoritativeVelocity(position,now){let velocity=[0,0,0];if(lastLocalSample){const dt=(now-lastLocalSample.at)/1000;if(dt>.001&&dt<.5)velocity=[(position[0]-lastLocalSample.p[0])/dt,(position[1]-lastLocalSample.p[1])/dt,0];}lastLocalSample={p:[...position],at:now};return velocity;}
function pendingMatchesFoot(pending,p,yaw){if(!pending||pending.pm!=="foot"||!Array.isArray(pending.p))return false;const d=Math.hypot((Number(pending.p[0])||0)-p[0],(Number(pending.p[1])||0)-p[1]),phYaw=Number(pending.ph?.yaw);return d<.025&&(!Number.isFinite(phYaw)||Math.abs(Math.atan2(Math.sin(phYaw-yaw),Math.cos(phYaw-yaw)))<.012);}
function replicateFoot(now=performance.now()){
  if(!activeFoot())return false;const s=session(),w=walk(),p=w?.position;if(!s?.setPose||!p)return false;
  const local=[Number(p.x)||0,Number(p.y)||0,0],canonical=localToCanonical(local),yaw=Number(w.yaw)||0,pitch=Number(w.pitch)||0,pending=s.pendingPose||null,movingSample=lastLocalSample?Math.hypot(canonical[0]-lastLocalSample.p[0],canonical[1]-lastLocalSample.p[1])>.01:false,interval=movingSample?POSE_MOVING_MS:POSE_IDLE_MS;
  if(now-lastPoseAt<interval&&pendingMatchesFoot(pending,canonical,yaw))return false;
  const velocity=authoritativeVelocity(canonical,now),speed=Math.hypot(velocity[0],velocity[1]),seq=++txSequence,next={...(pending||{}),p:canonical,q:yawQuaternion(yaw),v:velocity,pm:"foot",ps:seq,ph:{yaw,pitch,weapon:weaponMode(),dead:playerDead(),speed:+speed.toFixed(3),moving:speed>.12?1:0,aiming:viewport()?.dataset.walkScreenAimActive==="1"?1:0,seq}};
  const b=bridge();if(b?.active&&Number.isFinite(b.originLon)&&Number.isFinite(b.originLat))next.g=metersToLngLat(b.originLon,b.originLat,local[0],local[1]);
  const sent=Boolean(s.setPose(next));if(sent){lastPoseAt=now;const v=viewport();if(v){v.dataset.vsFootPoseAuthority="walk-position-heartbeat-v1";v.dataset.vsFootPoseTx=String((Number(v.dataset.vsFootPoseTx)||0)+1);v.dataset.vsFootPosePosition=`${local[0].toFixed(3)},${local[1].toFixed(3)}`;v.dataset.vsFootPoseMoving=speed>.12?"1":"0";}}return sent;
}
function armSpawnCheck(reason="mode-change"){
  spawnCheckUntil=performance.now()+SPAWN_RECHECK_WINDOW_MS;lastSpawnCheck=-Infinity;const v=viewport();if(v)v.dataset.walkSpawnCheckArmed=reason;requestAnimationFrame(()=>ensureClearSpawn(reason));
}
function frame(now=performance.now()){
  const hash=String(bridge()?.buildingCollisionSnapshot?.hash||"");if(hash!==lastCollisionHash){lastCollisionHash=hash;if(activeFoot())armSpawnCheck("collision-snapshot-change");}
  if(activeFoot()&&now<=spawnCheckUntil)ensureClearSpawn("entry-window",now);replicateFoot(now);requestAnimationFrame(frame);
}
export function installFirstPersonAuthorityRuntime(){
  if(installed)return;installed=true;addEventListener("arondight:player-mode",event=>{if(event?.detail?.mode==="foot"||walk()?.mode==="foot")armSpawnCheck("player-mode-foot");else lastLocalSample=null;});
  const v=viewport();if(v){v.dataset.walkSpawnResolution="nearest-free-collision-authority-v1";v.dataset.vsFootPoseAuthority="walk-position-heartbeat-v1";}
  if(activeFoot())armSpawnCheck("install-foot");requestAnimationFrame(frame);
  globalThis.__arondightFirstPersonAuthority=Object.freeze({nearestClearPoint,ensureClearSpawn,replicateFoot});
}
installFirstPersonAuthorityRuntime();
