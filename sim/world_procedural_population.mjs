import {vehicleFootprintsOverlap} from "./vehicle_spawn_clearance.mjs";
import * as THREE from "three";
import {groundHeightAt,staticGroundHeightAt,onTerrainChange} from "./terrain_craters.mjs";
import {vehicleGeometry,vehicleMaterial,wheelGeometry} from "./vehicle_models.mjs";
import {playAnimal} from "./animal_audio.mjs";
import {VS_FX_EVENT} from "./lan_vs.mjs";
import {spawnWorldPersonRagdoll} from "./world_person_ragdoll.mjs";
import {spawnWorldCarExplosion} from "./world_car_explosion.mjs";
import {stopWorldCriticalDamage} from "./world_critical_damage_fx.mjs";
import {buildTrafficRoute,collectRenderedDrivableRoads,makeBuildingsOpaque} from "./world_traffic_routes.mjs";
import {syncWorldBuildingDepthOcclusion} from "./world_building_depth_occlusion.mjs";

const MOBILE=/(?:android|iphone|ipad|ipod|macintosh.*mobile)/i.test(globalThis.navigator?.userAgent||"");
const CAR_COUNT=MOBILE?28:42;
const PERSON_COUNT=MOBILE?40:60;
const BUS_COUNT=MOBILE?5:8;
const BIRD_COUNT=MOBILE?16:24;
const AMBIENT_ANIMAL_COUNT=MOBILE?12:20;
const AMBIENT_ANIMAL_TICK_MS=0;
const ANIMAL_GROUND_OFFSET_M=.36;
const TREE_COUNT=MOBILE?20:34;
const LAMP_COUNT=MOBILE?12:20;
const MAINTENANCE_MS=1800;
const ROUTE_REFRESH_MS=1600;
const ROUTE_STALE_MS=18000;
const MAX_ROUTE_POOL=56;
const POPULATION_TICK_MS=MOBILE?32:16;
const STREAM_REBIND_DISTANCE_M=MOBILE?105:135;
const VEHICLE_STALL_NUDGE_MS=2600;
const IMAGERY_STORAGE="arondight45WorldImageryV1";
const IMAGERY_DEFAULT_OFF_MIGRATION="arondight45WorldImageryDefaultOffV3";
const FX_TYPE="world-procedural-death-v1";
const EARTH_RADIUS_M=6378137;

const records=[],spawnVisibilityRoots=[],byId=new Map(),routes=[],routeCache=new Map();
const tmp=new THREE.Vector3(),cameraPos=new THREE.Vector3(),matrix=new THREE.Matrix4(),quat=new THREE.Quaternion(),scale=new THREE.Vector3(1,1,1),decorUp=new THREE.Vector3(0,0,1);
let installed=false,boundScene=null,root=null,decorRoot=null,lightRoot=null,treeTrunks=null,treeCrowns=null,treeGlow=null,lampPoles=null,lampHeads=null,animalBodies=null,animalHeads=null;
let worldKey="",worldSeed=0,anchorX=0,anchorY=0,lastOriginLon=NaN,lastOriginLat=NaN,lastMaintenance=-Infinity,lastRouteRefresh=-Infinity,lastRouteOrigin="",worldVisibleLatched=false,mapStyledFor=null;
let hitBridge=null,lastFrame=performance.now(),lastPopulationTick=-Infinity,lastAmbientAnimalTick=-Infinity,forceImageryOff=false,cachedFocusTick=-Infinity,cachedFocus=null,cachedRoutePoolTick=-Infinity,cachedRoutePool=[];

