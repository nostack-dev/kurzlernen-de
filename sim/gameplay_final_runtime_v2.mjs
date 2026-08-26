import * as THREE from "three";
import {Box3dHitscanWorld} from "./box3d_hitscan.mjs";
import {AUDIO_SETTINGS_EVENT,loadAudioSettings,normalizeAudioSettings} from "./audio_settings.mjs";
import {getSharedCombatAudioContext,playCombatAudio} from "./combat_audio_bank.mjs";
import {wantedLineBlockedByPrisms} from "./wanted_system_logic.mjs";
import {findRayPopulationHit} from "./ray_population_hit.mjs";

const IMAGERY_KEY="arondight45WorldImageryV1";
const FOOT_WEAPON_KEY="arondight45FootWeaponV1";
const DRONE_WEAPON_KEY="arondight45DroneWeaponV1";
const BLAST_RADIUS_M=8;
const BLAST_MAX_DAMAGE=100;
const BLAST_OCCLUDED_SCALE=.18;
const MISSILE_TTL_MS=4200;
const tmp=new THREE.Vector3(),tmp2=new THREE.Vector3(),tmp3=new THREE.Vector3(),right=new THREE.Vector3(),forward=new THREE.Vector3(),ndc=new THREE.Vector2();
const shotCamera=new THREE.PerspectiveCamera(78,16/9,.01,500),shotRaycaster=new THREE.Raycaster(),boxHits=new Box3dHitscanWorld();
const tracerAxis=new THREE.Vector3(0,1,0),tracerVector=new THREE.Vector3();
let installed=false,audioSettings=loadAudioSettings(),footWeapon=loadMode(FOOT_WEAPON_KEY,"pistol",["pistol","smg"]),droneWeapon=loadMode(DRONE_WEAPON_KEY,"gun",["gun","missile"]),lastPistol=-Infinity,lastSmg=-Infinity,lastMissile=-Infinity;
let tracerScene=null,tracerPool=[],tracerCursor=0,blastScene=null,blastPool=[],blastCursor=0,tap=null,lastPedScan=-Infinity,pedestrians=[];
const pedState=new WeakMap(),missiles=[];

function viewport(){return document.getElementById("viewport");}
function bridge(){return globalThis.__arondightRealWorld||null;}
function walk(){return globalThis.__arondightWalkMode||null;}
function rigid(){return globalThis.__arondightWorldRigidBodies||null;}
function drive(){return globalThis.__arondightVehicleDrive||null;}
function clamp(v,a,b){return Math.max(a,Math.min(b,Number(v)||0));}
function loadMode(key,fallback,allowed){try{const value=localStorage.getItem(key);return allowed.includes(value)?value:fallback;}catch{return fallback;}}
function saveMode(key,value){try{localStorage.setItem(key,value);}catch{}}
function effectiveVisible(node){for(let n=node;n;n=n.parent)if(n.visible===false)return false;return true;}
function isFoot(){return walk()?.mode==="foot"&&!drive()?.active;}
function isDrone(){return walk()?.mode!=="foot"&&!drive()?.active;}
function audioShot(gain=.22){if(!audioSettings.soundEnabled||audioSettings.shotsVolume<=0)return;const ctx=getSharedCombatAudioContext({resume:true});if(ctx)playCombatAudio(ctx,"shot",{gain:gain*audioSettings.shotsVolume/100,minIntervalMs:28});}

try{if(localStorage.getItem(IMAGERY_KEY)===null)localStorage.setItem(IMAGERY_KEY,"0");}catch{}

