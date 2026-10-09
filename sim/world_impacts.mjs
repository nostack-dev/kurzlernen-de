import * as THREE from "three";
import {groundHeightAt,staticGroundHeightAt,terrainNormalAt,onTerrainChange,waterAt,WATER_LEVEL_M} from "./terrain_craters.mjs";
import {patchShockMaterial} from "./nuke_shock_field.mjs";
import {glassAt,addGlassCrack,addWallSoot,addWallBreach} from "./facade_marks.mjs";

// Every action of the player leaves a mark — nothing is silently ignored.
//  * Bullet impacts: a hole decal on walls, ground, cars and trees, plus a
//    burst of chips in the surface's colour (concrete, dirt, bark/leaves,
//    sparks on metal). Shots that miss every object still hit the ground.
//  * Explosions (grenades, rockets, missiles, cars): a scorch decal on the
//    ground and on nearby walls, a big chip burst, and trees in the blast
//    radius are knocked over, falling away from the blast.
//  * Trees: bullets shake them and shed leaves; enough hits fell them.
// Cheap: decals are one instanced mesh (ring buffer), chips another; no
// allocation per shot.

export const WORLD_IMPACTS_VERSION="terrain-draped-decals+embers+chips+tree-damage-v2";
const DECALS=420,CHIPS=220,TREE_HP=12;
let installed=false,sceneRef=null,decals=null,decalCursor=0,chips=null,chipItems=[],chipCursor=0,lastFrame=performance.now();
const m4=new THREE.Matrix4(),q=new THREE.Quaternion(),p=new THREE.Vector3(),s=new THREE.Vector3(),n=new THREE.Vector3(),Z=new THREE.Vector3(0,0,1),col=new THREE.Color(),ZERO=new THREE.Matrix4().makeScale(0,0,0);
const bridge=()=>globalThis.__arondightRealWorld||null;
const rand=(a,b)=>a+Math.random()*(b-a);
const COLORS={building:[0xcfc6b4,0xa89f90],ground:[0x6b5a44,0x7a9a52],tree:[0x4f9a3a,0x6b4a32],vehicle:[0xffd27a,0xfff2c4],glass:[0xe4f0f6,0xa9c6d6],actor:[0x8a1a1a,0x5a1010],water:[0x9fd0ff,0xffffff]};

