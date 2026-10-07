import * as THREE from "three";
import {Box3dHitscanWorld} from "./box3d_hitscan.mjs";

// First-person aim controller (replaces weapon_runtime_v3's 900 ms "align
// after shot" and anchor_v4's separate grip re-alignment, which fought each
// other and both aimed with a *reconstructed* camera).
//
// 1. Exact screen ray: every touch/click ray is cast through a snapshot of the
//    camera exactly as it was presented on screen (head bob, smoothing, roll,
//    FOV and collision push included). Previously the ray came from
//    state.position/yaw/pitch, so shots landed off the touch point.
// 2. Weapon stays anchored at the grip in the lower right corner, but always
//    rotates about the grip so the sight line (rear sight → front sight)
//    points at the aim point: at rest that is the crosshair, while a finger
//    is down it is the touch point and it follows the drag live. On a shot
//    the gun snaps to the new target *before* the tracer is spawned, so the
//    tracer leaves the muzzle along the sights straight into the hit point.

export const FIRST_PERSON_CONTROLLER_VERSION="presented-camera-ray+grip-anchored-sight-aim-v5";
const KICK_MS=130,KICK_RAD=.075,KICK_BACK_M=.035,REST_DISTANCE_M=30,MAX_RAY_M=180,TARGET_SMOOTH_HZ=22,RELEASE_HOLD_MS=420,REST_RESOLVE_MS=160;

const presented=new THREE.PerspectiveCamera();let presentedValid=false;
const raycaster=new THREE.Raycaster(),ndc=new THREE.Vector2(),boxHits=new Box3dHitscanWorld();
const aimPoint=new THREE.Vector3(),desiredPoint=new THREE.Vector3(),restPoint=new THREE.Vector3(),tmpA=new THREE.Vector3(),tmpB=new THREE.Vector3(),axis=new THREE.Vector3(),want=new THREE.Vector3(),gripBefore=new THREE.Vector3(),gripAfter=new THREE.Vector3(),q=new THREE.Quaternion();
let lastKickAt=-Infinity,installed=false,aimPointValid=false,pointer=null,pointerDepth=REST_DISTANCE_M,releasedAt=-Infinity,lastFrameMs=performance.now(),lastRestResolve=-Infinity,restDepth=REST_DISTANCE_M;

const viewport=()=>document.getElementById("viewport");
const bridge=()=>globalThis.__arondightRealWorld||null;
const walk=()=>globalThis.__arondightWalkMode||null;
const drive=()=>globalThis.__arondightVehicleDrive||null;
const footWeapons=()=>globalThis.__arondightFootWeapons||null;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number(v)||0));
function isFoot(){return walk()?.mode==="foot"&&!drive()?.active&&!walk()?.dead;}
function setData(key,value){const v=viewport();if(!v)return;const s=String(value);if(v.dataset[key]!==s)v.dataset[key]=s;}

// Called right before the frame is rendered with the final camera pose.
export function snapshotPresentedCamera(camera){
  if(!camera?.isPerspectiveCamera)return;camera.updateMatrixWorld?.(true);
  presented.copy(camera,false);presented.matrixWorld.copy(camera.matrixWorld);presented.matrixWorldInverse.copy(camera.matrixWorldInverse);presented.projectionMatrix.copy(camera.projectionMatrix);presented.projectionMatrixInverse.copy(camera.projectionMatrixInverse);presentedValid=true;
}
function logicalPoint(clientX,clientY){
  const view=viewport(),screen=view?.getBoundingClientRect();if(!view||!screen)return null;
  const width=Math.max(1,view.clientWidth),height=Math.max(1,view.clientHeight),cx=Number.isFinite(clientX)?clientX:screen.left+screen.width/2,cy=Number.isFinite(clientY)?clientY:screen.top+screen.height/2,rotated=view.dataset.soloOrientation==="css-landscape";
  const x=rotated?cy-screen.top:cx-screen.left,y=rotated?screen.right-cx:cy-screen.top;return{x:clamp(x,0,width),y:clamp(y,0,height),width,height};
}
// Ray through a screen point using exactly what the player saw last frame.
export function screenRay(clientX,clientY){
  if(!presentedValid)return null;const p=logicalPoint(clientX,clientY);if(!p)return null;
  ndc.set(p.x/p.width*2-1,1-p.y/p.height*2);raycaster.setFromCamera(ndc,presented);
  return{origin:raycaster.ray.origin.clone(),direction:raycaster.ray.direction.clone().normalize(),point:p};
}
function effectiveVisible(node){for(let n=node;n;n=n.parent)if(n.visible===false)return false;return true;}
function sceneCandidates(scene){const list=[];scene?.traverse?.(node=>{if(!node?.isMesh||!effectiveVisible(node)||node.material?.visible===false)return;const u=node.userData||{};if(u.flightFireIgnore||u.walkWeaponPart||u.arondightAirframe||u.localHumanAvatar||u.worldPopulationClone||u.neonEdge)return;list.push(node);});return list;}
function staticDistance(ray,max){const b=bridge();let best=max;try{if(b?.active){const hit=boxHits.cast([ray.origin.x,ray.origin.y,ray.origin.z],[ray.direction.x,ray.direction.y,ray.direction.z],max,b.buildingCollisionSnapshot);if(hit)best=Math.min(best,hit.distanceM);}}catch{}if(ray.direction.z<-1e-4){const t=(0-ray.origin.z)/ray.direction.z;if(t>.2)best=Math.min(best,t);}return best;}
function resolveDistance(ray,{full=false}={}){let distance=staticDistance(ray,MAX_RAY_M);if(full){const scene=bridge()?.threeScene;if(scene){raycaster.set(ray.origin,ray.direction);raycaster.near=.05;raycaster.far=distance;const hit=raycaster.intersectObjects(sceneCandidates(scene),false)[0];if(hit)distance=Math.min(distance,hit.distance);}}return clamp(distance,1.2,MAX_RAY_M);}

