import {spawnWorldPersonRagdoll} from "./world_person_ragdoll.mjs";
import {DRONE_MAX_HP,DRONE_REPLACEMENT_COOLDOWN_MS,PLAYER_MAX_HP,droneReplacementRemainingMs,healthAfterDamage} from "./player_vitals_logic.mjs";

const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));
let installed=false,playerHp=PLAYER_MAX_HP,droneHp=DRONE_MAX_HP,droneDestroyed=false,droneReadyAt=-Infinity,playerDead=false,droneDeathSerial=0,forcedFootTimer=0,hud=null;

function viewport(){return document.getElementById("viewport");}
function bridge(){return globalThis.__arondightRealWorld||null;}
function walk(){return globalThis.__arondightWalkMode||null;}
function currentMode(){return walk()?.mode==="foot"?"foot":"drone";}
function bridgePlayerHp(){const value=Number(bridge()?.vsLocalHealth);return Number.isFinite(value)?clamp(value,0,PLAYER_MAX_HP):null;}
function currentPlayerHp(){return bridgePlayerHp()??playerHp;}

function installHud(){
  const view=viewport();if(!view)return false;
  if(!hud){hud=document.createElement("div");hud.id="playerVitalsHud";hud.setAttribute("role","status");hud.setAttribute("aria-live","polite");hud.innerHTML='<span data-vital="player"><i>PILOT</i><b>100</b></span><span data-vital="drone"><i>DRONE</i><b>100</b></span>';view.appendChild(hud);}
  if(!document.querySelector("style[data-player-vitals]")){const style=document.createElement("style");style.dataset.playerVitals="separate-player-drone-v1";style.textContent=`
#playerVitalsHud{display:none;position:absolute;z-index:18;left:max(12px,var(--solo-safe-left,env(safe-area-inset-left)));top:max(50px,calc(var(--solo-safe-top,env(safe-area-inset-top)) + 44px));min-width:128px;padding:6px 8px;border:1px solid #ffffff28;border-radius:9px;background:#07111ad9;box-shadow:0 5px 18px #0008;color:#f2f8ff;font-family:system-ui,-apple-system,sans-serif;pointer-events:none;backdrop-filter:blur(4px)}body.solo-flight #playerVitalsHud{display:flex;gap:8px}#playerVitalsHud span{display:grid;grid-template-columns:auto auto;gap:5px;align-items:center}#playerVitalsHud i{font:850 7px/1 system-ui;font-style:normal;letter-spacing:.08em;color:#92a9b9}#playerVitalsHud b{font:950 10px/1 system-ui;font-variant-numeric:tabular-nums}#playerVitalsHud [data-vital="player"] b{color:#9cf0c9}#playerVitalsHud [data-vital="drone"] b{color:#8edcff}#playerVitalsHud[data-player-dead="1"] [data-vital="player"] b,#playerVitalsHud[data-drone-destroyed="1"] [data-vital="drone"] b{color:#ff7e8f}body.player-dead #footMove,body.player-dead #footLook,body.player-dead #footLookZone,body.player-dead #footFire{pointer-events:none!important;opacity:.22!important}body.drone-destroyed #soloArm,body.drone-destroyed #soloKill{pointer-events:none!important;opacity:.30!important}@media(max-height:340px){#playerVitalsHud{top:max(37px,calc(var(--solo-safe-top,env(safe-area-inset-top)) + 32px));padding:4px 6px;min-width:116px;gap:6px}#playerVitalsHud i{font-size:6px}#playerVitalsHud b{font-size:9px}}
`;document.head.appendChild(style);}return true;
}

function playerWorldPose(){const w=walk(),vehicle=globalThis.__arondightPlayerVehicleRuntime,source=w?.mode==="foot"&&w.position?w.position:vehicle?.humanAnchor;return{x:Number(source?.x)||0,y:Number(source?.y)||0,z:0,yaw:Number(w?.yaw??viewport()?.dataset.walkYaw)||0};}
function announce(type,detail){window.dispatchEvent(new CustomEvent(type,{detail}));}

function setBridgePlayerHp(hp,dead){const b=bridge();if(!b)return;b.vsLocalHealth=hp;b.vsLocalDead=dead;b.updateVsCombatHud?.(true);}
function markPlayerDeath(source="world"){
  if(playerDead)return;playerDead=true;const pose=playerWorldPose(),side=((String(source).length+Math.round(Math.abs(pose.x+pose.y)))&1)?1:-1;spawnWorldPersonRagdoll({position:[pose.x,pose.y,pose.z],yaw:pose.yaw,impulse:[side*.55,-.35,.15],seed:`local-player-${source}`,id:"local-player"});
  document.body?.classList.add("player-dead");announce("arondight:player-death",{source,position:[pose.x,pose.y,pose.z],yaw:pose.yaw,fallSide:side});const w=walk();if(w?.mode!=="foot")w?.setMode?.("foot",{persist:false,reason:"player-death"});
}
function revivePlayer(){const wasDead=playerDead;playerDead=false;document.body?.classList.remove("player-dead");if(wasDead)announce("arondight:player-revived",{hp:playerHp});}

