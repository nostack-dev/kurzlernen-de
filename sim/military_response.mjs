import * as THREE from "three";
import {vehicleMaterial} from "./vehicle_models.mjs";
import {createCrowd} from "./crowd_characters.mjs";
import {groundHeightAt} from "./terrain_craters.mjs";
import {wantedLineBlockedByPrisms,wantedPointInRing} from "./wanted_system_logic.mjs";
import {spawnWorldPersonRagdoll} from "./world_person_ragdoll.mjs";
import {requestLight} from "./dynamic_lights.mjs";
import {getSharedCombatAudioContext,playCombatAudio} from "./combat_audio_bank.mjs";
import {VS_FX_EVENT} from "./lan_vs.mjs";

// MILITARY. Only when the player really overdoes it — five stars held for
// over a minute while the heat keeps climbing, or a truly extreme rampage —
// and after a 25 s alert (lose the fifth star to call it off) the army takes
// over from the police: the police drones turn olive drab, an attack
// helicopter circles in and works the player with its heavy machine gun,
// a squad of soldiers advances on foot (rifle bursts from cover range) and a
// tank rolls in on the roads and fires its main gun. Threatening, but
// survivable for a while: bursts with honest spread, shells you can outrun,
// everything can be shot down / blown up. Below three stars they withdraw.
// Multiplayer: the owner simulates, peers see snapshots (8 Hz) and their
// hits are forwarded to the owner.

export const MILITARY_RESPONSE_VERSION="military-escalation-v1";
// the army is the last resort: five stars held for a long time while the heat
// keeps piling up (or a truly extreme rampage), then an alert phase in which
// calming down (losing the fifth star) still calls it off
const TRIGGER_HEAT=45,TRIGGER_HOLD_MS=75000,TRIGGER_EXTREME_HEAT=70,ALERT_MS=25000,END_STARS=3,SQUAD=4,MAX_SOLDIERS=8,SOLDIER_HP=100,HIT=25,HELI_HP=420,TANK_HP=900;
const OLIVE=0x4b5634,SOLDIER_COLORS=[0xc8956f,0xa87052,0x7b4a33,0xd2a27e].map(skin=>({shirt:0x55603c,vest:0x3d4530,pants:0x4a5238,boots:0x1d1a16,skin,gloves:0x2a2a24,helmet:0x4b5634}));
const bridge=()=>globalThis.__arondightRealWorld||null,physics=()=>globalThis.__arondightWorldRigidBodies||null,wanted=()=>globalThis.__arondightWantedSystem||null,viewport=()=>document.getElementById("viewport");
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),angleTo=(a,b)=>{let d=b-a;while(d>Math.PI)d-=2*Math.PI;while(d<-Math.PI)d+=2*Math.PI;return d;};
let active=false,root=null,sceneRef=null,crowd=null,remoteCrowd=null,since5=0,alertAt=0,startedAt=0,nextReinforce=0,serial=0,lastTx=0;
let helis=[],tanks=[],soldiers=[],tracers=[],shells=[];const remote=new Map(),tmp=new THREE.Vector3(),tmp2=new THREE.Vector3(),Y=new THREE.Vector3(0,1,0);

function playerTarget(){return globalThis.__arondightPlayerVitals?.damageTargets?.()?.find?.(t=>t.kind==="drone")||globalThis.__arondightPlayerVitals?.damageTargets?.()?.find?.(t=>t.kind==="player")||null;}
function prisms(){return bridge()?.buildingCollisionSnapshot?.prisms||[];}
function blocked(a,b){try{return wantedLineBlockedByPrisms(a,b,prisms());}catch{return false;}}
function insideBuilding(x,y){for(const pr of prisms()){const pts=pr.points;if(!pts||pts.length<3||Math.abs(x-pts[0][0])>120||Math.abs(y-pts[0][1])>120)continue;if(wantedPointInRing(x,y,pts))return true;}return false;}
function inView(x,y,z){const cam=bridge()?.threeCamera;if(!cam)return false;const v=tmp.set(x,y,z).project(cam);return v.z<1&&Math.abs(v.x)<1.1&&Math.abs(v.y)<1.1;}
function sound(kind,x,y,z,gain=.5,rate=1){try{const c=getSharedCombatAudioContext();if(!c||c.state!=="running")return;const pl=playerTarget()?.position,d=pl?Math.hypot(pl.x-x,pl.y-y,(pl.z||0)-z):60;playCombatAudio(c,kind,{gain:clamp(gain*40/(25+d),.03,gain),playbackRate:rate,minIntervalMs:30});}catch{}}
function damagePlayer(t,dmg,source){if(t?.model?.damage)t.model.damage(dmg,source);else window.dispatchEvent(new CustomEvent("arondight:player-damage",{detail:{damage:dmg,source}}));window.dispatchEvent(new CustomEvent("arondight:combat-damage",{detail:{damage:dmg,source,target:t?.kind||"player"}}));}

// ------------------------------------------------------------ scene / models
function ensureScene(){const scene=bridge()?.threeScene;if(!scene)return false;if(scene===sceneRef&&root?.parent===scene)return true;clearAll(true);root?.parent?.remove(root);crowd?.dispose?.();remoteCrowd?.dispose?.();sceneRef=scene;root=new THREE.Group();root.name="MILITARY_RESPONSE";scene.add(root);
  crowd=createCrowd(scene,{capacity:MAX_SOLDIERS,outfit:"police",name:"MILITARY_SOLDIERS"});remoteCrowd=createCrowd(scene,{capacity:16,outfit:"police",name:"MILITARY_SOLDIERS_REMOTE"});for(let i=0;i<MAX_SOLDIERS;i++)crowd.setColors(i,SOLDIER_COLORS[i%4]);for(let i=0;i<16;i++)remoteCrowd.setColors(i,SOLDIER_COLORS[i%4]);return true;}
