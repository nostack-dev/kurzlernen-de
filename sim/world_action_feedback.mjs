import * as THREE from "three";
import {AUDIO_SETTINGS_EVENT,loadAudioSettings,normalizeAudioSettings} from "./audio_settings.mjs";

const MOBILE_RE=/(?:android|iphone|ipad|ipod|macintosh.*mobile)/i;
const MOBILE=MOBILE_RE.test(globalThis.navigator?.userAgent||"");
const DOUBLE_TAP_MS=340;
const PARTICLE_COUNT=MOBILE?48:72;
const DECOR_REFRESH_MS=900;
const UI_SELECTOR="button,input,select,textarea,a,label,dialog,[role=button],#soloTopbar,#soloLeft,#soloRight,#soloClearance,.solo-action,.phone-settings-dialog,#worldLookHud";
const WORLD_DECOR_RE=/(?:WORLD_.*(?:TREE|LAMP|PROP|SIGN|DECOR|STREET)|WORLD_LIVELINESS_(?:TREES|LAMPS))/i;

let installed=false,lastTapAt=-Infinity,lastDecorRefresh=-Infinity,lastFrame=performance.now(),lastDetailedImpactAt=-Infinity;
let routingPopulationHit=false,audioCtx=null,audioMaster=null,noiseBuffer=null,audioSettings=loadAudioSettings();
let particleScene=null,particlePoints=null,particleGeometry=null,particlePositions=null,particleColors=null,particleCursor=0;
const particles=Array.from({length:PARTICLE_COUNT},()=>({active:false,v:new THREE.Vector3(),expires:0}));
const tmpPoint=new THREE.Vector3(),tmpColor=new THREE.Color();
let lastFireShots=0,lastWalkShots=0,lastProjectileImpacts=0;

function viewport(){return document.getElementById("viewport");}
function bridge(){return globalThis.__arondightRealWorld||null;}
function flightSurface(target){return target instanceof Element&&Boolean(target.closest("#viewport"))&&!target.closest(UI_SELECTOR);}
function bump(name,amount=1){const v=viewport();if(!v)return 0;const next=(Number(v.dataset[name])||0)+amount;v.dataset[name]=String(next);return next;}

function installMobileZoomGuard(){
  const meta=document.querySelector('meta[name="viewport"]');
  if(meta){
    const tokens=String(meta.content||"").split(",").map(x=>x.trim()).filter(Boolean),kept=tokens.filter(x=>!/^maximum-scale\s*=|^minimum-scale\s*=|^user-scalable\s*=/i.test(x));
    if(!kept.some(x=>/^width\s*=/i.test(x)))kept.unshift("width=device-width");
    if(!kept.some(x=>/^initial-scale\s*=/i.test(x)))kept.push("initial-scale=1");
    if(!kept.some(x=>/^viewport-fit\s*=/i.test(x)))kept.push("viewport-fit=cover");
    kept.push("maximum-scale=1","user-scalable=no");meta.content=kept.join(",");
  }
  const style=document.createElement("style");style.dataset.worldActionZoomGuard="v2";style.textContent=`
html,body,#viewport{overscroll-behavior:none}body.solo-flight #viewport,body.on-foot-mode #viewport,#viewport canvas{touch-action:none!important;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}
`;
  document.head.appendChild(style);
  const onTouchEnd=event=>{
    if(!flightSurface(event.target)||event.changedTouches?.length!==1){lastTapAt=-Infinity;return;}
    const now=performance.now();if(now-lastTapAt<=DOUBLE_TAP_MS){event.preventDefault();bump("mobileDoubleTapBlocks");}lastTapAt=now;
  };
  const onDoubleClick=event=>{if(!flightSurface(event.target))return;event.preventDefault();bump("mobileDoubleTapBlocks");};
  document.addEventListener("touchend",onTouchEnd,{capture:true,passive:false});
  document.addEventListener("dblclick",onDoubleClick,{capture:true,passive:false});
  const v=viewport();if(v){v.dataset.mobileDoubleTapZoom="disabled-v2";v.dataset.mobileViewportScaleLock="1";}
  return()=>{document.removeEventListener("touchend",onTouchEnd,true);document.removeEventListener("dblclick",onDoubleClick,true);style.remove();};
}

