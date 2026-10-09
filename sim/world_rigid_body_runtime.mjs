import {onTerrainChange} from "./terrain_craters.mjs";
import {WorldRigidBodyPhysics} from "./world_rigid_body_physics.mjs";

const FIXED_DT=1/60;
const MOBILE=globalThis.matchMedia?.("(pointer:coarse)")?.matches||/Android|iPhone|iPad|Mobile/i.test(globalThis.navigator?.userAgent||"");
const MAX_STEPS_PER_FRAME=MOBILE?2:3;
const SOLVER_SUBSTEPS=MOBILE?2:4;
const pendingBodies=new Map(),pendingTargets=new Map();
let engine=null,lastFrame=performance.now(),accumulator=0,lastBuildingSync=-Infinity,lastTelemetry=-Infinity,bootError="";

function viewport(){return document.getElementById("viewport");}
function bridge(){return globalThis.__arondightRealWorld||null;}
function ensureEngine(){
  if(engine)return engine;const b3=globalThis.__arondightBox3dRuntime?.b3;if(!b3)return null;
  try{engine=new WorldRigidBodyPhysics(b3,{buildingSnapshot:bridge()?.buildingCollisionSnapshot,onImpact:detail=>{globalThis.dispatchEvent(new CustomEvent("arondight:world-physics-impact",{detail}));const v=viewport();if(v){v.dataset.worldPhysicsImpacts=String(engine?.impactCount||0);v.dataset.worldPhysicsLastImpact=detail.kind;v.dataset.worldPhysicsLastImpactMps=detail.deltaVelocityMps.toFixed(2);}}});for(const config of pendingBodies.values())engine.addBody(config);for(const[id,target]of pendingTargets)engine.setTarget(id,target);bootError="";}catch(error){bootError=String(error?.message||error);const v=viewport();if(v)v.dataset.worldRigidBodyError=bootError;return null;}return engine;
}
function upsertBody(config={}){const id=String(config.id||"");if(!id)return false;pendingBodies.set(id,{...config,id});const current=ensureEngine();if(current&&!current.records.has(id))current.addBody(pendingBodies.get(id));const target=pendingTargets.get(id);if(current&&target)current.setTarget(id,target);return true;}
function setTarget(id,target={}){
  const key=String(id||""),position=target?.position;if(!key||!Array.isArray(position)||position.length!==3)return false;
  let stored=pendingTargets.get(key);if(!stored){stored={position:[0,0,0],speedMps:0,response:3.2,maxAccelerationMps2:undefined,yaw:null};pendingTargets.set(key,stored);}
  stored.position[0]=Number(position[0])||0;stored.position[1]=Number(position[1])||0;stored.position[2]=Number(position[2])||0;stored.speedMps=Number(target.speedMps)||0;stored.response=target.response??3.2;stored.maxAccelerationMps2=target.maxAccelerationMps2;stored.yaw=Number.isFinite(target.yaw)?Number(target.yaw):null;
  return ensureEngine()?.setTarget(key,stored)??true;
}
function setDrive(id,drive=null){return ensureEngine()?.setDrive?.(String(id||""),drive)??false;}
function clearTarget(id){const key=String(id||"");pendingTargets.delete(key);return ensureEngine()?.clearTarget(key)??false;}
function setPose(id,pose={}){const key=String(id||""),config=pendingBodies.get(key),position=pose?.position;if(!key||!config||!Array.isArray(position)||position.length!==3||!position.every(Number.isFinite))return false;const current=ensureEngine();if(!current?.setPose(key,pose))return false;pendingBodies.set(key,{...config,position:[...position],...(Number.isFinite(pose.yaw)?{yaw:Number(pose.yaw)}:{})});return true;}
function setGravityScale(id,gravityScale=1){const key=String(id||""),value=Number(gravityScale),config=pendingBodies.get(key);if(!key||!Number.isFinite(value)||!config)return false;pendingBodies.set(key,{...config,gravityScale:value});return ensureEngine()?.setGravityScale(key,value)??true;}
function removeBody(id){const key=String(id||"");pendingBodies.delete(key);pendingTargets.delete(key);return ensureEngine()?.removeBody(key)??false;}
function setForces(id,forces){return ensureEngine()?.setForces?.(String(id||""),forces)??false;}
function setFriction(id,f){return ensureEngine()?.setFriction?.(String(id||""),f)??false;}
function createHuman(id,opts){return ensureEngine()?.createHuman?.(String(id||""),opts)||null;}
function human(id){return ensureEngine()?.human?.(id)||null;}
function removeHuman(id){return ensureEngine()?.removeHuman?.(id)??false;}
function applyAngularImpulse(id,L){return ensureEngine()?.applyAngularImpulse?.(String(id||""),L)??false;}
function impulseHumanAt(point,impulse,radius){return ensureEngine()?.impulseHumanAt?.(point,impulse,radius)??false;}
function pushHuman(id,dv,spin){return ensureEngine()?.pushHuman?.(id,dv,spin)??false;}
function blast(center,options){return ensureEngine()?.blast?.(center,options)??0;}
function setController(id,fn){const key=String(id||""),config=pendingBodies.get(key);if(config)pendingBodies.set(key,{...config,controller:typeof fn==="function"?fn:null});return ensureEngine()?.setController?.(key,fn)??Boolean(config);}
function applyImpulse(id,impulse,options){return ensureEngine()?.applyImpulse(String(id||""),impulse,options)??false;}
function pose(id,out=null){return ensureEngine()?.pose(String(id||""),out)||null;}
function raycast(origin,direction,maxDistance=2000,options){return ensureEngine()?.raycast(origin,direction,maxDistance,options)||null;}

