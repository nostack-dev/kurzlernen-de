// Drone guided missile (LENKRAKETE). First press marks a target: whatever living or moving thing
// is closest to the crosshair / your finger on screen (a person, a car or bus, a dog, cat or cow,
// a bird, a police drone, another player or his drone). A lock box follows it with a lock tone.
// The next press launches: the missile drops off the drone, its motor lights with a bang and it
// flies like a cruise missile — up to a cruise height above the target's area, flat and fast
// (proportional navigation on the moving target), then a steep terminal dive. Proximity fuze,
// 9 m blast. A press on a different target while locked re-marks instead of firing.
import * as THREE from "three";
import {requestLight} from "./dynamic_lights.mjs";
import {staticGroundHeightAt} from "./terrain_craters.mjs";
import {wantedLineBlockedByPrisms} from "./wanted_system_logic.mjs";
import {GUIDED_BALANCE,updatePedestrianDodge} from "./guided_balance.mjs";

export const GUIDED_MISSILE_VERSION="press-fires-v3";
const PICK_PX=70,MAX_RANGE_M=600,CRUISE_MPS=GUIDED_BALANCE.speedMps,TURN_G=9.81*GUIDED_BALANCE.turnG,TTL_MS=22000,FUZE_M=2.4,BLAST_M=GUIDED_BALANCE.blastRadiusM,BLAST_DMG=GUIDED_BALANCE.damage,DIVE_RANGE_M=70,COOLDOWN_MS=GUIDED_BALANCE.cooldownMs;
let installed=false,lock=null,lockEl=null,lastLaunch=-Infinity,smokePool=null,smokeCursor=0;const missiles=[];
let guidedWarningEl=null;
const bridge=()=>globalThis.__arondightRealWorld||null;
const viewport=()=>document.getElementById("viewport");
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const tmp=new THREE.Vector3(),tmp2=new THREE.Vector3(),ndc=new THREE.Vector3();
function cam(){const b=bridge();return b?.presentedCamera?.()||b?.threeCamera||null;}
function logicalPoint(clientX,clientY){const view=viewport(),screen=view?.getBoundingClientRect();if(!view||!screen)return null;const width=Math.max(1,view.clientWidth),height=Math.max(1,view.clientHeight),cx=Number.isFinite(Number(clientX))?Number(clientX):screen.left+screen.width/2,cy=Number.isFinite(Number(clientY))?Number(clientY):screen.top+screen.height/2,rotated=view.dataset.soloOrientation==="css-landscape",x=rotated?cy-screen.top:cx-screen.left,y=rotated?screen.right-cx:cy-screen.top;return{x:clamp(x,0,width),y:clamp(y,0,height),width,height,rotated};}
function toScreen(p,c,w,h){ndc.set(p.x,p.y,p.z).project(c);if(ndc.z>1||ndc.z<-1)return null;return{x:(ndc.x+1)/2*w,y:(1-ndc.y)/2*h};}
// ---------------------------------------------------------------- what can be marked
function candidates(){const out=[],b=bridge(),scene=b?.threeScene;
  if(scene){const roots=new Map();scene.traverse(n=>{const u=n.userData;const id=String(u?.worldPopulationId||u?.worldLifeId||"");if(!id)return;const kind=String(u.worldPopulationKind||u.worldLifeKind||"").replace(/^life-/,"");if(!/person|car|bus|bird/.test(kind))return;let r=n;while(r.parent&&String(r.parent.userData?.worldPopulationId||r.parent.userData?.worldLifeId||"")===id)r=r.parent;if(!roots.has(id))roots.set(id,{r,kind});});
    for(const[id,{r,kind}]of roots){if(!r.visible)continue;const lift=kind==="person"?1.1:kind==="bird"?0:.8;out.push({id,kind,label:kind==="person"?"PERSON":kind==="bird"?"VOGEL":kind==="bus"?"BUS":"AUTO",pos:()=>r.parent&&r.visible!==false?r.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0,0,lift)):null});}}
  for(const a of globalThis.__ambientAnimals?.poses?.()||[]){const i=a.i;out.push({id:`animal-${i}`,kind:"animal",label:String(a.species||"TIER").toUpperCase().replace("BLACK-CAT","KATZE").replace("CAT","KATZE").replace("DOG","HUND"),pos:()=>{const q=(globalThis.__ambientAnimals?.poses?.()||[]).find(x=>x.i===i);return q?new THREE.Vector3(q.x,q.y,(Number(q.z)||staticGroundHeightAt(q.x,q.y))+.35):null;}});}
  for(const c of globalThis.__arondightCows?.list?.()||[]){if(c.dead||c.hidden)continue;out.push({id:`cow-${c.key}`,kind:"cow",label:"KUH",pos:()=>c.dead||c.hidden?null:new THREE.Vector3(c.x,c.y,staticGroundHeightAt(c.x,c.y)+1)});}
  for(const d of globalThis.__arondightWantedSystem?.drones||[]){if(!d?.active||!d.root||d.index<0)continue;out.push({id:`police-drone-${d.index}`,kind:"drone",label:"POLIZEIDROHNE",pos:()=>d.active&&d.root?d.root.getWorldPosition(new THREE.Vector3()):null});}
  for(const pl of globalThis.__arondightPlayerVehicleRuntime?.remotePlayers?.()||[]){const pid=pl.id;const get=key=>()=>{const q=(globalThis.__arondightPlayerVehicleRuntime?.remotePlayers?.()||[]).find(x=>x.id===pid)?.[key];return q?new THREE.Vector3(q[0],q[1],q[2]+(key==="body"?1.1:0)):null;};if(pl.body)out.push({id:`mate-${pid}`,kind:"mate",label:"SPIELER",pos:get("body")});if(pl.drone)out.push({id:`mate-drone-${pid}`,kind:"drone",label:"DROHNE",pos:get("drone")});}
  return out;}
