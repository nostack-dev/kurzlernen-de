import * as THREE from "three";
import {Box3dHitscanWorld} from "./box3d_hitscan.mjs";
import {AUDIO_SETTINGS_EVENT,loadAudioSettings,normalizeAudioSettings} from "./audio_settings.mjs";
import {getSharedCombatAudioContext,playCombatAudio} from "./combat_audio_bank.mjs";
import {wantedLineBlockedByPrisms} from "./wanted_system_logic.mjs";
import {groundHeightAt} from "./terrain_craters.mjs";

const IMAGERY_KEY="arondight45WorldImageryV1";
const FOOT_WEAPON_KEY="arondight45FootWeaponV1";
const DRONE_WEAPON_KEY="arondight45DroneWeaponV1";
const BLAST_RADIUS_M=8;
const BLAST_MAX_DAMAGE=100;
const BLAST_OCCLUDED_SCALE=.18;
const MISSILE_TTL_MS=4200;
const GRENADE_TTL_MS=5600;
const GRENADE_FUSE_MS=2800;
const GRENADE_COOLDOWN_MS=760;
const GRENADE_SPEED_MPS=32;
const GRENADE_GRAVITY_MPS2=9.81;
const GRENADE_RESTITUTION=.58;
const GRENADE_SURFACE_DAMPING=.88;
const GRENADE_MAX_BOUNCES=7;
const GRENADE_BASE_RADIUS_M=.039;
const GRENADE_VISUAL_SCALE=1.35;
const GRENADE_RADIUS_M=GRENADE_BASE_RADIUS_M*GRENADE_VISUAL_SCALE;
const GRENADE_FLOOR_NORMAL_Z=.58;
const GRENADE_BLAST_RADIUS_M=8.5;
const GRENADE_MAX_DAMAGE=125;
const FOOT_WEAPON_ORDER=Object.freeze(["smg","glock","grenade"]);
const tmp=new THREE.Vector3(),tmp2=new THREE.Vector3(),tmp3=new THREE.Vector3(),right=new THREE.Vector3(),forward=new THREE.Vector3(),ndc=new THREE.Vector2();
const shotCamera=new THREE.PerspectiveCamera(78,16/9,.01,500),shotRaycaster=new THREE.Raycaster(),boxHits=new Box3dHitscanWorld();
const tracerAxis=new THREE.Vector3(0,1,0),tracerVector=new THREE.Vector3(),grenadeAxis=new THREE.Vector3(0,0,-1),bounceFxAxis=new THREE.Vector3(0,0,1);
let installed=false,audioSettings=loadAudioSettings(),footWeapon=loadMode(FOOT_WEAPON_KEY,"smg",FOOT_WEAPON_ORDER),droneWeapon=loadMode(DRONE_WEAPON_KEY,"gun",["gun","missile"]),lastSmg=-Infinity,lastGlock=[-Infinity,-Infinity],lastGrenade=-Infinity,lastMissile=-Infinity;
let tracerScene=null,tracerPool=[],tracerCursor=0,blastScene=null,blastPool=[],blastCursor=0,bounceFxScene=null,bounceFxPool=[],bounceFxCursor=0,activeMovePointer=null,activeMoveElement=null,tap=null,lastPedScan=-Infinity,lastPedTelemetry=-Infinity,pedestrians=[],pedScanScene=null,pedScanStack=[],pedScanNext=[],pedScanSeen=new Set(),actorCacheScene=null,actorCacheAt=-Infinity,actorCachePhysicsReady=false,actorCache=[],grenadeOrganicCache=[],actorByPhysicsId=new Map();
const pedState=new WeakMap(),missiles=[],grenades=[];

function viewport(){return document.getElementById("viewport");}
function bridge(){return globalThis.__arondightRealWorld||null;}
function walk(){return globalThis.__arondightWalkMode||null;}
function rigid(){return globalThis.__arondightWorldRigidBodies||null;}
function drive(){return globalThis.__arondightVehicleDrive||null;}
function clamp(v,a,b){return Math.max(a,Math.min(b,Number(v)||0));}
function loadMode(key,fallback,allowed){try{const value=localStorage.getItem(key);return allowed.includes(value)?value:fallback;}catch{return fallback;}}
function saveMode(key,value){try{localStorage.setItem(key,value);}catch{}}
function effectiveVisible(node){for(let n=node;n;n=n.parent)if(n.visible===false)return false;return true;}
function isFoot(){return walk()?.mode==="foot"&&!drive()?.active&&!globalThis.__jetMode?.active;}
function isDrone(){return walk()?.mode!=="foot"&&!drive()?.active&&!globalThis.__jetMode?.active;}
function audioShot(gain=.22){if(!audioSettings.soundEnabled||audioSettings.shotsVolume<=0)return;const ctx=getSharedCombatAudioContext({resume:true});if(ctx)playCombatAudio(ctx,"shot",{gain:gain*audioSettings.shotsVolume/100,minIntervalMs:28});}
function audioGrenadeBounce(impactSpeed=8,bounceCount=0){if(!audioSettings.soundEnabled||audioSettings.fxVolume<=0)return;const ctx=getSharedCombatAudioContext({resume:true});if(ctx)playCombatAudio(ctx,"bounce",{gain:clamp(.16+impactSpeed*.018,.16,.44)*audioSettings.fxVolume/100,playbackRate:clamp(.92+bounceCount*.035+.02*Math.min(impactSpeed,10),.88,1.32),minIntervalMs:42});}
function weaponFired(weapon,intensity,source="runtime",mode=isFoot()?"foot":isDrone()?"drone":"vehicle"){window.dispatchEvent(new CustomEvent("arondight:weapon-fired",{detail:{weapon:String(weapon),intensity:clamp(intensity,0,.8),source:String(source),mode}}));}

try{if(localStorage.getItem(IMAGERY_KEY)===null)localStorage.setItem(IMAGERY_KEY,"0");}catch{}