function damagePlayer(amount=25,source="world"){
  const before=currentPlayerHp();if(before<=0)return 0;playerHp=healthAfterDamage(before,amount,PLAYER_MAX_HP);setBridgePlayerHp(playerHp,playerHp<=0);const view=viewport();if(view){view.dataset.selfHp=String(playerHp);view.dataset.playerHp=String(playerHp);view.dataset.playerDead=playerHp<=0?"1":"0";view.dataset.playerLastDamage=String(source);}if(playerHp<=0)markPlayerDeath(source);return playerHp;
}
function resetPlayer(){playerHp=PLAYER_MAX_HP;setBridgePlayerHp(playerHp,false);revivePlayer();const view=viewport();if(view){view.dataset.selfHp=String(playerHp);view.dataset.playerHp=String(playerHp);view.dataset.playerDead="0";}return playerHp;}

function finishDroneDestruction(){forcedFootTimer=0;const w=walk();if(w?.mode==="drone")w.setMode?.("foot",{persist:false,reason:"drone-destroyed"});}
function destroyDrone(source="world"){
  if(droneDestroyed)return;droneDestroyed=true;droneHp=0;droneReadyAt=performance.now()+DRONE_REPLACEMENT_COOLDOWN_MS;droneDeathSerial++;document.body?.classList.add("drone-destroyed");try{document.getElementById("soloKill")?.click?.();}catch{}announce("arondight:drone-destroyed",{source,cooldownMs:DRONE_REPLACEMENT_COOLDOWN_MS,readyAt:droneReadyAt,serial:droneDeathSerial});clearTimeout(forcedFootTimer);forcedFootTimer=setTimeout(finishDroneDestruction,850);
}
function damageDrone(amount=25,source="world"){
  if(droneDestroyed)return 0;droneHp=healthAfterDamage(droneHp,amount,DRONE_MAX_HP);const view=viewport();if(view){view.dataset.droneHp=String(droneHp);view.dataset.droneLastDamage=String(source);}if(droneHp<=0)destroyDrone(source);return droneHp;
}
function resetDrone(){clearTimeout(forcedFootTimer);forcedFootTimer=0;droneHp=DRONE_MAX_HP;droneDestroyed=false;droneReadyAt=-Infinity;document.body?.classList.remove("drone-destroyed");const view=viewport();if(view){view.dataset.droneHp=String(droneHp);view.dataset.droneDestroyed="0";view.dataset.droneReplacementRemainingMs="0";}return droneHp;}
function makeReplacementReady(){if(!droneDestroyed)return false;droneHp=DRONE_MAX_HP;droneDestroyed=false;droneReadyAt=-Infinity;document.body?.classList.remove("drone-destroyed");announce("arondight:drone-replacement-ready",{hp:droneHp,serial:droneDeathSerial});return true;}
function canDeployDrone(now=performance.now()){if(droneDestroyed&&now>=droneReadyAt)makeReplacementReady();return !droneDestroyed;}
function replacementRemainingMs(now=performance.now()){return droneReplacementRemainingMs({destroyed:droneDestroyed,readyAt:droneReadyAt,now});}

function damageTargetKindFromHit(hit){for(let node=hit?.object;node;node=node.parent){const kind=String(node.userData?.localDamageTarget||"");if(kind==="player"||kind==="drone")return kind;}return"";}
function localDamageTargets(){
  const w=walk(),vehicle=globalThis.__arondightPlayerVehicleRuntime,targets=[];
  if(!playerDead&&currentPlayerHp()>0){const foot=currentMode()==="foot",source=foot?w?.position:vehicle?.humanAnchor,velocity=vehicle?.humanVelocity||{},targetZ=foot?(Number(source?.z)||1.68):(Number(source?.z)||0)+1.12;if(source)targets.push({kind:"player",model:globalThis.__arondightPlayerDamageModel,hp:currentPlayerHp(),position:{x:Number(source.x)||0,y:Number(source.y)||0,z:targetZ},speedMps:foot?Math.hypot(Number(velocity.x)||0,Number(velocity.y)||0):0,mesh:vehicle?.humanMesh||null});}
  if(currentMode()==="drone"&&!droneDestroyed&&droneHp>0){const pose=vehicle?.dronePose;if(pose)targets.push({kind:"drone",model:globalThis.__arondightDroneDamageModel,hp:droneHp,position:{x:Number(pose.x)||0,y:Number(pose.y)||0,z:Number(pose.z)||0},speedMps:0,mesh:vehicle?.droneMesh||null});}
  return targets;
}
function damageLocalTarget(kind,amount=25,source="world"){return kind==="player"?damagePlayer(amount,source):kind==="drone"?damageDrone(amount,source):null;}
function registerLocalDamageHit(hit,{damage=25,source="hit"}={}){const kind=damageTargetKindFromHit(hit);if(!kind)return false;const before=kind==="player"?currentPlayerHp():droneHp,after=damageLocalTarget(kind,damage,source),view=viewport();if(view){view.dataset.localDamageTarget=kind;view.dataset.localDamageHits=String((Number(view.dataset.localDamageHits)||0)+1);}announce("arondight:combat-damage",{damage:Math.max(0,before-Number(after||0)),hp:after,source,target:kind});return true;}