function pick(clientX,clientY){const c=cam(),p=logicalPoint(clientX,clientY);if(!c||!p)return null;c.updateMatrixWorld?.(true);let best=null,bd=PICK_PX;
  for(const t of candidates()){const w=t.pos();if(!w)continue;const dist=w.distanceTo(c.position);if(dist>MAX_RANGE_M||dist<3)continue;const s=toScreen(w,c,p.width,p.height);if(!s)continue;const d=Math.hypot(s.x-p.x,s.y-p.y)-Math.min(18,600/dist);/* small far things get a little slack */if(d<bd){bd=d;best=t;}}
  return best;}
// ---------------------------------------------------------------- lock box
function ensureLockEl(){const v=viewport();if(!v)return null;if(lockEl?.isConnected)return lockEl;lockEl=document.createElement("div");lockEl.id="guidedLockBox";lockEl.style.cssText="position:absolute;left:0;top:0;width:46px;height:46px;margin:-23px 0 0 -23px;z-index:25;pointer-events:none;display:none;border:2px solid #ff4d3a;box-shadow:0 0 10px #ff4d3a99,inset 0 0 8px #ff4d3a55;border-radius:4px";const tag=document.createElement("div");tag.style.cssText="position:absolute;left:50%;top:-20px;transform:translateX(-50%);white-space:nowrap;font:900 11px/1 system-ui,sans-serif;letter-spacing:.14em;color:#ffdad4;text-shadow:0 1px 2px #000";lockEl.appendChild(tag);v.appendChild(lockEl);return lockEl;}
function renderLock(now){const el=ensureLockEl();if(!el)return;if(!lock){el.style.display="none";return;}const w=lock.pos(),c=cam(),v=viewport();if(!w||!c||!v){clearLock("lost");el.style.display="none";return;}const s=toScreen(w,c,v.clientWidth,v.clientHeight);if(!s){el.style.display="none";return;}
  const rotated=v.dataset.soloOrientation==="css-landscape";el.style.display="block";el.style.transform=rotated?`translate(${v.clientHeight-s.y}px,${s.x}px)`:`translate(${s.x}px,${s.y}px)`;const pulse=.85+.15*Math.sin(now/90);el.style.opacity=String(pulse);const d=w.distanceTo(c.position);el.firstChild.textContent=`LOCK · ${lock.label} · ${Math.round(d)} m`;}
