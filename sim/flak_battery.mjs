// FLAK: now and then a stationary anti-aircraft gun stands somewhere in the city — a four-barrel
// 20 mm mount behind sandbags. It only cares about things in the air: your drone or your jet within
// ~1.1 km and in sight. Then it hoses the sky — four barrels, ~30 rounds a second, tracers every
// round, airbursts around you — with a hard, cracking, thumping sound. Bursts close to you hurt
// (drone and jet take damage); a blast or a sniper round or two put the gun out for good.
//
// Placement is anchored to the real map (700 m geo cells, a hash decides whether a cell has a gun and
// where), so every player finds the same guns. Each client's guns shoot at its own aircraft.
import * as THREE from "three";
import {groundHeightAt} from "./terrain_craters.mjs";
import {getSharedCombatAudioContext} from "./combat_audio_bank.mjs";
import {loadAudioSettings,AUDIO_SETTINGS_EVENT} from "./audio_settings.mjs";

export const FLAK_VERSION="flak-quad-20mm-v1";
const CELL_M=700,CHANCE=.32,RANGE_M=1100,MIN_AGL_M=18,MUZZLE_MPS=900,ROUNDS_PER_S=30,BURST_ON_S=2.6,BURST_OFF_S=1.7,SPREAD=.012,BURST_R=7,TRACER_POOL=180,PUFF_POOL=60,HP=60;
const bridge=()=>globalThis.__arondightRealWorld||null,rigid=()=>globalThis.__arondightWorldRigidBodies||null,walk=()=>globalThis.__arondightWalkMode||null,viewport=()=>document.getElementById("viewport");
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function hash(str){let h=2166136261>>>0;for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}return h>>>0;}
function rand(seed,i){let x=(seed^Math.imul(i+1,0x9e3779b1))>>>0;x^=x>>>16;x=Math.imul(x,0x7feb352d)>>>0;x^=x>>>15;x=Math.imul(x,0x846ca68b)>>>0;x^=x>>>16;return(x>>>0)/4294967296;}
function geoMode(){const b=bridge();return Boolean(b?.active&&Number.isFinite(b.originLon)&&typeof b.unprojectMeters==="function"&&typeof b.projectLngLat==="function");}
function cellOf(x,y){if(!geoMode())return{cx:Math.floor(x/CELL_M),cy:Math.floor(y/CELL_M),lat:0,geo:false};const[lon,lat]=bridge().unprojectMeters(x,y),m=111320;return{cx:Math.floor(lon*m*Math.cos(lat*Math.PI/180)/CELL_M),cy:Math.floor(lat*m/CELL_M),lat,geo:true};}
function cellPoint(c,u,v){if(!c.geo)return[(c.cx+u)*CELL_M,(c.cy+v)*CELL_M];const m=111320,lonM=m*Math.cos(c.lat*Math.PI/180);return bridge().projectLngLat((c.cx+u)*CELL_M/lonM,(c.cy+v)*CELL_M/m);}
function openGround(x,y){if(globalThis.__arondightBuildingAt?.(x,y))return null;const g=groundHeightAt(x,y),R=rigid();if(!R?.raycast)return g;const hit=R.raycast([x,y,g+60],[.0003,.0002,-1],80,{categoryBits:8n,maskBits:1n});if(hit&&hit.point[2]>g+.4)return null;for(const[dx,dy]of[[3,0],[-3,0],[0,3],[0,-3]])if(globalThis.__arondightBuildingAt?.(x+dx,y+dy))return null;return g;}

let installed=false,root=null,sceneRef=null,tracerMesh=null,puffMesh=null,settings=loadAudioSettings();
const guns=new Map(),tracers=[],puffs=[];let tracerCursor=0,puffCursor=0,lastScan=-Infinity,lastFrame=performance.now(),lastTarget=null,targetVel=new THREE.Vector3();
const tmp=new THREE.Vector3(),tmp2=new THREE.Vector3(),dir=new THREE.Vector3(),m4=new THREE.Matrix4(),q=new THREE.Quaternion(),one=new THREE.Vector3(1,1,1),zAxis=new THREE.Vector3(0,0,1),sc=new THREE.Vector3();

