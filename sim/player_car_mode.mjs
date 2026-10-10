import * as THREE from "three";
import {findXboxGamepad} from "./xbox_gamepad.mjs";
import {claimSticks,releaseSticks,sticks} from "./shared_sticks.mjs";
import {VEHICLE_CONTROL_SETTINGS_EVENT,loadVehicleControlSettings,normalizeVehicleControlSettings} from "./vehicle_control_settings.mjs";

const ENTER_RADIUS_M=5.2;
const keys=new Set();
const tmp=new THREE.Vector3();
const forward=new THREE.Vector3();
const target=new THREE.Vector3();
let installed=false,active=false,vehicle=null,heading=0,commandSpeed=0,lastFrame=performance.now(),cameraInstalled=false,baseCameraProvider=null,cameraFireKick=0,cameraFirePhase=0,lastCameraAt=performance.now();
let touchSteer=0,touchPedal=0,touchLookX=0,touchLookY=0,handbrake=false,lastNearestScan=-Infinity,nearest=null;
let settings=loadVehicleControlSettings();
const nativeGetGamepads=typeof navigator!=="undefined"&&navigator.getGamepads?navigator.getGamepads.bind(navigator):()=>[];
const clamp=(v,min,max)=>Math.max(min,Math.min(max,Number(v)||0));