function ensure(){
  const scene=bridge()?.threeScene;if(!scene)return false;if(scene===sceneRef&&decals?.parent===scene)return true;sceneRef=scene;
  const dm=new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.86,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-4,polygonOffsetUnits:-4,fog:true});
  decals=new THREE.InstancedMesh(new THREE.CircleGeometry(1,14),dm,DECALS);decals.name="WORLD_IMPACT_DECALS";
  const cm=new THREE.MeshLambertMaterial({color:0xffffff});chips=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),cm,CHIPS);chips.name="WORLD_IMPACT_CHIPS";
  for(const mesh of[decals,chips]){mesh.frustumCulled=false;mesh.userData.flightFireIgnore=true;mesh.userData.neonSkip=true;mesh.raycast=()=>{};mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);for(let i=0;i<mesh.count;i++){mesh.setMatrixAt(i,ZERO);mesh.setColorAt(i,col.set(0x222222));}mesh.instanceMatrix.needsUpdate=true;mesh.instanceColor.needsUpdate=true;scene.add(mesh);}
  chipItems=Array.from({length:CHIPS},()=>({life:0,p:new THREE.Vector3(),v:new THREE.Vector3(),size:.1,spin:0,axis:new THREE.Vector3(1,0,0),angle:0}));
  // pools draw only the slots used so far (empty capacity costs no triangles)
  decals.count=Math.min(DECALS,decalCursor);chips.count=Math.min(CHIPS,chipCursor);
  return true;
}
// Ground marks live *on* the terrain: bullet holes take the surface normal of
// the shared ground, and scorches are draped grids (every vertex at the
// ground height) — both are re-laid when the ground deforms (craters, pads)
// and ride the nuke pressure wave like the ground itself.
const groundDecals=new Map(); // instance index -> {x,y,size,color}
const SCORCHES=40,SG=10,SV=(SG+1)*(SG+1);let scorch=null,scorchCursor=0;const scorchItems=new Array(SCORCHES).fill(null);
const SCORCH_VS=`attribute vec3 aInfo;varying vec3 vInfo;
void main() {vInfo=aInfo;
#include <begin_vertex>
gl_Position=projectionMatrix*modelViewMatrix*vec4(transformed,1.);}`;
const SCORCH_FS=`varying vec3 vInfo;
float h(vec2 p){return fract(sin(dot(p,vec2(41.3,289.1)))*43758.5);}
void main() {vec2 p=vInfo.xy;float r=length(p),a=atan(p.y,p.x),seed=vInfo.z;
float edge=.78+.12*sin(a*5.+seed*7.)+.07*sin(a*11.+seed*3.)+.05*sin(a*23.+seed);if(r>edge)discard;
float k=r/edge;
float char=smoothstep(1.,.35,k);float soot=.55+.45*h(floor(p*9.+seed));
vec3 col=mix(vec3(.05,.045,.04),vec3(.012,.01,.01),char)*soot;
gl_FragColor=vec4(col,.92*smoothstep(1.,.82,k));}`;
function ensureScorch(scene){
  if(scorch?.parent===scene)return scorch;const n=SCORCHES*SV,pos=new Float32Array(n*3),info=new Float32Array(n*3),idx=[];
  for(let s0=0;s0<SCORCHES;s0++){const o=s0*SV;for(let j=0;j<SG;j++)for(let i=0;i<SG;i++){const a=o+j*(SG+1)+i,b=a+1,c=a+SG+1,d=c+1;idx.push(a,b,d,a,d,c);}}
  const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.BufferAttribute(pos,3).setUsage(THREE.DynamicDrawUsage));g.setAttribute("aInfo",new THREE.BufferAttribute(info,3).setUsage(THREE.DynamicDrawUsage));g.setIndex(idx);g.boundingSphere=new THREE.Sphere(new THREE.Vector3(),1e7);
  const m=new THREE.ShaderMaterial({uniforms:{},vertexShader:SCORCH_VS,fragmentShader:SCORCH_FS,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-6,polygonOffsetUnits:-6});
  g.setDrawRange(0,0);/* grows with the scorches laid */scorch=new THREE.Mesh(g,patchShockMaterial(m));scorch.name="WORLD_SCORCH_MARKS";scorch.frustumCulled=false;scorch.renderOrder=3;scorch.userData.neonSkip=true;scorch.userData.flightFireIgnore=true;scorch.raycast=()=>{};scene.add(scorch);return scorch;
}
function layScorch(k){const it=scorchItems[k];if(!scorch||!it)return;const pos=scorch.geometry.attributes.position.array,info=scorch.geometry.attributes.aInfo.array,o=k*SV;
  for(let j=0;j<=SG;j++)for(let i=0;i<=SG;i++){const u=i/SG*2-1,v=j/SG*2-1,x=it.x+u*it.r,y=it.y+v*it.r,q=(o+j*(SG+1)+i)*3;pos[q]=x;pos[q+1]=y;pos[q+2]=staticGroundHeightAt(x,y)+.035;info[q]=u;info[q+1]=v;info[q+2]=it.seed;}
  scorch.geometry.attributes.position.needsUpdate=true;scorch.geometry.attributes.aInfo.needsUpdate=true;}