function bridge(){return globalThis.__arondightRealWorld||null;}
function viewport(){return document.getElementById("viewport");}
function rigidBodies(){return globalThis.__arondightWorldRigidBodies||null;}
function hashText(text){let h=2166136261;for(const c of String(text||"")){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}
function u(seed,salt){return hashText(`${seed}:${salt}`)/4294967295;}
function range(seed,salt,a,b){return a+(b-a)*u(seed,salt);}
function clamp(value,min,max){return Math.max(min,Math.min(max,Number(value)||0));}
function mod(x,m){return((x%m)+m)%m;}
function lngLatToMeters(lon0,lat0,lon,lat){const north=(lat-lat0)*Math.PI/180*EARTH_RADIUS_M,east=(lon-lon0)*Math.PI/180*EARTH_RADIUS_M*Math.max(.01,Math.cos(lat0*Math.PI/180));return[east,north];}
function worldVisible(){
  const b=bridge(),v=viewport(),solo=document.body?.classList.contains("solo-flight");
  if(solo||b?.active){worldVisibleLatched=true;return true;}
  if(worldVisibleLatched&&v?.dataset?.worldMode==="real")return true;
  worldVisibleLatched=false;return false;
}

function migrateSatelliteDefaultOff(){try{if(localStorage.getItem(IMAGERY_DEFAULT_OFF_MIGRATION)!=="1"){localStorage.setItem(IMAGERY_STORAGE,"0");localStorage.setItem(IMAGERY_DEFAULT_OFF_MIGRATION,"1");forceImageryOff=true;}const v=viewport();if(v){v.dataset.worldSatelliteDefault="off";v.dataset.worldImageryDefault="0";}}catch{}}
function syncSatelliteMigration(){migrateSatelliteDefaultOff();if(!forceImageryOff)return;const b=bridge();if(!b)return;b.setImageryEnabled?.(false);forceImageryOff=false;}
migrateSatelliteDefaultOff();

const shared={};
function mat(color,roughness=.7,metalness=.04){return new THREE.MeshStandardMaterial({color,roughness,metalness});}
function zCylinder(rt,rb,h,segments=8){const g=new THREE.CylinderGeometry(rt,rb,h,segments);g.rotateX(Math.PI/2);return g;}
function ensureShared(){if(shared.carBody)return;shared.carBody=new THREE.BoxGeometry(3.55,1.62,.55);shared.carCabin=new THREE.BoxGeometry(1.75,1.44,.55);shared.busBody=new THREE.BoxGeometry(8,2.34,2.2);shared.busWindow=new THREE.BoxGeometry(5.9,2.37,.66);shared.wheel=new THREE.CylinderGeometry(.3,.3,.18,8);shared.busWheel=new THREE.CylinderGeometry(.4,.4,.22,10);shared.torso=zCylinder(.2,.29,.7,7);shared.leg=new THREE.BoxGeometry(.14,.15,.62);shared.arm=new THREE.BoxGeometry(.12,.12,.58);shared.head=new THREE.SphereGeometry(.19,8,6);shared.bird=new THREE.BufferGeometry();shared.bird.setAttribute("position",new THREE.BufferAttribute(new Float32Array([-.08,.38,0,-.78,-.12,.02,-.08,.02,.02,.08,.38,0,.08,.02,.02,.78,-.12,.02,-.08,.38,0,.08,.38,0,0,-.46,.04]),3));shared.bird.computeVertexNormals();shared.carMats=[0xc7473a,0x3079b7,0xc59b36,0xd7d9d8,0x3d4348,0x4d8b62,0x71588f].map(c=>mat(c,.42,.2));shared.busMats=[0x236da8,0xb84b40,0xc49a38,0x3f7d5c].map(c=>mat(c,.48,.12));shared.window=mat(0x263b46,.26,.1);shared.wheelMat=mat(0x202327,.88,.02);shared.shirts=[0x397da1,0xa9574a,0x5c8f62,0xb38f43,0x75659b,0xad7040,0x3f8b86].map(c=>mat(c,.82));shared.pants=[0x26313a,0x3a4146,0x403b36,0x263a50].map(c=>mat(c,.9));shared.skins=[0xe2b391,0xc5906d,0xa76f50,0x75452f,0xd1a07e].map(c=>mat(c,.88));shared.birds=[0x2f3942,0x56626a,0x806e53,0xc3c6c4,0x415666].map(c=>new THREE.MeshStandardMaterial({color:c,roughness:.85,side:THREE.DoubleSide}));}
function tag(mesh,record){mesh.userData.worldPopulationKind=record.kind;mesh.userData.worldPopulationId=record.id;mesh.userData.worldProceduralId=record.id;mesh.userData.worldPopulationClone=false;}
function retag(record){record.group.userData.worldPopulationKind=record.kind;record.group.userData.worldPopulationId=record.id;record.group.userData.worldProceduralId=record.id;record.group.userData.gtaDrivableVehicle=record.kind==="car";record.group.traverse(node=>{if(node?.isMesh){tag(node,record);node.userData.gtaDrivableVehicle=record.kind==="car";}});}
function baseRecord(kind,index,group,color=0){return{kind,index,group,color,id:"",seed:0,motion:null,deadUntil:0,speed:0,routeDirection:index&1?-1:1,routeKey:"",streamX:0,streamY:0,streamRebinds:0,physicsRegistered:false,physicsPose:null,stalledSince:0,lastNudgeAt:0};}
function makeCar(index){ensureShared();const s=hashText(`car:${index}`),group=new THREE.Group(),paint=shared.carMats[s%shared.carMats.length].color.getHex(),body=new THREE.Mesh(vehicleGeometry("car",paint),vehicleMaterial),r=baseRecord("car",index,group,paint);body.castShadow=true;group.add(body);return r;}
function makeBus(index){ensureShared();const s=hashText(`bus:${index}`),group=new THREE.Group(),paint=shared.busMats[s%shared.busMats.length].color.getHex(),body=new THREE.Mesh(vehicleGeometry("bus",paint),vehicleMaterial),r=baseRecord("bus",index,group,paint);body.castShadow=true;group.add(body);return r;}
function makePerson(index){ensureShared();const s=hashText(`person:${index}`),group=new THREE.Group(),shirt=shared.shirts[s%shared.shirts.length],pants=shared.pants[(s>>>2)%shared.pants.length],skin=shared.skins[(s>>>4)%shared.skins.length],torso=new THREE.Mesh(shared.torso,shirt),head=new THREE.Mesh(shared.head,skin),r=baseRecord("person",index,group,shirt.color.getHex());r.legs=[];r.arms=[];torso.position.z=1.05;head.position.z=1.58;group.add(torso,head);for(const y of[-.11,.11]){const leg=new THREE.Mesh(shared.leg,pants);leg.position.set(0,y,.48);r.legs.push(leg);group.add(leg);}for(const y of[-.31,.31]){const arm=new THREE.Mesh(shared.arm,shirt);arm.position.set(0,y,1.07);r.arms.push(arm);group.add(arm);}return r;}
function makeBird(index){ensureShared();const s=hashText(`bird:${index}`),group=new THREE.Group(),mesh=new THREE.Mesh(shared.bird,shared.birds[s%shared.birds.length]),r=baseRecord("bird",index,group,mesh.material.color.getHex());mesh.scale.setScalar(.85+(s%14)/60);group.add(mesh);return r;}

function mergeParts(list){let n=0;const geos=list.map(([g,x=0,y=0,z=0,rx=0,ry=0,rz=0])=>{const q=g.index?g.toNonIndexed():g;q.rotateX(rx);q.rotateY(ry);q.rotateZ(rz);q.translate(x,y,z);n+=q.attributes.position.count;return q;});const pos=new Float32Array(n*3);let o=0;for(const q of geos){pos.set(q.attributes.position.array,o*3);o+=q.attributes.position.count;q.dispose();}const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.BufferAttribute(pos,3));g.computeVertexNormals();return g;}
// Dogs and cats (instanced): torso, four legs, tail / head, snout, ears.
function quadrupedBody(){const B=(x,y,z)=>new THREE.BoxGeometry(x,y,z);return mergeParts([[B(.66,.26,.27),0,0,0],[B(.08,.08,.3),.24,.09,-.2],[B(.08,.08,.3),.24,-.09,-.2],[B(.08,.08,.3),-.24,.09,-.2],[B(.08,.08,.3),-.24,-.09,-.2],[B(.3,.055,.055),-.44,0,.1,0,-.6,0],[B(.16,.16,.2),.3,0,.12,0,.5,0]]);}
function quadrupedHead(){return mergeParts([[new THREE.DodecahedronGeometry(.15,0),0,0,0],[new THREE.BoxGeometry(.15,.1,.09),.13,0,-.04],[new THREE.ConeGeometry(.045,.11,4),-.02,.08,.14,0,0,0],[new THREE.ConeGeometry(.045,.11,4),-.02,-.08,.14,0,0,0]]);}
function createDecor(scene){
  const trunk=zCylinder(.1,.15,2.3,7),crown=new THREE.DodecahedronGeometry(.92,0),pole=zCylinder(.035,.055,3.7,6),head=new THREE.SphereGeometry(.11,7,5),animalBody=quadrupedBody(),animalHead=quadrupedHead();
  // Stylized (cel-shaded via stylized_world_style.mjs): brown trunks, leafy crowns.
  const trunkMat=new THREE.MeshStandardMaterial({color:0x5a4030,roughness:.95}),crownMat=new THREE.MeshStandardMaterial({color:0x3f6b2a,roughness:.9}),glowMat=new THREE.MeshBasicMaterial({color:0x5fb04a,transparent:true,opacity:0,depthWrite:false,toneMapped:false}),animalMat=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.85});
  treeTrunks=new THREE.InstancedMesh(trunk,trunkMat,TREE_COUNT);treeCrowns=new THREE.InstancedMesh(crown,crownMat,TREE_COUNT);treeGlow=new THREE.InstancedMesh(crown,glowMat,TREE_COUNT);
  animalBodies=new THREE.InstancedMesh(animalBody,animalMat,AMBIENT_ANIMAL_COUNT);animalHeads=new THREE.InstancedMesh(animalHead,animalMat,AMBIENT_ANIMAL_COUNT);paintAnimals(true);
  lampPoles=new THREE.InstancedMesh(pole,mat(0x4b5358,.55,.35),LAMP_COUNT);lampHeads=new THREE.InstancedMesh(head,new THREE.MeshStandardMaterial({color:0xe4d3a3,roughness:.38,emissive:0x8f6f35,emissiveIntensity:.15}),LAMP_COUNT);
  decorRoot=new THREE.Group();decorRoot.name="WORLD_PROCEDURAL_DECOR";decorRoot.add(treeGlow,treeTrunks,treeCrowns,animalBodies,animalHeads,lampPoles,lampHeads);
  for(const m of[treeTrunks,treeCrowns,treeGlow,animalBodies,animalHeads,lampPoles,lampHeads]){m.userData.flightFireIgnore=true;m.userData.neonSkip=true;m.frustumCulled=true;}
  treeCrowns.userData.worldDecorKind="tree-green-mesh";treeGlow.userData.worldDecorKind="tree-halo-off";treeGlow.visible=false;animalBodies.userData.worldDecorKind="ambient-animal";animalHeads.userData.worldDecorKind="ambient-animal";
  scene.add(decorRoot);
}
function createLights(scene){lightRoot=new THREE.Group();lightRoot.name="WORLD_PROCEDURAL_LIGHTS";const hemi=new THREE.HemisphereLight(0xd8e7ef,0x5e5446,.26),sun=new THREE.DirectionalLight(0xffe6c5,.34);sun.position.set(-70,-40,110);lightRoot.add(hemi,sun);scene.add(lightRoot);}
function setInstance(mesh,i,x,y,z,s=1){matrix.compose(tmp.set(x,y,z+staticGroundHeightAt(x,y)),quat.identity(),scale.set(s,s,s));mesh.setMatrixAt(i,matrix);}
if(typeof window!=="undefined")onTerrainChange(()=>{try{positionDecor();}catch{}});
function positionDecor(){if(!worldSeed||!treeTrunks)return;for(let i=0;i<TREE_COUNT;i++){const seed=hashText(`${worldSeed}:tree:${i}`),x=anchorX+range(seed,1,-82,82),y=anchorY+range(seed,2,-82,82),sc=range(seed,3,.78,1.18);setInstance(treeTrunks,i,x,y,1.15,sc);setInstance(treeCrowns,i,x,y,2.75,sc*1.12);setInstance(treeGlow,i,x,y,2.75,sc*1.25);}treeTrunks.instanceMatrix.needsUpdate=true;treeCrowns.instanceMatrix.needsUpdate=true;treeGlow.instanceMatrix.needsUpdate=true;for(let i=0;i<LAMP_COUNT;i++){const seed=hashText(`${worldSeed}:lamp:${i}`),axis=u(seed,1)>.5,x=anchorX+(axis?range(seed,2,-78,78):(u(seed,3)>.5?42:-42)),y=anchorY+(axis?(u(seed,3)>.5?42:-42):range(seed,2,-78,78));setInstance(lampPoles,i,x,y,1.85);setInstance(lampHeads,i,x,y,3.72);}lampPoles.instanceMatrix.needsUpdate=true;lampHeads.instanceMatrix.needsUpdate=true;}
// Animals are real targets: a hit or a blast kills them (they topple over,
// vanish after a while and a new one wanders in later).
const animalDead=[],animalPose=[],animalMotion=[],deadTilt=new THREE.Quaternion(),tmp2=new THREE.Vector3(),tmp2q=new THREE.Quaternion();
// Species: every third animal is a cat, the rest dogs. Now and then (every
// other two minutes) animal #1 is a BLACK CAT — shoot it and it does not
// die: it hisses, charges at you, leaps into your face and kills you.
const DOG_COLORS=[0x8a6a4a,0xc49a5a,0x3b2c22,0xe8dcc8,0x6e5a46],CAT_COLORS=[0x8d8d8d,0xd88a3a,0x5b5048,0xe9e2d6];
function blackCatActive(){return Math.floor(Date.now()/120000)%2===0;}
function speciesOf(i){if(i===1&&(blackCatActive()||catAttack))return"black-cat";return i%3===2?"cat":"dog";}
let paintedBlack=null,catAttack=null;
function paintAnimals(force=false){if(!animalBodies)return;const bc=speciesOf(1)==="black-cat";if(!force&&bc===paintedBlack)return;paintedBlack=bc;const c=new THREE.Color();for(let i=0;i<AMBIENT_ANIMAL_COUNT;i++){const sp=speciesOf(i),seed=hashText(`animal-color:${i}`);c.set(sp==="black-cat"?0x0d0d0f:sp==="cat"?CAT_COLORS[seed%CAT_COLORS.length]:DOG_COLORS[seed%DOG_COLORS.length]);animalBodies.setColorAt(i,c);animalHeads.setColorAt(i,c);}animalBodies.instanceColor.needsUpdate=true;animalHeads.instanceColor.needsUpdate=true;}
function speciesScale(i,base){const sp=speciesOf(i);return sp==="dog"?base:base*.62;}
function killAnimal(i){const p=animalPose[i];if(!p||animalDead[i])return false;const sp=speciesOf(i);
  if(sp==="black-cat"){if(!catAttack){catAttack={i,start:performance.now(),x:p.x,y:p.y,z:p.z,yaw:p.yaw,phase:"charge"};playAnimal("hiss");const v=document.getElementById("viewport");if(v)v.dataset.blackCat="charging";}return true;}
  animalDead[i]={at:performance.now(),x:p.x,y:p.y,yaw:p.yaw,sc:p.sc};playAnimal(sp==="cat"?"cat":"dog");window.dispatchEvent(new CustomEvent("arondight:world-kill",{detail:{id:`animal-${i}`,kind:"animal",species:sp,network:false,local:true}}));return true;}
