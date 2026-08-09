// This shared semantics + workflow-hygiene test is part of both final Pages and ESP32-S31 validation.
import assert from "node:assert/strict";
import {readdirSync} from "node:fs";
import {
  DEFAULT_PHONE_SETTINGS,MAX_PHONE_EXPO,MIN_GAME_CLEARANCE_M,MAX_GAME_CLEARANCE_M,neutralControls,copyControls,armReady,applyStick,releaseStick,
  knobAxes,phoneAxis,inversePhoneAxis,finenessToExpo,normalizedPointer,endPointerDrag,applyGameStick,gameKnobAxes
} from "../sim/control_semantics.mjs";

assert.deepEqual(
  readdirSync(".github/workflows").sort(),
  ["deploy.yml","s31-hil.yml"],
  "production tree must contain only deploy.yml and s31-hil.yml",
);

const near=(a,b,eps=1e-6,msg="")=>assert.ok(Math.abs(a-b)<=eps,`${msg} expected ${b}, got ${a}`);

assert.equal(DEFAULT_PHONE_SETTINGS.leftFineness,10);
assert.equal(DEFAULT_PHONE_SETTINGS.rightFineness,10);
assert.equal(DEFAULT_PHONE_SETTINGS.lockLeftHorizontal,false);
assert.equal(DEFAULT_PHONE_SETTINGS.lockRightHorizontal,false);
assert.equal(DEFAULT_PHONE_SETTINGS.invertLeftHorizontal,false);
assert.equal(DEFAULT_PHONE_SETTINGS.invertRightHorizontal,false);
assert.equal(DEFAULT_PHONE_SETTINGS.invertRightVertical,true);
assert.equal(DEFAULT_PHONE_SETTINGS.defaultHoverAgl,1.2);
assert.equal(MIN_GAME_CLEARANCE_M,.5);assert.equal(MAX_GAME_CLEARANCE_M,50);
assert.equal(copyControls({groundClearance:999}).groundClearance,50);assert.equal(copyControls({groundClearance:-5}).groundClearance,.5);
near(finenessToExpo(1),0,1e-12,"1/10 must be direct");
near(finenessToExpo(10),MAX_PHONE_EXPO,1e-12,"10/10 must be max expo");
near(MAX_PHONE_EXPO,.70,1e-12,"max phone expo");

for(const level of [1,3,5,7,9,10]){
  near(phoneAxis(0,level),0);near(phoneAxis(1,level),1);near(phoneAxis(-1,level),-1);
  for(const value of [-1,-.75,-.5,-.2,0,.2,.5,.75,1])
    near(inversePhoneAxis(phoneAxis(value,level),level),value,3e-6,"expo inverse");
}
assert.equal(phoneAxis(.5,1),.5);
assert.ok(phoneAxis(.5,10)<phoneAxis(.5,9));
assert.ok(phoneAxis(.5,10)>.2,"max fineness must soften centre without killing authority");
const e2eYawPhoneCommand=phoneAxis(.65,DEFAULT_PHONE_SETTINGS.rightFineness);
assert.ok(e2eYawPhoneCommand>.38,"0.65 yaw E2E stimulus must retain enough authority for the strict physical rotation gate");

let c=neutralControls();
assert.equal(c.bodyPitch,0);
assert.equal(armReady("DISARMED",c,true,DEFAULT_PHONE_SETTINGS),true);
assert.equal(armReady("CALIBRATING",c,true,DEFAULT_PHONE_SETTINGS),false);
assert.equal(armReady("DISARMED",c,false,DEFAULT_PHONE_SETTINGS),false);

applyStick(c,"left",{x:.4,y:.5},DEFAULT_PHONE_SETTINGS);
near(c.yaw,phoneAxis(.4,DEFAULT_PHONE_SETTINGS.leftFineness));near(c.throttle,.25);
assert.equal(armReady("DISARMED",c,true,DEFAULT_PHONE_SETTINGS),true);
let leftKnob=knobAxes(c,"left",DEFAULT_PHONE_SETTINGS);near(leftKnob.x,.4,3e-6);near(leftKnob.y,.5,3e-6);
releaseStick(c,"left");assert.equal(c.yaw,0);near(c.throttle,.25,1e-6,"left release retains throttle");

c=neutralControls();
const lockedLeft={...DEFAULT_PHONE_SETTINGS,lockLeftHorizontal:true};
applyStick(c,"left",{x:.9,y:-.5},lockedLeft);
assert.equal(c.yaw,0);near(c.throttle,.75,1e-6,"left lock must preserve vertical throttle authority");
leftKnob=knobAxes(c,"left",lockedLeft);assert.equal(leftKnob.x,0);near(leftKnob.y,-.5,3e-6);
releaseStick(c,"left");assert.equal(c.yaw,0);near(c.throttle,.75,1e-6,"left lock release retains throttle");

c.throttle=0;
applyStick(c,"right",{x:-.3,y:.2},DEFAULT_PHONE_SETTINGS);
near(c.roll,phoneAxis(.3,DEFAULT_PHONE_SETTINGS.rightFineness));
near(c.pitch,phoneAxis(.2,DEFAULT_PHONE_SETTINGS.rightFineness));
assert.notEqual(c.roll,0);assert.notEqual(c.pitch,0);
let rightKnob=knobAxes(c,"right",DEFAULT_PHONE_SETTINGS);near(rightKnob.x,-.3,3e-6);near(rightKnob.y,.2,3e-6);
releaseStick(c,"right");assert.equal(c.roll,0);assert.equal(c.pitch,0);

