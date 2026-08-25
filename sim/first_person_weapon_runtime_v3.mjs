import * as THREE from "three";

const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number(v)||0));
const shotCamera=new THREE.PerspectiveCamera(78,16/9,.01,500),raycaster=new THREE.Raycaster(),ndc=new THREE.Vector2(),forward=new THREE.Vector3(),target=new THREE.Vector3();
const shotOrigin=new THREE.Vector3(),shotDirection=new THREE.Vector3(0,1,0),baseWorldPosition=new THREE.Vector3(),desiredAdsWorldPosition=new THREE.Vector3(),blendedWorldPosition=new THREE.Vector3(),rearWorld=new THREE.Vector3(),frontWorld=new THREE.Vector3(),sightDirection=new THREE.Vector3();
const baseWorldQuaternion=new THREE.Quaternion(),desiredWorldQuaternion=new THREE.Quaternion(),blendedWorldQuaternion=new THREE.Quaternion(),parentWorldQuaternion=new THREE.Quaternion(),inverseParentQuaternion=new THREE.Quaternion();
const lastBasePosition=new THREE.Vector3(),lastOutputPosition=new THREE.Vector3();
const lastBaseQuaternion=new THREE.Quaternion(),lastOutputQuaternion=new THREE.Quaternion();
const ADS_LOCAL_PISTOL=new THREE.Vector3(0,-.121,-.36),ADS_LOCAL_SMG=new THREE.Vector3(-.012,-.143,-.39);
const PISTOL_PARTS=new Set(["WALK_VM_FRAME","WALK_VM_RAIL","WALK_VM_SLIDE","WALK_VM_SLIDE_TOP","WALK_VM_BARREL","WALK_VM_MUZZLE","WALK_VM_EJECTION_PORT","WALK_VM_GRIP","WALK_VM_MAG_BASE","WALK_VM_TRIGGER_GUARD","WALK_VM_TRIGGER","WALK_VM_REAR_SIGHT","WALK_VM_FRONT_SIGHT","WALK_VM_FRONT_DOT"]);
const ADS_CLEANUP_PARTS=new Set(["WALK_VM_SLEEVE_R","WALK_VM_CUFF_R","WALK_VM_SLEEVE_L","WALK_VM_CUFF_L"]);
const POST_FIRE_ADS_MS=150;
const TRANSFORM_EPSILON_M=1e-6;
const QUAT_DOT_EPSILON=1e-7;
let installed=false,lastScreenAimAt=-Infinity,lastScreenFireAt=-Infinity,lastSwitchAt=-Infinity,lastMode="",lastGun=null,screenAimActive=false,lastAimSource="center",hasPresentationSnapshot=false,adsBlend=0,lastPresentationAt=performance.now();
let hookedScene=null,renderHook=null,previousSceneOnBeforeRender=null;

