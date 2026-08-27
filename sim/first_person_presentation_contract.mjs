import * as THREE from "three";
import {createPlayerHumanRig,setPlayerHumanFootParent,hidePlayerHumanRig} from "./player_human_rig.mjs";

const VM_LOCAL_OFFSET=new THREE.Vector3(.245,-.225,-.445);
const AIM_DISTANCE_M=180;
const vmCamera=new THREE.PerspectiveCamera(78,16/9,.01,500),vmTarget=new THREE.Vector3(),vmDirection=new THREE.Vector3(),vmOrigin=new THREE.Vector3();
const raycaster=new THREE.Raycaster(),ndc=new THREE.Vector2(),rayOrigin=new THREE.Vector3(),rayDirection=new THREE.Vector3();
const parentQuaternion=new THREE.Quaternion(),inverseParentQuaternion=new THREE.Quaternion(),gunWorldQuaternion=new THREE.Quaternion(),desiredWorldQuaternion=new THREE.Quaternion(),aimAdjust=new THREE.Quaternion();
const localPosition=new THREE.Vector3(),gunWorldPosition=new THREE.Vector3(),pivotBefore=new THREE.Vector3(),pivotAfter=new THREE.Vector3(),rearWorld=new THREE.Vector3(),frontWorld=new THREE.Vector3(),sightDirection=new THREE.Vector3(),desiredSightDirection=new THREE.Vector3(),aimTargetWorld=new THREE.Vector3(),muzzleWorld=new THREE.Vector3();
const lastBaseLocalPosition=new THREE.Vector3(),lastBaseLocalQuaternion=new THREE.Quaternion(),lastRenderCameraPosition=new THREE.Vector3(),lastRenderCameraQuaternion=new THREE.Quaternion();
const fallbackLocalQuaternion=new THREE.Quaternion().setFromEuler(new THREE.Euler(-.045,-.065,-.018,"XYZ"));
let installed=false,localRig=null,localRigScene=null,lastRigSample=null,patchedBridge=null,baseRenderFrame=null,wrappedProvider=null,providerBase=null,hasBaseLocal=false,hasRenderCamera=false,lastRenderFov=78,lastRenderAspect=16/9;
let screenAimActive=false,screenX=NaN,screenY=NaN;

function viewport(){return document.getElementById("viewport");}
function bridge(){return globalThis.__arondightRealWorld||null;}
function walk(){return globalThis.__arondightWalkMode||null;}
function drive(){return globalThis.__arondightVehicleDrive||null;}
function footWeapons(){return globalThis.__arondightFootWeapons||null;}
function footActive(){const w=walk();return w?.mode==="foot"&&!drive()?.active&&!w?.dead;}
function weaponMode(){return String(footWeapons()?.mode||viewport()?.dataset?.walkWeapon||"pistol")==="smg"?"smg":"pistol";}
function finite3(value){return Array.isArray(value)&&value.length===3&&value.every(Number.isFinite);}
function clamp(value,min,max){return Math.max(min,Math.min(max,Number(value)||0));}

