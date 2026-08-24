import * as THREE from "three";
import {AUDIO_SETTINGS_EVENT,loadAudioSettings,normalizeAudioSettings} from "./audio_settings.mjs";
import {accelerateCriticalDetonation,criticalDamageProfile,isCriticalDamage} from "./critical_damage_logic.mjs";
import {wantedCrimeSeverity,wantedDetectionRadiusM,wantedEscapeDurationMs,wantedLineBlockedByPrisms,wantedPointInRing,wantedPoliceAltitudeOffsetM,wantedPoliceCount,wantedPoliceDamage,wantedPoliceEngageDelayMs,wantedPoliceSpawnRadiusM,wantedSearchState,wantedStarsForHeat} from "./wanted_system_logic.mjs";
import {accelerateWorldCriticalDamage,startWorldCriticalDamage,stopWorldCriticalDamage} from "./world_critical_damage_fx.mjs";

const WORLD_KILL_EVENT="arondight:world-kill";
const MAX_POLICE_DRONES=5;
const POLICE_HP=100;
const POLICE_HIT_DAMAGE=34;
const POLICE_RESPAWN_MS=4400;
const SENSOR_INTERVAL_MS=170;
const PLAYER_DAMAGE_COOLDOWN_MS=1050;
const CRIME_MEMORY_MS=12000;
const MAX_FRAME_DT=.05;
const upAxis=new THREE.Vector3(0,1,0);

const drones=[];
const seenCrimes=new Map();
const playerPosition=new THREE.Vector3();
const lastKnownPosition=new THREE.Vector3();
const goalPosition=new THREE.Vector3();
const desiredVelocity=new THREE.Vector3();
const proposedPosition=new THREE.Vector3();
const tracerVector=new THREE.Vector3();
const tmpPosition=new THREE.Vector3();
const unitScale=new THREE.Vector3(1,1,1);

let installed=false;
let sceneRef=null;
let policeRoot=null;
let hud=null;
let heat=0;
let stars=0;
let phase="clear";
let lastCrimeAt=-Infinity;
let lastContactAt=-Infinity;
let lastFrameAt=performance.now();
let lastPlayerDamageAt=-Infinity;
let escapedBannerUntil=-Infinity;
let clearReason="";
let audioContext=null;
let audioUnlocked=false;
let audioSettings=loadAudioSettings();
let nextSirenAt=-Infinity;
let sirenHigh=false;
let policeKills=0;

function bridge(){return globalThis.__arondightRealWorld||null;}
function viewport(){return document.getElementById("viewport");}
function rigidBodies(){return globalThis.__arondightWorldRigidBodies||null;}
function clamp(value,min,max){return Math.max(min,Math.min(max,Number(value)||0));}

function rememberCrime(id,now=performance.now()){
  const key=String(id||"");
  if(!key)return true;
  const previous=seenCrimes.get(key);
  if(Number.isFinite(previous)&&now-previous<2000)return false;
  seenCrimes.set(key,now);
  for(const[crimeId,at]of seenCrimes)if(now-at>CRIME_MEMORY_MS)seenCrimes.delete(crimeId);
  while(seenCrimes.size>256)seenCrimes.delete(seenCrimes.keys().next().value);
  return true;
}

function installHud(){
  const view=viewport();
  if(!view)return false;
  if(!hud){
    hud=document.createElement("div");
    hud.id="wantedHud";
    hud.hidden=true;
    hud.setAttribute("role","status");
    hud.setAttribute("aria-live","polite");
    hud.innerHTML='<div class="wanted-stars" aria-hidden="true"><i>★</i><i>★</i><i>★</i><i>★</i><i>★</i></div><strong>WANTED</strong><small>POLICE DRONES INBOUND</small>';
    view.appendChild(hud);
  }
  if(!document.querySelector("style[data-wanted-police]")){
    const style=document.createElement("style");
    style.dataset.wantedPolice="police-drones-v1";
    style.textContent=`
#wantedHud{display:none;position:absolute;z-index:17;left:50%;top:max(48px,calc(var(--solo-safe-top,env(safe-area-inset-top)) + 42px));transform:translateX(-50%);min-width:190px;padding:7px 12px 8px;border:1px solid #5ab8ff66;border-radius:10px;background:linear-gradient(180deg,#07111aee,#090d14e8);box-shadow:0 6px 22px #000a,0 0 20px #207dca22;color:#fff;text-align:center;pointer-events:none;font-family:system-ui,-apple-system,sans-serif;backdrop-filter:blur(5px)}
body.solo-flight #wantedHud:not([hidden]){display:block}#wantedHud[hidden]{display:none!important}.wanted-stars{height:18px;white-space:nowrap}.wanted-stars i{display:inline-block;margin:0 1px;color:#39424c;font:900 20px/1 system-ui;font-style:normal;text-shadow:0 1px 2px #000}.wanted-stars i.hot{color:#ffd34f;text-shadow:0 0 7px #ff9c28,0 1px 2px #000}#wantedHud strong{display:block;margin-top:1px;font:950 9px/1 system-ui;letter-spacing:.18em;color:#e9f6ff}#wantedHud small{display:block;margin-top:4px;font:850 8px/1.15 system-ui;letter-spacing:.06em;color:#8ed6ff;white-space:nowrap}#wantedHud[data-phase="pursuit"]{border-color:#ff576988;box-shadow:0 6px 22px #000a,0 0 22px #ff294333}#wantedHud[data-phase="pursuit"] small{color:#ff8ea0}#wantedHud[data-phase="searching"] .wanted-stars i.hot{animation:wantedSearchBlink .72s steps(1,end) infinite}#wantedHud[data-phase="escaped"]{border-color:#6be4b088;box-shadow:0 6px 22px #000a,0 0 20px #32c98a33}#wantedHud[data-phase="escaped"] strong,#wantedHud[data-phase="escaped"] small{color:#8ff0c8}@keyframes wantedSearchBlink{0%,48%{opacity:1}49%,100%{opacity:.22}}@media(max-height:340px){#wantedHud{top:max(37px,calc(var(--solo-safe-top,env(safe-area-inset-top)) + 32px));min-width:166px;padding:4px 9px 5px}.wanted-stars{height:14px}.wanted-stars i{font-size:16px}#wantedHud strong{font-size:8px}#wantedHud small{font-size:7px;margin-top:3px}}
`;
    document.head.appendChild(style);
  }
  return true;
}

