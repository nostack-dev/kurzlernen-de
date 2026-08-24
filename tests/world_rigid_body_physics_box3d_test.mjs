import assert from "node:assert/strict";
import {pathToFileURL} from "node:url";
import {resolve} from "node:path";
import {WorldRigidBodyPhysics} from "../sim/world_rigid_body_physics.mjs";

const modulePath=process.argv[2];
if(!modulePath)throw new Error("usage: node tests/world_rigid_body_physics_box3d_test.mjs <box3d.inline.mjs>");
const imported=await import(pathToFileURL(resolve(modulePath)).href),factory=imported.default,b3=await factory();
const impacts=[],wall={hash:"traffic-wall",footprintCount:1,prisms:[{buildingKey:"wall",base:0,top:4,points:[[4,-3],[5,-3],[5,3],[4,3]]}]},physics=new WorldRigidBodyPhysics(b3,{buildingSnapshot:wall,onImpact:detail=>impacts.push(detail)});

physics.addBody({id:"grounded-car",kind:"car",position:[-12,-8,.42],yaw:.2,halfExtents:[1.78,.82,.42],massKg:1420});
physics.addBody({id:"grounded-bus",kind:"bus",position:[12,-8,1.08],yaw:-.2,halfExtents:[4,1.17,1.08],massKg:9200});
for(let index=0;index<240;index++)physics.step(1/60,4,index*1000/60);
const groundedCar=physics.pose("grounded-car"),groundedBus=physics.pose("grounded-bus");
assert.ok(groundedCar.position[2]>=.35&&groundedCar.position[2]<.60,`car fell through the Box3D ground: ${JSON.stringify(groundedCar)}`);
assert.ok(groundedBus.position[2]>=.98&&groundedBus.position[2]<1.30,`bus fell through the Box3D ground: ${JSON.stringify(groundedBus)}`);
physics.removeBody("grounded-car");physics.removeBody("grounded-bus");

physics.addBody({id:"car-wall",kind:"car",position:[0,0,.42],yaw:0,halfExtents:[1.78,.82,.42],massKg:1420});
physics.setTarget("car-wall",{position:[14,0,.42],yaw:0,speedMps:12,response:2.8,maxAccelerationMps2:5.2});
for(let index=0;index<360;index++)physics.step(1/60,4,index*1000/60);
const blocked=physics.pose("car-wall");
assert.ok(blocked.position[0]>1.5,`force-driven vehicle never reached the building: ${JSON.stringify(blocked)}`);
assert.ok(blocked.position[0]<2.35,`dynamic vehicle tunneled through static Box3D building: ${JSON.stringify(blocked)}`);
assert.ok(blocked.position.every(Number.isFinite));

physics.syncBuildings({hash:"clear",footprintCount:0,prisms:[]});physics.removeBody("car-wall");
physics.addBody({id:"car-a",kind:"car",position:[-7,8,.42],yaw:0,halfExtents:[1.78,.82,.42],massKg:1420});
physics.addBody({id:"car-b",kind:"car",position:[7,8,.42],yaw:Math.PI,halfExtents:[1.78,.82,.42],massKg:1420});
physics.setTarget("car-a",{position:[12,8,.42],yaw:0,speedMps:8});physics.setTarget("car-b",{position:[-12,8,.42],yaw:Math.PI,speedMps:8});
for(let index=0;index<180;index++)physics.step(1/60,4,7000+index*1000/60);
const carA=physics.pose("car-a"),carB=physics.pose("car-b");
assert.ok(carA.position[0]>-5&&carB.position[0]<5,`force-driven vehicles never reached each other: ${JSON.stringify({carA,carB})}`);
assert.ok(carA.position[0]<carB.position[0],`dynamic vehicles passed through each other instead of resolving contact: ${JSON.stringify({carA,carB})}`);

physics.addBody({id:"police-drone-test",kind:"police-drone",position:[0,20,4],yaw:0,halfExtents:[.79,.79,.34],massKg:18,gravityScale:0});
assert.equal(physics.applyImpulse("police-drone-test",[18,0,0],{point:[0,20.4,4]}),true);
physics.step(1/60,4,11000);const kicked=physics.pose("police-drone-test");
assert.ok(kicked.velocity[0]>.65,`shot impulse did not change police-drone rigid-body velocity: ${JSON.stringify(kicked)}`);
assert.ok(Math.abs(kicked.angularVelocity[2])>.01,`off-center shot impulse did not create physical torque: ${JSON.stringify(kicked)}`);
assert.equal(physics.setGravityScale("police-drone-test",1.35),true);const airborneZ=kicked.position[2];
for(let index=0;index<30;index++)physics.step(1/60,4,11200+index*1000/60);
const falling=physics.pose("police-drone-test");assert.ok(falling.position[2]<airborneZ-.4&&falling.velocity[2]<-1,`runtime gravity scale did not make the disabled police drone fall: ${JSON.stringify({airborneZ,falling})}`);
assert.ok(physics.impactCount>=1&&impacts.some(event=>event.nativeContactEvent&&event.approachSpeedMps>1),`native Box3D contact-hit events produced no impact evidence: ${JSON.stringify(impacts.slice(-3))}`);

physics.destroy();
console.log("WORLD rigid-body Box3D passed: cars and buses stayed on the static ground, vehicles resolved contacts, and EMP gravity made a police drone fall.");