export function addScorch(x,y,radius){
  const scene=bridge()?.threeScene;if(!scene||!Number.isFinite(x)||!Number.isFinite(y))return;ensureScorch(scene);
  const k=scorchCursor++%SCORCHES;scorchItems[k]={x,y,r:Math.max(.6,Math.min(6,radius)),seed:Math.random()*10};scorch.geometry.setDrawRange(0,Math.min(SCORCHES,scorchCursor)*SG*SG*6);layScorch(k);
}
function layGroundDecal(i,d){q.setFromUnitVectors(Z,n.fromArray(terrainNormalAt(d.x,d.y)));q.multiply(new THREE.Quaternion().setFromAxisAngle(Z,d.spin));p.set(d.x,d.y,staticGroundHeightAt(d.x,d.y)+.03);s.set(d.size,d.size,d.size);m4.compose(p,q,s);decals.setMatrixAt(i,m4);}
function relayGround(){if(decals){for(const[i,d]of groundDecals)layGroundDecal(i,d);decals.instanceMatrix.needsUpdate=true;}for(let k=0;k<SCORCHES;k++)if(scorchItems[k])layScorch(k);}
export function addDecal(point,normal,{size=.1,color=0x2a2622,ground=false}={}){
  if(ground&&ensure()&&point){const i=decalCursor++%DECALS,d={x:point.x,y:point.y,size,spin:Math.random()*6.28};decals.count=Math.min(DECALS,decalCursor);groundDecals.set(i,d);layGroundDecal(i,d);decals.setColorAt(i,col.set(color));decals.instanceMatrix.needsUpdate=true;decals.instanceColor.needsUpdate=true;return;}
  if(!ensure()||!point)return;n.copy(normal||Z);if(n.lengthSq()<1e-6)n.copy(Z);n.normalize();
  q.setFromUnitVectors(Z,n);const spin=new THREE.Quaternion().setFromAxisAngle(Z,Math.random()*6.28);q.multiply(spin);
  p.copy(point).addScaledVector(n,.012);s.set(size,size,size);m4.compose(p,q,s);const i=decalCursor++%DECALS;decals.count=Math.min(DECALS,decalCursor);groundDecals.delete(i);decals.setMatrixAt(i,m4);decals.setColorAt(i,col.set(color));decals.instanceMatrix.needsUpdate=true;decals.instanceColor.needsUpdate=true;
}
export function chipBurst(point,normal,surface="building",count=6,speed=4){
  if(!ensure()||!point)return;if(surface==="building"&&glassAt(point)?.glass){surface="glass";count=Math.min(count,5);}const palette=COLORS[surface]||COLORS.building;n.copy(normal||Z).normalize();
  for(let k=0;k<count;k++){const i=chipCursor++%CHIPS,c=chipItems[i];chips.count=Math.min(CHIPS,chipCursor);c.life=rand(.5,1.1);c.p.copy(point).addScaledVector(n,.05);c.v.set(n.x+rand(-.7,.7),n.y+rand(-.7,.7),n.z+rand(-.2,.9)).normalize().multiplyScalar(speed*rand(.5,1.2));c.size=rand(.04,.11)*(surface==="tree"?1.4:1);c.spin=rand(-14,14);c.axis.set(rand(-1,1),rand(-1,1),rand(-1,1)).normalize();c.angle=0;chips.setColorAt(i,col.set(palette[k%palette.length]));}
  chips.instanceColor.needsUpdate=true;
}
function stepChips(dt){
  if(!chips)return;let any=false;for(let i=0;i<CHIPS;i++){const c=chipItems[i];if(c.life<=0)continue;any=true;c.life-=dt;if(c.life<=0){chips.setMatrixAt(i,ZERO);continue;}
    c.v.z-=9.81*dt;c.p.addScaledVector(c.v,dt);const g=groundHeightAt(c.p.x,c.p.y);if(c.p.z<g+c.size*.5){c.p.z=g+c.size*.5;c.v.multiplyScalar(.35);c.v.z=Math.abs(c.v.z)*.3;}
    c.angle+=c.spin*dt;q.setFromAxisAngle(c.axis,c.angle);s.setScalar(c.size*Math.min(1,c.life*3));m4.compose(c.p,q,s);chips.setMatrixAt(i,m4);}
  if(any)chips.instanceMatrix.needsUpdate=true;
}

