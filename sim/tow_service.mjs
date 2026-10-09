import * as THREE from "three";
import {vehicleGeometry,vehicleMaterial,wheelGeometry} from "./vehicle_models.mjs";
import {groundHeightAt} from "./terrain_craters.mjs";
import {requestLight} from "./dynamic_lights.mjs";
import {wantedPointInRing} from "./wanted_system_logic.mjs";

// Breakdown service (ADAC-style). Traffic that is stuck — flipped, wedged,
// off its road, not moving although it should — is not teleported away: a
// yellow tow truck is dispatched from a depot on the real road network
// (A* over the roads, pure-pursuit driving on the same Box3D vehicle physics
// as all traffic), drives up, hooks the car, tows it back to its own lane on
// its own route, sets it down upright and leaves for the depot again. The
// car then simply carries on with its route. Nothing appears or vanishes in
// view: the truck enters and leaves the scene far away.

export const TOW_SERVICE_VERSION="tow-truck-dispatch-v1";
const MAX_TRUCKS=2,FLIP_S=2.5,STUCK_S=9,OFFROAD_S=7,OFFROAD_M=9,SPAWN_MIN=170,SPAWN_MAX=320,HOOK_M=7.5,HOOK_MS=1800,TOW_SPEED=9,DRIVE_SPEED=14,GIVE_UP_MS=70000;
const bridge=()=>globalThis.__arondightRealWorld||null,physics=()=>globalThis.__arondightWorldRigidBodies||null,pop=()=>globalThis.__arondightProceduralPopulation||null,viewport=()=>document.getElementById("viewport");
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),angleTo=(a,b)=>{let d=b-a;while(d>Math.PI)d-=2*Math.PI;while(d<-Math.PI)d+=2*Math.PI;return d;};
let root=null,sceneRef=null,trucks=[],serial=0,graph=null,graphAt=-Infinity,lastScan=0;const watch=new Map();
const up=new THREE.Vector3(),wp=new THREE.Vector3(),wq=new THREE.Quaternion();

// ------------------------------------------------------------ road network
function roadGraph(now){if(graph&&now-graphAt<5000)return graph;const routes=pop()?.roads?.()||[];graphAt=now;const nodes=new Map(),key=(x,y)=>`${Math.round(x/2)},${Math.round(y/2)}`,node=(x,y)=>{const k=key(x,y);let n=nodes.get(k);if(!n){n={x,y,adj:[]};nodes.set(k,n);}return n;};
  for(const r of routes)for(const s of r.segments||[]){const a=node(s.a[0],s.a[1]),b=node(s.a[0]+s.dx,s.a[1]+s.dy);if(a===b)continue;a.adj.push([b,s.d]);b.adj.push([a,s.d]);}graph={nodes:[...nodes.values()]};return graph;}
function nearestNode(g,x,y){let best=null,bd=Infinity;for(const n of g.nodes){const d=(n.x-x)**2+(n.y-y)**2;if(d<bd){bd=d;best=n;}}return best;}
function findPath(g,sx,sy,tx,ty){const a=nearestNode(g,sx,sy),b=nearestNode(g,tx,ty);if(!a||!b)return null;if(a===b)return[{x:sx,y:sy},{x:tx,y:ty}];
  const open=[a],inOpen=new Set([a]),gs=new Map([[a,0]]),from=new Map(),h=n=>Math.hypot(n.x-b.x,n.y-b.y),fs=new Map([[a,h(a)]]),closed=new Set();let it=0;
  while(open.length&&it++<5000){let bi=0;for(let i=1;i<open.length;i++)if(fs.get(open[i])<fs.get(open[bi]))bi=i;const cur=open[bi];open[bi]=open[open.length-1];open.pop();inOpen.delete(cur);if(cur===b)break;closed.add(cur);
    for(const[n,w]of cur.adj){if(closed.has(n))continue;const g2=gs.get(cur)+w;if(g2<(gs.get(n)??Infinity)){gs.set(n,g2);fs.set(n,g2+h(n));from.set(n,cur);if(!inOpen.has(n)){open.push(n);inOpen.add(n);}}}}
  if(!from.has(b))return null;const path=[{x:tx,y:ty}];for(let n=b;n;n=from.get(n))path.unshift({x:n.x,y:n.y});return path;}
