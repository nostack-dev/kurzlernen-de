import * as THREE from "three";
import {createCrowd} from "./crowd_characters.mjs";
import {OUTFITS} from "./character_model.mjs";
import {wantedPointInRing} from "./wanted_system_logic.mjs";
import {groundHeightAt} from "./terrain_craters.mjs";
import {spawnWorldPersonRagdoll} from "./world_person_ragdoll.mjs";
import {getSharedCombatAudioContext,playCombatAudio} from "./combat_audio_bank.mjs";
import {VS_FX_EVENT} from "./lan_vs.mjs";
import {worldOption,WORLD_OPTIONS_EVENT} from "./world_options.mjs";

// Zombie nights (CoD Zombies in the open sandbox). When night falls the dead
// rise in rounds around the player and shamble (later: sprint) after him.
// Buildings are shelters: every door carries a barricade of planks; zombies
// must smash them plank by plank before the door swings open for them. The
// player earns points for every hit and kill and spends them to nail planks
// back (REPAIR near a door). At dawn the dead collapse. Nothing is locked —
// fight in the street, hold a shop, fly away with the drone, nuke them.
// Multiplayer: each player's horde is simulated by that player and sent as
// snapshots; the others see and shoot the same zombies (hits forwarded).

export const ZOMBIE_NIGHTS_VERSION="cod-zombie-nights-v1";
const CAP=28,REMOTE_CAP=28,HP0=100,HIT_DMG=34,MELEE_DMG=14,MELEE_MS=1150,PLANK_MS=1500,REPAIR_COST=10,HIT_PTS=10,KILL_PTS=60,SPAWN_MIN=34,SPAWN_MAX=70,SYNC_MS=120;
const ZCOL=[0x8a9a78,0x7d8c70,0x93a183,0x6f7e66].map((skin,i)=>({shirt:[0x5d5a4a,0x4b4d43,0x6a5c4a,0x3f4a4f][i],vest:0x3b3428,pants:[0x2f2c28,0x3a3530,0x262a2e,0x40382e][i],boots:0x1f1b18,skin,gloves:skin,helmet:0x2b2620,dark:0x111111}));
const bridge=()=>globalThis.__arondightRealWorld||null,viewport=()=>document.getElementById("viewport"),interiors=()=>globalThis.__buildingInteriors||null;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),angleTo=(a,b)=>{let d=b-a;while(d>Math.PI)d-=2*Math.PI;while(d<-Math.PI)d+=2*Math.PI;return d;};

let sceneRef=null,root=null,crowd=null,remoteCrowd=null,zombies=[],active=false,round=0,toSpawn=0,nextSpawn=0,roundBreakUntil=0,points=0,lastFrame=performance.now(),lastSync=0,serial=0,proxyGeo=null,proxyMat=null;
const remote=new Map();

function playerTarget(){const t=globalThis.__arondightPlayerVitals?.damageTargets?.()?.find(x=>x.kind==="player");return t&&Number(t.hp)>0?t:null;}
function prisms(){return bridge()?.buildingCollisionSnapshot?.prisms||[];}
function insideBuilding(x,y){for(const pr of prisms()){const pts=pr.points;if(!pts||pts.length<3||(Number(pr.base)||0)>1.9)continue;if(Math.abs(x-pts[0][0])>120||Math.abs(y-pts[0][1])>120)continue;if(wantedPointInRing(x,y,pts))return true;}return false;}
function isNight(){return Boolean(globalThis.__dayNight?.state?.isNight);}

