// One pair of sticks for everything. The foot HUD's MOVE / LOOK sticks are
// the only on-screen sticks; a vehicle (car, jet) "claims" them while it is
// driven: the same two sticks, same place, same feel — they deliver
// spring-back deflections (x right +, y down +, unit circle) to the vehicle
// instead of walking / looking. FIRE goes to the claimant too.
const move={x:0,y:0},look={x:0,y:0},ptr={move:null,look:null};let owner=null,installed=false,fireDown=false;
const el=k=>document.getElementById(k==="move"?"footMove":"footLook");
const axes=k=>k==="move"?move:look;
function knob(k){const n=el(k)?.querySelector(".knob"),o=axes(k);if(n){n.style.left=`${50+o.x*31}%`;n.style.top=`${50+o.y*31}%`;}}
function apply(k,e){const s=el(k);if(!s)return;const r=s.getBoundingClientRect(),rad=Math.max(1,r.width*.38);let dx=(e.clientX-(r.left+r.width/2))/rad,dy=(e.clientY-(r.top+r.height/2))/rad;const l=Math.hypot(dx,dy);if(l>1){dx/=l;dy/=l;}const o=axes(k);o.x=dx;o.y=dy;knob(k);}
function release(k){const o=axes(k);o.x=o.y=0;ptr[k]=null;knob(k);}
function which(t){if(!(t instanceof Element))return null;if(t.closest("#footMove"))return"move";if(t.closest("#footLook"))return"look";if(t.closest("#footFire"))return"fire";return null;}
function swallow(e){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();}
function install(){if(installed||typeof window==="undefined")return;installed=true;
  addEventListener("pointerdown",e=>{if(!owner)return;const k=which(e.target);if(!k)return;swallow(e);if(k==="fire"){fireDown=true;owner.onFire?.(true);return;}if(ptr[k]!==null)return;ptr[k]=e.pointerId;try{el(k).setPointerCapture?.(e.pointerId);}catch{}apply(k,e);},{capture:true,passive:false});
  addEventListener("pointermove",e=>{if(!owner)return;for(const k of["move","look"])if(ptr[k]===e.pointerId){swallow(e);apply(k,e);}},{capture:true,passive:false});
  const up=e=>{if(!owner)return;if(fireDown&&which(e.target)==="fire"){fireDown=false;owner.onFire?.(false);swallow(e);}for(const k of["move","look"])if(ptr[k]===e.pointerId){swallow(e);release(k);}};
  for(const t of["pointerup","pointercancel","lostpointercapture"])addEventListener(t,up,{capture:true,passive:false});
  const st=document.createElement("style");st.dataset.sharedSticks="v1";st.textContent="body.sticks-claimed #footHud{display:block!important}body.sticks-claimed #footJump,body.sticks-claimed #footLookZone,body.sticks-claimed #footReticle,body.sticks-claimed #footReadout{display:none!important}body.sticks-claimed #footMove,body.sticks-claimed #footLook,body.sticks-claimed #footFire{display:block!important;pointer-events:auto!important}";document.head.appendChild(st);}
function label(k,text){const s=el(k)?.querySelector("span");if(!s)return;if(s.dataset.base===undefined)s.dataset.base=s.textContent;s.textContent=text??s.dataset.base;}
export function claimSticks(o){install();if(owner&&owner!==o)owner.onFire?.(false);owner=o;release("move");release("look");fireDown=false;document.body.classList.add("sticks-claimed");document.body.dataset.sticksOwner=String(o.name||"vehicle");label("move",o.labels?.move);label("look",o.labels?.look);const f=document.getElementById("footFire");if(f){if(f.dataset.base===undefined)f.dataset.base=f.textContent;f.textContent=o.labels?.fire||f.dataset.base;}return{move,look};}
export function releaseSticks(o){if(!owner||(o&&owner!==o))return;owner.onFire?.(false);owner=null;release("move");release("look");fireDown=false;document.body.classList.remove("sticks-claimed");delete document.body.dataset.sticksOwner;label("move");label("look");const f=document.getElementById("footFire");if(f&&f.dataset.base!==undefined)f.textContent=f.dataset.base;}
export const sticks={move,look,get owner(){return owner?.name||null;}};