function logicalPoint(clientX,clientY){
  const view=viewport(),screen=view?.getBoundingClientRect();if(!view||!screen)return null;
  const width=Math.max(1,view.clientWidth),height=Math.max(1,view.clientHeight),cx=Number.isFinite(clientX)?clientX:screen.left+screen.width/2,cy=Number.isFinite(clientY)?clientY:screen.top+screen.height/2,rotated=view.dataset.soloOrientation==="css-landscape",x=rotated?cy-screen.top:cx-screen.left,y=rotated?screen.right-cx:cy-screen.top;
  return{x:clamp(x,0,width),y:clamp(y,0,height),width,height,screen};
}
function footRay(clientX,clientY){
  const w=walk(),p=logicalPoint(clientX,clientY);if(!w?.position||!p)return null;
  shotCamera.fov=clamp(Number(viewport()?.dataset.walkCameraFovDeg)||Number(bridge()?.threeCamera?.fov)||78,45,120);shotCamera.aspect=p.width/p.height;shotCamera.near=.01;shotCamera.far=220;shotCamera.position.set(Number(w.position.x)||0,Number(w.position.y)||0,Number(w.position.z)||1.68);shotCamera.up.set(0,0,1);
  const cp=Math.cos(Number(w.pitch)||0);forward.set(Math.sin(Number(w.yaw)||0)*cp,Math.cos(Number(w.yaw)||0)*cp,Math.sin(Number(w.pitch)||0)).normalize();shotCamera.lookAt(tmp.copy(shotCamera.position).add(forward));shotCamera.updateProjectionMatrix();shotCamera.updateMatrixWorld(true);ndc.set(p.x/p.width*2-1,1-p.y/p.height*2);shotRaycaster.setFromCamera(ndc,shotCamera);return{origin:shotRaycaster.ray.origin.clone(),direction:shotRaycaster.ray.direction.clone(),point:p};
}
function droneRay(clientX,clientY){const camera=bridge()?.threeCamera,p=logicalPoint(clientX,clientY);if(!camera||!p)return null;ndc.set(p.x/p.width*2-1,1-p.y/p.height*2);shotRaycaster.setFromCamera(ndc,camera);return{origin:shotRaycaster.ray.origin.clone(),direction:shotRaycaster.ray.direction.clone(),point:p};}
function candidates(scene){const list=[];scene?.traverse?.(node=>{if(!node?.isMesh||!effectiveVisible(node)||node.material?.visible===false)return;const u=node.userData||{};if(u.flightFireIgnore||u.walkWeaponPart||u.arondightAirframe||u.localHumanAvatar||u.worldPopulationClone)return;list.push(node);});return list;}
function nearestHit(ray,maxDistance=180){
  const b=bridge(),scene=b?.threeScene;if(!scene||!ray)return null;shotRaycaster.set(ray.origin,ray.direction);shotRaycaster.near=.01;shotRaycaster.far=maxDistance;const sceneHit=shotRaycaster.intersectObjects(candidates(scene),false)[0]||null,populationHit=findRayPopulationHit(scene,ray,{maxDistance}),dynamicHit=populationHit&&(!sceneHit||populationHit.distance<sceneHit.distance)?populationHit:sceneHit;let staticHit=null;
  if(b.active){const hit=boxHits.cast([ray.origin.x,ray.origin.y,ray.origin.z],[ray.direction.x,ray.direction.y,ray.direction.z],maxDistance,b.buildingCollisionSnapshot);if(hit)staticHit={box3d:true,distance:hit.distanceM,point:new THREE.Vector3(...hit.point),worldNormal:new THREE.Vector3(...hit.normal)};}
  const view=viewport();if(populationHit&&dynamicHit===populationHit&&view)view.dataset.worldPopulationSoftTarget="ray-soft-person-volume-v1";
  return staticHit&&(!dynamicHit||staticHit.distance<dynamicHit.distance-.05)?staticHit:dynamicHit;
}

function ensureTracerPool(scene){if(tracerScene===scene&&tracerPool.length)return;if(tracerScene)for(const mesh of tracerPool)mesh.parent?.remove(mesh);tracerScene=scene;tracerPool=[];const geometry=new THREE.CylinderGeometry(.007,.007,1,5),material=new THREE.MeshBasicMaterial({color:0xffd27a,transparent:true,opacity:.92,depthTest:true,depthWrite:false,blending:THREE.AdditiveBlending});for(let i=0;i<18;i++){const mesh=new THREE.Mesh(geometry,material);mesh.visible=false;mesh.frustumCulled=false;mesh.renderOrder=14;mesh.userData.flightFireIgnore=true;mesh.userData.flightFireTracer=true;scene.add(mesh);tracerPool.push(mesh);}}
function showTracer(start,end,ttl=82){const scene=bridge()?.threeScene;if(!scene)return;ensureTracerPool(scene);const mesh=tracerPool[tracerCursor++%tracerPool.length];tracerVector.copy(end).sub(start);const length=tracerVector.length();if(length<.03)return;mesh.position.copy(start).addScaledVector(tracerVector,.5);mesh.quaternion.setFromUnitVectors(tracerAxis,tracerVector.normalize());mesh.scale.set(1,Math.min(length,26),1);mesh.visible=true;setTimeout(()=>mesh.visible=false,ttl);}
function routeHit(hit){if(!hit||hit.box3d)return false;const b=bridge(),police=Boolean(b?.registerPoliceHit?.(hit)),population=!police&&Boolean(b?.registerWorldPopulationHit?.(hit)),versus=!police&&!population&&Boolean(b?.registerVsHit?.(hit));return police||population||versus;}
function addFallbackDecal(hit){if(!hit?.point)return;const b=bridge(),scene=b?.threeScene;if(!scene)return;const g=new THREE.CircleGeometry(.026,8),m=new THREE.MeshBasicMaterial({color:0x171717,transparent:true,opacity:.9,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-4,side:THREE.DoubleSide}),mesh=new THREE.Mesh(g,m),n=hit.worldNormal?.clone?.()||hit.face?.normal?.clone?.().transformDirection(hit.object?.matrixWorld)||new THREE.Vector3(0,0,1);mesh.position.copy(hit.point).addScaledVector(n.normalize(),.004);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),n);mesh.userData.flightFireIgnore=true;scene.add(mesh);setTimeout(()=>{scene.remove(mesh);g.dispose();m.dispose();},9000);}

