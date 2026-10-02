import {PLAYER_CAPSULE_HEIGHT_M,PLAYER_CAPSULE_RADIUS_M,resolvePlayerCapsuleMove} from "./player_capsule_collision.mjs";

let patchedRuntime=null,lastBase=null;
function viewport(){return document.getElementById("viewport");}
function install(){
  const runtime=globalThis.__arondightPlayerVehicleRuntime;if(!runtime||typeof runtime.resolveWalkMove!=="function")return false;
  if(runtime.resolveWalkMove.__box3dPlayerCapsule===true)return true;
  const base=runtime.resolveWalkMove.bind(runtime);lastBase=base;
  const wrapped=function(from,to){
    const engine=globalThis.__arondightWorldRigidBodies?.engine||null,result=resolvePlayerCapsuleMove(engine,from,to);
    const v=viewport();if(result){if(v){v.dataset.walkCollision="box3d-capsule-mover-v1";v.dataset.walkCollisionShape="capsule";v.dataset.walkCollisionRadiusM=PLAYER_CAPSULE_RADIUS_M.toFixed(2);v.dataset.walkCollisionHeightM=PLAYER_CAPSULE_HEIGHT_M.toFixed(2);v.dataset.walkCollisionMask="terrain-walls-only";v.dataset.walkCollisionShots="pass-through";v.dataset.walkCollisionFraction=Number(result.fraction??1).toFixed(4);v.dataset.walkCollisionBlocked=result.blocked?"1":"0";}return{x:result.x,y:result.y};}
    if(v){v.dataset.walkCollision="legacy-fallback";v.dataset.walkCollisionShape="capsule-waiting-box3d";}return base(from,to);
  };
  wrapped.__box3dPlayerCapsule=true;wrapped.__box3dPlayerCapsuleBase=base;runtime.resolveWalkMove=wrapped;runtime.__box3dPlayerCapsule=true;patchedRuntime=runtime;
  const v=viewport();if(v){v.dataset.walkCollision="box3d-capsule-mover-v1";v.dataset.walkCollisionShape="capsule";v.dataset.walkCollisionMask="terrain-walls-only";v.dataset.walkCollisionShots="pass-through";}
  return true;
}
function frame(){const runtime=globalThis.__arondightPlayerVehicleRuntime;if(runtime&&runtime!==patchedRuntime)patchedRuntime=null;if(runtime&&runtime.resolveWalkMove?.__box3dPlayerCapsule!==true)install();requestAnimationFrame(frame);}
export function installPlayerBox3dCapsuleRuntime(){install();requestAnimationFrame(frame);return true;}
installPlayerBox3dCapsuleRuntime();