function warnLock(target){
  const v=viewport();if(!v)return;
  if(!guidedWarningEl?.isConnected){guidedWarningEl=document.createElement('div');guidedWarningEl.id='guidedLockWarning';guidedWarningEl.setAttribute('role','status');guidedWarningEl.style.cssText='position:absolute;top:23%;left:50%;transform:translateX(-50%);z-index:26;pointer-events:none;padding:7px 12px;color:#fff;background:#871d18e8;border:1px solid #ffac84;border-radius:7px;font:800 12px system-ui;letter-spacing:.06em;text-align:center';v.appendChild(guidedWarningEl);}
  guidedWarningEl.textContent='GUIDED LOCK · '+target.label+' · SPRINT ZUM AUSWEICHEN';
  guidedWarningEl.hidden=false;
  window.dispatchEvent(new CustomEvent('arondight:guided-lock-warning',{detail:{targetId:target.id,targetKind:target.kind}}));
}
function clearLock(reason=""){if(guidedWarningEl)guidedWarningEl.hidden=true;if(lock){lock=null;const v=viewport();if(v)v.dataset.guidedLock=reason||"none";}}
// ---------------------------------------------------------------- sound
function ac(){const a=globalThis.__sharedAudioContext;return a&&a.state==="running"?a:null;}
function lockTone(){const a=ac();if(!a)return;try{const t=a.currentTime;for(let k=0;k<2;k++){const o=a.createOscillator(),g=a.createGain();o.type="square";o.frequency.value=1760;const s=t+k*.09;g.gain.setValueAtTime(.05,s);g.gain.setValueAtTime(0,s+.05);o.connect(g).connect(a.destination);o.start(s);o.stop(s+.06);}}catch{}}
let noiseBuf=null;function noise(a){if(noiseBuf&&noiseBuf.sampleRate===a.sampleRate)return noiseBuf;const n=a.createBuffer(1,a.sampleRate*2,a.sampleRate),d=n.getChannelData(0);let b=0;for(let i=0;i<d.length;i++){const w=Math.random()*2-1;b=.96*b+.04*w;d[i]=w*.5+b*2;}return noiseBuf=n;}
function motorVoice(){const a=ac();if(!a)return null;try{const t=a.currentTime,src=a.createBufferSource();src.buffer=noise(a);src.loop=true;const bp=a.createBiquadFilter();bp.type="bandpass";bp.frequency.value=700;bp.Q.value=.7;const whine=a.createOscillator();whine.type="sawtooth";whine.frequency.value=1300;const wg=a.createGain();wg.gain.value=.05;const g=a.createGain();g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(.5,t+.06);g.gain.exponentialRampToValueAtTime(.28,t+.6);const pan=a.createPanner();pan.panningModel="equalpower";pan.distanceModel="inverse";pan.refDistance=6;pan.rolloffFactor=1.05;
    src.connect(bp).connect(g);whine.connect(wg).connect(g);g.connect(pan).connect(a.destination);src.start(t);whine.start(t);
    // ignition bang
    const o=a.createOscillator(),og=a.createGain();o.type="sine";o.frequency.setValueAtTime(110,t);o.frequency.exponentialRampToValueAtTime(40,t+.3);og.gain.setValueAtTime(.6,t);og.gain.exponentialRampToValueAtTime(.001,t+.35);o.connect(og).connect(a.destination);o.start(t);o.stop(t+.4);
    return{src,whine,g,pan,bp};}catch{return null;}}