function patchWeaponVisual(){
  const scene=bridge()?.threeScene;if(!scene)return;const gun=scene.getObjectByName?.("WALK_PISTOL_3D");if(!gun)return;const legacy=gun.getObjectByName?.("WALK_MUZZLE_FLASH");
  if(legacy){legacy.visible=false;legacy.traverse?.(n=>{if(n.isMesh&&n.material){n.material.depthTest=true;n.material.depthWrite=false;n.material.needsUpdate=true;}if(n.isMesh)n.renderOrder=9997;});}
  let custom=gun.getObjectByName?.("FINAL_MUZZLE_FLASH");
  if(!custom){custom=new THREE.Group();custom.name="FINAL_MUZZLE_FLASH";custom.position.set(0,.008,-.39);const mat=new THREE.MeshBasicMaterial({color:0xffd56b,transparent:true,opacity:.95,depthTest:true,depthWrite:false,blending:THREE.AdditiveBlending}),core=new THREE.Mesh(new THREE.SphereGeometry(.028,7,5),mat),cone=new THREE.Mesh(new THREE.ConeGeometry(.038,.11,7),mat);cone.position.z=-.055;cone.rotation.x=Math.PI/2;for(const m of[core,cone]){m.renderOrder=10001;m.userData.flightFireIgnore=true;m.userData.walkWeaponPart=true;}custom.add(core,cone);custom.visible=false;gun.add(custom);}
  let smg=gun.getObjectByName?.("FINAL_SMG_CONVERSION");
  if(!smg){smg=new THREE.Group();smg.name="FINAL_SMG_CONVERSION";const metal=new THREE.MeshStandardMaterial({color:0x222a30,roughness:.38,metalness:.62,depthTest:true,depthWrite:true}),dark=new THREE.MeshStandardMaterial({color:0x101418,roughness:.72,metalness:.15,depthTest:true,depthWrite:true});const add=(geo,mat,pos,rot=[0,0,0])=>{const m=new THREE.Mesh(geo,mat);m.position.set(...pos);m.rotation.set(...rot);m.renderOrder=10000;m.userData.flightFireIgnore=true;m.userData.walkWeaponPart=true;smg.add(m);};add(new THREE.BoxGeometry(.095,.085,.30),metal,[0,.002,-.31]);add(new THREE.CylinderGeometry(.014,.014,.26,10),dark,[0,.005,-.53],[Math.PI/2,0,0]);add(new THREE.BoxGeometry(.055,.18,.08),dark,[0,-.115,-.22],[.28,0,0]);add(new THREE.BoxGeometry(.06,.05,.20),dark,[0,-.015,-.06]);gun.add(smg);}
  smg.visible=footWeapon==="smg";custom.position.z=footWeapon==="smg"?-.66:-.39;gun.userData.finalWeapon=footWeapon;const view=viewport();if(view){view.dataset.walkMuzzleDepth="depth-tested-viewmodel-occlusion-v2";view.dataset.walkWeaponViewmodelAlignment="camera-owned-sights-v2";}
}
let flashUntil=-Infinity;
function flashWeapon(){flashUntil=performance.now()+55;}
function updateFlash(){const gun=bridge()?.threeScene?.getObjectByName?.("WALK_PISTOL_3D"),flash=gun?.getObjectByName?.("FINAL_MUZZLE_FLASH");if(flash)flash.visible=isFoot()&&performance.now()<flashUntil;}
function footMuzzle(out,ray){const muzzle=bridge()?.threeScene?.getObjectByName?.("FINAL_MUZZLE_FLASH");if(muzzle?.getWorldPosition){muzzle.updateWorldMatrix?.(true,false);muzzle.getWorldPosition(out);return out;}right.set(ray.direction.y,-ray.direction.x,0).normalize();return out.copy(ray.origin).addScaledVector(ray.direction,.34).addScaledVector(right,.20).add(new THREE.Vector3(0,0,-.16));}

