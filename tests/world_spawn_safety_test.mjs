import assert from 'node:assert/strict';
import {solveRaytracedSafeSpawn,spawnCandidatePoints,WORLD_RESPAWN_MIN_OFFSET_M,WORLD_RESPAWN_MAX_OFFSET_M} from '../sim/world_spawn_safety.mjs';

const flat=()=>0,ray=(x,y,z)=>({z:0,normal:[0,0,1]});
let result=solveRaytracedSafeSpawn({reference:[0,0,0],terrainHeightAt:flat,raycastDown:ray,prisms:[],randomized:false,airframeSupportM:.022});
assert.ok(result);assert.ok(Math.abs(result.position[0])<1e-9&&Math.abs(result.position[1])<1e-9);assert.ok(result.position[2]>.05);

const building={base:0,top:12,points:[[-3,-3],[3,-3],[3,3],[-3,3]]};
result=solveRaytracedSafeSpawn({reference:[0,0,0],terrainHeightAt:flat,raycastDown:ray,prisms:[building],randomized:false,seed:1});
assert.ok(result);assert.ok(Math.hypot(result.position[0],result.position[1])>4,'spawn must move outside building + margin');

result=solveRaytracedSafeSpawn({reference:[10,20,4],terrainHeightAt:flat,raycastDown:ray,prisms:[],randomized:true,seed:1234});
assert.ok(result);const offset=Math.hypot(result.position[0]-10,result.position[1]-20);assert.ok(offset>=WORLD_RESPAWN_MIN_OFFSET_M-.01&&offset<=WORLD_RESPAWN_MAX_OFFSET_M+.01,'respawn offset must be visible but local');
const same=solveRaytracedSafeSpawn({reference:[10,20,4],terrainHeightAt:flat,raycastDown:ray,prisms:[],randomized:true,seed:1234});assert.deepEqual(same.position,result.position,'seeded respawn must be deterministic for test/replay');

const roofRay=()=>({z:8,normal:[0,0,1]});assert.equal(solveRaytracedSafeSpawn({reference:[0,0,0],terrainHeightAt:flat,raycastDown:roofRay,prisms:[],randomized:true,seed:5}),null,'ray hit far above DEM must never be accepted as terrain');
const cliffRay=()=>({z:0,normal:[1,0,.2]});assert.equal(solveRaytracedSafeSpawn({reference:[0,0,0],terrainHeightAt:flat,raycastDown:cliffRay,prisms:[],randomized:true,seed:5}),null,'unsafe slope must be rejected');
assert.ok(spawnCandidatePoints([0,0,0],{randomized:false}).length>20);
console.log(`WORLD safe spawn passed: origin clear, building relocation, randomized death offset ${offset.toFixed(1)} m, roof/cliff rejection.`);
