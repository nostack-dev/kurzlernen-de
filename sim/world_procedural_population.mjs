import * as THREE from "three";
import {VS_FX_EVENT} from "./lan_vs.mjs";
import {spawnWorldPersonRagdoll} from "./world_person_ragdoll.mjs";
import {spawnWorldCarExplosion} from "./world_car_explosion.mjs";
import {stopWorldCriticalDamage} from "./world_critical_damage_fx.mjs";
import {buildTrafficRoute,collectRenderedDrivableRoads,makeBuildingsOpaque} from "./world_traffic_routes.mjs";
import {syncWorldBuildingDepthOcclusion} from "./world_building_depth_occlusion.mjs";

const MOBILE=/(?:android|iphone|ipad|ipod|macintosh.*mobile)/i.test(globalThis.navigator?.userAgent||"");
const CAR_COUNT=MOBILE?14:24;
const PERSON_COUNT=MOBILE?18:30;
const BUS_COUNT=MOBILE?3:5;
const BIRD_COUNT=MOBILE?10:16;
const TREE_COUNT=MOBILE?16:28;
const LAMP_COUNT=MOBILE?12:20;
const MAINTENANCE_MS=1800;
const ROUTE_REFRESH_MS=1600;
const ROUTE_STALE_MS=18000;
const MAX_ROUTE_POOL=56;
const IMAGERY_STORAGE="arondight45WorldImageryV1";
const IMAGERY_DEFAULT_OFF_MIGRATION="arondight45WorldImageryDefaultOffV3";
const FX_TYPE="world-procedural-death-v1";
const EARTH_RADIUS_M=6378137;

const records=[],byId=new Map(),routes=[],routeCache=new Map();
const tmp=new THREE.Vector3(),cameraPos=new THREE.Vector3(),matrix=new THREE.Matrix4(),quat=new THREE.Quaternion(),scale=new THREE.Vector3(1,1,1);
let installed=false,boundScene=null,root=null,decorRoot=null,lightRoot=null,treeTrunks=null,treeCrowns=null,lampPoles=null,lampHeads=null;
let worldKey="",worldSeed=0,anchorX=0,anchorY=0,lastOriginLon=NaN,lastOriginLat=NaN,lastMaintenance=-Infinity,lastRouteRefresh=-Infinity,lastRouteOrigin="",worldVisibleLatched=false,mapStyledFor=null;
let hitBridge=null,lastFrame=performance.now(),forceImageryOff=false;

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
function retag(record){record.group.userData.worldPopulationKind=record.kind;record.group.userData.worldPopulationId=record.id;record.group.userData.worldProceduralId=record.id;record.group.traverse(node=>{if(node?.isMesh)tag(node,record);});}
function baseRecord(kind,index,group,color=0){return{kind,index,group,color,id:"",seed:0,motion:null,deadUntil:0,speed:0,routeDirection:index&1?-1:1,physicsRegistered:false,physicsPose:null};}
function makeCar(index){ensureShared();const s=hashText(`car:${index}`),group=new THREE.Group(),bodyMat=shared.carMats[s%shared.carMats.length],body=new THREE.Mesh(shared.carBody,bodyMat),cab=new THREE.Mesh(shared.carCabin,shared.window),r=baseRecord("car",index,group,bodyMat.color.getHex());body.position.z=.48;cab.position.set(-.1,0,.93);group.add(body,cab);for(const x of[-1.18,1.18])for(const y of[-.86,.86]){const wheel=new THREE.Mesh(shared.wheel,shared.wheelMat);wheel.position.set(x,y,.28);group.add(wheel);}return r;}
function makeBus(index){ensureShared();const s=hashText(`bus:${index}`),group=new THREE.Group(),bodyMat=shared.busMats[s%shared.busMats.length],body=new THREE.Mesh(shared.busBody,bodyMat),windows=new THREE.Mesh(shared.busWindow,shared.window),r=baseRecord("bus",index,group,bodyMat.color.getHex());body.position.z=1.2;windows.position.set(.05,0,1.68);group.add(body,windows);for(const x of[-2.55,2.55])for(const y of[-1.22,1.22]){const wheel=new THREE.Mesh(shared.busWheel,shared.wheelMat);wheel.position.set(x,y,.42);group.add(wheel);}return r;}
function makePerson(index){ensureShared();const s=hashText(`person:${index}`),group=new THREE.Group(),shirt=shared.shirts[s%shared.shirts.length],pants=shared.pants[(s>>>2)%shared.pants.length],skin=shared.skins[(s>>>4)%shared.skins.length],torso=new THREE.Mesh(shared.torso,shirt),head=new THREE.Mesh(shared.head,skin),r=baseRecord("person",index,group,shirt.color.getHex());torso.position.z=1.05;head.position.z=1.58;group.add(torso,head);for(const y of[-.11,.11]){const leg=new THREE.Mesh(shared.leg,pants);leg.position.set(0,y,.48);group.add(leg);}for(const y of[-.31,.31]){const arm=new THREE.Mesh(shared.arm,shirt);arm.position.set(0,y,1.07);group.add(arm);}return r;}
function makeBird(index){ensureShared();const s=hashText(`bird:${index}`),group=new THREE.Group(),mesh=new THREE.Mesh(shared.bird,shared.birds[s%shared.birds.length]),r=baseRecord("bird",index,group,mesh.material.color.getHex());mesh.scale.setScalar(.48+(s%14)/100);group.add(mesh);return r;}