// ---------------------------------------------------------------- trees
const trees=new Map();// instanceId -> {hp, fall:{t,dir,axis,base}, sway, trunkM, crownM, written}
let treeMeshes=null;
function findTrees(){
  const scene=bridge()?.threeScene;if(!scene)return null;if(treeMeshes?.crown?.parent&&treeMeshes.trunk?.parent)return treeMeshes;let crown=null,trunk=null;
  scene.traverse(o=>{if(o.isInstancedMesh&&o.userData?.worldDecorKind==="tree-green-mesh")crown=o;});
  if(crown)crown.parent?.children.forEach(o=>{if(o.isInstancedMesh&&o!==crown&&o.count===crown.count&&!o.userData?.worldDecorKind&&o.geometry?.type?.includes("Cylinder"))trunk=o;});
  if(!trunk&&crown)crown.parent?.children.forEach(o=>{if(!trunk&&o.isInstancedMesh&&o!==crown&&o.count===crown.count&&o.userData?.worldDecorKind!=="tree-halo-off")trunk=o;});
  treeMeshes=crown&&trunk?{crown,trunk}:null;return treeMeshes;
}
function treeState(id){
  const t=findTrees();if(!t)return null;let st=trees.get(id);const tm=new THREE.Matrix4(),cm=new THREE.Matrix4();t.trunk.getMatrixAt(id,tm);t.crown.getMatrixAt(id,cm);
  // the population re-streamed this tree elsewhere: start fresh
  if(st&&st.written&&!tm.equals(st.written)){trees.delete(id);st=null;}
  if(!st){st={hp:TREE_HP,fall:null,sway:null,trunkM:tm.clone(),crownM:cm.clone(),written:null};trees.set(id,st);}return st;
}
function treeBase(st){p.setFromMatrixPosition(st.trunkM);return new THREE.Vector3(p.x,p.y,groundHeightAt(p.x,p.y));}
export function knockTree(id,fromX,fromY,force=1){
  const st=treeState(id);if(!st||st.fall)return false;const base=treeBase(st),dir=new THREE.Vector3(base.x-fromX,base.y-fromY,0);if(dir.lengthSq()<.01)dir.set(1,0,0);dir.normalize();
  st.fall={t:0,dur:Math.max(.45,1.3-.5*force),dir,axis:new THREE.Vector3(-dir.y,dir.x,0),base};chipBurst(new THREE.Vector3(base.x,base.y,base.z+2.4),new THREE.Vector3(0,0,1),"tree",10,5);return true;
}
function hitTree(id,point,fromX,fromY){
  const st=treeState(id);if(!st||st.fall)return;st.hp-=1;st.sway={t:0,dir:new THREE.Vector3(point.x-fromX,point.y-fromY,0).normalize()};
  chipBurst(point,new THREE.Vector3(fromX-point.x,fromY-point.y,0).normalize(),"tree",5,3.2);
  if(st.hp<=0)knockTree(id,fromX,fromY,.6);
}
const rotM=new THREE.Matrix4(),tA=new THREE.Matrix4(),tB=new THREE.Matrix4();
function pivoted(out,src,base,axis,angle){tA.makeTranslation(-base.x,-base.y,-base.z);rotM.makeRotationAxis(axis,angle);tB.makeTranslation(base.x,base.y,base.z);return out.copy(tB).multiply(rotM).multiply(tA).multiply(src);}
const outT=new THREE.Matrix4(),outC=new THREE.Matrix4();
function stepTrees(dt){
  const t=treeMeshes;if(!t||!trees.size)return;let dirty=false;
  for(const[id,st]of trees){
    let angle=0,axis=null;
    if(st.fall){st.fall.t=Math.min(st.fall.dur,st.fall.t+dt);const k=st.fall.t/st.fall.dur;angle=1.45*k*k;axis=st.fall.axis;if(st.fall.landed)continue;if(k>=1){st.fall.landed=true;chipBurst(new THREE.Vector3(st.fall.base.x+st.fall.dir.x*3,st.fall.base.y+st.fall.dir.y*3,st.fall.base.z+.3),Z,"tree",8,3);}}
    else if(st.sway){st.sway.t+=dt;if(st.sway.t>1.2){st.sway=null;}else{axis=new THREE.Vector3(-st.sway.dir.y,st.sway.dir.x,0);angle=.09*Math.exp(-st.sway.t*3.5)*Math.sin(st.sway.t*18);}}
    else continue;
    const base=treeBase(st);pivoted(outT,st.trunkM,base,axis||Z,axis?angle:0);pivoted(outC,st.crownM,base,axis||Z,axis?angle:0);
    t.trunk.setMatrixAt(id,outT);t.crown.setMatrixAt(id,outC);st.written=outT.clone();dirty=true;
  }
  if(dirty){t.trunk.instanceMatrix.needsUpdate=true;t.crown.instanceMatrix.needsUpdate=true;}
}

