import * as THREE from "three";
import {Box3dHitscanWorld} from "./box3d_hitscan.mjs";
import {buildGoldenHandCannon} from "./weapon_models.mjs";
import {terrainRayDistance} from "./terrain_craters.mjs";

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
let installed=false,lastFrameMs=performance.now(),lastRestResolve=-Infinity,restDepth=REST_DISTANCE_M;
// One aim state per hand: 0 = right hand (every weapon), 1 = left Glock.
const hands=[0,1].map(()=>({aim:new THREE.Vector3(),desired:new THREE.Vector3(),valid:false,pointer:null,depth:REST_DISTANCE_M,releasedAt:-Infinity,kickAt:-Infinity}));
const MIRROR=new THREE.Matrix4().makeScale(-1,1,1),mTmp=new THREE.Matrix4(),mTmp2=new THREE.Matrix4();let leftRoot=null;

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
function staticDistance(ray,max){const b=bridge();let best=max;try{if(b?.active){const hit=boxHits.cast([ray.origin.x,ray.origin.y,ray.origin.z],[ray.direction.x,ray.direction.y,ray.direction.z],max,b.buildingCollisionSnapshot);if(hit)best=Math.min(best,hit.distanceM);}}catch{}const t=terrainRayDistance(ray.origin,ray.direction,best);if(t!==null&&t>.2)best=Math.min(best,t);return best;}
function resolveDistance(ray,{full=false}={}){let distance=staticDistance(ray,MAX_RAY_M);if(full){const scene=bridge()?.threeScene;if(scene){raycaster.set(ray.origin,ray.direction);raycaster.near=.05;raycaster.far=distance;const hit=raycaster.intersectObjects(sceneCandidates(scene),false)[0];if(hit)distance=Math.min(distance,hit.distance);}}return clamp(distance,1.2,MAX_RAY_M);}

