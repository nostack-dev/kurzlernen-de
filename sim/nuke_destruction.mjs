import * as THREE from "three";
import {setBuildingDamage,commitDestruction} from "./world_destruction_state.mjs";

// Physical nuke aftermath, driven by the real shock front (343 m/s):
//  * every building is hit when the shock reaches it; overpressure falls off
//    with distance and is attenuated by standing buildings in between
//    (collapsed ones let the wave through) — so the wave breaks through the
//    first rows and propagates outward realistically,
//  * close buildings are leveled to rubble stumps, farther ones lose their
//    upper floors; the removed volume flies off as debris chunks,
//  * cars, buses and people are killed and thrown through the air (vehicles
//    explode when they land), rigid bodies get a radial impulse,
//  * a deformed crater mesh replaces the ground at ground zero.
// Everything is pooled / instanced: one draw call for all debris.

export const NUKE_DESTRUCTION_VERSION="shock-front-destruction-v1";
const SHOCK_MPS=343;
const FULL_DESTROY_M=180;          // overpressure intensity 1.0 here
const MAX_EFFECT_M=900;
const RUBBLE_M=1.6;
const DEBRIS_POOL=1400,DEBRIS_LIFE_S=22,GRAVITY=9.81;
const FLING_LIFE_S=9,MAX_FLUNG=48,MAX_SECONDARY=10;
const CRATER_R=210,CRATER_DEPTH=22,CRATER_RIM=7,CRATER_RINGS=30,CRATER_SEGMENTS=72,MAX_CRATERS=3;

let installed=false,debris=null,debrisFree=[],events=[],flung=[],craters=[],secondaryLeft=0,lastFrame=performance.now(),pendingCommit=false;
const tmp=new THREE.Vector3(),tmp2=new THREE.Vector3(),m4=new THREE.Matrix4(),qa=new THREE.Quaternion(),sc=new THREE.Vector3(),col=new THREE.Color();

const viewport=()=>document.getElementById("viewport");
const bridge=()=>globalThis.__arondightRealWorld||null;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number(v)||0));
const rand=(a,b)=>a+Math.random()*(b-a);
function setData(key,value){const v=viewport();if(v){const s=String(value);if(v.dataset[key]!==s)v.dataset[key]=s;}}
function intensityAt(distance){return Math.pow(FULL_DESTROY_M/Math.max(8,distance),1.5);}

