import * as THREE from "three";
import {Box3dHitscanWorld} from "./box3d_hitscan.mjs";

const STORAGE_KEY="arondight45DroneWeaponExtendedV1";
const COOLDOWN_MS=4500;
const MAX_RANGE_M=360;
const BLAST_RADIUS_M=65;
const BLAST_MAX_DAMAGE=250;
const raycaster=new THREE.Raycaster(),ndc=new THREE.Vector2(),boxHits=new Box3dHitscanWorld();
const tmp=new THREE.Vector3(),tmp2=new THREE.Vector3(),axis=new THREE.Vector3(0,-1,0);
let installed=false,patchedApi=null,lastNuke=-Infinity,displayMode="gun",originalToggle=null,originalSetMode=null,originalFireMissile=null;
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
function nearestHit(origin,direction,maxDistance){const b=bridge(),scene=b?.threeScene;if(!scene)return null;raycaster.set(origin,direction);raycaster.near=.03;raycaster.far=maxDistance;const sceneHit=raycaster.intersectObjects(candidates(scene),false)[0]||null;let staticHit=null;if(b.active&&b.buildingCollisionSnapshot){const hit=boxHits.cast([origin.x,origin.y,origin.z],[direction.x,direction.y,direction.z],maxDistance,b.buildingCollisionSnapshot);if(hit)staticHit={distance:hit.distanceM,point:new THREE.Vector3(...hit.point)};}return staticHit&&(!sceneHit||staticHit.distance<sceneHit.distance)?staticHit:sceneHit;}
function targetForRay(ray){const hit=nearestHit(ray.origin,ray.direction,MAX_RANGE_M);if(hit?.point)return hit.point.clone();const dz=ray.direction.z;if(Math.abs(dz)>.0001){const t=(0-ray.origin.z)/dz;if(t>1&&t<MAX_RANGE_M)return ray.origin.clone().addScaledVector(ray.direction,t);}return ray.origin.clone().addScaledVector(ray.direction,Math.min(120,MAX_RANGE_M));}

