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

const groundDef=b3.b3DefaultBodyDef();groundDef.position=[0,0,-.05];const ground=b3.b3CreateBody(world,groundDef),groundShape=b3.b3DefaultShapeDef();groundShape.filter={categoryBits:1n,maskBits:14n,groupIndex:0};b3.b3CreateBoxShape(ground,groundShape,10,10,.05);

const snapshot={hash:"fixture",footprintCount:2,prisms:[
  {buildingKey:"launch-house",base:0,top:3,points:[[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]]},
  {buildingKey:"launch-house",base:0,top:3,points:[[.5,-.5],[1.5,-.5],[1.5,.5],[.5,.5]]},
  {buildingKey:"house",base:0,top:2,points:[[2,-1],[3,-1],[3,1],[2,1]]},
]};

const safeLaunch=findClearBuildingLaunchPoint(snapshot,{clearanceM:.20});
assert.ok(Math.hypot(...safeLaunch)>.70,`indoor launch was not moved outside the footprint: ${safeLaunch}`);
assert.ok(safeLaunch[1]<-.65,`nearest deterministic clear launch should leave through the closest lower wall: ${safeLaunch}`);

const buildings=createWorldBuildingCollisionBodies(b3,world,snapshot,{categoryBits:1n,maskBits:14n,rangefinderCategoryBits:4n,projectileCategoryBits:16n,launchExclusionPoint:safeLaunch});
assert.equal(buildings.shapeCount,3);assert.equal(buildings.prismCount,3);assert.equal(buildings.skippedLaunchPrisms,0);assert.equal(buildings.skippedLaunchBuildings,0);assert.equal(buildings.activePrisms.length,3);assert.ok(buildings.body&&b3.b3Body_IsValid(buildings.body));assert.equal(buildings.projectileCategoryBits,16n);

const rayFilter=b3.b3DefaultQueryFilter();rayFilter.categoryBits=4n;rayFilter.maskBits=1n;
const aglGround=b3.b3World_CastRayClosest(world,[2.5,0,5],[0,0,-6],rayFilter);
assert.equal(aglGround.hit,true);assert.ok(Math.abs(5-6*aglGround.fraction)<.03,`building roof contaminated GAME AGL: point=${aglGround.point} fraction=${aglGround.fraction}`);assert.ok(aglGround.normal[2]>.98);

const projectileFilter=b3.b3DefaultQueryFilter();projectileFilter.categoryBits=16n;projectileFilter.maskBits=1n;
const projectileHit=b3.b3World_CastRayClosest(world,[1.5,0,1],[2.0,0,0],projectileFilter);
assert.equal(projectileHit.hit,true,"projectile query was incorrectly filtered out by building mask");assert.ok(projectileHit.fraction>.20&&projectileHit.fraction<.30,`projectile hit fraction wrong: ${projectileHit.fraction}`);

const wallCamera=resolveBox3dCameraPath(b3,world,[1.5,0,1],[3.5,0,1],{queryCategoryBits:8n,terrainCategoryBits:1n,clearanceM:.03,cameraRadiusM:.15});
assert.equal(wallCamera.collided,true);assert.ok(wallCamera.cameraRadiusM>=.149);assert.ok(wallCamera.position[0]>1.5&&wallCamera.position[0]<1.84,`camera volume crossed building wall: ${JSON.stringify(wallCamera)}`);
const groundCamera=resolveBox3dCameraPath(b3,world,[0,0,1],[0,0,-1],{queryCategoryBits:8n,terrainCategoryBits:1n,clearanceM:.03,cameraRadiusM:.15});
assert.equal(groundCamera.collided,true);assert.ok(groundCamera.position[2]>=.17,`camera volume clipped ground: ${JSON.stringify(groundCamera)}`);
const cornerCamera=resolveBox3dCameraPath(b3,world,[1.4,-1.6,1],[2.6,-.4,1],{queryCategoryBits:8n,terrainCategoryBits:1n,clearanceM:.02,cameraRadiusM:.16});
assert.equal(cornerCamera.collided,true);assert.ok(cornerCamera.position[0]<1.9||cornerCamera.position[1]<-1.1,`camera volume entered building corner: ${JSON.stringify(cornerCamera)}`);
const clearCamera=resolveBox3dCameraPath(b3,world,[0,0,1],[0,0,2],{queryCategoryBits:8n,terrainCategoryBits:1n,clearanceM:.03,cameraRadiusM:.15});assert.equal(clearCamera.collided,false);assert.deepEqual(clearCamera.position,[0,0,2]);
const lowAnchorCamera=resolveBox3dCameraPath(b3,world,[0,0,.024],[.095,0,.084],{queryCategoryBits:8n,terrainCategoryBits:1n,clearanceM:.01,cameraRadiusM:.09});
assert.ok(lowAnchorCamera.cameraRadiusM<.025,`low FPV anchor did not reduce camera volume: ${JSON.stringify(lowAnchorCamera)}`);assert.ok(lowAnchorCamera.position.every(Number.isFinite));