// ---------------------------------------------------------------- debris
function ensureDebris(scene){
  if(debris?.mesh.parent===scene)return debris;
  if(debris?.mesh.parent)debris.mesh.parent.remove(debris.mesh);
  const geometry=new THREE.BoxGeometry(1,1,1),material=new THREE.MeshBasicMaterial({color:0xffffff,toneMapped:false});
  const mesh=new THREE.InstancedMesh(geometry,material,DEBRIS_POOL);mesh.name="NUKE_DEBRIS";mesh.frustumCulled=false;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.userData.flightFireIgnore=true;mesh.userData.neonSkip=true;mesh.userData.nukeWeaponPart=true;
  const zero=new THREE.Matrix4().makeScale(0,0,0);for(let i=0;i<DEBRIS_POOL;i++){mesh.setMatrixAt(i,zero);mesh.setColorAt(i,col.set(0x0d2418));}
  mesh.instanceMatrix.needsUpdate=true;mesh.instanceColor.needsUpdate=true;scene.add(mesh);
  const items=Array.from({length:DEBRIS_POOL},()=>({alive:false,p:new THREE.Vector3(),v:new THREE.Vector3(),axis:new THREE.Vector3(1,0,0),angle:0,spin:0,size:new THREE.Vector3(1,1,1),age:0,rest:false}));
  debrisFree=items.map((_,i)=>DEBRIS_POOL-1-i);debris={mesh,items};return debris;
}
function spawnDebris(scene,at,velocity,size,color){
  const d=ensureDebris(scene);if(!debrisFree.length)return;const i=debrisFree.pop(),item=d.items[i];
  item.alive=true;item.rest=false;item.age=0;item.p.copy(at);item.v.copy(velocity);item.axis.set(rand(-1,1),rand(-1,1),rand(-1,1)).normalize();item.angle=rand(0,6.28);item.spin=rand(-9,9);item.size.copy(size);
  d.mesh.setColorAt(i,color);d.mesh.instanceColor.needsUpdate=true;
}
function stepDebris(dt){
  if(!debris)return 0;let alive=0;const{mesh,items}=debris;
  for(let i=0;i<items.length;i++){const it=items[i];if(!it.alive)continue;alive++;it.age+=dt;
    if(!it.rest){it.v.z-=GRAVITY*dt;it.v.multiplyScalar(Math.exp(-.08*dt));it.p.addScaledVector(it.v,dt);it.angle+=it.spin*dt;const floor=it.size.z*.5;
      if(it.p.z<floor){it.p.z=floor;if(Math.abs(it.v.z)<2.2&&Math.hypot(it.v.x,it.v.y)<1.5){it.rest=true;it.v.set(0,0,0);it.spin=0;}else{it.v.z=-it.v.z*.28;it.v.x*=.55;it.v.y*=.55;it.spin*=.5;}}}
    let sink=0;if(it.age>DEBRIS_LIFE_S-3)sink=(it.age-(DEBRIS_LIFE_S-3))/3*it.size.z;
    if(it.age>DEBRIS_LIFE_S){it.alive=false;debrisFree.push(i);m4.makeScale(0,0,0);mesh.setMatrixAt(i,m4);continue;}
    qa.setFromAxisAngle(it.axis,it.angle);tmp.copy(it.p);tmp.z-=sink;m4.compose(tmp,qa,it.size);mesh.setMatrixAt(i,m4);}
  mesh.instanceMatrix.needsUpdate=true;return alive;
}

