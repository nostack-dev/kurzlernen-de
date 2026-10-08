import * as THREE from "three";
import {vehicleGeometry,vehicleMaterial,wheelGeometry} from "./vehicle_models.mjs";
import {createCrowd} from "./crowd_characters.mjs";
import {wantedLineBlockedByPrisms,wantedPointInRing,wantedPoliceDamage,wantedPoliceHitChance} from "./wanted_system_logic.mjs";
import {groundHeightAt} from "./terrain_craters.mjs";
import {spawnWorldPersonRagdoll} from "./world_person_ragdoll.mjs";
import {getSharedCombatAudioContext,playCombatAudio} from "./combat_audio_bank.mjs";
import {VS_FX_EVENT} from "./lan_vs.mjs";

// GTA-style ground police. With a wanted level, police cruisers come after the
// player on the road network (A* over the real road graph, then straight at
// the player once in sight). They are real Box3D cars (same wheeled vehicle
// as all traffic). Close to a player on foot they brake, the officers get
// out, run after him and shoot with pistols from cover distance; when the
// player drives off or gets too far they run back, get in and give chase
// again. Officers are the same articulated people as everyone (police
// outfit, instanced), can be shot (ragdoll = same model) and blown up; a
// cruiser whose crew is dead is left behind and can be stolen.
//
// Multiplayer: every client runs the police after its own player and sends
// a compact snapshot (10 Hz) of its cruisers and officers; the others draw
// them as puppets (interpolated) with the same models, shots and lights, and
// hits on a remote officer are sent to the client that owns him.

export const POLICE_GROUND_VERSION="gta-police-cruisers+officers-v1";
const MAX_UNITS=3,COPS_PER_UNIT=2,MAX_COPS=MAX_UNITS*COPS_PER_UNIT,REMOTE_COPS=18,COP_HP=100,HIT_DAMAGE=25;
const RUN_MPS=3.7,STOP_FOOT_M=17,ENGAGE_MIN_M=6,ENGAGE_MAX_M=15,RETURN_M=42,SPAWN_MIN_M=70,SPAWN_MAX_M=125,DESPAWN_M=230;
const SYNC_MS=100,PATH_MS=1800,SIGHT_MS=300;
const POLICE_COLORS=[0xc8956f,0xa87052,0x7b4a33,0xd2a27e].map(skin=>({shirt:0x24314f,vest:0x15181e,pants:0x1b2230,boots:0x0f1012,skin,gloves:0x15161a,helmet:0x161c2b,dark:0x111214}));
const bridge=()=>globalThis.__arondightRealWorld||null;
const physics=()=>globalThis.__arondightWorldRigidBodies||null;
const wanted=()=>globalThis.__arondightWantedSystem||null;
const viewport=()=>document.getElementById("viewport");
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const angleTo=(a,b)=>{let d=b-a;while(d>Math.PI)d-=2*Math.PI;while(d<-Math.PI)d+=2*Math.PI;return d;};

let sceneRef=null,root=null,crowd=null,remoteCrowd=null,units=[],serial=0,lastFrame=performance.now(),lastSync=0,lastSight=0,graph=null,graphAt=-Infinity,proxyGeo=null,proxyMat=null;
const remote=new Map(); // peerId -> {units:Map, seen}
const tmpV=new THREE.Vector3(),up=new THREE.Vector3(),wq=new THREE.Quaternion(),wp=new THREE.Vector3();

// ------------------------------------------------------------ player / world
function playerTarget(){const t=globalThis.__arondightPlayerVitals?.damageTargets?.()?.find(x=>x.kind==="player");return t&&Number(t.hp)>0?t:null;}
function playerDriving(){return Boolean(globalThis.__arondightVehicleDrive?.active);}
function prisms(){return bridge()?.buildingCollisionSnapshot?.prisms||[];}
function blocked(a,b){return wantedLineBlockedByPrisms(a,b,prisms());}
function insideBuilding(x,y){for(const pr of prisms()){const pts=pr.points;if(!pts||pts.length<3)continue;if(Math.abs(x-pts[0][0])>120||Math.abs(y-pts[0][1])>120)continue;if(wantedPointInRing(x,y,pts))return true;}return false;}