function createDecor(scene){const trunk=zCylinder(.1,.15,2.3,7),crown=new THREE.DodecahedronGeometry(.92,0),pole=zCylinder(.035,.055,3.7,6),head=new THREE.SphereGeometry(.11,7,5);treeTrunks=new THREE.InstancedMesh(trunk,mat(0x6a523d,.95),TREE_COUNT);treeCrowns=new THREE.InstancedMesh(crown,mat(0x4f8658,.92),TREE_COUNT);lampPoles=new THREE.InstancedMesh(pole,mat(0x4b5358,.55,.35),LAMP_COUNT);lampHeads=new THREE.InstancedMesh(head,new THREE.MeshStandardMaterial({color:0xe4d3a3,roughness:.38,emissive:0x8f6f35,emissiveIntensity:.15}),LAMP_COUNT);decorRoot=new THREE.Group();decorRoot.name="WORLD_PROCEDURAL_DECOR";decorRoot.add(treeTrunks,treeCrowns,lampPoles,lampHeads);for(const m of[treeTrunks,treeCrowns,lampPoles,lampHeads])m.userData.flightFireIgnore=true;scene.add(decorRoot);}
function createLights(scene){lightRoot=new THREE.Group();lightRoot.name="WORLD_PROCEDURAL_LIGHTS";const hemi=new THREE.HemisphereLight(0xd8e7ef,0x5e5446,.26),sun=new THREE.DirectionalLight(0xffe6c5,.34);sun.position.set(-70,-40,110);lightRoot.add(hemi,sun);scene.add(lightRoot);}
function setInstance(mesh,i,x,y,z,s=1){matrix.compose(tmp.set(x,y,z),quat.identity(),scale.set(s,s,s));mesh.setMatrixAt(i,matrix);}
function positionDecor(){if(!worldSeed||!treeTrunks)return;for(let i=0;i<TREE_COUNT;i++){const s=hashText(`${worldSeed}:tree:${i}`),x=anchorX+range(s,1,-82,82),y=anchorY+range(s,2,-82,82),sc=range(s,3,.78,1.18);setInstance(treeTrunks,i,x,y,1.15,sc);setInstance(treeCrowns,i,x,y,2.75,sc*1.12);}treeTrunks.instanceMatrix.needsUpdate=true;treeCrowns.instanceMatrix.needsUpdate=true;for(let i=0;i<LAMP_COUNT;i++){const s=hashText(`${worldSeed}:lamp:${i}`),axis=u(s,1)>.5,x=anchorX+(axis?range(s,2,-78,78):(u(s,3)>.5?42:-42)),y=anchorY+(axis?(u(s,3)>.5?42:-42):range(s,2,-78,78));setInstance(lampPoles,i,x,y,1.85);setInstance(lampHeads,i,x,y,3.72);}lampPoles.instanceMatrix.needsUpdate=true;lampHeads.instanceMatrix.needsUpdate=true;}

