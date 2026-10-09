import * as THREE from "three";
import {groundHeightAt} from "./terrain_craters.mjs";
import {buildCharacter} from "./character_model.mjs";

const MOBILE_RE=/(?:android|iphone|ipad|ipod|macintosh.*mobile)/i;
const MOBILE=MOBILE_RE.test(globalThis.navigator?.userAgent||"");
const MAX_RAGDOLLS=MOBILE?6:10;
const LIFE_MS=7000;
const FADE_MS=1800;
const GRAVITY=9.81;
const FIXED_STEP=1/60;
const MAX_STEPS=3;
const CONSTRAINT_ITERS=4;
const FLOOR_Z=.045;
const DAMPING=.992;
const BOUNCE=.16;
const FRICTION=.72;

// Joint points of the articulated character (character_model.mjs, rest
// pose): the ragdoll IS the same person model that walked — same body, same
// clothes — only its joints are driven by the Verlet skeleton now.
const REST={
  pelvis:[0,0,.96],chest:[0,0,1.5],head:[0,0,1.74],
  lShoulder:[-.225,0,1.5],rShoulder:[.225,0,1.5],
  lElbow:[-.225,0,1.2],rElbow:[.225,0,1.2],
  lHand:[-.225,0,.93],rHand:[.225,0,.93],
  lHip:[-.1,0,.94],rHip:[.1,0,.94],
  lKnee:[-.1,0,.49],rKnee:[.1,0,.49],
  lFoot:[-.1,0,.05],rFoot:[.1,0,.05],
};
// how far each joint sits above the ground when the body lies on it (limb
// thickness): no part sinks into the terrain
const FLOOR={pelvis:.11,chest:.13,head:.11,lShoulder:.07,rShoulder:.07,lElbow:.055,rElbow:.055,lHand:.045,rHand:.045,lHip:.08,rHip:.08,lKnee:.065,rKnee:.065,lFoot:.05,rFoot:.05};
const POINT_NAMES=Object.keys(REST);
const LINKS=[
  ["pelvis","chest"],["chest","head"],
  ["chest","lShoulder"],["lShoulder","lElbow"],["lElbow","lHand"],
  ["chest","rShoulder"],["rShoulder","rElbow"],["rElbow","rHand"],
  ["pelvis","lHip"],["lHip","lKnee"],["lKnee","lFoot"],
  ["pelvis","rHip"],["rHip","rKnee"],["rKnee","rFoot"],
  ["lShoulder","rShoulder"],["lHip","rHip"],
  // torso braces: chest/shoulders/hips form a rigid block
  ["lShoulder","pelvis"],["rShoulder","pelvis"],["chest","lHip"],["chest","rHip"],["lShoulder","rHip"],["rShoulder","lHip"],["head","lShoulder"],["head","rShoulder"],
];

const ragdolls=[];
let lastNow=performance.now(),accumulator=0,raf=0,serial=0;

