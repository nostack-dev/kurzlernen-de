import * as THREE from "three";
import {setBuildingDamage,commitDestruction,buildingDamage} from "./world_destruction_state.mjs";
import {actorRoots} from "./world_actor_roots.mjs";
import {addCrater,clearCraters,staticGroundHeightAt,CRATER_R as TERRAIN_CRATER_R} from "./terrain_craters.mjs";

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
const DEBRIS_POOL=2000,DEBRIS_LIFE_S=22,GRAVITY=9.81;
const FLING_LIFE_S=9,MAX_FLUNG=140,MAX_SECONDARY=10;
const CRATER_R=TERRAIN_CRATER_R,CRATER_RINGS=30,CRATER_SEGMENTS=72,MAX_CRATERS=3;

let lastCommit=-Infinity;
let installed=false,debris=null,debrisFree=[],debrisActive=[],events=[],flung=[],craters=[],secondaryLeft=0,lastFrame=performance.now(),pendingCommit=false;
const UP=new THREE.Vector3(0,0,1),tmp=new THREE.Vector3(),tmp2=new THREE.Vector3(),m4=new THREE.Matrix4(),qa=new THREE.Quaternion(),sc=new THREE.Vector3(),col=new THREE.Color();

const viewport=()=>document.getElementById("viewport");
const bridge=()=>globalThis.__arondightRealWorld||null;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number(v)||0));
const rand=(a,b)=>a+Math.random()*(b-a);
function setData(key,value){const v=viewport();if(v){const s=String(value);if(v.dataset[key]!==s)v.dataset[key]=s;}}
function intensityAt(distance){return Math.pow(FULL_DESTROY_M/Math.max(8,distance),1.5);}

// ---------------------------------------------------------------- debris
// Debris material: same look as everything else (dark fill, neon edges) in a
// single instanced draw call. Edges come from the box UVs + fwidth, so every
// chunk is outlined without any extra line geometry.
function debrisMaterial(){
  return new THREE.RawShaderMaterial({glslVersion:THREE.GLSL3,
    vertexShader:`precision highp float;
in vec3 position;in vec2 uv;in mat4 instanceMatrix;in vec3 instanceColor;
uniform mat4 modelViewMatrix;uniform mat4 projectionMatrix;
out vec2 vUv;out vec3 vEdge;
void main(){vUv=uv;vEdge=instanceColor;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.0);}`,
    fragmentShader:`precision highp float;
in vec2 vUv;in vec3 vEdge;out vec4 outColor;
void main(){vec2 w=fwidth(vUv)*1.6;vec2 a=smoothstep(vec2(0.0),w,vUv);vec2 b=smoothstep(vec2(0.0),w,1.0-vUv);float inside=min(min(a.x,a.y),min(b.x,b.y));
vec3 fill=vec3(0.62,0.58,0.52);outColor=vec4(mix(vEdge,fill,inside),1.0);}`});
}
function ensureDebris(scene){
  if(debris?.mesh.parent===scene)return debris;
  if(debris?.mesh.parent)debris.mesh.parent.remove(debris.mesh);
  const geometry=new THREE.BoxGeometry(1,1,1),material=debrisMaterial();
  const mesh=new THREE.InstancedMesh(geometry,material,DEBRIS_POOL);mesh.name="NUKE_DEBRIS";mesh.frustumCulled=false;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.userData.flightFireIgnore=true;mesh.userData.neonSkip=true;mesh.userData.nukeWeaponPart=true;
  const zero=new THREE.Matrix4().makeScale(0,0,0);for(let i=0;i<DEBRIS_POOL;i++){mesh.setMatrixAt(i,zero);mesh.setColorAt(i,col.set(0x00ff9c));}
  mesh.instanceMatrix.needsUpdate=true;mesh.instanceColor.needsUpdate=true;scene.add(mesh);
  const items=Array.from({length:DEBRIS_POOL},()=>({alive:false,p:new THREE.Vector3(),v:new THREE.Vector3(),base:new THREE.Quaternion(),axis:new THREE.Vector3(1,0,0),angle:0,spin:0,size:new THREE.Vector3(1,1,1),age:0,rest:false}));
  debrisFree=items.map((_,i)=>DEBRIS_POOL-1-i);debris={mesh,items};return debris;
}
function spawnDebris(scene,at,velocity,size,color,yaw=null){
  const d=ensureDebris(scene);if(!debrisFree.length)return;const i=debrisFree.pop(),item=d.items[i];
  item.alive=true;item.rest=false;item.age=0;item.p.copy(at);item.v.copy(velocity);item.base.setFromAxisAngle(UP,yaw??Math.random()*6.28);item.axis.set(rand(-1,1),rand(-1,1),rand(-1,1)).normalize();item.angle=rand(0,6.28);item.spin=rand(-9,9);item.size.copy(size);debrisActive.push(i);
  d.mesh.setColorAt(i,color);d.mesh.instanceColor.needsUpdate=true;
}
function stepDebris(dt){
  if(!debris||!debrisActive.length)return 0;const{mesh,items}=debris;
  for(let slot=debrisActive.length-1;slot>=0;slot--){const i=debrisActive[slot],it=items[i];it.age+=dt;
    if(!it.rest){it.v.z-=GRAVITY*dt;it.v.multiplyScalar(Math.exp(-.08*dt));it.p.addScaledVector(it.v,dt);it.angle+=it.spin*dt;const floor=it.size.z*.5;
      if(it.p.z<floor){it.p.z=floor;if(Math.abs(it.v.z)<2.2&&Math.hypot(it.v.x,it.v.y)<1.5){it.rest=true;it.v.set(0,0,0);it.spin=0;}else{it.v.z=-it.v.z*.28;it.v.x*=.55;it.v.y*=.55;it.spin*=.5;}}}
    let sink=0;if(it.age>DEBRIS_LIFE_S-3)sink=(it.age-(DEBRIS_LIFE_S-3))/3*it.size.z;
    if(it.age>DEBRIS_LIFE_S){it.alive=false;debrisFree.push(i);debrisActive.splice(slot,1);m4.makeScale(0,0,0);mesh.setMatrixAt(i,m4);continue;}
    qa.setFromAxisAngle(it.axis,it.angle).multiply(it.base);tmp.copy(it.p);tmp.z-=sink;m4.compose(tmp,qa,it.size);mesh.setMatrixAt(i,m4);}
  mesh.instanceMatrix.needsUpdate=true;return debrisActive.length;
}

