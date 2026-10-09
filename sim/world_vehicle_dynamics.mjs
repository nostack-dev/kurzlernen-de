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

export const VEHICLE_DYNAMICS_VERSION="box3d-wheel-joint-vehicles-v3.0-strut-dampers-no-upright";

// Joint frame: local x -> up (suspension + steering axis), local z -> left
// (wheel spin axis), local y -> forward. Same frame on chassis and wheel.
const FRAME_Q=[-.5,-.5,-.5,.5];
export const VEHICLE_SPECS=Object.freeze({
  car:{half:[1.78,.82,.36],mass:1350,comZ:-.18,radius:.34,wheelWidth:.22,wheelMass:22,attachZ:-.26,wheels:[[1.2,.78,true],[1.2,-.78,true],[-1.15,.78,false],[-1.15,-.78,false]],
    suspension:{hertz:3.8,damping:.8,lower:-.15,upper:.11},/* wheel torque after gearing, not crank torque */torque:{front:700,rear:1650},brake:3200,handbrake:3600,coast:40,steerLock:.58,steerTorque:3000,friction:1.35},
  bus:{half:[4,1.17,1.2],mass:9200,comZ:-.52,radius:.46,wheelWidth:.3,wheelMass:85,attachZ:-1.1,wheels:[[2.6,1.08,true],[2.6,-1.08,true],[-2.55,1.08,false],[-2.55,-1.08,false]],
    suspension:{hertz:2.8,damping:.86,lower:-.18,upper:.14},torque:{front:0,rear:4200},brake:9500,handbrake:12000,coast:260,steerLock:.44,steerTorque:6000,friction:1.15},
});
export function vehicleSpec(kind){return kind==="bus"?VEHICLE_SPECS.bus:kind==="car"||kind==="vehicle"?VEHICLE_SPECS.car:null;}
// Static sag the suspension settles at under the vehicle's weight.
// Suspension per wheel = the wheel joint (axis guidance, bump stops, spring)
// + a vertical damper strut: a distance joint from a chassis mount straight
// above the wheel to the hub, a spring-damper solved implicitly as a soft
// constraint (stable even though the 22 kg hub reacts faster than a frame).
// The strut carries the damping and a share of the stiffness, the wheel
// joint spring the rest of the stiffness with only light damping.
const SAG={car:.06,bus:.08},BODY_DAMPING=.45,SPRING_ZETA=.06,STRUT_K_SHARE=.15,STRUT_M=.55;
const sagOf=spec=>spec===VEHICLE_SPECS.bus?SAG.bus:SAG.car;
// chassis centre height above the ground at rest (wheel radius + axle drop - sag)
export function vehicleGroundOffset(spec){return spec.radius-spec.attachZ-sagOf(spec);}
// Box3D's wheel-joint spring is a soft constraint: its hertz/damping ratio act
// on the joint's effective mass (≈ the light wheel), not on the chassis. Pick
// them so the spring really carries a quarter of the chassis at the target sag
// with a well damped body motion, instead of resting on the bump stops.
export function suspensionTuning(spec,zeta=BODY_DAMPING,kShare=1){
  const q=spec.mass/4,m=spec.wheelMass*q/(spec.wheelMass+q),k=q*9.81/sagOf(spec)*kShare,w=Math.sqrt(k/m),c=2*zeta*Math.sqrt(q*q*9.81/sagOf(spec));
  return{hertz:w/(2*Math.PI),dampingRatio:c/(2*m*w),stiffness:k,damping:c};
}
// strut: its share of the stiffness, the body damping minus what the wheel joint has
export function strutTuning(spec){return suspensionTuning(spec,Math.max(0,BODY_DAMPING-SPRING_ZETA),STRUT_K_SHARE);}

const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number(v)||0));
function rotate(q,v){const[x,y,z,w]=q,[vx,vy,vz]=v,tx=2*(y*vz-z*vy),ty=2*(z*vx-x*vz),tz=2*(x*vy-y*vx);return[vx+w*tx+(y*tz-z*ty),vy+w*ty+(z*tx-x*tz),vz+w*tz+(x*ty-y*tx)];}