function pursuitPoint(path,x,y,look){let bi=0,bt=0,bd=Infinity;for(let i=0;i<path.length-1;i++){const a=path[i],b=path[i+1],dx=b.x-a.x,dy=b.y-a.y,l2=dx*dx+dy*dy||1e-6,t=clamp(((x-a.x)*dx+(y-a.y)*dy)/l2,0,1),px=a.x+dx*t,py=a.y+dy*t,d=Math.hypot(x-px,y-py);if(d<bd){bd=d;bi=i;bt=t;}}
  if(path.length<2)return path[0];let i=bi,t=bt,left=look;while(i<path.length-1){const a=path[i],b=path[i+1],l=Math.hypot(b.x-a.x,b.y-a.y)||1e-6,rest=(1-t)*l;if(rest>=left){const tt=t+left/l;return{x:a.x+(b.x-a.x)*tt,y:a.y+(b.y-a.y)*tt};}left-=rest;i++;t=0;}return path.at(-1);}
function insideBuilding(x,y){for(const pr of bridge()?.buildingCollisionSnapshot?.prisms||[]){const pts=pr.points;if(!pts||pts.length<3||Math.abs(x-pts[0][0])>120||Math.abs(y-pts[0][1])>120)continue;if(wantedPointInRing(x,y,pts))return true;}return false;}
function playerPos(){const w=globalThis.__arondightWalkMode;if(w?.mode==="foot"&&w.position)return w.position;return bridge()?.threeCamera?.position||null;}
// seen by a player right now? The spawn guard knows the view that was actually drawn (walk / car /
// jet camera, not the drone camera the scene holds between frames) and peers' views, and buildings
const viewPoint=new THREE.Vector3();
function inView(x,y){const z=groundHeightAt(x,y),g=globalThis.__spawnVisibilityGuard;if(g?.canSpawnAt)return!g.canSpawnAt(x,y,z,{heightM:3});const cam=bridge()?.presentedCamera?.()||bridge()?.threeCamera;if(!cam)return false;const v=viewPoint.set(x,y,z+1.5).project(cam);return v.z<1&&Math.abs(v.x)<1.1&&Math.abs(v.y)<1.1;}

// ------------------------------------------------------------ the truck
function ensureScene(){const scene=bridge()?.threeScene;if(!scene)return false;if(scene===sceneRef&&root?.parent===scene)return true;for(const t of trucks)removeTruck(t);trucks=[];root?.parent?.remove(root);sceneRef=scene;root=new THREE.Group();root.name="TOW_SERVICE";scene.add(root);return true;}
const amberOn=new THREE.MeshBasicMaterial({color:0xffa31a}),amberOff=new THREE.MeshBasicMaterial({color:0x3a2508});
function buildTruck(){const g=new THREE.Group();g.name="TOW_TRUCK";const body=new THREE.Mesh(vehicleGeometry("car",0xf2b705),vehicleMaterial);body.castShadow=true;g.add(body);
  const dark=new THREE.MeshStandardMaterial({color:0x23262a,roughness:.6,metalness:.4}),steel=new THREE.MeshStandardMaterial({color:0x8a9096,roughness:.35,metalness:.8});
  const bed=new THREE.Mesh(new THREE.BoxGeometry(1.5,1.5,.12),dark);bed.position.set(-.95,0,1.05);g.add(bed);
  const boom=new THREE.Mesh(new THREE.BoxGeometry(1.9,.16,.16),steel);boom.position.set(-1.35,0,1.45);boom.rotation.y=-.38;g.add(boom);
  const hook=new THREE.Mesh(new THREE.BoxGeometry(.12,1.3,.1),steel);hook.position.set(-2.2,0,1.05);g.add(hook);
  const bar=new THREE.Group();bar.position.set(.2,0,1.55);g.add(bar);const l=new THREE.Mesh(new THREE.BoxGeometry(.22,.36,.1),amberOff),r=new THREE.Mesh(new THREE.BoxGeometry(.22,.36,.1),amberOff);l.position.y=.24;r.position.y=-.24;bar.add(l,r);
  const wheels=[];const wg=wheelGeometry();for(const[x,y]of[[1.2,.78],[1.2,-.78],[-1.15,.78],[-1.15,-.78]]){const w=new THREE.Mesh(wg,vehicleMaterial);w.castShadow=true;w.position.set(x,y,.34);g.add(w);wheels.push(w);}
  g.traverse(n=>{n.userData.flightFireIgnore=n!==body&&n.isMesh;});return{group:g,l,r,wheels};}
