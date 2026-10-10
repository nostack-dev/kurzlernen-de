// Hand grenades, cooked like real ones. Pressing the grenade button pulls the pin and lets the
// spoon fly: the 4 s fuse is burning from that moment (you see the count and hear the ticks).
// Release to throw — the longer you cooked, the less time they have to run. Hold it too long and
// it goes off in your hand. Thrown, it is a physical body (bounces, rolls, never goes off on
// contact) until the fuse burns down.
//
//   Touch: the round button above the left stick — press = pull, drag up/down = throw strength,
//          let go = throw.   Desktop: hold T, release to throw.   Pad: hold LB, release.
// You carry 3; one comes back every 20 s.
export const HAND_GRENADE_VERSION="cooked-hand-grenade-v1";
const FUSE_MS=4000,MAX_CARRY=3,REGEN_MS=20000,DRAG_PX=110;
let installed=false,btn=null,cooking=null,carry=MAX_CARRY,regenAt=0,lastTick=0,padLB=false,keyT=false;
const $=id=>document.getElementById(id);
const bridge=()=>globalThis.__arondightRealWorld||null;
const walk=()=>globalThis.__arondightWalkMode||null;
function canUse(){const w=walk();return w?.mode==="foot"&&!w.dead&&!globalThis.__arondightVehicleDrive?.active&&!globalThis.__jetMode?.active;}
function camera(){const b=bridge();return b?.presentedCamera?.()||b?.threeCamera||null;}
function sfx(fn){const a=globalThis.__sharedAudioContext;if(!a||a.state!=="running")return;try{fn(a,a.currentTime);}catch{}}
function pinSound(){sfx((a,t)=>{for(const[f,d,g]of[[3100,.09,.16],[4700,.05,.08]]){const o=a.createOscillator(),k=a.createGain();o.type="triangle";o.frequency.setValueAtTime(f,t);o.frequency.exponentialRampToValueAtTime(f*.86,t+d);k.gain.setValueAtTime(g,t);k.gain.exponentialRampToValueAtTime(.001,t+d+.05);o.connect(k).connect(a.destination);o.start(t);o.stop(t+d+.08);}
  const o=a.createOscillator(),k=a.createGain();o.type="square";o.frequency.value=900;k.gain.setValueAtTime(.08,t+.16);k.gain.exponentialRampToValueAtTime(.001,t+.2);o.connect(k).connect(a.destination);o.start(t+.16);o.stop(t+.22);});}
function tickSound(urgent){sfx((a,t)=>{const o=a.createOscillator(),k=a.createGain();o.type="square";o.frequency.value=urgent?1500:1100;k.gain.setValueAtTime(urgent?.07:.045,t);k.gain.exponentialRampToValueAtTime(.001,t+.04);o.connect(k).connect(a.destination);o.start(t);o.stop(t+.05);});}
function whoosh(){sfx((a,t)=>{const n=a.createBuffer(1,a.sampleRate*.25,a.sampleRate),d=n.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=(Math.random()*2-1)*Math.sin(Math.PI*i/d.length);const s=a.createBufferSource(),f=a.createBiquadFilter(),k=a.createGain();s.buffer=n;f.type="bandpass";f.frequency.setValueAtTime(600,t);f.frequency.exponentialRampToValueAtTime(1800,t+.2);k.gain.value=.22;s.connect(f).connect(k).connect(a.destination);s.start(t);});}

export function pull(source="touch"){if(cooking||!canUse()||carry<=0)return false;carry--;if(!regenAt)regenAt=performance.now()+REGEN_MS;cooking={at:performance.now(),power:.7,source};lastTick=0;pinSound();render();const v=$("viewport");if(v)v.dataset.handGrenade="cooking";return true;}
function hand(){const c=camera(),w=walk();if(!c)return null;const f=c.getWorldDirection(c.position.clone()).setZ(0);if(f.lengthSq()<1e-6)f.set(1,0,0);f.normalize();const right={x:f.y,y:-f.x};return{c,origin:[c.position.x+f.x*.45+right.x*.2,c.position.y+f.y*.45+right.y*.2,c.position.z-.12],w};}
export function release(){if(!cooking)return false;const ck=cooking;cooking=null;const h=hand(),api=globalThis.__arondightFootWeapons;if(!h||!api?.throwHandGrenade){render();return false;}
  const dir=h.c.getWorldDirection(h.c.position.clone());dir.z+=.26;dir.normalize();const speed=9+13*Math.max(0,Math.min(1,ck.power)),J=globalThis.__arondightWalkJump||{},vel=[dir.x*speed+(Number(J.vx)||0),dir.y*speed+(Number(J.vy)||0),dir.z*speed];
  const ok=api.throwHandGrenade({origin:h.origin,velocity:vel,fuseAt:ck.at+FUSE_MS,source:`hand-grenade:${ck.source}`});if(ok){whoosh();window.dispatchEvent(new CustomEvent("arondight:weapon-fired",{detail:{weapon:"hand-grenade",intensity:.2,source:ck.source,mode:"foot"}}));}
  const v=$("viewport");if(v){v.dataset.handGrenade="thrown";v.dataset.handGrenadeThrows=String((Number(v.dataset.handGrenadeThrows)||0)+1);v.dataset.handGrenadeCookedMs=String(Math.round(performance.now()-ck.at));}render();return ok;}