function bridge(){return globalThis.__arondightRealWorld||null;}
function viewport(){return document.getElementById("viewport");}
function hashText(text){let h=2166136261;for(const c of String(text||"")){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}
function seededNoise(seed,index){let x=(seed+Math.imul(index+1,0x9e3779b1))>>>0;x^=x>>>16;x=Math.imul(x,0x7feb352d);x^=x>>>15;x=Math.imul(x,0x846ca68b);x^=x>>>16;return(x>>>0)/0xffffffff*2-1;}
function rotateYaw(x,y,yaw){const c=Math.cos(yaw),s=Math.sin(yaw);return[x*c-y*s,x*s+y*c];}
function setOpacity(r,value){for(const material of Object.values(r.materials)){material.opacity=value;material.transparent=value<.999;material.depthWrite=value>.35;}}

function makeRagdoll(index){
  const scene=bridge()?.threeScene;if(!scene)return null;
  const rig=buildCharacter({outfit:"civilian"}),group=rig.root;group.visible=false;group.userData.worldRagdollRoot=true;group.userData.worldRagdollIndex=index;
  rig.gun.visible=false;rig.gunL.visible=false;rig.visor.visible=false;
  // own materials per ragdoll (the character materials are shared caches)
  const materials={};group.traverse(n=>{if(!n.isMesh)return;const cat=n.userData.cat||"dark";materials[cat]??=n.material.clone();n.material=materials[cat];n.userData.worldRagdollPart=true;n.userData.flightFireIgnore=true;n.raycast=()=>{};});
  scene.add(group);
  const points=Object.fromEntries(POINT_NAMES.map(name=>[name,{p:new THREE.Vector3(),prev:new THREE.Vector3()}]));
  const constraints=LINKS.map(([a,b])=>{const av=REST[a],bv=REST[b];return{a,b,length:Math.hypot(av[0]-bv[0],av[1]-bv[1],av[2]-bv[2])};});
  return{index,group,rig,materials,points,constraints,active:false,born:0,expires:0,seed:0,id:"",settledMs:0,recover:null,getup:null};
}

function ensurePool(){const scene=bridge()?.threeScene;if(!scene)return false;while(ragdolls.length<MAX_RAGDOLLS){const item=makeRagdoll(ragdolls.length);if(!item)break;ragdolls.push(item);}const view=viewport();if(view){view.dataset.worldRagdollPool=String(ragdolls.length);view.dataset.worldRagdollMax=String(MAX_RAGDOLLS);}return ragdolls.length>0;}
function chooseRagdoll(){if(!ensurePool())return null;const free=ragdolls.find(r=>!r.active);if(free)return free;const r=ragdolls.reduce((a,b)=>a.born<=b.born?a:b);
  // a body that was going to get up is reused: that person gets up right now (never left hidden)
  if(r.recover){const rec=r.recover,p=r.points.pelvis.p;r.recover=null;r.getup=null;try{rec.onUp?.({x:p.x,y:p.y,yaw:0});}catch{}}return r;}

const QX=new THREE.Vector3(),QY=new THREE.Vector3(),QZ=new THREE.Vector3(),M3=new THREE.Matrix4(),DOWN=new THREE.Vector3(0,0,-1),UPV=new THREE.Vector3(0,0,1),ax=new THREE.Vector3(),dv=new THREE.Vector3(),rv=new THREE.Vector3(),uv=new THREE.Vector3(),qa=new THREE.Quaternion(),inv=new THREE.Quaternion();
const W={pelvis:new THREE.Quaternion(),spine:new THREE.Quaternion(),neck:new THREE.Quaternion(),shL:new THREE.Quaternion(),elL:new THREE.Quaternion(),shR:new THREE.Quaternion(),elR:new THREE.Quaternion(),hipL:new THREE.Quaternion(),knL:new THREE.Quaternion(),hipR:new THREE.Quaternion(),knR:new THREE.Quaternion()};
// orientation with x = right, z = up (y = forward = z × x)
function frame(out,right,up){QZ.copy(up).normalize();QX.copy(right).addScaledVector(QZ,-right.dot(QZ));if(QX.lengthSq()<1e-8)QX.set(1,0,0);QX.normalize();QY.crossVectors(QZ,QX);M3.makeBasis(QX,QY,QZ);return out.setFromRotationMatrix(M3);}
// parent orientation turned the shortest way so its bone axis points along dir
function align(out,parent,axis,dir){ax.copy(axis).applyQuaternion(parent);dv.copy(dir);if(dv.lengthSq()<1e-10)return out.copy(parent);dv.normalize();qa.setFromUnitVectors(ax,dv);return out.copy(qa).multiply(parent);}
function setLocal(joint,parentWorld,world){inv.copy(parentWorld).invert();joint.quaternion.copy(inv).multiply(world);}
function renderRagdoll(r){
  const P=n=>r.points[n].p,rig=r.rig;
  frame(W.pelvis,rv.subVectors(P("rHip"),P("lHip")),uv.subVectors(P("chest"),P("pelvis")));
  frame(W.spine,rv.subVectors(P("rShoulder"),P("lShoulder")),uv.subVectors(P("chest"),P("pelvis")));
  align(W.neck,W.spine,UPV,dv.subVectors(P("head"),P("chest")));
  align(W.shL,W.spine,DOWN,rv.subVectors(P("lElbow"),P("lShoulder")));align(W.elL,W.shL,DOWN,rv.subVectors(P("lHand"),P("lElbow")));
  align(W.shR,W.spine,DOWN,rv.subVectors(P("rElbow"),P("rShoulder")));align(W.elR,W.shR,DOWN,rv.subVectors(P("rHand"),P("rElbow")));
  align(W.hipL,W.pelvis,DOWN,rv.subVectors(P("lKnee"),P("lHip")));align(W.knL,W.hipL,DOWN,rv.subVectors(P("lFoot"),P("lKnee")));
  align(W.hipR,W.pelvis,DOWN,rv.subVectors(P("rKnee"),P("rHip")));align(W.knR,W.hipR,DOWN,rv.subVectors(P("rFoot"),P("rKnee")));
  rig.pelvis.position.copy(P("pelvis"));rig.pelvis.quaternion.copy(W.pelvis);
  setLocal(rig.spine,W.pelvis,W.spine);setLocal(rig.neck,W.spine,W.neck);rig.head.quaternion.identity();
  setLocal(rig.arms.L.sh,W.spine,W.shL);setLocal(rig.arms.L.el,W.shL,W.elL);rig.arms.L.wr.quaternion.identity();
  setLocal(rig.arms.R.sh,W.spine,W.shR);setLocal(rig.arms.R.el,W.shR,W.elR);rig.arms.R.wr.quaternion.identity();
  setLocal(rig.legs.L.hip,W.pelvis,W.hipL);setLocal(rig.legs.L.kn,W.hipL,W.knL);rig.legs.L.an.quaternion.identity();
  setLocal(rig.legs.R.hip,W.pelvis,W.hipR);setLocal(rig.legs.R.kn,W.hipR,W.knR);rig.legs.R.an.quaternion.identity();
}

// the floor is the real terrain under each point (not a flat z=0 plane)
function floorPoint(point,lift=FLOOR_Z){
  const floor=groundHeightAt(point.p.x,point.p.y)+lift;if(point.p.z>=floor)return;
  const vx=point.p.x-point.prev.x,vy=point.p.y-point.prev.y,vz=point.p.z-point.prev.z;
  point.p.z=floor;point.prev.x=point.p.x-vx*FRICTION;point.prev.y=point.p.y-vy*FRICTION;point.prev.z=point.p.z+vz*BOUNCE;
}
function solveConstraints(r){
  for(let iter=0;iter<CONSTRAINT_ITERS;iter++){
    for(const c of r.constraints){const a=r.points[c.a].p,b=r.points[c.b].p,dx=b.x-a.x,dy=b.y-a.y,dz=b.z-a.z,d=Math.hypot(dx,dy,dz)||1e-6,error=(d-c.length)/d*.5,cx=dx*error,cy=dy*error,cz=dz*error;a.x+=cx;a.y+=cy;a.z+=cz;b.x-=cx;b.y-=cy;b.z-=cz;}
    for(const name of POINT_NAMES)floorPoint(r.points[name],FLOOR[name]);
  }
}
function integrateRagdoll(r,dt){
  const dt2=dt*dt;let kinetic=0;
  for(const name of POINT_NAMES){const point=r.points[name],p=point.p,prev=point.prev,vx=(p.x-prev.x)*DAMPING,vy=(p.y-prev.y)*DAMPING,vz=(p.z-prev.z)*DAMPING;prev.copy(p);p.x+=vx;p.y+=vy;p.z+=vz-GRAVITY*dt2;kinetic+=vx*vx+vy*vy+vz*vz;floorPoint(point,FLOOR[name]);}
  solveConstraints(r);r.settledMs=kinetic<.00008?r.settledMs+dt*1000:0;
}
function physicsStep(dt){for(const r of ragdolls)if(r.active&&!r.getup)integrateRagdoll(r,dt);}

// "Reverse ragdoll": a person who still has life gets up again. Once the body
// has settled (or after a short while) the joints blend from where the ragdoll
// lies through a kneel into the standing rest pose — facing the way the body
// lay — and the person walks on from exactly there.
const GETUP_MS=1150;
function smooth(t){t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);}
function beginGetup(r,now){const P=n=>r.points[n].p,px=P("pelvis").x,py=P("pelvis").y;
  // facing: across the hips (right = rHip-lHip), or along pelvis→head when they lie on the side
  const hx=P("rHip").x-P("lHip").x,hy=P("rHip").y-P("lHip").y;let yaw=Math.atan2(hy,hx);if(!Number.isFinite(yaw))yaw=0;
  const from=Object.fromEntries(POINT_NAMES.map(n=>[n,P(n).clone()])),kneel={},stand={},g=groundHeightAt(px,py);
  for(const n of POINT_NAMES){const rest=REST[n],[rx,ry]=rotateYaw(rest[0],rest[1],yaw);stand[n]=new THREE.Vector3(px+rx,py+ry,g+rest[2]);
    // kneel: hips low, one knee down, torso upright
    const kz=n==="pelvis"||n.includes("Hip")?.52:n==="chest"||n.includes("Shoulder")?1.02:n==="head"?1.26:n.includes("Elbow")?.78:n.includes("Hand")?.55:n==="lKnee"?.07:n==="rKnee"?.5:.05;const fwd=n==="rKnee"||n==="rFoot"?.32:n==="lFoot"?-.3:0,[kx,ky]=rotateYaw(rest[0],fwd,yaw);kneel[n]=new THREE.Vector3(px+kx,py+ky,g+kz);}
  r.getup={start:now,from,kneel,stand,yaw,x:px,y:py};}