// ------------------------------------------------------------ scene
function ensureScene(){const scene=bridge()?.threeScene;if(!scene)return false;if(scene===sceneRef&&root?.parent===scene)return true;root?.parent?.remove(root);crowd?.dispose?.();remoteCrowd?.dispose?.();sceneRef=scene;root=new THREE.Group();root.name="ZOMBIE_NIGHTS";scene.add(root);
  crowd=createCrowd(scene,{capacity:CAP,outfit:"zombie",name:"ZOMBIES"});remoteCrowd=createCrowd(scene,{capacity:REMOTE_CAP,outfit:"zombie",name:"ZOMBIES_REMOTE"});for(let i=0;i<CAP;i++)crowd.setColors(i,ZCOL[i%4]);for(let i=0;i<REMOTE_CAP;i++)remoteCrowd.setColors(i,ZCOL[i%4]);zombies=[];return true;}
function proxy(){proxyGeo??=(()=>{const g=new THREE.CapsuleGeometry(.28,1.2,3,8);g.rotateX(Math.PI/2);g.translate(0,0,.86);return g;})();proxyMat??=Object.assign(new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false}),{colorWrite:false,visible:false});const m=new THREE.Mesh(proxyGeo,proxyMat);m.name="ZOMBIE_HIT_PROXY";m.userData.hitProxy=true;m.userData.worldPopulationKind="enemy";m.userData.styleSkip=true;root.add(m);return m;}

// ------------------------------------------------------------ HUD
function hud(){
  let h=document.getElementById("zombieHud");if(h)return h;const view=viewport();if(!view)return null;h=document.createElement("div");h.id="zombieHud";h.innerHTML=`<div class="zh-round"></div><div class="zh-points"></div><div class="zh-banner"></div><button id="zombieRepair" type="button">REPAIR · ${REPAIR_COST}</button>`;view.appendChild(h);
  const st=document.createElement("style");st.dataset.zombieHud="v1";st.textContent=`#zombieHud{position:absolute;inset:0;pointer-events:none;z-index:19;font-family:Inter,system-ui,sans-serif;color:#fff}#zombieHud[hidden]{display:none}#zombieHud .zh-round{position:absolute;left:max(14px,var(--solo-safe-left,env(safe-area-inset-left)));bottom:calc(max(16px,var(--solo-safe-bottom,env(safe-area-inset-bottom))) + min(25vw,148px) + 90px);font:900 34px/1 "Barlow Condensed",Inter,sans-serif;color:#b3121b;text-shadow:0 2px 0 #000,0 0 12px #f004;letter-spacing:.04em}#zombieHud .zh-points{position:absolute;right:max(14px,var(--solo-safe-right,env(safe-area-inset-right)));bottom:calc(max(16px,var(--solo-safe-bottom,env(safe-area-inset-bottom))) + min(25vw,148px) + 96px);font:800 20px/1 Inter,sans-serif;color:#f4d27a;text-shadow:0 2px 0 #000}#zombieHud .zh-banner{position:absolute;left:50%;top:22%;transform:translateX(-50%);font:900 28px/1.1 "Barlow Condensed",Inter,sans-serif;letter-spacing:.12em;color:#e8e2d0;text-shadow:0 2px 6px #000;opacity:0;transition:opacity .6s;text-align:center;white-space:nowrap}#zombieHud .zh-banner[data-on="1"]{opacity:1}#zombieRepair{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(max(14px,var(--solo-safe-bottom,env(safe-area-inset-bottom))) + 120px);height:44px;padding:0 18px;border-radius:12px;border:2px solid #f4d27a;background:#1a1408e0;color:#f4d27a;font:900 14px/1 Inter,sans-serif;letter-spacing:.08em;pointer-events:auto;display:none}#zombieRepair[data-show="1"]{display:block}`;document.head.appendChild(st);
  h.querySelector("#zombieRepair").addEventListener("pointerdown",e=>{e.preventDefault();e.stopPropagation();repairNearest();});addEventListener("keydown",e=>{if(e.code==="KeyF"&&!e.repeat&&active){repairNearest();}});return h;
}
let bannerTimer=0;function banner(text,ms=3200){const h=hud();if(!h)return;const b=h.querySelector(".zh-banner");b.textContent=text;b.dataset.on="1";clearTimeout(bannerTimer);bannerTimer=setTimeout(()=>{b.dataset.on="0";},ms);}
function renderHud(){const h=hud();if(!h)return;const show=active||points>0;if(h.hidden===show)h.hidden=!show;h.querySelector(".zh-round").textContent=active?"I".repeat(Math.min(5,round))+(round>5?` ${round}`:""):"";h.querySelector(".zh-points").textContent=`${points}`;
  const d=nearDoor();const btn=h.querySelector("#zombieRepair"),want=active&&d&&d.planks<(interiors()?.PLANKS??6)?"1":"0";if(btn.dataset.show!==want)btn.dataset.show=want;if(want==="1")btn.disabled=points<REPAIR_COST;}