function updateTelemetry(remainingMs=0){
  const view=viewport();
  if(!view)return;
  view.dataset.wantedSystem="heat+fair-physics-police-drones-v3";
  view.dataset.wantedHeat=String(heat);
  view.dataset.wantedStars=String(stars);
  view.dataset.wantedPhase=phase;
  view.dataset.wantedPoliceActive=String(drones.filter(drone=>drone.active).length);
  view.dataset.wantedPoliceKills=String(policeKills);
  view.dataset.wantedEscapeRemainingMs=String(Math.max(0,Math.round(remainingMs)));
  view.dataset.wantedEscapable="1";
  view.dataset.wantedPoliceVisual="white-black+red-blue-lightbar-v2";
  view.dataset.wantedPoliceSpawn="rear-far-player-level-inbound-v3";
  view.dataset.wantedPoliceAltitude="player-level-formation-v1";
  view.dataset.wantedPoliceDamageModel="4-6hp+1050ms-grace-v2";
  view.dataset.wantedPoliceDamagePresentation="critical-smoke+delayed-explosion-v1";
  view.dataset.wantedPoliceCritical=String(drones.filter(drone=>drone.active&&drone.critical).length);
  view.dataset.wantedPoliceLights=String(drones.filter(drone=>drone.active&&(drone.red.visible||drone.blue.visible)).length);
  if(clearReason)view.dataset.wantedLastClear=clearReason;
}

function renderHud(remainingMs=0){
  if(!installHud())return;
  const now=performance.now(),showWanted=stars>0,showBanner=now<escapedBannerUntil;
  hud.hidden=!showWanted&&!showBanner;
  if(hud.hidden){updateTelemetry(0);return;}
  const starNodes=hud.querySelectorAll(".wanted-stars i"),title=hud.querySelector("strong"),detail=hud.querySelector("small");
  starNodes.forEach((node,index)=>node.classList.toggle("hot",showWanted&&index<stars));
  const active=drones.filter(drone=>drone.active).length;
  if(showBanner){hud.dataset.phase="escaped";title.textContent=clearReason==="busted"?"BUSTED":"ESCAPED";detail.textContent=clearReason==="busted"?"POLICE PURSUIT ENDED":"WANTED LEVEL CLEARED";hud.setAttribute("aria-label",title.textContent);}
  else if(phase==="searching"){hud.dataset.phase="searching";title.textContent="SEARCHING";detail.textContent=`HIDE ${Math.max(0,remainingMs/1000).toFixed(1)} s · ${active} DRONES`;hud.setAttribute("aria-label",`${stars} wanted stars. Police searching. Escape in ${Math.ceil(remainingMs/1000)} seconds.`);}
  else{const inboundTimes=drones.filter(drone=>drone.active).map(drone=>drone.engageAt-now),inbound=inboundTimes.length?Math.max(0,Math.min(...inboundTimes)):0;hud.dataset.phase="pursuit";title.textContent=inbound>0?"POLICE INBOUND":"POLICE PURSUIT";detail.textContent=inbound>0?`${active} DRONES · ${Math.ceil(inbound/100)/10} s WARNING`:`${active} DRONES · BREAK LINE OF SIGHT`;hud.setAttribute("aria-label",inbound>0?`${stars} wanted stars. Police drones inbound in ${Math.ceil(inbound/1000)} seconds.`:`${stars} wanted stars. ${active} police drones pursuing.`);}
  updateTelemetry(remainingMs);
}

function ensureAudio(){
  const Ctx=globalThis.AudioContext||globalThis.webkitAudioContext;
  if(!audioUnlocked||!Ctx)return null;
  try{audioContext??=new Ctx({latencyHint:"interactive"});if(audioContext.state==="suspended")audioContext.resume().catch(()=>{});}catch{return null;}
  return audioContext;
}

