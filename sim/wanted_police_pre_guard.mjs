import {wantedDetectionRadiusM,wantedLineBlockedByPrisms,wantedPoliceFireRangeM} from "./wanted_system_logic.mjs";
function viewport(){return document.getElementById("viewport");}
function controlledKind(){return globalThis.__arondightVehicleDrive?.active||globalThis.__arondightWalkMode?.mode==="foot"?"player":"drone";}
function controlledTarget(){const kind=controlledKind(),targets=globalThis.__arondightPlayerVitals?.damageTargets?.()||[];return targets.find(target=>target?.kind===kind&&target?.position&&Number(target?.hp)>0)||null;}
function frame(now=performance.now()){
  const api=globalThis.__arondightWantedSystem,state=api?.state;if(api&&state?.stars>0){const kind=controlledKind(),target=controlledTarget(),fireRange=wantedPoliceFireRangeM(state.stars),chaseRange=wantedDetectionRadiusM(state.stars),prisms=globalThis.__arondightRealWorld?.buildingCollisionSnapshot?.prisms||[];
    for(const drone of api.drones||[]){if(!drone?.active||drone.empDisabled||drone.retreating)continue;const hidden=drone.root?.visible===false,distance=target?.position?drone.root.position.distanceTo(target.position):Infinity,blocked=target?.position?wantedLineBlockedByPrisms(drone.root.position,target.position,prisms):true,canTrack=Boolean(target&&!hidden&&!blocked&&distance<=chaseRange);
      if(canTrack){drone.targetKind=kind;drone.targetPosition?.set?.(Number(target.position.x)||0,Number(target.position.y)||0,Number(target.position.z)||0);drone.targetSpeedMps=Number(target.speedMps)||0;drone.distance=distance;drone.seesPlayer=true;}
      else{drone.seesPlayer=false;drone.nextSensorAt=Math.max(Number(drone.nextSensorAt)||0,now+55);}
      if(!canTrack||distance>fireRange){drone.nextShotAt=Math.max(Number(drone.nextShotAt)||0,now+190);}
    }
    const view=viewport();if(view){view.dataset.wantedPoliceFireRangeM=fireRange.toFixed(1);view.dataset.wantedPoliceChaseRangeM=chaseRange.toFixed(1);view.dataset.wantedPoliceGhostHits="blocked-v3";view.dataset.wantedPoliceDamageRouting="controlled-target-local-filter-v3";view.dataset.wantedPoliceChase="controlled-body+los-pursuit-v2";}}
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
