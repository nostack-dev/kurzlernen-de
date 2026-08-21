import * as THREE from "three";

const DYNAMIC_KINDS=new Set(["car","person","life-car","life-person","bus","bird"]);
const PERSON_KINDS=new Set(["person","life-person"]);
const AUDIO_SETTINGS_KEY="arondight45AudioSettingsV1";
const PANIC_RADIUS_M=30;
const PANIC_MS=5200;
const FLEE_MPS=4.4;
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,Number(v)||0));

let installed=false,lastScan=0,lastFrame=performance.now(),lastWalkShots=0,lastLifeHits=0,audioCtx=null,audioUnlocked=false,shotObserver=null;
let sceneRef=null;
const roots=new Map();
const tmp=new THREE.Vector3();

function bridge(){return globalThis.__arondightRealWorld||null;}
function viewport(){return document.getElementById("viewport");}
function sourceId(node){return String(node?.userData?.worldLifeId||node?.userData?.worldPopulationId||"");}
function sourceKind(node){return String(node?.userData?.worldLifeKind||node?.userData?.worldPopulationKind||"");}
function audioSettings(){try{const raw=localStorage.getItem(AUDIO_SETTINGS_KEY),v=raw?JSON.parse(raw):{};return{enabled:v.soundEnabled!==false,volume:clamp(v.fxVolume??100,0,100)/100};}catch{return{enabled:true,volume:1};}}
function unlockAudio(){audioUnlocked=true;const Ctx=globalThis.AudioContext||globalThis.webkitAudioContext;if(!Ctx)return;try{audioCtx??=new Ctx({latencyHint:"interactive"});if(audioCtx.state==="suspended")audioCtx.resume().catch(()=>{});}catch{}}

function scream(strength=1){
  const settings=audioSettings();if(!audioUnlocked||!settings.enabled||settings.volume<=0||!audioCtx||audioCtx.state!=="running")return;
  try{
    const t=audioCtx.currentTime,d=.42+Math.random()*.16,master=audioCtx.createGain(),formant=audioCtx.createBiquadFilter(),o1=audioCtx.createOscillator(),o2=audioCtx.createOscillator();
    master.gain.setValueAtTime(.0001,t);master.gain.exponentialRampToValueAtTime(.055*settings.volume*strength,t+.025);master.gain.exponentialRampToValueAtTime(.0001,t+d);
    formant.type="bandpass";formant.frequency.setValueAtTime(980+Math.random()*180,t);formant.Q.value=1.15;
    o1.type="sawtooth";o2.type="triangle";o1.frequency.setValueAtTime(620+Math.random()*90,t);o1.frequency.exponentialRampToValueAtTime(310+Math.random()*55,t+d);o2.frequency.setValueAtTime(930+Math.random()*120,t);o2.frequency.exponentialRampToValueAtTime(470+Math.random()*80,t+d);
    o1.connect(formant);o2.connect(formant);formant.connect(master).connect(audioCtx.destination);o1.start(t);o2.start(t);o1.stop(t+d+.03);o2.stop(t+d+.03);
  }catch{}
}

function rootFor(node,id){let r=node;while(r.parent&&sourceId(r.parent)===id)r=r.parent;return r;}
function scanDynamic(now){
  const scene=bridge()?.threeScene;if(!scene)return;if(scene!==sceneRef){sceneRef=scene;roots.clear();lastScan=0;}
  if(now-lastScan<650)return;lastScan=now;roots.clear();
  scene.traverse(node=>{
    const kind=sourceKind(node),id=sourceId(node);
    if(node?.isMesh&&DYNAMIC_KINDS.has(kind)){node.frustumCulled=false;node.userData.walkNearCullProtected=true;}
    if(!id||!DYNAMIC_KINDS.has(kind)||roots.has(id))return;
    const root=rootFor(node,id);root.userData.walkNearCullProtected=true;roots.set(id,{id,kind,root});
  });
  const v=viewport();if(v){v.dataset.walkDynamicCull="disabled-near-v1";v.dataset.walkDynamicRoots=String(roots.size);}
}