function stopVoice(v){if(!v)return;const a=ac();try{const t=a?a.currentTime:0;v.g.gain.cancelScheduledValues(t);v.g.gain.setTargetAtTime(0,t,.05);setTimeout(()=>{try{v.src.stop();v.whine.stop();}catch{}},400);}catch{}}
// ---------------------------------------------------------------- missile
let puffTex=null;function softPuff(){if(puffTex)return puffTex;const c=document.createElement("canvas");c.width=c.height=64;const x=c.getContext("2d"),gr=x.createRadialGradient(32,32,0,32,32,32);gr.addColorStop(0,"rgba(255,255,255,.9)");gr.addColorStop(.5,"rgba(255,255,255,.35)");gr.addColorStop(1,"rgba(255,255,255,0)");x.fillStyle=gr;x.fillRect(0,0,64,64);puffTex=new THREE.CanvasTexture(c);return puffTex;}
function ensureSmoke(scene){if(smokePool?.parent===scene)return smokePool;const n=160,g=new THREE.BufferGeometry(),pos=new Float32Array(n*3).fill(-1e5);g.setAttribute("position",new THREE.BufferAttribute(pos,3).setUsage(THREE.DynamicDrawUsage));const m=new THREE.PointsMaterial({color:0xd9dcdf,size:1.6,sizeAttenuation:true,transparent:true,opacity:.42,depthWrite:false,map:softPuff(),alphaTest:.01});/* round, soft puffs (untextured points are drawn as squares) */smokePool=new THREE.Points(g,m);smokePool.frustumCulled=false;smokePool.userData.flightFireIgnore=true;smokePool.raycast=()=>{};smokePool.userData.born=new Float32Array(n);scene.add(smokePool);return smokePool;}
function puff(p){if(!smokePool)return;const pos=smokePool.geometry.attributes.position,i=smokeCursor++%pos.count;pos.setXYZ(i,p.x+(Math.random()-.5)*.2,p.y+(Math.random()-.5)*.2,p.z+(Math.random()-.5)*.2);smokePool.userData.born[i]=performance.now();pos.needsUpdate=true;}
function stepSmoke(now){if(!smokePool)return;const pos=smokePool.geometry.attributes.position,born=smokePool.userData.born;let dirty=false;for(let i=0;i<pos.count;i++){if(!born[i])continue;if(now-born[i]>2600){pos.setXYZ(i,0,0,-1e5);born[i]=0;dirty=true;continue;}pos.setZ(i,pos.getZ(i)+.006);dirty=true;}if(dirty)pos.needsUpdate=true;}
function launch(now){const b=bridge(),scene=b?.threeScene,c=cam();if(!lock||!scene||!c)return false;const target=lock.pos();if(!target){clearLock("lost");return false;}
  const drone=globalThis.__arondightPlayerVehicleRuntime?.dronePosition?.()||null,start=drone?new THREE.Vector3(drone[0],drone[1],drone[2]-.35):c.position.clone().add(new THREE.Vector3(0,0,-.6));
  const group=new THREE.Group();group.name="GUIDED_MISSILE";const body=new THREE.Mesh(new THREE.CylinderGeometry(.06,.06,.9,10),new THREE.MeshStandardMaterial({color:0xd8dcdf,roughness:.4,metalness:.5})),nose=new THREE.Mesh(new THREE.ConeGeometry(.06,.22,10),new THREE.MeshStandardMaterial({color:0x2e3338,roughness:.5})),flame=new THREE.Mesh(new THREE.ConeGeometry(.05,.5,8),new THREE.MeshBasicMaterial({color:0xffb24a,transparent:true,opacity:.9,blending:THREE.AdditiveBlending,depthWrite:false}));
  body.rotation.x=Math.PI/2;nose.rotation.x=-Math.PI/2;nose.position.z=-.56;flame.rotation.x=Math.PI/2;flame.position.z=.7;for(let k=0;k<4;k++){const fin=new THREE.Mesh(new THREE.BoxGeometry(.008,.18,.16),body.material);fin.rotation.z=k*Math.PI/2;fin.position.set(0,0,.36);fin.translateY(.07);group.add(fin);}
  flame.visible=false;group.add(body,nose,flame);group.traverse(n=>{n.userData.flightFireIgnore=true;n.raycast=()=>{};});group.position.copy(start);const dir=tmp.copy(target).sub(start).setZ(0).normalize();group.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,-1),dir);scene.add(group);ensureSmoke(scene);
  const cruiseZ=Math.max(start.z+8,target.z+28);missiles.push({group,flame,target:lock,last:target.clone(),vel:dir.clone().multiplyScalar(6).setZ(-3),born:now,ignite:now+320,cruiseZ,voice:null,scene,dodge:{last:target.clone(),seconds:0,lost:false}});
  lastLaunch=now;clearLock("fired");window.dispatchEvent(new CustomEvent("arondight:weapon-fired",{detail:{weapon:"guided-missile",source:"drone",mode:"drone",intensity:.5}}));const v=viewport();if(v)v.dataset.guidedLaunches=String((Number(v.dataset.guidedLaunches)||0)+1);return true;}
