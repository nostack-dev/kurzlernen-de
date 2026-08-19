import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dampingAlpha,EXTERNAL_CAMERA_PROFILES,StabilizedExternalCameraRig,externalCameraFrame} from "../sim/camera_stabilization.mjs";

const near=(actual,expected,tolerance,message)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${message}: ${actual} vs ${expected}`);
const range=values=>Math.max(...values)-Math.min(...values);

// Exponential damping must have the same response at every display refresh rate.
function dampedAfter(rate,hz,seconds){let value=0;const dt=1/hz,alpha=dampingAlpha(rate,dt);for(let i=0;i<hz*seconds;i++)value+=(1-value)*alpha;return value;}
const response30=dampedAfter(4.8,30,2);
near(response30,dampedAfter(4.8,60,2),1e-12,"60 Hz damping changed the camera time constant");
near(response30,dampedAfter(4.8,120,2),1e-12,"120 Hz damping changed the camera time constant");

// Heading damping follows the shortest yaw arc and remains stable when the
// airframe points almost vertically and has no reliable horizontal heading.
const headingRig=new StabilizedExternalCameraRig(),headingAt=degrees=>[Math.cos(degrees*Math.PI/180),Math.sin(degrees*Math.PI/180),0];
headingRig.update({position:[0,0,2],velocity:[0,0,0],heading:headingAt(179),mode:"follow",dt:1/60});
let headingState=headingRig.update({position:[0,0,2],velocity:[0,0,0],heading:headingAt(-179),mode:"follow",dt:1/60});
assert.ok(Math.abs(Math.atan2(headingState.heading[1],headingState.heading[0])*180/Math.PI)>175,"heading crossed the long arc at the ±180° wrap");
const heldHeading=[...headingState.heading];headingState=headingRig.update({position:[0,0,2],velocity:[0,0,0],heading:[0,0,1],mode:"follow",dt:1/60});
for(let axis=0;axis<3;axis++)near(headingState.heading[axis],heldHeading[axis],1e-12,`degenerate horizontal heading moved axis ${axis}`);

// Camera eye and look target must share one anchor. Translating the aircraft may
// move the complete frame, but it must not rotate the view of the world.
const delta=[2.75,-1.2,.42],frameA=externalCameraFrame([1,2,3],[-.8,.6,0],{back:2.2,up:1.1,lookAhead:.5,lookUp:.2}),frameB=externalCameraFrame([1+delta[0],2+delta[1],3+delta[2]],[-.8,.6,0],{back:2.2,up:1.1,lookAhead:.5,lookUp:.2});
for(let axis=0;axis<3;axis++){
  near(frameB.position[axis]-frameA.position[axis],delta[axis],1e-12,`camera translation mismatch on axis ${axis}`);
  near(frameB.target[axis]-frameA.target[axis],delta[axis],1e-12,`look-target translation mismatch on axis ${axis}`);
  near(frameB.target[axis]-frameB.position[axis],frameA.target[axis]-frameA.position[axis],1e-12,`world view rotated from position correction on axis ${axis}`);
}

// Representative high-frequency hover corrections remain in authoritative
// physics, while their presentation-only camera anchor attenuates world swim.
for(const mode of ["follow","third"]){
  const rig=new StabilizedExternalCameraRig(),raw=[],filtered=[],dt=1/120,frequencyHz=12,amplitudeM=.03;
  for(let i=0;i<1200;i++){
    const time=i*dt,x=amplitudeM*Math.sin(2*Math.PI*frequencyHz*time),vx=amplitudeM*2*Math.PI*frequencyHz*Math.cos(2*Math.PI*frequencyHz*time);
    const state=rig.update({position:[x,0,2],velocity:[vx,0,0],heading:[-1,0,0],mode,dt});
    if(i>240){raw.push(x);filtered.push(state.anchor[0]);}
  }
  const ratio=range(filtered)/range(raw);
  assert.ok(ratio<.30,`${mode} camera passed too much hover correction into the world view: ${ratio}`);
}

// The long third-person lever arm must not amplify tiny FC yaw corrections into
// visible world twitch. A 10 Hz ±1.5° correction is presentation noise, not a
// deliberate camera orbit.
{
  const rig=new StabilizedExternalCameraRig(),raw=[],filtered=[],dt=1/120,frequencyHz=10,amplitudeRad=1.5*Math.PI/180;
  for(let i=0;i<1200;i++){
    const time=i*dt,yaw=amplitudeRad*Math.sin(2*Math.PI*frequencyHz*time),heading=[Math.cos(yaw),Math.sin(yaw),0],state=rig.update({position:[0,0,2],velocity:[0,0,0],heading,mode:"third",dt});
    if(i>240){raw.push(yaw);filtered.push(Math.atan2(state.heading[1],state.heading[0]));}
  }
  const ratio=range(filtered)/range(raw);
  assert.ok(ratio<.09,`third-person camera passed too much high-frequency yaw into the world view: ${ratio}`);
}

// A long compositor frame must not trigger the old hard max-lag catch-up snap.
{
  const rig=new StabilizedExternalCameraRig(),dts=[...Array(20).fill(1/60),.1,...Array(80).fill(1/60)];let time=0,previousAnchor=null,maxCameraSpeed=0,maxSourceSpeed=0;
  for(const dt of dts){
    const acceleration=30,accelerating=time<.5,position=accelerating?.5*acceleration*time*time:.5*acceleration*.5*.5+acceleration*.5*(time-.5),velocity=accelerating?acceleration*time:acceleration*.5,state=rig.update({position:[position,0,2],velocity:[velocity,0,0],heading:[-1,0,0],mode:"third",dt});
    if(previousAnchor!==null)maxCameraSpeed=Math.max(maxCameraSpeed,Math.abs(state.anchor[0]-previousAnchor)/dt);
    previousAnchor=state.anchor[0];maxSourceSpeed=Math.max(maxSourceSpeed,velocity);time+=dt;
  }
  assert.ok(maxCameraSpeed<=maxSourceSpeed+3,`third-person camera snapped after a long frame: camera=${maxCameraSpeed.toFixed(2)} source=${maxSourceSpeed.toFixed(2)}`);
}

// Velocity prediction must follow sustained real motion without unbounded lag.
for(const mode of ["follow","third"]){
  const rig=new StabilizedExternalCameraRig(),dt=1/120,velocity=[8,-3,.4];let maximumLag=0;
  for(let i=0;i<600;i++){
    const time=i*dt,position=velocity.map(value=>value*time),state=rig.update({position,velocity,heading:[-.94,.34,0],mode,dt});
    maximumLag=Math.max(maximumLag,Math.hypot(...position.map((value,axis)=>value-state.anchor[axis])));
  }
  assert.ok(maximumLag<=EXTERNAL_CAMERA_PROFILES[mode].maxLagM+1e-9,`${mode} camera exceeded its bounded lag: ${maximumLag}`);
}

// Discontinuous state changes reset atomically; no camera fly-in is allowed.
const resetRig=new StabilizedExternalCameraRig();
resetRig.update({position:[0,0,1],velocity:[0,0,0],heading:[-1,0,0],mode:"follow",dt:1/60});
let resetState=resetRig.update({position:[20,-7,5],velocity:[1,2,0],heading:[0,1,0],mode:"follow",dt:1/60});
assert.deepEqual([...resetState.anchor],[20,-7,5],"teleport did not reset the camera anchor");
resetState=resetRig.update({position:[20.1,-6.9,5],velocity:[1,2,0],heading:[0,1,0],mode:"third",dt:1/60});
assert.deepEqual([...resetState.anchor],[20.1,-6.9,5],"camera-mode switch did not reset the camera anchor");

// The camera rig is downstream of PhysicsModel. It must never enter motor,
// sensor, controller, or Box3D stepping code.
const simulator=readFileSync("sim/simulator.mjs","utf8"),physicsStart=simulator.indexOf("class PhysicsModel"),physicsEnd=simulator.indexOf("function integrateDuration",physicsStart),physicsSource=simulator.slice(physicsStart,physicsEnd);
assert.ok(physicsStart>=0&&physicsEnd>physicsStart,"PhysicsModel boundary missing");
for(const forbidden of ["StabilizedExternalCameraRig","externalCameraFrame","camera.position","camera.lookAt"])
  assert.ok(!physicsSource.includes(forbidden),`presentation camera leaked into authoritative physics: ${forbidden}`);

console.log("Camera stabilization passed: refresh-rate invariant, translation-stable, bounded, physics-isolated");
