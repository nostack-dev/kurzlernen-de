import * as THREE from "three";
import {groundHeightAt} from "./terrain_craters.mjs";
import {getSharedCombatAudioContext,playCombatAudio} from "./combat_audio_bank.mjs";
import {AUDIO_SETTINGS_EVENT,loadAudioSettings,normalizeAudioSettings} from "./audio_settings.mjs";
import {addTrauma} from "./camera_shake.mjs";
import {worldOption,WORLD_OPTIONS_EVENT} from "./world_options.mjs";

// RUSH sandbox loop — no story, just a fun escalation:
//  * CHAOS earns SCORE: takedowns, wrecked cars, demolished buildings,
//    police drones, drifting, escaping. Events close together build a
//    COMBO multiplier (FLOW meter); flashy pop texts call them out.
//  * Chaos raises the WANTED level (existing heat system). Every star sends
//    more and tougher enemies ON FOOT on top of the police drones:
//      COP    — fast, light pistol fire, goes down quickly
//      SWAT   — armoured, rifle bursts, keeps distance
//      HEAVY  — slow, rocket launcher (real explosions), very tough
//    They spawn around you, path around buildings, take cover distance and
//    shoot at whatever you are (pilot, car or drone) — line of sight is a
//    real Box3D raycast. Grenades, MG, drone gun, cars and the bomb kill them.
//  * Lose them (stars run out) for an ESCAPE bonus.
// Performance: ≤10 enemies, shared geometry/materials, one pooled tracer
// mesh, no per-frame allocation in the hot loop.

export const SANDBOX_GAME_VERSION="sandbox-chaos-loop-v1";
const TYPES={
  cop:  {hp:3, speed:3.6,range:24,shotMs:900, burst:1,dmg:5, acc:.62,color:0x2f6bff,stripe:0x29e6ff,score:250,scale:1},
  swat: {hp:7, speed:2.9,range:32,shotMs:1700,burst:3,dmg:4, acc:.5, color:0x1c2030,stripe:0xffd23f,score:450,scale:1.08},
  heavy:{hp:14,speed:2.1,range:48,shotMs:3600,burst:1,dmg:0, acc:.0, color:0x7a1430,stripe:0xffb347,score:900,scale:1.22},
};
// relaxed: fewer foot enemies per star and a real gap between arrivals (was 2..10 every 2.4 s)
const BUDGET=[0,1,2,4,6,8],MAX_ENEMIES=8,SPAWN_MS=6000,COMBO_MS=3200;
let installed=false,enemies=[],serial=0,lastSpawn=0,score=0,combo=1,comboUntil=0,flow=0,lastFrame=performance.now(),noWantedSince=0,lastStars=0,lastPoliceKills=0,lastDestructHits=0;
let settings=normalizeAudioSettings(loadAudioSettings()),hud=null,scoreEl=null,comboEl=null,flowEl=null,popLayer=null,sceneRef=null,tracers=null,tracerSlot=0,driftScore=0;
const tmp=new THREE.Vector3(),tmp2=new THREE.Vector3();
const bridge=()=>globalThis.__arondightRealWorld||null;
const walk=()=>globalThis.__arondightWalkMode||null;
const drive=()=>globalThis.__arondightVehicleDrive||null;
const wanted=()=>globalThis.__arondightWantedSystem||null;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number(v)||0));
const rand=(a,b)=>a+Math.random()*(b-a);

// ------------------------------------------------------------------ audio
function sfx(kind,{gain=1,rate=1,at=null}={}){
  if(settings.soundEnabled===false)return;let att=1;const c=bridge()?.threeCamera;if(at&&c)att=clamp(1-c.position.distanceTo(at)/140,.05,1);
  const ctx=getSharedCombatAudioContext();if(ctx)playCombatAudio(ctx,kind,{gain:gain*att*(Number(settings.fxVolume)||70)/100,playbackRate:rate,minIntervalMs:28});
}