function parseWalkPosition(){const raw=String(viewport()?.dataset.walkPosition||"").split(",").map(Number);return raw.length>=2&&raw.every(Number.isFinite)?{x:raw[0],y:raw[1]}:null;}
function personEntries(){return[...roots.values()].filter(item=>PERSON_KINDS.has(item.kind)&&item.root?.visible!==false);}
function reactToGunshot(){
  const shot=parseWalkPosition();if(!shot)return;const now=performance.now(),near=[];
  for(const item of personEntries()){
    item.root.getWorldPosition(tmp);const dx=tmp.x-shot.x,dy=tmp.y-shot.y,dist=Math.hypot(dx,dy);if(dist>PANIC_RADIUS_M)continue;
    const inv=1/Math.max(.25,dist),p=item.root.userData.walkPanic||{offsetX:0,offsetY:0,lastScream:-Infinity,lastPatchedX:null,lastPatchedY:null};p.dirX=dx*inv;p.dirY=dy*inv;if(dist<1){const a=(item.id.length*1.731)%6.283;p.dirX=Math.cos(a);p.dirY=Math.sin(a);}p.until=now+PANIC_MS;p.speed=FLEE_MPS+(1-dist/PANIC_RADIUS_M)*1.7;item.root.userData.walkPanic=p;near.push({item,dist,p});
  }
  near.sort((a,b)=>a.dist-b.dist);let screamed=0;for(const x of near){if(screamed>=2)break;if(now-x.p.lastScream<2600)continue;x.p.lastScream=now;scream(x.dist<8?1:.72);screamed++;}
  const v=viewport();if(v){v.dataset.worldPeoplePanic=String(near.length);v.dataset.worldPeopleReaction="flee+scream-v1";}
}
function reactToHit(){scream(1.08);const v=viewport();if(v)v.dataset.worldPeopleHitScream="synth-v1";}
function updatePanic(now,dt){
  for(const item of personEntries()){
    const root=item.root,p=root.userData.walkPanic;if(!p)continue;
    // WORLD population code rewrites its deterministic base pose each frame. If
    // it did not run this frame, first remove our previous overlay so offsets
    // cannot accumulate twice.
    const sameAsLast=Number.isFinite(p.lastPatchedX)&&Math.hypot(root.position.x-p.lastPatchedX,root.position.y-p.lastPatchedY)<.006;
    if(sameAsLast){root.position.x-=Number(p.offsetX)||0;root.position.y-=Number(p.offsetY)||0;}
    if(now<p.until){p.offsetX=(Number(p.offsetX)||0)+(Number(p.dirX)||0)*(Number(p.speed)||FLEE_MPS)*dt;p.offsetY=(Number(p.offsetY)||0)+(Number(p.dirY)||0)*(Number(p.speed)||FLEE_MPS)*dt;root.rotation.z=Math.atan2(Number(p.dirY)||0,Number(p.dirX)||1);}
    else{const decay=Math.exp(-.10*dt);p.offsetX*=decay;p.offsetY*=decay;if(Math.hypot(p.offsetX,p.offsetY)<.03){delete root.userData.walkPanic;continue;}}
    root.position.x+=Number(p.offsetX)||0;root.position.y+=Number(p.offsetY)||0;p.lastPatchedX=root.position.x;p.lastPatchedY=root.position.y;
  }
}

function paletteForId(id){
  const scene=bridge()?.threeScene;if(!scene||!id)return null;const counts=new Map();let sphere=null,capsule=null;
  scene.traverse(node=>{if(!node?.isMesh||sourceId(node)!==id)return;const color=node.material?.color?.getHex?.();if(!Number.isFinite(color))return;counts.set(color,(counts.get(color)||0)+1);const type=String(node.geometry?.type||"");if(type.includes("Sphere"))sphere=color;if(type.includes("Capsule"))capsule=color;});
  const ranked=[...counts].sort((a,b)=>b[1]-a[1]).map(x=>x[0]);if(!ranked.length)return null;
  const shirt=capsule??ranked[0],skin=sphere??ranked.at(-1),pants=ranked.find(c=>c!==shirt&&c!==skin)??ranked.find(c=>c!==shirt)??0x293847;return{shirt,skin,pants};
}
function syncRagdollPalette(){
  const scene=bridge()?.threeScene;if(!scene)return;scene.traverse(root=>{
    if(!root?.userData?.worldRagdollRoot||root.visible===false)return;const id=String(root.userData.worldRagdollId||"");if(!id||root.userData.walkSourcePaletteId===id)return;const palette=paletteForId(id);if(!palette)return;
    root.traverse(node=>{if(!node?.isMesh||!node.material?.color)return;const kind=String(node.userData?.ragdollKind||"");if(kind==="shirt")node.material.color.setHex(palette.shirt);else if(kind==="pants")node.material.color.setHex(palette.pants);else if(kind==="skin"||kind==="head")node.material.color.setHex(palette.skin);});root.userData.walkSourcePaletteId=id;const v=viewport();if(v)v.dataset.worldRagdollPalette="source-preserved-v1";
  });
}

