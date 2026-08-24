import assert from "node:assert/strict";
import {pathToFileURL} from "node:url";
import {resolve} from "node:path";
import {WorldRigidBodyPhysics} from "../sim/world_rigid_body_physics.mjs";

const modulePath=process.argv[2];
if(!modulePath)throw new Error("usage: node tests/world_rigid_body_physics_box3d_test.mjs <box3d.inline.mjs>");
const imported=await import(pathToFileURL(resolve(modulePath)).href),factory=imported.default,b3=await factory();
const impacts=[],wall={hash:"traffic-wall",footprintCount:1,prisms:[{buildingKey:"wall",base:0,top:4,points:[[4,-3],[5,-3],[5,3],[4,3]]}]},physics=new WorldRigidBodyPhysics(b3,{buildingSnapshot:wall,onImpact:detail=>impacts.push(detail)});

physics.addBody({id:"car-wall",kind:"car",position:[0,0,.42],yaw:0,halfExtents:[1.78,.82,.42],massKg:1420});
physics.setTarget("car-wall",{position:[14,0,.42],yaw:0,speedMps:12,response:2.8,maxAccelerationMps2:5.2});
for(let index=0;index<360;index++)physics.step(1/60,4,index*1000/60);
const blocked=physics.pose("car-wall");
assert.ok(blocked.position[0]<2.35,`dynamic vehicle tunneled through static Box3D building: ${JSON.stringify(blocked)}`);
assert.ok(blocked.position.every(Number.isFinite));

physics.syncBuildings({hash:"clear",footprintCount:0,prisms:[]});physics.removeBody("car-wall");
physics.addBody({id:"car-a",kind:"car",position:[-7,8,.42],yaw:0,halfExtents:[1.78,.82,.42],massKg:1420});
physics.addBody({id:"car-b",kind:"car",position:[7,8,.42],yaw:Math.PI,halfExtents:[1.78,.82,.42],massKg:1420});
physics.setTarget("car-a",{position:[12,8,.42],yaw:0,speedMps:8});physics.setTarget("car-b",{position:[-12,8,.42],yaw:Math.PI,speedMps:8});
for(let index=0;index<180;index++)physics.step(1/60,4,7000+index*1000/60);
const carA=physics.pose("car-a"),carB=physics.pose("car-b");
assert.ok(carA.position[0]<carB.position[0],`dynamic vehicles passed through each other instead of resolving contact: ${JSON.stringify({carA,carB})}`);

physics.addBody({id:"police-drone-test",kind:"police-drone",position:[0,20,4],yaw:0,halfExtents:[.79,.79,.34],massKg:18,gravityScale:0});
assert.equal(physics.applyImpulse("police-drone-test",[18,0,0],{point:[0,20.4,4]}),true);
physics.step(1/60,4,11000);const kicked=physics.pose("police-drone-test");
assert.ok(kicked.velocity[0]>.65,`shot impulse did not change police-drone rigid-body velocity: ${JSON.stringify(kicked)}`);
assert.ok(Math.abs(kicked.angularVelocity[2])>.01,`off-center shot impulse did not create physical torque: ${JSON.stringify(kicked)}`);
assert.ok(physics.impactCount>=1&&impacts.length>=1,"contact solver produced no world impact evidence");

physics.destroy();
console.log("WORLD rigid-body Box3D passed: force-driven car stopped at a building, dynamic cars resolved contact, and a police drone accepted an off-center shot impulse.");
