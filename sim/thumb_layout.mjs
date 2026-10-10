// Touch: what you use while playing sits within reach of the thumbs. Phones are held at the
// lower corners; the right thumb sweeps an arc around the look stick, the left one around the
// move stick. Buttons sit LOW on that arc (nothing in the upper screen where you aim and shoot):
// the weapon switch just below-left of the look / right stick, JUMP left of it, and
// "get in" (car, jet) sits above JUMP at the right edge — no reaching into the middle or the
// top of the screen mid-fight. Positions follow the sticks (layout, safe areas, rotation).
export const THUMB_LAYOUT_VERSION="thumb-reach-v3-low";
const STICK_PX=168,CATCH_PX=38; // ~4.5 % smaller than before; the rings sit in the screen corners (tangent to the side and bottom edges)
let btn=null,lastKey="",installed=false;
const $=id=>document.getElementById(id);
// rectangles in the viewport's own (unrotated) coordinates: in portrait the viewport is turned by
// CSS, so screen-space client rects would not map onto its left/top
function visibleRect(el){if(!el||!el.offsetParent)return null;const v=$("viewport");let x=0,y=0,n=el;while(n&&n!==v){x+=n.offsetLeft;y+=n.offsetTop;n=n.offsetParent;}if(n!==v)return null;const w=el.offsetWidth,h=el.offsetHeight;return w>0&&h>0?{left:x,top:y,width:w,height:h,right:x+w,bottom:y+h}:null;}
function touchPlay(){const b=document.body;return b.classList.contains("solo-flight")&&!b.classList.contains("desktop-input")&&!b.classList.contains("player-driving")&&!b.classList.contains("jet-mode");}
function ensure(){const v=$("viewport");if(!v)return null;if(btn?.isConnected)return btn;
  btn=document.createElement("button");btn.id="thumbWeapon";btn.type="button";btn.setAttribute("aria-label","Switch weapon");btn.innerHTML="<b>⇄</b><small></small>";v.appendChild(btn);
  const st=document.createElement("style");st.dataset.thumbLayout=THUMB_LAYOUT_VERSION;st.textContent=`
#thumbWeapon{position:absolute;z-index:23;display:none;width:60px;height:60px;margin:0;padding:0;border-radius:50%;border:2px solid #ffffffaa;background:#2a1d0cd0;color:#fff;touch-action:none;box-shadow:0 6px 16px #0007;flex-direction:column;align-items:center;justify-content:center;gap:1px}
#thumbWeapon b{font:900 18px/1 system-ui,sans-serif}#thumbWeapon small{font:800 8.5px/1 system-ui,sans-serif;letter-spacing:.06em;max-width:54px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
html body #viewport #thumbWeapon{border-radius:50%!important;padding:0!important}#thumbWeapon.show{display:flex}#thumbWeapon:active{transform:scale(.94);background:#4a3212e0}
/* sticks: big, nearly invisible, and they catch the thumb well outside the drawn ring (the touch
   is relative to where it lands, so a wide catch area costs no precision) */
html body:not(.desktop-input) #viewport :is(#footMove,#footLook,#soloLeft,#soloRight){width:${STICK_PX}px!important;height:${STICK_PX}px!important;overflow:visible!important}
html body:not(.desktop-input) #viewport :is(#footMove,#soloLeft){left:var(--solo-safe-left,env(safe-area-inset-left,0px))!important;right:auto!important;bottom:var(--solo-safe-bottom,env(safe-area-inset-bottom,0px))!important;top:auto!important;transform:none!important}
html body:not(.desktop-input) #viewport :is(#footLook,#soloRight){right:var(--solo-safe-right,env(safe-area-inset-right,0px))!important;left:auto!important;bottom:var(--solo-safe-bottom,env(safe-area-inset-bottom,0px))!important;top:auto!important;transform:none!important}
html body:not(.desktop-input) #viewport :is(#footMove,#footLook,#soloLeft,#soloRight)::before{content:"";position:absolute;border-radius:40%;background:transparent;pointer-events:auto}
html body:not(.desktop-input) #viewport :is(#footMove,#soloLeft)::before{top:-${CATCH_PX*2}px;right:-${CATCH_PX*2}px;bottom:-${CATCH_PX}px;left:-${CATCH_PX}px}
html body:not(.desktop-input) #viewport :is(#footLook,#soloRight)::before{top:-${CATCH_PX}px;right:-${CATCH_PX}px;bottom:-${CATCH_PX}px;left:-${CATCH_PX}px}
html body:not(.desktop-input) #viewport :is(#footMove,#footLook,#soloLeft,#soloRight)>span{opacity:0!important}
html body.thumb-weapon:not(.desktop-input) #viewport #mobileGameplayDock #mobileGameplayWeapon,html body.thumb-weapon:not(.desktop-input) #mobileGameplayDock #mobileGameplayWeapon,html body.mobile-gameplay-compact:not(.desktop-input) #viewport #footHud #footWeaponToggle,html body.mobile-gameplay-compact:not(.desktop-input) #viewport #footWeaponToggle,html body.mobile-gameplay-compact:not(.desktop-input) #footWeaponToggle{display:none!important}`;document.head.appendChild(st);
  btn.addEventListener("pointerdown",e=>{e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();$("mobileGameplayWeapon")?.click();setTimeout(sync,60);},{capture:true});
  btn.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();});return btn;}
