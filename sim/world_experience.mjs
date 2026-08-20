import * as THREE from "three";
import {XBOX_CONTROL_SCHEMES,loadXboxControlScheme,saveXboxControlScheme} from "./xbox_gamepad.mjs";

const MOBILE_RE=/(?:android|iphone|ipad|ipod|macintosh.*mobile)/i;
const MOBILE=MOBILE_RE.test(globalThis.navigator?.userAgent||"");
const PLAYER_MODE_KEY="arondight45PlayerModeV1";
const WORLD_LOCATION_KEY="arondight45WorldLocationPresetV1";
const WORLD_IMAGERY_STORAGE="arondight45WorldImageryV1";
const WORLD_IMAGERY_MIGRATION="arondight45WorldImageryDefaultOffV2";
const FOOT_EYE_Z=1.68;
const FOOT_WALK_MPS=4.4;
const FOOT_SPRINT_MPS=7.0;
const FOOT_LOOK_MOUSE=.00215;
const FOOT_LOOK_TOUCH=.0048;
const FOOT_LOOK_PAD=.038;
const FOOT_PISTOL_INTERVAL_MS=175;
const LIFE_UPDATE_MS=MOBILE?80:60;
const LIFE_RESTYLE_MS=2200;
const LEGACY_CLONE_PRUNE_MS=300;

export const WORLD_LOCATION_PRESETS=Object.freeze([
  Object.freeze({id:"new-york",label:"New York",lat:40.7128,lon:-74.0060}),
  Object.freeze({id:"berlin",label:"Berlin",lat:52.5200,lon:13.4050}),
  Object.freeze({id:"zurich",label:"Zürich",lat:47.3769,lon:8.5417}),
  Object.freeze({id:"london",label:"London",lat:51.5074,lon:-0.1278}),
  Object.freeze({id:"paris",label:"Paris",lat:48.8566,lon:2.3522}),
  Object.freeze({id:"tokyo",label:"Tokyo",lat:35.6762,lon:139.6503}),
  Object.freeze({id:"los-angeles",label:"Los Angeles",lat:34.0522,lon:-118.2437}),
  Object.freeze({id:"singapore",label:"Singapore",lat:1.3521,lon:103.8198}),
  Object.freeze({id:"dubai",label:"Dubai",lat:25.2048,lon:55.2708}),
  Object.freeze({id:"sydney",label:"Sydney",lat:-33.8688,lon:151.2093}),
  Object.freeze({id:"rio",label:"Rio de Janeiro",lat:-22.9068,lon:-43.1729}),
]);

export function lifeBudgetForFps(fps=60,mobile=MOBILE){
  const base=mobile?{people:28,cars:9,buses:3,birds:16}:{people:48,cars:16,buses:5,birds:28};
  const value=Number(fps)||60,scale=value<34?.42:value<46?.68:value<54?.84:1;
  return Object.freeze({people:Math.max(8,Math.round(base.people*scale)),cars:Math.max(4,Math.round(base.cars*scale)),buses:Math.max(2,Math.round(base.buses*scale)),birds:Math.max(8,Math.round(base.birds*scale))});
}

export function stepFootPlanar({x=0,y=0,yaw=0,forward=0,strafe=0,speed=FOOT_WALK_MPS,dt=0}={}){
  const f=Math.max(-1,Math.min(1,Number(forward)||0)),s=Math.max(-1,Math.min(1,Number(strafe)||0)),length=Math.max(1,Math.hypot(f,s)),step=Math.max(0,Math.min(.05,Number(dt)||0))*Math.max(0,Number(speed)||0)/length;
  return{x:x+(Math.sin(yaw)*f+Math.cos(yaw)*s)*step,y:y+(Math.cos(yaw)*f-Math.sin(yaw)*s)*step};
}

let installed=false,mode="drone",life=null,lastLifeUpdate=-Infinity,lastRestyle=-Infinity,lastClonePrune=-Infinity,lastFrame=performance.now(),fpsEma=60;
let rendererWrapped=null,settingsMounted=false,topbarMounted=false,footHudMounted=false;
let pistolAudio=null,pistolGain=null,lastPistolAt=-Infinity,pistolFlashUntil=0,gunKick=0;
const foot={position:new THREE.Vector3(0,0,FOOT_EYE_Z),yaw:0,pitch:0,initialized:false,keys:new Set(),move:{x:0,y:0},movePointer:null,lookPointer:null,lookLast:null,fireHeld:false,xboxPrevY:false};
const raycaster=new THREE.Raycaster(),rayOrigin=new THREE.Vector3(),rayDirection=new THREE.Vector3(),tmpTarget=new THREE.Vector3(),tmpMatrix=new THREE.Matrix4(),tmpQuat=new THREE.Quaternion(),tmpScale=new THREE.Vector3(),tmpPosition=new THREE.Vector3(),zAxis=new THREE.Vector3(0,0,1);

