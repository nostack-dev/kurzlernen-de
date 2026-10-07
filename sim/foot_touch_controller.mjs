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

export const FOOT_TOUCH_VERSION="single-owner-foot-touch-v1";
const PASS_SELECTOR="button,input,select,textarea,a,label,dialog,.phone-settings-dialog,#worldLookHud,#soloTopbar,#mobileGameplayDock,#gameExitButton,#soundSwitch,#installApp,#gameMenu,#wantedEmpButton,#vsRespawnHud";
const STICK_RADIUS=.42,SPRINT_AT=.9,LOOK_EDGE=.72,FIRE_INTERVAL_MS=72;

const pointers=new Map();let installed=false,loop=0,lastLoop=performance.now();
const walk=()=>globalThis.__arondightWalkMode||null;
const weapons=()=>globalThis.__arondightFootWeapons||null;
const viewport=()=>document.getElementById("viewport");
const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number(v)||0));
function active(){const w=walk();return w?.mode==="foot"&&!w.dead&&!globalThis.__arondightVehicleDrive?.active;}
function setData(key,value){const v=viewport();if(v){const s=String(value);if(v.dataset[key]!==s)v.dataset[key]=s;}}

function stickAxes(entry,x,y){const r=entry.rect,cx=r.left+r.width/2,cy=r.top+r.height/2,rad=Math.max(1,Math.min(r.width,r.height)*STICK_RADIUS);let ax=(x-cx)/rad,ay=(y-cy)/rad;const m=Math.hypot(ax,ay);if(m>1){ax/=m;ay/=m;}return{x:ax,y:ay,m:Math.min(1,m)};}
function paintKnob(entry,axes){const knob=entry.knob;if(!knob)return;knob.style.left=`${50+axes.x*31}%`;knob.style.top=`${50+axes.y*31}%`;}
function fire(x,y,source){window.dispatchEvent(new CustomEvent("arondight:foot-screen-fire-anchor",{detail:{clientX:x,clientY:y,source}}));return Boolean(weapons()?.fireAt?.({clientX:x,clientY:y,source}));}

function claim(event){event.preventDefault();event.stopImmediatePropagation();}
function onDown(event){
  if(event.pointerType==="mouse"||!active())return;
  const target=event.target instanceof Element?event.target:null;if(!target||!viewport()?.contains(target))return;
  if(target.closest(PASS_SELECTOR)&&!target.closest("#footMove,#footLook"))return;
  const now=performance.now(),move=target.closest("#footMove"),look=target.closest("#footLook");
  if(move){for(const e of pointers.values())if(e.kind==="move")return claim(event);const entry={kind:"move",el:move,rect:move.getBoundingClientRect(),knob:move.querySelector(".knob")};pointers.set(event.pointerId,entry);updateMove(entry,event.clientX,event.clientY);}
  else if(look){for(const e of pointers.values())if(e.kind==="look")return claim(event);const entry={kind:"look",el:look,rect:look.getBoundingClientRect(),knob:look.querySelector(".knob"),lastX:event.clientX,lastY:event.clientY,axes:{x:0,y:0,m:0}};pointers.set(event.pointerId,entry);walk()?.beginTouchLook?.("touch-stick");entry.axes=stickAxes(entry,event.clientX,event.clientY);paintKnob(entry,entry.axes);}
  else{const entry={kind:"fire",x:event.clientX,y:event.clientY,lastShot:now};pointers.set(event.pointerId,entry);fire(entry.x,entry.y,"screen-touch-hold-start");}
  setData("footTouch",FOOT_TOUCH_VERSION);setData("footTouchPointers",pointers.size);ensureLoop();claim(event);
}
function updateMove(entry,x,y){const axes=stickAxes(entry,x,y);entry.axes=axes;const sprint=axes.m>=SPRINT_AT&&axes.y<-.35;walk()?.setTouchMove?.(axes.x,axes.y,{sprint});paintKnob(entry,axes);entry.el.classList.toggle("sprinting",sprint);setData("walkTouchSprint",sprint?"1":"0");}
function onMove(event){
  const entry=pointers.get(event.pointerId);if(!entry)return;
  if(entry.kind==="move")updateMove(entry,event.clientX,event.clientY);
  else if(entry.kind==="look"){const samples=event.getCoalescedEvents?.()||[event];for(const s of samples){const dx=s.clientX-entry.lastX,dy=s.clientY-entry.lastY;entry.lastX=s.clientX;entry.lastY=s.clientY;if(dx||dy)walk()?.applyTouchLook?.({dx,dy,dt:1/60,now:Number(s.timeStamp)||performance.now(),source:"touch-stick-drag"});}entry.axes=stickAxes(entry,event.clientX,event.clientY);paintKnob(entry,entry.axes);}
  else{entry.x=event.clientX;entry.y=event.clientY;window.dispatchEvent(new CustomEvent("arondight:foot-aim",{detail:{clientX:entry.x,clientY:entry.y,phase:"move"}}));}
  claim(event);
}
function release(id,reason){
  const entry=pointers.get(id);if(!entry)return;pointers.delete(id);
  if(entry.kind==="move"){walk()?.setTouchMove?.(0,0,{sprint:false});paintKnob(entry,{x:0,y:0});entry.el.classList.remove("sprinting");setData("walkTouchSprint","0");}
  else if(entry.kind==="look"){walk()?.endTouchLook?.("touch-stick");paintKnob(entry,{x:0,y:0});}
  else window.dispatchEvent(new CustomEvent("arondight:foot-aim",{detail:{clientX:entry.x,clientY:entry.y,phase:"end"}}));
  setData("footTouchPointers",pointers.size);setData("footTouchLastRelease",reason);
}
function onUp(event){if(!pointers.has(event.pointerId))return;release(event.pointerId,event.type);claim(event);}
function releaseAll(reason){for(const id of[...pointers.keys()])release(id,reason);}

// Continuous work: edge-turn on the look stick and MP auto-fire.
function ensureLoop(){if(loop)return;lastLoop=performance.now();const tick=now=>{const dt=clamp((now-lastLoop)/1000,0,.05);lastLoop=now;
  if(!pointers.size||!active()){if(!active())releaseAll("mode-inactive");loop=0;return;}
  for(const entry of pointers.values()){
    if(entry.kind==="look"&&entry.axes.m>LOOK_EDGE){const k=(entry.axes.m-LOOK_EDGE)/(1-LOOK_EDGE),n=entry.axes.m||1;walk()?.applyTouchLookStick?.({x:entry.axes.x/n*k,y:entry.axes.y/n*k,dt,now,source:"touch-stick-edge"});}
    else if(entry.kind==="fire"&&String(weapons()?.mode||"")==="smg"&&now-entry.lastShot>=FIRE_INTERVAL_MS){entry.lastShot=now;fire(entry.x,entry.y,"screen-touch-hold-repeat");}
  }
  loop=requestAnimationFrame(tick);};loop=requestAnimationFrame(tick);}

export function installFootTouchController(){
  if(installed||typeof window==="undefined")return;installed=true;
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
