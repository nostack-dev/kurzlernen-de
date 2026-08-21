import assert from "node:assert/strict";
import {pathToFileURL} from "node:url";
import {resolve} from "node:path";

const input=process.argv[2];
if(!input)throw new Error("usage: node tests/box3d_bullet_physics_test.mjs <box3d.inline.mjs>");
const Box3D=(await import(pathToFileURL(resolve(input)).href)).default;
const b3=await Box3D();
const CAR=2n,BULLET=32n;
const worldDef=b3.b3DefaultWorldDef();worldDef.gravity=[0,0,0];worldDef.enableContinuous=true;worldDef.maximumLinearSpeed=520;worldDef.hitEventThreshold=.1;
const world=b3.b3CreateWorld(worldDef);
try{
  const carDef=b3.b3DefaultBodyDef();carDef.type=b3.b3BodyType.b3_kinematicBody;carDef.position=[0,4,1];carDef.rotation=[0,0,0,1];carDef.enableSleep=false;
  const car=b3.b3CreateBody(world,carDef),carShapeDef=b3.b3DefaultShapeDef();carShapeDef.filter={categoryBits:CAR,maskBits:BULLET,groupIndex:0};carShapeDef.enableContactEvents=true;carShapeDef.enableHitEvents=true;const carShape=b3.b3CreateBoxShape(car,carShapeDef,1.82,.86,.72);
  assert.ok(carShape,"kinematic car shape was not created");
  b3.b3Body_SetTargetTransform(car,{position:[.15,4,1],quaternion:[0,0,0,1]},1/60,true);

  const bulletDef=b3.b3DefaultBodyDef();bulletDef.type=b3.b3BodyType.b3_dynamicBody;bulletDef.position=[0,0,1];bulletDef.rotation=[0,0,0,1];bulletDef.gravityScale=0;bulletDef.enableSleep=false;bulletDef.isBullet=true;
  const bullet=b3.b3CreateBody(world,bulletDef),bulletShapeDef=b3.b3DefaultShapeDef();bulletShapeDef.density=26;bulletShapeDef.filter={categoryBits:BULLET,maskBits:CAR,groupIndex:0};bulletShapeDef.enableContactEvents=true;bulletShapeDef.enableHitEvents=true;const bulletShape=b3.b3CreateSphereShape(bullet,bulletShapeDef,{center:[0,0,0],radius:.018});assert.ok(bulletShape,"bullet shape was not created");b3.b3Body_SetBullet(bullet,true);b3.b3Body_SetLinearVelocity(bullet,[0,430,0]);

  const events=b3.createEventsBuffer(),touch=b3.createContactTouchEvent(),hit=b3.createContactHitEvent();let begins=0,hits=0,impactSpeed=0;
  for(let i=0;i<20&&(begins===0&&hits===0);i++){
    b3.b3World_Step(world,1/120,2);b3.getEvents(events,world);
    const bn=b3.getNumContactBeginEvents(events);begins+=bn;if(bn){b3.getContactBeginEventAt(touch,events,0);assert.ok(touch.shapeIdA&&touch.shapeIdB,"contact event lost shape ids");}
    const hn=b3.getNumContactHitEvents(events);hits+=hn;if(hn){b3.getContactHitEventAt(hit,events,0);impactSpeed=Math.max(impactSpeed,Number(hit.approachSpeed)||0);}
  }
  b3.destroyEventsBuffer(events);
  assert.ok(begins>0||hits>0,`CCD bullet tunneled through kinematic car: begins=${begins} hits=${hits}`);
  assert.equal(b3.b3Body_GetType(car),b3.b3BodyType.b3_kinematicBody,"car is not a real Box3D kinematic body");
  console.log(`Box3D bullet physics passed: isBullet CCD hit real kinematic car, begins=${begins}, hits=${hits}, impactSpeed=${impactSpeed.toFixed(2)}`);
}finally{b3.b3DestroyWorld(world);}
