// Real wheeled vehicles on Box3D joints (after the Box3D "Driving" sample):
// a dynamic chassis and four dynamic wheels connected by b3WheelJoints with
// a suspension spring + damper and travel limits, a spin motor (engine torque,
// brakes, engine braking, handbrake on the rear axle) and a steering motor on
// the front axle. Nothing is scripted: the car accelerates because the motor
// joints apply torque to the wheels, the tyres' friction against the ground
// pushes the car, the chassis pitches under acceleration/braking and rolls
// in corners through the suspension, and it can slide, jump and flip.
//
// The same model drives the player's car (pedal / steer / handbrake) and the
// traffic (an AI driver steers towards its route target and controls speed
// with the same pedal). Frame: world z up; chassis local x forward, y left.

export const VEHICLE_DYNAMICS_VERSION="box3d-wheel-joint-vehicles-v1";

// Joint frame: local x -> up (suspension + steering axis), local z -> left
// (wheel spin axis), local y -> forward. Same frame on chassis and wheel.
const FRAME_Q=[-.5,-.5,-.5,.5];
export const VEHICLE_SPECS=Object.freeze({
  car:{half:[1.78,.82,.36],mass:1350,radius:.34,wheelMass:22,attachZ:-.26,wheels:[[1.2,.78,true],[1.2,-.78,true],[-1.15,.78,false],[-1.15,-.78,false]],
    suspension:{hertz:4.4,damping:.6,lower:-.14,upper:.1},torque:{front:320,rear:720},brake:3200,handbrake:3600,coast:40,steerLock:.6,steerTorque:900,friction:1.75},
  bus:{half:[4,1.17,1.2],mass:9200,radius:.46,wheelMass:85,attachZ:-1.1,wheels:[[2.6,1.08,true],[2.6,-1.08,true],[-2.55,1.08,false],[-2.55,-1.08,false]],
    suspension:{hertz:4.2,damping:.7,lower:-.16,upper:.12},torque:{front:0,rear:4200},brake:9500,handbrake:12000,coast:260,steerLock:.5,steerTorque:6000,friction:1.6},
});
export function vehicleSpec(kind){return kind==="bus"?VEHICLE_SPECS.bus:kind==="car"||kind==="vehicle"?VEHICLE_SPECS.car:null;}
export function vehicleGroundOffset(spec){return spec.radius-spec.attachZ;}

const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number(v)||0));
function rotate(q,v){const[x,y,z,w]=q,[vx,vy,vz]=v,tx=2*(y*vz-z*vy),ty=2*(z*vx-x*vz),tz=2*(x*vy-y*vx);return[vx+w*tx+(y*tz-z*ty),vy+w*ty+(z*tx-x*tz),vz+w*tz+(x*ty-y*tx)];}