function markPresentationOnly(rig){
  rig.group.name="LOCAL_FOOT_THIRD_PERSON";rig.group.userData.localThirdPersonAvatar=true;rig.group.userData.playerHumanRig=true;rig.hitbox.visible=false;
  rig.group.traverse(node=>{node.userData.flightFireIgnore=true;node.userData.worldPopulationClone=true;node.userData.aimAssistDisabled=true;if(node.isMesh)node.userData.localThirdPersonPresentation=true;});
}
function ensureLocalRig(scene){
  if(!scene)return null;if(localRigScene!==scene){localRig?.group?.parent?.remove(localRig.group);localRig=null;localRigScene=scene;lastRigSample=null;}
  if(!localRig){localRig=createPlayerHumanRig({id:"local-third-person",color:0x29d6ff});markPresentationOnly(localRig);scene.add(localRig.group);}return localRig;
}
function syncLocalRig(now=performance.now()){
  const b=bridge(),scene=b?.threeScene,w=walk(),rig=ensureLocalRig(scene),view=viewport();if(!rig)return false;
  if(!footActive()||!w?.position){hidePlayerHumanRig(rig);lastRigSample=null;if(view)view.dataset.walkThirdPersonMesh="hidden-non-foot";return false;}
  setPlayerHumanFootParent(rig,scene);const x=Number(w.position.x)||0,y=Number(w.position.y)||0,yaw=Number(w.yaw)||0,pitch=Number(w.pitch)||0;
  let speed=0;if(lastRigSample){const dt=(now-lastRigSample.at)/1000;if(dt>.001&&dt<.5)speed=Math.hypot(x-lastRigSample.x,y-lastRigSample.y)/dt;}lastRigSample={x,y,at:now};
  const moving=speed>.12,gait=moving?Math.sin(now*.0105)*Math.min(.72,.18+speed*.075):0;rig.group.position.set(x,y,0);rig.group.rotation.set(0,0,-yaw);rig.leftLeg.rotation.x=gait;rig.rightLeg.rotation.x=-gait;rig.leftArm.rotation.x=moving?-gait*.72:-.28;rig.rightArm.rotation.x=moving?gait*.72:-.28;rig.aimRig.rotation.x=pitch;const mode=weaponMode();rig.pistol.visible=mode!=="smg";rig.smg.visible=mode==="smg";rig.aimRig.visible=true;rig.hitbox.visible=false;rig.group.visible=true;
  if(view){view.dataset.walkThirdPersonMesh="local-world-rig+fp-hidden-v1";view.dataset.walkThirdPersonWeapon=mode;view.dataset.walkThirdPersonPose=`${x.toFixed(3)},${y.toFixed(3)},0.000`;view.dataset.walkThirdPersonSpeedMps=speed.toFixed(3);}return true;
}

