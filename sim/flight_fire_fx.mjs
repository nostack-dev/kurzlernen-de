import * as THREE from "three";
import {integrateProjectile,traceProjectileWorldSegment,createProjectileHit} from "./projectile_ballistics.mjs";

const SHOT_INTERVAL_MS=92;
const DECAL_POOL_SIZE=32;
const SCREEN_IMPACT_POOL_SIZE=8;
const PROJECTILE_POOL_SIZE=36;
const IMPACT_FLASH_POOL_SIZE=18;
const TRACER_SPEED_MPS=210;
const TRACER_LENGTH_M=2.2;
const PROJECTILE_TTL_MS=1800;
const PROJECTILE_AIM_DISTANCE_M=650;
const VS_COMBAT_VISUAL_SCALE=8;
const BLOCKED_SELECTOR="#soloTopbar,#soloRaceHud,#soloLeft,#soloRight,#soloClearance,.solo-action,.phone-settings-dialog,#worldLookHud,dialog,button,input,select,textarea,a,label";

export function installFlightFireFx({viewport,scene,camera,worldBridge=null,isEnabled=()=>document.body.classList.contains("solo-flight"),isPointerEnabled=()=>true,onRecoil=()=>{}}={}){
  if(!viewport||!scene||!camera)throw Error("flight fire FX requires viewport, scene and camera");
  if(viewport.dataset.fireFxInstalled==="1")return null;
  viewport.dataset.fireFxInstalled="1";
  viewport.dataset.fireDecalPoolSize=String(DECAL_POOL_SIZE);
  viewport.dataset.fireProjectilePoolSize=String(PROJECTILE_POOL_SIZE);
  viewport.dataset.fireTracerSpeedMps=String(TRACER_SPEED_MPS);
  viewport.dataset.fireDecalWrites="0";
  viewport.dataset.fireActiveProjectiles="0";
  viewport.dataset.fireProjectileImpacts="0";
  viewport.dataset.fireProjectileExpired="0";viewport.dataset.fireAimMode="center-fixed";viewport.dataset.fireCrosshairMode="center-fixed";

  const style=document.createElement("style");style.textContent=`
    #viewport{touch-action:none;overscroll-behavior:none}
    .flight-fire-impact{position:absolute;z-index:11;width:13px;height:13px;margin:-6.5px 0 0 -6.5px;border-radius:50%;border:1px solid #fff7c2;background:radial-gradient(circle,#fff9be 0 16%,#ffbf55 22%,#ff6d35aa 42%,transparent 68%);box-shadow:0 0 12px #ffb14a;pointer-events:none;display:none}
    .flight-fire-impact.active{display:block;animation:flightImpactFade .34s ease-out forwards}
    .xbox-crosshair{display:none;position:absolute;z-index:12;left:50%;top:50%;width:24px;height:24px;margin:-12px 0 0 -12px;border:1px solid #eafcffcc;border-radius:50%;pointer-events:none;filter:drop-shadow(0 0 4px #47cfff);box-shadow:inset 0 0 0 4px #07152255}
    .xbox-crosshair:before,.xbox-crosshair:after{content:"";position:absolute;left:50%;top:50%;transform:translate(-50%,-50%)}.xbox-crosshair:before{width:38px;height:1px;background:linear-gradient(90deg,#eaffff 0 38%,transparent 38% 62%,#eaffff 62% 100%)}.xbox-crosshair:after{width:1px;height:38px;background:linear-gradient(180deg,#eaffff 0 38%,transparent 38% 62%,#eaffff 62% 100%)}
    .xbox-crosshair.active{display:block}.xbox-crosshair.hit-confirm{animation:combatHitConfirm .14s ease-out;border-color:#ffefef;filter:drop-shadow(0 0 7px #ff584d)}
    .combat-damage-vignette{position:absolute;inset:0;z-index:13;pointer-events:none;opacity:0;background:radial-gradient(circle at center,transparent 42%,#d5000010 61%,#ff16167d 100%)}.combat-damage-vignette.active{animation:combatDamagePulse .34s ease-out}
    @keyframes flightImpactFade{from{opacity:1;transform:scale(.65)}to{opacity:0;transform:scale(1.55)}}@keyframes combatHitConfirm{0%{transform:scale(1)}35%{transform:scale(.72)}100%{transform:scale(1)}}@keyframes combatDamagePulse{0%{opacity:.92}100%{opacity:0}}
  `;document.head.appendChild(style);

  const screenImpacts=Array.from({length:SCREEN_IMPACT_POOL_SIZE},()=>{const el=document.createElement("i");el.className="flight-fire-impact";el.addEventListener("animationend",()=>el.classList.remove("active"));viewport.appendChild(el);return el;});
  const gamepadCrosshair=document.createElement("i");gamepadCrosshair.className="xbox-crosshair";gamepadCrosshair.setAttribute("aria-hidden","true");viewport.appendChild(gamepadCrosshair);
  const damageVignette=document.createElement("i");damageVignette.className="combat-damage-vignette";damageVignette.setAttribute("aria-hidden","true");viewport.appendChild(damageVignette);
  let screenImpactCursor=0;

  const raycaster=new THREE.Raycaster(),pointerNdc=new THREE.Vector2(),candidates=[],intersections=[],hitNormal=new THREE.Vector3(),decalForward=new THREE.Vector3(0,0,1);
  const muzzlePosition=new THREE.Vector3(),muzzleQuaternion=new THREE.Quaternion(),muzzleForward=new THREE.Vector3(),muzzleUp=new THREE.Vector3(),aimTarget=new THREE.Vector3(),launchDirection=new THREE.Vector3();
  const projectedImpact=new THREE.Vector3(),tracerDirection=new THREE.Vector3(),tracerAxis=new THREE.Vector3(0,1,0),worldImpactPoint=new THREE.Vector3(),worldImpactNormal=new THREE.Vector3();
  const worldVisualHit={point:worldImpactPoint,worldNormal:worldImpactNormal};

  const decalGeometry=new THREE.CircleGeometry(.022,12),decalMaterial=new THREE.MeshBasicMaterial({color:0x171717,transparent:true,opacity:.94,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-4,polygonOffsetUnits:-4,side:THREE.DoubleSide});
  const decalPool=Array.from({length:DECAL_POOL_SIZE},()=>{const mesh=new THREE.Mesh(decalGeometry,decalMaterial);mesh.visible=false;mesh.renderOrder=8;mesh.userData.flightFireDecal=true;mesh.userData.flightFireWorld=false;scene.add(mesh);return mesh;});
  let decalCursor=0,decalWrites=0;

  const tracerGeometry=new THREE.CylinderGeometry(.018,.018,1,6,1,false),tracerMaterial=new THREE.MeshBasicMaterial({color:0xffd36a,transparent:true,opacity:.96,depthWrite:false,blending:THREE.AdditiveBlending});
  const projectilePool=Array.from({length:PROJECTILE_POOL_SIZE},()=>{const mesh=new THREE.Mesh(tracerGeometry,tracerMaterial);mesh.visible=false;mesh.renderOrder=12;mesh.frustumCulled=false;mesh.userData.flightFireIgnore=true;mesh.userData.flightFireTracer=true;scene.add(mesh);return{mesh,active:false,position:new THREE.Vector3(),velocity:new THREE.Vector3(),nextPosition:new THREE.Vector3(),nextVelocity:new THREE.Vector3(),bornAt:0,source:""};});
  let projectileCursor=0,activeProjectileCount=0,lastProjectileFrameMs=performance.now(),projectileRaf=0;

  const impactGeometry=new THREE.SphereGeometry(.075,8,6);
  const impactPool=Array.from({length:IMPACT_FLASH_POOL_SIZE},()=>{const material=new THREE.MeshBasicMaterial({color:0xffb24d,transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending}),mesh=new THREE.Mesh(impactGeometry,material);mesh.visible=false;mesh.renderOrder=13;mesh.userData.flightFireIgnore=true;mesh.userData.flightFireImpact=true;scene.add(mesh);return{mesh,material,bornAt:0,expiresAt:0};});
  let impactCursor=0;

  const peerHitProxyMaterial=new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false,depthTest:false});peerHitProxyMaterial.colorWrite=false;
  let enhancedPeer=null;
  let active=null,nextShotAt=0,fireTimer=0,audioCtx=null,noiseBuffer=null;

  function blocked(target){return target instanceof Element&&Boolean(target.closest(BLOCKED_SELECTOR));}
  function hiddenTrainingObject(object){if(!worldBridge?.active)return false;for(let node=object;node;node=node.parent)if(worldBridge.trainingObjects?.has?.(node))return true;return false;}
  function visibleInHierarchy(object){for(let node=object;node;node=node.parent)if(node.visible===false)return false;return true;}
  function refreshCandidates(){candidates.length=0;scene.traverse(object=>{if(object.isMesh&&visibleInHierarchy(object)&&!object.userData?.arondightAirframe&&!object.userData?.flightFireDecal&&!object.userData?.flightFireIgnore&&object.material?.visible!==false&&!hiddenTrainingObject(object))candidates.push(object);});}

  function ensurePeerCombatScale(){
    const peer=worldBridge?.vsPeerMesh;if(!peer||peer===enhancedPeer)return;enhancedPeer=peer;
    const originals=peer.children.filter(child=>child?.isMesh&&!child.userData?.vsCombatOutline&&!child.userData?.vsReadableVisual);if(!originals.length)return;
    const visualGroup=new THREE.Group();visualGroup.name="VS_READABLE_DRONE";visualGroup.scale.setScalar(VS_COMBAT_VISUAL_SCALE);visualGroup.userData.vsReadableVisualGroup=true;visualGroup.userData.flightFireIgnore=true;
    for(const proxy of originals){
      const visualMaterial=proxy.material?.clone?.()||proxy.material;if(visualMaterial?.color?.setHex)visualMaterial.color.setHex(0xff6542);if(visualMaterial?.emissive?.setHex){visualMaterial.emissive.setHex(0xb51c08);visualMaterial.emissiveIntensity=2.2;}if(visualMaterial){visualMaterial.roughness=.24;visualMaterial.metalness=.18;}
      const visual=new THREE.Mesh(proxy.geometry,visualMaterial);visual.position.copy(proxy.position);visual.quaternion.copy(proxy.quaternion);visual.scale.copy(proxy.scale);visual.renderOrder=6;visual.userData.vsReadableVisual=true;visual.userData.vsCombatOutline=true;visual.userData.flightFireIgnore=true;visual.raycast=()=>{};visualGroup.add(visual);
      for(const child of proxy.children)if(child.userData?.vsCombatOutline)child.visible=false;
      proxy.userData.vsPeerHitProxy=true;proxy.userData.vsCombatOutline=true;proxy.material=peerHitProxyMaterial;
    }
    peer.add(visualGroup);peer.userData.vsCombatVisualScale=VS_COMBAT_VISUAL_SCALE;viewport.dataset.vsPeerVisualScale=String(VS_COMBAT_VISUAL_SCALE);viewport.dataset.vsPeerHitboxScale="1";
  }

  function ensureAudio(){
    if(audioCtx)return audioCtx;const Ctx=window.AudioContext||window.webkitAudioContext;if(!Ctx)return null;audioCtx=new Ctx();noiseBuffer=audioCtx.createBuffer(1,Math.floor(audioCtx.sampleRate*.045),audioCtx.sampleRate);const data=noiseBuffer.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=(Math.random()*2-1)*(1-i/data.length);return audioCtx;
  }
  function shotSound(){
    const ctx=ensureAudio();if(!ctx||!noiseBuffer)return;try{if(ctx.state==="suspended")ctx.resume();const t=ctx.currentTime,src=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),noiseGain=ctx.createGain(),thump=ctx.createOscillator(),thumpGain=ctx.createGain(),snap=ctx.createOscillator(),snapGain=ctx.createGain();src.buffer=noiseBuffer;filter.type="bandpass";filter.frequency.setValueAtTime(1700,t);filter.Q.value=.58;noiseGain.gain.setValueAtTime(.13,t);noiseGain.gain.exponentialRampToValueAtTime(.001,t+.052);thump.type="triangle";thump.frequency.setValueAtTime(155,t);thump.frequency.exponentialRampToValueAtTime(78,t+.06);thumpGain.gain.setValueAtTime(.07,t);thumpGain.gain.exponentialRampToValueAtTime(.001,t+.065);snap.type="square";snap.frequency.setValueAtTime(2600,t);snap.frequency.exponentialRampToValueAtTime(1100,t+.026);snapGain.gain.setValueAtTime(.021,t);snapGain.gain.exponentialRampToValueAtTime(.001,t+.032);src.connect(filter).connect(noiseGain).connect(ctx.destination);thump.connect(thumpGain).connect(ctx.destination);snap.connect(snapGain).connect(ctx.destination);src.start(t);src.stop(t+.06);thump.start(t);thump.stop(t+.07);snap.start(t);snap.stop(t+.035);}catch{}
  }
  function hitConfirmSound(){const ctx=ensureAudio();if(!ctx)return;try{if(ctx.state==="suspended")ctx.resume();const t=ctx.currentTime,osc=ctx.createOscillator(),gain=ctx.createGain(),tick=ctx.createOscillator(),tickGain=ctx.createGain();osc.type="sine";osc.frequency.setValueAtTime(900,t);osc.frequency.exponentialRampToValueAtTime(1500,t+.052);gain.gain.setValueAtTime(.065,t);gain.gain.exponentialRampToValueAtTime(.001,t+.075);tick.type="triangle";tick.frequency.setValueAtTime(2100,t);tick.frequency.exponentialRampToValueAtTime(1250,t+.035);tickGain.gain.setValueAtTime(.025,t);tickGain.gain.exponentialRampToValueAtTime(.001,t+.045);osc.connect(gain).connect(ctx.destination);tick.connect(tickGain).connect(ctx.destination);osc.start(t);osc.stop(t+.08);tick.start(t);tick.stop(t+.05);}catch{}}
  function updateCrosshair(){gamepadCrosshair.classList.toggle("active",Boolean(isEnabled()));viewport.dataset.fireCrosshairMode="center-fixed";}
  function damageFeedback(){damageVignette.classList.remove("active");void damageVignette.offsetWidth;damageVignette.classList.add("active");viewport.dataset.combatDamageFx=String((Number(viewport.dataset.combatDamageFx)||0)+1);}
  function hitConfirmFeedback(){hitConfirmSound();gamepadCrosshair.classList.remove("hit-confirm");void gamepadCrosshair.offsetWidth;gamepadCrosshair.classList.add("hit-confirm");viewport.dataset.combatHitConfirmFx=String((Number(viewport.dataset.combatHitConfirmFx)||0)+1);}
  const damageListener=()=>damageFeedback(),hitConfirmListener=()=>hitConfirmFeedback();window.addEventListener("arondight:combat-damage",damageListener);window.addEventListener("arondight:combat-hit-confirm",hitConfirmListener);
  function screenImpact(x,y){const el=screenImpacts[screenImpactCursor++%screenImpacts.length];el.classList.remove("active");el.style.left=`${x}px`;el.style.top=`${y}px`;void el.offsetWidth;el.classList.add("active");}
  function projectImpactToScreen(point){projectedImpact.copy(point).project(camera);if(projectedImpact.z<-1||projectedImpact.z>1||Math.abs(projectedImpact.x)>1.1||Math.abs(projectedImpact.y)>1.1)return;screenImpact((projectedImpact.x*.5+.5)*Math.max(1,viewport.clientWidth),(-projectedImpact.y*.5+.5)*Math.max(1,viewport.clientHeight));}
  function addThreeDecal(hit){
    if(!hit?.point)return false;const hasWorldNormal=hit.worldNormal&&Number.isFinite(hit.worldNormal.x)&&Number.isFinite(hit.worldNormal.y)&&Number.isFinite(hit.worldNormal.z);if(hasWorldNormal)hitNormal.copy(hit.worldNormal).normalize();else{if(!hit?.face?.normal||!hit.object)return false;hitNormal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld).normalize();}
    const mesh=decalPool[decalCursor++%decalPool.length];mesh.position.copy(hit.point).addScaledVector(hitNormal,.0035);mesh.quaternion.setFromUnitVectors(decalForward,hitNormal);mesh.rotateZ((decalWrites*2.399963229728653)%6.283185307179586);mesh.scale.setScalar(.88+(decalWrites%5)*.055);mesh.userData.flightFireWorld=Boolean(hasWorldNormal);mesh.visible=true;decalWrites++;viewport.dataset.fireDecalWrites=String(decalWrites);return true;
  }
  function impactFlash(point,vsHit=false,now=performance.now()){
    const item=impactPool[impactCursor++%impactPool.length];item.mesh.position.copy(point);item.mesh.scale.setScalar(vsHit?1.55:1);item.material.color.setHex(vsHit?0xff4b32:0xffb24d);item.material.opacity=1;item.mesh.visible=true;item.bornAt=now;item.expiresAt=now+(vsHit?240:170);
  }
  function updateImpacts(now){for(const item of impactPool){if(!item.mesh.visible)continue;if(now>=item.expiresAt){item.mesh.visible=false;item.material.opacity=0;continue;}const life=Math.max(1,item.expiresAt-item.bornAt),t=(now-item.bornAt)/life;item.material.opacity=Math.max(0,1-t);item.mesh.scale.multiplyScalar(1+Math.min(.08,(now-lastProjectileFrameMs)/1000*2));}}

  function aimPoint(){const rect={left:0,top:0,width:Math.max(1,viewport.clientWidth),height:Math.max(1,viewport.clientHeight)},x=rect.width*.5,y=rect.height*.5;return{x,y,rect};}
  function projectileMuzzle(ray){
    const airframe=worldBridge?.airframeFor?.(scene)||worldBridge?.airframe;if(!airframe?.getWorldPosition){muzzlePosition.copy(ray.origin);return muzzlePosition;}
    airframe.updateWorldMatrix?.(true,false);airframe.getWorldPosition(muzzlePosition);airframe.getWorldQuaternion?.(muzzleQuaternion);muzzleForward.set(-1,0,0).applyQuaternion(muzzleQuaternion).normalize();muzzleUp.set(0,0,1).applyQuaternion(muzzleQuaternion).normalize();muzzlePosition.addScaledVector(muzzleForward,.16).addScaledVector(muzzleUp,.018);return muzzlePosition;
  }
  function orientTracer(projectile){
    tracerDirection.copy(projectile.velocity);const speed=tracerDirection.length();if(speed<1e-5)return;tracerDirection.multiplyScalar(1/speed);projectile.mesh.quaternion.setFromUnitVectors(tracerAxis,tracerDirection);projectile.mesh.scale.set(1,TRACER_LENGTH_M,1);projectile.mesh.position.copy(projectile.position).addScaledVector(tracerDirection,-TRACER_LENGTH_M*.5);
  }
  function deactivateProjectile(projectile,expired=false){if(!projectile.active)return;projectile.active=false;projectile.mesh.visible=false;activeProjectileCount=Math.max(0,activeProjectileCount-1);viewport.dataset.fireActiveProjectiles=String(activeProjectileCount);if(expired)viewport.dataset.fireProjectileExpired=String((Number(viewport.dataset.fireProjectileExpired)||0)+1);}
  function spawnProjectile(now,aim){
    pointerNdc.set(aim.x/aim.rect.width*2-1,-(aim.y/aim.rect.height)*2+1);raycaster.setFromCamera(pointerNdc,camera);projectileMuzzle(raycaster.ray);aimTarget.copy(raycaster.ray.origin).addScaledVector(raycaster.ray.direction,PROJECTILE_AIM_DISTANCE_M);launchDirection.copy(aimTarget).sub(muzzlePosition).normalize();
    const projectile=projectilePool[projectileCursor++%projectilePool.length];if(projectile.active)deactivateProjectile(projectile,true);projectile.active=true;projectile.position.copy(muzzlePosition);projectile.velocity.copy(launchDirection).multiplyScalar(TRACER_SPEED_MPS);projectile.bornAt=now;projectile.source=active?.source||"pointer";projectile.mesh.visible=true;activeProjectileCount++;orientTracer(projectile);viewport.dataset.fireActiveProjectiles=String(activeProjectileCount);viewport.dataset.fireTracerSpawns=String((Number(viewport.dataset.fireTracerSpawns)||0)+1);return projectile;
  }
  function resolveProjectileHit(projectile,start,end,now){
    const deltaX=end.x-start.x,deltaY=end.y-start.y,deltaZ=end.z-start.z,segmentLength=Math.hypot(deltaX,deltaY,deltaZ);if(segmentLength<1e-6)return false;
    tracerDirection.set(deltaX/segmentLength,deltaY/segmentLength,deltaZ/segmentLength);raycaster.set(start,tracerDirection);raycaster.near=0;raycaster.far=segmentLength;intersections.length=0;raycaster.intersectObjects(candidates,false,intersections);const sceneHit=intersections[0]||null;
    const worldHit=worldBridge?.active?traceProjectileWorldSegment(worldBridge.buildingCollisionSnapshot,start,end,projectile.worldHit||(projectile.worldHit=createProjectileHit())):null;
    const sceneDistance=Number(sceneHit?.distance),worldDistance=Number(worldHit?.distanceM),takeScene=sceneHit&&Number.isFinite(sceneDistance)&&(!worldHit||sceneDistance<=worldDistance);
    if(!takeScene&&!worldHit)return false;
    let impactPoint,vsHit=false;
    if(takeScene){impactPoint=sceneHit.point;vsHit=Boolean(worldBridge?.registerVsHit?.(sceneHit));if(!vsHit)addThreeDecal(sceneHit);}else{worldImpactPoint.set(worldHit.point.x,worldHit.point.y,worldHit.point.z);worldImpactNormal.set(worldHit.normal.x,worldHit.normal.y,worldHit.normal.z);impactPoint=worldImpactPoint;addThreeDecal(worldVisualHit);}
    impactFlash(impactPoint,vsHit,now);projectImpactToScreen(impactPoint);viewport.dataset.fireProjectileImpacts=String((Number(viewport.dataset.fireProjectileImpacts)||0)+1);if(vsHit)viewport.dataset.fireVsHits=String((Number(viewport.dataset.fireVsHits)||0)+1);deactivateProjectile(projectile,false);return true;
  }
  function updateProjectiles(now){
    updateCrosshair();ensurePeerCombatScale();updateImpacts(now);const dt=Math.max(0,Math.min(.08,(now-lastProjectileFrameMs)/1000));lastProjectileFrameMs=now;if(activeProjectileCount>0){refreshCandidates();for(const projectile of projectilePool){if(!projectile.active)continue;if(now-projectile.bornAt>=PROJECTILE_TTL_MS){deactivateProjectile(projectile,true);continue;}integrateProjectile(projectile.position,projectile.velocity,dt,projectile.nextPosition,projectile.nextVelocity);if(resolveProjectileHit(projectile,projectile.position,projectile.nextPosition,now))continue;projectile.position.copy(projectile.nextPosition);projectile.velocity.copy(projectile.nextVelocity);orientTracer(projectile);}}
    projectileRaf=requestAnimationFrame(updateProjectiles);
  }
  projectileRaf=requestAnimationFrame(updateProjectiles);

  function fire(now){
    if(!active||now+.25<nextShotAt)return false;nextShotAt=now+SHOT_INTERVAL_MS;const aim=aimPoint();spawnProjectile(now,aim);shotSound();try{onRecoil(.16);}catch{}viewport.dataset.fireShots=String((Number(viewport.dataset.fireShots)||0)+1);viewport.dataset.fireAimX=aim.x.toFixed(2);viewport.dataset.fireAimY=aim.y.toFixed(2);viewport.dataset.fireInputSource=active.source||"pointer";return true;
  }
  function scheduleFire(){
    if(!active||fireTimer)return;const tick=()=>{fireTimer=0;if(!active)return;const now=performance.now();fire(now);fireTimer=setTimeout(tick,Math.max(4,nextShotAt-performance.now()+1));};fireTimer=setTimeout(tick,Math.max(4,nextShotAt-performance.now()+1));
  }
  function move(event){if(!active||active.source==="gamepad"||event.pointerId!==active.id)return;active.clientX=event.clientX;active.clientY=event.clientY;fire(performance.now());scheduleFire();event.preventDefault();}
  function stop(event){if(!active||(event?.pointerId!=null&&event.pointerId!==active.id))return;const id=active.id;active=null;if(fireTimer){clearTimeout(fireTimer);fireTimer=0;}viewport.dataset.fireInputSource="none";try{viewport.releasePointerCapture?.(id);}catch{}event?.preventDefault();}
  function setGamepadAim(enabled){viewport.dataset.gamepadAim=Boolean(enabled&&isEnabled())?"1":"0";updateCrosshair();}
  function setGamepadFire(pressed){
    if(!pressed||!isEnabled()){if(active?.source==="gamepad")stop();return false;}
    if(active&&active.source!=="gamepad")return false;
    if(!active){active={id:"xbox",source:"gamepad"};ensureAudio();nextShotAt=0;}
    fire(performance.now());scheduleFire();return true;
  }
  viewport.addEventListener("pointerdown",event=>{
    if(!isEnabled()||!isPointerEnabled()||event.button!==0||blocked(event.target)||active)return;active={id:event.pointerId,source:"pointer",clientX:event.clientX,clientY:event.clientY};try{viewport.setPointerCapture?.(event.pointerId);}catch{}ensureAudio();nextShotAt=0;fire(performance.now());scheduleFire();event.preventDefault();
  },{passive:false});
  viewport.addEventListener("pointermove",move,{passive:false});viewport.addEventListener("pointerup",stop,{passive:false});viewport.addEventListener("pointercancel",stop,{passive:false});
  return{stop,setGamepadAim,setGamepadFire,get decalPoolSize(){return decalPool.length;},get decalWrites(){return decalWrites;},get projectilePoolSize(){return projectilePool.length;},get activeProjectiles(){return activeProjectileCount;},dispose(){stop();cancelAnimationFrame(projectileRaf);window.removeEventListener("arondight:combat-damage",damageListener);window.removeEventListener("arondight:combat-hit-confirm",hitConfirmListener);gamepadCrosshair.remove();damageVignette.remove();for(const projectile of projectilePool){projectile.mesh.parent?.remove(projectile.mesh);projectile.mesh.visible=false;}for(const item of impactPool){item.mesh.parent?.remove(item.mesh);item.mesh.visible=false;item.material.dispose();}for(const mesh of decalPool){mesh.parent?.remove(mesh);mesh.visible=false;}tracerGeometry.dispose();tracerMaterial.dispose();impactGeometry.dispose();decalGeometry.dispose();decalMaterial.dispose();peerHitProxyMaterial.dispose();for(const el of screenImpacts)el.remove();style.remove();try{audioCtx?.close();}catch{}}};
}
