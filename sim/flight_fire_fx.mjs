import * as THREE from "three";

const SHOT_INTERVAL_MS=92;
const DECAL_POOL_SIZE=32;
const SCREEN_IMPACT_POOL_SIZE=8;
const TOUCH_DOUBLE_TAP_MS=330;
const TOUCH_DOUBLE_TAP_PX=36;
const TOUCH_HOLD_FIRE_MS=115;
const BLOCKED_SELECTOR="#soloTopbar,#soloRaceHud,#soloLeft,#soloRight,#soloClearance,.solo-action,.phone-settings-dialog,#worldLookHud,dialog,button,input,select,textarea,a,label";

export function installFlightFireFx({viewport,scene,camera,worldBridge=null,isEnabled=()=>document.body.classList.contains("solo-flight"),isPointerEnabled=()=>true}={}){
  if(!viewport||!scene||!camera)throw Error("flight fire FX requires viewport, scene and camera");
  if(viewport.dataset.fireFxInstalled==="1")return null;
  viewport.dataset.fireFxInstalled="1";
  viewport.dataset.fireDecalPoolSize=String(DECAL_POOL_SIZE);
  viewport.dataset.fireDecalWrites="0";
  viewport.dataset.fireTouchGestureArbiter="1";

  const style=document.createElement("style");style.textContent=`
    #viewport{touch-action:none;overscroll-behavior:none}
    .flight-fire-impact{position:absolute;z-index:11;width:13px;height:13px;margin:-6.5px 0 0 -6.5px;border-radius:50%;border:1px solid #fff7c2;background:radial-gradient(circle,#fff9be 0 16%,#ffbf55 22%,#ff6d35aa 42%,transparent 68%);box-shadow:0 0 12px #ffb14a;pointer-events:none;display:none}
    .flight-fire-impact.active{display:block;animation:flightImpactFade .48s ease-out forwards}
    .xbox-crosshair{display:none;position:absolute;z-index:12;width:34px;height:34px;margin:-17px 0 0 -17px;border:2px solid #dffaff;border-radius:50%;pointer-events:none;filter:drop-shadow(0 0 5px #47cfff);box-shadow:inset 0 0 0 7px #07152277}
    .xbox-crosshair:before,.xbox-crosshair:after{content:"";position:absolute;left:50%;top:50%;background:#ff6f7f;transform:translate(-50%,-50%)}.xbox-crosshair:before{width:44px;height:2px}.xbox-crosshair:after{width:2px;height:44px}
    .xbox-crosshair.active{display:block}
    @keyframes flightImpactFade{from{opacity:1;transform:scale(.65)}to{opacity:0;transform:scale(1.55)}}
  `;document.head.appendChild(style);

  const screenImpacts=Array.from({length:SCREEN_IMPACT_POOL_SIZE},()=>{const el=document.createElement("i");el.className="flight-fire-impact";el.addEventListener("animationend",()=>el.classList.remove("active"));viewport.appendChild(el);return el;});
  const gamepadCrosshair=document.createElement("i");gamepadCrosshair.className="xbox-crosshair";gamepadCrosshair.setAttribute("aria-hidden","true");viewport.appendChild(gamepadCrosshair);
  let screenImpactCursor=0;
  const raycaster=new THREE.Raycaster(),pointerNdc=new THREE.Vector2(),candidates=[],intersections=[],hitNormal=new THREE.Vector3(),decalForward=new THREE.Vector3(0,0,1);
  const decalGeometry=new THREE.CircleGeometry(.022,12),decalMaterial=new THREE.MeshBasicMaterial({color:0x171717,transparent:true,opacity:.94,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-4,polygonOffsetUnits:-4,side:THREE.DoubleSide});
  const decalPool=Array.from({length:DECAL_POOL_SIZE},()=>{const mesh=new THREE.Mesh(decalGeometry,decalMaterial);mesh.visible=false;mesh.renderOrder=8;mesh.userData.flightFireDecal=true;mesh.userData.flightFireWorld=false;scene.add(mesh);return mesh;});
  let decalCursor=0,decalWrites=0,active=null,nextShotAt=0,fireTimer=0,audioCtx=null,noiseBuffer=null,touchHoldTimer=0,pendingTap=null,pendingTapTimer=0;

  function blocked(target){return target instanceof Element&&Boolean(target.closest(BLOCKED_SELECTOR));}
  function multiplayerDoubleTapEnabled(){return Boolean(globalThis.__arondightRealWorld?.vsConnected);}
  function hiddenTrainingObject(object){if(!worldBridge?.active)return false;for(let node=object;node;node=node.parent)if(worldBridge.trainingObjects?.has?.(node))return true;return false;}
  function visibleInHierarchy(object){for(let node=object;node;node=node.parent)if(node.visible===false)return false;return true;}
  function ensureAudio(){
    if(audioCtx)return audioCtx;const Ctx=window.AudioContext||window.webkitAudioContext;if(!Ctx)return null;audioCtx=new Ctx();noiseBuffer=audioCtx.createBuffer(1,Math.floor(audioCtx.sampleRate*.045),audioCtx.sampleRate);const data=noiseBuffer.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=(Math.random()*2-1)*(1-i/data.length);return audioCtx;
  }
  function shotSound(){
    const ctx=ensureAudio();if(!ctx||!noiseBuffer)return;try{if(ctx.state==="suspended")ctx.resume();const src=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),gain=ctx.createGain();src.buffer=noiseBuffer;filter.type="bandpass";filter.frequency.value=1350;filter.Q.value=.7;gain.gain.setValueAtTime(.18,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.05);src.connect(filter).connect(gain).connect(ctx.destination);src.start();src.stop(ctx.currentTime+.055);}catch{}
  }
  function screenImpact(x,y){const el=screenImpacts[screenImpactCursor++%screenImpacts.length];el.classList.remove("active");el.style.left=`${x}px`;el.style.top=`${y}px`;void el.offsetWidth;el.classList.add("active");}
  function addThreeDecal(hit){
    if(!hit?.point)return false;const hasWorldNormal=hit.worldNormal&&Number.isFinite(hit.worldNormal.x)&&Number.isFinite(hit.worldNormal.y)&&Number.isFinite(hit.worldNormal.z);if(hasWorldNormal)hitNormal.copy(hit.worldNormal).normalize();else{if(!hit?.face?.normal||!hit.object)return false;hitNormal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld).normalize();}
    const mesh=decalPool[decalCursor++%decalPool.length];mesh.position.copy(hit.point).addScaledVector(hitNormal,.0035);mesh.quaternion.setFromUnitVectors(decalForward,hitNormal);mesh.rotateZ((decalWrites*2.399963229728653)%6.283185307179586);mesh.scale.setScalar(.88+(decalWrites%5)*.055);mesh.userData.flightFireWorld=Boolean(hasWorldNormal);mesh.visible=true;decalWrites++;viewport.dataset.fireDecalWrites=String(decalWrites);return true;
  }
  function aimPoint(state=active){
    const screenRect=viewport.getBoundingClientRect(),rect={left:0,top:0,width:Math.max(1,viewport.clientWidth),height:Math.max(1,viewport.clientHeight)};
    if(state?.source==="gamepad")return{x:Math.max(0,Math.min(rect.width,state.x)),y:Math.max(0,Math.min(rect.height,state.y)),rect};
    const clientX=state?.clientX??screenRect.left+screenRect.width/2,clientY=state?.clientY??screenRect.top+screenRect.height/2,rotated=viewport.dataset.soloOrientation==="css-landscape";
    const x=rotated?clientY-screenRect.top:clientX-screenRect.left,y=rotated?screenRect.right-clientX:clientY-screenRect.top;
    return{x:Math.max(0,Math.min(rect.width,x)),y:Math.max(0,Math.min(rect.height,y)),rect};
  }
  function fire(now,state=active){
    if(!state||now+.25<nextShotAt)return false;nextShotAt=now+SHOT_INTERVAL_MS;const aim=aimPoint(state);pointerNdc.set(aim.x/aim.rect.width*2-1,-(aim.y/aim.rect.height)*2+1);raycaster.setFromCamera(pointerNdc,camera);
    candidates.length=0;scene.traverse(object=>{if(object.isMesh&&visibleInHierarchy(object)&&!object.userData?.arondightAirframe&&!object.userData?.flightFireDecal&&!object.userData?.flightFireIgnore&&object.material?.visible!==false&&!hiddenTrainingObject(object))candidates.push(object);});intersections.length=0;raycaster.intersectObjects(candidates,false,intersections);const hit=intersections[0];
    const vsHit=Boolean(hit&&worldBridge?.registerVsHit?.(hit));if(hit&&!vsHit)addThreeDecal(hit);else if(!hit){const worldHit=worldBridge?.addVisualShotImpact?.(aim.x,aim.y,aim.rect,raycaster.ray);if(worldHit)addThreeDecal(worldHit);}if(vsHit)viewport.dataset.fireVsHits=String((Number(viewport.dataset.fireVsHits)||0)+1);
    screenImpact(aim.x,aim.y);shotSound();viewport.dataset.fireShots=String((Number(viewport.dataset.fireShots)||0)+1);viewport.dataset.fireAimX=aim.x.toFixed(2);viewport.dataset.fireAimY=aim.y.toFixed(2);viewport.dataset.fireInputSource=state.source||"pointer";return true;
  }
  function scheduleFire(){
    if(!active||fireTimer)return;const tick=()=>{fireTimer=0;if(!active)return;const now=performance.now();fire(now);fireTimer=setTimeout(tick,Math.max(4,nextShotAt-performance.now()+1));};fireTimer=setTimeout(tick,Math.max(4,nextShotAt-performance.now()+1));
  }
  function cancelPendingTap(){if(pendingTapTimer){clearTimeout(pendingTapTimer);pendingTapTimer=0;}pendingTap=null;}
  function firePendingTap(){if(!pendingTap)return false;const tap=pendingTap;cancelPendingTap();const previousNext=nextShotAt;nextShotAt=0;const fired=fire(performance.now(),{id:"tap",source:"pointer",clientX:tap.clientX,clientY:tap.clientY});nextShotAt=Math.max(nextShotAt,previousNext);return fired;}
  function armPendingTap(tap){cancelPendingTap();pendingTap=tap;pendingTapTimer=setTimeout(()=>{pendingTapTimer=0;if(!pendingTap)return;const shot=pendingTap;pendingTap=null;const previousNext=nextShotAt;nextShotAt=0;fire(performance.now(),{id:"tap",source:"pointer",clientX:shot.clientX,clientY:shot.clientY});nextShotAt=Math.max(nextShotAt,previousNext);},TOUCH_DOUBLE_TAP_MS+8);}
  function emitDoubleTap(event){viewport.dataset.fireDoubleTapSuppressed=String((Number(viewport.dataset.fireDoubleTapSuppressed)||0)+1);viewport.dispatchEvent(new CustomEvent("flightfiredoubletap",{detail:{clientX:Number(event.clientX),clientY:Number(event.clientY),pointerType:String(event.pointerType||"touch")}}));}
  function move(event){if(!active||active.source==="gamepad"||event.pointerId!==active.id)return;active.clientX=event.clientX;active.clientY=event.clientY;if(!active.touchGesture||active.holdFired){fire(performance.now());scheduleFire();}event.preventDefault();}
  function stop(event){
    if(!active||(event?.pointerId!=null&&event.pointerId!==active.id))return;const state=active,id=state.id;active=null;if(touchHoldTimer){clearTimeout(touchHoldTimer);touchHoldTimer=0;}if(fireTimer){clearTimeout(fireTimer);fireTimer=0;}viewport.dataset.fireInputSource="none";try{viewport.releasePointerCapture?.(id);}catch{}
    if(state.touchGesture&&!state.holdFired&&event){const now=performance.now(),tap={clientX:Number(event.clientX),clientY:Number(event.clientY),at:now};if(pendingTap){const dt=now-pendingTap.at,distance=Math.hypot(tap.clientX-pendingTap.clientX,tap.clientY-pendingTap.clientY);if(dt>0&&dt<=TOUCH_DOUBLE_TAP_MS&&distance<=TOUCH_DOUBLE_TAP_PX){cancelPendingTap();emitDoubleTap(event);event.preventDefault();return;}firePendingTap();}armPendingTap(tap);}
    event?.preventDefault();
  }
  function setGamepadAim(enabled,x=viewport.clientWidth/2,y=viewport.clientHeight/2){const activeAim=Boolean(enabled&&isEnabled());gamepadCrosshair.classList.toggle("active",activeAim);gamepadCrosshair.style.left=`${Math.max(0,Math.min(viewport.clientWidth,Number(x)||0))}px`;gamepadCrosshair.style.top=`${Math.max(0,Math.min(viewport.clientHeight,Number(y)||0))}px`;viewport.dataset.gamepadAim=activeAim?"1":"0";}
  function setGamepadFire(pressed,x=viewport.clientWidth/2,y=viewport.clientHeight/2){
    if(!pressed||!isEnabled()){if(active?.source==="gamepad")stop();return false;}
    if(active&&active.source!=="gamepad")return false;
    if(!active){active={id:"xbox",source:"gamepad",x,y};ensureAudio();nextShotAt=0;}else{active.x=x;active.y=y;}
    fire(performance.now());scheduleFire();return true;
  }
  viewport.addEventListener("pointerdown",event=>{
    if(!isEnabled()||!isPointerEnabled()||event.button!==0||blocked(event.target)||active)return;
    const touchGesture=event.pointerType==="touch"&&multiplayerDoubleTapEnabled();
    if(touchGesture&&pendingTap){const dt=performance.now()-pendingTap.at,distance=Math.hypot(Number(event.clientX)-pendingTap.clientX,Number(event.clientY)-pendingTap.clientY);if(dt>TOUCH_DOUBLE_TAP_MS||distance>TOUCH_DOUBLE_TAP_PX)firePendingTap();}
    active={id:event.pointerId,source:"pointer",clientX:event.clientX,clientY:event.clientY,touchGesture,holdFired:false};try{viewport.setPointerCapture?.(event.pointerId);}catch{}ensureAudio();nextShotAt=0;
    if(touchGesture){touchHoldTimer=setTimeout(()=>{touchHoldTimer=0;if(!active||active.id!==event.pointerId||!active.touchGesture)return;if(pendingTap)firePendingTap();active.holdFired=true;nextShotAt=0;fire(performance.now());scheduleFire();},TOUCH_HOLD_FIRE_MS);}else{fire(performance.now());scheduleFire();}event.preventDefault();
  },{passive:false});
  viewport.addEventListener("pointermove",move,{passive:false});viewport.addEventListener("pointerup",stop,{passive:false});viewport.addEventListener("pointercancel",stop,{passive:false});
  return{stop,setGamepadAim,setGamepadFire,get decalPoolSize(){return decalPool.length;},get decalWrites(){return decalWrites;},dispose(){stop();cancelPendingTap();if(touchHoldTimer)clearTimeout(touchHoldTimer);gamepadCrosshair.remove();for(const mesh of decalPool){mesh.parent?.remove(mesh);mesh.visible=false;}decalGeometry.dispose();decalMaterial.dispose();for(const el of screenImpacts)el.remove();style.remove();try{audioCtx?.close();}catch{}}};
}
