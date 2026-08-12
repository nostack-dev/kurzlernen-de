import * as THREE from "three";

const RESPAWN_MS=2200;
const STALE_PEER_MS=1400;
let installed=false;
let audioContext=null;
let marker=null;
let respawnHud=null;
let explosionFlash=null;
let enhancedPeerMesh=null;
let previousLocalDead=false;
let previousPeerDead=false;
let localDeathAt=-Infinity;
let peerDeathAt=-Infinity;
let soundCount=0;
const worldPosition=new THREE.Vector3();
const cameraPosition=new THREE.Vector3();
const projected=new THREE.Vector3();
const cameraSpace=new THREE.Vector3();

function viewport(){return document.getElementById("viewport");}
function bridge(){return globalThis.__arondightRealWorld||null;}
function clamp(value,min,max){return Math.max(min,Math.min(max,value));}

function ensureAudio(){
  const AudioCtor=globalThis.AudioContext||globalThis.webkitAudioContext;
  if(!AudioCtor)return null;
  try{audioContext??=new AudioCtor();}catch{return null;}
  if(audioContext.state==="suspended")audioContext.resume().catch(()=>{});
  return audioContext;
}

function primeAudio(){ensureAudio();}

function playExplosion(local=false){
  const view=viewport();soundCount++;if(view)view.dataset.vsExplosionSoundCount=String(soundCount);
  const ctx=ensureAudio();
  try{navigator.vibrate?.(local?[70,35,120]:[65]);}catch{}
  if(!ctx||ctx.state!=="running")return;
  const now=ctx.currentTime,duration=.82,samples=Math.max(1,Math.floor(ctx.sampleRate*duration));
  const buffer=ctx.createBuffer(1,samples,ctx.sampleRate),data=buffer.getChannelData(0);
  for(let i=0;i<samples;i++){const t=i/samples;data[i]=(Math.random()*2-1)*Math.pow(1-t,2.35);}
  const noise=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),noiseGain=ctx.createGain();
  noise.buffer=buffer;filter.type="lowpass";filter.frequency.setValueAtTime(local?1150:900,now);filter.frequency.exponentialRampToValueAtTime(120,now+duration);
  noiseGain.gain.setValueAtTime(.0001,now);noiseGain.gain.exponentialRampToValueAtTime(local?.52:.38,now+.012);noiseGain.gain.exponentialRampToValueAtTime(.0001,now+duration);
  noise.connect(filter).connect(noiseGain).connect(ctx.destination);
  const boom=ctx.createOscillator(),boomGain=ctx.createGain();boom.type="sine";boom.frequency.setValueAtTime(local?105:92,now);boom.frequency.exponentialRampToValueAtTime(34,now+.55);boomGain.gain.setValueAtTime(.0001,now);boomGain.gain.exponentialRampToValueAtTime(local?.58:.43,now+.008);boomGain.gain.exponentialRampToValueAtTime(.0001,now+.72);boom.connect(boomGain).connect(ctx.destination);
  const crack=ctx.createOscillator(),crackGain=ctx.createGain();crack.type="triangle";crack.frequency.setValueAtTime(210,now);crack.frequency.exponentialRampToValueAtTime(58,now+.18);crackGain.gain.setValueAtTime(.0001,now);crackGain.gain.exponentialRampToValueAtTime(.17,now+.004);crackGain.gain.exponentialRampToValueAtTime(.0001,now+.22);crack.connect(crackGain).connect(ctx.destination);
  noise.start(now);noise.stop(now+duration);boom.start(now);boom.stop(now+.74);crack.start(now);crack.stop(now+.24);
}

function flashExplosion(local=false){
  if(!explosionFlash)return;explosionFlash.classList.remove("pulse","local");void explosionFlash.offsetWidth;if(local)explosionFlash.classList.add("local");explosionFlash.classList.add("pulse");
}

