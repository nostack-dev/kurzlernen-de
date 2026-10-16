// The sniper's scope as you see it through the glass: everything outside the round field of view
// is the black of the scope tube, a mil-dot reticle in the middle, a thin red centre dot. Shown
// while scoped (RMB / LT held, or the SCOPE button on touch — first_person_controller_v5.mjs
// owns the zoom). On touch a round SCOPE button appears next to the weapon switch while the
// sniper is out: tap to look through the scope, tap again to come back; a tap on the screen
// while scoped fires through the crosshair.
// The scope is only ever on while you stand on foot with the sniper out, alive, in a running game
// with the page visible: every way out of that state (mode switch to drone / car / jet, death, game
// reset or exit, weapon switch, hidden tab, rotation or a big resize, an input change) takes you out
// of it at once — overlay gone, zoom 1 (walk FOV and look speed back), body classes removed. A
// per-frame guard backs the events up, so no path can leave the overlay hanging.
export const SNIPER_SCOPE_VERSION="sniper-scope-v2-hard-exit";
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
  button.addEventListener("pointerdown",e=>{e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();if(globalThis.__arondightScopeToggle)globalThis.__arondightScopeToggle=false;/* your own tap: the eye comes off the scope as usual */else if(scopeEligible())globalThis.__arondightScopeToggle=true;sync();},{capture:true});
  button.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();});
  return true;}
// beside the weapon switch (thumb_layout.mjs places that one left of the look stick): above it
function place(){const w=$("thumbWeapon");if(!w||!w.classList.contains("show"))return false;const l=parseFloat(w.style.left),t=parseFloat(w.style.top);if(!Number.isFinite(l)||!Number.isFinite(t))return false;const L=`${Math.round(l)}px`,T=`${Math.round(t-66)}px`; /* straight above the weapon switch, low by the thumb */if(button.style.left!==L)button.style.setProperty("left",L,"important");if(button.style.top!==T)button.style.setProperty("top",T,"important");return true;}
function readout(){if(!overlay||!document.body.classList.contains("scope-active"))return;const b=globalThis.__arondightRealWorld,c=b?.presentedCamera?.()||b?.threeCamera,el=overlay.querySelector(".ss-range");if(!c||!el)return;const ads=Number(globalThis.__arondightAds?.zoom),z=Math.max(1,Math.round(ads>1?ads:74/Math.max(1,c.fov)));/* the true magnification, not FOV ratio */const t=`${z}×`;if(el.textContent!==t)el.textContent=t;}
function gameRunning(){const b=document.body;if(!b.classList.contains("solo-flight"))return false;const menu=$("gameMenu");return!(menu&&!menu.hidden&&menu.offsetParent);}
// may the scope be on right now?
export function scopeEligible(){const w=globalThis.__arondightWalkMode;if(!w||w.mode!=="foot"||w.dead)return false;if(globalThis.__jetMode?.active||globalThis.__arondightVehicleDrive?.active)return false;if(String(globalThis.__arondightFootWeapons?.mode||"")!=="sniper")return false;if(typeof document!=="undefined"&&document.hidden)return false;return gameRunning();}
let lastExit={reason:"",at:0},unplacedSince=0;
// out of the scope, now: toggle off, the controller's sights reset (zoom 1, classes off), button off
export function exitScope(reason="exit"){const b=document.body,was=Boolean(globalThis.__arondightScopeToggle)||b.classList.contains("scope-active")||Number(globalThis.__arondightAds?.zoom)>1;globalThis.__arondightScopeToggle=false;unplacedSince=0;
  let reset=false;try{reset=Boolean(globalThis.__arondightFirstPersonController?.resetAds?.(reason));}catch{}
  if(!globalThis.__arondightFirstPersonController?.resetAds){globalThis.__arondightAds={t:0,zoom:1,scoped:false};}
  b.classList.remove("scope-active","ads-active");if(button){button.classList.remove("on");}
  if(was||reset){lastExit={reason:String(reason),at:Math.round(performance.now())};const v=$("viewport");if(v){v.dataset.sniperScopeExit=lastExit.reason;v.dataset.sniperScopeExits=String((Number(v.dataset.sniperScopeExits)||0)+1);}}
  return was||reset;}