// ------------------------------------------------------------ road graph + A*
function roadGraph(now){
  if(graph&&now-graphAt<5000)return graph;const routes=globalThis.__arondightProceduralPopulation?.roads?.()||[];graphAt=now;
  const nodes=new Map(),key=(x,y)=>`${Math.round(x/2)},${Math.round(y/2)}`,node=(x,y)=>{const k=key(x,y);let n=nodes.get(k);if(!n){n={x,y,adj:[]};nodes.set(k,n);}return n;};
  for(const r of routes)for(const s of r.segments||[]){const a=node(s.a[0],s.a[1]),b=node(s.a[0]+s.dx,s.a[1]+s.dy);if(a===b)continue;a.adj.push([b,s.d]);b.adj.push([a,s.d]);}
  graph={nodes:[...nodes.values()]};return graph;
}
function nearestNode(g,x,y){let best=null,bd=Infinity;for(const n of g.nodes){const d=(n.x-x)**2+(n.y-y)**2;if(d<bd){bd=d;best=n;}}return best;}
function findPath(g,sx,sy,tx,ty){
  const a=nearestNode(g,sx,sy),b=nearestNode(g,tx,ty);if(!a||!b)return null;if(a===b)return[{x:tx,y:ty}];
  const open=[a],inOpen=new Set([a]),gs=new Map([[a,0]]),from=new Map(),h=n=>Math.hypot(n.x-b.x,n.y-b.y),fs=new Map([[a,h(a)]]),closed=new Set();let it=0;
  while(open.length&&it++<4000){let bi=0;for(let i=1;i<open.length;i++)if(fs.get(open[i])<fs.get(open[bi]))bi=i;const cur=open[bi];open[bi]=open[open.length-1];open.pop();inOpen.delete(cur);if(cur===b)break;closed.add(cur);
    for(const[n,w]of cur.adj){if(closed.has(n))continue;const g2=gs.get(cur)+w;if(g2<(gs.get(n)??Infinity)){gs.set(n,g2);fs.set(n,g2+h(n));from.set(n,cur);if(!inOpen.has(n)){open.push(n);inOpen.add(n);}}}}
  if(!from.has(b))return null;const path=[{x:tx,y:ty}];for(let n=b;n;n=from.get(n))path.unshift({x:n.x,y:n.y});return path;
}

// ------------------------------------------------------------ visuals
function ensureScene(){
  const scene=bridge()?.threeScene;if(!scene)return false;if(scene===sceneRef&&root?.parent===scene)return true;
  for(const u of units)removeUnit(u,true);units=[];root?.parent?.remove(root);crowd?.dispose?.();remoteCrowd?.dispose?.();for(const r of remote.values())for(const u of r.units.values())u.car?.parent?.remove(u.car);remote.clear();
  sceneRef=scene;root=new THREE.Group();root.name="POLICE_GROUND_UNITS";scene.add(root);
  crowd=createCrowd(scene,{capacity:MAX_COPS,outfit:"police",name:"POLICE_OFFICERS"});remoteCrowd=createCrowd(scene,{capacity:REMOTE_COPS,outfit:"police",name:"POLICE_OFFICERS_REMOTE"});
  for(let i=0;i<MAX_COPS;i++)crowd.setColors(i,POLICE_COLORS[i%POLICE_COLORS.length]);for(let i=0;i<REMOTE_COPS;i++)remoteCrowd.setColors(i,POLICE_COLORS[i%POLICE_COLORS.length]);
  return true;
}
let carTop=null;const lightMats={red:new THREE.MeshBasicMaterial({color:0x330608}),blue:new THREE.MeshBasicMaterial({color:0x06102e})};
function buildCruiser(){
  const g=new THREE.Group();g.name="POLICE_CRUISER";const geo=vehicleGeometry("car",0x111419);const body=new THREE.Mesh(geo,vehicleMaterial);body.castShadow=true;g.add(body);
  if(carTop==null){geo.computeBoundingBox();carTop=geo.boundingBox.max.z;}
  const white=new THREE.MeshStandardMaterial({color:0xeef0f2,roughness:.4,metalness:.2});
  for(const s of[-1,1]){const door=new THREE.Mesh(new THREE.BoxGeometry(1.7,.02,.42),white);door.position.set(-.05,s*.83,.62);g.add(door);}
  const bar=new THREE.Group();bar.position.set(-.15,0,carTop+.06);g.add(bar);
  const base=new THREE.Mesh(new THREE.BoxGeometry(.32,1.05,.08),new THREE.MeshStandardMaterial({color:0x1a1c20,roughness:.5}));bar.add(base);
  const red=new THREE.Mesh(new THREE.BoxGeometry(.26,.44,.1),new THREE.MeshBasicMaterial({color:0x330608}));red.position.set(0,.25,.05);const blue=new THREE.Mesh(new THREE.BoxGeometry(.26,.44,.1),new THREE.MeshBasicMaterial({color:0x06102e}));blue.position.set(0,-.25,.05);bar.add(red,blue);
  const light=new THREE.PointLight(0xff2030,0,18,2);light.position.set(0,0,.4);bar.add(light);
  const wheels=[];const wg=wheelGeometry();for(const[x,y]of[[1.2,.78],[1.2,-.78],[-1.15,.78],[-1.15,-.78]]){const w=new THREE.Mesh(wg,vehicleMaterial);w.castShadow=true;w.position.set(x,y,.34);g.add(w);wheels.push(w);}
  g.traverse(n=>{n.userData.flightFireIgnore=n!==body&&n.isMesh;});
  return{group:g,body,red,blue,light,wheels};
}
function flashLights(c,now,on){const slot=Math.floor(now/110)%6,r=on&&(slot===0||slot===2),b=on&&(slot===3||slot===5);c.red.material.color.setHex(r?0xff1a2a:0x330608);c.blue.material.color.setHex(b?0x2a6bff:0x06102e);c.light.intensity=r||b?14:0;c.light.color.setHex(r?0xff2030:0x2a6bff);}
function makeProxy(){proxyGeo??=(()=>{const g=new THREE.CapsuleGeometry(.27,1.2,3,8);g.rotateX(Math.PI/2);g.translate(0,0,.86);return g;})();proxyMat??=Object.assign(new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false}),{colorWrite:false,visible:false});
  const m=new THREE.Mesh(proxyGeo,proxyMat);m.name="POLICE_OFFICER_HIT_PROXY";m.userData.worldPopulationKind="enemy";m.userData.styleSkip=true;m.visible=false;root.add(m);return m;}

