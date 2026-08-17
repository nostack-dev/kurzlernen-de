import assert from "node:assert/strict";
import {
  WORLD_BUILDING_COLLISION_MAX_FOOTPRINTS,
  WORLD_BUILDING_COLLISION_MAX_PRISMS,
  buildingFootprintsFromFeatures,
  buildingFootprintHash,
  buildingCollisionPrismsFromFootprints,
  makeBuildingCollisionSnapshot,
  triangulateBuildingFootprints,
} from "../sim/world_building_collisions.mjs";

const polygon=(id,coordinates,properties={})=>({id,properties,geometry:{type:"Polygon",coordinates}});
const square=(x0,y0,x1,y1)=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]];
const fan=(outer,holes)=>{
  assert.equal(holes.length,0,"fan fixture only accepts a solid polygon");
  return Array.from({length:Math.max(0,outer.length-2)},(_,index)=>[0,index+1,index+2]);
};

const courtyard=polygon(101,[square(-5,-4,5,4),square(-1,-1,1,1)],{render_height:"12.5",render_min_height:"2"});
const multi={id:202,properties:{height:7},geometry:{type:"MultiPolygon",coordinates:[[square(12,-2,16,2)],[square(18,-2,22,2)]]}};
const far=polygon(303,[square(500,500,510,510)],{height:9});
const footprints=buildingFootprintsFromFeatures([far,multi,courtyard],{radiusM:100});
assert.equal(footprints.length,3);
const yard=footprints.find(item=>item.key.startsWith("101:"));
assert.ok(yard);assert.equal(yard.holes.length,1);assert.equal(yard.outer.length,4);assert.equal(yard.holes[0].length,4);assert.equal(yard.base,2);assert.equal(yard.top,12.5);

// Identical cross-tile repeats collapse, but differently clipped pieces of the
// same OSM feature survive so the physical shell remains complete.
const repeated=polygon(404,[square(30,0,34,4)],{height:8});
const fragment=polygon(404,[square(34,0,38,4)],{height:8});
const tiled=buildingFootprintsFromFeatures([repeated,fragment,repeated],{radiusM:100});
assert.equal(tiled.length,2);
assert.equal(buildingFootprintHash(tiled),buildingFootprintHash([...tiled].reverse()));
assert.notEqual(buildingFootprintHash(tiled),buildingFootprintHash(tiled.map((item,index)=>index?item:{...item,top:9})));

const many=Array.from({length:WORLD_BUILDING_COLLISION_MAX_FOOTPRINTS+20},(_,index)=>polygon(`many-${index}`,[square(index%20,Math.floor(index/20),index%20+.4,Math.floor(index/20)+.4)]));
assert.equal(buildingFootprintsFromFeatures(many,{radiusM:1000}).length,WORLD_BUILDING_COLLISION_MAX_FOOTPRINTS);
const longRing=Array.from({length:160},(_,index)=>{const a=index/160*Math.PI*2;return[60+Math.cos(a)*5,Math.sin(a)*5];});longRing.push(longRing[0]);
assert.equal(buildingFootprintsFromFeatures([polygon("long",[longRing])],{radiusM:100,maxVertices:32})[0].outer.length,32);

const solid=buildingFootprintsFromFeatures([polygon("solid",[square(-2,-3,2,3)],{height:10})]);
const triangles=triangulateBuildingFootprints(solid,fan);
assert.equal(triangles.length,2);assert.deepEqual(triangles.map(item=>[item.base,item.top]),[[0,10],[0,10]]);
assert.equal(triangulateBuildingFootprints(solid,()=>Array.from({length:WORLD_BUILDING_COLLISION_MAX_PRISMS+10},()=>[0,1,2])).length,WORLD_BUILDING_COLLISION_MAX_PRISMS);
let convexTriangulatorCalls=0;const convexPrisms=buildingCollisionPrismsFromFootprints(solid,(outer,holes)=>{convexTriangulatorCalls++;return fan(outer,holes);});assert.equal(convexPrisms.length,1);assert.equal(convexPrisms[0].points.length,4);assert.equal(convexTriangulatorCalls,0);
let courtyardTriangulatorCalls=0;const courtyardPrisms=buildingCollisionPrismsFromFootprints([yard],()=>{courtyardTriangulatorCalls++;return[[0,1,2]];});assert.equal(courtyardPrisms.length,1);assert.equal(courtyardTriangulatorCalls,1,"a footprint with a hole must never be convex-hull filled");
const snapshot=makeBuildingCollisionSnapshot([polygon("snap",[square(1,2,5,6)],{render_height:11})],{triangulate:fan});
assert.match(snapshot.hash,/^osm-[0-9a-f]{8}$/);assert.equal(snapshot.footprintCount,1);assert.equal(snapshot.prismCount,1);assert.equal(Object.isFrozen(snapshot),true);

console.log("WORLD building geometry passed: OSM Polygon/MultiPolygon, holes, min/max heights, tile fragments, deterministic hashing and collision budgets are bounded.");
