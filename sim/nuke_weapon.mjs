import * as THREE from "three";
import {Box3dHitscanWorld} from "./box3d_hitscan.mjs";
import {staticGroundHeightAt,terrainRayDistance} from "./terrain_craters.mjs";
import {fatLineMaterial,fatLineGeometry,fatLineSegments} from "./box3d_collider_debug.mjs";
import {FX,sphereGeometry,ringGeometry,cylinderGeometry,circleGeometry,fxMaterial,disposeEffect,setData,warmNukePrograms} from "./nuke_fx_shared.mjs";

const STORAGE_KEY="arondight45DroneWeaponExtendedV1";
const COOLDOWN_MS=4500;
const MAX_RANGE_M=600;
const GROUND_BURST_Z=0;
// 3x scale (user request): blast, shock reach, cloud and fireball.
export const NUKE_SCALE=3;
const BLAST_RADIUS_M=360;
const BLAST_MAX_DAMAGE=1000;
const SHOCKWAVE_SPEED_MPS=343;
const SHOCKWAVE_MAX_M=1560;
const MUSHROOM_HEIGHT_M=324;
const MUSHROOM_LIFETIME_MS=32000;
const CAMERA_SHAKE_MAX_DISTANCE_M=1200;
const CINEMATIC_GRACE_MS=4200;
const NUKE_PERF_CONTRACT="no-runtime-lights+shared-geometry+compositor-shake-v1";
const raycaster=new THREE.Raycaster(),ndc=new THREE.Vector2(),boxHits=new Box3dHitscanWorld();
const tmp=new THREE.Vector3(),axis=new THREE.Vector3(0,-1,0),cameraWorld=new THREE.Vector3();
let warmedPrograms=false,lastWarmAttempt=-Infinity,installed=false,patchedApi=null,lastNuke=-Infinity,displayMode="gun",originalToggle=null,originalSetMode=null,originalFireMissile=null;
const warheads=[];
const impacts=[];