// Creates the four wheels and joints for an existing chassis record.
export function attachWheels(physics,record,spec,{category,mask}){
  const b3=physics.b3;if(typeof b3.b3CreateWheelJoint!=="function"||typeof b3.b3DefaultWheelJointDef!=="function")return false;
  const chassisPos=b3.b3Body_GetPosition([0,0,0],record.body),chassisRot=b3.b3Body_GetRotation([0,0,0,1],record.body);
  record.wheels=[];record.spec=spec;record.groundOffset=vehicleGroundOffset(spec);record.steerAngle=0;
  // Stability comes from the actual mass distribution, not an upright constraint.
  // Lowering the chassis COM approximates engine/floor/passenger mass while leaving
  // roll, pitch, jumps and flips entirely to Box3D contacts + suspension.
  if(Number.isFinite(spec.comZ)&&typeof b3.b3Body_GetMassData==="function"&&typeof b3.b3Body_SetMassData==="function"){const md=b3.b3Body_GetMassData(record.body);md.mass=spec.mass;md.center=[0,0,spec.comZ];b3.b3Body_SetMassData(record.body,md);}
  const r=spec.radius,volume=4/3*Math.PI*r*r*r;
  for(const[x,y,front]of spec.wheels){
    const local=[x,y,spec.attachZ],off=rotate(chassisRot,local),bd=b3.b3DefaultBodyDef();bd.type=b3.b3BodyType.b3_dynamicBody;bd.position=[chassisPos[0]+off[0],chassisPos[1]+off[1],chassisPos[2]+off[2]];bd.rotation=[...chassisRot];bd.angularDamping=.05;bd.linearDamping=.02;if("allowFastRotation"in bd)bd.allowFastRotation=true;bd.enableSleep=false;
    const body=b3.b3CreateBody(physics.world,bd),sd=b3.b3DefaultShapeDef();sd.density=spec.wheelMass/volume;sd.baseMaterial.friction=spec.friction;sd.baseMaterial.restitution=0;sd.enableContactEvents=true;sd.enableHitEvents=true;sd.filter={categoryBits:category,maskBits:mask,groupIndex:0};
    // A tyre is a finite-width cylinder, not a sphere. The cylinder axis is body-local Y,
    // exactly the wheel joint spin axis (joint-frame Z maps to body Y via FRAME_Q).
    // Box3D's cylinder runs from yOffset to yOffset+height: center it exactly on
    // the wheel-joint axle. An odd 15-sided tread also avoids symmetric contact
    // manifold degeneracy. No corrective steering/velocity hack is involved.
    // Wheels exactly as in Erin Catto's Box3D "Driving" sample (samples/sample_joint.cpp):
    // a sphere per wheel (the cylinder hull is commented out there) with
    // allowFastRotation — smooth rolling, no faceted tread bumps or wobble.
    const shape=b3.b3CreateSphereShape(body,sd,{center:[0,0,0],radius:r});
    const jd=b3.b3DefaultWheelJointDef();jd.base.bodyIdA=record.body;jd.base.bodyIdB=body;jd.base.localFrameA={position:local,quaternion:[...FRAME_Q]};jd.base.localFrameB={position:[0,0,0],quaternion:[...FRAME_Q]};jd.base.collideConnected=false;
    const tune=suspensionTuning(spec,SPRING_ZETA,1-STRUT_K_SHARE);jd.enableSuspensionSpring=true;jd.suspensionHertz=tune.hertz;jd.suspensionDampingRatio=tune.dampingRatio;jd.enableSuspensionLimit=true;jd.lowerSuspensionLimit=spec.suspension.lower;jd.upperSuspensionLimit=spec.suspension.upper;
    jd.enableSpinMotor=true;jd.maxSpinTorque=spec.coast;jd.spinSpeed=0;
    jd.enableSteering=Boolean(front);jd.steeringHertz=9;jd.steeringDampingRatio=.95;jd.maxSteeringTorque=spec.steerTorque;jd.targetSteeringAngle=0;jd.enableSteeringLimit=Boolean(front);jd.lowerSteeringLimit=-spec.steerLock;jd.upperSteeringLimit=spec.steerLock;
    const joint=b3.b3CreateWheelJoint(physics.world,jd);
    // damper strut: chassis mount STRUT_M above the hub -> hub, rest length at
    // zero suspension travel, soft spring-damper (implicit), free length range.
    let strut=null;if(typeof b3.b3CreateDistanceJoint==="function"){const st=strutTuning(spec);const dd=b3.b3DefaultDistanceJointDef();dd.base.bodyIdA=record.body;dd.base.bodyIdB=body;dd.base.localFrameA={position:[x,y,spec.attachZ+STRUT_M],quaternion:[0,0,0,1]};dd.base.localFrameB={position:[0,0,0],quaternion:[0,0,0,1]};dd.base.collideConnected=false;
      dd.length=STRUT_M;dd.enableSpring=true;dd.hertz=st.hertz;dd.dampingRatio=st.dampingRatio;dd.enableLimit=false;dd.minLength=STRUT_M-spec.suspension.upper-.25;dd.maxLength=STRUT_M-spec.suspension.lower+.25;dd.enableMotor=false;
      try{strut=b3.b3CreateDistanceJoint(physics.world,dd);}catch(error){console.warn("damper strut",error);}}
    record.wheels.push({body,shape,joint,strut,front:Boolean(front),local});physics.shapeRecords.set(physics.shapeKeyOf(shape),record);
  }

  // No "keep upright" constraint to the world: roll, pitch, tipping and flips
  // come only from mass distribution, tyres, springs and dampers.
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
export function driveWheeled(physics,record,dt,state=null){
  const b3=physics.b3,spec=record.spec,body=record.body,q=state?.rotation||b3.b3Body_GetRotation([0,0,0,1],body),v=state?.velocity||b3.b3Body_GetLinearVelocity([0,0,0],body),p=state?.position||b3.b3Body_GetPosition([0,0,0],body);
  const forward=rotate(q,[1,0,0]),vf=v[0]*forward[0]+v[1]*forward[1]+v[2]*forward[2],speed=Math.hypot(v[0],v[1],v[2]);
  const input=record.drive||(record.target?aiInput(record,p,forward,vf):{pedal:0,steer:0,handbrake:false,maxSpeed:30,maxReverse:6});
  const r=spec.radius,pedal=clamp(input.pedal,-1,1),handbrake=Boolean(input.handbrake),maxSpeed=clamp(input.maxSpeed??36,3,80),maxReverse=clamp(input.maxReverse??9,1,30);
  // Physical steering rack: the stick requests a wheel angle; the steering
  // joint motor reaches it at a finite actuator rate. No speed-based axis clamp.
  const target=clamp(input.steer,-1,1)*spec.steerLock,rate=(record.kind==="bus"?1.45:2.8)*dt;record.steerAngle+=clamp(target-record.steerAngle,-rate,rate);
  // Automatic direction selector with real braking: changing between Drive
  // and Reverse is a drivetrain state change, so it cannot happen while the
  // chassis is still moving. This prevents a spinning car from "becoming"
  // reverse merely because its body heading crossed 90 degrees.
  record.driveGear=record.driveGear===-1?-1:1;
  let mode="coast";
  if(Math.abs(pedal)>0.02){
    const desiredGear=pedal>0?1:-1;
    if(record.driveGear!==desiredGear){
      if(speed>.65)mode="brake";
      else{record.driveGear=desiredGear;mode=desiredGear>0?"drive":"reverse";}
    }else mode=desiredGear>0?"drive":"reverse";
  }
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
  if(pedal||input.steer||handbrake){b3.b3Body_SetAwake?.(body,true);for(const wheel of record.wheels)b3.b3Body_SetAwake?.(wheel.body,true);}

  record.vf=vf;
}
// Wheel poses for rendering: position from the wheel body (real suspension
// travel), orientation from the wheel joint's own frame — chassis rotation x
// steering about chassis-up x spin about the axle — so a wheel is always seen
// exactly on its axle, never twisted by solver slack.
const qa=[0,0,0,1],qb=[0,0,0,1],qc=[0,0,0,1];
function qmul(a,b,o){const[ax,ay,az,aw]=a,[bx,by,bz,bw]=b;o[0]=aw*bx+ax*bw+ay*bz-az*by;o[1]=aw*by-ax*bz+ay*bw+az*bx;o[2]=aw*bz+ax*by-ay*bx+az*bw;o[3]=aw*bw-ax*bx-ay*by-az*bz;return o;}
export function wheelPoses(physics,record,out=null){
  const b3=physics.b3,wheels=record.wheels||[],result=Array.isArray(out)?out:[],cq=b3.b3Body_GetRotation([0,0,0,1],record.body),inv=[-cq[0],-cq[1],-cq[2],cq[3]];
  for(let i=0;i<wheels.length;i++){const w=wheels[i],item=result[i]||(result[i]={position:[0,0,0],rotation:[0,0,0,1],front:false});b3.b3Body_GetPosition(item.position,w.body);b3.b3Body_GetRotation(qa,w.body);
    const steer=w.front?(typeof b3.b3WheelJoint_GetSteeringAngle==="function"?b3.b3WheelJoint_GetSteeringAngle(w.joint):record.steerAngle||0):0;
    // spin = twist of the wheel's rotation relative to the chassis about the axle (local y)
    qmul(inv,qa,qb);const sz=Math.sin(-steer/2),cz=Math.cos(-steer/2);qmul([0,0,sz,cz],qb,qc);const tw=Math.hypot(qc[1],qc[3])||1,spin=2*Math.atan2(qc[1]/tw,qc[3]/tw);
    w.spin=spin;qmul(cq,[0,0,Math.sin(steer/2),Math.cos(steer/2)],qb);qmul(qb,[0,Math.sin(spin/2),0,Math.cos(spin/2)],item.rotation);item.front=w.front;}
  result.length=wheels.length;return result;
}

