import {FPS_PITCH_LIMIT_RAD,fpsStickVelocity,shapeFpsStick,wrapFpsAngleRad} from "./fps_control_math.mjs";

const MOUSE_YAW_PER_PX=.0028;
const MOUSE_PITCH_PER_PX=.00235;
const SCREEN_PISTOL_AUTOFIRE_MS=195;
const SCREEN_SMG_AUTOFIRE_MS=228;
const RESERVED_SELECTOR="#footMove,#footWeaponToggle,#footFire,#soloTopbar,#wantedEmpButton,.solo-action,dialog,button,input,select,textarea,a,label";
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,Number(v)||0));

let installed=false,pointer=null,captureEl=null,stickKnob=null,stickEl=null,stickX=0,stickY=0,aimYaw=0,aimPitch=0,stickFrameMs=performance.now();
let screenPointer=null,screenCaptureEl=null,screenX=0,screenY=0,screenLastX=0,screenLastY=0,screenLastMs=0,lastScreenFireAt=-Infinity;

const viewport=()=>document.getElementById("viewport");
const walk=()=>globalThis.__arondightWalkMode||null;
const footWeapons=()=>globalThis.__arondightFootWeapons||null;
function reservedControlAt(event){
  if(!(event?.target instanceof Element))return false;
  if(event.target.closest("#footLook"))return false;
  if(event.target.closest(RESERVED_SELECTOR))return true;
  const stack=document.elementsFromPoint?.(Number(event.clientX)||0,Number(event.clientY)||0)||[];
  return stack.some(node=>node instanceof Element&&!node.closest("#footLook")&&Boolean(node.closest(RESERVED_SELECTOR)));
}
function currentAim(){const v=viewport();return{yaw:Number(v?.dataset.walkYaw)||0,pitch:Number(v?.dataset.walkPitch)||0};}
function syncAim(){const a=currentAim();aimYaw=a.yaw;aimPitch=a.pitch;}
function writeAim(yaw,pitch,mode){const w=walk(),v=viewport();if(w?.mode!=="foot"||!v)return false;aimYaw=Number(yaw)||0;aimPitch=clamp(pitch,-FPS_PITCH_LIMIT_RAD,FPS_PITCH_LIMIT_RAD);w.setPose?.({yaw:aimYaw,pitch:aimPitch});v.dataset.walkAimCapture="fps-authoritative-v15";v.dataset.walkLookInput=mode;v.dataset.walkAimEvents=String((Number(v.dataset.walkAimEvents)||0)+1);return true;}
function consume(event){event.preventDefault();event.stopImmediatePropagation();}
function logicalPoint(clientX,clientY){
  const view=viewport(),screen=view?.getBoundingClientRect();if(!view||!screen)return null;
  const width=Math.max(1,view.clientWidth),height=Math.max(1,view.clientHeight),cx=Number.isFinite(clientX)?clientX:screen.left+screen.width/2,cy=Number.isFinite(clientY)?clientY:screen.top+screen.height/2,rotated=view.dataset.soloOrientation==="css-landscape",x=rotated?cy-screen.top:cx-screen.left,y=rotated?screen.right-cx:cy-screen.top;
  return{x:clamp(x,0,width),y:clamp(y,0,height),width,height};
}
function centerClientPoint(){
  const view=viewport(),screen=view?.getBoundingClientRect();if(!view||!screen)return null;const width=Math.max(1,view.clientWidth),height=Math.max(1,view.clientHeight),rotated=view.dataset.soloOrientation==="css-landscape";
  if(rotated)return{clientX:clamp(screen.right-height*.5,screen.left,screen.right),clientY:clamp(screen.top+width*.5,screen.top,screen.bottom),x:width*.5,y:height*.5,width,height};
  return{clientX:screen.left+screen.width*.5,clientY:screen.top+screen.height*.5,x:width*.5,y:height*.5,width,height};
}
function applyScreenLook(clientX,clientY,timeStamp=performance.now()){
  const w=walk();if(screenPointer===null||w?.mode!=="foot"||w?.dead)return false;const now=Number(timeStamp)||performance.now(),dx=Number(clientX)-screenLastX,dy=Number(clientY)-screenLastY,dt=clamp((now-screenLastMs)/1000,1/240,.05);screenLastX=Number(clientX);screenLastY=Number(clientY);screenLastMs=now;if(!dx&&!dy)return false;
  const profiled=w.applyTouchLook?.({dx,dy,dt,now,source:"touch-ads-drag"});if(profiled){aimYaw=profiled.yaw;aimPitch=profiled.pitch;}else writeAim(aimYaw+dx*MOUSE_YAW_PER_PX,aimPitch-dy*MOUSE_PITCH_PER_PX,"fps-touch-ads-fallback-v1");
  const v=viewport();if(v){v.dataset.walkLookInput="touch-ads-camera-drag-v1";v.dataset.walkAdsDragDelta=`${dx.toFixed(1)},${dy.toFixed(1)}`;v.dataset.walkAdsDragEvents=String((Number(v.dataset.walkAdsDragEvents)||0)+1);}return true;
}
function publishScreenAim(clientX,clientY,source="touch-screen-drag"){
  screenX=Number.isFinite(Number(clientX))?Number(clientX):screenX;screenY=Number.isFinite(Number(clientY))?Number(clientY):screenY;const point=centerClientPoint(),reticle=document.getElementById("footReticle"),v=viewport();
  if(point&&reticle){reticle.style.left="50%";reticle.style.top="50%";reticle.classList.add("screen-aim-active");}
  document.body.classList.add("foot-ads-active");
  if(v){v.dataset.walkScreenAimActive="1";v.dataset.walkScreenAimPoint=point?`${point.x.toFixed(1)},${point.y.toFixed(1)}`:"";v.dataset.walkScreenAimRaw=logicalPoint(screenX,screenY)?`${logicalPoint(screenX,screenY).x.toFixed(1)},${logicalPoint(screenX,screenY).y.toFixed(1)}`:"";v.dataset.walkScreenAimSource=source;v.dataset.walkAimTouch="ads-camera-drag-autofire-v7";v.dataset.walkScreenAimContract="ads-centered-sights+camera-drag+center-hitscan-v2";}
  if(point)window.dispatchEvent(new CustomEvent("arondight:foot-screen-aim",{detail:{clientX:point.clientX,clientY:point.clientY,rawClientX:screenX,rawClientY:screenY,source,active:true}}));return point;
}
function fireScreen(source="touch-screen-pointerdown"){
  const api=footWeapons(),point=centerClientPoint();if(typeof api?.fireAt!=="function"||!point)return false;window.dispatchEvent(new CustomEvent("arondight:foot-screen-fire",{detail:{clientX:point.clientX,clientY:point.clientY,rawClientX:screenX,rawClientY:screenY,source}}));const fired=Boolean(api.fireAt({clientX:point.clientX,clientY:point.clientY,source})),v=viewport();
  if(v){v.dataset.walkTouchTapRoute="authoritative-ads-drag-hold-v7";v.dataset.walkTouchFire="screen-center-raycast-ads-v6";v.dataset.walkTouchFireResult=fired?"fired":"gated";v.dataset.walkAimTouch="ads-camera-drag-autofire-v7";v.dataset.walkAutoFire="hold-screen-v1";if(fired)v.dataset.walkAutoFireBursts=String((Number(v.dataset.walkAutoFireBursts)||0)+1);}return fired;
}
function screenFireCadenceMs(){return String(footWeapons()?.mode||"pistol")==="smg"?SCREEN_SMG_AUTOFIRE_MS:SCREEN_PISTOL_AUTOFIRE_MS;}
function beginScreenAim(event,target){
  if(screenPointer!==null)return false;syncAim();screenPointer=event.pointerId;screenCaptureEl=target;screenX=screenLastX=event.clientX;screenY=screenLastY=event.clientY;screenLastMs=Number(event.timeStamp)||performance.now();try{screenCaptureEl?.setPointerCapture?.(screenPointer);}catch{}walk()?.beginTouchLook?.("touch-ads-drag");publishScreenAim(screenX,screenY,"touch-screen-pointerdown");lastScreenFireAt=performance.now();fireScreen("touch-screen-pointerdown");const v=viewport();if(v){v.dataset.walkScreenAimPointer=String(screenPointer);v.dataset.walkScreenAimRelease="held";v.dataset.walkAdsMode="kimme-korn-centered-v1";}return true;
}
function clearScreenAim(reason="release"){
  if(screenPointer===null)return false;const oldPointer=screenPointer;try{if(screenCaptureEl?.hasPointerCapture?.(oldPointer))screenCaptureEl.releasePointerCapture?.(oldPointer);}catch{}screenPointer=null;screenCaptureEl=null;walk()?.endTouchLook?.("touch-ads-drag");document.body.classList.remove("foot-ads-active");
  const reticle=document.getElementById("footReticle");if(reticle){reticle.classList.remove("screen-aim-active");reticle.style.left="50%";reticle.style.top="50%";}
  const v=viewport();if(v){v.dataset.walkScreenAimActive="0";v.dataset.walkScreenAimPointer="";v.dataset.walkScreenAimRelease=reason;v.dataset.walkAdsMode="hip";}
  const point=centerClientPoint();window.dispatchEvent(new CustomEvent("arondight:foot-screen-aim",{detail:{clientX:point?.clientX??screenX,clientY:point?.clientY??screenY,source:reason,active:false}}));return true;
}
function updateStick(clientX,clientY){
  const el=stickEl||document.getElementById("footLook");if(!el)return;const r=el.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2,rad=Math.max(1,r.width*.38);let x=(Number(clientX)-cx)/rad,y=(Number(clientY)-cy)/rad,mag=Math.hypot(x,y);if(mag>1){x/=mag;y/=mag;}stickX=x;stickY=y;if(stickKnob){stickKnob.style.left=`${50+x*31}%`;stickKnob.style.top=`${50+y*31}%`;}const v=viewport();if(v){v.dataset.walkAimStickX=stickX.toFixed(3);v.dataset.walkAimStickY=stickY.toFixed(3);}
}
function resetStick(){stickX=0;stickY=0;stickEl=null;if(stickKnob){stickKnob.style.left="50%";stickKnob.style.top="50%";}stickKnob=null;const v=viewport();if(v){v.dataset.walkAimStickX="0.000";v.dataset.walkAimStickY="0.000";}}
function releaseCapture(){if(captureEl&&pointer!==null){try{if(captureEl.hasPointerCapture?.(pointer))captureEl.releasePointerCapture?.(pointer);}catch{}}captureEl=null;}
function hardRelease(reason="release"){if(pointer===null)return false;releaseCapture();pointer=null;walk()?.endTouchLook?.("touch-stick");resetStick();const v=viewport();if(v){v.dataset.walkAimRelease=reason;v.dataset.walkTouchLookActive="0";}return true;}
function hardReleaseAll(reason="release"){const lookReleased=hardRelease(reason),aimReleased=clearScreenAim(reason);return lookReleased||aimReleased;}
function syncLabels(){const zone=document.getElementById("footLookZone"),readout=document.getElementById("footReadout");if(zone){zone.setAttribute("aria-label","Hold and drag to aim down sights and auto-fire");zone.dataset.mobileLook="ads-camera-drag-autofire";}if(readout&&!readout.dataset.rightStickOnly){readout.dataset.rightStickOnly="1";readout.innerHTML="<b>WALK READY</b> · left move · right stick look · hold/drag ADS · auto-fire";}}
function stepStick(now){
  syncLabels();const dt=clamp((now-stickFrameMs)/1000,0,.04);stickFrameMs=now;
  if(pointer!==null&&dt>0&&walk()?.mode==="foot"&&!walk()?.dead){const w=walk(),profiled=w?.applyTouchLookStick?.({x:stickX,y:stickY,dt,now,source:"touch-stick"});let yawRate=0;if(profiled){yawRate=wrapFpsAngleRad(profiled.yaw-aimYaw)/dt;aimYaw=profiled.yaw;aimPitch=profiled.pitch;}else{const shaped=shapeFpsStick(stickX,stickY),velocity=fpsStickVelocity(shaped,undefined,{touch:true});yawRate=velocity.yaw;writeAim(aimYaw+velocity.yaw*dt,aimPitch+velocity.pitch*dt,"fps-stick-precision-rate-v15");}const v=viewport();if(v){v.dataset.walkAimStickMode="rate-edge-hold-v5";v.dataset.walkAimStickRate=Math.abs(yawRate).toFixed(2);v.dataset.walkAimStickCurve="radial-precision-centre-fast-edge-v2";}}
  if(screenPointer!==null&&walk()?.mode==="foot"&&!walk()?.dead){const cadence=screenFireCadenceMs();if(now-lastScreenFireAt>=cadence){lastScreenFireAt=now;fireScreen("touch-screen-autofire");}}
  requestAnimationFrame(stepStick);
}