function footShotAt(clientX,clientY,now=performance.now()){
  if(!isFoot()||walk()?.dead)return false;const interval=footWeapon==="smg"?72:190,last=footWeapon==="smg"?lastSmg:lastPistol;if(now-last<interval)return false;if(footWeapon==="smg")lastSmg=now;else lastPistol=now;
  const ray=footRay(clientX,clientY);if(!ray)return false;const hit=nearestHit(ray,180),end=hit?.point?.clone?.()||tmp.copy(ray.origin).addScaledVector(ray.direction,120).clone(),start=footMuzzle(tmp2,ray).clone();showTracer(start,end,footWeapon==="smg"?62:90);if(hit){const routed=routeHit(hit);if(!routed)addFallbackDecal(hit);}flashWeapon();audioShot(footWeapon==="smg"?.16:.24);window.dispatchEvent(new CustomEvent("arondight:world-gunshot",{detail:{position:[ray.origin.x,ray.origin.y,ray.origin.z],end:[end.x,end.y,end.z],source:"player",weapon:footWeapon}}));
  const view=viewport();if(view){view.dataset.walkWeapon=footWeapon;view.dataset.walkTouchFire="screen-point-raycast-v2";view.dataset.walkPistolTracer="world-ray-muzzle-origin-v2";view.dataset.walkEnhancedShots=String((Number(view.dataset.walkEnhancedShots)||0)+1);view.dataset.walkTouchAimX=ray.point.x.toFixed(1);view.dataset.walkTouchAimY=ray.point.y.toFixed(1);}return true;
}
function footBurst(clientX,clientY){if(footWeapon!=="smg")return footShotAt(clientX,clientY);for(let i=0;i<3;i++)setTimeout(()=>footShotAt(clientX,clientY,performance.now()),i*76);return true;}

function ensureBlastPool(scene){if(blastScene===scene&&blastPool.length)return;if(blastScene)for(const item of blastPool)item.group.parent?.remove(item.group);blastScene=scene;blastPool=[];const sphere=new THREE.SphereGeometry(.45,10,7),ringGeo=new THREE.RingGeometry(.6,1,24);for(let i=0;i<8;i++){const group=new THREE.Group(),hot=new THREE.Mesh(sphere,new THREE.MeshBasicMaterial({color:0xff9b43,transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending})),ring=new THREE.Mesh(ringGeo,new THREE.MeshBasicMaterial({color:0xffd27a,transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending}));ring.rotation.x=Math.PI/2;group.add(hot,ring);group.visible=false;scene.add(group);blastPool.push({group,hot,ring,born:0,until:0});}}
function visualBlast(position,scale=1){const scene=bridge()?.threeScene;if(!scene)return;ensureBlastPool(scene);const item=blastPool[blastCursor++%blastPool.length],now=performance.now();item.group.position.copy(position);item.group.visible=true;item.born=now;item.until=now+540;item.scale=scale;item.hot.material.opacity=.9;item.ring.material.opacity=.78;}
function updateBlasts(now){for(const item of blastPool){if(!item.group.visible)continue;if(now>=item.until){item.group.visible=false;continue;}const t=(now-item.born)/(item.until-item.born),e=1-(1-t)**3;item.hot.scale.setScalar(item.scale*(.5+4.5*e));item.ring.scale.setScalar(item.scale*(.7+7*e));item.hot.material.opacity=.9*(1-t);item.ring.material.opacity=.78*(1-t)**1.6;}}
function dispatchExplosion(position,detail={}){visualBlast(position,1);window.dispatchEvent(new CustomEvent("arondight:world-explosion",{detail:{position:[position.x,position.y,position.z],radiusM:BLAST_RADIUS_M,maxDamage:BLAST_MAX_DAMAGE,kind:"missile",...detail}}));}