function viewport(){return document.getElementById("viewport");}
function bridge(){return globalThis.__arondightRealWorld||null;}
function physics(){return globalThis.__arondightWorldRigidBodies||null;}
function walk(){return globalThis.__arondightWalkMode||null;}
function playerDead(){return Boolean(globalThis.__arondightPlayerDamageModel?.dead);}
function quaternionYaw(q){if(!Array.isArray(q)||q.length<4)return 0;const[x,y,z,w]=q.map(Number);return Math.atan2(2*(w*z+x*y),1-2*(y*y+z*z));}
function vehiclePose(){const pose=vehicle?physics()?.pose?.(vehicle.id):null;if(pose?.position)return pose;if(vehicle?.root)return{position:[vehicle.root.position.x,vehicle.root.position.y,vehicle.root.position.z+.42],rotation:[vehicle.root.quaternion.x,vehicle.root.quaternion.y,vehicle.root.quaternion.z,vehicle.root.quaternion.w],velocity:[0,0,0]};return null;}
function vehicleRoots(){const scene=bridge()?.threeScene,out=[];if(!scene)return out;scene.traverse(node=>{if(!node?.isGroup||node.visible===false)return;const kind=String(node.userData?.worldPopulationKind||""),id=String(node.userData?.worldPopulationId||node.userData?.worldProceduralId||"");if((kind==="car"||node.userData?.gtaDrivableVehicle===true)&&id)out.push({id,root:node});});return out;}
function nearestVehicle(now=performance.now()){if(active)return vehicle;if(now-lastNearestScan<240)return nearest;lastNearestScan=now;nearest=null;const w=walk();if(w?.mode!=="foot"||!w.position)return null;let best=ENTER_RADIUS_M;for(const record of vehicleRoots()){record.root.getWorldPosition(tmp);const d=Math.hypot(tmp.x-w.position.x,tmp.y-w.position.y);if(d<best){best=d;nearest={...record,distance:d};}}return nearest;}
function clearFootKeys(){for(const code of["KeyW","KeyA","KeyS","KeyD","ShiftLeft","ShiftRight"])dispatchEvent(new KeyboardEvent("keyup",{code}));}
// The pad is no longer blacked out for every other module while driving (that killed the menu, exit and
// reset on the pad); the walker ignores the pad itself while body.player-driving is set.
function suppressFootGamepad(){}
function setDrivingUi(value){document.body.classList.toggle("player-driving",value);const modeButton=document.getElementById("playerModeButton");if(modeButton){modeButton.disabled=value;modeButton.style.opacity=value?".45":"";}const view=viewport();if(view){view.dataset.playerDriveMode=value?"vehicle":"off";view.dataset.playerControlMode=value?"vehicle":(walk()?.mode||"drone");}}
function enter(record=nearestVehicle()){
  if(active||playerDead()||walk()?.mode!=="foot"||!record?.id)return false;const engine=physics();let pose=engine?.pose?.(record.id),root=record.root||vehicleRoots().find(item=>item.id===record.id)?.root||null;if(!pose?.position&&root&&typeof engine?.upsertBody==="function"){root.getWorldPosition(tmp);const q=root.quaternion,yaw=quaternionYaw([q.x,q.y,q.z,q.w]);engine.upsertBody({id:record.id,kind:"car",position:[tmp.x,tmp.y,Math.max(.42,tmp.z+.42)],yaw,halfExtents:[1.78,.82,.42],massKg:1420});pose=engine.pose?.(record.id);}if(!pose?.position)return false;
  vehicle={id:record.id,root};heading=quaternionYaw(pose.rotation);forward.set(Math.cos(heading),Math.sin(heading),0);const velocity=pose.velocity||[0,0,0];commandSpeed=clamp((Number(velocity[0])||0)*forward.x+(Number(velocity[1])||0)*forward.y,-settings.reverseSpeedKmh/3.6,settings.maxSpeedKmh/3.6);vehicle.root&&(vehicle.root.userData.playerDriven=true);clearFootKeys();touchSteer=touchPedal=touchLookX=touchLookY=0;camLookYaw=camLookPitch=0;handbrake=false;suppressFootGamepad(true);setDrivingUi(true);active=true;camSmoothInit=false;claimSticks(carSticks);window.dispatchEvent(new CustomEvent("arondight:vehicle-mode",{detail:{active:true,id:vehicle.id}}));return true;
}
function exit({forced=false}={}){
  if(!active)return false;const pose=vehiclePose(),id=vehicle?.id,root=vehicle?.root;if(pose?.position){const sideX=-Math.sin(heading),sideY=Math.cos(heading),x=pose.position[0]+sideX*2.15,y=pose.position[1]+sideY*2.15;walk()?.setPose?.({x,y,yaw:Math.PI/2-heading,pitch:0});}if(root){delete root.userData.playerDriven;restoreBodyVisibility(root);}if(id&&pose?.position){const park={id,x:pose.position[0],y:pose.position[1],yaw:quaternionYaw(pose.rotation)};globalThis.__arondightProceduralPopulation?.parkAt?.(id,park);window.dispatchEvent(new CustomEvent("arondight:car-parked",{detail:park}));}physics()?.setDrive?.(id,null);physics()?.clearTarget?.(id);camHeading=null;active=false;vehicle=null;commandSpeed=0;touchSteer=touchPedal=touchLookX=touchLookY=0;camLookYaw=camLookPitch=0;handbrake=false;suppressFootGamepad(false);setDrivingUi(false);releaseSticks(carSticks);if(cockpit)cockpit.visible=false;window.dispatchEvent(new CustomEvent("arondight:vehicle-mode",{detail:{active:false,id,forced}}));return true;
}
// Xbox in the car: LS steer, RT gas, LT brake / reverse, RS look, B handbrake; X exits, VIEW camera (shared pad actions).
function sampleGamepad(){if(globalThis.__arondightPadBlocked?.())return null;return findXboxGamepad(nativeGetGamepads());}
function button(pad,index){const b=pad?.buttons?.[index];return clamp(typeof b==="number"?b:(b?.value??(b?.pressed?1:0)),0,1);}
function axis(value,dead=.08){const v=clamp(value,-1,1),a=Math.abs(v);return a<=dead?0:Math.sign(v)*(a-dead)/(1-dead);}
const carSticks={name:"car",labels:{move:"LENKEN / GAS",look:"UMSCHAUEN"}};
function controls(){let steer=(keys.has("KeyD")?1:0)-(keys.has("KeyA")?1:0)+touchSteer+sticks.move.x,pedal=(keys.has("KeyW")?1:0)-(keys.has("KeyS")?1:0)+touchPedal-sticks.move.y,lookX=touchLookX+sticks.look.x,lookY=touchLookY-sticks.look.y,brake=handbrake||keys.has("Space");const pad=sampleGamepad();if(pad){steer+=axis(pad.axes?.[0]);pedal+=button(pad,7)-button(pad,6);lookX+=axis(pad.axes?.[2],.08);lookY+=-axis(pad.axes?.[3],.08);brake=brake||button(pad,1)>.55;}return{steer:clamp(steer,-1,1)*settings.steeringSensitivityPercent/100,pedal:clamp(pedal,-1,1)*settings.throttleSensitivityPercent/100,lookX:clamp(lookX,-1,1),lookY:clamp(lookY,-1,1),brake};}
// Driving input only requests wheel motor torque, steering angle and brakes.
// Chassis motion, suspension, grip, collisions, roll/pitch and flips are Box3D outcomes.
let camHeading=null,camLookYaw=0,camLookPitch=0,camSmoothInit=false;const camSmoothPos=new THREE.Vector3(),camSmoothQ=new THREE.Quaternion();
function updateDrive(now,dt){
  if(!active)return;const pose=vehiclePose();if(!pose?.position||vehicle?.root?.visible===false){exit({forced:true});return;}const input=controls();
  const engine=physics();if(engine?.setDrive)engine.setDrive(vehicle.id,{pedal:input.pedal,steer:-input.steer,handbrake:input.brake,maxSpeed:settings.maxSpeedKmh/3.6,maxReverse:settings.reverseSpeedKmh/3.6});
  {// head look = stick deflection (up to ~100° left/right), back to straight ahead on release
    const k=1-Math.exp(-dt*(Math.abs(input.lookX)+Math.abs(input.lookY)>.05?9:6));camLookYaw+=(input.lookX*1.75-camLookYaw)*k;camLookPitch+=(input.lookY*.7-camLookPitch)*k;}
  const yaw=Number.isFinite(pose.yaw)?pose.yaw:quaternionYaw(pose.rotation);heading=yaw;forward.set(Math.cos(yaw),Math.sin(yaw),0);
  const v=pose.velocity||[0,0,0];commandSpeed=(Number(v[0])||0)*forward.x+(Number(v[1])||0)*forward.y;
  walk()?.setPose?.({x:pose.position[0],y:pose.position[1],yaw:Math.PI/2-heading,pitch:0});const view=viewport();if(view){view.dataset.vehicleDriveId=vehicle.id;view.dataset.vehicleDriveSpeedKmh=(Math.abs(commandSpeed)*3.6).toFixed(1);view.dataset.vehicleDriveSteer=input.steer.toFixed(3);view.dataset.vehicleDriveThrottle=input.pedal.toFixed(3);view.dataset.vehicleDrivePhysics="box3d-wheel-joints-physical-v2";view.dataset.vehicleDriveController="dual-analog-touch+xbox+keyboard-v2";}
}
// Cameras: CHASE (zoomable: pinch / mouse wheel / +-) and COCKPIT (driver's
// seat: dashboard, instruments, steering wheel that turns with the front
// wheels, thin A-pillars — the windscreen stays clear). C or the camera
// button switches.
let camMode="chase",zoom=1;const camUp=new THREE.Vector3(),camFwd=new THREE.Vector3(),camQ=new THREE.Quaternion(),camOrigin=new THREE.Vector3(),seat=new THREE.Vector3();
function poseQuat(pose){const r=pose.rotation||[0,0,0,1];return camQ.set(r[0],r[1],r[2],r[3]);}
function applyDriveCamera({camera,now}){const pose=vehiclePose();if(!pose?.position)return null;const t=Number(now)||performance.now(),dt=clamp((t-lastCameraAt)/1000,0,.1);lastCameraAt=t;
  const q=poseQuat(pose),off=Number(pose.groundOffset)||.42;camUp.set(0,0,1).applyQuaternion(q);camFwd.set(1,0,0).applyQuaternion(q);camOrigin.set(pose.position[0]-camUp.x*off,pose.position[1]-camUp.y*off,pose.position[2]-camUp.z*off);
  syncCockpit(pose);
  // head look: touch/stick look plus dragging the minimap (snaps back like the drone)
  const b=bridge(),lookYaw=camLookYaw-(Number(b?.lookYawDeg)||0)*Math.PI/180,lookPitch=camLookPitch+(Number(b?.lookPitchDeg)||0)*Math.PI/180;
  if(camMode==="cockpit"){// the physics pose carries solver/contact micro-jitter: the driver's head follows a smoothed frame (velocity feed-forward: no lag), and the cockpit is drawn in that same frame so dash and view never shake against each other
    const v=pose.velocity||[0,0,0];if(!camSmoothInit){camSmoothPos.copy(camOrigin);camSmoothQ.copy(q);camSmoothInit=true;}else{camSmoothPos.x+=(Number(v[0])||0)*dt;camSmoothPos.y+=(Number(v[1])||0)*dt;camSmoothPos.z+=(Number(v[2])||0)*dt;camSmoothPos.lerp(camOrigin,1-Math.exp(-dt*18));camSmoothQ.slerp(q,1-Math.exp(-dt*16));}
    camUp.set(0,0,1).applyQuaternion(camSmoothQ);camFwd.set(1,0,0).applyQuaternion(camSmoothQ);
    seat.set(.04,.36,1.22).applyQuaternion(camSmoothQ).add(camSmoothPos);camera.position.copy(seat);camera.up.copy(camUp);target.copy(seat).addScaledVector(camFwd,12).addScaledVector(camUp,-.5);camera.lookAt(target);camera.rotateY(-lookYaw);camera.rotateX(lookPitch);camera.fov=76;}
  else{const d=settings.cameraDistanceM*zoom,h=settings.cameraHeightM*(.55+.45*zoom);const wantedHeading=heading+lookYaw;{const k=1-Math.exp(-6*dt);if(camHeading===null)camHeading=wantedHeading;let e=wantedHeading-camHeading;e=Math.atan2(Math.sin(e),Math.cos(e));camHeading+=e*k;}forward.set(Math.cos(camHeading),Math.sin(camHeading),0);target.set(camOrigin.x+forward.x*1.05,camOrigin.y+forward.y*1.05,camOrigin.z+1.2);camera.position.set(target.x-forward.x*d,target.y-forward.y*d,target.z+h);camera.up.set(0,0,1);camera.lookAt(target);camera.rotateX(lookPitch);camera.fov=Math.min(80,70+Math.abs(commandSpeed)*.25);}
  if(cameraFireKick>.0001){cameraFirePhase+=dt*51;camera.rotateX((-.0022+Math.sin(cameraFirePhase)*.0008)*cameraFireKick);camera.rotateY(Math.sin(cameraFirePhase*1.31)*.0011*cameraFireKick);cameraFireKick*=Math.exp(-15*dt);}
  // cockpit needs a close near plane (dashboard is 40 cm away), the chase cam a far one
  const wantNear=camMode==="cockpit"?.04:.22;if(Math.abs(camera.near-wantNear)>1e-4)camera.near=wantNear;
  camera.updateProjectionMatrix?.();camera.updateMatrixWorld?.(true);const view=viewport();if(view){view.dataset.vehicleCamera=camMode==="cockpit"?"cockpit-v1":"chase-zoom-v2";view.dataset.vehicleCameraZoom=zoom.toFixed(2);view.dataset.vehicleCameraFireKick=cameraFireKick.toFixed(3);}return{active:true,mode:"vehicle",origin:camMode==="cockpit"?"car-cockpit":"car-chase",now};}