function ensureAudio(unlock=false){
  const Ctx=globalThis.AudioContext||globalThis.webkitAudioContext;if(!Ctx)return null;
  if(!audioCtx){
    try{audioCtx=new Ctx({latencyHint:"interactive"});}catch{audioCtx=new Ctx();}
    audioMaster=audioCtx.createDynamicsCompressor();audioMaster.threshold.value=-10;audioMaster.knee.value=18;audioMaster.ratio.value=3.2;audioMaster.attack.value=.002;audioMaster.release.value=.14;audioMaster.connect(audioCtx.destination);
    noiseBuffer=audioCtx.createBuffer(1,Math.max(1,Math.floor(audioCtx.sampleRate*.24)),audioCtx.sampleRate);const data=noiseBuffer.getChannelData(0);let seed=0x45a39f1;
    for(let i=0;i<data.length;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;data[i]=(((seed>>>0)/2147483648)-1)*Math.pow(1-i/data.length,.55);}
  }
  if(unlock&&audioCtx.state==="suspended")audioCtx.resume().catch(()=>{});return audioCtx;
}
function audioLevel(kind){if(!audioSettings.soundEnabled)return 0;return Math.max(0,Math.min(1,(kind==="shots"?audioSettings.shotsVolume:audioSettings.fxVolume)/100));}
function playShotBody(scale=1){
  const level=audioLevel("shots"),ctx=ensureAudio(false);if(!ctx||ctx.state!=="running"||!audioMaster||!noiseBuffer||level<=0)return false;
  try{
    const t=ctx.currentTime,body=ctx.createOscillator(),bodyGain=ctx.createGain(),crack=ctx.createBufferSource(),crackFilter=ctx.createBiquadFilter(),crackGain=ctx.createGain(),tail=ctx.createBufferSource(),tailFilter=ctx.createBiquadFilter(),tailGain=ctx.createGain();
    body.type="triangle";body.frequency.setValueAtTime(138,t);body.frequency.exponentialRampToValueAtTime(54,t+.09);bodyGain.gain.setValueAtTime(.052*level*scale,t);bodyGain.gain.exponentialRampToValueAtTime(.0001,t+.105);
    crack.buffer=noiseBuffer;crackFilter.type="bandpass";crackFilter.frequency.setValueAtTime(2900,t);crackFilter.Q.value=.7;crackGain.gain.setValueAtTime(.036*level*scale,t);crackGain.gain.exponentialRampToValueAtTime(.0001,t+.038);
    tail.buffer=noiseBuffer;tailFilter.type="lowpass";tailFilter.frequency.setValueAtTime(980,t+.018);tailFilter.frequency.exponentialRampToValueAtTime(210,t+.18);tailGain.gain.setValueAtTime(.0001,t);tailGain.gain.exponentialRampToValueAtTime(.018*level*scale,t+.025);tailGain.gain.exponentialRampToValueAtTime(.0001,t+.19);
    body.connect(bodyGain).connect(audioMaster);crack.connect(crackFilter).connect(crackGain).connect(audioMaster);tail.connect(tailFilter).connect(tailGain).connect(audioMaster);
    body.start(t);body.stop(t+.11);crack.start(t);crack.stop(t+.045);tail.start(t);tail.stop(t+.20);return true;
  }catch{return false;}
}
function playImpactSound(kind="concrete"){
  const level=audioLevel("fx"),ctx=ensureAudio(false);if(!ctx||ctx.state!=="running"||!audioMaster||!noiseBuffer||level<=0)return false;
  try{
    const t=ctx.currentTime,src=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),gain=ctx.createGain();src.buffer=noiseBuffer;filter.type="bandpass";
    const profile=kind==="metal"?{f:2600,q:1.6,g:.042,d:.12}:kind==="wood"?{f:520,q:.85,g:.052,d:.105}:kind==="flesh"?{f:280,q:.7,g:.040,d:.09}:{f:980,q:.75,g:.040,d:.105};
    filter.frequency.setValueAtTime(profile.f,t);filter.Q.value=profile.q;gain.gain.setValueAtTime(profile.g*level,t);gain.gain.exponentialRampToValueAtTime(.0001,t+profile.d);src.connect(filter).connect(gain).connect(audioMaster);src.start(t);src.stop(t+profile.d+.02);
    if(kind==="metal"){const ping=ctx.createOscillator(),pg=ctx.createGain();ping.type="sine";ping.frequency.setValueAtTime(1850,t);ping.frequency.exponentialRampToValueAtTime(1120,t+.14);pg.gain.setValueAtTime(.018*level,t);pg.gain.exponentialRampToValueAtTime(.0001,t+.15);ping.connect(pg).connect(audioMaster);ping.start(t);ping.stop(t+.16);}return true;
  }catch{return false;}
}
function materialKind(hit){
  let kind="",node=hit?.object;for(let n=node;n;n=n.parent){kind=String(n.userData?.worldPopulationKind||n.userData?.worldLifeKind||kind);if(kind)break;}
  if(/person|player|human/i.test(kind))return"flesh";if(/car|bus|vehicle|lamp|metal/i.test(kind))return"metal";if(/tree|wood/i.test(kind))return"wood";
  const name=String(node?.name||"");if(/lamp|sign|pole|metal|car|bus/i.test(name))return"metal";if(/tree|wood/i.test(name))return"wood";const metalness=Number(Array.isArray(node?.material)?node.material[0]?.metalness:node?.material?.metalness);return Number.isFinite(metalness)&&metalness>.32?"metal":"concrete";
}

