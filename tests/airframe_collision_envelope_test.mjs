import assert from "node:assert/strict";
import {PROPELLER_SWEEP_HALF_THICKNESS_M,PROPELLER_SWEEP_SEGMENTS,addPropellerSweepColliders,propellerSweepRadius,propellerSweepVertices} from "../sim/airframe_collision_envelope.mjs";

assert.equal(propellerSweepRadius(.14),.07);
const vertices=propellerSweepVertices([.10,-.05,0],.14);
assert.equal(vertices.length,PROPELLER_SWEEP_SEGMENTS*2*3);
const points=[];for(let i=0;i<vertices.length;i+=3)points.push(vertices.slice(i,i+3));
assert.ok(points.every(point=>point.every(Number.isFinite)));
assert.ok(points.every(point=>Math.abs(Math.hypot(point[0]-.10,point[1]+.05)-.07)<1e-10));
assert.equal(Math.min(...points.map(point=>point[2])),-PROPELLER_SWEEP_HALF_THICKNESS_M);
assert.equal(Math.max(...points.map(point=>point[2])),PROPELLER_SWEEP_HALF_THICKNESS_M);
assert.ok(Math.min(...points.map(point=>point[0]))<.031,"sweep must cover the full visual prop radius toward obstacles");
assert.ok(Math.max(...points.map(point=>point[0]))>.169,"sweep must cover the full visual prop radius away from obstacles");

const calls={hulls:0,shapes:0,destroys:0};
const fakeB3={
  b3CreateHull(values){calls.hulls++;assert.ok(values.length>=48);return{values};},
  b3CreateHullShape(body,shapeDef,hull){assert.equal(body.id,"airframe");assert.equal(shapeDef.id,"collision");assert.ok(hull.values.length);calls.shapes++;},
  b3DestroyHull(){calls.destroys++;},
};
const motors=[[-.08,-.08,0],[-.08,.08,0],[.08,.08,0],[.08,-.08,0]];
assert.equal(addPropellerSweepColliders(fakeB3,{id:"airframe"},{id:"collision"},motors,.14),4);
assert.deepEqual(calls,{hulls:4,shapes:4,destroys:4});
assert.throws(()=>propellerSweepRadius(0),/positive/);
assert.throws(()=>propellerSweepVertices([0,0],.14),/finite xyz/);
console.log("AIRFRAME collision envelope passed: four thin full-radius propeller sweep hulls cover visible rotor geometry.");
