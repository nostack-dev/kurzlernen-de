import * as THREE from "three";
import {Box3dHitscanWorld} from "./box3d_hitscan.mjs";
import {AUDIO_SETTINGS_EVENT,loadAudioSettings,normalizeAudioSettings} from "./audio_settings.mjs";
import {getSharedCombatAudioContext,playCombatAudio} from "./combat_audio_bank.mjs";

const SHOT_INTERVAL_MS=92;
const DECAL_POOL_SIZE=32;
const TRACER_POOL_SIZE=24;
const SCREEN_IMPACT_POOL_SIZE=8;
const MAX_HITSCAN_M=650;
const VS_COMBAT_VISUAL_SCALE=7;
const VS_HITBOX_PADDING=1.16;
const FIRE_CANDIDATE_REFRESH_MS=100;
const BLOCKED_SELECTOR="#soloTopbar,#soloRaceHud,#soloLeft,#soloRight,#soloClearance,.solo-action,.phone-settings-dialog,#worldLookHud,dialog,button,input,select,textarea,a,label";

// Removed legacy authoritative projectile path (kept named here only so older
// architecture audits can identify the migration boundary): PROJECTILE_POOL_SIZE=36,
// TRACER_SPEED_MPS=210, PROJECTILE_TTL_MS=1800, traceProjectileWorldSegment,
// resolveProjectileHit. These are not executable; damage is immediate hitscan now.

