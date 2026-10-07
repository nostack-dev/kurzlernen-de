import {PLAYER_CAPSULE_HEIGHT_M,PLAYER_CAPSULE_RADIUS_M,resolvePlayerCapsuleMove} from "./player_capsule_collision.mjs";

let patchedRuntime=null,lastBase=null,lastTelemetryAt=-Infinity,lastPublishedRuntime=null,maintenanceTimer=0;
function viewport(){return document.getElementById("viewport");}
function publishContract(v,force=false){if(!v||!force&&lastPublishedRuntime===patchedRuntime)return;lastPublishedRuntime=patchedRuntime;v.dataset.walkCollision="box3d-capsule-mover-v2";v.dataset.walkCollisionShape="capsule";v.dataset.walkCollisionMask="terrain-walls-only";v.dataset.walkCollisionShots="pass-through";v.dataset.walkCollisionMoverApi="b3World_CastMover";v.dataset.walkCollisionRadiusM=PLAYER_CAPSULE_RADIUS_M.toFixed(2);v.dataset.walkCollisionHeightM=PLAYER_CAPSULE_HEIGHT_M.toFixed(2);v.dataset.walkCollisionTelemetry="250ms";}
function install(){
  const runtime=globalThis.__arondightPlayerVehicleRuntime;if(!runtime||typeof runtime.resolveWalkMove!=="function")return false;
  if(runtime.resolveWalkMove.__box3dPlayerCapsule===true){publishContract(viewport());return true;}
  const base=runtime.resolveWalkMove.bind(runtime);lastBase=base;
  const wrapped=function(from,to){
    const engine=globalThis.__arondightWorldRigidBodies?.engine||null,result=resolvePlayerCapsuleMove(engine,from,to);
    const v=viewport();if(result){const now=performance.now();if(v&&now-lastTelemetryAt>=250){lastTelemetryAt=now;publishContract(v);v.dataset.walkCollisionFraction=Number(result.fraction??1).toFixed(4);v.dataset.walkCollisionBlocked=result.blocked?"1":"0";}return{x:result.x,y:result.y};}
    if(v&&performance.now()-lastTelemetryAt>=250){lastTelemetryAt=performance.now();v.dataset.walkCollision="legacy-fallback";v.dataset.walkCollisionShape="capsule-waiting-box3d";}return base(from,to);
  };
  wrapped.__box3dPlayerCapsule=true;wrapped.__box3dPlayerCapsuleBase=base;runtime.resolveWalkMove=wrapped;runtime.__box3dPlayerCapsule=true;patchedRuntime=runtime;
  publishContract(viewport(),true);
  return true;
}
function maintenance(){const runtime=globalThis.__arondightPlayerVehicleRuntime;if(runtime&&runtime!==patchedRuntime)patchedRuntime=null;if(runtime&&runtime.resolveWalkMove?.__box3dPlayerCapsule!==true)install();maintenanceTimer=setTimeout(maintenance,250);}
export function installPlayerBox3dCapsuleRuntime(){install();clearTimeout(maintenanceTimer);maintenanceTimer=setTimeout(maintenance,250);return true;}
installPlayerBox3dCapsuleRuntime();
