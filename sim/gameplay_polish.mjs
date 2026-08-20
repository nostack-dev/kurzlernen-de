import * as THREE from "three";
import {VS_FX_EVENT} from "./lan_vs.mjs";

const MOBILE_RE=/(?:android|iphone|ipad|ipod|macintosh.*mobile)/i;
const MOBILE=MOBILE_RE.test(globalThis.navigator?.userAgent||"");
const EXTRA_CARS=MOBILE?6:10;
const EXTRA_PEOPLE=MOBILE?8:12;
const BLOOD_PARTICLES=MOBILE?18:30;
const BLOOD_SPLATS=MOBILE?5:8;
const AUDIO_SETTINGS_KEY="arondight45AudioSettingsV1";
const FLIGHT_UI_SELECTOR="button,input,select,textarea,a,label,dialog,#soloTopbar,#soloLeft,#soloRight,#soloClearance,.solo-action,#worldLookHud,#vsRespawnHud";

let installed=false,audioCtx=null,noiseBuffer=null,lastDead=false,lastDensityScan=-Infinity,lastFrame=performance.now();
let wrappedWorldHit=null,bloodGeometry=null,splatGeometry=null;
const activePointers=new Set(),densityClones=[],blood=[],splats=[];
const tempPosition=new THREE.Vector3();

function viewport(){return document.getElementById("viewport");}
function bridge(){return globalThis.__arondightRealWorld||null;}
function activeSession(){const s=bridge()?.vsSession;return s?.active||s||null;}
function hashText(text){let h=2166136261;for(const c of String(text||"")){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}
function clamp(value,min,max){return Math.max(min,Math.min(max,value));}
function fxSettings(){try{const raw=localStorage.getItem(AUDIO_SETTINGS_KEY),value=raw?JSON.parse(raw):{};return{enabled:value.soundEnabled!==false,volume:clamp(Number(value.fxVolume??100)||0,0,100)/100};}catch{return{enabled:true,volume:1};}}

export function deterministicInitialSpawnOffset(selfId,peerIds=[]){
  const self=String(selfId||""),ids=[...new Set([self,...peerIds.map(String)].filter(Boolean))].sort();
  if(!self||ids.length<2)return{x:0,y:0,r:0,index:-1,count:ids.length};
  const index=Math.max(0,ids.indexOf(self)),count=ids.length;
  if(count===2){const x=index===0?-12:12;return{x,y:0,r:12,index,count};}
  const phase=(hashText(ids.join("|"))%6283)/1000,angle=phase+index*Math.PI*2/count,r=12+(hashText(self)%4);
  return{x:Math.cos(angle)*r,y:Math.sin(angle)*r,r,index,count};
}
export const GAMEPLAY_POLISH_DENSITY=Object.freeze({extraCars:EXTRA_CARS,extraPeople:EXTRA_PEOPLE});

function ensureAudio(){
  const Ctx=globalThis.AudioContext||globalThis.webkitAudioContext;if(!Ctx)return null;
  try{audioCtx??=new Ctx({latencyHint:"interactive"});}catch{return null;}
  if(audioCtx.state==="suspended")audioCtx.resume().catch(()=>{});
  if(!noiseBuffer){const duration=.9,samples=Math.max(1,Math.floor(audioCtx.sampleRate*duration));noiseBuffer=audioCtx.createBuffer(1,samples,audioCtx.sampleRate);const data=noiseBuffer.getChannelData(0);for(let i=0;i<samples;i++){const t=i/samples;data[i]=(Math.random()*2-1)*Math.pow(1-t,1.8);}}
  return audioCtx;
}
function playCarExplosionSound(){
  const settings=fxSettings();if(!settings.enabled||settings.volume<=0)return false;const ctx=ensureAudio();if(!ctx||ctx.state!=="running"||!noiseBuffer)return false;
  try{const t=ctx.currentTime,level=settings.volume,noise=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),ng=ctx.createGain(),boom=ctx.createOscillator(),bg=ctx.createGain(),crack=ctx.createOscillator(),cg=ctx.createGain();noise.buffer=noiseBuffer;filter.type="lowpass";filter.frequency.setValueAtTime(1500,t);filter.frequency.exponentialRampToValueAtTime(95,t+.82);ng.gain.setValueAtTime(.0001,t);ng.gain.exponentialRampToValueAtTime(.34*level,t+.008);ng.gain.exponentialRampToValueAtTime(.0001,t+.86);boom.type="sine";boom.frequency.setValueAtTime(118,t);boom.frequency.exponentialRampToValueAtTime(31,t+.62);bg.gain.setValueAtTime(.0001,t);bg.gain.exponentialRampToValueAtTime(.46*level,t+.006);bg.gain.exponentialRampToValueAtTime(.0001,t+.72);crack.type="triangle";crack.frequency.setValueAtTime(330,t);crack.frequency.exponentialRampToValueAtTime(74,t+.16);cg.gain.setValueAtTime(.15*level,t);cg.gain.exponentialRampToValueAtTime(.0001,t+.20);noise.connect(filter).connect(ng).connect(ctx.destination);boom.connect(bg).connect(ctx.destination);crack.connect(cg).connect(ctx.destination);noise.start(t);noise.stop(t+.88);boom.start(t);boom.stop(t+.74);crack.start(t);crack.stop(t+.22);const view=viewport();if(view)view.dataset.worldCarExplosionSounds=String((Number(view.dataset.worldCarExplosionSounds)||0)+1);return true;}catch{return false;}
}
function playPersonGroan(){
  const settings=fxSettings();if(!settings.enabled||settings.volume<=0)return false;const ctx=ensureAudio();if(!ctx||ctx.state!=="running")return false;
  try{const t=ctx.currentTime,level=settings.volume,voice=ctx.createOscillator(),formant=ctx.createOscillator(),vg=ctx.createGain(),fg=ctx.createGain();voice.type="sawtooth";voice.frequency.setValueAtTime(155+Math.random()*24,t);voice.frequency.exponentialRampToValueAtTime(82+Math.random()*12,t+.34);formant.type="sine";formant.frequency.setValueAtTime(420+Math.random()*70,t);formant.frequency.exponentialRampToValueAtTime(210+Math.random()*40,t+.28);vg.gain.setValueAtTime(.0001,t);vg.gain.exponentialRampToValueAtTime(.045*level,t+.018);vg.gain.exponentialRampToValueAtTime(.0001,t+.39);fg.gain.setValueAtTime(.0001,t);fg.gain.exponentialRampToValueAtTime(.018*level,t+.025);fg.gain.exponentialRampToValueAtTime(.0001,t+.31);voice.connect(vg).connect(ctx.destination);formant.connect(fg).connect(ctx.destination);voice.start(t);voice.stop(t+.41);formant.start(t);formant.stop(t+.34);const view=viewport();if(view)view.dataset.worldPersonGroans=String((Number(view.dataset.worldPersonGroans)||0)+1);return true;}catch{return false;}
}

