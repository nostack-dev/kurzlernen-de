import * as THREE from "three";
import {loadFirstPersonControlSettings,saveFirstPersonControlSettings,DEFAULT_FIRST_PERSON_CONTROL_SETTINGS} from "./first_person_control_settings.mjs";
import {loadAudioSettings} from "./audio_settings.mjs";
import {findXboxGamepad} from "./xbox_gamepad.mjs";

const CAR_SETTINGS_KEY="arondight45VehicleControlsV1";
const CAMERA_CLEARANCE=.22;
const VEHICLE_RADIUS=1.28;
const MAX_DT=.05;
const tmp=new THREE.Vector3();
const tmp2=new THREE.Vector3();
let installed=false,sceneRef=null,showcase=null,drivable=null,lastFrame=performance.now();
let vehicleMode=false,vehicleState={x:0,y:-8,yaw:0,speed:0,steer:0,throttle:0,brake:0};
let keyState=new Set(),touchState={steer:0,throttle:0,brake:0},patchedRuntime=null,baseCan=null,baseResolve=null;
let audioCtx=null,audioMaster=null,engineGain=null,engineOscA=null,engineOscB=null,engineFilter=null,engineStarted=false;
let settingsObserver=null;
const showcaseColliders=[];

const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,Number(v)||0));
const lerp=(a,b,t)=>a+(b-a)*t;
function viewport(){return document.getElementById("viewport");}
function bridge(){return globalThis.__arondightRealWorld||null;}
function walk(){return globalThis.__arondightWalkMode||null;}
function playerRuntime(){return globalThis.__arondightPlayerVehicleRuntime||null;}
function trainingActive(){const b=bridge();return !b?.active;}
function carSettings(){try{return{steering:72,maxSpeedKmh:82,traction:78,...JSON.parse(localStorage.getItem(CAR_SETTINGS_KEY)||"{}")};}catch{return{steering:72,maxSpeedKmh:82,traction:78};}}
function saveCarSettings(next){const s={steering:clamp(next.steering,35,100),maxSpeedKmh:clamp(next.maxSpeedKmh,35,120),traction:clamp(next.traction,35,100)};try{localStorage.setItem(CAR_SETTINGS_KEY,JSON.stringify(s));}catch{}return s;}