// ------------------------------------------------------------- buildings
function buildingsFromSnapshot(){
  const prisms=bridge()?.buildingCollisionSnapshot?.prisms||[],groups=new Map();
  for(const prism of prisms){const key=String(prism?.buildingKey||"");if(!key||prism.leveled)continue;const pts=(prism.points||[]).filter(p=>Number.isFinite(Number(p?.[0]))&&Number.isFinite(Number(p?.[1])));if(pts.length<3)continue;
    let g=groups.get(key);if(!g){g={key,points:[],base:Number(prism.base)||0,top:Number(prism.top)||8};groups.set(key,g);}g.points.push(...pts);g.base=Math.min(g.base,Number(prism.base)||0);g.top=Math.max(g.top,Number(prism.top)||0);}
  const list=[];for(const g of groups.values()){let cx=0,cy=0;for(const p of g.points){cx+=+p[0];cy+=+p[1];}cx/=g.points.length;cy/=g.points.length;let r=0,minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;for(const p of g.points){r=Math.max(r,Math.hypot(p[0]-cx,p[1]-cy));minX=Math.min(minX,p[0]);maxX=Math.max(maxX,p[0]);minY=Math.min(minY,p[1]);maxY=Math.max(maxY,p[1]);}list.push({...g,cx,cy,r,minX,maxX,minY,maxY,height:Math.max(1,g.top-g.base)});}
  return list;
}
function segmentPointDistance(ax,ay,bx,by,px,py){const dx=bx-ax,dy=by-ay,l=dx*dx+dy*dy||1,t=clamp(((px-ax)*dx+(py-ay)*dy)/l,0,1);return Math.hypot(ax+dx*t-px,ay+dy*t-py);}
// Overpressure per building with shielding by buildings that are still
// standing after the wave passed them (processed nearest-first).
function planBuildings(center){
  const list=buildingsFromSnapshot().map(b=>({...b,distance:Math.max(0,Math.hypot(b.cx-center.x,b.cy-center.y)-b.r*.6)})).filter(b=>b.distance<MAX_EFFECT_M).sort((a,b)=>a.distance-b.distance);
  const standing=[];
  for(const b of list){
    let shield=1;for(const s of standing){if(s.distance>=b.distance-1)continue;if(segmentPointDistance(center.x,center.y,b.cx,b.cy,s.cx,s.cy)<s.r*.8)shield*=s.leveled?.93:.62;if(shield<.05)break;}
    const I=intensityAt(b.distance)*shield;b.intensity=I;
    if(I>=1){b.newTop=b.base+Math.min(RUBBLE_M,b.height);b.leveled=true;}
    else if(I>.32){const keep=1-(I-.32)/.68*.85;b.newTop=b.base+Math.max(RUBBLE_M,b.height*keep);b.leveled=false;}
    else b.newTop=null;
    if(b.newTop===null||b.newTop>=b.top-.5){standing.push(b);continue;}
    standing.push({...b,leveled:b.leveled,r:b.leveled?b.r*.3:b.r*(.6+.4*(b.newTop-b.base)/b.height)});
    events.push({at:performance.now()+b.distance/SHOCK_MPS*1000,type:"building",b,center:center.clone()});
  }
  return list.length;
}
const WALL=new THREE.Color(0x10291b),EMBER=new THREE.Color(0xff6a1a),CHAR=new THREE.Color(0x1c1a12);
function collapseBuilding(scene,b,center){
  setBuildingDamage(b.key,{top:b.newTop,leveled:b.leveled});pendingCommit=true;
  const removed=Math.max(0,b.top-b.newTop),area=(b.maxX-b.minX)*(b.maxY-b.minY),volume=removed*Math.max(20,area*.6),count=clamp(Math.round(volume/90),5,40),chunk=clamp(Math.cbrt(volume/count),1.2,5.5);
  const dir=tmp2.set(b.cx-center.x,b.cy-center.y,0);if(dir.lengthSq()<1)dir.set(1,0,0);dir.normalize();const I=Math.min(b.intensity,2.5);
  for(let i=0;i<count;i++){
    const at=new THREE.Vector3(rand(b.minX,b.maxX),rand(b.minY,b.maxY),b.newTop+rand(0,removed));
    const speed=(10+34*I)*rand(.55,1.25),v=new THREE.Vector3(dir.x*speed+rand(-6,6),dir.y*speed+rand(-6,6),rand(3,9)+9*I*rand(.3,1));
    spawnDebris(scene,at,v,new THREE.Vector3(chunk*rand(.6,1.4),chunk*rand(.6,1.4),chunk*rand(.4,1.1)),Math.random()<.22?EMBER:Math.random()<.5?CHAR:WALL);
  }
}