function ensureFlashOverlay(){const view=viewport();if(!view)return null;let el=document.getElementById("nukeFlashOverlay");if(el)return el;el=document.createElement("i");el.id="nukeFlashOverlay";el.setAttribute("aria-hidden","true");el.style.cssText="position:absolute;inset:0;z-index:80;pointer-events:none;background:#fff;opacity:0;mix-blend-mode:screen";view.appendChild(el);return el;}
function flashScreen(){const el=ensureFlashOverlay();if(!el)return;el.getAnimations?.().forEach(a=>a.cancel());el.animate([{opacity:0},{opacity:1,offset:.06},{opacity:.98,offset:.18},{opacity:.28,offset:.55},{opacity:0}],{duration:980,easing:"cubic-bezier(.12,.72,.18,1)"});}
function material(color,opacity=1,additive=false){return new THREE.MeshBasicMaterial({color,transparent:opacity<1,opacity,depthWrite:false,blending:additive?THREE.AdditiveBlending:THREE.NormalBlending});}
function mark(group){group.traverse?.(node=>{node.userData.nukeWeaponPart=true;node.userData.flightFireIgnore=true;});group.userData.nukeWeaponPart=true;group.userData.flightFireIgnore=true;return group;}
function makeWarhead(scene,start,target,now){const group=new THREE.Group(),body=new THREE.Mesh(new THREE.CylinderGeometry(.055,.07,.42,10),new THREE.MeshStandardMaterial({color:0x6d735f,roughness:.55,metalness:.4})),nose=new THREE.Mesh(new THREE.ConeGeometry(.07,.16,10),new THREE.MeshStandardMaterial({color:0x343832,roughness:.5,metalness:.5}));nose.position.y=-.29;group.add(body,nose);group.position.copy(start);const direction=target.clone().sub(start).normalize();group.quaternion.setFromUnitVectors(axis,direction);mark(group);scene.add(group);const distance=start.distanceTo(target),duration=clamp(360+distance*5.2,520,1450);warheads.push({group,scene,start:start.clone(),target:target.clone(),born:now,duration,arc:clamp(distance*.035,.8,4.5)});return group;}
function sphere(scene,group,r,color,opacity=1,additive=false){const mesh=new THREE.Mesh(new THREE.SphereGeometry(r,16,10),material(color,opacity,additive));group.add(mesh);return mesh;}
function makeImpact(scene,position,now){const group=new THREE.Group();group.position.copy(position);mark(group);scene.add(group);
  const flash=sphere(scene,group,1.2,0xffffff,1,true),hot=sphere(scene,group,1.5,0xfff0a0,.95,true),fire=sphere(scene,group,2.1,0xff6a1e,.84,true);
  const shock=new THREE.Mesh(new THREE.RingGeometry(1.2,1.65,64),material(0xfff1c8,.9,true));shock.position.z=.18;group.add(shock);
  const stemMat=new THREE.MeshStandardMaterial({color:0x6b5d4f,transparent:true,opacity:.82,roughness:1,depthWrite:false}),capMat=new THREE.MeshStandardMaterial({color:0x75675a,transparent:true,opacity:.84,roughness:1,depthWrite:false,emissive:0x30120a,emissiveIntensity:.42});
  const stem=new THREE.Group(),cap=new THREE.Group();group.add(stem,cap);
  for(let i=0;i<6;i++){const puff=sphere(scene,stem,2.2+i*.24,0x6a5a4b,.0,false);puff.material=stemMat.clone();puff.position.z=2.2+i*2.4;puff.scale.set(1,.86,1.12);}
  for(let i=0;i<9;i++){const a=i/9*Math.PI*2,puff=sphere(scene,cap,3.4+(i%3)*.35,0x75675a,.0,false);puff.material=capMat.clone();puff.position.set(Math.cos(a)*4.8,Math.sin(a)*4.8,16.8+(i%2)*1.2);puff.scale.set(1.3,1.3,.75);}
  const crown=sphere(scene,cap,5.1,0x77675b,.0,false);crown.material=capMat.clone();crown.position.z=18.4;crown.scale.set(1.42,1.42,.7);
  const light=new THREE.PointLight(0xffd089,65,130,1.35);light.position.z=8;group.add(light);
  const scorch=new THREE.Mesh(new THREE.CircleGeometry(10,40),new THREE.MeshBasicMaterial({color:0x120d09,transparent:true,opacity:.7,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-4,side:THREE.DoubleSide}));scorch.position.z=.03;group.add(scorch);
  impacts.push({group,scene,flash,hot,fire,shock,stem,cap,light,scorch,born:now,until:now+14500});
  flashScreen();
  window.dispatchEvent(new CustomEvent("arondight:world-explosion",{detail:{position:[position.x,position.y,position.z],radiusM:BLAST_RADIUS_M,maxDamage:BLAST_MAX_DAMAGE,kind:"nuke",source:"drone-nuke",targeted:true}}));
  window.dispatchEvent(new CustomEvent("arondight:nuke-impact",{detail:{position:[position.x,position.y,position.z],radiusM:BLAST_RADIUS_M}}));
  const view=viewport();if(view){view.dataset.nukeImpacts=String((Number(view.dataset.nukeImpacts)||0)+1);view.dataset.nukeBlastRadius=String(BLAST_RADIUS_M);view.dataset.nukeEffect="flash-fireball-shockwave-mushroom-v1";}
}
function updateWarheads(now){for(let i=warheads.length-1;i>=0;i--){const item=warheads[i],t=clamp((now-item.born)/item.duration,0,1),e=t*t*(3-2*t);item.group.position.lerpVectors(item.start,item.target,e);item.group.position.z+=Math.sin(Math.PI*t)*item.arc;const dir=tmp.copy(item.target).sub(item.group.position).normalize();if(dir.lengthSq()>.001)item.group.quaternion.setFromUnitVectors(axis,dir);if(t>=1){item.scene.remove(item.group);warheads.splice(i,1);makeImpact(item.scene,item.target,now);}}}
function updateImpacts(now){for(let i=impacts.length-1;i>=0;i--){const item=impacts[i],age=now-item.born,t=clamp(age/14500,0,1);if(age<1050){const e=1-(1-clamp(age/1050,0,1))**3;item.flash.scale.setScalar(1+18*e);item.hot.scale.setScalar(1+12*e);item.fire.scale.setScalar(1+8*e);item.flash.material.opacity=1-e;item.hot.material.opacity=.95*(1-e*.72);item.fire.material.opacity=.84*(1-e*.78);item.light.intensity=65*(1-e);}else{item.flash.material.opacity=0;item.hot.material.opacity=Math.max(0,.28*(1-t));item.fire.material.opacity=Math.max(0,.24*(1-t));item.light.intensity=0;}
    const shockT=clamp(age/1800,0,1),shockEase=1-(1-shockT)**2;item.shock.scale.setScalar(1+42*shockEase);item.shock.material.opacity=.9*(1-shockT)**1.7;
    const cloudT=clamp((age-420)/5200,0,1),rise=1-(1-cloudT)**2;item.stem.visible=age>300;item.cap.visible=age>450;item.stem.position.z=rise*3.5;item.cap.position.z=rise*7.5;item.stem.scale.setScalar(.45+.75*rise);item.cap.scale.setScalar(.38+.95*rise);for(const mesh of item.stem.children)mesh.material.opacity=.82*Math.min(1,cloudT*3)*(1-t*.7);for(const mesh of item.cap.children)mesh.material.opacity=.84*Math.min(1,cloudT*3)*(1-t*.62);item.scorch.material.opacity=.7*(1-clamp((age-9000)/5500,0,1));
    if(now>=item.until){item.scene.remove(item.group);impacts.splice(i,1);}}
}

