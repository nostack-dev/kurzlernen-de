import * as THREE from "three";
import {buildVoltSmg,buildGoldenHandCannon,buildBoomstick,buildRocketLauncher,buildSniperRifle,buildFists,buildKnife,attachWeaponArms} from "./weapon_models.mjs";

const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number(v)||0));
const shotCamera=new THREE.PerspectiveCamera(78,16/9,.01,500),raycaster=new THREE.Raycaster(),ndc=new THREE.Vector2(),forward=new THREE.Vector3(),target=new THREE.Vector3();
const localBarrelForward=new THREE.Vector3(0,0,-1),currentBarrelForward=new THREE.Vector3(),shotDirection=new THREE.Vector3(0,1,0),fullAdjust=new THREE.Quaternion(),weightedAdjust=new THREE.Quaternion(),identityQuat=new THREE.Quaternion(),lastAppliedAdjust=new THREE.Quaternion();
const PISTOL_PARTS=new Set(["WALK_VM_FRAME","WALK_VM_RAIL","WALK_VM_SLIDE","WALK_VM_SLIDE_TOP","WALK_VM_BARREL","WALK_VM_MUZZLE","WALK_VM_EJECTION_PORT","WALK_VM_GRIP","WALK_VM_MAG_BASE","WALK_VM_TRIGGER_GUARD","WALK_VM_TRIGGER","WALK_VM_REAR_SIGHT","WALK_VM_FRONT_SIGHT","WALK_VM_FRONT_DOT"]);
// the old capsule gloves/sleeves of the walk-mode pistol rig: replaced by the per-weapon arms
const LEGACY_ARM_PARTS=new Set(["WALK_VM_SLEEVE_R","WALK_VM_CUFF_R","WALK_VM_SLEEVE_L","WALK_VM_CUFF_L","WALK_VM_GLOVE_R","WALK_VM_GLOVE_L","WALK_VM_GLOVE_PAD_R","WALK_VM_GLOVE_PAD_L"]);
const WEAPON_NAMES={smg:"MP",glock:"GLOCK",sniper:"SNIPER",grenade:"WERFER",rocket:"RAKETEN",fists:"FÄUSTE",knife:"MESSER"},WEAPON_ORDER=["smg","glock","sniper","grenade","rocket","fists","knife"];
let installed=false,lastScreenShotAt=-Infinity,lastSwitchAt=-Infinity,lastMode="",lastGun=null,hasAppliedAdjust=false,lastShotClientX=NaN,lastShotClientY=NaN,weaponButton=null,lastButtonMode="";