// ------------------------------------------------------------ audio / shots
function playShot(x,y,z){try{const ctx=getSharedCombatAudioContext();if(!ctx||ctx.state!=="running")return;const pl=playerTarget()?.position,d=pl?Math.hypot(pl.x-x,pl.y-y,(pl.z||0)-z):30;playCombatAudio(ctx,"pistol",{gain:clamp(.55/(1+d*.06),.04,.5),minIntervalMs:25});}catch{}}
let tracers=[];
function tracer(from,to){if(!root)return;let t=tracers.find(x=>!x.mesh.visible);if(!t){if(tracers.length>=12)t=tracers[0];else{const m=new THREE.Mesh(new THREE.CylinderGeometry(.012,.012,1,5,1,true),new THREE.MeshBasicMaterial({color:0xffd27a,transparent:true,opacity:.85,blending:THREE.AdditiveBlending,depthWrite:false}));m.userData.flightFireIgnore=true;m.raycast=()=>{};root.add(m);t={mesh:m,until:0};tracers.push(t);}}
  tmpV.subVectors(to,from);const len=tmpV.length();if(len<.1)return;t.mesh.position.copy(from).addScaledVector(tmpV,.5);t.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),tmpV.normalize());t.mesh.scale.set(1,len,1);t.mesh.visible=true;t.until=performance.now()+70;}
function stepTracers(now){for(const t of tracers)if(t.mesh.visible&&now>t.until)t.mesh.visible=false;}

