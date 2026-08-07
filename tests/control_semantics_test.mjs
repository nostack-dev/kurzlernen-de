import assert from "node:assert/strict";
import {neutralControls,armReady,applyStick,releaseStick,knobAxes,phoneAxis,inversePhoneAxis,PHONE_EXPO} from "../sim/control_semantics.mjs";

const near=(a,b,eps=1e-5,msg="")=>assert.ok(Math.abs(a-b)<=eps,`${msg} expected ${b}, got ${a}`);

let c=neutralControls();
assert.equal(armReady("DISARMED",c,true),true);
assert.equal(armReady("CALIBRATING",c,true),false);

// Expo is monotonic, much finer around center, and never removes end authority.
assert.equal(PHONE_EXPO,0.55);
near(phoneAxis(0),0);near(phoneAxis(1),1);near(phoneAxis(-1),-1);
assert.ok(phoneAxis(.5)<.35&&phoneAxis(.5)>.25,"50% gimbal must become a substantially finer command");
for(const value of [-1,-.75,-.5,-.2,0,.2,.5,.75,1])near(inversePhoneAxis(phoneAxis(value)),value,2e-6,"expo inverse");

applyStick(c,"left",{x:.4,y:.5});
near(c.yaw,phoneAxis(.4));assert.equal(c.throttle,.25);assert.equal(armReady("DISARMED",c,true),false);
let leftKnob=knobAxes(c,"left");near(leftKnob.x,.4,2e-6,"yaw knob must stay under finger");
releaseStick(c,"left");assert.equal(c.yaw,0);assert.equal(c.throttle,.25,"left-stick release must retain throttle exactly like paired controller");

c.throttle=0;
applyStick(c,"right",{x:-.3,y:.2});
near(c.roll,phoneAxis(.3));
near(c.pitch,phoneAxis(-.2));
const rightKnob=knobAxes(c,"right");
near(rightKnob.x,-.3,2e-6,"right-stick knob must remain under finger after roll sign conversion and expo");
near(rightKnob.y,.2,2e-6,"pitch knob must remain under finger after expo");
releaseStick(c,"right");assert.equal(c.roll,0);assert.equal(c.pitch,0);

// ARM gating follows physical gimbal displacement, not the expo-reduced value.
c=neutralControls();applyStick(c,"right",{x:.13,y:0});assert.equal(armReady("DISARMED",c,true),false,"13% physical roll displacement must still block arming");
releaseStick(c,"right");
const l=knobAxes(c,"left");assert.equal(l.x,0);assert.equal(l.y,1,"zero throttle knob must be at bottom");
assert.equal(armReady("DISARMED",c,true),true);assert.equal(armReady("DISARMED",c,false),false);

console.log("Shared phone controls passed: correct roll direction, 55% gimbal expo, full authority, exact knob tracking and physical ARM gates.");