function viewport(){return document.getElementById("viewport");}
function bridge(){return globalThis.__arondightRealWorld||null;}
function walk(){return globalThis.__arondightWalkMode||null;}
function drive(){return globalThis.__arondightVehicleDrive||null;}
function footWeapons(){return globalThis.__arondightFootWeapons||null;}
function isFoot(){return walk()?.mode==="foot"&&!drive()?.active&&!walk()?.dead;}
function logicalPoint(clientX,clientY){const view=viewport(),screen=view?.getBoundingClientRect();if(!view||!screen)return null;const width=Math.max(1,view.clientWidth),height=Math.max(1,view.clientHeight),cx=Number.isFinite(clientX)?clientX:screen.left+screen.width/2,cy=Number.isFinite(clientY)?clientY:screen.top+screen.height/2,rotated=view.dataset.soloOrientation==="css-landscape",x=rotated?cy-screen.top:cx-screen.left,y=rotated?screen.right-cx:cy-screen.top;return{x:clamp(x,0,width),y:clamp(y,0,height),width,height};}
function shotRay(clientX,clientY){const w=walk(),p=logicalPoint(clientX,clientY);if(!w?.position||!p)return null;shotCamera.fov=clamp(Number(viewport()?.dataset.walkCameraFovDeg)||Number(bridge()?.threeCamera?.fov)||78,45,120);shotCamera.aspect=p.width/p.height;shotCamera.near=.01;shotCamera.far=220;shotCamera.position.set(Number(w.position.x)||0,Number(w.position.y)||0,Number(w.position.z)||1.68);shotCamera.up.set(0,0,1);const cp=Math.cos(Number(w.pitch)||0);forward.set(Math.sin(Number(w.yaw)||0)*cp,Math.cos(Number(w.yaw)||0)*cp,Math.sin(Number(w.pitch)||0)).normalize();shotCamera.lookAt(target.copy(shotCamera.position).add(forward));shotCamera.updateProjectionMatrix();shotCamera.updateMatrixWorld(true);ndc.set(p.x/p.width*2-1,1-p.y/p.height*2);raycaster.setFromCamera(ndc,shotCamera);return{origin:raycaster.ray.origin.clone(),direction:raycaster.ray.direction.clone()};}
function material(options){return new THREE.MeshStandardMaterial({depthTest:true,depthWrite:true,...options});}
function mesh(name,geometry,mat,x,y,z,rx=0,ry=0,rz=0,order=9998){const m=new THREE.Mesh(geometry,mat);m.name=name;m.position.set(x,y,z);m.rotation.set(rx,ry,rz);m.renderOrder=order;m.frustumCulled=false;m.userData.flightFireIgnore=true;m.userData.walkWeaponPart=true;m.userData.walkSmgPart=true;return m;}
function ensureAdsStyle(){if(document.querySelector("style[data-foot-ads-kimme-korn]"))return;const style=document.createElement("style");style.dataset.footAdsKimmeKorn="v1";style.textContent=`body.foot-ads-active #footReadout,body.foot-ads-active #footWeaponToggle{opacity:0!important;pointer-events:none!important}body.foot-ads-active #footReticle.screen-aim-active{width:12px!important;height:12px!important;opacity:.9!important}`;document.head.appendChild(style);}
function ensureSmg(gun){
  let group=gun.getObjectByName?.("WALK_SMG_3D");if(group)return group;
  group=new THREE.Group();group.name="WALK_SMG_3D";group.position.set(.012,-.008,.015);group.userData.flightFireIgnore=true;group.userData.walkWeaponPart=true;group.userData.walkSmgViewmodel="dedicated-mp-mesh-v4";
  const steel=material({color:0x202a31,roughness:.30,metalness:.72}),upper=material({color:0x38444d,roughness:.27,metalness:.68}),polymer=material({color:0x0d1317,roughness:.72,metalness:.08}),rubber=material({color:0x080b0d,roughness:.90,metalness:0}),sight=new THREE.MeshBasicMaterial({color:0xbfefff,depthTest:true,depthWrite:false});
  group.add(
    mesh("WALK_SMG_RECEIVER",new THREE.BoxGeometry(.178,.132,.390),steel,0,-.010,-.300),
    mesh("WALK_SMG_UPPER",new THREE.BoxGeometry(.158,.060,.345),upper,0,.075,-.320),
    mesh("WALK_SMG_HANDGUARD",new THREE.BoxGeometry(.162,.145,.275),polymer,0,-.005,-.575),
    mesh("WALK_SMG_BARREL",new THREE.CylinderGeometry(.020,.020,.270,12),steel,0,.020,-.735,Math.PI/2,0,0),
    mesh("WALK_SMG_MUZZLE",new THREE.CylinderGeometry(.039,.034,.074,12),rubber,0,.020,-.875,Math.PI/2,0,0),
    mesh("WALK_SMG_PISTOL_GRIP",new THREE.BoxGeometry(.098,.220,.120),polymer,0,-.178,-.155,-.13,0,0),
    mesh("WALK_SMG_MAGAZINE",new THREE.BoxGeometry(.090,.255,.112),upper,0,-.225,-.315,-.08,0,0),
    mesh("WALK_SMG_MAG_BASE",new THREE.BoxGeometry(.104,.028,.122),rubber,0,-.352,-.307,-.08,0,0),
    mesh("WALK_SMG_REAR_BLOCK",new THREE.BoxGeometry(.162,.108,.110),polymer,0,-.020,-.060),
    mesh("WALK_SMG_BRACE",new THREE.BoxGeometry(.190,.084,.175),rubber,0,-.040,.082),
    mesh("WALK_SMG_TOP_RAIL",new THREE.BoxGeometry(.118,.024,.320),rubber,0,.120,-.330),
    mesh("WALK_SMG_REAR_SIGHT",new THREE.BoxGeometry(.070,.034,.032),rubber,0,.142,-.125),
    mesh("WALK_SMG_FRONT_SIGHT",new THREE.BoxGeometry(.032,.040,.028),rubber,0,.143,-.705),
    mesh("WALK_SMG_FRONT_DOT",new THREE.SphereGeometry(.0065,6,4),sight,0,.161,-.713,0,0,0,9999)
  );
  const muzzleNode=new THREE.Object3D();muzzleNode.name="WALK_SMG_MUZZLE_NODE";muzzleNode.position.set(0,.020,-.915);muzzleNode.userData.flightFireIgnore=true;group.add(muzzleNode);gun.add(group);return group;
}
function setWeaponModeVisual(gun,mode){
  const smg=ensureSmg(gun),isSmg=mode==="smg";smg.visible=isSmg;const conversion=gun.getObjectByName?.("FINAL_SMG_CONVERSION");if(conversion)conversion.visible=false;gun.traverse?.(node=>{if(PISTOL_PARTS.has(node.name))node.visible=!isSmg;});
  const flash=gun.getObjectByName?.("FINAL_MUZZLE_FLASH")||gun.getObjectByName?.("WALK_MUZZLE_FLASH");if(flash){flash.position.z=isSmg?-.925:-.405;flash.position.y=isSmg?.020:.029;flash.traverse?.(node=>{if(node.isMesh&&node.material){node.material.depthTest=true;node.material.depthWrite=false;node.material.needsUpdate=true;}if(node.isMesh)node.renderOrder=9996;});}
  gun.userData.finalWeapon=mode;gun.userData.walkWeaponViewmodel=isSmg?"dedicated-mp-mesh-v4":"compact-pistol-gloves-v2";const view=viewport();if(view){view.dataset.walkWeapon=mode;view.dataset.walkWeaponViewmodel=gun.userData.walkWeaponViewmodel;view.dataset.walkSmgMesh=isSmg?"dedicated-receiver+barrel+magazine+brace-v4":"hidden";view.dataset.walkWeaponSwitch="single-owner-touch+q+dpad-v4";}
}
function setAdsCleanup(gun,active){gun.traverse?.(node=>{if(ADS_CLEANUP_PARTS.has(node.name))node.visible=!active;});}
function quaternionMatches(a,b){return 1-Math.abs(a.dot(b))<=QUAT_DOT_EPSILON;}
function restoreOrCaptureBase(gun){if(hasPresentationSnapshot&&gun===lastGun&&gun.position.distanceToSquared(lastOutputPosition)<=TRANSFORM_EPSILON_M*TRANSFORM_EPSILON_M&&quaternionMatches(gun.quaternion,lastOutputQuaternion)){gun.position.copy(lastBasePosition);gun.quaternion.copy(lastBaseQuaternion);}else{lastBasePosition.copy(gun.position);lastBaseQuaternion.copy(gun.quaternion);}hasPresentationSnapshot=true;}
function setWorldQuaternion(gun,quat){const parent=gun.parent;if(!parent){gun.quaternion.copy(quat);return;}parent.getWorldQuaternion(parentWorldQuaternion);inverseParentQuaternion.copy(parentWorldQuaternion).invert();gun.quaternion.copy(inverseParentQuaternion.multiply(quat)).normalize();}
function setWorldPosition(gun,position){const parent=gun.parent;if(!parent){gun.position.copy(position);return;}blendedWorldPosition.copy(position);parent.worldToLocal(blendedWorldPosition);gun.position.copy(blendedWorldPosition);}
function sightNodes(gun,mode){if(mode==="smg")return{rear:gun.getObjectByName?.("WALK_SMG_REAR_SIGHT"),front:gun.getObjectByName?.("WALK_SMG_FRONT_DOT")||gun.getObjectByName?.("WALK_SMG_FRONT_SIGHT")};return{rear:gun.getObjectByName?.("WALK_VM_REAR_SIGHT"),front:gun.getObjectByName?.("WALK_VM_FRONT_DOT")||gun.getObjectByName?.("WALK_VM_FRONT_SIGHT")};}
function updateAdsBlend(active,now){const dt=clamp((now-lastPresentationAt)/1000,0,.05);lastPresentationAt=now;const targetBlend=active?1:0,rate=active?18:22;adsBlend+= (targetBlend-adsBlend)*(1-Math.exp(-rate*dt));if(Math.abs(adsBlend-targetBlend)<.002)adsBlend=targetBlend;return adsBlend;}
function applyAdsTransform(gun,camera,now=performance.now()){
  restoreOrCaptureBase(gun);const fireAge=now-lastScreenFireAt,active=isFoot()&&(screenAimActive||(fireAge>=0&&fireAge<=POST_FIRE_ADS_MS)),blend=updateAdsBlend(active,now),mode=String(footWeapons()?.mode||"pistol");if(!camera||gun.visible===false){setAdsCleanup(gun,false);lastOutputPosition.copy(gun.position);lastOutputQuaternion.copy(gun.quaternion);return false;}
  setAdsCleanup(gun,blend>.08);if(blend<=.001){lastOutputPosition.copy(gun.position);lastOutputQuaternion.copy(gun.quaternion);const view=viewport();if(view){view.dataset.walkWeaponAdsBlend="0.000";view.dataset.walkWeaponAimMode="hip";}return false;}
  gun.updateMatrixWorld(true);gun.getWorldPosition(baseWorldPosition);gun.getWorldQuaternion(baseWorldQuaternion);const adsLocal=mode==="smg"?ADS_LOCAL_SMG:ADS_LOCAL_PISTOL;desiredAdsWorldPosition.copy(adsLocal);camera.localToWorld(desiredAdsWorldPosition);camera.getWorldQuaternion(desiredWorldQuaternion);const eased=blend*blend*(3-2*blend);blendedWorldPosition.lerpVectors(baseWorldPosition,desiredAdsWorldPosition,eased);blendedWorldQuaternion.copy(baseWorldQuaternion).slerp(desiredWorldQuaternion,eased);setWorldPosition(gun,blendedWorldPosition);setWorldQuaternion(gun,blendedWorldQuaternion);gun.updateMatrixWorld(true);
  const sights=sightNodes(gun,mode);let sightAngleError=0;if(sights.rear&&sights.front){sights.rear.getWorldPosition(rearWorld);sights.front.getWorldPosition(frontWorld);sightDirection.copy(frontWorld).sub(rearWorld).normalize();sightAngleError=Math.acos(clamp(sightDirection.dot(shotDirection),-1,1))*180/Math.PI;}
  lastOutputPosition.copy(gun.position);lastOutputQuaternion.copy(gun.quaternion);const view=viewport();if(view){view.dataset.walkWeaponVectorAlignment="ads-kimme-korn+centered-sight-axis-v7";view.dataset.walkWeaponAimMode="kimme-korn";view.dataset.walkWeaponAdsBlend=blend.toFixed(3);view.dataset.walkWeaponAimVector=`${shotDirection.x.toFixed(4)},${shotDirection.y.toFixed(4)},${shotDirection.z.toFixed(4)}`;view.dataset.walkWeaponAimActive=screenAimActive?"1":"0";view.dataset.walkWeaponAimSource=lastAimSource;view.dataset.walkWeaponSightAngleErrorDeg=sightAngleError.toFixed(4);view.dataset.walkWeaponPresentationOwner="scene-before-render-ads-v2";view.dataset.walkWeaponAdsPose=mode==="smg"?"mp-centered-safe-depth-v1":"pistol-centered-safe-depth-v1";}return true;
}
function ensureRenderHook(scene){
  if(!scene)return false;if(hookedScene===scene&&scene.onBeforeRender===renderHook)return true;if(hookedScene&&renderHook&&hookedScene.onBeforeRender===renderHook)hookedScene.onBeforeRender=previousSceneOnBeforeRender||(()=>{});hookedScene=scene;previousSceneOnBeforeRender=typeof scene.onBeforeRender==="function"?scene.onBeforeRender:null;renderHook=function(...args){previousSceneOnBeforeRender?.apply(this,args);const gun=scene.getObjectByName?.("WALK_PISTOL_3D");if(!gun)return;const mode=String(footWeapons()?.mode||"pistol"),camera=args[2]||bridge()?.threeCamera;setWeaponModeVisual(gun,mode);applyAdsTransform(gun,camera,performance.now());};scene.onBeforeRender=renderHook;return true;
}
function updateScreenVector(detail,source,active=true){if(!isFoot())return false;const ray=shotRay(Number(detail?.clientX),Number(detail?.clientY));if(!ray)return false;shotOrigin.copy(ray.origin);shotDirection.copy(ray.direction).normalize();lastScreenAimAt=performance.now();screenAimActive=Boolean(active);lastAimSource=String(source||detail?.source||"screen");const view=viewport();if(view){view.dataset.walkWeaponAimVector=`${shotDirection.x.toFixed(4)},${shotDirection.y.toFixed(4)},${shotDirection.z.toFixed(4)}`;view.dataset.walkWeaponAimActive=screenAimActive?"1":"0";view.dataset.walkWeaponAimSource=lastAimSource;}return true;}
function onScreenAim(event){const d=event?.detail||{};if(d.active===false){screenAimActive=false;lastAimSource=String(d.source||"release");const view=viewport();if(view){view.dataset.walkWeaponAimActive="0";view.dataset.walkWeaponAimSource=lastAimSource;}return;}updateScreenVector(d,d.source||"touch-screen-drag",true);}
function onScreenFire(event){if(!isFoot())return;const d=event?.detail||{};if(!updateScreenVector(d,d.source||"screen-fire",screenAimActive))return;lastScreenFireAt=performance.now();const view=viewport();if(view){view.dataset.walkWeaponFireVector="shared-center-ray-ads-v7";view.dataset.walkWeaponAimSource=String(d.source||"screen");}}
function reliableTouchSwitch(event){const button=event.target instanceof Element?event.target.closest("#footWeaponToggle"):null;if(!button||!isFoot())return;const now=performance.now();if(now-lastSwitchAt<170){event.preventDefault();event.stopImmediatePropagation();return;}const api=footWeapons();if(typeof api?.toggle!=="function")return;lastSwitchAt=now;button.dataset.weaponPointerToggleAt=String(now);event.preventDefault();event.stopImmediatePropagation();api.toggle();const view=viewport();if(view)view.dataset.walkWeaponSwitchLast="touch-pointerdown-v4";}
function suppressSyntheticClick(event){const button=event.target instanceof Element?event.target.closest("#footWeaponToggle"):null;if(!button)return;const at=Number(button.dataset.weaponPointerToggleAt)||-Infinity;if(performance.now()-at<750){event.preventDefault();event.stopImmediatePropagation();}}
function frame(now=performance.now()){
  ensureAdsStyle();const scene=bridge()?.threeScene,gun=scene?.getObjectByName?.("WALK_PISTOL_3D"),mode=String(footWeapons()?.mode||"pistol");ensureRenderHook(scene);if(gun){if(gun!==lastGun){hasPresentationSnapshot=false;adsBlend=0;lastGun=gun;lastMode="";}if(mode!==lastMode){lastMode=mode;hasPresentationSnapshot=false;}setWeaponModeVisual(gun,mode);if(!isFoot())screenAimActive=false;}
  const button=document.getElementById("footWeaponToggle");if(button){button.textContent=mode==="smg"?"MP → PISTOL":"PISTOL → MP";button.setAttribute("aria-label",mode==="smg"?"Switch to pistol":"Switch to MP");}
  const view=viewport();if(view){view.dataset.walkWeaponRuntime="dedicated-pistol+mp+ads-kimme-korn-v7";view.dataset.walkTouchFire="screen-center-raycast-ads-v6";view.dataset.walkWeaponAimFreshMs=Number.isFinite(lastScreenAimAt)?String(Math.max(0,Math.round(now-lastScreenAimAt))):"";}requestAnimationFrame(frame);
}
export function installFirstPersonWeaponRuntimeV3(){if(installed)return;installed=true;ensureAdsStyle();addEventListener("arondight:foot-screen-aim",onScreenAim);addEventListener("arondight:foot-screen-fire",onScreenFire);addEventListener("arondight:player-mode",()=>{if(!isFoot())screenAimActive=false;hasPresentationSnapshot=false;adsBlend=0;document.body.classList.remove("foot-ads-active");});window.addEventListener("pointerdown",reliableTouchSwitch,{capture:true,passive:false});window.addEventListener("click",suppressSyntheticClick,{capture:true,passive:false});requestAnimationFrame(frame);}
installFirstPersonWeaponRuntimeV3();
