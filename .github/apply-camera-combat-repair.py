from pathlib import Path
import re


def text(path):
    return Path(path).read_text()


def write(path, value):
    Path(path).write_text(value)


def replace_once(path, old, new):
    s = text(path)
    count = s.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, got {count}: {old[:180]!r}")
    write(path, s.replace(old, new, 1))


def regex_once(path, pattern, replacement, flags=0):
    s = text(path)
    out, count = re.subn(pattern, replacement, s, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f"{path}: regex expected exactly one match, got {count}: {pattern!r}")
    write(path, out)


# ---------------------------------------------------------------------------
# External-view presentation filter: only the visible child mesh is filtered.
# Root airframe transform remains authoritative for WORLD/VS/network/physics.
# ---------------------------------------------------------------------------
write("sim/visual_pose_stabilization.mjs", r'''const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));

export const EXTERNAL_AIRFRAME_VISUAL_PROFILES=Object.freeze({
  follow:Object.freeze({offsetRate:10.0,rotationRate:14.0,maxPositionErrorM:.030,maxRotationErrorRad:4*Math.PI/180}),
  third:Object.freeze({offsetRate:8.0,rotationRate:11.0,maxPositionErrorM:.050,maxRotationErrorRad:6*Math.PI/180}),
});

export function visualDampingAlpha(ratePerSecond,dtSeconds){
  const rate=Math.max(0,Number(ratePerSecond)||0),dt=clamp(dtSeconds,0,.1);
  return rate>0&&dt>0?1-Math.exp(-rate*dt):0;
}
function finite3(value){return value?.length>=3&&value.slice(0,3).every(Number.isFinite);}
function finite4(value){return value?.length>=4&&value.slice(0,4).every(Number.isFinite);}
function normalizeQuat(target,source){
  const x=Number(source?.[0]),y=Number(source?.[1]),z=Number(source?.[2]),w=Number(source?.[3]),length=Math.hypot(x,y,z,w);
  if(!(length>1e-9)){target[0]=target[1]=target[2]=0;target[3]=1;return target;}
  target[0]=x/length;target[1]=y/length;target[2]=z/length;target[3]=w/length;return target;
}
function slerpQuat(target,a,b,t){
  let bx=b[0],by=b[1],bz=b[2],bw=b[3],dot=a[0]*bx+a[1]*by+a[2]*bz+a[3]*bw;
  if(dot<0){dot=-dot;bx=-bx;by=-by;bz=-bz;bw=-bw;}
  dot=clamp(dot,-1,1);
  if(dot>.9995){target[0]=a[0]+(bx-a[0])*t;target[1]=a[1]+(by-a[1])*t;target[2]=a[2]+(bz-a[2])*t;target[3]=a[3]+(bw-a[3])*t;return normalizeQuat(target,target);}
  const theta=Math.acos(dot),sinTheta=Math.sin(theta),aScale=Math.sin((1-t)*theta)/sinTheta,bScale=Math.sin(t*theta)/sinTheta;
  target[0]=a[0]*aScale+bx*bScale;target[1]=a[1]*aScale+by*bScale;target[2]=a[2]*aScale+bz*bScale;target[3]=a[3]*aScale+bw*bScale;return normalizeQuat(target,target);
}
function quatAngle(a,b){return 2*Math.acos(clamp(Math.abs(a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3]),-1,1));}

export class StabilizedExternalAirframeVisual{
  constructor(profiles=EXTERNAL_AIRFRAME_VISUAL_PROFILES){this.profiles=profiles;this.offset=[0,0,0];this.quaternion=[0,0,0,1];this.outputPosition=[0,0,0];this.mode="";this.initialized=false;}
  invalidate(){this.initialized=false;this.mode="";}
  reset({position,quaternion,cameraAnchor,mode="follow"}){
    if(!finite3(position)||!finite3(cameraAnchor)||!finite4(quaternion))throw new Error("external visual pose must be finite");
    for(let i=0;i<3;i++){this.offset[i]=Number(position[i])-Number(cameraAnchor[i]);this.outputPosition[i]=Number(position[i]);}
    normalizeQuat(this.quaternion,quaternion);this.mode=mode;this.initialized=true;return this.state();
  }
  update({position,quaternion,cameraAnchor,mode="follow",dt=1/60}){
    if(!finite3(position)||!finite3(cameraAnchor)||!finite4(quaternion))throw new Error("external visual pose must be finite");
    const profile=this.profiles[mode]||this.profiles.follow;
    if(!this.initialized||this.mode!==mode)return this.reset({position,quaternion,cameraAnchor,mode});
    const alpha=visualDampingAlpha(profile.offsetRate,dt),rawOffset=[position[0]-cameraAnchor[0],position[1]-cameraAnchor[1],position[2]-cameraAnchor[2]];
    for(let i=0;i<3;i++)this.offset[i]+=(rawOffset[i]-this.offset[i])*alpha;
    let ex=rawOffset[0]-this.offset[0],ey=rawOffset[1]-this.offset[1],ez=rawOffset[2]-this.offset[2],error=Math.hypot(ex,ey,ez);
    if(error>profile.maxPositionErrorM){const correction=(error-profile.maxPositionErrorM)/error;this.offset[0]+=ex*correction;this.offset[1]+=ey*correction;this.offset[2]+=ez*correction;}
    const target=[0,0,0,1];normalizeQuat(target,quaternion);slerpQuat(this.quaternion,this.quaternion,target,visualDampingAlpha(profile.rotationRate,dt));
    const angleError=quatAngle(this.quaternion,target);if(angleError>profile.maxRotationErrorRad)slerpQuat(this.quaternion,this.quaternion,target,1-profile.maxRotationErrorRad/angleError);
    for(let i=0;i<3;i++)this.outputPosition[i]=cameraAnchor[i]+this.offset[i];
    return this.state(position,target);
  }
  state(rawPosition=null,rawQuaternion=null){
    const positionErrorM=rawPosition?Math.hypot(rawPosition[0]-this.outputPosition[0],rawPosition[1]-this.outputPosition[1],rawPosition[2]-this.outputPosition[2]):0;
    const rotationErrorRad=rawQuaternion?quatAngle(this.quaternion,rawQuaternion):0;
    return{position:this.outputPosition,quaternion:this.quaternion,mode:this.mode,positionErrorM,rotationErrorRad};
  }
}
''')

