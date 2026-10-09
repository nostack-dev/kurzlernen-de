// Desktop play: mouse + keyboard, no touch furniture.
//
// The input device in use decides the layout: a mouse / keyboard switches the
// page to `body.desktop-input` (touch sticks and touch-only buttons hidden,
// key hints shown), a touch on the screen switches back. On desktop the mouse
// is captured with pointer lock (click into the game; Esc releases it):
//   on foot  raw mouse look (walk.applyMouseLook), LMB fire (walk), 1-3 / Q /
//            wheel weapon, Space jump, Shift sprint, V drone, E vehicle
//   drone    WASD fly, Space / Shift climb / sink, mouse = turn + tilt rate,
//            RMB held = free look, LMB fire (centre crosshair), R arm,
//            C camera, 1-3 / Q / wheel weapon, V back on foot
//   car      the car's keys; mouse = head look (springs back when idle)
//   jet      the jet's keys; mouse deltas are handed to the jet
//            (__arondightDesktopInput.takeMouseDelta)
// This module is imported first, so its window capture listeners run before
// every other pointer handler.
const UI_SELECTOR="button,input,select,textarea,a,label,dialog,[role=button],#soloTopbar,#worldLookHud,#gameMenu,.phone-settings-dialog,#mobileGameplayDock,#vsRespawnHud";
const DRONE_FULL_RATE_PX_S=1500,DRONE_RATE_TAU_S=.05,LOOK_DEG_PER_PX=.12,LOOK_IDLE_SNAP_MS=1400,MAX_EVENT_PX=420;
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,Number(v)||0));
const viewport=()=>document.getElementById("viewport");
const walk=()=>globalThis.__arondightWalkMode||null;
const bridge=()=>globalThis.__arondightRealWorld||null;

let installed=false,desktop=false,lmb=false,rmb=false,dronePx={x:0,y:0},droneRate={x:0,y:0},lastTick=performance.now(),lastLookMs=-Infinity,lookOwned=false,jetDelta={x:0,y:0};
const keys=new Set(),droneSample={active:false,left:{x:0,y:0},right:{x:0,y:0},heightAxis:0,fire:false,arm:false,camera:false};

function playerDown(){return Boolean(globalThis.__arondightPlayerDamageModel?.dead||globalThis.__arondightRealWorld?.vsLocalDead||document.body.classList.contains("player-dead"));}
function gameMode(){const b=document.body;if(b.classList.contains("jet-mode"))return"jet";if(b.classList.contains("player-driving"))return"car";return walk()?.mode==="foot"?"foot":"drone";}
function locked(){const v=viewport();return Boolean(v)&&document.pointerLockElement===v;}
function inGame(){const menu=document.getElementById("gameMenu");return document.body.classList.contains("solo-flight")&&(!menu||menu.hidden)&&!document.querySelector("dialog[open]");}
function gameplayTarget(target){const v=viewport();return target instanceof Element&&Boolean(v?.contains(target))&&!target.closest(UI_SELECTOR);}
function consume(event){event.preventDefault();event.stopImmediatePropagation();}

function setDesktop(next){
  next=Boolean(next);if(next===desktop)return;desktop=next;document.body.classList.toggle("desktop-input",desktop);
  if(!desktop){if(locked())document.exitPointerLock?.();releaseAll();}
  const v=viewport();if(v)v.dataset.inputDevice=desktop?"mouse-keyboard":"touch";renderHints();
}
function releaseAll(){keys.clear();lmb=rmb=false;dronePx.x=dronePx.y=0;droneRate.x=droneRate.y=0;jetDelta.x=jetDelta.y=0;Object.assign(droneSample,{active:false,fire:false,arm:false,camera:false,heightAxis:0});droneSample.left={x:0,y:0};droneSample.right={x:0,y:0};endLook();}

function requestLock(){
  const v=viewport();if(!v?.requestPointerLock)return;
  // the OS pointer speed curve stays on (like the desktop cursor the player is used to): raw counts felt dead on small, slow moves
  try{const p=v.requestPointerLock();if(p?.catch)p.catch(()=>{});}catch{}
}

