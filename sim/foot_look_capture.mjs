const MOUSE_YAW_PER_PX=.0028;
const MOUSE_PITCH_PER_PX=.00235;
const TOUCH_YAW_PER_PX=.0042;
const TOUCH_PITCH_PER_PX=.00355;
const STICK_YAW_RATE=2.55;
const STICK_PITCH_RATE=1.85;
const STICK_DEADZONE=.12;
const STICK_CURVE=1.45;
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,Number(v)||0));

let installed=false,pointer=null,surface=null,lastX=0,lastY=0,stickKnob=null,stickEl=null,stickX=0,stickY=0,aimYaw=0,aimPitch=0,stickFrameMs=performance.now();

const viewport=()=>document.getElementById("viewport");
const walk=()=>globalThis.__arondightWalkMode||null;
const lookSurface=target=>{if(!(target instanceof Element))return null;if(target.closest("#footLook"))return"stick";if(target.closest("#footLookZone"))return"zone";return null;};
function currentAim(){const v=viewport();return{yaw:Number(v?.dataset.walkYaw)||0,pitch:Number(v?.dataset.walkPitch)||0};}
function syncAim(){const a=currentAim();aimYaw=a.yaw;aimPitch=a.pitch;}
function writeAim(yaw,pitch,mode){const w=walk(),v=viewport();if(w?.mode!=="foot"||!v)return false;aimYaw=Number(yaw)||0;aimPitch=clamp(pitch,-1.30,1.30);w.setPose?.({yaw:aimYaw,pitch:aimPitch});v.dataset.walkAimCapture="fps-authoritative-v10";v.dataset.walkLookModel=mode;v.dataset.walkAimEvents=String((Number(v.dataset.walkAimEvents)||0)+1);return true;}
function applyDelta(dx,dy,{mouse=false}={}){const y=mouse?MOUSE_YAW_PER_PX:TOUCH_YAW_PER_PX,p=mouse?MOUSE_PITCH_PER_PX:TOUCH_PITCH_PER_PX;return writeAim(aimYaw+Number(dx||0)*y,aimPitch-Number(dy||0)*p,mouse?"fps-pointerlock-raw-v10":"fps-touch-delta-v10");}
function consume(event){event.preventDefault();event.stopImmediatePropagation();}

function updateStick(clientX,clientY){
  const el=stickEl||document.getElementById("footLook");if(!el)return;const r=el.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2,rad=Math.max(1,r.width*.38);let x=(Number(clientX)-cx)/rad,y=(Number(clientY)-cy)/rad,mag=Math.hypot(x,y);if(mag>1){x/=mag;y/=mag;mag=1;}
  if(mag<=STICK_DEADZONE){stickX=0;stickY=0;}else{const normalized=(mag-STICK_DEADZONE)/(1-STICK_DEADZONE),curved=Math.pow(normalized,STICK_CURVE),k=curved/Math.max(mag,1e-6);stickX=x*k;stickY=y*k;}
  if(stickKnob){stickKnob.style.left=`${50+x*31}%`;stickKnob.style.top=`${50+y*31}%`;}
  const v=viewport();if(v){v.dataset.walkAimStickX=stickX.toFixed(3);v.dataset.walkAimStickY=stickY.toFixed(3);}
}
function resetStick(){stickX=0;stickY=0;stickEl=null;if(stickKnob){stickKnob.style.left="50%";stickKnob.style.top="50%";}stickKnob=null;const v=viewport();if(v){v.dataset.walkAimStickX="0.000";v.dataset.walkAimStickY="0.000";}}
function stepStick(now){const dt=clamp((now-stickFrameMs)/1000,0,.04);stickFrameMs=now;if(pointer!==null&&surface==="stick"&&dt>0&&walk()?.mode==="foot"){writeAim(aimYaw+stickX*STICK_YAW_RATE*dt,aimPitch-stickY*STICK_PITCH_RATE*dt,"fps-stick-rate-v10");const v=viewport();if(v){v.dataset.walkAimStickMode="rate-edge-hold-v2";v.dataset.walkAimStickRate=STICK_YAW_RATE.toFixed(2);}}requestAnimationFrame(stepStick);}

export function installFootLookCapture(){
  if(installed)return;installed=true;
  window.addEventListener("pointerdown",event=>{
    if(walk()?.mode!=="foot"||pointer!==null)return;const nextSurface=lookSurface(event.target);if(!nextSurface)return;if(event.pointerType==="mouse"&&event.button!==0)return;syncAim();surface=nextSurface;
    if(nextSurface==="zone"&&event.pointerType==="mouse"){
      const v=viewport();if(document.pointerLockElement!==v)try{v?.requestPointerLock?.({unadjustedMovement:true});}catch{try{v?.requestPointerLock?.();}catch{}}if(v)v.dataset.walkAimMouse="pointerlock-v10";consume(event);return;
    }
    pointer=event.pointerId;lastX=event.clientX;lastY=event.clientY;
    if(surface==="stick"){stickEl=event.target instanceof Element?event.target.closest("#footLook"):document.getElementById("footLook");stickKnob=stickEl?.querySelector(".knob")||null;stickFrameMs=performance.now();updateStick(event.clientX,event.clientY);const v=viewport();if(v){v.dataset.walkAimStickCapture="rate-v3";v.dataset.walkAimStickMode="rate-edge-hold-v2";}}
    else{const v=viewport();if(v)v.dataset.walkAimTouch="direct-drag-v10";}
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
  const v=viewport();if(v){v.dataset.walkAimCapture="fps-authoritative-v10";v.dataset.walkAimStickMode="rate-edge-hold-v2";v.dataset.walkAimProfile="mouse-lock+touch-drag+rate-stick-v10";}
  requestAnimationFrame(stepStick);
}

installFootLookCapture();
