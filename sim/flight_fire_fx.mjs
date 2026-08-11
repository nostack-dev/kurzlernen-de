import * as THREE from "three";

const SHOT_INTERVAL_MS=92;
const DECAL_POOL_SIZE=32;
const SCREEN_IMPACT_POOL_SIZE=8;
const RAYCAST_REFRESH_MS=500;
const BLOCKED_SELECTOR="#soloTopbar,#soloRaceHud,#soloLeft,#soloRight,#soloClearance,.solo-action,.phone-settings-dialog,#worldLookHud,dialog,button,input,select,textarea,a,label";

export function installFlightFireFx({viewport,scene,camera,worldBridge=null,isEnabled=()=>document.body.classList.contains("solo-flight"),onImpact=null}={}){
  if(!viewport||!scene||!camera)throw Error("flight fire FX requires viewport, scene and camera");
  if(viewport.dataset.fireFxInstalled==="1")return null;
  viewport.dataset.fireFxInstalled="1";
  viewport.dataset.fireDecalPoolSize=String(DECAL_POOL_SIZE);
  viewport.dataset.fireDecalWrites="0";
  viewport.dataset.fireRaycastBuilds="0";
  viewport.dataset.fireWorldHits="0";
  viewport.dataset.fireObjectHits="0";
  viewport.dataset.fireTargetHits="0";
  viewport.dataset.fireMisses="0";

  const style=document.createElement("style");style.textContent=`
    #viewport{touch-action:none;overscroll-behavior:none}
    .flight-fire-impact{position:absolute;z-index:11;width:13px;height:13px;margin:-6.5px 0 0 -6.5px;border-radius:50%;border:1px solid #fff7c2;background:radial-gradient(circle,#fff9be 0 16%,#ffbf55 22%,#ff6d35aa 42%,transparent 68%);box-shadow:0 0 12px #ffb14a;pointer-events:none;opacity:0}
    .flight-fire-impact.pulse-a{animation:flightImpactFadeA .48s ease-out forwards}.flight-fire-impact.pulse-b{animation:flightImpactFadeB .48s ease-out forwards}
    @keyframes flightImpactFadeA{from{opacity:1;transform:scale(.65)}to{opacity:0;transform:scale(1.55)}}
    @keyframes flightImpactFadeB{from{opacity:1;transform:scale(.65)}to{opacity:0;transform:scale(1.55)}}
  `;document.head.appendChild(style);

  const screenImpacts=Array.from({length:SCREEN_IMPACT_POOL_SIZE},()=>{const el=document.createElement("i");el.className="flight-fire-impact";viewport.appendChild(el);return el;});
  let screenImpactCursor=0,screenImpactPulse=false;
  const raycaster=new THREE.Raycaster(),pointerNdc=new THREE.Vector2(),candidates=[],intersections=[],hitNormal=new THREE.Vector3(),decalForward=new THREE.Vector3(0,0,1),observedNodes=new Set();
  const decalGeometry=new THREE.CircleGeometry(.022,12);
  const objectDecalMaterial=new THREE.MeshBasicMaterial({color:0x171717,transparent:true,opacity:.96,depthTest:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-4,polygonOffsetUnits:-4,side:THREE.DoubleSide});
  const worldDecalMaterial=new THREE.MeshBasicMaterial({color:0x111111,transparent:true,opacity:.98,depthTest:false,depthWrite:false,side:THREE.DoubleSide});
  const decalPool=Array.from({length:DECAL_POOL_SIZE},()=>{const mesh=new THREE.Mesh(decalGeometry,objectDecalMaterial);mesh.visible=false;mesh.renderOrder=8;mesh.userData.flightFireDecal=true;mesh.userData.flightFireWorld=false;mesh.userData.flightFireKind="none";scene.add(mesh);return mesh;});
  let decalCursor=0,decalWrites=0,active=null,nextShotAt=0,fireTimer=0,audioCtx=null,noiseBuffer=null,noiseSource=null,noiseFilter=null,noiseGain=null,raycastBuilds=0,lastRaycastBuildMs=-Infinity,impactSerial=0,candidatesDirty=true;

  function blocked(target){return target instanceof Element&&Boolean(target.closest(BLOCKED_SELECTOR));}
  function belongsToAirframe(object){for(let node=object;node;node=node.parent)if(node.userData?.arondightAirframe)return true;return false;}
  function hiddenTrainingObject(object){if(!worldBridge?.active)return false;for(let node=object;node;node=node.parent)if(worldBridge.trainingObjects?.has?.(node))return true;return false;}
  function impactTargetRoot(object){for(let node=object;node&&node!==scene;node=node.parent){const u=node.userData||{};if(u.flightTarget||u.hitTarget||u.damageable||u.enemy||u.opponent||u.shootable)return node;}return null;}
  function hierarchyVisible(object){for(let node=object;node&&node!==scene;node=node.parent)if(node.visible===false)return false;return true;}
  function hitEligible(object){return Boolean(object?.isMesh)&&hierarchyVisible(object)&&object.material?.visible!==false&&!belongsToAirframe(object)&&!object.userData?.flightFireDecal&&!hiddenTrainingObject(object);}
  function onChildAdded(event){const child=event?.child;if(!child||child.userData?.flightFireDecal)return;observeNode(child);candidatesDirty=true;}
  function onChildRemoved(event){const child=event?.child;if(!child||child.userData?.flightFireDecal)return;unobserveNode(child);candidatesDirty=true;}
  function observeNode(node){if(!node||observedNodes.has(node)||node.userData?.flightFireDecal)return;observedNodes.add(node);node.addEventListener?.("childadded",onChildAdded);node.addEventListener?.("childremoved",onChildRemoved);for(const child of node.children||[])observeNode(child);}
  function unobserveNode(node){if(!node||!observedNodes.has(node))return;for(const child of node.children||[])unobserveNode(child);node.removeEventListener?.("childadded",onChildAdded);node.removeEventListener?.("childremoved",onChildRemoved);observedNodes.delete(node);}
  observeNode(scene);
  function ensureAudio(){
    if(audioCtx)return audioCtx;const Ctx=window.AudioContext||window.webkitAudioContext;if(!Ctx)return null;audioCtx=new Ctx();noiseBuffer=audioCtx.createBuffer(1,Math.floor(audioCtx.sampleRate*.25),audioCtx.sampleRate);const data=noiseBuffer.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=Math.random()*2-1;noiseSource=audioCtx.createBufferSource();noiseFilter=audioCtx.createBiquadFilter();noiseGain=audioCtx.createGain();noiseSource.buffer=noiseBuffer;noiseSource.loop=true;noiseFilter.type="bandpass";noiseFilter.frequency.value=1350;noiseFilter.Q.value=.7;noiseGain.gain.value=.00001;noiseSource.connect(noiseFilter).connect(noiseGain).connect(audioCtx.destination);noiseSource.start();return audioCtx;
  }
  function shotSound(){
    const ctx=ensureAudio();if(!ctx||!noiseGain)return;try{if(ctx.state==="suspended")void ctx.resume();const now=ctx.currentTime,gain=noiseGain.gain;gain.cancelScheduledValues(now);gain.setValueAtTime(.00001,now);gain.linearRampToValueAtTime(.18,now+.002);gain.exponentialRampToValueAtTime(.00001,now+.052);}catch{}
  }
  function screenImpact(x,y){const el=screenImpacts[screenImpactCursor++%screenImpacts.length],pulse=el.dataset.pulse==="a"?"b":"a";el.dataset.pulse=pulse;el.style.left=`${x}px`;el.style.top=`${y}px`;el.classList.toggle("pulse-a",pulse==="a");el.classList.toggle("pulse-b",pulse==="b");}
  function rebuildCandidates(now=performance.now()){
    candidates.length=0;scene.traverse(object=>{if(object.isMesh&&!belongsToAirframe(object)&&!object.userData?.flightFireDecal)candidates.push(object);});lastRaycastBuildMs=now;raycastBuilds++;candidatesDirty=false;viewport.dataset.fireRaycastBuilds=String(raycastBuilds);
  }
  function refreshCandidates(now){if(candidatesDirty||!candidates.length||now-lastRaycastBuildMs>=RAYCAST_REFRESH_MS)rebuildCandidates(now);}
  function emitImpact(kind,hit,targetRoot=null){
    const point=hit?.point,normal=hit?.worldNormal||hitNormal;if(!point||!normal)return;impactSerial++;const detail={serial:impactSerial,kind,point:{x:point.x,y:point.y,z:point.z},normal:{x:normal.x,y:normal.y,z:normal.z},object:hit?.object||null,target:targetRoot};try{onImpact?.(detail);}catch(error){console.warn("flight impact callback failed",error);}viewport.dispatchEvent(new CustomEvent("arondight45:impact",{detail,bubbles:true}));
  }
  function addThreeDecal(hit,kind="object",targetRoot=null){
    if(!hit?.point)return false;const hasWorldNormal=hit.worldNormal&&Number.isFinite(hit.worldNormal.x)&&Number.isFinite(hit.worldNormal.y)&&Number.isFinite(hit.worldNormal.z);if(hasWorldNormal)hitNormal.copy(hit.worldNormal).normalize();else{if(!hit?.face?.normal||!hit.object)return false;hitNormal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld).normalize();}
    const mesh=decalPool[decalCursor++%decalPool.length];scene.add(mesh);mesh.material=hasWorldNormal?worldDecalMaterial:objectDecalMaterial;mesh.position.copy(hit.point).addScaledVector(hitNormal,.0035);mesh.quaternion.setFromUnitVectors(decalForward,hitNormal);mesh.rotateZ((decalWrites*2.399963229728653)%6.283185307179586);mesh.scale.setScalar(.88+(decalWrites%5)*.055);mesh.renderOrder=hasWorldNormal?18:8;mesh.userData.flightFireWorld=Boolean(hasWorldNormal);mesh.userData.flightFireKind=kind;mesh.userData.flightFireTarget=Boolean(targetRoot);mesh.visible=true;mesh.updateMatrixWorld(true);
    if(!hasWorldNormal&&hit.object?.attach)hit.object.attach(mesh);
    decalWrites++;viewport.dataset.fireDecalWrites=String(decalWrites);emitImpact(kind,hit,targetRoot);return true;
  }
  function aimPoint(){
    const rect=viewport.getBoundingClientRect(),clientX=active?.clientX??rect.left+rect.width/2,clientY=active?.clientY??rect.top+rect.height/2;
    return{x:Math.max(0,Math.min(rect.width,clientX-rect.left)),y:Math.max(0,Math.min(rect.height,clientY-rect.top)),rect};
  }
  function fire(now){
    if(!active||now+.25<nextShotAt)return false;nextShotAt=now+SHOT_INTERVAL_MS;refreshCandidates(now);const aim=aimPoint();pointerNdc.set(aim.x/aim.rect.width*2-1,-(aim.y/aim.rect.height)*2+1);raycaster.setFromCamera(pointerNdc,camera);
    intersections.length=0;raycaster.intersectObjects(candidates,false,intersections);const hit=intersections.find(item=>hitEligible(item.object));let impacted=false;
    if(hit){const targetRoot=impactTargetRoot(hit.object),kind=targetRoot?"target":"object";impacted=addThreeDecal(hit,kind,targetRoot);viewport.dataset.fireObjectHits=String((Number(viewport.dataset.fireObjectHits)||0)+(impacted?1:0));if(targetRoot&&impacted)viewport.dataset.fireTargetHits=String((Number(viewport.dataset.fireTargetHits)||0)+1);}
    else{const worldHit=worldBridge?.addVisualShotImpact?.(aim.x,aim.y,aim.rect,raycaster.ray);if(worldHit){if(worldHit.mapDecal){impacted=true;decalWrites++;viewport.dataset.fireDecalWrites=String(decalWrites);emitImpact("world",worldHit,null);}else impacted=addThreeDecal(worldHit,"world",null);if(impacted)viewport.dataset.fireWorldHits=String((Number(viewport.dataset.fireWorldHits)||0)+1);}}
    if(impacted)screenImpact(aim.x,aim.y);else viewport.dataset.fireMisses=String((Number(viewport.dataset.fireMisses)||0)+1);shotSound();viewport.dataset.fireShots=String((Number(viewport.dataset.fireShots)||0)+1);viewport.dataset.fireAimX=aim.x.toFixed(2);viewport.dataset.fireAimY=aim.y.toFixed(2);return true;
  }
  function scheduleFire(){
    if(!active||fireTimer)return;const tick=()=>{fireTimer=0;if(!active)return;const now=performance.now();fire(now);fireTimer=setTimeout(tick,Math.max(4,nextShotAt-performance.now()+1));};fireTimer=setTimeout(tick,Math.max(4,nextShotAt-performance.now()+1));
  }
  function move(event){if(!active||event.pointerId!==active.id)return;active.clientX=event.clientX;active.clientY=event.clientY;fire(performance.now());scheduleFire();event.preventDefault();}
  function stop(event){if(!active||(event?.pointerId!=null&&event.pointerId!==active.id))return;const id=active.id;active=null;if(fireTimer){clearTimeout(fireTimer);fireTimer=0;}try{viewport.releasePointerCapture?.(id);}catch{}event?.preventDefault();}
  viewport.addEventListener("pointerdown",event=>{
    if(!isEnabled()||event.button!==0||blocked(event.target)||active)return;active={id:event.pointerId,clientX:event.clientX,clientY:event.clientY};try{viewport.setPointerCapture?.(event.pointerId);}catch{}rebuildCandidates(performance.now());ensureAudio();nextShotAt=0;fire(performance.now());scheduleFire();event.preventDefault();
  },{passive:false});
  viewport.addEventListener("pointermove",move,{passive:false});viewport.addEventListener("pointerup",stop,{passive:false});viewport.addEventListener("pointercancel",stop,{passive:false});
  return{stop,get decalPoolSize(){return decalPool.length;},get decalWrites(){return decalWrites;},get impactCount(){return impactSerial;},dispose(){stop();unobserveNode(scene);for(const mesh of decalPool){mesh.parent?.remove(mesh);mesh.visible=false;}decalGeometry.dispose();objectDecalMaterial.dispose();worldDecalMaterial.dispose();for(const el of screenImpacts)el.remove();style.remove();try{noiseSource?.stop();}catch{}try{audioCtx?.close();}catch{}}};
}