const MAT={olive:new THREE.MeshStandardMaterial({color:OLIVE,roughness:.7,metalness:.25}),dark:new THREE.MeshStandardMaterial({color:0x22261c,roughness:.6,metalness:.4}),glass:new THREE.MeshStandardMaterial({color:0x1a2228,roughness:.1,metalness:.6}),rotor:new THREE.MeshStandardMaterial({color:0x15171a,roughness:.5,transparent:true,opacity:.75})};
function part(g,geo,mat,x,y,z,rx=0,ry=0,rz=0){const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.rotation.set(rx,ry,rz);m.castShadow=true;m.userData.flightFireIgnore=true;g.add(m);return m;}
let hitGeo=null;const hitMat=Object.assign(new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false}),{colorWrite:false,visible:false});
function proxy(g,shape,name){const m=new THREE.Mesh(shape,hitMat);m.name=name;m.userData.hitProxy=true;m.userData.worldPopulationKind="enemy";m.userData.styleSkip=true;g.add(m);return m;}
// attack helicopter (forward = +y)
function buildHeli(){const g=new THREE.Group();g.name="MIL_HELI";
  part(g,new THREE.CapsuleGeometry(.95,4.2,4,10),MAT.olive,0,0,0,Math.PI/2);part(g,new THREE.SphereGeometry(.75,10,8),MAT.glass,0,2.3,.45).scale.set(.8,1.3,.8);
  part(g,new THREE.CylinderGeometry(.22,.4,5.2,8),MAT.olive,0,-4.6,.35,Math.PI/2);part(g,new THREE.BoxGeometry(.12,1.1,1.5),MAT.olive,0,-7,.95);
  for(const s of[-1,1]){part(g,new THREE.BoxGeometry(1.7,.5,.12),MAT.olive,s*1.4,.2,-.15);part(g,new THREE.CylinderGeometry(.16,.16,1.6,8),MAT.dark,s*2.1,.4,-.35,Math.PI/2);part(g,new THREE.BoxGeometry(.08,3.2,.08),MAT.dark,s*.9,0,-1.3);}
  part(g,new THREE.CylinderGeometry(.08,.08,1.1,6),MAT.dark,0,3.2,-.8,Math.PI/2);// chin gun
  const mast=new THREE.Group();mast.position.set(0,.2,1.25);g.add(mast);for(const a of[0,Math.PI/2]){part(mast,new THREE.BoxGeometry(12.5,.32,.04),MAT.rotor,0,0,0,0,0,a);}
  const tail=new THREE.Group();tail.position.set(.18,-7,1.1);g.add(tail);part(tail,new THREE.BoxGeometry(.04,.22,2.2),MAT.rotor,0,0,0);
  hitGeo??=new THREE.CapsuleGeometry(1.3,6,3,8).rotateX(Math.PI/2);const hp=proxy(g,hitGeo,"MILITARY_HELI_HIT_PROXY");hp.position.y=-1;return{group:g,mast,tail,proxy:hp};}
// main battle tank (forward = +x like the vehicles)
function buildTank(){const g=new THREE.Group();g.name="MIL_TANK";
  part(g,new THREE.BoxGeometry(6.6,3.1,1.0),MAT.olive,0,0,.95);part(g,new THREE.BoxGeometry(6.9,.75,.85),MAT.dark,0,1.25,.55);part(g,new THREE.BoxGeometry(6.9,.75,.85),MAT.dark,0,-1.25,.55);
  part(g,new THREE.BoxGeometry(1.4,2.9,.5),MAT.olive,2.9,0,1.25,0,-.5,0);
  const turret=new THREE.Group();turret.position.set(-.3,0,1.65);g.add(turret);part(turret,new THREE.BoxGeometry(2.8,2.3,.75),MAT.olive,0,0,.2);part(turret,new THREE.CylinderGeometry(.13,.16,4.4,10),MAT.dark,2.9,0,.3,0,0,Math.PI/2);part(turret,new THREE.CylinderGeometry(.35,.35,.4,10),MAT.dark,-.6,.5,.75);
  const p=proxy(g,new THREE.BoxGeometry(6.8,3.2,2.4),"MILITARY_TANK_HIT_PROXY");p.position.z=1.2;return{group:g,turret,proxy:p};}
let soldierProxyGeo=null;function soldierProxy(){soldierProxyGeo??=(()=>{const g=new THREE.CapsuleGeometry(.27,1.2,3,8);g.rotateX(Math.PI/2);g.translate(0,0,.86);return g;})();const m=proxy(root,soldierProxyGeo,"MILITARY_SOLDIER_HIT_PROXY");m.visible=false;return m;}

// ------------------------------------------------------------ fx
function tracer(from,to,color=0xffe08a){let t=tracers.find(x=>!x.mesh.visible);if(!t){if(tracers.length>=28)t=tracers[0];else{const m=new THREE.Mesh(new THREE.CylinderGeometry(.03,.03,1,5,1,true),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.9,blending:THREE.AdditiveBlending,depthWrite:false}));m.userData.flightFireIgnore=true;m.raycast=()=>{};root.add(m);t={mesh:m,until:0};tracers.push(t);}}
  tmp.subVectors(to,from);const len=tmp.length();if(len<.1)return;t.mesh.position.copy(from).addScaledVector(tmp,.5);t.mesh.quaternion.setFromUnitVectors(Y,tmp.normalize());t.mesh.scale.set(1,len,1);t.mesh.visible=true;t.until=performance.now()+80;}
// one bullet from `from` at the target: hit by chance (distance, target speed), else it lands next to it
function shoot(from,t,chance,dmg,source,spread=2.6){const a=t.position,aim=new THREE.Vector3(a.x,a.y,a.z-.2);let to;
  if(Math.random()<chance){to=aim;damagePlayer(t,dmg,source);}else{to=new THREE.Vector3(a.x+(Math.random()-.5)*spread,a.y+(Math.random()-.5)*spread,a.z+(Math.random()-.6)*spread*.5);const dir=to.clone().sub(from).normalize(),d=from.distanceTo(to);to.copy(from).addScaledVector(dir,d+8);globalThis.__worldImpacts?.bullet?.({origin:from,direction:dir},null,{maxDistance:d+16});}
  tracer(from,to);sendFx({kind:"tracer",a:[from.x,from.y,from.z].map(v=>+v.toFixed(1)),b:[to.x,to.y,to.z].map(v=>+v.toFixed(1))});}
function boom(p,radius,damage,scale=.45){globalThis.__fighterJets?.blast?.(p,{radiusM:radius,maxDamage:damage,scale,kind:"military"});}