function ensureScene(){const scene=bridge()?.threeScene;if(!scene)return false;if(scene===boundScene&&root)return true;for(const record of records)if(record.id){rigidBodies()?.removeBody?.(record.id);stopWorldCriticalDamage(record.id);}boundScene=scene;records.splice(0);byId.clear();routes.splice(0);routeCache.clear();worldKey="";worldSeed=0;lastRouteRefresh=-Infinity;lastRouteOrigin="";root=new THREE.Group();root.name="WORLD_PROCEDURAL_POPULATION";scene.add(root);createDecor(scene);createLights(scene);for(let i=0;i<CAR_COUNT;i++)records.push(makeCar(i));for(let i=0;i<PERSON_COUNT;i++)records.push(makePerson(i));for(let i=0;i<BUS_COUNT;i++)records.push(makeBus(i));for(let i=0;i<BIRD_COUNT;i++)records.push(makeBird(i));for(const record of records){record.group.visible=false;root.add(record.group);}return true;}
function motionFor(record){const s=record.seed,person=record.kind==="person",bus=record.kind==="bus";if(record.kind==="bird")return{cx:range(s,1,-35,35),cy:range(s,2,-35,35),rx:range(s,3,20,62),ry:range(s,4,16,52),z:range(s,5,9,24),omega:range(s,6,.16,.34),phase:range(s,7,0,Math.PI*2)};return{cx:range(s,1,-42,42),cy:range(s,2,-42,42),hx:person?range(s,3,10,28):bus?range(s,3,44,68):range(s,3,28,58),hy:person?range(s,4,8,24):bus?range(s,4,32,56):range(s,4,22,48),angle:range(s,5,-Math.PI,Math.PI),phase:range(s,6,0,1),speed:person?range(s,7,1.0,1.65):bus?range(s,7,5.0,7.6):range(s,7,7.4,13.2)};}
function trainingMotionFor(record){const motion=motionFor(record);if(record.kind!=="car"&&record.kind!=="bus")return motion;const bus=record.kind==="bus",s=record.seed;if(record.index===0)return{...motion,cx:0,cy:0,hx:bus?25:18,hy:bus?17:13,angle:range(s,35,-Math.PI,Math.PI)};return{...motion,cx:range(s,31,-10,10),cy:range(s,32,-8,8),hx:bus?range(s,33,25,40):range(s,33,18,34),hy:bus?range(s,34,17,28):range(s,34,13,25),angle:range(s,35,-Math.PI,Math.PI)};}
function configureWorld(){
  const b=bridge(),v=viewport(),real=Boolean(b?.active&&Number.isFinite(b.originLon)&&Number.isFinite(b.originLat));let key="training",east=0,north=0;
  if(real){const bucketLat=Math.round(b.originLat*1000)/1000,bucketLon=Math.round(b.originLon*1000)/1000;key=`${bucketLat.toFixed(3)}:${bucketLon.toFixed(3)}`;[east,north]=lngLatToMeters(b.originLon,b.originLat,bucketLon,bucketLat);lastOriginLon=b.originLon;lastOriginLat=b.originLat;}
  else if(v?.dataset?.worldMode==="real"&&worldKey&&worldKey!=="training")return true;
  else{lastOriginLon=NaN;lastOriginLat=NaN;}
  anchorX=east;anchorY=north;if(key===worldKey)return true;
  for(const record of records)if(record.id){rigidBodies()?.removeBody?.(record.id);stopWorldCriticalDamage(record.id);}
  if(key==="training"){routes.splice(0);routeCache.clear();lastRouteOrigin="";}
  worldKey=key;worldSeed=hashText(`arondight-world-pop:${key}`);byId.clear();
  for(const record of records){record.seed=hashText(`${worldSeed}:${record.kind}:${record.index}`);record.id=`${record.kind}-proc-${worldSeed.toString(36)}-${record.index}`;record.motion=key==="training"?trainingMotionFor(record):motionFor(record);record.speed=record.motion.speed||0;record.deadUntil=0;record.physicsRegistered=false;record.physicsPose=null;record.routeDirection=record.seed&1?-1:1;retag(record);byId.set(record.id,record);}
  positionDecor();if(v){v.dataset.worldProceduralSeed=worldSeed.toString(36);v.dataset.worldPopulationMode=key==="training"?"training-physical":"real-road-physical";v.dataset.worldPopulationArchitecture="route+box3d-rigid-v3";v.dataset.worldLifeArchitecture="route+box3d-rigid-v3";v.dataset.worldTrafficContinuity="force-driven-contact-resolved-v2";v.dataset.worldCars=String(CAR_COUNT);v.dataset.worldPeople=String(PERSON_COUNT);v.dataset.worldLifeExtraCars=String(CAR_COUNT);v.dataset.worldLifeExtraPeople=String(PERSON_COUNT);v.dataset.worldLifeBuses=String(BUS_COUNT);v.dataset.worldLifeBirds=String(BIRD_COUNT);v.dataset.worldLifeShootable="1";v.dataset.worldTrafficRoutes="1";v.dataset.worldLifeRoutes=String(routes.length);v.dataset.worldVehiclePhysics="box3d-dynamic-force-controller-v1";v.dataset.worldVehicleGrounding="box3d-static-ground-contact-v1";v.dataset.worldTrainingTrafficRadiusM="52";v.dataset.worldVehicleDamagePresentation="critical-smoke+delayed-explosion-v1";}return true;
}
function refreshAnchor(){const b=bridge();if(worldKey==="training"||!Number.isFinite(b?.originLon)||!Number.isFinite(b?.originLat))return;if(b.originLon===lastOriginLon&&b.originLat===lastOriginLat)return;configureWorld();positionDecor();}

