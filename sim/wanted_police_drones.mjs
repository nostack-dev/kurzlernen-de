import * as THREE from "three";
import {AUDIO_SETTINGS_EVENT,loadAudioSettings,normalizeAudioSettings} from "./audio_settings.mjs";
import {accelerateCriticalDetonation,criticalDamageProfile,isCriticalDamage} from "./critical_damage_logic.mjs";
import {WANTED_EMP_COOLDOWN_MS,WANTED_EMP_RANGE_M,wantedCrimeSeverity,wantedDetectionRadiusM,wantedEmpImpulseNs,wantedEscapeDurationMs,wantedLineBlockedByPrisms,wantedPointInRing,wantedPoliceAltitudeOffsetM,wantedPoliceCount,wantedPoliceDamage,wantedPoliceEngageDelayMs,wantedPoliceHitChance,wantedPoliceShotIntervalMs,wantedPoliceSpawnRadiusM,wantedPoliceWaveBreakMs,wantedSearchState,wantedStarsForHeat} from "./wanted_system_logic.mjs";
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
const EMP_GRAVITY_SCALE=1.35;
const EMP_RESPAWN_MS=12000;
const EMP_EFFECT_MS=720;
const upAxis=new THREE.Vector3(0,1,0);

const drones=[];
const seenCrimes=new Map();
const playerPosition=new THREE.Vector3();
const previousPlayerPosition=new THREE.Vector3();
const lastKnownPosition=new THREE.Vector3();
const goalPosition=new THREE.Vector3();
const desiredVelocity=new THREE.Vector3();
const proposedPosition=new THREE.Vector3();
const tracerVector=new THREE.Vector3();
const tmpPosition=new THREE.Vector3();
const formationPosition=new THREE.Vector3();
const empDirection=new THREE.Vector3();
const unitScale=new THREE.Vector3(1,1,1);
const lastTargetDamageAt={player:-Infinity,drone:-Infinity};

let installed=false;
let sceneRef=null;
let policeRoot=null;
let hud=null;
let empButton=null;
let empPulse=null;
let heat=0;
let stars=0;
let phase="clear";
let lastCrimeAt=-Infinity;
let lastContactAt=-Infinity;
let lastFrameAt=performance.now();
let escapedBannerUntil=-Infinity;
let clearReason="";
let audioContext=null;
let audioUnlocked=false;
let audioSettings=loadAudioSettings();
let nextSirenAt=-Infinity;
let sirenHigh=false;
let policeKills=0;
let empReadyAt=-Infinity;
let empFeedbackUntil=-Infinity;
let empActivations=0;
let empLastAffected=0;
let empInRangeCount=0;
let waveNumber=0;
let waveStartedAt=-Infinity;
let nextWaveAt=-Infinity;
let playerSpeedMps=0;
let playerSampleAt=-Infinity;

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
  if(!empButton){
    empButton=document.createElement("button");empButton.id="wantedEmpButton";empButton.type="button";empButton.hidden=true;empButton.dataset.state="empty";empButton.setAttribute("aria-label",`Emergency EMP. ${WANTED_EMP_RANGE_M} meter range.`);empButton.innerHTML=`<strong>EMP</strong><small>${WANTED_EMP_RANGE_M} m · READY</small>`;empButton.addEventListener("pointerdown",event=>{event.preventDefault();event.stopPropagation();triggerEmp();});view.appendChild(empButton);
  }
  if(!document.querySelector("style[data-wanted-police]")){
    const style=document.createElement("style");
    style.dataset.wantedPolice="police-drones-v1";
    style.textContent=`
#wantedHud{display:none;position:absolute;z-index:17;left:50%;top:max(48px,calc(var(--solo-safe-top,env(safe-area-inset-top)) + 42px));transform:translateX(-50%);min-width:190px;padding:7px 12px 8px;border:1px solid #5ab8ff66;border-radius:10px;background:linear-gradient(180deg,#07111aee,#090d14e8);box-shadow:0 6px 22px #000a,0 0 20px #207dca22;color:#fff;text-align:center;pointer-events:none;font-family:system-ui,-apple-system,sans-serif;backdrop-filter:blur(5px)}
body.solo-flight #wantedHud:not([hidden]){display:block}#wantedHud[hidden]{display:none!important}.wanted-stars{height:18px;white-space:nowrap}.wanted-stars i{display:inline-block;margin:0 1px;color:#39424c;font:900 20px/1 system-ui;font-style:normal;text-shadow:0 1px 2px #000}.wanted-stars i.hot{color:#ffd34f;text-shadow:0 0 7px #ff9c28,0 1px 2px #000}#wantedHud strong{display:block;margin-top:1px;font:950 9px/1 system-ui;letter-spacing:.18em;color:#e9f6ff}#wantedHud small{display:block;margin-top:4px;font:850 8px/1.15 system-ui;letter-spacing:.06em;color:#8ed6ff;white-space:nowrap}#wantedHud[data-phase="pursuit"]{border-color:#ff576988;box-shadow:0 6px 22px #000a,0 0 22px #ff294333}#wantedHud[data-phase="pursuit"] small{color:#ff8ea0}#wantedHud[data-phase="searching"] .wanted-stars i.hot{animation:wantedSearchBlink .72s steps(1,end) infinite}#wantedHud[data-phase="escaped"]{border-color:#6be4b088;box-shadow:0 6px 22px #000a,0 0 20px #32c98a33}#wantedHud[data-phase="escaped"] strong,#wantedHud[data-phase="escaped"] small{color:#8ff0c8}@keyframes wantedSearchBlink{0%,48%{opacity:1}49%,100%{opacity:.22}}@media(max-height:340px){#wantedHud{top:max(37px,calc(var(--solo-safe-top,env(safe-area-inset-top)) + 32px));min-width:166px;padding:4px 9px 5px}.wanted-stars{height:14px}.wanted-stars i{font-size:16px}#wantedHud strong{font-size:8px}#wantedHud small{font-size:7px;margin-top:3px}}
#wantedEmpButton{display:none;position:absolute;z-index:20;right:max(16px,var(--solo-safe-right,env(safe-area-inset-right)));top:max(58px,calc(var(--solo-safe-top,env(safe-area-inset-top)) + 50px));width:108px;height:68px;padding:7px 8px;border:2px solid #73e7ffcc;border-radius:18px;background:radial-gradient(circle at 38% 28%,#176f87,#0a3448 58%,#061c2a);color:#effcff;box-shadow:0 8px 26px #000a,0 0 0 4px #43d9ff1f,inset 0 0 22px #4ce4ff28;pointer-events:auto;touch-action:manipulation;user-select:none;-webkit-tap-highlight-color:transparent;flex-direction:column;align-items:center;justify-content:center;gap:4px}body.solo-flight #wantedEmpButton:not([hidden]){display:flex}#wantedEmpButton[hidden]{display:none!important}#wantedEmpButton strong{font:950 22px/1 system-ui;letter-spacing:.09em;text-shadow:0 2px 5px #000}#wantedEmpButton small{font:850 8px/1.05 system-ui;letter-spacing:.05em;white-space:nowrap;color:#aeefff}#wantedEmpButton[data-state="ready"]{animation:wantedEmpReady 1.35s ease-in-out infinite}#wantedEmpButton[data-state="empty"]{border-color:#8aa8b477;background:linear-gradient(180deg,#18313dcc,#101d27dd);box-shadow:0 7px 22px #0008}#wantedEmpButton[data-state="empty"] small{color:#a8bac3}#wantedEmpButton[data-state="miss"]{border-color:#ffce7299;background:linear-gradient(180deg,#493a1dcc,#271d10e8)}#wantedEmpButton[data-state="cooldown"]{border-color:#536e7b88;background:conic-gradient(from 0deg,#12384a,#0c1c27 70%,#132b37);box-shadow:0 7px 20px #0008;animation:none}#wantedEmpButton:disabled{opacity:.76!important;cursor:not-allowed}#wantedEmpButton:not(:disabled):active{transform:scale(.94);filter:brightness(1.2)}@keyframes wantedEmpReady{0%,100%{box-shadow:0 8px 26px #000a,0 0 0 4px #43d9ff18,0 0 12px #2edfff55,inset 0 0 22px #4ce4ff28}50%{box-shadow:0 8px 26px #000a,0 0 0 7px #43d9ff24,0 0 28px #2edfff99,inset 0 0 28px #4ce4ff42}}@media(max-height:340px){#wantedEmpButton{top:max(42px,calc(var(--solo-safe-top,env(safe-area-inset-top)) + 36px));width:94px;height:58px;border-radius:15px;padding:5px 6px}#wantedEmpButton strong{font-size:18px}#wantedEmpButton small{font-size:7px}}
`;
    document.head.appendChild(style);
  }
  return true;
}