sim="sim/simulator.mjs"
replace_once(sim,
'''import {StabilizedExternalCameraRig,externalCameraFrame} from "./camera_stabilization.mjs";''',
'''import {StabilizedExternalCameraRig,externalCameraFrame} from "./camera_stabilization.mjs";
import {StabilizedExternalAirframeVisual,EXTERNAL_AIRFRAME_VISUAL_PROFILES} from "./visual_pose_stabilization.mjs";''')
replace_once(sim,
'''const FPV_CAMERA_FORWARD_OFFSET_M = .070;
const FPV_CAMERA_UP_OFFSET_M = .028;''',
'''const FPV_CAMERA_MOUNT_FORWARD_OFFSET_M = .070;
const FPV_CAMERA_LENS_FORWARD_OFFSET_M = .093;
const FPV_CAMERA_LENS_HALF_DEPTH_M = .004;
const FPV_CAMERA_FORWARD_OFFSET_M = .102;
const FPV_CAMERA_UP_OFFSET_M = .028;
const FPV_CAMERA_OPTICAL_CLEARANCE_M = FPV_CAMERA_FORWARD_OFFSET_M - (FPV_CAMERA_LENS_FORWARD_OFFSET_M + FPV_CAMERA_LENS_HALF_DEPTH_M);''')
replace_once(sim,
'''this.presentationPoseCache={position:this.renderPosition,quaternion:this.renderRotation,velocity:this.renderVelocity};this.reset(params);''',
'''this.presentationPoseCache={position:this.renderPosition,quaternion:this.renderRotation,velocity:this.renderVelocity};this.visualRelativePosition=new THREE.Vector3();this.visualDesiredPosition=new THREE.Vector3();this.visualInverseRootQuaternion=new THREE.Quaternion();this.visualRelativeQuaternion=new THREE.Quaternion();this.reset(params);''')
replace_once(sim,
'''    const fpvCameraBody=new THREE.Mesh(new THREE.BoxGeometry(.040,.030,.025),bodyMaterial);fpvCameraBody.position.set(-FPV_CAMERA_FORWARD_OFFSET_M,0,FPV_CAMERA_UP_OFFSET_M);fpvCameraBody.userData.arondightFpvCamera=true;fpvCameraBody.castShadow=true;this.group.add(fpvCameraBody);
    const fpvCameraLens=new THREE.Mesh(new THREE.CylinderGeometry(.010,.010,.008,18),new THREE.MeshStandardMaterial({color:0x111820,metalness:.15,roughness:.22}));fpvCameraLens.rotation.z=Math.PI/2;fpvCameraLens.position.set(-FPV_CAMERA_FORWARD_OFFSET_M-.023,0,FPV_CAMERA_UP_OFFSET_M);fpvCameraLens.userData.arondightFpvCameraLens=true;this.group.add(fpvCameraLens);''',
'''    const fpvCameraBody=new THREE.Mesh(new THREE.BoxGeometry(.040,.030,.025),bodyMaterial);fpvCameraBody.position.set(-FPV_CAMERA_MOUNT_FORWARD_OFFSET_M,0,FPV_CAMERA_UP_OFFSET_M);fpvCameraBody.userData.arondightFpvCamera=true;fpvCameraBody.castShadow=true;this.group.add(fpvCameraBody);this.fpvCameraBody=fpvCameraBody;
    const fpvCameraLens=new THREE.Mesh(new THREE.CylinderGeometry(.010,.010,.008,18),new THREE.MeshStandardMaterial({color:0x111820,metalness:.15,roughness:.22}));fpvCameraLens.rotation.z=Math.PI/2;fpvCameraLens.position.set(-FPV_CAMERA_LENS_FORWARD_OFFSET_M,0,FPV_CAMERA_UP_OFFSET_M);fpvCameraLens.userData.arondightFpvCameraLens=true;this.group.add(fpvCameraLens);this.fpvCameraLens=fpvCameraLens;''')
replace_once(sim,
'''    const worldHeadingCue=new THREE.Mesh(new THREE.ConeGeometry(.012,.055,12),new THREE.MeshBasicMaterial({color:0xff405a,depthTest:false,depthWrite:false}));worldHeadingCue.rotation.z=-Math.PI/2;worldHeadingCue.position.set(-.19,0,.036);worldHeadingCue.visible=false;worldHeadingCue.renderOrder=1001;this.group.add(worldHeadingCue);this.worldHeadingCue=worldHeadingCue;''',
'''    const worldHeadingCue=new THREE.Mesh(new THREE.ConeGeometry(.012,.055,12),new THREE.MeshBasicMaterial({color:0xff405a,depthTest:false,depthWrite:false}));worldHeadingCue.rotation.z=-Math.PI/2;worldHeadingCue.position.set(-.19,0,.036);worldHeadingCue.visible=false;worldHeadingCue.renderOrder=1001;this.group.add(worldHeadingCue);this.worldHeadingCue=worldHeadingCue;
    // Root airframe stays authoritative for WORLD/VS/network state. Every visible
    // component lives under a presentation-only child that may be filtered in
    // external views without ever moving physics, hitboxes or multiplayer pose.
    this.visualGroup=new THREE.Group();this.visualGroup.userData.arondightVisualAirframe=true;const visualChildren=[...this.group.children];for(const child of visualChildren)this.visualGroup.add(child);this.group.add(this.visualGroup);''')
