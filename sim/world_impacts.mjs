import * as THREE from "three";
import {groundHeightAt,waterAt,WATER_LEVEL_M} from "./terrain_craters.mjs";

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

export const WORLD_IMPACTS_VERSION="decals+chips+tree-damage-v1";
const DECALS=420,CHIPS=220,TREE_HP=12;
let installed=false,sceneRef=null,decals=null,decalCursor=0,chips=null,chipItems=[],chipCursor=0,lastFrame=performance.now();
const m4=new THREE.Matrix4(),q=new THREE.Quaternion(),p=new THREE.Vector3(),s=new THREE.Vector3(),n=new THREE.Vector3(),Z=new THREE.Vector3(0,0,1),col=new THREE.Color(),ZERO=new THREE.Matrix4().makeScale(0,0,0);
const bridge=()=>globalThis.__arondightRealWorld||null;
const rand=(a,b)=>a+Math.random()*(b-a);
const COLORS={building:[0xcfc6b4,0xa89f90],ground:[0x6b5a44,0x7a9a52],tree:[0x4f9a3a,0x6b4a32],vehicle:[0xffd27a,0xfff2c4],actor:[0x8a1a1a,0x5a1010],water:[0x9fd0ff,0xffffff]};

function ensure(){
  const scene=bridge()?.threeScene;if(!scene)return false;if(scene===sceneRef&&decals?.parent===scene)return true;sceneRef=scene;
  const dm=new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.86,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-4,polygonOffsetUnits:-4,fog:true});
  decals=new THREE.InstancedMesh(new THREE.CircleGeometry(1,14),dm,DECALS);decals.name="WORLD_IMPACT_DECALS";
  const cm=new THREE.MeshLambertMaterial({color:0xffffff});chips=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),cm,CHIPS);chips.name="WORLD_IMPACT_CHIPS";
  for(const mesh of[decals,chips]){mesh.frustumCulled=false;mesh.userData.flightFireIgnore=true;mesh.userData.neonSkip=true;mesh.raycast=()=>{};mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);for(let i=0;i<mesh.count;i++){mesh.setMatrixAt(i,ZERO);mesh.setColorAt(i,col.set(0x222222));}mesh.instanceMatrix.needsUpdate=true;mesh.instanceColor.needsUpdate=true;scene.add(mesh);}
  chipItems=Array.from({length:CHIPS},()=>({life:0,p:new THREE.Vector3(),v:new THREE.Vector3(),size:.1,spin:0,axis:new THREE.Vector3(1,0,0),angle:0}));
  return true;
}
export function addDecal(point,normal,{size=.1,color=0x2a2622}={}){
  if(!ensure()||!point)return;n.copy(normal||Z);if(n.lengthSq()<1e-6)n.copy(Z);n.normalize();
  q.setFromUnitVectors(Z,n);const spin=new THREE.Quaternion().setFromAxisAngle(Z,Math.random()*6.28);q.multiply(spin);
  p.copy(point).addScaledVector(n,.012);s.set(size,size,size);m4.compose(p,q,s);const i=decalCursor++%DECALS;decals.setMatrixAt(i,m4);decals.setColorAt(i,col.set(color));decals.instanceMatrix.needsUpdate=true;decals.instanceColor.needsUpdate=true;
}
export function chipBurst(point,normal,surface="building",count=6,speed=4){
  if(!ensure()||!point)return;const palette=COLORS[surface]||COLORS.building;n.copy(normal||Z).normalize();
  for(let k=0;k<count;k++){const i=chipCursor++%CHIPS,c=chipItems[i];c.life=rand(.5,1.1);c.p.copy(point).addScaledVector(n,.05);c.v.set(n.x+rand(-.7,.7),n.y+rand(-.7,.7),n.z+rand(-.2,.9)).normalize().multiplyScalar(speed*rand(.5,1.2));c.size=rand(.04,.11)*(surface==="tree"?1.4:1);c.spin=rand(-14,14);c.axis.set(rand(-1,1),rand(-1,1),rand(-1,1)).normalize();c.angle=0;chips.setColorAt(i,col.set(palette[k%palette.length]));}
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
export function bulletImpact(ray,hit,{routed=false,maxDistance=180}={}){
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
  addDecal(point,normal,{size:surface==="vehicle"?.06:.085,color:surface==="ground"?0x2e2a22:surface==="vehicle"?0x1c1c1c:0x34302a});
  chipBurst(point,normal,surface,surface==="vehicle"?5:6,surface==="vehicle"?5:3.5);
  return true;
}
function onExplosion(event){
  const d=event?.detail||{},pos=d.position;const x=Array.isArray(pos)?+pos[0]:+pos?.x,y=Array.isArray(pos)?+pos[1]:+pos?.y,z=Array.isArray(pos)?+pos[2]:+pos?.z;if(!Number.isFinite(x)||!Number.isFinite(y))return;
  const r=Math.max(1.5,Math.min(400,Number(d.radiusM)||6)),g=groundHeightAt(x,y),nuke=d.kind==="nuke";
  if(!nuke&&waterAt(x,y)){chipBurst(new THREE.Vector3(x,y,.05),Z,"water",Math.min(40,14+r*3),7+r*.8);return;}
  if(!nuke){ // scorch on the ground (if the blast is low enough) and chips
    if((Number.isFinite(z)?z:g)-g<r*.6)addDecal(new THREE.Vector3(x,y,g+.02),Z,{size:Math.min(4.5,r*.42),color:0x1b1612});
    chipBurst(new THREE.Vector3(x,y,(Number.isFinite(z)?z:g)+.2),Z,"ground",Math.min(26,8+r*2),6+r*.6);
    // walls within reach get scorched too
    const prisms=bridge()?.buildingCollisionSnapshot?.prisms||[];let walls=0;
    for(const pr of prisms){if(walls>=2)break;const pts=pr.points||[];for(let i=0;i<pts.length&&walls<2;i++){const a=pts[i],b=pts[(i+1)%pts.length],ex=b[0]-a[0],ey=b[1]-a[1],len=Math.hypot(ex,ey);if(len<.5)continue;const t=Math.max(0,Math.min(1,((x-a[0])*ex+(y-a[1])*ey)/(len*len))),px=a[0]+ex*t,py=a[1]+ey*t,dist=Math.hypot(x-px,y-py);if(dist<r*.5){const nx=-ey/len,ny=ex/len,sgn=Math.sign((x-px)*nx+(y-py)*ny)||1;addDecal(new THREE.Vector3(px,py,Math.max(g+.8,Math.min((Number.isFinite(z)?z:g)+.5,(+pr.top||8)-.3))),new THREE.Vector3(nx*sgn,ny*sgn,0),{size:Math.min(3,r*.35),color:0x1d1814});walls++;}}}
  }
  // animals in reach die
  for(const bd of globalThis.__ambientBirds?.poses?.()||[]){if(Math.hypot(bd.x-x,bd.y-y,(bd.z-(Number(event?.detail?.position?.[2])||0))*.6)<(nuke?r*2.2:r*1.1)){globalThis.__ambientBirds.kill(bd.id);chipBurst(new THREE.Vector3(bd.x,bd.y,bd.z),Z,"actor",6,3);}}
  for(const a of globalThis.__ambientAnimals?.poses?.()||[]){if(Math.hypot(a.x-x,a.y-y)<(nuke?r*1.5:r*.9)){globalThis.__ambientAnimals.kill(a.i);chipBurst(new THREE.Vector3(a.x,a.y,.3),Z,"actor",4,3);}}
  // trees: knock over everything in reach, falling away from the blast
  const t=findTrees();if(t){const reach=nuke?Math.min(600,r*1.4):r*.85;for(let i=0;i<t.trunk.count;i++){t.trunk.getMatrixAt(i,m4);p.setFromMatrixPosition(m4);const dist=Math.hypot(p.x-x,p.y-y);if(dist<reach){if(nuke)setTimeout(()=>knockTree(i,x,y,1.4),dist/343*1000);else knockTree(i,x,y,1-dist/reach);}}}
}
function frame(now){requestAnimationFrame(frame);const dt=Math.min(.1,(now-lastFrame)/1000);lastFrame=now;stepChips(dt);stepTrees(dt);}
export function installWorldImpacts(){
  if(installed||typeof window==="undefined")return;installed=true;
  window.addEventListener("arondight:world-explosion",onExplosion);
  window.addEventListener("arondight:world-reset",()=>{trees.clear();if(decals){for(let i=0;i<DECALS;i++)decals.setMatrixAt(i,ZERO);decals.instanceMatrix.needsUpdate=true;}});
  globalThis.__worldImpacts={bullet:bulletImpact,decal:addDecal,chips:chipBurst,knockTree,version:WORLD_IMPACTS_VERSION};
  const v=document.getElementById("viewport");if(v)v.dataset.worldImpacts=WORLD_IMPACTS_VERSION;
  requestAnimationFrame(frame);
}
installWorldImpacts();
