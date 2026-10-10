// One HUD frame for every mode (drone, on foot, car, jet) and every input (touch, mouse, pad):
//   * top-left corner: EXIT (asks "back to the main menu?" in a modal), MULTI right next to it,
//   * bottom-left, in reach of the left thumb: the mode switch, labelled with where it takes you
//     ("TO DRONE", "GO ON FOOT", "EJECT"). On touch it sits in the low row right of the move stick
//     (mirroring JUMP / weapon on the right); in the drone the altitude pad moves up above it.
// Positions follow the sticks, safe areas and rotation.
import {openQuitConfirm} from "./quit_confirm.mjs";

export const GAME_EXIT_VERSION="hud-frame-exit-multi-mode-v2";
let installed=false,button=null;
const $=id=>document.getElementById(id);
const viewport=()=>$("viewport");

function ensure(){
  if(button?.isConnected)return button;const view=viewport();if(!view)return null;
  button=document.createElement("button");button.id="gameExitButton";button.type="button";button.textContent="EXIT";button.setAttribute("aria-label","Exit to the main menu");button.hidden=true;
  button.addEventListener("pointerdown",event=>event.stopPropagation());
  button.addEventListener("click",event=>{event.preventDefault();event.stopPropagation();if(!openQuitConfirm())$("soloExit")?.click();});
  view.appendChild(button);return button;
}
function inGame(){const b=document.body;if(!b.classList.contains("solo-flight"))return false;const menu=$("gameMenu");return !(menu&&!menu.hidden&&menu.offsetParent);}
// rectangles in the viewport's own (unrotated) coordinates (portrait turns the viewport by CSS)
function rectOf(el){if(!el||!el.offsetParent)return null;const v=viewport();let x=0,y=0,n=el;while(n&&n!==v){x+=n.offsetLeft;y+=n.offsetTop;n=n.offsetParent;}if(n!==v)return null;const w=el.offsetWidth,h=el.offsetHeight;return w>0&&h>0?{left:x,top:y,width:w,height:h,right:x+w,bottom:y+h}:null;}
function setPx(el,prop,value){const v=value==null?"":`${Math.round(value)}px`;if(el.style.getPropertyValue(prop)!==v){if(v)el.style.setProperty(prop,v,"important");else el.style.removeProperty(prop);}}
function placeModeSwitch(){
  const mode=$("mobileGameplayMode"),view=viewport();if(!mode||!view)return;const touch=!document.body.classList.contains("desktop-input");
  const stick=touch?(rectOf($("footMove"))||rectOf($("soloLeft"))):null;
  if(!stick){for(const p of["left","top"])setPx(mode,p,null);mode.classList.remove("by-stick");return;}
  mode.classList.add("by-stick");const h=mode.offsetHeight||40;
  // low row, just right of the move stick (the left thumb rolls down-right onto it)
  const left=stick.right-6,top=stick.bottom-h-10;setPx(mode,"left",left);setPx(mode,"top",top);
  // drone: the altitude pad sits right of the stick too — lift it above the switch
  const clr=$("soloClearance"),cr=rectOf(clr);if(clr&&cr&&cr.left<left+mode.offsetWidth&&cr.right>left){const want=top-8-cr.height,off=cr.top-(clr.offsetTop||0);clr.style.setProperty("bottom","auto","important");setPx(clr,"top",want-off);}
}
function sync(){
  const b=ensure(),multi=$("mobileGameplayMultiplayer");
  if(b){const visible=inGame();if(b.hidden===visible)b.hidden=!visible;if(multi){multi.classList.remove("split-left");multi.classList.toggle("hud-after-exit",visible);/* MULTI starts right after EXIT, whatever EXIT's width (desktop shows a key hint) */if(visible&&b.offsetWidth){const l=`${b.offsetLeft+b.offsetWidth+6}px`;if(multi.style.getPropertyValue("left")!==l)multi.style.setProperty("left",l,"important");const st=$("mobileGameplayMultiplayerStatus");if(st&&st.style.getPropertyValue("left")!==l)st.style.setProperty("left",l,"important");}}}
  try{placeModeSwitch();}catch{}
  setTimeout(sync,250);
}
const SAFE_L="max(8px,var(--solo-safe-left,env(safe-area-inset-left)))",SAFE_T="max(8px,var(--solo-safe-top,env(safe-area-inset-top)))",SAFE_B="max(12px,var(--solo-safe-bottom,env(safe-area-inset-bottom)))";
const X=":not(#hud-a):not(#hud-b):not(#hud-c):not(#hud-d)"; // outranks the theme's id-chained rules
export function installGameExitButton(){
  if(installed)return;installed=true;
  const style=document.createElement("style");style.dataset.gameExit=GAME_EXIT_VERSION;
  style.textContent=`
html${X} body #viewport #gameExitButton{position:absolute;left:${SAFE_L};top:${SAFE_T};z-index:100003;width:56px;height:36px;min-height:0;margin:0;padding:0!important;display:flex!important;align-items:center;justify-content:center;gap:4px;border-radius:10px!important;border:1.5px solid #ff8a6a99!important;background:#2a1410e0!important;color:#ffe2d8!important;font:900 10px/1 system-ui,-apple-system,sans-serif!important;letter-spacing:.12em!important;pointer-events:auto;touch-action:manipulation;box-shadow:0 4px 12px #0006}
html${X} body #viewport #gameExitButton::before{content:"⟵";font-size:12px;letter-spacing:0}
html${X} body #viewport #gameExitButton[hidden]{display:none!important}
html${X} body.solo-flight #viewport #mobileGameplayMultiplayer.hud-after-exit{display:flex!important;visibility:visible!important;opacity:1!important;position:absolute!important;left:calc(${SAFE_L} + 62px)!important;top:${SAFE_T}!important;height:36px!important;min-height:0!important;width:auto!important;min-width:60px;padding:0 10px!important;align-items:center;justify-content:center;border-radius:10px!important;border-width:1.5px!important;border-right-width:1.5px!important;z-index:100003!important;pointer-events:auto!important}
html${X} body.solo-flight #viewport #mobileGameplayMultiplayerStatus{left:calc(${SAFE_L} + 62px)!important}
html${X} body.desktop-input #gameExitButton::after{content:"ESC";margin-left:3px;padding:0 3px;border:1px solid #ffffff55;border-radius:3px;font:800 8px/1.3 system-ui,sans-serif;letter-spacing:0}
html${X} body.desktop-input #viewport #gameExitButton{width:auto;padding:0 8px!important}
/* mode switch: one pill, bottom-left, all modes */
html${X} body.solo-flight #viewport #mobileGameplayMode.hud-mode-switch{display:flex!important;visibility:visible!important;position:absolute!important;left:${SAFE_L};top:auto;bottom:${SAFE_B};right:auto!important;transform:none!important;z-index:40!important;height:40px!important;min-height:0!important;min-width:96px;width:auto!important;margin:0!important;padding:0 12px!important;align-items:center;justify-content:center;gap:6px;border-radius:20px!important;border:2px solid #7fd3ffcc!important;background:#0e2a3ee6!important;color:#e8f7ff!important;font:900 11px/1 system-ui,-apple-system,sans-serif!important;letter-spacing:.08em!important;white-space:nowrap;pointer-events:auto!important;touch-action:manipulation;box-shadow:0 5px 14px #0007}
html${X} body.solo-flight #viewport #mobileGameplayMode.hud-mode-switch.by-stick{bottom:auto!important}
html${X} body.solo-flight #viewport #mobileGameplayMode.hud-mode-switch::before{content:"⇄";font-size:14px;letter-spacing:0}
html${X} body.solo-flight #viewport #mobileGameplayMode.hud-mode-switch[data-target="drone"]{border-color:#7fd3ffcc!important;background:#0e2a3ee6!important}
html${X} body.solo-flight #viewport #mobileGameplayMode.hud-mode-switch[data-target="foot"]{border-color:#ffd36bcc!important;background:#3a2810e6!important;color:#fff3d2!important}
html${X} body.solo-flight #viewport #mobileGameplayMode.hud-mode-switch[data-current="jet"]{border-color:#ff6a5acc!important;background:#3a1410e6!important}
html${X} body.solo-flight #viewport #mobileGameplayMode.hud-mode-switch:disabled{opacity:.55}
html${X} body.solo-flight #viewport #mobileGameplayMode.hud-mode-switch:active{transform:scale(.95)!important}
html${X} body.desktop-input #viewport #mobileGameplayMode.hud-mode-switch::after{content:"V";margin-left:2px;padding:1px 4px;border:1px solid #ffffff55;border-radius:3px;font:800 9px/1.2 system-ui,sans-serif;letter-spacing:0}
html${X} body.desktop-input.jet-mode #viewport #mobileGameplayMode.hud-mode-switch::after,html${X} body.desktop-input.player-driving #viewport #mobileGameplayMode.hud-mode-switch::after{content:"F"}
html${X} body.pad-input #viewport #mobileGameplayMode.hud-mode-switch::after{content:"↓";margin-left:2px;padding:1px 4px;border:1px solid #ffffff55;border-radius:3px;font:800 9px/1.2 system-ui,sans-serif}
#jetHud .jet-btns [data-a=exit]{display:none!important}
/* the top dock only holds what is left there (weapon on desktop, settings): it sizes to its buttons */
html${X} body.solo-flight #viewport #mobileGameplayDock{grid-template-columns:none!important;grid-auto-flow:column!important;grid-auto-columns:minmax(96px,auto)!important;width:auto!important}`;
  document.head.appendChild(style);sync();
}
installGameExitButton();