function playerHead(){const w=globalThis.__arondightWalkMode;if(w?.mode==="foot"&&w.position)return{x:w.position.x,y:w.position.y,z:w.position.z};const c=bridge()?.threeCamera;return c?{x:c.position.x,y:c.position.y,z:c.position.z}:null;}
// The charge: 11 m/s straight at you (faster than you can run), a leap at
// 1.6 m, then lights out. If you are already dead/gone it gives up.
function updateCatAttack(now){const a=catAttack;if(!a)return null;const head=playerHead(),dt=Math.min(.05,(now-(a.last||now))/1000);a.last=now;if(!head||globalThis.__arondightPlayerDamageModel?.dead){catAttack=null;return null;}
  const dx=head.x-a.x,dy=head.y-a.y,d=Math.hypot(dx,dy);a.yaw=Math.atan2(dy,dx);
  if(a.phase==="charge"){const step=Math.min(d,11*dt);a.x+=dx/(d||1)*step;a.y+=dy/(d||1)*step;a.z=groundHeightAt(a.x,a.y)+ANIMAL_GROUND_OFFSET_M+Math.abs(Math.sin(now/55))*.12;if(d<1.6){a.phase="leap";a.leapAt=now;a.fx=a.x;a.fy=a.y;a.fz=a.z;playAnimal("screech");}if(now-a.start>25000){catAttack=null;return null;}}
  else{const t=Math.min(1,(now-a.leapAt)/340);a.x=a.fx+(head.x-a.fx)*t;a.y=a.fy+(head.y-a.fy)*t;const airborne=a.fz+(head.z-.05-a.fz)*t+Math.sin(t*Math.PI)*.55;a.z=Math.max(groundHeightAt(a.x,a.y)+.18,airborne);
    if(t>=1){globalThis.__arondightPlayerDamageModel?.damage?.(100000,"black-cat");window.dispatchEvent(new CustomEvent("arondight:black-cat-kill"));const v=document.getElementById("viewport");if(v)v.dataset.blackCat="killed-player";catAttack=null;return null;}}
  return a;}