function addPoints(n){points+=n;}

// ------------------------------------------------------------ audio
let lastGroan=0;function groan(z,now){if(now-lastGroan<900)return;const pl=playerTarget()?.position;if(!pl)return;const d=Math.hypot(pl.x-z.x,pl.y-z.y);if(d>30)return;lastGroan=now;try{const c=getSharedCombatAudioContext();if(c?.state==="running")playCombatAudio(c,"scream",{gain:clamp(.25/(1+d*.12),.02,.22),playbackRate:.42+Math.random()*.12,minIntervalMs:400});}catch{}}

// ------------------------------------------------------------ doors / barricades
function nearDoor(){const p=globalThis.__arondightWalkMode?.position;if(!p)return null;let best=null;for(const d of interiors()?.doors?.()||[]){const dd=Math.hypot(p.x-d.cx,p.y-d.cy);if(dd<3.2&&(!best||dd<best.dd))best={...d,dd};}return best;}
function repairNearest(){const d=nearDoor();if(!d||points<REPAIR_COST)return false;if(interiors()?.repairPlank?.(d.i)){points-=REPAIR_COST;renderHud();try{const c=getSharedCombatAudioContext();if(c?.state==="running")playCombatAudio(c,"bounce",{gain:.4,playbackRate:.7});}catch{}return true;}return false;}
function doorFor(z){let best=null;for(const d of interiors()?.doors?.()||[]){const dd=Math.hypot(z.x-d.cx,z.y-d.cy);if(!best||dd<best.dd)best={...d,dd};}return best;}