function ensureBloodPools(){
  const scene=bridge()?.threeScene;if(!scene)return false;
  bloodGeometry??=new THREE.SphereGeometry(.035,5,4);splatGeometry??=new THREE.CircleGeometry(.13,10);
  while(blood.length<BLOOD_PARTICLES){const material=new THREE.MeshBasicMaterial({color:0x7a0707,transparent:true,opacity:0,depthWrite:false}),mesh=new THREE.Mesh(bloodGeometry,material);mesh.visible=false;mesh.renderOrder=19;mesh.userData.flightFireIgnore=true;scene.add(mesh);blood.push({mesh,velocity:new THREE.Vector3(),born:0,expires:0});}
  while(splats.length<BLOOD_SPLATS){const material=new THREE.MeshBasicMaterial({color:0x5d0505,transparent:true,opacity:0,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-6,side:THREE.DoubleSide}),mesh=new THREE.Mesh(splatGeometry,material);mesh.rotation.x=0;mesh.visible=false;mesh.renderOrder=7;mesh.userData.flightFireIgnore=true;scene.add(mesh);splats.push({mesh,born:0,expires:0});}
  return true;
}
function spawnBlood(position){
  if(!position||!ensureBloodPools())return;const p=Array.isArray(position)?tempPosition.set(Number(position[0])||0,Number(position[1])||0,Number(position[2])||0):tempPosition.copy(position),now=performance.now();
  for(let i=0;i<6;i++){const item=blood.find(x=>!x.mesh.visible)||blood[(hashText(`${now}:${i}`)+i)%blood.length],a=Math.random()*Math.PI*2,speed=.45+Math.random()*1.2;item.mesh.position.copy(p);item.mesh.position.z+=.02;item.velocity.set(Math.cos(a)*speed,Math.sin(a)*speed,.35+Math.random()*1.1);item.born=now;item.expires=now+520+Math.random()*260;item.mesh.material.opacity=.78;item.mesh.visible=true;}
  const splat=splats.find(x=>!x.mesh.visible)||splats.reduce((a,b)=>a.born<=b.born?a:b);splat.mesh.position.set(p.x,p.y,.014);splat.mesh.scale.setScalar(.65+Math.random()*.6);splat.mesh.material.opacity=.55;splat.born=now;splat.expires=now+2600;splat.mesh.visible=true;const view=viewport();if(view)view.dataset.worldBloodFx=String((Number(view.dataset.worldBloodFx)||0)+1);
}
function updateBlood(now,dt){
  for(const item of blood){if(!item.mesh.visible)continue;if(now>=item.expires){item.mesh.visible=false;continue;}item.velocity.z-=3.7*dt;item.mesh.position.addScaledVector(item.velocity,dt);if(item.mesh.position.z<.02){item.mesh.position.z=.02;item.velocity.z=Math.abs(item.velocity.z)*.16;item.velocity.x*=.55;item.velocity.y*=.55;}item.mesh.material.opacity=Math.max(0,.78*(item.expires-now)/Math.max(1,item.expires-item.born));}
  for(const item of splats){if(!item.mesh.visible)continue;if(now>=item.expires){item.mesh.visible=false;continue;}const remaining=item.expires-now;if(remaining<700)item.mesh.material.opacity=.55*remaining/700;}
}