// Creates the four wheels and joints for an existing chassis record.
export function attachWheels(physics,record,spec,{category,mask}){
  const b3=physics.b3;if(typeof b3.b3CreateWheelJoint!=="function"||typeof b3.b3DefaultWheelJointDef!=="function")return false;
  const chassisPos=b3.b3Body_GetPosition([0,0,0],record.body),chassisRot=b3.b3Body_GetRotation([0,0,0,1],record.body);
  record.wheels=[];record.spec=spec;record.groundOffset=vehicleGroundOffset(spec);record.steerAngle=0;
  const r=spec.radius,volume=4/3*Math.PI*r*r*r;
  for(const[x,y,front]of spec.wheels){
    const local=[x,y,spec.attachZ],off=rotate(chassisRot,local),bd=b3.b3DefaultBodyDef();bd.type=b3.b3BodyType.b3_dynamicBody;bd.position=[chassisPos[0]+off[0],chassisPos[1]+off[1],chassisPos[2]+off[2]];bd.rotation=[...chassisRot];bd.angularDamping=.05;bd.linearDamping=.02;if("allowFastRotation"in bd)bd.allowFastRotation=true;bd.enableSleep=false;
    const body=b3.b3CreateBody(physics.world,bd),sd=b3.b3DefaultShapeDef();sd.density=spec.wheelMass/volume;sd.baseMaterial.friction=spec.friction;sd.baseMaterial.restitution=0;sd.enableContactEvents=true;sd.enableHitEvents=true;sd.filter={categoryBits:category,maskBits:mask,groupIndex:0};
    const shape=b3.b3CreateSphereShape(body,sd,{center:[0,0,0],radius:r});
    const jd=b3.b3DefaultWheelJointDef();jd.base.bodyIdA=record.body;jd.base.bodyIdB=body;jd.base.localFrameA={position:local,quaternion:[...FRAME_Q]};jd.base.localFrameB={position:[0,0,0],quaternion:[...FRAME_Q]};jd.base.collideConnected=false;
    jd.enableSuspensionSpring=true;jd.suspensionHertz=spec.suspension.hertz;jd.suspensionDampingRatio=spec.suspension.damping;jd.enableSuspensionLimit=true;jd.lowerSuspensionLimit=spec.suspension.lower;jd.upperSuspensionLimit=spec.suspension.upper;
    jd.enableSpinMotor=true;jd.maxSpinTorque=spec.coast;jd.spinSpeed=0;
    jd.enableSteering=Boolean(front);jd.steeringHertz=9;jd.steeringDampingRatio=.95;jd.maxSteeringTorque=spec.steerTorque;jd.targetSteeringAngle=0;jd.enableSteeringLimit=Boolean(front);jd.lowerSteeringLimit=-spec.steerLock;jd.upperSteeringLimit=spec.steerLock;
    const joint=b3.b3CreateWheelJoint(physics.world,jd);
    record.wheels.push({body,shape,joint,front:Boolean(front),local});physics.shapeRecords.set(physics.shapeKeyOf(shape),record);
  }
  return true;
}
export function detachWheels(physics,record){const b3=physics.b3;for(const w of record.wheels||[]){physics.shapeRecords.delete(physics.shapeKeyOf(w.shape));if(b3.b3Body_IsValid(w.body))b3.b3DestroyBody(w.body);}record.wheels=null;}

// Puts the wheels back under the chassis (teleports / resets).
export function placeWheels(physics,record){
  const b3=physics.b3,p=b3.b3Body_GetPosition([0,0,0],record.body),q=b3.b3Body_GetRotation([0,0,0,1],record.body),v=b3.b3Body_GetLinearVelocity([0,0,0],record.body);
  for(const w of record.wheels||[]){const o=rotate(q,w.local);b3.b3Body_SetTransform(w.body,[p[0]+o[0],p[1]+o[1],p[2]+o[2]],[...q]);b3.b3Body_SetLinearVelocity(w.body,[...v]);b3.b3Body_SetAngularVelocity(w.body,[0,0,0]);b3.b3Body_SetAwake?.(w.body,true);}
}

// AI driver: steer towards the route target, hold the target speed.
function aiInput(record,position,forward,vf){
  const t=record.target;const dx=t.position[0]-position[0],dy=t.position[1]-position[1],dist=Math.hypot(dx,dy);if(dist<.4)return{pedal:-.4*Math.sign(vf),steer:0,handbrake:false,maxSpeed:Math.max(4,t.speedMps*1.2),maxReverse:4};
  const fx=forward[0],fy=forward[1],cross=fx*dy-fy*dx,dot=fx*dx+fy*dy,err=Math.atan2(cross,dot),steer=clamp(err*1.9,-1,1);
  const want=t.speedMps*Math.max(.25,Math.cos(err)**2),pedal=clamp((want-vf)*.45,-1,1);
  return{pedal:dot<0&&dist<6?-.6:pedal,steer:dot<0&&dist<6?-steer:steer,handbrake:false,maxSpeed:Math.max(6,t.speedMps*1.25),maxReverse:5};
}