function playTone({frequency=700,endFrequency=frequency,duration=.12,gain=.02,type="sine"}={}){
  if(!audioSettings.soundEnabled||audioSettings.fxVolume<=0)return false;
  const context=ensureAudio();
  if(!context||context.state!=="running")return false;
  try{
    const now=context.currentTime,oscillator=context.createOscillator(),volume=context.createGain();
    oscillator.type=type;oscillator.frequency.setValueAtTime(Math.max(30,frequency),now);oscillator.frequency.exponentialRampToValueAtTime(Math.max(30,endFrequency),now+duration);
    volume.gain.setValueAtTime(Math.max(.0001,gain*audioSettings.fxVolume/100),now);volume.gain.exponentialRampToValueAtTime(.0001,now+duration);
    oscillator.connect(volume).connect(context.destination);oscillator.start(now);oscillator.stop(now+duration+.02);return true;
  }catch{return false;}
}

function updateSiren(now){
  if(stars<=0||now<nextSirenAt)return;
  nextSirenAt=now+(phase==="searching"?1050:620);sirenHigh=!sirenHigh;
  playTone({frequency:sirenHigh?880:610,endFrequency:sirenHigh?690:830,duration:phase==="searching"? .18:.24,gain:.010+stars*.0015,type:"sine"});
}

function makeMaterials(){
  return{
    body:new THREE.MeshStandardMaterial({color:0xf2f5f6,roughness:.34,metalness:.46,emissive:0x20262a,emissiveIntensity:.16}),
    white:new THREE.MeshStandardMaterial({color:0xffffff,roughness:.40,metalness:.28}),
    dark:new THREE.MeshStandardMaterial({color:0x11161a,roughness:.62,metalness:.48}),
    red:new THREE.MeshStandardMaterial({color:0xff2c38,emissive:0xff1424,emissiveIntensity:2.6,roughness:.2}),
    blue:new THREE.MeshStandardMaterial({color:0x2d8cff,emissive:0x1475ff,emissiveIntensity:2.8,roughness:.2}),
    redHalo:new THREE.MeshBasicMaterial({color:0xff1834,transparent:true,opacity:.28,depthWrite:false,depthTest:false,blending:THREE.AdditiveBlending}),
    blueHalo:new THREE.MeshBasicMaterial({color:0x1688ff,transparent:true,opacity:.30,depthWrite:false,depthTest:false,blending:THREE.AdditiveBlending}),
    flash:new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.72,depthWrite:false}),
    hitbox:Object.assign(new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false,depthTest:false}),{colorWrite:false}),
    tracer:new THREE.MeshBasicMaterial({color:0xff5364,transparent:true,opacity:.92,depthWrite:false,blending:THREE.AdditiveBlending}),
  };
}

let materials=null;
let geometries=null;
function ensureSharedVisuals(){
  materials??=makeMaterials();
  geometries??={
    body:new THREE.BoxGeometry(.72,.46,.25),canopy:new THREE.SphereGeometry(.25,9,6),armX:new THREE.BoxGeometry(1.28,.065,.065),armY:new THREE.BoxGeometry(.065,1.28,.065),rotor:new THREE.TorusGeometry(.23,.027,5,12),light:new THREE.BoxGeometry(.19,.105,.075),lightBar:new THREE.BoxGeometry(.48,.30,.045),halo:new THREE.SphereGeometry(.20,8,6),gun:new THREE.CylinderGeometry(.035,.045,.30,7),hitbox:new THREE.BoxGeometry(1.58,1.58,.68),tracer:new THREE.CylinderGeometry(.018,.018,1,5),flash:new THREE.BoxGeometry(.76,.50,.27),
  };
}

function visualMesh(geometry,material){const mesh=new THREE.Mesh(geometry,material);mesh.userData.flightFireIgnore=true;mesh.frustumCulled=false;return mesh;}

function createExplosion(index){
  const count=14,positions=new Float32Array(count*3),directions=[];
  for(let i=0;i<count;i++){const a=(i/count)*Math.PI*2+(index*.37),z=.25+((i*7)%9)/9;directions.push(new THREE.Vector3(Math.cos(a),Math.sin(a),z).normalize().multiplyScalar(2.4+(i%4)*.65));}
  const geometry=new THREE.BufferGeometry();geometry.setAttribute("position",new THREE.BufferAttribute(positions,3));
  const material=new THREE.PointsMaterial({color:0xffa43b,size:.16,transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending,sizeAttenuation:true}),points=new THREE.Points(geometry,material),ringMaterial=new THREE.MeshBasicMaterial({color:0x64b7ff,transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending}),ring=new THREE.Mesh(new THREE.TorusGeometry(.34,.045,6,16),ringMaterial),group=new THREE.Group();
  points.frustumCulled=false;ring.rotation.x=Math.PI/2;group.visible=false;group.userData.flightFireIgnore=true;group.add(points,ring);policeRoot.add(group);return{group,points,ring,positions,directions,born:-Infinity,expires:-Infinity};
}

