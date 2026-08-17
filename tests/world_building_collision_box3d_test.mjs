import assert from "node:assert/strict";
import {pathToFileURL} from "node:url";
import {resolve} from "node:path";
import {createWorldBuildingCollisionBodies,destroyWorldBuildingCollisionBodies} from "../sim/world_building_collision_physics.mjs";

const modulePath=process.argv[2];
if(!modulePath)throw new Error("usage: node tests/world_building_collision_box3d_test.mjs <box3d.inline.mjs>");
const imported=await import(pathToFileURL(resolve(modulePath)).href),factory=imported.default;
if(typeof factory!=="function")throw new Error("Box3D inline module has no default factory");
const b3=await factory();
const worldDef=b3.b3DefaultWorldDef();worldDef.gravity=[0,0,0];worldDef.enableSleep=false;worldDef.enableContinuous=true;
const world=b3.b3CreateWorld(worldDef);
const snapshot={hash:"fixture",footprintCount:2,prisms:[
  {buildingKey:"launch-house",base:0,top:3,points:[[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]]},
  {buildingKey:"house",base:0,top:2,points:[[1,-1],[2,-1],[2,1],[1,1]]},
]};
const buildings=createWorldBuildingCollisionBodies(b3,world,snapshot,{categoryBits:1n,maskBits:6n});
assert.equal(buildings.shapeCount,1);assert.equal(buildings.prismCount,2);assert.equal(buildings.skippedLaunchPrisms,1);assert.ok(buildings.body&&b3.b3Body_IsValid(buildings.body));

// The launch-containing prism is omitted, but normal building roofs still remain
// valid rangefinder surfaces once the aircraft is outside the bad spawn prism.
const rayFilter=b3.b3DefaultQueryFilter();rayFilter.categoryBits=4n;rayFilter.maskBits=1n;
const roof=b3.b3World_CastRayClosest(world,[1.5,0,5],[0,0,-6],rayFilter);
assert.equal(roof.hit,true);assert.ok(Math.abs((5-6*roof.fraction)-2)<.03,`roof height mismatch: point=${roof.point} fraction=${roof.fraction}`);assert.ok(roof.normal[2]>.98);

function makeProbe(){
  const bodyDef=b3.b3DefaultBodyDef();bodyDef.type=b3.b3BodyType.b3_dynamicBody;bodyDef.position=[0,0,1];bodyDef.enableSleep=false;bodyDef.isBullet=true;
  const body=b3.b3CreateBody(world,bodyDef),shapeDef=b3.b3DefaultShapeDef();shapeDef.filter={categoryBits:2n,maskBits:1n,groupIndex:0};shapeDef.baseMaterial.friction=.2;shapeDef.baseMaterial.restitution=0;b3.b3CreateBoxShape(body,shapeDef,.1,.1,.1);b3.b3Body_SetLinearVelocity(body,[8,0,0]);return body;
}
function advance(body,steps=500){for(let index=0;index<steps;index++)b3.b3World_Step(world,.001,4);const position=[0,0,0];b3.b3Body_GetPosition(position,body);return position;}
const blocked=makeProbe(),blockedPosition=advance(blocked);assert.ok(blockedPosition[0]<.95,`continuous house wall collision failed: ${blockedPosition}`);assert.ok(blockedPosition.every(Number.isFinite));b3.b3DestroyBody(blocked);

destroyWorldBuildingCollisionBodies(b3,buildings);assert.equal(b3.b3Body_IsValid(buildings.body),false);
const clear=makeProbe(),clearPosition=advance(clear);assert.ok(clearPosition[0]>2.5,`destroyed house collider still blocks: ${clearPosition}`);b3.b3DestroyBody(clear);
b3.b3DestroyWorld(world);

console.log("WORLD Box3D building collision passed: launch-inside exclusion, roof ray, continuous wall contact and collider teardown use real box3d.js 3D shapes.");