function gunParts(gun){
  const mode=String(footWeapons()?.mode||"pistol"),smg=mode==="smg",grenade=mode==="grenade";
  const grip=gun.getObjectByName(grenade?"WALK_GL_GRIP":smg?"WALK_SMG_PISTOL_GRIP":"WALK_VM_GRIP")||gun.getObjectByName("WALK_VM_GRIP");
  const rear=gun.getObjectByName(grenade?"WALK_GL_REAR_SIGHT":smg?"WALK_SMG_REAR_SIGHT":"WALK_VM_REAR_SIGHT");
  const front=gun.getObjectByName(grenade?"WALK_GL_FRONT_SIGHT":smg?"WALK_SMG_FRONT_SIGHT":"WALK_VM_FRONT_SIGHT")||gun.getObjectByName(grenade?"WALK_GRENADE_MUZZLE_NODE":smg?"WALK_SMG_MUZZLE_NODE":"WALK_VM_MUZZLE");
  return{grip,rear,front,smg,grenade};
}
// Rotate the gun about its grip so the sight line passes through `target`.
// Two passes converge to well under 0.1°; the grip never moves.
function alignSights(gun,target){
  const{grip,rear,front}=gunParts(gun);if(!grip||!rear||!front)return null;
  gun.updateWorldMatrix(true,true);grip.getWorldPosition(gripBefore);
  for(let pass=0;pass<2;pass++){
    rear.getWorldPosition(tmpA);front.getWorldPosition(tmpB);axis.copy(tmpB).sub(tmpA);want.copy(target).sub(tmpA);
    if(axis.lengthSq()<1e-8||want.lengthSq()<1e-6)return null;q.setFromUnitVectors(axis.normalize(),want.normalize());
    gun.quaternion.premultiply(q);gun.updateWorldMatrix(true,true);grip.getWorldPosition(gripAfter);gun.position.add(tmpA.copy(gripBefore).sub(gripAfter));gun.updateWorldMatrix(true,true);
  }
  rear.getWorldPosition(tmpA);front.getWorldPosition(tmpB);grip.getWorldPosition(gripAfter);
  return{errorDeg:tmpB.sub(tmpA).angleTo(want.copy(target).sub(tmpA))*180/Math.PI,driftM:gripAfter.distanceTo(gripBefore)};
}
function centerRay(){const view=viewport(),r=view?.getBoundingClientRect();return r?screenRay(r.left+r.width/2,r.top+r.height/2):null;}

