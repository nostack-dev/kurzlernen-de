let installed=false;

const ROTATED_POINTER_TARGETS="#footMove,#footLook,#footLookZone";
const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));

function viewport(){return document.getElementById("viewport");}
function walk(){return globalThis.__arondightWalkMode||null;}
function footWeapons(){return globalThis.__arondightFootWeapons||null;}
function droneWeapons(){return globalThis.__arondightDroneWeapons||null;}
function cssLandscape(){return viewport()?.dataset?.soloOrientation==="css-landscape";}

function remapRotatedPointer(event){
  if(event.pointerType==="mouse"||!cssLandscape()||event.__arondightLogicalPointer===true)return;
  const target=event.target?.closest?.(ROTATED_POINTER_TARGETS);if(!target)return;
  const rect=target.getBoundingClientRect(),cx=rect.left+rect.width/2,cy=rect.top+rect.height/2;
  const screenX=event.clientX-cx,screenY=event.clientY-cy;
  const logicalX=cx+screenY,logicalY=cy-screenX;
  try{
    Object.defineProperty(event,"clientX",{configurable:true,value:logicalX});
    Object.defineProperty(event,"clientY",{configurable:true,value:logicalY});
    Object.defineProperty(event,"__arondightLogicalPointer",{configurable:true,value:true});
    const view=viewport();if(view){view.dataset.walkPortraitInput="screen-to-logical-quarter-turn-v1";view.dataset.walkPortraitPointer=`${event.type}:${target.id}`;}
  }catch(error){const view=viewport();if(view)view.dataset.walkPortraitInput=`failed:${error?.name||"error"}`;}
}

function installPointerContract(){
  for(const type of["pointerdown","pointermove","pointerup","pointercancel"])document.addEventListener(type,remapRotatedPointer,{capture:true,passive:false});
}