function viewport(){return document.getElementById("viewport");}
function bridge(){return globalThis.__arondightRealWorld||null;}
function walk(){return globalThis.__arondightWalkMode||null;}
function drive(){return globalThis.__arondightVehicleDrive||null;}
function isDrone(){return walk()?.mode!=="foot"&&!drive()?.active&&!globalThis.__jetMode?.active;}
function clamp(v,a,b){return Math.max(a,Math.min(b,Number(v)||0));}
function persistedMode(){try{const value=localStorage.getItem(STORAGE_KEY);return ["gun","missile"].includes(value)?value:null;}catch{return null;}} /* a nuke selection is never restored: every session starts on gun or rockets */
function saveMode(value){try{localStorage.setItem(STORAGE_KEY,value);}catch{}}
function logicalPoint(clientX,clientY){const view=viewport(),screen=view?.getBoundingClientRect();if(!view||!screen)return null;const width=Math.max(1,view.clientWidth),height=Math.max(1,view.clientHeight),cx=Number.isFinite(Number(clientX))?Number(clientX):screen.left+screen.width/2,cy=Number.isFinite(Number(clientY))?Number(clientY):screen.top+screen.height/2,rotated=view.dataset.soloOrientation==="css-landscape",x=rotated?cy-screen.top:cx-screen.left,y=rotated?screen.right-cx:cy-screen.top;return{x:clamp(x,0,width),y:clamp(y,0,height),width,height};}
function screenRay(clientX,clientY){const camera=bridge()?.threeCamera,p=logicalPoint(clientX,clientY);if(!camera||!p)return null;ndc.set(p.x/p.width*2-1,1-p.y/p.height*2);camera.updateMatrixWorld?.(true);raycaster.setFromCamera(ndc,camera);return{origin:raycaster.ray.origin.clone(),direction:raycaster.ray.direction.clone().normalize()};}
function ignored(node){for(let n=node;n;n=n.parent){const u=n.userData||{};if(u.flightFireIgnore||u.walkWeaponPart||u.arondightAirframe||u.localHumanAvatar||u.directFireMissile||u.nukeWeaponPart)return true;}return false;}
function candidates(scene){const out=[];scene?.traverse?.(node=>{if(!node?.isMesh||node.visible===false||(node.material?.visible===false&&!node.userData?.hitProxy)||ignored(node))return;out.push(node);});return out;}
// Objects right next to the drone (a passer-by, a lamp post) never become
// ground zero: the nuke always targets at least MIN_TARGET_M away.
const MIN_TARGET_M=25;
function nearestHit(origin,direction,maxDistance){const b=bridge(),scene=b?.threeScene;if(!scene)return null;raycaster.set(origin,direction);raycaster.near=MIN_TARGET_M;raycaster.far=maxDistance;const sceneHit=raycaster.intersectObjects(candidates(scene),false)[0]||null;let staticHit=null;if(b.active&&b.buildingCollisionSnapshot){const hit=boxHits.cast([origin.x,origin.y,origin.z],[direction.x,direction.y,direction.z],maxDistance,b.buildingCollisionSnapshot);if(hit&&hit.distanceM>=MIN_TARGET_M)staticHit={distance:hit.distanceM,point:new THREE.Vector3(...hit.point)};}return staticHit&&(!sceneHit||staticHit.distance<sceneHit.distance)?staticHit:sceneHit;}
function groundBurstPoint(point){const target=point.clone();target.z=staticGroundHeightAt(target.x,target.y)+GROUND_BURST_Z;return target;} // ground burst on the real terrain
function targetForRay(ray){const hit=nearestHit(ray.origin,ray.direction,MAX_RANGE_M);if(hit?.point)return groundBurstPoint(hit.point);{const t=terrainRayDistance(ray.origin,ray.direction,MAX_RANGE_M);if(t!==null&&t>MIN_TARGET_M)return groundBurstPoint(ray.origin.clone().addScaledVector(ray.direction,t));}return groundBurstPoint(ray.origin.clone().addScaledVector(ray.direction,Math.min(140,MAX_RANGE_M)));}