function missileTarget(ray){const hit=nearestHit(ray,220);return{hit,target:hit?.point?.clone?.()||tmp.copy(ray.origin).addScaledVector(ray.direction,105).clone(),object:hit&&!hit.box3d?hit.object:null};}
function launchMissile(clientX,clientY,now=performance.now(),source="pointer"){
  if(!isDrone()||globalThis.__arondightDroneDamageModel?.destroyed||now-lastMissile<950)return false;const view=viewport();if(view?.dataset.fireArmed!=="1")return false;const ray=droneRay(clientX,clientY),scene=bridge()?.threeScene;if(!ray||!scene)return false;
  lastMissile=now;const goal=missileTarget(ray),group=new THREE.Group(),body=new THREE.Mesh(new THREE.CylinderGeometry(.025,.032,.26,8),new THREE.MeshStandardMaterial({color:0xcfd7db,roughness:.35,metalness:.45})),tip=new THREE.Mesh(new THREE.ConeGeometry(.034,.09,8),new THREE.MeshBasicMaterial({color:0xffaa4a}));body.rotation.x=Math.PI/2;tip.rotation.x=Math.PI/2;tip.position.z=-.17;group.add(body,tip);group.position.copy(ray.origin).addScaledVector(ray.direction,.28);group.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,-1),ray.direction);for(const m of[body,tip])m.userData.flightFireIgnore=true;scene.add(group);missiles.push({group,velocity:ray.direction.clone().multiplyScalar(26),target:goal.target,object:goal.object,born:now,scene,source});audioShot(.34);
  if(view){view.dataset.droneWeapon="missile";view.dataset.droneMissiles=String((Number(view.dataset.droneMissiles)||0)+1);view.dataset.droneMissileGuidance="screen-target-homing+path-collision-v2";view.dataset.droneMissileInput=source;}return true;
}
function detonateMissile(index,position,targeted=false){const m=missiles[index];if(!m)return;m.scene.remove(m.group);missiles.splice(index,1);dispatchExplosion(position,{targeted,source:m.source||"missile"});}
function updateMissiles(now,dt){
  for(let i=missiles.length-1;i>=0;i--){const m=missiles[i];if(m.object?.parent&&effectiveVisible(m.object))m.object.getWorldPosition?.(m.target);tmp.copy(m.target).sub(m.group.position);const distance=tmp.length();if(distance<1.05||now-m.born>MISSILE_TTL_MS){detonateMissile(i,m.group.position.clone(),Boolean(m.object));continue;}
    const desired=tmp.normalize().multiplyScalar(31),blend=1-Math.exp(-5.8*dt);m.velocity.lerp(desired,blend);const speed=m.velocity.length(),step=Math.max(.01,speed*dt),pathDir=tmp2.copy(m.velocity).normalize(),pathHit=nearestHit({origin:m.group.position,direction:pathDir},step+.14);if(pathHit&&Number(pathHit.distance)<=step+.10){detonateMissile(i,pathHit.point?.clone?.()||m.group.position.clone(),Boolean(m.object));continue;}m.group.position.addScaledVector(m.velocity,dt);m.group.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,-1),pathDir);}
}

