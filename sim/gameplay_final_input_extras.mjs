let installed=false,weaponLatch=false;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number(v)||0));
function viewport(){return document.getElementById("viewport");}
function drive(){return globalThis.__arondightVehicleDrive||null;}
function walk(){return globalThis.__arondightWalkMode||null;}
function standardPad(){return Array.from(navigator.getGamepads?.()||[]).find(p=>p?.connected&&(p.mapping==="standard"||/xbox|xinput|045e/i.test(String(p.id||""))))||null;}
function buttonValue(pad,index){const b=pad?.buttons?.[index];return clamp(typeof b==="number"?b:(b?.value??(b?.pressed?1:0)),0,1);}
function switchWeapon(){if(drive()?.active)return false;const foot=walk()?.mode==="foot",api=foot?globalThis.__arondightFootWeapons:globalThis.__arondightDroneWeapons;if(typeof api?.toggle==="function")api.toggle();else{const button=document.getElementById(foot?"footWeaponToggle":"droneWeaponToggle");if(!button||button.hidden)return false;button.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,cancelable:true,pointerId:-15,pointerType:"mouse",button:0,buttons:1}));}const view=viewport();if(view){view.dataset.weaponSwitchGamepad="dpad-right-v2";view.dataset.weaponSwitchInputs="touch+keyboard-q+xbox-dpad-right-v2";}return true;}
function pollGamepad(){const pad=standardPad(),pressed=buttonValue(pad,15)>.55;if(pressed&&!weaponLatch)switchWeapon();weaponLatch=pressed;requestAnimationFrame(pollGamepad);}
export function installGameplayFinalInputExtras(){if(installed)return;installed=true;requestAnimationFrame(pollGamepad);}
installGameplayFinalInputExtras();
