import {wantedDetectionRadiusM,wantedLineBlockedByPrisms,wantedPoliceArrivalDelayMs,wantedPoliceFireRangeM} from "./wanted_system_logic.mjs";

let installed=false,patchedVitals=null,baseDamageTargets=null,lastStars=0;
const seenSpawnSerial=new Map();
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,Number(v)||0));

function viewport(){return document.getElementById("viewport");}
function bridge(){return globalThis.__arondightRealWorld||null;}
function wanted(){return globalThis.__arondightWantedSystem||null;}
function rigidBodies(){return globalThis.__arondightWorldRigidBodies||null;}
function activeTargetKind(){const mode=String(globalThis.__arondightGtaRuntime?.mode||globalThis.__arondightWalkMode?.mode||"drone");return mode==="drone"?"drone":"player";}
function targetPoint(target){const p=target?.position;return p&&[p.x,p.y,p.z].every(Number.isFinite)?p:null;}
function distance(a,b){return Math.hypot((Number(a?.x)||0)-(Number(b?.x)||0),(Number(a?.y)||0)-(Number(b?.y)||0),(Number(a?.z)||0)-(Number(b?.z)||0));}
function lineOfSight(from,to){return !wantedLineBlockedByPrisms(from,to,bridge()?.buildingCollisionSnapshot?.prisms);}

function patchDamageTargets(){
  const vitals=globalThis.__arondightPlayerVitals;if(!vitals||vitals===patchedVitals)return Boolean(vitals);
  const base=typeof vitals.damageTargets==="function"?vitals.damageTargets.bind(vitals):null;if(!base)return false;
  patchedVitals=vitals;baseDamageTargets=base;vitals.damageTargets=()=>base().filter(target=>target?.kind===activeTargetKind());vitals.__wantedFairTargetFilterV5=true;
  const v=viewport();if(v)v.dataset.wantedPoliceDamageRouting="controlled-target-only-v1";return true;
}

function freezeInbound(drone,now,stars){
  const serial=Number(drone?.spawnSerial)||0,known=seenSpawnSerial.get(drone.index);if(known===serial)return;
  seenSpawnSerial.set(drone.index,serial);if(!drone.active)return;
  const wave=Number(wanted()?.state?.waveNumber)||0;if(wave!==1)return;
  const delay=wantedPoliceArrivalDelayMs(stars),p=drone.root.position;drone.__fairArrival={until:now+delay,position:[p.x,p.y,p.z],yaw:Number(drone.root.rotation?.z)||0};drone.engageAt=Math.max(Number(drone.engageAt)||0,now+delay+1200);drone.nextShotAt=Infinity;drone.root.visible=false;drone.hitbox.visible=false;drone.tracer.visible=false;
}

function holdInbound(drone,now){
  const lock=drone.__fairArrival;if(!lock)return false;
  if(now>=lock.until){delete drone.__fairArrival;drone.root.visible=true;drone.hitbox.visible=true;drone.nextShotAt=Math.max(Number(drone.engageAt)||now,now+250+drone.index*90);return false;}
  drone.root.visible=false;drone.hitbox.visible=false;drone.tracer.visible=false;drone.seesPlayer=false;drone.targetKind="";drone.distance=Infinity;drone.nextShotAt=Infinity;
  const physics=rigidBodies(),id=`police-drone-${drone.index}`;physics?.clearTarget?.(id);physics?.setPose?.(id,{position:lock.position,yaw:lock.yaw,velocity:[0,0,0],angularVelocity:[0,0,0]});drone.root.position.set(lock.position[0],lock.position[1],lock.position[2]);drone.root.rotation.set(0,0,lock.yaw);return true;
}

function currentActiveTarget(){
  const base=baseDamageTargets;if(typeof base!=="function")return null;const kind=activeTargetKind();return base().find(target=>target?.kind===kind&&Number(target.hp)>0&&targetPoint(target))||null;
}

function enforceSensors(now){
  const api=wanted(),state=api?.state;if(!api||!state)return;const stars=Number(state.stars)||0;if(stars<=0){lastStars=0;return;}if(lastStars<=0)seenSpawnSerial.clear();lastStars=stars;
  const target=currentActiveTarget(),p=targetPoint(target),detect=wantedDetectionRadiusM(stars),fire=wantedPoliceFireRangeM(stars),v=viewport();let visibleCount=0,lockedCount=0;
  for(const drone of api.drones||[]){
    if(!drone?.active)continue;freezeInbound(drone,now,stars);drone.nextSensorAt=Infinity;if(holdInbound(drone,now)){lockedCount++;continue;}
    if(drone.empDisabled||drone.retreating||!target||!p||drone.root.visible===false){drone.seesPlayer=false;drone.targetKind="";drone.distance=Infinity;drone.tracer.visible=false;continue;}
    const actualDistance=distance(drone.root.position,p),los=actualDistance<=detect&&lineOfSight(drone.root.position,p);if(!los){drone.seesPlayer=false;drone.targetKind="";drone.distance=Infinity;drone.tracer.visible=false;drone.__fairFireLocked=true;drone.nextShotAt=Infinity;continue;}
    visibleCount++;drone.seesPlayer=true;drone.targetKind=target.kind;drone.targetPosition.set(p.x,p.y,p.z);drone.targetSpeedMps=target.kind==="drone"?clamp(Number(v?.dataset?.wantedPlayerSpeedMps)||0,0,20):clamp(Number(target.speedMps)||0,0,20);drone.__fairActualDistance=actualDistance;
    const canFire=actualDistance>=5&&actualDistance<=fire&&now>=Number(drone.engageAt||0);drone.distance=canFire?actualDistance:999;
    if(!canFire){drone.__fairFireLocked=true;drone.nextShotAt=Infinity;drone.tracer.visible=false;}else if(drone.__fairFireLocked){drone.__fairFireLocked=false;drone.nextShotAt=now+280+drone.index*70;}
  }
  if(v){v.dataset.wantedSystem="heat+fair-physics-police-drones-v5";v.dataset.wantedPoliceTargeting="controlled-target+fresh-los+hard-range-v2";v.dataset.wantedPoliceFireRangeM=fire.toFixed(1);v.dataset.wantedPoliceMaxFireRangeM="35";v.dataset.wantedPoliceInitialArrivalMs=String(wantedPoliceArrivalDelayMs(stars));v.dataset.wantedPoliceInboundHidden=String(lockedCount);v.dataset.wantedPoliceFreshLos=String(visibleCount);v.dataset.wantedPoliceGhostHits="blocked-v1";v.dataset.wantedPoliceSpawn="delayed-dispatch-far-inbound-v4";}
}

function frame(now=performance.now()){patchDamageTargets();enforceSensors(now);requestAnimationFrame(frame);}
export function installWantedPoliceFairnessV5(){if(installed)return;installed=true;requestAnimationFrame(frame);}
installWantedPoliceFairnessV5();