// ------------------------------------------------------------ units
function spawnUnit(player,now){
  const g=roadGraph(now),px=player.position.x,py=player.position.y;let spot=null;
  const cands=g.nodes.filter(n=>{const d=Math.hypot(n.x-px,n.y-py);return d>SPAWN_MIN_M&&d<SPAWN_MAX_M&&!insideBuilding(n.x,n.y);});
  for(let k=0;k<12&&cands.length&&!spot;k++){const n=cands[(Math.random()*cands.length)|0];if(blocked({x:n.x,y:n.y,z:1.2},{x:px,y:py,z:1.4})||k>8)spot=n;}
  if(!spot){const a=Math.random()*Math.PI*2;for(let r=90;r>40&&!spot;r-=10){const x=px+Math.cos(a)*r,y=py+Math.sin(a)*r;if(!insideBuilding(x,y))spot={x,y};}}
  if(!spot)return null;const firstLeg=findPath(g,spot.x,spot.y,px,py),nxt=firstLeg?.find(q=>Math.hypot(q.x-spot.x,q.y-spot.y)>3)||{x:px,y:py};const yaw=Math.atan2(nxt.y-spot.y,nxt.x-spot.x),id=`police-car-${(++serial).toString(36)}`,z=groundHeightAt(spot.x,spot.y);
  if(!physics()?.upsertBody?.({id,kind:"car",position:[spot.x,spot.y,z+.62],yaw,halfExtents:[1.78,.82,.36],massKg:1450}))return null;
  const c=buildCruiser();root.add(c.group);c.group.position.set(spot.x,spot.y,z);c.group.rotation.set(0,0,yaw);
  c.group.userData.policeCruiser=id;
  const used=new Set(units.flatMap(u=>u.cops.map(cp=>cp.slot)));const cops=[];for(let s=0,k=0;s<MAX_COPS&&k<COPS_PER_UNIT;s++)if(!used.has(s)){cops.push({slot:s,seat:k?-1:1,state:"in",hp:COP_HP,x:spot.x,y:spot.y,z,yaw,speed:0,nextShot:0,shots:0,aim:null,proxy:makeProxy()});k++;}
  const u={id,car:c,cops,state:"pursuit",path:null,pathAt:-Infinity,wp:0,stuckSince:0,recoverUntil:0,born:now,lights:true,pose:null};units.push(u);return u;
}
function removeUnit(u,hard=false){physics()?.removeBody?.(u.id);u.car.group.parent?.remove(u.car.group);for(const c of u.cops){c.proxy?.parent?.remove(c.proxy);if(crowd)crowd.hide(c.slot);}}
function carPose(u){const p=physics()?.pose?.(u.id,u.pose);if(p)u.pose=p;return p;}
function syncCar(u,now){
  const p=carPose(u),g=u.car.group;if(!p)return;const q=p.rotation,off=Number(p.groundOffset)||.6;g.quaternion.set(q[0],q[1],q[2],q[3]);up.set(0,0,1).applyQuaternion(g.quaternion);g.position.set(p.position[0]-up.x*off,p.position[1]-up.y*off,p.position[2]-up.z*off);
  g.updateMatrixWorld(true);if(p.wheels?.length===4){const inv=new THREE.Matrix4().copy(g.matrixWorld).invert();for(let i=0;i<4;i++){const w=p.wheels[i];wp.set(w.position[0],w.position[1],w.position[2]).applyMatrix4(inv);wq.set(w.rotation[0],w.rotation[1],w.rotation[2],w.rotation[3]);u.car.wheels[i].position.copy(wp);u.car.wheels[i].quaternion.copy(g.quaternion).invert().multiply(wq);}}
  flashLights(u.car,now,u.lights);
}
const speedOf=p=>p?Math.hypot(p.velocity[0],p.velocity[1]):0;
function driveTo(u,tx,ty,speed){physics()?.setDrive?.(u.id,null);physics()?.setTarget?.(u.id,{position:[tx,ty,0],yaw:0,speedMps:speed});}
function brake(u){physics()?.clearTarget?.(u.id);physics()?.setDrive?.(u.id,{pedal:0,steer:0,handbrake:true});}
function updatePursuit(u,player,now,dt){
  const p=u.pose;if(!p)return;const cx=p.position[0],cy=p.position[1],px=player.position.x,py=player.position.y,d=Math.hypot(px-cx,py-cy),sp=speedOf(p);
  const seen=d<45&&!blocked({x:cx,y:cy,z:1.3},{x:px,y:py,z:1.3});
  // stuck against something: back out with the wheel turned, then go again
  // three-point turn: reversing with the wheel turned the other way swings the
  // nose towards the target (backwards, steering right turns the car left)
  const herr=angleTo(p.yaw,Math.atan2((u.lastTy??py)-cy,(u.lastTx??px)-cx));
  if(now<u.recoverUntil){if(Math.abs(herr)<.45&&now-u.recoverStart>500)u.recoverUntil=0;else{physics()?.clearTarget?.(u.id);physics()?.setDrive?.(u.id,{pedal:-.8,steer:-Math.sign(herr||1),handbrake:false,maxReverse:5});return;}}
  if(sp<1.2&&Math.abs(herr)>1.05&&d>STOP_FOOT_M){u.turnSince||=now;if(now-u.turnSince>700){u.recoverStart=now;u.recoverUntil=now+2200;u.turnSince=0;return;}}else u.turnSince=0;
  if(sp<.7&&d>STOP_FOOT_M){u.stuckSince||=now;if(now-u.stuckSince>2000){u.recoverStart=now;u.recoverUntil=now+1600;u.stuckSince=0;u.path=null;return;}}else u.stuckSince=0;
  // no progress (scraping along a wall): back out and plan again
  if(!u.progress||now-u.progress.t>4000){if(u.progress&&d>STOP_FOOT_M&&Math.hypot(cx-u.progress.x,cy-u.progress.y)<6){u.recoverStart=now;u.recoverUntil=now+1600;u.path=null;}u.progress={t:now,x:cx,y:cy};}
  if(!playerDriving()&&d<STOP_FOOT_M&&seen){u.state="stopping";brake(u);return;}
  if(playerDriving()&&d<9&&sp<1.5&&seen&&player.speedMps<2){u.state="stopping";brake(u);return;}
  let tx=px,ty=py;
  if(!seen||d>40){if(!u.path||now-u.pathAt>PATH_MS){u.path=findPath(roadGraph(now),cx,cy,px,py);u.pathAt=now;u.wp=0;}
    if(u.path?.length){const t=pursuitPoint(u.path,cx,cy,Math.max(8,sp*1.1));tx=t.x;ty=t.y;
      // slow down before corners: heading change between here→look-ahead and look-ahead→further on
      const f=pursuitPoint(u.path,cx,cy,Math.max(22,sp*2.2)),h1=Math.atan2(ty-cy,tx-cx),h2=Math.atan2(f.y-ty,f.x-tx),turn=Math.abs(angleTo(h1,h2));u.cornerSpeed=clamp(17-turn/(Math.PI/2)*12,5,17);}}
  else u.cornerSpeed=17;
  u.lastTx=tx;u.lastTy=ty;driveTo(u,tx,ty,Math.min(u.cornerSpeed??17,d>70?17:d>30?13:8));
}
// pure pursuit along the road polyline: project the car on the path and aim a
// look-ahead distance further along it — the cruiser stays on the road line
// instead of cutting corners into buildings.
function pursuitPoint(path,x,y,look){
  let bi=0,bt=0,bd=Infinity;for(let i=0;i<path.length-1;i++){const a=path[i],b=path[i+1],dx=b.x-a.x,dy=b.y-a.y,l2=dx*dx+dy*dy||1e-6,t=clamp(((x-a.x)*dx+(y-a.y)*dy)/l2,0,1),px=a.x+dx*t,py=a.y+dy*t,d=Math.hypot(x-px,y-py);if(d<bd){bd=d;bi=i;bt=t;}}
  if(path.length<2)return path[0];let i=bi,t=bt,left=look;
  while(i<path.length-1){const a=path[i],b=path[i+1],l=Math.hypot(b.x-a.x,b.y-a.y)||1e-6,rest=(1-t)*l;if(rest>=left){const tt=t+left/l;return{x:a.x+(b.x-a.x)*tt,y:a.y+(b.y-a.y)*tt};}left-=rest;i++;t=0;}
  return path.at(-1);
}
function exitCar(u,now){
  const p=u.pose;if(!p)return;const yaw=p.yaw,fx=Math.cos(yaw),fy=Math.sin(yaw),lx=-fy,ly=fx;
  for(const c of u.cops){if(c.state!=="in")continue;const s=c.seat;let x=p.position[0]+fx*.25+lx*1.35*s,y=p.position[1]+fy*.25+ly*1.35*s;if(insideBuilding(x,y)){x=p.position[0]-fx*2.6;y=p.position[1]-fy*2.6;}c.x=x;c.y=y;c.z=groundHeightAt(x,y);c.yaw=yaw+s*Math.PI/2;c.state="out";c.nextShot=now+700+Math.random()*500;}
  u.state="engage";
}
function stepCop(c,u,player,now,dt,stars){
  const px=player.position.x,py=player.position.y,dx=px-c.x,dy=py-c.y,d=Math.hypot(dx,dy);
  const eye={x:c.x,y:c.y,z:c.z+1.45},aimAt={x:px,y:py,z:(player.position.z||1.68)-.35};
  if(now-(c.losAt||0)>SIGHT_MS){c.losAt=now;c.los=d<60&&!blocked(eye,aimAt);}
  let move=null;c.anim="idle";
  if(u.state==="return"){const p=u.pose;if(p){const tx=p.position[0],ty=p.position[1],dd=Math.hypot(tx-c.x,ty-c.y);if(dd<1.9){c.state="in";return;}move=[(tx-c.x)/dd,(ty-c.y)/dd];}}
  else if(!c.los||d>ENGAGE_MAX_M)move=d>.1?[dx/d,dy/d]:null;
  else if(d<ENGAGE_MIN_M)move=d>.1?[-dx/d*.6,-dy/d*.6]:null;
  if(move){const sp=u.state==="return"?RUN_MPS:(d>ENGAGE_MAX_M+10?RUN_MPS:2.4)*Math.hypot(move[0],move[1]);let ang=Math.atan2(move[1],move[0]),ok=false;
    for(const off of[0,.5,-.5,1,-1,1.6,-1.6]){const a=ang+off,nx=c.x+Math.cos(a)*sp*dt,ny=c.y+Math.sin(a)*sp*dt;if(!insideBuilding(nx,ny)){c.x=nx;c.y=ny;ang=a;ok=true;break;}}
    c.z=groundHeightAt(c.x,c.y);c.speed=ok?sp:0;const face=c.los&&u.state!=="return"&&d<ENGAGE_MAX_M+8?Math.atan2(dy,dx):ang;c.yaw+=angleTo(c.yaw,face)*Math.min(1,dt*10);c.anim=ok?(sp>3?"run":"walk"):"idle";}
  else{c.speed=0;c.yaw+=angleTo(c.yaw,Math.atan2(dy,dx))*Math.min(1,dt*12);c.anim="aim";}
  // shoot when in range and in sight (also while backing off / closing in)
  if(u.state!=="return"&&c.los&&d<ENGAGE_MAX_M+12&&now>=c.nextShot&&Math.abs(angleTo(c.yaw,Math.atan2(dy,dx)))<.35){
    c.nextShot=now+Math.max(520,950-stars*70)+Math.random()*420;c.shots++;c.lastShotAt=now;c.anim="aim";
    const fx=Math.cos(c.yaw),fy=Math.sin(c.yaw),from=new THREE.Vector3(c.x+fx*.45-fy*.12,c.y+fy*.45+fx*.12,c.z+1.38);
    const hit=Math.random()<wantedPoliceHitChance({stars,distanceM:d,playerSpeedMps:player.speedMps||0})*.85;let to;
    if(hit){to=new THREE.Vector3(aimAt.x,aimAt.y,aimAt.z);const dmg=Math.max(2,Math.round(wantedPoliceDamage(stars)*.6));const t=playerTarget();if(t?.model?.damage)t.model.damage(dmg,"police-officer");else window.dispatchEvent(new CustomEvent("arondight:player-damage",{detail:{damage:dmg,source:"police-officer"}}));window.dispatchEvent(new CustomEvent("arondight:combat-damage",{detail:{damage:dmg,source:"police-officer",target:"player"}}));}
    else{to=new THREE.Vector3(aimAt.x+(Math.random()-.5)*2.4,aimAt.y+(Math.random()-.5)*2.4,aimAt.z+(Math.random()-.6)*1.4);const dir=to.clone().sub(from).normalize();to.copy(from).addScaledVector(dir,d+6);globalThis.__worldImpacts?.bullet?.({origin:from,direction:dir},null,{maxDistance:d+12});}
    c.aim=[to.x,to.y,to.z];tracer(from,to);playShot(from.x,from.y,from.z);
  }
}
function killCop(c,u,dir=null){
  if(c.state==="dead")return;c.state="dead";c.hp=0;crowd?.hide(c.slot);c.proxy.visible=false;
  const ix=dir?dir.x*3:0,iy=dir?dir.y*3:0;spawnWorldPersonRagdoll({position:[c.x,c.y,c.z+.05],yaw:c.yaw-Math.PI/2,impulse:[ix,iy,2.2],seed:`cop-${c.slot}-${serial}`,id:`cop-${u.id}-${c.slot}`,colors:POLICE_COLORS[c.slot%POLICE_COLORS.length]});
  wanted()?.reportCrime?.({id:`cop-${u.id}-${c.slot}-${Date.now()}`,kind:"police-officer"});
  window.dispatchEvent(new CustomEvent("arondight:combat-hit-confirm",{detail:{police:true,killed:true,officer:true}}));
}
// A cruiser without a crew stays where it is: the player can take it.
function abandon(u){u.state="abandoned";u.lights=false;brake(u);const g=u.car.group;Object.assign(g.userData,{worldPopulationKind:"car",worldPopulationId:u.id,worldProceduralId:u.id,gtaDrivableVehicle:true});}
function updateUnit(u,player,now,dt,stars){
  syncCar(u,now);const alive=u.cops.filter(c=>c.state!=="dead");
  if(u.state!=="abandoned"&&!alive.length)abandon(u);
  if(u.state==="abandoned"){if(u.car.group.userData.playerDriven){u.lights=true;}return;}
  const p=u.pose;const pd=p&&player?Math.hypot(player.position.x-p.position[0],player.position.y-p.position[1]):Infinity;
  if(!player||stars<=0){ // called off: get in and leave
    if(alive.some(c=>c.state==="out"))u.state="return";else{u.state="leave";u.lights=false;if(p){const a=Math.atan2(p.position[1]-(player?.position.y??0),p.position[0]-(player?.position.x??0));driveTo(u,p.position[0]+Math.cos(a)*60,p.position[1]+Math.sin(a)*60,12);}}}
  if(u.state==="pursuit")updatePursuit(u,player,now,dt);
  else if(u.state==="stopping"){brake(u);if(speedOf(p)<1.2){if(playerDriving()&&pd>12)u.state="pursuit";else exitCar(u,now);}}
  else if(u.state==="engage"){brake(u);const far=alive.every(c=>c.state!=="out"||Math.hypot(player.position.x-c.x,player.position.y-c.y)>RETURN_M);if(playerDriving()&&(player.speedMps>4||pd>20)||far)u.state="return";}
  else if(u.state==="return"){brake(u);if(alive.every(c=>c.state==="in"))u.state=stars>0?"pursuit":"leave";}
  for(const c of u.cops){if(c.state!=="out")continue;if(player)stepCop(c,u,player,now,dt,stars);}
}
function renderCops(now,dt){
  if(!crowd)return;const shown=new Set();
  for(const u of units)for(const c of u.cops){if(c.state!=="out"){crowd.hide(c.slot);c.proxy.visible=false;continue;}shown.add(c.slot);
    const st=c.anim==="aim"||now-(c.lastShotAt||0)<400?"aim-pistol":c.anim==="run"?"run":c.anim==="walk"?"walk":"idle";
    crowd.set(c.slot,{x:c.x,y:c.y,z:c.z,yaw:c.yaw-Math.PI/2,state:st,speed:c.speed,weapon:"pistol",dt});c.proxy.visible=true;c.proxy.position.set(c.x,c.y,c.z);c.proxy.updateMatrixWorld();}
  crowd.commit();
}

