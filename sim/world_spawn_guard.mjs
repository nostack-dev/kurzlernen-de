import "./gameplay_polish_lite.mjs";
import "./combat_visual_polish.mjs";
import "./mobile_zoom_guard.mjs";
import "./world_action_feedback.mjs";
import "./foot_look_capture.mjs";
import "./walk_world_experience_hotfix.mjs";
import "./world_visibility_continuity.mjs";
import "./walk_weapon_system.mjs";
import "./walk_aim_state_sync.mjs";
import "./walk_ui_layout_hotfix.mjs";
import {buildingLaunchPointClear} from "./world_building_collision_physics.mjs";

let installed=false,lateCombatIndexTimer=0,combatBootPromise=null;

function bootCombatAfterWorldReality(){
  if(combatBootPromise)return combatBootPromise;
  // walk_world_experience_hotfix schedules its first RAF from a zero-delay timer.
  // Boot Box3D from the following timer so every frame stays ordered:
  // WORLD base pose -> WALK presentation/reaction pose -> Box3D target sync/step.
  combatBootPromise=new Promise(resolve=>setTimeout(resolve,0)).then(()=>import("./box3d_combat_world.mjs")).then(module=>{
    const viewport=document.getElementById("viewport");if(viewport)viewport.dataset.box3dCombatFrameOrder="world-reality-box3d-v1";return module;
  });
  return combatBootPromise;
}

function syncLatePopulationCombatTargets(){
  const bridge=globalThis.__arondightRealWorld,scene=bridge?.threeScene,combat=globalThis.__arondightBox3dCombat,viewport=document.getElementById("viewport");
  let registered=0,pending=0;
  if(scene&&typeof combat?.registerTarget==="function")scene.traverse(node=>{
    if(!node?.isGroup||node.userData?.worldPopulationClone||node.userData?.box3dCombatBody)return;
    const id=String(node.userData?.worldPopulationId||""),kind=String(node.userData?.worldPopulationKind||"");
    if(!id||!(kind==="car"||kind==="person"))return;
    pending++;
    if(combat.registerTarget(node))registered++;
  });
  if(viewport){viewport.dataset.box3dLatePopulationPending=String(pending);viewport.dataset.box3dLatePopulationRegistered=String((Number(viewport.dataset.box3dLatePopulationRegistered)||0)+registered);}
  clearTimeout(lateCombatIndexTimer);
  lateCombatIndexTimer=setTimeout(syncLatePopulationCombatTargets,250);
}

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

function installLoop(){if(!installWorldSpawnGuard())requestAnimationFrame(installLoop);}

// Population groups are created before route-derived IDs exist. Start this
// independently of the building spawn guard so late IDs always become physical
// Box3D combat targets, even when the RealWorld bridge finishes booting later.
bootCombatAfterWorldReality();
syncLatePopulationCombatTargets();
installLoop();
