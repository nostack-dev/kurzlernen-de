import assert from "node:assert/strict";
import {XBOX_STANDARD_BUTTON,XBOX_CONTROL_SCHEMES,findXboxGamepad,gamepadAxis,isXboxCompatibleGamepad,loadXboxControlScheme,saveXboxControlScheme,sampleXboxGamepad} from "../sim/xbox_gamepad.mjs";

const store=new Map();globalThis.localStorage={getItem:key=>store.has(key)?store.get(key):null,setItem:(key,value)=>store.set(key,String(value)),removeItem:key=>store.delete(key)};
const buttons=Array.from({length:17},()=>({pressed:false,value:0}));
const pad={id:"Xbox Wireless Controller (Vendor: 045e)",index:0,connected:true,mapping:"standard",axes:[.08,-.70,.55,-.40],buttons};
assert.equal(isXboxCompatibleGamepad(pad),true);
assert.equal(findXboxGamepad([null,pad]),pad);
assert.equal(gamepadAxis(.08),0);
assert.ok(gamepadAxis(-.70)<-.60);
assert.equal(loadXboxControlScheme(),XBOX_CONTROL_SCHEMES.CLASSIC,"classic flight must be the Xbox default");

buttons[XBOX_STANDARD_BUTTON.LEFT_TRIGGER]={pressed:true,value:.65};
buttons[XBOX_STANDARD_BUTTON.RIGHT_TRIGGER]={pressed:true,value:.20};
let sample=sampleXboxGamepad(pad);
assert.ok(sample.heightAxis<-.44,"LT must command height down while RT remains height up");
assert.equal(sample.fire,false,"RB is released, so fire must be off");

buttons[XBOX_STANDARD_BUTTON.RIGHT_SHOULDER]={pressed:true,value:1};
sample=sampleXboxGamepad(pad);
assert.equal(sample.aim,false);
assert.equal(sample.fire,true,"RB must fire independently in classic flight");
buttons[XBOX_STANDARD_BUTTON.LEFT_SHOULDER]={pressed:true,value:1};sample=sampleXboxGamepad(pad);assert.equal(sample.aim,false,"LB must not steal the right stick in classic flight");assert.equal(sample.fire,true);assert.ok(sample.right.x>.45&&sample.right.y<-.25,"classic flight must retain direct right-stick axes");

saveXboxControlScheme(XBOX_CONTROL_SCHEMES.AIM);sample=sampleXboxGamepad(pad);assert.equal(sample.aim,true,"AIM scheme must restore LB look/aim on demand");assert.equal(sample.fire,true);assert.equal(sample.scheme,XBOX_CONTROL_SCHEMES.AIM);
saveXboxControlScheme(XBOX_CONTROL_SCHEMES.CLASSIC);assert.equal(loadXboxControlScheme(),XBOX_CONTROL_SCHEMES.CLASSIC);

buttons[XBOX_STANDARD_BUTTON.RIGHT_TRIGGER]={pressed:true,value:1};
sample=sampleXboxGamepad(pad);
assert.ok(sample.heightAxis>.34,"RT must remain height up even while RB is the fire button");

// The on-foot controller owns the pad directly. Drone sampling must become neutral
// so walking/look/fire input cannot move or fire the hidden drone at the same time.
globalThis.__arondightOnFootMode=true;sample=sampleXboxGamepad(pad);assert.deepEqual(sample.left,{x:0,y:0});assert.deepEqual(sample.right,{x:0,y:0});assert.equal(sample.heightAxis,0);assert.equal(sample.fire,false);assert.equal(sample.aim,false);globalThis.__arondightOnFootMode=false;

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
console.log("Xbox mapping passed: classic direct RS default, optional LB aim, LT/RT altitude, independent RB fire, on-foot isolation and settings release latch.");