function installStyle(){
  if(document.querySelector("style[data-gta-runtime-v1]"))return;
  const style=document.createElement("style");style.dataset.gtaRuntimeV1="1";style.textContent=`
  .gta-settings-heading{margin:18px 0 8px;padding-top:13px;border-top:2px solid #ffffff26;font:900 13px/1.1 system-ui;letter-spacing:.10em;color:#6be4b0}
  .phone-settings-profile{display:none!important}
  .gta-mode-section,.gta-fps-section,.gta-car-section{margin:14px 0;padding:12px;border:1px solid #ffffff25;border-radius:11px;background:#0d1926}
  .gta-mode-section h4,.gta-fps-section h4,.gta-car-section h4{margin:0 0 6px;font:900 13px/1.2 system-ui;letter-spacing:.08em;color:#9fe9ff}
  .gta-mode-section p,.gta-fps-section p,.gta-car-section p{margin:0 0 10px!important}
  .gta-mode-stack{display:grid;gap:7px}.gta-mode-card{display:grid;grid-template-columns:1fr auto;gap:4px 10px;align-items:center;padding:9px 10px;border:1px solid #ffffff22;border-radius:9px;background:#07131f}
  .gta-mode-card strong{font:900 12px/1 system-ui}.gta-mode-card small{grid-column:1/2;color:#8da2ba;font:10px/1.3 system-ui}.gta-mode-card button{grid-column:2;grid-row:1/3;min-width:78px;border:1px solid #6ecdf55a;border-radius:8px;background:#13334a;color:#fff;padding:8px 9px;font-weight:900}.gta-mode-card button[data-active="1"]{background:#175f49;border-color:#64dcad}
  .gta-setting-row{display:grid;grid-template-columns:1fr auto;gap:5px 10px;align-items:center;margin:12px 0}.gta-setting-row label{font:750 12px system-ui}.gta-setting-row output{font:900 12px ui-monospace,SFMono-Regular,Menlo,monospace}.gta-setting-row input[type=range]{grid-column:1/3;width:100%;accent-color:#6be4b0}.gta-setting-toggle{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0;border-top:1px solid #ffffff18;font:750 12px system-ui}.gta-setting-toggle input{width:21px;height:21px;accent-color:#6be4b0}
  #gtaVehicleHud{display:none;position:absolute;inset:0;z-index:12;pointer-events:none;font-family:system-ui,-apple-system,sans-serif}body.vehicle-mode #gtaVehicleHud{display:block}body.vehicle-mode #footHud{display:none!important}body.vehicle-mode #playerModeButton{opacity:.45}
  #gtaVehicleSteer{position:absolute;left:max(12px,var(--solo-safe-left,env(safe-area-inset-left)));bottom:max(18px,var(--solo-safe-bottom,env(safe-area-inset-bottom)));width:min(22vw,132px);aspect-ratio:1;border-radius:50%;border:1px solid #bfe9ff55;background:#0715228c;pointer-events:auto;touch-action:none}#gtaVehicleSteer .knob{position:absolute;left:50%;top:50%;width:34%;aspect-ratio:1;transform:translate(-50%,-50%);border-radius:50%;background:#ecf8ffdd;border:1px solid #fff}
  #gtaVehiclePedals{position:absolute;right:max(12px,var(--solo-safe-right,env(safe-area-inset-right)));bottom:max(18px,var(--solo-safe-bottom,env(safe-area-inset-bottom)));display:flex;gap:10px;pointer-events:auto}#gtaVehiclePedals button{width:88px;height:88px;border-radius:50%;border:1px solid #ffffff55;color:#fff;font:950 11px/1 system-ui;letter-spacing:.05em;touch-action:none}#gtaGas{background:#176043dd}#gtaBrake{background:#7a322ddd}
  #gtaVehicleReadout{position:absolute;left:50%;top:max(48px,calc(var(--solo-safe-top,env(safe-area-inset-top)) + 40px));transform:translateX(-50%);padding:6px 10px;border:1px solid #ffffff22;border-radius:9px;background:#071522d7;color:#ecf8ff;font:900 10px/1 system-ui;letter-spacing:.07em}#gtaVehicleExit{position:absolute;right:max(12px,var(--solo-safe-right,env(safe-area-inset-right)));top:max(46px,calc(var(--solo-safe-top,env(safe-area-inset-top)) + 38px));pointer-events:auto;border:1px solid #ffffff44;border-radius:9px;background:#522831e8;color:#fff;padding:8px 11px;font-weight:900}
  #gtaVehicleButton{background:#1d4664e8!important;border-color:#76d4ff70!important}#gtaVehicleButton[disabled]{opacity:.42!important}
  body.vehicle-mode #soloLeft,body.vehicle-mode #soloRight,body.vehicle-mode #soloClearance,body.vehicle-mode .solo-action{display:none!important}
  @media(max-height:340px){#gtaVehicleSteer{width:min(19vw,112px)}#gtaVehiclePedals button{width:72px;height:72px}#gtaVehicleReadout{top:max(40px,calc(var(--solo-safe-top,env(safe-area-inset-top)) + 32px))}}
  `;document.head.appendChild(style);
}

