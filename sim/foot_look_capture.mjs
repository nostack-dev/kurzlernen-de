const YAW_PER_PX=.0066;
const PITCH_PER_PX=.0050;
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,Number(v)||0));

let installed=false;
let pointer=null;
let lastX=0;
let lastY=0;

const viewport=()=>document.getElementById("viewport");
const walk=()=>globalThis.__arondightWalkMode||null;
const isLookZone=target=>target instanceof Element&&Boolean(target.closest("#footLookZone"));

function apply(dx,dy){
  const w=walk(),v=viewport();
  if(w?.mode!=="foot"||!v)return false;
  const yaw=Number(v.dataset.walkYaw)||0,pitch=Number(v.dataset.walkPitch)||0;
  w.setPose?.({yaw:yaw+Number(dx||0)*YAW_PER_PX,pitch:clamp(pitch-Number(dy||0)*PITCH_PER_PX,-1.30,1.30)});
  v.dataset.walkAimCapture="foot-look-zone-direct-v8";
  v.dataset.walkAimEvents=String((Number(v.dataset.walkAimEvents)||0)+1);
  return true;
}

function consume(event){event.preventDefault();event.stopImmediatePropagation();}

export function installFootLookCapture(){
  if(installed)return;installed=true;
  window.addEventListener("pointerdown",event=>{
    if(walk()?.mode!=="foot"||!isLookZone(event.target))return;
    if(event.pointerType==="mouse"&&event.button!==0)return;
    pointer=event.pointerId;lastX=event.clientX;lastY=event.clientY;consume(event);
  },{capture:true,passive:false});
  window.addEventListener("pointermove",event=>{
    if(event.pointerId!==pointer||walk()?.mode!=="foot")return;
    const dx=event.clientX-lastX,dy=event.clientY-lastY;lastX=event.clientX;lastY=event.clientY;
    apply(dx,dy);consume(event);
  },{capture:true,passive:false});
  const release=event=>{if(event.pointerId!==pointer)return;pointer=null;consume(event);};
  window.addEventListener("pointerup",release,{capture:true,passive:false});
  window.addEventListener("pointercancel",release,{capture:true,passive:false});
  const v=viewport();if(v)v.dataset.walkAimCapture="foot-look-zone-direct-v8";
}

installFootLookCapture();