// ------------------------------------------------------------ helicopter
function spawnHeli(now,target){const a=Math.random()*Math.PI*2,x=target.x+Math.cos(a)*650,y=target.y+Math.sin(a)*650,z=groundHeightAt(x,y)+95;const m=buildHeli();root.add(m.group);const h={id:`mil-heli-${(++serial).toString(36)}`,m,p:new THREE.Vector3(x,y,z),v:new THREE.Vector3(),yaw:Math.atan2(target.y-y,target.x-x)-Math.PI/2,hp:HELI_HP,state:"inbound",orbit:a,rotor:0,nextBurst:now+5000,burst:0,nextShot:0,born:now};helis.push(h);sound("explosion",x,y,z,.2,.3);return h;}
function stepHeli(h,t,now,dt){const tp=t.position;
  if(h.state==="down"){h.v.z-=9.8*dt;h.v.multiplyScalar(1-.3*dt);h.p.addScaledVector(h.v,dt);h.yaw+=4*dt;const gz=groundHeightAt(h.p.x,h.p.y);if(h.p.z<gz+1||insideBuilding(h.p.x,h.p.y)&&h.p.z<gz+25){boom(h.p.clone().setZ(Math.max(h.p.z,gz)),14,120,.9);h.dead=true;}render(h,now,dt);return;}
  const leaving=h.state==="leave";let goal;
  if(leaving){goal=h.p.clone().add(tmp2.set(Math.cos(h.orbit),Math.sin(h.orbit),0).multiplyScalar(600));goal.z=groundHeightAt(goal.x,goal.y)+120;}
  else{const dist=Math.hypot(tp.x-h.p.x,tp.y-h.p.y);if(h.state==="inbound"&&dist<170)h.state="orbit";h.orbit+=dt*.22;const R=h.state==="orbit"?72:0;goal=new THREE.Vector3(tp.x+Math.cos(h.orbit)*R,tp.y+Math.sin(h.orbit)*R,0);goal.z=Math.max(groundHeightAt(goal.x,goal.y)+42,(tp.z||0)+16);}
  // fly: accelerate towards the goal, max 48 m/s, gentle bank
  tmp.subVectors(goal,h.p);const want=tmp.clone().setLength(Math.min(48,tmp.length()*.6));h.v.lerp(want,1-Math.exp(-dt*.9));h.p.addScaledVector(h.v,dt);
  const gz=groundHeightAt(h.p.x,h.p.y);if(h.p.z<gz+25)h.p.z+=(gz+25-h.p.z)*Math.min(1,dt*3);
  const face=leaving||h.state==="inbound"?Math.atan2(h.v.y,h.v.x):Math.atan2(tp.y-h.p.y,tp.x-h.p.x);h.yaw+=angleTo(h.yaw,face-Math.PI/2)*Math.min(1,dt*1.6);
  // heavy machine gun: bursts with honest spread
  if(h.state==="orbit"&&!leaving){const d=h.p.distanceTo(tmp.set(tp.x,tp.y,tp.z||0));if(now>h.nextBurst&&d<240&&!blocked({x:h.p.x,y:h.p.y,z:h.p.z},{x:tp.x,y:tp.y,z:(tp.z||1.6)})){h.burst=7;h.nextBurst=now+3200+Math.random()*1500;}
    if(h.burst>0&&now>h.nextShot){h.burst--;h.nextShot=now+110;const fwd=tmp2.set(-Math.sin(h.yaw),Math.cos(h.yaw),0),from=h.p.clone().addScaledVector(fwd,3.4).setZ(h.p.z-.9),chance=clamp(.32-d/650-(t.speedMps||0)*.025,.05,.32);shoot(from,t,chance,t.kind==="drone"?9:6,"military-heli",3.6);sound("shot",from.x,from.y,from.z,.6,.55);}}
  if(leaving&&Math.hypot(h.p.x-tp.x,h.p.y-tp.y)>650)h.dead=true;render(h,now,dt);}
function render(h,now,dt){const g=h.m.group;g.position.copy(h.p);g.rotation.set(clamp(-h.v.length()*.004,-.25,0),0,h.yaw);h.rotor+=dt*28;h.m.mast.rotation.z=h.rotor;h.m.tail.rotation.x=h.rotor*1.7;g.updateMatrixWorld();}

// ------------------------------------------------------------ tank
let graph=null,graphAt=-Infinity;
function roadGraph(now){if(graph&&now-graphAt<5000)return graph;const routes=globalThis.__arondightProceduralPopulation?.roads?.()||[];graphAt=now;const nodes=new Map(),key=(x,y)=>`${Math.round(x/2)},${Math.round(y/2)}`,node=(x,y)=>{const k=key(x,y);let n=nodes.get(k);if(!n){n={x,y,adj:[]};nodes.set(k,n);}return n;};for(const r of routes)for(const s of r.segments||[]){const a=node(s.a[0],s.a[1]),b=node(s.a[0]+s.dx,s.a[1]+s.dy);if(a===b)continue;a.adj.push([b,s.d]);b.adj.push([a,s.d]);}graph={nodes:[...nodes.values()]};return graph;}
function nearestNode(g,x,y){let best=null,bd=Infinity;for(const n of g.nodes){const d=(n.x-x)**2+(n.y-y)**2;if(d<bd){bd=d;best=n;}}return best;}
function findPath(g,sx,sy,tx,ty,avoid=null){const a=nearestNode(g,sx,sy),b=nearestNode(g,tx,ty);if(!a||!b)return null;if(a===b)return[{x:sx,y:sy},{x:tx,y:ty}];const open=[a],inOpen=new Set([a]),gs=new Map([[a,0]]),from=new Map(),h=n=>Math.hypot(n.x-b.x,n.y-b.y),fs=new Map([[a,h(a)]]),closed=new Set();let it=0;
  while(open.length&&it++<5000){let bi=0;for(let i=1;i<open.length;i++)if(fs.get(open[i])<fs.get(open[bi]))bi=i;const cur=open[bi];open[bi]=open[open.length-1];open.pop();inOpen.delete(cur);if(cur===b)break;closed.add(cur);for(const[n,w]of cur.adj){if(closed.has(n))continue;let ww=w;if(avoid?.length){const mx=(cur.x+n.x)/2,my=(cur.y+n.y)/2;for(const q of avoid)if(Math.hypot(mx-q.x,my-q.y)<9){ww*=25;break;}}const g2=gs.get(cur)+ww;if(g2<(gs.get(n)??Infinity)){gs.set(n,g2);fs.set(n,g2+h(n));from.set(n,cur);if(!inOpen.has(n)){open.push(n);inOpen.add(n);}}}}
  if(!from.has(b))return null;const path=[{x:tx,y:ty}];for(let n=b;n;n=from.get(n))path.unshift({x:n.x,y:n.y});return path;}