function createDrone(index){
  ensureSharedVisuals();const root=new THREE.Group();root.name=`POLICE_DRONE_${index+1}`;root.userData.wantedPoliceDrone=true;root.visible=false;
  const body=visualMesh(geometries.body,materials.body),canopy=visualMesh(geometries.canopy,materials.dark),armX=visualMesh(geometries.armX,materials.dark),armY=visualMesh(geometries.armY,materials.white),gun=visualMesh(geometries.gun,materials.dark),flash=visualMesh(geometries.flash,materials.flash),lightBar=visualMesh(geometries.lightBar,materials.dark);
  canopy.scale.set(1.0,.72,.52);canopy.position.set(-.05,0,.12);gun.rotation.z=Math.PI/2;gun.position.set(.46,0,-.13);flash.visible=false;
  const rotors=[];for(const[x,y]of[[-.56,-.56],[-.56,.56],[.56,-.56],[.56,.56]]){const rotor=visualMesh(geometries.rotor,materials.dark);rotor.position.set(x,y,.08);root.add(rotor);rotors.push(rotor);}
  lightBar.position.set(.05,0,.24);const red=visualMesh(geometries.light,materials.red),blue=visualMesh(geometries.light,materials.blue),redHalo=visualMesh(geometries.halo,materials.redHalo),blueHalo=visualMesh(geometries.halo,materials.blueHalo),emergencyLight=new THREE.PointLight(0xff1834,0,28,2);red.position.set(.05,-.105,.275);blue.position.set(.05,.105,.275);redHalo.position.copy(red.position);blueHalo.position.copy(blue.position);redHalo.scale.set(1.8,1.2,.9);blueHalo.scale.copy(redHalo.scale);redHalo.renderOrder=31;blueHalo.renderOrder=31;emergencyLight.position.set(.05,0,.31);emergencyLight.userData.flightFireIgnore=true;
  const hitbox=new THREE.Mesh(geometries.hitbox,materials.hitbox);hitbox.visible=false;hitbox.userData.policeDroneId=String(index);hitbox.userData.worldPopulationKind="police-drone";hitbox.userData.worldPopulationId=`police-drone-${index}`;hitbox.userData.worldPopulationClone=false;hitbox.frustumCulled=false;
  root.add(body,canopy,armX,armY,gun,lightBar,red,blue,redHalo,blueHalo,emergencyLight,flash,hitbox);policeRoot.add(root);
  const tracer=new THREE.Mesh(geometries.tracer,materials.tracer);tracer.visible=false;tracer.frustumCulled=false;tracer.renderOrder=22;tracer.userData.flightFireIgnore=true;policeRoot.add(tracer);
  return{index,root,body,rotors,red,blue,redHalo,blueHalo,emergencyLight,flash,hitbox,tracer,explosion:createExplosion(index),velocity:new THREE.Vector3(),goal:new THREE.Vector3(),active:false,hp:POLICE_HP,critical:false,criticalExpiresAt:Infinity,lastCollisionDamageAt:-Infinity,destroyedUntil:0,spawnSerial:0,spawnedAt:0,engageAt:0,nextShotAt:0,tracerUntil:0,hitUntil:0,nextSensorAt:0,nextGoalRoofAt:0,nextCollisionAt:0,goalRoof:0,collisionRoof:0,seesPlayer:false,distance:Infinity};
}

function ensureScene(){
  const scene=bridge()?.threeScene;if(!scene)return false;
  if(scene===sceneRef&&policeRoot)return true;
  for(const drone of drones)rigidBodies()?.removeBody?.(`police-drone-${drone.index}`);policeRoot?.parent?.remove(policeRoot);sceneRef=scene;policeRoot=new THREE.Group();policeRoot.name="WANTED_POLICE_DRONES";scene.add(policeRoot);drones.splice(0,drones.length);for(let index=0;index<MAX_POLICE_DRONES;index++)drones.push(createDrone(index));return true;
}

function currentPlayerPosition(out=playerPosition){
  const walk=globalThis.__arondightWalkMode;
  if(walk?.mode==="foot"&&walk.position&&[walk.position.x,walk.position.y,walk.position.z].every(Number.isFinite))return out.set(walk.position.x,walk.position.y,walk.position.z);
  const currentBridge=bridge(),airframe=currentBridge?.threeScene?(currentBridge.airframeFor?.(currentBridge.threeScene)||currentBridge.airframe):null;
  if(airframe?.getWorldPosition){airframe.updateWorldMatrix?.(true,false);airframe.getWorldPosition(out);if([out.x,out.y,out.z].every(Number.isFinite))return out;}
  return null;
}

function currentPlayerHp(){
  const model=globalThis.__arondightPlayerDamageModel,value=Number(model?.hp);
  if(Number.isFinite(value))return clamp(value,0,100);
  const currentBridge=bridge(),fallback=Number(currentBridge?.vsLocalHealth);return Number.isFinite(fallback)?clamp(fallback,0,100):100;
}

function lineOfSight(from,to){
  return !wantedLineBlockedByPrisms(from,to,bridge()?.buildingCollisionSnapshot?.prisms);
}

function buildingTopAt(x,y){
  let top=0;const snapshot=bridge()?.buildingCollisionSnapshot;
  for(const prism of Array.isArray(snapshot?.prisms)?snapshot.prisms:[])if(wantedPointInRing(x,y,prism.points))top=Math.max(top,Number(prism.top)||0);
  return top;
}

function safeAltitude(x,y,z){const top=buildingTopAt(x,y);return Math.max(.85,Number(z)||0,top?top+1.6:0);}

