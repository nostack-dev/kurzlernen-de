import * as THREE from "three";
import {VS_FX_EVENT} from "./lan_vs.mjs";
import {spawnWorldPersonRagdoll} from "./world_person_ragdoll.mjs";
import {hashRoadText,mergeRoadRouteRegistry,sampleRoadRoute} from "./world_road_routes.mjs";
import {enforceOpaqueBuildingLayers} from "./world_building_visual_guard.mjs";

const MOBILE_RE=/(?:android|iphone|ipad|ipod|macintosh.*mobile)/i;
const ROUTE_REFRESH_MS=2200;
const ROUTE_GRACE_MS=30000;
const BUILDING_VISUAL_REFRESH_MS=3000;
const CAR_RESPAWN_MS=16000;
const PERSON_RESPAWN_MS=10000;
const MOBILE=MOBILE_RE.test(globalThis.navigator?.userAgent||"");
const CAR_COUNT=MOBILE?8:14;
const PERSON_COUNT=MOBILE?8:14;
const CAR_LANE_OFFSET_M=.82;
const PERSON_SIDE_OFFSET_M=2.35;
const cars=[],people=[],routes=[],routeRegistry=new Map();
const pendingDead=new Map(),explosions=[];
let installed=false,lastRouteRefresh=-Infinity,lastBuildingVisualRefresh=-Infinity,lastOriginKey="",raf=0,explosionGeometry=null,personCylinderGeometry=null,personHeadGeometry=null;
const temp=new THREE.Vector3(),cameraPos=new THREE.Vector3(),impactDir=new THREE.Vector3(),segDir=new THREE.Vector3(),segMid=new THREE.Vector3(),unitY=new THREE.Vector3(0,1,0);

const PERSON_REST={
  pelvis:[0,0,.78],chest:[0,0,1.18],head:[0,0,1.58],
  lShoulder:[-.27,0,1.27],rShoulder:[.27,0,1.27],lElbow:[-.49,0,1.05],rElbow:[.49,0,1.05],lHand:[-.61,.02,.80],rHand:[.61,.02,.80],
  lHip:[-.15,0,.78],rHip:[.15,0,.78],lKnee:[-.15,.015,.40],rKnee:[.15,.015,.40],lFoot:[-.15,.13,.08],rFoot:[.15,.13,.08]
};
const PERSON_SEGMENTS=[
  ["pelvis","chest",.19,"shirt"],["lShoulder","rShoulder",.12,"shirt"],["lHip","rHip",.11,"pants"],
  ["lShoulder","lElbow",.085,"shirt"],["lElbow","lHand",.065,"skin"],["rShoulder","rElbow",.085,"shirt"],["rElbow","rHand",.065,"skin"],
  ["lHip","lKnee",.105,"pants"],["lKnee","lFoot",.082,"pants"],["rHip","rKnee",.105,"pants"],["rKnee","rFoot",.082,"pants"]
];

function bridge(){return globalThis.__arondightRealWorld||null;}
function viewport(){return document.getElementById("viewport");}
function session(){return bridge()?.vsSession||null;}
function hashText(text){return hashRoadText(text);}
function colorHex(material){return material?.color?.getHex?.()??0xffffff;}

function placeSegment(mesh,a,b,radius){
  const pa=PERSON_REST[a],pb=PERSON_REST[b];segDir.set(pb[0]-pa[0],pb[1]-pa[1],pb[2]-pa[2]);const length=segDir.length();segMid.set((pa[0]+pb[0])*.5,(pa[1]+pb[1])*.5,(pa[2]+pb[2])*.5);mesh.position.copy(segMid);mesh.quaternion.setFromUnitVectors(unitY,segDir.multiplyScalar(1/Math.max(.001,length)));mesh.scale.set(radius,length,radius);
}