// One physics step of the drivetrain (called before b3World_Step).
export function driveWheeled(physics,record,dt){
  const b3=physics.b3,spec=record.spec,body=record.body,q=b3.b3Body_GetRotation([0,0,0,1],body),v=b3.b3Body_GetLinearVelocity([0,0,0],body),w=b3.b3Body_GetAngularVelocity([0,0,0],body),p=b3.b3Body_GetPosition([0,0,0],body);
  const forward=rotate(q,[1,0,0]),up=rotate(q,[0,0,1]),vf=v[0]*forward[0]+v[1]*forward[1]+v[2]*forward[2],speed=Math.hypot(v[0],v[1],v[2]);
  const input=record.drive||(record.target?aiInput(record,p,forward,vf):{pedal:0,steer:0,handbrake:false,maxSpeed:30,maxReverse:6});
  const r=spec.radius,pedal=clamp(input.pedal,-1,1),handbrake=Boolean(input.handbrake),maxSpeed=clamp(input.maxSpeed??36,3,80),maxReverse=clamp(input.maxReverse??9,1,30);
  // steering: speed-sensitive lock, rate-limited
  const lock=spec.steerLock/(1+Math.abs(vf)/16),target=clamp(input.steer,-1,1)*lock,rate=2.8*dt;record.steerAngle+=clamp(target-record.steerAngle,-rate,rate);
  // brake until (almost) stopped — also while sliding sideways — then reverse
  let mode="coast";if(pedal>0.02)mode=vf<-.8?"brake":"drive";else if(pedal<-0.02)mode=vf>.8||(speed>2&&vf>-.5)?"brake":"reverse";
  const torqueCurve=s=>Math.max(.15,1-Math.max(0,s/maxSpeed-.55)/.45);
  for(const wheel of record.wheels){
    const j=wheel.joint;if(wheel.front)b3.b3WheelJoint_SetTargetSteeringAngle(j,record.steerAngle);
    const drive=wheel.front?spec.torque.front:spec.torque.rear;let spinSpeed=0,torque=drive>0?spec.coast:spec.coast*.02; // undriven wheels roll freely
    if(mode==="drive"&&drive>0){spinSpeed=maxSpeed/r;torque=drive*pedal*torqueCurve(Math.max(0,vf));}
    else if(mode==="reverse"&&drive>0){spinSpeed=-maxReverse/r;torque=drive*.7*-pedal;}
    else if(mode==="brake"){spinSpeed=0;torque=spec.brake*Math.abs(pedal);}
    if(handbrake&&!wheel.front){spinSpeed=0;torque=spec.handbrake;}
    b3.b3WheelJoint_SetSpinMotorSpeed(j,spinSpeed);b3.b3WheelJoint_SetMaxSpinTorque(j,Math.max(0,torque));
  }
  if(pedal||input.steer||handbrake)b3.b3Body_SetAwake?.(body,true);
  // anti-roll helper (like a soft parallel joint, only against big tilt) and
  // self-righting when the car lies on its side / roof and is almost stopped
  const tilt=Math.max(0,1-up[2]),ax=up[1],ay=-up[0];
  if(tilt>.06){const k=record.massKg*(up[2]<.3&&speed<2?26:6)*tilt;b3.b3Body_ApplyTorque(body,[ax*k-w[0]*record.massKg*.4,ay*k-w[1]*record.massKg*.4,0],true);}
  record.flippedFor=up[2]<.15&&speed<1.2?(record.flippedFor||0)+dt:0;
  if(record.flippedFor>2.5){record.flippedFor=0;const yaw=Math.atan2(forward[1],forward[0]);b3.b3Body_SetTransform(body,[p[0],p[1],p[2]+1.2],[0,0,Math.sin(yaw/2),Math.cos(yaw/2)]);b3.b3Body_SetLinearVelocity(body,[0,0,0]);b3.b3Body_SetAngularVelocity(body,[0,0,0]);placeWheels(physics,record);}
  record.vf=vf;
}
export function wheelPoses(physics,record){const b3=physics.b3;return(record.wheels||[]).map(w=>({position:[...b3.b3Body_GetPosition([0,0,0],w.body)],rotation:[...b3.b3Body_GetRotation([0,0,0,1],w.body)],front:w.front}));}
