import * as THREE from "three";
import {VS_FX_EVENT} from "./lan_vs.mjs";
import {buildTrafficRoute,collectRenderedDrivableRoads} from "./world_traffic_routes.mjs";
import {spawnWorldPersonRagdoll} from "./world_person_ragdoll.mjs";
import {spawnWorldCarExplosion} from "./world_car_explosion.mjs";

const MOBILE_RE=/(?:android|iphone|ipad|ipod|macintosh.*mobile)/i;
const MOBILE=MOBILE_RE.test(globalThis.navigator?.userAgent||"");
const EXTRA_CARS=MOBILE?6:10;
const EXTRA_PEOPLE=MOBILE?10:16;
const BUS_COUNT=MOBILE?3:5;
const BIRD_COUNT=MOBILE?10:16;
const TREE_COUNT=MOBILE?16:28;
const LAMP_COUNT=MOBILE?12:20;
const ROUTE_REFRESH_MS=1800;
const ROUTE_STALE_MS=18000;
const ROUTE_DROP_MS=90000;
const MAX_ROUTE_POOL=48;
const IMAGERY_STORAGE="arondight45WorldImageryV1";
const IMAGERY_DEFAULT_OFF_MIGRATION="arondight45WorldImageryDefaultOffV3";
const AUDIO_SETTINGS_KEY="arondight45AudioSettingsV1";
const LIFE_FX_TYPE="world-life-death-v1";
const records=[],routes=[],routeCache=new Map(),lifeById=new Map(),particles=[];
const tmp=new THREE.Vector3(),tmp2=new THREE.Vector3(),matrix=new THREE.Matrix4(),quat=new THREE.Quaternion(),scale=new THREE.Vector3(1,1,1);
let installed=false,boundScene=null,lifeRoot=null,lightRoot=null,treeRoot=null,lampRoot=null,lastRouteRefresh=-Infinity,lastOriginKey="",lastFrame=performance.now(),audioCtx=null,audioUnlocked=false,lastChirp=0,wrappedHit=null,particlePoints=null,particleGeometry=null,particlePositions=null,particleColors=null,particleCursor=0,treeTrunks=null,treeCrowns=null,lampPoles=null,lampHeads=null,mapStyledFor=null,forcedDefaultOff=false;