// ------------------------------------------------------------ damage in
function findCop(hit){for(let n=hit?.object;n;n=n.parent){if(n.name==="POLICE_OFFICER_HIT_PROXY"){for(const u of units)for(const c of u.cops)if(c.proxy===n)return{u,c};for(const[peer,r]of remote)for(const ru of r.units.values())for(const rc of ru.cops)if(rc.proxy===n)return{peer,ru,rc};}}return null;}
function hit(h){
  const f=findCop(h);if(!f)return false;const pl=playerTarget()?.position,dir=f.c&&pl?new THREE.Vector3(f.c.x-pl.x,f.c.y-pl.y,0).normalize():null;
  if(f.peer){sendFx({kind:"police-hit",to:f.peer,unit:f.ru.id,slot:f.rc.slot,dmg:HIT_DAMAGE});window.dispatchEvent(new CustomEvent("arondight:combat-hit-confirm",{detail:{police:true,damage:HIT_DAMAGE}}));return true;}
  f.c.hp-=HIT_DAMAGE;window.dispatchEvent(new CustomEvent("arondight:combat-hit-confirm",{detail:{police:true,damage:HIT_DAMAGE,hp:Math.max(0,f.c.hp),killed:f.c.hp<=0}}));if(f.c.hp<=0)killCop(f.c,f.u,dir);return true;
}
function onExplosion(e){const d=e?.detail||{},pos=d.position,x=Array.isArray(pos)?+pos[0]:+pos?.x,y=Array.isArray(pos)?+pos[1]:+pos?.y;if(!Number.isFinite(x))return;const r=Math.max(2,Math.min(60,Number(d.radiusM)||6));
  for(const u of units)for(const c of u.cops){if(c.state!=="out")continue;const dd=Math.hypot(c.x-x,c.y-y);if(dd<r){c.hp-=COP_HP*(1-dd/r)*1.6+20;if(c.hp<=0)killCop(c,u,new THREE.Vector3(c.x-x,c.y-y,0).normalize());}}}