function fallbackRoads(b){const out=[];for(const feature of b?.minimapFeatures||[]){if(feature?.kind!=="road")continue;for(const path of feature.paths||[])if(path?.length>=2)out.push({path,roadClass:String(feature.roadClass||"road")});}return out;}
function refreshRoutes(now){
  const b=bridge();if(!b?.active||!Number.isFinite(b.originLon)||!Number.isFinite(b.originLat))return;const origin=`${b.originLon.toFixed(6)}:${b.originLat.toFixed(6)}`;if(now-lastRouteRefresh<ROUTE_REFRESH_MS&&origin===lastRouteOrigin)return;lastRouteRefresh=now;
  if(origin!==lastRouteOrigin&&routeCache.size){for(const[key,old]of routeCache){const rebuilt=buildTrafficRoute(old.geoPath,{originLon:b.originLon,originLat:b.originLat,roadClass:old.roadClass,lastSeen:old.lastSeen});if(rebuilt)routeCache.set(key,rebuilt);else routeCache.delete(key);}}lastRouteOrigin=origin;
  let candidates=[];try{candidates=collectRenderedDrivableRoads(b.map);}catch{}if(!candidates.length)candidates=fallbackRoads(b);const seen=new Set();for(const candidate of candidates){const route=buildTrafficRoute(candidate.path,{originLon:b.originLon,originLat:b.originLat,roadClass:candidate.roadClass,lastSeen:now});if(!route||seen.has(route.key))continue;seen.add(route.key);routeCache.set(route.key,route);}for(const[key,route]of routeCache)if(now-route.lastSeen>ROUTE_STALE_MS*5)routeCache.delete(key);const fresh=[...routeCache.values()].filter(route=>now-route.lastSeen<=ROUTE_STALE_MS),pool=(fresh.length?fresh:[...routeCache.values()]).sort((a,c)=>a.key.localeCompare(c.key)).slice(0,MAX_ROUTE_POOL);if(pool.length)routes.splice(0,routes.length,...pool);const v=viewport();if(v){v.dataset.worldLifeRoutes=String(routes.length);v.dataset.worldTrafficRoadSource=seen.size?"rendered-osm":"cached-or-fallback";v.dataset.worldTrafficRouteModel="nearest-progress-lookahead-v1";}
}
function routeFor(record){if(!routes.length)return null;return routes[(record.index*7+(record.kind==="bus"?5:1))%routes.length];}
function laneWidth(route,record){const cls=String(route?.roadClass||""),width=/motorway|trunk|primary|secondary/.test(cls)?1.25:/service|living/.test(cls)? .64:.88;return(record.seed&1?1:-1)*width;}
function sampleRoadRoute(route,distance,offset=0,direction=1){if(!route?.segments?.length)return null;const d=clamp(distance,0,route.length),segment=route.segments.find(item=>d<=item.start+item.d)||route.segments.at(-1),t=clamp((d-segment.start)/segment.d,0,1),nx=-segment.dy/segment.d,ny=segment.dx/segment.d;return{x:segment.a[0]+segment.dx*t+nx*offset,y:segment.a[1]+segment.dy*t+ny*offset,yaw:Math.atan2(segment.dy,segment.dx)+(direction<0?Math.PI:0),distance:d};}
function nearestRouteDistance(route,x,y){let best=0,bestDistance=Infinity;for(const segment of route?.segments||[]){const t=clamp(((x-segment.a[0])*segment.dx+(y-segment.a[1])*segment.dy)/(segment.d*segment.d),0,1),px=segment.a[0]+segment.dx*t,py=segment.a[1]+segment.dy*t,distance=Math.hypot(x-px,y-py);if(distance<bestDistance){bestDistance=distance;best=segment.start+segment.d*t;}}return{distance:best,offsetM:bestDistance};}
function vehicleShape(record){return record.kind==="bus"?{half:[4,1.17,1.08],mass:9200}:{half:[1.78,.82,.42],mass:1420};}
function fallbackVehicleSample(record,epoch){const p=rectSample(record.motion,epoch);return{x:p.x,y:p.y,yaw:p.yaw};}
function updatePhysicalVehicle(record,epoch,now){
  if(!respawnAllowed(record)){record.group.visible=false;if(record.physicsRegistered){rigidBodies()?.removeBody?.(record.id);record.physicsRegistered=false;}return;}const physics=rigidBodies(),route=routeFor(record),shape=vehicleShape(record),fallback=fallbackVehicleSample(record,epoch),initial=route?sampleRoadRoute(route,(record.motion?.phase||0)*route.length,laneWidth(route,record)*record.routeDirection,record.routeDirection):fallback;
  if(!record.physicsRegistered){physics?.upsertBody?.({id:record.id,kind:record.kind,position:[initial.x,initial.y,shape.half[2]],yaw:initial.yaw,halfExtents:shape.half,massKg:shape.mass});record.physicsRegistered=true;}
  let pose=physics?.pose?.(record.id)||record.physicsPose;if(pose?.position?.[2]<-2){physics?.removeBody?.(record.id);record.physicsRegistered=false;pose=null;}const current=pose?.position||[initial.x,initial.y,shape.half[2]];let targetPoint;
  if(route){const nearest=nearestRouteDistance(route,current[0],current[1]);if(nearest.distance>route.length-2.5)record.routeDirection=-1;else if(nearest.distance<2.5)record.routeDirection=1;const lookahead=Math.max(5.5,record.speed*1.15),targetDistance=clamp(nearest.distance+record.routeDirection*lookahead,0,route.length),offset=laneWidth(route,record)*record.routeDirection;targetPoint=sampleRoadRoute(route,targetDistance,offset,record.routeDirection);}else targetPoint=fallbackVehicleSample(record,epoch+1.1);
  physics?.setTarget?.(record.id,{position:[targetPoint.x,targetPoint.y,shape.half[2]],yaw:targetPoint.yaw,speedMps:record.speed,response:record.kind==="bus"?2.1:2.8,maxAccelerationMps2:record.kind==="bus"?3.4:5.2});pose=physics?.pose?.(record.id)||pose;record.physicsPose=pose;
  if(pose){record.group.position.set(pose.position[0],pose.position[1],pose.position[2]-shape.half[2]);record.group.quaternion.set(pose.rotation[0],pose.rotation[1],pose.rotation[2],pose.rotation[3]);}else{record.group.position.set(initial.x,initial.y,0);record.group.rotation.set(0,0,initial.yaw);}record.group.visible=true;
}