function bridge(){return globalThis.__arondightRealWorld||null;}
function viewport(){return document.getElementById("viewport");}
function hashText(text){let h=2166136261;for(const c of String(text||"")){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}
function clamp(v,lo,hi){return Math.max(lo,Math.min(hi,Number(v)||0));}
function audioSettings(){try{const raw=localStorage.getItem(AUDIO_SETTINGS_KEY),v=raw?JSON.parse(raw):{};return{enabled:v.soundEnabled!==false,volume:clamp(v.fxVolume??100,0,100)/100};}catch{return{enabled:true,volume:1};}}
function unlockAudio(){audioUnlocked=true;const Ctx=globalThis.AudioContext||globalThis.webkitAudioContext;if(!Ctx)return;try{audioCtx??=new Ctx({latencyHint:"interactive"});if(audioCtx.state==="suspended")audioCtx.resume().catch(()=>{});}catch{}}
function beep({f=880,f2=440,d=.14,g=.03,type="sine"}={}){const s=audioSettings();if(!audioUnlocked||!s.enabled||s.volume<=0||!audioCtx||audioCtx.state!=="running")return;try{const t=audioCtx.currentTime,o=audioCtx.createOscillator(),gain=audioCtx.createGain();o.type=type;o.frequency.setValueAtTime(f,t);o.frequency.exponentialRampToValueAtTime(Math.max(20,f2),t+d);gain.gain.setValueAtTime(g*s.volume,t);gain.gain.exponentialRampToValueAtTime(.0001,t+d);o.connect(gain).connect(audioCtx.destination);o.start(t);o.stop(t+d+.02);}catch{}}
function playExplosion(){beep({f:96,f2:28,d:.48,g:.10,type:"sawtooth"});}
function playPersonHit(){beep({f:190,f2:78,d:.30,g:.04,type:"sawtooth"});}
function playBirdHit(){beep({f:1450,f2:430,d:.18,g:.03,type:"triangle"});}
function playAmbientBird(now){if(now-lastChirp<8000+Math.random()*7000)return;lastChirp=now;beep({f:1250+Math.random()*450,f2:1900+Math.random()*500,d:.10,g:.009,type:"sine"});setTimeout(()=>beep({f:1600+Math.random()*350,f2:1050,d:.08,g:.006,type:"sine"}),90);}

function forceSatelliteDefaultOff(){
  try{
    if(localStorage.getItem(IMAGERY_DEFAULT_OFF_MIGRATION)==="1")return false;
    localStorage.setItem(IMAGERY_STORAGE,"0");
    localStorage.setItem(IMAGERY_DEFAULT_OFF_MIGRATION,"1");
    forcedDefaultOff=true;
    return true;
  }catch{return false;}
}
forceSatelliteDefaultOff();

function populationKind(record){return record.kind==="car"?"life-car":record.kind==="person"?"life-person":record.kind;}
function tag(mesh,record){mesh.userData.worldPopulationKind=populationKind(record);mesh.userData.worldPopulationId=record.id;mesh.userData.worldLifeId=record.id;mesh.userData.worldLifeKind=record.kind;mesh.userData.worldPopulationClone=false;mesh.castShadow=false;mesh.receiveShadow=false;}
function colorMaterial(color,{roughness=.68,metalness=.05,emissive=0x000000,emissiveIntensity=0}={}){return new THREE.MeshStandardMaterial({color,roughness,metalness,emissive,emissiveIntensity});}
function zUpCylinder(rTop,rBottom,height,segments=8){const g=new THREE.CylinderGeometry(rTop,rBottom,height,segments);g.rotateX(Math.PI/2);return g;}

const shared={};
function ensureShared(){
  if(shared.carBodyGeo)return;
  shared.carBodyGeo=new THREE.BoxGeometry(3.55,1.62,.55);
  shared.carCabinGeo=new THREE.BoxGeometry(1.75,1.44,.55);
  shared.busBodyGeo=new THREE.BoxGeometry(8.0,2.34,2.20);
  shared.busWindowGeo=new THREE.BoxGeometry(5.9,2.37,.66);
  shared.wheelGeo=new THREE.CylinderGeometry(.30,.30,.18,8);
  shared.busWheelGeo=new THREE.CylinderGeometry(.40,.40,.22,10);
  shared.personTorsoGeo=zUpCylinder(.20,.29,.70,7);
  shared.personLegGeo=new THREE.BoxGeometry(.14,.15,.62);
  shared.personArmGeo=new THREE.BoxGeometry(.12,.12,.58);
  shared.headGeo=new THREE.SphereGeometry(.19,8,6);
  shared.birdGeo=new THREE.BufferGeometry();
  shared.birdGeo.setAttribute("position",new THREE.BufferAttribute(new Float32Array([
    -.08,.38,.00, -.78,-.12,.02, -.08,.02,.02,
     .08,.38,.00,  .08,.02,.02,  .78,-.12,.02,
    -.08,.38,.00,  .08,.38,.00,  .00,-.46,.04,
    -.05,.30,.06,  .00,-.42,.08,  .05,.30,.06
  ]),3));
  shared.birdGeo.computeVertexNormals();
  shared.carMats=[0xc7473a,0x3079b7,0xc59b36,0xd7d9d8,0x3d4348,0x4d8b62,0x71588f].map(c=>colorMaterial(c,{roughness:.42,metalness:.20}));
  shared.busMats=[0x236da8,0xb84b40,0xc49a38,0x3f7d5c].map(c=>colorMaterial(c,{roughness:.48,metalness:.12}));
  shared.windowMat=colorMaterial(0x263b46,{roughness:.26,metalness:.10,emissive:0x071015,emissiveIntensity:.10});
  shared.wheelMat=colorMaterial(0x202327,{roughness:.88,metalness:.02});
  shared.shirtMats=[0x397da1,0xa9574a,0x5c8f62,0xb38f43,0x75659b,0xad7040,0x3f8b86].map(c=>colorMaterial(c,{roughness:.82}));
  shared.pantsMats=[0x26313a,0x3a4146,0x403b36,0x263a50].map(c=>colorMaterial(c,{roughness:.9}));
  shared.skinMats=[0xe2b391,0xc5906d,0xa76f50,0x75452f,0xd1a07e].map(c=>colorMaterial(c,{roughness:.88}));
  shared.birdMats=[0x2f3942,0x56626a,0x806e53,0xc3c6c4,0x415666].map(c=>new THREE.MeshStandardMaterial({color:c,roughness:.85,side:THREE.DoubleSide}));
}

function makeCar(index){
  ensureShared();
  const seed=hashText(`life-car:${index}`),id=`life-car-${index}`,group=new THREE.Group(),mat=shared.carMats[seed%shared.carMats.length],body=new THREE.Mesh(shared.carBodyGeo,mat),cabin=new THREE.Mesh(shared.carCabinGeo,shared.windowMat);
  const record={id,kind:"car",index,group,seed,speed:8+(seed%55)/10,phase:(seed%10000)/10000,laneSign:seed&1?1:-1,side:0,deadUntil:0,dyingUntil:0,color:mat.color.getHex()};
  body.position.z=.48;cabin.position.set(-.10,0,.93);tag(body,record);tag(cabin,record);group.add(body,cabin);
  for(const x of[-1.18,1.18])for(const y of[-.86,.86]){const wheel=new THREE.Mesh(shared.wheelGeo,shared.wheelMat);wheel.position.set(x,y,.28);tag(wheel,record);group.add(wheel);}
  group.userData.worldLifeId=id;group.userData.worldLifeKind="car";group.userData.worldPopulationKind=populationKind(record);return record;
}
function makeBus(index){
  ensureShared();
  const seed=hashText(`life-bus:${index}`),id=`life-bus-${index}`,group=new THREE.Group(),mat=shared.busMats[seed%shared.busMats.length],body=new THREE.Mesh(shared.busBodyGeo,mat),windows=new THREE.Mesh(shared.busWindowGeo,shared.windowMat);
  const record={id,kind:"bus",index,group,seed,speed:5.2+(seed%28)/10,phase:(seed%9000)/9000,laneSign:seed&1?1:-1,side:0,deadUntil:0,dyingUntil:0,color:mat.color.getHex()};
  body.position.z=1.20;windows.position.set(.05,0,1.68);tag(body,record);tag(windows,record);group.add(body,windows);
  for(const x of[-2.55,2.55])for(const y of[-1.22,1.22]){const wheel=new THREE.Mesh(shared.busWheelGeo,shared.wheelMat);wheel.position.set(x,y,.42);tag(wheel,record);group.add(wheel);}
  group.userData.worldLifeId=id;group.userData.worldLifeKind="bus";group.userData.worldPopulationKind=populationKind(record);return record;
}
function makePerson(index){
  ensureShared();
  const seed=hashText(`life-person:${index}`),id=`life-person-${index}`,group=new THREE.Group(),shirt=shared.shirtMats[seed%shared.shirtMats.length],pants=shared.pantsMats[(seed>>>2)%shared.pantsMats.length],skin=shared.skinMats[(seed>>>4)%shared.skinMats.length],torso=new THREE.Mesh(shared.personTorsoGeo,shirt),head=new THREE.Mesh(shared.headGeo,skin);
  const record={id,kind:"person",index,group,seed,speed:1.0+(seed%65)/100,phase:(seed%8000)/8000,laneSign:1,side:(seed&1?1:-1)*(2.8+(seed%15)/20),deadUntil:0,dyingUntil:0,color:shirt.color.getHex()};
  torso.position.z=1.05;head.position.z=1.58;tag(torso,record);tag(head,record);group.add(torso,head);
  for(const y of[-.11,.11]){const leg=new THREE.Mesh(shared.personLegGeo,pants);leg.position.set(0,y,.48);tag(leg,record);group.add(leg);}
  for(const y of[-.31,.31]){const arm=new THREE.Mesh(shared.personArmGeo,shirt);arm.position.set(0,y,1.07);arm.rotation.x=y<0?.12:-.12;tag(arm,record);group.add(arm);}
  group.userData.worldLifeId=id;group.userData.worldLifeKind="person";group.userData.worldPopulationKind=populationKind(record);return record;
}
function makeBird(index){ensureShared();const seed=hashText(`life-bird:${index}`),id=`life-bird-${index}`,group=new THREE.Group(),mesh=new THREE.Mesh(shared.birdGeo,shared.birdMats[seed%shared.birdMats.length]);const record={id,kind:"bird",index,group,seed,speed:0,phase:(seed%10000)/10000,laneSign:1,side:0,deadUntil:0,dyingUntil:0,color:mesh.material.color.getHex(),deathV:new THREE.Vector3(),deathSpin:0};mesh.scale.setScalar(.48+(seed%14)/100);tag(mesh,record);group.add(mesh);group.userData.worldLifeId=id;group.userData.worldLifeKind="bird";group.userData.worldPopulationKind=populationKind(record);return record;}

function createParticles(scene){const count=MOBILE?56:80;particlePositions=new Float32Array(count*3);particleColors=new Float32Array(count*3);particleGeometry=new THREE.BufferGeometry();particleGeometry.setAttribute("position",new THREE.BufferAttribute(particlePositions,3));particleGeometry.setAttribute("color",new THREE.BufferAttribute(particleColors,3));particleGeometry.setDrawRange(0,count);const mat=new THREE.PointsMaterial({size:.075,vertexColors:true,transparent:true,opacity:.88,depthWrite:false,sizeAttenuation:true});particlePoints=new THREE.Points(particleGeometry,mat);particlePoints.userData.flightFireIgnore=true;particlePoints.frustumCulled=false;particlePoints.renderOrder=20;scene.add(particlePoints);for(let i=0;i<count;i++){particlePositions[i*3+2]=-999;particles.push({active:false,v:new THREE.Vector3(),expires:0});}}
function spawnParticles(position,kind){if(!particlePoints||!position)return;const now=performance.now(),n=kind==="bird"?10:kind==="person"?7:9;for(let i=0;i<n;i++){const idx=particleCursor++%particles.length,p=particles[idx],a=Math.random()*Math.PI*2,s=.45+Math.random()*(kind==="bird"?1.6:1.1);p.active=true;p.expires=now+500+Math.random()*450;p.v.set(Math.cos(a)*s,Math.sin(a)*s,.35+Math.random()*1.2);particlePositions[idx*3]=position.x;particlePositions[idx*3+1]=position.y;particlePositions[idx*3+2]=position.z;if(kind==="person"){particleColors[idx*3]=.58+Math.random()*.20;particleColors[idx*3+1]=.01;particleColors[idx*3+2]=.01;}else if(kind==="bird"){const c=.58+Math.random()*.30;particleColors[idx*3]=c;particleColors[idx*3+1]=c*.92;particleColors[idx*3+2]=c*.80;}else{particleColors[idx*3]=1;particleColors[idx*3+1]=.42+Math.random()*.30;particleColors[idx*3+2]=.06;}}particleGeometry.attributes.position.needsUpdate=true;particleGeometry.attributes.color.needsUpdate=true;}
function updateParticles(now,dt){if(!particlePoints)return;let active=false;for(let i=0;i<particles.length;i++){const p=particles[i];if(!p.active)continue;if(now>=p.expires){p.active=false;particlePositions[i*3+2]=-999;continue;}active=true;p.v.z-=3.2*dt;particlePositions[i*3]+=p.v.x*dt;particlePositions[i*3+1]+=p.v.y*dt;particlePositions[i*3+2]=Math.max(.02,particlePositions[i*3+2]+p.v.z*dt);}particlePoints.visible=active;if(active)particleGeometry.attributes.position.needsUpdate=true;}

function createDecor(scene){
  const trunkGeo=zUpCylinder(.10,.15,2.3,7),crownGeo=new THREE.DodecahedronGeometry(.92,0),poleGeo=zUpCylinder(.035,.055,3.7,6),headGeo=new THREE.SphereGeometry(.11,7,5);
  treeTrunks=new THREE.InstancedMesh(trunkGeo,colorMaterial(0x6a523d,{roughness:.95}),TREE_COUNT);treeCrowns=new THREE.InstancedMesh(crownGeo,colorMaterial(0x4f8658,{roughness:.92}),TREE_COUNT);lampPoles=new THREE.InstancedMesh(poleGeo,colorMaterial(0x4b5358,{roughness:.55,metalness:.35}),LAMP_COUNT);lampHeads=new THREE.InstancedMesh(headGeo,colorMaterial(0xe4d3a3,{roughness:.38,emissive:0x8f6f35,emissiveIntensity:.15}),LAMP_COUNT);
  treeRoot=new THREE.Group();treeRoot.name="WORLD_LIVELINESS_TREES";treeRoot.add(treeTrunks,treeCrowns);lampRoot=new THREE.Group();lampRoot.name="WORLD_LIVELINESS_LAMPS";lampRoot.add(lampPoles,lampHeads);for(const x of[treeTrunks,treeCrowns,lampPoles,lampHeads]){x.frustumCulled=true;x.userData.flightFireIgnore=true;}scene.add(treeRoot,lampRoot);
}
function createLights(scene){lightRoot=new THREE.Group();lightRoot.name="WORLD_LIVELINESS_LIGHTS";const hemi=new THREE.HemisphereLight(0xd8e7ef,0x5e5446,.26),sun=new THREE.DirectionalLight(0xffe6c5,.34);sun.position.set(-70,-40,110);lightRoot.add(hemi,sun);scene.add(lightRoot);}
function ensureScene(){const scene=bridge()?.threeScene;if(!scene)return false;if(scene===boundScene&&lifeRoot)return true;boundScene=scene;records.splice(0);lifeById.clear();routes.splice(0);routeCache.clear();lastOriginKey="";lastRouteRefresh=-Infinity;particles.splice(0);lifeRoot=new THREE.Group();lifeRoot.name="WORLD_LIVELINESS";scene.add(lifeRoot);createParticles(scene);createDecor(scene);createLights(scene);for(let i=0;i<EXTRA_CARS;i++)records.push(makeCar(i));for(let i=0;i<EXTRA_PEOPLE;i++)records.push(makePerson(i));for(let i=0;i<BUS_COUNT;i++)records.push(makeBus(i));for(let i=0;i<BIRD_COUNT;i++)records.push(makeBird(i));for(const r of records){lifeById.set(r.id,r);lifeRoot.add(r.group);r.group.visible=false;}const v=viewport();if(v){v.dataset.worldLifeExtraCars=String(EXTRA_CARS);v.dataset.worldLifeExtraPeople=String(EXTRA_PEOPLE);v.dataset.worldLifeBuses=String(BUS_COUNT);v.dataset.worldLifeBirds=String(BIRD_COUNT);v.dataset.worldLifeShootable="1";v.dataset.worldLifeArchitecture="route-anchored-v1";v.dataset.worldLifeVisualContract="z-up-scaled-v2";}return true;}

function fallbackRoads(b){const out=[];for(const feature of b?.minimapFeatures||[]){if(feature?.kind!=="road")continue;for(const path of feature.paths||[])if(path?.length>=2)out.push({path,roadClass:String(feature.roadClass||"road")});}return out;}
function refreshRoutes(now){
  const b=bridge();if(!b?.active||!Number.isFinite(b.originLon)||!Number.isFinite(b.originLat))return;
  const key=`${b.originLon.toFixed(6)}:${b.originLat.toFixed(6)}`;
  if(now-lastRouteRefresh<ROUTE_REFRESH_MS&&key===lastOriginKey)return;
  lastRouteRefresh=now;
  if(key!==lastOriginKey&&routeCache.size){for(const [routeKey,old] of routeCache){const rebuilt=buildTrafficRoute(old.geoPath,{originLon:b.originLon,originLat:b.originLat,roadClass:old.roadClass,lastSeen:old.lastSeen});if(rebuilt)routeCache.set(routeKey,rebuilt);else routeCache.delete(routeKey);}}
  lastOriginKey=key;
  let candidates=[];try{candidates=collectRenderedDrivableRoads(b.map);}catch{}
  if(!candidates.length)candidates=fallbackRoads(b);
  const seen=new Set();for(const c of candidates){const r=buildTrafficRoute(c.path,{originLon:b.originLon,originLat:b.originLat,roadClass:c.roadClass,lastSeen:now});if(!r||seen.has(r.key))continue;seen.add(r.key);routeCache.set(r.key,r);}
  for(const [routeKey,route] of routeCache)if(now-route.lastSeen>ROUTE_DROP_MS)routeCache.delete(routeKey);
  const fresh=[...routeCache.values()].filter(route=>now-route.lastSeen<=ROUTE_STALE_MS),pool=(fresh.length?fresh:[...routeCache.values()]).sort((a,c)=>a.key.localeCompare(c.key)).slice(0,MAX_ROUTE_POOL);
  if(pool.length){routes.splice(0,routes.length,...pool);positionDecor();}
  const v=viewport();if(v){v.dataset.worldLifeRoutes=String(routes.length);v.dataset.worldLifeCachedRoutes=String(routeCache.size);v.dataset.worldLifeRouteGapHeld=seen.size?"0":routes.length?"1":"0";v.dataset.worldLifeAlive="1";}
}
function sampleRoute(route,distance,offset=0){if(!route?.segments?.length)return null;const period=route.length*2,cycle=((distance%period)+period)%period,reverse=cycle>route.length,d=reverse?period-cycle:cycle;let seg=route.segments.at(-1);for(const s of route.segments){if(d<=s.start+s.d){seg=s;break;}}const t=clamp((d-seg.start)/seg.d,0,1),x=seg.a[0]+seg.dx*t,y=seg.a[1]+seg.dy*t,nx=-seg.dy/seg.d,ny=seg.dx/seg.d;return{x:x+nx*offset,y:y+ny*offset,yaw:Math.atan2(seg.dy,seg.dx)+(reverse?Math.PI:0)};}
function routeFor(record){if(!routes.length)return null;return routes[(record.index*7+(record.kind==="person"?3:record.kind==="bus"?5:1))%routes.length];}
function carLane(route,record){const cls=String(route?.roadClass||""),m=/motorway|trunk|primary|secondary/.test(cls)?1.2:/service|living/.test(cls)?.62:.84;return(record.laneSign||1)*m;}
function setInstance(mesh,i,pos,z,sx=1,sy=sx,sz=sx){matrix.compose(tmp.set(pos.x,pos.y,z),quat.identity(),scale.set(sx,sy,sz));mesh.setMatrixAt(i,matrix);}
function positionDecor(){if(!routes.length||!treeTrunks)return;for(let i=0;i<TREE_COUNT;i++){const r=routes[(i*5+2)%routes.length],p=sampleRoute(r,(i*31.7)%Math.max(1,r.length),(i&1?1:-1)*(5.4+(i%4)*.85));if(!p)continue;const s=.82+(i%5)*.045;setInstance(treeTrunks,i,p,1.15,s,s,s);setInstance(treeCrowns,i,p,2.75,s*1.05,s*1.05,s*1.28);}treeTrunks.instanceMatrix.needsUpdate=true;treeCrowns.instanceMatrix.needsUpdate=true;for(let i=0;i<LAMP_COUNT;i++){const r=routes[(i*3+1)%routes.length],p=sampleRoute(r,(i*26.2)%Math.max(1,r.length),(i&1?1:-1)*4.2);if(!p)continue;setInstance(lampPoles,i,p,1.85,1,1,1);setInstance(lampHeads,i,p,3.72,1,1,1);}lampPoles.instanceMatrix.needsUpdate=true;lampHeads.instanceMatrix.needsUpdate=true;}

function updateRecord(record,epochSec,now,dt){
  if(record.kind==="bird"){
    if(record.dyingUntil>now){record.group.visible=true;record.deathV.z-=5.4*dt;record.group.position.addScaledVector(record.deathV,dt);record.group.rotation.x+=record.deathSpin*dt;record.group.rotation.y+=record.deathSpin*.7*dt;return;}
    if(Date.now()<record.deadUntil){record.group.visible=false;return;}
    const a=epochSec*(.22+(record.seed%22)/1000)+record.phase*Math.PI*2,r=18+(record.seed%34),cx=((record.seed>>>7)%25)-12,cy=((record.seed>>>13)%25)-12,z=8+(record.seed%13)+Math.sin(a*2.3+record.index)*2.1;record.group.position.set(cx+Math.cos(a)*r,cy+Math.sin(a*.94)*r,z);record.group.rotation.set(.08*Math.sin(a*3),0,a+Math.PI/2);const flap=.82+.20*Math.sin(epochSec*10+record.index);record.group.scale.set(1,flap,1);record.group.visible=true;return;
  }
  if(Date.now()<record.deadUntil){record.group.visible=false;return;}
  const route=routeFor(record);if(!route){record.group.visible=false;return;}const speed=record.speed,offset=record.kind==="person"?record.side:carLane(route,record),p=sampleRoute(route,record.phase*route.length*2+epochSec*speed,offset);if(!p){record.group.visible=false;return;}record.group.position.set(p.x,p.y,record.kind==="person"?.01*Math.sin(epochSec*6+record.index):0);record.group.rotation.set(0,0,p.yaw);record.group.visible=true;
}

function styleMap(){const b=bridge(),map=b?.map;if(!b?.active||!map?.getStyle||!map?.setPaintProperty)return;if(mapStyledFor===map&&map.__worldLivelinessPaletteApplied)return;let changed=0;for(const layer of map.getStyle()?.layers||[]){if(!layer?.id||!map.getLayer?.(layer.id))continue;const id=String(layer.id).toLowerCase(),source=String(layer["source-layer"]||"").toLowerCase();try{if(layer.type==="fill-extrusion"&&(source==="building"||id.includes("building"))){map.setPaintProperty(layer.id,"fill-extrusion-color",["interpolate",["linear"],["coalesce",["get","render_height"],["get","height"],8],0,"#d8d2c8",18,"#cbc4ba",55,"#b9b7b2",140,"#a7adb1"]);map.setPaintProperty(layer.id,"fill-extrusion-opacity",.98);map.setPaintProperty(layer.id,"fill-extrusion-vertical-gradient",true);changed++;}else if(layer.type==="fill"&&(id.includes("water")||source.includes("water"))){map.setPaintProperty(layer.id,"fill-color","#78a9c3");changed++;}else if(layer.type==="fill"&&/(park|grass|wood|forest)/.test(`${id} ${source}`)){map.setPaintProperty(layer.id,"fill-color",id.includes("park")?"#8fb78c":"#95ad86");changed++;}}catch{}}map.__worldLivelinessPaletteApplied=true;mapStyledFor=map;const v=viewport();if(v){v.dataset.worldVisualPalette="natural-v2";v.dataset.worldVisualPaletteLayers=String(changed);}}

function nodeRecord(hit){for(let n=hit?.object;n;n=n.parent){const id=String(n.userData?.worldLifeId||"");if(id&&lifeById.has(id))return lifeById.get(id);}return null;}
function sendDeath(record){const s=bridge()?.vsSession;try{s?.sendFx?.({type:LIFE_FX_TYPE,id:`${record.id}-${Date.now().toString(36)}`,objectId:record.id,kind:record.kind,p:[record.group.position.x,record.group.position.y,record.group.position.z],yaw:record.group.rotation.z});}catch{}}
function killRecord(record,{network=true}={}){if(!record||Date.now()<record.deadUntil)return false;record.group.getWorldPosition(tmp);const now=performance.now();if(record.kind==="person"){record.deadUntil=Date.now()+10000;record.group.visible=false;spawnParticles(tmp,"person");spawnWorldPersonRagdoll({position:[tmp.x,tmp.y,Math.max(.8,tmp.z+.7)],yaw:record.group.rotation.z,impulse:[(Math.random()-.5)*3,(Math.random()-.5)*3,2.6],seed:record.id,id:record.id});playPersonHit();}else if(record.kind==="car"||record.kind==="bus"){record.deadUntil=Date.now()+(record.kind==="bus"?20000:16000);record.group.visible=false;spawnParticles(tmp,"fire");spawnWorldCarExplosion({position:[tmp.x,tmp.y,record.kind==="bus"?1.2:.45],yaw:record.group.rotation.z,velocity:[Math.cos(record.group.rotation.z)*record.speed,Math.sin(record.group.rotation.z)*record.speed,0],color:record.color,seed:record.id,id:record.id});if(record.kind==="bus"){tmp2.copy(tmp).add(new THREE.Vector3(Math.cos(record.group.rotation.z)*2.1,Math.sin(record.group.rotation.z)*2.1,.4));spawnParticles(tmp2,"fire");}playExplosion();}else if(record.kind==="bird"){record.deadUntil=Date.now()+9000;record.dyingUntil=now+1100;record.deathV.set((Math.random()-.5)*2.2,(Math.random()-.5)*2.2,-.4);record.deathSpin=4+Math.random()*4;spawnParticles(tmp,"bird");playBirdHit();}if(network)sendDeath(record);const v=viewport();if(v){v.dataset.worldLifeHits=String((Number(v.dataset.worldLifeHits)||0)+1);v.dataset.worldLifeLastHit=record.kind;}return true;}
function wrapPopulationHits(){const b=bridge(),base=b?.registerWorldPopulationHit;if(typeof base!=="function"||base===wrappedHit||base.__worldLivelinessWrapper)return;const wrapper=hit=>{const record=nodeRecord(hit);if(record)return killRecord(record);return Boolean(base(hit));};wrapper.__worldLivelinessWrapper=true;wrapper.__gameplayPolishLiteWrapper=true;wrappedHit=wrapper;b.registerWorldPopulationHit=wrapper;const v=viewport();if(v)v.dataset.worldLifeHitBridge="1";}
function handleRemoteFx(event){const p=event?.detail?.packet;if(p?.type!==LIFE_FX_TYPE)return;const r=lifeById.get(String(p.objectId||""));if(r)killRecord(r,{network:false});}

function patchSettingsUi(){for(const dialog of document.querySelectorAll(".phone-settings-dialog")){const imagery=dialog.querySelector("[data-world-imagery]");if(imagery&&!imagery.dataset.defaultOffPatched){imagery.dataset.defaultOffPatched="1";imagery.checked=bridge()?.imageryEnabled===true;const notes=[...dialog.querySelectorAll(".phone-settings-note")],note=notes.find(n=>n.textContent.includes("REAL AERIAL / SATELLITE MAP is ON by default"));if(note)note.textContent=note.textContent.replace("REAL AERIAL / SATELLITE MAP is ON by default","REAL AERIAL / SATELLITE MAP is OFF by default");const reset=dialog.querySelector("[data-reset]");reset?.addEventListener("click",()=>queueMicrotask(()=>{bridge()?.setImageryEnabled?.(false);imagery.checked=false;}),{capture:true});}}}
function syncDefaultOff(){const b=bridge();if(!b)return;if(forcedDefaultOff&&b.imageryEnabled!==false){b.setImageryEnabled?.(false);forcedDefaultOff=false;}const v=viewport();if(v){v.dataset.worldSatelliteDefault="off";v.dataset.worldImageryDefault="0";}}

function loop(now=performance.now()){const dt=Math.min(.05,Math.max(0,(now-lastFrame)/1000||0));lastFrame=now;const b=bridge();syncDefaultOff();patchSettingsUi();wrapPopulationHits();if(ensureScene()){const active=Boolean(b?.active);lifeRoot.visible=active;lightRoot.visible=active;treeRoot.visible=active;lampRoot.visible=active;if(active){refreshRoutes(now);styleMap();const t=Date.now()/1000;for(const r of records)updateRecord(r,t,now,dt);updateParticles(now,dt);playAmbientBird(now);const v=viewport();if(v){v.dataset.worldLifeVisible=String(records.filter(r=>r.group.visible).length);v.dataset.worldLifeTotal=String(records.length);v.dataset.worldLifeTotalApproxCars=String((MOBILE?8:14)+EXTRA_CARS);v.dataset.worldLifeTotalApproxPeople=String((MOBILE?8:14)+EXTRA_PEOPLE);}}else{particlePoints.visible=false;}}requestAnimationFrame(loop);}

export function installWorldLiveliness(){if(installed)return;installed=true;addEventListener("pointerdown",unlockAudio,{capture:true,passive:true});addEventListener("keydown",unlockAudio,{capture:true});addEventListener(VS_FX_EVENT,handleRemoteFx);new MutationObserver(patchSettingsUi).observe(document.documentElement,{subtree:true,childList:true});requestAnimationFrame(loop);}

installWorldLiveliness();