// ------------------------------------------------------------ multiplayer
function session(){return bridge()?.vsSession||null;}
function selfId(){try{return String(session()?.getSelfId?.()||"");}catch{return"";}}
function localOffset(){const b=bridge(),o=b?.__vsRespawnLocalOffset;return !b?.active&&Array.isArray(o)&&o.length===2?[Number(o[0])||0,Number(o[1])||0]:[0,0];}
const toCanon=(x,y)=>{const o=localOffset();return[+(x+o[0]).toFixed(2),+(y+o[1]).toFixed(2)];};
const toLocal=(x,y)=>{const o=localOffset();return[x-o[0],y-o[1]];};
function sendFx(extra){const s=session();if(!s?.sendFx)return false;try{return s.sendFx({type:"impact",objectId:"police-ground",id:`pol-${Date.now().toString(36)}-${(serial++).toString(36)}`,p:[0,0,0],playerId:selfId()||undefined,...extra});}catch{return false;}}
function broadcast(now){
  if(now-lastSync<SYNC_MS)return;lastSync=now;const s=session();const peers=typeof s?.peerCount==="function"?s.peerCount():Number(s?.peerCount)||s?.getPeerIds?.()?.length||0;if(!s?.sendFx||!peers)return;
  const list=units.map(u=>{const g=u.car.group,[x,y]=toCanon(g.position.x,g.position.y);return[u.id,x,y,+g.position.z.toFixed(2),+g.rotation.z.toFixed(3),u.lights?1:0,u.cops.filter(c=>c.state==="out").map(c=>{const[cx,cy]=toCanon(c.x,c.y);return[c.slot,cx,cy,+c.z.toFixed(2),+c.yaw.toFixed(2),c.anim==="aim"||now-(c.lastShotAt||0)<400?2:c.anim==="run"?1:0,c.shots,c.aim?toCanon(c.aim[0],c.aim[1]).concat(+c.aim[2].toFixed(2)):null];})];});
  sendFx({kind:"police-sync",units:list});
}
function onFx(event){const pk=event?.detail?.packet,peer=String(event?.detail?.peerId||pk?.playerId||"");if(!pk||pk.objectId!=="police-ground")return;
  if(pk.kind==="police-hit"){if(pk.to&&pk.to!==selfId())return;const u=units.find(x=>x.id===pk.unit),c=u?.cops.find(x=>x.slot===pk.slot);if(c&&c.state==="out"){c.hp-=Number(pk.dmg)||HIT_DAMAGE;if(c.hp<=0)killCop(c,u,null);}return;}
  if(pk.kind!=="police-sync"||!Array.isArray(pk.units)||!peer)return;ensureScene();let r=remote.get(peer);if(!r){r={units:new Map(),seen:0};remote.set(peer,r);}r.seen=performance.now();const live=new Set();
  for(const e of pk.units.slice(0,MAX_UNITS)){const[id,cx,cy,cz,cyaw,lights,cops]=e;if(typeof id!=="string")continue;live.add(id);let ru=r.units.get(id);if(!ru){const car=buildCruiser();root.add(car.group);ru={id,car,cops:[],x:0,y:0,z:0,yaw:0,init:false};r.units.set(id,ru);}
    const[lx,ly]=toLocal(+cx||0,+cy||0);Object.assign(ru,{tx:lx,ty:ly,tz:+cz||0,tyaw:+cyaw||0,lights:Boolean(lights)});if(!ru.init){ru.x=lx;ru.y=ly;ru.z=ru.tz;ru.yaw=ru.tyaw;ru.init=true;}
    const keep=new Map(ru.cops.map(c=>[c.slot,c]));ru.cops=(Array.isArray(cops)?cops:[]).slice(0,COPS_PER_UNIT).map(ce=>{const[slot,x,y,z,yaw,anim,shots,aim]=ce;const[ax,ay]=toLocal(+x||0,+y||0);let c=keep.get(slot);if(!c){c={slot,x:ax,y:ay,z:+z||0,yaw:+yaw||0,shots:+shots||0,proxy:makeProxy(),idx:-1};}keep.delete(slot);
      if((+shots||0)>c.shots&&Array.isArray(aim)){const[tx,ty]=toLocal(+aim[0]||0,+aim[1]||0);const from=new THREE.Vector3(c.x+Math.cos(c.yaw)*.45,c.y+Math.sin(c.yaw)*.45,(+z||0)+1.38);tracer(from,new THREE.Vector3(tx,ty,+aim[2]||1));playShot(from.x,from.y,from.z);}
      Object.assign(c,{tx:ax,ty:ay,tz:+z||0,tyaw:+yaw||0,anim:+anim||0,shots:+shots||0});return c;});for(const c of keep.values())c.proxy.parent?.remove(c.proxy);}
  for(const[id,ru]of r.units)if(!live.has(id)){ru.car.group.parent?.remove(ru.car.group);for(const c of ru.cops)c.proxy.parent?.remove(c.proxy);r.units.delete(id);}
}
function renderRemote(now,dt){
  if(!remoteCrowd)return;const a=1-Math.exp(-dt*12);let slot=0;
  for(const[peer,r]of remote){if(now-r.seen>2500){for(const ru of r.units.values()){ru.car.group.parent?.remove(ru.car.group);for(const c of ru.cops)c.proxy.parent?.remove(c.proxy);}remote.delete(peer);continue;}
    for(const ru of r.units.values()){ru.x+=(ru.tx-ru.x)*a;ru.y+=(ru.ty-ru.y)*a;ru.z+=(ru.tz-ru.z)*a;ru.yaw+=angleTo(ru.yaw,ru.tyaw)*a;const g=ru.car.group;g.position.set(ru.x,ru.y,groundHeightAt(ru.x,ru.y));g.rotation.set(0,0,ru.yaw);flashLights(ru.car,now,ru.lights);
      for(const c of ru.cops){const px=c.x,py=c.y;c.x+=(c.tx-c.x)*a;c.y+=(c.ty-c.y)*a;c.z=groundHeightAt(c.x,c.y);c.yaw+=angleTo(c.yaw,c.tyaw)*a;const sp=Math.hypot(c.x-px,c.y-py)/Math.max(dt,1e-3);if(slot>=REMOTE_COPS)continue;c.idx=slot++;
        remoteCrowd.set(c.idx,{x:c.x,y:c.y,z:c.z,yaw:c.yaw-Math.PI/2,state:c.anim===2?"aim-pistol":c.anim===1?"run":sp>.3?"walk":"idle",speed:Math.max(sp,c.anim===1?3.7:0),weapon:"pistol",dt});c.proxy.visible=true;c.proxy.position.set(c.x,c.y,c.z);c.proxy.updateMatrixWorld();}}}
  for(let i=slot;i<REMOTE_COPS;i++)remoteCrowd.hide(i);remoteCrowd.commit();
}

