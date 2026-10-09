import {TerrainTiles} from "./terrain_tiles.mjs";
import {createTerrainBody,waterAt,waterFlowAt,waterLevelAt,groundHeightAt,terrainRescueZ} from "./terrain_craters.mjs";
import {vehicleSpec,vehicleUpperBody,vehicleGroundOffset,attachWheels,detachWheels,placeWheels,driveWheeled,wheelPoses} from "./world_vehicle_dynamics.mjs";
import {createBox3dHuman,destroyBox3dHuman} from "./box3d_human.mjs";
import {createWorldBuildingCollisionBodies,destroyWorldBuildingCollisionBodies,normalizeBuildingCollisionSnapshot} from "./world_building_collision_physics.mjs";

export const WORLD_PHYSICS_CATEGORIES=Object.freeze({terrain:1n,vehicle:2n,drone:4n,projectileQuery:8n});
const ALL_DYNAMIC=WORLD_PHYSICS_CATEGORIES.vehicle|WORLD_PHYSICS_CATEGORIES.drone;
const PROJECTILE_QUERY_MASK=WORLD_PHYSICS_CATEGORIES.terrain|ALL_DYNAMIC;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));
const wrap=value=>{let angle=(Number(value)||0)%(Math.PI*2);if(angle>Math.PI)angle-=Math.PI*2;if(angle<-Math.PI)angle+=Math.PI*2;return angle;};
const length3=value=>Math.hypot(Number(value?.[0])||0,Number(value?.[1])||0,Number(value?.[2])||0);
const yawQuaternion=yaw=>[0,0,Math.sin((Number(yaw)||0)/2),Math.cos((Number(yaw)||0)/2)];
const quaternionYaw=q=>Math.atan2(2*((Number(q?.[3])||1)*(Number(q?.[2])||0)+(Number(q?.[0])||0)*(Number(q?.[1])||0)),1-2*((Number(q?.[1])||0)**2+(Number(q?.[2])||0)**2));
const shapeKey=id=>`${Number(id?.index1)||0}:${Number(id?.world0)||0}:${Number(id?.generation)||0}`;

function finiteVector(value,length=3){return Array.isArray(value)&&value.length===length&&value.every(Number.isFinite);}
function limitedVector(value,maxLength){const vector=[Number(value?.[0])||0,Number(value?.[1])||0,Number(value?.[2])||0],magnitude=length3(vector),limit=Math.max(0,Number(maxLength)||0);if(limit&&magnitude>limit){const scale=limit/magnitude;return vector.map(component=>component*scale);}return vector;}