// --- cockpit (built once, a child of the driven car: it moves exactly with the body)
// From the driver's seat the car's own body is hidden (its painted roof slab and cabin floor would
// fill half the picture) and this cockpit is drawn instead — a real driver's view built so the
// windscreen is the picture: a thin roof frame and header rail at the very top, slim A-pillars,
// a low dashboard (binnacle with lit dials and a speed needle, centre screen), the steering wheel
// rim at the bottom edge (turns with the steering), the bonnet in the car's paint just visible
// over the dash, door cards with window sills to the sides. Car frame: x forward, y left, z up,
// origin on the ground; the driver's eye sits left (y +.36), at z 1.22.
let cockpit=null,cockpitWheel=null,cockpitNeedle=null,cockpitRpm=null,cockpitHood=null,cockpitPaint=-1;
function paintOf(root){for(const c of root?.children||[]){const col=c.isMesh&&c.geometry?.attributes?.color;if(col&&col.count)return new THREE.Color(col.getX(0),col.getY(0),col.getZ(0)).getHex();}return 0x8a9096;}
function buildCockpit(){
  const g=new THREE.Group();g.name="CAR_COCKPIT";g.userData.flightFireIgnore=true;
  const dash=new THREE.MeshStandardMaterial({color:0x1d1f23,roughness:.86}),soft=new THREE.MeshStandardMaterial({color:0x2b2e34,roughness:.9}),trim=new THREE.MeshStandardMaterial({color:0x8d949b,roughness:.35,metalness:.75}),pillar=new THREE.MeshStandardMaterial({color:0x26282c,roughness:.8}),card=new THREE.MeshStandardMaterial({color:0x2f3238,roughness:.92}),face=new THREE.MeshBasicMaterial({color:0x070b10}),glow=new THREE.MeshBasicMaterial({color:0x8fe3ff,toneMapped:false}),amber=new THREE.MeshBasicMaterial({color:0xffa53a,toneMapped:false}),screen=new THREE.MeshBasicMaterial({color:0x10324a,toneMapped:false}),mirror=new THREE.MeshStandardMaterial({color:0x9fb6c8,roughness:.05,metalness:.9}),paint=new THREE.MeshStandardMaterial({color:0x8a9096,roughness:.35,metalness:.3});
  const add=(geo,mat,x,y,z,rx=0,ry=0,rz=0,parent=g)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.rotation.set(rx,ry,rz);m.userData.flightFireIgnore=true;m.castShadow=false;m.receiveShadow=true;parent.add(m);return m;};
  const beam=(a,b,w,h,mat)=>{const A=new THREE.Vector3(...a),B=new THREE.Vector3(...b),mid=A.clone().add(B).multiplyScalar(.5),m=add(new THREE.BoxGeometry(w,h,A.distanceTo(B)),mat,mid.x,mid.y,mid.z);m.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),B.clone().sub(A).normalize());return m;};
  // bonnet: from the windscreen base down to the nose, in the car's paint (seen over the dash)
  cockpitHood=beam([.86,0,.8],[1.72,0,.66],1.5,.03,paint);cockpitHood.material=paint;
  // dashboard: low slab from the windscreen base back towards the driver, rounded front lip
  add(new THREE.BoxGeometry(.42,1.46,.08),dash,.7,0,.86);
  add(new THREE.CylinderGeometry(.045,.045,1.46,12),dash,.49,0,.86,0,0,0);
  add(new THREE.BoxGeometry(.012,1.3,.012),trim,.46,0,.895);
  // instrument binnacle in front of the driver, dials facing the eye
  add(new THREE.BoxGeometry(.13,.36,.05),dash,.6,.36,.925);
  const dials=new THREE.Group();dials.position.set(.535,.36,.92);dials.rotation.set(0,-Math.PI/2,0,"YXZ");dials.rotateX(-.4);g.add(dials);
  add(new THREE.PlaneGeometry(.32,.09),face,0,0,0,0,0,0,dials);
  const needle=(dx)=>{add(new THREE.TorusGeometry(.034,.003,6,28),glow,dx,0,.001,0,0,0,dials);const pivot=new THREE.Group();pivot.position.set(dx,0,.002);dials.add(pivot);add(new THREE.BoxGeometry(.003,.029,.002),amber,0,.0145,0,0,0,0,pivot);return pivot;};
  cockpitNeedle=needle(-.075);cockpitRpm=needle(.075);
  add(new THREE.PlaneGeometry(.18,.1),screen,.6,0,.915,0,-Math.PI/2+.55,0).rotation.order="YXZ";   // centre screen
  // slim A-pillars along the windscreen edges, header rail and thin roof rails
  for(const sy of[-1,1]){beam([.86,sy*.72,.86],[.24,sy*.69,1.39],.05,.055,pillar);beam([.24,sy*.69,1.4],[-.9,sy*.69,1.4],.05,.05,pillar);}
  add(new THREE.BoxGeometry(.06,1.4,.04),pillar,.24,0,1.39);
  add(new THREE.BoxGeometry(.02,.02,.05),pillar,.21,0,1.355);add(new THREE.BoxGeometry(.03,.22,.06),pillar,.2,0,1.31);add(new THREE.PlaneGeometry(.2,.05),mirror,.184,0,1.31,0,-Math.PI/2,0);
  // door cards with window sills (side windows open above the sill)
  for(const sy of[-1,1]){add(new THREE.BoxGeometry(1.5,.04,.34),card,-.1,sy*.74,.83);add(new THREE.BoxGeometry(1.5,.09,.025),soft,-.1,sy*.715,1.0);}
  // steering column + wheel (axis tilted up towards the driver; rim top at the bottom of the view)
  const col=add(new THREE.CylinderGeometry(.033,.042,.3,10),soft,.47,.36,.78);col.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),new THREE.Vector3(Math.cos(.42),0,-Math.sin(.42)));
  cockpitWheel=new THREE.Group();cockpitWheel.position.set(.35,.36,.8);cockpitWheel.rotation.set(0,.42,0);g.add(cockpitWheel);
  const spin=new THREE.Group();cockpitWheel.add(spin);cockpitWheel.userData.spin=spin;
  add(new THREE.TorusGeometry(.17,.016,10,40),soft,0,0,0,0,Math.PI/2,0,spin);
  for(const a of[Math.PI/2,Math.PI*7/6,Math.PI*11/6])add(new THREE.BoxGeometry(.014,.16,.03),soft,0,Math.cos(a)*.085,Math.sin(a)*.085,a,0,0,spin);
  add(new THREE.CylinderGeometry(.05,.05,.04,16),dash,0,0,0,0,0,Math.PI/2,spin);
  add(new THREE.BoxGeometry(.006,.02,.012),amber,-.02,0,.16,0,0,0,spin); // top marker: how far the wheel is turned
  g.traverse(n=>{n.userData.flightFireIgnore=true;n.userData.carCockpitPart=true;});
  return g;
}
function syncCockpit(pose){const root=vehicle?.root;const want=camMode==="cockpit"&&Boolean(root)&&active;
  if(want&&!cockpit)cockpit=buildCockpit();if(!cockpit)return;
  if(want&&cockpit.parent!==root){cockpit.parent?.remove(cockpit);root.add(cockpit);cockpitPaint=-1;}
  cockpit.visible=want;if(!want)return;
  // the car's own body is hidden while you sit in it (restoreHiddenBodies shows it again)
  for(const c of root.children)if(c.isMesh&&c!==cockpit&&c.visible){c.visible=false;hiddenBodies.add(c);}
  root.userData.playerCockpit=performance.now();   // its wheels are not drawn either (world_procedural_population)
  if(cockpitPaint<0&&cockpitHood){cockpitPaint=paintOf(root);cockpitHood.material.color.setHex(cockpitPaint);}
  const spin=cockpitWheel?.userData?.spin;if(spin)spin.rotation.x=(Number(pose?.steer)||0)*-6.5;
  const sp=clamp(Math.abs(commandSpeed)/42,0,1);if(cockpitNeedle)cockpitNeedle.rotation.z=2.3-sp*4.6;if(cockpitRpm)cockpitRpm.rotation.z=2.3-clamp(.18+sp*.7+(handbrake?0:.08),0,1)*4.6;}