// ------------------------------------------------------------ zombies
// the dead rise only where no player sees it happen (out of every view, or behind a building);
// if no such place is found this time, the next attempt comes with the next spawn interval
function unseen(x,y,z){const g=globalThis.__spawnVisibilityGuard;return g?.canSpawnAt?g.canSpawnAt(x,y,z,{heightM:1.9}):true;}
function spawnOne(player,now){
  for(let k=0;k<14;k++){const a=Math.random()*Math.PI*2,r=SPAWN_MIN+Math.random()*(SPAWN_MAX-SPAWN_MIN),x=player.position.x+Math.cos(a)*r,y=player.position.y+Math.sin(a)*r;if(insideBuilding(x,y)||interiors()?.insideActive?.(x,y))continue;
    if(!unseen(x,y,groundHeightAt(x,y)))continue;
    const fast=round>=3&&Math.random()<Math.min(.55,.12*(round-2));const slot=freeSlot();if(slot<0)return false;
    zombies.push({id:`z${(++serial).toString(36)}`,slot,x,y,z:groundHeightAt(x,y),yaw:Math.atan2(player.position.y-y,player.position.x-x),hp:HP0+round*12,speed:fast?3+Math.random()*1.1:.85+Math.random()*.7+round*.06,state:"chase",nextHit:0,nextPlank:0,inside:false,proxy:proxy(),born:now,anim:"zombie",sp:0});return true;}
  return false;
}
function freeSlot(){const used=new Set(zombies.map(z=>z.slot));for(let i=0;i<CAP;i++)if(!used.has(i))return i;return -1;}
function moveToward(z,tx,ty,dt,{indoor=false}={}){
  const dx=tx-z.x,dy=ty-z.y,d=Math.hypot(dx,dy);if(d<.05){z.sp=0;return d;}const step=Math.min(d,z.speed*dt);let ang=Math.atan2(dy,dx);
  if(indoor){const I=interiors(),feet=z.z;const r=I?.resolveMove?.({x:z.x,y:z.y},{x:z.x+Math.cos(ang)*step,y:z.y+Math.sin(ang)*step},feet);const nx=r?.x??z.x+Math.cos(ang)*step,ny=r?.y??z.y+Math.sin(ang)*step;z.sp=Math.hypot(nx-z.x,ny-z.y)/Math.max(dt,1e-3);z.x=nx;z.y=ny;const h=I?.feetHeightAt?.(z.x,z.y,feet);z.z=Number.isFinite(h)?h:groundHeightAt(z.x,z.y);}
  else{// wall following (bug algorithm): when the straight way is blocked, keep
    // turning to one committed side along the wall until the way is free again
    const free=(a)=>{const nx=z.x+Math.cos(a)*Math.max(step,.35),ny=z.y+Math.sin(a)*Math.max(step,.35);return!insideBuilding(nx,ny)&&!(interiors()?.insideActive?.(nx,ny)&&!z.entering);};
    let ok=false,used=0;if(free(ang)&&(!z.side||free(ang+z.side*.35))){ok=true;if(z.side&&(z.freeSince||=performance.now())&&performance.now()-z.freeSince>600){z.side=0;}}
    else{z.freeSince=0;z.side||=(Math.random()<.5?1:-1);for(let pass=0;pass<2&&!ok;pass++){for(let k=1;k<=9;k++){const a=ang+z.side*k*.35;if(free(a)){ang=a;ok=true;used=k;break;}}if(!ok)z.side=-z.side;}}
    if(ok){z.x+=Math.cos(ang)*step;z.y+=Math.sin(ang)*step;}z.sp=ok?step/Math.max(dt,1e-3):0;z.z=groundHeightAt(z.x,z.y);}
  z.yaw+=angleTo(z.yaw,ang)*Math.min(1,dt*8);return d;
}
function stepZombie(z,player,now,dt){
  const I=interiors(),pIn=Boolean(I?.playerInside?.()),px=player.position.x,py=player.position.y;z.anim="zombie";
  if(z.entering&&z.enterAt){const ix=z.enterAt[0],iy=z.enterAt[1],dd=Math.hypot(ix-z.x,iy-z.y),st=Math.min(dd,Math.max(1.2,z.speed)*dt);z.state="enter";if(dd>1e-3){z.x+=(ix-z.x)/dd*st;z.y+=(iy-z.y)/dd*st;z.yaw+=angleTo(z.yaw,Math.atan2(iy-z.y,ix-z.x))*Math.min(1,dt*8);}z.sp=st/Math.max(dt,1e-3);const h=I?.feetHeightAt?.(z.x,z.y,z.z);z.z=Number.isFinite(h)?h:groundHeightAt(z.x,z.y);if(dd<.25){z.entering=false;z.enterAt=null;z.inside=Boolean(I?.insideActive?.(z.x,z.y));}}
  else if(pIn&&!z.inside){const d=doorFor(z);if(d){const ox=d.cx+d.nx*1.15,oy=d.cy+d.ny*1.15;const dist=moveToward(z,ox,oy,dt);
      if(dist<.9){z.yaw+=angleTo(z.yaw,Math.atan2(-d.ny,-d.nx))*Math.min(1,dt*8);
        if(d.planks>0){z.state="breach";z.sp=0;if(now>=z.nextPlank){z.nextPlank=now+PLANK_MS*(.8+Math.random()*.5);I.damagePlank?.(d.i);z.swing=now;}}
        else{z.state="enter";z.entering=true;z.enterAt=[d.cx-d.nx*1.8,d.cy-d.ny*1.8];}}
      else z.state="chase";}else moveToward(z,px,py,dt);}
  else if(z.inside){z.state="chase";if(!I?.insideActive?.(z.x,z.y)){z.inside=false;}else moveToward(z,px,py,dt,{indoor:true});}
  else moveToward(z,px,py,dt);
  // melee
  const dd=Math.hypot(px-z.x,py-z.y),dz=Math.abs(((player.position.z||1.68)-1.68)-z.z);
  if(dd<1.35&&dz<1.3){z.state="attack";if(now>=z.nextHit){z.nextHit=now+MELEE_MS;z.swing=now;const t=playerTarget();t?.model?.damage?.(MELEE_DMG,"zombie");window.dispatchEvent(new CustomEvent("arondight:combat-damage",{detail:{damage:MELEE_DMG,source:"zombie",target:"player"}}));}}
  if(Math.random()<dt*.25)groan(z,now);
}
function killZombie(z,dir=null,award=true,{silent=false}={}){
  const i=zombies.indexOf(z);if(i<0)return;zombies.splice(i,1);z.proxy.parent?.remove(z.proxy);if(award)addPoints(KILL_PTS);if(silent)return;
  spawnWorldPersonRagdoll({position:[z.x,z.y,z.z+.05],yaw:z.yaw-Math.PI/2,impulse:dir?[dir.x*2.4,dir.y*2.4,1.6]:[0,0,.8],seed:z.id,id:z.id,colors:ZCOL[z.slot%4]});
}