function viewport(){return document.getElementById("viewport");}
function bridge(){return globalThis.__arondightRealWorld||null;}
function walk(){return globalThis.__arondightWalkMode||null;}
function drive(){return globalThis.__arondightVehicleDrive||null;}
function footWeapons(){return globalThis.__arondightFootWeapons||null;}
function isFoot(){return walk()?.mode==="foot"&&!drive()?.active&&!globalThis.__jetMode?.active&&!walk()?.dead;}
function logicalPoint(clientX,clientY){const view=viewport(),screen=view?.getBoundingClientRect();if(!view||!screen)return null;const width=Math.max(1,view.clientWidth),height=Math.max(1,view.clientHeight),cx=Number.isFinite(clientX)?clientX:screen.left+screen.width/2,cy=Number.isFinite(clientY)?clientY:screen.top+screen.height/2,rotated=view.dataset.soloOrientation==="css-landscape",x=rotated?cy-screen.top:cx-screen.left,y=rotated?screen.right-cx:cy-screen.top;return{x:clamp(x,0,width),y:clamp(y,0,height),width,height};}
function shotRayDirection(clientX,clientY){const w=walk(),p=logicalPoint(clientX,clientY);if(!w?.position||!p)return null;shotCamera.fov=clamp(Number(viewport()?.dataset.walkCameraFovDeg)||Number(bridge()?.threeCamera?.fov)||78,45,120);shotCamera.aspect=p.width/p.height;shotCamera.position.set(Number(w.position.x)||0,Number(w.position.y)||0,Number(w.position.z)||1.68);shotCamera.up.set(0,0,1);const cp=Math.cos(Number(w.pitch)||0);forward.set(Math.sin(Number(w.yaw)||0)*cp,Math.cos(Number(w.yaw)||0)*cp,Math.sin(Number(w.pitch)||0)).normalize();shotCamera.lookAt(target.copy(shotCamera.position).add(forward));shotCamera.updateProjectionMatrix();shotCamera.updateMatrixWorld(true);ndc.set(p.x/p.width*2-1,1-p.y/p.height*2);raycaster.setFromCamera(ndc,shotCamera);return raycaster.ray.direction.clone();}
function material(options){return new THREE.MeshStandardMaterial({depthTest:true,depthWrite:true,...options});}
function mesh(name,geometry,mat,x,y,z,rx=0,ry=0,rz=0,order=9998){const m=new THREE.Mesh(geometry,mat);m.name=name;m.position.set(x,y,z);m.rotation.set(rx,ry,rz);m.renderOrder=order;m.frustumCulled=false;m.userData.flightFireIgnore=true;m.userData.walkWeaponPart=true;m.userData.walkSmgPart=true;return m;}
function launcherMesh(name,geometry,mat,x,y,z,rx=0,ry=0,rz=0,order=9998){const m=new THREE.Mesh(geometry,mat);m.name=name;m.position.set(x,y,z);m.rotation.set(rx,ry,rz);m.renderOrder=order;m.frustumCulled=false;m.userData.flightFireIgnore=true;m.userData.walkWeaponPart=true;m.userData.walkGrenadePart=true;return m;}
// Hero weapon skins (weapon_models.mjs). Group and muzzle-node names stay
// the same, so firing, muzzle flash and aiming code keep working.
// Each gun gets its own gloved arms (viewmodel_arms.mjs) posed on its grips.
function mount(gun,name,build,offset,meta,arms){let group=gun.getObjectByName?.(name);if(group)return group;group=build();group.name=name;group.position.add(offset);group.userData.flightFireIgnore=true;group.userData.walkWeaponPart=true;Object.assign(group.userData,meta);if(arms)attachWeaponArms(group,arms);gun.add(group);return group;}
function ensureSmg(gun){return mount(gun,"WALK_SMG_3D",buildVoltSmg,new THREE.Vector3(.012,.05,.015),{walkSmgViewmodel:"volt-smg-epic-v5"},"smg");}
function ensureGrenadeLauncher(gun){return mount(gun,"WALK_GRENADE_LAUNCHER_3D",buildBoomstick,new THREE.Vector3(.01,.1,.018),{walkGrenadePart:true,walkGrenadeViewmodel:"boomstick-40mm-v2"},"grenade");}
function ensureRocketLauncher(gun){return mount(gun,"WALK_ROCKET_LAUNCHER_3D",buildRocketLauncher,new THREE.Vector3(.01,.1,.02),{walkRocketViewmodel:"shoulder-tube-v1"},"rocket");}
function ensureSniper(gun){return mount(gun,"WALK_SNIPER_3D",buildSniperRifle,new THREE.Vector3(.012,.045,.02),{walkSniperViewmodel:"anti-materiel-50-v1"},"sniper");}
function ensureFists(gun){return mount(gun,"WALK_FISTS_3D",buildFists,new THREE.Vector3(0,0,0),{walkFistsViewmodel:"bare-fists-v1"});}
function ensureKnife(gun){return mount(gun,"WALK_KNIFE_3D",buildKnife,new THREE.Vector3(0,0,0),{walkKnifeViewmodel:"combat-knife-v1"});}
function ensureGlock(gun){
  let group=gun.getObjectByName?.("WALK_GLOCK_3D");if(group)return group;
  group=new THREE.Group();group.name="WALK_GLOCK_3D";group.position.set(.03,.12,-.14);group.userData.flightFireIgnore=true;group.userData.walkWeaponPart=true;group.userData.walkGlockViewmodel="dual-mirrored-matte-black-v3";
  // The right pistol sits in the right hand (the gun anchor). The left pistol
  // is a separate, mirrored viewmodel anchored in the left hand by the
  // first-person controller, so each gun aims at its own finger.
  const right=buildGoldenHandCannon();right.name="WALK_GLOCK_RIGHT";right.userData.walkGlockHand="right";
  // one pistol in the right hand
  right.position.x+=.02;right.position.y-=.006;attachWeaponArms(right,"glock");
  group.add(right);gun.add(group);return group;
}
function setWeaponModeVisual(gun,mode){
  const smg=ensureSmg(gun),launcher=ensureGrenadeLauncher(gun),rocketTube=ensureRocketLauncher(gun),glock=ensureGlock(gun),sniper=ensureSniper(gun),fists=ensureFists(gun),knife=ensureKnife(gun),isSmg=mode==="smg",isGrenade=mode==="grenade",isGlock=mode==="glock",isSniper=mode==="sniper";smg.visible=isSmg;launcher.visible=isGrenade;rocketTube.visible=mode==="rocket";glock.visible=isGlock;sniper.visible=isSniper;fists.visible=mode==="fists";knife.visible=mode==="knife";const conversion=gun.getObjectByName?.("FINAL_SMG_CONVERSION");if(conversion)conversion.visible=false;
  gun.traverse?.(node=>{if(PISTOL_PARTS.has(node.name)||LEGACY_ARM_PARTS.has(node.name)||node.userData?.walkArmHotfix)node.visible=false;});
  const flash=gun.getObjectByName?.("FINAL_MUZZLE_FLASH")||gun.getObjectByName?.("WALK_MUZZLE_FLASH");if(flash){flash.traverse?.(node=>{if(node.isMesh&&node.material){node.material.depthTest=true;node.material.depthWrite=false;node.material.needsUpdate=true;}if(node.isMesh)node.renderOrder=9996;});}
  gun.userData.finalWeapon=mode;gun.userData.walkWeaponViewmodel=isGrenade?"boomstick-40mm-v2":isSmg?"volt-smg-epic-v5":"dual-mirrored-matte-black-glock-v3";const view=viewport();if(view){view.dataset.walkWeapon=mode;view.dataset.walkWeaponViewmodel=gun.userData.walkWeaponViewmodel;view.dataset.walkSmgMesh=isSmg?"dedicated-receiver+barrel+magazine+brace-v4":"hidden";view.dataset.walkGrenadeLauncher=isGrenade?"40mm-visible-v1":"hidden";view.dataset.walkWeaponSwitch="single-owner-touch+q+dpad-v4";view.dataset.walkMuzzleOwnership="gameplay-runtime-dual-glock-nodes-v2";view.dataset.walkGlockViewmodel=isGlock?"dual-mirrored-matte-black-v3":"hidden";}
}
function clearPreviousVectorAdjustment(gun){if(!hasAppliedAdjust||gun!==lastGun)return;const inverse=lastAppliedAdjust.clone().invert();gun.quaternion.premultiply(inverse);hasAppliedAdjust=false;lastAppliedAdjust.identity();}
function alignGunToShot(gun,now){clearPreviousVectorAdjustment(gun);const age=now-lastScreenShotAt;if(age<0||age>900)return;const liveDirection=shotRayDirection(lastShotClientX,lastShotClientY);if(liveDirection)shotDirection.copy(liveDirection).normalize();currentBarrelForward.copy(localBarrelForward).applyQuaternion(gun.quaternion).normalize();if(currentBarrelForward.lengthSq()<.5||shotDirection.lengthSq()<.5)return;fullAdjust.setFromUnitVectors(currentBarrelForward,shotDirection);const weight=1;weightedAdjust.copy(fullAdjust);lastAppliedAdjust.copy(weightedAdjust);gun.quaternion.premultiply(weightedAdjust);hasAppliedAdjust=true;currentBarrelForward.copy(localBarrelForward).applyQuaternion(gun.quaternion).normalize();const errorDeg=currentBarrelForward.angleTo(shotDirection)*180/Math.PI,view=viewport();if(view){view.dataset.walkWeaponVectorAlignment="exact-screen-ray-from-hand-anchor-v5";view.dataset.walkWeaponAimVector=`${shotDirection.x.toFixed(4)},${shotDirection.y.toFixed(4)},${shotDirection.z.toFixed(4)}`;view.dataset.walkWeaponAimWeight=weight.toFixed(3);view.dataset.walkWeaponAimErrorDeg=errorDeg.toFixed(3);view.dataset.walkWeaponHandAnchor="position-fixed-rotation-only-v1";}}
function onScreenFire(event){if(!isFoot()||(performance.now()<(Number(globalThis.__arondightWeaponLockUntil)||0)))return;const d=event?.detail||{},x=Number(d.clientX),y=Number(d.clientY),dir=shotRayDirection(x,y);if(!dir)return;lastShotClientX=x;lastShotClientY=y;shotDirection.copy(dir).normalize();lastScreenShotAt=performance.now();const view=viewport();if(view){view.dataset.walkWeaponFireVector="touch-screen-ray-v5";view.dataset.walkWeaponAimSource=String(d.source||"screen");view.dataset.walkWeaponHandAnchor="position-fixed-rotation-only-v1";}}
function reliableTouchSwitch(event){const button=event.target instanceof Element?event.target.closest("#footWeaponToggle"):null;if(!button||!isFoot())return;const now=performance.now();if(now-lastSwitchAt<170){event.preventDefault();event.stopImmediatePropagation();return;}const api=footWeapons();if(typeof api?.toggle!=="function")return;lastSwitchAt=now;button.dataset.weaponPointerToggleAt=String(now);event.preventDefault();event.stopImmediatePropagation();api.toggle();const view=viewport();if(view)view.dataset.walkWeaponSwitchLast="touch-pointerdown-v4";}
function suppressSyntheticClick(event){const button=event.target instanceof Element?event.target.closest("#footWeaponToggle"):null;if(!button)return;const at=Number(button.dataset.weaponPointerToggleAt)||-Infinity;if(performance.now()-at<750){event.preventDefault();event.stopImmediatePropagation();}}
// Glock feel: the slide cycles back and returns on every shot (a 9 mm slide travels ~30 mm in
// about 20 ms and is back in battery ~60 ms later) and a brass case flips out of the port.
const SLIDE_TRAVEL=.062,SLIDE_BACK_MS=34,SLIDE_HOLD_MS=26,SLIDE_RETURN_MS=105,CASE_LIFE_MS=620; /* visible on 30 fps phones too: back, a beat at the rear, then home */
const glockFx={pistol:null,slide:null,baseZ:0,eject:null,kickAt:-Infinity,cases:[],caseGeo:null,caseMat:null,cursor:0};
function ensureGlockFx(gun){const pistol=gun?.getObjectByName?.("WALK_GLOCK_RIGHT");if(!pistol)return null;if(glockFx.pistol!==pistol){glockFx.pistol=pistol;glockFx.slide=pistol.getObjectByName("WALK_GLOCK_SLIDE");glockFx.baseZ=glockFx.slide?.position.z||0;glockFx.eject=pistol.getObjectByName("WALK_GLOCK_EJECT");glockFx.cases=[];
  glockFx.caseGeo??=new THREE.CylinderGeometry(.0048,.0048,.019,8);glockFx.caseMat??=new THREE.MeshStandardMaterial({color:0xd9a441,metalness:.85,roughness:.28});
  for(let i=0;i<4;i++){const m=new THREE.Mesh(glockFx.caseGeo,glockFx.caseMat);m.visible=false;m.frustumCulled=false;m.renderOrder=9998;m.userData.flightFireIgnore=true;m.userData.walkWeaponPart=true;pistol.add(m);glockFx.cases.push({mesh:m,born:-Infinity,v:new THREE.Vector3(),spin:new THREE.Vector3()});}}
  return glockFx;}