function ensureParticles(){
  const scene=bridge()?.threeScene;if(!scene)return null;if(particleScene===scene&&particlePoints)return particlePoints;
  particlePoints?.parent?.remove(particlePoints);particleScene=scene;particlePositions=new Float32Array(PARTICLE_COUNT*3);particleColors=new Float32Array(PARTICLE_COUNT*3);particleGeometry=new THREE.BufferGeometry();particleGeometry.setAttribute("position",new THREE.BufferAttribute(particlePositions,3));particleGeometry.setAttribute("color",new THREE.BufferAttribute(particleColors,3));particleGeometry.setDrawRange(0,PARTICLE_COUNT);
  const material=new THREE.PointsMaterial({size:.075,vertexColors:true,transparent:true,opacity:.90,depthWrite:false,sizeAttenuation:true});particlePoints=new THREE.Points(particleGeometry,material);particlePoints.visible=false;particlePoints.frustumCulled=false;particlePoints.renderOrder=21;particlePoints.userData.flightFireIgnore=true;particlePoints.userData.worldActionFeedbackFx=true;scene.add(particlePoints);for(let i=0;i<PARTICLE_COUNT;i++)particlePositions[i*3+2]=-999;return particlePoints;
}
function colorFor(kind,i){if(kind==="metal")return tmpColor.setRGB(1,.68+.04*(i%3),.25);if(kind==="wood")return tmpColor.setRGB(.55,.30,.12);if(kind==="flesh")return tmpColor.setRGB(.50,.015,.012);return tmpColor.setRGB(.72,.66,.56);}
function spawnImpactParticles(hit,kind){
  const points=ensureParticles(),point=hit?.point;if(!points||!point)return false;tmpPoint.copy(point);const now=performance.now(),count=MOBILE?5:7;
  let nx=Number(hit?.face?.normal?.x),ny=Number(hit?.face?.normal?.y),nz=Number(hit?.face?.normal?.z);if(!Number.isFinite(nx+ny+nz)){nx=0;ny=0;nz=1;}else if(hit?.object?.matrixWorld){const n=new THREE.Vector3(nx,ny,nz).transformDirection(hit.object.matrixWorld);nx=n.x;ny=n.y;nz=n.z;}
  for(let i=0;i<count;i++){const idx=particleCursor++%PARTICLE_COUNT,p=particles[idx],angle=Math.random()*Math.PI*2,side=.18+Math.random()*.85,forward=.25+Math.random()*1.25;p.active=true;p.expires=now+220+Math.random()*260;p.v.set(Math.cos(angle)*side+nx*forward,Math.sin(angle)*side+ny*forward,.10+Math.random()*.65+nz*forward*.35);particlePositions[idx*3]=tmpPoint.x;particlePositions[idx*3+1]=tmpPoint.y;particlePositions[idx*3+2]=tmpPoint.z;const c=colorFor(kind,i);particleColors[idx*3]=c.r;particleColors[idx*3+1]=c.g;particleColors[idx*3+2]=c.b;}
  particleGeometry.attributes.position.needsUpdate=true;particleGeometry.attributes.color.needsUpdate=true;particlePoints.visible=true;return true;
}
function updateParticles(now,dt){if(!particlePoints)return;let any=false;for(let i=0;i<PARTICLE_COUNT;i++){const p=particles[i];if(!p.active)continue;if(now>=p.expires){p.active=false;particlePositions[i*3+2]=-999;continue;}any=true;p.v.z-=3.1*dt;particlePositions[i*3]+=p.v.x*dt;particlePositions[i*3+1]+=p.v.y*dt;particlePositions[i*3+2]+=p.v.z*dt;}particlePoints.visible=any;if(any)particleGeometry.attributes.position.needsUpdate=true;}