globalThis.__ambientBirds={poses:()=>records.filter(r=>r.kind==="bird"&&r.group.visible&&!r.deadUntil).map(r=>({id:r.id,x:r.group.position.x,y:r.group.position.y,z:r.group.position.z,sc:r.group.children[0]?.scale.x||1})),kill:id=>{const r=records.find(q=>q.id===id);return r?killRecord(r):false;}};
globalThis.__ambientAnimals={kill:killAnimal,poses:()=>animalPose.map((p,i)=>p&&!animalDead[i]?{i,...p}:null).filter(Boolean)};
function updateAmbientAnimals(epoch,now){if(!animalBodies||now-lastAmbientAnimalTick<AMBIENT_ANIMAL_TICK_MS)return;lastAmbientAnimalTick=now;paintAnimals();const attack=updateCatAttack(now);const cx=anchorX,cy=anchorY;for(let i=0;i<AMBIENT_ANIMAL_COUNT;i++){if(attack&&attack.i===i){const sc=.62,y0=attack.yaw;animalPose[i]={x:attack.x,y:attack.y,z:attack.z,yaw:y0,sc};quat.setFromAxisAngle(decorUp,y0);if(attack.phase==="leap")quat.multiply(tmp2q.setFromAxisAngle(tmp2.set(0,1,0),-.5));matrix.compose(tmp.set(attack.x,attack.y,attack.z),quat,scale.set(sc,sc,sc));animalBodies.setMatrixAt(i,matrix);matrix.compose(tmp.set(attack.x+Math.cos(y0)*.43*sc,attack.y+Math.sin(y0)*.43*sc,attack.z+.16*sc),quat,scale.set(sc,sc,sc));animalHeads.setMatrixAt(i,matrix);continue;}const m=animalMotion[i]||(animalMotion[i]=(()=>{const seed=hashText(`${worldSeed}:animal:${i}`);return{radius:range(seed,1,13,58),omega:range(seed,2,.08,.20),phase:range(seed,3,0,Math.PI*2),wobbleOmega:range(seed,4,.6,1.4),wobbleRadius:range(seed,5,2,7),baseScale:range(seed,6,.72,1.18)}})()),a=epoch*m.omega+m.phase,wobble=Math.sin(epoch*m.wobbleOmega+m.phase)*m.wobbleRadius,x=cx+Math.cos(a)*m.radius+Math.cos(a*2.3)*wobble,y=cy+Math.sin(a*.92)*m.radius*.72+Math.sin(a*1.7)*wobble,z=ANIMAL_GROUND_OFFSET_M,prior=animalPose[i],yaw=prior&&Math.hypot(x-prior.x,y-prior.y)>.0001?Math.atan2(y-prior.y,x-prior.x):a+Math.PI/2,sc=speciesScale(i,m.baseScale);const dead=animalDead[i];if(dead){const age=(now-dead.at)/1000;if(age>25){animalDead[i]=null;}else{const fall=Math.min(1,age/.35),gone=age>7;quat.setFromAxisAngle(decorUp,dead.yaw);deadTilt.setFromAxisAngle(tmp2.set(Math.cos(dead.yaw),Math.sin(dead.yaw),0),fall*Math.PI/2);quat.premultiply(deadTilt);const s2=gone?0:dead.sc;const dz=groundHeightAt(dead.x,dead.y)+.12;matrix.compose(tmp.set(dead.x,dead.y,dz),quat,scale.set(s2,s2,s2));animalBodies.setMatrixAt(i,matrix);matrix.compose(tmp.set(dead.x+Math.cos(dead.yaw)*.43*dead.sc,dead.y+Math.sin(dead.yaw)*.43*dead.sc,dz),quat,scale.set(s2,s2,s2));animalHeads.setMatrixAt(i,matrix);continue;}}
    const gz=groundHeightAt(x,y)+z;animalPose[i]={x,y,z:gz,yaw,sc};quat.setFromAxisAngle(decorUp,yaw);matrix.compose(tmp.set(x,y,gz),quat,scale.set(sc,sc,sc));animalBodies.setMatrixAt(i,matrix);matrix.compose(tmp.set(x+Math.cos(yaw)*.43*sc,y+Math.sin(yaw)*.43*sc,gz+.16*sc),quat,scale.set(sc,sc,sc));animalHeads.setMatrixAt(i,matrix);}animalBodies.instanceMatrix.needsUpdate=true;animalHeads.instanceMatrix.needsUpdate=true;}

function ensureScene(){const scene=bridge()?.threeScene;if(!scene)return false;if(scene===boundScene&&root)return true;for(const record of records)if(record.id){rigidBodies()?.removeBody?.(record.id);stopWorldCriticalDamage(record.id);}boundScene=scene;records.splice(0);byId.clear();routes.splice(0);routeCache.clear();worldKey="";worldSeed=0;lastRouteRefresh=-Infinity;lastRouteOrigin="";root=new THREE.Group();root.name="WORLD_PROCEDURAL_POPULATION";scene.add(root);createDecor(scene);createLights(scene);for(let i=0;i<CAR_COUNT;i++)records.push(makeCar(i));for(let i=0;i<PERSON_COUNT;i++)records.push(makePerson(i));for(let i=0;i<BUS_COUNT;i++)records.push(makeBus(i));for(let i=0;i<BIRD_COUNT;i++)records.push(makeBird(i));spawnVisibilityRoots.length=0;for(const record of records){record.group.visible=false;root.add(record.group);if(record.kind==="car"||record.kind==="person")spawnVisibilityRoots.push(record.group);}return true;}
function motionFor(record){const s=record.seed,person=record.kind==="person",bus=record.kind==="bus";if(record.kind==="bird")return{cx:range(s,1,-35,35),cy:range(s,2,-35,35),rx:range(s,3,20,62),ry:range(s,4,16,52),z:range(s,5,9,24),omega:range(s,6,.16,.34),phase:range(s,7,0,Math.PI*2)};return{cx:range(s,1,-42,42),cy:range(s,2,-42,42),hx:person?range(s,3,10,28):bus?range(s,3,44,68):range(s,3,28,58),hy:person?range(s,4,8,24):bus?range(s,4,32,56):range(s,4,22,48),angle:range(s,5,-Math.PI,Math.PI),phase:range(s,6,0,1),speed:person?range(s,7,1.0,1.65):bus?range(s,7,5.0,7.6):range(s,7,7.4,13.2)};}
function trainingMotionFor(record){const motion=motionFor(record);if(record.kind!=="car"&&record.kind!=="bus")return motion;const bus=record.kind==="bus",s=record.seed;if(record.index===0)return{...motion,cx:0,cy:0,hx:bus?25:18,hy:bus?17:13,angle:range(s,35,-Math.PI,Math.PI)};return{...motion,cx:range(s,31,-10,10),cy:range(s,32,-8,8),hx:bus?range(s,33,25,40):range(s,33,18,34),hy:bus?range(s,34,17,28):range(s,34,13,25),angle:range(s,35,-Math.PI,Math.PI)};}
function configureWorld(){
  const b=bridge(),v=viewport(),real=Boolean(b?.active&&Number.isFinite(b.originLon)&&Number.isFinite(b.originLat));let key="training",east=0,north=0;
  if(real){const bucketLat=Math.round(b.originLat*1000)/1000,bucketLon=Math.round(b.originLon*1000)/1000;key=`${bucketLat.toFixed(3)}:${bucketLon.toFixed(3)}`;[east,north]=lngLatToMeters(b.originLon,b.originLat,bucketLon,bucketLat);lastOriginLon=b.originLon;lastOriginLat=b.originLat;}
  else if(v?.dataset?.worldMode==="real"&&worldKey&&worldKey!=="training")return true;
  else{lastOriginLon=NaN;lastOriginLat=NaN;}
  anchorX=east;anchorY=north;if(key===worldKey)return true;
  for(const record of records)if(record.id){rigidBodies()?.removeBody?.(record.id);stopWorldCriticalDamage(record.id);}
  if(key==="training"||worldKey==="training"){routes.splice(0);routeCache.clear();lastRouteOrigin="";}
  worldKey=key;worldSeed=hashText(`arondight-world-pop:${key}`);byId.clear();
  if(key==="training"){const seeded=trainingRoutes();routes.splice(0,routes.length,...seeded);for(const route of seeded)routeCache.set(route.key,route);}
  for(const record of records){record.seed=hashText(`${worldSeed}:${record.kind}:${record.index}`);record.id=`${record.kind}-proc-${worldSeed.toString(36)}-${record.index}`;record.motion=key==="training"?trainingMotionFor(record):motionFor(record);record.speed=record.motion.speed||0;record.deadUntil=0;record.physicsRegistered=false;record.physicsPose=null;record.routeKey="";record.streamX=record.streamY=record.streamRebinds=0;record.stalledSince=0;record.lastNudgeAt=0;record.routeDirection=record.seed&1?-1:1;retag(record);byId.set(record.id,record);}
  animalMotion.length=0;positionDecor();lastAmbientAnimalTick=-Infinity;if(v){v.dataset.worldProceduralSeed=worldSeed.toString(36);v.dataset.worldProceduralBucket=key;v.dataset.worldPopulationMode=key==="training"?"training-physical":"real-road-physical";v.dataset.worldPopulationArchitecture="route+box3d-rigid-v3";v.dataset.worldLifeArchitecture="route+box3d-rigid-v3";v.dataset.worldTrafficContinuity="force-driven-contact-resolved-v2";v.dataset.worldCars=String(CAR_COUNT);v.dataset.worldDrivableCars=String(CAR_COUNT);v.dataset.worldPeople=String(PERSON_COUNT);v.dataset.worldLifeExtraCars=String(CAR_COUNT);v.dataset.worldLifeExtraPeople=String(PERSON_COUNT);v.dataset.worldLifeBuses=String(BUS_COUNT);v.dataset.worldLifeBirds=String(BIRD_COUNT);v.dataset.worldAmbientAnimals=String(AMBIENT_ANIMAL_COUNT);v.dataset.worldTrees=String(TREE_COUNT);v.dataset.worldTreeMesh="stylized-cel-instanced-v1";v.dataset.worldLifeShootable="1";v.dataset.worldTrafficRoutes="1";v.dataset.worldLifeRoutes=String(routes.length);v.dataset.worldVehiclePhysics="box3d-dynamic-force-controller-v1";v.dataset.worldVehicleGrounding="box3d-static-ground-contact-v1";v.dataset.worldTrainingTrafficRadiusM="52";v.dataset.worldVehicleDamagePresentation="critical-smoke+delayed-explosion-v1";}return true;
}
function refreshAnchor(){const b=bridge();if(worldKey==="training"||!Number.isFinite(b?.originLon)||!Number.isFinite(b?.originLat))return;if(b.originLon===lastOriginLon&&b.originLat===lastOriginLat)return;configureWorld();positionDecor();}