// ------------------------------------------------------------- buildings
// Every building that is drawn: collision prisms near the player plus the
// full map city (world_city_buildings.mjs), merged by footprint key.
function buildingsFromSnapshot(){
  const groups=new Map();
  const add=(key,rings,base,top,leveled)=>{if(!key||leveled)return;let g=groups.get(key);if(!g){g={key,points:[],rings:[],base,top};groups.set(key,g);}for(const r of rings){const pts=r.filter(p=>Number.isFinite(Number(p?.[0]))&&Number.isFinite(Number(p?.[1])));if(pts.length<3)continue;g.points.push(...pts);g.rings.push(pts);}g.base=Math.min(g.base,base);g.top=Math.max(g.top,top);};
  for(const prism of bridge()?.buildingCollisionSnapshot?.prisms||[])add(String(prism?.buildingKey||""),[prism.points||[]],Number(prism.base)||0,Number(prism.top)||8,prism.leveled);
  for(const fp of globalThis.__arondightCityBuildings?.footprints?.()||[]){if(groups.has(String(fp.key)))continue;const d=buildingDamage(fp.key);add(String(fp.key),[fp.outer||[]],Number(fp.base)||0,d?Math.min(Number(fp.top)||8,d.top):Number(fp.top)||8,d?.leveled);}
  const list=[];for(const g of groups.values()){if(!g.points.length)continue;let cx=0,cy=0;for(const p of g.points){cx+=+p[0];cy+=+p[1];}cx/=g.points.length;cy/=g.points.length;let r=0,minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;for(const p of g.points){r=Math.max(r,Math.hypot(p[0]-cx,p[1]-cy));minX=Math.min(minX,p[0]);maxX=Math.max(maxX,p[0]);minY=Math.min(minY,p[1]);maxY=Math.max(maxY,p[1]);}list.push({...g,cx,cy,r,minX,maxX,minY,maxY,height:Math.max(1,g.top-g.base)});}
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
    if(b.newTop===null||b.newTop>=b.top-.5){standing.push(b);if(I>=.06)events.push({at:performance.now()+b.distance/SHOCK_MPS*1000,type:"sway",b,center:center.clone(),intensity:I});continue;}
    standing.push({...b,leveled:b.leveled,r:b.leveled?b.r*.3:b.r*(.6+.4*(b.newTop-b.base)/b.height)});
    events.push({at:performance.now()+b.distance/SHOCK_MPS*1000,type:"building",b,center:center.clone()});
  }
  return list.length;
}
// Edge colors of the debris: neon green structure, hot embers.
// Debris edge colours (cartoon outline): dark ink, a few warm embers.
const GREEN=new THREE.Color(0x3b3f46),EMBER=new THREE.Color(0xff8a3d),DIM=new THREE.Color(0x6b5a4a);
// Structural fracture: the removed part of a building breaks along its real
// geometry — façade panels per outline edge and floor band, plus roof slabs —
// instead of random cubes. Piece count adapts to size (cap per building) and
// the whole city's debris stays one instanced draw call.
const FLOOR_M=3.2,PANEL_MAX_M=7,MAX_PIECES=40;
function collapseBuilding(scene,b,center,{tear=true}={}){
  setBuildingDamage(b.key,{top:b.newTop,leveled:b.leveled});pendingCommit=true;
  // Instant: the drawn building loses its upper part in this very frame.
  try{globalThis.__arondightCityBuildings?.damageNow?.(b.key,b.newTop);}catch{}
  const removed=Math.max(0,b.top-b.newTop);if(removed<.5)return;
  // The removed part is torn off as one piece first (it leans away from the
  // blast and is carried outward), then shatters into fracture debris.
  // Right at ground zero everything is vaporised into debris at once.
  if(tear&&removed>2&&b.intensity<2.4&&chunks.length<CHUNK_MAX&&spawnChunk(scene,b,center))return;
  fractureDebris(scene,b,center,null,1);
}
function fractureDebris(scene,b,center,offset,boost){
  const removed=Math.max(0,b.top-b.newTop);if(removed<.5)return;
  const outward=tmp2.set(b.cx-center.x,b.cy-center.y,0);if(outward.lengthSq()<1)outward.set(1,0,0);outward.normalize();const I=Math.min(b.intensity,2.5);
  const segments=[];for(const ring of b.rings)for(let i=0;i<ring.length;i++){const a=ring[i],c=ring[(i+1)%ring.length],len=Math.hypot(c[0]-a[0],c[1]-a[1]);if(len<.4)continue;const parts=Math.max(1,Math.ceil(len/PANEL_MAX_M));for(let k=0;k<parts;k++){const t0=k/parts,t1=(k+1)/parts;segments.push({x:a[0]+(c[0]-a[0])*(t0+t1)/2,y:a[1]+(c[1]-a[1])*(t0+t1)/2,len:len/parts,yaw:Math.atan2(c[1]-a[1],c[0]-a[0])});}}
  let floors=Math.max(1,Math.round(removed/FLOOR_M));const roofCells=Math.max(1,Math.min(10,Math.round((b.maxX-b.minX)*(b.maxY-b.minY)/60)));
  while(segments.length*floors+roofCells>MAX_PIECES&&floors>1)floors--;
  const stride=Math.max(1,Math.ceil(segments.length*floors/(MAX_PIECES-roofCells))),band=removed/floors,ox=offset?.x||0,oy=offset?.y||0,oz=offset?.z||0;
  const launch=(at,size,yaw,edge)=>{at.x+=ox;at.y+=oy;at.z+=oz;const radial=tmp.set(at.x-center.x,at.y-center.y,0);if(radial.lengthSq()<1)radial.copy(outward);radial.normalize();const speed=(9+30*I)*rand(.55,1.2)*boost,v=new THREE.Vector3(radial.x*speed+rand(-5,5),radial.y*speed+rand(-5,5),rand(2,8)+8*I*rand(.2,1));spawnDebris(scene,at,v,size,edge,yaw);};
  for(let f=0;f<floors;f++)for(let i=f%stride;i<segments.length;i+=stride){const sg=segments[i],z=b.newTop+band*(f+.5);launch(new THREE.Vector3(sg.x,sg.y,z),new THREE.Vector3(sg.len*rand(.85,1),.45,band*rand(.8,1)),sg.yaw,Math.random()<.18?EMBER:Math.random()<.35?DIM:GREEN);}
  for(let i=0;i<roofCells;i++)launch(new THREE.Vector3(rand(b.minX,b.maxX),rand(b.minY,b.maxY),b.top-.3),new THREE.Vector3(rand(3,7),rand(3,7),.5),Math.random()*6.28,Math.random()<.25?EMBER:GREEN);
}

