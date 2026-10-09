import assert from "node:assert/strict";
import {pathToFileURL} from "node:url";
import {resolve} from "node:path";
import {WorldRigidBodyPhysics} from "../sim/world_rigid_body_physics.mjs";
import {groundHeightAt} from "../sim/terrain_craters.mjs";
// Nothing may stay stuck under the map: a car (chassis + wheels) and a plain box pushed below the
// terrain are put back on top by the physics safety net within a few steps, keeping their
// horizontal motion; bodies resting normally on the ground are never touched.
const modulePath=process.argv[2];if(!modulePath)throw new Error("usage: node tests/ground_safety_net_box3d_test.mjs <box3d.inline.mjs>");
const b3=await (await import(pathToFileURL(resolve(modulePath)).href)).default();
const physics=new WorldRigidBodyPhysics(b3,{buildingSnapshot:{hash:"none",footprintCount:0,prisms:[]}});
assert.ok(physics.addBody({id:"car-a",kind:"car",position:[0,0,1],yaw:0,halfExtents:[1.8,.8,.4],massKg:1400}));
assert.ok(physics.addBody({id:"box-a",kind:"prop",position:[10,0,1],yaw:0,halfExtents:[.3,.3,.3],massKg:20,wheeled:false}));
for(let i=0;i<120;i++)physics.step(1/60);
const rests=physics.groundRescues||0;assert.equal(rests,0,"bodies resting on the ground must never be 'rescued'");
const g0=groundHeightAt(0,0),g1=groundHeightAt(10,0);
// push both well under the ground (as a lost tile / tunnelling would)
physics.setPose("car-a",{position:[0,0,g0-2.5],velocity:[6,0,-3]});physics.setPose("box-a",{position:[10,0,g1-2]});
for(let i=0;i<30;i++)physics.step(1/60);
const car=physics.pose("car-a"),box=physics.pose("box-a");
assert.ok(physics.groundRescues>=2,`safety net did not fire (${physics.groundRescues})`);
assert.ok(car.position[2]>g0,`car still under the ground: z ${car.position[2].toFixed(2)} vs ground ${g0.toFixed(2)}`);
assert.ok(box.position[2]>g1,`box still under the ground: z ${box.position[2].toFixed(2)}`);
for(const w of car.wheels||[])assert.ok(w.position[2]>groundHeightAt(w.position[0],w.position[1])-.2,"wheels must come back up with the chassis");
console.log(`ground safety net passed: ${physics.groundRescues} rescues, car z ${car.position[2].toFixed(2)}, box z ${box.position[2].toFixed(2)}`);
