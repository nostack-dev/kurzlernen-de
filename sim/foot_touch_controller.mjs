// Single owner for every on-foot touch (mobile). Imported first by the page
// bootstrap, so its capture listeners run before every other module; it
// claims each foot touch by pointerId from down to up and stops it there.
//
// Why: four modules used to process the same fingers (walk mode, two legacy
// touch layers and a lifecycle guard). They fought over setPointerCapture;
// a lost capture, a stray window blur or a mode event made one of them
// cancel the stick — you stopped walking or shooting mid-touch.
//
//  * MOVE stick (#footMove): radial axes, pushing to the rim sprints.
//  * LOOK stick (#footLook): CoD-Mobile style — the finger turns the view 1:1
//    in pixels from the first millimetre (no deadzone, never clamped at the
//    rim), fast swipes accelerate; held beyond the rim it keeps turning. It
//    also catches a thumb that lands a little outside the (near-invisible)
//    ring.
//  * Anywhere else on the view: fire exactly at the touch point; holding keeps
//    the MP firing, dragging moves the aim point with the finger.
// Robustness: a stick never stays "owned" by a finger that is gone — a new
// finger on it takes over, everything resets when no finger is on the glass,
// and a short blip of an inactive state (mode event, respawn) no longer drops
// a finger that is still down; a finger lost that way is picked up again on
// its next move.
// No setPointerCapture is used: window capture listeners already receive
// every move/up of a tracked pointer, so nothing can "steal" a finger.

import {normalizedPointer,endPointerDrag} from "./control_semantics.mjs";

export const FOOT_TOUCH_VERSION="single-owner-foot-touch-v5-akimbo-screen-halves";
export const FOOT_TOUCH_LOOK="cod-mobile-drag-look-v6";
const PASS_SELECTOR="button,input,select,textarea,a,label,dialog,.phone-settings-dialog,#worldLookHud,#soloTopbar,#mobileGameplayDock,#gameExitButton,#soundSwitch,#installApp,#gameMenu,#wantedEmpButton,#vsRespawnHud";
const STICK_RADIUS=.42,SPRINT_AT=.9,FIRE_INTERVAL_MS=55,GLOCK_HOLD_MS=170;
// look: edge-turn starts this far (px) beyond the stick radius and reaches full rate EDGE_RAMP_PX later;
// the drag origin is pulled along so letting the finger come back stops the turn at once
const EDGE_START=1.0,EDGE_RAMP_PX=70,CATCH_EXTRA_PX=64,INACTIVE_GRACE_MS=320;

const pointers=new Map();let installed=false,loop=0,lastLoop=performance.now(),nextPistolHand=0,inactiveSince=0;
const walk=()=>globalThis.__arondightWalkMode||null;
const weapons=()=>globalThis.__arondightFootWeapons||null;
const viewport=()=>document.getElementById("viewport");
const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number(v)||0));
function active(){const w=walk();return w?.mode==="foot"&&!w.dead&&!globalThis.__arondightVehicleDrive?.active&&!document.body.classList.contains("sticks-claimed");}
function setData(key,value){const v=viewport();if(v){const s=String(value);if(v.dataset[key]!==s)v.dataset[key]=s;}}

// Stick axes via the shared helper: it accounts for the CSS quarter turn used
// in portrait (css-landscape), so "up" on screen is always forward.
function stickAxes(entry,event){const a=normalizedPointer(entry.el,event),m=Math.min(1,Math.hypot(a.x,a.y));return{x:a.x,y:a.y,m};}
function rotated(){return viewport()?.dataset.soloOrientation==="css-landscape";}
// screen px -> the game's logical px (portrait plays a CSS quarter-turned landscape)
function logical(dx,dy){return rotated()?{x:dy,y:-dx}:{x:dx,y:dy};}
function stickRadiusPx(entry){return Math.max(1,Math.min(entry.rect.width,entry.rect.height)*STICK_RADIUS);}
function centreOf(el){const r=el?.getBoundingClientRect?.();return r&&r.width>0?{x:r.left+r.width/2,y:r.top+r.height/2,r:Math.min(r.width,r.height)/2}:null;}
// a thumb that lands near a (near-invisible) stick belongs to it
function stickNear(x,y){let best=null,bestD=Infinity;for(const id of["footLook","footMove"]){const el=document.getElementById(id);if(!el||!el.offsetParent)continue;const c=centreOf(el);if(!c)continue;const d=Math.hypot(x-c.x,y-c.y);if(d<=c.r+CATCH_EXTRA_PX&&d<bestD){bestD=d;best=el;}}return best;}
function startLook(el,event){const entry={kind:"look",el,rect:el.getBoundingClientRect(),knob:el.querySelector(".knob"),ox:event.clientX,oy:event.clientY,lx:event.clientX,ly:event.clientY,lt:Number(event.timeStamp)||performance.now(),axes:{x:0,y:0,m:0}};walk()?.beginTouchLook?.("touch-stick");paintKnob(entry,entry.axes);return entry;}
function startMove(el,event){const entry={kind:"move",el,rect:el.getBoundingClientRect(),knob:el.querySelector(".knob")};updateMove(entry,event);return entry;}
// 1:1 drag look shared by the look stick and a dragged fire finger
function dragLook(entry,event,source){const t=Number(event.timeStamp)||performance.now(),d=logical(event.clientX-entry.lx,event.clientY-entry.ly),dtMs=Math.max(1,t-entry.lt);entry.lx=event.clientX;entry.ly=event.clientY;entry.lt=t;if(!d.x&&!d.y)return;
  walk()?.applyTouchLook?.({dx:d.x,dy:d.y,dt:clamp(dtMs/1000,1/240,.05),speedPxS:Math.hypot(d.x,d.y)/dtMs*1000,now:t,source});}
