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

// Phones and tablets (primary pointer coarse) stay in touch layout even if a mouse event
// arrives (emulated clicks, a paired mouse); laptops with touch screens have a fine primary
// pointer and switch whichever device the player uses last.
function mouseMeansDesktop(){try{return!globalThis.matchMedia?.("(pointer: coarse)")?.matches;}catch{return true;}}
function setDesktop(next){
  next=Boolean(next);if(next===desktop)return;desktop=next;document.body.classList.toggle("desktop-input",desktop);
  if(!desktop){if(locked())document.exitPointerLock?.();releaseAll();}
  const v=viewport();if(v)v.dataset.inputDevice=desktop?"mouse-keyboard":"touch";renderHints();
}
function releaseAll(){keys.clear();lmb=rmb=false;dronePx.x=dronePx.y=0;droneRate.x=droneRate.y=0;jetDelta.x=jetDelta.y=0;Object.assign(droneSample,{active:false,fire:false,arm:false,camera:false,heightAxis:0});droneSample.left={x:0,y:0};droneSample.right={x:0,y:0};endLook();}

let wantMenu=false;
function openMenu(){const d=document.querySelector("dialog.phone-settings-dialog");if(d?.open)return;wantMenu=true;if(locked())document.exitPointerLock?.();(document.querySelector("#soloTopbar .phone-settings-button")||document.querySelector(".phone-settings-button"))?.click();}
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

// the mouse was freed for a small prompt (reset vote, …), not by the player pressing Esc: no pause menu
function quietUnlock(){return Boolean(document.getElementById("resetVoteDialog")||document.getElementById("quitConfirmDialog"))||performance.now()<(Number(globalThis.__arondightQuietUnlockUntil)||0);}
function weaponApi(){return gameMode()==="foot"?globalThis.__arondightFootWeapons:globalThis.__arondightDroneWeapons;}
function selectWeapon(index){
  const mode=gameMode();if(mode==="foot"){const order=["smg","glock","sniper","grenade","grenade","gravity"];if(order[index])globalThis.__arondightFootWeapons?.setMode?.(order[index]);return true;}
  if(mode==="drone"){const order=["gun","missile"],api=globalThis.__arondightDroneWeapons;if(order[index])api?.setMode?.(order[index]);return true;}
  return false;
}

function droneFire(pressed){
  // the nuke is aimed by a screen point: under pointer lock that is the crosshair
  const api=globalThis.__arondightDroneWeapons;
  if(pressed&&String(api?.displayMode||"")==="nuke"){const v=viewport(),r=v?.getBoundingClientRect();if(r)api?.fireNuke?.({clientX:r.left+r.width/2,clientY:r.top+r.height/2,source:"mouse"});return;}
  droneSample.fire=Boolean(pressed);
}

function onPointerDown(event){if(event.pointerType==="mouse")document.body.classList.remove("pad-input");
  if(event.pointerType==="touch"||event.pointerType==="pen"){setDesktop(false);return;}
  if(event.pointerType!=="mouse"||!mouseMeansDesktop())return;
  // A click on a touch UI button (dock, HUD) must land first: switching now would hide the
  // button under the cursor and the click would hit the view instead. Switch right after it.
  if(!desktop&&event.target instanceof Element&&event.target.closest(UI_SELECTOR)){addEventListener("click",()=>setTimeout(()=>setDesktop(true),0),{once:true,capture:true});return;}
  setDesktop(true);
  if(!locked()){
    if(!inGame()||!gameplayTarget(event.target)||event.button!==0)return;
    requestLock();consume(event);return; // the capturing click never fires
  }
  const mode=gameMode();
  if(mode==="foot"){if(event.button===0)return; /* walk fires from the crosshair */ if(event.button===2)rmb=true; /* aim down sights */ consume(event);return;}
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
  if(event.pointerType==="mouse"&&(event.movementX||event.movementY)&&!locked()&&!desktop&&mouseMeansDesktop()&&!(event.target instanceof Element&&event.target.closest(UI_SELECTOR)))setDesktop(true);
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
  if(mode==="foot"){const order=["smg","glock","sniper","gravity","grenade"],i=order.indexOf(String(api.mode)),n=(i+(event.deltaY>0?1:-1)+order.length)%order.length;api.setMode?.(order[n]);}else api.toggle();
  event.preventDefault();
}

