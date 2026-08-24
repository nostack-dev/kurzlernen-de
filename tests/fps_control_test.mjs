import assert from "node:assert/strict";
import {FPS_CONTROL_PROFILE,FPS_HORIZONTAL_FOV_DEG,FPS_PITCH_LIMIT_RAD,FPS_WORLD_MAP_MAX_PITCH_DEG,FPS_WORLD_MAP_MIN_PITCH_DEG,addFpsShotImpulse,createFpsCameraMotionState,dampFpsLookVelocity,fpsAimAssist,fpsPitchRadToWorldMapPitchDeg,fpsStickVelocity,fpsTouchLookDelta,fpsVerticalFovDegForAspect,shapeFpsStick,stepFpsCameraMotion,wrapFpsAngleRad} from "../sim/fps_control_math.mjs";

const near=(actual,expected,tolerance=1e-6,message="")=>assert.ok(Math.abs(actual-expected)<=tolerance,`${message} expected ${expected}, got ${actual}`);

assert.deepEqual(shapeFpsStick(.04,-.03),{x:0,y:0,magnitude:0,rawMagnitude:.05});
const diagonal=shapeFpsStick(.55,.55);near(diagonal.x,diagonal.y,1e-12,"radial curve changed stick direction");assert.ok(diagonal.magnitude>.6&&diagonal.magnitude<.9);
let previous=0;for(let i=0;i<=100;i++){const shaped=shapeFpsStick(i/100,0);assert.ok(shaped.magnitude+1e-9>=previous,"dynamic response curve is not monotonic");previous=shaped.magnitude;}assert.equal(shapeFpsStick(1,0).magnitude,1);
const quarter=shapeFpsStick(FPS_CONTROL_PROFILE.innerDeadzone+(FPS_CONTROL_PROFILE.outerDeadzone-FPS_CONTROL_PROFILE.innerDeadzone)*.25,0);assert.ok(quarter.magnitude>.25,"dynamic reverse-S must respond above linear near the inner range");
const velocity=fpsStickVelocity(shapeFpsStick(1,-1));assert.ok(velocity.yaw>3.6&&velocity.pitch>3.2,"balanced X/Y controller rates missing");assert.ok(velocity.pitch/velocity.yaw>.84,"vertical aim remains disproportionately slow");
assert.ok(FPS_PITCH_LIMIT_RAD>1.55&&FPS_PITCH_LIMIT_RAD<Math.PI/2,"first-person pitch must reach a safe near-vertical limit");
assert.ok(FPS_WORLD_MAP_MAX_PITCH_DEG>179.5&&FPS_WORLD_MAP_MAX_PITCH_DEG<180&&FPS_WORLD_MAP_MIN_PITCH_DEG>0&&FPS_WORLD_MAP_MIN_PITCH_DEG<.5,"WORLD renderer must share the near-vertical FPS pitch contract");
near(fpsPitchRadToWorldMapPitchDeg(FPS_PITCH_LIMIT_RAD),90+FPS_PITCH_LIMIT_RAD*180/Math.PI,1e-10,"FPS/WORLD pitch conversion drifted");
assert.equal(FPS_HORIZONTAL_FOV_DEG,90);near(fpsVerticalFovDegForAspect(16/9),58.715507,1e-5,"FPS horizontal-to-vertical FOV conversion drifted");

const integrateVelocity=hz=>{let current=0,total=0;const dt=1/hz;for(let i=0;i<hz;i++){current=dampFpsLookVelocity(current,3,dt);total+=current*dt;}return total;};near(integrateVelocity(30),integrateVelocity(120),.035,"look acceleration depends on display rate");
assert.ok(dampFpsLookVelocity(3,0,1/60)<1.7,"stick release does not stop promptly");

const idleAssist=fpsAimAssist({yawError:.03,pitchError:.01,distanceM:20,stickMagnitude:0,inputYaw:0,inputPitch:0});assert.equal(idleAssist.active,false,"aim assist must never pull without right-stick input");
const outsideAssist=fpsAimAssist({yawError:.3,pitchError:0,distanceM:20,stickMagnitude:.8,inputYaw:2,inputPitch:0});assert.equal(outsideAssist.active,false);
const trackingAssist=fpsAimAssist({yawError:.035,pitchError:.012,distanceM:24,stickMagnitude:.7,inputYaw:2,inputPitch:.3}),awayAssist=fpsAimAssist({yawError:.035,pitchError:.012,distanceM:24,stickMagnitude:.7,inputYaw:-2,inputPitch:-.3});assert.ok(trackingAssist.active&&trackingAssist.slowdown<.85&&trackingAssist.correctionYaw>0&&trackingAssist.correctionPitch>0);assert.ok(trackingAssist.strength>awayAssist.strength*2,"tracking input must receive more help than input moving away");assert.ok(trackingAssist.correctionYaw<=FPS_CONTROL_PROFILE.assistMaxCorrectionRadS);
near(wrapFpsAngleRad(Math.PI*2+.2),.2,1e-12);
const touch=fpsTouchLookDelta(90,-45);assert.ok(touch.yaw>.35&&touch.pitch>.15&&touch.gain>1,"fast touch drag should turn quickly on both axes");

const bob=createFpsCameraMotionState();for(let i=0;i<120;i++)stepFpsCameraMotion(bob,{dt:1/60,speedMps:4.8});assert.ok(bob.bobWeight>.95&&Math.abs(bob.bobX)>.001&&Math.abs(bob.bobZ)>.001,"walking camera has no view bob");assert.ok(Math.abs(bob.bobX)<.02&&Math.abs(bob.bobZ)<.025&&Math.abs(bob.bobRoll)<.008,"view bob exceeds comfort bounds");for(let i=0;i<90;i++)stepFpsCameraMotion(bob,{dt:1/60,speedMps:0});assert.ok(bob.bobWeight<.0015,"view bob does not settle when stopped");
const recoil30=createFpsCameraMotionState(),recoil120=createFpsCameraMotionState();addFpsShotImpulse(recoil30);addFpsShotImpulse(recoil120);assert.ok(recoil30.recoilPitch>.01&&Math.abs(recoil30.recoilRoll)>.001&&recoil30.shakeEnergy>.5,"shot does not create a camera impulse");for(let i=0;i<15;i++)stepFpsCameraMotion(recoil30,{dt:1/30});for(let i=0;i<60;i++)stepFpsCameraMotion(recoil120,{dt:1/120});near(recoil30.recoilPitch,recoil120.recoilPitch,1e-10,"recoil decay depends on frame rate");near(recoil30.shakeEnergy,recoil120.shakeEnergy,1e-10,"shake decay depends on frame rate");assert.ok(recoil30.recoilPitch<.001&&recoil30.shakeEnergy<.001,"shot shake does not settle quickly");

console.log("FPS control contract passed: radial Dynamic stick curve, balanced vertical aim, input-bound assist friction, bounded view bob and frame-rate invariant recoil shake.");