function tag(node,role="part"){node.userData.nukeWeaponPart=true;node.userData.flightFireIgnore=true;node.userData.nukeRole=role;return node;}
function ensureFlashOverlay(){const view=viewport();if(!view)return null;let el=document.getElementById("nukeFlashOverlay");if(el)return el;el=document.createElement("i");el.id="nukeFlashOverlay";el.setAttribute("aria-hidden","true");el.style.cssText="position:absolute;inset:-2%;z-index:80;pointer-events:none;background:#fff6d8;opacity:0;will-change:opacity";view.appendChild(el);return el;}
function ensurePressureOverlay(){const view=viewport();if(!view)return null;let el=document.getElementById("nukePressureOverlay");if(el)return el;el=document.createElement("i");el.id="nukePressureOverlay";el.setAttribute("aria-hidden","true");el.style.cssText="position:absolute;inset:-12%;z-index:79;pointer-events:none;border:4px solid #ffffff;border-radius:50%;opacity:0;will-change:transform,opacity";view.appendChild(el);return el;}
function flashScreen(){const el=ensureFlashOverlay();if(!el)return;el.getAnimations?.().forEach(a=>a.cancel());el.animate([{opacity:0},{opacity:1,offset:.018},{opacity:1,offset:.22},{opacity:.82,offset:.38},{opacity:.36,offset:.62},{opacity:0}],{duration:2600,easing:"cubic-bezier(.06,.7,.12,1)"});const view=viewport();if(view)view.dataset.nukeFlash="fullscreen-whiteout-v3";}
function pressurePulse(strength){const el=ensurePressureOverlay();if(!el)return;el.getAnimations?.().forEach(a=>a.cancel());const s=clamp(strength,0,1);el.animate([{opacity:.92*s,transform:"scale(.52)"},{opacity:.55*s,transform:"scale(1.0)",offset:.28},{opacity:.18*s,transform:"scale(1.35)",offset:.58},{opacity:0,transform:"scale(1.8)"}],{duration:780+620*s,easing:"cubic-bezier(.1,.78,.18,1)"});}
// BackSide glow spheres stay visible when the camera ends up inside the
// expanding fireball, at the cost of a single side.
function material(color,opacity=1,additive=false){return fxMaterial(color,{opacity,additive,depthTest:true,side:THREE.BackSide});}
function sphere(group,r,color,opacity=1,additive=false,segments=14,role="part"){const mesh=tag(new THREE.Mesh(sphereGeometry(r,segments,Math.max(8,Math.round(segments*.6))),material(color,opacity,additive)),role);group.add(mesh);return mesh;}
function makeWarhead(scene,start,target,now){const group=tag(new THREE.Group(),"warhead"),body=tag(new THREE.Mesh(cylinderGeometry(.055,.07,.42,10,1,false),new THREE.MeshLambertMaterial({color:0x5f6656})),"warhead-body"),nose=tag(new THREE.Mesh(sphereGeometry(.07,10,8),new THREE.MeshLambertMaterial({color:0x2c302a})),"warhead-nose");nose.position.y=-.24;nose.scale.set(1,1.6,1);group.add(body,nose);group.position.copy(start);const direction=target.clone().sub(start).normalize();group.quaternion.setFromUnitVectors(axis,direction);scene.add(group);const distance=start.distanceTo(target),duration=clamp(360+distance*5.2,520,1450);warheads.push({group,scene,start:start.clone(),target:target.clone(),born:now,duration,arc:clamp(distance*.035,.8,4.5)});window.dispatchEvent(new CustomEvent("arondight:nuke-launch",{detail:{position:[start.x,start.y,start.z],target:[target.x,target.y,target.z],durationMs:duration}}));return group;}
function cameraDistanceTo(position){const camera=bridge()?.threeCamera;if(!camera)return Infinity;camera.updateMatrixWorld?.(true);camera.getWorldPosition?.(cameraWorld);return cameraWorld.distanceTo(position);}
// Shake every layer of the world together. The 3D canvas and the MapLibre map
// are separate elements; shaking only the 3D canvas made objects slide against
// the map during the blast. Transform-only keyframes stay on the compositor —
// the old blur/brightness filters forced a full repaint of a fullscreen WebGL
// canvas on every animation frame.
function shakeTargets(){const view=viewport(),canvas=bridge()?.renderer?.domElement||bridge()?.threeRenderer?.domElement||view?.querySelector("canvas"),geo=document.getElementById("geoViewport");return [canvas,geo].filter(el=>el?.animate);}
function shakeCamera(strength,distance){const view=viewport(),targets=shakeTargets();if(!targets.length)return;const s=clamp(strength,0,1),px=5+22*s,duration=720+1050*s;const frames=[{transform:"translate3d(0,0,0)"},{transform:`translate3d(${px}px,${-px*.62}px,0) rotate(${.7*s}deg)`,offset:.1},{transform:`translate3d(${-px*.9}px,${px*.42}px,0) rotate(${-0.56*s}deg)`,offset:.22},{transform:`translate3d(${px*.65}px,${px*.76}px,0) rotate(${.4*s}deg)`,offset:.36},{transform:`translate3d(${-px*.5}px,${-px*.58}px,0) rotate(${-0.25*s}deg)`,offset:.52},{transform:`translate3d(${px*.24}px,${-px*.18}px,0)`,offset:.72},{transform:"translate3d(0,0,0)"}];for(const el of targets){el.getAnimations?.().filter(a=>a.id==="nuke-shake").forEach(a=>a.cancel());const anim=el.animate(frames,{duration,easing:"cubic-bezier(.16,.72,.22,1)"});anim.id="nuke-shake";}pressurePulse(s);window.dispatchEvent(new CustomEvent("arondight:nuke-shockwave-arrival",{detail:{strength:s,distanceM:Number(distance)}}));if(view){view.dataset.nukeCameraShake="shockwave-arrival-v4-map-locked";view.dataset.nukeCameraShakeStrength=s.toFixed(3);view.dataset.nukeCameraShakeDistanceM=Number(distance).toFixed(1);}}
function dispatchBlastDamage(item,age){if(item.damageTriggered)return;item.damageTriggered=true;window.dispatchEvent(new CustomEvent("arondight:world-explosion",{detail:{position:[item.position.x,item.position.y,item.position.z],radiusM:BLAST_RADIUS_M,maxDamage:BLAST_MAX_DAMAGE,kind:"nuke",source:"drone-nuke",targeted:true,cinematicGraceMs:CINEMATIC_GRACE_MS}}));const view=viewport();if(view){view.dataset.nukeDamageState="released-after-cinematic-v1";view.dataset.nukeDamageReleaseMs=String(Math.round(age));}}
// Ground layer of the blast: flash, fireball, shockwave and scorch. The
// mushroom column itself is owned by the volumetric layer; this layer used to
// build a second, hidden-behind mushroom with a 900-candela point light.
// Wire sphere (latitude/longitude) for the fireball: neon structure lines
// instead of stacked soft glow spheres.
let fireballWireGeometry=null;
function fireballWire(){if(fireballWireGeometry)return fireballWireGeometry;const out=[],lat=7,lon=16,seg=32;
  for(let i=1;i<lat;i++){const t=i/lat*Math.PI,r=Math.sin(t),z=Math.cos(t);for(let k=0;k<seg;k++){const a=k/seg*Math.PI*2,b=(k+1)/seg*Math.PI*2;out.push(Math.cos(a)*r,Math.sin(a)*r,z,Math.cos(b)*r,Math.sin(b)*r,z);}}
  for(let k=0;k<lon;k++){const a=k/lon*Math.PI*2;for(let i=0;i<seg/2;i++){const t0=i/(seg/2)*Math.PI,t1=(i+1)/(seg/2)*Math.PI;out.push(Math.cos(a)*Math.sin(t0),Math.sin(a)*Math.sin(t0),Math.cos(t0),Math.cos(a)*Math.sin(t1),Math.sin(a)*Math.sin(t1),Math.cos(t1));}}
  fireballWireGeometry=fatLineGeometry(out);fireballWireGeometry.userData.nukeSharedGeometry=true;return fireballWireGeometry;}