function lookOffset(entry,event){const R=stickRadiusPx(entry);let o=logical(event.clientX-entry.ox,event.clientY-entry.oy),dist=Math.hypot(o.x,o.y);const cap=R*EDGE_START+EDGE_RAMP_PX;
  if(dist>cap){const pull=(dist-cap)/dist,sx=event.clientX-entry.ox,sy=event.clientY-entry.oy;entry.ox+=sx*pull;entry.oy+=sy*pull;o={x:o.x*(1-pull),y:o.y*(1-pull)};dist=cap;}
  entry.axes={x:o.x/R,y:o.y/R,m:dist/R,edge:clamp((dist-R*EDGE_START)/EDGE_RAMP_PX,0,1)};const shown=Math.min(1,entry.axes.m)/(entry.axes.m||1);paintKnob(entry,{x:entry.axes.x*shown,y:entry.axes.y*shown});}
function dropOther(kind,except){for(const[id,e]of pointers)if(e.kind===kind&&id!==except)release(id,"taken-over");}
function paintKnob(entry,axes){const knob=entry.knob;if(!knob)return;knob.style.left=`${50+axes.x*31}%`;knob.style.top=`${50+axes.y*31}%`;}
// at: the round's due time (hold cadence) so a long frame fires the rounds that fell due in it
function fire(x,y,source,hand=0,at=null){window.dispatchEvent(new CustomEvent("arondight:foot-screen-fire-anchor",{detail:{clientX:x,clientY:y,source,hand}}));return Boolean(weapons()?.fireAt?.({clientX:x,clientY:y,source,hand,at}));}
function fireHands(){return[...pointers.values()].filter(e=>e.kind==="fire").map(e=>e.hand);}
// Dual Glocks: the left half of the screen is the left pistol, the right half
// the right pistol — each finger aims and fires its own gun, alone,
// alternating or both at once.
function screenSide(x,y){const v=viewport(),r=v?.getBoundingClientRect();if(!r)return 0;const rotated=v.dataset.soloOrientation==="css-landscape",lx=rotated?y-r.top:x-r.left,w=rotated?r.height:r.width;return lx<w/2?1:0;}
// one Glock: always the right hand. Fists: the half of the screen picks the hand — left thumb
// throws the left, right thumb the right; both thumbs box independently (multitouch).
function chooseFireHand(x,y){return String(weapons()?.mode||"")==="fists"?screenSide(x,y):0;}

