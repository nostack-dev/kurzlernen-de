import * as THREE from "three";

const GROUND_PLANE_Z_M=0;
const GROUND_EPSILON_M=1e-6;
const MAX_BOOT_ATTEMPTS=8;

function findAirframe(scene,bridge){
  const cached=bridge?.airframeFor?.(scene);
  if(cached)return cached;
  let airframe=null;
  scene?.traverse?.(node=>{if(!airframe&&node?.userData?.arondightAirframe)airframe=node;});
  return airframe;
}

function visualBottom(airframe){
  airframe.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(airframe);
  return Number.isFinite(bounds.min.z)?bounds.min.z:null;
}

export function installInitialAirframeGroundPose(){
  let finished=false,attempts=0;
  const apply=()=>{
    const bridge=globalThis.__arondightRealWorld,scene=bridge?.threeScene,viewport=document.getElementById("viewport");
    if(!scene||!viewport)return false;
    const airframe=findAirframe(scene,bridge);
    if(!airframe)return false;

    // Physics owns every runtime pose. This guard only closes the construction-time
    // gap where the Three.js group exists at Object3D's default z=0 before the
    // first PhysicsModel.render() copies the already-correct Box3D spawn pose.
    const simTime=Number(globalThis.__arondightDiagnostics?.simTime);
    if(Number.isFinite(simTime)&&simTime>.001){
      viewport.dataset.initialAirframeGroundPose="late";
      return true;
    }

    const before=visualBottom(airframe);
    if(before===null)return false;
    const lift=Math.max(0,GROUND_PLANE_Z_M-before);
    if(lift>GROUND_EPSILON_M){
      airframe.position.z+=lift;
      airframe.updateMatrixWorld(true);
    }
    const after=visualBottom(airframe);
    if(after===null)return false;
    airframe.userData.initialGroundPoseApplied=true;
    viewport.dataset.initialAirframeGroundPose="1";
    viewport.dataset.initialAirframeVisualBottomM=after.toFixed(6);
    return after>=-GROUND_EPSILON_M;
  };

  const retry=()=>{
    if(finished)return;
    finished=apply();
    if(!finished&&++attempts<MAX_BOOT_ATTEMPTS)requestAnimationFrame(retry);
  };
  finished=apply();
  if(!finished)requestAnimationFrame(retry);
  return finished;
}
