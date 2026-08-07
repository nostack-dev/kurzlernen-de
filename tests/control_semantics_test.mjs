import assert from "node:assert/strict";
import {DEFAULT_PHONE_SETTINGS,MIN_PHONE_GAIN,neutralControls,armReady,applyStick,releaseStick,knobAxes,phoneAxis,inversePhoneAxis} from "../sim/control_semantics.mjs";
import {sensitivityToLevel,levelToSensitivity} from "../sim/control_settings.mjs";

const near=(a,b,eps=1e-5,msg="")=>assert.ok(Math.abs(a-b)<=eps,`${msg} expected ${b}, got ${a}`);
// Mirrors only the public FC expo equation for a human-factor regression. The
// architecture guard separately verifies that production uses deadband=0.
const fcShapeNoDeadband=(x,expo=.3)=>Math.sign(x)*(Math.abs(x)*(1-expo)+Math.abs(x)**3*expo);
const rollAngleDeg=rawRc=>fcShapeNoDeadband(rawRc)*32;

assert.equal(sensitivityToLevel(DEFAULT_PHONE_SETTINGS.leftSensitivity),9);
assert.equal(sensitivityToLevel(DEFAULT_PHONE_SETTINGS.rightSensitivity),10);
near(levelToSensitivity(1),1,1e-12,"1/10 must be full RC throw");
near(levelToSensitivity(10),MIN_PHONE_GAIN,1e-12,"10/10 must be minimum RC throw");
near(MIN_PHONE_GAIN,.25,1e-12,"maximum fine must be 25% RC throw");
let c=neutralControls();
assert.equal(armReady("DISARMED",c,true,DEFAULT_PHONE_SETTINGS),true);
assert.equal(armReady("CALIBRATING",c,true,DEFAULT_PHONE_SETTINGS),false);

// Phone mapping is deliberately linear: no second expo and no phone deadband.
for(const level of [1,3,5,7,9,10]){
  const gain=levelToSensitivity(level);
  near(phoneAxis(0,gain),0);near(phoneAxis(1,gain),gain);near(phoneAxis(-1,gain),-gain);
  for(const value of [-1,-.75,-.5,-.2,0,.2,.5,.75,1])near(inversePhoneAxis(phoneAxis(value,gain),gain),value,2e-6,"stick throw inverse");
}
assert.ok(phoneAxis(.5,levelToSensitivity(10))<phoneAxis(.5,levelToSensitivity(9)),"higher fineness must be less sensitive");
assert.equal(phoneAxis(.5,levelToSensitivity(1)),.5,"1/10 must be direct");

// Human-factor regression for the actual small landscape layout: at <=430 CSS
// px height the stick is 180 px wide; normalizedPointer uses a 42% radius =
// 75.6 px. At 10/10, the whole finger travel maps to only 25% RC throw.
const radiusPx=180*.42,gain10=levelToSensitivity(10),angleForPx=px=>rollAngleDeg(Math.min(1,px/radiusPx)*gain10);
const humanSamples=[
  [2,0.148],[5,0.370],[10,0.741],[20,1.484],[40,2.985],[75.6,5.750],
];
for(const [px,expected] of humanSamples)near(angleForPx(px),expected,.025,`${px}px human roll response`);
assert.ok(angleForPx(2)>0,"touch response must have no dead zone");
assert.ok(angleForPx(10)<1,"10px finger correction must stay below one degree at max fine");
assert.ok(angleForPx(40)<3.1,"40px correction must remain controllable at max fine");
assert.ok(angleForPx(radiusPx)<6,"full max-fine stick must stay below six degrees desired roll/pitch");

applyStick(c,"left",{x:.4,y:.5},DEFAULT_PHONE_SETTINGS);
near(c.yaw,phoneAxis(.4,DEFAULT_PHONE_SETTINGS.leftSensitivity));assert.equal(c.throttle,.25);assert.equal(armReady("DISARMED",c,true,DEFAULT_PHONE_SETTINGS),false);
let leftKnob=knobAxes(c,"left",DEFAULT_PHONE_SETTINGS);near(leftKnob.x,.4,2e-6,"yaw knob must stay under finger");
releaseStick(c,"left");assert.equal(c.yaw,0);assert.equal(c.throttle,.25,"left-stick release must retain throttle exactly like paired controller");

c.throttle=0;
applyStick(c,"right",{x:-.3,y:.2},DEFAULT_PHONE_SETTINGS);
near(c.roll,phoneAxis(.3,DEFAULT_PHONE_SETTINGS.rightSensitivity));
near(c.pitch,phoneAxis(-.2,DEFAULT_PHONE_SETTINGS.rightSensitivity));
const rightKnob=knobAxes(c,"right",DEFAULT_PHONE_SETTINGS);
near(rightKnob.x,-.3,2e-6,"right-stick knob must remain under finger after roll sign conversion");
near(rightKnob.y,.2,2e-6,"pitch knob must remain under finger");
releaseStick(c,"right");assert.equal(c.roll,0);assert.equal(c.pitch,0);

// ARM gating follows physical gimbal displacement, not reduced RC throw.
c=neutralControls();applyStick(c,"right",{x:.13,y:0},DEFAULT_PHONE_SETTINGS);assert.equal(armReady("DISARMED",c,true,DEFAULT_PHONE_SETTINGS),false,"13% physical roll displacement must still block arming");
releaseStick(c,"right");
const l=knobAxes(c,"left",DEFAULT_PHONE_SETTINGS);assert.equal(l.x,0);assert.equal(l.y,1,"zero throttle knob must be at bottom");
assert.equal(armReady("DISARMED",c,true,DEFAULT_PHONE_SETTINGS),true);assert.equal(armReady("DISARMED",c,false,DEFAULT_PHONE_SETTINGS),false);

console.log("Human phone-control regression passed: no touch dead zone; 10/10 = 25% linear RC throw; 10px ≈ 0.74deg and full stick ≈ 5.75deg desired roll/pitch; exact knob tracking and physical ARM gates preserved.");