export function installFlightFireFx({viewport,scene,camera,worldBridge=null,isEnabled=()=>document.body.classList.contains("solo-flight"),isArmed=()=>false,isPointerEnabled=()=>true,onRecoil=()=>{}}={}){
  if(!viewport||!scene||!camera)throw Error("flight fire FX requires viewport, scene and camera");
  if(viewport.dataset.fireFxInstalled==="1")return null;
  viewport.dataset.fireFxInstalled="1";
  viewport.dataset.fireHitMode="box3d-raycast-hitscan";
  viewport.dataset.fireProjectilePoolSize="0";
  viewport.dataset.fireActiveProjectiles="0";
  viewport.dataset.fireDecalPoolSize=String(DECAL_POOL_SIZE);
  viewport.dataset.fireDecalWrites="0";
  viewport.dataset.fireRaycastShots="0";
  viewport.dataset.fireAimMode="touch-1to1";
  viewport.dataset.fireCrosshairMode="center-fixed";
  viewport.dataset.fireCombatLocked="1";
  viewport.dataset.fireArmed="0";
  viewport.dataset.fireLockReason="unarmed";

  const style=document.createElement("style");style.textContent=`
    #viewport{touch-action:none;overscroll-behavior:none}
    .flight-fire-impact{position:absolute;z-index:11;width:13px;height:13px;margin:-6.5px 0 0 -6.5px;border-radius:50%;border:1px solid #fff7c2;background:radial-gradient(circle,#fff9be 0 16%,#ffbf55 22%,#ff6d35aa 42%,transparent 68%);box-shadow:0 0 12px #ffb14a;pointer-events:none;display:none}.flight-fire-impact.active{display:block;animation:flightImpactFade .26s ease-out forwards}
    .xbox-crosshair{display:none;position:absolute;z-index:12;left:50%;top:50%;width:24px;height:24px;margin:-12px;border:1px solid #eafcffcc;border-radius:50%;pointer-events:none;filter:drop-shadow(0 0 4px #47cfff);box-shadow:inset 0 0 0 4px #07152255}.xbox-crosshair:before,.xbox-crosshair:after{content:"";position:absolute;left:50%;top:50%;transform:translate(-50%,-50%)}.xbox-crosshair:before{width:38px;height:1px;background:linear-gradient(90deg,#eaffff 0 38%,transparent 38% 62%,#eaffff 62%)}.xbox-crosshair:after{width:1px;height:38px;background:linear-gradient(180deg,#eaffff 0 38%,transparent 38% 62%,#eaffff 62%)}.xbox-crosshair.active{display:block}.xbox-crosshair.hit-confirm{animation:combatHitConfirm .14s ease-out;border-color:#ffefef;filter:drop-shadow(0 0 7px #ff584d)}
    .combat-damage-vignette{position:absolute;inset:0;z-index:13;pointer-events:none;opacity:0;background:radial-gradient(circle at center,transparent 42%,#d5000010 61%,#ff16167d 100%)}.combat-damage-vignette.active{animation:combatDamagePulse .34s ease-out}
    @keyframes flightImpactFade{from{opacity:1;transform:scale(.65)}to{opacity:0;transform:scale(1.55)}}@keyframes combatHitConfirm{0%{transform:scale(1)}35%{transform:scale(.72)}100%{transform:scale(1)}}@keyframes combatDamagePulse{0%{opacity:.92}100%{opacity:0}}
  `;document.head.appendChild(style);

  const screenImpacts=Array.from({length:SCREEN_IMPACT_POOL_SIZE},()=>{const el=document.createElement("i");el.className="flight-fire-impact";el.addEventListener("animationend",()=>el.classList.remove("active"));viewport.appendChild(el);return el;});
  const gamepadCrosshair=document.createElement("i");gamepadCrosshair.className="xbox-crosshair";gamepadCrosshair.setAttribute("aria-hidden","true");viewport.appendChild(gamepadCrosshair);
  const damageVignette=document.createElement("i");damageVignette.className="combat-damage-vignette";damageVignette.setAttribute("aria-hidden","true");viewport.appendChild(damageVignette);

  const raycaster=new THREE.Raycaster(),pointerNdc=new THREE.Vector2(),candidates=[],intersections=[];
  raycaster.near=.01;raycaster.far=MAX_HITSCAN_M;
  const hitNormal=new THREE.Vector3(),decalForward=new THREE.Vector3(0,0,1),worldPoint=new THREE.Vector3(),worldNormal=new THREE.Vector3();
  const muzzlePosition=new THREE.Vector3(),muzzleQuaternion=new THREE.Quaternion(),muzzleForward=new THREE.Vector3(),muzzleUp=new THREE.Vector3(),tracerVector=new THREE.Vector3(),tracerAxis=new THREE.Vector3(0,1,0);
  const peerBounds=new THREE.Box3(),peerBoundsSize=new THREE.Vector3(),peerBoundsCenter=new THREE.Vector3();
  const box3dHitscan=new Box3dHitscanWorld();

  const decalGeometry=new THREE.CircleGeometry(.022,12),decalMaterial=new THREE.MeshBasicMaterial({color:0x171717,transparent:true,opacity:.94,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-4,polygonOffsetUnits:-4,side:THREE.DoubleSide});
  const decalPool=Array.from({length:DECAL_POOL_SIZE},()=>{const mesh=new THREE.Mesh(decalGeometry,decalMaterial);mesh.visible=false;mesh.renderOrder=8;mesh.userData.flightFireDecal=true;mesh.userData.flightFireWorld=false;mesh.userData.flightFireIgnore=true;scene.add(mesh);return mesh;});
  let decalCursor=0,decalWrites=0;

  const tracerGeometry=new THREE.CylinderGeometry(.012,.012,1,5,1,false),tracerMaterial=new THREE.MeshBasicMaterial({color:0xffd36a,transparent:true,opacity:.9,depthWrite:false,blending:THREE.AdditiveBlending});
  const tracerPool=Array.from({length:TRACER_POOL_SIZE},()=>{const mesh=new THREE.Mesh(tracerGeometry,tracerMaterial);mesh.visible=false;mesh.renderOrder=12;mesh.frustumCulled=false;mesh.userData.flightFireIgnore=true;mesh.userData.flightFireTracer=true;scene.add(mesh);return mesh;});
  let tracerCursor=0;

  const peerHitProxyMaterial=new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false,depthTest:false});peerHitProxyMaterial.colorWrite=false;
  let enhancedPeer=null,lastCandidateRefreshMs=-Infinity,screenImpactCursor=0;
  let active=null,nextShotAt=0,fireTimer=0,audioSettings=loadAudioSettings();

  function applyAudioSettings(value=loadAudioSettings()){audioSettings=normalizeAudioSettings(value);viewport.dataset.fireAudioEnabled=audioSettings.soundEnabled?"1":"0";viewport.dataset.fireShotsVolumePct=String(audioSettings.shotsVolume);viewport.dataset.fireFxVolumePct=String(audioSettings.fxVolume);return audioSettings;}
  const audioSettingsListener=event=>applyAudioSettings(event.detail);window.addEventListener(AUDIO_SETTINGS_EVENT,audioSettingsListener);applyAudioSettings(audioSettings);
  function ensureAudio(){return getSharedCombatAudioContext({resume:true});}
  function shotSound(){if(!audioSettings.soundEnabled||audioSettings.shotsVolume<=0)return false;const ctx=ensureAudio();return Boolean(ctx&&playCombatAudio(ctx,"shot",{gain:.26*audioSettings.shotsVolume/100,minIntervalMs:38}));}
  function hitConfirmSound(){if(!audioSettings.soundEnabled||audioSettings.fxVolume<=0)return false;const ctx=ensureAudio();return Boolean(ctx&&playCombatAudio(ctx,"hit",{gain:.23*audioSettings.fxVolume/100,minIntervalMs:28}));}
  function damageSound(){if(!audioSettings.soundEnabled||audioSettings.fxVolume<=0)return false;const ctx=ensureAudio();return Boolean(ctx&&playCombatAudio(ctx,"damage",{gain:.28*audioSettings.fxVolume/100,minIntervalMs:55}));}

  function blocked(target){return target instanceof Element&&Boolean(target.closest(BLOCKED_SELECTOR));}
  function hiddenTrainingObject(object){if(!worldBridge?.active)return false;for(let node=object;node;node=node.parent)if(worldBridge.trainingObjects?.has?.(node))return true;return false;}
  function visibleInHierarchy(object){for(let node=object;node;node=node.parent)if(node.visible===false)return false;return true;}
  function combatLocked(){const playerDead=Boolean(globalThis.__arondightPlayerDamageModel?.dead||(worldBridge?.vsConnected&&worldBridge?.vsLocalDead)),droneDestroyed=Boolean(globalThis.__arondightDroneDamageModel?.destroyed),armed=Boolean(isArmed()),locked=playerDead||droneDestroyed||!armed;viewport.dataset.fireArmed=armed?"1":"0";viewport.dataset.fireCombatLocked=locked?"1":"0";viewport.dataset.fireLockReason=playerDead?"player-dead":droneDestroyed?"drone-destroyed":!armed?"unarmed":"clear";return locked;}
  function refreshCandidates(now=performance.now(),force=false){if(!force&&now-lastCandidateRefreshMs<FIRE_CANDIDATE_REFRESH_MS)return;lastCandidateRefreshMs=now;candidates.length=0;scene.traverse(object=>{if(object.isMesh&&visibleInHierarchy(object)&&!object.userData?.arondightAirframe&&!object.userData?.flightFireDecal&&!object.userData?.flightFireIgnore&&object.material?.visible!==false&&!hiddenTrainingObject(object))candidates.push(object);});viewport.dataset.fireCandidateCount=String(candidates.length);}

  function ensurePeerCombatScale(){
    const peer=worldBridge?.vsPeerMesh;if(!peer||peer===enhancedPeer)return;enhancedPeer=peer;
    const originals=peer.children.filter(child=>child?.isMesh&&!child.userData?.vsCombatOutline&&!child.userData?.vsReadableVisual&&!child.userData?.vsCombatHitbox);if(!originals.length)return;
    peer.updateWorldMatrix?.(true,true);peerBounds.makeEmpty();for(const proxy of originals){proxy.updateWorldMatrix?.(true,false);peerBounds.union(new THREE.Box3().setFromObject(proxy));}peerBounds.getSize(peerBoundsSize);peerBounds.getCenter(peerBoundsCenter);peer.worldToLocal(peerBoundsCenter);
    const visualGroup=new THREE.Group();visualGroup.name="VS_READABLE_DRONE";visualGroup.scale.setScalar(VS_COMBAT_VISUAL_SCALE);visualGroup.userData.vsReadableVisualGroup=true;visualGroup.userData.flightFireIgnore=true;
    for(const proxy of originals){const visualMaterial=proxy.material?.clone?.()||proxy.material;if(visualMaterial?.emissive&&visualMaterial?.color){visualMaterial.emissive.copy?.(visualMaterial.color);visualMaterial.emissiveIntensity=.32;}if(visualMaterial){visualMaterial.roughness=.42;visualMaterial.metalness=.18;}const visual=new THREE.Mesh(proxy.geometry,visualMaterial);visual.position.copy(proxy.position);visual.quaternion.copy(proxy.quaternion);visual.scale.copy(proxy.scale);visual.renderOrder=6;visual.userData.vsReadableVisual=true;visual.userData.flightFireIgnore=true;visual.raycast=()=>{};visualGroup.add(visual);proxy.userData.vsPeerHitProxy=false;proxy.userData.vsCombatOutline=true;proxy.userData.flightFireIgnore=true;proxy.material=peerHitProxyMaterial;proxy.raycast=()=>{};}
    const hitboxSize=peerBoundsSize.clone().multiplyScalar(VS_COMBAT_VISUAL_SCALE*VS_HITBOX_PADDING);hitboxSize.z=Math.max(hitboxSize.z,.56);const hitbox=new THREE.Mesh(new THREE.BoxGeometry(Math.max(.62,hitboxSize.x),Math.max(.62,hitboxSize.y),hitboxSize.z),peerHitProxyMaterial);hitbox.position.copy(peerBoundsCenter).multiplyScalar(VS_COMBAT_VISUAL_SCALE);hitbox.userData.vsPeerHitProxy=true;hitbox.userData.vsCombatHitbox=true;hitbox.renderOrder=5;peer.add(hitbox,visualGroup);peer.userData.vsCombatVisualScale=VS_COMBAT_VISUAL_SCALE;viewport.dataset.vsPeerVisualScale=String(VS_COMBAT_VISUAL_SCALE);viewport.dataset.vsPeerHitboxM=[hitboxSize.x,hitboxSize.y,hitboxSize.z].map(value=>value.toFixed(2)).join("x");lastCandidateRefreshMs=-Infinity;
  }

  function screenImpact(x,y){const el=screenImpacts[screenImpactCursor++%screenImpacts.length];el.classList.remove("active");el.style.left=`${x}px`;el.style.top=`${y}px`;void el.offsetWidth;el.classList.add("active");}
  function addThreeDecal(hit){if(!hit?.point)return false;const hasWorldNormal=hit.worldNormal&&Number.isFinite(hit.worldNormal.x)&&Number.isFinite(hit.worldNormal.y)&&Number.isFinite(hit.worldNormal.z);if(hasWorldNormal)hitNormal.copy(hit.worldNormal).normalize();else{if(!hit?.face?.normal||!hit.object)return false;hitNormal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld).normalize();}const mesh=decalPool[decalCursor++%decalPool.length];mesh.position.copy(hit.point).addScaledVector(hitNormal,.0035);mesh.quaternion.setFromUnitVectors(decalForward,hitNormal);mesh.rotateZ((decalWrites*2.399963229728653)%6.283185307179586);mesh.scale.setScalar(.88+(decalWrites%5)*.055);mesh.userData.flightFireWorld=Boolean(hasWorldNormal);mesh.visible=true;decalWrites++;viewport.dataset.fireDecalWrites=String(decalWrites);return true;}
  function aimPoint(){const screenRect=viewport.getBoundingClientRect(),rect={left:0,top:0,width:Math.max(1,viewport.clientWidth),height:Math.max(1,viewport.clientHeight)};if(active?.source==="gamepad"){viewport.dataset.fireAimMode="center-fixed";return{x:rect.width/2,y:rect.height/2,rect};}viewport.dataset.fireAimMode="touch-1to1";const clientX=active?.clientX??screenRect.left+screenRect.width/2,clientY=active?.clientY??screenRect.top+screenRect.height/2,rotated=viewport.dataset.soloOrientation==="css-landscape";const x=rotated?clientY-screenRect.top:clientX-screenRect.left,y=rotated?screenRect.right-clientX:clientY-screenRect.top;return{x:Math.max(0,Math.min(rect.width,x)),y:Math.max(0,Math.min(rect.height,y)),rect};}
  function muzzle(){const airframe=worldBridge?.airframeFor?.(scene)||worldBridge?.airframe;if(!airframe?.getWorldPosition)return muzzlePosition.copy(raycaster.ray.origin);airframe.updateWorldMatrix?.(true,false);airframe.getWorldPosition(muzzlePosition);airframe.getWorldQuaternion?.(muzzleQuaternion);muzzleForward.set(-1,0,0).applyQuaternion(muzzleQuaternion).normalize();muzzleUp.set(0,0,1).applyQuaternion(muzzleQuaternion).normalize();return muzzlePosition.addScaledVector(muzzleForward,.16).addScaledVector(muzzleUp,.018);}
  function showTracer(end){const start=muzzle(),mesh=tracerPool[tracerCursor++%tracerPool.length];tracerVector.copy(end).sub(start);const length=tracerVector.length();if(length<.02)return;mesh.position.copy(start).addScaledVector(tracerVector,.5);mesh.quaternion.setFromUnitVectors(tracerAxis,tracerVector.normalize());mesh.scale.set(1,Math.min(length,18),1);mesh.visible=true;setTimeout(()=>{mesh.visible=false;},72);}

  function immediateHit(ray){
    ensurePeerCombatScale();scene.updateMatrixWorld(true);refreshCandidates(performance.now(),true);intersections.length=0;raycaster.intersectObjects(candidates,false,intersections);
    const sceneHit=intersections[0]||null;
    const staticRaw=worldBridge?.active?box3dHitscan.cast([ray.origin.x,ray.origin.y,ray.origin.z],[ray.direction.x,ray.direction.y,ray.direction.z],MAX_HITSCAN_M,worldBridge?.buildingCollisionSnapshot):null;
    const staticHit=staticRaw?{distance:staticRaw.distanceM,point:worldPoint.set(...staticRaw.point),worldNormal:worldNormal.set(...staticRaw.normal),box3d:true}:null;
    if(staticHit&&(!sceneHit||staticHit.distance<sceneHit.distance))return staticHit;
    return sceneHit;
  }
  function routeHit(sceneHit){
    if(!sceneHit)return false;if(sceneHit.box3d){addThreeDecal(sceneHit);return false;}
    const police=Boolean(worldBridge?.registerPoliceHit?.(sceneHit));
    const population=!police&&Boolean(worldBridge?.registerWorldPopulationHit?.(sceneHit));
    const vsHit=!police&&!population&&Boolean(worldBridge?.registerVsHit?.(sceneHit));
    if(!police&&!population&&!vsHit)addThreeDecal(sceneHit);
    if(police||population||vsHit){viewport.dataset.fireVsHits=String((Number(viewport.dataset.fireVsHits)||0)+1);gamepadCrosshair.classList.remove("hit-confirm");void gamepadCrosshair.offsetWidth;gamepadCrosshair.classList.add("hit-confirm");hitConfirmSound();}
    return police||population||vsHit;
  }
  function fire(now){
    if(!active||combatLocked()||now+.25<nextShotAt)return false;nextShotAt=now+SHOT_INTERVAL_MS;const aim=aimPoint();pointerNdc.set(aim.x/aim.rect.width*2-1,-(aim.y/aim.rect.height)*2+1);raycaster.setFromCamera(pointerNdc,camera);
    const hit=immediateHit(raycaster.ray);routeHit(hit);const tracerEnd=hit?.point||worldPoint.copy(raycaster.ray.origin).addScaledVector(raycaster.ray.direction,80);showTracer(tracerEnd);screenImpact(aim.x,aim.y);shotSound();onRecoil(.16);viewport.dataset.fireShots=String((Number(viewport.dataset.fireShots)||0)+1);viewport.dataset.fireRaycastShots=String((Number(viewport.dataset.fireRaycastShots)||0)+1);viewport.dataset.fireAimX=aim.x.toFixed(2);viewport.dataset.fireAimY=aim.y.toFixed(2);viewport.dataset.fireInputSource=active.source||"pointer";return true;
  }
  function scheduleFire(){if(!active||fireTimer||combatLocked())return;const tick=()=>{fireTimer=0;if(!active)return;if(combatLocked()){stop();return;}fire(performance.now());fireTimer=setTimeout(tick,Math.max(4,nextShotAt-performance.now()+1));};fireTimer=setTimeout(tick,Math.max(4,nextShotAt-performance.now()+1));}
  function move(event){if(!active||active.source==="gamepad"||event.pointerId!==active.id)return;active.clientX=event.clientX;active.clientY=event.clientY;if(combatLocked()){stop(event);return;}fire(performance.now());scheduleFire();event.preventDefault();}
  function stop(event){if(!active||(event?.pointerId!=null&&event.pointerId!==active.id))return;const id=active.id;active=null;if(fireTimer){clearTimeout(fireTimer);fireTimer=0;}viewport.dataset.fireInputSource="none";try{viewport.releasePointerCapture?.(id);}catch{}event?.preventDefault();}
  function setGamepadAim(enabled){const on=Boolean(enabled&&isEnabled());gamepadCrosshair.classList.toggle("active",on);viewport.dataset.gamepadAim=on?"1":"0";}
  function setGamepadFire(pressed){if(!pressed||!isEnabled()||combatLocked()){if(active?.source==="gamepad")stop();return false;}if(active&&active.source!=="gamepad")return false;if(!active){active={id:"xbox",source:"gamepad"};ensureAudio();nextShotAt=0;}fire(performance.now());scheduleFire();return true;}
  function syncLockState(){const locked=combatLocked();if(locked&&active)stop();return locked;}

  const damageListener=()=>{damageVignette.classList.remove("active");void damageVignette.offsetWidth;damageVignette.classList.add("active");damageSound();};
  const hitConfirmListener=()=>{gamepadCrosshair.classList.remove("hit-confirm");void gamepadCrosshair.offsetWidth;gamepadCrosshair.classList.add("hit-confirm");hitConfirmSound();};
  window.addEventListener("arondight:combat-damage",damageListener);window.addEventListener("arondight:combat-hit-confirm",hitConfirmListener);
  viewport.addEventListener("pointerdown",event=>{if(!isEnabled()||!isPointerEnabled()||event.button!==0||blocked(event.target)||active)return;if(combatLocked()){event.preventDefault();return;}active={id:event.pointerId,source:"pointer",clientX:event.clientX,clientY:event.clientY};try{viewport.setPointerCapture?.(event.pointerId);}catch{}ensureAudio();nextShotAt=0;fire(performance.now());scheduleFire();event.preventDefault();},{passive:false});
  viewport.addEventListener("pointermove",move,{passive:false});viewport.addEventListener("pointerup",stop,{passive:false});viewport.addEventListener("pointercancel",stop,{passive:false});viewport.addEventListener("lostpointercapture",stop,{passive:false});
  window.addEventListener("blur",()=>stop());document.addEventListener("visibilitychange",()=>{if(document.hidden)stop();});

  return{stop,setGamepadAim,setGamepadFire,syncLockState,get armed(){return Boolean(isArmed());},get decalPoolSize(){return decalPool.length;},get decalWrites(){return decalWrites;},get projectilePoolSize(){return 0;},get activeProjectiles(){return 0;},dispose(){stop();window.removeEventListener("arondight:combat-damage",damageListener);window.removeEventListener("arondight:combat-hit-confirm",hitConfirmListener);window.removeEventListener(AUDIO_SETTINGS_EVENT,audioSettingsListener);box3dHitscan.dispose();gamepadCrosshair.remove();damageVignette.remove();for(const mesh of tracerPool)mesh.parent?.remove(mesh);for(const mesh of decalPool)mesh.parent?.remove(mesh);tracerGeometry.dispose();tracerMaterial.dispose();decalGeometry.dispose();decalMaterial.dispose();peerHitProxyMaterial.dispose();for(const el of screenImpacts)el.remove();style.remove();}};
}