function bridge(){return globalThis.__arondightRealWorld||null;}
function viewport(){return document.getElementById("viewport");}
function clamp(value,min,max){return Math.max(min,Math.min(max,Number(value)||0));}
function hash(value){let h=2166136261;for(const c of String(value||"")){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}
function readStorage(key,fallback){try{return localStorage.getItem(key)??fallback;}catch{return fallback;}}
function writeStorage(key,value){try{localStorage.setItem(key,String(value));}catch{}}
function isUiTarget(target){return target instanceof Element&&Boolean(target.closest("button,input,select,textarea,a,label,dialog,#soloTopbar,#worldLookHud,#vsRespawnHud,#footHud"));}
function axis(value,deadzone=.14){const x=clamp(value,-1,1),a=Math.abs(x);if(a<=deadzone)return 0;return Math.sign(x)*(a-deadzone)/(1-deadzone);}
function button(gamepad,index){const b=gamepad?.buttons?.[index];return clamp(typeof b==="number"?b:(b?.value??(b?.pressed?1:0)),0,1);}
function currentGamepad(){return Array.from(navigator.getGamepads?.()||[]).find(p=>p?.connected&&(p.mapping==="standard"||/xbox|xinput|045e/i.test(String(p.id||""))))||null;}

function installStyle(){
  if(document.querySelector("style[data-world-experience]"))return;
  const style=document.createElement("style");style.dataset.worldExperience="v1";style.textContent=`
    body:not(.xbox-aim-mode) .xbox-crosshair{display:none!important}
    body.xbox-aim-mode .xbox-crosshair:not(.active){display:none!important}
    body.xbox-aim-mode .xbox-crosshair.active{display:block!important}
    #playerModeButton{border-color:#7bd7ff66!important;background:#0a2033e8!important;color:#dff7ff!important}
    body.on-foot-mode #playerModeButton{border-color:#ffcf6d88!important;background:#3a2710e8!important;color:#fff2cf!important}
    body.on-foot-mode #soloLeft,body.on-foot-mode #soloRight,body.on-foot-mode #soloClearance,body.on-foot-mode .solo-action{opacity:0!important;pointer-events:none!important}
    .world-experience-select,.world-experience-input{width:100%;box-sizing:border-box;border:1px solid #ffffff33;border-radius:8px;background:#0a1725;color:#eef8ff;padding:8px 9px;font:750 12px system-ui,-apple-system,sans-serif}
    .world-experience-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin:8px 0}.world-experience-grid .wide{grid-column:1/3}
    .world-experience-go{width:100%;border:1px solid #3e93b7;border-radius:8px;background:#123d51;color:#e8fbff;padding:8px;font-weight:850}
    #footHud{display:none;position:absolute;inset:0;z-index:9;pointer-events:none;color:#eef8ff;font-family:system-ui,-apple-system,sans-serif}
    body.on-foot-mode #footHud{display:block}
    #footMove{position:absolute;left:max(16px,var(--solo-safe-left,env(safe-area-inset-left)));bottom:max(18px,var(--solo-safe-bottom,env(safe-area-inset-bottom)));width:126px;height:126px;border:1px solid #b8e8ff44;border-radius:50%;background:#07152273;box-shadow:inset 0 0 25px #4ac4ff1c;pointer-events:auto;touch-action:none}
    #footMove i{position:absolute;left:50%;top:50%;width:48px;height:48px;margin:-24px;border-radius:50%;background:#dff8ff25;border:1px solid #dff8ff66;transform:translate(0,0)}
    #footLookPad{position:absolute;right:0;top:42px;width:54%;bottom:0;pointer-events:auto;touch-action:none;background:transparent}
    #footFire{position:absolute;right:max(18px,var(--solo-safe-right,env(safe-area-inset-right)));bottom:max(22px,var(--solo-safe-bottom,env(safe-area-inset-bottom)));width:74px;height:74px;border-radius:50%;border:1px solid #ffd37d88;background:#4d2e14d9;color:#fff4da;font:900 12px system-ui;pointer-events:auto;touch-action:none;box-shadow:0 5px 24px #0008,inset 0 0 18px #ffb13d22}
    #footModeReadout{position:absolute;left:50%;top:max(48px,calc(var(--solo-safe-top,env(safe-area-inset-top)) + 40px));transform:translateX(-50%);padding:5px 9px;border-radius:9px;background:#071522b8;border:1px solid #ffffff25;font:850 9px/1 system-ui;letter-spacing:.08em;pointer-events:none}
    #footModeReadout b{color:#ffcf6d}
    @media(max-height:340px){#footMove{width:106px;height:106px}#footFire{width:62px;height:62px;font-size:10px}#footModeReadout{top:38px}}
  `;document.head.appendChild(style);
}

function enforceImageryDefaultOff(){
  const b=bridge();let migrated=false;try{migrated=localStorage.getItem(WORLD_IMAGERY_MIGRATION)==="1";}catch{}
  if(!migrated){writeStorage(WORLD_IMAGERY_STORAGE,"0");writeStorage(WORLD_IMAGERY_MIGRATION,"1");b?.setImageryEnabled?.(false);}
}

function setXboxScheme(value){
  const scheme=saveXboxControlScheme(value);document.body.classList.toggle("xbox-aim-mode",scheme===XBOX_CONTROL_SCHEMES.AIM);const view=viewport();if(view)view.dataset.xboxControlScheme=scheme;renderGamepadHelp();return scheme;
}
function renderGamepadHelp(){
  const help=document.getElementById("soloGamepadHelp"),scheme=loadXboxControlScheme();if(!help)return;
  help.textContent=scheme===XBOX_CONTROL_SCHEMES.AIM?"LS MOVE · RS STEER · LT/RT ALT −/+ · HOLD LB AIM/LOOK · RB FIRE · A ARM · B KILL · X CAM · Y TARGET · MENU SETTINGS":"CLASSIC · LS MOVE · RS STEER · LT/RT ALT −/+ · RB FIRE · A ARM · B KILL · X CAM · Y TARGET · MENU SETTINGS";
}

function locationFix(lat,lon,label="CUSTOM"){
  return{coords:{latitude:Number(lat),longitude:Number(lon),accuracy:5,altitude:null,altitudeAccuracy:null,heading:null,speed:null},timestamp:Date.now(),manualLocation:true,label};
}
async function activateCoordinates(lat,lon,label="CUSTOM"){
  const latitude=Number(lat),longitude=Number(lon),b=bridge();if(!b||!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>85||Math.abs(longitude)>180)throw Error("Invalid latitude/longitude");
  if(b.loading)return false;if(b.active)b.deactivate?.();await b.activate?.(locationFix(latitude,longitude,label));const view=viewport();if(view){view.dataset.worldLocationSource="manual";view.dataset.worldLocationLabel=label;}return true;
}

function mountSettings(){
  if(settingsMounted)return;const dialog=document.querySelector(".phone-settings-dialog");if(!dialog)return;
  settingsMounted=true;
  const actions=dialog.querySelector(".phone-settings-actions");
  const controllerBlock=document.createElement("section");controllerBlock.className="world-settings-section";controllerBlock.dataset.worldExperienceController="1";controllerBlock.innerHTML=`<h4>XBOX CONTROL</h4><p class="phone-settings-note">CLASSIC keeps the old direct flight feel: right stick always steers. AIM keeps LB as the optional look/aim layer. The centre crosshair exists only in AIM.</p><label>XBOX FLIGHT SCHEME<select class="world-experience-select" data-xbox-scheme><option value="classic">CLASSIC FLIGHT · DIRECT RS</option><option value="aim">AIM / LOOK · HOLD LB</option></select></label><label>START VIEW<select class="world-experience-select" data-start-mode><option value="foot">ON FOOT · PISTOL</option><option value="drone">DRONE / FPV</option></select></label>`;
  dialog.insertBefore(controllerBlock,actions);
  const xboxSelect=controllerBlock.querySelector("[data-xbox-scheme]"),startSelect=controllerBlock.querySelector("[data-start-mode]");xboxSelect.value=loadXboxControlScheme();startSelect.value=readStorage(PLAYER_MODE_KEY,"foot")==="drone"?"drone":"foot";xboxSelect.addEventListener("change",()=>setXboxScheme(xboxSelect.value));startSelect.addEventListener("change",()=>{writeStorage(PLAYER_MODE_KEY,startSelect.value);setMode(startSelect.value,{persist:false});});

  const world=dialog.querySelector(".world-settings-section:not([data-world-experience-controller])");if(world){
    const oldLabel=[...world.querySelectorAll("label")].find(label=>/SATELLITE MAP/i.test(label.textContent||""));if(oldLabel){const span=oldLabel.querySelector("span");if(span)span.textContent="SATELLITE IMAGERY · OPTIONAL";}
    for(const note of world.querySelectorAll(".phone-settings-note")){note.textContent=note.textContent.replace("REAL AERIAL / SATELLITE MAP is ON by default in both the flight view and minimap.","SATELLITE IMAGERY is OFF by default for speed and clarity; enable it only when you want aerial pixels.");}
    const geo=document.createElement("div");geo.dataset.worldExperienceLocation="1";geo.innerHTML=`<label>GLOBAL WORLD LOCATION</label><select class="world-experience-select" data-location-preset><option value="gps">PHONE GPS</option>${WORLD_LOCATION_PRESETS.map(p=>`<option value="${p.id}">${p.label}</option>`).join("")}<option value="custom">CUSTOM LAT / LON</option></select><div class="world-experience-grid"><input class="world-experience-input" data-location-lat inputmode="decimal" placeholder="Latitude"><input class="world-experience-input" data-location-lon inputmode="decimal" placeholder="Longitude"><button class="world-experience-go wide" type="button" data-location-go>GO TO LOCATION</button></div><p class="phone-settings-note">Pick a city globally or enter coordinates. GPS stays available separately.</p>`;
    const firstToggle=world.querySelector(".phone-settings-toggle");world.insertBefore(geo,firstToggle||null);
    const preset=geo.querySelector("[data-location-preset]"),lat=geo.querySelector("[data-location-lat]"),lon=geo.querySelector("[data-location-lon]"),go=geo.querySelector("[data-location-go]");const stored=readStorage(WORLD_LOCATION_KEY,"gps");preset.value=["gps","custom",...WORLD_LOCATION_PRESETS.map(p=>p.id)].includes(stored)?stored:"gps";
    const syncCoords=()=>{const p=WORLD_LOCATION_PRESETS.find(item=>item.id===preset.value);if(p){lat.value=String(p.lat);lon.value=String(p.lon);}lat.disabled=preset.value==="gps";lon.disabled=preset.value==="gps";};syncCoords();preset.addEventListener("change",syncCoords);
    go.addEventListener("click",async()=>{go.disabled=true;const original=go.textContent;go.textContent="LOADING…";try{if(preset.value==="gps"){writeStorage(WORLD_LOCATION_KEY,"gps");if(bridge()?.active)bridge().deactivate?.();await bridge()?.activate?.();}else{const p=WORLD_LOCATION_PRESETS.find(item=>item.id===preset.value),la=p?.lat??Number(lat.value),lo=p?.lon??Number(lon.value),label=p?.label||"CUSTOM";await activateCoordinates(la,lo,label);writeStorage(WORLD_LOCATION_KEY,p?.id||"custom");}}catch(error){bridge()?.fail?.(error);}finally{go.disabled=false;go.textContent=original;}});
    const reset=dialog.querySelector("[data-reset]");reset?.addEventListener("click",()=>queueMicrotask(()=>{bridge()?.setImageryEnabled?.(false);setXboxScheme(XBOX_CONTROL_SCHEMES.CLASSIC);xboxSelect.value=XBOX_CONTROL_SCHEMES.CLASSIC;writeStorage(PLAYER_MODE_KEY,"foot");startSelect.value="foot";}));
  }
}

function mountTopbar(){
  if(topbarMounted)return;const top=document.getElementById("soloTopbar");if(!top)return;topbarMounted=true;const button=document.createElement("button");button.id="playerModeButton";button.type="button";button.setAttribute("aria-label","Switch between on-foot and drone FPV");const settings=top.querySelector(".phone-settings-button");top.insertBefore(button,settings||null);button.addEventListener("click",()=>setMode(mode==="foot"?"drone":"foot"));renderModeButton();
}
function renderModeButton(){const button=document.getElementById("playerModeButton");if(button)button.textContent=mode==="foot"?"WALK ✓":"DRONE ✓";const readout=document.getElementById("footModeReadout");if(readout)readout.innerHTML=mode==="foot"?"<b>ON FOOT</b> · left move · right look · FIRE":"DRONE / FPV";}

function mountFootHud(){
  if(footHudMounted)return;const view=viewport();if(!view)return;footHudMounted=true;const hud=document.createElement("div");hud.id="footHud";hud.innerHTML=`<div id="footModeReadout"><b>ON FOOT</b> · left move · right look · FIRE</div><div id="footMove" aria-label="On-foot move stick"><i></i></div><div id="footLookPad" aria-label="On-foot look area"></div><button id="footFire" type="button">FIRE</button>`;view.appendChild(hud);
  const move=hud.querySelector("#footMove"),knob=move.querySelector("i"),look=hud.querySelector("#footLookPad"),fire=hud.querySelector("#footFire");
  const updateMove=event=>{const rect=move.getBoundingClientRect(),cx=rect.left+rect.width/2,cy=rect.top+rect.height/2,r=Math.max(1,rect.width*.36),dx=event.clientX-cx,dy=event.clientY-cy,l=Math.max(1,Math.hypot(dx,dy)),scale=Math.min(1,r/l);foot.move.x=clamp(dx/r,-1,1)*scale;foot.move.y=clamp(dy/r,-1,1)*scale;knob.style.transform=`translate(${(foot.move.x*34).toFixed(1)}px,${(foot.move.y*34).toFixed(1)}px)`;};
  move.addEventListener("pointerdown",event=>{foot.movePointer=event.pointerId;move.setPointerCapture?.(event.pointerId);updateMove(event);event.preventDefault();});move.addEventListener("pointermove",event=>{if(event.pointerId!==foot.movePointer)return;updateMove(event);event.preventDefault();});const releaseMove=event=>{if(event.pointerId!==foot.movePointer)return;foot.movePointer=null;foot.move.x=0;foot.move.y=0;knob.style.transform="translate(0,0)";event.preventDefault();};move.addEventListener("pointerup",releaseMove);move.addEventListener("pointercancel",releaseMove);
  look.addEventListener("pointerdown",event=>{foot.lookPointer=event.pointerId;foot.lookLast={x:event.clientX,y:event.clientY};look.setPointerCapture?.(event.pointerId);event.preventDefault();});look.addEventListener("pointermove",event=>{if(event.pointerId!==foot.lookPointer||!foot.lookLast)return;foot.yaw-=clamp(event.clientX-foot.lookLast.x,-45,45)*FOOT_LOOK_TOUCH;foot.pitch=clamp(foot.pitch-clamp(event.clientY-foot.lookLast.y,-45,45)*FOOT_LOOK_TOUCH,-1.30,1.30);foot.lookLast={x:event.clientX,y:event.clientY};event.preventDefault();});const releaseLook=event=>{if(event.pointerId!==foot.lookPointer)return;foot.lookPointer=null;foot.lookLast=null;event.preventDefault();};look.addEventListener("pointerup",releaseLook);look.addEventListener("pointercancel",releaseLook);
  fire.addEventListener("pointerdown",event=>{foot.fireHeld=true;firePistol(performance.now());fire.setPointerCapture?.(event.pointerId);event.preventDefault();});for(const type of ["pointerup","pointercancel","pointerleave"])fire.addEventListener(type,event=>{foot.fireHeld=false;event.preventDefault();});
}

function initializeFoot(){
  if(foot.initialized)return;const b=bridge(),scene=b?.threeScene,airframe=scene?(b.airframeFor?.(scene)||b.airframe):null,p=airframe?.position;foot.position.set(Number(p?.x)||0,(Number(p?.y)||0)-1.4,FOOT_EYE_Z);foot.yaw=0;foot.pitch=0;foot.initialized=true;
}
function setMode(next,{persist=true}={}){
  mode=next==="foot"?"foot":"drone";if(persist)writeStorage(PLAYER_MODE_KEY,mode);globalThis.__arondightOnFootMode=mode==="foot";document.body.classList.toggle("on-foot-mode",mode==="foot");const view=viewport();if(view)view.dataset.playerMode=mode;if(mode==="foot"){initializeFoot();try{view?.dispatchEvent(new PointerEvent("pointercancel",{pointerId:1,bubbles:false,cancelable:true}));}catch{}}else{foot.keys.clear();foot.move.x=0;foot.move.y=0;foot.fireHeld=false;const cross=view?.querySelector(".xbox-crosshair");cross?.classList.remove("active");}if(life?.gun)life.gun.visible=mode==="foot";renderModeButton();return mode;
}

function pointInside(x,y,points){let inside=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const xi=points[i][0],yi=points[i][1],xj=points[j][0],yj=points[j][1],intersect=(yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/((yj-yi)||1e-12)+xi;if(intersect)inside=!inside;}return inside;}
function canWalkTo(x,y){const prisms=bridge()?.buildingCollisionSnapshot?.prisms||[];for(const prism of prisms){if(prism?.top>.2&&Array.isArray(prism.points)&&prism.points.length>=3&&pointInside(x,y,prism.points))return false;}return true;}
function desktopInputs(){return{forward:(foot.keys.has("KeyW")?1:0)-(foot.keys.has("KeyS")?1:0),strafe:(foot.keys.has("KeyD")?1:0)-(foot.keys.has("KeyA")?1:0),sprint:foot.keys.has("ShiftLeft")||foot.keys.has("ShiftRight")};}
function updateFoot(now,dt){
  if(mode!=="foot")return;initializeFoot();const keys=desktopInputs(),pad=currentGamepad();let forward=keys.forward-foot.move.y,strafe=keys.strafe+foot.move.x,sprint=keys.sprint;
  if(pad){forward+=-axis(pad.axes?.[1]);strafe+=axis(pad.axes?.[0]);foot.yaw-=axis(pad.axes?.[2])*FOOT_LOOK_PAD*dt*60;foot.pitch=clamp(foot.pitch-axis(pad.axes?.[3])*FOOT_LOOK_PAD*dt*60,-1.30,1.30);sprint=sprint||button(pad,10)>.5;const aim=loadXboxControlScheme()===XBOX_CONTROL_SCHEMES.AIM&&button(pad,4)>.5;const cross=viewport()?.querySelector(".xbox-crosshair");cross?.classList.toggle("active",aim);if(button(pad,7)>.5)firePistol(now);const y=button(pad,3)>.5;if(y&&!foot.xboxPrevY){setMode("drone");foot.xboxPrevY=y;return;}foot.xboxPrevY=y;}
  const next=stepFootPlanar({x:foot.position.x,y:foot.position.y,yaw:foot.yaw,forward,strafe,speed:sprint?FOOT_SPRINT_MPS:FOOT_WALK_MPS,dt});if(canWalkTo(next.x,foot.position.y))foot.position.x=next.x;if(canWalkTo(foot.position.x,next.y))foot.position.y=next.y;foot.position.z=FOOT_EYE_Z;if(foot.fireHeld)firePistol(now);
}
function applyFootCamera(camera){
  camera.position.copy(foot.position);camera.up.set(0,0,1);const cp=Math.cos(foot.pitch);rayDirection.set(Math.sin(foot.yaw)*cp,Math.cos(foot.yaw)*cp,Math.sin(foot.pitch)).normalize();tmpTarget.copy(camera.position).add(rayDirection);camera.lookAt(tmpTarget);camera.updateMatrixWorld?.(true);
}
function wrapRenderer(){
  const b=bridge(),renderer=b?.threeRenderer;if(!renderer||renderer===rendererWrapped||renderer.__worldExperienceRenderWrapped)return;const base=renderer.render.bind(renderer);renderer.render=(scene,camera)=>{if(mode!=="foot"||camera!==b.threeCamera)return base(scene,camera);const p=camera.position.clone(),q=camera.quaternion.clone(),up=camera.up.clone();applyFootCamera(camera);if(life?.gun)life.gun.visible=true;const result=base(scene,camera);camera.position.copy(p);camera.quaternion.copy(q);camera.up.copy(up);camera.updateMatrixWorld?.(true);return result;};renderer.__worldExperienceRenderWrapped=true;rendererWrapped=renderer;
}

function ensurePistolAudio(){const Ctx=globalThis.AudioContext||globalThis.webkitAudioContext;if(!Ctx)return null;try{pistolAudio??=new Ctx({latencyHint:"interactive"});if(pistolAudio.state==="suspended")pistolAudio.resume().catch(()=>{});if(!pistolGain){pistolGain=pistolAudio.createGain();pistolGain.gain.value=.33;pistolGain.connect(pistolAudio.destination);}return pistolAudio;}catch{return null;}}
function pistolSound(){const ctx=ensurePistolAudio();if(!ctx||!pistolGain)return;try{const t=ctx.currentTime,osc=ctx.createOscillator(),gain=ctx.createGain(),snap=ctx.createOscillator(),snapGain=ctx.createGain();osc.type="triangle";osc.frequency.setValueAtTime(170,t);osc.frequency.exponentialRampToValueAtTime(62,t+.09);gain.gain.setValueAtTime(.16,t);gain.gain.exponentialRampToValueAtTime(.0001,t+.11);snap.type="square";snap.frequency.setValueAtTime(1500,t);snap.frequency.exponentialRampToValueAtTime(520,t+.035);snapGain.gain.setValueAtTime(.045,t);snapGain.gain.exponentialRampToValueAtTime(.0001,t+.045);osc.connect(gain).connect(pistolGain);snap.connect(snapGain).connect(pistolGain);osc.start(t);osc.stop(t+.12);snap.start(t);snap.stop(t+.05);}catch{}}
function populationRoot(node){for(let current=node;current;current=current.parent)if(current.userData?.worldPopulationKind)return current;return null;}
function firePistol(now=performance.now()){
  if(mode!=="foot"||now-lastPistolAt<FOOT_PISTOL_INTERVAL_MS)return false;lastPistolAt=now;pistolSound();gunKick=1;pistolFlashUntil=now+58;const b=bridge(),scene=b?.threeScene;if(!scene)return false;rayOrigin.copy(foot.position);const cp=Math.cos(foot.pitch);rayDirection.set(Math.sin(foot.yaw)*cp,Math.cos(foot.yaw)*cp,Math.sin(foot.pitch)).normalize();raycaster.set(rayOrigin,rayDirection);raycaster.far=180;const candidates=[];scene.traverse(object=>{if(!object?.isMesh||object.visible===false)return;const root=populationRoot(object);if(root&&!root.userData?.worldPopulationClone)candidates.push(object);});const hits=raycaster.intersectObjects(candidates,false);if(hits.length)b?.registerWorldPopulationHit?.(hits[0]);const view=viewport();if(view)view.dataset.worldExperiencePistolShots=String((Number(view.dataset.worldExperiencePistolShots)||0)+1);return true;
}

function makeInstance(geometry,material,max){const mesh=new THREE.InstancedMesh(geometry,material,max);mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.frustumCulled=false;mesh.castShadow=false;mesh.receiveShadow=false;mesh.userData.flightFireIgnore=true;mesh.userData.worldExperienceLife=true;return mesh;}
function setInstance(mesh,index,x,y,z,yaw,sx=1,sy=1,sz=1,color=null){tmpPosition.set(x,y,z);tmpQuat.setFromAxisAngle(zAxis,yaw);tmpScale.set(sx,sy,sz);tmpMatrix.compose(tmpPosition,tmpQuat,tmpScale);mesh.setMatrixAt(index,tmpMatrix);if(color!=null)mesh.setColorAt(index,new THREE.Color(color));}
function makeGun(camera){const group=new THREE.Group();group.name="ON_FOOT_PISTOL";group.userData.flightFireIgnore=true;const dark=new THREE.MeshBasicMaterial({color:0x19232e}),metal=new THREE.MeshBasicMaterial({color:0x566575}),accent=new THREE.MeshBasicMaterial({color:0xd89c38});const slide=new THREE.Mesh(new THREE.BoxGeometry(.12,.09,.34),metal),frame=new THREE.Mesh(new THREE.BoxGeometry(.11,.14,.22),dark),grip=new THREE.Mesh(new THREE.BoxGeometry(.09,.22,.11),dark),sight=new THREE.Mesh(new THREE.BoxGeometry(.025,.02,.04),accent),flash=new THREE.Mesh(new THREE.OctahedronGeometry(.035,0),new THREE.MeshBasicMaterial({color:0xffd36a,transparent:true,opacity:.95}));slide.position.set(.28,-.22,-.52);frame.position.set(.28,-.25,-.39);grip.position.set(.28,-.34,-.31);grip.rotation.x=-.25;sight.position.set(.28,-.17,-.61);flash.position.set(.28,-.20,-.72);flash.visible=false;for(const mesh of [slide,frame,grip,sight,flash]){mesh.userData.flightFireIgnore=true;group.add(mesh);}group.visible=false;camera.add(group);return{group,flash};}
function ensureLife(){
  if(life)return life;const b=bridge(),scene=b?.threeScene,camera=b?.threeCamera;if(!scene||!camera)return null;const root=new THREE.Group();root.name="WORLD_EXPERIENCE_LIFE";root.userData.worldExperienceLife=true;scene.add(root);const max=lifeBudgetForFps(60,false),pal=[0xe95f56,0x4aa6db,0xf2bd4b,0x66b96b,0x8d6ad8,0xe58c49,0x4dc6ba];
  const bodyGeometry=new THREE.CylinderGeometry(.17,.21,.78,5);bodyGeometry.rotateX(Math.PI/2);const personBody=makeInstance(bodyGeometry,new THREE.MeshLambertMaterial({color:0xffffff,vertexColors:true}),max.people),personHead=makeInstance(new THREE.SphereGeometry(.16,6,4),new THREE.MeshLambertMaterial({color:0xd7a47e,vertexColors:true}),max.people),personLeg=makeInstance(new THREE.BoxGeometry(.13,.14,.62),new THREE.MeshLambertMaterial({color:0x27394c,vertexColors:true}),max.people*2);
  const carBody=makeInstance(new THREE.BoxGeometry(1.75,.82,.42),new THREE.MeshLambertMaterial({color:0xffffff,vertexColors:true}),max.cars),carCabin=makeInstance(new THREE.BoxGeometry(.86,.70,.34),new THREE.MeshLambertMaterial({color:0x91c9de,vertexColors:true,transparent:true,opacity:.88}),max.cars);
  const busBody=makeInstance(new THREE.BoxGeometry(4.5,1.48,1.45),new THREE.MeshLambertMaterial({color:0xffffff,vertexColors:true}),max.buses),busGlass=makeInstance(new THREE.BoxGeometry(3.6,1.50,.48),new THREE.MeshLambertMaterial({color:0x70b3cf,vertexColors:true,transparent:true,opacity:.83}),max.buses);
  const bird=makeInstance(new THREE.TetrahedronGeometry(.22,0),new THREE.MeshBasicMaterial({color:0xffffff,vertexColors:true}),max.birds);
  for(const mesh of [personBody,personHead,personLeg,carBody,carCabin,busBody,busGlass,bird])root.add(mesh);
  for(let i=0;i<max.people;i++){personBody.setColorAt(i,new THREE.Color(pal[i%pal.length]));personHead.setColorAt(i,new THREE.Color([0xd9a57d,0x9c6644,0xf0c7a3,0x6f4937][i%4]));}for(let i=0;i<max.people*2;i++)personLeg.setColorAt(i,new THREE.Color([0x233446,0x39404b,0x4a332d][i%3]));for(let i=0;i<max.cars;i++){carBody.setColorAt(i,new THREE.Color(pal[(i+2)%pal.length]));carCabin.setColorAt(i,new THREE.Color(0x7eb6ce));}for(let i=0;i<max.buses;i++){busBody.setColorAt(i,new THREE.Color([0xe7c143,0xd85b4a,0x3d8fc5,0x5da765][i%4]));busGlass.setColorAt(i,new THREE.Color(0x6ba7bd));}for(let i=0;i<max.birds;i++)bird.setColorAt(i,new THREE.Color([0xd7eef7,0x8fb3c8,0xf0f2df][i%3]));
  const hemi=new THREE.HemisphereLight(0xb8dcff,0x38442c,.58),sun=new THREE.DirectionalLight(0xfff0d3,.55);sun.position.set(-12,-18,24);hemi.userData.worldExperienceLife=true;sun.userData.worldExperienceLife=true;scene.add(hemi,sun);const gun=makeGun(camera);life={root,personBody,personHead,personLeg,carBody,carCabin,busBody,busGlass,bird,hemi,sun,gun:gun.group,gunFlash:gun.flash,max};return life;
}
function anchorPosition(){if(mode==="foot")return foot.position;const b=bridge(),airframe=b?.threeScene?(b.airframeFor?.(b.threeScene)||b.airframe):null;return airframe?.position||tmpPosition.set(0,0,0);}
function updateLife(now){
  const l=ensureLife();if(!l)return;const anchor=anchorPosition(),budget=lifeBudgetForFps(fpsEma,MOBILE),t=now/1000;l.personBody.count=l.personHead.count=budget.people;l.personLeg.count=budget.people*2;l.carBody.count=l.carCabin.count=budget.cars;l.busBody.count=l.busGlass.count=budget.buses;l.bird.count=budget.birds;
  for(let i=0;i<budget.people;i++){const seed=(i*1.618)%1,a=seed*Math.PI*2+t*(.09+(i%5)*.011),r=8+(i%9)*2.7,x=anchor.x+Math.cos(a)*r,y=anchor.y+Math.sin(a*.91)*r*.72,yaw=a+Math.PI/2,z=.39;setInstance(l.personBody,i,x,y,z+.48,yaw);setInstance(l.personHead,i,x,y,z+1.02,yaw);const gait=Math.sin(t*5+i)*.12;setInstance(l.personLeg,i*2,x+Math.cos(yaw)*.09,y+Math.sin(yaw)*.09,z-.03,yaw,1,1,1+gait);setInstance(l.personLeg,i*2+1,x-Math.cos(yaw)*.09,y-Math.sin(yaw)*.09,z-.03,yaw,1,1,1-gait);}
  for(let i=0;i<budget.cars;i++){const a=t*(.12+(i%4)*.018)+i*.83,r=22+(i%6)*5,x=anchor.x+Math.cos(a)*r,y=anchor.y+Math.sin(a)*r*.66,yaw=a+Math.PI/2;setInstance(l.carBody,i,x,y,.27,yaw);setInstance(l.carCabin,i,x,y,.58,yaw);}
  for(let i=0;i<budget.buses;i++){const a=-t*(.065+i*.006)+i*2.2,r=38+i*10,x=anchor.x+Math.cos(a)*r,y=anchor.y+Math.sin(a)*r*.72,yaw=a-Math.PI/2;setInstance(l.busBody,i,x,y,.80,yaw);setInstance(l.busGlass,i,x,y,1.03,yaw);}
  for(let i=0;i<budget.birds;i++){const a=t*(.18+(i%5)*.015)+i*.71,r=18+(i%8)*4,x=anchor.x+Math.cos(a)*r,y=anchor.y+Math.sin(a)*r,z=7+(i%7)*1.7+Math.sin(t*1.7+i)*1.2,yaw=a+Math.PI/2;setInstance(l.bird,i,x,y,z,yaw,1.6,.55,.45);}
  for(const mesh of [l.personBody,l.personHead,l.personLeg,l.carBody,l.carCabin,l.busBody,l.busGlass,l.bird]){mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;}
  const view=viewport();if(view){view.dataset.worldExperiencePeople=String(budget.people);view.dataset.worldExperienceCars=String(budget.cars);view.dataset.worldExperienceBuses=String(budget.buses);view.dataset.worldExperienceBirds=String(budget.birds);view.dataset.worldExperienceFps=fpsEma.toFixed(1);}
}
function pruneLegacyDensityClones(){const scene=bridge()?.threeScene;if(!scene)return;let removed=0;for(const child of [...scene.children])if(child?.userData?.worldPopulationClone){scene.remove(child);removed++;}if(removed){const view=viewport();if(view)view.dataset.worldLegacyDensityClonesPruned=String((Number(view.dataset.worldLegacyDensityClonesPruned)||0)+removed);}}
function restyleOriginalPopulation(){const scene=bridge()?.threeScene;if(!scene)return;const carPal=[0x326c8f,0x98483f,0xc39b34,0x4d7651,0x62507f],shirtPal=[0x4ca5d5,0xd25e4a,0x64b05e,0xd2ae3c,0x7961bd,0x38a98f];scene.traverse(node=>{if(!node?.isGroup||node.userData?.worldExperienceStyled||!node.userData?.worldPopulationKind||node.userData?.worldPopulationClone)return;node.userData.worldExperienceStyled=true;const id=String(node.userData.worldPopulationId||node.uuid),h=hash(id),palette=node.userData.worldPopulationKind==="car"?carPal:shirtPal;node.traverse(mesh=>{if(!mesh?.isMesh||!mesh.material?.color)return;try{mesh.material=mesh.material.clone();mesh.material.color.setHex(palette[h%palette.length]);if("roughness" in mesh.material)mesh.material.roughness=.72;if("metalness" in mesh.material)mesh.material.metalness=.08;}catch{}});});}
function updateGun(now){if(!life?.gun)return;gunKick+=(0-gunKick)*.24;life.gun.position.set(0,gunKick*.035,gunKick*.025);life.gun.rotation.x=-gunKick*.08;life.gunFlash.visible=mode==="foot"&&now<pistolFlashUntil;life.gun.visible=mode==="foot";}

function installInput(){
  addEventListener("keydown",event=>{if(mode!=="foot"||event.metaKey||event.ctrlKey||event.altKey||isUiTarget(event.target))return;if(["KeyW","KeyA","KeyS","KeyD","ShiftLeft","ShiftRight"].includes(event.code)){foot.keys.add(event.code);event.preventDefault();}else if(event.code==="KeyV"){setMode("drone");event.preventDefault();}});addEventListener("keyup",event=>foot.keys.delete(event.code));
  addEventListener("mousemove",event=>{if(mode!=="foot"||document.pointerLockElement!==viewport())return;foot.yaw-=event.movementX*FOOT_LOOK_MOUSE;foot.pitch=clamp(foot.pitch-event.movementY*FOOT_LOOK_MOUSE,-1.30,1.30);});
  viewport()?.addEventListener("pointerdown",event=>{if(mode!=="foot"||MOBILE||isUiTarget(event.target))return;if(document.pointerLockElement!==viewport()){viewport()?.requestPointerLock?.();return;}if(event.button===0)firePistol(performance.now());},{capture:true});
}
function frame(now=performance.now()){
  const dt=clamp((now-lastFrame)/1000,0,.05);lastFrame=now;const instant=dt>0?1/dt:60;fpsEma=fpsEma*.94+Math.min(120,instant)*.06;mountTopbar();mountFootHud();mountSettings();wrapRenderer();updateFoot(now,dt);updateGun(now);if(now-lastLifeUpdate>=LIFE_UPDATE_MS){lastLifeUpdate=now;updateLife(now);}if(now-lastClonePrune>=LEGACY_CLONE_PRUNE_MS){lastClonePrune=now;pruneLegacyDensityClones();}if(now-lastRestyle>=LIFE_RESTYLE_MS){lastRestyle=now;restyleOriginalPopulation();}requestAnimationFrame(frame);
}

export function installWorldExperience(){
  if(installed)return;installed=true;installStyle();enforceImageryDefaultOff();setXboxScheme(loadXboxControlScheme());const defaultMode=navigator.webdriver?"drone":(readStorage(PLAYER_MODE_KEY,"foot")==="drone"?"drone":"foot");mode=defaultMode;globalThis.__arondightOnFootMode=mode==="foot";document.body.classList.toggle("on-foot-mode",mode==="foot");globalThis.__arondightWorldLocations=WORLD_LOCATION_PRESETS;globalThis.__arondightActivateWorldCoordinates=activateCoordinates;installInput();new MutationObserver(()=>{mountTopbar();mountFootHud();mountSettings();}).observe(document.documentElement,{subtree:true,childList:true});requestAnimationFrame(frame);const view=viewport();if(view){view.dataset.worldExperience="1";view.dataset.playerMode=mode;view.dataset.worldExperienceLifeLayer="instanced";}
}

installWorldExperience();
