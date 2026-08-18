import assert from "node:assert/strict";
import {pathToFileURL} from "node:url";
import {resolve} from "node:path";
import {createWorldBuildingCollisionBodies,destroyWorldBuildingCollisionBodies,findClearBuildingLaunchPoint,resolveBox3dCameraPath} from "../sim/world_building_collision_physics.mjs";

const modulePath=process.argv[2];
if(!modulePath)throw new Error("usage: node tests/world_building_collision_box3d_test.mjs <box3d.inline.mjs>");
const imported=await import(pathToFileURL(resolve(modulePath)).href),factory=imported.default;
if(typeof factory!=="function")throw new Error("Box3D inline module has no default factory");
const b3=await factory();
const worldDef=b3.b3DefaultWorldDef();worldDef.gravity=[0,0,0];worldDef.enableSleep=false;worldDef.enableContinuous=true;
const world=b3.b3CreateWorld(worldDef);

// Stable GAME AGL datum: the flat launch/terrain plane remains visible to the
// rangefinder even when an OSM building is physically present above it.
const groundDef=b3.b3DefaultBodyDef();groundDef.position=[0,0,-.05];const ground=b3.b3CreateBody(world,groundDef),groundShape=b3.b3DefaultShapeDef();groundShape.filter={categoryBits:1n,maskBits:14n,groupIndex:0};b3.b3CreateBoxShape(ground,groundShape,10,10,.05);

const snapshot={hash:"fixture",footprintCount:3,prisms:[
  // A concave/triangulated source building can produce several convex prisms.
  // Only the first prism contains the launch point; the second prism is the seam
  // that used to catch left/right strafe immediately after takeoff.
  {buildingKey:"launch-house",base:0,top:3,points:[[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]]},
  {buildingKey:"launch-house",base:0,top:3,points:[[.5,-.5],[1.5,-.5],[1.5,.5],[.5,.5]]},
  {buildingKey:"house",base:0,top:2,points:[[2,-1],[3,-1],[3,1],[2,1]]},
  {buildingKey:"house-2",base:0,top:4,points:[[5,-1],[6,-1],[6,1],[5,1]]},
]};

const safeLaunch=findClearBuildingLaunchPoint(snapshot,{clearanceM:.20});
assert.ok(Math.hypot(...safeLaunch)>.70,`indoor launch was not moved outside the footprint: ${safeLaunch}`);
assert.ok(safeLaunch[1]<-.65,`nearest deterministic clear launch should leave through the closest lower wall: ${safeLaunch}`);

const countersBefore=b3.b3World_GetCounters(world);
const buildings=createWorldBuildingCollisionBodies(b3,world,snapshot,{categoryBits:1n,maskBits:14n,rangefinderCategoryBits:4n});
const countersAfter=b3.b3World_GetCounters(world);
assert.equal(buildings.shapeCount,2);assert.equal(buildings.prismCount,4);assert.equal(buildings.skippedLaunchPrisms,2);assert.equal(buildings.skippedLaunchBuildings,1);assert.equal(buildings.activePrisms.length,2);assert.equal(buildings.activePrisms[0].buildingKey,"house");assert.equal(buildings.activePrisms[1].buildingKey,"house-2");assert.equal(buildings.compoundChildCount,2);assert.equal(buildings.broadphaseShapeCount,1);assert.ok(buildings.compound);assert.ok(buildings.body&&b3.b3Body_IsValid(buildings.body));
// Box3D's static compound must collapse N convex building prisms to one top-level
// world shape/proxy; child culling happens in the compound's private BVH.
assert.equal(countersAfter.shapeCount-countersBefore.shapeCount,1,`compound leaked ${countersAfter.shapeCount-countersBefore.shapeCount} top-level world shapes for ${buildings.compoundChildCount} children`);