function gunParts(gun){
  const mode=String(footWeapons()?.mode||"smg"),smg=mode==="smg",grenade=mode==="grenade",glock=mode==="glock";
  const grip=gun.getObjectByName(grenade?"WALK_GL_GRIP":smg?"WALK_SMG_PISTOL_GRIP":glock?"WALK_GLOCK_GRIP":"WALK_VM_GRIP")||gun.getObjectByName("WALK_VM_GRIP");
  const rear=gun.getObjectByName(grenade?"WALK_GL_REAR_SIGHT":smg?"WALK_SMG_REAR_SIGHT":glock?"WALK_GLOCK_REAR_SIGHT":"WALK_VM_REAR_SIGHT");
  const front=gun.getObjectByName(grenade?"WALK_GL_FRONT_SIGHT":smg?"WALK_SMG_FRONT_SIGHT":glock?"WALK_GLOCK_FRONT_SIGHT":"WALK_VM_FRONT_SIGHT")||gun.getObjectByName(grenade?"WALK_GRENADE_MUZZLE_NODE":smg?"WALK_SMG_MUZZLE_NODE":glock?"WALK_GLOCK_MUZZLE_NODE":"WALK_VM_MUZZLE");
  return{grip,rear,front,smg,grenade};
}
// Rotate the gun about its grip so the sight line passes through `target`.
// Two passes converge to well under 0.1°; the grip never moves.
function alignSights(gun,target,parts=gunParts(gun)){
  const{grip,rear,front}=parts;if(!grip||!rear||!front)return null;
  gun.updateWorldMatrix(true,true);grip.getWorldPosition(gripBefore);
  for(let pass=0;pass<2;pass++){
    rear.getWorldPosition(tmpA);front.getWorldPosition(tmpB);axis.copy(tmpB).sub(tmpA);want.copy(target).sub(tmpA);
    if(axis.lengthSq()<1e-8||want.lengthSq()<1e-6)return null;q.setFromUnitVectors(axis.normalize(),want.normalize());
    gun.quaternion.premultiply(q);gun.updateWorldMatrix(true,true);grip.getWorldPosition(gripAfter);gun.position.add(tmpA.copy(gripBefore).sub(gripAfter));gun.updateWorldMatrix(true,true);
  }
  rear.getWorldPosition(tmpA);front.getWorldPosition(tmpB);grip.getWorldPosition(gripAfter);
  return{errorDeg:tmpB.sub(tmpA).angleTo(want.copy(target).sub(tmpA))*180/Math.PI,driftM:gripAfter.distanceTo(gripBefore)};
}
// Left Glock: its own viewmodel in the left hand — the exact mirror image of
// the right pistol's rest pose across the camera's vertical centre plane
// (left = Camera · Mirror_x · Camera⁻¹ · RightRest), then aimed on its own.
function ensureLeftPistol(scene){
  if(leftRoot?.parent===scene)return leftRoot;if(leftRoot?.parent)leftRoot.parent.remove(leftRoot);
  leftRoot=new THREE.Group();leftRoot.name="WALK_GLOCK_LEFT_ROOT";leftRoot.userData.flightFireIgnore=true;leftRoot.userData.walkWeaponPart=true;leftRoot.visible=false;
  const p=buildGoldenHandCannon();p.position.set(0,0,0);p.rotation.set(0,0,0);p.scale.set(1,1,1);
  const rename={WALK_GLOCK_GRIP:"WALK_GLOCK_GRIP_LEFT",WALK_GLOCK_REAR_SIGHT:"WALK_GLOCK_REAR_SIGHT_LEFT",WALK_GLOCK_FRONT_SIGHT:"WALK_GLOCK_FRONT_SIGHT_LEFT",WALK_GLOCK_MUZZLE_NODE:"WALK_GLOCK_MUZZLE_LEFT"};
  p.traverse(n=>{if(rename[n.name])n.name=rename[n.name];n.userData.flightFireIgnore=true;n.userData.walkWeaponPart=true;n.frustumCulled=false;});
  leftRoot.add(p);scene.add(leftRoot);return leftRoot;
}
function placeLeftPistol(scene,camera,gun){
  const right=gun.getObjectByName("WALK_GLOCK_RIGHT"),left=ensureLeftPistol(scene);if(!right||!camera){left.visible=false;return null;}
  gun.updateWorldMatrix(true,true);camera.updateMatrixWorld();
  mTmp.copy(camera.matrixWorld).multiply(MIRROR).multiply(mTmp2.copy(camera.matrixWorld).invert()).multiply(right.matrixWorld);
  mTmp.decompose(left.position,left.quaternion,left.scale);left.updateMatrixWorld(true);
  // copy the right pistol's material state (depth, render order) once
  if(!left.userData.styled){const src=[];right.traverse(n=>{if(n.isMesh)src.push(n);});let i=0;left.traverse(n=>{if(n.isMesh){const m=src[i++%Math.max(1,src.length)];if(m){n.renderOrder=m.renderOrder;}}});left.userData.styled=true;}
  left.visible=true;return left;
}
function leftParts(left){return{grip:left.getObjectByName("WALK_GLOCK_GRIP_LEFT"),rear:left.getObjectByName("WALK_GLOCK_REAR_SIGHT_LEFT"),front:left.getObjectByName("WALK_GLOCK_FRONT_SIGHT_LEFT")};}
function stepAim(h,dt,now,rest){
  if(h.pointer){const ray=screenRay(h.pointer.x,h.pointer.y);if(ray)h.desired.copy(ray.origin).addScaledVector(ray.direction,h.depth);}
  else if(now-h.releasedAt>RELEASE_HOLD_MS&&rest)h.desired.copy(rest);
  if(!h.valid){h.aim.copy(h.desired);h.valid=true;}else h.aim.lerp(h.desired,1-Math.exp(-TARGET_SMOOTH_HZ*dt));
}
function kick(obj,h,now){const age=now-h.kickAt;if(age>=0&&age<KICK_MS){const k=Math.sin(Math.PI*age/KICK_MS);obj.rotateX(KICK_RAD*k);obj.translateZ(KICK_BACK_M*k);}}
function centerRay(){const view=viewport(),r=view?.getBoundingClientRect();return r?screenRay(r.left+r.width/2,r.top+r.height/2):null;}