// ---------------------------------------------------------- torn chunks
// The upper part of a building as one solid piece (flat dark fill + neon
// outline, like the city), pivoting on its leeward base edge: it tips away
// from ground zero and is carried outward by the wind behind the front,
// then breaks apart. Pooled count, geometry freed when it breaks.
const CHUNK_MAX=40;let chunks=[];
const chunkFill=new THREE.MeshBasicMaterial({color:0xcdb99a,toneMapped:false,fog:true,side:THREE.DoubleSide});
const chunkLine=new THREE.LineBasicMaterial({color:0x3b3f46,toneMapped:false,fog:true,transparent:true,opacity:.35});
function largestRing(b){let best=null,area=-1;for(const r of b.rings){let a=0;for(let i=0;i<r.length;i++){const p=r[i],q=r[(i+1)%r.length];a+=p[0]*q[1]-q[0]*p[1];}a=Math.abs(a);if(a>area){area=a;best=r;}}return best;}
function spawnChunk(scene,b,center){
  const ring=largestRing(b);if(!ring||ring.length<3)return false;
  const dir=new THREE.Vector3(b.cx-center.x,b.cy-center.y,0);if(dir.lengthSq()<1)dir.set(1,0,0);dir.normalize();
  let reach=-Infinity;for(const p of ring)reach=Math.max(reach,(p[0]-b.cx)*dir.x+(p[1]-b.cy)*dir.y);
  const pivot=new THREE.Vector3(b.cx+dir.x*reach,b.cy+dir.y*reach,b.newTop),h=b.top-b.newTop;
  let pts=ring.map(p=>new THREE.Vector2(p[0]-pivot.x,p[1]-pivot.y));if(pts.length>3&&pts[0].distanceToSquared(pts.at(-1))<1e-8)pts.pop();if(pts.length<3)return false;if(THREE.ShapeUtils.isClockWise(pts))pts.reverse();
  const pos=[],line=[];
  for(const f of THREE.ShapeUtils.triangulateShape(pts,[])){for(const k of f)pos.push(pts[k].x,pts[k].y,h);for(const k of[f[0],f[2],f[1]])pos.push(pts[k].x,pts[k].y,0);}
  for(let i=0;i<pts.length;i++){const a=pts[i],c=pts[(i+1)%pts.length];pos.push(a.x,a.y,0,c.x,c.y,0,c.x,c.y,h,a.x,a.y,0,c.x,c.y,h,a.x,a.y,h);line.push(a.x,a.y,h,c.x,c.y,h,a.x,a.y,0,c.x,c.y,0,a.x,a.y,0,a.x,a.y,h);}
  const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));
  const lg=new THREE.BufferGeometry();lg.setAttribute("position",new THREE.Float32BufferAttribute(line,3));
  const group=new THREE.Group();group.name="NUKE_TORN_CHUNK";group.position.copy(pivot);
  const fill=new THREE.Mesh(g,chunkFill),edges=new THREE.LineSegments(lg,chunkLine);
  for(const n of[group,fill,edges]){n.userData.flightFireIgnore=true;n.userData.neonSkip=true;n.userData.nukeWeaponPart=true;n.frustumCulled=false;n.raycast=()=>{};}
  group.add(fill,edges);scene.add(group);
  const I=Math.min(b.intensity,2.4),axis=new THREE.Vector3(-dir.y,dir.x,0);
  chunks.push({group,g,lg,b,center:center.clone(),dir,axis,pivot,age:0,
    tilt:Math.min(1.45,.35+.55*I+.25*Math.min(1,h/30))*rand(.8,1.1),
    speed:(6+22*I)*rand(.75,1.15),lift:rand(1,4)+3*I,
    breakAt:Math.max(.28,1.15-.38*I)*rand(.85,1.2)});
  setData("nukeTornChunks",chunks.length);return true;
}
const chunkOffset=new THREE.Vector3();
function stepChunks(scene,dt){
  for(let i=chunks.length-1;i>=0;i--){const c=chunks[i];c.age+=dt;const t=c.age,k=Math.min(1,t/c.breakAt),ease=k*k*(3-2*k);
    c.group.quaternion.setFromAxisAngle(c.axis,c.tilt*ease);
    chunkOffset.copy(c.dir).multiplyScalar(c.speed*t*t/(2*c.breakAt)).setZ(c.lift*t-.5*GRAVITY*t*t*.35);
    c.group.position.copy(c.pivot).add(chunkOffset);
    if(t>=c.breakAt){scene&&fractureDebris(scene,c.b,c.center,chunkOffset,1+.35*c.tilt);c.group.parent?.remove(c.group);c.g.dispose();c.lg.dispose();chunks.splice(i,1);}}
}
function clearChunks(){for(const c of chunks){c.group.parent?.remove(c.group);c.g.dispose();c.lg.dispose();}chunks.length=0;}

