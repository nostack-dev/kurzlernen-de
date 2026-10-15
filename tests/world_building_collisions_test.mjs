import assert from "node:assert/strict";
import {applyDamageToPrisms,buildingDamage,clearDestruction,setBuildingDamage,setFeatureDamage} from "../sim/world_destruction_state.mjs";
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

// Destruction must survive a tile fragment / geometry-key change.
// Full demolition leaves the drawn rubble stump (and nothing taller) as the collider.
const collisionFragments=[
  {buildingKey:"777:first-tile-geometry",base:0,top:12,points:[[0,0],[1,0],[1,1]]},
  {buildingKey:"777:new-tile-geometry",base:0,top:12,points:[[1,0],[2,0],[2,1]]},
  {buildingKey:"888:neighbour",base:0,top:9,points:[[5,0],[6,0],[6,1]]},
];
assert.equal(setBuildingDamage("777:first-tile-geometry",{top:4,leveled:false}),true);
assert.equal(buildingDamage("777:new-tile-geometry")?.top,4,"a tile fragment must inherit the original building's damage");
let damagedPrisms=applyDamageToPrisms(collisionFragments);
assert.equal(damagedPrisms.length,3);assert.equal(damagedPrisms[0].top,4);assert.equal(damagedPrisms[1].top,4);
assert.equal(setFeatureDamage("777",{top:4,leveled:true}),true,"equal-height demolition must upgrade the leveled flag");
assert.equal(buildingDamage("777:first-tile-geometry")?.leveled,true);
{setFeatureDamage("777",{top:.8,leveled:true});const rubble=applyDamageToPrisms(collisionFragments);
assert.equal(rubble.length,3,"a leveled building keeps exactly its drawn rubble stump as collider");
assert.ok(rubble.slice(0,2).every(p=>p.leveled&&Math.abs(p.top-.8)<1e-9),"the rubble collider has the drawn rubble height, also for newly streamed fragments");
assert.equal(rubble[2].top,9,"the neighbour is untouched");}
assert.equal(setBuildingDamage("777:yet-another-fragment",{top:12,leveled:false}),true);
assert.equal(buildingDamage("777:yet-another-fragment")?.leveled,true,"a reloaded building must never resurrect a leveled collider");
clearDestruction();
assert.equal(buildingDamage("777:new-tile-geometry"),null);
assert.equal(applyDamageToPrisms(collisionFragments).length,3,"RESET must restore the intact building colliders");

console.log("WORLD building geometry passed: OSM Polygon/MultiPolygon, holes, min/max heights, tile fragments, deterministic hashing and collision budgets are bounded.");

// Concave footprints: triangles are merged back into convex pieces (one Box3D hull each), area kept
// exactly, every piece convex, and a building is never cut by the prism budget.
{
  // three.js is not installed on every CI host: a tiny ear clipper covers the hole-free footprints
  let THREE=null;try{THREE=await import("three");}catch{}
  const ear=(outer)=>{const idx=outer.map((_,i)=>i),out=[],A=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(c[0]-a[0])*(b[1]-a[1]);let area=0;for(let i=0,j=outer.length-1;i<outer.length;j=i++)area+=outer[j][0]*outer[i][1]-outer[i][0]*outer[j][1];const ccw=area>0;
    let guard=0;while(idx.length>3&&guard++<1000){for(let k=0;k<idx.length;k++){const i0=idx[(k+idx.length-1)%idx.length],i1=idx[k],i2=idx[(k+1)%idx.length],a=outer[i0],b=outer[i1],c=outer[i2],cr=A(a,b,c);if(ccw?cr<=0:cr>=0)continue;
      if(idx.some(j=>j!==i0&&j!==i1&&j!==i2&&(()=>{const p=outer[j],d1=A(a,b,p),d2=A(b,c,p),d3=A(c,a,p);return ccw?d1>0&&d2>0&&d3>0:d1<0&&d2<0&&d3<0;})()))continue;out.push([i0,i1,i2]);idx.splice(k,1);break;}}out.push(idx.slice(0,3));return out;};
  const tri=(outer,holes)=>THREE?THREE.ShapeUtils.triangulateShape(outer.map(p=>new THREE.Vector2(...p)),holes.map(r=>r.map(p=>new THREE.Vector2(...p)))):holes.length?null:ear(outer);
  const ringArea=r=>{let a=0;for(let i=0,j=r.length-1;i<r.length;j=i++)a+=r[j][0]*r[i][1]-r[i][0]*r[j][1];return a/2;};
  const isConvex=r=>{for(let i=0;i<r.length;i++){const a=r[i],b=r[(i+1)%r.length],c=r[(i+2)%r.length];if((b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0])<-1e-7)return false;}return true;};
  const L=buildingFootprintsFromFeatures([polygon("L",[[[0,0],[10,0],[10,3],[3,3],[3,8],[0,8],[0,0]]],{height:9})]);
  const lp=buildingCollisionPrismsFromFootprints(L,tri);
  assert.equal(lp.length,2,"an L-shaped house is two convex hulls, not four triangles");
  assert.ok(lp.every(p=>isConvex(p.points)));assert.ok(Math.abs(lp.reduce((s,p)=>s+ringArea(p.points),0)-45)<1e-6);
  if(THREE){const cy=buildingCollisionPrismsFromFootprints([yard],tri);
  assert.ok(cy.length<=4,`courtyard house in ${cy.length} pieces`);assert.ok(cy.every(p=>isConvex(p.points)));
  assert.ok(Math.abs(cy.reduce((s,p)=>s+ringArea(p.points),0)-76)<1e-6,"the courtyard stays open");}
  const two=[...L,{...L[0],key:"L2"}];
  assert.equal(buildingCollisionPrismsFromFootprints(two,tri,{maxPrisms:3}).length,2,"the second house does not fit whole and is left out, never cut in half");
}
console.log("Convex merge passed: L-shape 2 hulls, courtyard open, budget never cuts a house.");