// Pre-render hook: the walk camera provider has just placed the gun at its
// rest pose for this frame; aim it, then remember the presented camera.
function beforeRender(scene,camera,now=performance.now()){
  snapshotPresentedCamera(camera);
  const glock=String(footWeapons()?.mode||"smg")==="glock";
  // The first-person hands/guns exist only in a frame whose camera the walk
  // view placed: in a car, in the drone or dead they are hidden — otherwise
  // they stayed hanging in the world where the player got in (floating hands).
  const gun=scene?.getObjectByName?.("WALK_PISTOL_3D");if(gun&&(!isFoot()||now-(Number(gun.userData.placedAt)||-Infinity)>250))gun.visible=false;
  if(!isFoot()){if(leftRoot)leftRoot.visible=false;return;}if(!gun||gun.visible===false){if(leftRoot)leftRoot.visible=false;return;}
  const dt=clamp((now-lastFrameMs)/1000,0,.1);lastFrameMs=now;
  let rest=null;{const ray=centerRay();if(ray){if(now-lastRestResolve>REST_RESOLVE_MS){lastRestResolve=now;restDepth=resolveDistance(ray);}rest=restPoint.copy(ray.origin).addScaledVector(ray.direction,restDepth);}}
  // the left pistol takes its rest pose from the right one *before* aiming
  const left=glock?placeLeftPistol(scene,camera,gun):null;if(!glock&&leftRoot)leftRoot.visible=false;
  stepAim(hands[0],dt,now,rest);const result=alignSights(gun,hands[0].aim);if(!result)return;kick(gun,hands[0],now);
  if(left){stepAim(hands[1],dt,now,rest);alignSights(left,hands[1].aim,leftParts(left));kick(left,hands[1],now);}
  const h=hands[0];
  setData("walkWeaponController",FIRST_PERSON_CONTROLLER_VERSION);setData("walkWeaponAimMode",h.pointer?"touch-drag":now-h.releasedAt<=RELEASE_HOLD_MS?"shot-hold":"crosshair-rest");
  setData("walkWeaponVectorAlignment","exact-screen-ray-from-hand-anchor-v5");setData("walkWeaponGeometryAlignment","grip-anchor-to-resolved-shot-v6");setData("walkWeaponGeometryVector","grip-to-muzzle-to-shot-point-v1");
  setData("walkWeaponHandAnchor","position-fixed-rotation-only-v1");setData("walkWeaponGripAnchor","grip-world-fixed-v2");setData("walkWeaponAimWeight","1.000");
  setData("walkWeaponAimErrorDeg",result.errorDeg.toFixed(3));setData("walkWeaponGripAnchorDriftM",result.driftM.toFixed(5));setData("walkGlockAkimbo",glock?"left-hand-mirrored-independent-aim-v4":"off");
}

// Shot / drag input from the screen-touch owner (flight_first_cleanup) and
// the desktop click path (foot_look_capture).
function onAimStart(event){
  if(!isFoot())return;const d=event?.detail||{},x=Number(d.clientX),y=Number(d.clientY),ray=screenRay(x,y);if(!ray)return;
  const glock=String(footWeapons()?.mode||"smg")==="glock",hi=glock&&Number(d.hand)===1?1:0,h=hands[hi];
  h.depth=resolveDistance(ray,{full:true});h.desired.copy(ray.origin).addScaledVector(ray.direction,h.depth);h.aim.copy(h.desired);h.valid=true;
  if(String(d.source||"").startsWith("screen-touch-hold"))h.pointer={x,y};h.releasedAt=performance.now();
  // Snap this hand's gun onto the new target now, so the tracer spawned by
  // fireAt() right after this event leaves the aligned muzzle.
  const scene=bridge()?.threeScene,gun=scene?.getObjectByName?.("WALK_PISTOL_3D");
  if(hi===1){if(leftRoot?.visible)alignSights(leftRoot,h.aim,leftParts(leftRoot));}else if(gun&&gun.visible!==false)alignSights(gun,h.aim);
  h.kickAt=performance.now()+16;
  setData("walkWeaponFireVector","touch-screen-ray-v5");setData("walkWeaponFireGeometryVector","touch-screen-ray-v6");setData("walkWeaponAimSource","screen-touch");setData("walkWeaponAimSourceDetail",String(d.source||"screen"));
  setData("walkWeaponAimTarget",`${h.aim.x.toFixed(3)},${h.aim.y.toFixed(3)},${h.aim.z.toFixed(3)}`);setData("walkWeaponAimHand",hi);
}
function onAimMove(event){const d=event?.detail||{},h=hands[String(footWeapons()?.mode||"smg")==="glock"&&Number(d.hand)===1?1:0];if(d.phase==="end"){h.pointer=null;h.releasedAt=performance.now();return;}if(!h.pointer)return;h.pointer.x=Number(d.clientX);h.pointer.y=Number(d.clientY);}

export function installFirstPersonController(){
  if(installed)return;installed=true;
  const attach=()=>{const b=bridge();if(typeof b?.addPreRenderHook!=="function")return requestAnimationFrame(attach);b.addPreRenderHook(beforeRender);};attach();
  addEventListener("arondight:foot-screen-fire-anchor",onAimStart);
  addEventListener("arondight:foot-screen-fire",onAimStart);
  addEventListener("arondight:foot-aim",onAimMove);
  addEventListener("arondight:vehicle-mode",e=>{if(!e?.detail?.active)return;const gun=bridge()?.threeScene?.getObjectByName?.("WALK_PISTOL_3D");if(gun)gun.visible=false;if(leftRoot)leftRoot.visible=false;});
  globalThis.__arondightFirstPersonController=Object.freeze({version:FIRST_PERSON_CONTROLLER_VERSION,screenRay,snapshotPresentedCamera,get hasPresentedCamera(){return presentedValid;}});
}
installFirstPersonController();