// boxing: each fist has its own punch (left = jab, right = cross); a guard sway in between
const fistAt=[-Infinity,-Infinity],fistCombo=[false,false];
let knifeAt=-Infinity,knifeSide=1,knifeKickAt=-Infinity;
function onWeaponFired(event){const d=event?.detail||{};if(d.weapon==="knife"&&d.mode==="foot"){knifeAt=performance.now();knifeSide=-knifeSide;knifeKickAt=knifeAt+KNIFE_HIT_MS;return;}if(d.weapon==="fists"&&d.mode==="foot"){const h=d.hand===1?1:0;fistAt[h]=performance.now();fistCombo[h]=Boolean(d.combo);return;}if(d.weapon!=="glock"||d.mode!=="foot")return;const fx=ensureGlockFx(findGun(performance.now()));if(!fx)return;const now=performance.now();fx.kickAt=now;
  const c=fx.cases[fx.cursor++%fx.cases.length];if(c&&fx.eject){c.born=now;c.mesh.position.copy(fx.eject.position);c.mesh.rotation.set(Math.random()*3,0,Math.PI/2);c.v.set(.75+Math.random()*.35,.55+Math.random()*.3,.12+Math.random()*.18);c.spin.set(18+Math.random()*10,6*Math.random(),22+Math.random()*12);c.mesh.visible=true;}}