// ------------------------------------------------------------ main loop
function frame(now=performance.now()){
  requestAnimationFrame(frame);const dt=Math.min(.1,Math.max(0,(now-lastFrame)/1000));lastFrame=now;
  if(!ensureScene())return;const w=wanted()?.state,stars=Number(w?.stars)||0,player=playerTarget();
  // dispatch: one cruiser per star (max 3) while wanted
  if(player&&stars>0&&w?.phase!=="searching"){const want=Math.min(MAX_UNITS,stars),active=units.filter(u=>u.state!=="abandoned"&&u.state!=="leave").length;if(active<want&&now-(globalThis.__policeLastSpawn||0)>2600){globalThis.__policeLastSpawn=now;spawnUnit(player,now);}}
  for(const u of units)updateUnit(u,player,now,dt,stars);
  // sightings keep the wanted level alive while officers or cruisers see the player
  if(player&&stars>0&&now-lastSight>600){lastSight=now;const seen=units.some(u=>u.state!=="abandoned"&&(u.cops.some(c=>c.state==="out"&&c.los)||(u.pose&&Math.hypot(player.position.x-u.pose.position[0],player.position.y-u.pose.position[1])<30&&!blocked({x:u.pose.position[0],y:u.pose.position[1],z:1.3},{x:player.position.x,y:player.position.y,z:1.3}))));if(seen)wanted()?.sighting?.(player.position);}
  // despawn far / finished units (never one the player is driving)
  for(let i=units.length-1;i>=0;i--){const u=units[i],p=u.pose,d=p&&player?Math.hypot(player.position.x-p.position[0],player.position.y-p.position[1]):0;if(u.car.group.userData.playerDriven)continue;if(d>DESPAWN_M||(u.state==="leave"&&d>120)||(u.state==="leave"&&now-u.born>90000)){removeUnit(u);units.splice(i,1);}}
  renderCops(now,dt);renderRemote(now,dt);stepTracers(now);broadcast(now);
  const v=viewport();if(v){const cops=units.reduce((n,u)=>n+u.cops.filter(c=>c.state==="out").length,0);v.dataset.policeGround=`${units.length}c/${cops}o`;}
}
export function installPoliceGroundUnits(){
  if(globalThis.__policeGroundUnits||typeof window==="undefined")return globalThis.__policeGroundUnits;
  addEventListener("arondight:world-explosion",onExplosion);addEventListener(VS_FX_EVENT,onFx);
  addEventListener("arondight:world-reset",()=>{for(const u of units)removeUnit(u);units=[];});
  globalThis.__policeGroundUnits={hit,get units(){return units;},version:POLICE_GROUND_VERSION};requestAnimationFrame(frame);return globalThis.__policeGroundUnits;
}
installPoliceGroundUnits();
