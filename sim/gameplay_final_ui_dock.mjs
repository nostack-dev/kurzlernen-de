let installed=false;
function dock(){const button=document.getElementById("droneWeaponToggle"),top=document.getElementById("soloTopbarActions")||document.getElementById("soloTopbar");if(!button||!top)return false;if(button.parentElement!==top)top.appendChild(button);button.classList.add("final-drone-weapon-topbar");return true;}
function installStyle(){if(document.querySelector("style[data-final-drone-weapon-dock]"))return;const style=document.createElement("style");style.dataset.finalDroneWeaponDock="v1";style.textContent=`#soloTopbarActions #droneWeaponToggle,#soloTopbar #droneWeaponToggle{position:static!important;inset:auto!important;transform:none!important;min-width:92px!important;width:auto!important;height:30px!important;padding:0 8px!important;margin:0!important;flex:0 1 auto!important;font-size:8px!important;z-index:auto!important}body.on-foot-mode #droneWeaponToggle{display:none!important}`;document.head.appendChild(style);}
function frame(){dock();requestAnimationFrame(frame);}
export function installGameplayFinalUiDock(){if(installed)return;installed=true;installStyle();requestAnimationFrame(frame);}
installGameplayFinalUiDock();