function impactVisuals(group){
  const flash=sphere(group,5.5,0xfff6d8,1,true,24,"flash-core"),hot=sphere(group,8.5,0xff9a3c,.7,true,24,"hot-core"),fire=tag(fatLineSegments(fireballWire(),fatLineMaterial(0xffd23f,{width:2.4,opacity:.95,additive:true})),"fireball"),fireOuter=tag(fatLineSegments(fireballWire(),fatLineMaterial(0xff6a2a,{width:1.8,opacity:.8,additive:true})),"fireball-outer");fire.scale.setScalar(12.5);fireOuter.scale.setScalar(18);fireOuter.rotation.z=.2;group.add(fire,fireOuter);
  const shock=tag(new THREE.Mesh(ringGeometry(.985,1.015,96),fxMaterial(0xffffff,{opacity:.9,additive:true,depthTest:true})),"shockwave-ring");shock.position.z=.28;group.add(shock);
  const dust=tag(new THREE.Mesh(ringGeometry(.94,.955,64),fxMaterial(0xd8c8a8,{opacity:.6,additive:false,depthTest:true})),"shockwave-dust");dust.position.z=.14;group.add(dust);
  const wall=tag(new THREE.Mesh(cylinderGeometry(1,1,8,48,2,true),fxMaterial(0xffffff,{opacity:.14,additive:true,depthTest:true,side:THREE.DoubleSide})),"shockwave-wall");wall.rotation.x=Math.PI/2;wall.position.z=4;group.add(wall);
  const scorchMaterial=fxMaterial(0x2b2420,{opacity:.9,additive:false,depthTest:true});scorchMaterial.polygonOffset=true;scorchMaterial.polygonOffsetFactor=-4;const scorch=tag(new THREE.Mesh(circleGeometry(126,64),scorchMaterial),"scorch");scorch.position.z=.04;group.add(scorch);
  return{flash,hot,fire,fireOuter,shock,dust,wall,scorch};
}
function makeImpact(scene,position,now,{remote=false}={}){const group=tag(new THREE.Group(),"impact-root");group.position.copy(position);scene.add(group);
  const{flash,hot,fire,fireOuter,shock,dust,wall,scorch}=impactVisuals(group);
  impacts.push({group,scene,position:position.clone(),flash,hot,fire,fireOuter,shock,dust,wall,scorch,born:now,until:now+MUSHROOM_LIFETIME_MS,shakeTriggered:false,damageTriggered:false,shockRadius:0});
  flashScreen();
  window.dispatchEvent(new CustomEvent("arondight:nuke-impact",{detail:{position:[position.x,position.y,position.z],radiusM:BLAST_RADIUS_M,shockwaveSpeedMps:SHOCKWAVE_SPEED_MPS,mushroomHeightM:MUSHROOM_HEIGHT_M,cameraDistanceM:cameraDistanceTo(position),remote}}));
  const view=viewport();if(view){view.dataset.nukeImpacts=String((Number(view.dataset.nukeImpacts)||0)+1);view.dataset.nukeBlastRadius=String(BLAST_RADIUS_M);view.dataset.nukeEffect="whiteout-fireball-shockwave-mushroom-v4";view.dataset.nukeCinematic="whiteout+fireball+physical-shockwave+volumetric-mushroom+delayed-damage-v4";view.dataset.nukeShockwaveSpeedMps=String(SHOCKWAVE_SPEED_MPS);view.dataset.nukeMushroomHeightM=String(MUSHROOM_HEIGHT_M);view.dataset.nukeDamageDelayMs=String(CINEMATIC_GRACE_MS);view.dataset.nukeDamageState="cinematic-grace";view.dataset.nukePerf=NUKE_PERF_CONTRACT;}
}
function updateWarheads(now){for(let i=warheads.length-1;i>=0;i--){const item=warheads[i],t=clamp((now-item.born)/item.duration,0,1),e=t*t*(3-2*t);item.group.position.lerpVectors(item.start,item.target,e);item.group.position.z+=Math.sin(Math.PI*t)*item.arc;const dir=tmp.copy(item.target).sub(item.group.position);if(dir.lengthSq()>.000001)item.group.quaternion.setFromUnitVectors(axis,dir.normalize());if(t>=1){item.scene.remove(item.group);disposeEffect(item.group);warheads.splice(i,1);makeImpact(item.scene,item.target,now);}}}
function updateImpacts(now){const view=viewport();for(let i=impacts.length-1;i>=0;i--){const item=impacts[i],age=now-item.born,blastT=clamp(age/3200,0,1),blastEase=1-(1-blastT)**3;
    item.flash.scale.setScalar(NUKE_SCALE*(1+20*blastEase));item.hot.scale.setScalar(NUKE_SCALE*(1+6.2*blastEase));item.fire.scale.setScalar(12.5*NUKE_SCALE*(1+4.1*blastEase));item.fireOuter.scale.setScalar(18*NUKE_SCALE*(1+2.8*blastEase));item.fire.rotation.z=age*.00012;item.fireOuter.rotation.z=-age*.00008;item.flash.material.opacity=Math.max(0,1-blastT*1.55);item.hot.material.opacity=.95*Math.max(.12,1-blastT*.7);item.fire.material.opacity=.9*Math.max(.1,1-blastT*.76);item.fireOuter.material.opacity=.55*Math.max(.06,1-blastT*.84);item.flash.visible=item.flash.material.opacity>.002;
    const shockRadius=Math.min(SHOCKWAVE_MAX_M,Math.max(1,age/1000*SHOCKWAVE_SPEED_MPS));item.shockRadius=shockRadius;item.shock.scale.setScalar(shockRadius);item.dust.scale.setScalar(shockRadius*.92);item.wall.scale.set(shockRadius,1,shockRadius);const shockFade=1-clamp(shockRadius/SHOCKWAVE_MAX_M,0,1);item.shock.material.opacity=.98*shockFade**.55;item.dust.material.opacity=.48*shockFade**.48;item.wall.material.opacity=.28*shockFade**.72;item.shock.visible=item.dust.visible=item.wall.visible=shockFade>.001;
    if(!item.shakeTriggered){const cameraDistance=cameraDistanceTo(item.position);if(Number.isFinite(cameraDistance)&&shockRadius>=cameraDistance){item.shakeTriggered=true;const strength=clamp(1-cameraDistance/CAMERA_SHAKE_MAX_DISTANCE_M,.12,1);shakeCamera(strength,cameraDistance);if(view)view.dataset.nukeShockArrivalMs=String(Math.round(age));}}
    item.scorch.material.opacity=.9*(1-clamp((age-23000)/9000,0,1));
    if(!item.damageTriggered&&age>=CINEMATIC_GRACE_MS)dispatchBlastDamage(item,age);
    setData(view,"nukeShockwaveRadiusM",shockRadius.toFixed(0));setData(view,"nukeVisiblePhase",age<CINEMATIC_GRACE_MS?"cinematic":"aftermath");
    if(now>=item.until){item.scene.remove(item.group);disposeEffect(item.group);impacts.splice(i,1);}}
}