function logicalPoint(clientX,clientY){
  const view=viewport(),screen=view?.getBoundingClientRect();if(!view||!screen)return null;
  const width=Math.max(1,view.clientWidth),height=Math.max(1,view.clientHeight),cx=Number.isFinite(clientX)?clientX:screen.left+screen.width/2,cy=Number.isFinite(clientY)?clientY:screen.top+screen.height/2,rotated=view.dataset.soloOrientation==="css-landscape",x=rotated?cy-screen.top:cx-screen.left,y=rotated?screen.right-cx:cy-screen.top;
  return{x:clamp(x,0,width),y:clamp(y,0,height),width,height,screen};
}
function footRay(clientX,clientY){
  // Exact: cast through the camera as it was presented on screen.
  const exact=globalThis.__arondightFirstPersonController?.screenRay?.(clientX,clientY);if(exact)return exact;
  const w=walk(),p=logicalPoint(clientX,clientY);if(!w?.position||!p)return null;
  shotCamera.fov=clamp(Number(viewport()?.dataset.walkCameraFovDeg)||Number(bridge()?.threeCamera?.fov)||78,45,120);shotCamera.aspect=p.width/p.height;shotCamera.near=.01;shotCamera.far=220;shotCamera.position.set(Number(w.position.x)||0,Number(w.position.y)||0,Number(w.position.z)||1.68);shotCamera.up.set(0,0,1);
  const cp=Math.cos(Number(w.pitch)||0);forward.set(Math.sin(Number(w.yaw)||0)*cp,Math.cos(Number(w.yaw)||0)*cp,Math.sin(Number(w.pitch)||0)).normalize();shotCamera.lookAt(tmp.copy(shotCamera.position).add(forward));shotCamera.updateProjectionMatrix();shotCamera.updateMatrixWorld(true);ndc.set(p.x/p.width*2-1,1-p.y/p.height*2);shotRaycaster.setFromCamera(ndc,shotCamera);return{origin:shotRaycaster.ray.origin.clone(),direction:shotRaycaster.ray.direction.clone(),point:p};
}
function droneRay(clientX,clientY){const camera=bridge()?.threeCamera,p=logicalPoint(clientX,clientY);if(!camera||!p)return null;ndc.set(p.x/p.width*2-1,1-p.y/p.height*2);shotRaycaster.setFromCamera(ndc,camera);return{origin:shotRaycaster.ray.origin.clone(),direction:shotRaycaster.ray.direction.clone(),point:p};}
function refreshActorCache(scene,physicsReady,now=performance.now()){if(scene===actorCacheScene&&physicsReady===actorCachePhysicsReady&&now-actorCacheAt<180)return;actorCacheScene=scene;actorCachePhysicsReady=physicsReady;actorCacheAt=now;actorCache=[];grenadeOrganicCache=[];actorByPhysicsId=new Map();scene?.traverse?.(node=>{if(!node?.isMesh)return;const u=node.userData||{},kind=String(u.worldPopulationKind||u.worldLifeKind||""),decor=String(u.worldDecorKind||""),id=String(u.worldPopulationId||u.worldProceduralId||"");if(id){const existing=actorByPhysicsId.get(id);if(!existing||Number.isInteger(Number(u.policeDroneId)))actorByPhysicsId.set(id,node);}if(!effectiveVisible(node)||(node.material?.visible===false&&!node.userData?.hitProxy)||u.walkWeaponPart||u.arondightAirframe||u.localHumanAvatar||u.worldPopulationClone||u.neonEdge)return;if(decor==="ambient-animal"||decor.startsWith("tree-"))grenadeOrganicCache.push(node);if(u.flightFireIgnore||u.neonSkip)return;if(!kind&&!u.vsPeer&&!u.vsPlayerId)return;if(physicsReady&&(kind==="car"||kind==="bus"||kind==="police-drone"||u.gtaDrivableVehicle))return;actorCache.push(node);});const view=viewport();if(view){view.dataset.walkProjectileActorCache=String(actorCache.length);view.dataset.walkGrenadeOrganicCache=String(grenadeOrganicCache.length);view.dataset.walkProjectileActorCacheMs="180";}}
function physicsSceneObject(id){const key=String(id||""),scene=bridge()?.threeScene;if(!key||!scene)return null;refreshActorCache(scene,Boolean(rigid()?.ready));return actorByPhysicsId.get(key)||null;}
function actorCandidates(scene,{physicsReady=false}={}){refreshActorCache(scene,physicsReady);return actorCache;}
function box3dProjectileHit(ray,maxDistance){
  const runtime=rigid(),o=[ray.origin.x,ray.origin.y,ray.origin.z],d=[ray.direction.x,ray.direction.y,ray.direction.z],hit=runtime?.raycast?.(o,d,maxDistance);
  if(hit?.point){const object=physicsSceneObject(hit.id,hit.kind);return{box3d:true,physics:true,physicsId:String(hit.id||""),physicsKind:String(hit.kind||"terrain"),distance:Number(hit.distanceM),point:new THREE.Vector3(...hit.point),worldNormal:new THREE.Vector3(...(hit.normal||[0,0,1])),object};}
  const b=bridge();if(!b?.active)return null;const fallback=boxHits.cast(o,d,maxDistance,b.buildingCollisionSnapshot);return fallback?{box3d:true,physics:false,physicsKind:"terrain",distance:fallback.distanceM,point:new THREE.Vector3(...fallback.point),worldNormal:new THREE.Vector3(...fallback.normal)}:null;
}
function nearestHit(ray,maxDistance=180){
  const scene=bridge()?.threeScene;if(!scene||!ray)return null;const physicsReady=Boolean(rigid()?.ready);shotRaycaster.set(ray.origin,ray.direction);shotRaycaster.near=.01;shotRaycaster.far=maxDistance;const sceneHit=shotRaycaster.intersectObjects(actorCandidates(scene,{physicsReady}),false)[0]||null,physicsHit=box3dProjectileHit(ray,maxDistance);
  return physicsHit&&(!sceneHit||physicsHit.distance<sceneHit.distance)?physicsHit:sceneHit;
}
function nearestGrenadeHit(ray,maxDistance){
  const scene=bridge()?.threeScene;if(!scene||!ray)return null;const base=nearestHit(ray,maxDistance);refreshActorCache(scene,Boolean(rigid()?.ready));shotRaycaster.set(ray.origin,ray.direction);shotRaycaster.near=.005;shotRaycaster.far=maxDistance;const organic=shotRaycaster.intersectObjects(grenadeOrganicCache,false)[0]||null;return organic&&(!base||organic.distance<Number(base.distance??Infinity))?organic:base;
}

function ensureTracerPool(scene){if(tracerScene===scene&&tracerPool.length)return;if(tracerScene)for(const group of tracerPool)group.parent?.remove(group);tracerScene=scene;tracerPool=[];const coreGeo=new THREE.CylinderGeometry(.017,.017,1,6),haloGeo=new THREE.CylinderGeometry(.06,.06,1,8),coreMat=new THREE.MeshBasicMaterial({color:0xfff6e0,transparent:true,opacity:1,depthTest:true,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false}),haloMat=new THREE.MeshBasicMaterial({color:0xff9a3c,transparent:true,opacity:.42,depthTest:true,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false});for(let i=0;i<24;i++){const group=new THREE.Group(),halo=new THREE.Mesh(haloGeo,haloMat),core=new THREE.Mesh(coreGeo,coreMat);for(const mesh of[halo,core]){mesh.frustumCulled=false;mesh.renderOrder=14;mesh.userData.flightFireIgnore=true;mesh.userData.flightFireTracer=true;}group.add(halo,core);group.visible=false;group.userData.flightFireIgnore=true;group.userData.flightFireTracer=true;group.userData.tracerState={start:new THREE.Vector3(),direction:new THREE.Vector3(),distance:0,born:0,speed:240,tailM:9,holdMs:130,impacted:false};scene.add(group);tracerPool.push(group);}
  // impact flashes at the end of every trail (Robo Recall-style: you always see where the round lands)
  const flashGeo=new THREE.SphereGeometry(1,10,8),flashMat=new THREE.MeshBasicMaterial({color:0xffd9a0,transparent:true,opacity:.9,depthTest:true,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false});impactPool=[];for(let i=0;i<16;i++){const m=new THREE.Mesh(flashGeo,flashMat.clone());m.visible=false;m.frustumCulled=false;m.renderOrder=15;m.userData.flightFireIgnore=true;m.userData.neonSkip=true;m.userData.born=0;scene.add(m);impactPool.push(m);}}
let tracerHand=0;
function showTracer(start,end){const scene=bridge()?.threeScene;if(!scene)return;if(isFoot()){try{window.dispatchEvent(new CustomEvent("arondight:foot-tracer",{detail:{start:[start.x,start.y,start.z],end:[end.x,end.y,end.z],weapon:footWeapon,hand:tracerHand}}));}catch{}}tracerHand=0;ensureTracerPool(scene);const group=tracerPool[tracerCursor++%tracerPool.length],state=group.userData.tracerState;tracerVector.copy(end).sub(start);const length=tracerVector.length();if(length<.03)return;state.start.copy(start);state.direction.copy(tracerVector).normalize();state.distance=length;state.born=performance.now();state.impacted=false;group.visible=true;group.scale.set(1,.02,1);const view=viewport();if(view)view.dataset.walkShotVisibility="moving-bullet-segment+phosphor-halo-v2";}
let impactPool=[],impactCursor=0;
function updateTracers(now){for(const group of tracerPool){if(!group.visible)continue;const state=group.userData.tracerState,elapsed=Math.max(0,(now-state.born)/1000),head=Math.min(state.distance,elapsed*state.speed),arrivedMs=now-state.born-state.distance/state.speed*1000,tail=Math.max(0,head-state.tailM),segment=Math.max(.02,head-tail),done=head>=state.distance&&arrivedMs>=state.holdMs;if(done){group.visible=false;continue;}
  if(head>=state.distance&&!state.impacted){state.impacted=true;const f=impactPool[impactCursor++%Math.max(1,impactPool.length)];if(f){f.position.copy(state.start).addScaledVector(state.direction,state.distance);f.userData.born=now;f.visible=true;}}
  const fade=head>=state.distance?Math.max(.05,1-arrivedMs/state.holdMs):1;const center=(head+tail)*.5;group.position.copy(state.start).addScaledVector(state.direction,center);group.quaternion.setFromUnitVectors(tracerAxis,state.direction);group.scale.set(fade,segment,fade);}
  for(const f of impactPool){if(!f.visible)continue;const t=(now-f.userData.born)/110;if(t>=1){f.visible=false;continue;}f.scale.setScalar(.06+.22*t);f.material.opacity=.95*(1-t);}}
function routeHit(hit){if(!hit)return false;
  if(hit.physicsKind==="animal"&&hit.physicsId){
    const p=hit.point,dir=shotRaycaster.ray.direction;
    return Boolean(globalThis.__ambientAnimals?.hit?.({id:hit.physicsId,point:p?[p.x,p.y,p.z]:null,origin:[shotRaycaster.ray.origin.x,shotRaycaster.ray.origin.y,shotRaycaster.ray.origin.z],direction:[dir.x,dir.y,dir.z],strength:1}));
  }
  const b=bridge(),object=hit.object||physicsSceneObject(hit.physicsId,hit.physicsKind),routed={...hit,object};if(hit.box3d&&!object)return false;const police=Boolean(b?.registerPoliceHit?.(routed)),population=!police&&Boolean(b?.registerWorldPopulationHit?.({...routed,playerAction:true})),versus=!police&&!population&&Boolean(b?.registerVsHit?.(routed));return police||population||versus;}
