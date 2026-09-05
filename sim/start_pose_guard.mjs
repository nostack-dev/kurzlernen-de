import * as THREE from "three";

const GROUND_PLANE_Z_M=0;
const GROUND_EPSILON_M=1e-6;
const MAX_BOOT_ATTEMPTS=8;
let armToolbarInstalled=false;

function installArmToolbarControl(){
  if(armToolbarInstalled)return;armToolbarInstalled=true;
  if(!document.querySelector("style[data-arm-toolbar-guard]")){
    const style=document.createElement("style");style.dataset.armToolbarGuard="v1";style.textContent=`
      body.solo-flight #soloArmToolbar{display:inline-flex!important;align-items:center;justify-content:center;min-width:68px!important;min-height:30px!important;padding:5px 10px!important;border-color:#63e7b8!important;background:#17694f!important;color:#fff!important;font-weight:900!important;letter-spacing:.04em!important}
      body.solo-flight #soloArmToolbar[data-state="armed"]{border-color:#ff8795!important;background:#7d2635!important}
      body.solo-flight #soloArmToolbar[data-state="arming"]{border-color:#ffd06d!important;background:#6f5420!important}
      body.solo-flight #soloArmToolbar:disabled{opacity:.72!important}
      @media(max-height:340px){body.solo-flight #soloArmToolbar{min-width:58px!important;padding:4px 7px!important;font-size:9px!important}}
    `;document.head.appendChild(style);
  }
  const mount=()=>{
    const source=document.getElementById("soloArm"),actions=document.getElementById("soloTopbarActions");
    if(!source||!actions)return false;
    let button=document.getElementById("soloArmToolbar");
    if(!button){
      button=document.createElement("button");button.id="soloArmToolbar";button.type="button";button.setAttribute("aria-label","Arm drone");
      button.addEventListener("click",event=>{event.preventDefault();event.stopPropagation();source.click();});
      actions.appendChild(button);
    }
    const sync=()=>{
      const state=(document.getElementById("soloState")?.textContent||"").trim().toUpperCase();
      const armed=source.classList.contains("armed")||state==="ARMED";
      const arming=!armed&&(source.classList.contains("arming")||state==="ARMING");
      button.dataset.state=armed?"armed":arming?"arming":"disarmed";
      button.textContent=armed?"DISARM":arming?"ARMING…":"ARM";
      button.disabled=!armed&&source.disabled;
      button.setAttribute("aria-label",armed?"Disarm drone":"Arm drone");
    };
    sync();
    if(!source.dataset.toolbarGuardObserved){
      source.dataset.toolbarGuardObserved="1";
      new MutationObserver(sync).observe(source,{attributes:true,childList:true,characterData:true,subtree:true});
      const state=document.getElementById("soloState");if(state)new MutationObserver(sync).observe(state,{childList:true,characterData:true,subtree:true});
    }
    return true;
  };
  if(!mount()){
    const observer=new MutationObserver(()=>{if(mount())observer.disconnect();});
    observer.observe(document.documentElement,{childList:true,subtree:true});
  }
}

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
  installArmToolbarControl();
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