function pursuitPoint(path,x,y,look){let bi=0,bt=0,bd=Infinity;for(let i=0;i<path.length-1;i++){const a=path[i],b=path[i+1],dx=b.x-a.x,dy=b.y-a.y,l2=dx*dx+dy*dy||1e-6,t=clamp(((x-a.x)*dx+(y-a.y)*dy)/l2,0,1),px=a.x+dx*t,py=a.y+dy*t,d=Math.hypot(x-px,y-py);if(d<bd){bd=d;bi=i;bt=t;}}if(path.length<2)return path[0];let i=bi,t=bt,left=look;while(i<path.length-1){const a=path[i],b=path[i+1],l=Math.hypot(b.x-a.x,b.y-a.y)||1e-6,rest=(1-t)*l;if(rest>=left){const tt=t+left/l;return{x:a.x+(b.x-a.x)*tt,y:a.y+(b.y-a.y)*tt};}left-=rest;i++;t=0;}return path.at(-1);}
function spawnTank(now,target){const g=roadGraph(now),cands=g.nodes.filter(n=>{const d=Math.hypot(n.x-target.x,n.y-target.y);return d>170&&d<300&&!insideBuilding(n.x,n.y)&&!inView(n.x,n.y,groundHeightAt(n.x,n.y)+2);});const spot=cands[(Math.random()*cands.length)|0];if(!spot)return null;
  const id=`mil-tank-${(++serial).toString(36)}`,z=groundHeightAt(spot.x,spot.y),yaw=Math.atan2(target.y-spot.y,target.x-spot.x);if(!physics()?.upsertBody?.({id,kind:"bus",position:[spot.x,spot.y,z+1.1],yaw,halfExtents:[3.3,1.5,.9],massKg:9200}))return null;
  const m=buildTank();root.add(m.group);const tk={id,m,hp:TANK_HP,pose:null,path:null,pathAt:0,turret:0,nextShell:now+6000,born:now,recoverUntil:0,recoverStart:0,stuckSince:0,progress:null,fails:0,avoid:[],flippedSince:0,state:"advance"};tanks.push(tk);return tk;}
function stepTank(tk,t,now,dt){const p=physics()?.pose?.(tk.id,tk.pose);if(!p){tk.dead=true;return;}tk.pose=p;const cx=p.position[0],cy=p.position[1],tp=t.position,d=Math.hypot(tp.x-cx,tp.y-cy),sp=Math.hypot(p.velocity[0],p.velocity[1]);
  const g=tk.m.group,q=p.rotation,off=Number(p.groundOffset)||.9;g.quaternion.set(q[0],q[1],q[2],q[3]);tmp.set(0,0,1).applyQuaternion(g.quaternion);g.position.set(cx-tmp.x*off,cy-tmp.y*off,p.position[2]-tmp.z*off);g.updateMatrixWorld();
  const leaving=tk.state==="leave",goal=leaving?(tk.exit??={x:cx+(cx-tp.x)*3,y:cy+(cy-tp.y)*3}):{x:tp.x,y:tp.y};
  const los=d<160&&!blocked({x:cx,y:cy,z:g.position.z+2.6},{x:tp.x,y:tp.y,z:(tp.z||1.6)});
  // a tank on its side / roof is a wreck: it does not drive or fire any more
  const upZ=tmp.z;if(upZ<.4){tk.flippedSince||=now;}else tk.flippedSince=0;
  if(tk.state==="wreck"||(tk.flippedSince&&now-tk.flippedSince>3000)){if(tk.state!=="wreck"){tk.state="wreck";tk.wreckAt=now;physics()?.clearTarget?.(tk.id);physics()?.setDrive?.(tk.id,{pedal:0,steer:0,handbrake:true});}if(now-tk.wreckAt>20000&&d>120&&!inView(cx,cy,g.position.z+2))tk.dead=true;return;}
  if(!leaving&&los&&d<110){tk.stuckSince=0;tk.progress=null;physics()?.clearTarget?.(tk.id);physics()?.setDrive?.(tk.id,{pedal:0,steer:0,handbrake:true});}
  else{if(!tk.path||now-tk.pathAt>3000){tk.avoid=tk.avoid.filter(q=>now-q.at<60000);tk.path=findPath(roadGraph(now),cx,cy,goal.x,goal.y,tk.avoid)||[{x:cx,y:cy},goal];tk.pathAt=now;}const pt=pursuitPoint(tk.path,cx,cy,Math.max(8,sp*1.2)),herr=angleTo(p.yaw,Math.atan2(pt.y-cy,pt.x-cx));
    // recovery: back out (alternating the steer side each attempt so it does not
    // rock in the same notch); a road piece that blocked it twice is avoided
    // in the next plan — it really drives around, nothing is teleported
    if(now<tk.recoverUntil){if(Math.abs(herr)<.5&&now-tk.recoverStart>900)tk.recoverUntil=0;else{const side=(tk.fails%2?1:-1)*Math.sign(herr||1);physics()?.clearTarget?.(tk.id);physics()?.setDrive?.(tk.id,{pedal:-.75,steer:side,handbrake:false,maxReverse:3.5});}}
    else{tk.progress??={x:cx,y:cy,at:now};if(Math.hypot(cx-tk.progress.x,cy-tk.progress.y)>4){tk.progress={x:cx,y:cy,at:now};if(now-tk.recoverStart>8000)tk.fails=0;}
      const slow=sp<.5?(tk.stuckSince||=now,now-tk.stuckSince>2500):(tk.stuckSince=0,false),noProgress=now-tk.progress.at>7000;
      if(slow||noProgress){tk.fails++;if(tk.fails>=2)tk.avoid.push({x:pt.x,y:pt.y,at:now});tk.recoverStart=now;tk.recoverUntil=now+1800+Math.min(3,tk.fails)*500;tk.stuckSince=0;tk.progress=null;tk.path=null;}
      physics()?.setDrive?.(tk.id,null);physics()?.setTarget?.(tk.id,{position:[pt.x,pt.y,0],yaw:0,speedMps:9});}}
  // turret: slew to the target, main gun every ~7 s with a lead and a miss you can outrun
  const want=Math.atan2(tp.y-cy,tp.x-cx)-p.yaw;tk.turret+=clamp(angleTo(tk.turret,want),-dt*.7,dt*.7);tk.m.turret.rotation.z=tk.turret;
  if(!leaving&&los&&now>tk.nextShell&&Math.abs(angleTo(tk.turret,want))<.06){tk.nextShell=now+6500+Math.random()*2500;const yaw=p.yaw+tk.turret,muzzle=new THREE.Vector3(cx+Math.cos(yaw)*5.8,cy+Math.sin(yaw)*5.8,g.position.z+2);
    const vx=t.speedMps?(t.velocity?.x||0):0,vy=t.speedMps?(t.velocity?.y||0):0,err=2+d*.03+(t.speedMps||0)*.6,aim=new THREE.Vector3(tp.x+vx*.4+(Math.random()-.5)*err*2,tp.y+vy*.4+(Math.random()-.5)*err*2,Math.max(groundHeightAt(tp.x,tp.y),(tp.z||0)-1.2));
    shells.push({p:muzzle,v:aim.clone().sub(muzzle).setLength(130),life:3});boom(muzzle.clone(),0,0,.12);sound("explosion",muzzle.x,muzzle.y,muzzle.z,.9,1.35);sendFx({kind:"shell",a:[muzzle.x,muzzle.y,muzzle.z].map(v=>+v.toFixed(1)),b:[aim.x,aim.y,aim.z].map(v=>+v.toFixed(1))});}
  if(leaving&&d>300&&!inView(cx,cy,g.position.z+2))tk.dead=true;}