function makeProbe({position=[0,0,1],velocity=[8,0,0]}={}){
  const bodyDef=b3.b3DefaultBodyDef();bodyDef.type=b3.b3BodyType.b3_dynamicBody;bodyDef.position=position;bodyDef.enableSleep=false;bodyDef.isBullet=true;
  const body=b3.b3CreateBody(world,bodyDef),shapeDef=b3.b3DefaultShapeDef();shapeDef.filter={categoryBits:2n,maskBits:1n,groupIndex:0};shapeDef.baseMaterial.friction=.2;shapeDef.baseMaterial.restitution=0;b3.b3CreateBoxShape(body,shapeDef,.1,.1,.1);b3.b3Body_SetLinearVelocity(body,velocity);return body;
}
function advance(body,steps=500){for(let index=0;index<steps;index++)b3.b3World_Step(world,.001,4);const position=[0,0,0];b3.b3Body_GetPosition(position,body);return position;}

const lateral=makeProbe({position:[safeLaunch[0],safeLaunch[1],1],velocity:[0,-4,0]}),lateralPosition=advance(lateral,250);assert.ok(lateralPosition[1]<safeLaunch[1]-.75,`relocated launch is not clear of the building: ${lateralPosition}`);assert.ok(lateralPosition.every(Number.isFinite));b3.b3DestroyBody(lateral);
const blocked=makeProbe({position:[1.5,0,1]}),blockedPosition=advance(blocked);assert.ok(blockedPosition[0]<1.95,`continuous unrelated house wall collision failed: ${blockedPosition}`);assert.ok(blockedPosition.every(Number.isFinite));b3.b3DestroyBody(blocked);

destroyWorldBuildingCollisionBodies(b3,buildings);assert.equal(b3.b3Body_IsValid(buildings.body),false);
const clear=makeProbe({position:[1.5,0,1]}),clearPosition=advance(clear);assert.ok(clearPosition[0]>3.5,`destroyed house collider still blocks: ${clearPosition}`);b3.b3DestroyBody(clear);
b3.b3DestroyWorld(world);

// Gameplay regression: the car is a real Box3D kinematic body and the projectile is
// a real dynamic isBullet body. A 430 m/s round must generate a Box3D contact event.
const combatDef=b3.b3DefaultWorldDef();combatDef.gravity=[0,0,0];combatDef.enableContinuous=true;combatDef.maximumLinearSpeed=520;combatDef.hitEventThreshold=.1;const combatWorld=b3.b3CreateWorld(combatDef),CAR=2n,BULLET=32n;
const carDef=b3.b3DefaultBodyDef();carDef.type=b3.b3BodyType.b3_kinematicBody;carDef.position=[0,4,1];carDef.rotation=[0,0,0,1];carDef.enableSleep=false;const car=b3.b3CreateBody(combatWorld,carDef),carShapeDef=b3.b3DefaultShapeDef();carShapeDef.filter={categoryBits:CAR,maskBits:BULLET,groupIndex:0};carShapeDef.enableContactEvents=true;carShapeDef.enableHitEvents=true;b3.b3CreateBoxShape(car,carShapeDef,1.82,.86,.72);b3.b3Body_SetTargetTransform(car,{position:[.15,4,1],quaternion:[0,0,0,1]},1/60,true);
const bulletDef=b3.b3DefaultBodyDef();bulletDef.type=b3.b3BodyType.b3_dynamicBody;bulletDef.position=[0,0,1];bulletDef.rotation=[0,0,0,1];bulletDef.gravityScale=0;bulletDef.enableSleep=false;bulletDef.isBullet=true;const bullet=b3.b3CreateBody(combatWorld,bulletDef),bulletShapeDef=b3.b3DefaultShapeDef();bulletShapeDef.density=26;bulletShapeDef.filter={categoryBits:BULLET,maskBits:CAR,groupIndex:0};bulletShapeDef.enableContactEvents=true;bulletShapeDef.enableHitEvents=true;b3.b3CreateSphereShape(bullet,bulletShapeDef,{center:[0,0,0],radius:.018});b3.b3Body_SetBullet(bullet,true);b3.b3Body_SetLinearVelocity(bullet,[0,430,0]);
const events=b3.createEventsBuffer(),touch=b3.createContactTouchEvent(),hit=b3.createContactHitEvent();let beginCount=0,hitCount=0,impactSpeed=0;for(let i=0;i<20&&(beginCount===0&&hitCount===0);i++){b3.b3World_Step(combatWorld,1/120,2);b3.getEvents(events,combatWorld);const bn=b3.getNumContactBeginEvents(events);beginCount+=bn;if(bn){b3.getContactBeginEventAt(touch,events,0);assert.ok(touch.shapeIdA&&touch.shapeIdB);}const hn=b3.getNumContactHitEvents(events);hitCount+=hn;if(hn){b3.getContactHitEventAt(hit,events,0);impactSpeed=Math.max(impactSpeed,Number(hit.approachSpeed)||0);}}
assert.ok(beginCount>0||hitCount>0,`Box3D CCD bullet tunneled through kinematic car: begins=${beginCount} hits=${hitCount}`);assert.equal(b3.b3Body_GetType(car),b3.b3BodyType.b3_kinematicBody);b3.destroyEventsBuffer(events);b3.b3DestroyWorld(combatWorld);

console.log(`WORLD Box3D physics passed: launch/AGL/camera/buildings plus real isBullet CCD vs kinematic car (begins=${beginCount}, hits=${hitCount}, speed=${impactSpeed.toFixed(2)}).`);