function rectSample(m,t){const w=2*m.hx,h=2*m.hy,per=2*(w+h),d=mod(t*m.speed+m.phase*per,per);let x,y,dx,dy;if(d<w){x=-m.hx+d;y=-m.hy;dx=1;dy=0;}else if(d<w+h){x=m.hx;y=-m.hy+(d-w);dx=0;dy=1;}else if(d<2*w+h){x=m.hx-(d-w-h);y=m.hy;dx=-1;dy=0;}else{x=-m.hx;y=m.hy-(d-2*w-h);dx=0;dy=-1;}const c=Math.cos(m.angle),s=Math.sin(m.angle),rx=x*c-y*s,ry=x*s+y*c,rdx=dx*c-dy*s,rdy=dx*s+dy*c;return{x:anchorX+m.cx+rx,y:anchorY+m.cy+ry,yaw:Math.atan2(rdy,rdx)};}
function respawnAllowed(record){if(!record.deadUntil)return true;const now=Date.now();if(now<record.deadUntil)return false;const camera=bridge()?.threeCamera;if(!camera?.getWorldPosition)return false;camera.getWorldPosition(cameraPos);const clearance=record.kind==="bird"?70:55;if(cameraPos.distanceTo(record.group.position)<clearance)return false;record.deadUntil=0;return true;}
function updateRecord(record,epoch,now){if(record.kind==="car"||record.kind==="bus"){updatePhysicalVehicle(record,epoch,now);return;}if(!respawnAllowed(record)){record.group.visible=false;return;}if(record.kind==="bird"){const m=record.motion,a=epoch*m.omega+m.phase,flap=.82+.2*Math.sin(epoch*10+record.index);record.group.position.set(anchorX+m.cx+Math.cos(a)*m.rx,anchorY+m.cy+Math.sin(a*.94)*m.ry,m.z+Math.sin(a*2.3+record.index)*2.1);record.group.rotation.set(.08*Math.sin(a*3),0,a+Math.PI/2);record.group.scale.set(1,flap,1);record.group.visible=true;return;}const p=rectSample(record.motion,epoch),z=.01*Math.sin(epoch*6+record.index);record.group.position.set(p.x,p.y,z);record.group.rotation.set(0,0,p.yaw);record.group.visible=true;}

