import "./aim_magnifier_overlay.mjs";
import {createPlayerHumanRig,setPlayerHumanFootParent,hidePlayerHumanRig} from "./player_human_rig.mjs";

let installed=false,localRig=null,localRigScene=null,lastRigSample=null,patchedBridge=null,baseRenderFrame=null;

function viewport(){return document.getElementById("viewport");}
function bridge(){return globalThis.__arondightRealWorld||null;}
function walk(){return globalThis.__arondightWalkMode||null;}
function drive(){return globalThis.__arondightVehicleDrive||null;}
function footWeapons(){return globalThis.__arondightFootWeapons||null;}
function footActive(){const w=walk();return w?.mode==="foot"&&!drive()?.active&&!w?.dead;}
function weaponMode(){return String(footWeapons()?.mode||viewport()?.dataset?.walkWeapon||"pistol")==="smg"?"smg":"pistol";}

function markPresentationOnly(rig){
  rig.group.name="LOCAL_FOOT_THIRD_PERSON";
  rig.group.userData.localThirdPersonAvatar=true;
  rig.group.userData.playerHumanRig=true;
  rig.hitbox.visible=false;
  rig.group.traverse(node=>{
    node.userData.flightFireIgnore=true;
    node.userData.worldPopulationClone=true;
    node.userData.aimAssistDisabled=true;
    if(node.isMesh)node.userData.localThirdPersonPresentation=true;
  });
}
function ensureLocalRig(scene){
  if(!scene)return null;
  if(localRigScene!==scene){localRig?.group?.parent?.remove(localRig.group);localRig=null;localRigScene=scene;lastRigSample=null;}
  if(!localRig){localRig=createPlayerHumanRig({id:"local-third-person",color:0x29d6ff});markPresentationOnly(localRig);scene.add(localRig.group);}
  return localRig;
}
function syncLocalRig(now=performance.now()){
  const scene=bridge()?.threeScene,w=walk(),rig=ensureLocalRig(scene),view=viewport();if(!rig)return false;
  if(!footActive()||!w?.position){hidePlayerHumanRig(rig);lastRigSample=null;if(view)view.dataset.walkThirdPersonMesh="hidden-non-foot";return false;}
  setPlayerHumanFootParent(rig,scene);
  const x=Number(w.position.x)||0,y=Number(w.position.y)||0,yaw=Number(w.yaw)||0,pitch=Number(w.pitch)||0;
  let speed=0;if(lastRigSample){const dt=(now-lastRigSample.at)/1000;if(dt>.001&&dt<.5)speed=Math.hypot(x-lastRigSample.x,y-lastRigSample.y)/dt;}lastRigSample={x,y,at:now};
  const moving=speed>.12,gait=moving?Math.sin(now*.0105)*Math.min(.72,.18+speed*.075):0;
  rig.group.position.set(x,y,0);rig.group.rotation.set(0,0,-yaw);rig.leftLeg.rotation.x=gait;rig.rightLeg.rotation.x=-gait;rig.leftArm.rotation.x=moving?-gait*.72:-.28;rig.rightArm.rotation.x=moving?gait*.72:-.28;rig.aimRig.rotation.x=pitch;
  const mode=weaponMode();rig.pistol.visible=mode!=="smg";rig.smg.visible=mode==="smg";rig.aimRig.visible=true;rig.hitbox.visible=false;rig.group.visible=true;
  if(view){view.dataset.walkThirdPersonMesh="local-world-rig+fp-hidden-v2";view.dataset.walkThirdPersonWeapon=mode;view.dataset.walkThirdPersonPose=`${x.toFixed(3)},${y.toFixed(3)},0.000`;view.dataset.walkThirdPersonSpeedMps=speed.toFixed(3);}
  return true;
}
function patchRenderFrame(){
  const b=bridge();if(!b||typeof b.renderFrame!=="function")return false;
  if(b===patchedBridge&&b.renderFrame?.__firstPersonPresentationContract)return true;
  baseRenderFrame=b.renderFrame.bind(b);
  const wrapper=function(renderer,scene,camera){
    const fp=footActive(),rig=ensureLocalRig(scene);if(fp&&rig)rig.group.visible=false;
    try{return baseRenderFrame(renderer,scene,camera);}finally{
      if(fp&&rig&&!walk()?.dead)rig.group.visible=true;
      const view=viewport();if(view)view.dataset.walkRenderOwnership="world-avatar-hidden-during-fp-draw+weapon-runtime-single-owner-v4";
    }
  };
  wrapper.__firstPersonPresentationContract=true;b.renderFrame=wrapper;patchedBridge=b;return true;
}
function publishOwner(){
  const view=viewport();if(!view)return;
  const owner=globalThis.__arondightFootWeaponPresentationV1;
  view.dataset.firstPersonPresentationContract="world-avatar-only+weapon-runtime-owner-v4";
  view.dataset.walkViewmodelOwnership="player-walk-mode-v4+first-person-weapon-runtime-v3";
  view.dataset.walkViewmodelVisibilityOwner="player-walk-mode-v4";
  view.dataset.walkViewmodelTransformOwner=typeof owner?.apply==="function"?"first-person-weapon-runtime-v3":"waiting";
}
function frame(now=performance.now()){patchRenderFrame();syncLocalRig(now);publishOwner();requestAnimationFrame(frame);}

export function installFirstPersonPresentationContract(){
  if(installed)return;installed=true;
  addEventListener("arondight:player-mode",()=>syncLocalRig());
  publishOwner();requestAnimationFrame(frame);
}

installFirstPersonPresentationContract();
