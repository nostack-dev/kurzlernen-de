import {FPS_PITCH_LIMIT_RAD,fpsStickVelocity,fpsTouchLookDelta,shapeFpsStick} from "./fps_control_math.mjs";

const MOUSE_YAW_PER_PX=.0028;
const MOUSE_PITCH_PER_PX=.00235;
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,Number(v)||0));

let installed=false,pointer=null,surface=null,lastX=0,lastY=0,stickKnob=null,stickEl=null,stickX=0,stickY=0,aimYaw=0,aimPitch=0,stickFrameMs=performance.now();

const viewport=()=>document.getElementById("viewport");
const walk=()=>globalThis.__arondightWalkMode||null;
const lookSurface=target=>{if(!(target instanceof Element))return null;if(target.closest("#footLook"))return"stick";if(target.closest("#footLookZone"))return"zone";return null;};
function currentAim(){const v=viewport();return{yaw:Number(v?.dataset.walkYaw)||0,pitch:Number(v?.dataset.walkPitch)||0};}
function syncAim(){const a=currentAim();aimYaw=a.yaw;aimPitch=a.pitch;}
function writeAim(yaw,pitch,mode){const w=walk(),v=viewport();if(w?.mode!=="foot"||!v)return false;aimYaw=Number(yaw)||0;aimPitch=clamp(pitch,-FPS_PITCH_LIMIT_RAD,FPS_PITCH_LIMIT_RAD);w.setPose?.({yaw:aimYaw,pitch:aimPitch});v.dataset.walkAimCapture="fps-authoritative-v11";v.dataset.walkLookInput=mode;v.dataset.walkAimEvents=String((Number(v.dataset.walkAimEvents)||0)+1);return true;}
function applyDelta(dx,dy,{mouse=false}={}){if(mouse)return writeAim(aimYaw+Number(dx||0)*MOUSE_YAW_PER_PX,aimPitch-Number(dy||0)*MOUSE_PITCH_PER_PX,"fps-pointerlock-raw-v11");const delta=fpsTouchLookDelta(dx,dy);return writeAim(aimYaw+delta.yaw,aimPitch+delta.pitch,"fps-touch-dynamic-v11");}
function consume(event){event.preventDefault();event.stopImmediatePropagation();}

function updateStick(clientX,clientY){
  const el=stickEl||document.getElementById("footLook");if(!el)return;const r=el.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2,rad=Math.max(1,r.width*.38);let x=(Number(clientX)-cx)/rad,y=(Number(clientY)-cy)/rad,mag=Math.hypot(x,y);if(mag>1){x/=mag;y/=mag;mag=1;}
  const shaped=shapeFpsStick(x,y);stickX=shaped.x;stickY=shaped.y;
  if(stickKnob){stickKnob.style.left=`${50+x*31}%`;stickKnob.style.top=`${50+y*31}%`;}
  const v=viewport();if(v){v.dataset.walkAimStickX=stickX.toFixed(3);v.dataset.walkAimStickY=stickY.toFixed(3);}
}
function resetStick(){stickX=0;stickY=0;stickEl=null;if(stickKnob){stickKnob.style.left="50%";stickKnob.style.top="50%";}stickKnob=null;const v=viewport();if(v){v.dataset.walkAimStickX="0.000";v.dataset.walkAimStickY="0.000";}}
function stepStick(now){const dt=clamp((now-stickFrameMs)/1000,0,.04);stickFrameMs=now;if(pointer!==null&&surface==="stick"&&dt>0&&walk()?.mode==="foot"){const velocity=fpsStickVelocity({x:stickX,y:stickY},undefined,{touch:true});writeAim(aimYaw+velocity.yaw*dt,aimPitch+velocity.pitch*dt,"fps-stick-dynamic-rate-v11");const v=viewport();if(v){v.dataset.walkAimStickMode="rate-edge-hold-v2";v.dataset.walkAimStickRate=Math.abs(velocity.yaw).toFixed(2);v.dataset.walkAimStickCurve="radial-dynamic-reverse-s-v1";}}requestAnimationFrame(stepStick);}

export function installFootLookCapture(){
  if(installed)return;installed=true;
  window.addEventListener("pointerdown",event=>{
    if(walk()?.mode!=="foot"||pointer!==null)return;const nextSurface=lookSurface(event.target);if(!nextSurface)return;if(event.pointerType==="mouse"&&event.button!==0)return;syncAim();surface=nextSurface;
    if(nextSurface==="zone"&&event.pointerType==="mouse"){
      const v=viewport();if(document.pointerLockElement!==v)try{v?.requestPointerLock?.({unadjustedMovement:true});}catch{try{v?.requestPointerLock?.();}catch{}}if(v)v.dataset.walkAimMouse="pointerlock-v11";consume(event);return;
    }
    pointer=event.pointerId;lastX=event.clientX;lastY=event.clientY;
    if(surface==="stick"){stickEl=event.target instanceof Element?event.target.closest("#footLook"):document.getElementById("footLook");stickKnob=stickEl?.querySelector(".knob")||null;stickFrameMs=performance.now();updateStick(event.clientX,event.clientY);const v=viewport();if(v){v.dataset.walkAimStickCapture="rate-v3";v.dataset.walkAimStickMode="rate-edge-hold-v2";}}
    else{const v=viewport();if(v)v.dataset.walkAimTouch="direct-dynamic-drag-v11";}
    consume(event);
  },{capture:true,passive:false});
  window.addEventListener("pointermove",event=>{
    if(walk()?.mode!=="foot")return;const v=viewport();
    if(document.pointerLockElement===v){if(event.movementX||event.movementY){applyDelta(event.movementX,event.movementY,{mouse:true});consume(event);}return;}
    if(event.pointerId!==pointer)return;if(surface==="stick")updateStick(event.clientX,event.clientY);else{const dx=event.clientX-lastX,dy=event.clientY-lastY;lastX=event.clientX;lastY=event.clientY;applyDelta(dx,dy);}consume(event);
  },{capture:true,passive:false});
  const release=event=>{if(event.pointerId!==pointer)return;pointer=null;surface=null;resetStick();consume(event);};
  window.addEventListener("pointerup",release,{capture:true,passive:false});window.addEventListener("pointercancel",release,{capture:true,passive:false});
  document.addEventListener("pointerlockchange",()=>{if(document.pointerLockElement===viewport())syncAim();});
  window.addEventListener("contextmenu",event=>{if(walk()?.mode==="foot"&&viewport()?.contains(event.target))event.preventDefault();},{capture:true});
  const v=viewport();if(v){v.dataset.walkAimCapture="fps-authoritative-v11";v.dataset.walkAimStickMode="rate-edge-hold-v2";v.dataset.walkAimProfile="mouse-lock+dynamic-touch+radial-rate-stick-v11";v.dataset.walkAimStickCurve="radial-dynamic-reverse-s-v1";}
  requestAnimationFrame(stepStick);
}

installFootLookCapture();