// ------------------------------------------------------------------ HUD
function ensureHud(){
  const view=document.getElementById("viewport");if(!view)return false;if(hud?.isConnected)return true;
  hud=document.createElement("div");hud.id="sandboxHud";hud.setAttribute("aria-live","polite");
  hud.innerHTML='<div class="sb-flow"><span>FLOW</span><i><b></b></i><em>x1</em></div><div class="sb-score">0</div><div class="sb-pops"></div>';
  view.appendChild(hud);scoreEl=hud.querySelector(".sb-score");comboEl=hud.querySelector(".sb-flow em");flowEl=hud.querySelector(".sb-flow b");popLayer=hud.querySelector(".sb-pops");
  const style=document.createElement("style");style.dataset.sandboxHud=SANDBOX_GAME_VERSION;style.textContent=`
#sandboxHud{position:absolute;inset:0;z-index:9;pointer-events:none;font-family:"Inter",system-ui,-apple-system,sans-serif}
#sandboxHud .sb-score{position:absolute;left:max(14px,var(--solo-safe-left,env(safe-area-inset-left)));top:calc(max(8px,var(--solo-safe-top,env(safe-area-inset-top))) + 82px);font-weight:700;font-size:clamp(17px,2.6vw,24px);letter-spacing:.08em;color:#f2f4f7;text-shadow:0 1px 3px rgba(0,0,0,.7)}
#sandboxHud .sb-flow{position:absolute;left:max(14px,var(--solo-safe-left,env(safe-area-inset-left)));top:calc(max(8px,var(--solo-safe-top,env(safe-area-inset-top))) + 112px);display:flex;align-items:center;gap:6px;color:#f2f4f7;font-weight:600;font-size:10px;letter-spacing:.18em;text-shadow:0 1px 2px rgba(0,0,0,.6)}
#sandboxHud .sb-flow i{display:block;width:70px;height:4px;border-radius:2px;background:rgba(10,13,18,.5);overflow:hidden;box-shadow:none}
#sandboxHud .sb-flow b{display:block;height:100%;width:0;background:#f5b301;transition:width .15s linear}
#sandboxHud .sb-flow em{font-style:italic;color:#f5b301;font-style:normal;text-shadow:0 1px 2px rgba(0,0,0,.6);min-width:2.2em}
#sandboxHud .sb-pops{position:absolute;left:0;right:0;top:40%;display:flex;flex-direction:column;align-items:center;gap:4px}
#sandboxHud .sb-pop{font-weight:700;font-size:clamp(15px,2.6vw,24px);letter-spacing:.16em;animation:sbPop 1.5s ease-out forwards;white-space:nowrap}
#sandboxHud .sb-pop.pink{color:#f2f4f7;text-shadow:0 1px 4px rgba(0,0,0,.7)}
#sandboxHud .sb-pop.cyan{color:#9fd3ff;text-shadow:0 1px 4px rgba(0,0,0,.7)}
#sandboxHud .sb-pop.red{color:#ff6a5a;text-shadow:0 1px 4px rgba(0,0,0,.7)}
#sandboxHud .sb-pop.gold{color:#f5b301;text-shadow:0 1px 4px rgba(0,0,0,.7)}
@keyframes sbPop{0%{opacity:0;transform:scale(1.25)}10%{opacity:1;transform:scale(1)}75%{opacity:1}100%{opacity:0;transform:translateY(-14px)}}`;
  document.head.appendChild(style);return true;
}
function pop(text,color="pink"){if(!ensureHud())return;const key=String(text).replace(/\s+x\d+$/,"");for(const old of popLayer.children)if(old.dataset.key===key){old.textContent=text;old.style.animation="none";void old.offsetWidth;old.style.animation="";clearTimeout(old._t);old._t=setTimeout(()=>old.remove(),1550);return;}const el=document.createElement("div");el.dataset.key=key;el.className=`sb-pop ${color}`;el.textContent=text;popLayer.appendChild(el);while(popLayer.children.length>2)popLayer.firstChild.remove();el._t=setTimeout(()=>el.remove(),1550);}
export function award(points,label,color){
  const now=performance.now();if(now<comboUntil)combo=Math.min(8,combo+1);else combo=1;comboUntil=now+COMBO_MS;flow=Math.min(1,flow+.18);
  const gained=Math.round(points*combo);score+=gained;if(label)pop(combo>1?`${label}  x${combo}`:label,color);renderHud(true);
  const v=document.getElementById("viewport");if(v){v.dataset.sandboxScore=String(score);v.dataset.sandboxCombo=String(combo);}return gained;
}
let shownScore=-1;
function renderHud(force=false){if(!ensureHud())return;if(force||shownScore!==score){shownScore=score;scoreEl.textContent=score.toLocaleString("de-DE");}comboEl.textContent=`x${combo}`;flowEl.style.width=`${Math.round(flow*100)}%`;}