// Pre-render hook: the walk camera provider has just placed the gun at its
// rest pose for this frame; aim it, then remember the presented camera.
function beforeRender(scene,camera,now=performance.now()){
  snapshotPresentedCamera(camera);
  if(!isFoot())return;const gun=scene?.getObjectByName?.("WALK_PISTOL_3D");if(!gun||gun.visible===false)return;
  const dt=clamp((now-lastFrameMs)/1000,0,.1);lastFrameMs=now;
  if(pointer){const ray=screenRay(pointer.x,pointer.y);if(ray)desiredPoint.copy(ray.origin).addScaledVector(ray.direction,pointerDepth);}
  else if(now-releasedAt>RELEASE_HOLD_MS){const ray=centerRay();if(ray){if(now-lastRestResolve>REST_RESOLVE_MS){lastRestResolve=now;restDepth=resolveDistance(ray);}restPoint.copy(ray.origin).addScaledVector(ray.direction,restDepth);desiredPoint.copy(restPoint);}}
  if(!aimPointValid){aimPoint.copy(desiredPoint);aimPointValid=true;}else aimPoint.lerp(desiredPoint,1-Math.exp(-TARGET_SMOOTH_HZ*dt));
  const result=alignSights(gun,aimPoint);if(!result)return;
  // Recoil is applied on top of the aligned pose (aligning would otherwise
  // cancel the walk mode's own kick): muzzle flips up and the gun pushes back.
  const kickAge=now-lastKickAt;if(kickAge>=0&&kickAge<KICK_MS){const k=Math.sin(Math.PI*kickAge/KICK_MS);gun.rotateX(KICK_RAD*k);gun.translateZ(KICK_BACK_M*k);}
  setData("walkWeaponController",FIRST_PERSON_CONTROLLER_VERSION);setData("walkWeaponAimMode",pointer?"touch-drag":now-releasedAt<=RELEASE_HOLD_MS?"shot-hold":"crosshair-rest");
  setData("walkWeaponVectorAlignment","exact-screen-ray-from-hand-anchor-v5");setData("walkWeaponGeometryAlignment","grip-anchor-to-resolved-shot-v6");setData("walkWeaponGeometryVector","grip-to-muzzle-to-shot-point-v1");
  setData("walkWeaponHandAnchor","position-fixed-rotation-only-v1");setData("walkWeaponGripAnchor","grip-world-fixed-v2");setData("walkWeaponAimWeight","1.000");
  setData("walkWeaponAimErrorDeg",result.errorDeg.toFixed(3));setData("walkWeaponGripAnchorDriftM",result.driftM.toFixed(5));
}

// Shot / drag input from the screen-touch owner (flight_first_cleanup) and
// the desktop click path (foot_look_capture).
function onAimStart(event){
  if(!isFoot())return;const d=event?.detail||{},x=Number(d.clientX),y=Number(d.clientY),ray=screenRay(x,y);if(!ray)return;
  pointerDepth=resolveDistance(ray,{full:true});desiredPoint.copy(ray.origin).addScaledVector(ray.direction,pointerDepth);aimPoint.copy(desiredPoint);aimPointValid=true;
  if(String(d.source||"").startsWith("screen-touch-hold"))pointer={x,y};releasedAt=performance.now();
  // Snap the gun onto the new target now, so the tracer spawned by fireAt()
  // right after this event leaves the aligned muzzle.
  const gun=bridge()?.threeScene?.getObjectByName?.("WALK_PISTOL_3D");if(gun&&gun.visible!==false)alignSights(gun,aimPoint);lastKickAt=performance.now()+16;
  setData("walkWeaponFireVector","touch-screen-ray-v5");setData("walkWeaponFireGeometryVector","touch-screen-ray-v6");setData("walkWeaponAimSource","screen-touch");setData("walkWeaponAimSourceDetail",String(d.source||"screen"));
  setData("walkWeaponAimTarget",`${aimPoint.x.toFixed(3)},${aimPoint.y.toFixed(3)},${aimPoint.z.toFixed(3)}`);
}
function onAimMove(event){const d=event?.detail||{};if(d.phase==="end"){pointer=null;releasedAt=performance.now();return;}if(!pointer)return;pointer.x=Number(d.clientX);pointer.y=Number(d.clientY);}

export function installFirstPersonController(){
  if(installed)return;installed=true;
  const attach=()=>{const b=bridge();if(typeof b?.addPreRenderHook!=="function")return requestAnimationFrame(attach);b.addPreRenderHook(beforeRender);};attach();
  addEventListener("arondight:foot-screen-fire-anchor",onAimStart);
  addEventListener("arondight:foot-screen-fire",onAimStart);
  addEventListener("arondight:foot-aim",onAimMove);
  globalThis.__arondightFirstPersonController=Object.freeze({version:FIRST_PERSON_CONTROLLER_VERSION,screenRay,snapshotPresentedCamera,get hasPresentedCamera(){return presentedValid;}});
}
installFirstPersonController();
