import * as THREE from "three";

const MOBILE_RE=/(?:android|iphone|ipad|ipod|macintosh.*mobile)/i;
const MOBILE=MOBILE_RE.test(globalThis.navigator?.userAgent||"");
const MAX_RAGDOLLS=MOBILE?6:10;
const LIFE_MS=7000;
const FADE_MS=1800;
const GRAVITY=9.81;
const FIXED_STEP=1/60;
const MAX_STEPS=3;
const CONSTRAINT_ITERS=4;
const DAMPING=.992;
const BOUNCE=.16;
const FRICTION=.72;

const REST={
  pelvis:[0,0,.78],chest:[0,0,1.18],head:[0,0,1.58],
  lShoulder:[-.27,0,1.27],rShoulder:[.27,0,1.27],
  lElbow:[-.49,0,1.05],rElbow:[.49,0,1.05],
  lHand:[-.61,.02,.80],rHand:[.61,.02,.80],
  lHip:[-.15,0,.78],rHip:[.15,0,.78],
  lKnee:[-.15,.015,.40],rKnee:[.15,.015,.40],
  lFoot:[-.15,.13,.08],rFoot:[.15,.13,.08],
};
const POINT_NAMES=Object.keys(REST);
const LINKS=[
  ["pelvis","chest"],["chest","head"],
  ["chest","lShoulder"],["lShoulder","lElbow"],["lElbow","lHand"],
  ["chest","rShoulder"],["rShoulder","rElbow"],["rElbow","rHand"],
  ["pelvis","lHip"],["lHip","lKnee"],["lKnee","lFoot"],
  ["pelvis","rHip"],["rHip","rKnee"],["rKnee","rFoot"],
  ["lShoulder","rShoulder"],["lHip","rHip"],
];
const SEGMENTS=[
  ["pelvis","chest",.19,"shirt"],["lShoulder","rShoulder",.12,"shirt"],["lHip","rHip",.11,"pants"],
  ["lShoulder","lElbow",.085,"shirt"],["lElbow","lHand",.065,"skin"],
  ["rShoulder","rElbow",.085,"shirt"],["rElbow","rHand",.065,"skin"],
  ["lHip","lKnee",.105,"pants"],["lKnee","lFoot",.082,"pants"],
  ["rHip","rKnee",.105,"pants"],["rKnee","rFoot",.082,"pants"],
];
const END_PARTS=[
  ["lHand",.07,.07,.07,"skin","hand"],["rHand",.07,.07,.07,"skin","hand"],
  ["lFoot",.09,.14,.07,"pants","foot"],["rFoot",.09,.14,.07,"pants","foot"],
];
const FLOOR_BY_POINT={head:.18,lHand:.07,rHand:.07,lFoot:.08,rFoot:.08,lKnee:.09,rKnee:.09,lElbow:.07,rElbow:.07,lShoulder:.09,rShoulder:.09,lHip:.11,rHip:.11,pelvis:.16,chest:.17};

const unitY=new THREE.Vector3(0,1,0),tmpDir=new THREE.Vector3(),tmpMid=new THREE.Vector3();
const ragdolls=[];
let cylinderGeometry=null,sphereGeometry=null,lastNow=performance.now(),accumulator=0,raf=0,serial=0;