regex_once(sim,
    r'  render\(pose=this\.presentationPose\(1\),dt=1/60\)\{[^\n]+\n',
'''  render(pose=this.presentationPose(1),dt=1/60,visualPose=pose){if(!this.graphics||!this.group)return pose;this.group.position.copy(pose.position);this.group.position.z+=AIRFRAME_PRESENTATION_GROUND_BIAS_M;this.group.quaternion.copy(pose.quaternion);const visible=visualPose||pose;if(this.visualGroup){this.visualDesiredPosition.copy(visible.position);this.visualDesiredPosition.z+=AIRFRAME_PRESENTATION_GROUND_BIAS_M;this.visualInverseRootQuaternion.copy(this.group.quaternion).invert();this.visualRelativePosition.copy(this.visualDesiredPosition).sub(this.group.position).applyQuaternion(this.visualInverseRootQuaternion);this.visualGroup.position.copy(this.visualRelativePosition);this.visualRelativeQuaternion.copy(this.visualInverseRootQuaternion).multiply(visible.quaternion).normalize();this.visualGroup.quaternion.copy(this.visualRelativeQuaternion);}const presentationViewport=$("viewport");if(presentationViewport){presentationViewport.dataset.airframePresentationGroundBiasM=AIRFRAME_PRESENTATION_GROUND_BIAS_M.toFixed(3);presentationViewport.dataset.airframeVisualSupportZ=(visible.position.z+AIRFRAME_PRESENTATION_GROUND_BIAS_M+AIRFRAME_VISUAL_LOWEST_Z_M).toFixed(4);}const step=clamp(Number(dt)||0,0,.1);this.rotors.forEach((rotor,i)=>rotor.rotation.z=(rotor.rotation.z+(i%2?-1:1)*this.motorOmega[i]*step)%(2*Math.PI));const worldActive=Boolean(globalThis.__arondightRealWorld?.active),cameraMode=$("viewport")?.dataset.cameraMode||"follow",showWorldMarker=worldActive&&cameraMode!=="fpv";if(this.worldHalo)this.worldHalo.visible=showWorldMarker;if(this.worldHaloBack)this.worldHaloBack.visible=showWorldMarker;if(this.worldHeadingCue)this.worldHeadingCue.visible=showWorldMarker;return pose;}
''')
replace_once(sim,
'''const externalCameraRig=new StabilizedExternalCameraRig();
const cameraLookTarget=new THREE.Vector3();''',
'''const externalCameraRig=new StabilizedExternalCameraRig();
const externalAirframeVisualRig=new StabilizedExternalAirframeVisual(EXTERNAL_AIRFRAME_VISUAL_PROFILES),externalVisualPosition=new THREE.Vector3(),externalVisualQuaternion=new THREE.Quaternion(),externalVisualVelocity=new THREE.Vector3(),externalVisualPose={position:externalVisualPosition,quaternion:externalVisualQuaternion,velocity:externalVisualVelocity};
const cameraLookTarget=new THREE.Vector3();
let fireCameraKick=0,fireCameraPhase=0;
function addFireCameraKick(intensity=.16){fireCameraKick=Math.min(.65,fireCameraKick+clamp(Number(intensity)||0,0,.25));const viewport=$("viewport");if(viewport){viewport.dataset.fireRecoilImpulses=String((Number(viewport.dataset.fireRecoilImpulses)||0)+1);viewport.dataset.fireCameraKick=fireCameraKick.toFixed(3);}}
function applyFireCameraShake(dt){if(!(fireCameraKick>.0001))return;const step=clamp(dt,0,.1);fireCameraPhase+=step*55;camera.rotateX((-.00135+Math.sin(fireCameraPhase)*.00045)*fireCameraKick);camera.rotateY(Math.sin(fireCameraPhase*1.37)*.00055*fireCameraKick);fireCameraKick*=Math.exp(-19*step);const viewport=$("viewport");if(viewport)viewport.dataset.fireCameraKick=fireCameraKick.toFixed(3);}''')
replace_once(sim,
'''function applyCameraSettings(next){cameraSettings=next;externalCameraRig.invalidate();$("viewport").dataset.fpvTiltDeg=String(cameraSettings.fpvTiltDeg);$("viewport").dataset.fpvFovDeg=String(cameraSettings.fpvFovDeg);$("viewport").dataset.thirdCameraDistanceM=String(cameraSettings.thirdDistanceM);}''',
'''function applyCameraSettings(next){cameraSettings=next;externalCameraRig.invalidate();externalAirframeVisualRig.invalidate();$("viewport").dataset.fpvTiltDeg=String(cameraSettings.fpvTiltDeg);$("viewport").dataset.fpvFovDeg=String(cameraSettings.fpvFovDeg);$("viewport").dataset.thirdCameraDistanceM=String(cameraSettings.thirdDistanceM);}''')
replace_once(sim,
'''  cameraMode=["follow","fpv","third"].includes(next)?next:"follow";externalCameraRig.invalidate();cameraFrameMs=performance.now();localStorage.setItem("arondight45CameraMode",cameraMode);$("viewport").dataset.cameraMode=cameraMode;''',
'''  cameraMode=["follow","fpv","third"].includes(next)?next:"follow";externalCameraRig.invalidate();externalAirframeVisualRig.invalidate();cameraFrameMs=performance.now();localStorage.setItem("arondight45CameraMode",cameraMode);$("viewport").dataset.cameraMode=cameraMode;''')
regex_once(sim,
    r'function updateCamera\(pose,now=performance\.now\(\)\)\{.*?\n\}\n\$\("camFollow"\)',
'''function updateCamera(pose,now=performance.now()){
  const position=pose.position,q=pose.quaternion,velocity=pose.velocity,dt=clamp((now-cameraFrameMs)/1000,0,.1);cameraFrameMs=now;
  const bodyForward=new THREE.Vector3(-1,0,0).applyQuaternion(q).normalize(),showFpvSelfCamera=cameraMode!=="fpv";
  if(physics.fpvCameraBody)physics.fpvCameraBody.visible=showFpvSelfCamera;if(physics.fpvCameraLens)physics.fpvCameraLens.visible=showFpvSelfCamera;const fpvViewport=$("viewport");if(fpvViewport)fpvViewport.dataset.fpvSelfCameraVisible=showFpvSelfCamera?"1":"0";
  if(cameraMode==="fpv"){
    externalCameraRig.invalidate();externalAirframeVisualRig.invalidate();
    const bodyUp=new THREE.Vector3(0,0,1).applyQuaternion(q).normalize();
    // FPV optics are rigidly mounted to the airframe. GAME right-stick pitch now
    // moves the physical body through the motors; there is no virtual camera axis.
    const fpvTiltRad=cameraSettings.fpvTiltDeg*Math.PI/180,c=Math.cos(fpvTiltRad),si=Math.sin(fpvTiltRad);
    const fpvForward=bodyForward.clone().multiplyScalar(c).addScaledVector(bodyUp,si).normalize();
    const fpvUp=bodyUp.clone().multiplyScalar(c).addScaledVector(bodyForward,-si).normalize();
    camera.position.copy(position).addScaledVector(bodyForward,FPV_CAMERA_FORWARD_OFFSET_M).addScaledVector(bodyUp,FPV_CAMERA_UP_OFFSET_M);
    camera.up.copy(fpvUp);camera.lookAt(cameraLookTarget.copy(camera.position).addScaledVector(fpvForward,4));
    if(camera.fov!==cameraSettings.fpvFovDeg){camera.fov=cameraSettings.fpvFovDeg;camera.updateProjectionMatrix();}
    applyFireCameraShake(dt);const viewport=$("viewport");viewport.dataset.cameraFov=String(camera.fov);viewport.dataset.cameraTiltDeg=String(cameraSettings.fpvTiltDeg);viewport.dataset.cameraDistanceM="0";viewport.dataset.cameraRigMode="rigid-airframe";viewport.dataset.cameraRigLagM="0.0000";viewport.dataset.cameraRigAnchor=[position.x,position.y,position.z].map(value=>value.toFixed(4)).join(",");viewport.dataset.fpvCameraMountForwardOffsetM=FPV_CAMERA_MOUNT_FORWARD_OFFSET_M.toFixed(3);viewport.dataset.fpvCameraForwardOffsetM=FPV_CAMERA_FORWARD_OFFSET_M.toFixed(3);viewport.dataset.fpvCameraOpticalClearanceM=FPV_CAMERA_OPTICAL_CLEARANCE_M.toFixed(3);viewport.dataset.fpvCameraUpOffsetM=FPV_CAMERA_UP_OFFSET_M.toFixed(3);
    return null;
  }
  const horizontal=bodyForward.clone();horizontal.z=0;
  if(horizontal.lengthSq()>.04)horizontal.normalize();else if(externalCameraRig.initialized)horizontal.set(...externalCameraRig.heading);else horizontal.set(-1,0,0);
  const rig=externalCameraRig.update({position:[position.x,position.y,position.z],velocity:[velocity.x,velocity.y,velocity.z],heading:[horizontal.x,horizontal.y,horizontal.z],mode:cameraMode,dt});
  const viewport=$("viewport"),lag=Math.hypot(position.x-rig.anchor[0],position.y-rig.anchor[1],position.z-rig.anchor[2]);viewport.dataset.cameraRigMode="stabilized-inertial-anchor";viewport.dataset.cameraRigLagM=lag.toFixed(4);viewport.dataset.cameraRigAnchor=rig.anchor.map(value=>value.toFixed(4)).join(",");
  if(cameraMode==="third"){
    const thirdBaseLength=Math.hypot(2.25,1.05),thirdBack=cameraSettings.thirdDistanceM*(2.25/thirdBaseLength),thirdUp=cameraSettings.thirdDistanceM*(1.05/thirdBaseLength),frame=externalCameraFrame(rig.anchor,rig.heading,{back:thirdBack,up:thirdUp,lookAhead:.55,lookUp:.18});
    camera.position.set(...frame.position);camera.up.set(0,0,1);camera.lookAt(cameraLookTarget.set(...frame.target));
    const thirdFov=clamp(62*(cameraSettings.fpvFovDeg/105),35,100);if(Math.abs(camera.fov-thirdFov)>.01){camera.fov=thirdFov;camera.updateProjectionMatrix();}
    applyFireCameraShake(dt);viewport.dataset.cameraFov=String(camera.fov);viewport.dataset.cameraTiltDeg="0";viewport.dataset.cameraDistanceM=String(camera.position.distanceTo(position));return rig;
  }
  const frame=externalCameraFrame(rig.anchor,rig.heading,{back:1.65,up:.78,lookAhead:.38,lookUp:.10});camera.position.set(...frame.position);camera.up.set(0,0,1);camera.lookAt(cameraLookTarget.set(...frame.target));
  const followFov=clamp(52*(cameraSettings.fpvFovDeg/105),30,90);if(Math.abs(camera.fov-followFov)>.01){camera.fov=followFov;camera.updateProjectionMatrix();}
  applyFireCameraShake(dt);viewport.dataset.cameraFov=String(camera.fov);return rig;
}
$("camFollow")''', flags=re.S)
replace_once(sim,
'''  <div id="soloGamepadHelp" hidden>LS MOVE · RS TURN/PITCH · LT/RT ALT −/+ · LB+RS AIM · LB+RB FIRE · Y TARGET · A ARM · B KILL · X CAM</div>`;''',
'''  <div id="soloGamepadHelp" hidden>LS MOVE · RS TURN/PITCH · LT/RT ALT −/+ · LB+RS LOOK · RB FIRE · Y TARGET · A ARM · B KILL · X CAM</div>`;''')
replace_once(sim,
'''const flightFireFx=installFlightFireFx({viewport:$("viewport"),scene,camera,worldBridge:globalThis.__arondightRealWorld,isEnabled:()=>soloMode,isPointerEnabled:()=>$("viewport").dataset.controlSource!=="xbox"});''',
'''const flightFireFx=installFlightFireFx({viewport:$("viewport"),scene,camera,worldBridge:globalThis.__arondightRealWorld,isEnabled:()=>soloMode,isPointerEnabled:()=>$("viewport").dataset.controlSource!=="xbox",onRecoil:addFireCameraKick});''')
replace_once(sim,
'''  const aimX=viewport.clientWidth/2,aimY=viewport.clientHeight/2;flightFireFx?.setGamepadAim(sample.aim,aimX,aimY);flightFireFx?.setGamepadFire(sample.fire,aimX,aimY);viewport.dataset.gamepadAim=sample.aim?"1":"0";''',
'''  flightFireFx?.setGamepadAim(sample.aim);flightFireFx?.setGamepadFire(sample.fire);viewport.dataset.gamepadAim=sample.aim?"1":"0";''')
replace_once(sim,
'''  externalCameraRig.invalidate();cameraFrameMs=performance.now();physics.reset(defaultParams(),initial);''',
'''  externalCameraRig.invalidate();externalAirframeVisualRig.invalidate();cameraFrameMs=performance.now();physics.reset(defaultParams(),initial);''')
replace_once(sim,
'''physics.render(presentationPose,presentationDt);updateCamera(presentationPose,renderNow);''',
'''const externalCameraState=updateCamera(presentationPose,renderNow);let visualPose=presentationPose,visualState=null;if(externalCameraState){visualState=externalAirframeVisualRig.update({position:[presentationPose.position.x,presentationPose.position.y,presentationPose.position.z],quaternion:[presentationPose.quaternion.x,presentationPose.quaternion.y,presentationPose.quaternion.z,presentationPose.quaternion.w],cameraAnchor:externalCameraState.anchor,mode:cameraMode,dt:presentationDt});externalVisualPosition.set(...visualState.position);externalVisualQuaternion.set(...visualState.quaternion);externalVisualVelocity.copy(presentationPose.velocity);visualPose=externalVisualPose;}else externalAirframeVisualRig.invalidate();const visualViewport=$("viewport");if(visualViewport){visualViewport.dataset.visualAirframeFilter=externalCameraState?cameraMode:"off";visualViewport.dataset.visualAirframePositionErrorM=(visualState?.positionErrorM||0).toFixed(4);visualViewport.dataset.visualAirframeRotationErrorDeg=((visualState?.rotationErrorRad||0)*180/Math.PI).toFixed(3);}physics.render(presentationPose,presentationDt,visualPose);''')