function buildGun(){const g=new THREE.Group();g.name="FLAK_QUAD";const olive=new THREE.MeshStandardMaterial({color:0x4b5338,roughness:.7,metalness:.3}),steel=new THREE.MeshStandardMaterial({color:0x2a2d2f,roughness:.45,metalness:.7}),sand=new THREE.MeshStandardMaterial({color:0xb59c6b,roughness:.95});
  for(let i=0;i<14;i++){const a=i/14*Math.PI*2;if(i===3||i===4)continue;const bag=new THREE.Mesh(new THREE.CapsuleGeometry(.28,.7,3,6),sand);bag.rotation.set(Math.PI/2,0,a+Math.PI/2);bag.position.set(Math.cos(a)*2.6,Math.sin(a)*2.6,.3);bag.castShadow=true;g.add(bag);const top=bag.clone();top.position.z=.78;top.rotation.z+=.2;g.add(top);}
  const base=new THREE.Mesh(new THREE.CylinderGeometry(1.1,1.3,.35,16).rotateX(Math.PI/2),olive);base.position.z=.18;g.add(base);
  const yaw=new THREE.Group();yaw.position.z=.35;g.add(yaw);const ped=new THREE.Mesh(new THREE.BoxGeometry(1.2,1.4,.8),olive);ped.position.z=.45;yaw.add(ped);
  const seat=new THREE.Mesh(new THREE.BoxGeometry(.4,.5,.12),steel);seat.position.set(-.5,0,.95);yaw.add(seat);const shield=new THREE.Mesh(new THREE.BoxGeometry(.08,1.9,1.1),olive);shield.position.set(.55,0,1.25);yaw.add(shield);
  const pitch=new THREE.Group();pitch.position.set(.1,0,1.15);yaw.add(pitch);const cradle=new THREE.Mesh(new THREE.BoxGeometry(1.0,.9,.5),steel);pitch.add(cradle);
  const muzzles=[];for(const[y,z]of[[-.28,.17],[.28,.17],[-.28,-.17],[.28,-.17]]){const barrel=new THREE.Mesh(new THREE.CylinderGeometry(.045,.055,2.3,10).rotateZ(Math.PI/2),steel);barrel.position.set(1.4,y,z);pitch.add(barrel);const brake=new THREE.Mesh(new THREE.CylinderGeometry(.075,.075,.22,10).rotateZ(Math.PI/2),steel);brake.position.set(2.55,y,z);pitch.add(brake);const mz=new THREE.Object3D();mz.position.set(2.7,y,z);pitch.add(mz);muzzles.push(mz);
    const mag=new THREE.Mesh(new THREE.BoxGeometry(.25,.08,.3),olive);mag.position.set(.2,y,z+(z>0?.28:-.28));pitch.add(mag);}
  const flash=new THREE.Mesh(new THREE.SphereGeometry(.35,8,6),new THREE.MeshBasicMaterial({color:0xffd27a,transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false}));flash.position.set(2.75,0,0);flash.scale.set(2.2,1.4,1.4);pitch.add(flash);
  g.traverse(n=>{if(n.isMesh){n.castShadow=n.castShadow||n.geometry.type!=="SphereGeometry";n.userData.flakGun=true;}});flash.castShadow=false;flash.userData.flightFireIgnore=true;
  g.userData={yaw,pitch,muzzles,flash};return g;}

function ensureScene(){const s=bridge()?.threeScene;if(!s)return false;if(s===sceneRef&&root?.parent===s)return true;sceneRef=s;root=new THREE.Group();root.name="FLAK_BATTERIES";s.add(root);
  tracerMesh=new THREE.InstancedMesh(new THREE.CylinderGeometry(.06,.06,1,5).rotateX(Math.PI/2),new THREE.MeshBasicMaterial({color:0xffb347,transparent:true,opacity:.95,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false}),TRACER_POOL);tracerMesh.count=0;tracerMesh.frustumCulled=false;tracerMesh.userData.flightFireIgnore=true;tracerMesh.raycast=()=>{};root.add(tracerMesh);
  puffMesh=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,1),new THREE.MeshStandardMaterial({color:0x24221f,roughness:1,transparent:true,opacity:.8,depthWrite:false}),PUFF_POOL);puffMesh.count=0;puffMesh.frustumCulled=false;puffMesh.userData.flightFireIgnore=true;puffMesh.raycast=()=>{};root.add(puffMesh);
  for(const gun of guns.values())root.add(gun.model);return true;}

