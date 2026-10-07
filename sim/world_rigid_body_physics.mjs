import {createTerrainBody,waterAt,waterFlowAt,waterLevelAt,groundHeightAt,terrainRescueZ} from "./terrain_craters.mjs";
import {vehicleSpec,vehicleGroundOffset,attachWheels,detachWheels,placeWheels,driveWheeled,wheelPoses} from "./world_vehicle_dynamics.mjs";
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
    const worldDef=b3.b3DefaultWorldDef();worldDef.gravity=[0,0,-9.80665];worldDef.enableSleep=true;worldDef.enableContinuous=true;worldDef.hitEventThreshold=1.25;this.world=b3.b3CreateWorld(worldDef);
    this.terrainBodies=[];this.rebuildTerrain();this.syncBuildings(buildingSnapshot);
  }
  // Shared terrain (terrain_craters.mjs): flat ground with crater bowls and
  // real river/lake basins + bridge decks, so cars sink into water, float
  // and drift. Rebuilt when the terrain changes.
  rebuildTerrain(){const b3=this.b3;for(const body of this.terrainBodies||[])if(b3.b3Body_IsValid?.(body)!==false)b3.b3DestroyBody(body);const shapeDef=b3.b3DefaultShapeDef();shapeDef.baseMaterial.friction=.82;shapeDef.baseMaterial.restitution=.025;shapeDef.filter={categoryBits:WORLD_PHYSICS_CATEGORIES.terrain,maskBits:ALL_DYNAMIC|WORLD_PHYSICS_CATEGORIES.projectileQuery,groupIndex:0};const{bodies}=createTerrainBody(b3,this.world,shapeDef,10000);this.terrainBodies=bodies;this.ground=bodies[0]||null;
    // building colliders stand on the terrain too: re-create them with the new ground
    if(this.buildingSnapshot?.prismCount){const snap=this.buildingSnapshot;this.buildingSnapshot={...snap,hash:"__terrain-changed"};this.syncBuildings(snap);}
    if(this.records)this.rescueFromTerrain();
    return bodies.length;}
  syncBuildings(value){const snapshot=normalizeBuildingCollisionSnapshot(value);if(snapshot.hash===this.buildingSnapshot.hash&&snapshot.prismCount===this.buildingSnapshot.prismCount)return false;destroyWorldBuildingCollisionBodies(this.b3,this.buildingState);this.buildingSnapshot=snapshot;this.buildingState=createWorldBuildingCollisionBodies(this.b3,this.world,snapshot,{categoryBits:WORLD_PHYSICS_CATEGORIES.terrain,maskBits:ALL_DYNAMIC|WORLD_PHYSICS_CATEGORIES.projectileQuery,rangefinderCategoryBits:0n,launchExclusionPoint:[Infinity,Infinity]});return true;}
  shapeKeyOf(shape){return shapeKey(shape);}
  addBody({id,kind="vehicle",position=[0,0,0],yaw=0,halfExtents=[1,.5,.5],massKg=1000,gravityScale,linearDamping,angularDamping,wheeled=true}={}){
    // cars and buses are real wheeled vehicles (chassis + 4 wheel joints)
    const spec=wheeled&&typeof this.b3.b3CreateWheelJoint==="function"?vehicleSpec(kind==='vehicle'?null:kind):null;if(spec&&finiteVector(position)){halfExtents=[...spec.half];massKg=spec.mass;const gz=groundHeightAt(position[0],position[1])+vehicleGroundOffset(spec)+.06;position=[position[0],position[1],Math.max(position[2],gz)];}
    const key=String(id||"");if(!key||!finiteVector(position)||!finiteVector(halfExtents)||halfExtents.some(value=>!(value>.02)))return null;this.removeBody(key);const drone=kind==="drone"||kind==="police-drone",category=drone?WORLD_PHYSICS_CATEGORIES.drone:WORLD_PHYSICS_CATEGORIES.vehicle,b3=this.b3,bodyDef=b3.b3DefaultBodyDef(),resolvedGravityScale=Number.isFinite(gravityScale)?gravityScale:drone?0:1;bodyDef.type=b3.b3BodyType.b3_dynamicBody;bodyDef.position=[...position];bodyDef.rotation=yawQuaternion(yaw);bodyDef.linearDamping=Number.isFinite(linearDamping)?linearDamping:drone? .42:spec?.03:.16;bodyDef.angularDamping=Number.isFinite(angularDamping)?angularDamping:drone?1.15:spec?.3:.78;bodyDef.gravityScale=resolvedGravityScale;bodyDef.enableSleep=false;bodyDef.isBullet=true;const body=b3.b3CreateBody(this.world,bodyDef),shapeDef=b3.b3DefaultShapeDef(),volume=8*halfExtents[0]*halfExtents[1]*halfExtents[2];shapeDef.density=Math.max(.01,(Number(massKg)||1)/Math.max(.01,volume));shapeDef.baseMaterial.friction=drone? .48:.18;shapeDef.baseMaterial.restitution=drone? .12:.035;shapeDef.enableContactEvents=true;shapeDef.enableHitEvents=true;shapeDef.filter={categoryBits:category,maskBits:WORLD_PHYSICS_CATEGORIES.terrain|ALL_DYNAMIC|WORLD_PHYSICS_CATEGORIES.projectileQuery,groupIndex:0};const shape=b3.b3CreateBoxShape(body,shapeDef,...halfExtents);
    const record={id:key,kind:String(kind||"vehicle"),body,shape,halfExtents:[...halfExtents],massKg:Math.max(.1,Number(massKg)||1),gravityScale:resolvedGravityScale,drone,target:null,pendingImpulse:[0,0,0],impulsePoint:null,preVelocity:[0,0,0],lastVelocity:[0,0,0],lastImpactAt:-Infinity,impactCount:0};this.records.set(key,record);this.shapeRecords.set(shapeKey(shape),record);
    if(spec){try{attachWheels(this,record,spec,{category,mask:WORLD_PHYSICS_CATEGORIES.terrain|ALL_DYNAMIC|WORLD_PHYSICS_CATEGORIES.projectileQuery});}catch(error){console.warn("vehicle wheels",error);record.wheels=null;}}
    return record;
  }
  removeBody(id){const key=String(id||""),record=this.records.get(key);if(!record)return false;if(record.wheels)detachWheels(this,record);this.records.delete(key);this.shapeRecords.delete(shapeKey(record.shape));if(record.body&&this.b3.b3Body_IsValid(record.body))this.b3.b3DestroyBody(record.body);return true;}
  setTarget(id,{position,speedMps=0,response=3.2,maxAccelerationMps2,yaw=null}={}){const record=this.records.get(String(id||""));if(!record||!finiteVector(position))return false;record.target={position:[...position],speedMps:Math.max(0,Number(speedMps)||0),response:clamp(response,.2,10),maxAccelerationMps2:clamp(maxAccelerationMps2??(record.drone?13:6),.5,30),yaw:Number.isFinite(yaw)?Number(yaw):null};return true;}
  clearTarget(id){const record=this.records.get(String(id||""));if(!record)return false;record.target=null;return true;}
  // Player driving: an arcade bicycle model evaluated every physics step.
  // It sets the car's velocity (not its pose), so Box3D still resolves every
  // contact — hitting a wall stops you, the next step starts from the real,
  // post-collision velocity. Strong lateral grip = no unwanted drifting;
  // the handbrake deliberately breaks grip for a controllable slide.
  setDrive(id,drive=null){const record=this.records.get(String(id||""));if(!record)return false;if(!drive){record.drive=null;record.steerAngle=0;return true;}record.drive={pedal:clamp(drive.pedal,-1,1),steer:clamp(drive.steer,-1,1),handbrake:Boolean(drive.handbrake),maxSpeed:clamp(drive.maxSpeed??36,4,80),maxReverse:clamp(drive.maxReverse??9,1,30)};record.target=null;record.steerAngle??=0;return true;}
  setPose(id,{position,yaw=null,velocity=[0,0,0],angularVelocity=[0,0,0]}={}){
    const record=this.records.get(String(id||""));if(!record||!finiteVector(position)||!finiteVector(velocity)||!finiteVector(angularVelocity)||!this.b3.b3Body_IsValid(record.body))return false;const rotation=Number.isFinite(yaw)?yawQuaternion(yaw):this.b3.b3Body_GetRotation([0,0,0,1],record.body);this.b3.b3Body_SetTransform(record.body,[...position],rotation);this.b3.b3Body_SetLinearVelocity(record.body,[...velocity]);this.b3.b3Body_SetAngularVelocity(record.body,[...angularVelocity]);this.b3.b3Body_SetAwake?.(record.body,true);record.pendingImpulse=[0,0,0];record.impulsePoint=null;record.preVelocity=[...velocity];record.lastVelocity=[...velocity];if(record.wheels)placeWheels(this,record);return true;
  }
  setGravityScale(id,gravityScale=1){const record=this.records.get(String(id||"")),value=Number(gravityScale);if(!record||!Number.isFinite(value)||typeof this.b3.b3Body_SetGravityScale!=="function")return false;record.gravityScale=clamp(value,0,4);this.b3.b3Body_SetGravityScale(record.body,record.gravityScale);this.b3.b3Body_SetAwake?.(record.body,true);return true;}
  applyImpulse(id,impulse,{point=null}={}){const record=this.records.get(String(id||""));if(!record||!finiteVector(impulse))return false;const bounded=limitedVector(impulse,record.massKg*(record.drone?8:3));for(let index=0;index<3;index++)record.pendingImpulse[index]+=bounded[index];record.impulsePoint=finiteVector(point)?[...point]:null;return true;}
  pose(id){const record=this.records.get(String(id||""));if(!record||!this.b3.b3Body_IsValid(record.body))return null;const position=this.b3.b3Body_GetPosition([0,0,0],record.body),rotation=this.b3.b3Body_GetRotation([0,0,0,1],record.body),velocity=this.b3.b3Body_GetLinearVelocity([0,0,0],record.body),angularVelocity=this.b3.b3Body_GetAngularVelocity([0,0,0],record.body);return{position:[...position],rotation:[...rotation],velocity:[...velocity],angularVelocity:[...angularVelocity],yaw:quaternionYaw(rotation),groundOffset:record.wheels?record.groundOffset:record.halfExtents[2],wheels:record.wheels?wheelPoses(this,record):null,steer:record.steerAngle||0};}
  raycast(origin,direction,maxDistance=2000,{categoryBits=WORLD_PHYSICS_CATEGORIES.projectileQuery,maskBits=PROJECTILE_QUERY_MASK}={}){
    if(!this.world||!finiteVector(origin)||!finiteVector(direction))return null;const length=length3(direction),distance=Math.max(.01,Math.min(2000,Number(maxDistance)||2000));if(length<1e-9)return null;
    const unit=direction.map(value=>value/length),translation=unit.map(value=>value*distance),filter=this.b3.b3DefaultQueryFilter();filter.categoryBits=BigInt(categoryBits);filter.maskBits=BigInt(maskBits);
    const result=this.b3.b3World_CastRayClosest(this.world,origin,translation,filter);if(!result?.hit)return null;const fraction=Number(result.fraction);if(!Number.isFinite(fraction)||fraction<0||fraction>1)return null;
    const record=this.shapeRecords.get(shapeKey(result.shapeId))||null,point=finiteVector(result.point)?[...result.point]:origin.map((value,index)=>value+translation[index]*fraction),normal=finiteVector(result.normal)?[...result.normal]:[0,0,1];
    return{id:record?.id||"",kind:record?.kind||"terrain",shapeId:result.shapeId,point,normal,fraction,distanceM:distance*fraction,physics:true};
  }
  controlBody(record,dt){
    const b3=this.b3,body=record.body,position=b3.b3Body_GetPosition([0,0,0],body),velocity=b3.b3Body_GetLinearVelocity([0,0,0],body),angular=b3.b3Body_GetAngularVelocity([0,0,0],body);record.preVelocity=[...velocity];
    if(record.wheels){driveWheeled(this,record,dt);}
    else if(record.drive){this.driveBody(record,dt,velocity,angular);}
    else if(record.target){
      const offset=record.target.position.map((value,index)=>value-position[index]),horizontal=Math.hypot(offset[0],offset[1]),distance=record.drone?length3(offset):horizontal;
      if(distance>.03){
        const targetYaw=record.target.yaw??Math.atan2(offset[1],offset[0]),rotation=b3.b3Body_GetRotation([0,0,0,1],body),bodyYaw=quaternionYaw(rotation),yawError=wrap(targetYaw-bodyYaw),gain=record.target.response,maxAcceleration=record.target.maxAccelerationMps2;
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
    if(length3(record.pendingImpulse)>.0001){const force=record.pendingImpulse.map(value=>value/Math.max(.001,dt));if(record.impulsePoint)b3.b3Body_ApplyForce(body,force,record.impulsePoint,true);else b3.b3Body_ApplyForceToCenter(body,force,true);record.pendingImpulse=[0,0,0];record.impulsePoint=null;}
  }
  driveBody(record,dt,velocity,angular){
    const b3=this.b3,body=record.body,d=record.drive,rotation=b3.b3Body_GetRotation([0,0,0,1],body),yaw=quaternionYaw(rotation),fx=Math.cos(yaw),fy=Math.sin(yaw),rx=-fy,ry=fx;
    const[qx,qy,qz,qw]=rotation,upZ=1-2*(qx*qx+qy*qy);
    let vf=velocity[0]*fx+velocity[1]*fy,vl=velocity[0]*rx+velocity[1]*ry;const sgn=Math.sign(vf),speed=Math.abs(vf);
    // Longitudinal: throttle with a soft top-speed curve, strong brakes, coast drag.
    if(d.pedal>0){if(vf<-.4)vf=Math.min(0,vf+20*d.pedal*dt);else vf+=d.pedal*10.5*Math.max(0,1-vf/d.maxSpeed)**.75*dt;}
    else if(d.pedal<0){if(vf>.4)vf=Math.max(0,vf+20*d.pedal*dt);else vf=Math.max(-d.maxReverse,vf+d.pedal*6*dt);}
    else vf-=sgn*Math.min(speed,(.55+.011*vf*vf)*dt);
    if(d.handbrake)vf-=Math.sign(vf)*Math.min(Math.abs(vf),6.5*dt);
    // Steering: speed-sensitive lock, rate-limited wheel, grip-limited yaw rate.
    const lock=.62/(1+Math.abs(vf)/10),targetAngle=d.steer*lock,maxRate=3.6*dt;record.steerAngle+=clamp(targetAngle-record.steerAngle,-maxRate,maxRate);
    const WHEELBASE=2.65,latLimit=d.handbrake?6:11.5;let yawRate=vf/WHEELBASE*Math.tan(record.steerAngle);
    if(Math.abs(yawRate*vf)>latLimit)yawRate=Math.sign(yawRate)*latLimit/Math.max(.5,Math.abs(vf));
    if(d.handbrake&&Math.abs(vf)>5)yawRate*=1.55;
    vl*=Math.exp(-(d.handbrake?1.3:15)*dt);
    // Wheels only grip on ground: floating in water you barely steer.
    const grip=(record.inWater||0)>.25?.06:1;
    if(upZ>.6){
      const tvx=fx*vf+rx*vl,tvy=fy*vf+ry*vl;
      b3.b3Body_SetLinearVelocity(body,[velocity[0]+(tvx-velocity[0])*grip,velocity[1]+(tvy-velocity[1])*grip,grip<1?velocity[2]:Math.min(velocity[2],2)]);
      b3.b3Body_SetAngularVelocity(body,[angular[0]*.6,angular[1]*.6,angular[2]+(yawRate-angular[2])*grip]);
    }else if(Math.hypot(velocity[0],velocity[1])<1.5){
      // Upside down / on its side and nearly stopped: put it back on its wheels.
      const p=b3.b3Body_GetPosition([0,0,0],body);b3.b3Body_SetTransform(body,[p[0],p[1],p[2]+.9],yawQuaternion(yaw));b3.b3Body_SetLinearVelocity(body,[0,0,0]);b3.b3Body_SetAngularVelocity(body,[0,0,0]);
    }
  }
  // Nothing stays trapped below the terrain surface (terrain rose under it,
  // DEM arrived late, tunnelling): lift it back on top, keep its horizontal motion.
  rescueFromTerrain(){const b3=this.b3;let n=0;for(const record of this.records.values()){if(!record.body||!b3.b3Body_IsValid(record.body))continue;const p=b3.b3Body_GetPosition([0,0,0],record.body),z=terrainRescueZ(p[0],p[1],p[2],(record.groundOffset??record.halfExtents[2])+.12);if(z===null)continue;const v=b3.b3Body_GetLinearVelocity([0,0,0],record.body);b3.b3Body_SetTransform(record.body,[p[0],p[1],z],b3.b3Body_GetRotation([0,0,0,1],record.body));b3.b3Body_SetLinearVelocity(record.body,[v[0],v[1],Math.max(0,v[2])]);if(record.wheels)placeWheels(this,record);n++;}this.terrainRescues=(this.terrainRescues||0)+n;return n;}
  step(dt=1/60,subSteps=4,now=performance.now?.()??Date.now()){
    const delta=clamp(dt,.001,.04);for(const record of this.records.values())this.controlBody(record,delta);this.b3.b3World_Step(this.world,delta,Math.max(1,Math.min(8,Math.floor(Number(subSteps)||4))));this.stepCount++;if((this.stepCount&7)===0)this.rescueFromTerrain();
    let nativeHitCount=0;if(this.eventsBuffer&&this.hitEvent&&typeof this.b3.getEvents==="function"){this.b3.getEvents(this.eventsBuffer,this.world);nativeHitCount=this.b3.getNumContactHitEvents(this.eventsBuffer);for(let index=0;index<nativeHitCount;index++){this.b3.getContactHitEventAt(this.hitEvent,this.eventsBuffer,index);const speed=Math.abs(Number(this.hitEvent.approachSpeed)||0),hitRecords=new Set([this.shapeRecords.get(shapeKey(this.hitEvent.shapeIdA)),this.shapeRecords.get(shapeKey(this.hitEvent.shapeIdB))]);for(const record of hitRecords){if(!record||now-record.lastImpactAt<=120)continue;record.lastImpactAt=now;record.impactCount++;this.impactCount++;const pose=this.pose(record.id),detail={id:record.id,kind:record.kind,deltaVelocityMps:speed,approachSpeedMps:speed,energyJ:.5*record.massKg*speed*speed,position:[...this.hitEvent.point],normal:[...this.hitEvent.normal],velocity:pose?.velocity||[0,0,0],nativeContactEvent:true};this.onImpact?.(detail);}}}
    for(const record of this.records.values()){const velocity=this.b3.b3Body_GetLinearVelocity([0,0,0],record.body),change=Math.hypot(velocity[0]-record.preVelocity[0],velocity[1]-record.preVelocity[1],velocity[2]-record.preVelocity[2]),threshold=record.drone?1.05:1.45;if(!this.eventsBuffer&&change>=threshold&&now-record.lastImpactAt>180){record.lastImpactAt=now;record.impactCount++;this.impactCount++;const pose=this.pose(record.id),detail={id:record.id,kind:record.kind,deltaVelocityMps:change,energyJ:.5*record.massKg*change*change,position:pose?.position||[0,0,0],velocity:pose?.velocity||velocity,nativeContactEvent:false};this.onImpact?.(detail);}record.lastVelocity=[...velocity];}return this.stepCount;
  }
  destroy(){for(const id of[...this.records.keys()])this.removeBody(id);destroyWorldBuildingCollisionBodies(this.b3,this.buildingState);this.buildingState=null;if(this.eventsBuffer)this.b3.destroyEventsBuffer?.(this.eventsBuffer);this.eventsBuffer=null;this.hitEvent=null;if(this.world&&this.b3.b3World_IsValid?.(this.world)!==false)this.b3.b3DestroyWorld(this.world);this.world=null;}
}