function stepGetup(r,now){const gu=r.getup,t=(now-gu.start)/GETUP_MS;
  for(const n of POINT_NAMES){const p=r.points[n].p;if(t<.45){const k=smooth(t/.45);p.copy(gu.from[n]).lerp(gu.kneel[n],k);}else{const k=smooth((t-.45)/.55);p.copy(gu.kneel[n]).lerp(gu.stand[n],k);}r.points[n].prev.copy(p);}
  if(t>=1){const rec=r.recover;r.active=false;r.group.visible=false;r.getup=null;r.recover=null;try{rec?.onUp?.({x:gu.x,y:gu.y,yaw:gu.yaw+Math.PI/2});}catch{}}}
// nothing of the body may sink into the ground: lift the whole skeleton by
// the deepest penetration of any part (exact oriented boxes of the meshes)
const BOX=new THREE.Box3(),CORNER=new THREE.Vector3();
function liftOutOfGround(r){let deficit=0;r.group.updateMatrixWorld(true);r.group.traverse(n=>{if(!n.isMesh||!n.visible)return;const geo=n.geometry;if(!geo.boundingBox)geo.computeBoundingBox();const b=geo.boundingBox;let minZ=Infinity,cx=0,cy=0;
    for(let i=0;i<8;i++){CORNER.set(i&1?b.max.x:b.min.x,i&2?b.max.y:b.min.y,i&4?b.max.z:b.min.z).applyMatrix4(n.matrixWorld);if(CORNER.z<minZ)minZ=CORNER.z;cx+=CORNER.x;cy+=CORNER.y;}
    const d=groundHeightAt(cx/8,cy/8)+.004-minZ;if(d>deficit)deficit=d;});
  if(deficit>.002){const lift=Math.min(deficit,.25);for(const name of POINT_NAMES){r.points[name].p.z+=lift;r.points[name].prev.z+=lift;}return true;}return false;}