function scan(now){if(now-lastScan<1500)return;lastScan=now;const at=listener();if(!at)return;const c=cellOf(at.x,at.y),want=new Set();
  for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){const cell={...c,cx:c.cx+dx,cy:c.cy+dy},key=`${c.geo?"g":"l"}${cell.cx}:${cell.cy}`,seed=hash(`flak:${key}`);if(rand(seed,0)>CHANCE)continue;want.add(key);if(guns.has(key))continue;
    let spot=null;for(let t=0;t<10&&!spot;t++){const[x,y]=cellPoint(cell,.15+.7*rand(seed,1+t*2),.15+.7*rand(seed,2+t*2)),g=openGround(x,y);if(g!=null)spot={x,y,z:g};}
    if(!spot)continue;const model=buildGun();model.position.set(spot.x,spot.y,spot.z);model.rotation.z=rand(seed,40)*Math.PI*2;root.add(model);guns.set(key,{key,model,x:spot.x,y:spot.y,z:spot.z,hp:HP,dead:false,yaw:model.rotation.z,pitch:.2,burstT:rand(seed,41)*3,nextShot:0,barrel:0});}
  for(const[key,gun]of[...guns])if(!want.has(key)){gun.model.parent?.remove(gun.model);guns.delete(key);}
  const v=viewport();if(v)v.dataset.flakGuns=String(guns.size);}
function listener(){const b=bridge(),c=b?.presentedCamera?.()||b?.threeCamera;return c?.position||null;}
// the aircraft the guns look for: your jet (or you under the canopy), else your drone in flight
function target(){const J=globalThis.__jetMode;if(J?.active){const p=J.pose;if(p&&!p.para&&p.seat!=="passenger"&&Number.isFinite(p.x))return{kind:"jet",p:new THREE.Vector3(p.x,p.y,p.z)};return null;}
  const w=walk();if(w?.mode==="foot"||globalThis.__arondightVehicleDrive?.active)return null;const b=bridge(),a=b?.airframeFor?.(b.threeScene);if(!a||globalThis.__arondightDroneDamageModel?.destroyed)return null;return{kind:"drone",p:a.getWorldPosition(new THREE.Vector3())};}
function lineOfSight(from,to){const R=rigid();if(!R?.raycast)return true;const d=tmp2.copy(to).sub(from),len=d.length();if(len<1)return true;const hit=R.raycast([from.x,from.y,from.z],[d.x/len,d.y/len,d.z/len],len-2,{categoryBits:8n,maskBits:1n});return!hit;}

function audioShot(gun,dist){if(!settings.soundEnabled)return;const ctx=getSharedCombatAudioContext();if(!ctx||ctx.state!=="running")return;const level=clamp((Number(settings.fxVolume)||70)/72,0,1.4)*clamp(1.4/(1+dist/90),0,1.2);if(level<.01)return;const t=ctx.currentTime;
  const out=ctx.createGain();out.gain.value=level*.55;out.connect(ctx.destination);
  // thump: a falling sine kick
  const o=ctx.createOscillator(),og=ctx.createGain();o.type="sine";o.frequency.setValueAtTime(95,t);o.frequency.exponentialRampToValueAtTime(38,t+.11);og.gain.setValueAtTime(1,t);og.gain.exponentialRampToValueAtTime(.001,t+.16);o.connect(og).connect(out);o.start(t);o.stop(t+.18);
  // crack: short filtered noise, duller far away
  const n=ctx.createBufferSource(),buf=audioShot.buf||(audioShot.buf=(()=>{const b=ctx.createBuffer(1,ctx.sampleRate*.12|0,ctx.sampleRate),d=b.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=(Math.random()*2-1)*Math.exp(-i/(d.length*.18));return b;})());n.buffer=buf;const f=ctx.createBiquadFilter();f.type="lowpass";f.frequency.value=clamp(9000-dist*7,900,9000);const ng=ctx.createGain();ng.gain.value=.9;n.connect(f).connect(ng).connect(out);n.start(t);}