function makeGlowTexture(){
  const canvas=document.createElement("canvas");canvas.width=128;canvas.height=128;const ctx=canvas.getContext("2d");if(!ctx)return null;
  const gradient=ctx.createRadialGradient(64,64,4,64,64,62);gradient.addColorStop(0,"rgba(255,235,180,.95)");gradient.addColorStop(.17,"rgba(255,78,44,.72)");gradient.addColorStop(.48,"rgba(255,35,22,.28)");gradient.addColorStop(1,"rgba(255,20,10,0)");ctx.fillStyle=gradient;ctx.fillRect(0,0,128,128);const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}

function enhancePeerVisual(currentBridge){
  const peer=currentBridge?.vsPeerMesh;if(!peer||peer===enhancedPeerMesh)return;
  enhancedPeerMesh=peer;
  const meshes=[];peer.traverse(node=>{if(node?.isMesh&&!node.userData?.vsCombatOutline)meshes.push(node);});
  for(const mesh of meshes){
    const material=mesh.material;if(material?.color?.setHex)material.color.setHex(0xff5a32);if(material?.emissive?.setHex){material.emissive.setHex(0x8a1000);material.emissiveIntensity=1.7;}if(material){material.roughness=.28;material.metalness=.18;}
    if(mesh.geometry){const outlineMaterial=new THREE.MeshBasicMaterial({color:0xff2416,side:THREE.BackSide,transparent:true,opacity:.7,depthWrite:false});const outline=new THREE.Mesh(mesh.geometry,outlineMaterial);outline.scale.setScalar(1.13);outline.userData.vsCombatOutline=true;outline.userData.flightFireIgnore=true;outline.raycast=()=>{};mesh.add(outline);}
  }
  const texture=makeGlowTexture();if(texture){const glow=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,color:0xff4b28,transparent:true,opacity:.42,depthWrite:false,depthTest:true,blending:THREE.AdditiveBlending}));glow.scale.set(.92,.92,.92);glow.position.z=.02;glow.userData.flightFireIgnore=true;glow.raycast=()=>{};peer.add(glow);}
}

function updateEnemyMarker(currentBridge,now){
  if(!marker)return;
  const peer=currentBridge?.vsPeerMesh,camera=currentBridge?.threeCamera,view=viewport();
  const fresh=Number.isFinite(currentBridge?.vsPeerLastPoseMs)&&now-currentBridge.vsPeerLastPoseMs<STALE_PEER_MS;
  if(!currentBridge?.vsConnected||!peer||!camera||!view||(!fresh&&!currentBridge.vsPeerDead)){marker.hidden=true;return;}
  const rect=view.getBoundingClientRect();if(rect.width<1||rect.height<1){marker.hidden=true;return;}
  peer.updateWorldMatrix?.(true,false);camera.updateMatrixWorld?.(true);peer.getWorldPosition(worldPosition);camera.getWorldPosition(cameraPosition);projected.copy(worldPosition).project(camera);cameraSpace.copy(worldPosition).applyMatrix4(camera.matrixWorldInverse);
  const inFront=cameraSpace.z<0;let nx=projected.x,ny=projected.y;if(!inFront){nx=-nx;ny=-ny;}
  const marginX=Math.min(74,rect.width*.14),marginY=Math.min(54,rect.height*.18),halfW=Math.max(1,rect.width/2-marginX),halfH=Math.max(1,rect.height/2-marginY);let sx=nx*rect.width/2,sy=-ny*rect.height/2;const scale=Math.min(1,halfW/Math.max(1,Math.abs(sx)),halfH/Math.max(1,Math.abs(sy)));sx*=scale;sy*=scale;const x=rect.width/2+sx,y=rect.height/2+sy;const onScreen=inFront&&Math.abs(projected.x)<.92&&Math.abs(projected.y)<.84&&projected.z>-1&&projected.z<1;
  marker.hidden=false;marker.classList.toggle("offscreen",!onScreen);marker.style.transform=`translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) translate(-50%,-50%)`;const pointer=marker.querySelector(".vs-enemy-pointer");if(pointer)pointer.style.transform=`rotate(${(Math.atan2(sy,sx)*180/Math.PI+90).toFixed(1)}deg)`;
  const distance=Math.max(0,cameraPosition.distanceTo(worldPosition)),health=clamp(Math.round(Number(currentBridge.vsPeerHealth)||0),0,100),label=marker.querySelector("strong"),detail=marker.querySelector("small");if(label)label.textContent=currentBridge.vsPeerDead?"ENEMY DOWN":"ENEMY";if(detail){if(currentBridge.vsPeerDead){const remaining=Math.max(0,RESPAWN_MS-(now-peerDeathAt));detail.textContent=remaining>0?`RESPAWN ${(remaining/1000).toFixed(1)}s`:"RESPAWNING…";}else detail.textContent=`HP ${health} · ${distance<100?distance.toFixed(1):Math.round(distance)} m`;}
  view.dataset.vsEnemyMarker=onScreen?"onscreen":"offscreen";view.dataset.vsEnemyDistanceM=distance.toFixed(2);
}

