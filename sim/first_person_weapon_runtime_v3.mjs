import * as THREE from "three";

const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number(v)||0));
const shotCamera=new THREE.PerspectiveCamera(78,16/9,.01,500),raycaster=new THREE.Raycaster(),ndc=new THREE.Vector2(),forward=new THREE.Vector3(),target=new THREE.Vector3();
const localBarrelForward=new THREE.Vector3(0,0,-1),currentBarrelForward=new THREE.Vector3(),shotDirection=new THREE.Vector3(0,1,0),fullAdjust=new THREE.Quaternion(),weightedAdjust=new THREE.Quaternion(),identityQuat=new THREE.Quaternion(),lastAppliedAdjust=new THREE.Quaternion();
const PISTOL_PARTS=new Set(["WALK_VM_FRAME","WALK_VM_RAIL","WALK_VM_SLIDE","WALK_VM_SLIDE_TOP","WALK_VM_BARREL","WALK_VM_MUZZLE","WALK_VM_EJECTION_PORT","WALK_VM_GRIP","WALK_VM_MAG_BASE","WALK_VM_TRIGGER_GUARD","WALK_VM_TRIGGER","WALK_VM_REAR_SIGHT","WALK_VM_FRONT_SIGHT","WALK_VM_FRONT_DOT"]);
let installed=false,lastScreenShotAt=-Infinity,lastSwitchAt=-Infinity,lastMode="",lastGun=null,hasAppliedAdjust=false,lastShotClientX=NaN,lastShotClientY=NaN;

