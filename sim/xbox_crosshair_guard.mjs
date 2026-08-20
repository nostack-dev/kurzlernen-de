import {XBOX_CONTROL_SCHEMES,loadXboxControlScheme} from "./xbox_gamepad.mjs";

let installed=false,last=false;
function viewport(){return document.getElementById("viewport");}
function currentPad(){return Array.from(navigator.getGamepads?.()||[]).find(p=>p?.connected&&(p.mapping==="standard"||/xbox|xinput|045e/i.test(String(p.id||""))))||null;}
function buttonValue(gamepad,index){const button=gamepad?.buttons?.[index];return Math.max(0,Math.min(1,Number(typeof button==="number"?button:(button?.value??(button?.pressed?1:0)))||0));}
function frame(){
  const view=viewport(),scheme=loadXboxControlScheme();let active=scheme===XBOX_CONTROL_SCHEMES.AIM&&view?.dataset.gamepadAim==="1";
  if(document.body.classList.contains("on-foot-mode")&&scheme===XBOX_CONTROL_SCHEMES.AIM)active=buttonValue(currentPad(),4)>.5;
  if(active!==last){last=active;document.body.classList.toggle("xbox-aim-active",active);const cross=view?.querySelector(".xbox-crosshair");cross?.classList.toggle("active",active);if(view)view.dataset.xboxAimCrosshair=active?"1":"0";}
  requestAnimationFrame(frame);
}
export function installXboxCrosshairGuard(){
  if(installed)return;installed=true;const style=document.createElement("style");style.dataset.xboxCrosshairGuard="v2";style.textContent=`body:not(.xbox-aim-active) #viewport .xbox-crosshair{display:none!important}body.xbox-aim-active #viewport .xbox-crosshair{display:block!important}`;document.head.appendChild(style);requestAnimationFrame(frame);
}
installXboxCrosshairGuard();