const invertX={...DEFAULT_PHONE_SETTINGS,invertRightHorizontal:true};
c=neutralControls();applyStick(c,"right",{x:-.3,y:.2},invertX);
near(c.roll,phoneAxis(-.3,invertX.rightFineness));near(c.pitch,phoneAxis(.2,invertX.rightFineness));
rightKnob=knobAxes(c,"right",invertX);near(rightKnob.x,-.3,3e-6);near(rightKnob.y,.2,3e-6);

const invertY={...DEFAULT_PHONE_SETTINGS,invertRightVertical:true};
c=neutralControls();applyStick(c,"right",{x:-.3,y:.2},invertY);
near(c.roll,phoneAxis(.3,invertY.rightFineness));near(c.pitch,phoneAxis(.2,invertY.rightFineness));
rightKnob=knobAxes(c,"right",invertY);near(rightKnob.x,-.3,3e-6);near(rightKnob.y,.2,3e-6);

const invertBoth={...DEFAULT_PHONE_SETTINGS,invertRightHorizontal:true,invertRightVertical:true};
c=neutralControls();applyStick(c,"right",{x:.45,y:-.35},invertBoth);
near(c.roll,phoneAxis(.45,invertBoth.rightFineness));near(c.pitch,phoneAxis(-.35,invertBoth.rightFineness));
rightKnob=knobAxes(c,"right",invertBoth);near(rightKnob.x,.45,3e-6);near(rightKnob.y,-.35,3e-6);
releaseStick(c,"right");

const lockedRight={...DEFAULT_PHONE_SETTINGS,lockRightHorizontal:true};
applyStick(c,"right",{x:-.6,y:.8},lockedRight);
near(c.roll,phoneAxis(.6,lockedRight.rightFineness));assert.equal(c.pitch,0);
rightKnob=knobAxes(c,"right",lockedRight);near(rightKnob.x,-.6,3e-6);near(rightKnob.y,0,1e-12);
releaseStick(c,"right");

let game=neutralControls();
applyGameStick(game,"left",{x:-.60,y:0},DEFAULT_PHONE_SETTINGS);
assert.ok(game.roll<0,"LEFT stick motion must produce physical LEFT strafe");
let gameKnob=gameKnobAxes(game,"left",DEFAULT_PHONE_SETTINGS);
near(gameKnob.x,-.60,3e-6,"LEFT strafe knob must stay under the left pointer");
game=neutralControls();
applyGameStick(game,"left",{x:.60,y:0},DEFAULT_PHONE_SETTINGS);
assert.ok(game.roll>0,"RIGHT stick motion must produce physical RIGHT strafe");
gameKnob=gameKnobAxes(game,"left",DEFAULT_PHONE_SETTINGS);
near(gameKnob.x,.60,3e-6,"RIGHT strafe knob must stay under the right pointer");
const gameInvertLeft={...DEFAULT_PHONE_SETTINGS,invertLeftHorizontal:true};
game=neutralControls();applyGameStick(game,"left",{x:-.60,y:0},gameInvertLeft);
assert.ok(game.roll>0,"inverted LEFT motion must produce physical RIGHT strafe");
game=neutralControls();applyGameStick(game,"left",{x:.60,y:0},gameInvertLeft);
assert.ok(game.roll<0,"inverted RIGHT motion must produce physical LEFT strafe");

const knob={style:{left:"50%",top:"71%"}};
const element={
  querySelector:()=>knob,
  getBoundingClientRect:()=>({left:0,top:0,width:180,height:180}),
};
const down=normalizedPointer(element,{type:"pointerdown",pointerId:1,clientX:90,clientY:90});
near(down.x,0);near(down.y,.5);
const move=normalizedPointer(element,{type:"pointermove",pointerId:1,clientX:90,clientY:52.2});
near(move.x,0);near(move.y,0,1e-6,"relative drag should move by half radius, not jump absolute");
endPointerDrag(element,1);

const tenPxRaw=phoneAxis(10/(180*.42),10);
assert.ok(tenPxRaw>.035,"10 px max-fine movement must cross production roll/pitch deadband");
near(phoneAxis(1,10),1,1e-12,"right full stick authority");
near(phoneAxis(-1,10),-1,1e-12,"left full stick authority");

c=neutralControls();applyStick(c,"right",{x:.8,y:.8},DEFAULT_PHONE_SETTINGS);
assert.equal(armReady("DISARMED",c,true,DEFAULT_PHONE_SETTINGS),true,"UI must not duplicate the FC stick arming gate");
releaseStick(c,"right");
const l=knobAxes(c,"left",DEFAULT_PHONE_SETTINGS);assert.equal(l.x,0);assert.equal(l.y,1);

console.log("Phone controls passed: requested 10/10 production defaults, optional cubic fineness, full authority, semantic inversion, axis locks, relative throttle re-touch, and FC-authoritative arming.");

import {clearanceRateMps,stepGroundClearanceTarget,MAX_GAME_CLEARANCE_RATE_MPS} from "../sim/control_semantics.mjs";
if(clearanceRateMps(0)!==0||clearanceRateMps(.05)!==0)throw new Error("height HOLD/deadband failed");
if(Math.abs(clearanceRateMps(1)-MAX_GAME_CLEARANCE_RATE_MPS)>1e-9||Math.abs(clearanceRateMps(-1)+MAX_GAME_CLEARANCE_RATE_MPS)>1e-9)throw new Error("height full-rate authority failed");
if(Math.abs(stepGroundClearanceTarget(1.2,1,.05)-1.45)>.011)throw new Error("height target slew failed");
if(stepGroundClearanceTarget(49.9,1,1)>50||stepGroundClearanceTarget(.6,-1,1)<.5)throw new Error("height target envelope failed");
