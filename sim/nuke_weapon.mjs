import * as THREE from "three";
import {Box3dHitscanWorld} from "./box3d_hitscan.mjs";
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
function isDrone(){return walk()?.mode!=="foot"&&!drive()?.active;}
function clamp(v,a,b){return Math.max(a,Math.min(b,Number(v)||0));}
function persistedMode(){try{const value=localStorage.getItem(STORAGE_KEY);return ["gun","missile","nuke"].includes(value)?value:null;}catch{return null;}}
function saveMode(value){try{localStorage.setItem(STORAGE_KEY,value);}catch{}}
function logicalPoint(clientX,clientY){const view=viewport(),screen=view?.getBoundingClientRect();if(!view||!screen)return null;const width=Math.max(1,view.clientWidth),height=Math.max(1,view.clientHeight),cx=Number.isFinite(Number(clientX))?Number(clientX):screen.left+screen.width/2,cy=Number.isFinite(Number(clientY))?Number(clientY):screen.top+screen.height/2,rotated=view.dataset.soloOrientation==="css-landscape",x=rotated?cy-screen.top:cx-screen.left,y=rotated?screen.right-cx:cy-screen.top;return{x:clamp(x,0,width),y:clamp(y,0,height),width,height};}
function screenRay(clientX,clientY){const camera=bridge()?.threeCamera,p=logicalPoint(clientX,clientY);if(!camera||!p)return null;ndc.set(p.x/p.width*2-1,1-p.y/p.height*2);camera.updateMatrixWorld?.(true);raycaster.setFromCamera(ndc,camera);return{origin:raycaster.ray.origin.clone(),direction:raycaster.ray.direction.clone().normalize()};}
function ignored(node){for(let n=node;n;n=n.parent){const u=n.userData||{};if(u.flightFireIgnore||u.walkWeaponPart||u.arondightAirframe||u.localHumanAvatar||u.directFireMissile||u.nukeWeaponPart)return true;}return false;}
function candidates(scene){const out=[];scene?.traverse?.(node=>{if(!node?.isMesh||node.visible===false||node.material?.visible===false||ignored(node))return;out.push(node);});return out;}
// Objects right next to the drone (a passer-by, a lamp post) never become
// ground zero: the nuke always targets at least MIN_TARGET_M away.
const MIN_TARGET_M=25;
function nearestHit(origin,direction,maxDistance){const b=bridge(),scene=b?.threeScene;if(!scene)return null;raycaster.set(origin,direction);raycaster.near=MIN_TARGET_M;raycaster.far=maxDistance;const sceneHit=raycaster.intersectObjects(candidates(scene),false)[0]||null;let staticHit=null;if(b.active&&b.buildingCollisionSnapshot){const hit=boxHits.cast([origin.x,origin.y,origin.z],[direction.x,direction.y,direction.z],maxDistance,b.buildingCollisionSnapshot);if(hit&&hit.distanceM>=MIN_TARGET_M)staticHit={distance:hit.distanceM,point:new THREE.Vector3(...hit.point)};}return staticHit&&(!sceneHit||staticHit.distance<sceneHit.distance)?staticHit:sceneHit;}
function groundBurstPoint(point){const target=point.clone();target.z=GROUND_BURST_Z;return target;}
function targetForRay(ray){const hit=nearestHit(ray.origin,ray.direction,MAX_RANGE_M);if(hit?.point)return groundBurstPoint(hit.point);const dz=ray.direction.z;if(Math.abs(dz)>.0001){const t=(GROUND_BURST_Z-ray.origin.z)/dz;if(t>MIN_TARGET_M&&t<MAX_RANGE_M)return groundBurstPoint(ray.origin.clone().addScaledVector(ray.direction,t));}return groundBurstPoint(ray.origin.clone().addScaledVector(ray.direction,Math.min(140,MAX_RANGE_M)));}