function dronesInEmpRange(player){return player?drones.filter(drone=>drone.active&&!drone.empDisabled&&drone.root.position.distanceTo(player)<=WANTED_EMP_RANGE_M):[];}

function renderEmpControl(now=performance.now()){
  if(!empButton)return;const show=stars>0;empButton.hidden=!show;if(!show){empInRangeCount=0;return;}
  const player=currentPlayerPosition(playerPosition),targets=dronesInEmpRange(player),remaining=Math.max(0,empReadyAt-now);empInRangeCount=targets.length;empButton.disabled=remaining>0;
  const label=empButton.querySelector("small");if(remaining>0){empButton.dataset.state="cooldown";label.textContent=`COOLDOWN ${(remaining/1000).toFixed(1)} s`;}else if(targets.length){empButton.dataset.state="ready";label.textContent=`${targets.length} IN RANGE · ${WANTED_EMP_RANGE_M} m`;}else if(now<empFeedbackUntil){empButton.dataset.state="miss";label.textContent="NO TARGET IN RANGE";}else{empButton.dataset.state="empty";label.textContent=`0 IN RANGE · ${WANTED_EMP_RANGE_M} m`;}
  empButton.setAttribute("aria-label",remaining>0?`Emergency EMP recharging. ${Math.ceil(remaining/1000)} seconds remaining.`:targets.length?`Fire emergency EMP at ${targets.length} police ${targets.length===1?"drone":"drones"} in range.`:`Emergency EMP ready. No police drones within ${WANTED_EMP_RANGE_M} meters.`);
}

function updateTelemetry(remainingMs=0){
  const view=viewport();
  if(!view)return;
  const now=performance.now();view.dataset.wantedSystem="heat+fair-physics-police-drones-v4";
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
  view.dataset.wantedPoliceDamageModel="independent-pilot+drone-targets+1050ms-grace-v4";
  view.dataset.wantedPoliceDamagePresentation="critical-smoke+delayed-explosion-v1";
  view.dataset.wantedPoliceCritical=String(drones.filter(drone=>drone.active&&drone.critical).length);
  view.dataset.wantedPoliceLights=String(drones.filter(drone=>drone.active&&(drone.red.visible||drone.blue.visible)).length);
  view.dataset.wantedEmp="radial-box3d-gravity-blast-v1";
  view.dataset.wantedEmpRangeM=String(WANTED_EMP_RANGE_M);
  view.dataset.wantedEmpCooldownMs=String(WANTED_EMP_COOLDOWN_MS);
  view.dataset.wantedEmpCooldownRemainingMs=String(Math.max(0,Math.round(empReadyAt-now)));
  view.dataset.wantedEmpReady=now>=empReadyAt?"1":"0";
  view.dataset.wantedEmpInRange=String(empInRangeCount);
  view.dataset.wantedEmpActivations=String(empActivations);
  view.dataset.wantedEmpLastAffected=String(empLastAffected);
  view.dataset.wantedEmpDisabled=String(drones.filter(drone=>drone.active&&drone.empDisabled).length);
  view.dataset.wantedEmpGravityScale=String(EMP_GRAVITY_SCALE);
  view.dataset.wantedEmpPulseActive=empPulse?.group.visible?"1":"0";
  view.dataset.wantedPoliceWaves="far-group+breather-v1";
  view.dataset.wantedPoliceWave=String(waveNumber);
  view.dataset.wantedPoliceNextWaveMs=String(Number.isFinite(nextWaveAt)?Math.max(0,Math.round(nextWaveAt-now)):0);
  view.dataset.wantedPoliceAccuracy="distance+movement+deterministic-spread-v1";
  view.dataset.wantedPoliceTargeting="mesh-position+los+split-roles-v1";
  view.dataset.wantedPolicePlayerTargets=String(drones.filter(drone=>drone.active&&drone.targetKind==="player").length);
  view.dataset.wantedPoliceDroneTargets=String(drones.filter(drone=>drone.active&&drone.targetKind==="drone").length);
  view.dataset.wantedPoliceDisengage="los-search-cooldown+physical-retreat-v1";
  view.dataset.wantedPoliceRetreating=String(drones.filter(drone=>drone.active&&drone.retreating).length);
  view.dataset.wantedPlayerSpeedMps=playerSpeedMps.toFixed(2);
  if(clearReason)view.dataset.wantedLastClear=clearReason;
}