// Bodies hidden for the cockpit view. Every frame, any body that is not the
// car the player is sitting in (cockpit cam) is shown again — whatever path
// ended the drive (exit, death, reset, despawn), no car is left as bare wheels.
const hiddenBodies=new Set();
function restoreHiddenBodies(){if(cockpit&&!(active&&camMode==="cockpit"))cockpit.visible=false;if(!hiddenBodies.size)return;const keep=active&&camMode==="cockpit"?vehicle?.root:null;for(const body of hiddenBodies){if(keep&&body.parent===keep)continue;body.visible=true;hiddenBodies.delete(body);}}
function restoreBodyVisibility(root){if(!root)return;for(const c of root.children)if(c.isMesh)c.visible=true;if(cockpit)cockpit.visible=false;}
function toggleCamera(){camMode=camMode==="cockpit"?"chase":"cockpit";const b=document.getElementById("vehicleCamButton");if(b)b.textContent=camMode==="cockpit"?"🎥 AUSSEN":"🎥 INNEN";}
function zoomBy(f){zoom=clamp(zoom*f,.55,2.6);}
const driveCameraProvider={isActive:()=>active||Boolean(baseCameraProvider?.isActive?.()),apply:args=>active?applyDriveCamera(args):baseCameraProvider?.apply?.(args)};
function ensureCameraProvider(){if(cameraInstalled)return;const b=bridge(),current=b?.presentationCameraProvider;if(!b||typeof b.attachPresentationCameraProvider!=="function"||!current)return;baseCameraProvider=current;b.attachPresentationCameraProvider(driveCameraProvider);cameraInstalled=true;const v=viewport();if(v)v.dataset.playerCameraStack="walk+vehicle-v1";}
function installStyle(){if(document.querySelector("style[data-player-car-mode]"))return;const style=document.createElement("style");style.dataset.playerCarMode="gta-physical-v1";style.textContent=`
body.player-driving .vehicle-stick,html body.player-driving #footHud #footFire,html body.player-driving #footHud #footJump,body.player-driving #soloLeft,body.player-driving #soloRight,body.player-driving #soloClearance,body.player-driving .solo-action{display:none!important;pointer-events:none!important}#vehicleHud{display:none;position:absolute;inset:0;z-index:12;pointer-events:none;font-family:system-ui,-apple-system,sans-serif}body.player-driving #vehicleHud{display:block}.vehicle-stick{position:absolute!important;bottom:max(20px,var(--solo-safe-bottom,env(safe-area-inset-bottom)))!important;width:min(25vw,150px)!important;aspect-ratio:1!important;border:0!important;border-radius:50%!important;background:transparent!important;box-shadow:none!important;opacity:1!important;pointer-events:auto!important;touch-action:none!important;z-index:20!important}.vehicle-stick .ring{position:absolute!important;inset:0!important;border-radius:50%!important;border:2px solid #ffffff66!important;background:#0b18265c!important;box-shadow:inset 0 0 45px #0005,0 6px 22px #0005!important}.vehicle-stick .knob{position:absolute!important;left:50%;top:50%;width:31%!important;aspect-ratio:1!important;transform:translate(-50%,-50%)!important;border-radius:50%!important;background:#f3f7ffcc!important;border:2px solid #fff!important;box-shadow:0 3px 14px #0008!important}.vehicle-stick span{position:absolute;left:50%;bottom:-15px;transform:translateX(-50%);color:#f2f4f7;font:600 9px/1 system-ui;letter-spacing:.06em;white-space:nowrap;text-shadow:0 1px 1px #0008}#vehicleMove{left:max(12px,var(--solo-safe-left,env(safe-area-inset-left)))!important}#vehicleLook{right:max(12px,var(--solo-safe-right,env(safe-area-inset-right)))!important}#vehicleButtons{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(max(18px,var(--solo-safe-bottom,env(safe-area-inset-bottom))) + 36px);display:flex;gap:8px;pointer-events:auto}#vehicleButtons button{height:36px;padding:0 14px;border-radius:6px;font:600 12px/1 Inter,system-ui,sans-serif;letter-spacing:.06em;color:#f2f4f7;background:rgba(10,13,18,.6);border:1px solid rgba(255,255,255,.18)}#vehicleReadout{position:absolute;left:50%;bottom:max(18px,var(--solo-safe-bottom,env(safe-area-inset-bottom)));transform:translateX(-50%);padding:7px 10px;border:1px solid #ffffff2c;border-radius:9px;background:#071522d8;color:#dff5ff;font:900 9px/1 system-ui;letter-spacing:.07em}#driveModeButton[data-near="1"]{border-color:#7de7b988!important;background:#154932e8!important}body.player-driving #driveModeButton{border-color:#ffcf6f88!important;background:#52350fe8!important}@media(max-height:340px){.vehicle-stick{width:min(22vw,128px)!important;bottom:max(16px,var(--solo-safe-bottom,env(safe-area-inset-bottom)))!important}#vehicleReadout{bottom:max(10px,var(--solo-safe-bottom,env(safe-area-inset-bottom)));font-size:8px}}
`;document.head.appendChild(style);}
// Touch on the driving pads is handled at WINDOW capture level (before the
// foot/look/fire modules that listen on the viewport and stop propagation),
// so steering and throttle always respond. Two fingers on the free screen
// pinch-zoom the chase camera; the mouse wheel zooms too.
const padPointers=new Map(),pinch=new Map();let pinchDist=0;
function padVector(el,e){const r=el.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2,radius=Math.max(1,Math.min(r.width,r.height)*.42);let x=(e.clientX-cx)/radius,y=(e.clientY-cy)/radius,m=Math.hypot(x,y);if(m>1){x/=m;y/=m;}return{x:clamp(x,-1,1),y:clamp(y,-1,1)};}
function padApply(el,kind,e){const knob=el.querySelector(".knob"),p=padVector(el,e);knob.style.left=`${50+p.x*42}%`;knob.style.top=`${50+p.y*42}%`;if(kind==="drive"){touchSteer=p.x;touchPedal=-p.y;}else{touchLookX=p.x;touchLookY=-p.y;}}
function padRelease(el,kind){const knob=el.querySelector(".knob");knob.style.left=knob.style.top="50%";if(kind==="drive"){touchSteer=touchPedal=0;}else{touchLookX=touchLookY=0;}}
function installPadCapture(){
  addEventListener("pointerdown",e=>{if(!active)return;const pad=e.target instanceof Element?e.target.closest(".vehicle-stick"):null;if(pad){const kind=pad.id==="vehicleMove"?"drive":"look";padPointers.set(e.pointerId,{pad,kind});padApply(pad,kind,e);e.preventDefault();e.stopImmediatePropagation();return;}
    if(e.pointerType==="touch"&&!(e.target instanceof Element&&e.target.closest("button,#vehicleHud button,#worldLookHud,#soloTopbar,dialog"))){pinch.set(e.pointerId,{x:e.clientX,y:e.clientY});if(pinch.size===2){const[a,b]=[...pinch.values()];pinchDist=Math.hypot(a.x-b.x,a.y-b.y);}}},{capture:true,passive:false});
  addEventListener("pointermove",e=>{const p=padPointers.get(e.pointerId);if(p){padApply(p.pad,p.kind,e);e.preventDefault();e.stopImmediatePropagation();return;}if(active&&pinch.has(e.pointerId)){pinch.set(e.pointerId,{x:e.clientX,y:e.clientY});if(pinch.size===2){const[a,b]=[...pinch.values()],d=Math.hypot(a.x-b.x,a.y-b.y);if(pinchDist>10&&d>10)zoomBy(pinchDist/d);pinchDist=d;}}},{capture:true,passive:false});
  const up=e=>{const p=padPointers.get(e.pointerId);if(p){padPointers.delete(e.pointerId);padRelease(p.pad,p.kind);e.preventDefault();e.stopImmediatePropagation();}pinch.delete(e.pointerId);};
  addEventListener("pointerup",up,{capture:true,passive:false});addEventListener("pointercancel",up,{capture:true,passive:false});
  addEventListener("wheel",e=>{if(!active)return;zoomBy(e.deltaY>0?1.1:1/1.1);e.preventDefault();},{passive:false});
}
function mountUi(){const view=viewport(),top=document.getElementById("soloTopbarActions")||document.getElementById("soloTopbar");if(view&&!document.getElementById("vehicleHud")){const hud=document.createElement("div");hud.id="vehicleHud";hud.innerHTML='<div id="vehicleMove" class="vehicle-stick"><div class="ring"></div><div class="knob"></div><span>MOVE</span></div><div id="vehicleLook" class="vehicle-stick"><div class="ring"></div><div class="knob"></div><span>LOOK</span></div><div id="vehicleReadout">CAR · 0 km/h · E EXIT</div><div id="vehicleButtons"><button id="vehicleCamButton" type="button">🎥 INNEN</button><button id="vehicleBrakeButton" type="button">HANDBREMSE</button></div>';view.appendChild(hud);hud.querySelector("#vehicleCamButton").addEventListener("click",e=>{e.preventDefault();e.stopPropagation();toggleCamera();});const hb=hud.querySelector("#vehicleBrakeButton");hb.addEventListener("pointerdown",e=>{handbrake=true;e.preventDefault();e.stopPropagation();});for(const ev of["pointerup","pointercancel","pointerleave"])hb.addEventListener(ev,()=>{handbrake=false;});}if(top&&!document.getElementById("driveModeButton")){const b=document.createElement("button");b.id="driveModeButton";b.type="button";b.addEventListener("click",()=>active?exit():enter());top.insertBefore(b,document.getElementById("soloCamera")?.parentElement===top?document.getElementById("soloCamera"):null);}}
// Contextual GTA-style button on every device: appears next to a car while
// on foot ("EINSTEIGEN") and stays while driving ("AUSSTEIGEN"). The old
// topbar CAR button is hidden in the flight-first mobile layout.
function mountEnterButton(){const view=viewport();if(!view||document.getElementById("enterCarButton"))return;const b=document.createElement("button");b.id="enterCarButton";b.type="button";b.hidden=true;b.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();active?exit():enter();});view.appendChild(b);
  const style=document.createElement("style");style.dataset.enterCar="contextual-v1";style.textContent=`#enterCarButton{position:absolute;z-index:30;left:50%;transform:translateX(-50%);bottom:calc(max(14px,var(--solo-safe-bottom,env(safe-area-inset-bottom))) + 64px);min-width:150px;height:46px;padding:0 18px;border-radius:14px;font:900 15px/1 "Nunito","Trebuchet MS",system-ui,sans-serif;letter-spacing:.06em;color:#3a2600;background:#ffc93c;border:2.5px solid #fff;box-shadow:0 4px 0 #c48a12;pointer-events:auto;touch-action:manipulation}#enterCarButton[hidden]{display:none!important}#enterCarButton[data-mode="exit"]{background:#ff6b5a;color:#fff;box-shadow:0 4px 0 #b13b2e}html.neon-line-style:not(#ng-a):not(#ng-b):not(#ng-c) #enterCarButton{background:#ffc93c!important;color:#3a2600!important;border:2.5px solid #fff!important;box-shadow:0 4px 0 #c48a12!important}html.neon-line-style:not(#ng-a):not(#ng-b):not(#ng-c) #enterCarButton[data-mode="exit"]{background:#ff6b5a!important;color:#fff!important;box-shadow:0 4px 0 #b13b2e!important}`;document.head.appendChild(style);}