function localRoute(key,points,roadClass="secondary"){const segments=[];let length=0;for(let i=0;i<points.length-1;i++){const a=points[i],c=points[i+1],dx=c[0]-a[0],dy=c[1]-a[1],d=Math.hypot(dx,dy);if(d<.5)continue;segments.push({a,c,dx,dy,d,start:length});length+=d;}return segments.length?{key,points,segments,length,roadClass,lastSeen:Infinity,training:true}:null;}
function trainingRoutes(){return[
  localRoute("training-loop",[[-62,-38],[62,-38],[62,38],[-62,38],[-62,-38]],"secondary"),
  localRoute("training-east-west",[[-84,0],[-24,0],[24,0],[84,0]],"primary"),
  localRoute("training-north-south",[[0,-76],[0,-28],[0,28],[0,76]],"secondary"),
  localRoute("training-waterfront",[[-70,54],[-28,54],[18,54],[70,54]],"tertiary")
].filter(Boolean);}
function fallbackRoads(b){const out=[];for(const feature of b?.minimapFeatures||[]){if(feature?.kind!=="road")continue;for(const path of feature.paths||[])if(path?.length>=2)out.push({path,roadClass:String(feature.roadClass||"road")});}return out;}
function refreshRoutes(now){
  const b=bridge();if(!b?.active||!Number.isFinite(b.originLon)||!Number.isFinite(b.originLat))return;const origin=`${b.originLon.toFixed(6)}:${b.originLat.toFixed(6)}`;if(now-lastRouteRefresh<ROUTE_REFRESH_MS&&origin===lastRouteOrigin)return;lastRouteRefresh=now;
  if(origin!==lastRouteOrigin&&routeCache.size){for(const[key,old]of routeCache){const rebuilt=buildTrafficRoute(old.geoPath,{originLon:b.originLon,originLat:b.originLat,roadClass:old.roadClass,lastSeen:old.lastSeen});if(rebuilt)routeCache.set(key,rebuilt);else routeCache.delete(key);}}lastRouteOrigin=origin;
  let candidates=[];try{candidates=collectRenderedDrivableRoads(b.map);}catch{}if(!candidates.length)candidates=fallbackRoads(b);const seen=new Set();for(const candidate of candidates){const route=buildTrafficRoute(candidate.path,{originLon:b.originLon,originLat:b.originLat,roadClass:candidate.roadClass,lastSeen:now});if(!route||seen.has(route.key))continue;seen.add(route.key);routeCache.set(route.key,route);}for(const[key,route]of routeCache)if(now-route.lastSeen>ROUTE_STALE_MS*5)routeCache.delete(key);const fresh=[...routeCache.values()].filter(route=>now-route.lastSeen<=ROUTE_STALE_MS),pool=(fresh.length?fresh:[...routeCache.values()]).sort((a,c)=>a.key.localeCompare(c.key)).slice(0,MAX_ROUTE_POOL);if(pool.length)routes.splice(0,routes.length,...pool);const v=viewport();if(v){v.dataset.worldLifeRoutes=String(routes.length);v.dataset.worldTrafficRoadSource=seen.size?"rendered-osm":"cached-or-fallback";v.dataset.worldTrafficRouteModel="nearest-progress-lookahead-v1";}
}
function populationFocus(){if(cachedFocusTick===lastPopulationTick)return cachedFocus;cachedFocusTick=lastPopulationTick;const b=bridge(),walk=globalThis.__arondightWalkMode,drive=globalThis.__arondightVehicleDrive;if(drive?.active&&drive.cameraAnchor)return cachedFocus=drive.cameraAnchor;if(walk?.mode==="foot"&&walk.position)return cachedFocus=walk.position;const airframe=b?.airframeFor?.(b.threeScene)||b?.airframe;if(airframe?.getWorldPosition){airframe.getWorldPosition(cameraPos);return cachedFocus=cameraPos;}return cachedFocus=b?.threeCamera?.position||null;}
function streamFallbackAroundFocus(record,focus=populationFocus(),epoch=Date.now()/1000){
  if(!focus||!record.group.visible||record.group.userData?.playerDriven||Math.hypot(record.group.position.x-focus.x,record.group.position.y-focus.y)<=STREAM_REBIND_DISTANCE_M)return false;
  const cellX=Math.floor(focus.x/80),cellY=Math.floor(focus.y/80),seed=hashText(`${record.seed}:${cellX}:${cellY}:${record.streamRebinds}`),angle=u(seed,1)*Math.PI*2,distance=range(seed,2,MOBILE?72:88,MOBILE?98:116),sample=rectSample(record.motion,epoch);
  record.streamX=focus.x+Math.cos(angle)*distance-sample.x;record.streamY=focus.y+Math.sin(angle)*distance-sample.y;record.streamRebinds++;record.stalledSince=0;
  if(record.physicsRegistered){rigidBodies()?.removeBody?.(record.id);record.physicsRegistered=false;record.physicsPose=null;}
  return true;
}
function routeFor(record,now=performance.now()){
  if(!routes.length)return null;const current=record.routeKey?routeCache.get(record.routeKey):null,focus=populationFocus(),driven=Boolean(record.group.userData?.playerDriven),far=Boolean(focus&&record.group.visible&&Math.hypot(record.group.position.x-focus.x,record.group.position.y-focus.y)>STREAM_REBIND_DISTANCE_M),stale=Boolean(current&&now-current.lastSeen>ROUTE_STALE_MS*5);
  if(current&&(driven||(!far&&!stale)))return current;
  let pool=routes;if(focus){if(cachedRoutePoolTick!==lastPopulationTick){cachedRoutePoolTick=lastPopulationTick;cachedRoutePool=[...routes].map(route=>({route,d:nearestRouteDistance(route,focus.x,focus.y).offsetM})).sort((a,c)=>a.d-c.d).slice(0,Math.min(routes.length,18)).map(x=>x.route);}pool=cachedRoutePool;}const cellX=focus?Math.floor(focus.x/80):0,cellY=focus?Math.floor(focus.y/80):0,index=mod(record.index*7+(record.kind==="bus"?5:record.kind==="person"?3:1)+hashText(`${cellX}:${cellY}`),pool.length),next=pool[index]||pool[0];
  if(!next)return current||null;if(current?.key!==next.key){record.routeKey=next.key;record.routeDirection=record.seed&1?-1:1;record.stalledSince=0;if(record.physicsRegistered&&!driven){rigidBodies()?.removeBody?.(record.id);record.physicsRegistered=false;record.physicsPose=null;}}return next;
}
function laneWidth(route,record){const cls=String(route?.roadClass||""),width=/motorway|trunk|primary|secondary/.test(cls)?1.25:/service|living/.test(cls)? .64:.88;return(record.seed&1?1:-1)*width;}
function sampleRoadRoute(route,distance,offset=0,direction=1){if(!route?.segments?.length)return null;const d=clamp(distance,0,route.length),segment=route.segments.find(item=>d<=item.start+item.d)||route.segments.at(-1),t=clamp((d-segment.start)/segment.d,0,1),nx=-segment.dy/segment.d,ny=segment.dx/segment.d;return{x:segment.a[0]+segment.dx*t+nx*offset,y:segment.a[1]+segment.dy*t+ny*offset,yaw:Math.atan2(segment.dy,segment.dx)+(direction<0?Math.PI:0),distance:d};}
function samplePingPongRoute(route,distance,offset=0){const period=Math.max(.01,route.length*2),cycle=mod(distance,period),direction=cycle<=route.length?1:-1,d=direction>0?cycle:period-cycle;return sampleRoadRoute(route,d,offset,direction);}
function nearestRouteDistance(route,x,y){let best=0,bestDistance=Infinity;for(const segment of route?.segments||[]){const t=clamp(((x-segment.a[0])*segment.dx+(y-segment.a[1])*segment.dy)/(segment.d*segment.d),0,1),px=segment.a[0]+segment.dx*t,py=segment.a[1]+segment.dy*t,distance=Math.hypot(x-px,y-py);if(distance<bestDistance){bestDistance=distance;best=segment.start+segment.d*t;}}return{distance:best,offsetM:bestDistance};}
function vehicleShape(record){return record.kind==="bus"?{half:[4,1.17,1.08],mass:9200}:{half:[1.78,.82,.42],mass:1420};}
function fallbackVehicleSample(record,epoch){const p=rectSample(record.motion,epoch,anchorX+record.streamX,anchorY+record.streamY);return{x:p.x,y:p.y,yaw:p.yaw};}
// Vehicles near the player (or the one being driven) are real Box3D cars
// (chassis + 4 wheel joints, AI driver steering to its route target). Far
// ones keep driving their route as a lightweight point (no physics body)
// and become physical again — exactly where they are — when the player
// comes close. Hysteresis avoids flapping at the boundary.
const PHYS_NEAR_M=150,PHYS_FAR_M=180,wheelOrigin=new THREE.Vector3(),wheelUp=new THREE.Vector3();
function updatePhysicalVehicle(record,epoch,now){
  if(!respawnAllowed(record)){record.group.visible=false;record.wheelPoses=null;if(record.physicsRegistered){rigidBodies()?.removeBody?.(record.id);record.physicsRegistered=false;}return;}
  const physics=rigidBodies(),route=routeFor(record,now);if(!route)streamFallbackAroundFocus(record,populationFocus(),epoch);const shape=vehicleShape(record),fallback=fallbackVehicleSample(record,epoch),initial=route?samplePingPongRoute(route,epoch*record.speed+(record.motion?.phase||0)*route.length,laneWidth(route,record)):fallback;
  const driven=Boolean(record.group.userData?.playerDriven),focus=populationFocus(),here=record.physicsRegistered&&record.physicsPose?record.physicsPose.position:[initial.x,initial.y],dist=focus?Math.hypot(here[0]-focus.x,here[1]-focus.y):0,near=driven||!focus||dist<(record.physicsRegistered?PHYS_FAR_M:PHYS_NEAR_M);
  if(!near){if(record.physicsRegistered){physics?.removeBody?.(record.id);record.physicsRegistered=false;}record.physicsPose=null;record.wheelPoses=null;record.group.position.set(initial.x,initial.y,groundHeightAt(initial.x,initial.y));record.group.rotation.set(0,0,initial.yaw);record.group.visible=true;return;}
  if(!record.physicsRegistered){
    const candidate={x:initial.x,y:initial.y,yaw:initial.yaw,half:shape.half};
    const occupied=records.some(other=>{
      if(other===record||!other.physicsRegistered||(other.kind!=="car"&&other.kind!=="bus"))return false;
      const p=other.physicsPose||physics?.pose?.(other.id);return p&&vehicleFootprintsOverlap(candidate,{x:p.position[0],y:p.position[1],yaw:p.yaw,half:vehicleShape(other).half});
    });
    if(occupied){record.group.visible=false;record.physicsPose=null;record.wheelPoses=null;return;}
  }
  if(!record.physicsRegistered)record.physicsRegistered=Boolean(physics?.upsertBody?.({id:record.id,kind:record.kind,position:[initial.x,initial.y,groundHeightAt(initial.x,initial.y)+shape.half[2]],yaw:initial.yaw,halfExtents:shape.half,massKg:shape.mass}));
  let pose=physics?.pose?.(record.id,record.physicsPose)||record.physicsPose;if(pose?.position&&pose.position[2]<staticGroundHeightAt(pose.position[0],pose.position[1])-6){physics?.removeBody?.(record.id);record.physicsRegistered=false;pose=null;}
  if(!driven&&pose){const current=pose.position;let targetPoint;
    if(route){const nearest=nearestRouteDistance(route,current[0],current[1]);if(nearest.distance>route.length-2.5)record.routeDirection=-1;else if(nearest.distance<2.5)record.routeDirection=1;const lookahead=Math.max(7,record.speed*1.3),targetDistance=clamp(nearest.distance+record.routeDirection*lookahead,0,route.length),offset=laneWidth(route,record)*record.routeDirection;targetPoint=sampleRoadRoute(route,targetDistance,offset,record.routeDirection);}else targetPoint=fallbackVehicleSample(record,epoch+1.1);
    physics?.setTarget?.(record.id,{position:[targetPoint.x,targetPoint.y,0],yaw:targetPoint.yaw,speedMps:record.speed});pose=physics?.pose?.(record.id,pose)||pose;}
  record.physicsPose=pose;
  if(pose){const q=pose.rotation,off=Number(pose.groundOffset)||shape.half[2];record.group.quaternion.set(q[0],q[1],q[2],q[3]);wheelUp.set(0,0,1).applyQuaternion(record.group.quaternion);record.group.position.set(pose.position[0]-wheelUp.x*off,pose.position[1]-wheelUp.y*off,pose.position[2]-wheelUp.z*off);record.wheelPoses=pose.wheels||null;}
  else{record.group.position.set(initial.x,initial.y,groundHeightAt(initial.x,initial.y));record.group.rotation.set(0,0,initial.yaw);record.wheelPoses=null;}
  record.group.visible=true;if(driven){const view=viewport();if(view)view.dataset.worldDrivenVehicleAi="suspended-while-player-controls-v1";}
}
// All wheels of all vehicles: one instanced draw call. Physical cars use the
// wheel bodies (spin, steering, suspension travel); far cars static wheels.
const WHEEL_LAYOUT={car:{r:.34,pts:[[1.2,.78],[1.2,-.78],[-1.15,.78],[-1.15,-.78]]},bus:{r:.46,pts:[[2.6,1.08],[2.6,-1.08],[-2.55,1.08],[-2.55,-1.08]]}};
let wheelMesh=null;const wq=new THREE.Quaternion(),wm=new THREE.Matrix4(),ws=new THREE.Vector3(),wp=new THREE.Vector3();
function updateWheelInstances(){
  if(!root)return;if(!wheelMesh){wheelMesh=new THREE.InstancedMesh(wheelGeometry(),vehicleMaterial,4*Math.max(8,records.filter(r=>r.kind==="car"||r.kind==="bus").length));wheelMesh.name="WORLD_VEHICLE_WHEELS";wheelMesh.castShadow=true;wheelMesh.receiveShadow=true;wheelMesh.frustumCulled=false;wheelMesh.userData.flightFireIgnore=true;wheelMesh.raycast=()=>{};root.add(wheelMesh);}
  let n=0;const cap=wheelMesh.instanceMatrix.count;
  for(const r of records){if((r.kind!=="car"&&r.kind!=="bus")||!r.group.visible||n+4>cap)continue;const L=WHEEL_LAYOUT[r.kind],k=L.r/.34;ws.set(k,k,k);
    if(r.wheelPoses?.length===4){for(const w of r.wheelPoses){wp.set(w.position[0],w.position[1],w.position[2]);wq.set(w.rotation[0],w.rotation[1],w.rotation[2],w.rotation[3]);wm.compose(wp,wq,ws);wheelMesh.setMatrixAt(n++,wm);}}
    else{r.group.updateMatrixWorld();for(const[x,y]of L.pts){wp.set(x,y,L.r).applyMatrix4(r.group.matrixWorld);wm.compose(wp,r.group.quaternion,ws);wheelMesh.setMatrixAt(n++,wm);}}}
  wheelMesh.count=n;wheelMesh.instanceMatrix.needsUpdate=true;
}