function addMesh(root,geometry,material,pos,rot=[0,0,0],name=""){
  const mesh=new THREE.Mesh(geometry,material);mesh.position.set(...pos);mesh.rotation.set(...rot);mesh.name=name;mesh.receiveShadow=false;mesh.castShadow=false;mesh.userData.flightFireIgnore=true;root.add(mesh);return mesh;
}
function addCollider(x,y,hx,hy){showcaseColliders.push({x,y,hx,hy});}
function buildCar(scene){
  const root=new THREE.Group();root.name="GTA_DRIVABLE_TRAINING_CAR";root.userData.gtaDrivableVehicle=true;root.userData.flightFireIgnore=true;
  const bodyMat=new THREE.MeshStandardMaterial({color:0x2b6fa5,roughness:.34,metalness:.36}),glass=new THREE.MeshStandardMaterial({color:0x18303c,roughness:.16,metalness:.18,transparent:true,opacity:.86}),rubber=new THREE.MeshStandardMaterial({color:0x181b1f,roughness:.92});
  addMesh(root,new THREE.BoxGeometry(3.85,1.74,.58),bodyMat,[0,0,.52]);addMesh(root,new THREE.BoxGeometry(2.0,1.55,.62),glass,[-.15,0,1.00]);
  const wheelGeo=new THREE.CylinderGeometry(.34,.34,.20,10);wheelGeo.rotateX(Math.PI/2);for(const x of[-1.25,1.25])for(const y of[-.88,.88])addMesh(root,wheelGeo,rubber,[x,y,.33]);
  root.position.set(vehicleState.x,vehicleState.y,0);root.rotation.z=vehicleState.yaw;scene.add(root);return root;
}
function buildShowcase(scene){
  showcaseColliders.length=0;const root=new THREE.Group();root.name="TRAINING_SHOWPLACE_GTA_V1";root.userData.flightFireIgnore=true;
  const asphalt=new THREE.MeshStandardMaterial({color:0x24282c,roughness:.92}),concrete=new THREE.MeshStandardMaterial({color:0x727980,roughness:.90}),accent=new THREE.MeshStandardMaterial({color:0x1d6f8f,roughness:.58,metalness:.05,emissive:0x062d3b,emissiveIntensity:.25}),white=new THREE.MeshStandardMaterial({color:0xd8dedf,roughness:.72}),dark=new THREE.MeshStandardMaterial({color:0x343a40,roughness:.86});
  addMesh(root,new THREE.CircleGeometry(19,48),concrete,[0,0,.018]);addMesh(root,new THREE.RingGeometry(20.5,31.5,64),asphalt,[0,0,.026]);
  for(let i=0;i<32;i++){const a=i/32*Math.PI*2,r=26;const mark=addMesh(root,new THREE.BoxGeometry(2.2,.16,.035),white,[Math.cos(a)*r,Math.sin(a)*r,.055],[0,0,a+Math.PI/2]);mark.material.transparent=true;mark.material.opacity=.72;}
  for(const [x,y] of[[-13,-8],[13,-8],[-13,8],[13,8]]){addMesh(root,new THREE.BoxGeometry(5.0,.72,1.0),dark,[x,y,.5]);addCollider(x,y,2.5,.36);}
  addMesh(root,new THREE.BoxGeometry(7,4,.45),accent,[-5,13,1.05],[.18,0,0]);addCollider(-5,13,3.4,1.9);addMesh(root,new THREE.BoxGeometry(7,4,.45),accent,[6,-14,1.05],[-.18,0,0]);addCollider(6,-14,3.4,1.9);
  for(const x of[-9,0,9]){addMesh(root,new THREE.BoxGeometry(.45,.45,4.6),accent,[x,2,2.3]);addCollider(x,2,.26,.26);}
  addMesh(root,new THREE.BoxGeometry(18,.30,.30),accent,[0,2,4.55]);
  for(const [x,y] of[[-16,15],[16,15],[-16,-15],[16,-15]]){addMesh(root,new THREE.CylinderGeometry(.12,.16,4.0,8).rotateX(Math.PI/2),dark,[x,y,2]);addMesh(root,new THREE.SphereGeometry(.22,8,6),new THREE.MeshBasicMaterial({color:0x7fe8ff}),[x,y,4.02]);}
  const pad=addMesh(root,new THREE.CylinderGeometry(3.3,3.3,.12,32).rotateX(Math.PI/2),accent,[0,-8,.08]);pad.material.emissiveIntensity=.45;
  scene.add(root);return root;
}
function ensureShowcase(){
  const scene=bridge()?.threeScene;if(!scene)return;
  if(scene!==sceneRef){showcase?.parent?.remove(showcase);drivable?.parent?.remove(drivable);sceneRef=scene;showcase=buildShowcase(scene);drivable=buildCar(scene);}
  const visible=trainingActive();if(showcase)showcase.visible=visible;if(drivable)drivable.visible=visible;
  const v=viewport();if(v){v.dataset.trainingShowplace=visible?"gta-walk-drive-v1":"hidden-real-world";v.dataset.trainingWalkableRadiusM="32";v.dataset.trainingDrivableCar="1";}
}