function place(el,left,top){const l=`${Math.round(left)}px`,t=`${Math.round(top)}px`;if(el.style.left!==l)el.style.setProperty("left",l,"important");if(el.style.top!==t)el.style.setProperty("top",t,"important");}
function sync(){
  const b=ensure();if(!b)return;const on=touchPlay(),stick=visibleRect($("footLook"))||visibleRect($("soloRight"));
  if(!on||!stick){b.classList.remove("show");document.body.classList.remove("thumb-weapon");return;}
  document.body.classList.add("thumb-weapon"); // the thumb button is THE weapon switch on touch: the dock copy goes
  // low on the screen, out of the shooting area: weapon just below-left of the right stick (the thumb
  // rolls down-left onto it), JUMP left of the stick slightly above its centre line
  const scx=stick.left+stick.width/2,scy=stick.top+stick.height/2,wa=198*Math.PI/180,wr=stick.width/2+12+30;
  place(b,scx+Math.cos(wa)*wr-30,scy-Math.sin(wa)*wr-30);b.classList.add("show");
  const label=String($("mobileGameplayWeapon")?.textContent||"").replace(/^WEAPON\s*·\s*/i,"").trim();if(label!==lastKey){lastKey=label;b.querySelector("small").textContent=label;}
  // drone: the altitude pad sits right of the (bigger) left stick, never on it
  const ls=visibleRect($("soloLeft")),clr=$("soloClearance"),cr=visibleRect(clr);if(ls&&cr&&cr.left<ls.right+10){clr.style.setProperty("right","auto","important");clr.style.setProperty("transform","none","important");const v=$("viewport"),off=cr.left-(clr.offsetLeft||0);clr.style.setProperty("left",`${Math.round(ls.right+10-off)}px`,"important");}
  // JUMP: on the arc just up-left of the look stick, where the right thumb rolls off it
  // JUMP: in the same low row, just left of the weapon switch
  const jumpEl=$("footJump"),jr=visibleRect(jumpEl);if(jumpEl&&jr){const wl=parseFloat(b.style.left),wt=parseFloat(b.style.top);
    jumpEl.style.setProperty("transform","none","important");jumpEl.style.setProperty("right","auto","important");jumpEl.style.setProperty("bottom","auto","important");place(jumpEl,wl-12-jr.width,wt+30-jr.height/2);}
  // get in (car / jet): above JUMP at the right edge
  const jump=visibleRect($("footJump"));for(const id of["enterCarButton","enterJetButton"]){const el=$(id),r=visibleRect(el);if(!el||!r)continue;const right=jump?jump.left+r.width:stick.left-10,top=(jump?jump.top:stick.top)-r.height-10; // above the JUMP / weapon row, clear of the stick
    el.style.setProperty("transform","none","important");el.style.setProperty("right","auto","important");el.style.setProperty("bottom","auto","important");place(el,right-r.width,top);}
}
const live=new Map();
function liveDown(e){if(e.pointerType==="mouse")return;const el=e.target instanceof Element?e.target.closest("#footMove,#footLook,#soloLeft,#soloRight"):null;if(!el)return;live.set(e.pointerId,el);el.classList.add("stick-live");}
function liveUp(e){const el=live.get(e.pointerId);if(!el)return;live.delete(e.pointerId);if(![...live.values()].includes(el))el.classList.remove("stick-live");}
export function installThumbLayout(){if(installed||typeof document==="undefined")return;installed=true;addEventListener("pointerdown",liveDown,{capture:true,passive:true});addEventListener("pointerup",liveUp,{capture:true,passive:true});addEventListener("pointercancel",liveUp,{capture:true,passive:true});const loop=()=>{try{sync();}catch(e){console.warn("thumb layout",e);}setTimeout(loop,200);};loop();addEventListener("resize",()=>setTimeout(sync,50));}
installThumbLayout();
