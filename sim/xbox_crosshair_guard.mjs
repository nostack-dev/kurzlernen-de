import {XBOX_CONTROL_SCHEMES,loadXboxControlScheme} from "./xbox_gamepad.mjs";

let installed=false,last=false,lastHelp="";
function viewport(){return document.getElementById("viewport");}
function currentPad(){return Array.from(navigator.getGamepads?.()||[]).find(p=>p?.connected&&(p.mapping==="standard"||/xbox|xinput|045e/i.test(String(p.id||""))))||null;}
function buttonValue(gamepad,index){const button=gamepad?.buttons?.[index];return Math.max(0,Math.min(1,Number(typeof button==="number"?button:(button?.value??(button?.pressed?1:0)))||0));}
function helpText(scheme){return scheme===XBOX_CONTROL_SCHEMES.AIM?"LS MOVE · RS STEER · LT/RT ALT −/+ · HOLD LB AIM/LOOK · RB FIRE · A ARM · B KILL · X CAM · Y RESET · VIEW EXIT · MENU SETTINGS":"CLASSIC · LS MOVE · RS STEER · LT/RT ALT −/+ · RB FIRE · A ARM · B KILL · X CAM · Y RESET · VIEW EXIT · MENU SETTINGS";}
function frame(){
  const view=viewport(),scheme=loadXboxControlScheme();let active=scheme===XBOX_CONTROL_SCHEMES.AIM&&view?.dataset.gamepadAim==="1";
  if(document.body.classList.contains("on-foot-mode")&&scheme===XBOX_CONTROL_SCHEMES.AIM)active=buttonValue(currentPad(),4)>.5;
  if(active!==last){last=active;document.body.classList.toggle("xbox-aim-active",active);const cross=view?.querySelector(".xbox-crosshair");cross?.classList.toggle("active",active);if(view)view.dataset.xboxAimCrosshair=active?"1":"0";}
  const text=helpText(scheme),help=document.getElementById("soloGamepadHelp");if(help&&text!==lastHelp){lastHelp=text;help.textContent=text;}
  requestAnimationFrame(frame);
}
export function installXboxCrosshairGuard(){
  if(installed)return;installed=true;const style=document.createElement("style");style.dataset.xboxCrosshairGuard="v4";style.textContent=`body:not(.xbox-aim-active) #viewport .xbox-crosshair{display:none!important}body.xbox-aim-active #viewport .xbox-crosshair{display:block!important}`;document.head.appendChild(style);requestAnimationFrame(frame);
}
installXboxCrosshairGuard();