function rectSample(m,t,baseX=anchorX,baseY=anchorY){const w=2*m.hx,h=2*m.hy,per=2*(w+h),d=mod(t*m.speed+m.phase*per,per);let x,y,dx,dy;if(d<w){x=-m.hx+d;y=-m.hy;dx=1;dy=0;}else if(d<w+h){x=m.hx;y=-m.hy+(d-w);dx=0;dy=1;}else if(d<2*w+h){x=m.hx-(d-w-h);y=m.hy;dx=-1;dy=0;}else{x=-m.hx;y=m.hy-(d-2*w-h);dx=0;dy=-1;}const c=Math.cos(m.angle),s=Math.sin(m.angle),rx=x*c-y*s,ry=x*s+y*c,rdx=dx*c-dy*s,rdy=dx*s+dy*c;return{x:baseX+m.cx+rx,y:baseY+m.cy+ry,yaw:Math.atan2(rdy,rdx)};}
function respawnAllowed(record){if(!record.deadUntil)return true;const now=Date.now();if(now<record.deadUntil)return false;const camera=bridge()?.threeCamera;if(!camera?.getWorldPosition)return false;camera.getWorldPosition(cameraPos);const clearance=record.kind==="bird"?70:55;if(cameraPos.distanceTo(record.group.position)<clearance)return false;record.deadUntil=0;return true;}
// A shot bird drops out of the sky: ballistic fall with air drag, tumbling,
// wings folded; it lies on the (deformed) ground for a while, then is gone.
function updateFallingBird(record){const f=record.fall,t=Date.now(),dt=Math.min(.05,(t-f.last)/1000);f.last=t;const g=record.group;
  if(!f.landed){f.vz-=9.81*dt;const drag=Math.exp(-.9*dt);f.vx*=drag;f.vy*=drag;f.x+=f.vx*dt;f.y+=f.vy*dt;f.z+=f.vz*dt;f.roll+=f.spin*dt;const ground=groundHeightAt(f.x,f.y)+.05;if(f.z<=ground){f.z=ground;f.landed=t;}
    g.position.set(f.x,f.y,f.z);g.rotation.set(f.roll,.6*Math.sin(f.roll*.7),g.rotation.z+f.spin*.35*dt);g.scale.set(1,.35,1);}
  else{g.position.z=groundHeightAt(f.x,f.y)+.05;g.rotation.set(Math.PI*.5*Math.sign(f.spin||1),0,g.rotation.z);g.scale.set(1,.4,1);}
  g.visible=true;if(f.landed&&t-f.landed>6000){record.fall=null;g.visible=false;g.scale.set(1,1,1);}}