function logicalPoint(clientX,clientY){
  const view=viewport(),screen=view?.getBoundingClientRect();if(!view||!screen)return null;const width=Math.max(1,view.clientWidth),height=Math.max(1,view.clientHeight),cx=Number.isFinite(Number(clientX))?Number(clientX):screen.left+screen.width/2,cy=Number.isFinite(Number(clientY))?Number(clientY):screen.top+screen.height/2,rotated=view.dataset.soloOrientation==="css-landscape",x=rotated?cy-screen.top:cx-screen.left,y=rotated?screen.right-cx:cy-screen.top;return{x:clamp(x,0,width),y:clamp(y,0,height),width,height};
}
function canonicalScreenRay(clientX,clientY){
  const w=walk(),p=logicalPoint(clientX,clientY),viewRay=w?.viewRay?.();if(!p||!finite3(viewRay?.origin)||!finite3(viewRay?.direction))return null;
  vmOrigin.set(...viewRay.origin);vmDirection.set(...viewRay.direction).normalize();vmCamera.fov=clamp(Number(viewport()?.dataset.walkCameraFovDeg)||Number(bridge()?.threeCamera?.fov)||78,45,120);vmCamera.aspect=p.width/p.height;vmCamera.position.copy(vmOrigin);vmCamera.up.set(0,0,1);vmCamera.lookAt(vmTarget.copy(vmOrigin).add(vmDirection));vmCamera.updateProjectionMatrix();vmCamera.updateMatrixWorld(true);ndc.set(p.x/p.width*2-1,1-p.y/p.height*2);raycaster.setFromCamera(ndc,vmCamera);rayOrigin.copy(raycaster.ray.origin);rayDirection.copy(raycaster.ray.direction).normalize();return{origin:rayOrigin,direction:rayDirection,point:p};
}
function sightNodes(gun,mode){return mode==="smg"?{rear:gun.getObjectByName?.("WALK_SMG_REAR_SIGHT"),front:gun.getObjectByName?.("WALK_SMG_FRONT_DOT")||gun.getObjectByName?.("WALK_SMG_FRONT_SIGHT"),pivot:gun.getObjectByName?.("WALK_SMG_PISTOL_GRIP")}:{rear:gun.getObjectByName?.("WALK_VM_REAR_SIGHT"),front:gun.getObjectByName?.("WALK_VM_FRONT_DOT")||gun.getObjectByName?.("WALK_VM_FRONT_SIGHT"),pivot:gun.getObjectByName?.("WALK_VM_GRIP")};}
function setWorldPosition(object,position){const parent=object?.parent;if(!object)return;if(!parent){object.position.copy(position);return;}localPosition.copy(position);parent.worldToLocal(localPosition);object.position.copy(localPosition);}
function setWorldQuaternion(object,quaternion){const parent=object?.parent;if(!object)return;if(!parent){object.quaternion.copy(quaternion);return;}parent.getWorldQuaternion(parentQuaternion);inverseParentQuaternion.copy(parentQuaternion).invert();object.quaternion.copy(inverseParentQuaternion.multiply(quaternion)).normalize();}
function alignWeaponToRay(gun,ray,mode=weaponMode()){
  if(!gun||!ray)return NaN;const sights=sightNodes(gun,mode);if(!sights.rear||!sights.front||!sights.pivot)return NaN;gun.updateWorldMatrix?.(true,true);sights.pivot.getWorldPosition(pivotBefore);sights.rear.getWorldPosition(rearWorld);sights.front.getWorldPosition(frontWorld);sightDirection.copy(frontWorld).sub(rearWorld).normalize();aimTargetWorld.copy(ray.origin).addScaledVector(ray.direction,AIM_DISTANCE_M);desiredSightDirection.copy(aimTargetWorld).sub(rearWorld).normalize();gun.getWorldQuaternion(gunWorldQuaternion);aimAdjust.setFromUnitVectors(sightDirection,desiredSightDirection);desiredWorldQuaternion.copy(aimAdjust).multiply(gunWorldQuaternion).normalize();setWorldQuaternion(gun,desiredWorldQuaternion);gun.updateWorldMatrix?.(true,true);sights.pivot.getWorldPosition(pivotAfter);gun.getWorldPosition(gunWorldPosition);gunWorldPosition.add(pivotBefore).sub(pivotAfter);setWorldPosition(gun,gunWorldPosition);gun.updateWorldMatrix?.(true,true);sights.rear.getWorldPosition(rearWorld);sights.front.getWorldPosition(frontWorld);sightDirection.copy(frontWorld).sub(rearWorld).normalize();desiredSightDirection.copy(aimTargetWorld).sub(rearWorld).normalize();return Math.acos(clamp(sightDirection.dot(desiredSightDirection),-1,1))*180/Math.PI;
}
function ensureCameraInScene(scene,camera){if(!scene||!camera)return false;if(!camera.parent){scene.add(camera);return true;}return camera.parent===scene;}
function parentViewmodelAtCameraPose(camera,gun){
  if(!camera||!gun)return false;if(gun.parent!==camera){gun.parent?.remove(gun);camera.add(gun);}gun.position.copy(VM_LOCAL_OFFSET);gun.quaternion.copy(fallbackLocalQuaternion);gun.scale.setScalar(1);gun.updateMatrixWorld?.(true);return true;
}
function publishAlignment(ray,error,phase){const view=viewport();if(!view||!ray)return;view.dataset.walkWeaponVectorAlignment="camera-child+screen-ray+grip-pivot-v1";view.dataset.walkViewmodelAimVector=`${ray.direction.x.toFixed(5)},${ray.direction.y.toFixed(5)},${ray.direction.z.toFixed(5)}`;view.dataset.walkWeaponSightTargetErrorDeg=Number.isFinite(error)?error.toFixed(5):"";view.dataset.walkViewmodelAimPhase=phase;view.dataset.walkViewmodelAimPoint=`${ray.point.x.toFixed(1)},${ray.point.y.toFixed(1)}`;}
function presentViewmodel({camera,scene}={}){
  if(!camera||!scene||!footActive())return false;const gun=scene.getObjectByName?.("WALK_PISTOL_3D");if(!gun||gun.visible===false||!ensureCameraInScene(scene,camera))return false;
  scene.updateMatrixWorld?.(true);camera.updateMatrixWorld?.(true);if(!parentViewmodelAtCameraPose(camera,gun))return false;lastBaseLocalPosition.copy(gun.position);lastBaseLocalQuaternion.copy(gun.quaternion);hasBaseLocal=true;lastRenderCameraPosition.copy(camera.position);lastRenderCameraQuaternion.copy(camera.quaternion);lastRenderFov=Number(camera.fov)||78;lastRenderAspect=Number(camera.aspect)||16/9;hasRenderCamera=true;
  let error=NaN,ray=null;if(screenAimActive){ray=canonicalScreenRay(screenX,screenY);if(ray)error=alignWeaponToRay(gun,ray);}gun.updateMatrixWorld?.(true);const flash=gun.getObjectByName?.("FINAL_MUZZLE_FLASH")||gun.getObjectByName?.("WALK_MUZZLE_FLASH");flash?.getWorldPosition?.(muzzleWorld);const view=viewport();if(view){view.dataset.firstPersonPresentationContract="camera-local-pose-screen-ray-v4";view.dataset.walkViewmodelOwnership="single-final-render-fire-owner-v4";view.dataset.walkViewmodelRenderParent="camera";view.dataset.walkViewmodelDetachPolicy="post-render-scene";view.dataset.walkViewmodelCameraFrames=String((Number(view.dataset.walkViewmodelCameraFrames)||0)+1);view.dataset.walkMuzzleWorld=`${muzzleWorld.x.toFixed(3)},${muzzleWorld.y.toFixed(3)},${muzzleWorld.z.toFixed(3)}`;}if(ray)publishAlignment(ray,error,"render");return true;
}
function detachViewmodel(scene,camera){const gun=camera?.getObjectByName?.("WALK_PISTOL_3D");if(!gun||gun.parent!==camera||!scene)return false;scene.updateMatrixWorld?.(true);camera.updateMatrixWorld?.(true);gun.updateMatrixWorld?.(true);scene.attach(gun);const view=viewport();if(view)view.dataset.walkViewmodelPostRenderParent="scene";return true;}
function syncPreFireViewmodel(clientX,clientY){
  const b=bridge(),scene=b?.threeScene,gun=scene?.getObjectByName?.("WALK_PISTOL_3D");if(!scene||!gun||!footActive())return false;const ray=canonicalScreenRay(clientX,clientY);if(!ray)return false;
  const p=hasBaseLocal?lastBaseLocalPosition:VM_LOCAL_OFFSET,q=hasBaseLocal?lastBaseLocalQuaternion:fallbackLocalQuaternion;vmCamera.fov=hasRenderCamera?lastRenderFov:vmCamera.fov;vmCamera.aspect=hasRenderCamera?lastRenderAspect:vmCamera.aspect;if(hasRenderCamera){vmCamera.position.copy(lastRenderCameraPosition);vmCamera.quaternion.copy(lastRenderCameraQuaternion);}else{vmCamera.position.copy(ray.origin);vmCamera.up.set(0,0,1);vmCamera.lookAt(vmTarget.copy(ray.origin).add(ray.direction));}vmCamera.updateProjectionMatrix();vmCamera.updateMatrixWorld(true);if(gun.parent)gun.parent.remove(gun);vmCamera.add(gun);gun.position.copy(p);gun.quaternion.copy(q);gun.scale.setScalar(1);gun.updateMatrixWorld?.(true);const error=alignWeaponToRay(gun,ray);gun.updateMatrixWorld?.(true);scene.updateMatrixWorld?.(true);scene.attach(gun);gun.updateMatrixWorld?.(true);const flash=gun.getObjectByName?.("FINAL_MUZZLE_FLASH")||gun.getObjectByName?.("WALK_MUZZLE_FLASH");flash?.getWorldPosition?.(muzzleWorld);const view=viewport();if(view){view.dataset.walkMuzzleShotSync="screen-ray-pre-fire-v2";view.dataset.walkViewmodelPreFireParent="scene";view.dataset.walkMuzzleWorld=`${muzzleWorld.x.toFixed(3)},${muzzleWorld.y.toFixed(3)},${muzzleWorld.z.toFixed(3)}`;}publishAlignment(ray,error,"pre-fire");return true;
}

