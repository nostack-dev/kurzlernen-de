import assert from 'node:assert/strict';
import {TERRAIN_GRID_COUNT,TERRAIN_CELL_M,TERRAIN_HALF_EXTENT_M,TERRAIN_FLAT_RADIUS_M,TERRAIN_SAFETY_BED_Z_M,createTerrainMeshData,terrainHeightAt,terrainStats} from '../sim/terrain_heightfield.mjs';

const stats=terrainStats();
assert.equal(stats.gridCount,177);assert.equal(stats.cellM,8);assert.equal(stats.halfExtentM,704);assert.ok(stats.triangleCount>60000);
assert.ok(stats.maxHeightM>=30,'terrain must contain substantial hills');assert.ok(stats.minHeightM<=-15,'terrain must contain valleys');
for(const point of [[0,0],[50,20],[-90,70],[120,-60]])assert.ok(Math.abs(terrainHeightAt(...point))<1e-7,'launch/city clearing must remain flat');
assert.equal(terrainHeightAt(TERRAIN_HALF_EXTENT_M+1,0),TERRAIN_SAFETY_BED_Z_M);
const mesh=createTerrainMeshData();assert.equal(mesh.positions.length,TERRAIN_GRID_COUNT*TERRAIN_GRID_COUNT*3);assert.equal(mesh.indices.length,(TERRAIN_GRID_COUNT-1)*(TERRAIN_GRID_COUNT-1)*6);
for(let i=0;i<mesh.indices.length;i+=3){
  const a=mesh.indices[i]*3,b=mesh.indices[i+1]*3,c=mesh.indices[i+2]*3,ax=mesh.positions[a],ay=mesh.positions[a+1],az=mesh.positions[a+2],bx=mesh.positions[b],by=mesh.positions[b+1],bz=mesh.positions[b+2],cx=mesh.positions[c],cy=mesh.positions[c+1],cz=mesh.positions[c+2];
  const abx=bx-ax,aby=by-ay,abz=bz-az,acx=cx-ax,acy=cy-ay,acz=cz-az,nz=abx*acy-aby*acx;
  assert.ok(nz>0,`terrain triangle ${i/3} must face +Z`);
}
for(const [x,y] of [[240,-190],[-330,220],[100,390],[410,80],[-470,-130]]){
  const h=terrainHeightAt(x,y);assert.ok(Number.isFinite(h));
  const eps=.25;assert.ok(Math.abs(terrainHeightAt(x+eps,y)-h)<1&&Math.abs(terrainHeightAt(x,y+eps)-h)<1,'heightfield interpolation must be continuous');
}
console.log(`Terrain heightfield passed: ${stats.triangleCount} triangles, ${stats.minHeightM.toFixed(1)}..${stats.maxHeightM.toFixed(1)} m, flat radius ${TERRAIN_FLAT_RADIUS_M} m.`);