function fireNuke({clientX,clientY,source="external"}={}){const now=performance.now(),view=viewport();if((performance.now()<(Number(globalThis.__arondightWeaponLockUntil)||0)))return false;if(displayMode!=="nuke"||!droneNukeAllowed()||!isDrone()||globalThis.__arondightDroneDamageModel?.destroyed||view?.dataset.fireArmed!=="1"||now-lastNuke<COOLDOWN_MS)return false;const ray=screenRay(clientX,clientY),scene=bridge()?.threeScene;if(!ray||!scene)return false;lastNuke=now;const target=targetForRay(ray),start=ray.origin.clone().addScaledVector(ray.direction,.45).add(new THREE.Vector3(0,0,-.08));makeWarhead(scene,start,target,now);if(view){view.dataset.droneWeapon="nuke";view.dataset.nukeLaunches=String((Number(view.dataset.nukeLaunches)||0)+1);view.dataset.nukeInput=String(source);view.dataset.nukeTarget=`${target.x.toFixed(2)},${target.y.toFixed(2)},${target.z.toFixed(2)}`;view.dataset.nukeTargetResolver="ground-burst-xy-v1";view.dataset.nukeContract="drone-targeted-fixed-impact-v2";}return true;}
// On foot: the shoulder-fired nuke ("NUKE" in the weapon cycle). Same warhead and blast as the
// drone's, fired from the launcher muzzle along the crosshair / tap ray of the camera you see.
// It always fires, wherever you aim (close means you are in your own fireball). Aimed at the sky
// or far away: it flies out to 600 m and bursts over the ground there. 20 s to reload.
const FOOT_NUKE_RELOAD_MS=20000,FOOT_NUKE_MIN_M=200;let lastFootNuke=-Infinity;
function footRay(clientX,clientY){const camera=bridge()?.presentedCamera?.()||bridge()?.threeCamera,p=logicalPoint(clientX,clientY);if(!camera||!p)return null;ndc.set(p.x/p.width*2-1,1-p.y/p.height*2);raycaster.setFromCamera(ndc,camera);return{origin:raycaster.ray.origin.clone(),direction:raycaster.ray.direction.clone().normalize()};}
function fireFootNuke({clientX,clientY,source="foot"}={}){const now=performance.now(),view=viewport(),scene=bridge()?.threeScene,walk=globalThis.__arondightWalkMode;
  if(walk?.mode!=="foot"||walk.dead||!globalThis.__arondightWorldOptions?.rule?.("launcherNuke")||now<(Number(globalThis.__arondightWeaponLockUntil)||0)||!scene)return false;
  if(now-lastFootNuke<FOOT_NUKE_RELOAD_MS){if(view)view.dataset.footNukeState=`reloading-${Math.ceil((FOOT_NUKE_RELOAD_MS-(now-lastFootNuke))/1000)}s`;window.dispatchEvent(new CustomEvent("arondight:foot-nuke-denied",{detail:{reason:"reload",remainingMs:FOOT_NUKE_RELOAD_MS-(now-lastFootNuke)}}));return false;}
  const ray=footRay(clientX,clientY);if(!ray)return false;let target=null;const hit=nearestHit(ray.origin,ray.direction,MAX_RANGE_M);if(hit?.point)target=groundBurstPoint(hit.point);else{let t=terrainRayDistance(ray.origin,ray.direction,MAX_RANGE_M);
    // no terrain tile hit: intersect the ground surface itself (two refinements of the height under the ray)
    if((t===null||!Number.isFinite(t))&&ray.direction.z<-1e-4){t=(staticGroundHeightAt(ray.origin.x,ray.origin.y)-ray.origin.z)/ray.direction.z;for(let k=0;k<2;k++){const q=ray.origin.clone().addScaledVector(ray.direction,t);t=(staticGroundHeightAt(q.x,q.y)-ray.origin.z)/ray.direction.z;}if(!(t>0))t=null;}
    target=groundBurstPoint(ray.origin.clone().addScaledVector(ray.direction,t!==null&&t>0?Math.min(t,MAX_RANGE_M):MAX_RANGE_M));}
  /* no minimum range: it always fires - point blank means you are inside your own fireball */
  lastFootNuke=now;const muzzle=scene.getObjectByName?.("WALK_GRENADE_MUZZLE_NODE"),start=muzzle?muzzle.getWorldPosition(new THREE.Vector3()):ray.origin.clone().addScaledVector(ray.direction,.6);makeWarhead(scene,start,target,now);
  window.dispatchEvent(new CustomEvent("arondight:weapon-fired",{detail:{weapon:"nuke",source}}));
  if(view){view.dataset.footNukeState="fired";view.dataset.footNukeLaunches=String((Number(view.dataset.footNukeLaunches)||0)+1);view.dataset.nukeTarget=`${target.x.toFixed(1)},${target.y.toFixed(1)},${target.z.toFixed(1)}`;}return true;}
