import assert from "node:assert/strict";
import {pathToFileURL} from "node:url";
import {resolve} from "node:path";
import {WorldRigidBodyPhysics} from "../sim/world_rigid_body_physics.mjs";
import {VEHICLE_SPECS,driveWheeled} from "../sim/world_vehicle_dynamics.mjs";

// Real Box3D vehicles: chassis + 4 wheel joints (suspension, spin motor,
// steering). Drives the car with pedal/steer/handbrake and checks the
// physical outcome (acceleration, top speed, braking, turning, stability)
// and an AI car following its target.
const modulePath=process.argv[2];
if(!modulePath)throw new Error("usage: node tests/world_vehicle_dynamics_box3d_test.mjs <box3d.inline.mjs>");
const b3=await (await import(pathToFileURL(resolve(modulePath)).href)).default();
assert.ok(VEHICLE_SPECS.car.comZ<0&&VEHICLE_SPECS.bus.comZ<0,"vehicle stability must come from a physical low centre of mass");
const drivetrainSource=driveWheeled.toString();for(const forbidden of["b3Body_SetTransform","b3Body_SetLinearVelocity","b3Body_SetAngularVelocity","b3Body_ApplyTorque","flippedFor"])assert.ok(!drivetrainSource.includes(forbidden),`physical drivetrain must not use pose/velocity/upright cheats: ${forbidden}`);
const physics=new WorldRigidBodyPhysics(b3,{buildingSnapshot:{hash:"none",footprintCount:0,prisms:[]}});
const step=(n,t0=0)=>{for(let i=0;i<n;i++)physics.step(1/60,4,t0+i*1000/60);};
const speedOf=id=>{const p=physics.pose(id);return Math.hypot(p.velocity[0],p.velocity[1]);};
const upOf=id=>{const[x,y]=physics.pose(id).rotation;return 1-2*(x*x+y*y);};
physics.addBody({id:"car",kind:"car",position:[0,0,.5],yaw:0});
step(90);
let p=physics.pose("car");
assert.ok(p.wheels?.length===4,"car must have four physical wheels");
assert.ok(p.position[2]>.4&&p.position[2]<.7,`car rests on its suspension: ${p.position[2]}`);
physics.setDrive("car",{pedal:1,steer:0,maxSpeed:36});step(240);
const v3=speedOf("car");p=physics.pose("car");
console.log("after 4 s full throttle",v3.toFixed(1),"m/s, x",p.position[0].toFixed(1),"up",upOf("car").toFixed(3));
assert.ok(v3>12,`motor torque must accelerate the car: ${v3}`);
assert.ok(p.position[0]>15,"car drives forward (+x)");
assert.ok(Math.abs(p.position[1])<3,`straight line: ${p.position[1]}`);
physics.setDrive("car",{pedal:1,steer:1,maxSpeed:36});step(120);
const yaw1=physics.pose("car").yaw;console.log("yaw after left steer",yaw1.toFixed(2),"up",upOf("car").toFixed(3));
assert.ok(yaw1>.5,`steering left turns the car left: ${yaw1}`);
assert.ok(upOf("car")>.72,"car remains dynamically stable in the turn without an upright constraint");
physics.setDrive("car",{pedal:-1,steer:0});let vb=Infinity;const v0=speedOf("car");for(let i=0;i<150;i++){physics.step(1/60,4,i*16);vb=Math.min(vb,speedOf("car"));}p=physics.pose("car");{const rec=physics.records.get("car"),f=[Math.cos(p.yaw),Math.sin(p.yaw)],l=[-f[1],f[0]],vf=p.velocity[0]*f[0]+p.velocity[1]*f[1],vl=p.velocity[0]*l[0]+p.velocity[1]*l[1],angles=(rec?.wheels||[]).map(w=>w.front?b3.b3WheelJoint_GetSteeringAngle?.(w.joint):0),spins=(rec?.wheels||[]).map(w=>b3.b3WheelJoint_GetSpinSpeed?.(w.joint));console.log("brake diagnostics",{velocity:p.velocity.map(x=>Number(x.toFixed(3))),vf:Number(vf.toFixed(3)),vl:Number(vl.toFixed(3)),yaw:Number(p.yaw.toFixed(3)),steer:angles.map(x=>Number((x||0).toFixed(3))),spin:spins.map(x=>Number((x||0).toFixed(3)))});}console.log("braking from",v0.toFixed(1),"min",vb.toFixed(2));
assert.ok(vb<2.2,`brakes stop the car: ${vb}`);
physics.setDrive("car",{pedal:-1,steer:0,maxReverse:8});step(120);
p=physics.pose("car");const fwd=[Math.cos(p.yaw),Math.sin(p.yaw)],vf=p.velocity[0]*fwd[0]+p.velocity[1]*fwd[1];console.log("reverse speed",vf.toFixed(2));
assert.ok(vf<-2,`reverse gear: ${vf}`);
// AI car follows a target
physics.addBody({id:"ai",kind:"car",position:[0,30,.5],yaw:0});step(30);
for(let i=0;i<300;i++){physics.setTarget("ai",{position:[60,60,0],speedMps:10});physics.step(1/60,4,i*16);}
p=physics.pose("ai");const d=Math.hypot(60-p.position[0],60-p.position[1]);console.log("ai distance to target",d.toFixed(1));
assert.ok(d<40,`AI drives towards its target: ${d}`);
physics.addBody({id:"bus",kind:"bus",position:[0,-30,1],yaw:0});step(60);physics.setDrive("bus",{pedal:1,steer:0,maxSpeed:20});step(240);
console.log("bus speed",speedOf("bus").toFixed(1));assert.ok(speedOf("bus")>6,"bus accelerates");
physics.removeBody("car");physics.removeBody("ai");physics.removeBody("bus");physics.destroy();
console.log("vehicle dynamics test passed");