// ------------------------------------------------------------ hits in
function findZombie(hit){for(let n=hit?.object;n;n=n.parent){if(n.name!=="ZOMBIE_HIT_PROXY")continue;for(const z of zombies)if(z.proxy===n)return{z};for(const[peer,r]of remote)for(const rz of r.list)if(rz.proxy===n)return{peer,rz};}return null;}
function hit(h){const f=findZombie(h);if(!f)return false;window.dispatchEvent(new CustomEvent("arondight:combat-hit-confirm",{detail:{police:true,damage:HIT_DMG,zombie:true}}));
  if(f.peer){sendFx({kind:"zombie-hit",to:f.peer,zid:f.rz.id,dmg:HIT_DMG});addPoints(HIT_PTS);return true;}
  const z=f.z,pl=playerTarget()?.position;z.hp-=HIT_DMG;addPoints(HIT_PTS);if(z.hp<=0)killZombie(z,pl?new THREE.Vector3(z.x-pl.x,z.y-pl.y,0).normalize():null);return true;}
function onExplosion(e){const d=e?.detail||{},pos=d.position,x=Array.isArray(pos)?+pos[0]:+pos?.x,y=Array.isArray(pos)?+pos[1]:+pos?.y;if(!Number.isFinite(x))return;const r=d.kind==="nuke"?600:Math.max(3,Math.min(40,Number(d.radiusM)||6));
  for(const z of [...zombies]){const dd=Math.hypot(z.x-x,z.y-y);if(dd<r){z.hp-=d.kind==="nuke"?999:220*(1-dd/r)+30;if(z.hp<=0)killZombie(z,new THREE.Vector3(z.x-x,z.y-y,0).normalize());}}}

// ------------------------------------------------------------ rounds
function startNight(now){active=true;round=0;nextRound(now);banner("DIE NACHT BRICHT HEREIN",3600);}
function nextRound(now){round++;toSpawn=6+round*4;nextSpawn=now+1800;roundBreakUntil=0;banner(`RUNDE ${round}`,2600);}
function endNight(){active=false;for(const z of [...zombies].slice(0,8))killZombie(z,null,false);for(const z of zombies)z.proxy.parent?.remove(z.proxy);zombies=[];if(round)banner(`MORGENGRAUEN — ${round} RUNDEN ÜBERLEBT`,4200);round=0;toSpawn=0;}