function nodeKind(hit){for(let node=hit?.object;node;node=node.parent){const kind=String(node.userData?.worldPopulationKind||"");if(kind)return{kind,node};}return{kind:"",node:null};}
function cloneRoot(node){for(let current=node;current;current=current.parent)if(current.userData?.worldPopulationCloneSource)return current;return null;}
function wrapWorldPopulationHits(){
  const b=bridge(),base=b?.registerWorldPopulationHit;if(typeof base!=="function"||base===wrappedWorldHit||base.__gameplayPolishWrapper)return;
  const wrapper=hit=>{const info=nodeKind(hit),clone=cloneRoot(info.node),source=clone?.userData?.worldPopulationCloneSource||null,saved=source?{position:source.position.clone(),rotation:source.rotation.clone()}:null;if(source&&clone){source.position.copy(clone.position);source.rotation.copy(clone.rotation);source.updateMatrixWorld?.(true);}let handled=false;try{handled=Boolean(base(hit));}finally{if(source&&saved){source.position.copy(saved.position);source.rotation.copy(saved.rotation);source.updateMatrixWorld?.(true);}}if(handled&&info.kind==="person"){spawnBlood(hit?.point||clone?.position||info.node?.getWorldPosition?.(tempPosition));playPersonGroan();}else if(handled&&info.kind==="car")playCarExplosionSound();return handled;};
  wrapper.__gameplayPolishWrapper=true;wrappedWorldHit=wrapper;b.registerWorldPopulationHit=wrapper;const view=viewport();if(view)view.dataset.gameplayWorldHitAudio="1";
}

function refreshDensity(now){
  if(now-lastDensityScan<900)return;lastDensityScan=now;const scene=bridge()?.threeScene;if(!scene)return;const originals=[];scene.traverse(node=>{if(node?.isGroup&&!node.userData?.worldPopulationClone&&node.userData?.worldPopulationKind&&(node.userData.worldPopulationKind==="car"||node.userData.worldPopulationKind==="person"))originals.push(node);});
  const byKind=kind=>densityClones.filter(x=>x.kind===kind).length;
  for(const kind of ["car","person"]){const limit=kind==="car"?EXTRA_CARS:EXTRA_PEOPLE;let count=byKind(kind);for(const source of originals.filter(x=>x.userData.worldPopulationKind===kind)){if(count>=limit||densityClones.some(x=>x.source===source))continue;const clone=source.clone(true);clone.userData.worldPopulationClone=true;clone.userData.worldPopulationCloneSource=source;clone.traverse(node=>{node.userData.worldPopulationClone=true;node.userData.flightFireIgnore=false;});scene.add(clone);densityClones.push({kind,source,clone,index:count++});}}
  const view=viewport();if(view){view.dataset.worldExtraCars=String(byKind("car"));view.dataset.worldExtraPeople=String(byKind("person"));}
}
function updateDensity(){
  for(const record of densityClones){const{source,clone,kind,index}=record;if(!source?.parent){clone.parent?.remove(clone);continue;}const id=String(source.userData?.worldPopulationId||"");clone.userData.worldPopulationId=id;clone.traverse(node=>{if(node?.isMesh){node.userData.worldPopulationId=id;node.userData.worldPopulationKind=kind;}});if(!source.visible||!id){clone.visible=false;continue;}const yaw=Number(source.rotation.z)||0,distance=kind==="car"?(10+(index%4)*3)*(index%2?1:-1):(3.5+(index%5)*1.15)*(index%2?1:-1);clone.position.copy(source.position);clone.position.x+=Math.cos(yaw)*distance;clone.position.y+=Math.sin(yaw)*distance;clone.rotation.copy(source.rotation);clone.visible=true;}
}