function pointHitsShowcase(x,y){if(!trainingActive())return false;for(const c of showcaseColliders)if(Math.abs(x-c.x)<=c.hx+.48&&Math.abs(y-c.y)<=c.hy+.48)return true;return false;}
function pointHitsCar(x,y){if(vehicleMode||!drivable?.visible)return false;return Math.hypot(x-vehicleState.x,y-vehicleState.y)<VEHICLE_RADIUS+.48;}
function safeBasePoint(x,y){if(!baseCan)return true;if(!baseCan(x,y))return false;for(const [dx,dy] of[[CAMERA_CLEARANCE,0],[-CAMERA_CLEARANCE,0],[0,CAMERA_CLEARANCE],[0,-CAMERA_CLEARANCE],[CAMERA_CLEARANCE*.707,CAMERA_CLEARANCE*.707],[CAMERA_CLEARANCE*.707,-CAMERA_CLEARANCE*.707],[-CAMERA_CLEARANCE*.707,CAMERA_CLEARANCE*.707],[-CAMERA_CLEARANCE*.707,-CAMERA_CLEARANCE*.707]])if(!baseCan(x+dx,y+dy))return false;return true;}
function safeWalkPoint(x,y){return safeBasePoint(x,y)&&!pointHitsShowcase(x,y)&&!pointHitsCar(x,y);}
function resolveSafe(from,to){
  const initial=baseResolve?baseResolve(from,to):to;if(safeWalkPoint(initial.x,initial.y))return initial;
  const candidates=[{x:initial.x,y:from.y},{x:from.x,y:initial.y}];for(const c of candidates)if(safeWalkPoint(c.x,c.y))return c;
  if(!safeWalkPoint(from.x,from.y))return initial;let lo=0,hi=1,best={x:from.x,y:from.y};for(let i=0;i<7;i++){const m=(lo+hi)/2,c={x:lerp(from.x,initial.x,m),y:lerp(from.y,initial.y,m)};if(safeWalkPoint(c.x,c.y)){best=c;lo=m;}else hi=m;}return best;
}
function patchWalkCollision(){
  const runtime=playerRuntime();if(!runtime||runtime===patchedRuntime)return;if(runtime.__gtaCameraClearancePatched)return;patchedRuntime=runtime;baseCan=runtime.canOccupyWalkPoint?.bind(runtime);baseResolve=runtime.resolveWalkMove?.bind(runtime);runtime.canOccupyWalkPoint=safeWalkPoint;runtime.resolveWalkMove=resolveSafe;runtime.__gtaCameraClearancePatched=true;const v=viewport();if(v){v.dataset.walkCameraWallClearanceM=(.28+CAMERA_CLEARANCE).toFixed(2);v.dataset.walkCameraCollision="inflated-capsule-slide-v1";}}
function enforceCameraGround(){
  const camera=bridge()?.threeCamera;if(!camera?.getWorldPosition)return;camera.getWorldPosition(tmp);const floor=vehicleMode?.42:.16;if(tmp.z>=floor)return;tmp.z=floor;if(camera.parent){camera.parent.worldToLocal(tmp2.copy(tmp));camera.position.copy(tmp2);}else camera.position.copy(tmp);camera.updateMatrixWorld?.();const v=viewport();if(v){v.dataset.cameraGroundGuard="world-z-floor-v1";v.dataset.cameraGroundGuardTrips=String((Number(v.dataset.cameraGroundGuardTrips)||0)+1);}}