function claim(event){event.preventDefault();event.stopImmediatePropagation();}
// EMP works in every mode and wins over any overlay or later handler: if the
// EMP button is anywhere in the hit stack of a touch, trigger it directly.
function empAt(event){
  const button=document.getElementById("wantedEmpButton");if(!button||button.hidden||getComputedStyle(button).display==="none")return false;
  const r=button.getBoundingClientRect();if(!(event.clientX>=r.left&&event.clientX<=r.right&&event.clientY>=r.top&&event.clientY<=r.bottom))return false;
  const api=globalThis.__arondightWantedSystem;if(typeof api?.triggerEmp!=="function")return false;
  const result=api.triggerEmp(),v=viewport();if(v){v.dataset.mobileEmpRoute="wanted-api-direct-v1";v.dataset.mobileEmpResult=result?.activated?"activated":String(result?.reason||"gated");v.dataset.mobileEmpAffected=String(Number(result?.affected)||0);}
  return true;
}
function onDown(event){
  if(event.pointerType!=="mouse"&&(navigator.maxTouchPoints||0)>0&&empAt(event))return claim(event);
  if(event.pointerType==="mouse"||!active())return;
  const target=event.target instanceof Element?event.target:null;if(!target||!viewport()?.contains(target))return;
  if(target.closest(PASS_SELECTOR)&&!target.closest("#footMove,#footLook"))return;
  const now=performance.now(),near=target.closest("#footMove,#footLook")||(target.closest(PASS_SELECTOR)?null:stickNear(event.clientX,event.clientY)),move=near?.id==="footMove"?near:null,look=near?.id==="footLook"?near:null;
  // newest finger on a stick takes it over: a finger whose "up" got lost can never block the stick
  if(move){dropOther("move",event.pointerId);pointers.set(event.pointerId,startMove(move,event));}
  else if(look){dropOther("look",event.pointerId);pointers.set(event.pointerId,startLook(look,event));setData("walkTouchLookModel",FOOT_TOUCH_LOOK);}
  else{const hand=chooseFireHand(event.clientX,event.clientY);if(hand<0){setData("walkGlockExtraTouch","ignored-third-fire-pointer");return claim(event);}const entry={kind:"fire",x:event.clientX,y:event.clientY,sx:event.clientX,sy:event.clientY,lastShot:now,hand};pointers.set(event.pointerId,entry);fire(entry.x,entry.y,"screen-touch-hold-start",entry.hand);setData("walkFirePointerActive","1");ensureHoldTimer();setData("walkFirePointerId",event.pointerId);setData("walkFireHand",entry.hand);setData("walkFireHands",fireHands().join(","));setData("walkGlockTriggerModel","screen-half-owns-pistol-v4");setData("walkHoldFire","screen-pointer-owned-smg-v1");setData("walkScreenTouch","fire-only-v1");}
  // Keep the established input contracts that the live regression checks.
  setData("walkTouchContract","drone-normalized-pointer-origin-v2");setData("walkStickSemantics","drone-normalizedPointer-v1");setData("walkMultiTouchMoveIsolation","pointer-id-owned-v1");setData("walkAimStickCoordinates","drone-normalizedPointer-v2");setData("walkWeaponTouchVector","screen-ray+hand-anchor-v1");
  {const e=pointers.get(event.pointerId);if(e&&(e.kind==="move"||e.kind==="look"))e.el.classList.add("stick-live");}
  setData("footTouch",FOOT_TOUCH_VERSION);setData("footTouchPointers",pointers.size);ensureLoop();claim(event);
}
function updateMove(entry,event){const axes=stickAxes(entry,event);entry.axes=axes;const sprint=axes.m>=SPRINT_AT&&axes.y<-.35;walk()?.setTouchMove?.(axes.x,axes.y,{sprint});paintKnob(entry,axes);entry.el.classList.toggle("sprinting",sprint);setData("walkTouchSprint",sprint?"1":"0");}
function onMove(event){
  let entry=pointers.get(event.pointerId);
  // re-adopt a stick finger that was dropped while it stayed on the glass (touch targets stay on the element the finger went down on)
  if(!entry){if(event.pointerType==="mouse"||!active())return;const t=event.target instanceof Element?event.target.closest("#footMove,#footLook"):null;if(!t)return;dropOther(t.id==="footLook"?"look":"move",event.pointerId);entry=t.id==="footLook"?startLook(t,event):startMove(t,event);pointers.set(event.pointerId,entry);t.classList.add("stick-live");setData("footTouchReadopted",(Number(viewport()?.dataset.footTouchReadopted)||0)+1);ensureLoop();return claim(event);}
  if(entry.kind==="move")updateMove(entry,event);
  else if(entry.kind==="look"){dragLook(entry,event,"touch-stick-drag");lookOffset(entry,event);}
  else{
    // the round always goes exactly where the finger is: dragging a fire finger moves the aim point with it
    entry.x=event.clientX;entry.y=event.clientY;window.dispatchEvent(new CustomEvent("arondight:foot-aim",{detail:{clientX:entry.x,clientY:entry.y,phase:"move",hand:entry.hand}}));}
  claim(event);
}
function release(id,reason){
  const entry=pointers.get(id);if(!entry)return;pointers.delete(id);
  if(entry.kind==="move"||entry.kind==="look"){endPointerDrag(entry.el,id);entry.el.classList.remove("stick-live");}
  if(entry.kind==="move"){walk()?.setTouchMove?.(0,0,{sprint:false});paintKnob(entry,{x:0,y:0});entry.el.classList.remove("sprinting");setData("walkTouchSprint","0");}
  else if(entry.kind==="look"){if(!stillLooking())walk()?.endTouchLook?.("touch-stick");paintKnob(entry,{x:0,y:0});}
  else{window.dispatchEvent(new CustomEvent("arondight:foot-aim",{detail:{clientX:entry.x,clientY:entry.y,phase:"end",hand:entry.hand}}));const hands=fireHands();setData("walkFirePointerActive",hands.length?"1":"0");setData("walkFireHands",hands.join(","));setData("walkFirePointerRelease",reason);}
  setData("footTouchPointers",pointers.size);setData("footTouchLastRelease",reason);
}
function stillLooking(){for(const e of pointers.values())if(e.kind==="look")return true;return false;}
function onUp(event){if(!pointers.has(event.pointerId))return;release(event.pointerId,event.type);claim(event);}
function releaseAll(reason){for(const id of[...pointers.keys()])release(id,reason);nextPistolHand=0;}