function renderHud(remainingMs=0){
  if(!installHud())return;
  const now=performance.now(),showWanted=stars>0,showBanner=now<escapedBannerUntil;
  renderEmpControl(now);
  hud.hidden=!showWanted&&!showBanner;
  if(hud.hidden){updateTelemetry(0);return;}
  const starNodes=hud.querySelectorAll(".wanted-stars i"),title=hud.querySelector("strong"),detail=hud.querySelector("small");
  starNodes.forEach((node,index)=>node.classList.toggle("hot",showWanted&&index<stars));
  const active=drones.filter(drone=>drone.active).length;
  if(showBanner){hud.dataset.phase="escaped";title.textContent=clearReason==="busted"?"BUSTED":"ESCAPED";detail.textContent=clearReason==="busted"?"POLICE PURSUIT ENDED":"WANTED LEVEL CLEARED";hud.setAttribute("aria-label",title.textContent);}
  else if(active===0&&Number.isFinite(nextWaveAt)&&now<nextWaveAt){const waveWait=Math.max(0,nextWaveAt-now);hud.dataset.phase="searching";title.textContent="WAVE CLEARED";detail.textContent=`HIDE NOW · NEXT ${(waveWait/1000).toFixed(1)} s`;hud.setAttribute("aria-label",`Police wave cleared. Hide now. Next wave in ${Math.ceil(waveWait/1000)} seconds.`);}
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

function ensureEmpPulse(){
  if(!sceneRef)return null;if(empPulse?.group?.parent===sceneRef)return empPulse;empPulse?.group?.parent?.remove(empPulse.group);
  const group=new THREE.Group(),shell=new THREE.Mesh(new THREE.SphereGeometry(1,18,12),new THREE.MeshBasicMaterial({color:0x65eaff,transparent:true,opacity:0,wireframe:true,depthWrite:false,blending:THREE.AdditiveBlending})),ring=new THREE.Mesh(new THREE.TorusGeometry(1,.026,6,36),new THREE.MeshBasicMaterial({color:0xb7f7ff,transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending}));ring.rotation.x=Math.PI/2;for(const mesh of[shell,ring]){mesh.frustumCulled=false;mesh.userData.flightFireIgnore=true;}group.name="WANTED_EMP_PULSE";group.visible=false;group.renderOrder=35;group.userData.flightFireIgnore=true;group.add(shell,ring);sceneRef.add(group);empPulse={group,shell,ring,born:-Infinity,expires:-Infinity};return empPulse;
}

function startEmpPulse(position,now=performance.now()){
  const pulse=ensureEmpPulse();if(!pulse||!position)return false;pulse.group.position.copy(position);pulse.group.scale.setScalar(.15);pulse.group.visible=true;pulse.born=now;pulse.expires=now+EMP_EFFECT_MS;pulse.shell.material.opacity=.42;pulse.ring.material.opacity=.82;return true;
}

function updateEmpPulse(now){
  const pulse=empPulse;if(!pulse?.group.visible)return;if(now>=pulse.expires){pulse.group.visible=false;return;}const t=clamp((now-pulse.born)/EMP_EFFECT_MS,0,1),eased=1-(1-t)**3,radius=.15+(WANTED_EMP_RANGE_M-.15)*eased;pulse.group.scale.setScalar(radius);pulse.group.rotation.z=t*.7;pulse.shell.material.opacity=.38*(1-t)**1.35;pulse.ring.material.opacity=.78*(1-t)**1.05;
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
  return{index,root,body,rotors,red,blue,redHalo,blueHalo,emergencyLight,flash,hitbox,tracer,explosion:createExplosion(index),velocity:new THREE.Vector3(),goal:new THREE.Vector3(),retreatGoal:new THREE.Vector3(),targetPosition:new THREE.Vector3(),targetKind:"",targetSpeedMps:0,active:false,hp:POLICE_HP,critical:false,criticalExpiresAt:Infinity,lastCollisionDamageAt:-Infinity,destroyedUntil:0,spawnSerial:0,shotSerial:0,spawnedAt:0,engageAt:0,nextShotAt:0,tracerUntil:0,hitUntil:0,nextSensorAt:0,nextGoalRoofAt:0,nextCollisionAt:0,goalRoof:0,collisionRoof:0,seesPlayer:false,distance:Infinity,empDisabled:false,empDisabledAt:-Infinity,empImpactAt:-Infinity,retreating:false,retreatUntil:-Infinity};
}

function ensureScene(){
  const scene=bridge()?.threeScene;if(!scene)return false;
  if(scene===sceneRef&&policeRoot)return true;
  for(const drone of drones)rigidBodies()?.removeBody?.(`police-drone-${drone.index}`);policeRoot?.parent?.remove(policeRoot);empPulse?.group?.parent?.remove(empPulse.group);empPulse=null;sceneRef=scene;policeRoot=new THREE.Group();policeRoot.name="WANTED_POLICE_DRONES";scene.add(policeRoot);drones.splice(0,drones.length);for(let index=0;index<MAX_POLICE_DRONES;index++)drones.push(createDrone(index));ensureEmpPulse();return true;
}

function currentPlayerPosition(out=playerPosition){
  const walk=globalThis.__arondightWalkMode;
  if(walk?.mode==="foot"&&walk.position&&[walk.position.x,walk.position.y,walk.position.z].every(Number.isFinite))return out.set(walk.position.x,walk.position.y,walk.position.z);
  const currentBridge=bridge(),airframe=currentBridge?.threeScene?(currentBridge.airframeFor?.(currentBridge.threeScene)||currentBridge.airframe):null;
  if(airframe?.getWorldPosition){airframe.updateWorldMatrix?.(true,false);airframe.getWorldPosition(out);if([out.x,out.y,out.z].every(Number.isFinite))return out;}
  return null;
}

function updatePlayerSpeed(player,now){
  if(!player)return playerSpeedMps;if(!Number.isFinite(playerSampleAt)){previousPlayerPosition.copy(player);playerSampleAt=now;playerSpeedMps=0;return 0;}const dt=Math.max(.001,(now-playerSampleAt)/1000);if(dt<.035)return playerSpeedMps;const measured=Math.min(12,player.distanceTo(previousPlayerPosition)/dt),blend=1-Math.exp(-6*dt);playerSpeedMps+= (measured-playerSpeedMps)*blend;previousPlayerPosition.copy(player);playerSampleAt=now;return playerSpeedMps;
}

function currentPlayerHp(){
  const model=globalThis.__arondightPlayerDamageModel,value=Number(model?.hp);
  if(Number.isFinite(value))return clamp(value,0,100);
  const currentBridge=bridge(),fallback=Number(currentBridge?.vsLocalHealth);return Number.isFinite(fallback)?clamp(fallback,0,100):100;
}

function currentDamageTargets(){
  const targets=globalThis.__arondightPlayerVitals?.damageTargets?.();if(Array.isArray(targets))return targets.filter(target=>target&&(target.kind==="player"||target.kind==="drone")&&target.position&&Number(target.hp)>0);
  const player=currentPlayerPosition(new THREE.Vector3()),droneMode=globalThis.__arondightWalkMode?.mode!=="foot",model=droneMode?globalThis.__arondightDroneDamageModel:globalThis.__arondightPlayerDamageModel,hp=Number(model?.hp);return player&&Number.isFinite(hp)&&hp>0?[{kind:droneMode?"drone":"player",model,hp,position:{x:player.x,y:player.y,z:player.z},speedMps:playerSpeedMps}]:[];
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
  stopWorldCriticalDamage(id);drone.root.position.set(x,y,z);drone.root.rotation.set(0,0,angle+Math.PI);drone.root.scale.setScalar(1);drone.velocity.set(-Math.sin(angle)*1.2,Math.cos(angle)*1.2,0);drone.hp=POLICE_HP;drone.critical=false;drone.criticalExpiresAt=Infinity;drone.lastCollisionDamageAt=-Infinity;drone.empDisabled=false;drone.empDisabledAt=-Infinity;drone.empImpactAt=-Infinity;drone.retreating=false;drone.retreatUntil=-Infinity;drone.targetKind="";drone.targetSpeedMps=0;drone.targetPosition.copy(player);drone.active=true;drone.root.visible=true;drone.hitbox.visible=true;drone.flash.visible=false;drone.hitUntil=0;drone.spawnSerial++;drone.shotSerial=0;drone.spawnedAt=now;drone.engageAt=now+wantedPoliceEngageDelayMs(stars);drone.nextShotAt=drone.engageAt+drone.index*160;drone.nextSensorAt=now+drone.index*24;drone.nextGoalRoofAt=0;drone.nextCollisionAt=0;drone.goalRoof=0;drone.collisionRoof=0;drone.seesPlayer=false;drone.distance=drone.root.position.distanceTo(player);drone.tracer.visible=false;rigidBodies()?.upsertBody?.({id,kind:"police-drone",position:[x,y,z],yaw:angle+Math.PI,halfExtents:[.79,.79,.34],massKg:18,gravityScale:0,linearDamping:.38,angularDamping:1.1});const view=viewport();if(view){view.dataset.wantedPoliceSpawnDistanceM=radius.toFixed(1);view.dataset.wantedPoliceInboundMs=String(Math.round(drone.engageAt-now));}
}

function deactivateDrone(drone){const id=`police-drone-${drone.index}`;stopWorldCriticalDamage(id);drone.active=false;drone.critical=false;drone.criticalExpiresAt=Infinity;drone.empDisabled=false;drone.empDisabledAt=-Infinity;drone.empImpactAt=-Infinity;drone.retreating=false;drone.retreatUntil=-Infinity;drone.targetKind="";drone.targetSpeedMps=0;drone.root.visible=false;drone.hitbox.visible=false;drone.tracer.visible=false;drone.seesPlayer=false;drone.distance=Infinity;drone.emergencyLight.intensity=0;rigidBodies()?.removeBody?.(id);}

function beginPoliceRetreat(drone,now){if(!drone?.active)return;const dx=drone.root.position.x-lastKnownPosition.x,dy=drone.root.position.y-lastKnownPosition.y,length=Math.hypot(dx,dy)||1,angle=length>1?Math.atan2(dy,dx):drone.index/MAX_POLICE_DRONES*Math.PI*2;drone.retreating=true;drone.retreatUntil=now+3600+drone.index*140;drone.seesPlayer=false;drone.nextShotAt=Infinity;drone.hitbox.visible=false;drone.retreatGoal.set(drone.root.position.x+Math.cos(angle)*96,drone.root.position.y+Math.sin(angle)*96,safeAltitude(drone.root.position.x+Math.cos(angle)*96,drone.root.position.y+Math.sin(angle)*96,drone.root.position.z+4.5));rigidBodies()?.clearTarget?.(`police-drone-${drone.index}`);}

function updatePoliceRetreats(now,dt){for(const drone of drones){if(!drone.active||!drone.retreating)continue;if(now>=drone.retreatUntil||drone.root.position.distanceTo(drone.retreatGoal)<2){deactivateDrone(drone);continue;}const id=`police-drone-${drone.index}`,physics=rigidBodies();physics?.setTarget?.(id,{position:[drone.retreatGoal.x,drone.retreatGoal.y,drone.retreatGoal.z],speedMps:13,response:2.8,maxAccelerationMps2:15});const pose=physics?.pose?.(id);if(pose){drone.root.position.set(...pose.position);drone.root.quaternion.set(...pose.rotation);drone.velocity.set(...pose.velocity);}else{desiredVelocity.copy(drone.retreatGoal).sub(drone.root.position);if(desiredVelocity.lengthSq()>1e-6)desiredVelocity.normalize().multiplyScalar(13);drone.velocity.lerp(desiredVelocity,1-Math.exp(-2.8*dt));drone.root.position.addScaledVector(drone.velocity,dt);}const rotorAngle=now*.031+drone.index;for(const rotor of drone.rotors)rotor.rotation.z=rotorAngle;const blink=Math.floor((now+drone.index*80)/180)%2===0;drone.red.visible=drone.redHalo.visible=blink;drone.blue.visible=drone.blueHalo.visible=!blink;drone.emergencyLight.intensity=12;}}

function syncPoliceWaves(player,now){
  const desired=wantedPoliceCount(stars);let active=drones.filter(drone=>drone.active).length;if(active>desired)for(const drone of[...drones].reverse())if(drone.active&&active>desired){deactivateDrone(drone);active--;}
  if(active>0){nextWaveAt=Infinity;return active;}if(nextWaveAt===Infinity)nextWaveAt=now+wantedPoliceWaveBreakMs(stars);else if(nextWaveAt===-Infinity)nextWaveAt=now;if(now<nextWaveAt)return 0;
  const available=drones.filter(drone=>!drone.active&&now>=drone.destroyedUntil);if(available.length<desired){const readyTimes=drones.filter(drone=>!drone.active).map(drone=>drone.destroyedUntil).sort((a,b)=>a-b);nextWaveAt=Math.max(nextWaveAt,readyTimes[Math.max(0,desired-1)]||now+250);return 0;}
  const anchor=phase==="searching"?lastKnownPosition:player;waveNumber++;waveStartedAt=now;nextWaveAt=Infinity;for(const drone of available.slice(0,desired))spawnDrone(drone,anchor,now);const view=viewport();if(view){view.dataset.wantedPoliceWave=String(waveNumber);view.dataset.wantedPoliceWaveSpawns=String((Number(view.dataset.wantedPoliceWaveSpawns)||0)+1);}return desired;
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
  if(!drone?.active)return false;const crimeId=`police:${drone.index}:${drone.spawnSerial}`,empDisabled=drone.empDisabled;explodeDrone(drone,now);deactivateDrone(drone);drone.destroyedUntil=now+(empDisabled?EMP_RESPAWN_MS:POLICE_RESPAWN_MS);policeKills++;reportCrime({id:crimeId,kind:"police-drone",revealPlayer:false});const view=viewport();if(view){view.dataset.wantedPoliceCriticalExplosions=String((Number(view.dataset.wantedPoliceCriticalExplosions)||0)+1);view.dataset.wantedPoliceLastHp="0";}return true;
}

function armPoliceCritical(drone,now=performance.now(),accelerate=false){
  if(!drone?.active)return false;const id=`police-drone-${drone.index}`,profile=criticalDamageProfile("police-drone");if(!profile)return false;
  if(!drone.critical){const serial=drone.spawnSerial;drone.critical=true;drone.criticalExpiresAt=startWorldCriticalDamage({id,object:drone.root,kind:"police-drone",offset:[-.12,0,.18],scale:.68,delayMs:profile.delayMs,seed:`${id}:${serial}`,onExpire:()=>{if(drone.active&&drone.spawnSerial===serial&&drone.critical)destroyPoliceDrone(drone,performance.now());}})||now+profile.delayMs;}else if(accelerate){drone.criticalExpiresAt=accelerateCriticalDetonation("police-drone",drone.criticalExpiresAt,now);accelerateWorldCriticalDamage(id,drone.criticalExpiresAt);}const view=viewport();if(view){view.dataset.wantedPoliceCritical=String(drones.filter(item=>item.active&&item.critical).length);view.dataset.wantedPoliceDamagePresentation="critical-smoke+delayed-explosion-v1";}return true;
}

function triggerEmp(now=performance.now()){
  const sample=Number(now)||performance.now();if(stars<=0||sample<empReadyAt)return{activated:false,affected:0,reason:stars<=0?"clear":"cooldown"};const player=currentPlayerPosition(playerPosition),targets=dronesInEmpRange(player),physics=rigidBodies();
  if(!player||!targets.length||!physics?.ready){empFeedbackUntil=sample+1100;empLastAffected=0;renderEmpControl(sample);updateTelemetry();return{activated:false,affected:0,reason:!player?"no-player":!targets.length?"out-of-range":"physics-not-ready"};}
  let affected=0,strongestImpulse=0;
  for(const drone of targets){const id=`police-drone-${drone.index}`,distance=drone.root.position.distanceTo(player),impulse=wantedEmpImpulseNs(distance);empDirection.set(drone.root.position.x-player.x,drone.root.position.y-player.y,0);if(empDirection.lengthSq()<1e-4){const angle=drone.index/MAX_POLICE_DRONES*Math.PI*2;empDirection.set(Math.cos(angle),Math.sin(angle),0);}empDirection.normalize();const gravityEnabled=physics.setGravityScale?.(id,EMP_GRAVITY_SCALE),targetCleared=physics.clearTarget?.(id),kick=physics.applyImpulse?.(id,[empDirection.x*impulse,empDirection.y*impulse,-Math.max(16,impulse*.16)],{point:[drone.root.position.x,drone.root.position.y+(drone.index%2? .42:-.42),drone.root.position.z+.18]});if(!gravityEnabled||!targetCleared||!kick){if(gravityEnabled)physics.setGravityScale?.(id,0);continue;}drone.empDisabled=true;drone.empDisabledAt=sample;drone.empImpactAt=-Infinity;drone.seesPlayer=false;drone.nextShotAt=Infinity;drone.hp=Math.min(drone.hp,Math.ceil(POLICE_HP*.34));drone.hitUntil=sample+260;drone.flash.visible=true;armPoliceCritical(drone,sample);affected++;strongestImpulse=Math.max(strongestImpulse,impulse);}
  if(!affected){empFeedbackUntil=sample+1100;empLastAffected=0;renderEmpControl(sample);updateTelemetry();return{activated:false,affected:0,reason:"physics-rejected"};}
  empReadyAt=sample+WANTED_EMP_COOLDOWN_MS;empFeedbackUntil=-Infinity;empActivations++;empLastAffected=affected;startEmpPulse(player,sample);playTone({frequency:1120,endFrequency:170,duration:.34,gain:.052,type:"sawtooth"});window.dispatchEvent(new CustomEvent("arondight:emp-blast",{detail:{affected,rangeM:WANTED_EMP_RANGE_M,origin:[player.x,player.y,player.z]}}));const view=viewport();if(view){view.dataset.wantedEmpLastImpulseNs=strongestImpulse.toFixed(1);view.dataset.wantedEmpLastAt=String(Math.round(sample));}renderEmpControl(sample);updateTelemetry();return{activated:true,affected,reason:"fired"};
}

function reportCrime(detail={}){
  const kind=String(detail.kind||""),explicit=Number(detail.severity),severity=Number.isFinite(explicit)?Math.max(0,Math.min(5,Math.floor(explicit))):wantedCrimeSeverity(kind);
  const now=performance.now();if(severity<=0||!rememberCrime(detail.id,now))return false;
  heat=Math.min(99,heat+severity);const previousStars=stars;stars=wantedStarsForHeat(heat);lastCrimeAt=now;clearReason="";
  if(stars>0){const revealPlayer=detail.revealPlayer!==false;if(revealPlayer){phase="pursuit";lastContactAt=now;const player=currentPlayerPosition();if(player)lastKnownPosition.copy(player);}for(const drone of drones)if(drone.active&&drone.retreating){drone.retreating=false;drone.retreatUntil=-Infinity;drone.hitbox.visible=true;drone.engageAt=now+wantedPoliceEngageDelayMs(stars);drone.nextShotAt=drone.engageAt+drone.index*160;}if(stars>previousStars)playTone({frequency:520+stars*90,endFrequency:760+stars*100,duration:.16,gain:.022,type:"square"});}
  const view=viewport();if(view){view.dataset.wantedLastCrime=kind||"unknown";view.dataset.wantedCrimeEvents=String((Number(view.dataset.wantedCrimeEvents)||0)+1);}renderHud(wantedEscapeDurationMs(stars));return true;
}

function clearWanted(reason="escaped"){
  const now=performance.now(),hadWanted=stars>0;heat=0;stars=0;phase="clear";clearReason=String(reason||"clear");lastContactAt=-Infinity;lastCrimeAt=-Infinity;for(const drone of drones){if(reason==="escaped"&&drone.active&&!drone.empDisabled)beginPoliceRetreat(drone,now);else deactivateDrone(drone);}
  lastTargetDamageAt.player=-Infinity;lastTargetDamageAt.drone=-Infinity;waveNumber=0;waveStartedAt=-Infinity;nextWaveAt=-Infinity;playerSpeedMps=0;playerSampleAt=-Infinity;
  if(reason==="reset"){seenCrimes.clear();empReadyAt=-Infinity;empFeedbackUntil=-Infinity;empActivations=0;empLastAffected=0;empInRangeCount=0;}
  escapedBannerUntil=hadWanted&&reason!=="reset"?now+2100:-Infinity;if(hadWanted&&reason==="escaped")playTone({frequency:660,endFrequency:1040,duration:.22,gain:.023,type:"sine"});renderHud(0);return hadWanted;
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

function updateSensors(now){
  let seesPlayer=false,closestContact=null,closestDistance=Infinity;const radius=wantedDetectionRadiusM(stars),targets=currentDamageTargets();
  for(const drone of drones){
    if(!drone.active)continue;if(drone.empDisabled){drone.seesPlayer=false;drone.targetKind="";continue;}
    if(now>=drone.nextSensorAt){
      drone.nextSensorAt=now+SENSOR_INTERVAL_MS+drone.index*7;
      const visible=targets.map(target=>({target,distance:drone.root.position.distanceTo(target.position)})).filter(item=>item.distance<=radius&&lineOfSight(drone.root.position,item.target.position)).sort((a,b)=>a.distance-b.distance),nearest=visible[0]||null,preferredKind=drone.index%3===0?"player":"drone",preferred=visible.find(item=>item.target.kind===preferredKind),previous=visible.find(item=>item.target.kind===drone.targetKind);
      const selected=preferred&&preferred.distance<=nearest.distance+14?preferred:previous&&previous.distance<=nearest.distance+3?previous:nearest;
      drone.seesPlayer=Boolean(selected);if(selected){drone.targetKind=selected.target.kind;drone.targetPosition.set(selected.target.position.x,selected.target.position.y,selected.target.position.z);drone.targetSpeedMps=selected.target.kind==="drone"?playerSpeedMps:Number(selected.target.speedMps)||0;drone.distance=selected.distance;}else{drone.targetKind="";drone.targetSpeedMps=0;drone.distance=Infinity;}
    }
    if(drone.seesPlayer){seesPlayer=true;if(drone.distance<closestDistance){closestDistance=drone.distance;closestContact=drone.targetPosition;}}
  }
  if(closestContact){lastKnownPosition.copy(closestContact);lastContactAt=now;}
  return seesPlayer;
}

function droneGoal(drone,now){
  const searching=phase==="searching",angle=drone.index/MAX_POLICE_DRONES*Math.PI*2+now*(searching? .00035:.00016),radius=searching?11+(drone.index%3)*5:8+(drone.index%2)*4;
  const target=phase==="pursuit"&&drone.seesPlayer?drone.targetPosition:lastKnownPosition,controlled=phase==="pursuit"&&globalThis.__arondightWalkMode?.mode!=="foot"?currentPlayerPosition(formationPosition):null,formationZ=controlled?.z??target.z;goalPosition.set(target.x+Math.cos(angle)*radius,target.y+Math.sin(angle)*radius,formationZ+wantedPoliceAltitudeOffsetM(drone.index,phase));
  if(now>=drone.nextGoalRoofAt){drone.nextGoalRoofAt=now+125+drone.index*9;drone.goalRoof=buildingTopAt(goalPosition.x,goalPosition.y);}goalPosition.z=Math.max(.85,goalPosition.z,drone.goalRoof?drone.goalRoof+1.6:0);drone.goal.copy(goalPosition);return drone.goal;
}

function updateDroneMotion(drone,now,dt){
  const physics=rigidBodies(),id=`police-drone-${drone.index}`;
  if(drone.empDisabled){physics?.clearTarget?.(id);const pose=physics?.pose?.(id);if(pose){drone.root.position.set(...pose.position);drone.root.quaternion.set(...pose.rotation);drone.velocity.set(...pose.velocity);}else{drone.velocity.z-=9.80665*EMP_GRAVITY_SCALE*dt;drone.root.position.addScaledVector(drone.velocity,dt);drone.root.rotation.x+=dt*2.4;drone.root.rotation.y-=dt*1.7;if(drone.root.position.z<.34){drone.root.position.z=.34;drone.velocity.multiplyScalar(.22);if(now-drone.empImpactAt>500){drone.empImpactAt=now;armPoliceCritical(drone,now,true);}}}}
  else{const goal=droneGoal(drone,now),distance=drone.root.position.distanceTo(goal),healthScale=drone.critical? .68:1,maxSpeed=((phase==="searching"?6.4:8.4+stars*.72)+(distance>45?3.8:0))*healthScale,speed=Math.min(maxSpeed,Math.max(1.8,distance*.72));physics?.setTarget?.(id,{position:[goal.x,goal.y,goal.z],speedMps:speed,response:3.5,maxAccelerationMps2:13});const pose=physics?.pose?.(id);if(pose){drone.root.position.set(...pose.position);drone.root.quaternion.set(...pose.rotation);drone.velocity.set(...pose.velocity);}else{desiredVelocity.copy(goal).sub(drone.root.position);if(desiredVelocity.lengthSq()>1e-6)desiredVelocity.normalize().multiplyScalar(speed);const response=1-Math.exp(-3.4*dt);drone.velocity.lerp(desiredVelocity,response);proposedPosition.copy(drone.root.position).addScaledVector(drone.velocity,dt);if(now>=drone.nextCollisionAt){drone.nextCollisionAt=now+90+drone.index*6;drone.collisionRoof=buildingTopAt(proposedPosition.x,proposedPosition.y);}const roof=drone.collisionRoof;if(roof&&proposedPosition.z<roof+1.15){proposedPosition.x=drone.root.position.x;proposedPosition.y=drone.root.position.y;proposedPosition.z=Math.min(roof+1.7,drone.root.position.z+Math.max(2.5,roof-drone.root.position.z+1)*dt);drone.velocity.x*=.45;drone.velocity.y*=.45;drone.velocity.z=Math.max(2.5,drone.velocity.z);}drone.root.position.copy(proposedPosition);if(Math.hypot(drone.velocity.x,drone.velocity.y)>.08)drone.root.rotation.z=Math.atan2(drone.velocity.y,drone.velocity.x);}}
  if(!drone.empDisabled){const rotorAngle=now*.031+drone.index;for(const rotor of drone.rotors)rotor.rotation.z=rotorAngle;}const lightSlot=(Math.floor((now+drone.index*37)/92)%8+8)%8,redOn=!drone.empDisabled&&(lightSlot===0||lightSlot===1),blueOn=!drone.empDisabled&&(lightSlot===4||lightSlot===5);drone.red.visible=drone.redHalo.visible=redOn;drone.blue.visible=drone.blueHalo.visible=blueOn;drone.emergencyLight.color.setHex(redOn?0xff1834:0x1688ff);drone.emergencyLight.intensity=redOn||blueOn?24:0;if(now>=drone.hitUntil)drone.flash.visible=false;else drone.root.scale.setScalar(1.08);if(now>=drone.hitUntil)drone.root.scale.lerp(unitScale,Math.min(1,dt*12));if(now>=drone.tracerUntil)drone.tracer.visible=false;
}

function showTracer(drone,from,to,now){
  tracerVector.copy(to).sub(from);const length=tracerVector.length();if(length<.05)return;drone.tracer.position.copy(from).addScaledVector(tracerVector,.5);drone.tracer.quaternion.setFromUnitVectors(upAxis,tracerVector.normalize());drone.tracer.scale.set(1,Math.min(45,length),1);drone.tracer.visible=true;drone.tracerUntil=now+92;
}

function applyTargetDamage(drone,target,now){
  if(!target||now-lastTargetDamageAt[target.kind]<PLAYER_DAMAGE_COOLDOWN_MS||target.hp<=0)return false;lastTargetDamageAt[target.kind]=now;const amount=wantedPoliceDamage(stars),before=Number(target.hp);let after=typeof target.model?.damage==="function"?Number(target.model.damage(amount,"police-drone")):NaN;
  if(!Number.isFinite(after)){window.dispatchEvent(new CustomEvent(target.kind==="drone"?"arondight:drone-damage":"arondight:player-damage",{detail:{damage:amount,source:"police-drone",policeDrone:drone.index,target:target.kind}}));after=Number(target.model?.hp);}
  window.dispatchEvent(new CustomEvent("arondight:combat-damage",{detail:{damage:amount,hp:Number.isFinite(after)?after:Math.max(0,before-amount),source:"police-drone",target:target.kind}}));
  const view=viewport();if(view){view.dataset.wantedPoliceDamage=String((Number(view.dataset.wantedPoliceDamage)||0)+amount);view.dataset.wantedPoliceShotsHit=String((Number(view.dataset.wantedPoliceShotsHit)||0)+1);view.dataset.wantedPoliceLastDamage=String(amount);view.dataset.wantedPoliceHitGraceMs=String(PLAYER_DAMAGE_COOLDOWN_MS);view.dataset.wantedPoliceDamageTarget=target.kind;}return true;
}

function updateDroneAttack(drone,now){
  const target=currentDamageTargets().find(item=>item.kind===drone.targetKind);if(drone.empDisabled||drone.retreating||phase!=="pursuit"||!drone.seesPlayer||drone.distance<4.5||drone.distance>34+stars*2||now<drone.engageAt||now<drone.nextShotAt||!target||target.hp<=0)return;
  drone.nextShotAt=now+wantedPoliceShotIntervalMs(stars)+drone.index*73;const shot=++drone.shotSerial,chance=wantedPoliceHitChance({stars,distanceM:drone.distance,playerSpeedMps:drone.targetSpeedMps}),roll=((drone.index+1)*.371+shot*.618+drone.spawnSerial*.137)%1,accurate=roll<chance;tmpPosition.set(target.position.x,target.position.y,target.position.z);
  if(accurate){tmpPosition.x+=(drone.index%2? .15:-.15);tmpPosition.z+=.04;}else{const missAngle=(drone.index*.93+shot*2.17)% (Math.PI*2),spread=.85+(1-chance)*1.5+drone.distance*.018;tmpPosition.x+=Math.cos(missAngle)*spread;tmpPosition.y+=Math.sin(missAngle)*spread;tmpPosition.z+=Math.sin(missAngle*1.7)*spread*.55;}
  showTracer(drone,drone.root.position,tmpPosition,now);playTone({frequency:310,endFrequency:145,duration:.075,gain:.015,type:"square"});const damaged=accurate&&applyTargetDamage(drone,target,now),view=viewport();if(view){view.dataset.wantedPoliceShots=String((Number(view.dataset.wantedPoliceShots)||0)+1);if(!accurate)view.dataset.wantedPoliceShotsMissed=String((Number(view.dataset.wantedPoliceShotsMissed)||0)+1);view.dataset.wantedPoliceLastShotResult=accurate?(damaged?"hit":"grace"):"miss";view.dataset.wantedPoliceLastHitChance=chance.toFixed(3);view.dataset.wantedPoliceLastShotRoll=roll.toFixed(3);view.dataset.wantedPoliceShotTarget=target.kind;}
}

function updateWanted(now,dt){
  installPoliceHitApi();updateEmpPulse(now);for(const drone of drones)updateExplosion(drone,now);
  if(stars<=0){updatePoliceRetreats(now,dt);if(heat>0&&now-lastCrimeAt>CRIME_MEMORY_MS)heat=0;renderHud(0);return;}
  const player=currentPlayerPosition();if(!player)return;
  if(currentPlayerHp()<=0){clearWanted("busted");return;}
  updatePlayerSpeed(player,now);syncPoliceWaves(player,now);const seesPlayer=updateSensors(now),search=wantedSearchState({stars,seesPlayer,now,lastContactAt});lastContactAt=search.lastContactAt;phase=search.phase;
  if(search.escaped){clearWanted("escaped");return;}
  for(const drone of drones)if(drone.active){updateDroneMotion(drone,now,dt);updateDroneAttack(drone,now);}updateSiren(now);renderHud(search.remainingMs);
}

function onWorldKill(event){const detail=event?.detail||{};if(detail.remote||detail.network===false)return;reportCrime(detail);}
function onCombatKill(event){const detail=event?.detail||{};if(!detail.killed||detail.self||detail.world||detail.police)return;reportCrime({id:`player-${Date.now().toString(36)}-${Math.floor(performance.now()).toString(36)}`,kind:"player"});}
function onPhysicsImpact(event){const detail=event?.detail||{},id=String(detail.id||""),match=id.match(/^police-drone-(\d+)$/),drone=match?drones[Number(match[1])]:null;if(!drone?.active)return;const now=performance.now(),impact=Number(detail.deltaVelocityMps)||0;drone.hitUntil=Math.max(drone.hitUntil,now+90);drone.flash.visible=true;if(drone.empDisabled&&impact>=1.4&&now-drone.empImpactAt>420){drone.empImpactAt=now;drone.hp=0;armPoliceCritical(drone,now,true);}else if(impact>=3.8&&now-drone.lastCollisionDamageAt>520){drone.lastCollisionDamageAt=now;const damage=clamp(Math.round((impact-3.2)*5),3,18);drone.hp=Math.max(0,drone.hp-damage);if(isCriticalDamage("police-drone",drone.hp,POLICE_HP))armPoliceCritical(drone,now,drone.critical||drone.hp===0);}const view=viewport();if(view){view.dataset.wantedPolicePhysicalImpacts=String((Number(view.dataset.wantedPolicePhysicalImpacts)||0)+1);view.dataset.wantedPoliceLastImpactMps=impact.toFixed(2);view.dataset.wantedPoliceLastHp=String(drone.hp);if(drone.empDisabled)view.dataset.wantedEmpCrashImpacts=String((Number(view.dataset.wantedEmpCrashImpacts)||0)+1);}}

function frame(now=performance.now()){
  requestAnimationFrame(frame);const dt=clamp((now-lastFrameAt)/1000,0,MAX_FRAME_DT);lastFrameAt=now;installHud();if(!ensureScene()){renderHud(0);return;}updateWanted(now,dt);
}

export function installWantedPoliceDrones(){
  if(installed)return globalThis.__arondightWantedSystem;installed=true;installHud();installPoliceHitApi();
  addEventListener(WORLD_KILL_EVENT,onWorldKill);addEventListener("arondight:combat-hit-confirm",onCombatKill);addEventListener("arondight:world-physics-impact",onPhysicsImpact);addEventListener(AUDIO_SETTINGS_EVENT,event=>{audioSettings=normalizeAudioSettings(event.detail||loadAudioSettings());});
  const unlock=()=>{audioUnlocked=true;ensureAudio();};addEventListener("pointerdown",unlock,{capture:true,passive:true});addEventListener("keydown",unlock,{capture:true});
  document.addEventListener("click",event=>{const target=event.target instanceof Element?event.target.closest("#reset,#soloReset"):null;if(target)clearWanted("reset");},{capture:true,passive:true});
  const api={reportCrime,clear:clearWanted,triggerEmp,get state(){return{heat,stars,phase,policeActive:drones.filter(drone=>drone.active).length,policeRetreating:drones.filter(drone=>drone.active&&drone.retreating).length,policeKills,lastContactAt,lastCrimeAt,waveNumber,nextWaveAt,playerSpeedMps,empReadyAt,empDisabled:drones.filter(drone=>drone.active&&drone.empDisabled).length};},get drones(){return drones.slice();}};globalThis.__arondightWantedSystem=api;const view=viewport();if(view)view.dataset.wantedSystem="heat+fair-physics-police-drones-v4";requestAnimationFrame(frame);return api;
}

installWantedPoliceDrones();
