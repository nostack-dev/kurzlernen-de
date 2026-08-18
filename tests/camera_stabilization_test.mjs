import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dampingAlpha,EXTERNAL_CAMERA_PROFILES,StabilizedExternalCameraRig,externalCameraFrame} from "../sim/camera_stabilization.mjs";

const near=(actual,expected,tolerance,message)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${message}: ${actual} vs ${expected}`);

// Utility damping stays refresh-rate invariant for the presentation code that
// still uses it elsewhere; the external camera translation itself no longer does.
function dampedAfter(rate,hz,seconds){let value=0;const dt=1/hz,alpha=dampingAlpha(rate,dt);for(let i=0;i<hz*seconds;i++)value+=(1-value)*alpha;return value;}
const response30=dampedAfter(4.8,30,2);
near(response30,dampedAfter(4.8,60,2),1e-12,"60 Hz damping changed the time constant");
near(response30,dampedAfter(4.8,120,2),1e-12,"120 Hz damping changed the time constant");

// FOLLOW and THIRD must be exactly translation-locked to the current interpolated
// presentation pose at every refresh rate. No chase spring or velocity prediction
// may let the visible aircraft pull through the external-camera frame.
const headingAt=degrees=>[Math.cos(degrees*Math.PI/180),Math.sin(degrees*Math.PI/180),0];
for(const mode of ["follow","third"]){
  assert.equal(EXTERNAL_CAMERA_PROFILES[mode].maxLagM,0,`${mode} profile reintroduced translational lag`);
  for(const hz of [30,60,120]){
    const rig=new StabilizedExternalCameraRig(),dt=1/hz;
    for(let i=0;i<240;i++){
      const time=i*dt,position=[8*time+.07*Math.sin(time*17),-3*time+.03*Math.cos(time*11),2+.04*Math.sin(time*23)],velocity=[8,-3,0],heading=headingAt((time*95)%360),state=rig.update({position,velocity,heading,mode,dt});
      assert.deepEqual([...state.anchor],position,`${mode} camera lagged the presentation pose at ${hz} Hz frame ${i}`);
      assert.deepEqual([...state.velocity],velocity,`${mode} camera velocity state diverged at ${hz} Hz frame ${i}`);
      const expectedHeading=[heading[0],heading[1],0];
      near(state.heading[0],expectedHeading[0],1e-12,`${mode} heading x lagged at ${hz} Hz`);
      near(state.heading[1],expectedHeading[1],1e-12,`${mode} heading y lagged at ${hz} Hz`);
    }
  }
}

// If horizontal heading becomes undefined (near-vertical airframe), hold the last
// valid yaw instead of inventing a direction or producing NaNs.
const headingRig=new StabilizedExternalCameraRig();
let headingState=headingRig.update({position:[0,0,2],velocity:[0,0,0],heading:headingAt(137),mode:"follow",dt:1/60});
const heldHeading=[...headingState.heading];
headingState=headingRig.update({position:[1,2,3],velocity:[0,0,0],heading:[0,0,1],mode:"follow",dt:1/60});
assert.deepEqual([...headingState.anchor],[1,2,3],"degenerate heading must not reintroduce translation lag");
for(let axis=0;axis<3;axis++)near(headingState.heading[axis],heldHeading[axis],1e-12,`degenerate horizontal heading moved axis ${axis}`);

// Camera eye and look target share the exact same anchor. Translating the aircraft
// therefore translates the complete external-camera frame without rotating it.
const delta=[2.75,-1.2,.42],frameA=externalCameraFrame([1,2,3],[-.8,.6,0],{back:2.2,up:1.1,lookAhead:.5,lookUp:.2}),frameB=externalCameraFrame([1+delta[0],2+delta[1],3+delta[2]],[-.8,.6,0],{back:2.2,up:1.1,lookAhead:.5,lookUp:.2});
for(let axis=0;axis<3;axis++){
  near(frameB.position[axis]-frameA.position[axis],delta[axis],1e-12,`camera translation mismatch on axis ${axis}`);
  near(frameB.target[axis]-frameA.target[axis],delta[axis],1e-12,`look-target translation mismatch on axis ${axis}`);
  near(frameB.target[axis]-frameB.position[axis],frameA.target[axis]-frameA.position[axis],1e-12,`world view rotated from position correction on axis ${axis}`);
}

// Mode switches and discontinuous state changes are atomic: the first frame in a
// new mode is already on the exact current pose, never a fly-in.
const resetRig=new StabilizedExternalCameraRig();
resetRig.update({position:[0,0,1],velocity:[0,0,0],heading:[-1,0,0],mode:"follow",dt:1/60});
let resetState=resetRig.update({position:[20,-7,5],velocity:[1,2,0],heading:[0,1,0],mode:"follow",dt:1/60});
assert.deepEqual([...resetState.anchor],[20,-7,5],"large state change did not stay frame-locked");
resetState=resetRig.update({position:[20.1,-6.9,5],velocity:[1,2,0],heading:[0,1,0],mode:"third",dt:1/60});
assert.deepEqual([...resetState.anchor],[20.1,-6.9,5],"camera-mode switch did not frame-lock immediately");

const simulator=readFileSync("sim/simulator.mjs","utf8"),physicsStart=simulator.indexOf("class PhysicsModel"),physicsEnd=simulator.indexOf("function integrateDuration",physicsStart),physicsSource=simulator.slice(physicsStart,physicsEnd);
assert.ok(physicsStart>=0&&physicsEnd>physicsStart,"PhysicsModel boundary missing");
for(const forbidden of ["StabilizedExternalCameraRig","externalCameraFrame","camera.position","camera.lookAt"])
  assert.ok(!physicsSource.includes(forbidden),`presentation camera leaked into authoritative physics: ${forbidden}`);

// FPV gets the very same interpolated presentation pose as the visible aircraft,
// then applies only rigid body-frame offsets. It must bypass the external rig.
const updateStart=simulator.indexOf("function updateCamera("),updateEnd=simulator.indexOf('$("camFollow")',updateStart),cameraSource=simulator.slice(updateStart,updateEnd),fpvStart=cameraSource.indexOf('if(cameraMode==="fpv"){'),externalStart=cameraSource.indexOf("const horizontal=bodyForward.clone()",fpvStart),fpvSource=cameraSource.slice(fpvStart,externalStart);
assert.ok(updateStart>=0&&updateEnd>updateStart&&fpvStart>=0&&externalStart>fpvStart,"camera-mode source boundaries missing");
assert.ok(fpvSource.includes("camera.position.copy(position)"),"FPV camera is not rigidly based on the current presentation position");
assert.ok(fpvSource.includes("externalCameraRig.invalidate()"),"FPV does not bypass the external camera rig");
assert.ok(!fpvSource.includes("externalCameraRig.update("),"FPV accidentally passes through the external camera lag path");
assert.ok(simulator.includes("physics.render(presentationPose,presentationDt);updateCamera(presentationPose,renderNow);"),"visible aircraft and all camera modes no longer share one presentation pose");

console.log("Camera stabilization passed: FOLLOW/THIRD zero-lag frame lock, FPV rigid shared-pose mount, translation-stable, physics-isolated");