function spawnDrone(drone,player,now){
  const walk=globalThis.__arondightWalkMode,playerForwardAngle=walk?.mode==="foot"?Math.PI/2-(Number(walk.yaw)||0):now*.00017,angle=playerForwardAngle+Math.PI+(drone.index-(MAX_POLICE_DRONES-1)/2)*.34,radius=wantedPoliceSpawnRadiusM(drone.index),x=player.x+Math.cos(angle)*radius,y=player.y+Math.sin(angle)*radius,z=safeAltitude(x,y,player.z+wantedPoliceAltitudeOffsetM(drone.index,"pursuit")),id=`police-drone-${drone.index}`;
  stopWorldCriticalDamage(id);drone.root.position.set(x,y,z);drone.root.rotation.set(0,0,angle+Math.PI);drone.root.scale.setScalar(1);drone.velocity.set(-Math.sin(angle)*1.2,Math.cos(angle)*1.2,0);drone.hp=POLICE_HP;drone.critical=false;drone.criticalExpiresAt=Infinity;drone.lastCollisionDamageAt=-Infinity;drone.active=true;drone.root.visible=true;drone.hitbox.visible=true;drone.flash.visible=false;drone.hitUntil=0;drone.spawnSerial++;drone.spawnedAt=now;drone.engageAt=now+wantedPoliceEngageDelayMs(stars);drone.nextShotAt=drone.engageAt+drone.index*160;drone.nextSensorAt=now+drone.index*24;drone.nextGoalRoofAt=0;drone.nextCollisionAt=0;drone.goalRoof=0;drone.collisionRoof=0;drone.seesPlayer=true;drone.distance=drone.root.position.distanceTo(player);drone.tracer.visible=false;rigidBodies()?.upsertBody?.({id,kind:"police-drone",position:[x,y,z],yaw:angle+Math.PI,halfExtents:[.79,.79,.34],massKg:18,gravityScale:0,linearDamping:.38,angularDamping:1.1});const view=viewport();if(view){view.dataset.wantedPoliceSpawnDistanceM=radius.toFixed(1);view.dataset.wantedPoliceInboundMs=String(Math.round(drone.engageAt-now));}
}

function deactivateDrone(drone){const id=`police-drone-${drone.index}`;stopWorldCriticalDamage(id);drone.active=false;drone.critical=false;drone.criticalExpiresAt=Infinity;drone.root.visible=false;drone.hitbox.visible=false;drone.tracer.visible=false;drone.seesPlayer=false;drone.distance=Infinity;drone.emergencyLight.intensity=0;rigidBodies()?.removeBody?.(id);}

function syncPoliceCount(player,now){
  const desired=wantedPoliceCount(stars);let active=drones.filter(drone=>drone.active).length;
  if(active>desired)for(const drone of[...drones].reverse())if(drone.active&&active>desired){deactivateDrone(drone);active--;}
  for(const drone of drones){if(active>=desired)break;if(!drone.active&&now>=drone.destroyedUntil){spawnDrone(drone,player,now);active++;}}
}

function updateExplosion(drone,now){
  const effect=drone.explosion;if(!effect.group.visible)return;
  if(now>=effect.expires){effect.group.visible=false;return;}
  const age=(now-effect.born)/1000,t=clamp((now-effect.born)/(effect.expires-effect.born),0,1);
  for(let i=0;i<effect.directions.length;i++){const direction=effect.directions[i],speed=1+age*.25;effect.positions[i*3]=direction.x*age*speed;effect.positions[i*3+1]=direction.y*age*speed;effect.positions[i*3+2]=direction.z*age*speed-1.8*age*age;}
  effect.points.geometry.attributes.position.needsUpdate=true;effect.points.material.opacity=.95*(1-t);effect.ring.material.opacity=.74*(1-t);effect.ring.scale.setScalar(.7+t*5.8);
}

function explodeDrone(drone,now){
  const effect=drone.explosion;effect.group.position.copy(drone.root.position);effect.group.visible=true;effect.born=now;effect.expires=now+920;effect.points.material.opacity=.95;effect.ring.material.opacity=.74;effect.ring.scale.setScalar(.7);effect.positions.fill(0);effect.points.geometry.attributes.position.needsUpdate=true;
  window.dispatchEvent(new CustomEvent("arondight:world-explosion",{detail:{position:drone.root.position.clone(),kind:"police-drone"}}));playTone({frequency:150,endFrequency:48,duration:.28,gain:.055,type:"sawtooth"});
}

function destroyPoliceDrone(drone,now=performance.now()){
  if(!drone?.active)return false;const crimeId=`police:${drone.index}:${drone.spawnSerial}`;explodeDrone(drone,now);deactivateDrone(drone);drone.destroyedUntil=now+POLICE_RESPAWN_MS;policeKills++;reportCrime({id:crimeId,kind:"police-drone"});const view=viewport();if(view){view.dataset.wantedPoliceCriticalExplosions=String((Number(view.dataset.wantedPoliceCriticalExplosions)||0)+1);view.dataset.wantedPoliceLastHp="0";}return true;
}