function renderEnterButton(near){const b=document.getElementById("enterCarButton");if(!b)return;const show=!playerDead()&&(active||(Boolean(near)&&walk()?.mode==="foot"));if(b.hidden===show)b.hidden=!show;const cls=document.body.classList,key=cls.contains("pad-input")?"Ⓧ  ":cls.contains("desktop-input")?"F · ":"",mode=`${active?"exit":"enter"}:${key}`;if(b.dataset.mode!==mode){b.dataset.mode=mode;b.textContent=active?`${key}AUSSTEIGEN`:`${key}🚗 EINSTEIGEN`;}}
function renderUi(now){mountUi();mountEnterButton();const near=nearestVehicle(now),b=document.getElementById("driveModeButton"),readout=document.getElementById("vehicleReadout");if(b){b.dataset.near=!active&&near?"1":"0";b.disabled=playerDead()||(!active&&!near);b.textContent=active?"EXIT CAR":near?"CAR":"CAR —";b.setAttribute("aria-label",active?"Exit vehicle":near?`Enter nearby car ${near.distance.toFixed(1)} meters away`:"No drivable car nearby");}renderEnterButton(near);if(readout&&active)readout.textContent=`CAR · ${Math.round(Math.abs(commandSpeed)*3.6)} km/h · E EXIT`;}
function vehicleWeaponFire(event){if(!active)return;const intensity=clamp(event?.detail?.intensity??.2,0,.8);cameraFireKick=Math.min(.8,cameraFireKick+intensity);const view=viewport();if(view){view.dataset.vehicleCameraFireWeapon=String(event?.detail?.weapon||"unknown");view.dataset.vehicleCameraFireKick=cameraFireKick.toFixed(3);}}
function installInput(){installPadCapture();addEventListener("arondight:world-reset",()=>{if(active)exit({forced:true});});addEventListener("arondight:weapon-fired",vehicleWeaponFire);addEventListener("keydown",event=>{if(event.metaKey||event.ctrlKey||event.altKey)return;if(active&&(event.code==="Equal"||event.code==="NumpadAdd")){zoomBy(1/1.15);event.preventDefault();return;}if(active&&(event.code==="Minus"||event.code==="NumpadSubtract")){zoomBy(1.15);event.preventDefault();return;}if(active&&["KeyW","KeyA","KeyS","KeyD","Space","KeyE","KeyV","KeyC","ShiftLeft","ShiftRight"].includes(event.code)){event.preventDefault();event.stopImmediatePropagation();if(event.code==="KeyE"){exit();return;}if(event.code==="KeyC"){toggleCamera();return;}if(event.code==="Space")handbrake=true;else keys.add(event.code);return;}if(!active&&event.code==="KeyE"&&walk()?.mode==="foot"){const near=nearestVehicle();if(near){event.preventDefault();event.stopImmediatePropagation();enter(near);}}},{capture:true});addEventListener("keyup",event=>{keys.delete(event.code);if(event.code==="Space")handbrake=false;},{capture:true});addEventListener(VEHICLE_CONTROL_SETTINGS_EVENT,event=>{settings=normalizeVehicleControlSettings(event.detail?.settings||loadVehicleControlSettings());});addEventListener("arondight:player-death",()=>exit({forced:true}));}
// The car you sit in can be destroyed (shot, blown up, burnt out) or its body can be taken away;
// then there is no chassis to drive: you are thrown out next to it instead of steering a ghost
// (an invisible car without collision). A body that is only re-made (fell through a crater edge)
// comes back within a few frames; that does not throw you out.
let bodyMissingSince=0;
function watchBody(now){if(!active||!vehicle?.id){bodyMissingSince=0;return;}const has=Boolean(physics()?.pose?.(vehicle.id)?.position);if(has){bodyMissingSince=0;return;}bodyMissingSince||=now;
  const hidden=vehicle.root&&vehicle.root.visible===false;if(now-bodyMissingSince>(hidden?120:600)){const v=viewport();if(v){v.dataset.vehicleLostBodyExits=String((Number(v.dataset.vehicleLostBodyExits)||0)+1);}exit({forced:true});bodyMissingSince=0;}}
