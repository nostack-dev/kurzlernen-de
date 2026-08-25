import * as THREE from "three";

let installed=false,lastWrappedProvider=null,lastWrapper=null;
const anchor=new THREE.Vector3();
const FALLBACK_FLOOR_M=.03;

function viewport(){return document.getElementById("viewport");}
function bridge(){return globalThis.__arondightRealWorld||null;}
function cameraMode(){const drive=globalThis.__arondightVehicleDrive;if(drive?.active)return"vehicle";const walk=globalThis.__arondightWalkMode;if(walk?.mode==="foot")return"walk";return String(viewport()?.dataset?.cameraMode||"follow");}
function resolveAnchor(){
  const drive=globalThis.__arondightVehicleDrive;if(drive?.active&&drive.cameraAnchor){const a=drive.cameraAnchor;return anchor.set(Number(a.x)||0,Number(a.y)||0,Math.max(.02,Number(a.z)||0));}
  const walk=globalThis.__arondightWalkMode,p=walk?.position;if(walk?.mode==="foot"&&p)return anchor.set(Number(p.x)||0,Number(p.y)||0,Math.max(.02,(Number(p.z)||1.68)-.38));
  const b=bridge(),air=b?.threeScene?(b.airframeFor?.(b.threeScene)||b.airframe):b?.airframe;if(air?.position)return anchor.set(Number(air.position.x)||0,Number(air.position.y)||0,Math.max(.02,Number(air.position.z)||0));
  return null;
}
function clearLegacySpringTelemetry(view){
  if(!view)return;
  for(const key of["playerCameraSpringBody","playerCameraSpringWorld","playerCameraSpringMode","playerCameraSpringCompressionM","playerCameraSpringPhysics","playerCameraSpringBodies","playerCameraSpringResets","playerCameraSpringHalfExtentsM","playerCameraHardSafety","playerCameraSafetyRadiusM","playerCameraSafetyClearanceM","playerCameraHardLimited","playerCameraPhysicsReady","playerCameraResolverFallback"])delete view.dataset[key];
}
function constrain(args,result){
  const b=bridge(),camera=args?.camera,a=resolveAnchor();if(!camera?.position||!a)return result;
  const hasResolver=typeof b?.cameraCollisionResolver==="function"&&typeof b?.constrainCameraToPhysics==="function",collided=hasResolver?Boolean(b.constrainCameraToPhysics(a,camera)):false;
  if(!hasResolver&&camera.position.z<FALLBACK_FLOOR_M)camera.position.z=FALLBACK_FLOOR_M;
  camera.near=Math.max(.035,Math.min(.08,Number(camera.near)||.06));camera.updateProjectionMatrix?.();camera.updateMatrixWorld?.(true);
  const view=viewport();if(view){clearLegacySpringTelemetry(view);view.dataset.playerCameraCollisionGuard="geometric-swept-query-v4";view.dataset.playerCameraCollision=collided?"blocked":"clear";view.dataset.playerCameraCollisionMode=cameraMode();view.dataset.playerCameraPhysicsBody="none";view.dataset.playerCameraNoClipContract="single-authoritative-swept-volume-v2";view.dataset.playerCameraCollisionResolver=hasResolver?"native-drone-world-query":"fallback-floor-only";}
  return result;
}
function wrapCurrentProvider(){
  const b=bridge(),current=b?.presentationCameraProvider;if(!b||typeof b.attachPresentationCameraProvider!=="function"||!current)return false;
  if(current===lastWrapper||current.__geometricCameraCollisionGuard)return true;
  const base=current,wrapper={__collisionGuard:true,__geometricCameraCollisionGuard:true,isActive:()=>Boolean(base?.isActive?.()),apply:args=>constrain(args,base?.apply?.(args))};
  lastWrappedProvider=base;lastWrapper=wrapper;b.attachPresentationCameraProvider(wrapper);return true;
}
function frame(){wrapCurrentProvider();requestAnimationFrame(frame);}
export function installCameraCollisionGuard(){if(installed)return;installed=true;const view=viewport();if(view){clearLegacySpringTelemetry(view);view.dataset.playerCameraCollisionGuard="waiting-geometric-swept-query-v4";view.dataset.playerCameraPhysicsBody="none";view.dataset.playerCameraNoClipContract="single-authoritative-swept-volume-v2";}requestAnimationFrame(frame);}
installCameraCollisionGuard();