// --------------------------------------------- vehicles, people, bodies
function populationRoots(scene){const roots=new Map();scene?.traverse?.(node=>{const u=node.userData||{},id=String(u.worldPopulationId||u.worldLifeId||""),kind=String(u.worldPopulationKind||u.worldLifeKind||"");if(!id||!kind)return;let root=node;while(root.parent&&String(root.parent.userData?.worldPopulationId||root.parent.userData?.worldLifeId||"")===id)root=root.parent;if(!roots.has(id))roots.set(id,{root,kind});});return roots;}
function meshFor(root){let found=null;root.traverse?.(n=>{if(!found&&n.isMesh)found=n;});return found||root;}
function planActors(scene,center){
  let n=0;for(const[id,{root,kind}]of populationRoots(scene)){if(root.visible===false)continue;root.getWorldPosition(tmp);const d=Math.hypot(tmp.x-center.x,tmp.y-center.y);if(d>MAX_EFFECT_M*.8)continue;events.push({at:performance.now()+d/SHOCK_MPS*1000,type:"actor",id,root,kind:kind.replace(/^life-/,""),center:center.clone(),distance:d});n++;}
  const vitals=globalThis.__arondightPlayerVitals;for(const target of vitals?.damageTargets?.()||[]){const p=target.position;if(!p)continue;const d=Math.hypot(p.x-center.x,p.y-center.y);events.push({at:performance.now()+d/SHOCK_MPS*1000,type:"local",target,distance:d,center:center.clone()});}
  const rigid=globalThis.__arondightWorldRigidBodies;if(rigid?.engine?.records)for(const record of rigid.engine.records.values()){const q=rigid.pose?.(record.id)?.position;if(!q)continue;const d=Math.hypot(q[0]-center.x,q[1]-center.y);if(d<MAX_EFFECT_M)events.push({at:performance.now()+d/SHOCK_MPS*1000,type:"rigid",record,distance:d,center:center.clone()});}
  for(const drone of globalThis.__arondightWantedSystem?.drones||[]){if(!drone?.active||!drone.root)continue;drone.root.getWorldPosition(tmp);const d=tmp.distanceTo(center);if(d<MAX_EFFECT_M)events.push({at:performance.now()+d/SHOCK_MPS*1000,type:"police",drone,distance:d});}
  const peer=bridge()?.vsPeerMesh;if(peer&&peer.visible!==false){peer.getWorldPosition(tmp);const d=tmp.distanceTo(center);if(d<MAX_EFFECT_M)events.push({at:performance.now()+d/SHOCK_MPS*1000,type:"peer",peer,distance:d});}
  return n;
}
function hitActor(scene,e){
  const I=intensityAt(e.distance);if(I<.12)return;const b=bridge(),object=meshFor(e.root);e.root.getWorldPosition(tmp);
  const hits=e.kind==="person"?2:e.kind==="bus"?8:6;for(let i=0;i<hits;i++)try{b?.registerWorldPopulationHit?.({object,point:tmp.clone()});}catch{}
  if(flung.length>=MAX_FLUNG||I<.25)return;
  // Thrown clone: shares geometry/materials, the original stays hidden while it flies.
  // Object3D.clone JSON-copies userData, which can hold live references in
  // population roots; strip it for the copy and restore afterwards.
  const stash=[];e.root.traverse(n=>{stash.push([n,n.userData]);n.userData={};});let clone=null;
  try{clone=e.root.clone(true);}catch{clone=null;}finally{for(const[n,u]of stash)n.userData=u;}
  if(!clone)return;e.root.updateWorldMatrix(true,false);e.root.matrixWorld.decompose(clone.position,clone.quaternion,clone.scale);
  clone.traverse(n=>{n.userData={flightFireIgnore:true,nukeFlung:true};n.layers.enable(0);});scene.add(clone);
  const dir=tmp2.set(tmp.x-e.center.x,tmp.y-e.center.y,0);if(dir.lengthSq()<1)dir.set(1,0,0);dir.normalize();const light=e.kind==="person",speed=Math.min(90,(light?22:14)*Math.min(I,3)*rand(.7,1.2));
  flung.push({clone,root:e.root,kind:e.kind,v:new THREE.Vector3(dir.x*speed,dir.y*speed,(light?8:6)+speed*.45),spin:new THREE.Vector3(rand(-4,4),rand(-4,4),rand(-6,6)),age:0,landed:false});
}
function stepFlung(dt){
  for(let i=flung.length-1;i>=0;i--){const f=flung[i];f.age+=dt;f.root.visible=false;
    if(!f.landed){f.v.z-=GRAVITY*dt;f.clone.position.addScaledVector(f.v,dt);f.clone.rotation.x+=f.spin.x*dt;f.clone.rotation.y+=f.spin.y*dt;f.clone.rotation.z+=f.spin.z*dt;
      if(f.clone.position.z<=0&&f.v.z<0){f.clone.position.z=0;if(f.kind!=="person"&&secondaryLeft>0){secondaryLeft--;window.dispatchEvent(new CustomEvent("arondight:world-explosion",{detail:{position:[f.clone.position.x,f.clone.position.y,.5],radiusM:7,maxDamage:60,kind:"nuke-secondary",source:"nuke-flung-vehicle"}}));}
        if(Math.abs(f.v.z)<4){f.landed=true;}else{f.v.z*=-.25;f.v.x*=.5;f.v.y*=.5;f.spin.multiplyScalar(.4);}}}
    if(f.age>FLING_LIFE_S){f.clone.parent?.remove(f.clone);f.root.visible=true;flung.splice(i,1);}}
}