export function installFootLookCapture(){
  if(installed)return;installed=true;
  window.addEventListener("pointerdown",event=>{
    if(walk()?.mode!=="foot"||walk()?.dead||reservedControlAt(event))return;const target=event.target instanceof Element?event.target:null;
    if(target?.closest("#footLook")){if(pointer!==null)return;if(event.pointerType==="mouse"&&event.button!==0)return;syncAim();pointer=event.pointerId;captureEl=target.closest("#footLook")||target;try{captureEl?.setPointerCapture?.(pointer);}catch{}walk()?.beginTouchLook?.("touch-stick");stickEl=captureEl;stickKnob=stickEl?.querySelector(".knob")||null;stickFrameMs=performance.now();updateStick(event.clientX,event.clientY);const v=viewport();if(v){v.dataset.walkAimStickCapture="rate-v6";v.dataset.walkAimStickMode="rate-edge-hold-v5";v.dataset.walkTouchLookActive="1";}consume(event);return;}
    if(!target?.closest("#footLookZone"))return;
    if(event.pointerType==="mouse"){if(event.button!==0)return;syncAim();const v=viewport();if(document.pointerLockElement!==v)try{v?.requestPointerLock?.({unadjustedMovement:true});}catch{try{v?.requestPointerLock?.();}catch{}}if(v)v.dataset.walkAimMouse="pointerlock-v13";consume(event);return;}
    if(beginScreenAim(event,target.closest("#footLookZone")||target))consume(event);
  },{capture:true,passive:false});
  window.addEventListener("pointermove",event=>{
    if(walk()?.mode!=="foot")return;const v=viewport();if(document.pointerLockElement===v){if(event.movementX||event.movementY){writeAim(aimYaw+Number(event.movementX||0)*MOUSE_YAW_PER_PX,aimPitch-Number(event.movementY||0)*MOUSE_PITCH_PER_PX,"fps-pointerlock-raw-v13");consume(event);}return;}
    if(event.pointerId===screenPointer){const samples=event.getCoalescedEvents?.()||[event];for(const sample of samples)applyScreenLook(sample.clientX,sample.clientY,sample.timeStamp);screenX=event.clientX;screenY=event.clientY;publishScreenAim(screenX,screenY,"touch-screen-drag");consume(event);return;}
    if(event.pointerId!==pointer)return;updateStick(event.clientX,event.clientY);consume(event);
  },{capture:true,passive:false});
  const release=event=>{if(event.pointerId===screenPointer){clearScreenAim(event.type);consume(event);return;}if(event.pointerId!==pointer)return;hardRelease(event.type);consume(event);};
  window.addEventListener("pointerup",release,{capture:true,passive:false});window.addEventListener("pointercancel",release,{capture:true,passive:false});window.addEventListener("lostpointercapture",event=>{if(event.pointerId===screenPointer){clearScreenAim("lostpointercapture");return;}if(event.pointerId===pointer)hardRelease("lostpointercapture");},true);addEventListener("blur",()=>hardReleaseAll("window-blur"),true);addEventListener("pagehide",()=>hardReleaseAll("pagehide"),true);document.addEventListener("visibilitychange",()=>{if(document.hidden)hardReleaseAll("visibility-hidden");},true);addEventListener("arondight:player-mode",()=>{if(walk()?.mode!=="foot")hardReleaseAll("mode-change");});
  document.addEventListener("pointerlockchange",()=>{if(document.pointerLockElement===viewport())syncAim();});window.addEventListener("contextmenu",event=>{if(walk()?.mode==="foot"&&viewport()?.contains(event.target))event.preventDefault();},{capture:true});
  const v=viewport();if(v){v.dataset.walkAimCapture="fps-authoritative-v15";v.dataset.walkAimStickMode="rate-edge-hold-v5";v.dataset.walkAimProfile="mouse-lock+screen-ads-drag-autofire+right-stick-v18";v.dataset.walkAimStickCurve="radial-precision-centre-fast-edge-v2";v.dataset.walkTouchTapRoute="authoritative-ads-drag-hold-v7";v.dataset.walkTouchOwnership="left-move+right-look+screen-ads-drag-fire-v3";v.dataset.walkScreenAimContract="ads-centered-sights+camera-drag+center-hitscan-v2";v.dataset.walkAutoFire="hold-screen-v1";}
  requestAnimationFrame(stepStick);
}

installFootLookCapture();