// ------------------------------------------------------------------ enemies
let geo=null;
function geometries(){if(geo)return geo;geo={body:new THREE.CylinderGeometry(.28,.34,1.15,8),legs:new THREE.CylinderGeometry(.22,.18,.8,8),head:new THREE.SphereGeometry(.2,10,8),gun:new THREE.BoxGeometry(.1,.62,.1),tube:new THREE.CylinderGeometry(.13,.13,1.1,10),stripe:new THREE.TorusGeometry(.31,.035,6,16)};for(const g of[geo.body,geo.legs,geo.tube])g.rotateX(Math.PI/2);geo.stripe.rotateX(0);return geo;}
const materials=new Map();
function mat(color,basic=false){const key=`${color}-${basic}`;let m=materials.get(key);if(!m){m=basic?new THREE.MeshBasicMaterial({color,toneMapped:false}):new THREE.MeshLambertMaterial({color});materials.set(key,m);}return m;}
function buildEnemy(type){
  const t=TYPES[type],G=geometries(),root=new THREE.Group(),id=`enemy-${++serial}`;
  const tag=n=>{n.userData.worldPopulationKind="enemy";n.userData.worldPopulationId=id;n.userData.sandboxEnemyId=id;n.userData.worldLifeKind="person";return n;};
  const legs=tag(new THREE.Mesh(G.legs,mat(0x14121f)));legs.position.z=.4;
  const body=tag(new THREE.Mesh(G.body,mat(t.color)));body.position.z=1.15;
  const stripe=tag(new THREE.Mesh(G.stripe,mat(t.stripe,true)));stripe.position.z=1.42;
  const head=tag(new THREE.Mesh(G.head,mat(type==="swat"?0x101018:0xe0b394)));head.position.z=1.92;
  const visor=tag(new THREE.Mesh(new THREE.BoxGeometry(.26,.1,.06),mat(t.stripe,true)));visor.position.set(.17,0,1.95);visor.rotation.z=Math.PI/2;
  const gun=tag(new THREE.Mesh(type==="heavy"?G.tube:G.gun,mat(0x1a1a22)));gun.position.set(.36,-.18,1.3);if(type!=="heavy")gun.rotation.z=Math.PI/2;else{gun.rotation.z=Math.PI/2;gun.position.z=1.62;}
  root.add(legs,body,stripe,head,visor,gun);root.scale.setScalar(t.scale);tag(root);root.name=`SANDBOX_${type.toUpperCase()}`;
  return{id,type,t,root,hp:t.hp,state:"approach",yaw:0,nextShot:performance.now()+rand(900,1800),burstLeft:0,deadAt:0,strafe:Math.random()<.5?-1:1,stuck:0};
}
function insideBuilding(x,y){
  const prisms=bridge()?.buildingCollisionSnapshot?.prisms||[];for(const p of prisms){const pts=p.points;if(!pts||pts.length<3||p.leveled)continue;let inside=false;for(let i=0,j=pts.length-1;i<pts.length;j=i++){const xi=+pts[i][0],yi=+pts[i][1],xj=+pts[j][0],yj=+pts[j][1];if(((yi>y)!==(yj>y))&&x<(xj-xi)*(y-yi)/((yj-yi)||1e-9)+xi)inside=!inside;}if(inside)return true;}return false;
}
function target(){
  const list=globalThis.__arondightPlayerVitals?.damageTargets?.()||[],droneMode=walk()?.mode!=="foot"&&!drive()?.active&&!globalThis.__jetMode?.active;
  return list.find(t=>t.kind===(droneMode?"drone":"player"))||list[0]||null;
}
// cops and SWAT are police, the rocket-carrying heavy is military: a kind switched off in the world
// options does not come at all
function typeAllowed(type){return type==="heavy"?worldOption("military"):worldOption("police");}
function dropDisallowed(){for(let i=enemies.length-1;i>=0;i--){const e=enemies[i];if(typeAllowed(e.type))continue;e.root.parent?.remove(e.root);enemies.splice(i,1);}}
function spawnEnemy(type,center){
  const scene=bridge()?.threeScene;if(!scene||!typeAllowed(type))return null;const guard=globalThis.__spawnVisibilityGuard;
  // they come in where nobody sees them appear (out of view or behind buildings); none found: retry next interval
  for(let attempt=0;attempt<10;attempt++){const a=Math.random()*Math.PI*2,d=rand(55,85),x=center.x+Math.cos(a)*d,y=center.y+Math.sin(a)*d;if(insideBuilding(x,y))continue;if(guard?.canSpawnAt&&!guard.canSpawnAt(x,y,groundHeightAt(x,y),{heightM:2.2}))continue;
    const e=buildEnemy(type);e.root.position.set(x,y,groundHeightAt(x,y));scene.add(e.root);enemies.push(e);return e;}
  return null;
}
function lineOfSight(from,to){const rb=globalThis.__arondightWorldRigidBodies;if(!rb?.raycast)return true;const d=[to.x-from.x,to.y-from.y,to.z-from.z],len=Math.hypot(...d);if(len<1)return true;const hit=rb.raycast([from.x,from.y,from.z],d,len-1.2);return!hit||hit.kind!=="terrain";}
function ensureTracers(scene){
  if(tracers?.parent===scene)return tracers;const positions=new Float32Array(24*6),colors=new Float32Array(24*6);
  const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.BufferAttribute(positions,3));g.setAttribute("color",new THREE.BufferAttribute(colors,3));
  tracers=new THREE.LineSegments(g,new THREE.LineBasicMaterial({vertexColors:true,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false}));tracers.frustumCulled=false;tracers.userData.styleSkip=true;tracers.userData.flightFireIgnore=true;tracers.raycast=()=>{};tracers.life=new Float32Array(24);scene.add(tracers);return tracers;
}
function tracer(from,to,color){const tr=ensureTracers(bridge().threeScene),i=tracerSlot++%24,p=tr.geometry.attributes.position.array,c=tr.geometry.attributes.color.array,col=new THREE.Color(color);p.set([from.x,from.y,from.z,to.x,to.y,to.z],i*6);c.set([col.r,col.g,col.b,col.r*.4,col.g*.4,col.b*.4],i*6);tr.life[i]=.09;tr.geometry.attributes.position.needsUpdate=true;tr.geometry.attributes.color.needsUpdate=true;}
function stepTracers(dt){if(!tracers)return;let dirty=false;const c=tracers.geometry.attributes.color.array;for(let i=0;i<24;i++){if(tracers.life[i]<=0)continue;tracers.life[i]-=dt;if(tracers.life[i]<=0){c.fill(0,i*6,i*6+6);dirty=true;}}if(dirty)tracers.geometry.attributes.color.needsUpdate=true;}