function ancestorName(node){let names="";for(let n=node;n;n=n.parent)names+=` ${String(n.name||"")}`;return names;}
function releaseShootableWorldDecor(now){
  if(now-lastDecorRefresh<DECOR_REFRESH_MS)return;lastDecorRefresh=now;const scene=bridge()?.threeScene,v=viewport();if(!scene||!v)return;let released=0,population=0;
  scene.traverse?.(node=>{
    if(!(node?.isMesh||node?.isInstancedMesh)||node.userData?.flightFireDecal||node.userData?.flightFireTracer||node.userData?.worldActionFeedbackFx)return;
    const populationKind=String(node.userData?.worldPopulationKind||node.userData?.worldLifeKind||"");const decor=WORLD_DECOR_RE.test(ancestorName(node));
    if(node.userData?.flightFireIgnore===true&&(populationKind||decor)){node.userData.flightFireIgnore=false;node.userData.worldActionShootable=true;released++;}
    if(populationKind)population++;
  });
  v.dataset.worldShootablePopulation=String(population);v.dataset.worldShootableDecorReleased=String((Number(v.dataset.worldShootableDecorReleased)||0)+released);v.dataset.worldActionFeedback="decals+particles+audio+population-reaction-v2";
}

function acknowledgeSceneHit(hit,handledWorld=false){
  const v=viewport();if(!v||!hit?.point)return;const kind=materialKind(hit);lastDetailedImpactAt=performance.now();spawnImpactParticles(hit,kind);playImpactSound(kind);bump("worldActionImpacts");v.dataset.worldLastImpactKind=kind;v.dataset.worldLastImpactReactive=handledWorld?"1":"0";
  if(handledWorld){bump("worldReactiveHits");window.dispatchEvent(new CustomEvent("arondight:combat-hit-confirm",{detail:{world:true,kind}}));}else bump("worldStaticHits");
}
function patchWorldHitRouting(){
  const b=bridge();if(!b)return;const current=b.registerVsHit;if(current?.__worldActionFeedbackWrapper)return;
  const base=typeof current==="function"?current:null;const wrapper=function(hit){
    const vsHandled=base?Boolean(base.call(b,hit)):false;if(vsHandled){acknowledgeSceneHit(hit,false);return true;}if(routingPopulationHit){acknowledgeSceneHit(hit,false);return false;}
    let worldHandled=false;const populationHandler=b.registerWorldPopulationHit;if(typeof populationHandler==="function"){
      routingPopulationHit=true;try{worldHandled=Boolean(populationHandler.call(b,hit));}catch{}finally{routingPopulationHit=false;}
    }
    acknowledgeSceneHit(hit,worldHandled);return false;
  };
  wrapper.__worldActionFeedbackWrapper=true;wrapper.__worldActionFeedbackBase=base;b.registerVsHit=wrapper;const v=viewport();if(v)v.dataset.worldHitRouting=base?"vs+population+static-v2":"population+static-v2";
}

function syncActionCounters(now){
  const v=viewport();if(!v)return;const fire=Number(v.dataset.fireShots)||0,walk=Number(v.dataset.walkShots)||0,impacts=Number(v.dataset.fireProjectileImpacts)||0;
  if(fire>lastFireShots){for(let i=0;i<Math.min(2,fire-lastFireShots);i++)playShotBody(1);lastFireShots=fire;v.dataset.worldShotAudioLayer="procedural-body+crack+tail-v2";}
  if(walk>lastWalkShots){for(let i=0;i<Math.min(2,walk-lastWalkShots);i++)playShotBody(.82);lastWalkShots=walk;v.dataset.worldWalkShotAudioLayer="procedural-body+tail-v2";}
  if(impacts>lastProjectileImpacts){if(now-lastDetailedImpactAt>45)playImpactSound("concrete");lastProjectileImpacts=impacts;}
}
function frame(now=performance.now()){
  const dt=Math.min(.05,Math.max(0,(now-lastFrame)/1000||0));lastFrame=now;patchWorldHitRouting();releaseShootableWorldDecor(now);syncActionCounters(now);updateParticles(now,dt);requestAnimationFrame(frame);
}

export function installWorldActionFeedback(){
  if(installed)return true;installed=true;installMobileZoomGuard();const v=viewport();if(v){lastFireShots=Number(v.dataset.fireShots)||0;lastWalkShots=Number(v.dataset.walkShots)||0;lastProjectileImpacts=Number(v.dataset.fireProjectileImpacts)||0;v.dataset.worldActionFeedback="decals+particles+audio+population-reaction-v2";v.dataset.worldActionAudio="layered-procedural-v2";}
  const unlock=()=>ensureAudio(true);document.addEventListener("pointerdown",unlock,{capture:true,passive:true});document.addEventListener("keydown",unlock,{capture:true,passive:true});
  const audioListener=event=>{audioSettings=normalizeAudioSettings(event.detail||loadAudioSettings());};window.addEventListener(AUDIO_SETTINGS_EVENT,audioListener);requestAnimationFrame(frame);return true;
}

installWorldActionFeedback();
