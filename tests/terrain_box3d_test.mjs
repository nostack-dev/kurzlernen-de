import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createTerrainMeshData,terrainHeightAt,terrainStats} from '../sim/terrain_heightfield.mjs';

const modulePath=process.argv[2];if(!modulePath)throw new Error('usage: node tests/terrain_box3d_test.mjs <box3d.inline.mjs>');
const imported=await import(pathToFileURL(resolve(modulePath)).href),factory=imported.default;if(typeof factory!=='function')throw new Error('Box3D inline module has no default factory');
const b3=await factory(),worldDef=b3.b3DefaultWorldDef();worldDef.gravity=[0,0,-9.80665];worldDef.enableSleep=false;worldDef.enableContinuous=true;const world=b3.b3CreateWorld(worldDef);
const bodyDef=b3.b3DefaultBodyDef(),terrainBody=b3.b3CreateBody(world,bodyDef),shapeDef=b3.b3DefaultShapeDef();shapeDef.baseMaterial.friction=.78;shapeDef.baseMaterial.restitution=.02;shapeDef.filter={categoryBits:1n,maskBits:14n,groupIndex:0};
const mesh=createTerrainMeshData(),meshData=b3.b3CreateMesh(mesh.positions,mesh.indices);assert.ok(meshData,'Box3D terrain mesh creation failed');b3.b3CreateMeshShape(terrainBody,shapeDef,meshData,[1,1,1]);
const query=b3.b3DefaultQueryFilter();query.categoryBits=4n;query.maskBits=1n;
for(const [x,y] of [[0,0],[250,-190],[-330,220],[100,390],[-460,-120]]){
  const expected=terrainHeightAt(x,y),originZ=Math.max(60,expected+45),ray=b3.b3World_CastRayClosest(world,[x,y,originZ],[0,0,-100],query);
  assert.equal(ray.hit,true,`terrain ray missed at ${x},${y}`);const actual=originZ-100*ray.fraction;assert.ok(Math.abs(actual-expected)<.035,`terrain ray mismatch at ${x},${y}: ${actual} vs ${expected}`);assert.ok(ray.normal[2]>.2,`terrain triangle normal must face upward at ${x},${y}`);
}
const hill=[250,-190],hillZ=terrainHeightAt(...hill),probeDef=b3.b3DefaultBodyDef();probeDef.type=b3.b3BodyType.b3_dynamicBody;probeDef.position=[hill[0],hill[1],hillZ+8];probeDef.enableSleep=false;const probe=b3.b3CreateBody(world,probeDef),probeShape=b3.b3DefaultShapeDef();probeShape.density=700;probeShape.filter={categoryBits:2n,maskBits:1n,groupIndex:0};b3.b3CreateSphereShape(probe,probeShape,{center:[0,0,0],radius:.18});
for(let i=0;i<3000;i++)b3.b3World_Step(world,.001,4);const position=[0,0,0];b3.b3Body_GetPosition(position,probe);assert.ok(position[2]>hillZ+.14,`dynamic probe penetrated terrain: ${position[2]} <= ${hillZ}`);assert.ok(position[2]<hillZ+.5,`dynamic probe did not settle on terrain: ${position[2]} vs ${hillZ}`);
b3.b3DestroyWorld(world);if(typeof b3.b3DestroyMesh==='function')b3.b3DestroyMesh(meshData);else meshData.delete?.();
const stats=terrainStats();console.log(`Terrain Box3D passed: ${stats.triangleCount} physical triangles, AGL rays match rendered height source and dynamic contact settles on hillside.`);