// ---------------------------------------------------------------- crater
function craterHeight(r){
  const bowl=CRATER_R*.5;if(r<bowl)return-CRATER_DEPTH*(1-(r/bowl)**2);
  const x=(r-bowl)/(CRATER_R-bowl);const k=(x-.12)/.14;return CRATER_RIM*Math.exp(-(k*k))*(1-x);
}
function spawnCrater(scene,center){
  const positions=[],colors=[],index=[],cols=CRATER_SEGMENTS,rows=CRATER_RINGS;
  for(let r=0;r<=rows;r++)for(let s=0;s<cols;s++){const rad=CRATER_R*(r/rows)**1.15,a=s/cols*Math.PI*2+(r%2)*.04;positions.push(Math.cos(a)*rad,Math.sin(a)*rad,0);colors.push(0,0,0);}
  for(let r=0;r<rows;r++)for(let s=0;s<cols;s++){const a=r*cols+s,b=r*cols+(s+1)%cols,c=(r+1)*cols+s,d=(r+1)*cols+(s+1)%cols;index.push(a,c,b,b,c,d);}
  const geometry=new THREE.BufferGeometry();geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute("color",new THREE.Float32BufferAttribute(colors,3));geometry.setIndex(index);
  const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({vertexColors:true,toneMapped:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1}));
  mesh.name="NUKE_CRATER_GROUND";mesh.position.set(center.x,center.y,.02);mesh.userData.flightFireIgnore=true;mesh.userData.neonSkip=true;mesh.userData.nukeCrater=true;mesh.frustumCulled=false;mesh.renderOrder=-9000;
  const rimPts=[];for(let s=0;s<=96;s++){const a=s/96*Math.PI*2,r=CRATER_R*.56;rimPts.push(new THREE.Vector3(Math.cos(a)*r,Math.sin(a)*r,0));}
  const rim=new THREE.Line(new THREE.BufferGeometry().setFromPoints(rimPts),new THREE.LineBasicMaterial({color:0x00ff9c,toneMapped:false,transparent:true,opacity:.85}));rim.raycast=()=>{};mesh.add(rim);
  scene.add(mesh);craters.push({mesh,rim,born:performance.now(),lastColor:-Infinity});
  while(craters.length>MAX_CRATERS){const old=craters.shift();old.mesh.parent?.remove(old.mesh);old.mesh.geometry.dispose();old.mesh.material.dispose();old.rim.geometry.dispose();old.rim.material.dispose();}
}
const HOT=new THREE.Color(0xff7a1a),GLASS=new THREE.Color(0x3a1f0e),SCORCH=new THREE.Color(0x0b0f09),RIM=new THREE.Color(0x12301d);
function stepCraters(now){
  for(const c of craters){const age=(now-c.born)/1000,dig=clamp(age/1.4,0,1),ease=1-(1-dig)**3;if(dig>=1&&now-c.lastColor<400)continue;c.lastColor=now;
    const pos=c.mesh.geometry.attributes.position,colAttr=c.mesh.geometry.attributes.color,heat=Math.max(0,1-age/45);
    for(let i=0;i<pos.count;i++){const x=pos.getX(i),y=pos.getY(i),r=Math.hypot(x,y);pos.setZ(i,craterHeight(r)*ease);const t=r/CRATER_R;
      col.copy(SCORCH).lerp(RIM,clamp((t-.45)*3,0,1));if(t<.5)col.lerp(GLASS,(1-t*2)*.8).lerp(HOT,heat*Math.max(0,1-t*2.4));col.lerp(SCORCH,clamp((t-.85)*6,0,1));colAttr.setXYZ(i,col.r,col.g,col.b);}
    pos.needsUpdate=true;colAttr.needsUpdate=true;c.rim.position.z=craterHeight(CRATER_R*.56)*ease+.05;c.mesh.geometry.computeBoundingSphere();}
}