# ---------------------------------------------------------------------------
# Fixed center fire, improved shot transient, recoil, hit confirm and damage FX.
# ---------------------------------------------------------------------------
fire="sim/flight_fire_fx.mjs"
replace_once(fire,
'''export function installFlightFireFx({viewport,scene,camera,worldBridge=null,isEnabled=()=>document.body.classList.contains("solo-flight"),isPointerEnabled=()=>true}={}){''',
'''export function installFlightFireFx({viewport,scene,camera,worldBridge=null,isEnabled=()=>document.body.classList.contains("solo-flight"),isPointerEnabled=()=>true,onRecoil=()=>{}}={}){''')
replace_once(fire,
'''  viewport.dataset.fireProjectileExpired="0";''',
'''  viewport.dataset.fireProjectileExpired="0";viewport.dataset.fireAimMode="center-fixed";viewport.dataset.fireCrosshairMode="center-fixed";''')
replace_once(fire,
'''    .xbox-crosshair{display:none;position:absolute;z-index:12;width:34px;height:34px;margin:-17px 0 0 -17px;border:2px solid #dffaff;border-radius:50%;pointer-events:none;filter:drop-shadow(0 0 5px #47cfff);box-shadow:inset 0 0 0 7px #07152277}
    .xbox-crosshair:before,.xbox-crosshair:after{content:"";position:absolute;left:50%;top:50%;background:#ff6f7f;transform:translate(-50%,-50%)}.xbox-crosshair:before{width:44px;height:2px}.xbox-crosshair:after{width:2px;height:44px}
    .xbox-crosshair.active{display:block}
    @keyframes flightImpactFade{from{opacity:1;transform:scale(.65)}to{opacity:0;transform:scale(1.55)}}''',
'''    .xbox-crosshair{display:none;position:absolute;z-index:12;left:50%;top:50%;width:24px;height:24px;margin:-12px 0 0 -12px;border:1px solid #eafcffcc;border-radius:50%;pointer-events:none;filter:drop-shadow(0 0 4px #47cfff);box-shadow:inset 0 0 0 4px #07152255}
    .xbox-crosshair:before,.xbox-crosshair:after{content:"";position:absolute;left:50%;top:50%;transform:translate(-50%,-50%)}.xbox-crosshair:before{width:38px;height:1px;background:linear-gradient(90deg,#eaffff 0 38%,transparent 38% 62%,#eaffff 62% 100%)}.xbox-crosshair:after{width:1px;height:38px;background:linear-gradient(180deg,#eaffff 0 38%,transparent 38% 62%,#eaffff 62% 100%)}
    .xbox-crosshair.active{display:block}.xbox-crosshair.hit-confirm{animation:combatHitConfirm .14s ease-out;border-color:#ffefef;filter:drop-shadow(0 0 7px #ff584d)}
    .combat-damage-vignette{position:absolute;inset:0;z-index:13;pointer-events:none;opacity:0;background:radial-gradient(circle at center,transparent 42%,#d5000010 61%,#ff16167d 100%)}.combat-damage-vignette.active{animation:combatDamagePulse .34s ease-out}
    @keyframes flightImpactFade{from{opacity:1;transform:scale(.65)}to{opacity:0;transform:scale(1.55)}}@keyframes combatHitConfirm{0%{transform:scale(1)}35%{transform:scale(.72)}100%{transform:scale(1)}}@keyframes combatDamagePulse{0%{opacity:.92}100%{opacity:0}}''')
replace_once(fire,
'''  const gamepadCrosshair=document.createElement("i");gamepadCrosshair.className="xbox-crosshair";gamepadCrosshair.setAttribute("aria-hidden","true");viewport.appendChild(gamepadCrosshair);
  let screenImpactCursor=0;''',
'''  const gamepadCrosshair=document.createElement("i");gamepadCrosshair.className="xbox-crosshair";gamepadCrosshair.setAttribute("aria-hidden","true");viewport.appendChild(gamepadCrosshair);
  const damageVignette=document.createElement("i");damageVignette.className="combat-damage-vignette";damageVignette.setAttribute("aria-hidden","true");viewport.appendChild(damageVignette);
  let screenImpactCursor=0;''')
