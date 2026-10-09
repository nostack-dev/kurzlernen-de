import {FPS_PITCH_LIMIT_RAD,fpsStickVelocity,fpsTouchLookDelta,shapeFpsStick,wrapFpsAngleRad} from "./fps_control_math.mjs";
import {normalizedPointer,endPointerDrag} from "./control_semantics.mjs";

const MOUSE_YAW_PER_PX=.0028;
const MOUSE_PITCH_PER_PX=.00235;
const RESERVED_SELECTOR="#worldLookHud,#footMove,#footWeaponToggle,#footFire,#soloTopbar,#wantedEmpButton,.solo-action,dialog,button,input,select,textarea,a,label";
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,Number(v)||0));

let installed=false,pointer=null,surface=null,captureEl=null,lastX=0,lastY=0,stickKnob=null,stickEl=null,stickX=0,stickY=0,aimYaw=0,aimPitch=0,stickFrameMs=performance.now(),lastInputMs=performance.now();

const viewport=()=>document.getElementById("viewport");
const walk=()=>globalThis.__arondightWalkMode||null;
const lookSurface=target=>{if(!(target instanceof Element))return null;if(target.closest("#footLook"))return"stick";if(target.closest("#footLookZone"))return"zone";return null;};
function reservedControlAt(event){
  if(!(event?.target instanceof Element))return false;
  if(event.target.closest("#footLook"))return false;
  if(event.target.closest(RESERVED_SELECTOR))return true;
  const stack=document.elementsFromPoint?.(Number(event.clientX)||0,Number(event.clientY)||0)||[];
  return stack.some(node=>node instanceof Element&&!node.closest("#footLook")&&Boolean(node.closest(RESERVED_SELECTOR)));
}
function currentAim(){const v=viewport();return{yaw:Number(v?.dataset.walkYaw)||0,pitch:Number(v?.dataset.walkPitch)||0};}
function syncAim(){const a=currentAim();aimYaw=a.yaw;aimPitch=a.pitch;}
function writeAim(yaw,pitch,mode){const w=walk(),v=viewport();if(w?.mode!=="foot"||!v)return false;aimYaw=Number(yaw)||0;aimPitch=clamp(pitch,-FPS_PITCH_LIMIT_RAD,FPS_PITCH_LIMIT_RAD);w.setPose?.({yaw:aimYaw,pitch:aimPitch});v.dataset.walkAimCapture="fps-authoritative-v14";v.dataset.walkLookInput=mode;v.dataset.walkAimEvents=String((Number(v.dataset.walkAimEvents)||0)+1);return true;}
function applyDelta(dx,dy,{mouse=false,now=performance.now()}={}){if(mouse)return writeAim(aimYaw+Number(dx||0)*MOUSE_YAW_PER_PX,aimPitch-Number(dy||0)*MOUSE_PITCH_PER_PX,"fps-pointerlock-raw-v12");const sampleMs=Number(now)||performance.now(),dt=clamp((sampleMs-lastInputMs)/1000,1/240,.05);lastInputMs=sampleMs;const w=walk(),profiled=w?.applyTouchLook?.({dx,dy,dt,now:sampleMs,source:"touch-drag"});if(profiled){aimYaw=profiled.yaw;aimPitch=profiled.pitch;const v=viewport();if(v){v.dataset.walkAimCapture="fps-authoritative-v14";v.dataset.walkLookInput="fps-touch-profiled-dynamic-v14";v.dataset.walkAimEvents=String((Number(v.dataset.walkAimEvents)||0)+1);}return true;}const delta=fpsTouchLookDelta(dx,dy);return writeAim(aimYaw+delta.yaw,aimPitch+delta.pitch,"fps-touch-dynamic-v14");}
function consume(event){event.preventDefault();event.stopImmediatePropagation();}
function fireScreen(clientX,clientY){
  const api=globalThis.__arondightFootWeapons;if(typeof api?.fireAt!=="function")return false;
  window.dispatchEvent(new CustomEvent("arondight:foot-screen-fire",{detail:{clientX,clientY,source:"touch-screen-pointerdown"}}));const fired=Boolean(api.fireAt({clientX,clientY,source:"touch-screen-pointerdown"}));const v=viewport();if(v){v.dataset.walkTouchTapRoute="authoritative-screen-pointerdown-v5";v.dataset.walkTouchFire="screen-point-raycast-v4";v.dataset.walkTouchFireResult=fired?"fired":"gated";}return fired;
}
function updateStick(event){
  const el=stickEl||document.getElementById("footLook");if(!el)return;const axes=normalizedPointer(el,event);stickX=axes.x;stickY=axes.y;if(stickKnob){stickKnob.style.left=`${50+stickX*42}%`;stickKnob.style.top=`${50+stickY*42}%`;}
  const v=viewport();if(v){v.dataset.walkAimStickX=stickX.toFixed(3);v.dataset.walkAimStickY=stickY.toFixed(3);v.dataset.walkAimStickCoordinates="drone-normalizedPointer-v2";}
}
function resetStick(){stickX=0;stickY=0;stickEl=null;if(stickKnob){stickKnob.style.left="50%";stickKnob.style.top="50%";}stickKnob=null;const v=viewport();if(v){v.dataset.walkAimStickX="0.000";v.dataset.walkAimStickY="0.000";}}
function releaseCapture(){if(captureEl&&pointer!==null){try{if(captureEl.hasPointerCapture?.(pointer))captureEl.releasePointerCapture?.(pointer);}catch{}}captureEl=null;}
function hardRelease(reason="release"){
  if(pointer===null)return false;const releasedSurface=surface,releasedPointer=pointer,releasedStick=stickEl;releaseCapture();if(releasedSurface==="stick"&&releasedStick)endPointerDrag(releasedStick,releasedPointer);pointer=null;surface=null;walk()?.endTouchLook?.(releasedSurface==="stick"?"touch-stick":"touch-drag");resetStick();const v=viewport();if(v){v.dataset.walkAimRelease=reason;v.dataset.walkTouchLookActive="0";}return true;
}
function stepStick(now){const dt=clamp((now-stickFrameMs)/1000,0,.04);stickFrameMs=now;if(pointer!==null&&surface==="stick"&&dt>0&&walk()?.mode==="foot"&&!walk()?.dead){const w=walk(),profiled=w?.applyTouchLookStick?.({x:stickX,y:stickY,dt,now,source:"touch-stick"});let yawRate=0;if(profiled){yawRate=wrapFpsAngleRad(profiled.yaw-aimYaw)/dt;aimYaw=profiled.yaw;aimPitch=profiled.pitch;}else{const shaped=shapeFpsStick(stickX,stickY),velocity=fpsStickVelocity(shaped,undefined,{touch:true});yawRate=velocity.yaw;writeAim(aimYaw+velocity.yaw*dt,aimPitch+velocity.pitch*dt,"fps-stick-precision-rate-v14");}const v=viewport();if(v){v.dataset.walkAimStickMode="rate-edge-hold-v5";v.dataset.walkAimStickRate=Math.abs(yawRate).toFixed(2);v.dataset.walkAimStickCurve="radial-precision-centre-fast-edge-v2";}}requestAnimationFrame(stepStick);}