let nukeToast=null,nukeToastTimer=0;function footNukeToast(text){const v=viewport();if(!v)return;if(!nukeToast?.isConnected){nukeToast=document.createElement("div");nukeToast.id="footNukeToast";nukeToast.style.cssText="position:absolute;left:50%;top:58%;transform:translateX(-50%);z-index:30;padding:7px 14px;border-radius:8px;background:#200c08d8;border:1px solid #ff6a3a99;color:#ffd9c8;font:800 13px/1 system-ui,sans-serif;letter-spacing:.12em;pointer-events:none;display:none";v.appendChild(nukeToast);}nukeToast.textContent=text;nukeToast.style.display="block";clearTimeout(nukeToastTimer);nukeToastTimer=setTimeout(()=>{nukeToast.style.display="none";},1400);}
if(typeof window!=="undefined")addEventListener("arondight:foot-nuke-denied",e=>{const d=e.detail||{};footNukeToast(d.reason==="min-range"?`NUKE · TOO CLOSE · MIN ${d.minM} m (${Math.round(d.rangeM)} m)`:`NUKE · RELOADING ${Math.ceil((d.remainingMs||0)/1000)} s`);});
globalThis.__arondightFootNuke={fire:fireFootNuke,get readyInMs(){return Math.max(0,FOOT_NUKE_RELOAD_MS-(performance.now()-lastFootNuke));},minRangeM:FOOT_NUKE_MIN_M};
// The drone nuke is a game rule (main menu WORLD → DRONE NUKE, default off; in multiplayer the
// host's switch applies): only then is it the third drone weapon after gun and rockets.
const droneNukeAllowed=()=>Boolean(globalThis.__arondightWorldOptions?.rule?.("droneNuke"));
function droneModes(){return droneNukeAllowed()?["gun","missile","nuke"]:["gun","missile"];}
function applyDisplayMode(next){if(!droneModes().includes(next))return displayMode;displayMode=next;saveMode(displayMode);if(displayMode==="gun")originalSetMode?.("gun");else originalSetMode?.("missile");const view=viewport();if(view){view.dataset.droneExtendedWeapon=displayMode;view.dataset.nukeSelected=displayMode==="nuke"?"1":"0";}return displayMode;}
function cycle(){const m=droneModes();return applyDisplayMode(m[(m.indexOf(displayMode)+1)%m.length]);}
function onRules(){if(displayMode==="nuke"&&!droneNukeAllowed())applyDisplayMode("gun");}
if(typeof window!=="undefined")addEventListener("rush-world-options-change",onRules);
function patchApi(){const api=globalThis.__arondightDroneWeapons;if(!api)return false;if(api===patchedApi)return true;patchedApi=api;originalToggle=api.toggle?.bind(api)||null;originalSetMode=api.setMode?.bind(api)||null;originalFireMissile=api.fireMissile?.bind(api)||null;displayMode=persistedMode()||String(api.mode||"gun");if(!droneModes().includes(displayMode))displayMode="gun";api.toggle=cycle;api.setMode=mode=>applyDisplayMode(String(mode));api.fireNuke=fireNuke;api.fireMissile=args=>displayMode==="nuke"?fireNuke(args):(performance.now()<(Number(globalThis.__arondightWeaponLockUntil)||0))?false:Boolean(originalFireMissile?.(args));Object.defineProperty(api,"displayMode",{configurable:true,enumerable:true,get:()=>displayMode});applyDisplayMode(displayMode);const view=viewport();if(view)view.dataset.nukeWeapon="enabled-v3";return true;}
function frame(now=performance.now()){patchApi();if(warheads.length)updateWarheads(now);if(impacts.length)updateImpacts(now);if(!warmedPrograms&&now-lastWarmAttempt>1000){lastWarmAttempt=now;warmedPrograms=warmNukePrograms();}requestAnimationFrame(frame);}

export function installNukeWeapon(){if(installed)return;installed=true;(globalThis.__prewarmFactories??=[]).push(()=>{const g=tag(new THREE.Group(),"prewarm");impactVisuals(g);return g;});
  // A nuke dropped by a multiplayer peer (world_sync.mjs): same impact, here.
  window.addEventListener("arondight:remote-nuke",event=>{const p=event?.detail?.position,scene=bridge()?.threeScene;if(!Array.isArray(p)||!scene)return;makeImpact(scene,new THREE.Vector3(+p[0]||0,+p[1]||0,0),performance.now(),{remote:true});});window.addEventListener("arondight:world-reset",()=>{for(const w of warheads.splice(0)){w.scene.remove(w.group);disposeEffect(w.group);}for(const i of impacts.splice(0)){i.scene.remove(i.group);disposeEffect(i.group);}});ensureFlashOverlay();ensurePressureOverlay();requestAnimationFrame(frame);}
installNukeWeapon();