replace_once(fire,
'''  function shotSound(){
    const ctx=ensureAudio();if(!ctx||!noiseBuffer)return;try{if(ctx.state==="suspended")ctx.resume();const src=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),gain=ctx.createGain();src.buffer=noiseBuffer;filter.type="bandpass";filter.frequency.value=1350;filter.Q.value=.7;gain.gain.setValueAtTime(.18,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.05);src.connect(filter).connect(gain).connect(ctx.destination);src.start();src.stop(ctx.currentTime+.055);}catch{}
  }''',
'''  function shotSound(){
    const ctx=ensureAudio();if(!ctx||!noiseBuffer)return;try{if(ctx.state==="suspended")ctx.resume();const t=ctx.currentTime,src=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),noiseGain=ctx.createGain(),thump=ctx.createOscillator(),thumpGain=ctx.createGain(),snap=ctx.createOscillator(),snapGain=ctx.createGain();src.buffer=noiseBuffer;filter.type="bandpass";filter.frequency.setValueAtTime(1700,t);filter.Q.value=.58;noiseGain.gain.setValueAtTime(.13,t);noiseGain.gain.exponentialRampToValueAtTime(.001,t+.052);thump.type="triangle";thump.frequency.setValueAtTime(155,t);thump.frequency.exponentialRampToValueAtTime(78,t+.06);thumpGain.gain.setValueAtTime(.07,t);thumpGain.gain.exponentialRampToValueAtTime(.001,t+.065);snap.type="square";snap.frequency.setValueAtTime(2600,t);snap.frequency.exponentialRampToValueAtTime(1100,t+.026);snapGain.gain.setValueAtTime(.021,t);snapGain.gain.exponentialRampToValueAtTime(.001,t+.032);src.connect(filter).connect(noiseGain).connect(ctx.destination);thump.connect(thumpGain).connect(ctx.destination);snap.connect(snapGain).connect(ctx.destination);src.start(t);src.stop(t+.06);thump.start(t);thump.stop(t+.07);snap.start(t);snap.stop(t+.035);}catch{}
  }
  function hitConfirmSound(){const ctx=ensureAudio();if(!ctx)return;try{if(ctx.state==="suspended")ctx.resume();const t=ctx.currentTime,osc=ctx.createOscillator(),gain=ctx.createGain(),tick=ctx.createOscillator(),tickGain=ctx.createGain();osc.type="sine";osc.frequency.setValueAtTime(900,t);osc.frequency.exponentialRampToValueAtTime(1500,t+.052);gain.gain.setValueAtTime(.065,t);gain.gain.exponentialRampToValueAtTime(.001,t+.075);tick.type="triangle";tick.frequency.setValueAtTime(2100,t);tick.frequency.exponentialRampToValueAtTime(1250,t+.035);tickGain.gain.setValueAtTime(.025,t);tickGain.gain.exponentialRampToValueAtTime(.001,t+.045);osc.connect(gain).connect(ctx.destination);tick.connect(tickGain).connect(ctx.destination);osc.start(t);osc.stop(t+.08);tick.start(t);tick.stop(t+.05);}catch{}}
  function updateCrosshair(){gamepadCrosshair.classList.toggle("active",Boolean(isEnabled()));viewport.dataset.fireCrosshairMode="center-fixed";}
  function damageFeedback(){damageVignette.classList.remove("active");void damageVignette.offsetWidth;damageVignette.classList.add("active");viewport.dataset.combatDamageFx=String((Number(viewport.dataset.combatDamageFx)||0)+1);}
  function hitConfirmFeedback(){hitConfirmSound();gamepadCrosshair.classList.remove("hit-confirm");void gamepadCrosshair.offsetWidth;gamepadCrosshair.classList.add("hit-confirm");viewport.dataset.combatHitConfirmFx=String((Number(viewport.dataset.combatHitConfirmFx)||0)+1);}
  const damageListener=()=>damageFeedback(),hitConfirmListener=()=>hitConfirmFeedback();window.addEventListener("arondight:combat-damage",damageListener);window.addEventListener("arondight:combat-hit-confirm",hitConfirmListener);''')
regex_once(fire,
    r'  function aimPoint\(\)\{.*?\n  \}',
'''  function aimPoint(){const rect={left:0,top:0,width:Math.max(1,viewport.clientWidth),height:Math.max(1,viewport.clientHeight)},x=rect.width*.5,y=rect.height*.5;return{x,y,rect};}''', flags=re.S)
replace_once(fire,
'''  function updateProjectiles(now){
    ensurePeerCombatScale();updateImpacts(now);''',
'''  function updateProjectiles(now){
    updateCrosshair();ensurePeerCombatScale();updateImpacts(now);''')
replace_once(fire,
'''    if(!active||now+.25<nextShotAt)return false;nextShotAt=now+SHOT_INTERVAL_MS;const aim=aimPoint();spawnProjectile(now,aim);shotSound();viewport.dataset.fireShots=String((Number(viewport.dataset.fireShots)||0)+1);''',
'''    if(!active||now+.25<nextShotAt)return false;nextShotAt=now+SHOT_INTERVAL_MS;const aim=aimPoint();spawnProjectile(now,aim);shotSound();try{onRecoil(.16);}catch{}viewport.dataset.fireShots=String((Number(viewport.dataset.fireShots)||0)+1);''')
replace_once(fire,
'''  function setGamepadAim(enabled,x=viewport.clientWidth/2,y=viewport.clientHeight/2){const activeAim=Boolean(enabled&&isEnabled());gamepadCrosshair.classList.toggle("active",activeAim);gamepadCrosshair.style.left=`${Math.max(0,Math.min(viewport.clientWidth,Number(x)||0))}px`;gamepadCrosshair.style.top=`${Math.max(0,Math.min(viewport.clientHeight,Number(y)||0))}px`;viewport.dataset.gamepadAim=activeAim?"1":"0";}''',
'''  function setGamepadAim(enabled){viewport.dataset.gamepadAim=Boolean(enabled&&isEnabled())?"1":"0";updateCrosshair();}''')
regex_once(fire,
    r'  function setGamepadFire\(pressed,x=viewport\.clientWidth/2,y=viewport\.clientHeight/2\)\{.*?\n  \}',
'''  function setGamepadFire(pressed){
    if(!pressed||!isEnabled()){if(active?.source==="gamepad")stop();return false;}
    if(active&&active.source!=="gamepad")return false;
    if(!active){active={id:"xbox",source:"gamepad"};ensureAudio();nextShotAt=0;}
    fire(performance.now());scheduleFire();return true;
  }''', flags=re.S)
replace_once(fire,
'''  return{stop,setGamepadAim,setGamepadFire,get decalPoolSize(){return decalPool.length;},get decalWrites(){return decalWrites;},get projectilePoolSize(){return projectilePool.length;},get activeProjectiles(){return activeProjectileCount;},dispose(){stop();cancelAnimationFrame(projectileRaf);gamepadCrosshair.remove();''',
'''  return{stop,setGamepadAim,setGamepadFire,get decalPoolSize(){return decalPool.length;},get decalWrites(){return decalWrites;},get projectilePoolSize(){return projectilePool.length;},get activeProjectiles(){return activeProjectileCount;},dispose(){stop();cancelAnimationFrame(projectileRaf);window.removeEventListener("arondight:combat-damage",damageListener);window.removeEventListener("arondight:combat-hit-confirm",hitConfirmListener);gamepadCrosshair.remove();damageVignette.remove();''')

# Confirmed network combat events drive feedback. A local ray intersection alone
# is not enough to produce a hit-confirm sound.
world="sim/real_world_bootstrap.mjs"
replace_once(world,
'''if(killed){this.vsLocalDead=true;this.vsDeaths++;}this.updateVsCombatHud(true);this.vsSession.sendCombat({type:"state",id:packet.id,hp:this.vsLocalHealth,killed});''',
'''if(killed){this.vsLocalDead=true;this.vsDeaths++;}this.updateVsCombatHud(true);window.dispatchEvent(new CustomEvent("arondight:combat-damage",{detail:{damage,hp:this.vsLocalHealth,killed}}));this.vsSession.sendCombat({type:"state",id:packet.id,hp:this.vsLocalHealth,killed});''')
replace_once(world,
'''if(packet.type==="state"){
      if(!this.vsPendingHits.delete(packet.id))return;if(this.vsPeerDead&&!packet.killed)return;this.vsPeerHealth=clamp(Math.round(Number(packet.hp)||0),0,100);if(packet.killed&&!this.vsPeerDead){this.vsPeerDead=true;this.vsKills++;this.vsPendingHits.clear();this.explodeVsPeer();}this.updateVsCombatHud(true);return;
    }''',
'''if(packet.type==="state"){
      if(!this.vsPendingHits.delete(packet.id))return;if(this.vsPeerDead&&!packet.killed)return;this.vsPeerHealth=clamp(Math.round(Number(packet.hp)||0),0,100);if(packet.killed&&!this.vsPeerDead){this.vsPeerDead=true;this.vsKills++;this.vsPendingHits.clear();this.explodeVsPeer();}this.updateVsCombatHud(true);window.dispatchEvent(new CustomEvent("arondight:combat-hit-confirm",{detail:{hp:this.vsPeerHealth,killed:Boolean(packet.killed)}}));return;
    }''')

# Xbox: RB is straight fire by itself. LB remains camera/free-look, not a gun aim modifier.
xbox="sim/xbox_gamepad.mjs"
replace_once(xbox,'''    fire:aim&&rightShoulder,''','''    fire:rightShoulder,''')

