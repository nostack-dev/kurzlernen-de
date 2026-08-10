import * as THREE from "three";

const SHOT_INTERVAL_MS=92;
const DECAL_TTL_MS=1800;
const MAX_DECALS=24;
const STICK_RADIUS_PX=42;
const AIM_RADIUS_FRACTION=.24;
const BLOCKED_SELECTOR="#soloTopbar,#soloRaceHud,#soloLeft,#soloRight,#soloClearance,.solo-action,.phone-settings-dialog,#worldLookHud,dialog,button,input,select,textarea,a,label";
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));

export function installFlightFireFx({viewport,scene,camera,worldBridge=null,isEnabled=()=>document.body.classList.contains("solo-flight")}={}){
  if(!viewport||!scene||!camera)throw Error("flight fire FX requires viewport, scene and camera");
  if(viewport.dataset.fireFxInstalled==="1")return null;
  viewport.dataset.fireFxInstalled="1";

  const style=document.createElement("style");style.textContent=`
    #flightFireStick{position:absolute;z-index:13;width:92px;height:92px;margin:-46px 0 0 -46px;border-radius:50%;border:2px solid #62ef9bbb;background:#0a3c2255;box-shadow:0 0 0 1px #07170dcc inset,0 0 22px #43f18c55;pointer-events:none;display:none}
    #flightFireStick .fire-knob{position:absolute;left:50%;top:50%;width:32px;height:32px;margin:-16px;border-radius:50%;background:#67f5a6e8;border:2px solid #d7ffe8;box-shadow:0 2px 10px #0009,0 0 14px #3eff8b99}
    #flightFireReticle{position:absolute;z-index:12;width:18px;height:18px;margin:-9px 0 0 -9px;border:1px solid #79ffac;border-radius:50%;box-shadow:0 0 8px #4cff91aa;pointer-events:none;display:none}
    #flightFireReticle:before,#flightFireReticle:after{content:"";position:absolute;background:#79ffac}.flight-fire-impact{position:absolute;z-index:11;width:13px;height:13px;margin:-6.5px 0 0 -6.5px;border-radius:50%;border:1px solid #fff7c2;background:radial-gradient(circle,#fff9be 0 16%,#ffbf55 22%,#ff6d35aa 42%,transparent 68%);box-shadow:0 0 12px #ffb14a;pointer-events:none;animation:flightImpactFade .48s ease-out forwards}
    #flightFireReticle:before{left:8px;top:-5px;width:1px;height:26px}#flightFireReticle:after{top:8px;left:-5px;height:1px;width:26px}@keyframes flightImpactFade{from{opacity:1;transform:scale(.65)}to{opacity:0;transform:scale(1.55)}}
  `;document.head.appendChild(style);
  const stick=document.createElement("div");stick.id="flightFireStick";stick.innerHTML='<i class="fire-knob"></i>';viewport.appendChild(stick);
  const reticle=document.createElement("div");reticle.id="flightFireReticle";viewport.appendChild(reticle);const knob=stick.querySelector(".fire-knob");

  const raycaster=new THREE.Raycaster(),pointerNdc=new THREE.Vector2(),decals=[];
  const decalGeometry=new THREE.CircleGeometry(.018,10),decalMaterial=()=>new THREE.MeshBasicMaterial({color:0x252525,transparent:true,opacity:.82,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2,side:THREE.DoubleSide});
  let active=null,lastShot=-Infinity,raf=0,audioCtx=null,noiseBuffer=null;

  function blocked(target){return target instanceof Element&&Boolean(target.closest(BLOCKED_SELECTOR));}
  function ensureAudio(){
    if(audioCtx)return audioCtx;const Ctx=window.AudioContext||window.webkitAudioContext;if(!Ctx)return null;audioCtx=new Ctx();noiseBuffer=audioCtx.createBuffer(1,Math.floor(audioCtx.sampleRate*.045),audioCtx.sampleRate);const data=noiseBuffer.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=(Math.random()*2-1)*(1-i/data.length);return audioCtx;
  }
  function shotSound(){
    const ctx=ensureAudio();if(!ctx||!noiseBuffer)return;try{if(ctx.state==="suspended")ctx.resume();const src=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),gain=ctx.createGain();src.buffer=noiseBuffer;filter.type="bandpass";filter.frequency.value=1350;filter.Q.value=.7;gain.gain.setValueAtTime(.18,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.05);src.connect(filter).connect(gain).connect(ctx.destination);src.start();src.stop(ctx.currentTime+.055);}catch{}
  }
  function screenImpact(x,y){const el=document.createElement("i");el.className="flight-fire-impact";el.style.left=`${x}px`;el.style.top=`${y}px`;viewport.appendChild(el);setTimeout(()=>el.remove(),520);}
  function removeDecal(entry){const index=decals.indexOf(entry);if(index>=0)decals.splice(index,1);entry.mesh.parent?.remove(entry.mesh);entry.mesh.material.dispose();}
  function addThreeDecal(hit,now){
    if(!hit?.point||!hit?.face?.normal||!hit.object)return false;const mesh=new THREE.Mesh(decalGeometry,decalMaterial()),normal=hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();mesh.position.copy(hit.point).addScaledVector(normal,.003);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),normal);mesh.renderOrder=8;scene.add(mesh);const entry={mesh,born:now};decals.push(entry);while(decals.length>MAX_DECALS)removeDecal(decals[0]);return true;
  }
  function updateDecals(now){for(const entry of [...decals]){const age=now-entry.born;if(age>=DECAL_TTL_MS){removeDecal(entry);continue;}entry.mesh.material.opacity=.82*(1-age/DECAL_TTL_MS);entry.mesh.scale.setScalar(1+.28*age/DECAL_TTL_MS);}}
  function aimPoint(){
    const rect=viewport.getBoundingClientRect(),dx=active?.dx||0,dy=active?.dy||0,span=Math.min(rect.width,rect.height)*AIM_RADIUS_FRACTION;return{x:rect.width/2+dx/STICK_RADIUS_PX*span,y:rect.height/2+dy/STICK_RADIUS_PX*span,rect};
  }
  function fire(now){
    if(!active||now-lastShot<SHOT_INTERVAL_MS)return;lastShot=now;const aim=aimPoint();reticle.style.left=`${aim.x}px`;reticle.style.top=`${aim.y}px`;reticle.style.display="block";pointerNdc.set(aim.x/aim.rect.width*2-1,-(aim.y/aim.rect.height)*2+1);raycaster.setFromCamera(pointerNdc,camera);
    const candidates=[];scene.traverse(object=>{if(object.isMesh&&object.visible&&!object.userData?.arondightAirframe&&object.material?.visible!==false)candidates.push(object);});const hit=raycaster.intersectObjects(candidates,false)[0];
    if(hit)addThreeDecal(hit,now);else worldBridge?.addVisualShotImpact?.(aim.x,aim.y,aim.rect);
    screenImpact(aim.x,aim.y);shotSound();viewport.dataset.fireShots=String((Number(viewport.dataset.fireShots)||0)+1);
  }
  function frame(now){updateDecals(now);if(active){fire(now);raf=requestAnimationFrame(frame);}else raf=0;}
  function renderStick(){if(!active)return;stick.style.left=`${active.startX}px`;stick.style.top=`${active.startY}px`;knob.style.transform=`translate(${active.dx}px,${active.dy}px)`;}
  function move(event){if(!active||event.pointerId!==active.id)return;const dx=event.clientX-active.startX,dy=event.clientY-active.startY,len=Math.hypot(dx,dy),scale=len>STICK_RADIUS_PX?STICK_RADIUS_PX/len:1;active.dx=dx*scale;active.dy=dy*scale;renderStick();event.preventDefault();}
  function stop(event){if(!active||(event?.pointerId!=null&&event.pointerId!==active.id))return;const id=active.id;active=null;stick.style.display="none";reticle.style.display="none";try{viewport.releasePointerCapture?.(id);}catch{}event?.preventDefault();}
  viewport.addEventListener("pointerdown",event=>{
    if(!isEnabled()||event.button!==0||blocked(event.target)||active)return;active={id:event.pointerId,startX:event.clientX,startY:event.clientY,dx:0,dy:0};try{viewport.setPointerCapture?.(event.pointerId);}catch{}stick.style.display="block";renderStick();ensureAudio();lastShot=-Infinity;if(!raf)raf=requestAnimationFrame(frame);event.preventDefault();
  },{passive:false});
  viewport.addEventListener("pointermove",move,{passive:false});viewport.addEventListener("pointerup",stop,{passive:false});viewport.addEventListener("pointercancel",stop,{passive:false});
  return{stop,dispose(){stop();for(const entry of [...decals])removeDecal(entry);decalGeometry.dispose();stick.remove();reticle.remove();style.remove();try{audioCtx?.close();}catch{}}};
}