function installStyle(){
  if(document.querySelector("style[data-mobile-gameplay-ui]"))return;
  const style=document.createElement("style");style.dataset.mobileGameplayUi="compact-v1";style.textContent=`
#mobileGameplayDock{display:none}
body.mobile-gameplay-compact.solo-flight #mobileGameplayDock{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:5px;position:absolute;top:max(5px,var(--solo-safe-top,env(safe-area-inset-top)));left:50%;transform:translateX(-50%);width:min(calc(100% - 18px),430px);z-index:46;pointer-events:auto;padding:4px;border:1px solid #7cccfb42;border-radius:12px;background:#071522e8;box-shadow:0 7px 24px #0008;backdrop-filter:blur(8px)}
body.mobile-gameplay-compact.solo-flight #mobileGameplayDock button{min-width:0;min-height:38px;margin:0;padding:5px 7px;border-radius:9px;font:900 9px/1.05 system-ui,-apple-system,sans-serif;letter-spacing:.035em;white-space:normal;overflow:hidden;text-overflow:ellipsis;touch-action:manipulation}
body.mobile-gameplay-compact.solo-flight #mobileGameplayMode{background:#123b57!important;border-color:#5fc7ff88!important}
body.mobile-gameplay-compact.solo-flight #mobileGameplayStart{background:#17694f!important;border-color:#63e7b8!important;color:#fff!important}
body.mobile-gameplay-compact.solo-flight #mobileGameplayStart[data-state="armed"]{background:#7d2635!important;border-color:#ff8795!important}
body.mobile-gameplay-compact.solo-flight #mobileGameplayWeapon{background:#473312!important;border-color:#ffc56d88!important}
body.mobile-gameplay-compact.solo-flight #mobileGameplayMenu{background:#202d42!important}
body.mobile-gameplay-compact.solo-flight #soloTopbar{top:calc(max(5px,var(--solo-safe-top,env(safe-area-inset-top))) + 47px)!important;width:min(calc(100% - 18px),560px)!important;gap:2px!important}
body.mobile-gameplay-compact.solo-flight #soloTopbarActions{display:none!important;flex-wrap:wrap!important;gap:4px!important;justify-content:center!important;padding:5px!important}
body.mobile-gameplay-compact.mobile-gameplay-menu.solo-flight #soloTopbarActions{display:flex!important}
body.mobile-gameplay-compact.solo-flight #soloTopbarActions :is(#playerModeButton,#soloArmToolbar,#droneWeaponToggle){display:none!important}
body.mobile-gameplay-compact.solo-flight #soloTopbarStatus{min-height:18px!important;gap:3px!important}
body.mobile-gameplay-compact.solo-flight #soloTopbarStatus>span{min-height:18px!important;padding:3px 6px!important;font-size:8px!important}
body.mobile-gameplay-compact.solo-flight.on-foot-mode #soloTopbarStatus{display:none!important}
body.mobile-gameplay-compact.solo-flight #soloArm{display:none!important}
body.mobile-gameplay-compact.solo-flight #soloKill{left:50%!important;right:auto!important;transform:translateX(-50%)!important;width:112px!important;height:38px!important;bottom:max(13px,var(--solo-safe-bottom,env(safe-area-inset-bottom)))!important;background:#712535e8!important;border-color:#ff8092aa!important;font-size:9px!important;letter-spacing:.045em!important}
body.mobile-gameplay-compact.solo-flight.on-foot-mode #soloKill{display:none!important}
body.mobile-gameplay-compact.solo-flight.on-foot-mode #footReadout{display:none!important}
body.mobile-gameplay-compact.solo-flight.on-foot-mode #footHud #footWeaponToggle{display:none!important}
body.mobile-gameplay-compact.solo-flight #droneWeaponToggle{display:none!important}
body.mobile-gameplay-compact.solo-flight #soloLeft>span,body.mobile-gameplay-compact.solo-flight #soloRight>span{font-size:8px!important;letter-spacing:.06em!important}
body.mobile-gameplay-compact.solo-flight #footFire{z-index:20!important}
@media(max-height:360px){body.mobile-gameplay-compact.solo-flight #mobileGameplayDock{width:min(calc(100% - 14px),390px);gap:3px;padding:3px;border-radius:9px}body.mobile-gameplay-compact.solo-flight #mobileGameplayDock button{min-height:34px;padding:4px 5px;font-size:8px}body.mobile-gameplay-compact.solo-flight #soloTopbar{top:calc(max(3px,var(--solo-safe-top,env(safe-area-inset-top))) + 40px)!important}}
  `;document.head.appendChild(style);
}

function compactWanted(){return Boolean((navigator.maxTouchPoints||0)>0||innerWidth<720||innerHeight<520);}
function currentWeaponName(onFoot){const api=onFoot?footWeapons():droneWeapons(),mode=String(api?.mode||"").trim();if(mode)return mode.replaceAll("_"," ").toUpperCase();const source=document.getElementById(onFoot?"footWeaponToggle":"droneWeaponToggle");return String(source?.textContent||"WEAPON").trim().toUpperCase().replace(/^WEAPON\s*[·:-]?\s*/,"")||"WEAPON";}
function clickSource(id){const element=document.getElementById(id);if(!element||element.disabled)return false;element.click();return true;}