# Browser boot contract: physical mount stays at 70 mm, optical eye is ahead of lens.
browser="tests/browser_sim_smoke.mjs"
replace_once(browser,
'''    fpvCameraForward:Number(document.querySelector("#viewport")?.dataset.fpvCameraForwardOffsetM),
    fpvCameraUp:Number(document.querySelector("#viewport")?.dataset.fpvCameraUpOffsetM),''',
'''    fpvCameraMountForward:Number(document.querySelector("#viewport")?.dataset.fpvCameraMountForwardOffsetM),
    fpvCameraForward:Number(document.querySelector("#viewport")?.dataset.fpvCameraForwardOffsetM),
    fpvCameraOpticalClearance:Number(document.querySelector("#viewport")?.dataset.fpvCameraOpticalClearanceM),
    fpvSelfCameraVisible:document.querySelector("#viewport")?.dataset.fpvSelfCameraVisible||"",
    fpvCameraUp:Number(document.querySelector("#viewport")?.dataset.fpvCameraUpOffsetM),''')
replace_once(browser,
'''  if(cameraBoot.mode!=="fpv"||cameraBoot.fpv!=="1"||cameraBoot.tilt!=="-15"||cameraBoot.auto!=="fpv"||cameraBoot.soloCamera!=="FPV"||cameraBoot.fpvCameraForward!==.070||cameraBoot.fpvCameraUp!==.028||cameraBoot.cameraMassX!==-70||cameraBoot.cameraMassZ!==28||cameraBoot.initialGroundPose!=="1"||cameraBoot.initialVisualBottom<0||cameraBoot.panel!=="none")''',
'''  if(cameraBoot.mode!=="fpv"||cameraBoot.fpv!=="1"||cameraBoot.tilt!=="-15"||cameraBoot.auto!=="fpv"||cameraBoot.soloCamera!=="FPV"||cameraBoot.fpvCameraMountForward!==.070||cameraBoot.fpvCameraForward!==.102||cameraBoot.fpvCameraOpticalClearance<.004||cameraBoot.fpvSelfCameraVisible!=="0"||cameraBoot.fpvCameraUp!==.028||cameraBoot.cameraMassX!==-70||cameraBoot.cameraMassZ!==28||cameraBoot.initialGroundPose!=="1"||cameraBoot.initialVisualBottom<0||cameraBoot.panel!=="none")''')

# Xbox unit contract.
test_xbox="tests/xbox_gamepad_test.mjs"
replace_once(test_xbox,
'''assert.equal(sample.fire,false,"RB must never fire without the LB aim modifier");''',
'''assert.equal(sample.fire,false,"RB is released, so fixed-center fire must be off");''')
replace_once(test_xbox,
'''buttons[XBOX_STANDARD_BUTTON.LEFT_SHOULDER]={pressed:true,value:1};
buttons[XBOX_STANDARD_BUTTON.RIGHT_SHOULDER]={pressed:true,value:1};
sample=sampleXboxGamepad(pad);
assert.equal(sample.aim,true);
assert.equal(sample.fire,true,"LB + RB must fire");
assert.ok(sample.right.x>.45&&sample.right.y<-.25,"LB aim must retain right-stick free-look axes");''',
'''buttons[XBOX_STANDARD_BUTTON.RIGHT_SHOULDER]={pressed:true,value:1};
sample=sampleXboxGamepad(pad);
assert.equal(sample.aim,false);
assert.equal(sample.fire,true,"RB must fire straight through the center crosshair without LB");
buttons[XBOX_STANDARD_BUTTON.LEFT_SHOULDER]={pressed:true,value:1};sample=sampleXboxGamepad(pad);assert.equal(sample.aim,true);assert.equal(sample.fire,true);assert.ok(sample.right.x>.45&&sample.right.y<-.25,"LB free-look must retain right-stick axes while RB fire stays independent");''')
replace_once(test_xbox,
'''console.log("Xbox mapping passed: touch handoff, LT/RT altitude, LB free-look/fire, and settings-modal flight suppression with release latch.");''',
'''console.log("Xbox mapping passed: touch handoff, LT/RT altitude, independent RB center-fire, LB free-look, and settings-modal flight suppression with release latch.");''')

# Xbox browser contract: RB fires without LB; crosshair remains centered/persistent.
xbox_browser="tests/xbox_gamepad_browser_smoke.mjs"
replace_once(xbox_browser,'''!active.helpText.includes("LB+RB FIRE")''','''!active.helpText.includes("RB FIRE")''')
replace_once(xbox_browser,
'''  await setButton(5,1);await pause(260);
  const rbOnly=await page.$eval("#viewport",v=>({shots:Number(v.dataset.fireShots||0),aim:v.dataset.gamepadAim,fire:v.dataset.gamepadFire}));
  if(rbOnly.shots!==triggerBaseline||rbOnly.aim!=="0"||rbOnly.fire!=="0")throw new Error(`RB fired outside LB aim mode: ${JSON.stringify(rbOnly)}`);''',
'''  await setButton(5,1);await page.waitForFunction(before=>{const v=document.querySelector("#viewport");return v?.dataset.gamepadFire==="1"&&Number(v.dataset.fireShots||0)>before&&v.dataset.fireAimMode==="center-fixed";},{timeout:4000},triggerBaseline);await pause(180);
  const rbOnly=await page.$eval("#viewport",v=>({shots:Number(v.dataset.fireShots||0),aim:v.dataset.gamepadAim,fire:v.dataset.gamepadFire,x:Number(v.dataset.fireAimX),y:Number(v.dataset.fireAimY),w:v.clientWidth,h:v.clientHeight}));
  if(rbOnly.shots<=triggerBaseline||rbOnly.aim!=="0"||rbOnly.fire!=="1"||Math.abs(rbOnly.x-rbOnly.w/2)>.6||Math.abs(rbOnly.y-rbOnly.h/2)>.6)throw new Error(`RB did not fire straight through center without LB: ${JSON.stringify(rbOnly)}`);''')
replace_once(xbox_browser,
'''  if(pointerBlocked!==triggerBaseline)throw new Error(`touch fire remained active in Xbox mode: ${triggerBaseline} -> ${pointerBlocked}`);''',
'''  if(pointerBlocked!==rbOnly.shots)throw new Error(`touch fire remained active in Xbox mode: ${rbOnly.shots} -> ${pointerBlocked}`);''')
replace_once(xbox_browser,
'''  await setButton(5,0);await setButton(4,1);''',
'''  await setButton(5,0);await setButton(4,1);''')
replace_once(xbox_browser,
'''  await page.waitForFunction(()=>document.querySelector("#viewport")?.dataset.gamepadFire==="0"&&getComputedStyle(document.querySelector(".xbox-crosshair")).display==="none",{timeout:3000});''',
'''  await page.waitForFunction(()=>document.querySelector("#viewport")?.dataset.gamepadFire==="0"&&document.querySelector("#viewport")?.dataset.fireCrosshairMode==="center-fixed"&&getComputedStyle(document.querySelector(".xbox-crosshair")).display!=="none",{timeout:3000});''')
replace_once(xbox_browser,
'''console.log("Xbox browser E2E passed: Chrome paired-before-load exposure, MENU settings, Y reset, VIEW exit, persistent Xbox handoff and fire/aim/altitude controls.");''',
'''console.log("Xbox browser E2E passed: Chrome exposure, persistent handoff, independent RB center-fire, LB free-look, altitude, MENU/Y/VIEW recovery controls.");''')

