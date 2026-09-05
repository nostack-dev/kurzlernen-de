import "./gameplay_polish_lite.mjs";
import "./combat_visual_polish.mjs";
import "./mobile_zoom_guard.mjs";
import "./world_action_feedback.mjs";
import "./foot_look_capture.mjs";
import "./player_vitals_runtime.mjs";
import "./walk_world_experience_hotfix.mjs";
import "./wanted_police_pre_guard.mjs";
import "./wanted_police_drones.mjs";
import "./world_rigid_body_runtime.mjs";
import "./camera_collision_guard.mjs";
import "./world_network_physics_sync.mjs";
import "./world_explosion_acoustics.mjs";
import "./walk_ui_layout_hotfix.mjs";
import "./combat_hit_stack_guard.mjs";
import {buildingLaunchPointClear} from "./world_building_collision_physics.mjs";

let installed=false;

export function installWorldSpawnGuard(){
  if(installed)return true;const bridge=globalThis.__arondightRealWorld;if(!bridge||typeof bridge.attachBuildingCollisionSink!=="function")return false;installed=true;
  const baseAttach=bridge.attachBuildingCollisionSink.bind(bridge);let lastPrismCount=0;
  bridge.attachBuildingCollisionSink=sink=>baseAttach(snapshot=>{
    const prismCount=Math.max(0,Number(snapshot?.prismCount)||0),firstLoaded=lastPrismCount===0&&prismCount>0,scene=bridge.threeScene,airframe=scene?bridge.airframeFor?.(scene):null,p=airframe?.position,nearGround=Number.isFinite(p?.z)&&p.z<.35,unsafeBefore=firstLoaded&&nearGround&&!buildingLaunchPointClear(snapshot,[Number(p?.x)||0,Number(p?.y)||0],{clearanceM:.9});
    lastPrismCount=prismCount;
    // PhysicsModel.setWorldBuildingCollisions() already resolves a collision-free
    // launch point before it creates the static building bodies and then snaps the
    // rigid body to the actual Box3D support surface. A UI RESET here used to
    // destroy that freshly rebuilt Box3D world and put the aircraft back at the
    // original GPS origin, which could leave the visual/physics spawn buried and
    // NAV invalid. Keep exactly one owner: the collision sink.
    const result=sink(snapshot);
    const viewport=document.getElementById("viewport");if(viewport){viewport.dataset.worldSpawnGuard=unsafeBefore?"physics-relocate":firstLoaded?"clear":prismCount?"tracking":"waiting";viewport.dataset.worldSpawnGuardPrisms=String(prismCount);viewport.dataset.worldSpawnGuardPolicy="physics-sink-single-owner-v2";}
    return result;
  });
  return true;
}

installWorldSpawnGuard();