function spawnTruck(job,now){const g=roadGraph(now),me=playerPos();if(!g.nodes.length)return null;
  // the depot: a road node far from the player (out of sight), not too far from the job
  const cands=g.nodes.filter(n=>{const dj=Math.hypot(n.x-job.x,n.y-job.y),dp=me?Math.hypot(n.x-me.x,n.y-me.y):999;return dj>SPAWN_MIN&&dj<SPAWN_MAX&&dp>140&&!insideBuilding(n.x,n.y)&&!inView(n.x,n.y);});
  const spot=cands.length?cands[(Math.random()*cands.length)|0]:null;if(!spot)return null;const path=findPath(g,spot.x,spot.y,job.x,job.y);if(!path)return null;
  const nxt=path.find(q=>Math.hypot(q.x-spot.x,q.y-spot.y)>3)||{x:job.x,y:job.y},yaw=Math.atan2(nxt.y-spot.y,nxt.x-spot.x),id=`tow-truck-${(++serial).toString(36)}`,z=groundHeightAt(spot.x,spot.y);
  if(!physics()?.upsertBody?.({id,kind:"car",position:[spot.x,spot.y,z+.62],yaw,halfExtents:[1.78,.82,.36],massKg:2600}))return null;
  const t={id,job,state:"to-job",path,pathAt:now,depot:{x:spot.x,y:spot.y},born:now,mesh:buildTruck(),pose:null,progress:null,recoverUntil:0,recoverStart:0,stuckSince:0};root.add(t.mesh.group);trucks.push(t);return t;}
function removeTruck(t){physics()?.removeBody?.(t.id);t.mesh.group.parent?.remove(t.mesh.group);if(t.job?.towing){pop()?.towEnd?.(t.job.id,{});}if(t.job&&t.state!=="depot")watch.delete(t.job.id);}
function truckPose(t){const p=physics()?.pose?.(t.id,t.pose);if(p)t.pose=p;return p;}
function syncTruck(t,now){const p=t.pose,g=t.mesh.group;if(!p)return;const q=p.rotation,off=Number(p.groundOffset)||.6;g.quaternion.set(q[0],q[1],q[2],q[3]);up.set(0,0,1).applyQuaternion(g.quaternion);g.position.set(p.position[0]-up.x*off,p.position[1]-up.y*off,p.position[2]-up.z*off);
  g.updateMatrixWorld(true);if(p.wheels?.length===4){const inv=new THREE.Matrix4().copy(g.matrixWorld).invert();for(let i=0;i<4;i++){const w=p.wheels[i];wp.set(w.position[0],w.position[1],w.position[2]).applyMatrix4(inv);wq.set(w.rotation[0],w.rotation[1],w.rotation[2],w.rotation[3]);t.mesh.wheels[i].position.copy(wp);t.mesh.wheels[i].quaternion.copy(g.quaternion).invert().multiply(wq);}}
  const on=(Math.floor(now/260)%2)===0;t.mesh.l.material=on?amberOn:amberOff;t.mesh.r.material=on?amberOff:amberOn;if(t.state!=="depot"||Math.hypot(g.position.x-(playerPos()?.x||0),g.position.y-(playerPos()?.y||0))<120)requestLight(g.position.clone().setZ(g.position.z+1.8),{color:0xffa31a,intensity:on?5:2,distance:16});}