export class WorldRigidBodyPhysics{
  constructor(b3,{buildingSnapshot=null,onImpact=null}={}){
    if(!b3?.b3CreateWorld||!b3?.b3CreateBody)throw Error("Box3D runtime is required");this.b3=b3;this.onImpact=typeof onImpact==="function"?onImpact:null;this.records=new Map();this.shapeRecords=new Map();this.impactCount=0;this.stepCount=0;this.buildingState=null;this.buildingSnapshot=normalizeBuildingCollisionSnapshot(null);this.eventsBuffer=typeof b3.createEventsBuffer==="function"?b3.createEventsBuffer():null;this.hitEvent=typeof b3.createContactHitEvent==="function"?b3.createContactHitEvent():null;
    const worldDef=b3.b3DefaultWorldDef();worldDef.gravity=[0,0,-9.80665];worldDef.enableSleep=true;worldDef.enableContinuous=true;worldDef.hitEventThreshold=1.25;worldDef.maximumLinearSpeed=1200;/* jets fly supersonic; Box3D defaults to 400 m/s */this.world=b3.b3CreateWorld(worldDef);
    this.terrainBodies=[];this.rebuildTerrain();this.syncBuildings(buildingSnapshot);
  }
  // Shared terrain (terrain_craters.mjs): flat ground with crater bowls and
  // real river/lake basins + bridge decks, so cars sink into water, float
  // and drift. Rebuilt when the terrain changes.
  rebuildTerrain(regions=null){const b3=this.b3,shapeDef=b3.b3DefaultShapeDef();shapeDef.baseMaterial.friction=.82;shapeDef.baseMaterial.restitution=.025;shapeDef.filter={categoryBits:WORLD_PHYSICS_CATEGORIES.terrain,maskBits:ALL_DYNAMIC|WORLD_PHYSICS_CATEGORIES.projectileQuery,groupIndex:0};
    this.terrainTiles??=new TerrainTiles(b3,this.world,shapeDef,{floorHalfM:10000});
    if(this.terrainTiles.available){const full=regions===null;this.terrainTiles.update(regions);this.terrainBodies=this.terrainTiles.bodies;this.ground=this.terrainBodies[0]||null;if(!full){if(this.records)this.rescueFromTerrain();return this.terrainTiles.shapeCount;}}
    else{for(const body of this.terrainBodies||[])if(b3.b3Body_IsValid?.(body)!==false)b3.b3DestroyBody(body);const{bodies}=createTerrainBody(b3,this.world,shapeDef,10000);this.terrainBodies=bodies;this.ground=bodies[0]||null;}
    // building colliders stand on the terrain too: re-create them with the new ground
    if(this.buildingSnapshot?.prismCount){const snap=this.buildingSnapshot;this.buildingSnapshot={...snap,hash:"__terrain-changed"};this.syncBuildings(snap);}
    if(this.records)this.rescueFromTerrain();
    return this.terrainBodies.length;}
  syncBuildings(value){const snapshot=normalizeBuildingCollisionSnapshot(value);if(snapshot.hash===this.buildingSnapshot.hash&&snapshot.prismCount===this.buildingSnapshot.prismCount)return false;destroyWorldBuildingCollisionBodies(this.b3,this.buildingState);this.buildingSnapshot=snapshot;this.buildingState=createWorldBuildingCollisionBodies(this.b3,this.world,snapshot,{categoryBits:WORLD_PHYSICS_CATEGORIES.terrain,maskBits:ALL_DYNAMIC|WORLD_PHYSICS_CATEGORIES.projectileQuery,rangefinderCategoryBits:0n,launchExclusionPoint:[Infinity,Infinity]});return true;}
  shapeKeyOf(shape){return shapeKey(shape);}
  addBody({id,kind="vehicle",position=[0,0,0],yaw=0,halfExtents=[1,.5,.5],massKg=1000,gravityScale,linearDamping,angularDamping,wheeled=true,hulls=null,inertia=null,friction=null,restitution=null,controller=null,sleep=false}={}){
    // cars and buses are real wheeled vehicles (chassis + 4 wheel joints)
    const spec=wheeled&&typeof this.b3.b3CreateWheelJoint==="function"?vehicleSpec(kind==='vehicle'?null:kind):null;if(spec&&finiteVector(position)){halfExtents=[...spec.half];massKg=spec.mass;const gz=groundHeightAt(position[0],position[1])+vehicleGroundOffset(spec)+.06;position=[position[0],position[1],Math.max(position[2],gz)];}
    const key=String(id||"");if(!key||!finiteVector(position)||!finiteVector(halfExtents)||halfExtents.some(value=>!(value>.02)))return null;this.removeBody(key);const drone=kind==="drone"||kind==="police-drone",category=drone?WORLD_PHYSICS_CATEGORIES.drone:WORLD_PHYSICS_CATEGORIES.vehicle,b3=this.b3,bodyDef=b3.b3DefaultBodyDef(),resolvedGravityScale=Number.isFinite(gravityScale)?gravityScale:drone?0:1;bodyDef.type=b3.b3BodyType.b3_dynamicBody;bodyDef.position=[...position];bodyDef.rotation=yawQuaternion(yaw);bodyDef.linearDamping=Number.isFinite(linearDamping)?linearDamping:drone? .42:spec?.03:.16;bodyDef.angularDamping=Number.isFinite(angularDamping)?angularDamping:drone?1.15:spec?.08:.78;bodyDef.gravityScale=resolvedGravityScale;bodyDef.enableSleep=Boolean(sleep);bodyDef.isBullet=!sleep;const body=b3.b3CreateBody(this.world,bodyDef),shapeDef=b3.b3DefaultShapeDef(),volume=8*halfExtents[0]*halfExtents[1]*halfExtents[2];shapeDef.density=Math.max(.01,(Number(massKg)||1)/Math.max(.01,volume));shapeDef.baseMaterial.friction=drone? .48:.18;shapeDef.baseMaterial.restitution=drone? .12:.035;shapeDef.enableContactEvents=true;shapeDef.enableHitEvents=true;shapeDef.filter={categoryBits:category,maskBits:WORLD_PHYSICS_CATEGORIES.terrain|ALL_DYNAMIC|WORLD_PHYSICS_CATEGORIES.projectileQuery,groupIndex:0};if(Number.isFinite(friction))shapeDef.baseMaterial.friction=friction;if(Number.isFinite(restitution))shapeDef.baseMaterial.restitution=restitution;
    // convex hulls (an airframe: fuselage + wing) instead of one box; mass and principal inertia then set explicitly
    let shape=null;const extraShapes=[];
    if(Array.isArray(hulls)&&hulls.length){for(const points of hulls){const hull=b3.b3CreateHull(points);if(!hull)continue;try{const sh=b3.b3CreateHullShape(body,shapeDef,hull);if(shape)extraShapes.push(sh);else shape=sh;}finally{b3.b3DestroyHull(hull);}}}
    // wheeled vehicles: chassis box + the upper body as drawn (greenhouse / bus roof), the mass split between them
    const upper=spec?vehicleUpperBody(spec):null;if(!shape&&upper){shapeDef.density=Math.max(.01,(massKg-upper.mass)/Math.max(.01,volume));}
    if(!shape)shape=b3.b3CreateBoxShape(body,shapeDef,...halfExtents);
    if(upper){const hull=b3.b3CreateHull(upper.points);if(hull){try{shapeDef.density=upper.mass/upper.volume;extraShapes.push(b3.b3CreateHullShape(body,shapeDef,hull));}finally{b3.b3DestroyHull(hull);}}}
    if(finiteVector(inertia)&&typeof b3.b3Body_SetMassData==="function")b3.b3Body_SetMassData(body,{mass:Math.max(.1,Number(massKg)||1),center:[0,0,0],inertia:{cx:[inertia[0],0,0],cy:[0,inertia[1],0],cz:[0,0,inertia[2]]}});
    const record={id:key,kind:String(kind||"vehicle"),body,shape,extraShapes,controller:typeof controller==="function"?controller:null,halfExtents:[...halfExtents],massKg:Math.max(.1,Number(massKg)||1),gravityScale:resolvedGravityScale,drone,target:null,pendingImpulse:[0,0,0],impulsePoint:null,preVelocity:[0,0,0],lastVelocity:[0,0,0],stepPosition:[0,0,0],stepVelocity:[0,0,0],stepAngular:[0,0,0],stepRotation:[0,0,0,1],postVelocity:[0,0,0],lastImpactAt:-Infinity,impactCount:0};this.records.set(key,record);this.shapeRecords.set(shapeKey(shape),record);for(const sh of extraShapes)this.shapeRecords.set(shapeKey(sh),record);
    if(spec){try{attachWheels(this,record,spec,{category,mask:WORLD_PHYSICS_CATEGORIES.terrain|ALL_DYNAMIC|WORLD_PHYSICS_CATEGORIES.projectileQuery,terrain:WORLD_PHYSICS_CATEGORIES.terrain});}catch(error){console.warn("vehicle wheels",error);record.wheels=null;}}
    return record;
  }
  removeBody(id){const key=String(id||""),record=this.records.get(key);if(!record)return false;if(record.wheels)detachWheels(this,record);this.records.delete(key);this.shapeRecords.delete(shapeKey(record.shape));for(const sh of record.extraShapes||[])this.shapeRecords.delete(shapeKey(sh));if(record.body&&this.b3.b3Body_IsValid(record.body))this.b3.b3DestroyBody(record.body);return true;}
  setTarget(id,{position,speedMps=0,response=3.2,maxAccelerationMps2,yaw=null}={}){
    const record=this.records.get(String(id||""));if(!record||!finiteVector(position))return false;
    const target=record.target||(record.target={position:[0,0,0],speedMps:0,response:3.2,maxAccelerationMps2:6,yaw:null});target.position[0]=position[0];target.position[1]=position[1];target.position[2]=position[2];target.speedMps=Math.max(0,Number(speedMps)||0);target.response=clamp(response,.2,10);target.maxAccelerationMps2=clamp(maxAccelerationMps2??(record.drone?13:6),.5,30);target.yaw=Number.isFinite(yaw)?Number(yaw):null;return true;
  }
  clearTarget(id){const record=this.records.get(String(id||""));if(!record)return false;record.target=null;return true;}
  // Player driving is accepted only for the real chassis + wheel-joint model.
  // No velocity/yaw/pose fallback is allowed for a drivable vehicle.
  setDrive(id,drive=null){const record=this.records.get(String(id||""));if(!record)return false;if(!drive){record.drive=null;record.steerAngle=0;return true;}if(!record.wheels?.length)return false;record.drive={pedal:clamp(drive.pedal,-1,1),steer:clamp(drive.steer,-1,1),handbrake:Boolean(drive.handbrake),maxSpeed:clamp(drive.maxSpeed??36,4,80),maxReverse:clamp(drive.maxReverse??9,1,30)};record.target=null;record.steerAngle??=0;return true;}
  setPose(id,{position,yaw=null,rotation:q=null,velocity=[0,0,0],angularVelocity=[0,0,0]}={}){
    const record=this.records.get(String(id||""));if(!record||!finiteVector(position)||!finiteVector(velocity)||!finiteVector(angularVelocity)||!this.b3.b3Body_IsValid(record.body))return false;const qn=Array.isArray(q)&&q.length===4&&q.every(Number.isFinite)?Math.hypot(...q):0,rotation=qn>.5?q.map(v=>v/qn):Number.isFinite(yaw)?yawQuaternion(yaw):this.b3.b3Body_GetRotation([0,0,0,1],record.body);this.b3.b3Body_SetTransform(record.body,[...position],rotation);this.b3.b3Body_SetLinearVelocity(record.body,[...velocity]);this.b3.b3Body_SetAngularVelocity(record.body,[...angularVelocity]);this.b3.b3Body_SetAwake?.(record.body,true);record.pendingImpulse=[0,0,0];record.impulsePoint=null;record.preVelocity=[...velocity];record.lastVelocity=[...velocity];if(record.wheels)placeWheels(this,record);return true;
  }
  setGravityScale(id,gravityScale=1){const record=this.records.get(String(id||"")),value=Number(gravityScale);if(!record||!Number.isFinite(value)||typeof this.b3.b3Body_SetGravityScale!=="function")return false;record.gravityScale=clamp(value,0,4);this.b3.b3Body_SetGravityScale(record.body,record.gravityScale);this.b3.b3Body_SetAwake?.(record.body,true);return true;}
  // A per-step force model (aircraft): fn(state,dt,engine) -> {force,torque}, called inside every
  // fixed physics step with the body's live state, so the model never sees a stale pose.
  // surface grip of a body (e.g. an animal: paws give traction while it walks, a carcass grinds to a stop)
  setFriction(id,friction){const record=this.records.get(String(id||""));if(!record||!Number.isFinite(friction)||typeof this.b3.b3Shape_SetFriction!=="function")return false;for(const sh of[record.shape,...(record.extraShapes||[])])this.b3.b3Shape_SetFriction(sh,friction);return true;}
  // Box3D ragdoll humans (box3d_human.mjs): jointed bodies that collide with terrain, buildings and vehicles
  createHuman(id,opts={}){const key=String(id||"");if(!key||!this.world)return null;this.removeHuman(key);this.humans??=new Map();this.humanGroup=(this.humanGroup||0)%30000+1;
    const h=createBox3dHuman(this.b3,this.world,{...opts,groupIndex:this.humanGroup,categoryBits:WORLD_PHYSICS_CATEGORIES.vehicle,maskBits:WORLD_PHYSICS_CATEGORIES.terrain|ALL_DYNAMIC|WORLD_PHYSICS_CATEGORIES.projectileQuery});this.humans.set(key,h);return h;}
  human(id){return this.humans?.get(String(id||""))||null;}
  removeHuman(id){const h=this.humans?.get(String(id||""));if(!h)return false;destroyBox3dHuman(this.b3,h);this.humans.delete(String(id));return true;}
  applyAngularImpulse(id,L){const record=this.records.get(String(id||""));if(!record||!finiteVector(L)||!this.b3.b3Body_IsValid(record.body))return false;this.b3.b3Body_ApplyAngularImpulse(record.body,[...L],true);return true;}
  // a bullet in a ragdoll: its whole momentum goes into the bone it hits, at the hit point (a 2 kg
  // forearm takes a .50 round's 41 N·s as ~20 m/s; the joints hand it on to the rest of the body)
  impulseHumanAt(point,impulse,radius=.9){if(!finiteVector(point)||!finiteVector(impulse)||!this.humans?.size)return false;let best=null,bestD=radius;
    for(const h of this.humans.values())for(const b of h.bodies){if(!this.b3.b3Body_IsValid(b))continue;const p=this.b3.b3Body_GetPosition([0,0,0],b),d=Math.hypot(p[0]-point[0],p[1]-point[1],p[2]-point[2]);if(d<bestD){bestD=d;best=b;}}
    if(!best)return false;this.b3.b3Body_ApplyLinearImpulse(best,[...impulse],[...point],true);return true;}
  // a blast / hit: the same velocity change for every bone (spread over its mass), plus spin
  pushHuman(id,dv=[0,0,0],spin=0){const h=this.human(id);if(!h||!finiteVector(dv))return false;for(const b of h.bodies){if(!this.b3.b3Body_IsValid(b))continue;const v=this.b3.b3Body_GetLinearVelocity([0,0,0],b);this.b3.b3Body_SetLinearVelocity(b,[v[0]+dv[0],v[1]+dv[1],v[2]+dv[2]]);this.b3.b3Body_SetAwake?.(b,true);}if(spin&&h.bodies[1])this.b3.b3Body_ApplyAngularImpulse(h.bodies[1],[(Math.random()-.5)*spin,(Math.random()-.5)*spin,(Math.random()-.5)*spin],true);return true;}
  // Blast loading from first principles. A charge of W kg TNT-equivalent delivers a side-on
  // positive-phase specific impulse i_s ≈ 250·W^(2/3)/r Pa·s (Kingery-Bulmash far field, surface
  // burst); a face turned to the blast takes the reflected ≈ 2·i_s. The impulse on a body is that
  // pressure-time integral times the area it shows to the blast, applied where the wave hits it:
  //   rigid bodies: mean projected area of their box (Cauchy: surface/4), at the point of the
  //                 body nearest to the charge (a ground burst loads the low side → it tips);
  //   ragdolls:     each bone gets its share of a 0.7 m² silhouette (by mass), at its own range,
  //                 so near bones get more and the body tumbles through its joints.
  // exposure(x,y,z) → 0..1 (buildings shadow the wave). Returns the number of bodies pushed.
  blast(center,{tntKg=1,exposure=null,skipId=""}={}){const W=Math.max(.001,Number(tntKg)||1),w3=Math.cbrt(W),w23=w3*w3,rMin=.5*w3,iAt=r=>250*w23/Math.max(rMin,r),reach=60*w3;let pushed=0;const c=center;
    for(const record of this.records.values()){if(record.id===skipId||!this.b3.b3Body_IsValid(record.body))continue;const p=this.b3.b3Body_GetPosition([0,0,0],record.body),h=record.halfExtents||[.5,.5,.5],q=[Math.min(p[0]+h[0],Math.max(p[0]-h[0],c[0])),Math.min(p[1]+h[1],Math.max(p[1]-h[1],c[1])),Math.min(p[2]+h[2],Math.max(p[2]-h[2],c[2]))];
      let dx=q[0]-c[0],dy=q[1]-c[1],dz=q[2]-c[2],r=Math.hypot(dx,dy,dz);if(r>reach)continue;if(r<1e-3){dx=p[0]-c[0];dy=p[1]-c[1];dz=p[2]-c[2]+.01;r=Math.hypot(dx,dy,dz)||1;}
      const e=exposure?Math.max(0,Math.min(1,exposure(p[0],p[1],p[2]))):1;if(e<=0)continue;const a=2*h[0],b=2*h[1],cc=2*h[2],area=(a*b+b*cc+cc*a)/2,J=2*iAt(r)*area*e,k=J/Math.max(1e-6,Math.hypot(dx,dy,dz));
      if(J<.05)continue;if(this.applyImpulse(record.id,[dx*k,dy*k,dz*k],{point:q}))pushed++;if(this.b3.b3Body_IsValid(record.body))this.b3.b3Body_SetAwake?.(record.body,true);}
    for(const[,h]of this.humans||[]){let M=0;for(const b of h.bodies)if(this.b3.b3Body_IsValid(b))M+=this.b3.b3Body_GetMass(b);if(M<=0)continue;let any=false;
      for(const b of h.bodies){if(!this.b3.b3Body_IsValid(b))continue;const p=this.b3.b3Body_GetPosition([0,0,0],b);let dx=p[0]-c[0],dy=p[1]-c[1],dz=p[2]-c[2];const r=Math.hypot(dx,dy,dz)||1e-3;if(r>reach)continue;const e=exposure?Math.max(0,Math.min(1,exposure(p[0],p[1],p[2]))):1;if(e<=0)continue;
        const J=2*iAt(r)*.7*(this.b3.b3Body_GetMass(b)/M)*e;if(J<.02)continue;const k=J/r;this.b3.b3Body_ApplyLinearImpulseToCenter(b,[dx*k,dy*k,dz*k],true);any=true;}if(any)pushed++;}
    return pushed;}
  setController(id,fn){const record=this.records.get(String(id||""));if(!record)return false;record.controller=typeof fn==="function"?fn:null;return true;}
  setForces(id,{force=null,torque=null}={}){const record=this.records.get(String(id||""));if(!record)return false;record.extForce=finiteVector(force)?[...force]:null;record.extTorque=finiteVector(torque)?[...torque]:null;if(this.b3.b3Body_IsValid(record.body))this.b3.b3Body_SetAwake?.(record.body,true);return true;}
  applyImpulse(id,impulse,{point=null}={}){const record=this.records.get(String(id||""));if(!record||!finiteVector(impulse))return false;const bounded=limitedVector(impulse,record.massKg*60);/* at most a 60 m/s kick in one go (a nuke front): blasts must be able to throw light bodies */for(let index=0;index<3;index++)record.pendingImpulse[index]+=bounded[index];record.impulsePoint=finiteVector(point)?[...point]:null;return true;}
  pose(id,out=null){
    const record=this.records.get(String(id||""));if(!record||!this.b3.b3Body_IsValid(record.body))return null;const result=out&&typeof out==="object"?out:{};
    const position=Array.isArray(result.position)&&result.position.length===3?result.position:[0,0,0],rotation=Array.isArray(result.rotation)&&result.rotation.length===4?result.rotation:[0,0,0,1],velocity=Array.isArray(result.velocity)&&result.velocity.length===3?result.velocity:[0,0,0],angularVelocity=Array.isArray(result.angularVelocity)&&result.angularVelocity.length===3?result.angularVelocity:[0,0,0];
    this.b3.b3Body_GetPosition(position,record.body);this.b3.b3Body_GetRotation(rotation,record.body);this.b3.b3Body_GetLinearVelocity(velocity,record.body);this.b3.b3Body_GetAngularVelocity(angularVelocity,record.body);
    result.position=position;result.rotation=rotation;result.velocity=velocity;result.angularVelocity=angularVelocity;result.yaw=quaternionYaw(rotation);result.groundOffset=record.wheels?record.groundOffset:record.halfExtents[2];result.wheels=record.wheels?wheelPoses(this,record,result.wheels):null;result.steer=record.steerAngle||0;return result;
  }
  raycast(origin,direction,maxDistance=2000,{categoryBits=WORLD_PHYSICS_CATEGORIES.projectileQuery,maskBits=PROJECTILE_QUERY_MASK}={}){
    if(!this.world||!finiteVector(origin)||!finiteVector(direction))return null;const length=length3(direction),distance=Math.max(.01,Math.min(2000,Number(maxDistance)||2000));if(length<1e-9)return null;
    const unit=direction.map(value=>value/length),translation=unit.map(value=>value*distance),filter=this.b3.b3DefaultQueryFilter();filter.categoryBits=BigInt(categoryBits);filter.maskBits=BigInt(maskBits);
    const result=this.b3.b3World_CastRayClosest(this.world,origin,translation,filter);if(!result?.hit)return null;const fraction=Number(result.fraction);if(!Number.isFinite(fraction)||fraction<0||fraction>1)return null;
    const record=this.shapeRecords.get(shapeKey(result.shapeId))||null,point=finiteVector(result.point)?[...result.point]:origin.map((value,index)=>value+translation[index]*fraction),normal=finiteVector(result.normal)?[...result.normal]:[0,0,1];
    return{id:record?.id||"",kind:record?.kind||"terrain",shapeId:result.shapeId,point,normal,fraction,distanceM:distance*fraction,physics:true};
  }
  controlBody(record,dt){
    const b3=this.b3,body=record.body,position=b3.b3Body_GetPosition(record.stepPosition,body),velocity=b3.b3Body_GetLinearVelocity(record.stepVelocity,body),angular=b3.b3Body_GetAngularVelocity(record.stepAngular,body),pre=record.preVelocity;pre[0]=velocity[0];pre[1]=velocity[1];pre[2]=velocity[2];
    if(record.controller){const rotation=b3.b3Body_GetRotation(record.stepRotation,body);let out=null;try{out=record.controller({position,velocity,rotation,angularVelocity:angular},dt,this);}catch(error){console.warn("body controller",error);}
      if(finiteVector(out?.force))b3.b3Body_ApplyForceToCenter(body,out.force,true);if(finiteVector(out?.torque))b3.b3Body_ApplyTorque(body,out.torque,true);}
    if(record.wheels){const rotation=b3.b3Body_GetRotation(record.stepRotation,body);driveWheeled(this,record,dt,{position,velocity,rotation});}
    else if(record.target){
      const offset=record.target.position.map((value,index)=>value-position[index]),horizontal=Math.hypot(offset[0],offset[1]),distance=record.drone?length3(offset):horizontal;
      if(distance>.03){
        const targetYaw=record.target.yaw??Math.atan2(offset[1],offset[0]),rotation=b3.b3Body_GetRotation(record.stepRotation,body),bodyYaw=quaternionYaw(rotation),yawError=wrap(targetYaw-bodyYaw),gain=record.target.response,maxAcceleration=record.target.maxAccelerationMps2;
        let force;
        if(record.drone){
          const vertical=offset[2]/Math.max(.01,distance),horizontalScale=Math.sqrt(Math.max(0,1-vertical*vertical)),desired=[Math.cos(targetYaw)*record.target.speedMps*horizontalScale,Math.sin(targetYaw)*record.target.speedMps*horizontalScale,vertical*record.target.speedMps],maxForce=record.massKg*maxAcceleration;
          force=limitedVector([(desired[0]-velocity[0])*record.massKg*gain,(desired[1]-velocity[1])*record.massKg*gain,(desired[2]-velocity[2])*record.massKg*gain],maxForce);
        }else{
          const forwardX=Math.cos(bodyYaw),forwardY=Math.sin(bodyYaw),rightX=-forwardY,rightY=forwardX,forwardSpeed=velocity[0]*forwardX+velocity[1]*forwardY,lateralSpeed=velocity[0]*rightX+velocity[1]*rightY,alignment=Math.max(0,Math.cos(yawError)),turnSpeedScale=.12+.88*alignment*alignment,desiredForwardSpeed=record.target.speedMps*turnSpeedScale,longitudinalAccel=clamp((desiredForwardSpeed-forwardSpeed)*gain,-maxAcceleration,maxAcceleration),lateralAccel=clamp(-lateralSpeed*16,-22,22);
          force=[record.massKg*(forwardX*longitudinalAccel+rightX*lateralAccel),record.massKg*(forwardY*longitudinalAccel+rightY*lateralAccel),0];
        }
        b3.b3Body_ApplyForceToCenter(body,force,true);
        const torqueZ=clamp((yawError*7-angular[2]*2.8)*record.massKg,-record.massKg*12,record.massKg*12);
        if(record.drone){const[qx,qy,qz,qw]=rotation,upX=2*(qx*qz+qw*qy),upY=2*(qy*qz-qw*qx),torqueX=clamp((upY*10-angular[0]*3.4)*record.massKg,-record.massKg*12,record.massKg*12),torqueY=clamp((-upX*10-angular[1]*3.4)*record.massKg,-record.massKg*12,record.massKg*12);b3.b3Body_ApplyTorque(body,[torqueX,torqueY,torqueZ],true);}else b3.b3Body_ApplyTorque(body,[0,0,torqueZ],true);
      }
    }
    // Water: Archimedes buoyancy from the submerged fraction of the body's
    // box, linear + quadratic water drag and the river current. Cars are
    // lighter than the water they displace, so they float low and drift.
    if(!record.drone&&waterAt(position[0],position[1])){const hz=record.halfExtents[2],bottom=position[2]-hz,sub=clamp((waterLevelAt(position[0],position[1])-bottom)/(2*hz),0,1);if(sub>0){const volume=8*record.halfExtents[0]*record.halfExtents[1]*hz,flow=waterFlowAt(position[0],position[1])||[0,0],rel=[velocity[0]-flow[0],velocity[1]-flow[1],velocity[2]],speed=length3(rel),k=sub*(1.6+.9*speed)*record.massKg*.35;
      b3.b3Body_ApplyForceToCenter(body,[-rel[0]*k,-rel[1]*k,1000*9.80665*volume*sub*.62-rel[2]*k*1.4],true);b3.b3Body_ApplyTorque(body,[-angular[0]*record.massKg*sub*.8,-angular[1]*record.massKg*sub*.8,-angular[2]*record.massKg*sub*.5],true);record.inWater=sub;}else record.inWater=0;}else record.inWater=0;
    // continuous external force / torque (aircraft aerodynamics, thrust): applied every step until changed
    if(record.extForce){b3.b3Body_ApplyForceToCenter(body,record.extForce,true);}if(record.extTorque){b3.b3Body_ApplyTorque(body,record.extTorque,true);}
    if(length3(record.pendingImpulse)>.0001){const force=record.pendingImpulse.map(value=>value/Math.max(.001,dt));if(record.impulsePoint)b3.b3Body_ApplyForce(body,force,record.impulsePoint,true);else b3.b3Body_ApplyForceToCenter(body,force,true);record.pendingImpulse=[0,0,0];record.impulsePoint=null;}
  }
  // One-shot recovery for a terrain rebuild / late DEM only. This is never called from
  // the normal physics step: ordinary driving is resolved entirely by contacts and gravity.
  rescueFromTerrain(){const b3=this.b3;let n=0;for(const record of this.records.values()){if(!record.body||!b3.b3Body_IsValid(record.body))continue;const p=b3.b3Body_GetPosition([0,0,0],record.body),z=terrainRescueZ(p[0],p[1],p[2],(record.groundOffset??record.halfExtents[2])+.12);if(z===null)continue;const v=b3.b3Body_GetLinearVelocity([0,0,0],record.body);b3.b3Body_SetTransform(record.body,[p[0],p[1],z],b3.b3Body_GetRotation([0,0,0,1],record.body));b3.b3Body_SetLinearVelocity(record.body,[v[0],v[1],Math.max(0,v[2])]);if(record.wheels)placeWheels(this,record);n++;}this.terrainRescues=(this.terrainRescues||0)+n;return n;}
  // Continuous safety net (cheap: every 6th step, one height lookup per body). Whatever lets a body
  // slip under the terrain — a tile being rewritten under it, a seam, a tunnelling hit at speed,
  // a terrain reload — a body whose underside is clearly below the ground for two checks in a row
  // is put back on top, keeping its horizontal motion. Nothing stays stuck under the map.
  groundSafetyNet(){const b3=this.b3;for(const record of this.records.values()){if(!record.body||!b3.b3Body_IsValid(record.body))continue;const p=b3.b3Body_GetPosition([0,0,0],record.body);if(!Number.isFinite(p[2]))continue;
      const g=groundHeightAt(p[0],p[1]),off=record.wheels?(Number(record.groundOffset)||record.halfExtents[2]):record.halfExtents[2],under=p[2]-off<g-.7;record.underGround=under?(record.underGround||0)+1:0;if(record.underGround<2)continue;
      const v=b3.b3Body_GetLinearVelocity([0,0,0],record.body);b3.b3Body_SetTransform(record.body,[p[0],p[1],g+off+.25],b3.b3Body_GetRotation([0,0,0,1],record.body));b3.b3Body_SetLinearVelocity(record.body,[v[0],v[1],Math.max(0,v[2])]);b3.b3Body_SetAwake?.(record.body,true);if(record.wheels)placeWheels(this,record);record.underGround=0;this.groundRescues=(this.groundRescues||0)+1;}}
  step(dt=1/60,subSteps=4,now=performance.now?.()??Date.now()){
    const delta=clamp(dt,.001,.04);this.terrainTiles?.tick(now);for(const record of this.records.values())this.controlBody(record,delta);this.b3.b3World_Step(this.world,delta,Math.max(1,Math.min(8,Math.floor(Number(subSteps)||4))));this.stepCount++;
    let nativeHitCount=0;if(this.eventsBuffer&&this.hitEvent&&typeof this.b3.getEvents==="function"){this.b3.getEvents(this.eventsBuffer,this.world);nativeHitCount=this.b3.getNumContactHitEvents(this.eventsBuffer);for(let index=0;index<nativeHitCount;index++){this.b3.getContactHitEventAt(this.hitEvent,this.eventsBuffer,index);const speed=Math.abs(Number(this.hitEvent.approachSpeed)||0),hitRecords=new Set([this.shapeRecords.get(shapeKey(this.hitEvent.shapeIdA)),this.shapeRecords.get(shapeKey(this.hitEvent.shapeIdB))]);for(const record of hitRecords){if(!record||now-record.lastImpactAt<=120)continue;record.lastImpactAt=now;record.impactCount++;this.impactCount++;const pose=this.pose(record.id),detail={id:record.id,kind:record.kind,deltaVelocityMps:speed,approachSpeedMps:speed,energyJ:.5*record.massKg*speed*speed,position:[...this.hitEvent.point],normal:[...this.hitEvent.normal],velocity:pose?.velocity||[0,0,0],nativeContactEvent:true};this.onImpact?.(detail);}}}
    if(this.stepCount%6===0)this.groundSafetyNet();
    for(const record of this.records.values()){const velocity=this.b3.b3Body_GetLinearVelocity(record.postVelocity,record.body),change=Math.hypot(velocity[0]-record.preVelocity[0],velocity[1]-record.preVelocity[1],velocity[2]-record.preVelocity[2]),threshold=record.drone?1.05:1.45;if(!this.eventsBuffer&&change>=threshold&&now-record.lastImpactAt>180){record.lastImpactAt=now;record.impactCount++;this.impactCount++;const pose=this.pose(record.id),detail={id:record.id,kind:record.kind,deltaVelocityMps:change,energyJ:.5*record.massKg*change*change,position:pose?.position||[0,0,0],velocity:pose?.velocity||velocity,nativeContactEvent:false};this.onImpact?.(detail);}const last=record.lastVelocity;last[0]=velocity[0];last[1]=velocity[1];last[2]=velocity[2];}return this.stepCount;
  }
  destroy(){for(const id of[...this.records.keys()])this.removeBody(id);this.terrainTiles?.destroyAll();this.terrainTiles=null;destroyWorldBuildingCollisionBodies(this.b3,this.buildingState);this.buildingState=null;if(this.eventsBuffer)this.b3.destroyEventsBuffer?.(this.eventsBuffer);this.eventsBuffer=null;this.hitEvent=null;if(this.world&&this.b3.b3World_IsValid?.(this.world)!==false)this.b3.b3DestroyWorld(this.world);this.world=null;}
}