function bridge(){return globalThis.__arondightRealWorld||null;}
function viewport(){return document.getElementById("viewport");}
function hashText(text){let h=2166136261;for(const c of String(text||"")){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}
function seededNoise(seed,index){let x=(seed+Math.imul(index+1,0x9e3779b1))>>>0;x^=x>>>16;x=Math.imul(x,0x7feb352d);x^=x>>>15;x=Math.imul(x,0x846ca68b);x^=x>>>16;return(x>>>0)/0xffffffff*2-1;}
function rotateYaw(x,y,yaw){const c=Math.cos(yaw),s=Math.sin(yaw);return[x*c-y*s,x*s+y*c];}
function setOpacity(r,value){for(const material of Object.values(r.materials)){material.opacity=value;material.transparent=value<.999;material.depthWrite=value>.35;}}
function applyColors(r,colors,seedNumber){
  const fallbackShirt=[0x32a4d8,0xd85a42,0x5cbb57,0xd4b640,0x835dcc][seedNumber%5],fallbackPants=[0x263647,0x3a3130,0x20323b,0x343a45][(seedNumber>>>3)%4],fallbackSkin=0xd6a27e;
  const shirt=Number(colors?.shirt),pants=Number(colors?.pants),skin=Number(colors?.skin);r.materials.shirt.color.setHex(Number.isFinite(shirt)?shirt:fallbackShirt);r.materials.pants.color.setHex(Number.isFinite(pants)?pants:fallbackPants);r.materials.skin.color.setHex(Number.isFinite(skin)?skin:fallbackSkin);
  r.group.userData.worldRagdollColors={shirt:r.materials.shirt.color.getHex(),pants:r.materials.pants.color.getHex(),skin:r.materials.skin.color.getHex()};
}

function markPart(mesh,kind){mesh.userData.worldRagdollPart=true;mesh.userData.flightFireIgnore=true;mesh.userData.ragdollKind=kind;return mesh;}
function makeRagdoll(index){
  const scene=bridge()?.threeScene;if(!scene)return null;
  cylinderGeometry??=new THREE.CylinderGeometry(1,1,1,9,1,false);sphereGeometry??=new THREE.SphereGeometry(1,10,8);
  const group=new THREE.Group();group.visible=false;group.userData.worldRagdollRoot=true;group.userData.worldRagdollHuman=true;group.userData.worldRagdollIndex=index;group.renderOrder=9;
  const materials={shirt:new THREE.MeshStandardMaterial({color:0x4aa6db,roughness:.72,metalness:0}),skin:new THREE.MeshStandardMaterial({color:0xd4a07d,roughness:.82,metalness:0}),pants:new THREE.MeshStandardMaterial({color:0x293847,roughness:.78,metalness:0})};
  const meshes=[];for(const [a,b,radius,kind] of SEGMENTS){const mesh=markPart(new THREE.Mesh(cylinderGeometry,materials[kind]),kind);mesh.userData.ragdollA=a;mesh.userData.ragdollB=b;group.add(mesh);meshes.push(mesh);}
  const head=markPart(new THREE.Mesh(sphereGeometry,materials.skin),"head");group.add(head);
  const ends=END_PARTS.map(([point,sx,sy,sz,kind,label])=>{const mesh=markPart(new THREE.Mesh(sphereGeometry,materials[kind]),label);mesh.userData.ragdollPoint=point;mesh.userData.ragdollScale=[sx,sy,sz];group.add(mesh);return mesh;});
  scene.add(group);
  const points=Object.fromEntries(POINT_NAMES.map(name=>[name,{p:new THREE.Vector3(),prev:new THREE.Vector3()}]));
  const constraints=LINKS.map(([a,b])=>{const av=REST[a],bv=REST[b];return{a,b,length:Math.hypot(av[0]-bv[0],av[1]-bv[1],av[2]-bv[2])};});
  return{index,group,materials,meshes,head,ends,points,constraints,active:false,born:0,expires:0,seed:0,id:"",settledMs:0};
}

function ensurePool(){const scene=bridge()?.threeScene;if(!scene)return false;while(ragdolls.length<MAX_RAGDOLLS){const item=makeRagdoll(ragdolls.length);if(!item)break;ragdolls.push(item);}const view=viewport();if(view){view.dataset.worldRagdollPool=String(ragdolls.length);view.dataset.worldRagdollMax=String(MAX_RAGDOLLS);}return ragdolls.length>0;}
function chooseRagdoll(){if(!ensurePool())return null;return ragdolls.find(r=>!r.active)||ragdolls.reduce((a,b)=>a.born<=b.born?a:b);}

function renderRagdoll(r){
  for(let i=0;i<SEGMENTS.length;i++){
    const [a,b,radius]=SEGMENTS[i],mesh=r.meshes[i],pa=r.points[a].p,pb=r.points[b].p;tmpDir.copy(pb).sub(pa);const length=Math.max(.001,tmpDir.length());tmpMid.copy(pa).add(pb).multiplyScalar(.5);mesh.position.copy(tmpMid);mesh.quaternion.setFromUnitVectors(unitY,tmpDir.multiplyScalar(1/length));mesh.scale.set(radius,length,radius);
  }
  r.head.position.copy(r.points.head.p);r.head.scale.setScalar(.18);
  for(let i=0;i<END_PARTS.length;i++){const [point,sx,sy,sz]=END_PARTS[i],mesh=r.ends[i];mesh.position.copy(r.points[point].p);mesh.scale.set(sx,sy,sz);}
}

function floorPoint(name,point){
  const floor=FLOOR_BY_POINT[name]??.07;if(point.p.z>=floor)return;const vx=point.p.x-point.prev.x,vy=point.p.y-point.prev.y,vz=point.p.z-point.prev.z;point.p.z=floor;point.prev.x=point.p.x-vx*FRICTION;point.prev.y=point.p.y-vy*FRICTION;point.prev.z=point.p.z+vz*BOUNCE;
}
function solveConstraints(r){for(let iter=0;iter<CONSTRAINT_ITERS;iter++){for(const c of r.constraints){const a=r.points[c.a].p,b=r.points[c.b].p,dx=b.x-a.x,dy=b.y-a.y,dz=b.z-a.z,d=Math.hypot(dx,dy,dz)||1e-6,error=(d-c.length)/d*.5,cx=dx*error,cy=dy*error,cz=dz*error;a.x+=cx;a.y+=cy;a.z+=cz;b.x-=cx;b.y-=cy;b.z-=cz;}for(const name of POINT_NAMES)floorPoint(name,r.points[name]);}}
function integrateRagdoll(r,dt){const dt2=dt*dt;let kinetic=0;for(const name of POINT_NAMES){const point=r.points[name],p=point.p,prev=point.prev,vx=(p.x-prev.x)*DAMPING,vy=(p.y-prev.y)*DAMPING,vz=(p.z-prev.z)*DAMPING;prev.copy(p);p.x+=vx;p.y+=vy;p.z+=vz-GRAVITY*dt2;kinetic+=vx*vx+vy*vy+vz*vz;floorPoint(name,point);}solveConstraints(r);r.settledMs=kinetic<.00008?r.settledMs+dt*1000:0;}
function physicsStep(dt){for(const r of ragdolls)if(r.active)integrateRagdoll(r,dt);}

function update(now=performance.now()){
  raf=requestAnimationFrame(update);let frameDt=Math.min(.08,Math.max(0,(now-lastNow)/1000));lastNow=now;accumulator+=frameDt;let steps=0;while(accumulator>=FIXED_STEP&&steps<MAX_STEPS){physicsStep(FIXED_STEP);accumulator-=FIXED_STEP;steps++;}if(steps===MAX_STEPS)accumulator=Math.min(accumulator,FIXED_STEP);
  let active=0;for(const r of ragdolls){if(!r.active)continue;if(now>=r.expires){r.active=false;r.group.visible=false;continue;}active++;const remaining=r.expires-now,opacity=remaining<FADE_MS?Math.max(0,remaining/FADE_MS):1;setOpacity(r,opacity);renderRagdoll(r);}
  const view=viewport();if(view){view.dataset.worldRagdolls=String(active);view.dataset.worldRagdollParts=String(active?(SEGMENTS.length+1+END_PARTS.length):0);}
}
function startLoop(){if(raf)return;lastNow=performance.now();raf=requestAnimationFrame(update);}

export function spawnWorldPersonRagdoll({position,yaw=0,impulse=[0,0,0],seed="",id="",colors=null}={}){
  const r=chooseRagdoll();if(!r||!position)return false;startLoop();const origin=Array.isArray(position)?position:[position.x,position.y,position.z],ox=Number(origin[0])||0,oy=Number(origin[1])||0,oz=Number(origin[2])||0,ix=Number(impulse?.[0])||0,iy=Number(impulse?.[1])||0,iz=Number(impulse?.[2])||0,seedNumber=hashText(seed||id||String(++serial));applyColors(r,colors,seedNumber);setOpacity(r,1);
  for(let i=0;i<POINT_NAMES.length;i++){
    const name=POINT_NAMES[i],rest=REST[name],[rx,ry]=rotateYaw(rest[0],rest[1],yaw),p=r.points[name].p,prev=r.points[name].prev,limbBoost=(name==="chest"||name==="head")?1.15:(name.includes("Hand")||name.includes("Foot"))?1.28:1,noise=.65;
    p.set(ox+rx,oy+ry,oz+rest[2]);const vx=ix*limbBoost+seededNoise(seedNumber,i*3)*noise,vy=iy*limbBoost+seededNoise(seedNumber,i*3+1)*noise,vz=iz*limbBoost+1.1+Math.abs(seededNoise(seedNumber,i*3+2))*.9;prev.set(p.x-vx*FIXED_STEP,p.y-vy*FIXED_STEP,p.z-vz*FIXED_STEP);
  }
  r.active=true;r.born=performance.now();r.expires=r.born+LIFE_MS;r.seed=seedNumber;r.id=String(id||"");r.settledMs=0;r.group.visible=true;r.group.userData.worldRagdollId=r.id;renderRagdoll(r);const view=viewport();if(view){view.dataset.worldRagdollSpawns=String((Number(view.dataset.worldRagdollSpawns)||0)+1);view.dataset.worldRagdollLastId=r.id;}return true;
}

export function worldPersonRagdollStats(){return{active:ragdolls.filter(r=>r.active).length,pool:ragdolls.length,max:MAX_RAGDOLLS,partsPerRagdoll:SEGMENTS.length+1+END_PARTS.length};}