function refreshRoutes(now){
  const b=bridge();if(!b?.active||!Number.isFinite(b.originLon)||!Number.isFinite(b.originLat))return;
  const originKey=`${b.originLon.toFixed(6)}:${b.originLat.toFixed(6)}`;
  if(originKey===lastOriginKey&&now-lastRouteRefresh<ROUTE_REFRESH_MS)return;
  lastRouteRefresh=now;lastOriginKey=originKey;
  const paths=[];for(const feature of Array.isArray(b.minimapFeatures)?b.minimapFeatures:[]){if(feature?.kind!=="road")continue;for(const path of feature.paths||[])paths.push(path);}
  const merged=mergeRoadRouteRegistry(routeRegistry,paths,b.originLon,b.originLat,now,{graceMs:ROUTE_GRACE_MS,maxRoutes:48});routes.splice(0,routes.length,...merged);
  const view=viewport();if(view){view.dataset.worldTrafficRoutes=String(routes.length);view.dataset.worldTrafficStableRoutes=String(routeRegistry.size);view.dataset.worldCars=String(CAR_COUNT);view.dataset.worldPeople=String(PERSON_COUNT);}
}

function refreshBuildingVisuals(now){if(now-lastBuildingVisualRefresh<BUILDING_VISUAL_REFRESH_MS)return;lastBuildingVisualRefresh=now;const count=enforceOpaqueBuildingLayers(bridge()?.map);const view=viewport();if(view)view.dataset.worldOpaqueBuildingLayers=String(count);}

function makeCar(index){
  const group=new THREE.Group(),seed=hashText(`car:${index}`),color=[0xd53d32,0x2f82d7,0xd9b53b,0xe7e7e7,0x24282d,0x45a85a][seed%6],bodyMat=new THREE.MeshStandardMaterial({color,roughness:.38,metalness:.35}),glassMat=new THREE.MeshStandardMaterial({color:0x18364f,roughness:.18,metalness:.2});
  const body=new THREE.Mesh(new THREE.BoxGeometry(3.8,1.75,.72),bodyMat);body.position.z=.48;const roof=new THREE.Mesh(new THREE.BoxGeometry(2.0,1.52,.58),glassMat);roof.position.set(-.15,0,1.03);
  for(const mesh of[body,roof]){mesh.castShadow=true;mesh.userData.worldPopulationKind="car";}group.add(body,roof);group.userData.worldPopulationKind="car";group.visible=false;bridge()?.threeScene?.add(group);
  return{id:"",kind:"car",index,group,routeKey:"",speed:7+(seed%70)/10,phase:(seed%10000)/100,lane:(seed&1?1:-1)*CAR_LANE_OFFSET_M,deadUntil:0,deadAt:0};
}

function makePerson(index){
  personCylinderGeometry??=new THREE.CylinderGeometry(1,1,1,8,1,false);personHeadGeometry??=new THREE.SphereGeometry(.18,9,7);
  const group=new THREE.Group(),seed=hashText(`person:${index}`),shirtHex=[0x32a4d8,0xd85a42,0x5cbb57,0xd4b640,0x835dcc][seed%5],skinHex=0xd6a27e,pantsHex=[0x263647,0x3a3130,0x20323b,0x343a45][(seed>>>3)%4],materials={shirt:new THREE.MeshStandardMaterial({color:shirtHex,roughness:.72}),skin:new THREE.MeshStandardMaterial({color:skinHex,roughness:.82}),pants:new THREE.MeshStandardMaterial({color:pantsHex,roughness:.78})};
  for(const [a,b,radius,kind] of PERSON_SEGMENTS){const mesh=new THREE.Mesh(personCylinderGeometry,materials[kind]);placeSegment(mesh,a,b,radius);mesh.userData.worldPopulationKind="person";mesh.userData.worldPopulationBodyPart=kind;group.add(mesh);}
  const head=new THREE.Mesh(personHeadGeometry,materials.skin);head.position.set(...PERSON_REST.head);head.userData.worldPopulationKind="person";head.userData.worldPopulationBodyPart="head";group.add(head);
  group.userData.worldPopulationKind="person";group.userData.worldPedestrianArticulated=true;group.visible=false;bridge()?.threeScene?.add(group);
  return{id:"",kind:"person",index,group,materials,shirtHex,skinHex,pantsHex,routeKey:"",speed:1.1+(seed%55)/100,phase:(seed%8000)/100,side:(seed&1?1:-1)*PERSON_SIDE_OFFSET_M,deadUntil:0,deadAt:0};
}

