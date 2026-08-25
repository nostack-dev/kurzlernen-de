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
physics.addBody({id:"car-slip",kind:"car",position:[0,-12,.42],yaw:0,halfExtents:[1.78,.82,.42],massKg:1420});
physics.setPose("car-slip",{position:[0,-12,.42],yaw:0,velocity:[8,5,0],angularVelocity:[0,0,0]});
physics.setTarget("car-slip",{position:[35,-12,.42],yaw:0,speedMps:9,response:3.8,maxAccelerationMps2:8});
for(let index=0;index<75;index++)physics.step(1/60,4,6000+index*1000/60);
const gripped=physics.pose("car-slip");
assert.ok(Math.abs(gripped.lateralSlipMps)<1.25,`vehicle retained unrealistic lateral slide instead of tire side-force: ${JSON.stringify(gripped)}`);
assert.ok(gripped.position[0]>6,`tire side-force killed longitudinal vehicle travel: ${JSON.stringify(gripped)}`);
physics.removeBody("car-slip");

physics.addBody({id:"car-steer",kind:"car",position:[0,-18,.42],yaw:0,halfExtents:[1.78,.82,.42],massKg:1420});
physics.setTarget("car-steer",{position:[20,-18,.42],yaw:0,speedMps:2,signedSpeedMps:2,steer:.72,maxSteerAngleRad:.56,response:4.4,maxAccelerationMps2:9});
for(let index=0;index<150;index++)physics.step(1/60,4,6500+index*1000/60);
const physicallySteered=physics.pose("car-steer");
assert.ok(physicallySteered.yaw<-.08,`right steering input did not rotate the Box3D vehicle clockwise at low speed: ${JSON.stringify(physicallySteered)}`);
assert.ok(Math.hypot(physicallySteered.position[0],physicallySteered.position[1]+18)>1.2,`low-speed steered car did not physically travel: ${JSON.stringify(physicallySteered)}`);
physics.removeBody("car-steer");

physics.addBody({id:"car-steer-stability",kind:"car",position:[0,-24,.42],yaw:0,halfExtents:[1.78,.82,.42],massKg:1420});
physics.setTarget("car-steer-stability",{position:[20,-24,.42],yaw:0,speedMps:2.2,signedSpeedMps:2.2,steer:.895,maxSteerAngleRad:.5585,response:4.4,maxAccelerationMps2:11.5});
for(let index=0;index<110;index++)physics.step(1/60,4,6600+index*1000/60);
const stableSteer=physics.pose("car-steer-stability");
assert.ok(stableSteer.yaw<-.06&&stableSteer.yaw>-2.2,`sustained right steer did not produce bounded clockwise chassis yaw: ${JSON.stringify(stableSteer)}`);
assert.ok((stableSteer.uprightError||0)<.10,`steering tipped the chassis instead of rotating it around Z: ${JSON.stringify(stableSteer)}`);
assert.ok(Math.abs(stableSteer.rotation[0])<.001&&Math.abs(stableSteer.rotation[1])<.001,`road vehicle escaped planar yaw constraint: ${JSON.stringify(stableSteer)}`);
assert.ok(Math.abs(stableSteer.angularVelocity[0])<1.2&&Math.abs(stableSteer.angularVelocity[1])<1.2,`vehicle accumulated unstable roll/pitch angular velocity: ${JSON.stringify(stableSteer)}`);
physics.removeBody("car-steer-stability");

