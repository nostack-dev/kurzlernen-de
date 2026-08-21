const YAW_PER_PX=.0066;
const PITCH_PER_PX=.0050;
const MOBILE_RE=/(?:android|iphone|ipad|ipod|macintosh.*mobile)/i;
const MOBILE=MOBILE_RE.test(globalThis.navigator?.userAgent||"");
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,Number(v)||0));

let installed=false;
let pointer=null;
let surface=null;
let lastX=0;
let lastY=0;
let originX=0;
let originY=0;
let stickKnob=null;

const viewport=()=>document.getElementById("viewport");
const walk=()=>globalThis.__arondightWalkMode||null;
const lookSurface=target=>{
  if(!(target instanceof Element))return null;
  if(target.closest("#footLook"))return"stick";
  if(target.closest("#footLookZone"))return"zone";
  return null;
};

function apply(dx,dy){
  const w=walk(),v=viewport();
  if(w?.mode!=="foot"||!v)return false;
  const yaw=Number(v.dataset.walkYaw)||0,pitch=Number(v.dataset.walkPitch)||0;
  w.setPose?.({yaw:yaw+Number(dx||0)*YAW_PER_PX,pitch:clamp(pitch-Number(dy||0)*PITCH_PER_PX,-1.30,1.30)});
  v.dataset.walkAimCapture="foot-look-zone-direct-v8";
  v.dataset.walkAimEvents=String((Number(v.dataset.walkAimEvents)||0)+1);
  return true;
}

function updateStickVisual(clientX,clientY){
  if(!stickKnob)return;
  const dx=clamp((clientX-originX)/38,-1,1),dy=clamp((clientY-originY)/38,-1,1);
  stickKnob.style.left=`${50+dx*28}%`;
  stickKnob.style.top=`${50+dy*28}%`;
}
function resetStickVisual(){if(stickKnob){stickKnob.style.left="50%";stickKnob.style.top="50%";}stickKnob=null;}
function consume(event){event.preventDefault();event.stopImmediatePropagation();}

export function installFootLookCapture(){
  if(installed)return;installed=true;
  window.addEventListener("pointerdown",event=>{
    if(walk()?.mode!=="foot"||pointer!==null)return;
    const nextSurface=lookSurface(event.target);if(!nextSurface)return;
    if(event.pointerType==="mouse"&&event.button!==0)return;
    // Real desktop mouse keeps pointer-lock free-look. Mobile/touch UI must stay
    // direct-drag even when automation or an attached pointer reports as mouse,
    // otherwise pointer lock retargets the next MOVE-stick press to the viewport.
    if(nextSurface==="zone"&&event.pointerType==="mouse"&&!MOBILE)return;
    surface=nextSurface;pointer=event.pointerId;lastX=originX=event.clientX;lastY=originY=event.clientY;
    if(surface==="stick")stickKnob=document.querySelector("#footLook .knob");
    const v=viewport();if(v){
      if(surface==="stick")v.dataset.walkAimStickCapture="direct-v1";
      if(surface==="zone"&&MOBILE)v.dataset.walkAimMobileCapture="direct-v1";
    }
    consume(event);
  },{capture:true,passive:false});
  window.addEventListener("pointermove",event=>{
    if(event.pointerId!==pointer||walk()?.mode!=="foot")return;
    const dx=event.clientX-lastX,dy=event.clientY-lastY;lastX=event.clientX;lastY=event.clientY;
    apply(dx,dy);if(surface==="stick")updateStickVisual(event.clientX,event.clientY);consume(event);
  },{capture:true,passive:false});
  const release=event=>{
    if(event.pointerId!==pointer)return;
    pointer=null;surface=null;resetStickVisual();consume(event);
  };
  window.addEventListener("pointerup",release,{capture:true,passive:false});
  window.addEventListener("pointercancel",release,{capture:true,passive:false});
  const v=viewport();if(v)v.dataset.walkAimCapture="foot-look-zone-direct-v8";
}

installFootLookCapture();
