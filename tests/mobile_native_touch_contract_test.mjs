import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {normalizedPointer} from "../sim/control_semantics.mjs";

const element={getBoundingClientRect(){return{left:100,top:50,width:200,height:200};}};
const right=normalizedPointer(element,{type:"pointerdown",pointerId:2,clientX:284,clientY:150});
assert.ok(right.x>.99&&Math.abs(right.y)<.01,"pointerdown must immediately use the touched position");
const upperLeft=normalizedPointer(element,{type:"pointermove",pointerId:2,clientX:140,clientY:90});
assert.ok(upperLeft.x<-.49&&upperLeft.y<-.49,"drag must follow absolute browser coordinates");

const sim=readFileSync("sim/simulator.mjs","utf8");
const semantics=readFileSync("sim/control_semantics.mjs","utf8");
const gate=readFileSync("sim/landscape_only_gate.mjs","utf8");
const layout=readFileSync("sim/solo_layout.mjs","utf8");
assert.ok(!sim.includes("transform:rotate(90deg)!important"),"simulator must never CSS-rotate its display");
assert.ok(!gate.includes("rotate(90deg)"),"landscape enforcement must never fake rotation with CSS");
assert.ok(gate.includes('LANDSCAPE_ONLY_POLICY="landscape-only-v1"'));
assert.ok(gate.includes('innerHeight>innerWidth'),"portrait must be detected from the native viewport");
assert.ok(gate.includes('orientationBlocked=next?"portrait":"none"'),"portrait must be explicitly blocked");
assert.ok(gate.includes('screen.orientation.lock("landscape")'),"supported browsers should best-effort lock landscape");
assert.ok(layout.includes('import "./landscape_only_gate.mjs";'),"landscape gate must load for menu and simulator");
assert.ok(!layout.includes("@media(orientation:portrait)"),"there must be no supported portrait flight layout");
assert.ok(!semantics.includes("cssLandscapeQuarterTurn"),"touch semantics must not contain rotated-coordinate remapping");
assert.ok(!semantics.includes("pointerDrags=new WeakMap"),"sticks must not use relative drag state");

const simulator=readFileSync("sim/simulator.mjs","utf8");
const walk=readFileSync("sim/player_walk_mode_v4.mjs","utf8");
const car=readFileSync("sim/player_car_mode.mjs","utf8");
assert.ok(simulator.includes('pointer=e.pointerId;apply(e);try{el.setPointerCapture?.(pointer);}catch{}'),"drone stick must apply before capture");
assert.ok(simulator.includes('soloHeightPointer=event.pointerId;applySoloHeightPointer(event);try{soloHeightPad.setPointerCapture?.(soloHeightPointer);}catch{}'),"height pad must apply before capture");
assert.ok(walk.includes('pointer=e.pointerId;apply(e);try{el.setPointerCapture?.(pointer);}catch{}'),"walk stick must apply before capture");
assert.ok(car.includes('try{el.setPointerCapture?.(pointer);}catch{}apply(e);'),"car capture failure must not block touch input");
console.log("Mobile contract passed: landscape-only UI, no CSS rotation, absolute touch and non-blocking pointer capture.");