// ------------------------------------------------------------ multiplayer
function session(){return bridge()?.vsSession||null;}
function selfId(){try{return String(session()?.getSelfId?.()||"");}catch{return"";}}
function localOffset(){const b=bridge(),o=b?.__vsRespawnLocalOffset;return !b?.active&&Array.isArray(o)&&o.length===2?[Number(o[0])||0,Number(o[1])||0]:[0,0];}
function sendFx(extra){const s=session();if(!s?.sendFx)return false;try{return s.sendFx({type:"impact",objectId:"zombies",p:[0,0,0],id:`zb-${Date.now().toString(36)}-${(serial++).toString(36)}`,playerId:selfId()||undefined,...extra});}catch{return false;}}
function broadcast(now){if(now-lastSync<SYNC_MS)return;lastSync=now;const s=session();const peers=Number(s?.peerCount)||s?.getPeerIds?.()?.length||0;if(!s?.sendFx||!peers)return;const o=localOffset();
  sendFx({kind:"zombie-sync",list:zombies.map(z=>[z.id,+(z.x+o[0]).toFixed(2),+(z.y+o[1]).toFixed(2),+z.z.toFixed(2),+z.yaw.toFixed(2),z.state==="attack"||z.state==="breach"?1:0,+z.sp.toFixed(1)])});}
function onFx(e){const pk=e?.detail?.packet,peer=String(e?.detail?.peerId||pk?.playerId||"");if(pk?.objectId!=="zombies")return;
  if(pk.kind==="zombie-hit"){if(pk.to&&pk.to!==selfId())return;const z=zombies.find(q=>q.id===pk.zid);if(z){z.hp-=Number(pk.dmg)||HIT_DMG;if(z.hp<=0)killZombie(z,null,false);}return;}
  if(pk.kind!=="zombie-sync"||!Array.isArray(pk.list)||!peer||!zombiesEnabled)return;ensureScene();let r=remote.get(peer);if(!r){r={list:[],seen:0};remote.set(peer,r);}r.seen=performance.now();const o=localOffset(),keep=new Map(r.list.map(z=>[z.id,z]));
  r.list=pk.list.slice(0,REMOTE_CAP).map(([id,x,y,z,yaw,att,sp])=>{let q=keep.get(id);if(!q)q={id,x:x-o[0],y:y-o[1],z,yaw,proxy:proxy()};keep.delete(id);Object.assign(q,{tx:x-o[0],ty:y-o[1],tz:z,tyaw:yaw,att,sp});return q;});for(const q of keep.values())q.proxy.parent?.remove(q.proxy);}
function renderRemote(now,dt){if(!remoteCrowd)return;const a=1-Math.exp(-dt*10);for(const[peer,r]of remote){if(now-r.seen>2500){for(const q of r.list)q.proxy.parent?.remove(q.proxy);remote.delete(peer);continue;}
    for(const q of r.list){q.x+=(q.tx-q.x)*a;q.y+=(q.ty-q.y)*a;q.z+=(q.tz-q.z)*a;q.yaw+=angleTo(q.yaw,q.tyaw)*a;remoteCrowd.set(remoteIndex(q),{x:q.x,y:q.y,z:q.z,yaw:q.yaw-Math.PI/2,state:"zombie",speed:Math.max(.4,q.sp),dt});q.proxy.position.set(q.x,q.y,q.z);q.proxy.updateMatrixWorld();}}
  remoteCrowd.commit();}
const remoteIdx=new Map();let remoteNext=0;function remoteIndex(q){let i=remoteIdx.get(q.id);if(i===undefined){i=remoteNext++%REMOTE_CAP;remoteIdx.set(q.id,i);if(remoteIdx.size>400)remoteIdx.delete(remoteIdx.keys().next().value);}return i;}