function updateTelemetry(now){if(now-lastTelemetry<250)return;lastTelemetry=now;const v=viewport(),current=engine;if(!v)return;const records=current?[...current.records.values()]:[],vehicles=records.filter(record=>!record.drone).length,drones=records.length-vehicles;v.dataset.worldRigidBodyPhysics=current?"box3d-dynamic-forces-v1":bootError?"error":"waiting-box3d";v.dataset.worldPhysicsBodies=String(records.length);v.dataset.worldPhysicsVehicles=String(vehicles);v.dataset.worldPhysicsDrones=String(drones);v.dataset.worldPhysicsImpacts=String(current?.impactCount||0);v.dataset.worldPhysicsSteps=String(current?.stepCount||0);v.dataset.worldPhysicsBuildingPrisms=String(current?.buildingState?.shapeCount||0);v.dataset.worldPhysicsContinuous="1";v.dataset.worldPhysicsControl="force+torque+impulse";v.dataset.worldPhysicsGravityScale="runtime-v1";v.dataset.worldPhysicsProjectileQuery="category8-mask7-symmetric-v1";v.dataset.worldPhysicsBudget=`${MAX_STEPS_PER_FRAME}x${SOLVER_SUBSTEPS}`;}
function frame(now=performance.now()){
  requestAnimationFrame(frame);const current=ensureEngine(),elapsed=Math.max(0,Math.min(.10,(now-lastFrame)/1000));lastFrame=now;if(!current){updateTelemetry(now);return;}if(now-lastBuildingSync>350){lastBuildingSync=now;current.syncBuildings(bridge()?.buildingCollisionSnapshot);}if(current.records.size){accumulator=Math.min(.075,accumulator+elapsed);let steps=0;while(accumulator>=FIXED_DT&&steps<MAX_STEPS_PER_FRAME){current.step(FIXED_DT,SOLVER_SUBSTEPS,now);accumulator-=FIXED_DT;steps++;}}else accumulator=0;updateTelemetry(now);
}

onTerrainChange((_craters,regions)=>{try{engine?.rebuildTerrain?.(regions??null);}catch(error){console.warn("rigid terrain",error);}});
export // every registered body (id, kind, half extents, mass) — e.g. vehicle-vs-pedestrian checks
function bodies(){const current=ensureEngine();const out=[];for(const b of pendingBodies.values())if(!current||current.records.has(b.id))out.push(b);return out;}
const worldRigidBodyRuntime=Object.freeze({blast,bodies,setForces,setController,setFriction,createHuman,human,removeHuman,pushHuman,impulseHumanAt,applyAngularImpulse,upsertBody,setTarget,setDrive,clearTarget,setPose,setGravityScale,removeBody,applyImpulse,pose,raycast,get ready(){return Boolean(ensureEngine());},get engine(){return ensureEngine();}});
globalThis.__arondightWorldRigidBodies=worldRigidBodyRuntime;
requestAnimationFrame(frame);
