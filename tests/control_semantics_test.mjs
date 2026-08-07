import assert from "node:assert/strict";
import {DEFAULT_PHONE_SETTINGS,MIN_PHONE_SENSITIVITY,neutralControls,armReady,applyStick,releaseStick,knobAxes,phoneAxis,inversePhoneAxis} from "../sim/control_semantics.mjs";
import {sensitivityToLevel,levelToSensitivity} from "../sim/control_settings.mjs";

const near=(a,b,eps=1e-5,msg="")=>assert.ok(Math.abs(a-b)<=eps,`${msg} expected ${b}, got ${a}`);

assert.equal(sensitivityToLevel(DEFAULT_PHONE_SETTINGS.leftSensitivity),7);
assert.equal(sensitivityToLevel(DEFAULT_PHONE_SETTINGS.rightSensitivity),9);
near(levelToSensitivity(1),1,1e-12,"1/10 must be direct");
near(levelToSensitivity(10),MIN_PHONE_SENSITIVITY,1e-12,"10/10 must be maximum fine");
assert.ok(levelToSensitivity(10)<.1,"maximum fine must extend below the old minimum sensitivity");
let c=neutralControls();
assert.equal(armReady("DISARMED",c,true,DEFAULT_PHONE_SETTINGS),true);
assert.equal(armReady("CALIBRATING",c,true,DEFAULT_PHONE_SETTINGS),false);

// Phone shaping changes only gimbal feel. End authority stays exact at every level.
for(const level of [1,3,5,7,9,10]){
  const sensitivity=levelToSensitivity(level);
  near(phoneAxis(0,sensitivity),0);near(phoneAxis(1,sensitivity),1);near(phoneAxis(-1,sensitivity),-1);
  for(const value of [-1,-.75,-.5,-.2,0,.2,.5,.75,1])near(inversePhoneAxis(phoneAxis(value,sensitivity),sensitivity),value,3e-6,"sensitivity inverse");
}
assert.ok(phoneAxis(.5,levelToSensitivity(10))<.05,"10/10 must make half-stick a very fine centre command");
assert.ok(phoneAxis(.5,levelToSensitivity(10))<phoneAxis(.5,levelToSensitivity(9)),"higher fineness level must be less sensitive");
assert.equal(phoneAxis(.5,levelToSensitivity(1)),.5,"1/10 must be linear/direct");

applyStick(c,"left",{x:.4,y:.5},DEFAULT_PHONE_SETTINGS);
near(c.yaw,phoneAxis(.4,DEFAULT_PHONE_SETTINGS.leftSensitivity));assert.equal(c.throttle,.25);assert.equal(armReady("DISARMED",c,true,DEFAULT_PHONE_SETTINGS),false);
let leftKnob=knobAxes(c,"left",DEFAULT_PHONE_SETTINGS);near(leftKnob.x,.4,3e-6,"yaw knob must stay under finger");
releaseStick(c,"left");assert.equal(c.yaw,0);assert.equal(c.throttle,.25,"left-stick release must retain throttle exactly like paired controller");

c.throttle=0;
applyStick(c,"right",{x:-.3,y:.2},DEFAULT_PHONE_SETTINGS);
near(c.roll,phoneAxis(.3,DEFAULT_PHONE_SETTINGS.rightSensitivity));
near(c.pitch,phoneAxis(-.2,DEFAULT_PHONE_SETTINGS.rightSensitivity));
const rightKnob=knobAxes(c,"right",DEFAULT_PHONE_SETTINGS);
near(rightKnob.x,-.3,3e-6,"right-stick knob must remain under finger after roll sign conversion and shaping");
near(rightKnob.y,.2,3e-6,"pitch knob must remain under finger after shaping");
releaseStick(c,"right");assert.equal(c.roll,0);assert.equal(c.pitch,0);

// ARM gating follows physical gimbal displacement, not the shaped command.
c=neutralControls();applyStick(c,"right",{x:.13,y:0},DEFAULT_PHONE_SETTINGS);assert.equal(armReady("DISARMED",c,true,DEFAULT_PHONE_SETTINGS),false,"13% physical roll displacement must still block arming");
releaseStick(c,"right");
const l=knobAxes(c,"left",DEFAULT_PHONE_SETTINGS);assert.equal(l.x,0);assert.equal(l.y,1,"zero throttle knob must be at bottom");
assert.equal(armReady("DISARMED",c,true,DEFAULT_PHONE_SETTINGS),true);assert.equal(armReady("DISARMED",c,false,DEFAULT_PHONE_SETTINGS),false);

console.log("Shared phone controls passed: 1=direct, 10=max fine, extended 2% centre gain, independent LEFT/RIGHT feel, correct roll direction, full authority and physical ARM gates.");