# Unit regression for presentation-only smoothing.
write("tests/visual_pose_stabilization_test.mjs", r'''import assert from "node:assert/strict";
import {StabilizedExternalAirframeVisual,EXTERNAL_AIRFRAME_VISUAL_PROFILES} from "../sim/visual_pose_stabilization.mjs";
const range=v=>Math.max(...v)-Math.min(...v),yawQuat=y=>[0,0,Math.sin(y/2),Math.cos(y/2)],quatYaw=q=>Math.atan2(2*q[3]*q[2],1-2*q[2]*q[2]);
for(const mode of ["follow","third"]){
  const filter=new StabilizedExternalAirframeVisual(),raw=[],filtered=[],dt=1/120,anchor=[0,0,2];
  for(let i=0;i<1200;i++){const t=i*dt,jitter=.018*Math.sin(2*Math.PI*14*t),p=[jitter,0,2],state=filter.update({position:p,quaternion:[0,0,0,1],cameraAnchor:anchor,mode,dt});if(i>180){raw.push(jitter);filtered.push(state.position[0]);}}
  const ratio=range(filtered)/range(raw);assert.ok(ratio<.48,`${mode} passed too much 14 Hz external-view position twitch: ${ratio}`);
}
for(const mode of ["follow","third"]){
  const profile=EXTERNAL_AIRFRAME_VISUAL_PROFILES[mode],filter=new StabilizedExternalAirframeVisual(),dt=1/120;let maxError=0;
  for(let i=0;i<900;i++){const t=i*dt,x=t<1?.5*7*t*t:3.5+7*(t-1),anchor=[x-.16*(1-Math.exp(-2*t)),0,2],state=filter.update({position:[x,0,2],quaternion:[0,0,0,1],cameraAnchor:anchor,mode,dt});maxError=Math.max(maxError,state.positionErrorM);}
  assert.ok(maxError<=profile.maxPositionErrorM+1e-6,`${mode} visible airframe diverged from authoritative pose: ${maxError}`);
}
for(const mode of ["follow","third"]){
  const filter=new StabilizedExternalAirframeVisual(),raw=[],filtered=[],dt=1/120,anchor=[0,0,2];
  for(let i=0;i<1200;i++){const t=i*dt,yaw=.035*Math.sin(2*Math.PI*12*t),state=filter.update({position:[0,0,2],quaternion:yawQuat(yaw),cameraAnchor:anchor,mode,dt});if(i>180){raw.push(yaw);filtered.push(quatYaw(state.quaternion));}}
  assert.ok(range(filtered)/range(raw)<.55,`${mode} passed too much 12 Hz attitude twitch`);
}
console.log("External airframe presentation passed: high-frequency relative twitch attenuated, physical/root pose untouched, bounded visual error.");
''')

# Static combat contract.
write("tests/combat_center_fire_test.mjs", r'''import assert from "node:assert/strict";import {readFileSync} from "node:fs";
const fire=readFileSync("sim/flight_fire_fx.mjs","utf8"),sim=readFileSync("sim/simulator.mjs","utf8"),world=readFileSync("sim/real_world_bootstrap.mjs","utf8"),xbox=readFileSync("sim/xbox_gamepad.mjs","utf8");
for(const marker of ['fireAimMode="center-fixed"','fireCrosshairMode="center-fixed"','x=rect.width*.5,y=rect.height*.5','onRecoil(.16)','hitConfirmSound','combat-damage-vignette','arondight:combat-hit-confirm','arondight:combat-damage'])assert.ok(fire.includes(marker),`missing combat marker: ${marker}`);
assert.ok(!fire.includes('return{x:Math.max(0,Math.min(rect.width,active.x))'),"gamepad screen aim still moves projectile ray");assert.ok(!fire.includes('const x=rotated?clientY-screenRect.top:clientX-screenRect.left'),"touch point still moves projectile ray");
for(const marker of ['onRecoil:addFireCameraKick','applyFireCameraShake(dt)','externalAirframeVisualRig.update','physics.render(presentationPose,presentationDt,visualPose)','this.visualGroup','fpvSelfCameraVisible'])assert.ok(sim.includes(marker),`missing simulator presentation marker: ${marker}`);
assert.ok(world.includes('window.dispatchEvent(new CustomEvent("arondight:combat-hit-confirm"'),"peer acknowledgement does not drive hit confirm");assert.ok(world.includes('window.dispatchEvent(new CustomEvent("arondight:combat-damage"'),"incoming hit does not drive damage indication");assert.ok(xbox.includes('fire:rightShoulder'),"Xbox RB is still gated behind LB aim");
console.log("Combat center-fire contract passed: fixed center ray for touch/Xbox, independent RB fire, recoil, confirmed-hit sound and incoming-damage feedback.");
''')

# Browser regression: off-center touch still shoots center, FPV cannot see own camera,
# and external camera modes activate the child-only visual stabilizer.
write("tests/combat_center_fire_browser_smoke.mjs", r'''import puppeteer from "puppeteer-core";
const input=process.argv[2]||"http://127.0.0.1:4174/drone_simulator.html",url=new URL(input,"http://127.0.0.1:4174"),baseOrigin=url.origin,cacheTag=process.env.GITHUB_SHA?`${url.search?"&":"?"}ci=${encodeURIComponent(process.env.GITHUB_SHA)}`:"",executablePath=process.env.CHROME_BIN;if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");
const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader"]}),page=await browser.newPage();
try{await page.setViewport({width:844,height:390,deviceScaleFactor:1});await page.goto(`${baseOrigin}/drone_simulator.html${cacheTag}`,{waitUntil:"load",timeout:30000});await page.waitForFunction(()=>document.querySelector("#status")?.textContent?.includes("SIM ready"),{timeout:30000});await page.waitForFunction(()=>document.body.classList.contains("solo-flight")&&document.querySelector("#viewport")?.dataset.fireCrosshairMode==="center-fixed",{timeout:8000});
const cross=await page.evaluate(()=>{const v=document.querySelector("#viewport"),c=document.querySelector(".xbox-crosshair"),r=c.getBoundingClientRect(),vr=v.getBoundingClientRect();return{display:getComputedStyle(c).display,cx:r.left+r.width/2-vr.left,cy:r.top+r.height/2-vr.top,w:v.clientWidth,h:v.clientHeight};});if(cross.display==="none"||Math.abs(cross.cx-cross.w/2)>2||Math.abs(cross.cy-cross.h/2)>2)throw new Error(`crosshair not centered: ${JSON.stringify(cross)}`);
const before=await page.$eval("#viewport",v=>Number(v.dataset.fireShots||0));await page.evaluate(()=>{const v=document.querySelector("#viewport"),r=v.getBoundingClientRect();v.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,cancelable:true,pointerId:77,pointerType:"touch",clientX:r.left+18,clientY:r.top+22,button:0}));});await page.waitForFunction(n=>Number(document.querySelector("#viewport")?.dataset.fireShots||0)>n,{timeout:3000},before);const fired=await page.$eval("#viewport",v=>({x:Number(v.dataset.fireAimX),y:Number(v.dataset.fireAimY),w:v.clientWidth,h:v.clientHeight,mode:v.dataset.fireAimMode,recoil:Number(v.dataset.fireRecoilImpulses||0)}));if(fired.mode!=="center-fixed"||Math.abs(fired.x-fired.w/2)>.6||Math.abs(fired.y-fired.h/2)>.6||fired.recoil<1)throw new Error(`off-center touch changed shot direction: ${JSON.stringify(fired)}`);await page.evaluate(()=>document.querySelector("#viewport").dispatchEvent(new PointerEvent("pointerup",{bubbles:true,cancelable:true,pointerId:77,pointerType:"touch",button:0})));
await page.evaluate(()=>{dispatchEvent(new CustomEvent("arondight:combat-damage",{detail:{damage:25,hp:75}}));dispatchEvent(new CustomEvent("arondight:combat-hit-confirm",{detail:{hp:75}}));});await page.waitForFunction(()=>Number(document.querySelector("#viewport")?.dataset.combatDamageFx||0)>=1&&Number(document.querySelector("#viewport")?.dataset.combatHitConfirmFx||0)>=1,{timeout:3000});
await page.click("#camThird");await page.waitForFunction(()=>document.querySelector("#viewport")?.dataset.visualAirframeFilter==="third",{timeout:3000});let ext=await page.$eval("#viewport",v=>({pos:Number(v.dataset.visualAirframePositionErrorM),rot:Number(v.dataset.visualAirframeRotationErrorDeg)}));if(ext.pos>.051||ext.rot>6.1)throw new Error(`third visual filter exceeded physical bound: ${JSON.stringify(ext)}`);await page.click("#camFollow");await page.waitForFunction(()=>document.querySelector("#viewport")?.dataset.visualAirframeFilter==="follow",{timeout:3000});ext=await page.$eval("#viewport",v=>({pos:Number(v.dataset.visualAirframePositionErrorM),rot:Number(v.dataset.visualAirframeRotationErrorDeg)}));if(ext.pos>.031||ext.rot>4.1)throw new Error(`follow visual filter exceeded physical bound: ${JSON.stringify(ext)}`);await page.click("#camFpv");await page.waitForFunction(()=>{const v=document.querySelector("#viewport");return v?.dataset.fpvSelfCameraVisible==="0"&&Number(v.dataset.fpvCameraOpticalClearanceM)>.004&&v.dataset.visualAirframeFilter==="off";},{timeout:3000});
console.log("Combat/camera browser E2E passed: fixed center fire, recoil/hit/damage FX, bounded external visual stabilizer and FPV self-occlusion guard.");}finally{await browser.close();}
''')

