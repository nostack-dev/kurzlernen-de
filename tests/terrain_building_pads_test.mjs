import assert from "node:assert/strict";
import {setElevationGrid} from "../sim/terrain_elevation.mjs";
import {setBuildingPads,buildingGroundBase,staticGroundHeightAt,addCrater,clearCraters,onTerrainChange,PAD_BLEND_M} from "../sim/terrain_craters.mjs";

// Buildings stand on levelled pads that are part of the one terrain: no house
// tilted into a hill or hanging over the downhill side, and after a crater
// the building base follows the lowered ground.
const n=161,step=5,h=new Float32Array(n*n);
for(let j=0;j<n;j++)for(let i=0;i<n;i++){const x=-400+i*step;h[j*n+i]=.12*x;} // 12 % slope along x
setElevationGrid({x0:-400,y0:-400,step,n,h,cx:0,cy:0});
const ring=[[10,10],[34,10],[34,26],[10,26]];let events=[];onTerrainChange((c,regions,source)=>events.push({regions,source}));
assert.ok(setBuildingPads([{key:"house",outer:ring}]));assert.equal(events.at(-1).source,"pads");assert.ok(events.at(-1).regions.length===1,"only the pad region changes");
assert.equal(setBuildingPads([{key:"house",outer:ring}]),false,"unchanged pads do not re-shape the terrain");
const inside=[];for(let x=11;x<34;x+=2.3)for(let y=11;y<26;y+=2.1)inside.push(staticGroundHeightAt(x,y));
const spread=Math.max(...inside)-Math.min(...inside);console.log("ground spread under the house",spread.toFixed(3),"m (natural slope would be",(.12*23).toFixed(2),"m)");
assert.ok(spread<.9,"ground under the building is levelled");
const base=buildingGroundBase(ring);for(const[x,y]of ring)assert.ok(staticGroundHeightAt(x,y)>=base-1e-6,"base never above the ground at the outline (no floating)");
for(const[x,y]of ring)assert.ok(staticGroundHeightAt(x,y)-base<.9,"no wall buried deep into the slope");
// far from the pad the natural slope is untouched
assert.ok(Math.abs(staticGroundHeightAt(80,18)-.12*80)<1e-6);assert.ok(Math.abs(staticGroundHeightAt(10-PAD_BLEND_M-6,18)-.12*(10-PAD_BLEND_M-6))<1e-6);
// crater: base follows the ground down
addCrater(40,18);const after=buildingGroundBase(ring);console.log("base before",base.toFixed(2),"after crater",after.toFixed(2));assert.ok(after<base-5,"building base follows the crater down");
for(const[x,y]of ring)assert.ok(staticGroundHeightAt(x,y)>=after-1e-6,"still not floating after the crater");
clearCraters();setBuildingPads([]);assert.ok(Math.abs(staticGroundHeightAt(20,18)-.12*20)<1e-6,"removing the pad restores the slope");
console.log("building pads test passed");