// cooked too long, or the thrower died holding it: it goes off right there
function cookOff(reason){const ck=cooking;cooking=null;const h=hand();if(h){if(reason==="dropped")globalThis.__arondightFootWeapons?.throwHandGrenade?.({origin:[h.origin[0],h.origin[1],h.origin[2]-1],velocity:[0,0,-1],fuseAt:ck.at+FUSE_MS,source:"hand-grenade:dropped"});else globalThis.__arondightFootWeapons?.explodeAt?.(h.origin,"hand-grenade:cooked-off");}const v=$("viewport");if(v)v.dataset.handGrenade=reason;render();}

function ensureButton(){const v=$("viewport");if(!v)return null;if(btn?.isConnected)return btn;btn=document.createElement("button");btn.id="handGrenadeBtn";btn.type="button";btn.setAttribute("aria-label","Hand grenade: press to pull the pin, release to throw");btn.innerHTML='<svg viewBox="0 0 64 64" aria-hidden="true"><circle class="ring" cx="32" cy="32" r="29"/><circle class="fuse" cx="32" cy="32" r="29"/></svg><b>●</b><small>GRANATE</small><i></i>';v.appendChild(btn);
  const st=document.createElement("style");st.dataset.handGrenade=HAND_GRENADE_VERSION;st.textContent=`
#handGrenadeBtn{position:absolute;z-index:23;display:none;width:64px;height:64px;margin:0;padding:0;border-radius:50%!important;border:0;background:#1c2414d8;color:#e9f2d8;touch-action:none;box-shadow:0 6px 16px #0007;flex-direction:column;align-items:center;justify-content:center;gap:0;user-select:none;-webkit-user-select:none}
#handGrenadeBtn.show{display:flex}#handGrenadeBtn svg{position:absolute;inset:0;width:100%;height:100%;transform:rotate(-90deg)}#handGrenadeBtn .ring{fill:none;stroke:#ffffff55;stroke-width:3}#handGrenadeBtn .fuse{fill:none;stroke:#ff8a2a;stroke-width:4;stroke-dasharray:182.2;stroke-dashoffset:182.2}
#handGrenadeBtn b{font:900 20px/1 system-ui,sans-serif;color:#7d8f4e;position:relative}#handGrenadeBtn small{font:800 7.5px/1 system-ui,sans-serif;letter-spacing:.08em;position:relative;margin-top:2px}#handGrenadeBtn i{position:absolute;right:-4px;top:-4px;min-width:18px;height:18px;border-radius:9px;background:#ffd76a;color:#111;font:900 11px/18px system-ui,sans-serif;font-style:normal;text-align:center}
#handGrenadeBtn.cooking{background:#3a1c0ce8;transform:scale(1.08)}#handGrenadeBtn.cooking b{color:#fff;font-size:22px}#handGrenadeBtn.empty{opacity:.45}#handGrenadeBtn.urgent{animation:hgPulse .25s infinite alternate}@keyframes hgPulse{to{box-shadow:0 0 0 6px #ff3b1f88}}`;document.head.appendChild(st);
  let pid=null,startX=0,startY=0;
  btn.addEventListener("pointerdown",e=>{e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();if(pid!==null||!pull("touch"))return;pid=e.pointerId;startX=e.clientX;startY=e.clientY;try{btn.setPointerCapture(pid);}catch{}},{capture:true});
  btn.addEventListener("pointermove",e=>{if(e.pointerId!==pid||!cooking)return;const rot=$("viewport")?.dataset.soloOrientation==="css-landscape",d=rot?e.clientX-startX:startY-e.clientY; /* drag "up" in the game's frame = stronger throw */cooking.power=Math.max(0,Math.min(1,.7+d/DRAG_PX*.6));e.preventDefault();e.stopPropagation();},{capture:true});
  const up=e=>{if(e.pointerId!==pid)return;pid=null;e.preventDefault();e.stopPropagation();release();};btn.addEventListener("pointerup",up,{capture:true});btn.addEventListener("pointercancel",up,{capture:true});btn.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();});
  return btn;}