// head look (car, drone with RMB): the shared world look, snapping back when idle
function look(dx,dy){
  const b=bridge();if(!b)return;lookOwned=true;lastLookMs=performance.now();b.lookSnapping=false;
  b.lookYawDeg=((Number(b.lookYawDeg)||0)+dx*LOOK_DEG_PER_PX+540)%360-180;b.lookPitchDeg=clamp((Number(b.lookPitchDeg)||0)-dy*LOOK_DEG_PER_PX*.85,-75,60);b.minimapLastDrawMs=-Infinity;b.renderLookHud?.();
}
function endLook(){const b=bridge();if(lookOwned&&b&&!b.keepLookOrientation)b.lookSnapping=true;lookOwned=false;}

function weaponApi(){return gameMode()==="foot"?globalThis.__arondightFootWeapons:globalThis.__arondightDroneWeapons;}
function selectWeapon(index){
  const mode=gameMode();if(mode==="foot"){const order=["smg","glock","grenade"];if(order[index])globalThis.__arondightFootWeapons?.setMode?.(order[index]);return true;}
  if(mode==="drone"){const order=["gun","missile","nuke"],api=globalThis.__arondightDroneWeapons;if(order[index])api?.setMode?.(order[index]);return true;}
  return false;
}

function droneFire(pressed){
  // the nuke is aimed by a screen point: under pointer lock that is the crosshair
  const api=globalThis.__arondightDroneWeapons;
  if(pressed&&String(api?.displayMode||"")==="nuke"){const v=viewport(),r=v?.getBoundingClientRect();if(r)api?.fireNuke?.({clientX:r.left+r.width/2,clientY:r.top+r.height/2,source:"mouse"});return;}
  droneSample.fire=Boolean(pressed);
}

function onPointerDown(event){
  if(event.pointerType==="touch"||event.pointerType==="pen"){setDesktop(false);return;}
  if(event.pointerType!=="mouse")return;setDesktop(true);
  if(!locked()){
    if(!inGame()||!gameplayTarget(event.target)||event.button!==0)return;
    requestLock();consume(event);return; // the capturing click never fires
  }
  const mode=gameMode();
  if(mode==="foot"){if(event.button===0)return; /* walk fires from the crosshair */ consume(event);return;}
  if(event.button===0){lmb=true;if(mode==="drone")droneFire(true);}
  else if(event.button===2){rmb=true;}
  consume(event);
}
function onPointerUp(event){
  if(event.pointerType!=="mouse")return;
  if(event.button===0&&lmb){lmb=false;droneFire(false);}
  if(event.button===2&&rmb){rmb=false;endLook();}
  if(locked()&&gameMode()!=="foot")consume(event);
}
function onPointerMove(event){
  if(event.pointerType==="mouse"&&(event.movementX||event.movementY)&&!locked())setDesktop(true);
  if(!locked()||event.pointerType!=="mouse")return;
  let dx=Number(event.movementX)||0,dy=Number(event.movementY)||0;
  if(Math.abs(dx)>MAX_EVENT_PX||Math.abs(dy)>MAX_EVENT_PX){consume(event);return;} // pointer-lock entry spikes
  const mode=gameMode();
  if(mode==="foot")walk()?.applyMouseLook?.({dx,dy});
  else if(mode==="car")look(dx,dy);
  else if(mode==="jet"){jetDelta.x+=dx;jetDelta.y+=dy;}
  else if(rmb)look(dx,dy);
  else{dronePx.x+=dx;dronePx.y+=dy;}
  consume(event);
}
function onWheel(event){
  if(!locked())return;const mode=gameMode();if(mode!=="foot"&&mode!=="drone")return;
  const api=weaponApi();if(typeof api?.toggle!=="function")return;
  if(mode==="foot"){const order=["smg","glock","grenade"],i=order.indexOf(String(api.mode)),n=(i+(event.deltaY>0?1:-1)+order.length)%order.length;api.setMode?.(order[n]);}else api.toggle();
  event.preventDefault();
}