// Rockets (HEAVY): slow visible projectile, real explosion on impact.
const rockets=[];let rocketGeo=null;
function fireRocket(e,from,to){
  const scene=bridge()?.threeScene;if(!scene)return;rocketGeo??=new THREE.SphereGeometry(.22,8,6);const m=new THREE.Mesh(rocketGeo,mat(0xffb347,true));m.position.copy(from);m.userData.flightFireIgnore=true;m.userData.styleSkip=true;scene.add(m);
  const dir=tmp.copy(to).sub(from);const dist=dir.length();dir.normalize();rockets.push({mesh:m,v:dir.clone().multiplyScalar(26),life:dist/26+.2});sfx("shot",{gain:.9,rate:.6,at:from});
}
function stepRockets(dt){
  for(let i=rockets.length-1;i>=0;i--){const r=rockets[i];r.mesh.position.addScaledVector(r.v,dt);r.life-=dt;const p=r.mesh.position,ground=groundHeightAt(p.x,p.y);
    const t=target();const near=t&&Math.hypot(p.x-t.position.x,p.y-t.position.y,p.z-t.position.z)<1.6;
    if(r.life<=0||p.z<=ground+.15||near||insideBuilding(p.x,p.y)){
      window.dispatchEvent(new CustomEvent("arondight:world-explosion",{detail:{position:[p.x,p.y,Math.max(ground+.2,p.z)],radiusM:6,maxDamage:90,kind:"enemy-rocket",source:"sandbox-heavy"}}));
      if(t){const d=Math.hypot(p.x-t.position.x,p.y-t.position.y,p.z-t.position.z);if(d<6)t.model?.damage?.(Math.round(38*(1-d/6))+6,"enemy:heavy-rocket");}
      sfx("explosion",{gain:1,at:p});r.mesh.parent?.remove(r.mesh);rockets.splice(i,1);}}
}
function shoot(e,now){
  const t=target();if(!t)return;const from=tmp2.copy(e.root.position);from.z+=1.45*e.t.scale;const to=new THREE.Vector3(t.position.x,t.position.y,t.position.z);
  if(!lineOfSight(from,to)){e.nextShot=now+500;return;}
  if(e.type==="heavy"){fireRocket(e,from.clone(),to);return;}
  const dist=from.distanceTo(to),moving=Number(t.speedMps)||Number(drive()?.speedMps)||0,p=clamp(e.t.acc-dist/90-moving*.02,.08,.85),hit=Math.random()<p;
  const miss=hit?to:to.clone().add(new THREE.Vector3(rand(-2.5,2.5),rand(-2.5,2.5),rand(-.6,1.2)));
  tracer(from,miss,e.type==="cop"?0xfff1a8:0xffb347);sfx("shot",{gain:.45,rate:e.type==="cop"?1.35:1.05,at:from});
  if(hit){t.model?.damage?.(e.t.dmg,`enemy:${e.type}`);addTrauma(.12);}
}
function killEnemy(e,how="shot"){
  if(e.state==="dead")return;e.state="dead";e.deadAt=performance.now();
  award(e.t.score,{cop:"TAKEDOWN!",swat:"SWAT DOWN!",heavy:"HEAVY DOWN!!"}[e.type]||"TAKEDOWN!",e.type==="heavy"?"gold":"pink");
  wanted()?.reportCrime?.({id:`${e.id}-kill`,kind:"police-kill",severity:1});sfx("hit",{gain:.8,at:e.root.position});
}
function damageEnemy(e,amount,how){if(e.state==="dead")return false;e.hp-=amount;e.hitFlash=performance.now();if(e.hp<=0)killEnemy(e,how);else if(e.state==="approach")e.nextShot=Math.min(e.nextShot,performance.now()+350);return true;}
function enemyFromObject(object){for(let n=object;n;n=n.parent){const id=n.userData?.sandboxEnemyId;if(id)return enemies.find(e=>e.id===id)||null;}return null;}
// Hits from every weapon go through the bridge; ours are handled here first.
function wrapHits(){
  const b=bridge();if(!b||typeof b.registerWorldPopulationHit!=="function"||b.registerWorldPopulationHit.__sandbox)return;
  const original=b.registerWorldPopulationHit.bind(b);const wrapped=hit=>{const e=enemyFromObject(hit?.object);if(e)return damageEnemy(e,1,"shot")||true;return original(hit);};wrapped.__sandbox=true;b.registerWorldPopulationHit=wrapped;
}
function onExplosion(event){
  const d=event?.detail||{};if(d.source==="sandbox-heavy")return;const p=d.position;const x=Array.isArray(p)?+p[0]:+p?.x,y=Array.isArray(p)?+p[1]:+p?.y;if(!Number.isFinite(x))return;const r=clamp(d.radiusM??6,2,400);
  for(const e of enemies){if(e.state==="dead")continue;const dist=Math.hypot(e.root.position.x-x,e.root.position.y-y);if(dist<r)damageEnemy(e,d.kind==="nuke"?999:Math.ceil(12*(1-dist/r))+1,"explosion");}
}
function stepEnemy(e,dt,now,t){
  const pos=e.root.position;
  if(e.state==="dead"){const k=Math.min(1,(now-e.deadAt)/350);e.root.rotation.y=k*Math.PI/2*(e.strafe);if(now-e.deadAt>4000)pos.z-=dt*.6;return now-e.deadAt<6500;}
  if(!t)return true;const dx=t.position.x-pos.x,dy=t.position.y-pos.y,dist=Math.hypot(dx,dy);if(dist>300)return false;
  const want=Math.atan2(dy,dx);let move=0,side=0;
  if(e.state==="retreat"){move=-1;}
  else if(dist>e.t.range){move=1;}else if(dist<e.t.range*.45){move=-.6;}else{side=e.strafe*.5;if(Math.random()<dt*.25)e.strafe*=-1;}
  // steer: direct, else slide around buildings (try rotated headings)
  let heading=want;if(move<0)heading+=Math.PI;
  const spd=e.t.speed*(move?Math.abs(move):Math.abs(side));
  if(spd>0){let moved=false;const baseH=side&&!move?want+Math.PI/2*Math.sign(side):heading;for(const off of[0,.6,-.6,1.2,-1.2,1.8,-1.8]){const h=baseH+off*(e.strafe||1),nx=pos.x+Math.cos(h)*spd*dt,ny=pos.y+Math.sin(h)*spd*dt;if(!insideBuilding(nx,ny)){pos.x=nx;pos.y=ny;moved=true;break;}}if(!moved)e.stuck+=dt;else e.stuck=0;}
  pos.z=groundHeightAt(pos.x,pos.y);e.yaw=want;e.root.rotation.set(0,0,want);
  // gait bob
  e.root.children[0].rotation.y=Math.sin(now*.012*e.t.speed)*.25*(spd>0?1:0);
  if(e.state!=="retreat"&&dist<e.t.range*1.15&&now>=e.nextShot){shoot(e,now);if(e.burstLeft>0){e.burstLeft--;e.nextShot=now+110;}else{e.burstLeft=e.t.burst-1;e.nextShot=now+e.t.shotMs*rand(.8,1.25);}}
  return true;
}
function chooseType(stars){const r=Math.random(),police=worldOption("police"),military=worldOption("military");if(military&&stars>=4&&(r<.22||!police)&&enemies.filter(e=>e.type==="heavy"&&e.state!=="dead").length<2)return"heavy";if(!police)return null;if(stars>=2&&r<.5)return"swat";return"cop";}

