import assert from "node:assert/strict";
import {pathToFileURL} from "node:url";
import {resolve} from "node:path";
import {WorldRigidBodyPhysics} from "../sim/world_rigid_body_physics.mjs";
import {setElevationGrid} from "../sim/terrain_elevation.mjs";
import {onTerrainChange,staticGroundHeightAt,terrainRescueZ} from "../sim/terrain_craters.mjs";

// The terrain must never trap anything underneath it: when the DEM arrives
// (or the world origin moves) and the ground rises above bodies resting on
// the old surface, they are put back on top and keep driving on it.
const modulePath=process.argv[2];
if(!modulePath)throw new Error("usage: node tests/terrain_underground_rescue_box3d_test.mjs <box3d.inline.mjs>");
const b3=await (await import(pathToFileURL(resolve(modulePath)).href)).default();
const physics=new WorldRigidBodyPhysics(b3,{buildingSnapshot:{hash:"none",footprintCount:0,prisms:[]}});
onTerrainChange(()=>physics.rebuildTerrain());
const step=(n)=>{for(let i=0;i<n;i++)physics.step(1/60,4,i*1000/60);};
physics.addBody({id:"car",kind:"car",position:[0,0,.6],yaw:0});
physics.addBody({id:"box",kind:"crate",position:[6,3,.6],halfExtents:[.5,.5,.5],massKg:80,wheeled:false});
physics.addBody({id:"north",kind:"crate",position:[-20,62,.6],halfExtents:[.5,.5,.5],massKg:80,wheeled:false});
physics.addBody({id:"south",kind:"crate",position:[-20,-62,.6],halfExtents:[.5,.5,.5],massKg:80,wheeled:false});
step(60);
assert.ok(physics.pose("car").position[2]<1,"car rests on the flat start ground");

// a hill: 9 m at the car, sloping 6 % — the old ground is now 9 m underground
const n=241,stepM=5,h=new Float32Array(n*n);for(let j=0;j<n;j++)for(let i=0;i<n;i++){const x=-600+i*stepM,y=-600+j*stepM;h[j*n+i]=9+.06*x+4*Math.sin(y/40);}
setElevationGrid({x0:-600,y0:-600,step:stepM,n,h,cx:0,cy:0});
assert.ok(staticGroundHeightAt(0,0)>8.5,"the DEM raised the ground");
step(120);
for(const id of["car","box","north","south"]){const p=physics.pose(id),g=staticGroundHeightAt(p.position[0],p.position[1]);console.log(id,"z",p.position[2].toFixed(2),"ground",g.toFixed(2));
  assert.ok(p.position[2]>g&&p.position[2]<g+1.4,`${id} must stand on the risen terrain exactly where it is drawn (no mirrored/offset collision): z=${p.position[2]} ground=${g}`);}
// drives up the slope on the height field
physics.setDrive("car",{pedal:1,steer:0,maxSpeed:20});step(240);
let p=physics.pose("car"),g=staticGroundHeightAt(p.position[0],p.position[1]);console.log("after climbing x",p.position[0].toFixed(1),"z",p.position[2].toFixed(2),"ground",g.toFixed(2));
assert.ok(p.position[0]>15,"car climbs the hill");assert.ok(p.position[2]>g&&p.position[2]<g+2,"car stays on the slope");
// a body forced below the surface is recovered by the guard within a few steps
const z0=terrainRescueZ(p.position[0],p.position[1],g-3,.6);assert.ok(z0!==null&&z0>g,"rescue height is above the surface");
assert.equal(terrainRescueZ(p.position[0],p.position[1],g+.5,.6),null,"bodies above the surface are left alone");
physics.setDrive("car",{pedal:0,steer:0});const q=physics.pose("car");physics.setPose?.("car",{position:[q.position[0],q.position[1],g-4],yaw:0});
step(30);p=physics.pose("car");g=staticGroundHeightAt(p.position[0],p.position[1]);console.log("after forced burial z",p.position[2].toFixed(2),"ground",g.toFixed(2));
assert.ok(p.position[2]>g,"buried car is lifted back on top");
console.log("terrain underground rescue test passed");