function armPoliceCritical(drone,now=performance.now(),accelerate=false){
  if(!drone?.active)return false;const id=`police-drone-${drone.index}`,profile=criticalDamageProfile("police-drone");if(!profile)return false;
  if(!drone.critical){const serial=drone.spawnSerial;drone.critical=true;drone.criticalExpiresAt=startWorldCriticalDamage({id,object:drone.root,kind:"police-drone",offset:[-.12,0,.18],scale:.68,delayMs:profile.delayMs,seed:`${id}:${serial}`,onExpire:()=>{if(drone.active&&drone.spawnSerial===serial&&drone.critical)destroyPoliceDrone(drone,performance.now());}})||now+profile.delayMs;}else if(accelerate){drone.criticalExpiresAt=accelerateCriticalDetonation("police-drone",drone.criticalExpiresAt,now);accelerateWorldCriticalDamage(id,drone.criticalExpiresAt);}const view=viewport();if(view){view.dataset.wantedPoliceCritical=String(drones.filter(item=>item.active&&item.critical).length);view.dataset.wantedPoliceDamagePresentation="critical-smoke+delayed-explosion-v1";}return true;
}

function reportCrime(detail={}){
  const kind=String(detail.kind||""),explicit=Number(detail.severity),severity=Number.isFinite(explicit)?Math.max(0,Math.min(5,Math.floor(explicit))):wantedCrimeSeverity(kind);
  const now=performance.now();if(severity<=0||!rememberCrime(detail.id,now))return false;
  heat=Math.min(99,heat+severity);const previousStars=stars;stars=wantedStarsForHeat(heat);lastCrimeAt=now;clearReason="";
  if(stars>0){phase="pursuit";lastContactAt=now;const player=currentPlayerPosition();if(player)lastKnownPosition.copy(player);if(stars>previousStars)playTone({frequency:520+stars*90,endFrequency:760+stars*100,duration:.16,gain:.022,type:"square"});}
  const view=viewport();if(view){view.dataset.wantedLastCrime=kind||"unknown";view.dataset.wantedCrimeEvents=String((Number(view.dataset.wantedCrimeEvents)||0)+1);}renderHud(wantedEscapeDurationMs(stars));return true;
}

function clearWanted(reason="escaped"){
  const hadWanted=stars>0;heat=0;stars=0;phase="clear";clearReason=String(reason||"clear");lastContactAt=-Infinity;lastCrimeAt=-Infinity;for(const drone of drones)deactivateDrone(drone);
  lastPlayerDamageAt=-Infinity;
  if(reason==="reset")seenCrimes.clear();
  escapedBannerUntil=hadWanted&&reason!=="reset"?performance.now()+2100:-Infinity;if(hadWanted&&reason==="escaped")playTone({frequency:660,endFrequency:1040,duration:.22,gain:.023,type:"sine"});renderHud(0);return hadWanted;
}

function findDrone(hit){
  for(let node=hit?.object;node;node=node.parent){const index=Number(node.userData?.policeDroneId);if(Number.isInteger(index)&&drones[index])return drones[index];}
  return null;
}

function registerPoliceHit(hit){
  const drone=findDrone(hit);if(!drone?.active)return false;const now=performance.now();drone.hp=Math.max(0,drone.hp-POLICE_HIT_DAMAGE);drone.hitUntil=now+105;drone.flash.visible=true;
  const player=currentPlayerPosition(playerPosition),dx=drone.root.position.x-(player?.x??drone.root.position.x-1),dy=drone.root.position.y-(player?.y??drone.root.position.y),dz=drone.root.position.z-(player?.z??drone.root.position.z),length=Math.hypot(dx,dy,dz)||1,point=hit?.point;rigidBodies()?.applyImpulse?.(`police-drone-${drone.index}`,[dx/length*12,dy/length*12,dz/length*12+1.8],{point:point?[Number(point.x)||0,Number(point.y)||0,Number(point.z)||0]:null});
  const critical=isCriticalDamage("police-drone",drone.hp,POLICE_HP);if(critical)armPoliceCritical(drone,now,drone.critical||drone.hp===0);const killed=false;window.dispatchEvent(new CustomEvent("arondight:combat-hit-confirm",{detail:{police:true,damage:POLICE_HIT_DAMAGE,hp:drone.hp,killed,critical}}));
  const view=viewport();if(view){view.dataset.wantedPoliceHits=String((Number(view.dataset.wantedPoliceHits)||0)+1);view.dataset.wantedPoliceLastHp=String(drone.hp);}
  return true;
}

function installPoliceHitApi(){const currentBridge=bridge();if(!currentBridge)return false;currentBridge.registerPoliceHit=registerPoliceHit;return true;}

function updateSensors(player,now){
  let seesPlayer=false;const radius=wantedDetectionRadiusM(stars);
  for(const drone of drones){
    if(!drone.active)continue;drone.distance=drone.root.position.distanceTo(player);
    if(now>=drone.nextSensorAt){drone.nextSensorAt=now+SENSOR_INTERVAL_MS+drone.index*7;drone.seesPlayer=drone.distance<=radius&&lineOfSight(drone.root.position,player);}
    if(drone.seesPlayer)seesPlayer=true;
  }
  if(seesPlayer){lastKnownPosition.copy(player);lastContactAt=now;}
  return seesPlayer;
}