function detonate(i,pos,hit){const m=missiles[i];missiles.splice(i,1);m.scene.remove(m.group);stopVoice(m.voice);window.dispatchEvent(new CustomEvent("arondight:world-explosion",{detail:{position:[pos.x,pos.y,pos.z],radiusM:BLAST_M,maxDamage:BLAST_DMG,kind:"missile",source:"guided-missile",targeted:Boolean(hit)}}));const v=viewport();if(v)v.dataset.guidedLast=hit?"hit":"miss";}
function step(now,dt){for(let i=missiles.length-1;i>=0;i--){const m=missiles[i],p=m.group.position;const t=m.target.pos();
    if(t&&!m.dodge.lost){
      const pedestrian=m.target.kind==='person'||m.target.kind==='mate';
      const state=updatePedestrianDodge(m.dodge,{previous:m.dodge.last,current:t,dt,pedestrian});
      m.dodge.seconds=state.seconds;m.dodge.lost=state.lost;
      if(state.lost){m.target={...m.target,pos:()=>null};const v=viewport();if(v)v.dataset.guidedCounter='dodge-sprint';}
      else m.last.copy(t);
      m.dodge.last=t.clone();
    }
    const goal=m.last;
    if(now<m.ignite){m.vel.z-=9.81*dt;p.addScaledVector(m.vel,dt);continue;}/* dropped off the rail, then the motor lights */
    if(!m.voice){m.voice=motorVoice();m.flame.visible=true;}
    const horiz=Math.hypot(goal.x-p.x,goal.y-p.y),diving=horiz<DIVE_RANGE_M||goal.distanceTo(p)<DIVE_RANGE_M;
    // aim point: cruise height until the dive, then straight at the target (lead on its motion)
    const aim=tmp.copy(goal);if(!diving)aim.z=Math.max(m.cruiseZ,staticGroundHeightAt(p.x,p.y)+18);
    const want=tmp2.copy(aim).sub(p).normalize().multiplyScalar(CRUISE_MPS*(diving?1.12:1)),dv=want.sub(m.vel),maxDv=TURN_G*dt*(diving?1.4:1);if(dv.length()>maxDv)dv.setLength(maxDv);m.vel.add(dv);
    const speed=m.vel.length(),boost=Math.min(CRUISE_MPS,speed+40*dt);m.vel.setLength(Math.max(boost,8));p.addScaledVector(m.vel,dt);m.group.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,-1),tmp.copy(m.vel).normalize());
    m.flame.scale.set(1,.8+Math.random()*.5,1);puff(tmp.copy(p).addScaledVector(m.vel,-.9/Math.max(1,m.vel.length())));requestLight([p.x,p.y,p.z],{color:0xffa04a,intensity:20,distance:12});
    if(m.voice?.pan?.positionX){m.voice.pan.positionX.value=p.x;m.voice.pan.positionY.value=p.y;m.voice.pan.positionZ.value=p.z;}
    const ground=staticGroundHeightAt(p.x,p.y);if(goal.distanceTo(p)<FUZE_M){detonate(i,p.clone(),true);continue;}if(p.z<ground+.3){detonate(i,new THREE.Vector3(p.x,p.y,ground+.3),false);continue;}if(now-m.born>TTL_MS){detonate(i,p.clone(),false);continue;}
    // a building in the way: it goes off at the wall
    const prisms=bridge()?.buildingCollisionSnapshot?.prisms;if(prisms?.length&&m.prev&&wantedLineBlockedByPrisms({x:m.prev.x,y:m.prev.y,z:m.prev.z},{x:p.x,y:p.y,z:p.z},prisms)){detonate(i,m.prev.clone(),false);continue;}
    (m.prev??=new THREE.Vector3()).copy(p);}}