const DRONE_KEYS=new Set(["KeyW","KeyA","KeyS","KeyD","Space","ShiftLeft","ShiftRight","ArrowUp","ArrowDown","ArrowLeft","ArrowRight","KeyR","KeyC"]);
function onKeyDown(event){
  if(event.metaKey||event.ctrlKey||event.altKey)return;
  const target=event.target;if(target instanceof Element&&target.closest("input,textarea,select,[contenteditable]"))return;
  if(event.__synthetic!=="pad"){setDesktop(true);document.body.classList.remove("pad-input");}
  // TAB / M: the pause menu (settings + all game actions), the mouse is freed for it
  if(event.code==="Escape"&&!event.repeat&&event.__synthetic!=="pad"&&inGame()&&!locked()&&!document.querySelector("dialog[open],#resetVoteDialog,#quitConfirmDialog,#worldOptionsPanel:not([hidden])")){event.preventDefault();globalThis.__arondightQuitConfirm?.open?.();return;}
  if((event.code==="Tab"||event.code==="KeyM")&&!event.repeat&&event.__synthetic!=="pad"&&inGame()&&!playerDown()){event.preventDefault();openMenu();return;}
  // dead: R / Enter respawns (the mouse is captured, the RESET button cannot be clicked)
  if((event.code==="KeyR"||event.code==="Enter")&&!event.repeat&&playerDown()){event.preventDefault();event.stopImmediatePropagation();if(globalThis.__arondightRespawnReady&&!globalThis.__arondightRespawnReady())return;const hud=document.getElementById("vsRespawnHud");if(hud&&!hud.hidden)hud.querySelector("button")?.click();else globalThis.__arondightRequestReset?.();event.preventDefault();event.stopImmediatePropagation();return;}
  if(!inGame())return;const mode=gameMode();
  if(/^Digit[1-3]$/.test(event.code)&&(mode==="foot"||mode==="drone")){selectWeapon(Number(event.code.slice(5))-1);event.preventDefault();return;}
  if(event.code==="Digit5"&&mode==="foot"){selectWeapon(3);event.preventDefault();return;} /* 5 = rocket launcher (4 is the air strike) */
  if(event.code==="Digit6"&&mode==="foot"){selectWeapon(4);event.preventDefault();return;} /* 6 = grenade launcher */
  if(event.code==="Digit7"&&mode==="foot"){selectWeapon(5);event.preventDefault();return;} /* 7 = gravity gun */
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
  foot:"WASD move · SHIFT sprint · SPACE jump (2× jetpack) · LMB fire · RMB aim / scope · 1 MP 2 Glock 3 Sniper 5/6 Raketen 7 Gravity / Q / WHEEL · F vehicle · V drone · 4 strike · G EMP · P multiplayer · ESC menu",
  drone:"WASD fly · SPACE / SHIFT up / down · MOUSE turn · RMB look · LMB fire · R arm · C camera · 1-3 / Q weapon · V on foot · ESC menu",
  car:"W / S gas / brake · A / D steer · SPACE handbrake · MOUSE look · C camera · F exit · ESC menu",
  jet:"W / S throttle · A / D rudder · MOUSE pitch / roll · LMB / SPACE gun · R rocket · B bomb · V hover / flight · C camera · F exit / eject · ESC menu",
};
function installUi(){
  if(document.querySelector("style[data-desktop-controls]"))return;
  const st=document.createElement("style");st.dataset.desktopControls="v1";st.textContent=`
html body.desktop-input #viewport #footHud #footMove,html body.desktop-input #viewport #footHud #footLook,html body.desktop-input #viewport #footHud #footFire,html body.desktop-input #viewport #footHud #footJump,html body.desktop-input #viewport #footHud #footLookZone{display:none!important;pointer-events:none!important}
body.desktop-input #footMove,body.desktop-input #footLook,body.desktop-input #footJump,body.desktop-input #footFire,body.desktop-input #footLookZone,
body.desktop-input #soloLeft,body.desktop-input #soloRight,body.desktop-input #soloHeightPad,body.desktop-input .vehicle-stick,
body.desktop-input #vehicleCamButton,body.desktop-input #footWeaponToggle,body.desktop-input #droneWeaponToggle,body.desktop-input #vehicleBrakeButton,body.desktop-input #jetHud .jet-btns{display:none!important;pointer-events:none!important}
/* same HUD as mobile; the key sits on each dock button */
body.desktop-input #mobileGameplayDock button::after{display:inline-block;margin-left:6px;padding:1px 4px;border:1px solid #ffffff55;border-radius:3px;font:800 9px/1.2 system-ui,sans-serif;letter-spacing:.04em;opacity:.8}
html body.desktop-input.mobile-gameplay-compact.solo-flight #mobileGameplayDock{width:min(calc(100% - 300px),470px)}
/* the STRIKE button stays visible with its key / pad button, so the strike is easy to find */
html body.desktop-input #airStrikeButton{position:relative}html body.desktop-input #airStrikeButton::after,html body.pad-input #airStrikeButton::after{position:absolute;right:-6px;top:-6px;padding:1px 5px;border-radius:4px;background:#000c;border:1px solid #ffffff66;color:#fff;font:800 10px/1.2 system-ui,sans-serif}html body.desktop-input:not(.pad-input) #airStrikeButton::after{content:"4"}html body.desktop-input #wantedEmpButton{position:relative}html body.desktop-input:not(.pad-input) #wantedEmpButton::after,html body.pad-input #wantedEmpButton::after{position:absolute;right:-6px;top:-6px;padding:1px 5px;border-radius:4px;background:#000c;border:1px solid #ffffff66;color:#fff;font:800 10px/1.2 system-ui,sans-serif}html body.desktop-input:not(.pad-input) #wantedEmpButton::after{content:"G"}html body.desktop-input:not(.pad-input) #mobileGameplayMultiplayer::after{content:"P";margin-left:5px;padding:0 4px;border:1px solid #ffffff55;border-radius:3px;font:800 9px/1.3 system-ui,sans-serif}html body.desktop-input #mobileGameplayMultiplayer{width:auto!important;padding:0 8px!important}html body.pad-input #wantedEmpButton::after{content:"B"}html body.pad-input #airStrikeButton::after{content:"D-PAD ⬆"}
/* the last used device owns the help line: keys or pad */
html body.pad-input #desktopKeyHints{display:none!important}
/* pad: the dock shows the pad buttons instead of keys */
html body.pad-input #mobileGameplayDock button::after{display:inline-block;margin-left:6px;padding:1px 4px;border:1px solid #ffffff55;border-radius:3px;font:800 9px/1.2 system-ui,sans-serif;opacity:.85}html body.pad-input #mobileGameplayMode::after{content:"D-PAD ⬇"!important}html body.pad-input #mobileGameplayWeapon::after{content:"Y"!important}html body.pad-input #mobileGameplaySettings::after{content:"☰"!important}
body.desktop-input #mobileGameplayMode::after{content:"V"}body.desktop-input #mobileGameplayWeapon::after{content:"Q"}body.desktop-input #mobileGameplaySettings::after{content:"ESC"}
/* jet / car: the dock mode button means leave the vehicle */
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
  if(!playEl){playEl=document.createElement("div");playEl.id="desktopClickToPlay";playEl.innerHTML="CLICK TO PLAY<small>mouse + keyboard · ESC / TAB = menu</small>";v.appendChild(playEl);}
  return true;
}
const WEAPON_NAMES={smg:"SMG",glock:"PISTOL",grenade:"GRENADE LAUNCHER",gun:"GUN",missile:"MISSILE",nuke:"NUKE"};
function renderHints(){if(!ensureEls())return;if(desktop&&playerDown()){const t="DOWN · R / ENTER = RESPAWN";if(t!==lastHint){hintEl.textContent=t;lastHint=t;}return;}const mode=gameMode(),api=mode==="foot"?globalThis.__arondightFootWeapons:mode==="drone"?globalThis.__arondightDroneWeapons:null,w=api?WEAPON_NAMES[String(api.displayMode||api.mode)]||"":"",text=desktop?(w?`[ ${w} ]  `:"")+(HINTS[mode]||""):"";if(text!==lastHint){hintEl.textContent=text;lastHint=text;}}
// No "CLICK TO PLAY" wall: START and RESUME capture the mouse in the same click, losing it (ESC,
// alt-tab) opens the pause menu, and a stray click into the game captures it again.
function syncOverlay(){if(!ensureEls())return;renderHints();playEl.classList.remove("show");const v=viewport();if(v)v.dataset.pointerLock=locked()?"1":"0";}

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
  // ESC (the browser's own mouse release) opens the pause menu, like any shooter: no
  // "press ESC, then hunt for a button" dance. Closing the menu with a click captures the
  // mouse again right away.
  document.addEventListener("pointerlockchange",()=>{if(!locked()){lmb=false;rmb=false;droneFire(false);endLook();keys.clear();if(desktop&&inGame()&&!playerDown()&&!wantMenu&&!quietUnlock())setTimeout(()=>{if(!locked()&&inGame()&&!playerDown()&&!quietUnlock())globalThis.__arondightQuitConfirm?.open?.();},0); /* Esc releases the mouse: ask "back to the main menu?" (Tab / M open the menu) */}wantMenu=false;syncOverlay();});
  document.addEventListener("click",e=>{if(desktop&&e.target?.closest?.("#gameMenuStart"))requestLock();},true);
  document.addEventListener("close",e=>{if(desktop&&e.target?.matches?.("dialog.phone-settings-dialog")&&inGame())requestLock();},true);
  window.addEventListener("blur",releaseAll);
  /* death keeps the mouse captured: R / Enter (or Ⓐ) respawns after the countdown, no cursor in the picture */
  globalThis.__arondightDesktopDroneInput=droneSample;
  globalThis.__arondightDesktopInput={get active(){return desktop;},get locked(){return locked();},get mode(){return gameMode();},get lmb(){return lmb;},get rmb(){return rmb;},keys,takeMouseDelta(){const d={x:jetDelta.x,y:jetDelta.y};jetDelta.x=jetDelta.y=0;return d;},version:"desktop-mouse-keyboard-v1"};
  setInterval(tick,16);
}
installDesktopControls();
