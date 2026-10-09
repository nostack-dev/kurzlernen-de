// Touch: what you use while playing sits within reach of the thumbs. Phones are held at the
// lower corners; the right thumb sweeps an arc around the look stick, the left one around the
// move stick. So the weapon switch is a round button just left of the look / right stick, and
// "get in" (car, jet) sits above JUMP at the right edge — no reaching into the middle or the
// top of the screen mid-fight. Positions follow the sticks (layout, safe areas, rotation).
export const THUMB_LAYOUT_VERSION="thumb-reach-v1";
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
html body.mobile-gameplay-compact:not(.desktop-input) #viewport #footHud #footWeaponToggle,html body.mobile-gameplay-compact:not(.desktop-input) #viewport #footWeaponToggle,html body.mobile-gameplay-compact:not(.desktop-input) #footWeaponToggle{display:none!important}`;document.head.appendChild(st);
  btn.addEventListener("pointerdown",e=>{e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();$("mobileGameplayWeapon")?.click();setTimeout(sync,60);},{capture:true});
  btn.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();});return btn;}
function place(el,left,top){const l=`${Math.round(left)}px`,t=`${Math.round(top)}px`;if(el.style.left!==l)el.style.setProperty("left",l,"important");if(el.style.top!==t)el.style.setProperty("top",t,"important");}
function sync(){
  const b=ensure();if(!b)return;const on=touchPlay(),stick=visibleRect($("footLook"))||visibleRect($("soloRight"));
  if(!on||!stick){b.classList.remove("show");return;}
  // weapon: left of the right stick, at its centre height (where the thumb rolls to naturally)
  place(b,stick.left-60-14,stick.top+stick.height/2-30+8);b.classList.add("show");
  const label=String($("mobileGameplayWeapon")?.textContent||"").replace(/^WEAPON\s*·\s*/i,"").trim();if(label!==lastKey){lastKey=label;b.querySelector("small").textContent=label;}
  // get in (car / jet): above JUMP at the right edge
  const jump=visibleRect($("footJump"));for(const id of["enterCarButton","enterJetButton"]){const el=$(id),r=visibleRect(el);if(!el||!r)continue;const right=stick.right,top=(jump?jump.top:stick.top)-r.height-10;
    el.style.setProperty("transform","none","important");el.style.setProperty("right","auto","important");el.style.setProperty("bottom","auto","important");place(el,right-r.width,top);}
}
export function installThumbLayout(){if(installed||typeof document==="undefined")return;installed=true;const loop=()=>{try{sync();}catch(e){console.warn("thumb layout",e);}setTimeout(loop,200);};loop();addEventListener("resize",()=>setTimeout(sync,50));}
installThumbLayout();