// above the left (move) stick, in the viewport's own unrotated coordinates (portrait turns it by CSS)
function visibleRect(el){if(!el||!el.offsetParent)return null;const v=$("viewport");let x=0,y=0,n=el;while(n&&n!==v){x+=n.offsetLeft;y+=n.offsetTop;n=n.offsetParent;}if(n!==v)return null;const w=el.offsetWidth,h=el.offsetHeight;return w>0&&h>0?{left:x,top:y,width:w,height:h}:null;}
function touchPlay(){const b=document.body;return!b.classList.contains("desktop-input")&&!b.classList.contains("player-driving")&&!b.classList.contains("jet-mode")&&b.classList.contains("on-foot-mode");}
function place(){const b=ensureButton();if(!b)return;const stick=visibleRect($("footMove")),on=touchPlay()&&canUse()&&stick;b.classList.toggle("show",Boolean(on));if(!on)return;const l=`${Math.round(stick.left+stick.width-38)}px`,t=`${Math.round(Math.max(8,stick.top-66))}px`; /* over the stick's upper right: clear of the strike button and the HUD */if(b.style.left!==l)b.style.setProperty("left",l,"important");if(b.style.top!==t)b.style.setProperty("top",t,"important");}
function render(){const b=ensureButton();if(!b)return;const now=performance.now(),left=cooking?Math.max(0,FUSE_MS-(now-cooking.at)):0;b.classList.toggle("cooking",Boolean(cooking));b.classList.toggle("urgent",Boolean(cooking)&&left<1200);b.classList.toggle("empty",!cooking&&carry<=0);
  b.querySelector("b").textContent=cooking?(left/1000).toFixed(1):"●";b.querySelector("i").textContent=String(carry);b.querySelector(".fuse").style.strokeDashoffset=String(cooking?182.2*(1-left/FUSE_MS):182.2);}
function frame(){requestAnimationFrame(frame);const now=performance.now();
  if(carry<MAX_CARRY&&regenAt&&now>=regenAt){carry++;regenAt=carry<MAX_CARRY?now+REGEN_MS:0;render();}
  if(cooking){const held=now-cooking.at;if(!canUse()){cookOff("dropped");return;}if(held>=FUSE_MS){cookOff("cooked-off");return;}const sec=Math.floor(held/1000);if(sec>lastTick-1&&held-lastTick*1000>=0){lastTick=sec+1;tickSound(FUSE_MS-held<1200);}render();}
  // pad: LB held = cooking, released = throw
  const pad=(()=>{if(globalThis.__arondightPadBlocked?.())return null;for(const p of navigator.getGamepads?.()||[])if(p?.connected)return p;return null;})(),lb=Boolean(pad?.buttons?.[4]?.pressed);if(lb&&!padLB&&canUse())pull("pad");else if(!lb&&padLB&&cooking?.source==="pad")release();padLB=lb;}
export function installHandGrenade(){if(installed||typeof window==="undefined")return;installed=true;addEventListener("arondight:world-reset",()=>{cooking=null;carry=MAX_CARRY;regenAt=0;render();});
  addEventListener("keydown",e=>{if(e.code!=="KeyT"||e.repeat||e.metaKey||e.ctrlKey||e.altKey)return;if(pull("keyboard")){keyT=true;e.preventDefault();}});addEventListener("keyup",e=>{if(e.code==="KeyT"&&keyT){keyT=false;if(cooking?.source==="keyboard")release();}});
  setInterval(place,250);requestAnimationFrame(frame);globalThis.__arondightHandGrenade={pull,release,get cooking(){return cooking?{msLeft:Math.max(0,FUSE_MS-(performance.now()-cooking.at)),power:cooking.power}:null;},get carry(){return carry;},version:HAND_GRENADE_VERSION};}
installHandGrenade();