function updateRespawnHud(currentBridge,now){
  if(!respawnHud)return;const view=viewport();let title="",detail="",state="none";
  if(currentBridge?.vsLocalDead){const remaining=Math.max(0,RESPAWN_MS-(now-localDeathAt));title="DESTROYED";detail=remaining>0?`RESPAWN ${(remaining/1000).toFixed(1)}s`:"RESPAWNING…";state="local";}
  else if(currentBridge?.vsPeerDead){const remaining=Math.max(0,RESPAWN_MS-(now-peerDeathAt));title="ENEMY DESTROYED";detail=remaining>0?`RESPAWN ${(remaining/1000).toFixed(1)}s`:"RESPAWNING…";state="enemy";}
  respawnHud.hidden=!title;respawnHud.classList.toggle("enemy",state==="enemy");const strong=respawnHud.querySelector("strong"),small=respawnHud.querySelector("span");if(strong)strong.textContent=title;if(small)small.textContent=detail;if(view)view.dataset.vsRespawnState=state;
}

function tick(){
  const currentBridge=bridge(),now=performance.now();
  if(currentBridge){enhancePeerVisual(currentBridge);const localDead=Boolean(currentBridge.vsLocalDead),peerDead=Boolean(currentBridge.vsPeerDead);if(localDead&&!previousLocalDead){localDeathAt=now;playExplosion(true);flashExplosion(true);}if(peerDead&&!previousPeerDead){peerDeathAt=now;playExplosion(false);flashExplosion(false);}if(!localDead)localDeathAt=-Infinity;if(!peerDead)peerDeathAt=-Infinity;previousLocalDead=localDead;previousPeerDead=peerDead;updateEnemyMarker(currentBridge,now);updateRespawnHud(currentBridge,now);}else{if(marker)marker.hidden=true;if(respawnHud)respawnHud.hidden=true;}
  requestAnimationFrame(tick);
}

function attachUi(){
  const view=viewport();if(!view)return false;
  if(!marker){marker=document.createElement("div");marker.id="vsEnemyMarker";marker.hidden=true;marker.setAttribute("aria-live","off");marker.innerHTML='<i class="vs-enemy-reticle"></i><i class="vs-enemy-pointer">▲</i><strong>ENEMY</strong><small>HP 100</small>';view.appendChild(marker);}
  if(!respawnHud){respawnHud=document.createElement("div");respawnHud.id="vsRespawnHud";respawnHud.hidden=true;respawnHud.setAttribute("role","status");respawnHud.setAttribute("aria-live","polite");respawnHud.innerHTML='<strong>DESTROYED</strong><span>RESPAWN 2.2s</span>';view.appendChild(respawnHud);}
  if(!explosionFlash){explosionFlash=document.createElement("div");explosionFlash.id="vsExplosionFlash";explosionFlash.setAttribute("aria-hidden","true");view.appendChild(explosionFlash);}
  return true;
}