function suppressLegacyWeaponTransformOwner(){const current=globalThis.__arondightFootWeaponPresentationV1;if(current?.__finalViewmodelOwner)return;globalThis.__arondightFootWeaponPresentationV1=Object.freeze({__finalViewmodelOwner:true,apply:()=>false});}
function wrapFinalCameraProvider(){
  const b=bridge(),current=b?.presentationCameraProvider;if(!b||typeof b.attachPresentationCameraProvider!=="function"||!current)return false;if(current===wrappedProvider||current.__firstPersonViewmodelOwner)return true;if(!current.__geometricCameraCollisionGuard)return false;providerBase=current;const base=current,wrapper={__firstPersonViewmodelOwner:true,__geometricCameraCollisionGuard:true,isActive:()=>Boolean(base?.isActive?.()),apply:args=>{const result=base?.apply?.(args);if(Boolean(result?.active)&&footActive())presentViewmodel(args);return result;}};wrappedProvider=wrapper;b.attachPresentationCameraProvider(wrapper);const view=viewport();if(view)view.dataset.walkViewmodelProviderOrder="walk-camera>collision>final-viewmodel-v1";return true;
}
function patchRenderFrame(){
  const b=bridge();if(!b||typeof b.renderFrame!=="function")return false;if(b===patchedBridge&&b.renderFrame?.__firstPersonPresentationContract)return true;baseRenderFrame=b.renderFrame.bind(b);const wrapper=function(renderer,scene,camera){const fp=footActive(),rig=ensureLocalRig(scene);if(fp&&rig)rig.group.visible=false;try{return baseRenderFrame(renderer,scene,camera);}finally{detachViewmodel(scene,camera);if(fp&&rig&&!walk()?.dead)rig.group.visible=true;const view=viewport();if(view)view.dataset.walkRenderOwnership="world-avatar-hidden+camera-child-viewmodel-during-draw-v4";}};wrapper.__firstPersonPresentationContract=true;b.renderFrame=wrapper;patchedBridge=b;return true;
}
function onScreenAim(event){const d=event?.detail||{};if(d.active===false){screenAimActive=false;return;}screenAimActive=true;screenX=Number(d.clientX);screenY=Number(d.clientY);}
function onScreenFire(event){const d=event?.detail||{};screenX=Number(d.clientX);screenY=Number(d.clientY);syncPreFireViewmodel(screenX,screenY);}
function frame(now=performance.now()){suppressLegacyWeaponTransformOwner();patchRenderFrame();wrapFinalCameraProvider();syncLocalRig(now);requestAnimationFrame(frame);}

export function installFirstPersonPresentationContract(){
  if(installed)return;installed=true;suppressLegacyWeaponTransformOwner();addEventListener("arondight:foot-screen-aim",onScreenAim,{capture:true});addEventListener("arondight:foot-screen-fire",onScreenFire,{capture:true});addEventListener("arondight:player-mode",()=>{screenAimActive=false;syncLocalRig();});const view=viewport();if(view){view.dataset.firstPersonPresentationContract="camera-local-pose-screen-ray-v4";view.dataset.walkViewmodelOwnership="single-final-render-fire-owner-v4";view.dataset.walkViewmodelVisibilityOwner="player-walk-mode-v4";}requestAnimationFrame(frame);
}