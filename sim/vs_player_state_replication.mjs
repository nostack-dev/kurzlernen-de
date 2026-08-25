import * as THREE from "three";
import {createPlayerHumanRig,setPlayerHumanFootParent,setPlayerHumanVehiclePose} from "./player_human_rig.mjs";
import {VsPoseTimeline} from "./vs_pose_sync.mjs";
import {VS_GAME_EVENT,VS_PEER_EVENT,VS_POSE_EVENT} from "./lan_vs.mjs";

const EYE_Z=1.68;
const EARTH_RADIUS_M=6378137;
const STALE_MS=3000;
const PATCH_RETRY_MS=80;
const PALETTE=[0x29d6ff,0xff6b35,0x8cf43f,0xff4fd8,0xffd83d,0x9b7bff,0x24e6a1,0xff405f,0x43a8ff,0xff9f1c,0x7ce7ff,0xd6ff4b];
const records=new Map();
let installed=false,patchedSession=null,patchedSetPose=null,baseSetPose=null,lastPatchAt=-Infinity,localMode="drone",localSample=null,txSequence=0;

const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));
const finiteArray=(value,length)=>Array.isArray(value)&&value.length===length&&value.every(Number.isFinite);
function bridge(){return globalThis.__arondightRealWorld||null;}
function viewport(){return document.getElementById("viewport");}
function session(){return bridge()?.vsSession||null;}
function walk(){return globalThis.__arondightWalkMode||null;}
function drive(){return globalThis.__arondightVehicleDrive||null;}
function footWeapons(){return globalThis.__arondightFootWeapons||null;}
function playerVitals(){return globalThis.__arondightPlayerDamageModel||null;}
function selfId(){try{return String(session()?.getSelfId?.()||session()?.active?.getSelfId?.()||"");}catch{return"";}}
function hashId(value){let h=2166136261;for(const c of String(value||"")){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}
function colorFor(id){return PALETTE[hashId(id)%PALETTE.length];}
function localOffset(){const b=bridge(),offset=b?.__vsRespawnLocalOffset;return !b?.active&&Array.isArray(offset)&&offset.length===2?[Number(offset[0])||0,Number(offset[1])||0]:[0,0];}
function canonicalToLocal(p){const offset=localOffset();return[(Number(p?.[0])||0)-offset[0],(Number(p?.[1])||0)-offset[1],Number(p?.[2])||0];}
function metersToLngLat(originLon,originLat,eastM,northM){const latRad=originLat*Math.PI/180;return[originLon+(eastM/(EARTH_RADIUS_M*Math.max(.01,Math.cos(latRad))))*180/Math.PI,originLat+(northM/EARTH_RADIUS_M)*180/Math.PI];}
function lngLatToMeters(originLon,originLat,longitude,latitude){const north=(latitude-originLat)*Math.PI/180*EARTH_RADIUS_M,east=(longitude-originLon)*Math.PI/180*EARTH_RADIUS_M*Math.max(.01,Math.cos(originLat*Math.PI/180));return[east,north];}
function posePosition(pose){const b=bridge();if(Array.isArray(pose?.g)&&pose.g.length===2&&Number.isFinite(b?.originLon)&&Number.isFinite(b?.originLat)){const local=lngLatToMeters(b.originLon,b.originLat,Number(pose.g[0]),Number(pose.g[1]));return[local[0],local[1],Number(pose.p?.[2])||0];}return canonicalToLocal(pose?.p);}
function yawQuaternion(yaw){const half=-(Number(yaw)||0)/2;return[0,0,Math.sin(half),Math.cos(half)];}
function localVelocity(mode,p,now){let velocity=[0,0,0];if(localSample?.mode===mode&&finiteArray(localSample.p,3)){const dt=(now-localSample.at)/1000;if(dt>.001&&dt<.5)velocity=p.map((value,index)=>(value-localSample.p[index])/dt);}localSample={mode,p:[...p],at:now};return velocity;}
function localDead(){const model=playerVitals();return Boolean(walk()?.dead||model?.dead||Number(model?.hp)<=0);}
function localWeapon(){const mode=String(footWeapons()?.mode||viewport()?.dataset?.walkWeapon||"pistol");return mode==="smg"?"smg":"pistol";}
function enrichLocalPose(input){
  if(!input||!finiteArray(input.p,3)||!finiteArray(input.q,4))return input;
  const now=performance.now(),w=walk(),d=drive(),b=bridge();let pose={...input},mode="drone";
  if(d?.active&&d?.physicsPose&&finiteArray(d.physicsPose.position,3)&&finiteArray(d.physicsPose.rotation,4)){
    mode="vehicle";const physical=d.physicsPose,p=[...physical.position],q=[...physical.rotation],v=finiteArray(physical.velocity,3)?[...physical.velocity]:localVelocity(mode,p,now);pose={...pose,p,q,v,pm:mode,ps:++txSequence,pv:{id:String(d.vehicleId||""),seq:txSequence}};
  }else if(w?.mode==="foot"&&w?.position){
    mode="foot";const p=[Number(w.position.x)||0,Number(w.position.y)||0,Math.max(0,(Number(w.position.z)||EYE_Z)-EYE_Z)],yaw=Number(w.yaw)||0,pitch=clamp(Number(w.pitch)||0,-Math.PI/2,Math.PI/2),q=yawQuaternion(yaw),v=localVelocity(mode,p,now),speed=Math.hypot(v[0],v[1]);pose={...pose,p,q,v,pm:mode,ps:++txSequence,ph:{yaw,pitch,weapon:localWeapon(),dead:localDead(),speed:+speed.toFixed(3),moving:speed>.12?1:0,aiming:viewport()?.dataset?.walkScreenAimActive==="1"?1:0,seq:txSequence}};
  }else{
    pose={...pose,pm:"drone",ps:++txSequence};localVelocity("drone",pose.p,now);
  }
  if(b?.active&&Number.isFinite(b.originLon)&&Number.isFinite(b.originLat))pose.g=metersToLngLat(b.originLon,b.originLat,pose.p[0],pose.p[1]);
  localMode=mode;const view=viewport();if(view){view.dataset.vsLocalPlayerMode=mode;view.dataset.vsPlayerStateTx=String((Number(view.dataset.vsPlayerStateTx)||0)+1);view.dataset.vsPlayerReplication="drone+foot+vehicle-seated+weapon+death-v3";}return pose;
}
function patchSession(now=performance.now()){
  if(now-lastPatchAt<PATCH_RETRY_MS)return false;lastPatchAt=now;const s=session();if(!s||typeof s.setPose!=="function")return false;
  if(s===patchedSession&&s.setPose===patchedSetPose)return true;
  if(!s.__worldVehiclePhysicsSync)return false;
  baseSetPose=s.setPose.bind(s);patchedSetPose=pose=>baseSetPose(enrichLocalPose(pose));s.setPose=patchedSetPose;s.__vsPlayerStateReplication=true;patchedSession=s;const view=viewport();if(view)view.dataset.vsPosePipeline="base->player-mode->vehicle-physics->transport-v2";return true;
}
function createAvatar(id){const scene=bridge()?.threeScene;if(!scene)return null;const rig=createPlayerHumanRig({id,color:colorFor(id)});rig.group.userData.vsMultiplayerHuman=true;scene.add(rig.group);return rig;}
function recordFor(id){id=String(id||"");if(!id||id===selfId())return null;let record=records.get(id);if(!record){record={id,mode:"drone",vehicleId:"",timeline:new VsPoseTimeline(),lastPoseMs:-Infinity,ph:null,dead:false,avatar:createAvatar(id)};records.set(id,record);}else if(!record.avatar)record.avatar=createAvatar(id);return record;}
function removeRecord(id){const key=String(id||""),record=records.get(key);if(!record)return;record.avatar?.group?.parent?.remove(record.avatar.group);records.delete(key);}
function onPose(event){const peerId=String(event?.detail?.peerId||""),pose=event?.detail?.pose;if(!peerId||!pose||peerId===selfId())return;const record=recordFor(peerId);if(!record)return;record.mode=["foot","vehicle","drone"].includes(String(pose.pm))?String(pose.pm):"drone";record.ph=pose.ph&&typeof pose.ph==="object"?{...pose.ph}:null;record.vehicleId=String(pose.pv?.id||pose.cv?.id||record.vehicleId||"");if(typeof record.ph?.dead==="boolean")record.dead=record.ph.dead;const p=posePosition(pose);record.timeline.push({...pose,p},performance.now());record.lastPoseMs=performance.now();const view=viewport();if(view){view.dataset.vsPlayerStateRx=String((Number(view.dataset.vsPlayerStateRx)||0)+1);view.dataset.vsLastRemoteMode=record.mode;}}
function onPeer(event){const {type,peerId}=event?.detail||{};if(type==="leave")removeRecord(peerId);else if(type==="join")recordFor(peerId);}
function onGame(event){const packet=event?.detail?.packet;if(packet?.type!=="state"||!packet.playerId)return;const record=records.get(String(packet.playerId));if(record)record.dead=Boolean(packet.killed||Number(packet.hp)<=0);}
function hideLegacyPeer(id){const scene=bridge()?.threeScene;if(!scene)return;scene.traverse(node=>{if(!node||node.userData?.vsHumanAvatar)return;if(String(node.userData?.vsPlayerId||"")!==id)return;if(node.userData?.vsMultiplayerPeer||node.userData?.vsLegacyPrimary||node===bridge()?.vsPeerMesh)node.visible=false;});}
function renderHuman(record,now){
  const avatar=record.avatar;if(!avatar)return;const active=record.mode==="foot"&&now-record.lastPoseMs<=STALE_MS,sample=active?record.timeline.sample(now):null;if(!sample||sample.stale){avatar.group.visible=false;if(record.mode==="vehicle")hideLegacyPeer(record.id);return;}
  const ph=record.ph||{},yaw=Number(ph.yaw)||0,pitch=clamp(Number(ph.pitch)||0,-1.48,1.48),speed=Math.max(0,Number(ph.speed)||0),moving=Boolean(ph.moving)||speed>.12,dead=Boolean(record.dead||ph.dead);setPlayerHumanFootParent(avatar,bridge()?.threeScene);avatar.group.position.set(...sample.p);avatar.group.rotation.set(dead?Math.PI*.48:0,0,-yaw);avatar.group.visible=true;const gait=moving&&!dead?Math.sin(now*.0105+hashId(record.id)%17)*Math.min(.72,.18+speed*.075):0;avatar.leftLeg.rotation.x=gait;avatar.rightLeg.rotation.x=-gait;avatar.leftArm.rotation.x=-gait*.72;avatar.rightArm.rotation.x=gait*.72;avatar.aimRig.rotation.x=pitch;const weapon=String(ph.weapon||"pistol");avatar.pistol.visible=!dead&&weapon!=="smg";avatar.smg.visible=!dead&&weapon==="smg";avatar.aimRig.visible=!dead;avatar.group.userData.vsRemotePlayerMode="foot";avatar.group.userData.vsRemoteWeapon=weapon;avatar.group.userData.vsRemoteDead=dead;hideLegacyPeer(record.id);
}
function vehicleRootForRecord(record){const cached=record.vehicleRoot;if(cached?.parent&&(String(cached.userData?.worldPopulationId||cached.userData?.worldProceduralId||"")===record.vehicleId||String(cached.userData?.remotePlayerDriven||"")===record.id))return cached;const scene=bridge()?.threeScene;if(!scene)return null;let found=null;scene.traverse(node=>{if(found||!node?.children?.length)return;const id=String(node.userData?.worldPopulationId||node.userData?.worldProceduralId||"");if(record.vehicleId&&id===record.vehicleId){found=node;return;}if(String(node.userData?.remotePlayerDriven||"")===record.id)found=node;});record.vehicleRoot=found;return found;}
function renderVehicleHuman(record,now){const avatar=record.avatar;if(!avatar)return false;const fresh=now-record.lastPoseMs<=STALE_MS,root=fresh?vehicleRootForRecord(record):null;if(!root){avatar.group.visible=false;return false;}setPlayerHumanVehiclePose(avatar,root,{driverSide:-1});avatar.group.userData.vsRemotePlayerMode="vehicle";avatar.group.userData.vsRemoteVehicleId=record.vehicleId||String(root.userData?.worldPopulationId||"");hideLegacyPeer(record.id);return true;}
function frame(now=performance.now()){
  patchSession(now);let humans=0,vehicles=0,drones=0;for(const record of records.values()){if(record.mode==="foot"){renderHuman(record,now);if(record.avatar?.group?.visible)humans++;}else if(record.mode==="vehicle"){vehicles++;renderVehicleHuman(record,now);}else{if(record.avatar)record.avatar.group.visible=false;drones++;}}
  const view=viewport();if(view){view.dataset.vsRemoteHumanAvatars=String(humans);view.dataset.vsRemoteVehiclePlayers=String(vehicles);view.dataset.vsRemoteDronePlayers=String(drones);view.dataset.vsPlayerReplication="drone+foot+vehicle-seated+weapon+death-v3";view.dataset.vsLocalPlayerMode=localMode;}
  requestAnimationFrame(frame);
}
export function installVsPlayerStateReplication(){if(installed)return;installed=true;addEventListener(VS_POSE_EVENT,onPose);addEventListener(VS_PEER_EVENT,onPeer);addEventListener(VS_GAME_EVENT,onGame);requestAnimationFrame(frame);}