function vehicleFree(x,y,yaw){if(pointHitsShowcase(x,y))return false;if(!baseCan)return true;const c=Math.cos(yaw),s=Math.sin(yaw);for(const [lx,ly] of[[1.55,.68],[1.55,-.68],[-1.55,.68],[-1.55,-.68]]){const px=x+lx*c-ly*s,py=y+lx*s+ly*c;if(!baseCan(px,py))return false;}return true;}
function nearestCarDistance(){const p=walk()?.position;if(!p||!drivable?.visible)return Infinity;return Math.hypot(p.x-vehicleState.x,p.y-vehicleState.y);}
function setVehicleMode(on){
  const next=Boolean(on);if(next===vehicleMode)return next;if(next){if(!trainingActive()||nearestCarDistance()>3.4)return false;walk()?.setMode?.("foot");vehicleMode=true;keyState.clear();touchState={steer:0,throttle:0,brake:0};playTransient("door");}
  else{vehicleMode=false;vehicleState.speed=0;touchState={steer:0,throttle:0,brake:0};const sideX=vehicleState.x+Math.cos(vehicleState.yaw+Math.PI/2)*2.1,sideY=vehicleState.y+Math.sin(vehicleState.yaw+Math.PI/2)*2.1;walk()?.setPose?.({x:sideX,y:sideY,yaw:vehicleState.yaw,pitch:0});playTransient("door");}
  document.body.classList.toggle("vehicle-mode",vehicleMode);const v=viewport();if(v){v.dataset.playerControlMode=vehicleMode?"vehicle":walk()?.mode||"drone";v.dataset.vehicleController="arcade-physical-v1";}return vehicleMode;
}
function updateVehicle(dt){
  if(!vehicleMode)return;const s=carSettings(),pad=findXboxGamepad(navigator.getGamepads?.());let steer=touchState.steer+(keyState.has("KeyA")?-1:0)+(keyState.has("KeyD")?1:0),gas=Math.max(touchState.throttle,keyState.has("KeyW")?1:0),brake=Math.max(touchState.brake,keyState.has("KeyS")?1:0);
  if(pad){steer+=clamp(pad.axes?.[0],-1,1);gas=Math.max(gas,clamp(pad.buttons?.[7]?.value||0,0,1));brake=Math.max(brake,clamp(pad.buttons?.[6]?.value||0,0,1));}
  steer=clamp(steer,-1,1);const max=s.maxSpeedKmh/3.6,reverseMax=8,accel=9.5,decel=13.5,drag=1.5+(100-s.traction)*.018;
  if(gas>0)vehicleState.speed+=gas*accel*dt;if(brake>0){if(vehicleState.speed>1)vehicleState.speed-=brake*decel*dt;else vehicleState.speed-=brake*5.5*dt;}if(gas===0&&brake===0)vehicleState.speed*=Math.max(0,1-drag*dt);vehicleState.speed=clamp(vehicleState.speed,-reverseMax,max);
  const speedRatio=clamp(Math.abs(vehicleState.speed)/Math.max(1,max),0,1),turn=(.65+1.15*(1-speedRatio))*(s.steering/72);vehicleState.yaw+=steer*turn*dt*clamp(Math.abs(vehicleState.speed)/3,0,1)*Math.sign(vehicleState.speed||1);
  const nx=vehicleState.x+Math.sin(vehicleState.yaw)*vehicleState.speed*dt,ny=vehicleState.y+Math.cos(vehicleState.yaw)*vehicleState.speed*dt;if(vehicleFree(nx,ny,vehicleState.yaw)){vehicleState.x=nx;vehicleState.y=ny;}else{vehicleState.speed*=-.16;playTransient("bump");}
  if(drivable){drivable.position.set(vehicleState.x,vehicleState.y,0);drivable.rotation.z=vehicleState.yaw;}walk()?.setPose?.({x:vehicleState.x,y:vehicleState.y,yaw:vehicleState.yaw,pitch:-.03});const v=viewport();if(v){v.dataset.vehicleSpeedKmh=(vehicleState.speed*3.6).toFixed(1);v.dataset.vehicleSteer=steer.toFixed(2);}updateVehicleHud();updateEngine(gas,brake);
}

function ensureAudio(unlock=false){
  const Ctx=globalThis.AudioContext||globalThis.webkitAudioContext;if(!Ctx)return null;if(!audioCtx){audioCtx=new Ctx({latencyHint:"interactive"});audioMaster=audioCtx.createDynamicsCompressor();audioMaster.threshold.value=-10;audioMaster.knee.value=16;audioMaster.ratio.value=3;audioMaster.attack.value=.003;audioMaster.release.value=.18;audioMaster.connect(audioCtx.destination);engineFilter=audioCtx.createBiquadFilter();engineFilter.type="lowpass";engineFilter.frequency.value=850;engineGain=audioCtx.createGain();engineGain.gain.value=0;engineOscA=audioCtx.createOscillator();engineOscB=audioCtx.createOscillator();engineOscA.type="sawtooth";engineOscB.type="triangle";engineOscA.connect(engineFilter);engineOscB.connect(engineFilter);engineFilter.connect(engineGain);engineGain.connect(audioMaster);engineOscA.start();engineOscB.start();engineStarted=true;}if(unlock&&audioCtx.state==="suspended")audioCtx.resume().catch(()=>{});return audioCtx;}