function stepGlockFx(now,dt){const fx=glockFx;if(!fx.pistol)return;
  if(fx.slide){const t=now-fx.kickAt;let off=0;if(t>=0&&t<SLIDE_BACK_MS)off=SLIDE_TRAVEL*Math.sin(t/SLIDE_BACK_MS*Math.PI/2);else if(t>=SLIDE_BACK_MS&&t<SLIDE_BACK_MS+SLIDE_HOLD_MS)off=SLIDE_TRAVEL;else if(t>=SLIDE_BACK_MS+SLIDE_HOLD_MS&&t<SLIDE_BACK_MS+SLIDE_HOLD_MS+SLIDE_RETURN_MS){const u=(t-SLIDE_BACK_MS-SLIDE_HOLD_MS)/SLIDE_RETURN_MS;off=SLIDE_TRAVEL*(1-u)*(1-u)*(1-.15*Math.sin(u*Math.PI));}const z=fx.baseZ+off;if(fx.slide.position.z!==z)fx.slide.position.z=z;}
  for(const c of fx.cases){if(!c.mesh.visible)continue;if(now-c.born>CASE_LIFE_MS){c.mesh.visible=false;continue;}c.v.y-=6.5*dt;c.mesh.position.addScaledVector(c.v,dt);c.mesh.rotation.x+=c.spin.x*dt;c.mesh.rotation.y+=c.spin.y*dt;c.mesh.rotation.z+=c.spin.z*dt;}}