function mountDock(){
  const view=viewport();if(!view)return null;let dock=document.getElementById("mobileGameplayDock");if(dock)return dock;
  dock=document.createElement("div");dock.id="mobileGameplayDock";dock.setAttribute("role","toolbar");dock.setAttribute("aria-label","Mobile gameplay controls");dock.innerHTML='<button id="mobileGameplayMode" type="button">MODE</button><button id="mobileGameplayStart" type="button">START</button><button id="mobileGameplayWeapon" type="button">WEAPON</button><button id="mobileGameplayMenu" type="button">MENU</button>';
  view.appendChild(dock);
  const mode=dock.querySelector("#mobileGameplayMode"),start=dock.querySelector("#mobileGameplayStart"),weapon=dock.querySelector("#mobileGameplayWeapon"),menu=dock.querySelector("#mobileGameplayMenu");
  mode.addEventListener("click",event=>{event.preventDefault();event.stopPropagation();clickSource("playerModeButton");document.body.classList.remove("mobile-gameplay-menu");});
  start.addEventListener("click",event=>{event.preventDefault();event.stopPropagation();if(!clickSource("soloArmToolbar"))clickSource("soloArm");});
  weapon.addEventListener("click",event=>{event.preventDefault();event.stopPropagation();const onFoot=walk()?.mode==="foot"||document.body.classList.contains("on-foot-mode");if(!clickSource(onFoot?"footWeaponToggle":"droneWeaponToggle")){const api=onFoot?footWeapons():droneWeapons();api?.toggle?.();}});
  menu.addEventListener("click",event=>{event.preventDefault();event.stopPropagation();document.body.classList.toggle("mobile-gameplay-menu");});
  for(const button of[mode,start,weapon,menu])button.addEventListener("pointerdown",event=>event.stopPropagation());
  return dock;
}

function sync(){
  const compact=compactWanted();document.body.classList.toggle("mobile-gameplay-compact",compact);if(!compact)document.body.classList.remove("mobile-gameplay-menu");
  const dock=mountDock(),view=viewport();if(!dock||!view){requestAnimationFrame(sync);return;}
  const onFoot=walk()?.mode==="foot"||document.body.classList.contains("on-foot-mode"),driving=document.body.classList.contains("player-driving");
  const mode=dock.querySelector("#mobileGameplayMode"),start=dock.querySelector("#mobileGameplayStart"),weapon=dock.querySelector("#mobileGameplayWeapon"),menu=dock.querySelector("#mobileGameplayMenu");
  mode.textContent=driving?"CAR":onFoot?"ON FOOT":"DRONE";mode.disabled=driving;mode.setAttribute("aria-label",driving?"Driving mode active":onFoot?"Switch to drone":"Switch to first person");
  const armSource=document.getElementById("soloArmToolbar"),state=(armSource?.dataset.state||document.getElementById("soloState")?.textContent||"").trim().toLowerCase(),armed=state==="armed",arming=state==="arming"||state.includes("arming");
  start.hidden=onFoot||driving;start.disabled=Boolean(armSource?.disabled)&&!armed;start.dataset.state=armed?"armed":arming?"arming":"disarmed";start.textContent=armed?"DISARM":arming?"ARMING…":"START";start.setAttribute("aria-label",armed?"Disarm drone":"Start and arm drone");
  weapon.disabled=driving;weapon.textContent=`WEAPON · ${currentWeaponName(onFoot)}`;weapon.setAttribute("aria-label",`Switch ${onFoot?"first-person":"drone"} weapon`);
  menu.textContent=document.body.classList.contains("mobile-gameplay-menu")?"CLOSE":"MENU";
  const kill=document.getElementById("soloKill");if(kill&&!onFoot){kill.textContent="EMERGENCY STOP";kill.setAttribute("aria-label","Emergency stop and disarm drone");}
  const left=document.querySelector("#soloLeft>span"),right=document.querySelector("#soloRight>span");if(left)left.textContent="MOVE";if(right)right.textContent="LOOK";
  view.dataset.mobileGameplayUi=compact?"compact-actions-v1":"desktop";view.dataset.mobileGameplayMode=driving?"car":onFoot?"foot":"drone";view.dataset.mobileGameplayWeapon=currentWeaponName(onFoot);
  requestAnimationFrame(sync);
}

export function installMobileGameplayUi(){if(installed)return;installed=true;installStyle();installPointerContract();addEventListener("resize",()=>document.body.classList.toggle("mobile-gameplay-compact",compactWanted()),{passive:true});requestAnimationFrame(sync);}