// Held fire (MP full-auto, Glock repeat). Driven by the frame loop AND a 25 ms timer: on a device
// (or a CI browser) whose frames stall, the timer keeps the cadence; both share entry.lastShot,
// so a round is never fired twice.
function holdFire(now){if(!active())return;const mode=String(weapons()?.mode||"");for(const entry of pointers.values()){if(entry.kind!=="fire")continue;
  if(mode==="smg"){
    // Fire rate is independent of the frame rate: catch up on missed
    // intervals (bounded) so a slow frame doesn't throttle the MP.
    let n=0;while(now-entry.lastShot>=FIRE_INTERVAL_MS&&n<4){entry.lastShot+=FIRE_INTERVAL_MS;n++;fire(entry.x,entry.y,"screen-touch-hold-repeat",entry.hand,entry.lastShot);}
    if(now-entry.lastShot>=FIRE_INTERVAL_MS)entry.lastShot=now;}
  else if(mode==="glock"&&now-entry.lastShot>=GLOCK_HOLD_MS){entry.lastShot=now;fire(entry.x,entry.y,"screen-touch-hold-repeat",entry.hand);}}}
let holdTimer=0;function ensureHoldTimer(){if(holdTimer)return;holdTimer=setInterval(()=>{if(![...pointers.values()].some(e=>e.kind==="fire")){clearInterval(holdTimer);holdTimer=0;return;}holdFire(performance.now());},25);}
// Continuous work: edge-turn on the look stick and MP auto-fire.
function ensureLoop(){if(loop)return;lastLoop=performance.now();const tick=now=>{const dt=clamp((now-lastLoop)/1000,0,.05);lastLoop=now;
  // a blip of "inactive" (mode event, respawn frame) must not drop fingers that are still down
  if(!active()){inactiveSince=inactiveSince||now;if(now-inactiveSince>=INACTIVE_GRACE_MS||!pointers.size){releaseAll("mode-inactive");loop=0;return;}loop=requestAnimationFrame(tick);return;}inactiveSince=0;
  if(!pointers.size){loop=0;return;}
  for(const entry of pointers.values()){
    if(entry.kind==="look"&&entry.axes.edge>0){const k=entry.axes.edge,n=entry.axes.m||1;walk()?.applyTouchLookStick?.({x:entry.axes.x/n*k,y:entry.axes.y/n*k,dt,now,source:"touch-stick-edge"});}
  }
  holdFire(now);
  loop=requestAnimationFrame(tick);};loop=requestAnimationFrame(tick);}

export function installFootTouchController(){
  if(installed||typeof window==="undefined")return;installed=true;
  const mark=()=>{const v=viewport();if(!v)return requestAnimationFrame(mark);setData("walkTouchContract","drone-normalized-pointer-origin-v2");setData("footTouch",FOOT_TOUCH_VERSION);};mark();
  window.addEventListener("pointerdown",onDown,{capture:true,passive:false});
  window.addEventListener("pointermove",onMove,{capture:true,passive:false});
  window.addEventListener("pointerup",onUp,{capture:true,passive:false});
  window.addEventListener("pointercancel",onUp,{capture:true,passive:false});
  // Only a real interruption ends the touches (app switch / page hide); a
  // spurious window blur or lost pointer capture no longer does.
  document.addEventListener("visibilitychange",()=>{if(document.hidden)releaseAll("hidden");});
  // ground truth: no finger on the glass means no finger is down, whatever events got lost
  const sweep=e=>{if((e.touches?.length||0)===0&&pointers.size)releaseAll("no-touches");};
  window.addEventListener("touchend",sweep,{capture:true,passive:true});window.addEventListener("touchcancel",sweep,{capture:true,passive:true});
  window.addEventListener("pagehide",()=>releaseAll("pagehide"));
  // Browser gestures (scroll, zoom, callout) must never cancel a stick.
  const style=document.createElement("style");style.dataset.footTouch=FOOT_TOUCH_VERSION;
  style.textContent=`body.on-foot-mode #viewport,body.on-foot-mode #viewport *{touch-action:none!important;-webkit-touch-callout:none!important;-webkit-user-select:none!important;user-select:none!important}
#footMove.sprinting .ring{border-color:#00ff9c!important;box-shadow:0 0 14px rgba(0,255,156,.55)!important}`;
  (document.head||document.documentElement).appendChild(style);
}
installFootTouchController();