// ------------------------------------------------------------------ chaos sources
function onWorldKill(event){const d=event?.detail||{};if(d.remote||d.network===false)return;const kind=String(d.kind||"");if(kind==="car"||kind==="bus")award(kind==="bus"?220:140,kind==="bus"?"BUS WRECKED!":"CAR WRECKED!","gold");else if(kind!=="police-drone")award(40,null);}
function trackSystems(now,dt){
  const w=wanted()?.state;if(w){
    if(w.policeKills>lastPoliceKills){award(300*(w.policeKills-lastPoliceKills),"COP DRONE DOWN!","cyan");}lastPoliceKills=w.policeKills;
    if(w.stars>lastStars&&w.stars>0)pop(`WANTED ${"★".repeat(w.stars)}`,"red");
    if(lastStars>0&&w.stars===0){award(400*lastStars,"ESCAPED!","cyan");}
    lastStars=w.stars;
  }
  const v=document.getElementById("viewport"),hits=Number(v?.dataset.worldDestructibleHits)||0;if(hits>lastDestructHits){award(150*(hits-lastDestructHits),hits-lastDestructHits>1?"DEMOLITION!":"SMASH!","gold");}lastDestructHits=hits;
  // drifting: sliding the car sideways at speed
  const dv=drive();if(dv?.active&&Math.abs(Number(dv.speedMps)||0)>9){const sliding=document.body.classList.contains("player-driving")&&(Number(v?.dataset.vehicleDriveSteer)||0)!==0&&Math.abs(Number(v?.dataset.vehicleDriveSteer))>.5;if(sliding){driftScore+=dt*60*(Math.abs(dv.speedMps)/12);flow=Math.min(1,flow+dt*.15);}else if(driftScore>60){award(Math.round(driftScore),"DRIFT!","cyan");driftScore=0;}else driftScore=0;}
  flow=Math.max(0,flow-dt*.06);if(now>comboUntil&&combo>1){combo=1;}
}