// ------------------------------------------------------------ world option
// zombies switched off: none exist (no bodies, no AI, no draw, no night rounds); switched back on,
// the next night (or this one) brings them in out of view like always
let zombiesEnabled=worldOption("zombies");
function removeAllZombies(){for(const z of zombies)z.proxy.parent?.remove(z.proxy);zombies=[];for(const r of remote.values())for(const q of r.list)q.proxy.parent?.remove(q.proxy);remote.clear();active=false;round=0;toSpawn=0;roundBreakUntil=0;crowd?.commit();remoteCrowd?.commit();}
function onWorldOptions(){const on=worldOption("zombies");if(on===zombiesEnabled)return;zombiesEnabled=on;if(!on)removeAllZombies();}

// ------------------------------------------------------------ loop
let lastUi=0;
function frame(now=performance.now()){
  requestAnimationFrame(frame);const dt=Math.min(.1,Math.max(0,(now-lastFrame)/1000));lastFrame=now;if(!ensureScene())return;
  if(!zombiesEnabled){if(active||zombies.length||remote.size)removeAllZombies();if(now-lastUi>200){lastUi=now;renderHud();}return;}
  const night=isNight()||Boolean(globalThis.__zombieForce);if(night&&!active)startNight(now);else if(!night&&active)endNight();
  const player=playerTarget();
  if(active&&player){
    if(toSpawn>0&&now>=nextSpawn&&zombies.length<CAP){if(spawnOne(player,now))toSpawn--;nextSpawn=now+Math.max(350,1100-round*60);}
    if(toSpawn<=0&&!zombies.length){if(!roundBreakUntil){roundBreakUntil=now+9000;banner(`RUNDE ${round} ÜBERSTANDEN`,2400);}else if(now>roundBreakUntil)nextRound(now);}
    for(const z of zombies)stepZombie(z,player,now,dt);
    // far stragglers drop out (the round keeps its pressure) - only where nobody sees them go
    for(const z of [...zombies]){const d=Math.hypot(player.position.x-z.x,player.position.y-z.y);if(d>140&&unseen(z.x,z.y,z.z)){killZombie(z,null,false,{silent:true});toSpawn++;}}
    for(const z of [...zombies])if(z.hp<=0)killZombie(z,null,false);
  }
  for(const z of zombies){const st=z.state==="attack"||z.state==="breach"?"zombie":"zombie";crowd.set(z.slot,{x:z.x,y:z.y,z:z.z,yaw:z.yaw-Math.PI/2,state:st,speed:Math.max(.5,z.sp),lean:z.swing&&now-z.swing<300?.25:0,dt});z.proxy.position.set(z.x,z.y,z.z);z.proxy.updateMatrixWorld();}
  crowd.commit();renderRemote(now,dt);broadcast(now);
  if(now-lastUi>200){lastUi=now;renderHud();const v=viewport();if(v)v.dataset.zombies=`${active?"night":"day"}/r${round}/${zombies.length}z/${points}p`;}
}
export function installZombieNights(){if(globalThis.__zombies||typeof window==="undefined")return globalThis.__zombies;
  addEventListener("arondight:world-explosion",onExplosion);addEventListener(VS_FX_EVENT,onFx);addEventListener(WORLD_OPTIONS_EVENT,onWorldOptions);addEventListener("arondight:world-reset",()=>{for(const z of zombies)z.proxy.parent?.remove(z.proxy);zombies=[];points=0;if(active){round=0;nextRound(performance.now());}});
  globalThis.__zombies={hit,get active(){return active;},get round(){return round;},get points(){return points;},get list(){return zombies;},atDoor(x,y){return zombies.some(z=>z.entering&&Math.hypot(z.x-x,z.y-y)<2.6);},force(on=true){globalThis.__zombieForce=on;},simulate(seconds=10,dt=.05){const player=playerTarget();if(!player)return 0;let t=performance.now();for(let k=0;k<seconds/dt;k++){t+=dt*1000;for(const z of zombies)stepZombie(z,player,t,dt);}return zombies.length;},version:ZOMBIE_NIGHTS_VERSION};
  requestAnimationFrame(frame);return globalThis.__zombies;}
installZombieNights();