// ---------------------------------------------------------------- input (drone weapon "guided")
// One press = one missile, on every input (tap, click, RT/RB, key). Near the aim point there is
// something to home on → it locks and flies at it; nothing there → it flies to the spot you aimed at
// (ground, wall). While it reloads (5 s) a press only shows how long is left — on the weapon button,
// next to the crosshair and with a short "denied" blip; it never silently does nothing.
const rc=new THREE.Raycaster(),ndc2=new THREE.Vector2();
function aimPoint(clientX,clientY){const c=cam(),p=logicalPoint(clientX,clientY);if(!c||!p)return null;c.updateMatrixWorld?.(true);ndc2.set(p.x/p.width*2-1,-(p.y/p.height)*2+1);rc.setFromCamera(ndc2,c);const o=rc.ray.origin,d=rc.ray.direction,R=globalThis.__arondightWorldRigidBodies;
  try{const hit=R?.raycast?.([o.x,o.y,o.z],[d.x,d.y,d.z],MAX_RANGE_M,{categoryBits:8n,maskBits:1n});if(hit?.point)return new THREE.Vector3(hit.point[0],hit.point[1],hit.point[2]);}catch{}
  for(let t=3;t<MAX_RANGE_M;t+=t<80?1.5:5){tmp2.copy(o).addScaledVector(d,t);if(tmp2.z<=staticGroundHeightAt(tmp2.x,tmp2.y))return tmp2.clone();}return o.clone().addScaledVector(d,180);}
export function cooldownLeftMs(now=performance.now()){return Math.max(0,COOLDOWN_MS-(now-lastLaunch));}
function denied(){const a=ac();if(a)try{const t=a.currentTime,o=a.createOscillator(),g=a.createGain();o.type="square";o.frequency.setValueAtTime(330,t);o.frequency.setValueAtTime(220,t+.07);g.gain.setValueAtTime(.05,t);g.gain.exponentialRampToValueAtTime(.001,t+.16);o.connect(g).connect(a.destination);o.start(t);o.stop(t+.18);}catch{}
  const v=viewport();if(v){v.dataset.guidedDenied=String(performance.now()|0);document.body.classList.add("guided-denied");clearTimeout(denied.t);denied.t=setTimeout(()=>document.body.classList.remove("guided-denied"),900);}}
export function press({clientX,clientY,source="external"}={}){const now=performance.now();if(now<(Number(globalThis.__arondightWeaponLockUntil)||0)||globalThis.__arondightDroneDamageModel?.destroyed)return false;
  if(cooldownLeftMs(now)>0){denied();return false;}
  const picked=pick(clientX,clientY);
  if(picked&&(!lock||picked.id!==lock.id)){lock=picked;lockTone();warnLock(picked);}
  if(!lock){const p=aimPoint(clientX,clientY);if(!p)return false;const at=p.clone();lock={id:`point-${now|0}`,kind:"point",label:"ZIELPUNKT",pos:()=>at};}
  const v=viewport();if(v){v.dataset.guidedLock=`${lock.kind}:${lock.id}`;v.dataset.guidedLockInput=source;}
  return launch(now);}
const BLOCKED="#worldLookHud,#soloTopbar,#soloLeft,#soloRight,#soloClearance,.solo-action,.phone-settings-dialog,#wantedEmpButton,#droneWeaponToggle,#desktopDroneWeaponSwitch,dialog,button,input,select,textarea,a,label";
function isDrone(){return globalThis.__arondightWalkMode?.mode!=="foot"&&!globalThis.__arondightVehicleDrive?.active&&!globalThis.__jetMode?.active;}
// taps / clicks in the view while the guided missile is selected: mark, then launch (before the rocket-salvo handler sees them)
function onPointer(e){if(e.type!=="pointerdown"||e.button!==0||!isDrone()||document.body.classList.contains("air-strike-targeting"))return;if(String(globalThis.__arondightDroneWeapons?.displayMode||"")!=="guided")return;const t=e.target instanceof Element?e.target:null;if(t?.closest?.(BLOCKED))return;e.preventDefault();e.stopImmediatePropagation();
  const locked=Boolean(document.pointerLockElement);press({clientX:locked?undefined:e.clientX,clientY:locked?undefined:e.clientY,source:e.pointerType||"pointer"});}
