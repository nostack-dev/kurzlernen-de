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
//  * LOOK stick (#footLook): drag turns directly (like dragging the view),
//    holding past the rim keeps turning — no more slow, rate-only aiming.
//  * Anywhere else on the view: fire at the touch point; holding keeps the
//    MP firing, dragging moves the aim (the gun follows).
// No setPointerCapture is used: window capture listeners already receive
// every move/up of a tracked pointer, so nothing can "steal" a finger.

import {normalizedPointer,endPointerDrag} from "./control_semantics.mjs";

export const FOOT_TOUCH_VERSION="single-owner-foot-touch-v2";
const PASS_SELECTOR="button,input,select,textarea,a,label,dialog,.phone-settings-dialog,#worldLookHud,#soloTopbar,#mobileGameplayDock,#gameExitButton,#soundSwitch,#installApp,#gameMenu,#wantedEmpButton,#vsRespawnHud";
const STICK_RADIUS=.42,SPRINT_AT=.9,LOOK_EDGE=.72,FIRE_INTERVAL_MS=72;

const pointers=new Map();let installed=false,loop=0,lastLoop=performance.now();
const walk=()=>globalThis.__arondightWalkMode||null;
const weapons=()=>globalThis.__arondightFootWeapons||null;
const viewport=()=>document.getElementById("viewport");
const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number(v)||0));
function active(){const w=walk();return w?.mode==="foot"&&!w.dead&&!globalThis.__arondightVehicleDrive?.active;}
function setData(key,value){const v=viewport();if(v){const s=String(value);if(v.dataset[key]!==s)v.dataset[key]=s;}}

// Stick axes via the shared helper: it accounts for the CSS quarter turn used
// in portrait (css-landscape), so "up" on screen is always forward.
function stickAxes(entry,event){const a=normalizedPointer(entry.el,event),m=Math.min(1,Math.hypot(a.x,a.y));return{x:a.x,y:a.y,m};}
function paintKnob(entry,axes){const knob=entry.knob;if(!knob)return;knob.style.left=`${50+axes.x*31}%`;knob.style.top=`${50+axes.y*31}%`;}
function fire(x,y,source){window.dispatchEvent(new CustomEvent("arondight:foot-screen-fire-anchor",{detail:{clientX:x,clientY:y,source}}));return Boolean(weapons()?.fireAt?.({clientX:x,clientY:y,source}));}

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
  const now=performance.now(),move=target.closest("#footMove"),look=target.closest("#footLook");
  if(move){for(const e of pointers.values())if(e.kind==="move")return claim(event);const entry={kind:"move",el:move,rect:move.getBoundingClientRect(),knob:move.querySelector(".knob")};pointers.set(event.pointerId,entry);updateMove(entry,event);}
  else if(look){for(const e of pointers.values())if(e.kind==="look")return claim(event);const entry={kind:"look",el:look,rect:look.getBoundingClientRect(),knob:look.querySelector(".knob"),axes:{x:0,y:0,m:0}};pointers.set(event.pointerId,entry);walk()?.beginTouchLook?.("touch-stick");entry.axes=stickAxes(entry,event);paintKnob(entry,entry.axes);}
  else{const entry={kind:"fire",x:event.clientX,y:event.clientY,lastShot:now};pointers.set(event.pointerId,entry);fire(entry.x,entry.y,"screen-touch-hold-start");setData("walkFirePointerActive","1");setData("walkFirePointerId",event.pointerId);setData("walkHoldFire","screen-pointer-owned-smg-v1");setData("walkScreenTouch","fire-only-v1");}
  // Keep the established input contracts that the live regression checks.
  setData("walkTouchContract","drone-normalized-pointer-origin-v2");setData("walkStickSemantics","drone-normalizedPointer-v1");setData("walkMultiTouchMoveIsolation","pointer-id-owned-v1");setData("walkAimStickCoordinates","drone-normalizedPointer-v2");setData("walkWeaponTouchVector","screen-ray+hand-anchor-v1");
  setData("footTouch",FOOT_TOUCH_VERSION);setData("footTouchPointers",pointers.size);ensureLoop();claim(event);
}
function updateMove(entry,event){const axes=stickAxes(entry,event);entry.axes=axes;const sprint=axes.m>=SPRINT_AT&&axes.y<-.35;walk()?.setTouchMove?.(axes.x,axes.y,{sprint});paintKnob(entry,axes);entry.el.classList.toggle("sprinting",sprint);setData("walkTouchSprint",sprint?"1":"0");}
function onMove(event){
  const entry=pointers.get(event.pointerId);if(!entry)return;
  if(entry.kind==="move")updateMove(entry,event);
  else if(entry.kind==="look"){
    // Drag turns directly: the change of the (rotation-aware) stick axes,
    // converted back to pixels, feeds the same profiled touch-look as a drag.
    const prev=entry.axes,next=stickAxes(entry,event),rad=Math.max(1,Math.min(entry.rect.width,entry.rect.height)*STICK_RADIUS),dx=(next.x-prev.x)*rad,dy=(next.y-prev.y)*rad;
    if(dx||dy)walk()?.applyTouchLook?.({dx,dy,dt:1/60,now:Number(event.timeStamp)||performance.now(),source:"touch-stick-drag"});entry.axes=next;paintKnob(entry,next);}
  else{entry.x=event.clientX;entry.y=event.clientY;window.dispatchEvent(new CustomEvent("arondight:foot-aim",{detail:{clientX:entry.x,clientY:entry.y,phase:"move"}}));}
  claim(event);
}
function release(id,reason){
  const entry=pointers.get(id);if(!entry)return;pointers.delete(id);
  if(entry.kind==="move"||entry.kind==="look")endPointerDrag(entry.el,id);
  if(entry.kind==="move"){walk()?.setTouchMove?.(0,0,{sprint:false});paintKnob(entry,{x:0,y:0});entry.el.classList.remove("sprinting");setData("walkTouchSprint","0");}
  else if(entry.kind==="look"){walk()?.endTouchLook?.("touch-stick");paintKnob(entry,{x:0,y:0});}
  else{window.dispatchEvent(new CustomEvent("arondight:foot-aim",{detail:{clientX:entry.x,clientY:entry.y,phase:"end"}}));setData("walkFirePointerActive","0");setData("walkFirePointerRelease",reason);}
  setData("footTouchPointers",pointers.size);setData("footTouchLastRelease",reason);
}
function onUp(event){if(!pointers.has(event.pointerId))return;release(event.pointerId,event.type);claim(event);}
function releaseAll(reason){for(const id of[...pointers.keys()])release(id,reason);}