function ensurePools(){
  const scene=bridge()?.threeScene;if(!scene)return;
  while(cars.length<CAR_COUNT)cars.push(makeCar(cars.length));while(people.length<PERSON_COUNT)people.push(makePerson(people.length));
  if(!explosionGeometry){explosionGeometry=new THREE.SphereGeometry(.16,7,5);for(let i=0;i<16;i++){const material=new THREE.MeshBasicMaterial({color:i%2?0xff5a27:0xffc45a,transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending}),mesh=new THREE.Mesh(explosionGeometry,material);mesh.visible=false;mesh.renderOrder=17;mesh.userData.flightFireIgnore=true;scene.add(mesh);explosions.push({mesh,born:0,expires:0});}}
}

function assign(record,route,slot){if(!route){record.id="";record.routeKey="";record.group.visible=false;return;}record.routeKey=route.key;record.id=`${record.kind}-${route.key}-${slot}`;record.group.userData.worldPopulationId=record.id;record.group.traverse(node=>{if(node?.isMesh){node.userData.worldPopulationId=record.id;node.userData.worldPopulationKind=record.kind;}});const dead=pendingDead.get(record.id);if(dead)record.deadUntil=Math.max(record.deadUntil,dead);}
function spawnExplosion(position){ensurePools();const item=explosions.find(x=>!x.mesh.visible)||explosions[hashText(`${position.x}:${position.y}`)%explosions.length];item.born=performance.now();item.expires=item.born+900;item.mesh.position.copy(position);item.mesh.scale.setScalar(1);item.mesh.material.opacity=.95;item.mesh.visible=true;}
function personImpulseAt(position){const camera=bridge()?.threeCamera;if(camera?.getWorldPosition){camera.getWorldPosition(cameraPos);impactDir.copy(position).sub(cameraPos);if(impactDir.lengthSq()<1e-6)impactDir.set(1,0,0);impactDir.normalize().multiplyScalar(4.6);}else impactDir.set(2.8,0,0);impactDir.z=Math.max(2.2,impactDir.z+2.0);return[impactDir.x,impactDir.y,impactDir.z];}
function recordColors(record){return record?.kind==="person"?{shirt:record.shirtHex??colorHex(record.materials?.shirt),skin:record.skinHex??colorHex(record.materials?.skin),pants:record.pantsHex??colorHex(record.materials?.pants)}:null;}
function spawnPersonDeath(record,position,impulse=null,yaw=null,colors=null){if(!record&&!position)return false;const p=position||temp,angle=Number.isFinite(Number(yaw))?Number(yaw):Number(record?.group?.rotation?.z)||0,kick=Array.isArray(impulse)?impulse:personImpulseAt(p),id=String(record?.id||"");return spawnWorldPersonRagdoll({position:[p.x,p.y,p.z],yaw:angle,impulse:kick,seed:id||`${p.x}:${p.y}`,id,colors:colors||recordColors(record)});}

function markDead(record,{network=false}={}){
  if(!record||!record.id)return false;const now=Date.now(),ttl=record.kind==="car"?CAR_RESPAWN_MS:PERSON_RESPAWN_MS;record.deadUntil=Math.max(record.deadUntil,now+ttl);record.deadAt=performance.now();pendingDead.set(record.id,record.deadUntil);record.group.getWorldPosition(temp);const p=[temp.x,temp.y,temp.z];let impulse=null,colors=null;
  if(record.kind==="car")spawnExplosion(temp);else{impulse=personImpulseAt(temp);colors=recordColors(record);spawnPersonDeath(record,temp,impulse,record.group.rotation.z,colors);record.group.visible=false;}
  if(network){const s=session(),packet={type:record.kind==="car"?"explosion":"impact",id:`world-${record.id}-${now.toString(36)}`,p,objectId:record.id,kind:record.kind};if(record.kind==="person"){packet.yaw=Number(record.group.rotation.z)||0;packet.impulse=impulse;packet.colors=colors;}s?.sendFx?.(packet);}return true;
}