function tag(node,role="part"){node.userData.nukeWeaponPart=true;node.userData.flightFireIgnore=true;node.userData.nukeRole=role;return node;}
function ensureFlashOverlay(){const view=viewport();if(!view)return null;let el=document.getElementById("nukeFlashOverlay");if(el)return el;el=document.createElement("i");el.id="nukeFlashOverlay";el.setAttribute("aria-hidden","true");el.style.cssText="position:absolute;inset:-2%;z-index:80;pointer-events:none;background:radial-gradient(circle at 50% 48%,#fff 0%,#fff 24%,#fff8d5 48%,#ffbf62 75%,#ff6a18 100%);opacity:0;will-change:opacity";view.appendChild(el);return el;}
function ensurePressureOverlay(){const view=viewport();if(!view)return null;let el=document.getElementById("nukePressureOverlay");if(el)return el;el=document.createElement("i");el.id="nukePressureOverlay";el.setAttribute("aria-hidden","true");el.style.cssText="position:absolute;inset:-12%;z-index:79;pointer-events:none;border:12px solid #fff9;border-radius:50%;opacity:0;will-change:transform,opacity;box-shadow:inset 0 0 90px #fff9,0 0 90px #fff8";view.appendChild(el);return el;}
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
function makeImpact(scene,position,now,{remote=false}={}){const group=tag(new THREE.Group(),"impact-root");group.position.copy(position);scene.add(group);
  const flash=sphere(group,5.5,FX.white,1,true,24,"flash-core"),hot=sphere(group,8.5,FX.core,.95,true,24,"hot-core"),fire=sphere(group,12.5,FX.orange,.9,true,22,"fireball"),fireOuter=sphere(group,18,FX.red,.55,true,20,"fireball-outer");
  const shock=tag(new THREE.Mesh(ringGeometry(.985,1.015,96),fxMaterial(FX.shock,{opacity:.98,additive:true,depthTest:true})),"shockwave-ring");shock.position.z=.28;group.add(shock);
  const dust=tag(new THREE.Mesh(ringGeometry(.88,1.12,64),fxMaterial(FX.dust,{opacity:.48,additive:false,depthTest:true})),"shockwave-dust");dust.position.z=.14;group.add(dust);
  const wall=tag(new THREE.Mesh(cylinderGeometry(1,1,8,48,2,true),fxMaterial(FX.shock,{opacity:.28,additive:true,depthTest:true,side:THREE.DoubleSide})),"shockwave-wall");wall.rotation.x=Math.PI/2;wall.position.z=4;group.add(wall);
  const scorchMaterial=fxMaterial(FX.scorch,{opacity:.9,additive:false,depthTest:true});scorchMaterial.polygonOffset=true;scorchMaterial.polygonOffsetFactor=-4;const scorch=tag(new THREE.Mesh(circleGeometry(126,64),scorchMaterial),"scorch");scorch.position.z=.04;group.add(scorch);
  impacts.push({group,scene,position:position.clone(),flash,hot,fire,fireOuter,shock,dust,wall,scorch,born:now,until:now+MUSHROOM_LIFETIME_MS,shakeTriggered:false,damageTriggered:false,shockRadius:0});
  flashScreen();
  window.dispatchEvent(new CustomEvent("arondight:nuke-impact",{detail:{position:[position.x,position.y,position.z],radiusM:BLAST_RADIUS_M,shockwaveSpeedMps:SHOCKWAVE_SPEED_MPS,mushroomHeightM:MUSHROOM_HEIGHT_M,cameraDistanceM:cameraDistanceTo(position),remote}}));
  const view=viewport();if(view){view.dataset.nukeImpacts=String((Number(view.dataset.nukeImpacts)||0)+1);view.dataset.nukeBlastRadius=String(BLAST_RADIUS_M);view.dataset.nukeEffect="whiteout-fireball-shockwave-mushroom-v4";view.dataset.nukeCinematic="whiteout+fireball+physical-shockwave+volumetric-mushroom+delayed-damage-v4";view.dataset.nukeShockwaveSpeedMps=String(SHOCKWAVE_SPEED_MPS);view.dataset.nukeMushroomHeightM=String(MUSHROOM_HEIGHT_M);view.dataset.nukeDamageDelayMs=String(CINEMATIC_GRACE_MS);view.dataset.nukeDamageState="cinematic-grace";view.dataset.nukePerf=NUKE_PERF_CONTRACT;}
}
function updateWarheads(now){for(let i=warheads.length-1;i>=0;i--){const item=warheads[i],t=clamp((now-item.born)/item.duration,0,1),e=t*t*(3-2*t);item.group.position.lerpVectors(item.start,item.target,e);item.group.position.z+=Math.sin(Math.PI*t)*item.arc;const dir=tmp.copy(item.target).sub(item.group.position);if(dir.lengthSq()>.000001)item.group.quaternion.setFromUnitVectors(axis,dir.normalize());if(t>=1){item.scene.remove(item.group);disposeEffect(item.group);warheads.splice(i,1);makeImpact(item.scene,item.target,now);}}}
function updateImpacts(now){const view=viewport();for(let i=impacts.length-1;i>=0;i--){const item=impacts[i],age=now-item.born,blastT=clamp(age/3200,0,1),blastEase=1-(1-blastT)**3;
    item.flash.scale.setScalar(NUKE_SCALE*(1+20*blastEase));item.hot.scale.setScalar(NUKE_SCALE*(1+6.2*blastEase));item.fire.scale.setScalar(NUKE_SCALE*(1+4.1*blastEase));item.fireOuter.scale.setScalar(NUKE_SCALE*(1+2.8*blastEase));item.flash.material.opacity=Math.max(0,1-blastT*1.55);item.hot.material.opacity=.95*Math.max(.12,1-blastT*.7);item.fire.material.opacity=.9*Math.max(.1,1-blastT*.76);item.fireOuter.material.opacity=.55*Math.max(.06,1-blastT*.84);item.flash.visible=item.flash.material.opacity>.002;
    const shockRadius=Math.min(SHOCKWAVE_MAX_M,Math.max(1,age/1000*SHOCKWAVE_SPEED_MPS));item.shockRadius=shockRadius;item.shock.scale.setScalar(shockRadius);item.dust.scale.setScalar(shockRadius*.92);item.wall.scale.set(shockRadius,1,shockRadius);const shockFade=1-clamp(shockRadius/SHOCKWAVE_MAX_M,0,1);item.shock.material.opacity=.98*shockFade**.55;item.dust.material.opacity=.48*shockFade**.48;item.wall.material.opacity=.28*shockFade**.72;item.shock.visible=item.dust.visible=item.wall.visible=shockFade>.001;
    if(!item.shakeTriggered){const cameraDistance=cameraDistanceTo(item.position);if(Number.isFinite(cameraDistance)&&shockRadius>=cameraDistance){item.shakeTriggered=true;const strength=clamp(1-cameraDistance/CAMERA_SHAKE_MAX_DISTANCE_M,.12,1);shakeCamera(strength,cameraDistance);if(view)view.dataset.nukeShockArrivalMs=String(Math.round(age));}}
    item.scorch.material.opacity=.9*(1-clamp((age-23000)/9000,0,1));
    if(!item.damageTriggered&&age>=CINEMATIC_GRACE_MS)dispatchBlastDamage(item,age);
    setData(view,"nukeShockwaveRadiusM",shockRadius.toFixed(0));setData(view,"nukeVisiblePhase",age<CINEMATIC_GRACE_MS?"cinematic":"aftermath");
    if(now>=item.until){item.scene.remove(item.group);disposeEffect(item.group);impacts.splice(i,1);}}
}