export function installVsCombatPresentation(){
  if(installed)return;installed=true;
  const style=document.createElement("style");style.dataset.vsCombatPresentation="v1";style.textContent=`
    #vsEnemyMarker{position:absolute;z-index:13;left:0;top:0;width:116px;height:58px;pointer-events:none;will-change:transform;filter:drop-shadow(0 2px 3px #000) drop-shadow(0 0 8px #ff321c88);font-family:system-ui,-apple-system,sans-serif;text-align:center;color:#fff;transform-origin:50% 50%}
    #vsEnemyMarker[hidden]{display:none!important}
    #vsEnemyMarker .vs-enemy-reticle{position:absolute;left:50%;top:33px;width:28px;height:28px;transform:translate(-50%,-50%) rotate(45deg);border:2px solid #ff4c32;box-shadow:0 0 0 1px #260000,0 0 14px #ff3b22aa,inset 0 0 10px #ff3b2244;background:#2100001f}
    #vsEnemyMarker strong{position:absolute;left:0;right:0;top:0;font:950 10px/1 system-ui,-apple-system,sans-serif;letter-spacing:.12em;color:#ff765f;text-shadow:0 1px 2px #000,0 0 7px #ff2a18}
    #vsEnemyMarker small{position:absolute;left:0;right:0;top:13px;font:850 8px/1 system-ui,-apple-system,sans-serif;letter-spacing:.04em;color:#fff;background:#120706d9;border:1px solid #ff543c88;border-radius:7px;padding:3px 4px;white-space:nowrap}
    #vsEnemyMarker .vs-enemy-pointer{display:none;position:absolute;left:50%;top:31px;margin-left:-6px;margin-top:-7px;font:900 14px/1 system-ui;color:#ff4a32;text-shadow:0 0 8px #ff2600;transform-origin:50% 50%}
    #vsEnemyMarker.offscreen{width:106px;height:46px}#vsEnemyMarker.offscreen .vs-enemy-reticle{display:none}#vsEnemyMarker.offscreen .vs-enemy-pointer{display:block}#vsEnemyMarker.offscreen strong{top:26px}#vsEnemyMarker.offscreen small{top:37px;background:#160807ef}
    #vsRespawnHud{position:absolute;z-index:16;left:50%;top:45%;transform:translate(-50%,-50%);min-width:min(72vw,290px);padding:14px 20px;border-radius:14px;border:1px solid #ff5a42aa;background:#180807e8;box-shadow:0 8px 35px #000b,0 0 28px #ff351b38;color:#fff;text-align:center;pointer-events:none;font-family:system-ui,-apple-system,sans-serif}
    #vsRespawnHud[hidden]{display:none!important}#vsRespawnHud strong{display:block;font:950 25px/.95 system-ui,-apple-system,sans-serif;letter-spacing:.08em;color:#ff6650;text-shadow:0 0 14px #ff2e1d88}#vsRespawnHud span{display:block;margin-top:8px;font:900 13px/1 system-ui,-apple-system,sans-serif;letter-spacing:.12em;color:#fff;font-variant-numeric:tabular-nums}#vsRespawnHud.enemy{top:29%;min-width:min(58vw,240px);padding:10px 16px;background:#0b1119e8;border-color:#ff744f88}#vsRespawnHud.enemy strong{font-size:17px}#vsRespawnHud.enemy span{font-size:10px;margin-top:5px}
    #vsExplosionFlash{position:absolute;z-index:15;inset:0;pointer-events:none;opacity:0;background:radial-gradient(circle at center,#fff6bd 0%,#ff7a2d55 22%,#ff2a1600 67%);mix-blend-mode:screen}#vsExplosionFlash.pulse{animation:vsExplosionFlash .48s ease-out both}#vsExplosionFlash.local{background:radial-gradient(circle at center,#fff 0%,#ff4c2b99 20%,#a8000038 58%,transparent 78%)}@keyframes vsExplosionFlash{0%{opacity:.92}35%{opacity:.46}100%{opacity:0}}
    @media(max-height:340px){#vsEnemyMarker{width:102px;height:50px}#vsEnemyMarker strong{font-size:9px}#vsEnemyMarker small{font-size:7px}#vsRespawnHud{top:43%;padding:10px 16px}#vsRespawnHud strong{font-size:20px}#vsRespawnHud span{font-size:11px}}
  `;document.head.appendChild(style);
  if(!attachUi()){const observer=new MutationObserver(()=>{if(attachUi())observer.disconnect();});observer.observe(document.documentElement,{childList:true,subtree:true});}
  document.addEventListener("pointerdown",primeAudio,{passive:true});document.addEventListener("touchstart",primeAudio,{passive:true});
  requestAnimationFrame(tick);
}