function audioBurst(at,dist){if(!settings.soundEnabled)return;const ctx=getSharedCombatAudioContext();if(!ctx||ctx.state!=="running")return;const level=clamp((Number(settings.fxVolume)||70)/72,0,1.4)*clamp(1/(1+dist/60),0,1);if(level<.02)return;const t=ctx.currentTime+dist/343;const o=ctx.createOscillator(),g=ctx.createGain();o.type="triangle";o.frequency.setValueAtTime(70,t);o.frequency.exponentialRampToValueAtTime(30,t+.25);g.gain.setValueAtTime(level*.6,t);g.gain.exponentialRampToValueAtTime(.001,t+.3);o.connect(g).connect(ctx.destination);o.start(t);o.stop(t+.32);}

function fire(gun,aim,now,dist){const mz=gun.model.userData.muzzles[gun.barrel++%4];mz.getWorldPosition(tmp);dir.copy(aim).sub(tmp).normalize();dir.x+=(Math.random()-.5)*SPREAD*2;dir.y+=(Math.random()-.5)*SPREAD*2;dir.z+=(Math.random()-.5)*SPREAD*2;dir.normalize();
  const fuse=clamp(tmp.distanceTo(aim)/MUZZLE_MPS+(Math.random()-.5)*.06,.05,1.6);const tr=tracers[tracerCursor++%TRACER_POOL]||(tracers[(tracerCursor-1)%TRACER_POOL]={p:new THREE.Vector3(),v:new THREE.Vector3(),until:0});tr.p.copy(tmp);tr.v.copy(dir).multiplyScalar(MUZZLE_MPS);tr.until=now+fuse*1000;tr.live=true;
  gun.model.userData.flash.material.opacity=1;gun.flashAt=now;audioShot(gun,dist);}
function burst(p,now){const pf=puffs[puffCursor++%PUFF_POOL]||(puffs[(puffCursor-1)%PUFF_POOL]={p:new THREE.Vector3(),born:0});pf.p.copy(p);pf.born=now;pf.live=true;
  const L=listener();if(L)audioBurst(p,L.distanceTo?L.distanceTo(p):Math.hypot(L.x-p.x,L.y-p.y,L.z-p.z));
  const T=target();if(!T)return;const d=T.p.distanceTo(p);if(d>BURST_R)return;const dmg=Math.round(14*(1-d/BURST_R)+2);
  if(T.kind==="jet")globalThis.__jetMode?.damageOwn?.(dmg,"flak");else globalThis.__arondightDroneDamageModel?.damage?.(dmg,"flak");const v=viewport();if(v)v.dataset.flakHits=String((Number(v.dataset.flakHits)||0)+1);}