// Regression: OSM roofs/walls remain airframe colliders but must not become the
// altitude controller's AGL datum. A downward NAV query through the 2 m roof must
// continue to the stable ground at z=0 instead of stepping to the roof height.
const rayFilter=b3.b3DefaultQueryFilter();rayFilter.categoryBits=4n;rayFilter.maskBits=1n;
const aglGround=b3.b3World_CastRayClosest(world,[2.5,0,5],[0,0,-6],rayFilter);
assert.equal(aglGround.hit,true);assert.ok(Math.abs(5-6*aglGround.fraction)<.03,`building roof contaminated GAME AGL: point=${aglGround.point} fraction=${aglGround.fraction}`);assert.ok(aglGround.normal[2]>.98);

const wallCamera=resolveBox3dCameraPath(b3,world,[1.5,0,1],[3.5,0,1],{queryCategoryBits:8n,terrainCategoryBits:1n,clearanceM:.08});
assert.equal(wallCamera.collided,true);assert.ok(wallCamera.position[0]>1.5&&wallCamera.position[0]<1.95,`camera crossed building wall: ${JSON.stringify(wallCamera)}`);
const groundCamera=resolveBox3dCameraPath(b3,world,[0,0,1],[0,0,-1],{queryCategoryBits:8n,terrainCategoryBits:1n,clearanceM:.08});
assert.equal(groundCamera.collided,true);assert.ok(groundCamera.position[2]>=.075,`camera clipped ground: ${JSON.stringify(groundCamera)}`);
const clearCamera=resolveBox3dCameraPath(b3,world,[0,0,1],[0,0,2],{queryCategoryBits:8n,terrainCategoryBits:1n,clearanceM:.08});assert.equal(clearCamera.collided,false);assert.deepEqual(clearCamera.position,[0,0,2]);

function makeProbe({position=[0,0,1],velocity=[8,0,0]}={}){
  const bodyDef=b3.b3DefaultBodyDef();bodyDef.type=b3.b3BodyType.b3_dynamicBody;bodyDef.position=position;bodyDef.enableSleep=false;bodyDef.isBullet=true;
  const body=b3.b3CreateBody(world,bodyDef),shapeDef=b3.b3DefaultShapeDef();shapeDef.filter={categoryBits:2n,maskBits:1n,groupIndex:0};shapeDef.baseMaterial.friction=.2;shapeDef.baseMaterial.restitution=0;b3.b3CreateBoxShape(body,shapeDef,.1,.1,.1);b3.b3Body_SetLinearVelocity(body,velocity);return body;
}
function advance(body,steps=500){for(let index=0;index<steps;index++)b3.b3World_Step(world,.001,4);const position=[0,0,0];b3.b3Body_GetPosition(position,body);return position;}

// Regression: moving laterally away from an indoor launch must cross the old
// triangle boundary without chatter or blockage from another prism of that house.
const lateral=makeProbe({velocity:[4,0,0]}),lateralPosition=advance(lateral,250);assert.ok(lateralPosition[0]>.80,`launch-building sibling prism still blocks lateral strafe: ${lateralPosition}`);assert.ok(lateralPosition.every(Number.isFinite));b3.b3DestroyBody(lateral);

const blocked=makeProbe({position:[1.5,0,1]}),blockedPosition=advance(blocked);assert.ok(blockedPosition[0]<1.95,`continuous unrelated house wall collision failed: ${blockedPosition}`);assert.ok(blockedPosition.every(Number.isFinite));b3.b3DestroyBody(blocked);

destroyWorldBuildingCollisionBodies(b3,buildings);assert.equal(b3.b3Body_IsValid(buildings.body),false);assert.equal(b3.b3World_GetCounters(world).shapeCount,countersBefore.shapeCount);
const clear=makeProbe({position:[1.5,0,1]}),clearPosition=advance(clear);assert.ok(clearPosition[0]>3.5,`destroyed house collider still blocks: ${clearPosition}`);b3.b3DestroyBody(clear);
b3.b3DestroyWorld(world);

console.log("WORLD Box3D building collision passed: static compound BVH collapses multiple building prisms to one world shape while preserving launch exclusion, stable ground-only GAME AGL, camera occlusion, CCD wall contact and teardown.");
