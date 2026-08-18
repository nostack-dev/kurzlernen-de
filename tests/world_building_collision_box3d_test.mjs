import assert from "node:assert/strict";
import {pathToFileURL} from "node:url";
import {resolve} from "node:path";
import {createWorldBuildingCollisionBodies,destroyWorldBuildingCollisionBodies,findClearBuildingLaunchPoint,resolveBox3dCameraPath} from "../sim/world_building_collision_physics.mjs";
import {COLLISION_TERRAIN,COLLISION_AIRFRAME,QUERY_RANGEFINDER,QUERY_CAMERA,QUERY_SPAWN,TERRAIN_MASK,BUILDING_MASK,AIRFRAME_MASK} from "../sim/collision_filter_matrix.mjs";

const modulePath=process.argv[2];
if(!modulePath)throw new Error("usage: node tests/world_building_collision_box3d_test.mjs <box3d.inline.mjs>");
const imported=await import(pathToFileURL(resolve(modulePath)).href),factory=imported.default;
if(typeof factory!=="function")throw new Error("Box3D inline module has no default factory");
const b3=await factory();
const worldDef=b3.b3DefaultWorldDef();worldDef.gravity=[0,0,0];worldDef.enableSleep=false;worldDef.enableContinuous=true;
const world=b3.b3CreateWorld(worldDef);

const groundDef=b3.b3DefaultBodyDef();groundDef.position=[0,0,-.05];const ground=b3.b3CreateBody(world,groundDef),groundShape=b3.b3DefaultShapeDef();groundShape.filter={categoryBits:COLLISION_TERRAIN,maskBits:TERRAIN_MASK,groupIndex:0};b3.b3CreateBoxShape(ground,groundShape,10,10,.05);

const snapshot={hash:"fixture",footprintCount:2,prisms:[
  {buildingKey:"launch-house",base:0,top:3,points:[[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]]},
  {buildingKey:"launch-house",base:0,top:3,points:[[.5,-.5],[1.5,-.5],[1.5,.5],[.5,.5]]},
  {buildingKey:"house",base:0,top:2,points:[[2,-1],[3,-1],[3,1],[2,1]]},
]};

const safeLaunch=findClearBuildingLaunchPoint(snapshot,{clearanceM:.20});
assert.ok(Math.hypot(...safeLaunch)>.70,`indoor launch was not moved outside the footprint: ${safeLaunch}`);

const buildings=createWorldBuildingCollisionBodies(b3,world,snapshot,{categoryBits:COLLISION_TERRAIN,maskBits:BUILDING_MASK});
assert.equal(buildings.shapeCount,3);assert.equal(buildings.prismCount,3);assert.equal(buildings.skippedLaunchPrisms,0);assert.equal(buildings.skippedLaunchBuildings,0);assert.equal(buildings.activePrisms.length,3);assert.ok(buildings.body&&b3.b3Body_IsValid(buildings.body));

const cast=(category,origin,translation)=>{const filter=b3.b3DefaultQueryFilter();filter.categoryBits=category;filter.maskBits=COLLISION_TERRAIN;return b3.b3World_CastRayClosest(world,origin,translation,filter);};
// GAME AGL sees terrain through the roof because BUILDING_MASK deliberately omits QUERY_RANGEFINDER.
const aglGround=cast(QUERY_RANGEFINDER,[2.5,0,5],[0,0,-6]);
assert.equal(aglGround.hit,true);assert.ok(Math.abs(aglGround.point[2])<.03,`building roof contaminated GAME AGL: ${aglGround.point}`);assert.ok(aglGround.normal[2]>.98);
// Dedicated spawn query sees the preserved launch building, so safe-spawn can reject (0,0).
const spawnRoof=cast(QUERY_SPAWN,[0,0,5],[0,0,-6]);assert.equal(spawnRoof.hit,true);assert.ok(Math.abs(spawnRoof.point[2]-3)<.04,`spawn query missed launch roof: ${spawnRoof.point}`);
const cameraRoof=cast(QUERY_CAMERA,[0,0,5],[0,0,-6]);assert.equal(cameraRoof.hit,true);assert.ok(Math.abs(cameraRoof.point[2]-3)<.04,`camera query missed launch roof: ${cameraRoof.point}`);

const wallCamera=resolveBox3dCameraPath(b3,world,[1.5,0,1],[3.5,0,1],{queryCategoryBits:QUERY_CAMERA,terrainCategoryBits:COLLISION_TERRAIN,clearanceM:.08});
assert.equal(wallCamera.collided,true);assert.ok(wallCamera.position[0]>1.5&&wallCamera.position[0]<1.95,`camera crossed building wall: ${JSON.stringify(wallCamera)}`);
const groundCamera=resolveBox3dCameraPath(b3,world,[-2,0,1],[-2,0,-1],{queryCategoryBits:QUERY_CAMERA,terrainCategoryBits:COLLISION_TERRAIN,clearanceM:.08});
assert.equal(groundCamera.collided,true);assert.ok(groundCamera.position[2]>=.075,`camera clipped ground: ${JSON.stringify(groundCamera)}`);

function makeProbe({position=[-1.5,0,1],velocity=[8,0,0]}={}){
  const bodyDef=b3.b3DefaultBodyDef();bodyDef.type=b3.b3BodyType.b3_dynamicBody;bodyDef.position=position;bodyDef.enableSleep=false;bodyDef.isBullet=true;
  const body=b3.b3CreateBody(world,bodyDef),shapeDef=b3.b3DefaultShapeDef();shapeDef.filter={categoryBits:COLLISION_AIRFRAME,maskBits:AIRFRAME_MASK,groupIndex:0};shapeDef.baseMaterial.friction=.2;shapeDef.baseMaterial.restitution=0;b3.b3CreateBoxShape(body,shapeDef,.1,.1,.1);b3.b3Body_SetLinearVelocity(body,velocity);return body;
}
function advance(body,steps=500){for(let index=0;index<steps;index++)b3.b3World_Step(world,.001,4);const position=[0,0,0];b3.b3Body_GetPosition(position,body);return position;}

const launchBlocked=makeProbe(),launchBlockedPosition=advance(launchBlocked,300);assert.ok(launchBlockedPosition[0]<-.55,`launch building was punched out of physics: ${launchBlockedPosition}`);b3.b3DestroyBody(launchBlocked);
const blocked=makeProbe({position:[1.5,0,1]}),blockedPosition=advance(blocked);assert.ok(blockedPosition[0]<1.95,`continuous unrelated house wall collision failed: ${blockedPosition}`);b3.b3DestroyBody(blocked);

destroyWorldBuildingCollisionBodies(b3,buildings);assert.equal(b3.b3Body_IsValid(buildings.body),false);
const clear=makeProbe({position:[1.5,0,1]}),clearPosition=advance(clear);assert.ok(clearPosition[0]>3.5,`destroyed house collider still blocks: ${clearPosition}`);b3.b3DestroyBody(clear);
b3.b3DestroyWorld(world);

console.log("WORLD Box3D collision passed: launch buildings preserved, AGL ignores roofs, camera/spawn hit geometry, airframe collides, teardown clears.");