function update(now=performance.now()){
  raf=requestAnimationFrame(update);let frameDt=Math.min(.08,Math.max(0,(now-lastNow)/1000));lastNow=now;accumulator+=frameDt;let steps=0;while(accumulator>=FIXED_STEP&&steps<MAX_STEPS){physicsStep(FIXED_STEP);accumulator-=FIXED_STEP;steps++;}if(steps===MAX_STEPS)accumulator=Math.min(accumulator,FIXED_STEP);
  let active=0;
  for(const r of ragdolls){if(!r.active)continue;if(now>=r.expires&&!r.recover){r.active=false;r.group.visible=false;continue;}active++;
    if(r.recover&&!r.getup&&(r.settledMs>350||now-r.born>(r.recover.afterMs||2600)))beginGetup(r,now);
    if(r.getup){stepGetup(r,now);if(!r.active)continue;setOpacity(r,1);renderRagdoll(r);continue;}
    const remaining=r.expires-now,opacity=r.recover?1:remaining<FADE_MS?Math.max(0,remaining/FADE_MS):1;setOpacity(r,opacity);renderRagdoll(r);if(now-r.born<6000&&liftOutOfGround(r))renderRagdoll(r);}
  const view=viewport();if(view){view.dataset.worldRagdolls=String(active);view.dataset.worldRagdollModel="articulated-character";}
}

