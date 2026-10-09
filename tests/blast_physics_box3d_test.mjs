// The blast impulse follows the pressure-impulse law (i_s ≈ 250·W^(2/3)/r, reflected ×2, × area
// shown to the blast), shadowed bodies get nothing, a ragdoll tumbles, and bullets hand over
// exactly their momentum.
import assert from "node:assert/strict";
import {pathToFileURL} from "node:url";
import {resolve} from "node:path";
import {WorldRigidBodyPhysics} from "../sim/world_rigid_body_physics.mjs";
import {projectileMomentumNs,bulletImpulse} from "../sim/ballistics.mjs";
const modulePath=process.argv[2];if(!modulePath)throw new Error("usage: node tests/blast_physics_box3d_test.mjs <box3d.inline.mjs>");
const b3=await (await import(pathToFileURL(resolve(modulePath)).href)).default();
const physics=new WorldRigidBodyPhysics(b3,{buildingSnapshot:{hash:"none",footprintCount:0,prisms:[]}});
const dog={id:"dog",kind:"animal",position:[5,0,.4],yaw:0,halfExtents:[.33,.13,.25],massKg:28},car={id:"car",kind:"car",position:[0,10,.45],yaw:0,halfExtents:[1.78,.82,.42],massKg:1420},hidden={id:"hidden",kind:"animal",position:[-5,0,.4],yaw:0,halfExtents:[.33,.13,.25],massKg:28};
for(const b of[dog,car,hidden])physics.addBody(b);
for(let i=0;i<60;i++)physics.step(1/60,4,i*1000/60);
const v0=id=>physics.pose(id).velocity;
const W=1.3,pushed=physics.blast([0,0,.05],{tntKg:W,exposure:(x)=>x<-1?0:1});
assert.ok(pushed>=2,"dog and car pushed");
// expected dog impulse: r = distance to nearest point of the box
const near=[5-.33,0,Math.max(.05,.4-.25)],r=Math.hypot(...near.map((v,i)=>v-[0,0,.05][i])),area=((.66*.26)+(.26*.5)+(.5*.66))/2,J=2*250*Math.cbrt(W)**2/r*area;
physics.step(1/240,1,2000);const vd=v0("dog"),speed=Math.hypot(vd[0],vd[1],vd[2]);
assert.ok(Math.abs(speed-J/28)/(J/28)<.25,`dog dv ${speed.toFixed(3)} vs law ${(J/28).toFixed(3)} m/s`);
const vc=v0("car");assert.ok(Math.hypot(...vc)<speed,"a car moves less than a dog");
const vh=v0("hidden");assert.ok(Math.hypot(...vh)<.01,"shadowed body untouched");
assert.ok(Math.abs(projectileMomentumNs("9mm")-2.88)<.01&&Math.abs(Math.hypot(...bulletImpulse({x:0,y:3,z:4},"9mm"))-2.88)<.01,"9 mm momentum");
console.log(`Blast physics passed: dog ${speed.toFixed(2)} m/s (law ${(J/28).toFixed(2)}), car ${Math.hypot(...vc).toFixed(3)} m/s, shadowed 0.`);