export function installFootLookCapture(){
  if(installed)return;installed=true;
  window.addEventListener("pointerdown",event=>{
    if(walk()?.mode!=="foot"||walk()?.dead||pointer!==null||reservedControlAt(event))return;const nextSurface=lookSurface(event.target);if(!nextSurface)return;if(event.pointerType==="mouse"&&event.button!==0)return;syncAim();surface=nextSurface;
    if(event.pointerType==="mouse")return; // mouse + pointer lock: desktop_controls.mjs
    if(nextSurface==="zone"){
      fireScreen(event.clientX,event.clientY);surface=null;const v=viewport();if(v){v.dataset.walkAimTouch="screen-fire-only-v5";v.dataset.walkTouchOwnership="stick-origin-only+screen-fire-v2";}consume(event);return;
    }
    pointer=event.pointerId;captureEl=event.target instanceof Element?(event.target.closest("#footLook")||event.target):null;try{captureEl?.setPointerCapture?.(pointer);}catch{}lastX=event.clientX;lastY=event.clientY;lastInputMs=Number(event.timeStamp)||performance.now();walk()?.beginTouchLook?.("touch-stick");
    stickEl=captureEl||document.getElementById("footLook");stickKnob=stickEl?.querySelector(".knob")||null;stickFrameMs=performance.now();updateStick(event);const v=viewport();if(v){v.dataset.walkAimStickCapture="drone-normalizedPointer-v2";v.dataset.walkAimStickMode="rate-edge-hold-v5";}
    consume(event);
  },{capture:true,passive:false});
  window.addEventListener("pointermove",event=>{
    if(walk()?.mode!=="foot"||event.pointerId!==pointer)return;if(surface==="stick")updateStick(event);consume(event);
  },{capture:true,passive:false});
  const release=event=>{if(event.pointerId!==pointer)return;hardRelease(event.type);consume(event);};
  window.addEventListener("pointerup",release,{capture:true,passive:false});window.addEventListener("pointercancel",release,{capture:true,passive:false});window.addEventListener("lostpointercapture",event=>{if(event.pointerId===pointer)hardRelease("lostpointercapture");},true);addEventListener("blur",()=>hardRelease("window-blur"),true);addEventListener("pagehide",()=>hardRelease("pagehide"),true);document.addEventListener("visibilitychange",()=>{if(document.hidden)hardRelease("visibility-hidden");},true);
  document.addEventListener("pointerlockchange",()=>{if(document.pointerLockElement===viewport())syncAim();});window.addEventListener("contextmenu",event=>{if(walk()?.mode==="foot"&&viewport()?.contains(event.target))event.preventDefault();},{capture:true});
  const v=viewport();if(v){v.dataset.walkAimCapture="fps-authoritative-v15";v.dataset.walkAimStickMode="rate-edge-hold-v5";v.dataset.walkAimProfile="mouse-lock+screen-fire+drone-normalized-stick-v16";v.dataset.walkAimStickCurve="radial-precision-centre-fast-edge-v2";v.dataset.walkTouchTapRoute="authoritative-screen-pointerdown-v5";v.dataset.walkTouchOwnership="stick-origin-only+screen-fire-v2";}
  requestAnimationFrame(stepStick);
}

installFootLookCapture();