function soundLevel(){const s=loadAudioSettings();return s.soundEnabled===false?0:clamp((s.fxVolume??80)/100,0,1);}
function updateEngine(gas=0,brake=0){if(!engineStarted||!audioCtx||audioCtx.state!=="running")return;const level=soundLevel(),speed=Math.abs(vehicleState.speed),rpm=52+speed*7.2+gas*34;engineOscA.frequency.setTargetAtTime(rpm,audioCtx.currentTime,.045);engineOscB.frequency.setTargetAtTime(rpm*2.03,audioCtx.currentTime,.045);engineFilter.frequency.setTargetAtTime(620+speed*45+gas*700,audioCtx.currentTime,.05);engineGain.gain.setTargetAtTime(vehicleMode?(.018+.045*gas+.022*clamp(speed/20,0,1))*level:0,audioCtx.currentTime,.055);}
function playTransient(kind){const ctx=ensureAudio(true);if(!ctx||ctx.state!=="running"||!audioMaster)return;const level=soundLevel();if(level<=0)return;const osc=ctx.createOscillator(),gain=ctx.createGain();osc.type=kind==="bump"?"square":"sine";osc.frequency.value=kind==="door"?92:55;gain.gain.setValueAtTime(kind==="door"?.08*level:.045*level,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+(kind==="door"?.18:.11));osc.connect(gain);gain.connect(audioMaster);osc.start();osc.stop(ctx.currentTime+(kind==="door"?.2:.13));}
function syncAudioDataset(){const v=viewport();if(v){v.dataset.soundArchitecture="layered-drone-combat-footstep-vehicle-v4";v.dataset.vehicleSound="dual-osc-filtered-rpm-v1";v.dataset.soundMix="compressed-spatial-existing+vehicle-layer-v1";}}

function mountVehicleHud(){
  const view=viewport();if(!view||document.getElementById("gtaVehicleHud"))return;const hud=document.createElement("div");hud.id="gtaVehicleHud";hud.innerHTML=`<div id="gtaVehicleReadout">CAR · 0 km/h</div><div id="gtaVehicleSteer" aria-label="Steer"><div class="knob"></div></div><div id="gtaVehiclePedals"><button id="gtaBrake" type="button">BRAKE / REV</button><button id="gtaGas" type="button">GAS</button></div><button id="gtaVehicleExit" type="button">EXIT CAR</button>`;view.appendChild(hud);
  const steer=hud.querySelector("#gtaVehicleSteer"),knob=steer.querySelector(".knob");let pointer=null;const apply=e=>{const r=steer.getBoundingClientRect(),x=clamp((e.clientX-(r.left+r.width/2))/(r.width*.38),-1,1);touchState.steer=x;knob.style.left=`${50+x*31}%`;e.preventDefault();e.stopPropagation();};steer.addEventListener("pointerdown",e=>{pointer=e.pointerId;steer.setPointerCapture?.(pointer);apply(e);});steer.addEventListener("pointermove",e=>{if(e.pointerId===pointer)apply(e);});const release=e=>{if(e.pointerId!==pointer)return;pointer=null;touchState.steer=0;knob.style.left="50%";e.preventDefault();};steer.addEventListener("pointerup",release);steer.addEventListener("pointercancel",release);
  const bindPedal=(id,key)=>{const el=hud.querySelector(id);const on=e=>{touchState[key]=1;el.setPointerCapture?.(e.pointerId);e.preventDefault();e.stopPropagation();},off=e=>{touchState[key]=0;e.preventDefault();e.stopPropagation();};el.addEventListener("pointerdown",on);el.addEventListener("pointerup",off);el.addEventListener("pointercancel",off);};bindPedal("#gtaGas","throttle");bindPedal("#gtaBrake","brake");hud.querySelector("#gtaVehicleExit").addEventListener("click",()=>setVehicleMode(false));
}
function updateVehicleHud(){const el=document.getElementById("gtaVehicleReadout");if(el)el.textContent=`CAR · ${Math.round(Math.abs(vehicleState.speed)*3.6)} km/h · ${vehicleState.speed<-.5?"R":vehicleState.speed>.5?"D":"N"}`;}
function mountVehicleButton(){
  const bar=document.getElementById("soloTopbarActions")||document.getElementById("soloTopbar");if(!bar||document.getElementById("gtaVehicleButton"))return;const btn=document.createElement("button");btn.id="gtaVehicleButton";btn.type="button";btn.textContent="CAR";btn.title="Enter/exit nearby training car";btn.addEventListener("click",()=>vehicleMode?setVehicleMode(false):setVehicleMode(true));const settings=bar.querySelector(".phone-settings-button");bar.insertBefore(btn,settings||null);
}
function updateVehicleButton(){const btn=document.getElementById("gtaVehicleButton");if(!btn)return;const foot=walk()?.mode==="foot",near=nearestCarDistance()<=3.4;btn.hidden=!trainingActive()||(!foot&&!vehicleMode);btn.disabled=!vehicleMode&&!near;btn.textContent=vehicleMode?"CAR ✓":near?"ENTER CAR":"CAR";btn.dataset.active=vehicleMode?"1":"0";}