function participantIds(session,self){try{return[...new Set([self,...(session?.getPeerIds?.()||[])].filter(Boolean).map(String))];}catch{return self?[self]:[];}}
function installGeoSpawnAdapter(currentBridge,session){
  if(!session||typeof session.setPose!=="function"||session.__gameplayInitialGeoSpawnAdapter)return;session.__gameplayInitialGeoSpawnAdapter=true;const base=session.setPose.bind(session);session.setPose=pose=>{const offset=currentBridge.__vsInitialGeoSpawnOffset;if(Array.isArray(pose?.g)&&pose.g.length===2&&Array.isArray(offset)&&(offset[0]||offset[1])){const lon=Number(pose.g[0]),lat=Number(pose.g[1]);if(Number.isFinite(lon)&&Number.isFinite(lat)){const earth=6378137,cos=Math.max(.01,Math.cos(lat*Math.PI/180));pose={...pose,g:[lon+offset[0]/(earth*cos)*180/Math.PI,lat+offset[1]/earth*180/Math.PI]};}}return base(pose);};
}
function ensureInitialSpawnSeparation(){
  const b=bridge(),s=activeSession(),self=String(s?.getSelfId?.()||"");if(!b||!s||!self)return;const ids=participantIds(s,self);if(ids.length<2)return;const mode=b.active?"real":"training";if(mode==="training"&&!b.__vsRespawnOffsetAdapter)return;if(mode==="real")installGeoSpawnAdapter(b,s);const key=`${mode}:${ids.slice().sort().join("|")}`,offset=deterministicInitialSpawnOffset(self,ids.filter(id=>id!==self));if(b.__vsInitialSpawnSetKey===key)return;if(mode==="real")b.__vsInitialGeoSpawnOffset=[offset.x,offset.y];else b.__vsRespawnLocalOffset=[offset.x,offset.y];b.__vsInitialSpawnSetKey=key;const view=viewport();if(view){view.dataset.vsInitialSpawnSeparated="1";view.dataset.vsInitialSpawnMode=mode;view.dataset.vsInitialSpawnSet=key;view.dataset.vsInitialSpawnOffsetM=`${offset.x.toFixed(2)},${offset.y.toFixed(2)}`;view.dataset.vsInitialSpawnPairDistanceM=ids.length===2?"24.00":"ring";}}

function flightSurface(event){const target=event?.target;return target instanceof Element&&!target.closest(FLIGHT_UI_SELECTOR);}
function cancelActivePointers(){const view=viewport();if(!view)return;for(const pointerId of [...activePointers]){try{view.dispatchEvent(new PointerEvent("pointercancel",{pointerId,bubbles:false,cancelable:true}));}catch{try{view.dispatchEvent(new Event("pointercancel",{bubbles:false,cancelable:true}));}catch{}}}activePointers.clear();}
function syncDeathFireLock(){
  const b=bridge(),dead=Boolean(b?.vsLocalDead),view=viewport();if(dead){globalThis.__arondightSettingsGamepadBlockUntilRelease=true;if(!lastDead)cancelActivePointers();}document.body?.classList.toggle("vs-combat-dead",dead);if(view)view.dataset.fireLockedByDeath=dead?"1":"0";lastDead=dead;
}

function handleRemoteFx(event){queueMicrotask(()=>{const packet=event?.detail?.packet;if(!packet?.objectId)return;if(packet.kind==="car"&&packet.type==="explosion")playCarExplosionSound();else if(packet.kind==="person"&&packet.type==="impact"){playPersonGroan();if(Array.isArray(packet.p))spawnBlood(packet.p);}});}
function animationLoop(now=performance.now()){
  const dt=Math.min(.05,Math.max(0,(now-lastFrame)/1000||0));lastFrame=now;wrapWorldPopulationHits();ensureInitialSpawnSeparation();syncDeathFireLock();refreshDensity(now);updateDensity();updateBlood(now,dt);requestAnimationFrame(animationLoop);
}

export function installGameplayPolish(){
  if(installed)return;installed=true;const style=document.createElement("style");style.dataset.gameplayPolish="v1";style.textContent=`body.vs-combat-dead .xbox-crosshair{display:none!important}body.vs-combat-dead #viewport{cursor:not-allowed}`;document.head.appendChild(style);const view=viewport();
  view?.addEventListener("pointerdown",event=>{ensureAudio();if(!flightSurface(event))return;if(bridge()?.vsLocalDead){event.preventDefault();event.stopImmediatePropagation();return;}activePointers.add(event.pointerId);},{capture:true,passive:false});
  for(const type of ["pointerup","pointercancel"])view?.addEventListener(type,event=>activePointers.delete(event.pointerId),{capture:true,passive:true});
  document.addEventListener("keydown",()=>ensureAudio(),{capture:true});globalThis.addEventListener(VS_FX_EVENT,handleRemoteFx);if(view&&globalThis.MutationObserver)new MutationObserver(()=>syncDeathFireLock()).observe(view,{attributes:true,attributeFilter:["data-vs-local-health"]});requestAnimationFrame(animationLoop);if(view){view.dataset.gameplayPolish="1";view.dataset.gameplayExtraCarsTarget=String(EXTRA_CARS);view.dataset.gameplayExtraPeopleTarget=String(EXTRA_PEOPLE);}
}

installGameplayPolish();
