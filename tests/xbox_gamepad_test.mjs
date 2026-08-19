import assert from "node:assert/strict";
import {XBOX_STANDARD_BUTTON,findXboxGamepad,gamepadAxis,isXboxCompatibleGamepad,sampleXboxGamepad} from "../sim/xbox_gamepad.mjs";

const buttons=Array.from({length:17},()=>({pressed:false,value:0}));
const pad={id:"Xbox Wireless Controller (Vendor: 045e)",index:0,connected:true,mapping:"standard",axes:[.08,-.70,.55,-.40],buttons};
assert.equal(isXboxCompatibleGamepad(pad),true);
assert.equal(findXboxGamepad([null,pad]),pad);
assert.equal(gamepadAxis(.08),0);
assert.ok(gamepadAxis(-.70)<-.60);

buttons[XBOX_STANDARD_BUTTON.LEFT_TRIGGER]={pressed:true,value:.65};
buttons[XBOX_STANDARD_BUTTON.RIGHT_TRIGGER]={pressed:true,value:.20};
let sample=sampleXboxGamepad(pad);
assert.ok(sample.heightAxis<-.44,"LT must command height down while RT remains height up");
assert.equal(sample.fire,false,"RB must never fire without the LB aim modifier");

buttons[XBOX_STANDARD_BUTTON.LEFT_SHOULDER]={pressed:true,value:1};
buttons[XBOX_STANDARD_BUTTON.RIGHT_SHOULDER]={pressed:true,value:1};
sample=sampleXboxGamepad(pad);
assert.equal(sample.aim,true);
assert.equal(sample.fire,true,"LB + RB must fire");
assert.ok(sample.right.x>.45&&sample.right.y<-.25,"LB aim must retain right-stick free-look axes");

buttons[XBOX_STANDARD_BUTTON.RIGHT_TRIGGER]={pressed:true,value:1};
sample=sampleXboxGamepad(pad);
assert.ok(sample.heightAxis>.34,"RT must remain height up even while RB is the fire button");

// The settings dialog owns the controller while open. Flight sampling must become
// completely neutral, then remain latched neutral after close until every control
// has physically returned to rest so B/A cannot leak into KILL/ARM on the next frame.
globalThis.__arondightSettingsModalOpen=true;
sample=sampleXboxGamepad(pad);
assert.deepEqual(sample.left,{x:0,y:0});assert.deepEqual(sample.right,{x:0,y:0});assert.equal(sample.heightAxis,0);assert.equal(sample.arm,false);assert.equal(sample.kill,false);assert.equal(sample.aim,false);assert.equal(sample.fire,false);
globalThis.__arondightSettingsModalOpen=false;globalThis.__arondightSettingsGamepadBlockUntilRelease=true;
sample=sampleXboxGamepad(pad);assert.equal(sample.kill,false);assert.equal(globalThis.__arondightSettingsGamepadBlockUntilRelease,true,"held controller input must keep the post-menu safety latch active");
pad.axes=[0,0,0,0];for(let index=0;index<buttons.length;index++)buttons[index]={pressed:false,value:0};sample=sampleXboxGamepad(pad);assert.equal(globalThis.__arondightSettingsGamepadBlockUntilRelease,false,"neutral pad must release the post-menu safety latch");assert.equal(sample.heightAxis,0);

pad.connected=false;
assert.equal(sampleXboxGamepad(pad),null);
console.log("Xbox mapping passed: touch handoff, LT/RT altitude, LB free-look/fire, and settings-modal flight suppression with release latch.");