function update(now,dt){const T=target();let tv=null;if(T){if(lastTarget){targetVel.copy(T.p).sub(lastTarget).multiplyScalar(1/Math.max(.016,dt));if(targetVel.length()>400)targetVel.set(0,0,0);}lastTarget=T.p.clone();tv=targetVel;}else lastTarget=null;
  const L=listener();
  for(const gun of guns.values()){const ud=gun.model.userData;if(gun.flashAt&&now-gun.flashAt>45)ud.flash.material.opacity=0;if(gun.dead)continue;
    let engaged=false;if(T){const base=tmp.set(gun.x,gun.y,gun.z+1.6),dist=base.distanceTo(T.p),agl=T.p.z-groundHeightAt(T.p.x,T.p.y);
      if(dist<RANGE_M&&agl>MIN_AGL_M&&(now-(gun.losAt||0)<400?gun.los:(gun.losAt=now,gun.los=lineOfSight(base,T.p)))){engaged=true;
        // lead: where the target will be when the round gets there
        const tof=dist/MUZZLE_MPS,aim=tmp2.copy(T.p).addScaledVector(tv||targetVel,tof);const dx=aim.x-gun.x,dy=aim.y-gun.y,wantYaw=Math.atan2(dy,dx),wantPitch=Math.atan2(aim.z-gun.z-1.6,Math.hypot(dx,dy));
        let dyaw=((wantYaw-gun.yaw+Math.PI)%(Math.PI*2)+Math.PI*2)%(Math.PI*2)-Math.PI;gun.yaw+=clamp(dyaw,-2.2*dt,2.2*dt);gun.pitch+=clamp(wantPitch-gun.pitch,-1.6*dt,1.6*dt);
        gun.burstT+=dt;const cyc=BURST_ON_S+BURST_OFF_S,phase=gun.burstT%cyc;
        if(phase<BURST_ON_S&&Math.abs(dyaw)<.15){const aimNow=aim.clone();while(gun.nextShot<=now){fire(gun,aimNow,now,L?Math.hypot(L.x-gun.x,L.y-gun.y,L.z-gun.z):300);gun.nextShot=Math.max(gun.nextShot+1000/ROUNDS_PER_S,now-50);}}}}
    if(!engaged){gun.nextShot=now;gun.pitch+=(.25-gun.pitch)*Math.min(1,dt*.5);}
    ud.yaw.rotation.z=gun.yaw-gun.model.rotation.z;ud.pitch.rotation.y=-gun.pitch;}
  // tracers: fly straight (900 m/s barely drops over 1.5 s), burst at the fuse
  let n=0;for(const tr of tracers){if(!tr?.live)continue;if(now>=tr.until){tr.live=false;burst(tr.p,now);continue;}tr.p.addScaledVector(tr.v,dt);tr.v.z-=9.81*dt;q.setFromUnitVectors(zAxis,dir.copy(tr.v).normalize());sc.set(1,1,Math.min(14,tr.v.length()*.016));m4.compose(tr.p,q,sc);tracerMesh.setMatrixAt(n++,m4);}
  tracerMesh.count=n;tracerMesh.instanceMatrix.needsUpdate=true;
  let k=0;for(const pf of puffs){if(!pf?.live)continue;const a=(now-pf.born)/1000;if(a>2.4){pf.live=false;continue;}const s=1.2+a*2.2;sc.set(s,s,s);pf.p.z+=dt*.6;m4.compose(pf.p,q.identity(),sc);puffMesh.setMatrixAt(k++,m4);}
  puffMesh.count=k;puffMesh.instanceMatrix.needsUpdate=true;}

function knockOut(gun){if(gun.dead)return;gun.dead=true;gun.model.userData.pitch.rotation.y=.35;gun.model.traverse(n=>{if(n.isMesh&&n.material?.color&&n.userData.flakGun){n.material=n.material.clone();n.material.color.multiplyScalar(.35);}});const v=viewport();if(v)v.dataset.flakDestroyed=String((Number(v.dataset.flakDestroyed)||0)+1);}
function onExplosion(e){const d=e?.detail||{},p=d.position;if(!Array.isArray(p))return;const R=Number(d.radiusM)||8;for(const gun of guns.values()){if(gun.dead)continue;const dist=Math.hypot(gun.x-p[0],gun.y-p[1],gun.z+1-p[2]);if(dist<R*.8){gun.hp-=(Number(d.maxDamage)||100)*(1-dist/R)*1.5;if(gun.hp<=0)knockOut(gun);}}}
function onTracer(e){const b=e?.detail?.end;if(!Array.isArray(b))return;for(const gun of guns.values()){if(gun.dead)continue;if(Math.hypot(gun.x-b[0],gun.y-b[1],gun.z+1.2-b[2])<1.8){gun.hp-=e.detail.weapon==="sniper"?35:4;if(gun.hp<=0)knockOut(gun);}}}

function frame(now=performance.now()){requestAnimationFrame(frame);const dt=Math.min(.1,Math.max(0,(now-lastFrame)/1000));lastFrame=now;if(!bridge()?.threeScene||!ensureScene())return;
  if(globalThis.__arondightWorldOptions?.get?.("flak")===false){for(const g of guns.values())g.model.parent?.remove(g.model);guns.clear();return;}
  try{scan(now);update(now,dt);}catch(err){console.warn("flak",err);}}
export function installFlak(){if(installed||typeof window==="undefined")return;installed=true;addEventListener(AUDIO_SETTINGS_EVENT,e=>{settings={...settings,...(e?.detail||loadAudioSettings())};});addEventListener("arondight:world-explosion",onExplosion);addEventListener("arondight:foot-tracer",onTracer);addEventListener("arondight:world-reset",()=>{for(const g of guns.values()){g.model.parent?.remove(g.model);}guns.clear();});
  globalThis.__flak={version:FLAK_VERSION,get guns(){return[...guns.values()].map(g=>({key:g.key,x:g.x,y:g.y,dead:g.dead,hp:g.hp}));}};requestAnimationFrame(frame);}
installFlak();