function updateRecord(record,epoch,now){if(record.kind==="car"||record.kind==="bus"){updatePhysicalVehicle(record,epoch,now);return;}if(record.fall){updateFallingBird(record);return;}if(!respawnAllowed(record)){record.group.visible=false;return;}if(record.kind==="bird"){const m=record.motion,a=epoch*m.omega+m.phase,flap=.82+.2*Math.sin(epoch*10+record.index),cx=anchorX+m.cx,cy=anchorY+m.cy;const bx=cx+Math.cos(a)*m.rx,by=cy+Math.sin(a*.94)*m.ry,bz=m.z+Math.sin(a*2.3+record.index)*2.1,dx=-Math.sin(a)*m.rx,dy=.94*Math.cos(a*.94)*m.ry,yaw=Math.atan2(dy,dx);record.group.position.set(bx,by,bz+Math.max(0,groundHeightAt(bx,by)));record.group.rotation.set(.08*Math.sin(a*3),0,yaw);record.group.scale.set(1,flap,1);record.group.visible=true;return;}const route=routeFor(record,now);if(!route&&worldKey!=="training")streamFallbackAroundFocus(record,populationFocus(),epoch);const p=route?samplePingPongRoute(route,epoch*record.speed+(record.motion?.phase||0)*route.length,(record.seed&1?1:-1)*2.45):rectSample(record.motion,epoch,anchorX+record.streamX,anchorY+record.streamY),phase=epoch*(6.2+record.speed*.35)+record.index,z=.018*Math.sin(phase)+groundHeightAt(p.x,p.y);record.group.position.set(p.x,p.y,z);record.group.rotation.set(0,0,p.yaw);if(record.kind==="person"){const swing=Math.sin(phase)*.42;if(record.legs?.[0])record.legs[0].rotation.y=swing;if(record.legs?.[1])record.legs[1].rotation.y=-swing;if(record.arms?.[0])record.arms[0].rotation.y=-swing*.72;if(record.arms?.[1])record.arms[1].rotation.y=swing*.72;}record.group.visible=true;}