const speedOf=p=>p?Math.hypot(p.velocity[0],p.velocity[1]):0;
function driveTo(t,tx,ty,speed){physics()?.setDrive?.(t.id,null);physics()?.setTarget?.(t.id,{position:[tx,ty,0],yaw:0,speedMps:speed});}
function brake(t){physics()?.clearTarget?.(t.id);physics()?.setDrive?.(t.id,{pedal:0,steer:0,handbrake:true});}
// follow the path; back out with the wheel turned when wedged (the same driving as all physical traffic)
function follow(t,goal,speed,now){const p=t.pose;if(!p)return Infinity;const cx=p.position[0],cy=p.position[1],d=Math.hypot(goal.x-cx,goal.y-cy),sp=speedOf(p);
  if(!t.path||now-t.pathAt>2500){t.path=findPath(roadGraph(now),cx,cy,goal.x,goal.y)||[{x:cx,y:cy},goal];t.pathAt=now;}
  const tp=pursuitPoint(t.path,cx,cy,Math.max(7,sp*1.1)),herr=angleTo(p.yaw,Math.atan2(tp.y-cy,tp.x-cx));
  if(now<t.recoverUntil){if(Math.abs(herr)<.45&&now-t.recoverStart>500)t.recoverUntil=0;else{physics()?.clearTarget?.(t.id);physics()?.setDrive?.(t.id,{pedal:-.75,steer:-Math.sign(herr||1),handbrake:false,maxReverse:4});return d;}}
  if(sp<.7&&d>6){t.stuckSince||=now;if(now-t.stuckSince>2200){t.recoverStart=now;t.recoverUntil=now+1700;t.stuckSince=0;t.path=null;return d;}}else t.stuckSince=0;
  if(!t.progress||now-t.progress.t>4500){if(t.progress&&d>6&&Math.hypot(cx-t.progress.x,cy-t.progress.y)<5){t.recoverStart=now;t.recoverUntil=now+1600;t.path=null;t.progress={t:now,x:cx,y:cy};return d;}t.progress={t:now,x:cx,y:cy};}
  const far=pursuitPoint(t.path,cx,cy,Math.max(20,sp*2.2)),turn=Math.abs(angleTo(Math.atan2(tp.y-cy,tp.x-cx),Math.atan2(far.y-tp.y,far.x-tp.x)));
  driveTo(t,tp.x,tp.y,Math.min(speed,clamp(speed-turn/(Math.PI/2)*(speed-4),4,speed),d<20?Math.max(3,d*.5):speed));return d;}

// ------------------------------------------------------------ the job
function update(t,now){
  const p=truckPose(t);if(!p){removeTruck(t);return false;}syncTruck(t,now);const job=t.job,api=pop();
  // the player got into the car the truck came for (or is holding it): the job is off, the car is his
  if(t.state!=="depot"&&(globalThis.__arondightVehicleDrive?.vehicleId===job.id||globalThis.__arondightGravityGun?.heldId===job.id)){if(job.towing){api?.towEnd?.(job.id,{});job.towing=false;}t.state="depot";t.path=null;t.leaveAt=now;const w=watch.get(job.id);if(w){w.dispatched=false;w.cooldownUntil=now+60000;}return true;}
  if(now-t.born>GIVE_UP_MS&&t.state!=="depot"){if(job.towing){const lp=api?.lanePose?.(job.id,0);api?.towEnd?.(job.id,lp||{});job.towing=false;}t.state="depot";t.path=null;}
  if(t.state==="to-job"){const car=api?.vehicles?.().find(v=>v.id===job.id);if(!car){t.state="depot";t.path=null;return true;}job.x=car.x;job.y=car.y;
    const d=follow(t,{x:car.x,y:car.y},DRIVE_SPEED,now);if(d<HOOK_M){brake(t);t.state="hook";t.hookAt=now;}return true;}
  if(t.state==="hook"){brake(t);if(now-t.hookAt>HOOK_MS){if(!api?.towBegin?.(job.id)){t.state="depot";t.path=null;return true;}job.towing=true;job.drop=api?.lanePose?.(job.id,30)||null;t.state="tow";t.path=null;}return true;}
  if(t.state==="tow"){// the car hangs behind on the boom, front wheels lifted
    const yaw=p.yaw,bx=p.position[0]-Math.cos(yaw)*5.1,by=p.position[1]-Math.sin(yaw)*5.1,gz=groundHeightAt(bx,by);physics()?.setPose?.(job.id,{position:[bx,by,gz+.62],yaw,velocity:[p.velocity[0],p.velocity[1],0]});
    const drop=job.drop||{x:p.position[0],y:p.position[1],yaw};const d=follow(t,{x:drop.x+Math.cos(drop.yaw)*5.5,y:drop.y+Math.sin(drop.yaw)*5.5},TOW_SPEED,now);
    if(d<4.5&&speedOf(p)<2.5){brake(t);api?.towEnd?.(job.id,{x:bx,y:by,yaw});job.towing=false;t.state="depot";t.path=null;t.leaveAt=now;{const w=watch.get(job.id);if(w){w.dispatched=false;w.flipSince=w.slowSince=w.offSince=0;w.cooldownUntil=now+60000;}}const v=viewport();if(v)v.dataset.towServiceJobsDone=String((Number(v.dataset.towServiceJobsDone)||0)+1);}return true;}
  if(t.state==="depot"){if(now-(t.leaveAt||0)<1200){brake(t);return true;}const me=playerPos(),gx=t.depot.x,gy=t.depot.y;const d=follow(t,{x:gx,y:gy},DRIVE_SPEED,now);
    const away=me?Math.hypot(p.position[0]-me.x,p.position[1]-me.y):999;if((d<12||away>200)&&!inView(p.position[0],p.position[1])){removeTruck(t);return false;}return true;}
  return true;}