let last=performance.now();
// reload state on every weapon control (touch button, desktop GUIDED segment, pad dock) and, after a
// press that came too early, right under the crosshair
let cdEl=null,cdShown="";
function renderCooldown(now){const mode=String(globalThis.__arondightDroneWeapons?.displayMode||""),active=mode==="guided"&&isDrone(),left=cooldownLeftMs(now),frac=left/COOLDOWN_MS,b=document.body;
  const key=active?(left>0?Math.ceil(left/100):0):-1;if(key===cdShown)return;cdShown=key;b.style.setProperty("--guided-cd",active?frac.toFixed(3):"0");b.classList.toggle("guided-reloading",active&&left>0);
  for(const el of document.querySelectorAll('#droneWeaponToggle,#mobileGameplayWeapon,[data-drone-weapon="guided"]')){if(active&&left>0)el.dataset.guidedCd=`${(left/1000).toFixed(1)} s`;else delete el.dataset.guidedCd;}
  const v=viewport();if(!v)return;if(!cdEl?.isConnected){cdEl=document.createElement("div");cdEl.id="guidedCooldownNear";v.appendChild(cdEl);const st=document.createElement("style");st.textContent=`#guidedCooldownNear{position:absolute;left:50%;top:calc(50% + 34px);transform:translateX(-50%);padding:3px 9px;border-radius:10px;background:#0b1118d0;border:1px solid #ffb24a;color:#ffe2b8;font:800 11px/1.3 system-ui,sans-serif;letter-spacing:.06em;pointer-events:none;z-index:25;display:none}
body.guided-denied #guidedCooldownNear{display:block}
body.guided-reloading #droneWeaponToggle,body.guided-reloading #mobileGameplayWeapon,body.guided-reloading [data-drone-weapon="guided"]{background-image:linear-gradient(90deg,#ffb24a55 calc((1 - var(--guided-cd,0))*100%),transparent 0)!important}
#droneWeaponToggle[data-guided-cd]::after,#mobileGameplayWeapon[data-guided-cd]::before,[data-drone-weapon="guided"][data-guided-cd]::after{content:" ⏳" attr(data-guided-cd);font-weight:700;opacity:.85}`;document.head.appendChild(st);}
  cdEl.textContent=left>0?`LENKRAKETE LÄDT · ${(left/1000).toFixed(1)} s`:"LENKRAKETE BEREIT";}
function frame(now=performance.now()){requestAnimationFrame(frame);const dt=Math.min(.05,(now-last)/1000);last=now;if(missiles.length)step(now,dt);stepSmoke(now);try{renderCooldown(now);}catch{}
  const mode=String(globalThis.__arondightDroneWeapons?.displayMode||"");if(lock&&(mode!=="guided"||globalThis.__arondightWalkMode?.mode==="foot"))clearLock("mode");renderLock(now);}
export function installGuidedMissile(){if(installed||typeof window==="undefined")return;installed=true;addEventListener("arondight:world-reset",()=>{clearLock("reset");for(const m of missiles.splice(0)){m.scene.remove(m.group);stopVoice(m.voice);}});window.addEventListener("pointerdown",onPointer,{capture:true,passive:false});requestAnimationFrame(frame);globalThis.__arondightGuidedMissile={press,get cooldownLeftMs(){return cooldownLeftMs();},get lock(){return lock?{id:lock.id,kind:lock.kind,label:lock.label}:null;},get inFlight(){return missiles.length;},clear:()=>clearLock("api"),version:GUIDED_MISSILE_VERSION};}
installGuidedMissile();