function droneGoal(drone,now){
  const searching=phase==="searching",angle=drone.index/MAX_POLICE_DRONES*Math.PI*2+now*(searching? .00035:.00016),radius=searching?11+(drone.index%3)*5:8+(drone.index%2)*4;
  goalPosition.set(lastKnownPosition.x+Math.cos(angle)*radius,lastKnownPosition.y+Math.sin(angle)*radius,lastKnownPosition.z+wantedPoliceAltitudeOffsetM(drone.index,phase));
  if(now>=drone.nextGoalRoofAt){drone.nextGoalRoofAt=now+125+drone.index*9;drone.goalRoof=buildingTopAt(goalPosition.x,goalPosition.y);}goalPosition.z=Math.max(.85,goalPosition.z,drone.goalRoof?drone.goalRoof+1.6:0);drone.goal.copy(goalPosition);return drone.goal;
}

function updateDroneMotion(drone,now,dt){
  const goal=droneGoal(drone,now),distance=drone.root.position.distanceTo(goal),healthScale=drone.critical? .68:1,maxSpeed=((phase==="searching"?6.4:8.4+stars*.72)+(distance>45?3.8:0))*healthScale,speed=Math.min(maxSpeed,Math.max(1.8,distance*.72));
  const physics=rigidBodies(),id=`police-drone-${drone.index}`;physics?.setTarget?.(id,{position:[goal.x,goal.y,goal.z],speedMps:speed,response:3.5,maxAccelerationMps2:13});const pose=physics?.pose?.(id);
  if(pose){drone.root.position.set(...pose.position);drone.root.quaternion.set(...pose.rotation);drone.velocity.set(...pose.velocity);}else{desiredVelocity.copy(goal).sub(drone.root.position);if(desiredVelocity.lengthSq()>1e-6)desiredVelocity.normalize().multiplyScalar(speed);const response=1-Math.exp(-3.4*dt);drone.velocity.lerp(desiredVelocity,response);proposedPosition.copy(drone.root.position).addScaledVector(drone.velocity,dt);if(now>=drone.nextCollisionAt){drone.nextCollisionAt=now+90+drone.index*6;drone.collisionRoof=buildingTopAt(proposedPosition.x,proposedPosition.y);}const roof=drone.collisionRoof;if(roof&&proposedPosition.z<roof+1.15){proposedPosition.x=drone.root.position.x;proposedPosition.y=drone.root.position.y;proposedPosition.z=Math.min(roof+1.7,drone.root.position.z+Math.max(2.5,roof-drone.root.position.z+1)*dt);drone.velocity.x*=.45;drone.velocity.y*=.45;drone.velocity.z=Math.max(2.5,drone.velocity.z);}drone.root.position.copy(proposedPosition);if(Math.hypot(drone.velocity.x,drone.velocity.y)>.08)drone.root.rotation.z=Math.atan2(drone.velocity.y,drone.velocity.x);}
  const rotorAngle=now*.031+drone.index;for(const rotor of drone.rotors)rotor.rotation.z=rotorAngle;const lightSlot=(Math.floor((now+drone.index*37)/92)%8+8)%8,redOn=lightSlot===0||lightSlot===1,blueOn=lightSlot===4||lightSlot===5;drone.red.visible=drone.redHalo.visible=redOn;drone.blue.visible=drone.blueHalo.visible=blueOn;drone.emergencyLight.color.setHex(redOn?0xff1834:0x1688ff);drone.emergencyLight.intensity=redOn||blueOn?24:0;if(now>=drone.hitUntil)drone.flash.visible=false;else drone.root.scale.setScalar(1.08);if(now>=drone.hitUntil)drone.root.scale.lerp(unitScale,Math.min(1,dt*12));if(now>=drone.tracerUntil)drone.tracer.visible=false;
}

function showTracer(drone,from,to,now){
  tracerVector.copy(to).sub(from);const length=tracerVector.length();if(length<.05)return;drone.tracer.position.copy(from).addScaledVector(tracerVector,.5);drone.tracer.quaternion.setFromUnitVectors(upAxis,tracerVector.normalize());drone.tracer.scale.set(1,Math.min(45,length),1);drone.tracer.visible=true;drone.tracerUntil=now+92;
}

function applyPlayerDamage(drone,now){
  if(now-lastPlayerDamageAt<PLAYER_DAMAGE_COOLDOWN_MS||currentPlayerHp()<=0)return false;lastPlayerDamageAt=now;const amount=wantedPoliceDamage(stars),before=currentPlayerHp();
  window.dispatchEvent(new CustomEvent("arondight:player-damage",{detail:{damage:amount,source:"police-drone",policeDrone:drone.index}}));let after=currentPlayerHp();
  const model=globalThis.__arondightPlayerDamageModel;if(after===before&&typeof model?.damage==="function")after=Number(model.damage(amount,"police-drone"));
  window.dispatchEvent(new CustomEvent("arondight:combat-damage",{detail:{damage:amount,hp:Number.isFinite(after)?after:Math.max(0,before-amount),source:"police-drone"}}));
  const view=viewport();if(view){view.dataset.wantedPoliceDamage=String((Number(view.dataset.wantedPoliceDamage)||0)+amount);view.dataset.wantedPoliceShotsHit=String((Number(view.dataset.wantedPoliceShotsHit)||0)+1);view.dataset.wantedPoliceLastDamage=String(amount);view.dataset.wantedPoliceHitGraceMs=String(PLAYER_DAMAGE_COOLDOWN_MS);}return true;
}

