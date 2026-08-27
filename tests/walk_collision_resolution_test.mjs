import assert from "node:assert/strict";
import {resolveWalkCollisionMove} from "../sim/walk_collision_resolution.mjs";

const wall=[{points:[[0,-4],[0,4],[1,4],[1,-4]]}];
const freeLeft=(x,y)=>Number(x)<-.0001&&Math.abs(Number(y))<10;
const stuckBase=from=>({x:Number(from.x)||0,y:Number(from.y)||0});

const free=resolveWalkCollisionMove({x:-.4,y:0},{x:-.6,y:.3},{canOccupy:freeLeft,baseResolve:stuckBase,prisms:wall});
assert(Math.abs(free.x+.6)<1e-9&&Math.abs(free.y-.3)<1e-9,"free movement must remain exact");

const slide=resolveWalkCollisionMove({x:-.10,y:0},{x:.10,y:.22},{canOccupy:freeLeft,baseResolve:stuckBase,prisms:wall});
assert(slide.x<0,"wall slide must stay outside the building");
assert(slide.y>.12,"diagonal input must preserve tangential progress instead of sticking");
assert.equal(slide.__walkCollisionSlide,true,"wall contact should report tangent slide");

const perpendicular=resolveWalkCollisionMove({x:-.10,y:0},{x:.10,y:0},{canOccupy:freeLeft,baseResolve:stuckBase,prisms:wall});
assert(Math.abs(perpendicular.y)<1e-9,"pressing straight into a wall must not invent sideways movement");
assert(perpendicular.x<0,"perpendicular wall contact must not enter the building");

let fallbackCalls=0;
const vehicleFallback=resolveWalkCollisionMove({x:0,y:0},{x:.1,y:.1},{canOccupy:(x,y)=>!(x>.05&&y>.05),baseResolve:()=>{fallbackCalls++;return{x:.04,y:0};},prisms:[]});
assert.equal(fallbackCalls,1,"non-building blockers should retain the base resolver");
assert.deepEqual(vehicleFallback,{x:.04,y:0});

console.log("WALK collision resolution passed: substeps preserve free motion, rotated/building wall contact slides tangentially, perpendicular contact does not auto-strafe, and non-building blockers fall back cleanly.");