function sync(now=performance.now()){
  const bridgeHp=bridgePlayerHp();if(bridgeHp!==null&&bridgeHp!==playerHp){playerHp=bridgeHp;if(playerHp<=0)markPlayerDeath("combat");else revivePlayer();}
  if(droneDestroyed&&now>=droneReadyAt)makeReplacementReady();
  const b=bridge();if(b&&b.registerLocalVehicleHit!==registerLocalDamageHit)b.registerLocalVehicleHit=registerLocalDamageHit;
  installHud();const remaining=replacementRemainingMs(now),view=viewport(),targetCount=localDamageTargets().length;if(view){view.dataset.playerHp=String(playerHp);view.dataset.playerMaxHp=String(PLAYER_MAX_HP);view.dataset.playerDead=playerDead?"1":"0";view.dataset.playerDamageModel="pilot-independent-hp-v3";view.dataset.droneHp=String(droneHp);view.dataset.droneMaxHp=String(DRONE_MAX_HP);view.dataset.droneDestroyed=droneDestroyed?"1":"0";view.dataset.droneReplacementCooldownMs=String(DRONE_REPLACEMENT_COOLDOWN_MS);view.dataset.droneReplacementRemainingMs=String(Math.ceil(remaining));view.dataset.playerDroneVitals="separate-health+replacement-cooldown-v2";view.dataset.playerVehicleDamageRouting="mesh-tagged-pilot+drone-v1";view.dataset.playerVehicleDamageTargetCount=String(targetCount);view.dataset.playerDeathPresentation="input-lock+physical-ragdoll+camera-fall-v1";}
  if(hud){hud.dataset.playerDead=playerDead?"1":"0";hud.dataset.droneDestroyed=droneDestroyed?"1":"0";hud.querySelector('[data-vital="player"] b').textContent=String(Math.round(playerHp));const droneLabel=hud.querySelector('[data-vital="drone"] b');droneLabel.textContent=droneDestroyed?`${(remaining/1000).toFixed(1)}s`:String(Math.round(droneHp));hud.setAttribute("aria-label",droneDestroyed?`Pilot health ${Math.round(playerHp)}. Replacement drone ready in ${Math.ceil(remaining/1000)} seconds.`:`Pilot health ${Math.round(playerHp)}. Drone health ${Math.round(droneHp)}.`);}
  requestAnimationFrame(sync);
}

function installResetHook(){document.addEventListener("click",event=>{const target=event.target instanceof Element?event.target.closest("#reset,#soloReset"):null;if(!target)return;resetPlayer();resetDrone();},{capture:true,passive:true});}

export function installPlayerVitalsRuntime(){
  if(installed)return globalThis.__arondightPlayerVitals;installed=true;installHud();installResetHook();
  const playerApi={maxHp:PLAYER_MAX_HP,get hp(){return currentPlayerHp();},get dead(){return playerDead||currentPlayerHp()<=0;},damage:damagePlayer,reset:resetPlayer};
  const droneApi={maxHp:DRONE_MAX_HP,get hp(){return droneHp;},get destroyed(){return droneDestroyed;},get readyAt(){return droneReadyAt;},get cooldownMs(){return DRONE_REPLACEMENT_COOLDOWN_MS;},get remainingMs(){return replacementRemainingMs();},get canDeploy(){return canDeployDrone();},damage:damageDrone,destroy:destroyDrone,reset:resetDrone};
  globalThis.__arondightPlayerDamageModel=playerApi;globalThis.__arondightDroneDamageModel=droneApi;globalThis.__arondightPlayerVitals={player:playerApi,drone:droneApi,damageTargets:localDamageTargets,targetKindFromHit:damageTargetKindFromHit,registerHit:registerLocalDamageHit};
  addEventListener("arondight:player-damage",event=>damagePlayer(event?.detail?.damage??25,event?.detail?.source||"event"));addEventListener("arondight:drone-damage",event=>damageDrone(event?.detail?.damage??25,event?.detail?.source||"event"));requestAnimationFrame(sync);return globalThis.__arondightPlayerVitals;
}

installPlayerVitalsRuntime();