function startLoop(){if(raf)return;lastNow=performance.now();raf=requestAnimationFrame(update);}

export function spawnWorldPersonRagdoll({position,yaw=0,impulse=[0,0,0],seed="",id="",colors=null,recover=null}={}){
  const r=chooseRagdoll();if(!r||!position)return false;startLoop();const origin=Array.isArray(position)?position:[position.x,position.y,position.z],ox=Number(origin[0])||0,oy=Number(origin[1])||0,oz=Number(origin[2])||0,ix=Number(impulse?.[0])||0,iy=Number(impulse?.[1])||0,iz=Number(impulse?.[2])||0,seedNumber=hashText(seed||id||String(++serial));
  // same clothes as the person who fell (no colour swap on death)
  // same clothes as the person who fell (no colour swap on death)
  const pal={shirt:[0x5a6f86,0x8a4b3e,0x4f6f4a,0xa08348,0x5e4f7a,0x3e6d6a][seedNumber%6],pants:[0x2c3138,0x3a3f45,0x3f3832,0x283646][seedNumber%4]};pal.vest=pal.shirt;
  for(const[cat,m]of Object.entries(r.materials)){const c=colors?.[cat]??pal[cat]??(cat==="gloves"?colors?.skin:null);if(c!=null)m.color.setHex(c);else m.color.copy(r.rig.root.userData.baseColors?.[cat]??m.color);}
  setOpacity(r,1);
  for(let i=0;i<POINT_NAMES.length;i++){
    const name=POINT_NAMES[i],rest=REST[name],[rx,ry]=rotateYaw(rest[0],rest[1],yaw),p=r.points[name].p,prev=r.points[name].prev,limbBoost=(name==="chest"||name==="head")?1.15:(name.includes("Hand")||name.includes("Foot"))?1.28:1,noise=.65;
    p.set(ox+rx,oy+ry,Math.max(oz,groundHeightAt(ox+rx,oy+ry))+rest[2]);const vx=(ix*limbBoost+seededNoise(seedNumber,i*3)*noise),vy=(iy*limbBoost+seededNoise(seedNumber,i*3+1)*noise),vz=(iz*limbBoost+1.1+Math.abs(seededNoise(seedNumber,i*3+2))*.9);prev.set(p.x-vx*FIXED_STEP,p.y-vy*FIXED_STEP,p.z-vz*FIXED_STEP);
  }
  r.active=true;r.born=performance.now();r.expires=r.born+LIFE_MS;r.seed=seedNumber;r.id=String(id||"");r.settledMs=0;r.recover=typeof recover?.onUp==="function"?recover:null;r.getup=null;if(r.recover)r.expires=r.born+60000;r.group.visible=true;r.group.userData.worldRagdollId=r.id;renderRagdoll(r);const view=viewport();if(view){view.dataset.worldRagdollSpawns=String((Number(view.dataset.worldRagdollSpawns)||0)+1);view.dataset.worldRagdollLastId=r.id;}return true;
}

export function worldPersonRagdollStats(){return{active:ragdolls.filter(r=>r.active).length,pool:ragdolls.length,max:MAX_RAGDOLLS,model:"articulated-character"};}

// shader prewarm: build the ragdoll pool early (hidden; compiled with everything else)
if(typeof window!=="undefined")(globalThis.__prewarmFactories??=[]).push(()=>{ensurePool();return null;});