// ---------------------------------------------------------------- API
function surfaceOf(hit){
  if(!hit)return"ground";if(hit.box3d&&!hit.object)return hit.physicsKind&&hit.physicsKind!=="terrain"?"vehicle":"building";
  for(let o=hit.object;o;o=o.parent){const u=o.userData||{};if(u.worldDecorKind==="ambient-animal")return"animal";if(u.worldDecorKind==="tree-green-mesh"||String(u.worldDecorKind||"").startsWith("tree"))return"tree";const k=String(u.worldPopulationKind||u.worldLifeKind||"");if(k==="car"||k==="bus"||k==="police-drone"||u.gtaDrivableVehicle)return"vehicle";if(k==="person"||k==="enemy"||u.vsHumanAvatar)return"actor";if(u.worldCityBuildings)return"building";}
  return hit.object?.geometry?.type==="BoxGeometry"&&(hit.object.geometry.parameters?.width||0)>1000?"ground":"building";
}
function normalOf(hit,ray){
  if(hit?.worldNormal)return hit.worldNormal.clone();
  if(hit?.face?.normal&&hit.object){const nm=new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld),out=hit.face.normal.clone();if(hit.instanceId!=null&&hit.object.isInstancedMesh){hit.object.getMatrixAt(hit.instanceId,m4);out.applyMatrix3(new THREE.Matrix3().getNormalMatrix(m4));}return out.applyMatrix3(nm).normalize();}
  return ray?ray.direction.clone().negate():Z.clone();
}
// A bullet: hit (raycast result, may be null) along ray {origin,direction}.
// Animals are small instanced decor: test them against the ray directly so
// every weapon (also the drone gun, whose raycast skips decor) can hit them.
// Birds: sphere test along the shot (they are small and fast; the hit sphere
// is a bit larger than the body so a clean shot counts).
function birdOnRay(ray,maxT){const o=ray.origin,d=ray.direction;let best=null;for(const b of globalThis.__ambientBirds?.poses?.()||[]){const ax=b.x-o.x,ay=b.y-o.y,az=b.z-o.z,t=ax*d.x+ay*d.y+az*d.z;if(t<=0||t>maxT)continue;const px=o.x+d.x*t-b.x,py=o.y+d.y*t-b.y,pz=o.z+d.z*t-b.z,r=.75*(b.sc||1)+t*.004;if(px*px+py*py+pz*pz<r*r&&(!best||t<best.t))best={b,t};}return best;}
function animalOnRay(ray,maxT){const o=ray.origin,d=ray.direction;let best=null;for(const a of globalThis.__ambientAnimals?.poses?.()||[]){const cz=(a.z??.2)+.1,ax=a.x-o.x,ay=a.y-o.y,az=cz-o.z,t=ax*d.x+ay*d.y+az*d.z;if(t<=0||t>maxT)continue;const px=o.x+d.x*t-a.x,py=o.y+d.y*t-a.y,pz=o.z+d.z*t-cz;if(px*px+py*py+pz*pz<.5*.5*(a.sc||1)*(a.sc||1)*1.6&&(!best||t<best.t))best={a,t};}return best;}
function tagOf(object,key){for(let o=object;o;o=o.parent)if(o.userData?.[key]!=null)return o.userData[key];return null;}
export function bulletImpact(ray,hit,{routed=false,maxDistance=180,bodyDamage=5,source="bullet"}={}){
  // aircraft (jets): a hit on the airframe — a Box3D body ray or the jet's mesh — damages it; another player's jet: its owner applies it
  {const airId=hit?.physicsKind==="aircraft"&&hit.physicsId?String(hit.physicsId):tagOf(hit?.object,"airframeId"),remoteAir=airId?null:tagOf(hit?.object,"remoteAirframe");
    if((airId||remoteAir)&&hit?.point){const pt=hit.point.clone?.()||new THREE.Vector3(...hit.point),n=ray?ray.direction.clone().negate():Z.clone();
      if(airId)window.dispatchEvent(new CustomEvent("arondight:physics-body-hit",{detail:{id:airId,kind:"aircraft",damage:bodyDamage,source,point:[pt.x,pt.y,pt.z]}}));
      else window.dispatchEvent(new CustomEvent("arondight:remote-airframe-hit",{detail:{owner:remoteAir.owner,id:remoteAir.id,damage:bodyDamage,source}}));
      chipBurst(pt,n,"vehicle",5,5);return true;}}
  if(ray&&!(surfaceOf(hit)==="actor")){const maxT=hit?.distance??(hit?.point?ray.origin.distanceTo(hit.point):maxDistance),bd=birdOnRay(ray,maxT);if(bd){globalThis.__ambientBirds.kill(bd.b.id);chipBurst(new THREE.Vector3(bd.b.x,bd.b.y,bd.b.z),ray.direction.clone().negate(),"actor",4,2.2);return true;}const an=animalOnRay(ray,maxT);if(an){globalThis.__ambientAnimals.kill(an.a.i);chipBurst(new THREE.Vector3(an.a.x,an.a.y,(an.a.z??.2)+.15),ray.direction.clone().negate(),"actor",5,2.5);return true;}}
  let point=hit?.point?.clone?.()||null,normal=null,surface=surfaceOf(hit);
  if(!point&&ray){const o=ray.origin,d=ray.direction;if(d.z<-1e-4){let t=(groundHeightAt(o.x,o.y)-o.z)/d.z;if(t>0&&t<maxDistance){point=o.clone().addScaledVector(d,t);point.z=groundHeightAt(point.x,point.y);normal=Z.clone();surface="ground";}}}
  // shots into a river / lake: splash on the water surface, no decal
  if(ray&&(!hit||surface==="ground")){const o=ray.origin,d=ray.direction;if(d.z<-1e-4){const t=(.03-o.z)/d.z;if(t>0&&t<maxDistance){const wp=o.clone().addScaledVector(d,t);if(waterAt(wp.x,wp.y)&&(!point||o.distanceTo(point)>=t-.1)){chipBurst(wp,Z,"water",7,3.2);return true;}}}}
  if(!point)return false;normal??=normalOf(hit,ray);if(ray&&normal.dot(ray.direction)>0)normal.negate();
  const from=ray?ray.origin:point;
  if(surface==="tree"&&hit?.instanceId!=null){hitTree(hit.instanceId,point,from.x,from.y);addDecal(point,normal,{size:.07,color:0x3a2a1c});return true;}
  if(surface==="animal"){if(hit?.instanceId!=null)globalThis.__ambientAnimals?.kill?.(hit.instanceId);chipBurst(point,normal,"actor",5,2.5);return true;}
  if(surface==="actor"){chipBurst(point,normal,"actor",3,2);return true;}
  if(surface==="building"){const g=glassAt(point);if(g?.glass){addGlassCrack(g,point);chipBurst(point,normal,"glass",5,2.6);return true;}}
  addDecal(point,normal,{size:surface==="vehicle"?.06:.085,color:surface==="ground"?0x2e2a22:surface==="vehicle"?0x1c1c1c:0x34302a,ground:surface==="ground"});
  chipBurst(point,normal,surface,surface==="vehicle"?5:6,surface==="vehicle"?5:3.5);
  return true;
}
function onExplosion(event){
  const d=event?.detail||{},pos=d.position;const x=Array.isArray(pos)?+pos[0]:+pos?.x,y=Array.isArray(pos)?+pos[1]:+pos?.y,z=Array.isArray(pos)?+pos[2]:+pos?.z;if(!Number.isFinite(x)||!Number.isFinite(y))return;
  const r=Math.max(1.5,Math.min(400,Number(d.radiusM)||6)),g=groundHeightAt(x,y),nuke=d.kind==="nuke";
  if(!nuke&&waterAt(x,y)){chipBurst(new THREE.Vector3(x,y,.05),Z,"water",Math.min(40,14+r*3),7+r*.8);return;}
  if(!nuke){ // scorch on the ground (if the blast is low enough) and chips
    if((Number.isFinite(z)?z:g)-g<r*.6)addScorch(x,y,Math.min(5.5,r*.5));
    chipBurst(new THREE.Vector3(x,y,(Number.isFinite(z)?z:g)+.2),Z,"ground",Math.min(26,8+r*2),6+r*.6);
    // walls within reach get soot, clipped to the rendered wall (never hanging in the air)
    addWallSoot(x,y,Number.isFinite(z)?z:g,r);
    // and the wall itself breaks: a breach that opens further with every blast, chunks flying out
    addWallBreach(x,y,Number.isFinite(z)?z:g,r,Math.min(1.4,(Number(d.maxDamage)||60)/110));
  }
  // animals in reach die
  for(const bd of globalThis.__ambientBirds?.poses?.()||[]){if(Math.hypot(bd.x-x,bd.y-y,(bd.z-(Number(event?.detail?.position?.[2])||0))*.6)<(nuke?r*2.2:r*1.1)){globalThis.__ambientBirds.kill(bd.id);chipBurst(new THREE.Vector3(bd.x,bd.y,bd.z),Z,"actor",6,3);}}
  for(const a of globalThis.__ambientAnimals?.poses?.()||[]){if(Math.hypot(a.x-x,a.y-y)<(nuke?r*1.5:r*.9)){globalThis.__ambientAnimals.kill(a.i);chipBurst(new THREE.Vector3(a.x,a.y,.3),Z,"actor",4,3);}}
  // trees: knock over everything in reach, falling away from the blast
  const t=findTrees();if(t){const reach=nuke?Math.min(600,r*1.4):r*.85;for(let i=0;i<t.trunk.count;i++){t.trunk.getMatrixAt(i,m4);p.setFromMatrixPosition(m4);const dist=Math.hypot(p.x-x,p.y-y);if(dist<reach){if(nuke)setTimeout(()=>knockTree(i,x,y,1.4),dist/343*1000);else knockTree(i,x,y,1-dist/reach);}}}
}
function frame(now){requestAnimationFrame(frame);const dt=Math.min(.1,(now-lastFrame)/1000);lastFrame=now;stepChips(dt);stepTrees(dt);}
// shader prewarm: the decal / chip / scorch pools exist (and compile) before the first impact
if(typeof window!=="undefined")(globalThis.__prewarmFactories??=[]).push(()=>{try{ensure();const sc=bridge()?.threeScene;if(sc)ensureScorch(sc);}catch{}return null;});
export function installWorldImpacts(){
  if(installed||typeof window==="undefined")return;installed=true;
  window.addEventListener("arondight:world-explosion",onExplosion);
  window.addEventListener("arondight:world-reset",()=>{trees.clear();groundDecals.clear();scorchItems.fill(null);if(scorch){scorch.geometry.attributes.position.array.fill(0);scorch.geometry.attributes.position.needsUpdate=true;}if(decals){for(let i=0;i<DECALS;i++)decals.setMatrixAt(i,ZERO);decals.instanceMatrix.needsUpdate=true;}});
  onTerrainChange(()=>relayGround());
  globalThis.__worldImpacts={bullet:bulletImpact,decal:addDecal,scorch:addScorch,chips:chipBurst,knockTree,version:WORLD_IMPACTS_VERSION};
  const v=document.getElementById("viewport");if(v)v.dataset.worldImpacts=WORLD_IMPACTS_VERSION;
  requestAnimationFrame(frame);
}
installWorldImpacts();
