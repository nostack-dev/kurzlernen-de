// EMP button placement: small, and never on top of the minimap. It sits in
// the free strip directly left of the minimap (same top edge); when the
// minimap is hidden or expanded it falls back to the top-right corner under
// the RESET button. Positioned from the real minimap rectangle, so it also
// follows portrait/landscape and safe-area changes.

export const EMP_LAYOUT_VERSION="emp-left-of-minimap-v1";
const GAP=8,W=62,H=36;
let installed=false,last="";

// Layout-space rectangle relative to the button's offset parent. offset*
// values ignore CSS transforms, so this stays right when the portrait view is
// rotated into landscape (getBoundingClientRect would return screen space).
function rectOf(el,host){
  if(!el||el.hidden)return null;const cs=getComputedStyle(el);if(cs.display==="none"||cs.visibility==="hidden"||!el.offsetWidth||!el.offsetHeight)return null;
  let x=0,y=0,n=el;while(n&&n!==host){x+=n.offsetLeft;y+=n.offsetTop;n=n.offsetParent;}if(n!==host)return null;
  return{left:x,top:y,right:x+el.offsetWidth,bottom:y+el.offsetHeight,width:el.offsetWidth,height:el.offsetHeight};
}
function place(){
  const button=document.getElementById("wantedEmpButton"),view=document.getElementById("viewport");if(!button||!view)return;
  const host=button.offsetParent||view,hud=document.getElementById("worldLookHud"),map=rectOf(hud,host),expanded=hud?.classList.contains("expanded");
  let left,top;
  if(map&&!expanded){left=map.left-GAP-W;top=map.top;}
  else{const reset=rectOf(document.getElementById("mobileGameplayReset"),host)||rectOf(document.getElementById("soloReset"),host);if(reset){left=reset.right-W;top=reset.bottom+GAP;}else{left=(host.clientWidth||innerWidth)-W-12;top=56;}}
  left=Math.max(8,Math.round(left));top=Math.max(8,Math.round(top));
  const key=`${left},${top}`;if(key===last&&button.dataset.empLayout===EMP_LAYOUT_VERSION)return;last=key;
  for(const[k,v]of[["left",`${left}px`],["top",`${top}px`],["right","auto"],["bottom","auto"]])button.style.setProperty(k,v,"important");
  button.dataset.empLayout=EMP_LAYOUT_VERSION;
}
export function installEmpButtonLayout(){
  if(installed||typeof document==="undefined")return;installed=true;
  const style=document.createElement("style");style.dataset.empLayout=EMP_LAYOUT_VERSION;
  style.textContent=`html #viewport #wantedEmpButton{width:${W}px!important;height:${H}px!important;min-width:${W}px!important;min-height:${H}px!important;padding:2px 4px!important;gap:0!important;border-radius:8px!important;transform:none}
html #viewport #wantedEmpButton strong{font-size:12px!important;line-height:1!important;letter-spacing:.08em!important}
html #viewport #wantedEmpButton small{font-size:6px!important;line-height:1.1!important;max-width:${W-8}px!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important}
html #viewport #wantedEmpButton:not(:disabled):active{transform:scale(.94)}`;
  (document.head||document.documentElement).appendChild(style);
  const tick=()=>{try{place();}catch{}};setInterval(tick,400);window.addEventListener("resize",()=>requestAnimationFrame(tick));tick();
}
installEmpButtonLayout();
