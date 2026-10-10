import assert from "node:assert/strict";
import {pathToFileURL} from "node:url";
import {resolve} from "node:path";
import {updateWorldBuildingCollisionBodies,destroyWorldBuildingCollisionBodies} from "../sim/world_building_collision_physics.mjs";
// Moving fast through a city changes the nearby-building set every few hundred ms: unchanged houses
// keep their Box3D hulls, only new ones are built, vanished ones are destroyed, rays hit the right set.
const modulePath=process.argv[2]||"./node_modules/box3d.js/dist/box3d.inline.mjs";
const b3=await (await import(pathToFileURL(resolve(modulePath)).href)).default();
const wd=b3.b3DefaultWorldDef();wd.gravity=[0,0,0];const world=b3.b3CreateWorld(wd);
const house=(k,x)=>({buildingKey:k,base:0,top:6,points:[[x,-2],[x+4,-2],[x+4,2],[x,2]]});
const A={hash:"A",prisms:[house("a",0),house("b",10),house("c",20)]},B={hash:"B",prisms:[house("b",10),house("c",20),house("d",30)]};
const opts={categoryBits:1n,maskBits:14n,rangefinderCategoryBits:0n};
const filter=b3.b3DefaultQueryFilter();filter.categoryBits=8n;filter.maskBits=1n;
const hits=x=>Boolean(b3.b3World_CastRayClosest(world,[x+2,0,20],[0,0,-30],filter)?.hit);
let s=updateWorldBuildingCollisionBodies(b3,world,null,A,opts);
assert.equal(s.shapeCount,3);assert.equal(s.built,3);assert.ok(hits(0)&&hits(10)&&hits(20)&&!hits(30));
const keepB=[...s.entries.values()][1].body;
s=updateWorldBuildingCollisionBodies(b3,world,s,B,opts);
assert.equal(s.shapeCount,3);assert.equal(s.built,1,"only the new house is built");assert.equal(s.kept,2);
assert.ok(!hits(0),"the house that left the set is gone");assert.ok(hits(10)&&hits(20)&&hits(30));
assert.ok([...s.entries.values()].some(e=>e.body===keepB),"unchanged house keeps its body");
s=updateWorldBuildingCollisionBodies(b3,world,s,{hash:"E",prisms:[]},opts);assert.equal(s.shapeCount,0);assert.ok(!hits(10)&&!hits(30));
s=updateWorldBuildingCollisionBodies(b3,world,s,A,opts);destroyWorldBuildingCollisionBodies(b3,s);assert.ok(!hits(0)&&!hits(10));
console.log("incremental building collision Box3D test passed");
