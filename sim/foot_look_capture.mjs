const YAW_PER_PX=.0066;
const PITCH_PER_PX=.0050;
const STICK_YAW_RATE=3.35;
const STICK_PITCH_RATE=2.55;
const STICK_DEADZONE=.08;
const MOBILE_RE=/(?:android|iphone|ipad|ipod|macintosh.*mobile)/i;
const MOBILE=MOBILE_RE.test(globalThis.navigator?.userAgent||"");
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,Number(v)||0));

let installed=false;
let pointer=null;
let surface=null;
let lastX=0;
let lastY=0;
let stickKnob=null;
let stickEl=null;
let stickX=0;
let stickY=0;
let stickYaw=0;
let stickPitch=0;
let stickFrameMs=performance.now();

const viewport=()=>document.getElementById("viewport");
const walk=()=>globalThis.__arondightWalkMode||null;
const lookSurface=target=>{
  if(!(target instanceof Element))return null;
  if(target.closest("#footLook"))return"stick";
  if(target.closest("#footLookZone"))return"zone";
  return null;
};

function applyDrag(dx,dy){
  const w=walk(),v=viewport();
  if(w?.mode!=="foot"||!v)return false;
  const yaw=Number(v.dataset.walkYaw)||0,pitch=Number(v.dataset.walkPitch)||0;
  w.setPose?.({yaw:yaw+Number(dx||0)*YAW_PER_PX,pitch:clamp(pitch-Number(dy||0)*PITCH_PER_PX,-1.30,1.30)});
  v.dataset.walkAimCapture="foot-look-zone-direct-v9";
  v.dataset.walkAimEvents=String((Number(v.dataset.walkAimEvents)||0)+1);
  return true;
}

function updateStick(clientX,clientY){
  const el=stickEl||document.getElementById("footLook");if(!el)return;
  const r=el.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2,rad=Math.max(1,r.width*.38);
  let x=(Number(clientX)-cx)/rad,y=(Number(clientY)-cy)/rad,mag=Math.hypot(x,y);
  if(mag>1){x/=mag;y/=mag;mag=1;}
  if(mag<=STICK_DEADZONE){stickX=0;stickY=0;}else{const scaled=(mag-STICK_DEADZONE)/(1-STICK_DEADZONE),k=scaled/Math.max(mag,1e-6);stickX=x*k;stickY=y*k;}
  if(stickKnob){stickKnob.style.left=`${50+x*31}%`;stickKnob.style.top=`${50+y*31}%`;}
  const v=viewport();if(v){v.dataset.walkAimStickX=stickX.toFixed(3);v.dataset.walkAimStickY=stickY.toFixed(3);}
}
function resetStick(){stickX=0;stickY=0;stickEl=null;if(stickKnob){stickKnob.style.left="50%";stickKnob.style.top="50%";}stickKnob=null;const v=viewport();if(v){v.dataset.walkAimStickX="0.000";v.dataset.walkAimStickY="0.000";}}
function consume(event){event.preventDefault();event.stopImmediatePropagation();}
function stepStick(now){
  const dt=clamp((now-stickFrameMs)/1000,0,.05);stickFrameMs=now;
  if(pointer!==null&&surface==="stick"&&dt>0){
    const w=walk(),v=viewport();
    if(w?.mode==="foot"&&v){
      stickYaw+=stickX*STICK_YAW_RATE*dt;
      stickPitch=clamp(stickPitch-stickY*STICK_PITCH_RATE*dt,-1.30,1.30);
      w.setPose?.({yaw:stickYaw,pitch:stickPitch});
      v.dataset.walkAimStickMode="rate-edge-hold-v1";
      v.dataset.walkAimStickRate=STICK_YAW_RATE.toFixed(2);
      v.dataset.walkAimEvents=String((Number(v.dataset.walkAimEvents)||0)+1);
    }
  }
  requestAnimationFrame(stepStick);
}

export function installFootLookCapture(){
  if(installed)return;installed=true;
  window.addEventListener("pointerdown",event=>{
    if(walk()?.mode!=="foot"||pointer!==null)return;
    const nextSurface=lookSurface(event.target);if(!nextSurface)return;
    if(event.pointerType==="mouse"&&event.button!==0)return;
    // Real desktop mouse keeps pointer-lock free-look on the blank viewport.
    // The visible LOOK stick is always an analog rate stick: holding its edge
    // keeps turning until release, just like a gamepad right stick.
    if(nextSurface==="zone"&&event.pointerType==="mouse"&&!MOBILE)return;
    surface=nextSurface;pointer=event.pointerId;lastX=event.clientX;lastY=event.clientY;
    const v=viewport();
    if(surface==="stick"){
      stickEl=event.target instanceof Element?event.target.closest("#footLook"):document.getElementById("footLook");
      stickKnob=stickEl?.querySelector(".knob")||null;
      stickYaw=Number(v?.dataset.walkYaw)||0;stickPitch=Number(v?.dataset.walkPitch)||0;stickFrameMs=performance.now();updateStick(event.clientX,event.clientY);
      if(v){v.dataset.walkAimStickCapture="rate-v2";v.dataset.walkAimStickMode="rate-edge-hold-v1";}
    }else if(v&&MOBILE)v.dataset.walkAimMobileCapture="direct-v1";
    consume(event);
  },{capture:true,passive:false});
  window.addEventListener("pointermove",event=>{
    if(event.pointerId!==pointer||walk()?.mode!=="foot")return;
    if(surface==="stick")updateStick(event.clientX,event.clientY);
    else{const dx=event.clientX-lastX,dy=event.clientY-lastY;lastX=event.clientX;lastY=event.clientY;applyDrag(dx,dy);}
    consume(event);
  },{capture:true,passive:false});
  const release=event=>{
    if(event.pointerId!==pointer)return;
    pointer=null;surface=null;resetStick();consume(event);
  };
  window.addEventListener("pointerup",release,{capture:true,passive:false});
  window.addEventListener("pointercancel",release,{capture:true,passive:false});
  const v=viewport();if(v){v.dataset.walkAimCapture="foot-look-zone-direct-v9";v.dataset.walkAimStickMode="rate-edge-hold-v1";}
  requestAnimationFrame(stepStick);
}

installFootLookCapture();