// ------------------------------------------------------------ who needs help
function scan(now){const api=pop();if(!api?.vehicles)return;const list=api.vehicles(),seen=new Set();
  for(const v of list){seen.add(v.id);if(v.parked||v.driven||v.towed)continue;let w=watch.get(v.id);if(!w){w={id:v.id,flipSince:0,slowSince:0,offSince:0,dispatched:false};watch.set(v.id,w);}if(w.dispatched||now<(w.cooldownUntil||0))continue;
    w.flipSince=v.up<.5?(w.flipSince||now):0;w.slowSince=v.speed<.6&&v.hasRoute?(w.slowSince||now):0;w.offSince=v.offRoute>OFFROAD_M?(w.offSince||now):0;
    const flipped=w.flipSince&&now-w.flipSince>FLIP_S*1000,stuck=w.slowSince&&now-w.slowSince>STUCK_S*1000,off=w.offSince&&now-w.offSince>OFFROAD_S*1000;
    if((flipped||stuck||off)&&trucks.length<MAX_TRUCKS){const t=spawnTruck({id:v.id,x:v.x,y:v.y,reason:flipped?"flipped":off?"off-road":"stuck"},now);if(t){w.dispatched=true;const vp=viewport();if(vp){vp.dataset.towServiceDispatches=String((Number(vp.dataset.towServiceDispatches)||0)+1);vp.dataset.towServiceLast=t.job.reason;}}}}
  for(const id of watch.keys())if(!seen.has(id)&&!trucks.some(t=>t.job?.id===id))watch.delete(id);}

let lastFrame=performance.now();
function frame(now=performance.now()){requestAnimationFrame(frame);lastFrame=now;if(!bridge()?.threeScene||!ensureScene())return;
  if(now-lastScan>500){lastScan=now;try{scan(now);}catch(e){console.warn("tow scan",e);}}
  for(let i=trucks.length-1;i>=0;i--){try{if(!update(trucks[i],now))trucks.splice(i,1);}catch(e){console.warn("tow truck",e);removeTruck(trucks[i]);trucks.splice(i,1);}}
  const v=viewport();if(v)v.dataset.towService=`${trucks.length}t/${[...watch.values()].filter(w=>w.dispatched).length}j`;}
export function installTowService(){if(globalThis.__towService||typeof window==="undefined")return;globalThis.__towService={version:TOW_SERVICE_VERSION,get trucks(){return trucks.map(t=>({id:t.id,state:t.state,job:t.job?.id,reason:t.job?.reason}));},dispatch(id){const v=pop()?.vehicles?.().find(q=>q.id===id);return v?Boolean(spawnTruck({id,x:v.x,y:v.y,reason:"manual"},performance.now())):false;}};addEventListener("arondight:world-reset",()=>{for(const t of trucks)removeTruck(t);trucks=[];watch.clear();});requestAnimationFrame(frame);}
installTowService();