function scopeEngaged(){return Boolean(globalThis.__arondightScopeToggle)||document.body.classList.contains("scope-active")||Number(globalThis.__arondightAds?.zoom)>1.0001&&String(globalThis.__arondightFootWeapons?.mode||"")==="sniper";}
// per-frame guard: the scope never outlives its state, whatever path changed it
let guardMode="",guardWeapon="";
function guard(){requestAnimationFrame(guard);try{const w=globalThis.__arondightWalkMode,mode=`${w?.mode||""}|${w?.dead?"dead":""}|${globalThis.__jetMode?.active?"jet":""}|${globalThis.__arondightVehicleDrive?.active?"car":""}`,weapon=String(globalThis.__arondightFootWeapons?.mode||"");
  if(guardMode&&mode!==guardMode&&scopeEngaged())exitScope("mode-change");else if(guardWeapon&&weapon!==guardWeapon&&scopeEngaged())exitScope("weapon-switch");guardMode=mode;guardWeapon=weapon;
  if(scopeEngaged()&&!scopeEligible())exitScope("not-eligible");
  // the touch toggle belongs to touch play: with mouse (RMB) or pad (LT) it must not keep the scope up
  if(globalThis.__arondightScopeToggle&&!touchPlay())exitScope("input-change");}catch(e){console.warn("sniper scope guard",e);}}
let lastW=0,lastH=0;
function onResize(){const w=innerWidth,h=innerHeight;if(!lastW){lastW=w;lastH=h;return;}const flipped=(w>h)!==(lastW>lastH),big=Math.abs(w-lastW)/Math.max(1,lastW)>.2||Math.abs(h-lastH)/Math.max(1,lastH)>.2;lastW=w;lastH=h;if((flipped||big)&&scopeEngaged())exitScope(flipped?"rotate":"resize");}
function installExits(){const out=reason=>()=>{if(scopeEngaged())exitScope(reason);};
  addEventListener("arondight:player-mode",out("player-mode"),{capture:true});addEventListener("arondight:vehicle-mode",out("vehicle-mode"),{capture:true});
  addEventListener("arondight:game-reset",out("game-reset"));addEventListener("arondight:world-reset",out("world-reset"));addEventListener("arondight:game-start",out("game-start"));
  addEventListener("arondight:player-damage",()=>{if(globalThis.__arondightWalkMode?.dead&&scopeEngaged())exitScope("death");});
  document.addEventListener("visibilitychange",()=>{if(document.hidden&&scopeEngaged())exitScope("hidden");},{capture:true});addEventListener("pagehide",out("pagehide"));addEventListener("blur",()=>{/* desktop: RMB release is lost with the focus */if(!touchPlay()&&scopeEngaged())exitScope("blur");});
  addEventListener("orientationchange",out("orientation"));try{screen.orientation?.addEventListener?.("change",out("orientation"));}catch{}addEventListener("resize",onResize);lastW=innerWidth;lastH=innerHeight;
  requestAnimationFrame(guard);}
function sync(){try{readout();}catch{}if(!button)return;const out=sniperOut()&&scopeEligible(),grav=false;if(!out&&globalThis.__arondightScopeToggle)exitScope("not-eligible");const placed=(out||grav)&&touchPlay()&&place(),show=placed;button.classList.toggle("show",Boolean(show));
  // a scoped touch player always has the button to come back out: if it cannot be placed (rotation, layout change) the scope goes
  if(globalThis.__arondightScopeToggle&&!placed){const now=performance.now();if(!unplacedSince)unplacedSince=now;else if(now-unplacedSince>350)exitScope("no-button");}else unplacedSince=0;
  const on=grav?Boolean(globalThis.__arondightGravityGun?.holding):Boolean(globalThis.__arondightScopeToggle),html=grav?(on?"<b>✋</b>DROP":"<b>⊛</b>GRAB"):"<b>◎</b>SCOPE";if(button.dataset.html!==html){button.dataset.html=html;button.innerHTML=html;}button.classList.toggle("on",on);}
export function installSniperScope(){if(installed||typeof document==="undefined")return;installed=true;globalThis.__arondightSniperScope={exit:exitScope,eligible:scopeEligible,get lastExit(){return{...lastExit};},version:SNIPER_SCOPE_VERSION};installExits();const boot=()=>{if(!mount()){setTimeout(boot,300);return;}const loop=()=>{try{sync();}catch(e){console.warn("sniper scope",e);}setTimeout(loop,150);};loop();};boot();}
installSniperScope();
