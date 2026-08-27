import * as THREE from "three";

const MAX_FOLLOW_M=.08;
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,Number(v)||0));
const basePivotLocal=new THREE.Vector3(),aimStartBasePivotLocal=new THREE.Vector3(),pivotWorld=new THREE.Vector3(),deltaLocal=new THREE.Vector3(),worldOrigin=new THREE.Vector3(),worldDeltaPoint=new THREE.Vector3(),rootWorld=new THREE.Vector3(),rootLocal=new THREE.Vector3();
let installed=false,retryTimer=0,aimBaselineValid=false,wasAimActive=false;

function viewport(){return document.getElementById("viewport");}
function footWeapons(){return globalThis.__arondightFootWeapons||null;}
function pivotNode(gun){return String(footWeapons()?.mode||"pistol")==="smg"?gun?.getObjectByName?.("WALK_SMG_PISTOL_GRIP"):gun?.getObjectByName?.("WALK_VM_GRIP");}
function setWorldPosition(root,position){const parent=root?.parent;if(!root)return;if(!parent){root.position.copy(position);return;}rootLocal.copy(position);parent.worldToLocal(rootLocal);root.position.copy(rootLocal);}
function aimActive(){const v=viewport();return document.body?.classList.contains("foot-ads-active")||v?.dataset.walkWeaponAimActive==="1";}

function installHook(){
  const current=globalThis.__arondightFootWeaponPresentationV1;if(!current||typeof current.apply!=="function"||current.__motionFollowV1)return false;
  const baseApply=current.apply.bind(current);
  const decorated={
    __motionFollowV1:true,
    apply(context={}){
      const camera=context.camera,root=context.gun||context.scene?.getObjectByName?.("WALK_PISTOL_3D"),pivot=root?pivotNode(root):null;
      let baseReady=false;
      if(camera&&root&&pivot){camera.updateMatrixWorld?.(true);root.updateMatrixWorld?.(true);pivot.getWorldPosition(pivotWorld);basePivotLocal.copy(pivotWorld);camera.worldToLocal(basePivotLocal);baseReady=[basePivotLocal.x,basePivotLocal.y,basePivotLocal.z].every(Number.isFinite);}
      const result=baseApply(context),active=aimActive();
      if(active&&baseReady&&camera&&root){
        if(!wasAimActive||!aimBaselineValid){aimStartBasePivotLocal.copy(basePivotLocal);aimBaselineValid=true;}
        deltaLocal.copy(basePivotLocal).sub(aimStartBasePivotLocal);const length=deltaLocal.length();if(length>MAX_FOLLOW_M)deltaLocal.multiplyScalar(MAX_FOLLOW_M/length);
        worldOrigin.set(0,0,0);camera.localToWorld(worldOrigin);worldDeltaPoint.copy(deltaLocal);camera.localToWorld(worldDeltaPoint);worldDeltaPoint.sub(worldOrigin);
        root.getWorldPosition(rootWorld);rootWorld.add(worldDeltaPoint);setWorldPosition(root,rootWorld);root.updateMatrixWorld?.(true);
        const v=viewport();if(v){v.dataset.walkWeaponMovementFollow="base-hip-translation-v1";v.dataset.walkWeaponMovementDeltaM=`${deltaLocal.x.toFixed(4)},${deltaLocal.y.toFixed(4)},${deltaLocal.z.toFixed(4)}`;v.dataset.walkWeaponTranslationPolicy="aim-rotation+current-hip-translation-v5";}
      }else if(!active){aimBaselineValid=false;const v=viewport();if(v){v.dataset.walkWeaponMovementFollow="hip-native";v.dataset.walkWeaponMovementDeltaM="0.0000,0.0000,0.0000";}}
      wasAimActive=active;return result;
    }
  };
  globalThis.__arondightFootWeaponPresentationV1=Object.freeze(decorated);installed=true;const v=viewport();if(v)v.dataset.walkWeaponMotionOwner="first-person-motion-follow-v1";return true;
}

export function installFirstPersonMotionFollow(){
  if(installed)return true;if(installHook())return true;
  if(!retryTimer)retryTimer=setInterval(()=>{if(installHook()){clearInterval(retryTimer);retryTimer=0;}},50);
  setTimeout(()=>{if(retryTimer){clearInterval(retryTimer);retryTimer=0;}},10000);return false;
}

installFirstPersonMotionFollow();
