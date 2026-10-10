// The sniper's scope as you see it through the glass: everything outside the round field of view
// is the black of the scope tube, a mil-dot reticle in the middle, a thin red centre dot. Shown
// while scoped (RMB / LT held, or the SCOPE button on touch — first_person_controller_v5.mjs
// owns the zoom). On touch a round SCOPE button appears next to the weapon switch while the
// sniper is out: tap to look through the scope, tap again to come back; a tap on the screen
// while scoped fires through the crosshair.
export const SNIPER_SCOPE_VERSION="sniper-scope-v1";
let installed=false,overlay=null,button=null;
const $=id=>document.getElementById(id);
const CSS=`
#sniperScope{position:absolute;inset:0;z-index:12;pointer-events:none;display:none;--r:min(47vw,47vh)}
body.scope-active #sniperScope{display:block}
/* tube: hard black outside the glass, a narrow dark rim with a hint of lens colour at the edge */
#sniperScope .ss-tube{position:absolute;inset:0;background:radial-gradient(circle at 50% 50%,transparent 0,transparent calc(var(--r) - 18px),#06080a8c calc(var(--r) - 6px),#020304 calc(var(--r) - 1px),#000 var(--r),#000 100%)}
#sniperScope .ss-ring{position:absolute;left:50%;top:50%;width:calc(var(--r)*2);height:calc(var(--r)*2);transform:translate(-50%,-50%);border-radius:50%;box-shadow:inset 0 0 0 1px #2a3a4855,inset 0 0 26px 6px #000a;background:radial-gradient(circle at 34% 28%,#ffffff12 0,#ffffff05 18%,transparent 38%)}
/* duplex reticle: hair-thin centre lines, heavy posts from the rim to 40 % */
#sniperScope .ss-h,#sniperScope .ss-v{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);background:#0b0b0bdd}
#sniperScope .ss-h{width:calc(var(--r)*2);height:1px}#sniperScope .ss-v{height:calc(var(--r)*2);width:1px}
#sniperScope .ss-h::before,#sniperScope .ss-h::after{content:"";position:absolute;top:-2px;height:5px;width:30%;background:#050505}#sniperScope .ss-h::before{left:0}#sniperScope .ss-h::after{right:0}
#sniperScope .ss-v::after{content:"";position:absolute;left:-2px;width:5px;height:30%;background:#050505;bottom:0}
#sniperScope .ss-dots{position:absolute;left:50%;top:50%;width:0;height:0}
#sniperScope .ss-dots i{position:absolute;width:3px;height:3px;margin:-1.5px 0 0 -1.5px;border-radius:50%;background:#0b0b0b}
#sniperScope .ss-dot{position:absolute;left:50%;top:50%;width:3px;height:3px;margin:-1.5px 0 0 -1.5px;border-radius:50%;background:#ff3b22;box-shadow:0 0 3px 1px #ff3b2299}
#sniperScope .ss-range{position:absolute;left:50%;top:calc(50% + var(--r)*.52);transform:translateX(-50%);font:700 11px/1 "Barlow Condensed",Inter,system-ui,sans-serif;letter-spacing:.12em;color:#ff7a5a;text-shadow:0 0 3px #000,0 0 1px #000;white-space:nowrap}
#scopeButton{position:absolute;z-index:23;display:none;width:60px;height:60px;margin:0;padding:0;border-radius:50%!important;border:2px solid #ffffffaa;background:#0c1a14d0;color:#fff;font:900 10px/1 system-ui,sans-serif;letter-spacing:.06em;touch-action:none;box-shadow:0 6px 16px #0007;flex-direction:column;align-items:center;justify-content:center;gap:2px}
#scopeButton b{font-size:20px;line-height:1}#scopeButton.show{display:flex}#scopeButton.on{background:#b3261ed8;border-color:#ffd0c8}`;
function weaponOut(name){const w=globalThis.__arondightWalkMode;return w?.mode==="foot"&&String(globalThis.__arondightFootWeapons?.mode||"")===name;}
function sniperOut(){return weaponOut("sniper");}
function touchPlay(){const b=document.body;return!b.classList.contains("desktop-input")&&!b.classList.contains("pad-input");}
function mount(){const v=$("viewport");if(!v)return false;
  const st=document.createElement("style");st.dataset.sniperScope=SNIPER_SCOPE_VERSION;st.textContent=CSS;document.head.appendChild(st);
  overlay=document.createElement("div");overlay.id="sniperScope";overlay.setAttribute("aria-hidden","true");
  const dots=[];for(let k=1;k<=4;k++)for(const s of[-1,1]){dots.push(`<i style="left:${s*k*4.2}vmin;top:0"></i>`);if(s>0||k<=2)dots.push(`<i style="top:${s*k*4.2}vmin;left:0"></i>`);}
  overlay.innerHTML=`<div class="ss-tube"></div><div class="ss-ring"></div><div class="ss-h"></div><div class="ss-v"></div><div class="ss-dots">${dots.join("")}</div><div class="ss-dot"></div><div class="ss-range"></div>`;v.appendChild(overlay);
  button=document.createElement("button");button.id="scopeButton";button.type="button";button.setAttribute("aria-label","Scope");button.innerHTML="<b>◎</b>SCOPE";v.appendChild(button);
  button.addEventListener("pointerdown",e=>{e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();globalThis.__arondightScopeToggle=!globalThis.__arondightScopeToggle;sync();},{capture:true});
  button.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();});
  return true;}
// beside the weapon switch (thumb_layout.mjs places that one left of the look stick): above it
function place(){const w=$("thumbWeapon");if(!w||!w.classList.contains("show"))return false;const l=parseFloat(w.style.left),t=parseFloat(w.style.top);if(!Number.isFinite(l)||!Number.isFinite(t))return false;const L=`${Math.round(l)}px`,T=`${Math.round(t-66)}px`; /* straight above the weapon switch, low by the thumb */if(button.style.left!==L)button.style.setProperty("left",L,"important");if(button.style.top!==T)button.style.setProperty("top",T,"important");return true;}
function readout(){if(!overlay||!document.body.classList.contains("scope-active"))return;const b=globalThis.__arondightRealWorld,c=b?.presentedCamera?.()||b?.threeCamera,el=overlay.querySelector(".ss-range");if(!c||!el)return;const z=Math.max(1,Math.round(74/Math.max(1,c.fov)));const t=`${z}×`;if(el.textContent!==t)el.textContent=t;}
function sync(){try{readout();}catch{}if(!button)return;const out=sniperOut(),grav=false;if(!out&&globalThis.__arondightScopeToggle)globalThis.__arondightScopeToggle=false;const show=(out||grav)&&touchPlay()&&place();button.classList.toggle("show",Boolean(show));
  const on=grav?Boolean(globalThis.__arondightGravityGun?.holding):Boolean(globalThis.__arondightScopeToggle),html=grav?(on?"<b>✋</b>DROP":"<b>⊛</b>GRAB"):"<b>◎</b>SCOPE";if(button.dataset.html!==html){button.dataset.html=html;button.innerHTML=html;}button.classList.toggle("on",on);}
export function installSniperScope(){if(installed||typeof document==="undefined")return;installed=true;const boot=()=>{if(!mount()){setTimeout(boot,300);return;}const loop=()=>{try{sync();}catch(e){console.warn("sniper scope",e);}setTimeout(loop,150);};loop();};boot();}
installSniperScope();