function stepShells(dt){for(let i=shells.length-1;i>=0;i--){const s=shells[i];const prev=s.p.clone();s.p.addScaledVector(s.v,dt);s.life-=dt;const gz=groundHeightAt(s.p.x,s.p.y);
  let hitP=null;if(s.p.z<=gz+.2)hitP=s.p.clone().setZ(gz);else if(insideBuilding(s.p.x,s.p.y))hitP=prev;else{const t=playerTarget();if(t&&s.p.distanceTo(tmp.set(t.position.x,t.position.y,t.position.z))<2.2)hitP=s.p.clone();}
  if(hitP||s.life<=0){shells.splice(i,1);if(hitP&&!s.remote)boom(hitP,6,48,.55);else if(hitP)boom(hitP,0,0,.55);continue;}tracer(prev,s.p,0xffb060);}}

// ------------------------------------------------------------ soldiers
function spawnSquad(now,target,n){const g=roadGraph(now),cands=g.nodes.filter(q=>{const d=Math.hypot(q.x-target.x,q.y-target.y);return d>90&&d<170&&!insideBuilding(q.x,q.y)&&!inView(q.x,q.y,groundHeightAt(q.x,q.y)+1);});const base=cands[(Math.random()*cands.length)|0]||{x:target.x+120,y:target.y};
  const used=new Set(soldiers.filter(s=>!s.dead).map(s=>s.slot));for(let k=0,slot=0;k<n&&slot<MAX_SOLDIERS;slot++){if(used.has(slot))continue;const x=base.x+(k%2)*1.6,y=base.y+Math.floor(k/2)*1.6;soldiers=soldiers.filter(s=>s.slot!==slot);soldiers.push({slot,x,y,z:groundHeightAt(x,y),yaw:0,hp:SOLDIER_HP,speed:0,anim:"run",los:false,losAt:0,nextShot:now+3000+Math.random()*2000,burst:0,dead:false,proxy:soldierProxy(),hold:20+Math.random()*12});k++;}}
function stepSoldier(s,t,now,dt){if(s.dead)return;const tp=t.position,dx=tp.x-s.x,dy=tp.y-s.y,d=Math.hypot(dx,dy),eye={x:s.x,y:s.y,z:s.z+1.5};
  if(now-s.losAt>350){s.losAt=now;s.los=d<90&&!blocked(eye,{x:tp.x,y:tp.y,z:(tp.z||1.6)-.3});}
  let move=null;s.anim="aim";if(active===false){move=d>.1?[-dx/d,-dy/d]:null;}
  else if(!s.los){// no sight: advance along the streets (A* over the road graph), not into walls
    if(!s.path||now-(s.pathAt||0)>3000){s.path=findPath(roadGraph(now),s.x,s.y,tp.x,tp.y);s.pathAt=now;}const wp=s.path?.length?pursuitPoint(s.path,s.x,s.y,5):{x:tp.x,y:tp.y},ex=wp.x-s.x,ey=wp.y-s.y,ed=Math.hypot(ex,ey)||1;move=[ex/ed,ey/ed];}
  else if(d>s.hold+8)move=[dx/d,dy/d];else if(d<s.hold-10)move=[-dx/d*.5,-dy/d*.5];
  if(move){const sp=active?(d>60?3.8:2.6):3.8;let ang=Math.atan2(move[1],move[0]),ok=false;for(const o of[0,.5,-.5,1,-1,1.6,-1.6]){const a=ang+o,nx=s.x+Math.cos(a)*sp*dt,ny=s.y+Math.sin(a)*sp*dt;if(!insideBuilding(nx,ny)){s.x=nx;s.y=ny;ang=a;ok=true;break;}}s.z=groundHeightAt(s.x,s.y);s.speed=ok?sp:0;const face=s.los&&active?Math.atan2(dy,dx):ang;s.yaw+=angleTo(s.yaw,face)*Math.min(1,dt*9);s.anim=ok?(sp>3?"run":"walk"):"aim";}
  else{s.speed=0;s.yaw+=angleTo(s.yaw,Math.atan2(dy,dx))*Math.min(1,dt*10);}
  // rifle: 3-round bursts from range, dispersion that grows with distance and target speed
  if(active&&s.los&&d<s.hold+20&&now>s.nextShot&&Math.abs(angleTo(s.yaw,Math.atan2(dy,dx)))<.3){if(!s.burst)s.burst=3;s.burst--;s.nextShot=s.burst?now+120:now+2200+Math.random()*1600;s.lastShotAt=now;const fx=Math.cos(s.yaw),fy=Math.sin(s.yaw),from=new THREE.Vector3(s.x+fx*.55-fy*.12,s.y+fy*.55+fx*.12,s.z+1.4);
    shoot(from,t,clamp(.24-d/300-(t.speedMps||0)*.03,.04,.24),t.kind==="drone"?6:5,"military-soldier",2.2);sound("shot",from.x,from.y,from.z,.45,.9);}}