physics.syncBuildings({hash:"vehicle-passage",footprintCount:2,prisms:[{buildingKey:"passage-north",base:0,top:4,points:[[-2,1.3],[18,1.3],[18,4],[-2,4]]},{buildingKey:"passage-south",base:0,top:4,points:[[-2,-4],[18,-4],[18,-1.3],[-2,-1.3]]}]});
physics.addBody({id:"car-passage",kind:"car",position:[0,0,.42],yaw:0,halfExtents:[1.78,.82,.42],massKg:1420});
physics.setTarget("car-passage",{position:[16,0,.42],yaw:0,speedMps:7,response:4,maxAccelerationMps2:8});
for(let index=0;index<180;index++)physics.step(1/60,4,6700+index*1000/60);
const passageCar=physics.pose("car-passage");
assert.ok(passageCar.position[0]>8,`car could not physically traverse a passable building corridor: ${JSON.stringify(passageCar)}`);
assert.ok(Math.abs(passageCar.position[1])<.7,`car was pushed out of the physical passage instead of traversing it: ${JSON.stringify(passageCar)}`);
physics.removeBody("car-passage");physics.syncBuildings({hash:"clear-after-passage",footprintCount:0,prisms:[]});

physics.addBody({id:"car-a",kind:"car",position:[-7,8,.42],yaw:0,halfExtents:[1.78,.82,.42],massKg:1420});
physics.addBody({id:"car-b",kind:"car",position:[7,8,.42],yaw:Math.PI,halfExtents:[1.78,.82,.42],massKg:1420});
physics.setTarget("car-a",{position:[12,8,.42],yaw:0,speedMps:8});physics.setTarget("car-b",{position:[-12,8,.42],yaw:Math.PI,speedMps:8});
for(let index=0;index<180;index++)physics.step(1/60,4,7000+index*1000/60);
const carA=physics.pose("car-a"),carB=physics.pose("car-b");
assert.ok(carA.position[0]>-5&&carB.position[0]<5,`force-driven vehicles never reached each other: ${JSON.stringify({carA,carB})}`);
assert.ok(carA.position[0]<carB.position[0],`dynamic vehicles passed through each other instead of resolving contact: ${JSON.stringify({carA,carB})}`);

physics.addBody({id:"police-drone-test",kind:"police-drone",position:[0,20,4],yaw:0,halfExtents:[.79,.79,.34],massKg:18,gravityScale:0});
assert.equal(physics.setPose("police-drone-test",{position:[0,20,4],yaw:.35,velocity:[0,0,0],angularVelocity:[0,0,0]}),true);const resetPose=physics.pose("police-drone-test");
assert.ok(Math.abs(resetPose.position[0])<.001&&Math.abs(resetPose.position[1]-20)<.001&&Math.abs(resetPose.position[2]-4)<.001&&Math.abs(resetPose.yaw-.35)<.001,`rigid-body pose reset was not applied by Box3D: ${JSON.stringify(resetPose)}`);
assert.equal(physics.setPose("police-drone-test",{position:[NaN,20,4]}),false);
assert.equal(physics.applyImpulse("police-drone-test",[18,0,0],{point:[0,20.4,4]}),true);
physics.step(1/60,4,21000);const kicked=physics.pose("police-drone-test");
assert.ok(kicked.velocity[0]>.65,`shot impulse did not change police-drone rigid-body velocity: ${JSON.stringify(kicked)}`);
assert.ok(Math.abs(kicked.angularVelocity[2])>.01,`off-center shot impulse did not create physical torque: ${JSON.stringify(kicked)}`);
assert.equal(physics.setGravityScale("police-drone-test",1.35),true);const airborneZ=kicked.position[2];
for(let index=0;index<30;index++)physics.step(1/60,4,21200+index*1000/60);
const falling=physics.pose("police-drone-test");assert.ok(falling.position[2]<airborneZ-.4&&falling.velocity[2]<-1,`runtime gravity scale did not make the disabled police drone fall: ${JSON.stringify({airborneZ,falling})}`);
assert.ok(physics.impactCount>=1&&impacts.some(event=>event.nativeContactEvent&&event.approachSpeedMps>1),`native Box3D contact-hit events produced no impact evidence: ${JSON.stringify(impacts.slice(-3))}`);

physics.destroy();
console.log("WORLD rigid-body Box3D passed: vehicles resolve physical contacts, ground support, tire grip, low-speed inverted rigid-body steering, passable-corridor traversal and impulse/gravity behavior; no dynamic camera body exists in this physics world.");