// KNIFE (CoD feel): wind-up 70 ms (hand cocks back/right), strike 120 ms (fast diagonal slash
// right→left, or a forward stab on every second swing), 60 ms follow-through, 200 ms recovery.
// The hit lands at the strike frame (gameplay_final_runtime_v2 KNIFE_STRIKE_MS), the slash smear
// fades in with the strike and the camera kicks at the same moment.
const KNIFE_WIND_MS=70,KNIFE_STRIKE_MS=120,KNIFE_FOLLOW_MS=60,KNIFE_RECOVER_MS=200,KNIFE_HIT_MS=KNIFE_WIND_MS+KNIFE_STRIKE_MS*.5;
//            x     y     z     rx    ry    rz
const KNIFE_IDLE=[0,0,0,0,0,0];
// slash: cocks up and out to the right, then cuts across to the left (blade flat, edge leading)
const KNIFE_SLASH=[[.04,.06,.05,.3,-.4,.35],[-.2,-.06,-.22,-.05,1.15,-.1],[-.24,-.09,-.2,-.1,1.25,-.15]];
// stab (every second swing): pulls back low, then drives in towards the crosshair
const KNIFE_STAB=[[.05,-.08,.1,.3,.1,-.1],[-.07,-.02,-.24,0,.2,.1],[-.08,-.025,-.27,-.02,.24,.12]];
const knifePose=[0,0,0,0,0,0];let knifeRefs=null;
const TRAIL_LIFE_MS=110,trailHist=[],trailTip=new THREE.Vector3(),trailBase=new THREE.Vector3(),trailM=new THREE.Matrix4();
// blade path ribbon in the knife group's space: hand · grip pose · knife
function stepKnifeTrail(refs,t,now){
  const{trail,hand,blade}=refs;if(!trail||!blade)return;const swinging=t>=KNIFE_WIND_MS*.6&&t<KNIFE_WIND_MS+KNIFE_STRIKE_MS+KNIFE_FOLLOW_MS;
  if(swinging){hand.updateMatrix();blade.parent.updateMatrix();blade.updateMatrix();trailM.copy(hand.matrix).multiply(blade.parent.matrix).multiply(blade.matrix);
    trailTip.copy(blade.userData.tipLocal).applyMatrix4(trailM);trailBase.copy(blade.userData.baseLocal).applyMatrix4(trailM);
    const last=trailHist[trailHist.length-1];if(!last||now-last.at>4)trailHist.push({at:now,tip:trailTip.clone(),base:trailBase.clone()});}
  while(trailHist.length&&(now-trailHist[0].at>TRAIL_LIFE_MS||trailHist.length>trail.userData.samples))trailHist.shift();
  const n=trailHist.length;trail.visible=n>=2;if(n<2){trail.geometry.setDrawRange(0,0);return;}
  const pos=trail.geometry.attributes.position,col=trail.geometry.attributes.color;
  for(let i=0;i<n;i++){const h=trailHist[i],a=clamp(1-(now-h.at)/TRAIL_LIFE_MS,0,1)*(i/(n-1))**.7,c=.62*a;pos.setXYZ(i*2,h.tip.x,h.tip.y,h.tip.z);pos.setXYZ(i*2+1,h.base.x,h.base.y,h.base.z);col.setXYZ(i*2,c,c*1.02,c*1.08);col.setXYZ(i*2+1,c*.15,c*.15,c*.17);}
  pos.needsUpdate=true;col.needsUpdate=true;trail.geometry.setDrawRange(0,(n-1)*6);trail.geometry.computeBoundingSphere();
}
const easeOut=u=>1-(1-u)**3,easeInOut=u=>u<.5?4*u*u*u:1-(-2*u+2)**3/2;
function lerpPose(a,b,u,out){for(let i=0;i<6;i++)out[i]=a[i]+(b[i]-a[i])*u;return out;}
function animateKnife(gun,now){
  if(!knifeRefs||knifeRefs.gun!==gun||!knifeRefs.hand?.parent){knifeRefs={gun,hand:gun.getObjectByName?.("WALK_KNIFE_HAND"),trail:gun.getObjectByName?.("WALK_KNIFE_TRAIL"),blade:gun.getObjectByName?.("WALK_KNIFE_BLADE")};trailHist.length=0;}
  const{hand,trail}=knifeRefs;if(!hand)return;
  const t=now-knifeAt,keys=knifeSide>0?KNIFE_SLASH:KNIFE_STAB,W=KNIFE_WIND_MS,S=KNIFE_STRIKE_MS,F=KNIFE_FOLLOW_MS,R=KNIFE_RECOVER_MS;let strikeU=-1;
  if(t<0||t>=W+S+F+R)lerpPose(KNIFE_IDLE,KNIFE_IDLE,0,knifePose);
  else if(t<W)lerpPose(KNIFE_IDLE,keys[0],easeOut(t/W),knifePose);
  else if(t<W+S){strikeU=(t-W)/S;lerpPose(keys[0],keys[1],easeInOut(strikeU),knifePose);}
  else if(t<W+S+F)lerpPose(keys[1],keys[2],easeOut((t-W-S)/F),knifePose);
  else lerpPose(keys[2],KNIFE_IDLE,easeInOut((t-W-S-F)/R),knifePose);
  // idle: held low right, slow breathing sway (and a little tilt)
  const breathe=Math.sin(now/620),sway=Math.sin(now/1130);
  hand.position.set(.16+knifePose[0]+sway*.004,-.02+knifePose[1]+breathe*.006,knifePose[2]);
  hand.rotation.set(knifePose[3]+breathe*.025,knifePose[4]+sway*.02,knifePose[5]);
  stepKnifeTrail(knifeRefs,t,now);void strikeU;void trail;
  const view=viewport();if(view){const phase=t<0||t>=W+S+F+R?"idle":t<W?"windup":t<W+S?"strike":t<W+S+F?"follow":"recover";if(view.dataset.walkKnifePhase!==phase)view.dataset.walkKnifePhase=phase;}
}
// camera kick at the knife's hit frame (pre-render: the walk camera and the viewmodel are
// placed; rotate both about the eye so the hands stay planted in view)
const kickQ=new THREE.Quaternion(),kickE=new THREE.Euler(),kickD=new THREE.Quaternion(),kickV=new THREE.Vector3(),kickInv=new THREE.Quaternion();
function knifeCameraKick(scene,camera,now){
  const age=now-knifeKickAt;if(!(age>=0&&age<170)||!camera||!isFoot())return;
  const k=age<35?age/35:Math.exp(-(age-35)/45)*(1-(age-35)/135),side=knifeSide>0?1:0;
  kickE.set(-.022*k,(side?.02:0)*k,(side?-.028:.006)*k);kickQ.setFromEuler(kickE);
  kickInv.copy(camera.quaternion);kickD.copy(camera.quaternion).multiply(kickQ).multiply(kickInv.invert());
  camera.quaternion.multiply(kickQ);camera.updateMatrixWorld();
  const gun=findGun(now);if(gun&&gun.visible!==false){kickV.copy(gun.position).sub(camera.position).applyQuaternion(kickD);gun.position.copy(camera.position).add(kickV);gun.quaternion.premultiply(kickD);gun.updateMatrixWorld(true);}
}
let lastFxFrame=performance.now();
let lastVisualSync=-Infinity,gunRef=null,gunLookupAt=-Infinity;
// getObjectByName walks the whole scene — cache the viewmodel and re-check rarely
function findGun(now){const scene=bridge()?.threeScene;if(!scene)return null;let ok=false;for(let n=gunRef;n;n=n.parent)if(n===scene){ok=true;break;}if(ok&&now-gunLookupAt<2000)return gunRef;if(!ok&&now-gunLookupAt<250)return null;gunLookupAt=now;gunRef=scene.getObjectByName?.("WALK_PISTOL_3D")||null;return gunRef;} // visual sync (traversal + material flags) only on change or once a second, not every frame
function frame(now=performance.now()){
  const gun=findGun(now),mode=String(footWeapons()?.mode||"smg");if(gun){if(gun!==lastGun){hasAppliedAdjust=false;lastAppliedAdjust.identity();lastGun=gun;lastMode="";}if(mode!==lastMode){lastMode=mode;lastVisualSync=now;setWeaponModeVisual(gun,mode);}/* aiming is owned by first_person_controller_v5.mjs */}
  if(!weaponButton?.isConnected)weaponButton=document.getElementById("footWeaponToggle");const key=mode,name=m=>WEAPON_NAMES[m];if(weaponButton&&(key!==lastButtonMode||!weaponButton.textContent.includes("→"))){lastButtonMode=key;const next=WEAPON_ORDER[(WEAPON_ORDER.indexOf(mode)+1)%WEAPON_ORDER.length],text=`${name(mode)||"MP"} → ${name(next)}`;if(weaponButton.textContent!==text)weaponButton.textContent=text;weaponButton.setAttribute("aria-label",`Switch from ${mode} to ${next}`);}
  {const dt=Math.min(.05,Math.max(0,(now-lastFxFrame)/1000));lastFxFrame=now;if(mode==="glock"&&gun)ensureGlockFx(gun);stepGlockFx(now,dt);}
  if(mode==="knife"&&gun)animateKnife(gun,now);
  if(mode==="fists"&&gun){const breathe=Math.sin(now/420)*.006,sway=Math.sin(now/260)*.01;for(const[name,h]of[["WALK_FIST_R",0],["WALK_FIST_L",1]]){const fist=gun.getObjectByName?.(name);if(!fist)continue;const t=now-fistAt[h],out=h?75:95,back=h?170:230,e=t<0||t>out+back?0:t<out?Math.sin(t/out*Math.PI/2):1-((t-out)/back)**2,other=now-fistAt[1-h]<out+back?.05:0,reach=(h?-.42:-.5)*(fistCombo[h]?1.08:1);
    // a real straight punch: the fist drives out and slightly up, the forearm turns over (palm down)
    // at the end, the shoulder brings it towards the centre line; the other hand tucks back to the chin
    fist.position.z=reach*e+other*(1-e);fist.position.y=-.02+.06*e-.015*(1-e)*other*8+(h?sway:-sway)+breathe;fist.position.x=h?-.16+.05*e:.16-.08*e;fist.rotation.z=(h?.55:-.7)*e;fist.rotation.x=-.12*e;fist.rotation.y=(h?-.12:.16)*e;}}
  requestAnimationFrame(frame);
}
export function installFirstPersonWeaponRuntimeV3(){if(installed)return;installed=true;addEventListener("arondight:weapon-fired",onWeaponFired);addEventListener("arondight:foot-screen-fire",onScreenFire);window.addEventListener("pointerdown",reliableTouchSwitch,{capture:true,passive:false});window.addEventListener("click",suppressSyntheticClick,{capture:true,passive:false});addEventListener("arondight:world-reset",()=>{gunRef=null;lastGun=null;lastMode="";gunLookupAt=-Infinity;knifeRefs=null;});{const attach=()=>{const b=bridge();if(typeof b?.addPreRenderHook!=="function")return requestAnimationFrame(attach);b.addPreRenderHook(knifeCameraKick);};attach();}const view=viewport();if(view){view.dataset.walkWeaponRuntime="dedicated-mp+40mm-no-pistol-v7";view.dataset.walkTouchFire="screen-point-raycast-v5";view.dataset.walkWeaponHousekeeping="change-driven-v1";}requestAnimationFrame(frame);}
installFirstPersonWeaponRuntimeV3();
