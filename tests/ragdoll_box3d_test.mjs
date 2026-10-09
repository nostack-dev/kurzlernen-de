import assert from "node:assert/strict";
import {pathToFileURL} from "node:url";
import {resolve} from "node:path";
import {WorldRigidBodyPhysics} from "../sim/world_rigid_body_physics.mjs";
import {humanPoint,HUMAN_BONE_INDEX as I} from "../sim/box3d_human.mjs";

// Ragdolls are Erin Catto's Box3D human (capsules, cone/twist + hinge limits,
// joint friction, sleeping): thrown, they fall, tumble and come to a real
// rest — no jitter, no hopping — with no limb under the ground.
const modulePath=process.argv[2];
if(!modulePath)throw new Error("usage: node tests/ragdoll_box3d_test.mjs <box3d.inline.mjs>");
const b3=await (await import(pathToFileURL(resolve(modulePath)).href)).default();
for(const [label,vel] of [["fall",[0,0,0]],["thrown",[6,1,4]],["blasted",[-9,4,7]]]){
  const ph=new WorldRigidBodyPhysics(b3,{buildingSnapshot:{hash:"none",footprintCount:0,prisms:[]}});
  const h=ph.createHuman("p",{position:[0,0,.02],yaw:.7,velocity:vel});let t=0,zs=[],minZ=Infinity;
  for(let k=0;k<480;k++){ph.step(1/60,4,(t++)*1000/60);for(const b of h.bodies)minZ=Math.min(minZ,b3.b3Body_GetPosition([0,0,0],b)[2]);if(k>=300)zs.push(humanPoint(b3,h,I.pelvis,[0,0,0])[2]);}
  const vmax=Math.max(...h.bodies.map(b=>Math.hypot(...b3.b3Body_GetLinearVelocity([0,0,0],b)))),range=Math.max(...zs)-Math.min(...zs),head=humanPoint(b3,h,I.neck_01,[0,-.15,0])[2];
  console.log(label,"rest speed",vmax.toFixed(4),"pelvis z wobble",range.toFixed(4),"lowest bone",minZ.toFixed(3),"head z",head.toFixed(2));
  assert.ok(vmax<.02,`${label}: the body comes to rest`);assert.ok(range<.005,`${label}: no jitter / hopping once down`);assert.ok(minZ>0,`${label}: nothing under the ground`);assert.ok(head<.6,`${label}: it actually fell`);
  ph.destroy();
}
console.log("Box3D ragdoll test passed");