// ----------------------------------------------------------------- driver
function onImpact(event){
  const p=event?.detail?.position,scene=bridge()?.threeScene;if(!Array.isArray(p)||!scene)return;const center=new THREE.Vector3(+p[0]||0,+p[1]||0,0);
  secondaryLeft=MAX_SECONDARY;spawnCrater(scene,center);ensureDebris(scene);
  const buildings=planBuildings(center),actors=planActors(scene,center);events.sort((a,b)=>a.at-b.at);
  setData("nukeDestruction",NUKE_DESTRUCTION_VERSION);setData("nukeDestructionBuildings",buildings);setData("nukeDestructionActors",actors);setData("nukeDestructionFullRadiusM",FULL_DESTROY_M);
}
function runEvent(scene,e){
  const I=intensityAt(e.distance??0);
  if(e.type==="building")collapseBuilding(scene,e.b,e.center);
  else if(e.type==="actor")hitActor(scene,e);
  else if(e.type==="local"){const t=e.target;if(t.kind==="player"&&globalThis.__arondightPlayerShield?.nukeImmune?.())return;if(t.kind==="drone"){const amount=Math.min(35,8*I);if(amount>1)t.model?.damage?.(amount,"explosion:nuke");}else{const amount=I>=1?1000:260*I;if(amount>2)t.model?.damage?.(amount,"explosion:nuke");}}
  else if(e.type==="rigid"){const rigid=globalThis.__arondightWorldRigidBodies,q=rigid?.pose?.(e.record.id)?.position;if(!q)return;tmp.set(q[0]-e.center.x,q[1]-e.center.y,0);if(tmp.lengthSq()<.01)tmp.set(1,0,0);tmp.normalize();const mass=Math.max(.1,Number(e.record.massKg)||1),dv=e.record.drone?Math.min(7,4*I):Math.min(70,28*I);rigid.applyImpulse?.(e.record.id,[tmp.x*mass*dv,tmp.y*mass*dv,mass*dv*.55],{point:q});}
  else if(e.type==="police"){if(I<.15)return;const hits=Math.min(6,Math.ceil(I*4));for(let i=0;i<hits;i++)bridge()?.registerPoliceHit?.({object:e.drone.hitbox||e.drone.root,point:e.drone.root.position.clone()});}
  else if(e.type==="peer"){if(I<.15)return;const hits=Math.min(6,Math.ceil(I*4));for(let i=0;i<hits;i++)bridge()?.registerVsHit?.({object:e.peer,point:e.peer.position.clone()});}
}
function frame(now){
  const dt=clamp((now-lastFrame)/1000,0,.05);lastFrame=now;const scene=bridge()?.threeScene;
  if(scene&&events.length){let budget=0;while(events.length&&events[0].at<=now&&budget<40){runEvent(scene,events.shift());budget++;}}
  if(pendingCommit){pendingCommit=false;commitDestruction();}
  const alive=stepDebris(dt);if(flung.length)stepFlung(dt);if(craters.length)stepCraters(now);
  if(alive||flung.length){setData("nukeDebrisAlive",alive);setData("nukeFlungActors",flung.length);}
  requestAnimationFrame(frame);
}
function resetWorld(){
  events.length=0;for(const f of flung){f.clone.parent?.remove(f.clone);f.root.visible=true;}flung.length=0;
  if(debris){const zero=new THREE.Matrix4().makeScale(0,0,0);debris.items.forEach((it,i)=>{if(it.alive){it.alive=false;debris.mesh.setMatrixAt(i,zero);}});debrisFree=debris.items.map((_,i)=>DEBRIS_POOL-1-i);debris.mesh.instanceMatrix.needsUpdate=true;}
  for(const c of craters){c.mesh.parent?.remove(c.mesh);c.mesh.geometry.dispose();c.mesh.material.dispose();c.rim.geometry.dispose();c.rim.material.dispose();}craters.length=0;
  setData("nukeDebrisAlive",0);setData("nukeFlungActors",0);
}
export function installNukeDestruction(){if(installed)return;installed=true;window.addEventListener("arondight:nuke-impact",onImpact);window.addEventListener("arondight:world-reset",resetWorld);requestAnimationFrame(frame);}
installNukeDestruction();