function styleMap(){const b=bridge(),map=b?.map;if(!b?.active||!map?.getStyle||!map?.setPaintProperty||mapStyledFor===map)return;let changed=0;for(const layer of map.getStyle()?.layers||[]){const id=String(layer?.id||"").toLowerCase(),source=String(layer?.["source-layer"]||"").toLowerCase();try{if(layer.type==="fill-extrusion"&&(source==="building"||id.includes("building"))){map.setPaintProperty(layer.id,"fill-extrusion-opacity",1);changed++;}}catch{}}mapStyledFor=map;const v=viewport();if(v){v.dataset.worldVisualPalette="neon-tactical-v1";v.dataset.worldVisualPaletteLayers=String(changed);}}
function maintain(now){const b=bridge();if(!b?.active||now-lastMaintenance<MAINTENANCE_MS)return;lastMaintenance=now;try{const opaque=makeBuildingsOpaque(b.map),depth=syncWorldBuildingDepthOcclusion(b),v=viewport();styleMap();if(v){v.dataset.worldBuildingsOpaque="1";v.dataset.worldBuildingsSolidified=String(opaque);v.dataset.worldBuildingDepthOccluders=String(depth);}}catch{}}

function nodeRecord(hit){for(let n=hit?.object;n;n=n.parent){const id=String(n.userData?.worldProceduralId||n.userData?.worldPopulationId||"");if(id&&byId.has(id))return byId.get(id);}return null;}
function sendDeath(record){try{bridge()?.vsSession?.sendFx?.({type:FX_TYPE,id:`${record.id}-${Date.now().toString(36)}`,objectId:record.id,kind:record.kind,p:[record.group.position.x,record.group.position.y,record.group.position.z],yaw:record.group.rotation.z});}catch{}}
function killRecord(record,{network=true}={}){
  if(!record||record.deadUntil)return false;
  stopWorldCriticalDamage(record.id);
  record.group.getWorldPosition(tmp);const physicsPose=rigidBodies()?.pose?.(record.id),position=[tmp.x,tmp.y,tmp.z],now=Date.now(),angle=range(record.seed,21,-Math.PI,Math.PI);
  if(record.kind==="person"){record.deadUntil=now+10000;spawnWorldPersonRagdoll({position:[tmp.x,tmp.y,Math.max(.8,tmp.z+.7)],yaw:record.group.rotation.z,impulse:[Math.cos(angle)*2.5,Math.sin(angle)*2.5,2.6],seed:record.id,id:record.id});}
  else if(record.kind==="car"||record.kind==="bus"){record.deadUntil=now+(record.kind==="bus"?20000:16000);spawnWorldCarExplosion({position:[tmp.x,tmp.y,record.kind==="bus"?1.2:.45],yaw:record.group.rotation.z,velocity:physicsPose?.velocity||[Math.cos(record.group.rotation.z)*record.speed,Math.sin(record.group.rotation.z)*record.speed,0],color:record.color,seed:record.id,id:record.id});rigidBodies()?.removeBody?.(record.id);record.physicsRegistered=false;record.physicsPose=null;}
  else if(record.kind==="bird"){record.deadUntil=now+9000;const yaw=record.group.rotation.z,m=record.motion||{},sp=(m.omega||.25)*(m.rx||30)*.8;record.fall={t:now,last:now,x:tmp.x,y:tmp.y,z:tmp.z,vx:Math.cos(yaw)*sp,vy:Math.sin(yaw)*sp,vz:1.2,spin:range(record.seed,22,-9,9),roll:0,landed:0};playAnimal("bird");}
  else record.deadUntil=now+9000;
  if(!record.fall)record.group.visible=false;
  if(network){sendDeath(record);window.dispatchEvent(new CustomEvent("arondight:world-kill",{detail:{id:record.id,kind:record.kind,position,network:true}}));}
  const v=viewport();if(v){v.dataset.worldLifeHits=String((Number(v.dataset.worldLifeHits)||0)+1);v.dataset.worldPopulationHits=String((Number(v.dataset.worldPopulationHits)||0)+1);v.dataset.worldLifeLastHit=record.kind;v.dataset.worldPopulationLastHit=record.kind;}return true;
}
function handleProceduralHit(hit){const record=nodeRecord(hit);if(!record)return false;if(!record.deadUntil)killRecord(record);return true;}
function ensureHitBridge(){const b=bridge();if(!b||hitBridge===b)return;const base=typeof b.registerWorldPopulationHit==="function"?b.registerWorldPopulationHit.bind(b):null;const dispatcher=hit=>handleProceduralHit(hit)||(base?Boolean(base(hit)):false);dispatcher.__proceduralPopulationProvider=true;dispatcher.__worldLivelinessWrapper=true;dispatcher.__gameplayPolishLiteWrapper=true;b.__proceduralPopulationHit=handleProceduralHit;b.registerWorldPopulationHit=dispatcher;hitBridge=b;}
function handleRemoteFx(event){const packet=event?.detail?.packet;if(packet?.type!==FX_TYPE)return;const record=byId.get(String(packet.objectId||""));if(record&&!record.deadUntil)killRecord(record,{network:false});}

function frame(now=performance.now()){requestAnimationFrame(frame);const dt=Math.min(.05,Math.max(0,(now-lastFrame)/1000||0));lastFrame=now;void dt;syncSatelliteMigration();if(!ensureScene())return;ensureHitBridge();const visible=worldVisible();root.visible=visible;decorRoot.visible=visible;lightRoot.visible=visible;if(!visible||now-lastPopulationTick<POPULATION_TICK_MS)return;lastPopulationTick=now;if(!configureWorld())return;refreshAnchor();refreshRoutes(now);maintain(now);const epoch=Date.now()/1000;updateAmbientAnimals(epoch,now);let alive=0,physicalVehicles=0,lowestVehicleZ=Infinity,streamRebinds=0;for(const record of records){updateRecord(record,epoch,now);streamRebinds+=record.streamRebinds||0;if(record.group.visible)alive++;if((record.kind==="car"||record.kind==="bus")&&record.physicsPose){physicalVehicles++;lowestVehicleZ=Math.min(lowestVehicleZ,record.group.position.z);}}try{updateWheelInstances();}catch(e){console.warn("wheels",e);}if(now-lastTelemetryTick>=250){lastTelemetryTick=now;const v=viewport();if(v){v.dataset.worldLifeVisible=String(alive);v.dataset.worldLifeTotal=String(records.length);v.dataset.worldProceduralPopulation="1";v.dataset.worldPopulationTickHz=String(Math.round(1000/POPULATION_TICK_MS));v.dataset.worldAmbientAnimalTickHz=String(Math.round(1000/AMBIENT_ANIMAL_TICK_MS));v.dataset.worldDecorDrawCalls="instanced-trees+halo+animals-v1";v.dataset.worldPopulationStreaming="world-anchored-routes+offscreen-recycle-v6";v.dataset.worldPopulationGrounding="world-space-fixed-centres-v1";v.dataset.worldTrainingRoutes="fixed-local-road-network-v1";v.dataset.worldPopulationRebinds=String(streamRebinds);v.dataset.worldVehicleStallRecovery="impulse-nudge-v1";v.dataset.worldPedestrianRouting=worldKey==="training"?"training-offscreen-stream-v2":"road-sidewalk-stream-v1";v.dataset.worldVehiclePhysics=rigidBodies()?.ready?"box3d-dynamic-force-controller-v1":"waiting-box3d";v.dataset.worldPhysicsVehicleVisuals=String(physicalVehicles);v.dataset.worldPhysicsVehicleLowestZ=Number.isFinite(lowestVehicleZ)?lowestVehicleZ.toFixed(3):"waiting";v.dataset.worldPopulationTelemetry="250ms";}}}

export function installWorldProceduralPopulation(){if(installed)return;installed=true;globalThis.__arondightProceduralPopulation={get spawnVisibilityRoots(){return spawnVisibilityRoots;}};globalThis.addEventListener(VS_FX_EVENT,handleRemoteFx);requestAnimationFrame(frame);}

installWorldProceduralPopulation();
