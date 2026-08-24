import {WorldRigidBodyPhysics} from "./world_rigid_body_physics.mjs";

const FIXED_DT=1/60;
const MAX_STEPS_PER_FRAME=3;
const pendingBodies=new Map(),pendingTargets=new Map();
let engine=null,lastFrame=performance.now(),accumulator=0,lastBuildingSync=-Infinity,lastTelemetry=-Infinity,bootError="";

function viewport(){return document.getElementById("viewport");}
function bridge(){return globalThis.__arondightRealWorld||null;}
function ensureEngine(){
  if(engine)return engine;const b3=globalThis.__arondightBox3dRuntime?.b3;if(!b3)return null;
  try{engine=new WorldRigidBodyPhysics(b3,{buildingSnapshot:bridge()?.buildingCollisionSnapshot,onImpact:detail=>{globalThis.dispatchEvent(new CustomEvent("arondight:world-physics-impact",{detail}));const v=viewport();if(v){v.dataset.worldPhysicsImpacts=String(engine?.impactCount||0);v.dataset.worldPhysicsLastImpact=detail.kind;v.dataset.worldPhysicsLastImpactMps=detail.deltaVelocityMps.toFixed(2);}}});for(const config of pendingBodies.values())engine.addBody(config);for(const[id,target]of pendingTargets)engine.setTarget(id,target);bootError="";}catch(error){bootError=String(error?.message||error);const v=viewport();if(v)v.dataset.worldRigidBodyError=bootError;return null;}return engine;
}
function upsertBody(config={}){const id=String(config.id||"");if(!id)return false;pendingBodies.set(id,{...config,id});const current=ensureEngine();if(current&&!current.records.has(id))current.addBody(pendingBodies.get(id));const target=pendingTargets.get(id);if(current&&target)current.setTarget(id,target);return true;}
function setTarget(id,target={}){const key=String(id||"");if(!key)return false;pendingTargets.set(key,{...target,position:Array.isArray(target.position)?[...target.position]:target.position});return ensureEngine()?.setTarget(key,pendingTargets.get(key))??true;}
function clearTarget(id){const key=String(id||"");pendingTargets.delete(key);return ensureEngine()?.clearTarget(key)??false;}
function setPose(id,pose={}){const key=String(id||""),config=pendingBodies.get(key),position=pose?.position;if(!key||!config||!Array.isArray(position)||position.length!==3||!position.every(Number.isFinite))return false;const current=ensureEngine();if(!current?.setPose(key,pose))return false;pendingBodies.set(key,{...config,position:[...position],...(Number.isFinite(pose.yaw)?{yaw:Number(pose.yaw)}:{})});return true;}
function setGravityScale(id,gravityScale=1){const key=String(id||""),value=Number(gravityScale),config=pendingBodies.get(key);if(!key||!Number.isFinite(value)||!config)return false;pendingBodies.set(key,{...config,gravityScale:value});return ensureEngine()?.setGravityScale(key,value)??true;}
function removeBody(id){const key=String(id||"");pendingBodies.delete(key);pendingTargets.delete(key);return ensureEngine()?.removeBody(key)??false;}
function applyImpulse(id,impulse,options){return ensureEngine()?.applyImpulse(String(id||""),impulse,options)??false;}
function pose(id){return ensureEngine()?.pose(String(id||""))||null;}

function updateTelemetry(now){if(now-lastTelemetry<250)return;lastTelemetry=now;const v=viewport(),current=engine;if(!v)return;const records=current?[...current.records.values()]:[],vehicles=records.filter(record=>!record.drone).length,drones=records.length-vehicles;v.dataset.worldRigidBodyPhysics=current?"box3d-dynamic-forces-v1":bootError?"error":"waiting-box3d";v.dataset.worldPhysicsBodies=String(records.length);v.dataset.worldPhysicsVehicles=String(vehicles);v.dataset.worldPhysicsDrones=String(drones);v.dataset.worldPhysicsImpacts=String(current?.impactCount||0);v.dataset.worldPhysicsSteps=String(current?.stepCount||0);v.dataset.worldPhysicsBuildingPrisms=String(current?.buildingState?.shapeCount||0);v.dataset.worldPhysicsContinuous="1";v.dataset.worldPhysicsControl="force+torque+impulse";v.dataset.worldPhysicsGravityScale="runtime-v1";}
function frame(now=performance.now()){
  requestAnimationFrame(frame);const current=ensureEngine(),elapsed=Math.max(0,Math.min(.10,(now-lastFrame)/1000));lastFrame=now;if(!current){updateTelemetry(now);return;}if(now-lastBuildingSync>350){lastBuildingSync=now;current.syncBuildings(bridge()?.buildingCollisionSnapshot);}if(current.records.size){accumulator=Math.min(.075,accumulator+elapsed);let steps=0;while(accumulator>=FIXED_DT&&steps<MAX_STEPS_PER_FRAME){current.step(FIXED_DT,4,now);accumulator-=FIXED_DT;steps++;}}else accumulator=0;updateTelemetry(now);
}

export const worldRigidBodyRuntime=Object.freeze({upsertBody,setTarget,clearTarget,setPose,setGravityScale,removeBody,applyImpulse,pose,get ready(){return Boolean(ensureEngine());},get engine(){return ensureEngine();}});
globalThis.__arondightWorldRigidBodies=worldRigidBodyRuntime;
requestAnimationFrame(frame);
