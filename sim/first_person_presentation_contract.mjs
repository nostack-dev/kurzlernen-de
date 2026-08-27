import * as THREE from "three";
import {createPlayerHumanRig,setPlayerHumanFootParent,hidePlayerHumanRig} from "./player_human_rig.mjs";

const VM_LOCAL_OFFSET=new THREE.Vector3(.245,-.225,-.445);
const vmCamera=new THREE.PerspectiveCamera(78,16/9,.01,500),vmTarget=new THREE.Vector3(),vmWorld=new THREE.Vector3(),vmDirection=new THREE.Vector3(),vmOrigin=new THREE.Vector3();
const parentQuaternion=new THREE.Quaternion(),inverseParentQuaternion=new THREE.Quaternion(),vmQuaternion=new THREE.Quaternion(),localPosition=new THREE.Vector3();
let installed=false,localRig=null,localRigScene=null,lastRigSample=null,patchedBridge=null,baseRenderFrame=null,patchedFootWeapons=null,baseFireAt=null;

function viewport(){return document.getElementById("viewport");}
function bridge(){return globalThis.__arondightRealWorld||null;}
function walk(){return globalThis.__arondightWalkMode||null;}
function drive(){return globalThis.__arondightVehicleDrive||null;}
function footWeapons(){return globalThis.__arondightFootWeapons||null;}
function footActive(){const w=walk();return w?.mode==="foot"&&!drive()?.active&&!w?.dead;}
function weaponMode(){return String(footWeapons()?.mode||viewport()?.dataset?.walkWeapon||"pistol")==="smg"?"smg":"pistol";}
function finite3(value){return Array.isArray(value)&&value.length===3&&value.every(Number.isFinite);}

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
function setWorldPosition(object,position){const parent=object?.parent;if(!object)return;if(!parent){object.position.copy(position);return;}localPosition.copy(position);parent.worldToLocal(localPosition);object.position.copy(localPosition);}
function setWorldQuaternion(object,quaternion){const parent=object?.parent;if(!object)return;if(!parent){object.quaternion.copy(quaternion);return;}parent.getWorldQuaternion(parentQuaternion);inverseParentQuaternion.copy(parentQuaternion).invert();object.quaternion.copy(inverseParentQuaternion.multiply(quaternion)).normalize();}
function syncViewmodelPose(){
  const b=bridge(),scene=b?.threeScene,w=walk(),gun=scene?.getObjectByName?.("WALK_PISTOL_3D"),view=viewport();if(!gun||!footActive()||!w?.viewRay)return false;const ray=w.viewRay();if(!finite3(ray?.origin)||!finite3(ray?.direction))return false;
  vmOrigin.set(...ray.origin);vmDirection.set(...ray.direction).normalize();vmCamera.position.copy(vmOrigin);vmCamera.up.set(0,0,1);vmCamera.lookAt(vmTarget.copy(vmOrigin).add(vmDirection));vmCamera.updateMatrixWorld(true);vmWorld.copy(VM_LOCAL_OFFSET);vmCamera.localToWorld(vmWorld);vmQuaternion.copy(vmCamera.quaternion);gun.scale.setScalar(1);setWorldPosition(gun,vmWorld);setWorldQuaternion(gun,vmQuaternion);gun.rotateX(-.045);gun.rotateY(-.065);gun.rotateZ(-.018);gun.updateMatrixWorld?.(true);
  const flash=gun.getObjectByName?.("FINAL_MUZZLE_FLASH")||gun.getObjectByName?.("WALK_MUZZLE_FLASH"),muzzle=new THREE.Vector3();flash?.getWorldPosition?.(muzzle);if(view){view.dataset.walkViewmodelOwnership="walk-runtime-single-visibility-owner+pre-fire-pose-sync-v2";view.dataset.walkViewmodelVisibilityOwner="player-walk-mode-v4";view.dataset.walkViewmodelAnchor="current-walk-view-ray-v1";view.dataset.walkViewmodelOrigin=`${vmOrigin.x.toFixed(3)},${vmOrigin.y.toFixed(3)},${vmOrigin.z.toFixed(3)}`;if(flash)view.dataset.walkMuzzleWorld=`${muzzle.x.toFixed(3)},${muzzle.y.toFixed(3)},${muzzle.z.toFixed(3)}`;}return true;
}
function patchFootWeaponFire(){
  const api=footWeapons();if(!api||api===patchedFootWeapons||typeof api.fireAt!=="function")return false;baseFireAt=api.fireAt.bind(api);api.fireAt=args=>{syncViewmodelPose();return baseFireAt(args);};api.__firstPersonPresentationFireSync=true;patchedFootWeapons=api;const view=viewport();if(view)view.dataset.walkMuzzleShotSync="pre-fire-current-pose-v1";return true;
}
function patchRenderFrame(){
  const b=bridge();if(!b||typeof b.renderFrame!=="function")return false;if(b===patchedBridge&&b.renderFrame?.__firstPersonPresentationContract)return true;
  baseRenderFrame=b.renderFrame.bind(b);const wrapper=function(renderer,scene,camera){const fp=footActive(),rig=ensureLocalRig(scene);if(fp&&rig)rig.group.visible=false;try{return baseRenderFrame(renderer,scene,camera);}finally{if(fp&&rig&&!walk()?.dead)rig.group.visible=true;const view=viewport();if(view)view.dataset.walkRenderOwnership="world-avatar-hidden-during-fp-draw+walk-owned-viewmodel-v2";}};wrapper.__firstPersonPresentationContract=true;b.renderFrame=wrapper;patchedBridge=b;return true;
}
function frame(now=performance.now()){patchRenderFrame();patchFootWeaponFire();syncLocalRig(now);requestAnimationFrame(frame);}

export function installFirstPersonPresentationContract(){
  if(installed)return;installed=true;addEventListener("arondight:foot-screen-fire",()=>syncViewmodelPose(),{capture:true});addEventListener("arondight:player-mode",()=>syncLocalRig());const view=viewport();if(view){view.dataset.firstPersonPresentationContract="viewmodel-vs-world-avatar-v2";view.dataset.walkViewmodelOwnership="walk-runtime-single-visibility-owner+pre-fire-pose-sync-v2";view.dataset.walkViewmodelVisibilityOwner="player-walk-mode-v4";}requestAnimationFrame(frame);
}