function fireNuke({clientX,clientY,source="external"}={}){const now=performance.now(),view=viewport();if(displayMode!=="nuke"||!isDrone()||globalThis.__arondightDroneDamageModel?.destroyed||view?.dataset.fireArmed!=="1"||now-lastNuke<COOLDOWN_MS)return false;const ray=screenRay(clientX,clientY),scene=bridge()?.threeScene;if(!ray||!scene)return false;lastNuke=now;const target=targetForRay(ray),start=ray.origin.clone().addScaledVector(ray.direction,.45).add(new THREE.Vector3(0,0,-.08));makeWarhead(scene,start,target,now);if(view){view.dataset.droneWeapon="nuke";view.dataset.nukeLaunches=String((Number(view.dataset.nukeLaunches)||0)+1);view.dataset.nukeInput=String(source);view.dataset.nukeTarget=`${target.x.toFixed(2)},${target.y.toFixed(2)},${target.z.toFixed(2)}`;view.dataset.nukeContract="drone-targeted-fixed-impact-v1";}return true;}
function applyDisplayMode(next){if(!["gun","missile","nuke"].includes(next))return displayMode;displayMode=next;saveMode(displayMode);if(displayMode==="gun")originalSetMode?.("gun");else originalSetMode?.("missile");const view=viewport();if(view){view.dataset.droneExtendedWeapon=displayMode;view.dataset.nukeSelected=displayMode==="nuke"?"1":"0";}return displayMode;}
function cycle(){return applyDisplayMode(displayMode==="gun"?"missile":displayMode==="missile"?"nuke":"gun");}
function patchApi(){const api=globalThis.__arondightDroneWeapons;if(!api)return false;if(api===patchedApi)return true;patchedApi=api;originalToggle=api.toggle?.bind(api)||null;originalSetMode=api.setMode?.bind(api)||null;originalFireMissile=api.fireMissile?.bind(api)||null;displayMode=persistedMode()||String(api.mode||"gun");if(!["gun","missile","nuke"].includes(displayMode))displayMode="gun";api.toggle=cycle;api.setMode=mode=>applyDisplayMode(String(mode));api.fireNuke=fireNuke;api.fireMissile=args=>displayMode==="nuke"?fireNuke(args):Boolean(originalFireMissile?.(args));Object.defineProperty(api,"displayMode",{configurable:true,enumerable:true,get:()=>displayMode});applyDisplayMode(displayMode);const view=viewport();if(view)view.dataset.nukeWeapon="enabled-v1";return true;}
function frame(now=performance.now()){patchApi();updateWarheads(now);updateImpacts(now);requestAnimationFrame(frame);}

export function installNukeWeapon(){if(installed)return;installed=true;ensureFlashOverlay();requestAnimationFrame(frame);}
installNukeWeapon();
