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
#sniperScope{position:absolute;inset:0;z-index:12;pointer-events:none;display:none}
body.scope-active #sniperScope{display:block}
#sniperScope .ss-tube{position:absolute;inset:0;background:radial-gradient(circle at 50% 50%,transparent 0,transparent calc(min(46vw,46vh) - 2px),#000 calc(min(46vw,46vh) + 1px),#000 100%)}
#sniperScope .ss-ring{position:absolute;left:50%;top:50%;width:calc(min(92vw,92vh));height:calc(min(92vw,92vh));transform:translate(-50%,-50%);border-radius:50%;box-shadow:inset 0 0 40px 10px #000c}
#sniperScope .ss-h,#sniperScope .ss-v{position:absolute;left:50%;top:50%;background:#000;transform:translate(-50%,-50%)}
#sniperScope .ss-h{width:calc(min(92vw,92vh));height:2px}#sniperScope .ss-v{height:calc(min(92vw,92vh));width:2px}
#sniperScope .ss-h::before,#sniperScope .ss-h::after{content:"";position:absolute;top:-2px;height:6px;width:32%;background:#000}#sniperScope .ss-h::before{left:0}#sniperScope .ss-h::after{right:0}
#sniperScope .ss-v::before,#sniperScope .ss-v::after{content:"";position:absolute;left:-2px;width:6px;height:32%;background:#000}#sniperScope .ss-v::before{top:0}#sniperScope .ss-v::after{bottom:0}
#sniperScope .ss-dots{position:absolute;left:50%;top:50%;width:0;height:0}
#sniperScope .ss-dots i{position:absolute;width:5px;height:5px;margin:-2.5px 0 0 -2.5px;border-radius:50%;background:#000}
#sniperScope .ss-dot{position:absolute;left:50%;top:50%;width:4px;height:4px;margin:-2px 0 0 -2px;border-radius:50%;background:#ff2a1a;box-shadow:0 0 4px #ff2a1a}
#scopeButton{position:absolute;z-index:23;display:none;width:60px;height:60px;margin:0;padding:0;border-radius:50%!important;border:2px solid #ffffffaa;background:#0c1a14d0;color:#fff;font:900 10px/1 system-ui,sans-serif;letter-spacing:.06em;touch-action:none;box-shadow:0 6px 16px #0007;flex-direction:column;align-items:center;justify-content:center;gap:2px}
#scopeButton b{font-size:20px;line-height:1}#scopeButton.show{display:flex}#scopeButton.on{background:#b3261ed8;border-color:#ffd0c8}`;
function weaponOut(name){const w=globalThis.__arondightWalkMode;return w?.mode==="foot"&&String(globalThis.__arondightFootWeapons?.mode||"")===name;}
function sniperOut(){return weaponOut("sniper");}
function touchPlay(){const b=document.body;return!b.classList.contains("desktop-input")&&!b.classList.contains("pad-input");}
function mount(){const v=$("viewport");if(!v)return false;
  const st=document.createElement("style");st.dataset.sniperScope=SNIPER_SCOPE_VERSION;st.textContent=CSS;document.head.appendChild(st);
  overlay=document.createElement("div");overlay.id="sniperScope";overlay.setAttribute("aria-hidden","true");
  const dots=[];for(let k=1;k<=4;k++)for(const s of[-1,1]){dots.push(`<i style="left:${s*k*4.2}vmin;top:0"></i>`,`<i style="top:${s*k*4.2}vmin;left:0"></i>`);}
  overlay.innerHTML=`<div class="ss-tube"></div><div class="ss-ring"></div><div class="ss-h"></div><div class="ss-v"></div><div class="ss-dots">${dots.join("")}</div><div class="ss-dot"></div>`;v.appendChild(overlay);
  button=document.createElement("button");button.id="scopeButton";button.type="button";button.setAttribute("aria-label","Scope");button.innerHTML="<b>◎</b>SCOPE";v.appendChild(button);
  button.addEventListener("pointerdown",e=>{e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();globalThis.__arondightScopeToggle=!globalThis.__arondightScopeToggle;sync();},{capture:true});
  button.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();});
  return true;}
// beside the weapon switch (thumb_layout.mjs places that one left of the look stick): above it
function place(){const w=$("thumbWeapon");if(!w||!w.classList.contains("show"))return false;const l=parseFloat(w.style.left),t=parseFloat(w.style.top);if(!Number.isFinite(l)||!Number.isFinite(t))return false;const L=`${Math.round(l-22)}px`,T=`${Math.round(t-64)}px`;if(button.style.left!==L)button.style.setProperty("left",L,"important");if(button.style.top!==T)button.style.setProperty("top",T,"important");return true;}
function sync(){if(!button)return;const out=sniperOut(),grav=false;if(!out&&globalThis.__arondightScopeToggle)globalThis.__arondightScopeToggle=false;const show=(out||grav)&&touchPlay()&&place();button.classList.toggle("show",Boolean(show));
  const on=grav?Boolean(globalThis.__arondightGravityGun?.holding):Boolean(globalThis.__arondightScopeToggle),html=grav?(on?"<b>✋</b>DROP":"<b>⊛</b>GRAB"):"<b>◎</b>SCOPE";if(button.dataset.html!==html){button.dataset.html=html;button.innerHTML=html;}button.classList.toggle("on",on);}
export function installSniperScope(){if(installed||typeof document==="undefined")return;installed=true;const boot=()=>{if(!mount()){setTimeout(boot,300);return;}const loop=()=>{try{sync();}catch(e){console.warn("sniper scope",e);}setTimeout(loop,150);};loop();};boot();}
installSniperScope();