// Static instanced props (trees, street lamps): flattened when the shock
// passes and thrown as debris. Animated instanced crowds rewrite their own
// matrices every frame and are handled by their population modules.
const flattenedProps=[],instM=new THREE.Matrix4(),instP=new THREE.Vector3(),instQ=new THREE.Quaternion(),instS=new THREE.Vector3(),ZERO=new THREE.Matrix4().makeScale(0,0,0);
function planInstancedProps(scene,center){
  scene.traverse(node=>{if(!node.isInstancedMesh||node.userData?.nukeWeaponPart||node.userData?.neonSkip)return;node.updateWorldMatrix(true,false);
    for(let i=0;i<node.count;i++){node.getMatrixAt(i,instM);instM.premultiply(node.matrixWorld);instM.decompose(instP,instQ,instS);if(instS.x<1e-4)continue;const d=Math.hypot(instP.x-center.x,instP.y-center.y);if(d>FULL_DESTROY_M*1.25)continue;
      events.push({at:performance.now()+d/SHOCK_MPS*1000,type:"prop",mesh:node,index:i,position:instP.clone(),size:Math.max(.5,instS.z),distance:d,center:center.clone()});}});
}
function flattenProp(scene,e){
  const node=e.mesh;if(!node.parent)return;const original=new THREE.Matrix4();node.getMatrixAt(e.index,original);flattenedProps.push({mesh:node,index:e.index,matrix:original});node.setMatrixAt(e.index,ZERO);node.instanceMatrix.needsUpdate=true;
  const dir=tmp.set(e.position.x-e.center.x,e.position.y-e.center.y,0);if(dir.lengthSq()<1)dir.set(1,0,0);dir.normalize();const I=Math.min(intensityAt(e.distance),2.5),speed=(10+26*I)*rand(.6,1.1);
  for(let k=0;k<2;k++)spawnDebris(scene,e.position.clone().add(new THREE.Vector3(0,0,1+k)),new THREE.Vector3(dir.x*speed,dir.y*speed,4+6*I),new THREE.Vector3(.5,.5,Math.min(4,e.size)*rand(.4,.7)),Math.random()<.3?EMBER:GREEN);
}