function killSoldier(s,dir){if(s.dead)return;s.dead=true;s.hp=0;crowd?.hide(s.slot);s.proxy.visible=false;spawnWorldPersonRagdoll({position:[s.x,s.y,s.z+.05],yaw:s.yaw-Math.PI/2,impulse:dir?[dir.x*3,dir.y*3,2.2]:[0,0,2],seed:`soldier-${s.slot}-${serial}`,id:`soldier-${s.slot}-${now()}`,colors:SOLDIER_COLORS[s.slot%4]});window.dispatchEvent(new CustomEvent("arondight:combat-hit-confirm",{detail:{police:true,killed:true}}));}
const now=()=>performance.now();
function renderSoldiers(dt){if(!crowd)return;for(let i=0;i<MAX_SOLDIERS;i++){const s=soldiers.find(q=>q.slot===i&&!q.dead);if(!s){crowd.hide(i);continue;}const st=s.anim==="aim"||now()-(s.lastShotAt||0)<500?"aim-smg":s.anim;crowd.set(i,{x:s.x,y:s.y,z:s.z,yaw:s.yaw-Math.PI/2,state:st,speed:s.speed,weapon:"smg",dt});s.proxy.visible=true;s.proxy.position.set(s.x,s.y,s.z);s.proxy.updateMatrixWorld();}crowd.commit?.();}

// ------------------------------------------------------------ hits (player weapons) and blasts
function find(hit){for(let n=hit?.object;n;n=n.parent){if(n.name==="MILITARY_SOLDIER_HIT_PROXY"){const s=soldiers.find(q=>q.proxy===n);if(s)return{s};for(const[peer,r]of remote)for(const rs of r.soldiers)if(rs.proxy===n)return{peer,id:`s${rs.slot}`};}
  if(n.name==="MILITARY_HELI_HIT_PROXY"){const h=helis.find(q=>q.m.proxy===n);if(h)return{h};for(const[peer,r]of remote)for(const[id,u]of r.units)if(u.m?.proxy===n)return{peer,id};}
  if(n.name==="MILITARY_TANK_HIT_PROXY"){const tk=tanks.find(q=>q.m.proxy===n);if(tk)return{tk};for(const[peer,r]of remote)for(const[id,u]of r.units)if(u.m?.proxy===n)return{peer,id};}}return null;}
function damage(f,dmg,dir){if(f.s){f.s.hp-=dmg;if(f.s.hp<=0)killSoldier(f.s,dir);return f.s.hp<=0;}
  if(f.h){f.h.hp-=dmg;if(f.h.hp<=0&&f.h.state!=="down"){f.h.state="down";f.h.v.z=Math.min(f.h.v.z,2);sound("explosion",f.h.p.x,f.h.p.y,f.h.p.z,.8,.8);}return f.h.hp<=0;}
  if(f.tk){f.tk.hp-=dmg;if(f.tk.hp<=0&&!f.tk.dead){const g=f.tk.m.group.position;boom(g.clone().setZ(g.z+1.5),12,100,1);f.tk.dead=true;}return f.tk.hp<=0;}return false;}
function hit(h){const f=find(h);if(!f)return false;const pl=playerTarget()?.position;if(f.peer){sendFx({kind:"mil-hit",to:f.peer,id:f.id,dmg:HIT});window.dispatchEvent(new CustomEvent("arondight:combat-hit-confirm",{detail:{police:true,damage:HIT}}));return true;}
  const dmg=f.tk?4:HIT,dir=f.s&&pl?new THREE.Vector3(f.s.x-pl.x,f.s.y-pl.y,0).normalize():null,killed=damage(f,dmg,dir);window.dispatchEvent(new CustomEvent("arondight:combat-hit-confirm",{detail:{police:true,damage:dmg,killed}}));return true;}
function onExplosion(e){const d=e?.detail||{};if(d.kind==="military")return;const pos=d.position,x=Array.isArray(pos)?+pos[0]:+pos?.x,y=Array.isArray(pos)?+pos[1]:+pos?.y,z=Array.isArray(pos)?+pos[2]:+pos?.z||0;if(!Number.isFinite(x))return;const r=Math.max(2,Math.min(80,Number(d.radiusM)||6)),max=Math.max(40,Number(d.maxDamage)||80);
  for(const s of soldiers){if(s.dead)continue;const dd=Math.hypot(s.x-x,s.y-y);if(dd<r)damage({s},max*(1-dd/r)*1.5+20,new THREE.Vector3(s.x-x,s.y-y,0).normalize());}
  for(const h of helis){const dd=h.p.distanceTo(tmp.set(x,y,z));if(dd<r+4)damage({h},max*(1-dd/(r+4))*2+40);}
  for(const tk of tanks){if(!tk.pose)continue;const dd=Math.hypot(tk.pose.position[0]-x,tk.pose.position[1]-y);if(dd<r+3)damage({tk},max*(1-dd/(r+3))*2.2+30);}}

