import * as THREE from "three";
import {CameraBox3dSpring} from "./camera_box3d_spring.mjs";
import {resolveBox3dCameraPath} from "./world_building_collision_physics.mjs";

let installed=false,wrapped=false,baseProvider=null,baseCollisionResolver=null,springEngine=null,lastSpringResult=null;
const springs=new Map(),anchor=new THREE.Vector3();
const MODE_PROFILES=Object.freeze({
  fpv:Object.freeze({halfExtents:[.022,.022,.018],massKg:.055,frequencyHz:7.2,dampingRatio:1,maxAccelerationMps2:96,maxTargetVelocityMps:48}),
  follow:Object.freeze({halfExtents:[.075,.075,.065],massKg:.12,frequencyHz:5.8,dampingRatio:1,maxAccelerationMps2:88,maxTargetVelocityMps:42}),
  third:Object.freeze({halfExtents:[.085,.085,.075],massKg:.14,frequencyHz:5.5,dampingRatio:1,maxAccelerationMps2:86,maxTargetVelocityMps:42}),
  walk:Object.freeze({halfExtents:[.10,.10,.085],massKg:.18,frequencyHz:5.4,dampingRatio:1,maxAccelerationMps2:82,maxTargetVelocityMps:38}),
  vehicle:Object.freeze({halfExtents:[.12,.12,.10],massKg:.22,frequencyHz:5.0,dampingRatio:1,maxAccelerationMps2:80,maxTargetVelocityMps:38}),
});
const SAFETY_PROFILES=Object.freeze({
  fpv:Object.freeze({radiusM:.035,clearanceM:.012,floorM:.040}),
  follow:Object.freeze({radiusM:.105,clearanceM:.032,floorM:.070}),
  third:Object.freeze({radiusM:.120,clearanceM:.036,floorM:.075}),
  walk:Object.freeze({radiusM:.140,clearanceM:.040,floorM:.120}),
  vehicle:Object.freeze({radiusM:.160,clearanceM:.050,floorM:.120}),
});
const finite3=value=>Array.isArray(value)&&value.length===3&&value.every(Number.isFinite);
const distance3=(a,b)=>finite3(a)&&finite3(b)?Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]):Infinity;
function viewport(){return document.getElementById("viewport");}
function bridge(){return globalThis.__arondightRealWorld||null;}
function physicsRuntime(){return globalThis.__arondightWorldRigidBodies||null;}
function cameraMode(){const drive=globalThis.__arondightVehicleDrive;if(drive?.active)return"vehicle";const walk=globalThis.__arondightWalkMode;if(walk?.mode==="foot")return"walk";return String(viewport()?.dataset?.cameraMode||"follow");}
function profileFor(mode){return MODE_PROFILES[mode]||MODE_PROFILES.follow;}
function safetyFor(mode){return SAFETY_PROFILES[mode]||SAFETY_PROFILES.follow;}
function resolveAnchor(){const drive=globalThis.__arondightVehicleDrive;if(drive?.active&&drive.cameraAnchor){const a=drive.cameraAnchor;return anchor.set(Number(a.x)||0,Number(a.y)||0,Math.max(.22,Number(a.z)||0));}const walk=globalThis.__arondightWalkMode,p=walk?.position;if(walk?.mode==="foot"&&p)return anchor.set(Number(p.x)||0,Number(p.y)||0,Math.max(.20,(Number(p.z)||1.68)-.38));const b=bridge(),air=b?.threeScene?(b.airframeFor?.(b.threeScene)||b.airframe):b?.airframe;if(air?.position)return anchor.set(Number(air.position.x)||0,Number(air.position.y)||0,Math.max(.024,Number(air.position.z)||0));return null;}
function destroySprings(){for(const spring of springs.values())spring.destroy();springs.clear();lastSpringResult=null;}
function ensureSpring(mode){const engine=physicsRuntime()?.engine;if(!engine?.world||!engine?.b3)return null;if(engine!==springEngine){destroySprings();springEngine=engine;}const key=String(mode||"camera");let spring=springs.get(key);if(!spring){spring=new CameraBox3dSpring({b3:engine.b3,world:engine.world,profile:profileFor(key)});springs.set(key,spring);}return spring;}
function fallbackResolve(source,desired){if(typeof baseCollisionResolver!=="function")return{position:finite3(desired)?[...desired]:[0,0,0],collided:false,compressionM:0,hitDistanceM:0,physics:"no-fallback"};try{return baseCollisionResolver(source,desired)||{position:desired,collided:false,compressionM:0,hitDistanceM:0,physics:"base-camera-resolver"};}catch{return{position:desired,collided:false,compressionM:0,hitDistanceM:0,physics:"base-camera-resolver-error"};}}
function conservativeResolve(source,desired,mode){
  if(!finite3(source)||!finite3(desired))return{position:finite3(desired)?[...desired]:[0,0,0],collided:false,hitDistanceM:0,physics:"invalid-camera-path"};
  const engine=physicsRuntime()?.engine,safety=safetyFor(mode),requestedDistance=distance3(source,desired);let worldResult=null;
  if(engine?.world&&engine?.b3)worldResult=resolveBox3dCameraPath(engine.b3,engine.world,source,desired,{queryCategoryBits:8n,terrainCategoryBits:1n,clearanceM:safety.clearanceM,cameraRadiusM:safety.radiusM});
  const baseResult=fallbackResolve(source,desired),candidates=[];
  if(worldResult&&finite3(worldResult.position))candidates.push({...worldResult,source:"world-swept"});
  if(baseResult?.collided&&finite3(baseResult.position))candidates.push({...baseResult,source:"native-swept"});
  if(!candidates.length)return{position:[...desired],collided:false,hitDistanceM:requestedDistance,cameraRadiusM:safety.radiusM,physics:"swept-clear-v1",source:"clear"};
  let winner=candidates[0];for(const candidate of candidates.slice(1))if(distance3(source,candidate.position)<distance3(source,winner.position))winner=candidate;
  const collided=Boolean(candidates.some(candidate=>candidate.collided));
  if(!collided)return{...winner,position:[...desired],collided:false,hitDistanceM:requestedDistance,cameraRadiusM:safety.radiusM,physics:"swept-clear-v1"};
  return{...winner,position:[...winner.position],collided:true,cameraRadiusM:safety.radiusM,physics:"conservative-swept-volume-v1"};
}
function physicalResolver(anchorValue,desiredValue){
  const mode=cameraMode(),desired=Array.isArray(desiredValue)?desiredValue.map(Number):[],source=Array.isArray(anchorValue)?anchorValue.map(Number):[],spring=ensureSpring(mode);
  if(!spring||!finite3(source)||!finite3(desired))return fallbackResolve(source,desired);
  const hardTarget=conservativeResolve(source,desired,mode),springTarget=finite3(hardTarget.position)?hardTarget.position:desired,result=spring.update({anchor:source,desired:springTarget,now:performance.now(),mode}),post=conservativeResolve(source,finite3(result?.position)?result.position:springTarget,mode),finalPosition=finite3(post.position)?post.position:springTarget,compressionM=distance3(desired,finalPosition),collided=Boolean(hardTarget.collided||result?.collided||post.collided),hitDistanceM=Number(hardTarget.hitDistanceM)||distance3(source,finalPosition),v=viewport(),profile=profileFor(mode),safety=safetyFor(mode);
  lastSpringResult={...result,position:[...finalPosition],compressionM,collided,hardLimited:Boolean(hardTarget.collided||post.collided)};
  if(v){v.dataset.playerCameraSpringBody="dynamic-bullet-box-v3";v.dataset.playerCameraSpringWorld="isolated-camera-layer-world-v3";v.dataset.playerCameraSpringMode=mode;v.dataset.playerCameraSpringCompressionM=Number(compressionM||0).toFixed(3);v.dataset.playerCameraSpringPhysics=result?.physics||"box3d";v.dataset.playerCameraSpringBodies=String(springs.size);v.dataset.playerCameraSpringResets=String(result?.resets||0);v.dataset.playerCameraSpringHalfExtentsM=profile.halfExtents.map(value=>Number(value).toFixed(3)).join(",");v.dataset.playerCameraCollisionCategory="camera-8n-not-drone-4n";v.dataset.playerCameraHardSafety="pre+post-swept-volume-v1";v.dataset.playerCameraSafetyRadiusM=safety.radiusM.toFixed(3);v.dataset.playerCameraSafetyClearanceM=safety.clearanceM.toFixed(3);v.dataset.playerCameraHardLimited=collided?"1":"0";}
  return{...result,position:[...finalPosition],compressionM,collided,obstructed:collided,hardLimited:Boolean(hardTarget.collided||post.collided),hitDistanceM,cameraRadiusM:safety.radiusM,physics:"box3d-spring+conservative-swept-volume-v1",presentation:"hard-safe+spring-soft-v1"};
}
function ensureResolver(){const b=bridge();if(!b||typeof b.attachCameraCollisionResolver!=="function")return false;const current=b.cameraCollisionResolver;if(typeof current==="function"&&current!==physicalResolver)baseCollisionResolver=current;if(current!==physicalResolver)b.attachCameraCollisionResolver(physicalResolver);return true;}
function constrain(args,result){
  const b=bridge(),camera=args?.camera,a=resolveAnchor(),mode=cameraMode();if(!camera?.position||!a)return result;
  const physicsReady=Boolean(ensureResolver()&&physicsRuntime()?.engine),collided=typeof b?.constrainCameraToPhysics==="function"?Boolean(b.constrainCameraToPhysics(a,camera)):false,safety=safetyFor(mode),hardFloor=safety.floorM;
  if(camera.position.z<hardFloor)camera.position.z=hardFloor;
  camera.near=Math.max(.035,Math.min(.08,Number(camera.near)||.06));camera.updateProjectionMatrix?.();camera.updateMatrixWorld?.(true);
  const view=viewport();if(view){view.dataset.playerCameraCollisionGuard="box3d-spring+hard-swept-volume-v3";view.dataset.playerCameraCollision=collided?"blocked":"clear";view.dataset.playerCameraFloorM=hardFloor.toFixed(3);view.dataset.playerCameraSpringCompressionM=Number(lastSpringResult?.compressionM||0).toFixed(3);view.dataset.playerCameraResolverFallback=typeof baseCollisionResolver==="function"?"available":"missing";view.dataset.playerCameraNoClipContract="swept-volume-before+after-spring-v1";view.dataset.playerCameraPhysicsReady=physicsReady?"1":"0";}
  return result;
}
function tryWrap(){if(wrapped)return true;const b=bridge(),current=b?.presentationCameraProvider;if(!b||typeof b.attachPresentationCameraProvider!=="function"||!current||current.__collisionGuard)return false;baseProvider=current;const provider={__collisionGuard:true,__box3dCameraSpringGuard:true,isActive:()=>Boolean(baseProvider?.isActive?.()),apply:args=>constrain(args,baseProvider?.apply?.(args))};b.attachPresentationCameraProvider(provider);wrapped=true;return true;}
function frame(){ensureResolver();tryWrap();requestAnimationFrame(frame);}
export function installCameraCollisionGuard(){if(installed)return;installed=true;const view=viewport();if(view){view.dataset.playerCameraCollisionGuard="waiting-hard-swept-volume-v3";view.dataset.playerCameraSpringBody="dynamic-bullet-box-v3";view.dataset.playerCameraCollisionCategory="camera-8n-not-drone-4n";view.dataset.playerCameraNoClipContract="swept-volume-before+after-spring-v1";}requestAnimationFrame(frame);}
installCameraCollisionGuard();