// --------------------------------------------- vehicles, people, bodies
function populationRoots(scene){const out=new Map();for(const[id,{root,kind}]of actorRoots(scene))out.set(id,{root,kind});return out;}
function meshFor(root){let found=null;root.traverse?.(n=>{if(!found&&n.isMesh)found=n;});return found||root;}
function planActors(scene,center){
  let n=0;for(const[id,{root,kind}]of populationRoots(scene)){if(root.visible===false)continue;root.getWorldPosition(tmp);const d=Math.hypot(tmp.x-center.x,tmp.y-center.y);if(d>MAX_EFFECT_M*.8)continue;events.push({at:performance.now()+d/SHOCK_MPS*1000,type:"actor",id,root,kind:kind.replace(/^life-/,""),center:center.clone(),distance:d});n++;}
  const vitals=globalThis.__arondightPlayerVitals;for(const target of vitals?.damageTargets?.()||[]){const p=target.position;if(!p)continue;const d=Math.hypot(p.x-center.x,p.y-center.y);events.push({at:performance.now()+d/SHOCK_MPS*1000,type:"local",target,distance:d,center:center.clone()});}
  const rigid=globalThis.__arondightWorldRigidBodies;if(rigid?.engine?.records)for(const record of rigid.engine.records.values()){const q=rigid.pose?.(record.id)?.position;if(!q)continue;const d=Math.hypot(q[0]-center.x,q[1]-center.y);if(d<MAX_EFFECT_M)events.push({at:performance.now()+d/SHOCK_MPS*1000,type:"rigid",record,distance:d,center:center.clone()});}
  for(const drone of globalThis.__arondightWantedSystem?.drones||[]){if(!drone?.active||!drone.root)continue;drone.root.getWorldPosition(tmp);const d=tmp.distanceTo(center);if(d<MAX_EFFECT_M)events.push({at:performance.now()+d/SHOCK_MPS*1000,type:"police",drone,distance:d});}
  /* other players: every client runs the nuke (remote nukes are replayed) and damages only its own player, so nobody is hit twice */
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
  clone.traverse(n=>{n.userData={flightFireIgnore:true,nukeFlung:true,neonSkip:true};n.layers.enable(0);});scene.add(clone);
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
// The visible crater surface is WORLD_GROUND itself. It is rebuilt from the same
// 5 m triangle field as Box3D, so there is never a second decorative floor that
// can sit above the physical bowl. This module only adds contour lines.
// The crater is a real deformed mesh: flat dark fill (the game's look, no
// colour gradients) plus neon contour lines — concentric rings and radial
// spokes that sit on the deformed surface, so the bowl and the raised rim
// read clearly. The lines start white-hot and cool to neon green.
const CONTOUR_RINGS=9,CONTOUR_SPOKES=24,CONTOUR_SEG=72,CONTOUR_STEPS=24;
function contourBase(){
  const out=[];
  for(let k=1;k<=CONTOUR_RINGS;k++){const r=CRATER_R*k/(CONTOUR_RINGS+.6);for(let i=0;i<CONTOUR_SEG;i++){const a=i/CONTOUR_SEG*Math.PI*2,b=(i+1)/CONTOUR_SEG*Math.PI*2;out.push(Math.cos(a)*r,Math.sin(a)*r,Math.cos(b)*r,Math.sin(b)*r);}}
  for(let k=0;k<CONTOUR_SPOKES;k++){const a=k/CONTOUR_SPOKES*Math.PI*2,c=Math.cos(a),sn=Math.sin(a);for(let i=0;i<CONTOUR_STEPS;i++){const r0=CRATER_R*i/CONTOUR_STEPS,r1=CRATER_R*(i+1)/CONTOUR_STEPS;out.push(c*r0,sn*r0,c*r1,sn*r1);}}
  return out;
}
let contourXY=null;
function spawnCrater(scene,center){
  // Commit the shared terrain immediately: renderer, walking height and Box3D
  // receive one terrain-change event and therefore agree from this frame on.
  addCrater(center.x,center.y);
  contourXY??=contourBase();
  const linePos=new Float32Array(contourXY.length/2*3);
  for(let i=0,j=0;i<contourXY.length;i+=2,j+=3){
    const x=contourXY[i],y=contourXY[i+1];
    linePos[j]=x;linePos[j+1]=y;
    linePos[j+2]=staticGroundHeightAt(center.x+x,center.y+y)+.08;
  }
  const lineGeo=new THREE.BufferGeometry();lineGeo.setAttribute("position",new THREE.BufferAttribute(linePos,3));
  const rim=new THREE.LineSegments(lineGeo,new THREE.LineBasicMaterial({color:0x2a2018,transparent:true,opacity:.82,depthWrite:false}));
  rim.name="NUKE_CRATER_CONTOURS";rim.position.set(center.x,center.y,0);rim.raycast=()=>{};rim.frustumCulled=false;rim.userData.neonSkip=true;rim.userData.flightFireIgnore=true;scene.add(rim);
  craters.push({mesh:rim,rim,born:performance.now(),lastColor:-Infinity,contourOnly:true});
  while(craters.length>MAX_CRATERS){
    const old=craters.shift();old.mesh.parent?.remove(old.mesh);old.mesh.geometry.dispose();old.mesh.material.dispose();
  }
  setData("nukeCraterSurface","shared-terrain-box3d-exact-v2");
}
const LINE_HOT=new THREE.Color(0xff8a3d),LINE_NEON=new THREE.Color(0x4a3a2c);
function stepCraters(now){
  for(const c of craters){const age=(now-c.born)/1000;if(now-c.lastColor<120)continue;c.lastColor=now;
    const heat=Math.max(0,1-age/45),appear=clamp(age/.32,0,1);c.rim.material.color.copy(LINE_NEON).lerp(LINE_HOT,heat*heat);c.rim.material.opacity=.82*appear;}
}

// ----------------------------------------------------------------- driver
// ------------------------------------------- everyday destructibles
// Every non-nuke explosion (missiles, exploding cars, police drones,
// secondary blasts) chips buildings too. Each building has structural HP
// proportional to its volume; damage accumulates, upper floors break off
// as the HP drops, and at zero it collapses — same fracture debris, same
// persistent state (collision, rendering, map) as the nuke.
const buildingHp=new Map();
function structuralHp(b){return Math.max(220,(b.maxX-b.minX)*(b.maxY-b.minY)*b.height*.22);}
function onWorldExplosion(event){
  const d=event?.detail||{};if(d.kind==="nuke")return;const p=d.position,scene=bridge()?.threeScene;if(!scene)return;
  const x=Array.isArray(p)?+p[0]:+p?.x,y=Array.isArray(p)?+p[1]:+p?.y,z=Array.isArray(p)?+p[2]:+p?.z;if(!Number.isFinite(x)||!Number.isFinite(y))return;
  const radius=clamp(d.radiusM??6,2,40),power=clamp(d.maxDamage??60,10,400)*(d.kind==="missile"||String(d.source||"").includes("missile")?2.2:1);let touched=0;
  for(const b of buildingsFromSnapshot()){
    const dx=Math.max(b.minX-x,0,x-b.maxX),dy=Math.max(b.minY-y,0,y-b.maxY),dist=Math.hypot(dx,dy,Math.max(0,(Number.isFinite(z)?z:0)-b.top));if(dist>radius)continue;
    const full=structuralHp(b),prev=buildingHp.has(b.key)?buildingHp.get(b.key):full,damage=power*(1-dist/radius)**1.5*2.6,hp=Math.max(0,prev-damage);buildingHp.set(b.key,hp);
    const keep=hp/full,targetTop=hp<=0?b.base+Math.min(RUBBLE_M,b.height):b.base+Math.max(RUBBLE_M,Math.ceil(b.height*keep/FLOOR_M)*FLOOR_M);
    if(targetTop>=b.top-.4)continue;touched++;
    collapseBuilding(scene,{...b,newTop:targetTop,leveled:hp<=0,intensity:.35+.6*(1-dist/radius)},new THREE.Vector3(x,y,0));
  }
  if(touched)setData("worldDestructibleHits",(Number(viewport()?.dataset.worldDestructibleHits)||0)+touched);
}

// The drone is shaken hard but protected from destruction from the moment a
// nuke goes off until the blast, debris and fires have calmed down.
let droneProtectedUntil=-Infinity;
globalThis.__arondightNukeShake={droneProtected:()=>performance.now()<droneProtectedUntil};
window.addEventListener?.("arondight:nuke-launch",()=>{droneProtectedUntil=Math.max(droneProtectedUntil,performance.now()+40000);});
function onImpact(event){droneProtectedUntil=performance.now()+40000;
  const p=event?.detail?.position,scene=bridge()?.threeScene;if(!Array.isArray(p)||!scene)return;const center=new THREE.Vector3(+p[0]||0,+p[1]||0,0);
  secondaryLeft=MAX_SECONDARY;spawnCrater(scene,center);ensureDebris(scene);
  const buildings=planBuildings(center),actors=planActors(scene,center);planInstancedProps(scene,center);events.sort((a,b)=>a.at-b.at);
  setData("nukeDestruction",NUKE_DESTRUCTION_VERSION);setData("nukeDestructionBuildings",buildings);setData("nukeDestructionActors",actors);setData("nukeDestructionFullRadiusM",FULL_DESTROY_M);
}
function runEvent(scene,e){
  const I=intensityAt(e.distance??0);
  if(e.type==="building"){collapseBuilding(scene,e.b,e.center);if(!e.b.leveled)globalThis.__arondightCityBuildings?.sway?.(e.b.key,e.b.cx-e.center.x,e.b.cy-e.center.y,3.5*Math.min(1,e.b.intensity));}
  else if(e.type==="sway")globalThis.__arondightCityBuildings?.sway?.(e.b.key,e.b.cx-e.center.x,e.b.cy-e.center.y,Math.min(4,1+9*e.intensity));
  else if(e.type==="prop")flattenProp(scene,e);
  else if(e.type==="actor")hitActor(scene,e);
  else if(e.type==="local"){const t=e.target;if(t.kind==="player"&&globalThis.__arondightPlayerShield?.nukeImmune?.())return;if(t.kind==="drone"){/* protected: shaken, never destroyed */}else{const amount=I>=1?1000:260*I;if(amount>2)t.model?.damage?.(amount,"explosion:nuke");}}
  else if(e.type==="rigid"){const rigid=globalThis.__arondightWorldRigidBodies,q=rigid?.pose?.(e.record.id)?.position;if(!q)return;tmp.set(q[0]-e.center.x,q[1]-e.center.y,0);if(tmp.lengthSq()<.01)tmp.set(1,0,0);tmp.normalize();const mass=Math.max(.1,Number(e.record.massKg)||1);
    if(e.record.drone){// Heavy buffeting: a hard first punch, then a burst of turbulent kicks.
      const punch=Math.min(1.6,.5+.8*I);rigid.applyImpulse?.(e.record.id,[tmp.x*mass*punch,tmp.y*mass*punch,mass*punch*.6],{point:q});
      const now=performance.now();for(let k=1;k<=9;k++)events.push({at:now+k*rand(160,320),type:"buffet",record:e.record,strength:Math.min(1.6,.4+I)*(1-k/11)});events.sort((a,b)=>a.at-b.at);}
    else{const dv=Math.min(70,28*I);rigid.applyImpulse?.(e.record.id,[tmp.x*mass*dv,tmp.y*mass*dv,mass*dv*.55],{point:q});}}
  else if(e.type==="buffet"){const rigid=globalThis.__arondightWorldRigidBodies,q=rigid?.pose?.(e.record.id)?.position;if(!q)return;const mass=Math.max(.1,Number(e.record.massKg)||1),k=.7*e.strength;rigid.applyImpulse?.(e.record.id,[rand(-1,1)*mass*k,rand(-1,1)*mass*k,rand(-.4,1)*mass*k],{point:[q[0]+rand(-.08,.08),q[1]+rand(-.08,.08),q[2]]});}
  else if(e.type==="police"){if(I<.15)return;const hits=Math.min(6,Math.ceil(I*4));for(let i=0;i<hits;i++)bridge()?.registerPoliceHit?.({object:e.drone.hitbox||e.drone.root,point:e.drone.root.position.clone()});}
  else if(e.type==="peer"){if(I<.15)return;const hits=Math.min(6,Math.ceil(I*4));for(let i=0;i<hits;i++)bridge()?.registerVsHit?.({object:e.peer,point:e.peer.position.clone()});}
}
// Compile every nuke shader during startup (behind the menu): the debris
// pool is created right away, and a tiny crater sits far below the ground
// until the game has been running for a few seconds.
let prewarm=null;
// the crater contour lines exactly as drawn after an impact (same material flags = same program)
if(typeof window!=="undefined")(globalThis.__prewarmFactories??=[]).push(()=>{const l=new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3(1,0,0)]),new THREE.LineBasicMaterial({color:0x2a2018,transparent:true,opacity:.82,depthWrite:false}));l.name="NUKE_CRATER_CONTOURS_PREWARM";return l;});
function ensurePrewarm(scene){
  if(prewarm!==null)return;
  const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3));g.setAttribute("color",new THREE.Float32BufferAttribute([0,0,0,0,0,0,0,0,0],3));
  const mesh=new THREE.Mesh(g,new THREE.MeshBasicMaterial({color:0x020a06,toneMapped:false,fog:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1}));
  const rim=new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3(1,0,0)]),new THREE.LineBasicMaterial({color:0x00ff9c,toneMapped:false,fog:false,transparent:true,opacity:.9}));
  const debrisWarm=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),debrisMaterial(),1);debrisWarm.setMatrixAt(0,new THREE.Matrix4().makeScale(.001,.001,.001));debrisWarm.instanceMatrix.needsUpdate=true;
  prewarm=new THREE.Group();prewarm.name="NUKE_PREWARM";prewarm.position.set(0,0,-3000);prewarm.scale.setScalar(.001);prewarm.userData.neonSkip=true;prewarm.userData.flightFireIgnore=true;for(const m of[mesh,rim,debrisWarm]){m.frustumCulled=false;m.raycast=()=>{};}prewarm.add(mesh,rim,debrisWarm);scene.add(prewarm);
  const drop=()=>setTimeout(()=>{prewarm?.parent?.remove(prewarm);g.dispose();},4000);window.addEventListener("arondight:game-start",drop,{once:true});setTimeout(drop,60000);
}
function frame(now){
  const dt=clamp((now-lastFrame)/1000,0,.05);lastFrame=now;const scene=bridge()?.threeScene;if(scene)ensurePrewarm(scene);
  if(scene&&events.length){let budget=0;while(events.length&&events[0].at<=now&&budget<40){runEvent(scene,events.shift());budget++;}}
  // Rendering already shows damage instantly; the shared state (collision,
  // map, multiplayer) is committed at most twice a second during a wave.
  if(pendingCommit&&now-lastCommit>500){pendingCommit=false;lastCommit=now;commitDestruction();}
  if(chunks.length)stepChunks(scene,dt);
  const alive=stepDebris(dt);if(flung.length)stepFlung(dt);if(craters.length)stepCraters(now);
  if(alive||flung.length){setData("nukeDebrisAlive",alive);setData("nukeFlungActors",flung.length);}
  requestAnimationFrame(frame);
}
function resetWorld(){
  clearCraters();clearChunks();events.length=0;buildingHp.clear();for(const f of flattenedProps.splice(0)){f.mesh.setMatrixAt(f.index,f.matrix);f.mesh.instanceMatrix.needsUpdate=true;}for(const f of flung){f.clone.parent?.remove(f.clone);f.root.visible=true;}flung.length=0;
  if(debris){const zero=new THREE.Matrix4().makeScale(0,0,0);for(const i of debrisActive){const it=debris.items[i];it.alive=false;debris.mesh.setMatrixAt(i,zero);}debrisActive.length=0;debrisFree=debris.items.map((_,i)=>DEBRIS_POOL-1-i);debris.mesh.instanceMatrix.needsUpdate=true;}
  for(const c of craters){c.mesh.parent?.remove(c.mesh);c.mesh.geometry.dispose();c.mesh.material.dispose();}craters.length=0;
  setData("nukeDebrisAlive",0);setData("nukeFlungActors",0);
}
export function installNukeDestruction(){if(installed)return;installed=true;window.addEventListener("arondight:nuke-impact",onImpact);window.addEventListener("arondight:world-reset",resetWorld);window.addEventListener("arondight:world-explosion",onWorldExplosion);requestAnimationFrame(frame);}
installNukeDestruction();