// ------------------------------------------------------------ escalation
function clearAll(hard=false){for(const h of helis)h.m.group.parent?.remove(h.m.group);for(const tk of tanks){physics()?.removeBody?.(tk.id);tk.m.group.parent?.remove(tk.m.group);}for(const s of soldiers)s.proxy?.parent?.remove(s.proxy);helis=[];tanks=[];soldiers=[];shells=[];if(hard){for(const t of tracers)t.mesh.parent?.remove(t.mesh);tracers=[];}for(let i=0;i<MAX_SOLDIERS;i++)crowd?.hide(i);}
function banner(text){const v=viewport();if(!v)return;let b=document.getElementById("militaryBanner");if(!b){b=document.createElement("div");b.id="militaryBanner";b.style.cssText="position:absolute;left:50%;top:22%;transform:translateX(-50%);z-index:40;padding:10px 18px;border-radius:10px;background:#2c3320e8;border:2px solid #b8c27a;color:#e8f0b8;font:900 16px/1.1 Inter,system-ui,sans-serif;letter-spacing:.12em;pointer-events:none;text-align:center;transition:opacity .4s";v.appendChild(b);}b.textContent=text;b.style.opacity="1";clearTimeout(b._t);b._t=setTimeout(()=>{b.style.opacity="0";},3800);}
function start(nowMs,t){active=true;startedAt=nowMs;nextReinforce=nowMs+50000;wanted()?.setMilitary?.(true);spawnHeli(nowMs,t.position);spawnSquad(nowMs,t.position,SQUAD);spawnTank(nowMs,t.position);banner("⚠ MILITÄR RÜCKT AN");const v=viewport();if(v)v.dataset.militaryResponse="active";}
function stop(){active=false;wanted()?.setMilitary?.(false);for(const h of helis)if(h.state!=="down")h.state="leave";for(const tk of tanks)if(tk.state!=="wreck")tk.state="leave";banner("MILITÄR ZIEHT AB");const v=viewport();if(v)v.dataset.militaryResponse="withdrawing";}

// ------------------------------------------------------------ multiplayer
function session(){return bridge()?.vsSession||null;}
function selfId(){try{return String(session()?.getSelfId?.()||"");}catch{return"";}}
function sendFx(extra){const s=session();if(!s?.sendFx)return;try{s.sendFx({type:"impact",objectId:"military",id:`mil-${Date.now().toString(36)}-${(serial++).toString(36)}`,p:[0,0,0],playerId:selfId()||undefined,...extra});}catch{}}
function broadcast(nowMs){if(nowMs-lastTx<125)return;lastTx=nowMs;const s=session(),peers=Number(s?.peerCount)||s?.getPeerIds?.()?.length||0;if(!peers)return;if(!helis.length&&!tanks.length&&!soldiers.some(q=>!q.dead))return;
  const b=bridge(),geo=(x,y)=>b?.active&&Number.isFinite(b.originLon)?[+(b.originLon+x/(6378137*Math.cos(b.originLat*Math.PI/180))*180/Math.PI).toFixed(7),+(b.originLat+y/6378137*180/Math.PI).toFixed(7)]:[x,y];
  sendFx({kind:"mil-snap",u:[...helis.filter(h=>!h.dead).map(h=>({id:h.id,t:"h",g:geo(h.p.x,h.p.y),z:+h.p.z.toFixed(1),y:+h.yaw.toFixed(2),d:h.state==="down"?1:0})),...tanks.filter(k=>!k.dead&&k.pose).map(k=>({id:k.id,t:"k",g:geo(k.pose.position[0],k.pose.position[1]),z:+k.m.group.position.z.toFixed(1),y:+k.pose.yaw.toFixed(2),r:+k.turret.toFixed(2)}))],s:soldiers.filter(q=>!q.dead).map(q=>({i:q.slot,g:geo(q.x,q.y),y:+q.yaw.toFixed(2),a:q.anim==="aim"||nowMs-(q.lastShotAt||0)<500?1:q.speed>3?2:q.speed>0?3:0}))});}
function toLocal(g){const b=bridge();if(!Array.isArray(g))return[0,0];if(!b?.active||!Number.isFinite(b.originLon))return[+g[0],+g[1]];return[(g[0]-b.originLon)*Math.PI/180*6378137*Math.cos(b.originLat*Math.PI/180),(g[1]-b.originLat)*Math.PI/180*6378137];}
function onFx(e){const pk=e?.detail?.packet,peer=String(e?.detail?.peerId||pk?.playerId||"");if(pk?.objectId!=="military")return;ensureScene();
  if(pk.kind==="tracer"&&Array.isArray(pk.a)){tracer(new THREE.Vector3(...pk.a),new THREE.Vector3(...pk.b));return;}
  if(pk.kind==="shell"&&Array.isArray(pk.a)){const a=new THREE.Vector3(...pk.a),b=new THREE.Vector3(...pk.b);shells.push({p:a,v:b.sub(a).setLength(130),life:3,remote:true});return;}
  if(pk.kind==="mil-hit"){if(pk.to!==selfId())return;const id=String(pk.id||"");if(id.startsWith("s")){const s=soldiers.find(q=>q.slot===Number(id.slice(1))&&!q.dead);if(s)damage({s},Number(pk.dmg)||HIT,null);}else{const h=helis.find(q=>q.id===id),tk=tanks.find(q=>q.id===id);if(h)damage({h},Number(pk.dmg)||HIT);if(tk)damage({tk},4);}return;}
  if(pk.kind!=="mil-snap"||!peer)return;let r=remote.get(peer);if(!r){r={units:new Map(),soldiers:[],seen:0};remote.set(peer,r);}r.seen=performance.now();const live=new Set();
  for(const u of pk.u||[]){live.add(u.id);let m=r.units.get(u.id);if(!m){m={kind:u.t,m:u.t==="h"?buildHeli():buildTank(),p:new THREE.Vector3(),yaw:0,init:false,rotor:0};root.add(m.m.group);r.units.set(u.id,m);}const[x,y]=toLocal(u.g);m.tp=new THREE.Vector3(x,y,+u.z||0);m.ty=+u.y||0;m.tr=+u.r||0;if(!m.init){m.p.copy(m.tp);m.yaw=m.ty;m.init=true;}}
  for(const[id,m]of r.units)if(!live.has(id)){m.m.group.parent?.remove(m.m.group);r.units.delete(id);}
  r.soldiers=(pk.s||[]).map((s,k)=>{const[x,y]=toLocal(s.g);const prev=r.soldiers.find(q=>q.slot===s.i);return{slot:s.i,x,y,z:groundHeightAt(x,y),yaw:+s.y||0,a:s.a,proxy:prev?.proxy||soldierProxy()};});}