const DRONE_KEYS=new Set(["KeyW","KeyA","KeyS","KeyD","Space","ShiftLeft","ShiftRight","ArrowUp","ArrowDown","ArrowLeft","ArrowRight","KeyR","KeyC"]);
function onKeyDown(event){
  if(event.metaKey||event.ctrlKey||event.altKey)return;
  const target=event.target;if(target instanceof Element&&target.closest("input,textarea,select,[contenteditable]"))return;
  setDesktop(true);
  // dead: R / Enter respawns (the mouse is captured, the RESET button cannot be clicked)
  if((event.code==="KeyR"||event.code==="Enter")&&!event.repeat&&playerDown()){const hud=document.getElementById("vsRespawnHud");if(hud&&!hud.hidden)hud.querySelector("button")?.click();else globalThis.__arondightRequestReset?.();event.preventDefault();event.stopImmediatePropagation();return;}
  if(!inGame())return;const mode=gameMode();
  if(/^Digit[1-3]$/.test(event.code)&&(mode==="foot"||mode==="drone")){selectWeapon(Number(event.code.slice(5))-1);event.preventDefault();return;}
  if(mode!=="drone")return;
  if(event.code==="KeyV"&&!event.repeat){walk()?.setMode?.("foot");consume(event);return;}
  if(DRONE_KEYS.has(event.code)){keys.add(event.code);if(event.code==="KeyR"&&!event.repeat)droneSample.arm=true;if(event.code==="KeyC"&&!event.repeat)droneSample.camera=true;event.preventDefault();}
}
function onKeyUp(event){keys.delete(event.code);if(event.code==="KeyR")droneSample.arm=false;if(event.code==="KeyC")droneSample.camera=false;}

function tick(){
  const now=performance.now(),dt=clamp((now-lastTick)/1000,1/240,.1);lastTick=now;
  const drone=desktop&&gameMode()==="drone"&&inGame();
  if(drone){
    const k=c=>keys.has(c)?1:0,a=1-Math.exp(-dt/DRONE_RATE_TAU_S);
    droneRate.x+=(clamp(dronePx.x/dt/DRONE_FULL_RATE_PX_S,-1,1)-droneRate.x)*a;droneRate.y+=(clamp(dronePx.y/dt/DRONE_FULL_RATE_PX_S,-1,1)-droneRate.y)*a;dronePx.x=dronePx.y=0;
    droneSample.left={x:k("KeyD")-k("KeyA"),y:k("KeyS")-k("KeyW")};
    droneSample.right={x:clamp(droneRate.x+k("ArrowRight")-k("ArrowLeft"),-1,1),y:clamp(droneRate.y+k("ArrowDown")-k("ArrowUp"),-1,1)};
    droneSample.heightAxis=k("Space")-(k("ShiftLeft")||k("ShiftRight"));droneSample.active=true;
  }else if(droneSample.active){droneSample.active=false;droneSample.fire=false;dronePx.x=dronePx.y=0;droneRate.x=droneRate.y=0;}
  if(lookOwned&&!rmb&&now-lastLookMs>LOOK_IDLE_SNAP_MS)endLook();
  syncOverlay();
}