function fireNuke({clientX,clientY,source="external"}={}){const now=performance.now(),view=viewport();if(displayMode!=="nuke"||!isDrone()||globalThis.__arondightDroneDamageModel?.destroyed||view?.dataset.fireArmed!=="1"||now-lastNuke<COOLDOWN_MS)return false;const ray=screenRay(clientX,clientY),scene=bridge()?.threeScene;if(!ray||!scene)return false;lastNuke=now;const target=targetForRay(ray),start=ray.origin.clone().addScaledVector(ray.direction,.45).add(new THREE.Vector3(0,0,-.08));makeWarhead(scene,start,target,now);if(view){view.dataset.droneWeapon="nuke";view.dataset.nukeLaunches=String((Number(view.dataset.nukeLaunches)||0)+1);view.dataset.nukeInput=String(source);view.dataset.nukeTarget=`${target.x.toFixed(2)},${target.y.toFixed(2)},${target.z.toFixed(2)}`;view.dataset.nukeTargetResolver="ground-burst-xy-v1";view.dataset.nukeContract="drone-targeted-fixed-impact-v2";}return true;}
function applyDisplayMode(next){if(!["gun","missile","nuke"].includes(next))return displayMode;displayMode=next;saveMode(displayMode);if(displayMode==="gun")originalSetMode?.("gun");else originalSetMode?.("missile");const view=viewport();if(view){view.dataset.droneExtendedWeapon=displayMode;view.dataset.nukeSelected=displayMode==="nuke"?"1":"0";}return displayMode;}
function cycle(){return applyDisplayMode(displayMode==="gun"?"missile":displayMode==="missile"?"nuke":"gun");}
function patchApi(){const api=globalThis.__arondightDroneWeapons;if(!api)return false;if(api===patchedApi)return true;patchedApi=api;originalToggle=api.toggle?.bind(api)||null;originalSetMode=api.setMode?.bind(api)||null;originalFireMissile=api.fireMissile?.bind(api)||null;displayMode=persistedMode()||String(api.mode||"gun");if(!["gun","missile","nuke"].includes(displayMode))displayMode="gun";api.toggle=cycle;api.setMode=mode=>applyDisplayMode(String(mode));api.fireNuke=fireNuke;api.fireMissile=args=>displayMode==="nuke"?fireNuke(args):Boolean(originalFireMissile?.(args));Object.defineProperty(api,"displayMode",{configurable:true,enumerable:true,get:()=>displayMode});applyDisplayMode(displayMode);const view=viewport();if(view)view.dataset.nukeWeapon="enabled-v3";return true;}
function frame(now=performance.now()){patchApi();if(warheads.length)updateWarheads(now);if(impacts.length)updateImpacts(now);if(!warmedPrograms&&now-lastWarmAttempt>1000){lastWarmAttempt=now;warmedPrograms=warmNukePrograms();}requestAnimationFrame(frame);}

export function installNukeWeapon(){if(installed)return;installed=true;
  // A nuke dropped by a multiplayer peer (world_sync.mjs): same impact, here.
  window.addEventListener("arondight:remote-nuke",event=>{const p=event?.detail?.position,scene=bridge()?.threeScene;if(!Array.isArray(p)||!scene)return;makeImpact(scene,new THREE.Vector3(+p[0]||0,+p[1]||0,0),performance.now(),{remote:true});});window.addEventListener("arondight:world-reset",()=>{for(const w of warheads.splice(0)){w.scene.remove(w.group);disposeEffect(w.group);}for(const i of impacts.splice(0)){i.scene.remove(i.group);disposeEffect(i.group);}});ensureFlashOverlay();ensurePressureOverlay();requestAnimationFrame(frame);}
installNukeWeapon();