function blastFalloff(distance,radius){const x=clamp(1-distance/Math.max(.1,radius),0,1);return x*x*(3-2*x);}
function blastExposure(center,target){const prisms=bridge()?.buildingCollisionSnapshot?.prisms||[];if(!prisms.length)return 1;const from={x:center.x,y:center.y,z:center.z+.12},to={x:target.x,y:target.y,z:target.z};return wantedLineBlockedByPrisms(from,to,prisms)?BLAST_OCCLUDED_SCALE:1;}
function populationRoots(scene){const roots=new Map();scene?.traverse?.(node=>{const id=String(node.userData?.worldPopulationId||node.userData?.worldLifeId||""),kind=String(node.userData?.worldPopulationKind||node.userData?.worldLifeKind||"");if(!id||!kind)return;let root=node;while(root.parent&&String(root.parent.userData?.worldPopulationId||root.parent.userData?.worldLifeId||"")===id)root=root.parent;if(!roots.has(id))roots.set(id,root);});return roots;}
function meshFor(root){let out=null;root?.traverse?.(n=>{if(!out&&n.isMesh)out=n;});return out||root;}
function applyBlast(event){
  const d=event?.detail||{},p=Array.isArray(d.position)?d.position:null;if(!p||p.length<3)return;const center=new THREE.Vector3(Number(p[0])||0,Number(p[1])||0,Number(p[2])||0),radius=clamp(d.radiusM??BLAST_RADIUS_M,2,18),maxDamage=clamp(d.maxDamage??BLAST_MAX_DAMAGE,10,160),sourceId=String(d.id||"");let impulses=0,damaged=0,occluded=0;const runtime=rigid(),engine=runtime?.engine;
  if(engine?.records)for(const record of engine.records.values()){if(record.id===sourceId)continue;const pose=runtime.pose?.(record.id),q=pose?.position;if(!q)continue;tmp2.set(q[0],q[1],q[2]);const dist=tmp2.distanceTo(center);if(dist>=radius)continue;const exposure=blastExposure(center,tmp2);if(exposure<1)occluded++;const f=blastFalloff(dist,radius)*Math.sqrt(exposure),dir=tmp3.copy(tmp2).sub(center);if(dir.lengthSq()<.001)dir.set(.2,0,1);dir.normalize();const mass=Math.max(.1,Number(record.massKg)||1),dv=(record.drone?6.2:3.1)*f,impulse=[dir.x*mass*dv,dir.y*mass*dv,(dir.z+.32)*mass*dv];if(runtime.applyImpulse?.(record.id,impulse,{point:q}))impulses++;}
  const vitals=globalThis.__arondightPlayerVitals;for(const target of vitals?.damageTargets?.()||[]){const q=target.position;if(!q)continue;tmp2.set(Number(q.x)||0,Number(q.y)||0,Number(q.z)||0);const dist=tmp2.distanceTo(center);if(dist>=radius)continue;const exposure=blastExposure(center,tmp2);if(exposure<1)occluded++;const amount=maxDamage*blastFalloff(dist,radius)*exposure;if(amount>2){target.model?.damage?.(amount,`explosion:${d.kind||"world"}`);damaged++;}}
  const wanted=globalThis.__arondightWantedSystem,b=bridge();for(const drone of wanted?.drones||[]){if(!drone?.active||!drone.root)continue;drone.root.getWorldPosition?.(tmp2);const dist=tmp2.distanceTo(center);if(dist>=radius)continue;const exposure=blastExposure(center,tmp2);if(exposure<1)occluded++;const amount=maxDamage*blastFalloff(dist,radius)*exposure,hits=Math.min(3,Math.max(0,Math.round(amount/34)));for(let i=0;i<hits;i++)b?.registerPoliceHit?.({object:drone.hitbox||drone.root,point:tmp2.clone()});if(hits)damaged++;}
  const scene=b?.threeScene;if(scene&&typeof b?.registerWorldPopulationHit==="function")for(const[id,root]of populationRoots(scene)){if(id===sourceId||root.visible===false)continue;root.getWorldPosition(tmp2);const dist=tmp2.distanceTo(center);if(dist>=radius)continue;const exposure=blastExposure(center,tmp2);if(exposure<1)occluded++;const f=blastFalloff(dist,radius)*exposure,kind=String(root.userData?.worldPopulationKind||root.userData?.worldLifeKind||"").replace(/^life-/,"");let hits=kind==="person"?(f>.22?1:0):kind==="bus"?Math.ceil(f*4):kind==="car"?Math.ceil(f*5):f>.7?1:0;hits=Math.min(5,hits);const object=meshFor(root);for(let i=0;i<hits;i++)b.registerWorldPopulationHit({object,point:tmp2.clone()});if(hits)damaged++;}
  const peer=b?.vsPeerMesh;if(peer&&peer.visible!==false&&typeof b?.registerVsHit==="function"){peer.getWorldPosition?.(tmp2);const dist=tmp2.distanceTo(center);if(dist<radius){const exposure=blastExposure(center,tmp2);if(exposure<1)occluded++;const hits=Math.min(4,Math.max(0,Math.ceil(blastFalloff(dist,radius)*exposure*4)));for(let i=0;i<hits;i++)b.registerVsHit({object:peer,point:tmp2.clone()});if(hits)damaged++;}}
  const view=viewport();if(view){view.dataset.explosionPhysics="box3d-radial-impulse+damage-falloff-v2";view.dataset.explosionRadiusM=radius.toFixed(1);view.dataset.explosionLastImpulses=String(impulses);view.dataset.explosionLastDamaged=String(damaged);view.dataset.explosionOccludedTargets=String(occluded);view.dataset.explosionDamageFalloff="smoothstep-radial-v2";view.dataset.explosionOcclusion="building-prism-los-v2";}
}