function addFallbackDecal(hit){if(!hit?.point)return;const b=bridge(),scene=b?.threeScene;if(!scene)return;const g=new THREE.CircleGeometry(.026,8),m=new THREE.MeshBasicMaterial({color:0x171717,transparent:true,opacity:.9,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-4,side:THREE.DoubleSide}),mesh=new THREE.Mesh(g,m),n=hit.worldNormal?.clone?.()||hit.face?.normal?.clone?.().transformDirection(hit.object?.matrixWorld)||new THREE.Vector3(0,0,1);mesh.position.copy(hit.point).addScaledVector(n.normalize(),.004);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),n);mesh.userData.flightFireIgnore=true;scene.add(mesh);setTimeout(()=>{scene.remove(mesh);g.dispose();m.dispose();},9000);}

export const SMG_INTERVAL_MS=55,GLOCK_MIN_INTERVAL_MS=110; // MP ~1090 rpm
let cachedWeaponGun=null,cachedMuzzleFlash=null,cachedMuzzleFlashLeft=null;
// Muzzle flash: a hot star burst facing down the barrel (randomised spikes,
// white-hot core fading to orange), two crossed side flames licking forward,
// plus a sparse spark spray — shader-drawn, additive, new shape every shot.
const FLASH_STAR_FS=`uniform float uSeed,uFade;varying vec2 vUv;
void main(){vec2 p=vUv*2.-1.;float r=length(p),a=atan(p.y,p.x);
float sp=pow(abs(cos(a*2.5+uSeed)),14.)+.75*pow(abs(cos(a*4.+uSeed*2.3)),26.)+.5*pow(abs(cos(a*7.+uSeed*5.1)),40.);
float star=clamp(1.-r/(.18+.82*clamp(sp,0.,1.)),0.,1.);float core=exp(-r*r*26.);
float i=(core*1.9+star*star*1.25)*uFade;vec3 c=mix(vec3(1.,.42,.08),vec3(1.,.96,.82),clamp(core*1.6+star*.35,0.,1.));
gl_FragColor=vec4(c*i,1.);}`;
const FLASH_SIDE_FS=`uniform float uSeed,uFade;varying vec2 vUv;
void main(){float x=vUv.x,y=vUv.y*2.-1.;float w=(1.-x)*(.42+.18*sin(x*17.+uSeed*7.))+.05;
float body=smoothstep(w,w*.15,abs(y))*pow(1.-x,1.25);float lick=.65+.35*sin(x*31.+uSeed*11.+y*6.);
float i=body*lick*1.5*uFade;vec3 c=mix(vec3(1.,.38,.06),vec3(1.,.93,.75),clamp((1.-x)*(1.-abs(y)/max(w,.01))*1.3,0.,1.));
gl_FragColor=vec4(c*i,1.);}`;
const FLASH_VS=`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
function flashMaterial(fs){return new THREE.ShaderMaterial({uniforms:{uSeed:{value:0},uFade:{value:0}},vertexShader:FLASH_VS,fragmentShader:fs,transparent:true,depthTest:true,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide,toneMapped:false});}
function makeMuzzleFlash(name){
  const custom=new THREE.Group();custom.name=name;custom.userData.neonSkip=true;custom.userData.flightFireIgnore=true;custom.userData.walkWeaponPart=true;
  const starMat=flashMaterial(FLASH_STAR_FS),sideMat=flashMaterial(FLASH_SIDE_FS);
  const star=new THREE.Mesh(new THREE.PlaneGeometry(.2,.2),starMat);star.position.z=-.012;
  const sideGeo=new THREE.PlaneGeometry(1,1);sideGeo.translate(.5,0,0);sideGeo.rotateY(Math.PI/2); // local x (0..1) -> -z (forward)
  const sideA=new THREE.Mesh(sideGeo,sideMat);sideA.scale.set(1,.11,.26);const sideB=new THREE.Mesh(sideGeo,sideMat);sideB.scale.set(1,.11,.26);sideB.rotation.z=Math.PI/2;
  const sparkGeo=new THREE.BufferGeometry(),sp=new Float32Array(14*3);for(let i=0;i<14;i++){const a=i*2.39996,r=.02+.05*((i*37)%11)/11;sp[i*3]=Math.cos(a)*r;sp[i*3+1]=Math.sin(a)*r;sp[i*3+2]=-.05-.22*((i*53)%13)/13;}sparkGeo.setAttribute("position",new THREE.BufferAttribute(sp,3));
  const sparks=new THREE.Points(sparkGeo,new THREE.PointsMaterial({color:0xffd27a,size:.012,transparent:true,opacity:1,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false}));
  for(const m of[star,sideA,sideB,sparks]){m.renderOrder=10001;m.frustumCulled=false;m.userData.flightFireIgnore=true;m.userData.walkWeaponPart=true;m.userData.neonSkip=true;m.userData.flashBaseOpacity=1;}
  custom.add(sideA,sideB,star,sparks);custom.visible=false;custom.userData.flashStartedAt=-Infinity;custom.userData.flashUntil=-Infinity;return custom;
}
function attachFlash(flash,node,scale=1){
  if(!flash||!node)return false;if(flash.parent!==node)node.add(flash);flash.position.set(0,0,0);if(!flash.visible)flash.rotation.set(0,0,flash.rotation.z);flash.userData.flashBase=scale;if(!flash.visible)flash.scale.setScalar(scale);return true;
}
function patchWeaponVisual(){
  const scene=bridge()?.threeScene;if(!scene)return;const gun=cachedWeaponGun?.parent?cachedWeaponGun:scene.getObjectByName?.("WALK_PISTOL_3D");if(!gun)return;cachedWeaponGun=gun;const legacy=gun.getObjectByName?.("WALK_MUZZLE_FLASH");
  if(legacy){legacy.parent?.remove(legacy);legacy.visible=false;legacy.traverse?.(n=>{if(n.isMesh&&n.material){n.material.depthTest=true;n.material.depthWrite=false;n.material.needsUpdate=true;}if(n.isMesh)n.renderOrder=9997;});}
  let custom=gun.getObjectByName?.("FINAL_MUZZLE_FLASH");if(!custom){custom=makeMuzzleFlash("FINAL_MUZZLE_FLASH");gun.add(custom);}cachedMuzzleFlash=custom;
  // the left flash lives on the scene-level left pistol: keep the one instance (re-creating it
  // every housekeeping tick left orphaned, still-visible flashes hanging at the gun)
  let leftFlash=cachedMuzzleFlashLeft||scene.getObjectByName?.("FINAL_MUZZLE_FLASH_LEFT");if(!leftFlash){leftFlash=makeMuzzleFlash("FINAL_MUZZLE_FLASH_LEFT");gun.add(leftFlash);}cachedMuzzleFlashLeft=leftFlash;
  let smg=gun.getObjectByName?.("FINAL_SMG_CONVERSION");
  if(!smg){smg=new THREE.Group();smg.name="FINAL_SMG_CONVERSION";const metal=new THREE.MeshStandardMaterial({color:0x222a30,roughness:.38,metalness:.62,depthTest:true,depthWrite:true}),dark=new THREE.MeshStandardMaterial({color:0x101418,roughness:.72,metalness:.15,depthTest:true,depthWrite:true});const add=(geo,mat,pos,rot=[0,0,0])=>{const m=new THREE.Mesh(geo,mat);m.position.set(...pos);m.rotation.set(...rot);m.renderOrder=10000;m.userData.flightFireIgnore=true;m.userData.walkWeaponPart=true;smg.add(m);};add(new THREE.BoxGeometry(.095,.085,.30),metal,[0,.002,-.31]);add(new THREE.CylinderGeometry(.014,.014,.26,10),dark,[0,.005,-.53],[Math.PI/2,0,0]);add(new THREE.BoxGeometry(.055,.18,.08),dark,[0,-.115,-.22],[.28,0,0]);add(new THREE.BoxGeometry(.06,.05,.20),dark,[0,-.015,-.06]);gun.add(smg);}
  smg.visible=footWeapon==="smg";
  const rightNode=gun.getObjectByName?.(footWeapon==="grenade"?"WALK_GRENADE_MUZZLE_NODE":footWeapon==="glock"?"WALK_GLOCK_MUZZLE_NODE":"WALK_SMG_MUZZLE_NODE"),leftNode=footWeapon==="glock"?scene.getObjectByName?.("WALK_GLOCK_MUZZLE_LEFT"):null;
  if(rightNode)attachFlash(custom,rightNode,footWeapon==="grenade"?1.45:footWeapon==="glock"?1.7:1);
  if(leftNode)attachFlash(leftFlash,leftNode,1.7);else leftFlash.visible=false;
  gun.userData.finalWeapon=footWeapon;const view=viewport();if(view){view.dataset.walkMuzzleDepth="depth-tested-viewmodel-occlusion-v2";view.dataset.walkWeaponViewmodelAlignment="camera-owned-sights-v2";view.dataset.walkMuzzleAnchor=rightNode?"dedicated-weapon-node-v1":"fallback";view.dataset.walkGlockMuzzleFx=footWeapon==="glock"&&leftNode?"independent-right+left-v3":"single";}
}
function resetFlashOpacity(flash){flash?.traverse?.(node=>{if(!node?.material||!Number.isFinite(node.userData?.flashBaseOpacity))return;if(node.material.uniforms?.uFade)node.material.uniforms.uFade.value=1;else node.material.opacity=node.userData.flashBaseOpacity;});}
function flashWeapon(duration=34,hand=0){
  const flash=footWeapon==="glock"&&hand===1?cachedMuzzleFlashLeft:cachedMuzzleFlash;if(!flash)return;const now=performance.now();flash.userData.flashStartedAt=now;flash.userData.flashUntil=now+duration;
  // every shot a different burst: roll, size, spike pattern
  flash.rotation.z=Math.random()*Math.PI*2;const k=.82+Math.random()*.42;flash.userData.flashScale=k;const seed=Math.random()*40;flash.traverse?.(n=>{if(n.material?.uniforms?.uSeed)n.material.uniforms.uSeed.value=seed;});resetFlashOpacity(flash);
}
function updateOneFlash(flash,now){
  if(!flash)return;if(!flash.parent){flash.visible=false;return;}const started=Number(flash.userData.flashStartedAt)||-Infinity,until=Number(flash.userData.flashUntil)||-Infinity,visible=isFoot()&&now<until;flash.visible=visible;if(!visible)return;
  const t=clamp((now-started)/Math.max(1,until-started),0,1),fade=(1-t)**1.6,grow=1+.35*t;flash.traverse?.(node=>{if(!node?.material||!Number.isFinite(node.userData?.flashBaseOpacity))return;if(node.material.uniforms?.uFade)node.material.uniforms.uFade.value=fade;else node.material.opacity=node.userData.flashBaseOpacity*fade;});const sc=(Number(flash.userData.flashScale)||1)*(Number(flash.userData.flashBase)||1)*grow;flash.scale.setScalar(sc);
}
function updateFlash(){const now=performance.now();updateOneFlash(cachedMuzzleFlash,now);updateOneFlash(cachedMuzzleFlashLeft,now);}
function footMuzzle(out,ray,hand=0){const scene=bridge()?.threeScene,node=scene?.getObjectByName?.(footWeapon==="grenade"?"WALK_GRENADE_MUZZLE_NODE":footWeapon==="glock"&&hand===1?"WALK_GLOCK_MUZZLE_LEFT":footWeapon==="glock"?"WALK_GLOCK_MUZZLE_NODE":"WALK_SMG_MUZZLE_NODE");if(node?.getWorldPosition){node.updateWorldMatrix?.(true,false);node.getWorldPosition(out);return out;}const muzzle=footWeapon==="glock"&&hand===1?cachedMuzzleFlashLeft:cachedMuzzleFlash;if(muzzle?.getWorldPosition){muzzle.updateWorldMatrix?.(true,false);muzzle.getWorldPosition(out);return out;}right.set(ray.direction.y,-ray.direction.x,0).normalize();return out.copy(ray.origin).addScaledVector(ray.direction,.34).addScaledVector(right,hand===1?-.20:.20).add(new THREE.Vector3(0,0,-.16));}

function makeGrenade(scene,start,direction){
  const group=new THREE.Group(),shell=new THREE.MeshStandardMaterial({color:0x102018,roughness:.36,metalness:.52}),core=new THREE.MeshBasicMaterial({color:0xffb347,toneMapped:false}),haloMat=new THREE.MeshBasicMaterial({color:0x00ff66,transparent:true,opacity:.24,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false});
  const body=new THREE.Mesh(new THREE.SphereGeometry(GRENADE_BASE_RADIUS_M,12,8),shell),bandA=new THREE.Mesh(new THREE.TorusGeometry(GRENADE_BASE_RADIUS_M*1.02,.0048,6,18),core),bandB=new THREE.Mesh(new THREE.TorusGeometry(GRENADE_BASE_RADIUS_M*1.02,.0037,6,18),core),halo=new THREE.Mesh(new THREE.SphereGeometry(GRENADE_BASE_RADIUS_M*1.28,10,7),haloMat);
  bandA.rotation.x=Math.PI/2;bandB.rotation.y=Math.PI/2;for(const node of[body,bandA,bandB,halo]){node.userData.flightFireIgnore=true;node.userData.walkWeaponPart=true;}group.userData.flightFireIgnore=true;group.userData.walkGrenadeProjectile=true;group.userData.walkGrenadeVisual="round-phosphor-orb-115pct-v1";group.add(halo,body,bandA,bandB);group.scale.setScalar(GRENADE_VISUAL_SCALE);group.position.copy(start);group.quaternion.setFromUnitVectors(grenadeAxis,direction);scene.add(group);return group;
}
function launchFootGrenade(clientX,clientY,now=performance.now(),source="foot-screen"){
  // Remote detonation: while a round is still flying / bouncing, the next tap
  // fires the clacker in the left hand instead of launching — boom, right now.
  if(isFoot()&&!walk()?.dead&&grenades.length){for(let i=grenades.length-1;i>=0;i--)detonateFootGrenade(i,grenades[i].group.position.clone(),"remote");lastGrenade=now-GRENADE_COOLDOWN_MS*.5;try{window.dispatchEvent(new CustomEvent("arondight:grenade-detonator",{detail:{fired:true}}));}catch{}const v=viewport();if(v)v.dataset.walkGrenadeRemoteDetonations=String((Number(v.dataset.walkGrenadeRemoteDetonations)||0)+1);return true;}
  if(!isFoot()||walk()?.dead||now-lastGrenade<GRENADE_COOLDOWN_MS)return false;const ray=footRay(clientX,clientY),scene=bridge()?.threeScene;if(!ray||!scene)return false;lastGrenade=now;const start=footMuzzle(tmp2,ray).clone().addScaledVector(ray.direction,.10),direction=ray.direction.clone().normalize(),group=makeGrenade(scene,start,direction);grenades.push({group,scene,velocity:direction.clone().multiplyScalar(GRENADE_SPEED_MPS),born:now,fuseAt:now+GRENADE_FUSE_MS,bounces:0,nextCollisionAt:0,resting:false,source});flashWeapon(62);audioShot(.34);weaponFired("grenade",.62,source,"foot");const view=viewport();if(view){view.dataset.walkWeapon="grenade";view.dataset.walkGrenadeLaunches=String((Number(view.dataset.walkGrenadeLaunches)||0)+1);view.dataset.walkGrenadeBallistics="spring-orb-floor-bounce+impact-fuse-v3";view.dataset.walkGrenadeFuseMs=String(GRENADE_FUSE_MS);view.dataset.walkGrenadeProjectileSpeedMps=String(GRENADE_SPEED_MPS);view.dataset.walkGrenadeVisualScale=String(GRENADE_VISUAL_SCALE);view.dataset.walkGrenadeShape="round-phosphor-orb-v1";}return true;
}
function detonateFootGrenade(index,position,reason="fuse"){
  const grenade=grenades[index];if(!grenade)return false;grenade.scene.remove(grenade.group);grenades.splice(index,1);dispatchExplosion(position,{kind:"grenade",radiusM:GRENADE_BLAST_RADIUS_M,maxDamage:GRENADE_MAX_DAMAGE,source:grenade.source||"foot-grenade",targeted:false,impactReason:reason});
  const view=viewport();if(view){view.dataset.walkGrenadesActive=String(grenades.length);view.dataset.walkGrenadeLastDetonation=reason;if(reason==="wall")view.dataset.walkGrenadeBuildingDamage="impact-explosion-at-wall-v1";}return true;
}
function grenadeHitNormal(hit,out){if(hit?.worldNormal?.lengthSq?.()>1e-8)return out.copy(hit.worldNormal).normalize();if(hit?.face?.normal&&hit?.object?.matrixWorld)return out.copy(hit.face.normal).transformDirection(hit.object.matrixWorld).normalize();return out.set(0,0,1);}
function grenadeSurfaceKind(hit){
  for(let node=hit?.object;node;node=node.parent){const u=node.userData||{},decor=String(u.worldDecorKind||""),kind=String(u.worldPopulationKind||u.worldLifeKind||"");if(decor)return decor;if(kind)return kind;if(u.vsHumanAvatar||u.vsPlayerId)return"human";}
  return String(hit?.physicsKind||"");
}
function grenadeImpactMode(hit,normal){
  const kind=grenadeSurfaceKind(hit).toLowerCase();if(kind.includes("person")||kind.includes("human")||kind.includes("animal")||kind.startsWith("tree-"))return"organic";
  if(kind==="car"||kind==="bus"||kind.includes("drone")||kind==="vehicle")return"target";
  return Number(normal?.z)>=GRENADE_FLOOR_NORMAL_Z?"floor":"wall";
}
function ensureGrenadeBounceFxPool(scene){
  if(bounceFxScene===scene&&bounceFxPool.length)return;if(bounceFxScene)for(const item of bounceFxPool)item.group.parent?.remove(item.group);bounceFxScene=scene;bounceFxPool=[];
  const ringGeo=new THREE.RingGeometry(.040,.058,20),flashGeo=new THREE.SphereGeometry(.020,7,5);
  for(let i=0;i<8;i++){const group=new THREE.Group(),ring=new THREE.Mesh(ringGeo,new THREE.MeshBasicMaterial({color:0xffb347,transparent:true,opacity:0,depthTest:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,toneMapped:false})),flash=new THREE.Mesh(flashGeo,new THREE.MeshBasicMaterial({color:0xf4fff8,transparent:true,opacity:0,depthTest:true,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false}));for(const mesh of[ring,flash]){mesh.userData.flightFireIgnore=true;mesh.userData.walkWeaponPart=true;mesh.frustumCulled=false;}group.add(ring,flash);group.visible=false;group.userData.flightFireIgnore=true;group.userData.walkWeaponPart=true;scene.add(group);bounceFxPool.push({group,ring,flash,born:0,until:0,strength:1});}
}
function spawnGrenadeBounceFx(point,normal,impactSpeed){
  const scene=bridge()?.threeScene;if(!scene)return;ensureGrenadeBounceFxPool(scene);const item=bounceFxPool[bounceFxCursor++%bounceFxPool.length],now=performance.now(),strength=clamp(impactSpeed/12,.55,1.35);item.group.position.copy(point).addScaledVector(normal,.008);item.group.quaternion.setFromUnitVectors(bounceFxAxis,normal);item.group.scale.setScalar(1);item.group.visible=true;item.born=now;item.until=now+180;item.strength=strength;item.ring.material.opacity=.72;item.flash.material.opacity=.95;
}
function updateGrenadeBounceFx(now){
  for(const item of bounceFxPool){if(!item.group.visible)continue;if(now>=item.until){item.group.visible=false;continue;}const t=clamp((now-item.born)/(item.until-item.born),0,1),e=1-(1-t)**3;item.ring.scale.setScalar(item.strength*(.75+3.1*e));item.flash.scale.setScalar(item.strength*(1+.7*e));item.ring.material.opacity=.72*(1-t)**1.35;item.flash.material.opacity=.95*(1-t)**2.2;}
}
function bounceFootGrenade(g,point,normal,now){
  const n=normal.normalize(),impactSpeed=g.velocity.length();if(g.velocity.dot(n)>0)n.multiplyScalar(-1);const vn=g.velocity.dot(n);if(vn<0)g.velocity.addScaledVector(n,-(1+GRENADE_RESTITUTION)*vn);g.velocity.multiplyScalar(GRENADE_SURFACE_DAMPING);g.bounces=Math.min(GRENADE_MAX_BOUNCES,g.bounces+1);g.resting=false;g.nextCollisionAt=now+36;g.group.position.copy(point).addScaledVector(n,GRENADE_RADIUS_M+.014);const speed=g.velocity.length();if(speed>.05)g.group.position.addScaledVector(tmp3.copy(g.velocity).multiplyScalar(1/speed),.020);g.group.rotation.x+=.72;g.group.rotation.z+=((g.bounces&1)?.58:-.58);spawnGrenadeBounceFx(point,n,impactSpeed);audioGrenadeBounce(impactSpeed,g.bounces);if(g.bounces>=GRENADE_MAX_BOUNCES&&g.velocity.length()<2.8)g.velocity.multiplyScalar(.38);const view=viewport();if(view){view.dataset.walkGrenadeBounces=String(g.bounces);view.dataset.walkGrenadeBouncePhysics="spring-floor-only+impact-fuse-v3";view.dataset.walkGrenadeBounceAudio="prebaked-spring-bounce-v1";view.dataset.walkGrenadeBounceFx="pooled-phosphor-ring-v1";}
}
function updateFootGrenades(now,dt){
  for(let i=grenades.length-1;i>=0;i--){const g=grenades[i];if(now>=g.fuseAt||now-g.born>GRENADE_TTL_MS){detonateFootGrenade(i,g.group.position.clone(),"fuse");continue;}let removed=false;const substeps=Math.max(1,Math.min(4,Math.ceil(dt/.014))),stepDt=dt/substeps;
    for(let step=0;step<substeps;step++){if(g.resting){const ground=groundHeightAt(g.group.position.x,g.group.position.y)+GRENADE_RADIUS_M;g.group.position.z=ground;break;}g.velocity.z-=GRENADE_GRAVITY_MPS2*stepDt;let speed=g.velocity.length();if(speed<.05){const ground=groundHeightAt(g.group.position.x,g.group.position.y);if(g.group.position.z>ground+GRENADE_RADIUS_M+.08)g.velocity.z=-1.15;else{g.group.position.z=ground+GRENADE_RADIUS_M;g.velocity.set(0,0,0);g.resting=true;break;}speed=g.velocity.length();}
      const direction=tmp3.copy(g.velocity).multiplyScalar(1/Math.max(.001,speed)),travel=Math.max(.001,speed*stepDt);let hit=null;if(now>=g.nextCollisionAt)hit=nearestGrenadeHit({origin:g.group.position,direction},travel+GRENADE_RADIUS_M+.035);
      if(hit&&Number(hit.distance)<=travel+GRENADE_RADIUS_M+.018){const point=hit.point?.clone?.()||g.group.position.clone().addScaledVector(direction,Math.max(.01,Number(hit.distance)||.01)),normal=grenadeHitNormal(hit,tmp),mode=grenadeImpactMode(hit,normal);if(mode!=="floor"){detonateFootGrenade(i,point,mode);removed=true;break;}bounceFootGrenade(g,point,normal,now);continue;}
      tmp2.copy(g.group.position).addScaledVector(direction,travel);const ground=groundHeightAt(tmp2.x,tmp2.y),floorZ=ground+GRENADE_RADIUS_M;if(tmp2.z<=floorZ){tmp2.z=floorZ;const horizontal=Math.hypot(g.velocity.x,g.velocity.y),down=Math.abs(g.velocity.z);if(g.bounces>=3&&down<1.15&&horizontal<1.35){g.group.position.copy(tmp2);g.velocity.set(0,0,0);g.resting=true;break;}bounceFootGrenade(g,tmp2,tmp.set(0,0,1),now);continue;}g.group.position.copy(tmp2);g.group.quaternion.setFromUnitVectors(grenadeAxis,direction);g.group.rotation.z+=stepDt*11;}
    if(removed)continue;const groundNow=groundHeightAt(g.group.position.x,g.group.position.y);if(!g.resting&&g.group.position.z>groundNow+GRENADE_RADIUS_M+.12&&g.velocity.length()<.6)g.velocity.z=Math.min(g.velocity.z,-1.15);
  }
  const view=viewport();if(view){view.dataset.walkGrenadesActive=String(grenades.length);view.dataset.walkGrenadeAirStallRecovery="gravity+filtered-colliders+separation-v1";view.dataset.walkGrenadeImpactFuse="organic+wall+dynamic-target-v1";view.dataset.walkGrenadeFloorRule="upward-normal-bounces-v1";}
}
function footShotAt(clientX,clientY,now=performance.now(),hand=0){
  if(footWeapon==="grenade")return launchFootGrenade(clientX,clientY,now,"foot-screen");
  if(footWeapon==="glock")return glockShotAt(clientX,clientY,now,hand);
  if(!isFoot()||walk()?.dead||now-lastSmg<SMG_INTERVAL_MS-.5)return false;lastSmg=now; // `now` = the round's due time (the hold loop keeps the cadence)
  const ray=footRay(clientX,clientY);if(!ray)return false;const hit=nearestGrenadeHit(ray,180),end=hit?.point?.clone?.()||tmp.copy(ray.origin).addScaledVector(ray.direction,130).clone(),start=footMuzzle(tmp2,ray).clone();showTracer(start,end);{const routed=hit?routeHit(hit):false;if(globalThis.__worldImpacts)globalThis.__worldImpacts.bullet(ray,hit,{routed});else if(hit&&!routed)addFallbackDecal(hit);}flashWeapon(34);audioShot(.18);weaponFired("smg",.14,"foot-screen","foot");
  const view=viewport();if(view){view.dataset.walkWeapon="smg";view.dataset.walkTouchFire="screen-point-raycast-v2";view.dataset.walkPistolTracer="world-ray-muzzle-origin-v2";view.dataset.walkSmgAutoFire="always-on-hold-v1";view.dataset.walkEnhancedShots=String((Number(view.dataset.walkEnhancedShots)||0)+1);view.dataset.walkTouchAimX=ray.point.x.toFixed(1);view.dataset.walkTouchAimY=ray.point.y.toFixed(1);}return true;
}
// GOLDEN HAND CANNON (Glock): semi-auto, brutal. One round counts as six
// hits (one-shots people, cops and most SWAT), pierces up to three bodies,
// shoves cars and drones hard, leaves big impacts; walls stop it.
// Each pistol has its own trigger and cadence (fast double taps possible).
function glockShotAt(clientX,clientY,now,hand=0){
  const h=hand===1?1:0;if(!isFoot()||walk()?.dead||now-lastGlock[h]<GLOCK_MIN_INTERVAL_MS)return false;lastGlock[h]=now;
  const ray=footRay(clientX,clientY);if(!ray)return false;const start=footMuzzle(tmp2,ray,h).clone();let origin=ray.origin.clone(),remaining=240,pierced=0,end=null;
  while(pierced<3&&remaining>1){const r={origin,direction:ray.direction},hit=nearestGrenadeHit(r,remaining);
    if(!hit){end=origin.clone().addScaledVector(ray.direction,remaining);globalThis.__worldImpacts?.bullet(r,null,{maxDistance:remaining});break;}
    let routed=false;for(let i=0;i<6;i++)routed=routeHit(hit)||routed;
    globalThis.__worldImpacts?.bullet(r,hit,{routed});if(hit.point)globalThis.__worldImpacts?.chips?.(hit.point,ray.direction.clone().negate(),routed?"actor":"building",9,6);
    if(hit.physicsId)rigid()?.applyImpulse?.(hit.physicsId,[ray.direction.x*40,ray.direction.y*40,ray.direction.z*40],{point:[hit.point.x,hit.point.y,hit.point.z]});
    end=hit.point?.clone?.()||origin.clone().addScaledVector(ray.direction,Number(hit.distance)||10);
    if(!routed&&!hit.physicsId)break;pierced++;const d=Number(hit.distance)||origin.distanceTo(end);origin=end.clone().addScaledVector(ray.direction,.6);remaining-=d+.6;}
  tracerHand=h;showTracer(start,end||origin);flashWeapon(52,h);
  if(audioSettings.soundEnabled&&audioSettings.shotsVolume>0){const ctx=getSharedCombatAudioContext({resume:true});if(ctx)playCombatAudio(ctx,"pistol",{gain:.72*audioSettings.shotsVolume/100,playbackRate:1,minIntervalMs:0});}
  weaponFired("glock",.55,"foot-screen","foot");const view=viewport();if(view){view.dataset.walkWeapon="glock";view.dataset.walkGlockShots=String((Number(view.dataset.walkGlockShots)||0)+1);view.dataset.walkGlockLastHand=String(h);view.dataset.walkGlockMultitouch="one-pointer-one-pistol-v3";view.dataset.walkGlockMuzzleHand=String(h);}return true;
}
function footBurst(clientX,clientY){return footShotAt(clientX,clientY,performance.now());}

function ensureBlastPool(scene){if(blastScene===scene&&blastPool.length)return;if(blastScene)for(const item of blastPool)item.group.parent?.remove(item.group);blastScene=scene;blastPool=[];const sphere=new THREE.SphereGeometry(.45,10,7),ringGeo=new THREE.RingGeometry(.6,1,24);for(let i=0;i<8;i++){const group=new THREE.Group(),hot=new THREE.Mesh(sphere,new THREE.MeshBasicMaterial({color:0xff9b43,transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending})),ring=new THREE.Mesh(ringGeo,new THREE.MeshBasicMaterial({color:0xffd27a,transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending}));ring.rotation.x=Math.PI/2;group.add(hot,ring);group.visible=false;scene.add(group);blastPool.push({group,hot,ring,born:0,until:0});}}
function visualBlast(position,scale=1){const scene=bridge()?.threeScene;if(!scene)return;ensureBlastPool(scene);const item=blastPool[blastCursor++%blastPool.length],now=performance.now();item.group.position.copy(position);item.group.visible=true;item.born=now;item.until=now+540;item.scale=scale;item.hot.material.opacity=.9;item.ring.material.opacity=.78;}
function updateBlasts(now){for(const item of blastPool){if(!item.group.visible)continue;if(now>=item.until){item.group.visible=false;continue;}const t=(now-item.born)/(item.until-item.born),e=1-(1-t)**3;item.hot.scale.setScalar(item.scale*(.5+4.5*e));item.ring.scale.setScalar(item.scale*(.7+7*e));item.hot.material.opacity=.9*(1-t);item.ring.material.opacity=.78*(1-t)**1.6;}}
function dispatchExplosion(position,detail={}){visualBlast(position,1);window.dispatchEvent(new CustomEvent("arondight:world-explosion",{detail:{position:[position.x,position.y,position.z],radiusM:BLAST_RADIUS_M,maxDamage:BLAST_MAX_DAMAGE,kind:"missile",...detail}}));}

function missileTarget(ray){const hit=nearestHit(ray,220);return{hit,target:hit?.point?.clone?.()||tmp.copy(ray.origin).addScaledVector(ray.direction,105).clone(),object:hit&&!hit.box3d?hit.object:null};}
function launchMissile(clientX,clientY,now=performance.now(),source="pointer"){
  if(!isDrone()||globalThis.__arondightDroneDamageModel?.destroyed||now-lastMissile<950)return false;const view=viewport();if(view?.dataset.fireArmed!=="1")return false;const ray=droneRay(clientX,clientY),scene=bridge()?.threeScene;if(!ray||!scene)return false;
  lastMissile=now;const goal=missileTarget(ray),group=new THREE.Group(),body=new THREE.Mesh(new THREE.CylinderGeometry(.025,.032,.26,8),new THREE.MeshStandardMaterial({color:0xcfd7db,roughness:.35,metalness:.45})),tip=new THREE.Mesh(new THREE.ConeGeometry(.034,.09,8),new THREE.MeshBasicMaterial({color:0xffaa4a}));body.rotation.x=Math.PI/2;tip.rotation.x=Math.PI/2;tip.position.z=-.17;group.add(body,tip);group.position.copy(ray.origin).addScaledVector(ray.direction,.28);group.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,-1),ray.direction);for(const m of[body,tip])m.userData.flightFireIgnore=true;scene.add(group);missiles.push({group,velocity:ray.direction.clone().multiplyScalar(26),target:goal.target,object:goal.object,born:now,scene,source});audioShot(.34);
  weaponFired("missile",.42,source,"drone");if(view){view.dataset.droneWeapon="missile";view.dataset.droneMissiles=String((Number(view.dataset.droneMissiles)||0)+1);view.dataset.droneMissileGuidance="screen-target-homing+path-collision-v2";view.dataset.droneMissileInput=source;}return true;
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
  const d=event?.detail||{},p=Array.isArray(d.position)?d.position:null;if(!p||p.length<3)return;if(d.kind==="nuke")return;/* shock-timed nuke damage lives in nuke_destruction.mjs */const center=new THREE.Vector3(Number(p[0])||0,Number(p[1])||0,Number(p[2])||0),radius=clamp(d.radiusM??BLAST_RADIUS_M,2,18),maxDamage=clamp(d.maxDamage??BLAST_MAX_DAMAGE,10,160),sourceId=String(d.id||"");let impulses=0,damaged=0,occluded=0;const runtime=rigid(),engine=runtime?.engine;
  if(engine?.records)for(const record of engine.records.values()){if(record.id===sourceId)continue;const pose=runtime.pose?.(record.id),q=pose?.position;if(!q)continue;tmp2.set(q[0],q[1],q[2]);const dist=tmp2.distanceTo(center);if(dist>=radius)continue;const exposure=blastExposure(center,tmp2);if(exposure<1)occluded++;const f=blastFalloff(dist,radius)*Math.sqrt(exposure),dir=tmp3.copy(tmp2).sub(center);if(dir.lengthSq()<.001)dir.set(.2,0,1);dir.normalize();const mass=Math.max(.1,Number(record.massKg)||1),dv=(record.drone?6.2:3.1*Math.min(5,Math.max(.5,Math.cbrt(1350/mass))))*f,/* the blast pushes on the body's area (~ mass^2/3): light things (a dog) fly much faster than a car */impulse=[dir.x*mass*dv,dir.y*mass*dv,(dir.z+.32)*mass*dv];if(runtime.applyImpulse?.(record.id,impulse,{point:q}))impulses++;}
  // ragdolls (Box3D humans) are thrown as well: same area/mass law, a 70 kg body
  if(engine?.humans)for(const[hid,h]of engine.humans){const b=h.bodies?.[0];if(!b||!engine.b3.b3Body_IsValid(b))continue;const q=engine.b3.b3Body_GetPosition([0,0,0],b);tmp2.set(q[0],q[1],q[2]);const dist=tmp2.distanceTo(center);if(dist>=radius)continue;const f=blastFalloff(dist,radius)*Math.sqrt(blastExposure(center,tmp2)),dir=tmp3.copy(tmp2).sub(center);if(dir.lengthSq()<.001)dir.set(.2,0,1);dir.normalize();const dv=3.1*Math.cbrt(1350/70)*f;if(runtime.pushHuman?.(hid,[dir.x*dv,dir.y*dv,(dir.z+.32)*dv],8*f))impulses++;}
  const vitals=globalThis.__arondightPlayerVitals;for(const target of vitals?.damageTargets?.()||[]){const q=target.position;if(!q)continue;tmp2.set(Number(q.x)||0,Number(q.y)||0,Number(q.z)||0);const dist=tmp2.distanceTo(center);if(dist>=radius)continue;const exposure=blastExposure(center,tmp2);if(exposure<1)occluded++;const amount=maxDamage*blastFalloff(dist,radius)*exposure;if(amount>2){target.model?.damage?.(amount,`explosion:${d.kind||"world"}`);damaged++;}}
  const wanted=globalThis.__arondightWantedSystem,b=bridge();for(const drone of wanted?.drones||[]){if(!drone?.active||!drone.root)continue;drone.root.getWorldPosition?.(tmp2);const dist=tmp2.distanceTo(center);if(dist>=radius)continue;const exposure=blastExposure(center,tmp2);if(exposure<1)occluded++;const amount=maxDamage*blastFalloff(dist,radius)*exposure,hits=Math.min(3,Math.max(0,Math.round(amount/34)));for(let i=0;i<hits;i++)b?.registerPoliceHit?.({object:drone.hitbox||drone.root,point:tmp2.clone()});if(hits)damaged++;}
  const scene=b?.threeScene;if(scene&&typeof b?.registerWorldPopulationHit==="function")for(const[id,root]of populationRoots(scene)){if(id===sourceId||root.visible===false)continue;root.getWorldPosition(tmp2);const dist=tmp2.distanceTo(center);if(dist>=radius)continue;const exposure=blastExposure(center,tmp2);if(exposure<1)occluded++;const f=blastFalloff(dist,radius)*exposure,kind=String(root.userData?.worldPopulationKind||root.userData?.worldLifeKind||"").replace(/^life-/,"");let hits=kind==="person"?(f>.22?1:0):kind==="bus"?Math.ceil(f*4):kind==="car"?Math.ceil(f*5):f>.7?1:0;hits=Math.min(5,hits);const object=meshFor(root);for(let i=0;i<hits;i++)b.registerWorldPopulationHit({object,point:tmp2.clone()});if(hits)damaged++;}
  // other players (their body or their drone, whichever is closer): one authoritative hit each, scaled like any other target
  const mp=globalThis.__arondightVsMultiplayer;if(mp?.connected&&!d.remote)for(const pl of globalThis.__arondightPlayerVehicleRuntime?.remotePlayers?.()||[]){let best=null,bd=Infinity;for(const q of[pl.body,pl.drone]){if(!q)continue;tmp2.set(q[0],q[1],q[2]);const dd=tmp2.distanceTo(center);if(dd<bd){bd=dd;best=q;}}if(!best||bd>=radius)continue;tmp2.set(best[0],best[1],best[2]);const exposure=blastExposure(center,tmp2);if(exposure<1)occluded++;const amount=maxDamage*blastFalloff(bd,radius)*exposure;if(amount>2&&mp.blastHit(pl.id,amount))damaged++;}
  const view=viewport();if(view){view.dataset.explosionPhysics="box3d-radial-impulse+damage-falloff-v2";view.dataset.explosionRadiusM=radius.toFixed(1);view.dataset.explosionLastImpulses=String(impulses);view.dataset.explosionLastDamaged=String(damaged);view.dataset.explosionOccludedTargets=String(occluded);view.dataset.explosionDamageFalloff="smoothstep-radial-v2";view.dataset.explosionOcclusion="building-prism-los-v2";}
}

function ensureControls(){const view=viewport();if(!view)return;let foot=document.getElementById("footWeaponToggle");if(!foot){foot=document.createElement("button");foot.id="footWeaponToggle";foot.type="button";foot.addEventListener("pointerdown",e=>{e.preventDefault();e.stopPropagation();toggleFootWeapon();});view.appendChild(foot);}let drone=document.getElementById("droneWeaponToggle");if(!drone){drone=document.createElement("button");drone.id="droneWeaponToggle";drone.type="button";drone.addEventListener("pointerdown",e=>{e.preventDefault();e.stopPropagation();toggleDroneWeapon();});view.appendChild(drone);}foot.textContent=footWeapon==="smg"?"MP · GRENADE":"GRENADE · MP";drone.textContent=droneWeapon==="gun"?"GUN · MISSILE":"MISSILE · GUN";foot.hidden=!isFoot();drone.hidden=!isDrone();view.dataset.walkWeapon=footWeapon;view.dataset.droneWeapon=droneWeapon;}
function setFootWeapon(mode){const next=String(mode);if(!FOOT_WEAPON_ORDER.includes(next))return footWeapon;footWeapon=next;saveMode(FOOT_WEAPON_KEY,footWeapon);patchWeaponVisual();ensureControls();return footWeapon;}
function toggleFootWeapon(){const index=FOOT_WEAPON_ORDER.indexOf(footWeapon);return setFootWeapon(FOOT_WEAPON_ORDER[(index+1)%FOOT_WEAPON_ORDER.length]);}
function toggleDroneWeapon(){droneWeapon=droneWeapon==="gun"?"missile":"gun";saveMode(DRONE_WEAPON_KEY,droneWeapon);ensureControls();return droneWeapon;}

function forceMoveRelease(reason="recovery"){
  if(activeMovePointer===null||!activeMoveElement)return false;try{activeMoveElement.dispatchEvent(new PointerEvent("pointercancel",{bubbles:true,cancelable:true,pointerId:activeMovePointer,pointerType:"touch"}));}catch{}const knob=activeMoveElement.querySelector?.(".knob");if(knob){knob.style.left="50%";knob.style.top="50%";}activeMovePointer=null;activeMoveElement=null;const view=viewport();if(view){view.dataset.walkMoveStickRecovery=reason;view.dataset.walkMoveStickRecoveries=String((Number(view.dataset.walkMoveStickRecoveries)||0)+1);}return true;
}
function inputCapture(event){
  const target=event.target instanceof Element?event.target:null;if(event.type==="pointerdown"&&target?.closest("#footMove")){activeMovePointer=event.pointerId;activeMoveElement=target.closest("#footMove");}
  if((event.type==="pointerup"||event.type==="pointercancel")&&event.pointerId===activeMovePointer){activeMovePointer=null;activeMoveElement=null;}
  if(event.type==="pointerdown"&&isFoot()&&event.pointerType!=="mouse"&&target?.closest("#footLookZone")){tap={id:event.pointerId,x:event.clientX,y:event.clientY,lastX:event.clientX,lastY:event.clientY,at:performance.now(),moved:false};}
  if(event.type==="pointermove"&&tap&&event.pointerId===tap.id){tap.lastX=event.clientX;tap.lastY=event.clientY;if(Math.hypot(event.clientX-tap.x,event.clientY-tap.y)>9)tap.moved=true;}
  if((event.type==="pointerup"||event.type==="pointercancel")&&tap&&event.pointerId===tap.id){const t=tap;tap=null;if(event.type==="pointerup"&&!t.moved&&performance.now()-t.at<260)footBurst(t.lastX,t.lastY);}
  if(event.type==="pointerdown"&&isDrone()&&droneWeapon==="missile"&&event.button===0&&!target?.closest("#worldLookHud,#soloTopbar,#soloLeft,#soloRight,#soloClearance,.solo-action,.phone-settings-dialog,#wantedEmpButton,#droneWeaponToggle,dialog,button,input,select,textarea,a,label")){event.preventDefault();event.stopImmediatePropagation();launchMissile(event.clientX,event.clientY,performance.now(),event.pointerType||"pointer");}
}

function beginPedestrianScan(scene){pedScanScene=scene;pedScanStack.length=0;pedScanNext.length=0;pedScanSeen.clear();pedScanStack.push(scene);}
function stepPedestrianScan(deadline){
  while(pedScanStack.length&&performance.now()<deadline){
    const node=pedScanStack.pop();if(!node)continue;const children=node.children||[];for(let i=children.length-1;i>=0;i--)pedScanStack.push(children[i]);
    if(!children.length)continue;const kind=String(node.userData?.worldPopulationKind||node.userData?.worldLifeKind||"");if(kind!=="person"&&kind!=="life-person")continue;
    const id=String(node.userData?.worldPopulationId||node.userData?.worldLifeId||"");if(!id||pedScanSeen.has(id))continue;pedScanSeen.add(id);const limbs=[];
    for(const child of children){if(!child?.isMesh)continue;const type=String(child.geometry?.type||""),z=Number(child.position.z)||0;if(!type.includes("Box"))continue;if(z<.8||z>.82&&z<1.38)limbs.push({mesh:child,base:child.rotation.y,leg:z<.8,side:Math.sign(Number(child.position.y)||1)});}
    if(limbs.length)pedScanNext.push({id,root:node,limbs});
  }
  if(pedScanStack.length)return false;pedestrians=pedScanNext.slice();pedScanScene=null;return true;
}
function scanPedestrians(now){const scene=bridge()?.threeScene;if(!scene)return;if(pedScanScene&&pedScanScene!==scene){pedScanScene=null;pedScanStack.length=0;}if(!pedScanScene&&now-lastPedScan>=850){lastPedScan=now;beginPedestrianScan(scene);}if(pedScanScene)stepPedestrianScan(performance.now()+.75);}
function animatePedestrians(now,dt){scanPedestrians(now);let moving=0;for(const p of pedestrians){if(!p.root?.parent||p.root.visible===false)continue;let s=pedState.get(p.root);if(!s){s={x:p.root.position.x,y:p.root.position.y,phase:(p.id.length%7)*.7};pedState.set(p.root,s);}const speed=Math.hypot(p.root.position.x-s.x,p.root.position.y-s.y)/Math.max(.001,dt);s.x=p.root.position.x;s.y=p.root.position.y;const weight=clamp((speed-.08)/1.2,0,1);if(weight>.05){s.phase+=dt*(5.5+speed*2.4);moving++;}const swing=Math.sin(s.phase)*.48*weight;for(const limb of p.limbs)limb.mesh.rotation.y=limb.base+(limb.leg?1:-.82)*limb.side*swing;}if(now-lastPedTelemetry>=250){lastPedTelemetry=now;const view=viewport();if(view){view.dataset.pedestrianAnimation="procedural-arm-leg-walkcycle-v2";view.dataset.pedestriansWalking=String(moving);view.dataset.pedestrianTelemetry="250ms";}}}

function installStyle(){if(document.querySelector("style[data-gameplay-final-runtime]"))return;const style=document.createElement("style");style.dataset.gameplayFinalRuntime="v2";style.textContent=`
#footFire{display:block!important;width:64px!important;height:64px!important;right:calc(max(10px,var(--solo-safe-right,env(safe-area-inset-right))) + min(25vw,148px) + 12px)!important;bottom:max(16px,calc(var(--solo-safe-bottom,env(safe-area-inset-bottom)) + 12px))!important;font-size:9px!important;border-width:1px!important;opacity:.92!important;box-shadow:0 5px 16px #0008,0 0 0 3px #ffb34a18!important}
#footLookZone::after{display:none!important}
#footWeaponToggle,#droneWeaponToggle{position:absolute;z-index:21;bottom:max(18px,calc(var(--solo-safe-bottom,env(safe-area-inset-bottom)) + 10px));left:50%;transform:translateX(-50%);min-width:112px;height:32px;padding:0 10px;border:1px solid #ffffff4a;border-radius:9px;background:#0a1826e8;color:#eaf7ff;font:900 8px/1 system-ui;letter-spacing:.05em;box-shadow:0 4px 14px #0007;touch-action:manipulation}#footWeaponToggle{border-color:#ffd27a77;color:#ffe9b9}#droneWeaponToggle{border-color:#7cdfff77;color:#c9f4ff}#footWeaponToggle[hidden],#droneWeaponToggle[hidden]{display:none!important}@media(max-height:340px){#footFire{width:54px!important;height:54px!important;right:calc(max(8px,var(--solo-safe-right,env(safe-area-inset-right))) + min(22vw,124px) + 8px)!important;bottom:max(8px,var(--solo-safe-bottom,env(safe-area-inset-bottom)))!important}#footWeaponToggle,#droneWeaponToggle{height:28px;min-width:102px;font-size:7px;bottom:max(8px,var(--solo-safe-bottom,env(safe-area-inset-bottom)))}}
`;document.head.appendChild(style);}

function installApis(){
  globalThis.__arondightFootWeapons={get mode(){return footWeapon;},get automatic(){return footWeapon==="smg";},toggle:toggleFootWeapon,setMode:setFootWeapon,fireAt({clientX,clientY,source="external",hand=0,at=null}={}){const t=Number.isFinite(at)?at:performance.now();return footWeapon==="grenade"?launchFootGrenade(clientX,clientY,t,source):footShotAt(clientX,clientY,t,hand);}};
  globalThis.__arondightDroneWeapons={get mode(){return droneWeapon;},toggle:toggleDroneWeapon,setMode(mode){if(mode!==droneWeapon&&["gun","missile"].includes(mode))toggleDroneWeapon();return droneWeapon;},fireMissile({clientX,clientY,source="external"}={}){return launchMissile(clientX,clientY,performance.now(),source);}};
}
let lastFrame=performance.now(),lastHousekeeping=-Infinity;
function frame(now=performance.now()){const dt=clamp((now-lastFrame)/1000,.001,.05);lastFrame=now;if(now-lastHousekeeping>=250){lastHousekeeping=now;ensureControls();patchWeaponVisual();const view=viewport();if(view)view.dataset.droneWeaponMode=droneWeapon;}updateFlash();updateTracers(now);updateMissiles(now,dt);updateFootGrenades(now,dt);updateGrenadeBounceFx(now);updateBlasts(now);animatePedestrians(now,dt);requestAnimationFrame(frame);}

export function installGameplayFinalRuntime(){
  if(installed)return;installed=true;installStyle();installApis();ensureControls();patchWeaponVisual();const view=viewport();if(view){view.dataset.gameplayFinalRuntime="weapons+blast+pedestrians+input-v2";view.dataset.worldSatelliteDefault="off";view.dataset.walkMoveStickRelease="pointerup+cancel+lostcapture+blur+visibility+pagehide+orientation-v2";view.dataset.weaponSwitchInputs="touch+keyboard-q+xbox-dpad-right-v2";view.dataset.droneWeaponMode=droneWeapon;view.dataset.walkProjectileCollision="box3d-rigid+three-nonrigid-v1";}for(const type of["pointerdown","pointermove","pointerup","pointercancel"])document.addEventListener(type,inputCapture,{capture:true,passive:false});document.addEventListener("lostpointercapture",()=>forceMoveRelease("lostpointercapture"),true);addEventListener("blur",()=>forceMoveRelease("window-blur"));addEventListener("pagehide",()=>forceMoveRelease("pagehide"));addEventListener("orientationchange",()=>forceMoveRelease("orientationchange"));document.addEventListener("visibilitychange",()=>{if(document.hidden)forceMoveRelease("visibility-hidden");});addEventListener("arondight:player-mode",()=>forceMoveRelease("mode-change"));addEventListener("arondight:world-explosion",applyBlast);addEventListener(AUDIO_SETTINGS_EVENT,event=>audioSettings=normalizeAudioSettings(event.detail||loadAudioSettings()));addEventListener("keydown",event=>{if(event.code!=="KeyQ"||event.repeat)return;if(isFoot())toggleFootWeapon();else if(isDrone())toggleDroneWeapon();});requestAnimationFrame(frame);
}

installGameplayFinalRuntime();
// the shot / blast effect pools exist (hidden) before the shader prewarm runs,
// so the first shot does not compile their programs mid-action
if(typeof window!=="undefined")(globalThis.__prewarmFactories??=[]).push(()=>{const sc=bridge()?.threeScene;if(sc){try{ensureTracerPool(sc);}catch{}try{ensureBlastPool(sc);}catch{}try{ensureGrenadeBounceFxPool(sc);}catch{}}return null;});