function styleMap(){const b=bridge(),map=b?.map;if(!b?.active||!map?.getStyle||!map?.setPaintProperty||mapStyledFor===map)return;let changed=0;for(const layer of map.getStyle()?.layers||[]){const id=String(layer?.id||"").toLowerCase(),source=String(layer?.["source-layer"]||"").toLowerCase();try{if(layer.type==="fill-extrusion"&&(source==="building"||id.includes("building"))){map.setPaintProperty(layer.id,"fill-extrusion-opacity",.98);changed++;}}catch{}}mapStyledFor=map;const v=viewport();if(v){v.dataset.worldVisualPalette="natural-v2";v.dataset.worldVisualPaletteLayers=String(changed);}}
function maintain(now){const b=bridge();if(!b?.active||now-lastMaintenance<MAINTENANCE_MS)return;lastMaintenance=now;try{const opaque=makeBuildingsOpaque(b.map),depth=syncWorldBuildingDepthOcclusion(b),v=viewport();styleMap();if(v){v.dataset.worldBuildingsOpaque="1";v.dataset.worldBuildingsSolidified=String(opaque);v.dataset.worldBuildingDepthOccluders=String(depth);}}catch{}}

function nodeRecord(hit){for(let n=hit?.object;n;n=n.parent){const id=String(n.userData?.worldProceduralId||n.userData?.worldPopulationId||"");if(id&&byId.has(id))return byId.get(id);}return null;}
function sendDeath(record){try{bridge()?.vsSession?.sendFx?.({type:FX_TYPE,id:`${record.id}-${Date.now().toString(36)}`,objectId:record.id,kind:record.kind,p:[record.group.position.x,record.group.position.y,record.group.position.z],yaw:record.group.rotation.z});}catch{}}
function killRecord(record,{network=true}={}){
  if(!record||record.deadUntil)return false;
  stopWorldCriticalDamage(record.id);
  record.group.getWorldPosition(tmp);const physicsPose=rigidBodies()?.pose?.(record.id),position=[tmp.x,tmp.y,tmp.z],now=Date.now(),angle=range(record.seed,21,-Math.PI,Math.PI);
  if(record.kind==="person"){record.deadUntil=now+10000;spawnWorldPersonRagdoll({position:[tmp.x,tmp.y,Math.max(.8,tmp.z+.7)],yaw:record.group.rotation.z,impulse:[Math.cos(angle)*2.5,Math.sin(angle)*2.5,2.6],seed:record.id,id:record.id});}
  else if(record.kind==="car"||record.kind==="bus"){record.deadUntil=now+(record.kind==="bus"?20000:16000);spawnWorldCarExplosion({position:[tmp.x,tmp.y,record.kind==="bus"?1.2:.45],yaw:record.group.rotation.z,velocity:physicsPose?.velocity||[Math.cos(record.group.rotation.z)*record.speed,Math.sin(record.group.rotation.z)*record.speed,0],color:record.color,seed:record.id,id:record.id});rigidBodies()?.removeBody?.(record.id);record.physicsRegistered=false;record.physicsPose=null;}
  else record.deadUntil=now+9000;
  record.group.visible=false;
  if(network){sendDeath(record);window.dispatchEvent(new CustomEvent("arondight:world-kill",{detail:{id:record.id,kind:record.kind,position,network:true}}));}
  const v=viewport();if(v){v.dataset.worldLifeHits=String((Number(v.dataset.worldLifeHits)||0)+1);v.dataset.worldPopulationHits=String((Number(v.dataset.worldPopulationHits)||0)+1);v.dataset.worldLifeLastHit=record.kind;v.dataset.worldPopulationLastHit=record.kind;}return true;
}
function handleProceduralHit(hit){const record=nodeRecord(hit);if(!record)return false;if(!record.deadUntil)killRecord(record);return true;}
function ensureHitBridge(){const b=bridge();if(!b||hitBridge===b)return;const base=typeof b.registerWorldPopulationHit==="function"?b.registerWorldPopulationHit.bind(b):null;const dispatcher=hit=>handleProceduralHit(hit)||(base?Boolean(base(hit)):false);dispatcher.__proceduralPopulationProvider=true;dispatcher.__worldLivelinessWrapper=true;dispatcher.__gameplayPolishLiteWrapper=true;b.__proceduralPopulationHit=handleProceduralHit;b.registerWorldPopulationHit=dispatcher;hitBridge=b;}
function handleRemoteFx(event){const packet=event?.detail?.packet;if(packet?.type!==FX_TYPE)return;const record=byId.get(String(packet.objectId||""));if(record&&!record.deadUntil)killRecord(record,{network:false});}

