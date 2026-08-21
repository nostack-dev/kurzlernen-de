import "./gameplay_polish_lite.mjs";
import "./combat_visual_polish.mjs";
import "./mobile_zoom_guard.mjs";
import "./world_action_feedback.mjs";
import "./foot_look_capture.mjs";
import "./walk_world_experience_hotfix.mjs";
import "./world_visibility_continuity.mjs";
import "./walk_weapon_system.mjs";
import "./walk_ui_layout_hotfix.mjs";
import {buildingLaunchPointClear} from "./world_building_collision_physics.mjs";

let installed=false;

export function installWorldSpawnGuard(){
  if(installed)return true;const bridge=globalThis.__arondightRealWorld;if(!bridge||typeof bridge.attachBuildingCollisionSink!=="function")return false;installed=true;
  const baseAttach=bridge.attachBuildingCollisionSink.bind(bridge);let lastPrismCount=0,resetQueued=false;
  bridge.attachBuildingCollisionSink=sink=>baseAttach(snapshot=>{
    const prismCount=Math.max(0,Number(snapshot?.prismCount)||0),firstLoaded=lastPrismCount===0&&prismCount>0,scene=bridge.threeScene,airframe=scene?bridge.airframeFor?.(scene):null,p=airframe?.position,nearGround=Number.isFinite(p?.z)&&p.z<.35,unsafe=firstLoaded&&nearGround&&!buildingLaunchPointClear(snapshot,[Number(p?.x)||0,Number(p?.y)||0],{clearanceM:.9});
    lastPrismCount=prismCount;sink(snapshot);
    const viewport=document.getElementById("viewport");if(viewport){viewport.dataset.worldSpawnGuard=unsafe?"relocate":firstLoaded?"clear":prismCount?"tracking":"waiting";viewport.dataset.worldSpawnGuardPrisms=String(prismCount);}
    if(!unsafe||resetQueued)return;resetQueued=true;queueMicrotask(()=>{
      resetQueued=false;const button=document.getElementById("soloReset");if(!button)return;if(viewport){viewport.dataset.worldSpawnGuardResets=String((Number(viewport.dataset.worldSpawnGuardResets)||0)+1);viewport.dataset.worldSpawnGuard="resetting-to-clear-launch";}button.click();
    });
  });
  return true;
}

installWorldSpawnGuard();
