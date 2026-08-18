import assert from 'node:assert/strict';
import {buildTerrainSnapshot,terrainHeightAt,raycastTerrainSnapshot} from '../sim/world_terrain.mjs';

const snapshot=buildTerrainSnapshot({originElevationM:500,center:[0,0],halfExtentM:20,gridSize:5,sampleMsl:(x,y)=>500+.1*x+.2*y});
assert.ok(snapshot);assert.equal(snapshot.gridSize,5);assert.equal(snapshot.indices.length,4*4*6);assert.ok(Math.abs(terrainHeightAt(snapshot,7,-3)-(.7-.6))<1e-5);
const hit=raycastTerrainSnapshot(snapshot,{x:0,y:0,z:10},{x:0,y:0,z:-1},50);assert.ok(hit);assert.ok(Math.abs(hit.point[2])<1e-3);assert.ok(hit.normal[2]>.95);
const sloped=raycastTerrainSnapshot(snapshot,{x:-10,y:-10,z:10},{x:1,y:1,z:-.5},60);assert.ok(sloped);assert.ok(Number.isFinite(sloped.distance));
assert.equal(buildTerrainSnapshot({originElevationM:500,center:[0,0],halfExtentM:20,gridSize:5,sampleMsl:()=>null}),null);
console.log(`WORLD terrain model passed: ${snapshot.indices.length/3} triangles, z ${snapshot.minZ.toFixed(2)}..${snapshot.maxZ.toFixed(2)} m.`);