function frame(now=performance.now()){requestAnimationFrame(frame);const dt=Math.min(.05,Math.max(0,(now-lastFrame)/1000||0));lastFrame=now;void dt;syncSatelliteMigration();if(!ensureScene())return;ensureHitBridge();const visible=worldVisible();root.visible=visible;decorRoot.visible=visible;lightRoot.visible=visible;if(!visible)return;if(!configureWorld())return;refreshAnchor();refreshRoutes(now);maintain(now);const epoch=Date.now()/1000;let alive=0,physicalVehicles=0,lowestVehicleZ=Infinity;for(const record of records){updateRecord(record,epoch,now);if(record.group.visible)alive++;if((record.kind==="car"||record.kind==="bus")&&record.physicsPose){physicalVehicles++;lowestVehicleZ=Math.min(lowestVehicleZ,record.group.position.z);}}const v=viewport();if(v){v.dataset.worldLifeVisible=String(alive);v.dataset.worldLifeTotal=String(records.length);v.dataset.worldProceduralPopulation="1";v.dataset.worldVehiclePhysics=rigidBodies()?.ready?"box3d-dynamic-force-controller-v1":"waiting-box3d";v.dataset.worldPhysicsVehicleVisuals=String(physicalVehicles);v.dataset.worldPhysicsVehicleLowestZ=Number.isFinite(lowestVehicleZ)?lowestVehicleZ.toFixed(3):"waiting";}}

export function installWorldProceduralPopulation(){if(installed)return;installed=true;globalThis.addEventListener(VS_FX_EVENT,handleRemoteFx);requestAnimationFrame(frame);}

installWorldProceduralPopulation();