let hintEl=null,playEl=null,lastHint="";
const HINTS={
  foot:"WASD move · SHIFT sprint · SPACE jump · LMB fire · 1-3 / Q / WHEEL weapon · E vehicle · V drone · J strike · ESC mouse",
  drone:"WASD fly · SPACE / SHIFT up / down · MOUSE turn · RMB look · LMB fire · R arm · C camera · 1-3 / Q weapon · V on foot",
  car:"W / S gas / brake · A / D steer · SPACE handbrake · MOUSE look · C camera · E exit",
  jet:"W / S throttle · A / D rudder · MOUSE pitch / roll · LMB / SPACE gun · R rocket · B bomb · V hover / flight · C camera · E exit",
};
function installUi(){
  if(document.querySelector("style[data-desktop-controls]"))return;
  const st=document.createElement("style");st.dataset.desktopControls="v1";st.textContent=`
html body.desktop-input #viewport #footHud #footMove,html body.desktop-input #viewport #footHud #footLook,html body.desktop-input #viewport #footHud #footFire,html body.desktop-input #viewport #footHud #footJump,html body.desktop-input #viewport #footHud #footLookZone{display:none!important;pointer-events:none!important}
body.desktop-input #footMove,body.desktop-input #footLook,body.desktop-input #footJump,body.desktop-input #footFire,body.desktop-input #footLookZone,
body.desktop-input #soloLeft,body.desktop-input #soloRight,body.desktop-input #soloHeightPad,body.desktop-input .vehicle-stick,
body.desktop-input #vehicleCamButton,body.desktop-input #footWeaponToggle,body.desktop-input #droneWeaponToggle,body.desktop-input #vehicleBrakeButton,body.desktop-input #jetHud .jet-btns,body.desktop-input #mobileGameplayDock{display:none!important;pointer-events:none!important}
#desktopKeyHints{position:absolute;left:50%;bottom:max(10px,env(safe-area-inset-bottom));transform:translateX(-50%);z-index:30;max-width:min(94vw,980px);padding:6px 12px;border-radius:6px;background:#0b0f16a8;color:#dfe7f2;font:600 11px/1.35 Inter,system-ui,sans-serif;letter-spacing:.04em;text-align:center;pointer-events:none;display:none;white-space:normal}
body.desktop-input.solo-flight #desktopKeyHints{display:block}
#desktopClickToPlay{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:31;padding:14px 22px;border-radius:8px;background:#0b0f16d0;border:1px solid #ffffff44;color:#fff;font:800 15px/1.2 Inter,system-ui,sans-serif;letter-spacing:.12em;text-align:center;pointer-events:none;display:none}
#desktopClickToPlay small{display:block;margin-top:6px;font-weight:600;font-size:11px;letter-spacing:.05em;opacity:.75}
body.desktop-input.solo-flight #desktopClickToPlay.show{display:block}`;
  document.head.appendChild(st);
}
function ensureEls(){
  const v=viewport();if(!v)return false;
  if(!hintEl){hintEl=document.createElement("div");hintEl.id="desktopKeyHints";v.appendChild(hintEl);}
  if(!playEl){playEl=document.createElement("div");playEl.id="desktopClickToPlay";playEl.innerHTML="CLICK TO PLAY<small>mouse + keyboard · ESC releases the mouse</small>";v.appendChild(playEl);}
  return true;
}
const WEAPON_NAMES={smg:"SMG",glock:"PISTOL",grenade:"GRENADE LAUNCHER",gun:"GUN",missile:"MISSILE",nuke:"NUKE"};
function renderHints(){if(!ensureEls())return;if(desktop&&playerDown()){const t="DOWN · R / ENTER = RESPAWN";if(t!==lastHint){hintEl.textContent=t;lastHint=t;}return;}const mode=gameMode(),api=mode==="foot"?globalThis.__arondightFootWeapons:mode==="drone"?globalThis.__arondightDroneWeapons:null,w=api?WEAPON_NAMES[String(api.displayMode||api.mode)]||"":"",text=desktop?(w?`[ ${w} ]  `:"")+(HINTS[mode]||""):"";if(text!==lastHint){hintEl.textContent=text;lastHint=text;}}
function syncOverlay(){if(!ensureEls())return;renderHints();playEl.classList.toggle("show",desktop&&inGame()&&!locked());const v=viewport();if(v)v.dataset.pointerLock=locked()?"1":"0";}

export function installDesktopControls(){
  if(installed||typeof window==="undefined")return;installed=true;
  installUi();
  setDesktop(Boolean(globalThis.matchMedia?.("(hover: hover) and (pointer: fine)")?.matches));
  window.addEventListener("pointerdown",onPointerDown,{capture:true,passive:false});
  window.addEventListener("pointerup",onPointerUp,{capture:true,passive:false});
  window.addEventListener("pointermove",onPointerMove,{capture:true,passive:false});
  window.addEventListener("wheel",onWheel,{capture:true,passive:false});
  window.addEventListener("keydown",onKeyDown);window.addEventListener("keyup",onKeyUp);
  window.addEventListener("contextmenu",event=>{if(locked()||(desktop&&gameplayTarget(event.target)))event.preventDefault();},{capture:true});
  document.addEventListener("pointerlockchange",()=>{if(!locked()){lmb=false;rmb=false;droneFire(false);endLook();keys.clear();}syncOverlay();});
  window.addEventListener("blur",releaseAll);
  window.addEventListener("arondight:player-death",()=>{if(locked())document.exitPointerLock?.();});
  globalThis.__arondightDesktopDroneInput=droneSample;
  globalThis.__arondightDesktopInput={get active(){return desktop;},get locked(){return locked();},get mode(){return gameMode();},get lmb(){return lmb;},get rmb(){return rmb;},keys,takeMouseDelta(){const d={x:jetDelta.x,y:jetDelta.y};jetDelta.x=jetDelta.y=0;return d;},version:"desktop-mouse-keyboard-v1"};
  setInterval(tick,16);
}
installDesktopControls();
