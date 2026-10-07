import assert from "node:assert/strict";
import {pathToFileURL} from "node:url";
import {resolve} from "node:path";
import {WorldRigidBodyPhysics} from "../sim/world_rigid_body_physics.mjs";
import {setElevationGrid} from "../sim/terrain_elevation.mjs";
import {staticGroundHeightAt,terrainNodeHeightAt,addCrater,clearCraters,CRATER_R} from "../sim/terrain_craters.mjs";

// One terrain truth: Box3D height-field tiles = the rendered node field.
// 1) The height-field data must outlive its shape (Box3D keeps a pointer):
//    after lots of other allocations the collision surface is unchanged.
// 2) Deformation rebuilds only the touched tiles, and afterwards physics,
//    visual nodes and the walker height agree everywhere (also in the crater).
const modulePath=process.argv[2]||"node_modules/box3d.js/dist/box3d.inline.mjs";
const b3=await (await import(pathToFileURL(resolve(modulePath)).href)).default();
const n=241,step=5,h=new Float32Array(n*n);
for(let j=0;j<n;j++)for(let i=0;i<n;i++){const x=-600+i*step,y=-600+j*step;h[j*n+i]=.04*x-.03*y+3*Math.sin(x/37)*Math.cos(y/29);}
setElevationGrid({x0:-600,y0:-600,step,n,h,cx:0,cy:0});
const physics=new WorldRigidBodyPhysics(b3,{buildingSnapshot:{hash:"none",footprintCount:0,prisms:[]}});
const tiles=physics.terrainTiles;assert.ok(tiles?.available,"height-field tiles in use");
const filter=b3.b3DefaultQueryFilter();filter.categoryBits=8n;filter.maskBits=1n;
const probe=(label,pts)=>{for(const[x,y]of pts){const z=staticGroundHeightAt(x,y),hit=b3.b3World_CastRayClosest(physics.world,[x,y,z+60],[0,0,-120],filter);assert.ok(hit.hit,`${label}: no terrain at ${x},${y}`);assert.ok(Math.abs(hit.point[2]-z)<.004,`${label}: physics ${hit.point[2]} != visual/walk ${z} at ${x},${y}`);}};
const pts=[];for(let k=0;k<160;k++)pts.push([-430+k*5.37,310-k*3.91]);
probe("fresh",pts);
// churn the allocator: fields/hulls created and freed (would overwrite freed field memory)
for(let k=0;k<300;k++){const f=b3.b3CreateHeightField(new Float32Array(33*33).fill(k%7),33,33,[5,1,5]);b3.b3DestroyHeightField(f);const hull=b3.b3CreateHull([0,0,0,1,0,0,0,1,0,0,0,1,k%3+1,1,1]);if(hull)b3.b3DestroyHull(hull);}
probe("after allocator churn",pts);
// visual node == physics node
for(const[x,y]of[[0,0],[155,-245],[-320,410]])assert.equal(staticGroundHeightAt(x,y),terrainNodeHeightAt(x,y));
// crater: only the touched tiles are rebuilt
const before=tiles.tileBuilds;addCrater(80,-40);physics.rebuildTerrain([[80-CRATER_R,-40-CRATER_R,80+CRATER_R,-40+CRATER_R]]);
const rebuilt=tiles.tileBuilds-before;console.log("tiles",tiles.tiles.size,"rebuilt for crater",rebuilt);
assert.ok(rebuilt>0&&rebuilt<=16,`crater must rebuild only its tiles: ${rebuilt}/${tiles.tiles.size}`);
const crater=[];for(let a=0;a<48;a++){const r=(a%12)*18,t=a*.7;crater.push([80+Math.cos(t)*r,-40+Math.sin(t)*r]);}
probe("crater",crater);probe("outside crater",pts);
assert.ok(staticGroundHeightAt(80,-40)<terrainNodeHeightAt(600,600)+30&&staticGroundHeightAt(80,-40)<-10,"crater bowl is deep");
// a car dropped into the bowl rests on the deformed surface
physics.addBody({id:"car",kind:"car",position:[90,-40,staticGroundHeightAt(90,-40)+2],yaw:0});
for(let i=0;i<180;i++)physics.step(1/60,4,i*16.7);
const p=physics.pose("car"),g=staticGroundHeightAt(p.position[0],p.position[1]);console.log("car in crater z",p.position[2].toFixed(2),"ground",g.toFixed(2));
assert.ok(p.position[2]>g&&p.position[2]<g+1.4,"car rests on the crater floor");
clearCraters();physics.rebuildTerrain([[80-CRATER_R,-40-CRATER_R,80+CRATER_R,-40+CRATER_R]]);probe("crater cleared",crater);
physics.destroy();
console.log("terrain tiles Box3D test passed: field lifetime, partial deformation rebuild, physics = visual = walk height");