function viewport(){return document.getElementById("viewport");}
function bridge(){return globalThis.__arondightRealWorld||null;}
function walk(){return globalThis.__arondightWalkMode||null;}
function drive(){return globalThis.__arondightVehicleDrive||null;}
function footWeapons(){return globalThis.__arondightFootWeapons||null;}
function isFoot(){return walk()?.mode==="foot"&&!drive()?.active&&!walk()?.dead;}
function logicalPoint(clientX,clientY){const view=viewport(),screen=view?.getBoundingClientRect();if(!view||!screen)return null;const width=Math.max(1,view.clientWidth),height=Math.max(1,view.clientHeight),cx=Number.isFinite(clientX)?clientX:screen.left+screen.width/2,cy=Number.isFinite(clientY)?clientY:screen.top+screen.height/2,rotated=view.dataset.soloOrientation==="css-landscape",x=rotated?cy-screen.top:cx-screen.left,y=rotated?screen.right-cx:cy-screen.top;return{x:clamp(x,0,width),y:clamp(y,0,height),width,height};}
function shotRayDirection(clientX,clientY){const w=walk(),p=logicalPoint(clientX,clientY);if(!w?.position||!p)return null;shotCamera.fov=clamp(Number(viewport()?.dataset.walkCameraFovDeg)||Number(bridge()?.threeCamera?.fov)||78,45,120);shotCamera.aspect=p.width/p.height;shotCamera.position.set(Number(w.position.x)||0,Number(w.position.y)||0,Number(w.position.z)||1.68);shotCamera.up.set(0,0,1);const cp=Math.cos(Number(w.pitch)||0);forward.set(Math.sin(Number(w.yaw)||0)*cp,Math.cos(Number(w.yaw)||0)*cp,Math.sin(Number(w.pitch)||0)).normalize();shotCamera.lookAt(target.copy(shotCamera.position).add(forward));shotCamera.updateProjectionMatrix();shotCamera.updateMatrixWorld(true);ndc.set(p.x/p.width*2-1,1-p.y/p.height*2);raycaster.setFromCamera(ndc,shotCamera);return raycaster.ray.direction.clone();}
function material(options){return new THREE.MeshStandardMaterial({depthTest:true,depthWrite:true,...options});}
function mesh(name,geometry,mat,x,y,z,rx=0,ry=0,rz=0,order=9998){const m=new THREE.Mesh(geometry,mat);m.name=name;m.position.set(x,y,z);m.rotation.set(rx,ry,rz);m.renderOrder=order;m.frustumCulled=false;m.userData.flightFireIgnore=true;m.userData.walkWeaponPart=true;m.userData.walkSmgPart=true;return m;}
function launcherMesh(name,geometry,mat,x,y,z,rx=0,ry=0,rz=0,order=9998){const m=new THREE.Mesh(geometry,mat);m.name=name;m.position.set(x,y,z);m.rotation.set(rx,ry,rz);m.renderOrder=order;m.frustumCulled=false;m.userData.flightFireIgnore=true;m.userData.walkWeaponPart=true;m.userData.walkGrenadePart=true;return m;}
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
function ensureGrenadeLauncher(gun){
  let group=gun.getObjectByName?.("WALK_GRENADE_LAUNCHER_3D");if(group)return group;
  group=new THREE.Group();group.name="WALK_GRENADE_LAUNCHER_3D";group.position.set(.010,-.015,.018);group.userData.flightFireIgnore=true;group.userData.walkWeaponPart=true;group.userData.walkGrenadePart=true;group.userData.walkGrenadeViewmodel="dedicated-40mm-break-action-v1";
  const steel=material({color:0x202923,roughness:.32,metalness:.68}),tube=material({color:0x111713,roughness:.42,metalness:.54}),polymer=material({color:0x0a100d,roughness:.82,metalness:.05}),accent=new THREE.MeshBasicMaterial({color:0x00ff9c,depthTest:true,depthWrite:false,toneMapped:false});
  group.add(
    launcherMesh("WALK_GL_RECEIVER",new THREE.BoxGeometry(.190,.145,.285),steel,0,-.010,-.245),
    launcherMesh("WALK_GL_TUBE",new THREE.CylinderGeometry(.052,.052,.545,14),tube,0,.020,-.565,Math.PI/2,0,0),
    launcherMesh("WALK_GL_MUZZLE_RING",new THREE.TorusGeometry(.055,.008,6,16),accent,0,.020,-.840,Math.PI/2,0,0,9999),
    launcherMesh("WALK_GL_BREECH",new THREE.BoxGeometry(.205,.170,.120),steel,0,-.005,-.080),
    launcherMesh("WALK_GL_GRIP",new THREE.BoxGeometry(.105,.235,.115),polymer,0,-.190,-.115,-.16,0,0),
    launcherMesh("WALK_GL_STOCK",new THREE.BoxGeometry(.180,.105,.235),polymer,0,-.060,.130,-.04,0,0),
    launcherMesh("WALK_GL_TOP_RAIL",new THREE.BoxGeometry(.100,.026,.360),polymer,0,.125,-.335),
    launcherMesh("WALK_GL_REAR_SIGHT",new THREE.BoxGeometry(.072,.042,.036),polymer,0,.151,-.120),
    launcherMesh("WALK_GL_FRONT_SIGHT",new THREE.BoxGeometry(.038,.050,.032),polymer,0,.154,-.720),
    launcherMesh("WALK_GL_FRONT_DOT",new THREE.SphereGeometry(.007,6,4),accent,0,.177,-.728,0,0,0,9999)
  );
  const muzzleNode=new THREE.Object3D();muzzleNode.name="WALK_GRENADE_MUZZLE_NODE";muzzleNode.position.set(0,.020,-.895);muzzleNode.userData.flightFireIgnore=true;muzzleNode.userData.walkWeaponPart=true;muzzleNode.userData.walkGrenadePart=true;group.add(muzzleNode);gun.add(group);return group;
}
function setWeaponModeVisual(gun,mode){
  const smg=ensureSmg(gun),launcher=ensureGrenadeLauncher(gun),isSmg=mode==="smg",isGrenade=mode==="grenade";smg.visible=isSmg;launcher.visible=isGrenade;const conversion=gun.getObjectByName?.("FINAL_SMG_CONVERSION");if(conversion)conversion.visible=false;
  gun.traverse?.(node=>{if(PISTOL_PARTS.has(node.name))node.visible=!isSmg&&!isGrenade;});
  const flash=gun.getObjectByName?.("FINAL_MUZZLE_FLASH")||gun.getObjectByName?.("WALK_MUZZLE_FLASH");if(flash){flash.traverse?.(node=>{if(node.isMesh&&node.material){node.material.depthTest=true;node.material.depthWrite=false;node.material.needsUpdate=true;}if(node.isMesh)node.renderOrder=9996;});}
  gun.userData.finalWeapon=mode;gun.userData.walkWeaponViewmodel=isGrenade?"dedicated-40mm-break-action-v1":isSmg?"dedicated-mp-mesh-v4":"compact-pistol-gloves-v2";const view=viewport();if(view){view.dataset.walkWeapon=mode;view.dataset.walkWeaponViewmodel=gun.userData.walkWeaponViewmodel;view.dataset.walkSmgMesh=isSmg?"dedicated-receiver+barrel+magazine+brace-v4":"hidden";view.dataset.walkGrenadeLauncher=isGrenade?"40mm-visible-v1":"hidden";view.dataset.walkWeaponSwitch="single-owner-touch+q+dpad-v4";view.dataset.walkMuzzleOwnership="gameplay-runtime-dedicated-node-v1";}
}
function clearPreviousVectorAdjustment(gun){if(!hasAppliedAdjust||gun!==lastGun)return;const inverse=lastAppliedAdjust.clone().invert();gun.quaternion.premultiply(inverse);hasAppliedAdjust=false;lastAppliedAdjust.identity();}
function alignGunToShot(gun,now){clearPreviousVectorAdjustment(gun);const age=now-lastScreenShotAt;if(age<0||age>900)return;const liveDirection=shotRayDirection(lastShotClientX,lastShotClientY);if(liveDirection)shotDirection.copy(liveDirection).normalize();currentBarrelForward.copy(localBarrelForward).applyQuaternion(gun.quaternion).normalize();if(currentBarrelForward.lengthSq()<.5||shotDirection.lengthSq()<.5)return;fullAdjust.setFromUnitVectors(currentBarrelForward,shotDirection);const weight=1;weightedAdjust.copy(fullAdjust);lastAppliedAdjust.copy(weightedAdjust);gun.quaternion.premultiply(weightedAdjust);hasAppliedAdjust=true;currentBarrelForward.copy(localBarrelForward).applyQuaternion(gun.quaternion).normalize();const errorDeg=currentBarrelForward.angleTo(shotDirection)*180/Math.PI,view=viewport();if(view){view.dataset.walkWeaponVectorAlignment="exact-screen-ray-from-hand-anchor-v5";view.dataset.walkWeaponAimVector=`${shotDirection.x.toFixed(4)},${shotDirection.y.toFixed(4)},${shotDirection.z.toFixed(4)}`;view.dataset.walkWeaponAimWeight=weight.toFixed(3);view.dataset.walkWeaponAimErrorDeg=errorDeg.toFixed(3);view.dataset.walkWeaponHandAnchor="position-fixed-rotation-only-v1";}}
function onScreenFire(event){if(!isFoot())return;const d=event?.detail||{},x=Number(d.clientX),y=Number(d.clientY),dir=shotRayDirection(x,y);if(!dir)return;lastShotClientX=x;lastShotClientY=y;shotDirection.copy(dir).normalize();lastScreenShotAt=performance.now();const view=viewport();if(view){view.dataset.walkWeaponFireVector="touch-screen-ray-v5";view.dataset.walkWeaponAimSource=String(d.source||"screen");view.dataset.walkWeaponHandAnchor="position-fixed-rotation-only-v1";}}
function reliableTouchSwitch(event){const button=event.target instanceof Element?event.target.closest("#footWeaponToggle"):null;if(!button||!isFoot())return;const now=performance.now();if(now-lastSwitchAt<170){event.preventDefault();event.stopImmediatePropagation();return;}const api=footWeapons();if(typeof api?.toggle!=="function")return;lastSwitchAt=now;button.dataset.weaponPointerToggleAt=String(now);event.preventDefault();event.stopImmediatePropagation();api.toggle();const view=viewport();if(view)view.dataset.walkWeaponSwitchLast="touch-pointerdown-v4";}
function suppressSyntheticClick(event){const button=event.target instanceof Element?event.target.closest("#footWeaponToggle"):null;if(!button)return;const at=Number(button.dataset.weaponPointerToggleAt)||-Infinity;if(performance.now()-at<750){event.preventDefault();event.stopImmediatePropagation();}}
function frame(now=performance.now()){
  const gun=bridge()?.threeScene?.getObjectByName?.("WALK_PISTOL_3D"),mode=String(footWeapons()?.mode||"smg");if(gun){if(gun!==lastGun){hasAppliedAdjust=false;lastAppliedAdjust.identity();lastGun=gun;lastMode="";}if(mode!==lastMode){lastMode=mode;setWeaponModeVisual(gun,mode);}else setWeaponModeVisual(gun,mode);/* aiming is owned by first_person_controller_v5.mjs */}
  const button=document.getElementById("footWeaponToggle");if(button){const next=mode==="smg"?"GRENADE":"MP";button.textContent=`${mode==="smg"?"MP":"GRENADE"} → ${next}`;button.setAttribute("aria-label",`Switch from ${mode} to ${next.toLowerCase()}`);}
  const view=viewport();if(view){view.dataset.walkWeaponRuntime="dedicated-mp+40mm-no-pistol-v6";view.dataset.walkTouchFire="screen-point-raycast-v5";}requestAnimationFrame(frame);
}
export function installFirstPersonWeaponRuntimeV3(){if(installed)return;installed=true;addEventListener("arondight:foot-screen-fire",onScreenFire);window.addEventListener("pointerdown",reliableTouchSwitch,{capture:true,passive:false});window.addEventListener("click",suppressSyntheticClick,{capture:true,passive:false});requestAnimationFrame(frame);}
installFirstPersonWeaponRuntimeV3();