function updateDroneAttack(drone,player,now){
  if(phase!=="pursuit"||!drone.seesPlayer||drone.distance<4.5||drone.distance>34+stars*2||now<drone.engageAt||now<drone.nextShotAt||currentPlayerHp()<=0)return;
  drone.nextShotAt=now+Math.max(980,2050-stars*130+drone.index*61);tmpPosition.copy(player);tmpPosition.x+=(drone.index%2? .18:-.18);tmpPosition.z+=.05;showTracer(drone,drone.root.position,tmpPosition,now);playTone({frequency:310,endFrequency:145,duration:.075,gain:.015,type:"square"});applyPlayerDamage(drone,now);
  const view=viewport();if(view)view.dataset.wantedPoliceShots=String((Number(view.dataset.wantedPoliceShots)||0)+1);
}

function updateWanted(now,dt){
  installPoliceHitApi();for(const drone of drones)updateExplosion(drone,now);
  if(stars<=0){if(heat>0&&now-lastCrimeAt>CRIME_MEMORY_MS)heat=0;renderHud(0);return;}
  const player=currentPlayerPosition();if(!player)return;
  if(currentPlayerHp()<=0){clearWanted("busted");return;}
  syncPoliceCount(player,now);const seesPlayer=updateSensors(player,now),search=wantedSearchState({stars,seesPlayer,now,lastContactAt});lastContactAt=search.lastContactAt;phase=search.phase;
  if(search.escaped){clearWanted("escaped");return;}
  for(const drone of drones)if(drone.active){updateDroneMotion(drone,now,dt);updateDroneAttack(drone,player,now);}updateSiren(now);renderHud(search.remainingMs);
}

function onWorldKill(event){const detail=event?.detail||{};if(detail.remote||detail.network===false)return;reportCrime(detail);}
function onCombatKill(event){const detail=event?.detail||{};if(!detail.killed||detail.self||detail.world||detail.police)return;reportCrime({id:`player-${Date.now().toString(36)}-${Math.floor(performance.now()).toString(36)}`,kind:"player"});}
function onPhysicsImpact(event){const detail=event?.detail||{},id=String(detail.id||""),match=id.match(/^police-drone-(\d+)$/),drone=match?drones[Number(match[1])]:null;if(!drone?.active)return;const now=performance.now(),impact=Number(detail.deltaVelocityMps)||0;drone.hitUntil=Math.max(drone.hitUntil,now+90);drone.flash.visible=true;if(impact>=3.8&&now-drone.lastCollisionDamageAt>520){drone.lastCollisionDamageAt=now;const damage=clamp(Math.round((impact-3.2)*5),3,18);drone.hp=Math.max(0,drone.hp-damage);if(isCriticalDamage("police-drone",drone.hp,POLICE_HP))armPoliceCritical(drone,now,drone.critical||drone.hp===0);}const view=viewport();if(view){view.dataset.wantedPolicePhysicalImpacts=String((Number(view.dataset.wantedPolicePhysicalImpacts)||0)+1);view.dataset.wantedPoliceLastImpactMps=impact.toFixed(2);view.dataset.wantedPoliceLastHp=String(drone.hp);}}

function frame(now=performance.now()){
  requestAnimationFrame(frame);const dt=clamp((now-lastFrameAt)/1000,0,MAX_FRAME_DT);lastFrameAt=now;installHud();if(!ensureScene()){renderHud(0);return;}updateWanted(now,dt);
}

export function installWantedPoliceDrones(){
  if(installed)return globalThis.__arondightWantedSystem;installed=true;installHud();installPoliceHitApi();
  addEventListener(WORLD_KILL_EVENT,onWorldKill);addEventListener("arondight:combat-hit-confirm",onCombatKill);addEventListener("arondight:world-physics-impact",onPhysicsImpact);addEventListener(AUDIO_SETTINGS_EVENT,event=>{audioSettings=normalizeAudioSettings(event.detail||loadAudioSettings());});
  const unlock=()=>{audioUnlocked=true;ensureAudio();};addEventListener("pointerdown",unlock,{capture:true,passive:true});addEventListener("keydown",unlock,{capture:true});
  document.addEventListener("click",event=>{const target=event.target instanceof Element?event.target.closest("#reset,#soloReset"):null;if(target)clearWanted("reset");},{capture:true,passive:true});
  const api={reportCrime,clear:clearWanted,get state(){return{heat,stars,phase,policeActive:drones.filter(drone=>drone.active).length,policeKills,lastContactAt,lastCrimeAt};},get drones(){return drones.slice();}};globalThis.__arondightWantedSystem=api;const view=viewport();if(view)view.dataset.wantedSystem="heat+fair-physics-police-drones-v3";requestAnimationFrame(frame);return api;
}

installWantedPoliceDrones();