function addRange(section,label,key,min,max,step,suffix,read,write){const row=document.createElement("div");row.className="gta-setting-row";row.innerHTML=`<label>${label}</label><output></output><input type="range" min="${min}" max="${max}" step="${step}">`;const input=row.querySelector("input"),out=row.querySelector("output");const render=()=>{const v=read();input.value=String(v);out.value=`${Math.round(Number(v))}${suffix}`;};input.addEventListener("input",()=>{write(Number(input.value));render();});render();section.appendChild(row);return row;}
function addToggle(section,label,read,write){const row=document.createElement("label");row.className="gta-setting-toggle";row.innerHTML=`<span>${label}</span><input type="checkbox">`;const input=row.querySelector("input");input.checked=Boolean(read());input.addEventListener("change",()=>write(input.checked));section.appendChild(row);return row;}
function patchSettingsDialog(dialog){
  if(!dialog||dialog.dataset.gtaSettingsPatched==="1")return;dialog.dataset.gtaSettingsPatched="1";const profile=dialog.querySelector("[data-control-profile]");const description=dialog.querySelector("[data-control-description]");if(description){const h=document.createElement("div");h.className="gta-settings-heading";h.textContent="DRONE CONTROLS";description.before(h);}const forceDrone=()=>{if(profile&&profile.value!=="drone"){profile.value="drone";profile.dispatchEvent(new Event("change",{bubbles:true}));}};const openObserver=new MutationObserver(()=>{if(dialog.open)queueMicrotask(forceDrone);});openObserver.observe(dialog,{attributes:true,attributeFilter:["open"]});forceDrone();
  const anchor=dialog.querySelector(".world-settings-section")||dialog.querySelector(".phone-settings-actions");
  const modes=document.createElement("section");modes.className="gta-mode-section";modes.innerHTML=`<h4>CONTROL MODES</h4><p>Gameplay mode is separate from the input device. Drone, First Person and Vehicle each keep their own control behavior.</p><div class="gta-mode-stack"><div class="gta-mode-card"><strong>DRONE</strong><small>Flight controller + altitude / camera controls.</small><button type="button" data-mode="drone">USE</button></div><div class="gta-mode-card"><strong>FIRST PERSON</strong><small>On-foot movement, look and weapon controls.</small><button type="button" data-mode="foot">USE</button></div><div class="gta-mode-card"><strong>VEHICLE</strong><small>GTA-style steering, throttle and brake near the training car.</small><button type="button" data-mode="vehicle">USE</button></div></div>`;
  for(const b of modes.querySelectorAll("button[data-mode]"))b.addEventListener("click",()=>{const m=b.dataset.mode;if(m==="vehicle"){if(!setVehicleMode(true))return;}else{if(vehicleMode)setVehicleMode(false);walk()?.setMode?.(m);}renderModeCards(modes);});
  const fps=document.createElement("section");fps.className="gta-fps-section";fps.innerHTML=`<h4>FIRST PERSON CONTROLS</h4><p>Independent from Drone. These values apply to touch and Xbox where relevant.</p>`;let fpsState=loadFirstPersonControlSettings();const writeFps=patch=>{fpsState=saveFirstPersonControlSettings({...fpsState,...patch});};addRange(fps,"MOVE STICK FINENESS","move",1,10,1,"/10",()=>fpsState.moveFineness,v=>writeFps({moveFineness:v}));addRange(fps,"LOOK STICK FINENESS","look",1,10,1,"/10",()=>fpsState.lookFineness,v=>writeFps({lookFineness:v}));addRange(fps,"HORIZONTAL LOOK SENSITIVITY","hlook",50,150,1,"%",()=>fpsState.horizontalLookSensitivityPercent,v=>writeFps({horizontalLookSensitivityPercent:v}));addRange(fps,"VERTICAL LOOK SENSITIVITY","vlook",50,150,1,"%",()=>fpsState.verticalLookSensitivityPercent,v=>writeFps({verticalLookSensitivityPercent:v}));addRange(fps,"XBOX RIGHT STICK DEADZONE","dead",2,20,1,"%",()=>fpsState.lookDeadzonePercent,v=>writeFps({lookDeadzonePercent:v}));addRange(fps,"LIGHT AIM ASSIST","assist",0,100,1,"%",()=>fpsState.aimAssistStrengthPercent,v=>writeFps({aimAssistStrengthPercent:v}));addToggle(fps,"INVERT MOVE HORIZONTAL",()=>fpsState.invertMoveHorizontal,v=>writeFps({invertMoveHorizontal:v}));addToggle(fps,"INVERT LOOK HORIZONTAL",()=>fpsState.invertLookHorizontal,v=>writeFps({invertLookHorizontal:v}));addToggle(fps,"INVERT LOOK VERTICAL",()=>fpsState.invertLookVertical,v=>writeFps({invertLookVertical:v}));addToggle(fps,"LOCK MOVE HORIZONTAL AXIS",()=>fpsState.lockMoveHorizontal,v=>writeFps({lockMoveHorizontal:v}));addToggle(fps,"LOCK LOOK VERTICAL AXIS",()=>fpsState.lockLookVertical,v=>writeFps({lockLookVertical:v}));
  const car=document.createElement("section");car.className="gta-car-section";car.innerHTML=`<h4>VEHICLE CONTROLS</h4><p>Separate car handling profile. Xbox: LS steer, RT gas, LT brake/reverse. Touch controls appear only while driving.</p>`;let cs=carSettings();const writeCar=patch=>{cs=saveCarSettings({...cs,...patch});};addRange(car,"STEERING RESPONSE","steering",35,100,1,"%",()=>cs.steering,v=>writeCar({steering:v}));addRange(car,"MAX SPEED","speed",35,120,1," km/h",()=>cs.maxSpeedKmh,v=>writeCar({maxSpeedKmh:v}));addRange(car,"TRACTION","traction",35,100,1,"%",()=>cs.traction,v=>writeCar({traction:v}));
  dialog.insertBefore(modes,anchor);dialog.insertBefore(fps,anchor);dialog.insertBefore(car,anchor);renderModeCards(modes);const v=viewport();if(v){v.dataset.settingsControlLayout="stacked-drone-first-person-vehicle-v1";v.dataset.settingsModeSeparation="control-modes-vs-input-controls-v1";}
}
function renderModeCards(section=document.querySelector(".gta-mode-section")){if(!section)return;const mode=vehicleMode?"vehicle":walk()?.mode||"drone";for(const b of section.querySelectorAll("button[data-mode]"))b.dataset.active=b.dataset.mode===mode?"1":"0";}
function patchSettings(){for(const d of document.querySelectorAll("dialog.phone-settings-dialog[data-control-profiles]"))patchSettingsDialog(d);if(settingsObserver)return;settingsObserver=new MutationObserver(()=>{for(const d of document.querySelectorAll("dialog.phone-settings-dialog[data-control-profiles]"))patchSettingsDialog(d);});settingsObserver.observe(document.body,{childList:true,subtree:true});}