function weaponMesh(geometry,material,position,rotation=[0,0,0]){const m=new THREE.Mesh(geometry,material);m.position.set(...position);m.rotation.set(...rotation);m.frustumCulled=false;m.renderOrder=10002;m.userData.flightFireIgnore=true;m.userData.walkWeaponPart=true;m.userData.walkArmHotfix=true;return m;}
function patchWeapon(){
  const scene=bridge()?.threeScene,gun=scene?.getObjectByName?.("WALK_PISTOL_3D");if(!gun||gun.userData.walkWeaponVisualHotfix)return;
  for(const child of[...gun.children]){const hex=child?.material?.color?.getHex?.();if(hex===0xb97855)gun.remove(child);}
  const skin=new THREE.MeshStandardMaterial({color:0xc58a67,roughness:.78,metalness:0,depthTest:false,depthWrite:false});
  const hand=weaponMesh(new THREE.CapsuleGeometry(.040,.085,4,8),skin,[.018,-.175,.035],[.12,0,-.08]);hand.scale.set(1.05,.90,1.0);
  const wrist=weaponMesh(new THREE.CapsuleGeometry(.043,.075,4,8),skin,[.035,-.245,.090],[.62,0,.08]);
  const forearm=weaponMesh(new THREE.CapsuleGeometry(.048,.19,4,8),skin,[.055,-.335,.175],[.72,0,.10]);
  gun.add(hand,wrist,forearm);gun.userData.walkWeaponVisualHotfix=true;gun.userData.walkWeaponVisual="pistol-hand-arm-v2";const v=viewport();if(v)v.dataset.walkWeaponVisual="pistol-hand-arm-v2";
}

function installLocationAutoApply(){
  document.addEventListener("change",event=>{const select=event.target instanceof Element?event.target.closest("[data-world-location-select]"):null;if(!select||select.value==="custom")return;const root=select.closest("[data-world-location-selector]");queueMicrotask(()=>root?.querySelector("[data-world-location-apply]")?.click());const v=viewport();if(v)v.dataset.worldLocationSwitch="auto-apply-v1";},{capture:true});
}
function observeShots(){
  const v=viewport();if(!v||shotObserver)return false;lastWalkShots=Number(v.dataset.walkShots)||0;lastLifeHits=Number(v.dataset.worldLifeHits)||0;
  shotObserver=new MutationObserver(()=>{const shots=Number(v.dataset.walkShots)||0,hits=Number(v.dataset.worldLifeHits)||0;if(shots>lastWalkShots)for(let n=lastWalkShots;n<shots;n++)reactToGunshot();if(hits>lastLifeHits)reactToHit();lastWalkShots=shots;lastLifeHits=hits;});shotObserver.observe(v,{attributes:true,attributeFilter:["data-walk-shots","data-world-life-hits"]});return true;
}
function frame(now=performance.now()){const dt=clamp((now-lastFrame)/1000,0,.05);lastFrame=now;observeShots();scanDynamic(now);patchWeapon();updatePanic(now,dt);syncRagdollPalette();requestAnimationFrame(frame);}

export function installWalkWorldExperienceHotfix(){if(installed)return;installed=true;addEventListener("pointerdown",unlockAudio,{capture:true,passive:true});addEventListener("keydown",unlockAudio,{capture:true});installLocationAutoApply();observeShots();requestAnimationFrame(frame);}

installWalkWorldExperienceHotfix();