// Continuous work: edge-turn on the look stick and MP auto-fire.
function ensureLoop(){if(loop)return;lastLoop=performance.now();const tick=now=>{const dt=clamp((now-lastLoop)/1000,0,.05);lastLoop=now;
  if(!pointers.size||!active()){if(!active())releaseAll("mode-inactive");loop=0;return;}
  for(const entry of pointers.values()){
    if(entry.kind==="look"&&entry.axes.m>LOOK_EDGE){const k=(entry.axes.m-LOOK_EDGE)/(1-LOOK_EDGE),n=entry.axes.m||1;walk()?.applyTouchLookStick?.({x:entry.axes.x/n*k,y:entry.axes.y/n*k,dt,now,source:"touch-stick-edge"});}
    else if(entry.kind==="fire"&&String(weapons()?.mode||"")==="smg"){
      // Fire rate is independent of the frame rate: catch up on missed
      // intervals (bounded) so a slow frame doesn't throttle the MP.
      let n=0;while(now-entry.lastShot>=FIRE_INTERVAL_MS&&n<4){entry.lastShot+=FIRE_INTERVAL_MS;n++;fire(entry.x,entry.y,"screen-touch-hold-repeat");}
      if(now-entry.lastShot>=FIRE_INTERVAL_MS)entry.lastShot=now;}
  }
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
  window.addEventListener("pagehide",()=>releaseAll("pagehide"));
  // Browser gestures (scroll, zoom, callout) must never cancel a stick.
  const style=document.createElement("style");style.dataset.footTouch=FOOT_TOUCH_VERSION;
  style.textContent=`body.on-foot-mode #viewport,body.on-foot-mode #viewport *{touch-action:none!important;-webkit-touch-callout:none!important;-webkit-user-select:none!important;user-select:none!important}
#footMove.sprinting .ring{border-color:#00ff9c!important;box-shadow:0 0 14px rgba(0,255,156,.55)!important}`;
  (document.head||document.documentElement).appendChild(style);
}
installFootTouchController();
