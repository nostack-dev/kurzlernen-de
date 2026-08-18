import assert from 'node:assert/strict';import{decodeTerrariumHeight,lonLatToGlobalDemPixel,WORLD_DEM_TILE_SIZE,WORLD_DEM_ZOOM}from'../sim/world_dem_sampler.mjs';
assert.equal(decodeTerrariumHeight(128,0,0),0);assert.equal(decodeTerrariumHeight(128,1,128),1.5);assert.equal(decodeTerrariumHeight(127,255,0),-1);
const zero=lonLatToGlobalDemPixel(0,0);const world=WORLD_DEM_TILE_SIZE*2**WORLD_DEM_ZOOM;assert.ok(Math.abs(zero.x-world/2)<1e-6);assert.ok(Math.abs(zero.y-world/2)<1e-6);
const berlin=lonLatToGlobalDemPixel(13.405,52.52);assert.ok(berlin.x>world/2);assert.ok(berlin.y<world/2);const repeat=lonLatToGlobalDemPixel(13.405,52.52);assert.deepEqual(repeat,berlin);
console.log(`WORLD DEM sampler math passed: z${WORLD_DEM_ZOOM}, ${WORLD_DEM_TILE_SIZE}px Terrarium.`);