function recordById(id){return cars.find(x=>x.id===id)||people.find(x=>x.id===id)||null;}
function handleRemoteFx(event){
  const packet=event.detail?.packet,id=String(packet?.objectId||"");if(!id||!/^car-|^person-/.test(id))return;const ttl=String(packet.kind)==="person"?PERSON_RESPAWN_MS:CAR_RESPAWN_MS,pending=Date.now()+ttl,record=recordById(id),wasAlive=!record||Date.now()>=record.deadUntil;if(record){record.deadUntil=Math.max(record.deadUntil,pending);record.deadAt=performance.now();record.group.visible=false;}pendingDead.set(id,pending);
  if(packet.type==="explosion"&&Array.isArray(packet.p)){temp.set(Number(packet.p[0])||0,Number(packet.p[1])||0,Number(packet.p[2])||0);spawnExplosion(temp);}else if(packet.type==="impact"&&String(packet.kind)==="person"&&Array.isArray(packet.p)&&wasAlive){temp.set(Number(packet.p[0])||0,Number(packet.p[1])||0,Number(packet.p[2])||0);spawnWorldPersonRagdoll({position:[temp.x,temp.y,temp.z],yaw:Number(packet.yaw)||0,impulse:Array.isArray(packet.impulse)?packet.impulse:[2.8,0,2.2],seed:id,id,colors:packet.colors||recordColors(record)});}
}

function updateRecord(record,nowMs,epochSeconds,person=false){
  if(!routeRegistry.size){record.group.visible=false;return;}let route=record.routeKey?routeRegistry.get(record.routeKey):null;if(!route){route=routes[(record.index*7+(person?3:0))%Math.max(1,routes.length)]||null;if(route)assign(record,route,record.index);}if(!route){record.group.visible=false;return;}
  if(Date.now()<record.deadUntil){record.group.visible=false;return;}record.group.rotation.x=0;pendingDead.delete(record.id);const distance=epochSeconds*record.speed+record.phase,lane=person?record.side:record.lane,sample=sampleRoadRoute(route,distance,lane);if(!sample){record.group.visible=false;return;}
  record.group.position.set(sample.x,sample.y,person?0.018:0);record.group.rotation.z=sample.yaw;if(person)record.group.position.z=.018+.012*Math.sin(epochSeconds*record.speed*4+record.index);record.group.visible=Boolean(bridge()?.active);
}

function updateExplosions(now){for(const item of explosions){if(!item.mesh.visible)continue;if(now>=item.expires){item.mesh.visible=false;continue;}const t=(now-item.born)/(item.expires-item.born);item.mesh.scale.setScalar(.8+8*t);item.mesh.material.opacity=Math.max(0,.95*(1-t));}}
function frame(now=performance.now()){raf=requestAnimationFrame(frame);const b=bridge();if(!b?.threeScene)return;ensurePools();refreshRoutes(now);refreshBuildingVisuals(now);const epoch=Date.now()/1000;for(const car of cars)updateRecord(car,now,epoch,false);for(const person of people)updateRecord(person,now,epoch,true);updateExplosions(now);}

function installHitHook(){const b=bridge();if(!b)return;if(!b.__worldPopulationHitHook){b.__worldPopulationHitHook=true;b.registerWorldPopulationHit=hit=>{let node=hit?.object;while(node&&!node.userData?.worldPopulationId)node=node.parent;if(!node)return false;const record=recordById(String(node.userData.worldPopulationId||""));if(!record||Date.now()<record.deadUntil)return Boolean(record);markDead(record,{network:true});const view=viewport();if(view){view.dataset.worldPopulationHits=String((Number(view.dataset.worldPopulationHits)||0)+1);view.dataset.worldPopulationLastHit=record.kind;}return true;};}if(!b.__worldPopulationRegisterShim&&typeof b.registerVsHit==="function"){b.__worldPopulationRegisterShim=true;const base=b.registerVsHit.bind(b);b.registerVsHit=hit=>b.registerWorldPopulationHit?.(hit)||base(hit);}}
function hookLoop(){installHitHook();setTimeout(hookLoop,500);}
export function installWorldPopulation(){if(installed)return;installed=true;globalThis.addEventListener(VS_FX_EVENT,handleRemoteFx);hookLoop();raf=requestAnimationFrame(frame);}
