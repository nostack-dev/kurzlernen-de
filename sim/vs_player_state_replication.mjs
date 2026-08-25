import * as THREE from "three";
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
  localMode=mode;const view=viewport();if(view){view.dataset.vsLocalPlayerMode=mode;view.dataset.vsPlayerStateTx=String((Number(view.dataset.vsPlayerStateTx)||0)+1);view.dataset.vsPlayerReplication="drone+foot+vehicle+weapon+death-v2";}return pose;
}
function patchSession(now=performance.now()){
  if(now-lastPatchAt<PATCH_RETRY_MS)return false;lastPatchAt=now;const s=session();if(!s||typeof s.setPose!=="function")return false;
  if(s===patchedSession&&s.setPose===patchedSetPose)return true;
  if(!s.__worldVehiclePhysicsSync)return false;
  baseSetPose=s.setPose.bind(s);patchedSetPose=pose=>baseSetPose(enrichLocalPose(pose));s.setPose=patchedSetPose;s.__vsPlayerStateReplication=true;patchedSession=s;const view=viewport();if(view)view.dataset.vsPosePipeline="base->player-mode->vehicle-physics->transport-v2";return true;
}
function bodyMaterial(color,roughness=.72){return new THREE.MeshStandardMaterial({color,roughness,metalness:.04});}
function box(name,size,material,position){const mesh=new THREE.Mesh(new THREE.BoxGeometry(...size),material);mesh.name=name;mesh.position.set(...position);mesh.castShadow=false;mesh.receiveShadow=false;mesh.userData.flightFireIgnore=false;return mesh;}
function createAvatar(id){
  const scene=bridge()?.threeScene;if(!scene)return null;const color=colorFor(id),shirt=bodyMaterial(color,.62),pants=bodyMaterial(0x26313a,.9),skin=bodyMaterial(0xc5906d,.86),dark=bodyMaterial(0x171d22,.7),group=new THREE.Group();group.name=`VS_HUMAN_${id}`;group.userData.vsHumanAvatar=true;group.userData.vsPlayerId=id;group.userData.vsMultiplayerHuman=true;
  const pelvis=box("VS_HUMAN_PELVIS",[.36,.25,.24],pants,[0,0,.83]),torso=box("VS_HUMAN_TORSO",[.48,.28,.62],shirt,[0,0,1.18]),head=new THREE.Mesh(new THREE.SphereGeometry(.17,8,6),skin);head.name="VS_HUMAN_HEAD";head.position.set(0,0,1.66);group.add(pelvis,torso,head);
  const leftLeg=new THREE.Group(),rightLeg=new THREE.Group();leftLeg.name="VS_HUMAN_LEG_L";rightLeg.name="VS_HUMAN_LEG_R";leftLeg.position.set(-.12,0,.72);rightLeg.position.set(.12,0,.72);leftLeg.add(box("VS_HUMAN_SHIN_L",[.16,.18,.68],pants,[0,0,-.34]));rightLeg.add(box("VS_HUMAN_SHIN_R",[.16,.18,.68],pants,[0,0,-.34]));group.add(leftLeg,rightLeg);
  const leftArm=new THREE.Group(),rightArm=new THREE.Group();leftArm.name="VS_HUMAN_ARM_L";rightArm.name="VS_HUMAN_ARM_R";leftArm.position.set(-.31,0,1.42);rightArm.position.set(.31,0,1.42);leftArm.add(box("VS_HUMAN_FOREARM_L",[.13,.14,.58],shirt,[0,0,-.27]));rightArm.add(box("VS_HUMAN_FOREARM_R",[.13,.14,.58],shirt,[0,0,-.27]));group.add(leftArm,rightArm);
  const aimRig=new THREE.Group();aimRig.name="VS_HUMAN_AIM_RIG";aimRig.position.set(0,.10,1.31);const pistol=box("VS_HUMAN_PISTOL",[.10,.34,.12],dark,[.18,.22,0]),smg=box("VS_HUMAN_SMG",[.13,.68,.15],dark,[.12,.38,0]);pistol.userData.vsWeapon=true;smg.userData.vsWeapon=true;aimRig.add(pistol,smg);group.add(aimRig);
  const hitMat=new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false,depthTest:false});hitMat.colorWrite=false;const hitbox=new THREE.Mesh(new THREE.BoxGeometry(.62,.54,1.78),hitMat);hitbox.name="VS_HUMAN_HITBOX";hitbox.position.z=.89;hitbox.userData.vsCombatHitbox=true;hitbox.userData.vsPlayerId=id;hitbox.userData.vsPeerHitProxy=true;hitbox.userData.vsHumanHitbox=true;group.add(hitbox);
  group.visible=false;scene.add(group);return{group,leftLeg,rightLeg,leftArm,rightArm,aimRig,pistol,smg,hitbox};
}
function recordFor(id){id=String(id||"");if(!id||id===selfId())return null;let record=records.get(id);if(!record){record={id,mode:"drone",timeline:new VsPoseTimeline(),lastPoseMs:-Infinity,ph:null,dead:false,avatar:createAvatar(id)};records.set(id,record);}else if(!record.avatar)record.avatar=createAvatar(id);return record;}
function removeRecord(id){const key=String(id||""),record=records.get(key);if(!record)return;record.avatar?.group?.parent?.remove(record.avatar.group);records.delete(key);}
function onPose(event){const peerId=String(event?.detail?.peerId||""),pose=event?.detail?.pose;if(!peerId||!pose||peerId===selfId())return;const record=recordFor(peerId);if(!record)return;record.mode=["foot","vehicle","drone"].includes(String(pose.pm))?String(pose.pm):"drone";record.ph=pose.ph&&typeof pose.ph==="object"?{...pose.ph}:null;if(typeof record.ph?.dead==="boolean")record.dead=record.ph.dead;const p=posePosition(pose);record.timeline.push({...pose,p},performance.now());record.lastPoseMs=performance.now();const view=viewport();if(view){view.dataset.vsPlayerStateRx=String((Number(view.dataset.vsPlayerStateRx)||0)+1);view.dataset.vsLastRemoteMode=record.mode;}}
function onPeer(event){const {type,peerId}=event?.detail||{};if(type==="leave")removeRecord(peerId);else if(type==="join")recordFor(peerId);}
function onGame(event){const packet=event?.detail?.packet;if(packet?.type!=="state"||!packet.playerId)return;const record=records.get(String(packet.playerId));if(record)record.dead=Boolean(packet.killed||Number(packet.hp)<=0);}
function hideLegacyPeer(id){const scene=bridge()?.threeScene;if(!scene)return;scene.traverse(node=>{if(!node||node.userData?.vsHumanAvatar)return;if(String(node.userData?.vsPlayerId||"")!==id)return;if(node.userData?.vsMultiplayerPeer||node.userData?.vsLegacyPrimary||node===bridge()?.vsPeerMesh)node.visible=false;});}
function renderHuman(record,now){
  const avatar=record.avatar;if(!avatar)return;const active=record.mode==="foot"&&now-record.lastPoseMs<=STALE_MS,sample=active?record.timeline.sample(now):null;if(!sample||sample.stale){avatar.group.visible=false;if(record.mode==="vehicle")hideLegacyPeer(record.id);return;}
  const ph=record.ph||{},yaw=Number(ph.yaw)||0,pitch=clamp(Number(ph.pitch)||0,-1.48,1.48),speed=Math.max(0,Number(ph.speed)||0),moving=Boolean(ph.moving)||speed>.12,dead=Boolean(record.dead||ph.dead);avatar.group.position.set(...sample.p);avatar.group.rotation.set(dead?Math.PI*.48:0,0,-yaw);avatar.group.visible=true;const gait=moving&&!dead?Math.sin(now*.0105+hashId(record.id)%17)*Math.min(.72,.18+speed*.075):0;avatar.leftLeg.rotation.x=gait;avatar.rightLeg.rotation.x=-gait;avatar.leftArm.rotation.x=-gait*.72;avatar.rightArm.rotation.x=gait*.72;avatar.aimRig.rotation.x=pitch;const weapon=String(ph.weapon||"pistol");avatar.pistol.visible=!dead&&weapon!=="smg";avatar.smg.visible=!dead&&weapon==="smg";avatar.aimRig.visible=!dead;avatar.group.userData.vsRemotePlayerMode="foot";avatar.group.userData.vsRemoteWeapon=weapon;avatar.group.userData.vsRemoteDead=dead;hideLegacyPeer(record.id);
}
function frame(now=performance.now()){
  patchSession(now);let humans=0,vehicles=0,drones=0;for(const record of records.values()){if(record.mode==="foot"){renderHuman(record,now);if(record.avatar?.group?.visible)humans++;}else{if(record.avatar)record.avatar.group.visible=false;if(record.mode==="vehicle"){vehicles++;hideLegacyPeer(record.id);}else drones++;}}
  const view=viewport();if(view){view.dataset.vsRemoteHumanAvatars=String(humans);view.dataset.vsRemoteVehiclePlayers=String(vehicles);view.dataset.vsRemoteDronePlayers=String(drones);view.dataset.vsPlayerReplication="drone+foot+vehicle+weapon+death-v2";view.dataset.vsLocalPlayerMode=localMode;}
  requestAnimationFrame(frame);
}
export function installVsPlayerStateReplication(){if(installed)return;installed=true;addEventListener(VS_POSE_EVENT,onPose);addEventListener(VS_PEER_EVENT,onPeer);addEventListener(VS_GAME_EVENT,onGame);requestAnimationFrame(frame);}