// ------------------------------------------------------------------ loop
function frame(now){
  requestAnimationFrame(frame);const dt=clamp((now-lastFrame)/1000,0,.1);lastFrame=now;const scene=bridge()?.threeScene;if(!scene)return;
  if(sceneRef!==scene){sceneRef=scene;enemies=[];}
  wrapHits();trackSystems(now,dt);renderHud();
  const w=wanted()?.state,stars=Number(w?.stars)||0,t=target();
  if(stars>0){noWantedSince=0;const alive=enemies.filter(e=>e.state!=="dead"&&e.state!=="retreat").length;if(t&&alive<Math.min(MAX_ENEMIES,BUDGET[Math.min(5,stars)])&&now-lastSpawn>SPAWN_MS){lastSpawn=now;const type=chooseType(stars);if(type)spawnEnemy(type,t.position);}}
  else{noWantedSince||=now;if(now-noWantedSince>2500)for(const e of enemies)if(e.state==="approach")e.state="retreat";}
  for(let i=enemies.length-1;i>=0;i--){const e=enemies[i];let keep=stepEnemy(e,dt,now,t);if(e.state==="retreat"&&t&&Math.hypot(t.position.x-e.root.position.x,t.position.y-e.root.position.y)>120)keep=false;
    // somebody who walked off leaves only where nobody sees it (a corpse has already sunk away)
    if(!keep&&e.state!=="dead"){const g=globalThis.__spawnVisibilityGuard,p=e.root.position;if(g?.canSpawnAt&&!g.canSpawnAt(p.x,p.y,p.z,{farEntryM:600}))keep=true;}if(!keep){e.root.parent?.remove(e.root);enemies.splice(i,1);}}
  stepTracers(dt);stepRockets(dt);
  const v=document.getElementById("viewport");if(v){const s=String(enemies.filter(e=>e.state!=="dead").length);if(v.dataset.sandboxEnemies!==s)v.dataset.sandboxEnemies=s;}
}
export function installSandboxGame(){
  if(installed||typeof window==="undefined")return;installed=true;(globalThis.__prewarmFactories??=[]).push(()=>{const g=new THREE.Group();for(const t of Object.keys(TYPES)){try{g.add(buildEnemy(t).root);}catch{}}return g;});
  window.addEventListener("arondight:world-explosion",onExplosion);
  window.addEventListener(WORLD_OPTIONS_EVENT,dropDisallowed);
  window.addEventListener("arondight:world-kill",onWorldKill);
  window.addEventListener("arondight:nuke-impact",e=>{if(!e?.detail?.remote)setTimeout(()=>award(2000,"MEGA BLAST!!!","gold"),900);});
  window.addEventListener(AUDIO_SETTINGS_EVENT,e=>{settings=normalizeAudioSettings(e?.detail||loadAudioSettings());});
  window.addEventListener("arondight:world-reset",()=>{for(const e of enemies)e.root.parent?.remove(e.root);enemies=[];for(const r of rockets)r.mesh.parent?.remove(r.mesh);rockets.length=0;score=0;combo=1;flow=0;renderHud(true);});
  const v=document.getElementById("viewport");if(v)v.dataset.sandboxGame=SANDBOX_GAME_VERSION;
  globalThis.__skyRushSandbox={award,pop,get score(){return score;},get enemies(){return enemies.map(e=>({id:e.id,type:e.type,hp:e.hp,state:e.state}));},spawn:(type="cop")=>{const t=target();return t?Boolean(spawnEnemy(TYPES[type]?type:"cop",t.position)):false;}};
  requestAnimationFrame(frame);
}
installSandboxGame();