function ensureControls(){const view=viewport();if(!view)return;let foot=document.getElementById("footWeaponToggle");if(!foot){foot=document.createElement("button");foot.id="footWeaponToggle";foot.type="button";foot.addEventListener("pointerdown",e=>{e.preventDefault();e.stopPropagation();toggleFootWeapon();});view.appendChild(foot);}let drone=document.getElementById("droneWeaponToggle");if(!drone){drone=document.createElement("button");drone.id="droneWeaponToggle";drone.type="button";drone.addEventListener("pointerdown",e=>{e.preventDefault();e.stopPropagation();toggleDroneWeapon();});view.appendChild(drone);}foot.textContent=footWeapon==="pistol"?"PISTOL · MP":"MP · PISTOL";drone.textContent=droneWeapon==="gun"?"GUN · MISSILE":"MISSILE · GUN";foot.hidden=!isFoot();drone.hidden=!isDrone();view.dataset.walkWeapon=footWeapon;view.dataset.droneWeapon=droneWeapon;}
function toggleFootWeapon(){footWeapon=footWeapon==="pistol"?"smg":"pistol";saveMode(FOOT_WEAPON_KEY,footWeapon);patchWeaponVisual();ensureControls();return footWeapon;}
function toggleDroneWeapon(){droneWeapon=droneWeapon==="gun"?"missile":"gun";saveMode(DRONE_WEAPON_KEY,droneWeapon);ensureControls();return droneWeapon;}


function inputCapture(event){
  const target=event.target instanceof Element?event.target:null;
  if(event.type==="pointerdown"&&isFoot()&&event.pointerType!=="mouse"&&target?.closest("#footLookZone")){tap={id:event.pointerId,x:event.clientX,y:event.clientY,lastX:event.clientX,lastY:event.clientY,at:performance.now(),moved:false};}
  if(event.type==="pointermove"&&tap&&event.pointerId===tap.id){tap.lastX=event.clientX;tap.lastY=event.clientY;if(Math.hypot(event.clientX-tap.x,event.clientY-tap.y)>9)tap.moved=true;}
  if((event.type==="pointerup"||event.type==="pointercancel")&&tap&&event.pointerId===tap.id){const t=tap;tap=null;if(event.type==="pointerup"&&!t.moved&&performance.now()-t.at<260)footBurst(t.lastX,t.lastY);}
  if(event.type==="pointerdown"&&isDrone()&&droneWeapon==="missile"&&event.button===0&&!target?.closest("#soloTopbar,#soloLeft,#soloRight,#soloClearance,.solo-action,.phone-settings-dialog,#wantedEmpButton,#droneWeaponToggle,dialog,button,input,select,textarea,a,label")){event.preventDefault();event.stopImmediatePropagation();launchMissile(event.clientX,event.clientY,performance.now(),event.pointerType||"pointer");}
}

function scanPedestrians(now){if(now-lastPedScan<850)return;lastPedScan=now;pedestrians=[];const scene=bridge()?.threeScene;scene?.traverse?.(node=>{if(!node.children?.length)return;const kind=String(node.userData?.worldPopulationKind||node.userData?.worldLifeKind||"");if(kind!=="person"&&kind!=="life-person")return;const id=String(node.userData?.worldPopulationId||node.userData?.worldLifeId||"");if(!id||pedestrians.some(x=>x.id===id))return;const limbs=[];for(const child of node.children){if(!child?.isMesh)continue;const type=String(child.geometry?.type||""),z=Number(child.position.z)||0;if(!type.includes("Box"))continue;if(z<.8||z>.82&&z<1.38)limbs.push({mesh:child,base:child.rotation.y,leg:z<.8,side:Math.sign(Number(child.position.y)||1)});}if(limbs.length)pedestrians.push({id,root:node,limbs});});}
function animatePedestrians(now,dt){scanPedestrians(now);let moving=0;for(const p of pedestrians){if(!p.root?.parent||p.root.visible===false)continue;let s=pedState.get(p.root);if(!s){s={x:p.root.position.x,y:p.root.position.y,phase:(p.id.length%7)*.7};pedState.set(p.root,s);}const speed=Math.hypot(p.root.position.x-s.x,p.root.position.y-s.y)/Math.max(.001,dt);s.x=p.root.position.x;s.y=p.root.position.y;const weight=clamp((speed-.08)/1.2,0,1);if(weight>.05){s.phase+=dt*(5.5+speed*2.4);moving++;}const swing=Math.sin(s.phase)*.48*weight;for(const limb of p.limbs)limb.mesh.rotation.y=limb.base+(limb.leg?1:-.82)*limb.side*swing;}const view=viewport();if(view){view.dataset.pedestrianAnimation="procedural-arm-leg-walkcycle-v2";view.dataset.pedestriansWalking=String(moving);}}

