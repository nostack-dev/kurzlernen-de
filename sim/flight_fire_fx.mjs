import * as THREE from "three";

const SHOT_INTERVAL_MS=92;
const DECAL_POOL_SIZE=32;
const SCREEN_IMPACT_POOL_SIZE=8;
const STICK_RADIUS_PX=42;
const AIM_RADIUS_FRACTION=.24;
const BLOCKED_SELECTOR="#soloTopbar,#soloRaceHud,#soloLeft,#soloRight,#soloClearance,.solo-action,.phone-settings-dialog,#worldLookHud,dialog,button,input,select,textarea,a,label";
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));

export function installFlightFireFx({viewport,scene,camera,worldBridge=null,isEnabled=()=>document.body.classList.contains("solo-flight")}={}){
  if(!viewport||!scene||!camera)throw Error("flight fire FX requires viewport, scene and camera");
  if(viewport.dataset.fireFxInstalled==="1")return null;
  viewport.dataset.fireFxInstalled="1";
  viewport.dataset.fireDecalPoolSize=String(DECAL_POOL_SIZE);
  viewport.dataset.fireDecalWrites="0";

  const style=document.createElement("style");style.textContent=`
    #viewport{touch-action:none;overscroll-behavior:none}
    #flightFireStick{position:absolute;z-index:13;width:92px;height:92px;margin:-46px 0 0 -46px;border-radius:50%;border:2px solid #62ef9bbb;background:#0a3c2255;box-shadow:0 0 0 1px #07170dcc inset,0 0 22px #43f18c55;pointer-events:none;display:none}
    #flightFireStick .fire-knob{position:absolute;left:50%;top:50%;width:32px;height:32px;margin:-16px;border-radius:50%;background:#67f5a6e8;border:2px solid #d7ffe8;box-shadow:0 2px 10px #0009,0 0 14px #3eff8b99}
    #flightFireReticle{position:absolute;z-index:12;width:18px;height:18px;margin:-9px 0 0 -9px;border:1px solid #79ffac;border-radius:50%;box-shadow:0 0 8px #4cff91aa;pointer-events:none;display:none}
    #flightFireReticle:before,#flightFireReticle:after{content:"";position:absolute;background:#79ffac}.flight-fire-impact{position:absolute;z-index:11;width:13px;height:13px;margin:-6.5px 0 0 -6.5px;border-radius:50%;border:1px solid #fff7c2;background:radial-gradient(circle,#fff9be 0 16%,#ffbf55 22%,#ff6d35aa 42%,transparent 68%);box-shadow:0 0 12px #ffb14a;pointer-events:none;display:none}
    .flight-fire-impact.active{display:block;animation:flightImpactFade .48s ease-out forwards}
    #flightFireReticle:before{left:8px;top:-5px;width:1px;height:26px}#flightFireReticle:after{top:8px;left:-5px;height:1px;width:26px}@keyframes flightImpactFade{from{opacity:1;transform:scale(.65)}to{opacity:0;transform:scale(1.55)}}
  `;document.head.appendChild(style);
  const stick=document.createElement("div");stick.id="flightFireStick";stick.innerHTML='<i class="fire-knob"></i>';viewport.appendChild(stick);
  const reticle=document.createElement("div");reticle.id="flightFireReticle";viewport.appendChild(reticle);const knob=stick.querySelector(".fire-knob");

  const screenImpacts=Array.from({length:SCREEN_IMPACT_POOL_SIZE},()=>{const el=document.createElement("i");el.className="flight-fire-impact";el.addEventListener("animationend",()=>el.classList.remove("active"));viewport.appendChild(el);return el;});
  let screenImpactCursor=0;
  const raycaster=new THREE.Raycaster(),pointerNdc=new THREE.Vector2(),candidates=[],intersections=[],hitNormal=new THREE.Vector3(),decalForward=new THREE.Vector3(0,0,1);
  const decalGeometry=new THREE.CircleGeometry(.022,12),decalMaterial=new THREE.MeshBasicMaterial({color:0x171717,transparent:true,opacity:.94,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-4,polygonOffsetUnits:-4,side:THREE.DoubleSide});
  const decalPool=Array.from({length:DECAL_POOL_SIZE},()=>{const mesh=new THREE.Mesh(decalGeometry,decalMaterial);mesh.visible=false;mesh.renderOrder=8;mesh.userData.flightFireDecal=true;scene.add(mesh);return mesh;});
  let decalCursor=0,decalWrites=0,active=null,nextShotAt=0,fireTimer=0,audioCtx=null,noiseBuffer=null;

  function blocked(target){return target instanceof Element&&Boolean(target.closest(BLOCKED_SELECTOR));}
  function hiddenTrainingObject(object){if(!worldBridge?.active)return false;for(let node=object;node;node=node.parent)if(worldBridge.trainingObjects?.has?.(node))return true;return false;}
  function ensureAudio(){
    if(audioCtx)return audioCtx;const Ctx=window.AudioContext||window.webkitAudioContext;if(!Ctx)return null;audioCtx=new Ctx();noiseBuffer=audioCtx.createBuffer(1,Math.floor(audioCtx.sampleRate*.045),audioCtx.sampleRate);const data=noiseBuffer.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=(Math.random()*2-1)*(1-i/data.length);return audioCtx;
  }
  function shotSound(){
    const ctx=ensureAudio();if(!ctx||!noiseBuffer)return;try{if(ctx.state==="suspended")ctx.resume();const src=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),gain=ctx.createGain();src.buffer=noiseBuffer;filter.type="bandpass";filter.frequency.value=1350;filter.Q.value=.7;gain.gain.setValueAtTime(.18,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.05);src.connect(filter).connect(gain).connect(ctx.destination);src.start();src.stop(ctx.currentTime+.055);}catch{}
  }
  function screenImpact(x,y){const el=screenImpacts[screenImpactCursor++%screenImpacts.length];el.classList.remove("active");el.style.left=`${x}px`;el.style.top=`${y}px`;void el.offsetWidth;el.classList.add("active");}
  function addThreeDecal(hit){
    if(!hit?.point||!hit?.face?.normal||!hit.object)return false;const mesh=decalPool[decalCursor++%decalPool.length];hitNormal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld).normalize();mesh.position.copy(hit.point).addScaledVector(hitNormal,.0035);mesh.quaternion.setFromUnitVectors(decalForward,hitNormal);mesh.rotateZ((decalWrites*2.399963229728653)%6.283185307179586);mesh.scale.setScalar(.88+(decalWrites%5)*.055);mesh.visible=true;decalWrites++;viewport.dataset.fireDecalWrites=String(decalWrites);return true;
  }
  function aimPoint(){
    const rect=viewport.getBoundingClientRect(),dx=active?.dx||0,dy=active?.dy||0,span=Math.min(rect.width,rect.height)*AIM_RADIUS_FRACTION;return{x:rect.width/2+dx/STICK_RADIUS_PX*span,y:rect.height/2+dy/STICK_RADIUS_PX*span,rect};
  }
  function fire(now){
    if(!active||now+.25<nextShotAt)return false;nextShotAt=now+SHOT_INTERVAL_MS;const aim=aimPoint();reticle.style.left=`${aim.x}px`;reticle.style.top=`${aim.y}px`;reticle.style.display="block";pointerNdc.set(aim.x/aim.rect.width*2-1,-(aim.y/aim.rect.height)*2+1);raycaster.setFromCamera(pointerNdc,camera);
    candidates.length=0;scene.traverse(object=>{if(object.isMesh&&object.visible&&!object.userData?.arondightAirframe&&!object.userData?.flightFireDecal&&object.material?.visible!==false&&!hiddenTrainingObject(object))candidates.push(object);});intersections.length=0;raycaster.intersectObjects(candidates,false,intersections);const hit=intersections[0];
    if(hit)addThreeDecal(hit);else worldBridge?.addVisualShotImpact?.(aim.x,aim.y,aim.rect);
    screenImpact(aim.x,aim.y);shotSound();viewport.dataset.fireShots=String((Number(viewport.dataset.fireShots)||0)+1);return true;
  }
  function scheduleFire(){
    if(!active||fireTimer)return;const tick=()=>{fireTimer=0;if(!active)return;const now=performance.now();fire(now);fireTimer=setTimeout(tick,Math.max(4,nextShotAt-performance.now()+1));};fireTimer=setTimeout(tick,Math.max(4,nextShotAt-performance.now()+1));
  }
  function renderStick(){if(!active)return;stick.style.left=`${active.startX}px`;stick.style.top=`${active.startY}px`;knob.style.transform=`translate(${active.dx}px,${active.dy}px)`;}
  function move(event){if(!active||event.pointerId!==active.id)return;const dx=event.clientX-active.startX,dy=event.clientY-active.startY,len=Math.hypot(dx,dy),scale=len>STICK_RADIUS_PX?STICK_RADIUS_PX/len:1;active.dx=dx*scale;active.dy=dy*scale;renderStick();fire(performance.now());scheduleFire();event.preventDefault();}
  function stop(event){if(!active||(event?.pointerId!=null&&event.pointerId!==active.id))return;const id=active.id;active=null;if(fireTimer){clearTimeout(fireTimer);fireTimer=0;}stick.style.display="none";reticle.style.display="none";try{viewport.releasePointerCapture?.(id);}catch{}event?.preventDefault();}
  viewport.addEventListener("pointerdown",event=>{
    if(!isEnabled()||event.button!==0||blocked(event.target)||active)return;active={id:event.pointerId,startX:event.clientX,startY:event.clientY,dx:0,dy:0};try{viewport.setPointerCapture?.(event.pointerId);}catch{}stick.style.display="block";renderStick();ensureAudio();nextShotAt=0;fire(performance.now());scheduleFire();event.preventDefault();
  },{passive:false});
  viewport.addEventListener("pointermove",move,{passive:false});viewport.addEventListener("pointerup",stop,{passive:false});viewport.addEventListener("pointercancel",stop,{passive:false});
  return{stop,get decalPoolSize(){return decalPool.length;},get decalWrites(){return decalWrites;},dispose(){stop();for(const mesh of decalPool){mesh.parent?.remove(mesh);mesh.visible=false;}decalGeometry.dispose();decalMaterial.dispose();for(const el of screenImpacts)el.remove();stick.remove();reticle.remove();style.remove();try{audioCtx?.close();}catch{}}};
}