function installInput(){addEventListener("keydown",e=>{if(!vehicleMode)return;if(["KeyW","KeyA","KeyS","KeyD"].includes(e.code)){keyState.add(e.code);e.preventDefault();e.stopPropagation();}if(e.code==="KeyF"||e.code==="KeyV"){setVehicleMode(false);e.preventDefault();e.stopPropagation();}},{capture:true});addEventListener("keyup",e=>keyState.delete(e.code),{capture:true});addEventListener("pointerdown",()=>ensureAudio(true),{capture:true,passive:true});}
function expose(){globalThis.__arondightGtaRuntime={get mode(){return vehicleMode?"vehicle":walk()?.mode||"drone";},get vehicleState(){return{...vehicleState};},get car(){return drivable;},enterVehicle:()=>setVehicleMode(true),exitVehicle:()=>setVehicleMode(false),setMode(mode){if(mode==="vehicle")return setVehicleMode(true);if(vehicleMode)setVehicleMode(false);walk()?.setMode?.(mode==="foot"?"foot":"drone");return true;}};}
function frame(now=performance.now()){
  const dt=clamp((now-lastFrame)/1000,0,MAX_DT);lastFrame=now;ensureShowcase();patchWalkCollision();patchSettings();mountVehicleHud();mountVehicleButton();updateVehicleButton();if(vehicleMode&&!trainingActive())setVehicleMode(false);updateVehicle(dt);if(!vehicleMode)updateEngine(0,0);enforceCameraGround();renderModeCards();syncAudioDataset();const v=viewport();if(v){v.dataset.controlModeArchitecture="drone+first-person+vehicle-v1";v.dataset.cameraClipGuard="wall-clearance+ground-world-z-v1";}requestAnimationFrame(frame);
}
export function installGtaRuntime(){if(installed)return;installed=true;installStyle();installInput();expose();requestAnimationFrame(frame);}
installGtaRuntime();