function installStyle(){if(document.querySelector("style[data-gameplay-final-runtime]"))return;const style=document.createElement("style");style.dataset.gameplayFinalRuntime="v2";style.textContent=`
#footFire{display:block!important;width:64px!important;height:64px!important;right:calc(max(10px,var(--solo-safe-right,env(safe-area-inset-right))) + min(25vw,148px) + 12px)!important;bottom:max(16px,calc(var(--solo-safe-bottom,env(safe-area-inset-bottom)) + 12px))!important;font-size:9px!important;border-width:1px!important;opacity:.92!important;box-shadow:0 5px 16px #0008,0 0 0 3px #ffb34a18!important}
#footLookZone::after{display:none!important}
#footWeaponToggle,#droneWeaponToggle{position:absolute;z-index:21;bottom:max(18px,calc(var(--solo-safe-bottom,env(safe-area-inset-bottom)) + 10px));left:50%;transform:translateX(-50%);min-width:112px;height:32px;padding:0 10px;border:1px solid #ffffff4a;border-radius:9px;background:#0a1826e8;color:#eaf7ff;font:900 8px/1 system-ui;letter-spacing:.05em;box-shadow:0 4px 14px #0007;touch-action:manipulation}#footWeaponToggle{border-color:#ffd27a77;color:#ffe9b9}#droneWeaponToggle{border-color:#7cdfff77;color:#c9f4ff}#footWeaponToggle[hidden],#droneWeaponToggle[hidden]{display:none!important}@media(max-height:340px){#footFire{width:54px!important;height:54px!important;right:calc(max(8px,var(--solo-safe-right,env(safe-area-inset-right))) + min(22vw,124px) + 8px)!important;bottom:max(8px,var(--solo-safe-bottom,env(safe-area-inset-bottom)))!important}#footWeaponToggle,#droneWeaponToggle{height:28px;min-width:102px;font-size:7px;bottom:max(8px,var(--solo-safe-bottom,env(safe-area-inset-bottom)))}}
`;document.head.appendChild(style);}

function installApis(){
  globalThis.__arondightFootWeapons={get mode(){return footWeapon;},toggle:toggleFootWeapon,setMode(mode){if(mode!==footWeapon&&["pistol","smg"].includes(mode))toggleFootWeapon();return footWeapon;},fireAt({clientX,clientY}={}){return footBurst(clientX,clientY);}};
  globalThis.__arondightDroneWeapons={get mode(){return droneWeapon;},toggle:toggleDroneWeapon,setMode(mode){if(mode!==droneWeapon&&["gun","missile"].includes(mode))toggleDroneWeapon();return droneWeapon;},fireMissile({clientX,clientY,source="external"}={}){return launchMissile(clientX,clientY,performance.now(),source);}};
}
let lastFrame=performance.now();
function frame(now=performance.now()){const dt=clamp((now-lastFrame)/1000,.001,.05);lastFrame=now;ensureControls();patchWeaponVisual();updateFlash();updateMissiles(now,dt);updateBlasts(now);animatePedestrians(now,dt);const view=viewport();if(view){view.dataset.gameplayFinalRuntime="weapons+blast+pedestrians+input-v2";view.dataset.worldSatelliteDefault="off";view.dataset.weaponSwitchInputs="touch+keyboard-q+xbox-dpad-right-v2";view.dataset.droneWeaponMode=droneWeapon;}requestAnimationFrame(frame);}

export function installGameplayFinalRuntime(){
  if(installed)return;installed=true;installStyle();installApis();for(const type of["pointerdown","pointermove","pointerup","pointercancel"])document.addEventListener(type,inputCapture,{capture:true,passive:false});addEventListener("arondight:world-explosion",applyBlast);addEventListener(AUDIO_SETTINGS_EVENT,event=>audioSettings=normalizeAudioSettings(event.detail||loadAudioSettings()));addEventListener("keydown",event=>{if(event.code!=="KeyQ"||event.repeat)return;if(isFoot())toggleFootWeapon();else if(isDrone())toggleDroneWeapon();});requestAnimationFrame(frame);
}

installGameplayFinalRuntime();
