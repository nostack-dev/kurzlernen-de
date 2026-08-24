let installed=false,weaponLatch=false;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number(v)||0));
function viewport(){return document.getElementById("viewport");}
function bridge(){return globalThis.__arondightRealWorld||null;}
function drive(){return globalThis.__arondightVehicleDrive||null;}
function walk(){return globalThis.__arondightWalkMode||null;}
function standardPad(){return Array.from(navigator.getGamepads?.()||[]).find(p=>p?.connected&&(p.mapping==="standard"||/xbox|xinput|045e/i.test(String(p.id||""))))||null;}
function buttonValue(pad,index){const b=pad?.buttons?.[index];return clamp(typeof b==="number"?b:(b?.value??(b?.pressed?1:0)),0,1);}
function switchWeapon(){if(drive()?.active)return false;const foot=walk()?.mode==="foot",button=document.getElementById(foot?"footWeaponToggle":"droneWeaponToggle");if(!button||button.hidden)return false;button.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,cancelable:true,pointerId:-15,pointerType:"mouse",button:0,buttons:1}));const view=viewport();if(view){view.dataset.weaponSwitchGamepad="dpad-right-v1";view.dataset.weaponSwitchInputs="touch+keyboard-q+xbox-dpad-right-v1";}return true;}
function pollGamepad(){const pad=standardPad(),pressed=buttonValue(pad,15)>.55;if(pressed&&!weaponLatch)switchWeapon();weaponLatch=pressed;requestAnimationFrame(pollGamepad);}
function falloff(distance,radius){const x=clamp(1-distance/Math.max(.1,radius),0,1);return x*x*(3-2*x);}
function blastVs(event){const b=bridge(),mesh=b?.vsPeerMesh,register=b?.registerVsHit;if(!mesh||typeof register!=="function"||mesh.visible===false)return;const p=event?.detail?.position;if(!Array.isArray(p)||p.length<3)return;const pos={x:0,y:0,z:0};mesh.getWorldPosition?.(pos);const radius=clamp(event.detail?.radiusM??8,2,18),distance=Math.hypot((Number(pos.x)||0)-(Number(p[0])||0),(Number(pos.y)||0)-(Number(p[1])||0),(Number(pos.z)||0)-(Number(p[2])||0));if(distance>=radius)return;const strength=falloff(distance,radius),hits=Math.min(5,Math.max(1,Math.ceil(strength*4))),point=mesh.position?.clone?.()||pos;for(let i=0;i<hits;i++)register.call(b,{object:mesh,point});const view=viewport();if(view){view.dataset.explosionVsRouting="radial-v1";view.dataset.explosionVsHits=String((Number(view.dataset.explosionVsHits)||0)+hits);}}
export function installGameplayFinalInputExtras(){if(installed)return;installed=true;addEventListener("arondight:world-explosion",blastVs);requestAnimationFrame(pollGamepad);}
installGameplayFinalInputExtras();