function renderRemote(dt){const a=1-Math.exp(-dt*8);let k=0;for(const[peer,r]of remote){if(performance.now()-r.seen>3000){for(const m of r.units.values())m.m.group.parent?.remove(m.m.group);for(const s of r.soldiers)s.proxy?.parent?.remove(s.proxy);remote.delete(peer);continue;}
  for(const m of r.units.values()){m.p.lerp(m.tp,a);m.yaw+=angleTo(m.yaw,m.ty)*a;const g=m.m.group;g.position.copy(m.p);if(m.kind==="h"){g.rotation.set(0,0,m.yaw);m.rotor+=dt*28;m.m.mast.rotation.z=m.rotor;}else{g.position.z=groundHeightAt(m.p.x,m.p.y);g.rotation.set(0,0,m.yaw);m.m.turret.rotation.z=m.tr;}g.updateMatrixWorld();}
  for(const s of r.soldiers){if(k>=16)break;remoteCrowd.set(k++,{x:s.x,y:s.y,z:s.z,yaw:s.yaw-Math.PI/2,state:s.a===1?"aim-smg":s.a===2?"run":s.a===3?"walk":"idle",speed:s.a===2?3.8:s.a===3?2.4:0,weapon:"smg",dt});s.proxy.visible=true;s.proxy.position.set(s.x,s.y,s.z);s.proxy.updateMatrixWorld();}}
  for(;k<16;k++)remoteCrowd?.hide(k);remoteCrowd?.commit?.();}

// ------------------------------------------------------------ loop
let lastFrame=performance.now();
function frame(nowMs=performance.now()){requestAnimationFrame(frame);const dt=Math.min(.05,Math.max(0,(nowMs-lastFrame)/1000));lastFrame=nowMs;if(!bridge()?.threeScene||!ensureScene())return;
  const st=wanted()?.state,t=globalThis.__jetMode?.active?null:playerTarget();// a pilot in the jet is out of their reach
  if(st&&t){if(st.stars>=5){since5||=nowMs;}else since5=0;
    if(!active&&!alertAt&&st.stars>=5&&((st.heat>=TRIGGER_HEAT&&nowMs-since5>TRIGGER_HOLD_MS)||st.heat>=TRIGGER_EXTREME_HEAT)){alertAt=nowMs;banner("⚠ MILITÄR ALARMIERT");const v=viewport();if(v)v.dataset.militaryResponse="alert";}
    else if(alertAt&&!active&&st.stars<5){alertAt=0;banner("MILITÄR-ALARM AUFGEHOBEN");const v=viewport();if(v)v.dataset.militaryResponse="alert-cancelled";}
    else if(alertAt&&!active&&nowMs-alertAt>ALERT_MS){alertAt=0;start(nowMs,t);}
    else if(active&&st.stars<=END_STARS)stop();
    if(active&&nowMs>nextReinforce){nextReinforce=nowMs+45000;if(helis.filter(h=>!h.dead&&h.state!=="down").length<2)spawnHeli(nowMs,t.position);if(soldiers.filter(s=>!s.dead).length<MAX_SOLDIERS-1)spawnSquad(nowMs,t.position,2);if(!tanks.some(k=>!k.dead&&k.state!=="wreck"))spawnTank(nowMs,t.position);}}
  else if(active&&!t){/* player down: hold fire, they stay */}
  if(t){for(const h of helis)stepHeli(h,t,nowMs,dt);for(const tk of tanks)stepTank(tk,t,nowMs,dt);for(const s of soldiers)stepSoldier(s,t,nowMs,dt);}
  for(let i=helis.length-1;i>=0;i--)if(helis[i].dead){helis[i].m.group.parent?.remove(helis[i].m.group);helis.splice(i,1);}
  for(let i=tanks.length-1;i>=0;i--)if(tanks[i].dead){physics()?.removeBody?.(tanks[i].id);tanks[i].m.group.parent?.remove(tanks[i].m.group);tanks.splice(i,1);}
  if(!active){const pl=t?.position;for(const s of soldiers)if(!s.dead&&pl&&Math.hypot(s.x-pl.x,s.y-pl.y)>140&&!inView(s.x,s.y,s.z+1)){s.dead=true;s.proxy.visible=false;}}
  soldiers=soldiers.filter(s=>!(s.dead&&!s.proxy.visible&&(s.proxy.parent?.remove(s.proxy),true)));
  stepShells(dt);for(const tr of tracers)if(tr.mesh.visible&&nowMs>tr.until)tr.mesh.visible=false;renderSoldiers(dt);if(remote.size)renderRemote(dt);broadcast(nowMs);
  for(const h of helis)if(nowMs%400<200)requestLight(h.p,{color:0xff3020,intensity:2,distance:12});
  const v=viewport();if(v)v.dataset.military=`${active?"on":"off"}/${helis.length}h/${tanks.length}t/${soldiers.filter(s=>!s.dead).length}s`;}
export function installMilitaryResponse(){if(globalThis.__militaryResponse||typeof window==="undefined")return;
  globalThis.__militaryResponse={version:MILITARY_RESPONSE_VERSION,hit,get active(){return active;},start(){const t=playerTarget();if(t)start(performance.now(),t);},stop,get units(){return{helis:helis.map(h=>({id:h.id,state:h.state,hp:h.hp,p:h.p.toArray().map(v=>+v.toFixed(1))})),tanks:tanks.map(k=>({id:k.id,hp:k.hp,state:k.state,p:k.pose?.position?.map(v=>+v.toFixed(1))})),soldiers:soldiers.filter(s=>!s.dead).map(s=>({slot:s.slot,hp:s.hp,x:+s.x.toFixed(1),y:+s.y.toFixed(1)}))};}};
  addEventListener("arondight:world-explosion",onExplosion);addEventListener(VS_FX_EVENT,onFx);addEventListener("arondight:world-reset",()=>{if(active)stop();clearAll();});
  (globalThis.__prewarmFactories??=[]).push(()=>{const g=new THREE.Group();g.add(buildHeli().group,buildTank().group);return g;});requestAnimationFrame(frame);}
installMilitaryResponse();