let lastCarUi=-Infinity;function frame(now=performance.now()){const dt=clamp((now-lastFrame)/1000,0,.05);lastFrame=now;ensureCameraProvider();watchBody(now);if(now-lastCarUi>=100){lastCarUi=now;renderUi(now);}updateDrive(now,dt);restoreHiddenBodies();requestAnimationFrame(frame);}
export function installPlayerCarMode(){if(installed)return globalThis.__arondightVehicleDrive;installed=true;installStyle();installInput();mountUi();const api={enterNearest:()=>enter(nearestVehicle()),exit,get active(){return active;},get vehicleId(){return vehicle?.id||"";},get speedMps(){return Math.abs(commandSpeed);},get signedSpeedMps(){return commandSpeed;},get throttle(){return touchPedal+(keys.has("KeyW")?1:0)-(keys.has("KeyS")?1:0);},get heading(){return heading;},get pose(){return active?vehiclePose():null;},get cameraAnchor(){const pose=vehiclePose();return pose?.position?{x:pose.position[0],y:pose.position[1],z:pose.position[2]+.78}:null;},nearestVehicle};globalThis.__arondightVehicleDrive=api;const view=viewport();if(view){view.dataset.vehicleDriveMode="box3d-wheel-joint-dual-stick-v2";view.dataset.vehicleDriveEnterRadiusM=String(ENTER_RADIUS_M);view.dataset.vehicleDriveAvailability="all-procedural-cars+physics-fallback-v2";}requestAnimationFrame(frame);return api;}
installPlayerCarMode();