# Architecture contracts updated to the final semantics.
arch="tests/architecture_invariants.mjs"
replace_once(arch,
'''for(const marker of ["LB+RB FIRE","data-control-source=\\"xbox\\"","data-gamepad-enabled=\\"1\\"","pollXboxGamepad(renderNow)","setGamepadLook?.(sample.aim","setGamepadFire(sample.fire","xboxControllerToggle:true","phoneSettings.xboxControllerEnabled===true","deactivateXboxGamepad(true)"])''',
'''for(const marker of ["RB FIRE","data-control-source=\\"xbox\\"","data-gamepad-enabled=\\"1\\"","pollXboxGamepad(renderNow)","setGamepadLook?.(sample.aim","setGamepadFire(sample.fire","xboxControllerToggle:true","phoneSettings.xboxControllerEnabled===true","deactivateXboxGamepad(true)"])''')
replace_once(arch,
'''for(const marker of ["RIGHT_SHOULDER:5","LEFT_TRIGGER:6","RIGHT_TRIGGER:7","heightAxis:","fire:aim&&rightShoulder"])''',
'''for(const marker of ["RIGHT_SHOULDER:5","LEFT_TRIGGER:6","RIGHT_TRIGGER:7","heightAxis:","fire:rightShoulder"])''')
replace_once(arch,'''requireText("tests/xbox_gamepad_test.mjs","LB + RB must fire");''','''requireText("tests/xbox_gamepad_test.mjs","RB must fire straight through the center crosshair without LB");''')
replace_once(arch,
'''for(const marker of ["const FPV_CAMERA_FORWARD_OFFSET_M = .070;","const FPV_CAMERA_UP_OFFSET_M = .028;","fpvCameraUpOffsetM=FPV_CAMERA_UP_OFFSET_M.toFixed(3)","fpvCameraBody.userData.arondightFpvCamera=true","fpvCameraLens.userData.arondightFpvCameraLens=true"])requireText("sim/simulator.mjs",marker);''',
'''for(const marker of ["const FPV_CAMERA_MOUNT_FORWARD_OFFSET_M = .070;","const FPV_CAMERA_LENS_FORWARD_OFFSET_M = .093;","const FPV_CAMERA_FORWARD_OFFSET_M = .102;","const FPV_CAMERA_UP_OFFSET_M = .028;","FPV_CAMERA_OPTICAL_CLEARANCE_M","fpvCameraMountForwardOffsetM=FPV_CAMERA_MOUNT_FORWARD_OFFSET_M.toFixed(3)","fpvCameraOpticalClearanceM=FPV_CAMERA_OPTICAL_CLEARANCE_M.toFixed(3)","fpvSelfCameraVisible","fpvCameraBody.userData.arondightFpvCamera=true","fpvCameraLens.userData.arondightFpvCameraLens=true"])requireText("sim/simulator.mjs",marker);forbidText("sim/simulator.mjs","fpvCameraBody.position.set(-FPV_CAMERA_FORWARD_OFFSET_M","optical origin must not be reused as physical camera-body center");''')
replace_once(arch,
'''for(const marker of ['import {StabilizedExternalCameraRig,externalCameraFrame} from "./camera_stabilization.mjs";',"capturePresentationStep()","capturePresentationCurrent()","presentationPose(alpha=1)","stabilized-inertial-anchor","presentationPoseInterpolation","physics.render(presentationPose,presentationDt);updateCamera(presentationPose,renderNow)"])''',
'''for(const marker of ['import {StabilizedExternalCameraRig,externalCameraFrame} from "./camera_stabilization.mjs";','import {StabilizedExternalAirframeVisual,EXTERNAL_AIRFRAME_VISUAL_PROFILES} from "./visual_pose_stabilization.mjs";',"capturePresentationStep()","capturePresentationCurrent()","presentationPose(alpha=1)","stabilized-inertial-anchor","presentationPoseInterpolation","physics.render(presentationPose,presentationDt,visualPose)","this.visualGroup","externalAirframeVisualRig.update"])''')
write(arch, text(arch)+'''\nfor(const marker of ["fireAimMode=\\\"center-fixed\\\"","fireCrosshairMode=\\\"center-fixed\\\"","hitConfirmSound","combat-damage-vignette","onRecoil(.16)"])requireText("sim/flight_fire_fx.mjs",marker);\nfor(const marker of ["arondight:combat-hit-confirm","arondight:combat-damage"])requireText("sim/real_world_bootstrap.mjs",marker);\nrequireText("sim/visual_pose_stabilization.mjs","class StabilizedExternalAirframeVisual");\nrequireText(".github/workflows/deploy.yml","node tests/visual_pose_stabilization_test.mjs");\nrequireText(".github/workflows/deploy.yml","node tests/combat_center_fire_test.mjs");\nrequireText(".github/workflows/deploy.yml","node tests/combat_center_fire_browser_smoke.mjs");\n''')

# Release gates: unit + local browser + exact live browser. S31 host also runs new unit contracts.
deploy=".github/workflows/deploy.yml"
replace_once(deploy,
'''          node tests/camera_stabilization_test.mjs
          node tests/render_stability_test.mjs''',
'''          node tests/camera_stabilization_test.mjs
          node tests/visual_pose_stabilization_test.mjs
          node tests/combat_center_fire_test.mjs
          node tests/render_stability_test.mjs''')
replace_once(deploy,
'''          CHROME_BIN="$CHROME_BIN" node tests/browser_sim_smoke.mjs http://127.0.0.1:4174/drone_simulator.html
          CHROME_BIN="$CHROME_BIN" node tests/xbox_gamepad_browser_smoke.mjs http://127.0.0.1:4174''',
'''          CHROME_BIN="$CHROME_BIN" node tests/browser_sim_smoke.mjs http://127.0.0.1:4174/drone_simulator.html
          CHROME_BIN="$CHROME_BIN" node tests/combat_center_fire_browser_smoke.mjs http://127.0.0.1:4174/drone_simulator.html
          CHROME_BIN="$CHROME_BIN" node tests/xbox_gamepad_browser_smoke.mjs http://127.0.0.1:4174''')
replace_once(deploy,
'''          CHROME_BIN="$CHROME_BIN" node tests/takeoff_agl_browser_smoke.mjs "https://kurzlernen.de/drone_simulator.html?ci=${GITHUB_SHA}"
          CHROME_BIN="$CHROME_BIN" node tests/xbox_gamepad_browser_smoke.mjs https://kurzlernen.de''',
'''          CHROME_BIN="$CHROME_BIN" node tests/takeoff_agl_browser_smoke.mjs "https://kurzlernen.de/drone_simulator.html?ci=${GITHUB_SHA}"
          CHROME_BIN="$CHROME_BIN" node tests/combat_center_fire_browser_smoke.mjs "https://kurzlernen.de/drone_simulator.html?ci=${GITHUB_SHA}"
          CHROME_BIN="$CHROME_BIN" node tests/xbox_gamepad_browser_smoke.mjs https://kurzlernen.de''')

s31=".github/workflows/s31-hil.yml"
replace_once(s31,
'''          node tests/xbox_gamepad_test.mjs
          node tests/render_stability_test.mjs''',
'''          node tests/xbox_gamepad_test.mjs
          node tests/visual_pose_stabilization_test.mjs
          node tests/combat_center_fire_test.mjs
          node tests/render_stability_test.mjs''')

print("camera/combat product patch prepared")
