// Real wheeled vehicles on Box3D joints (after the Box3D "Driving" sample)
// with a real tyre model (v4): see "Tyres" below.
//
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

import {groundSurfaceAt} from "./terrain_craters.mjs";
export const VEHICLE_DYNAMICS_VERSION="box3d-vehicles-v4.1-material-pair-friction";

// Joint frame: local x -> up (suspension + steering axis), local z -> left
// (wheel spin axis), local y -> forward. Same frame on chassis and wheel.
const FRAME_Q=[-.5,-.5,-.5,.5];
// Real-world-like data: mass + centre of mass (engine in front: ~55/45),
// tyre μ0 on dry asphalt, wheel torque of the low gear, engine power, drag
// area, wheel + drivetrain inertia, brake torques per wheel.
export const VEHICLE_SPECS=Object.freeze({
  car:{half:[1.78,.82,.36],mass:1350,comZ:-.06,comX:.15,radius:.34,wheelWidth:.22,wheelMass:22,attachZ:-.26,wheels:[[1.2,.78,true],[1.2,-.78,true],[-1.15,.78,false],[-1.15,-.78,false]],
    suspension:{hertz:3.8,damping:.8,lower:-.15,upper:.11},torque:{front:550,rear:850},power:140000,steerLag:.15,steerDampSpeed:15,dragArea:.68,rollingResistance:.013,wheelInertia:1.3,brake:2400,handbrake:3200,coast:30,steerLock:.58,steerTorque:3000,steerHand:430,steerAssist:600,steerAssistSpeed:6,friction:1.1},
  bus:{half:[4,1.17,1.2],mass:9200,comZ:-.52,radius:.46,wheelWidth:.3,wheelMass:85,attachZ:-1.1,wheels:[[2.6,1.08,true],[2.6,-1.08,true],[-2.55,1.08,false],[-2.55,-1.08,false]],
    suspension:{hertz:2.8,damping:.86,lower:-.18,upper:.14},torque:{front:0,rear:4200},power:230000,dragArea:6.2,rollingResistance:.008,wheelInertia:14,brake:9500,handbrake:12000,coast:200,steerLock:.44,steerTorque:6000,steerHand:2600,steerAssist:5200,steerAssistSpeed:6,friction:1.0},
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
// Tyres. Box3D carries each wheel's load (contact + suspension) but the
// wheel bodies neither spin nor rub in the solver: a sphere spinning at
// 100 rad/s rotates its contact anchor by ~1.5 rad per frame, sinks into the
// ground and skews its friction. Instead every wheel has its own spin degree
// of freedom (I·dω/dt = T_engine − T_brake − Fx·r, integrated implicitly) and
// a tyre model (Pacejka-like curve over slip ratio κ and slip angle α,
// friction ellipse, load sensitivity, sliding grip below peak). The tyre
// force acts on the chassis at the contact patch, so load transfer, pitch,
// roll and yaw follow from the physics.
const KAPPA_PEAK=.1,ALPHA_PEAK=Math.tan(6.5*Math.PI/180),SLIDE_GRIP=.78,LOAD_SENSITIVITY=.15,V_REG=2,TCS_SLIP=.11,ABS_SLIP=.11,TYRE_SUBSTEPS=5;
// Self-aligning torque: the lateral force acts behind the patch centre by the
// pneumatic trail (collapses towards the grip peak) + the caster trail. It
// acts on the wheel, against the steering column, which is a spring-damper
// (stick = target, finite stiffness): at speed the same stick deflection
// yields less wheel angle, the wheel self-centres and the steering goes
// light past the grip peak — the feel of a real car, from physics.
// Electric power steering as in a real car: the assist (column stiffness)
// falls with speed, so at speed the aligning torque holds the wheel nearer
// straight; caster/kingpin geometry adds a self-centring torque ∝ load·angle.
const RUBBER_FRICTION=.9,PNEUMATIC_TRAIL=.03,CASTER_TRAIL=.025,STEER_JACKING=.18,TRAIL_COLLAPSE=3;
// stick = hand torque on the wheel (N·m at the tyres, both wheels) incl. assist
const steerTorqueAt=(spec,v)=>(spec.steerHand||360)+(spec.steerAssist||520)/(1+(v/(spec.steerAssistSpeed||8))**2);
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
export function attachWheels(physics,record,spec,{category,mask,terrain=1n}){
  const b3=physics.b3;if(typeof b3.b3CreateWheelJoint!=="function"||typeof b3.b3DefaultWheelJointDef!=="function")return false;
  const chassisPos=b3.b3Body_GetPosition([0,0,0],record.body),chassisRot=b3.b3Body_GetRotation([0,0,0,1],record.body);
  record.wheels=[];record.spec=spec;record.groundOffset=vehicleGroundOffset(spec);record.steerAngle=0;
  // Stability comes from the actual mass distribution, not an upright constraint.
  // Lowering the chassis COM approximates engine/floor/passenger mass while leaving
  // roll, pitch, jumps and flips entirely to Box3D contacts + suspension.
  if(Number.isFinite(spec.comZ)&&typeof b3.b3Body_GetMassData==="function"&&typeof b3.b3Body_SetMassData==="function"){const md=b3.b3Body_GetMassData(record.body);md.mass=spec.mass;md.center=[spec.comX||0,0,spec.comZ];b3.b3Body_SetMassData(record.body,md);}
  const r=spec.radius,volume=4/3*Math.PI*r*r*r;
  for(const[x,y,front]of spec.wheels){
    const local=[x,y,spec.attachZ],off=rotate(chassisRot,local),bd=b3.b3DefaultBodyDef();bd.type=b3.b3BodyType.b3_dynamicBody;bd.position=[chassisPos[0]+off[0],chassisPos[1]+off[1],chassisPos[2]+off[2]];bd.rotation=[...chassisRot];bd.angularDamping=.05;bd.linearDamping=.02;if("allowFastRotation"in bd)bd.allowFastRotation=true;bd.enableSleep=false;
    const body=b3.b3CreateBody(physics.world,bd),sd=b3.b3DefaultShapeDef();sd.density=spec.wheelMass/volume;sd.baseMaterial.friction=0;sd.baseMaterial.restitution=0;sd.enableContactEvents=true;sd.enableHitEvents=true;sd.filter={categoryBits:category,maskBits:mask&terrain,groupIndex:0};
    // A tyre is a finite-width cylinder, not a sphere. The cylinder axis is body-local Y,
    // exactly the wheel joint spin axis (joint-frame Z maps to body Y via FRAME_Q).
    // Box3D's cylinder runs from yOffset to yOffset+height: center it exactly on
    // the wheel-joint axle. An odd 15-sided tread also avoids symmetric contact
    // manifold degeneracy. No corrective steering/velocity hack is involved.
    // Wheels exactly as in Erin Catto's Box3D "Driving" sample (samples/sample_joint.cpp):
    // a sphere per wheel (the cylinder hull is commented out there) with
    // allowFastRotation — smooth rolling, no faceted tread bumps or wobble.
    // two shapes, one sphere: the tyre's contact with the GROUND has no solver
    // friction (its grip is the tyre model's: rubber x surface, slip, load);
    // against everything else (kerb stones, walls, other cars) the same tyre
    // rubs with real rubber friction
    const shape=b3.b3CreateSphereShape(body,sd,{center:[0,0,0],radius:r});
    let rubber=null;{const rd=b3.b3DefaultShapeDef();rd.density=0;rd.baseMaterial.friction=RUBBER_FRICTION;rd.baseMaterial.restitution=.05;rd.enableContactEvents=true;rd.enableHitEvents=true;rd.filter={categoryBits:category,maskBits:mask&~terrain,groupIndex:0};rubber=b3.b3CreateSphereShape(body,rd,{center:[0,0,0],radius:r});physics.shapeRecords.set(physics.shapeKeyOf(rubber),record);}
    const jd=b3.b3DefaultWheelJointDef();jd.base.bodyIdA=record.body;jd.base.bodyIdB=body;jd.base.localFrameA={position:local,quaternion:[...FRAME_Q]};jd.base.localFrameB={position:[0,0,0],quaternion:[...FRAME_Q]};jd.base.collideConnected=false;
    const tune=suspensionTuning(spec,SPRING_ZETA,1-STRUT_K_SHARE);jd.enableSuspensionSpring=true;jd.suspensionHertz=tune.hertz;jd.suspensionDampingRatio=tune.dampingRatio;jd.enableSuspensionLimit=true;jd.lowerSuspensionLimit=spec.suspension.lower;jd.upperSuspensionLimit=spec.suspension.upper;
    jd.enableSpinMotor=true;jd.maxSpinTorque=spec.mass*40;jd.spinSpeed=0;/* the body does not spin: the wheel's rotation is its own DOF (tyres) */
    jd.enableSteering=Boolean(front);jd.steeringHertz=9;jd.steeringDampingRatio=.95;jd.maxSteeringTorque=spec.steerTorque;jd.targetSteeringAngle=0;jd.enableSteeringLimit=Boolean(front);jd.lowerSteeringLimit=-spec.steerLock;jd.upperSteeringLimit=spec.steerLock;
    const joint=b3.b3CreateWheelJoint(physics.world,jd);
    // damper strut: chassis mount STRUT_M above the hub -> hub, rest length at
    // zero suspension travel, soft spring-damper (implicit), free length range.
    let strut=null;if(typeof b3.b3CreateDistanceJoint==="function"){const st=strutTuning(spec);const dd=b3.b3DefaultDistanceJointDef();dd.base.bodyIdA=record.body;dd.base.bodyIdB=body;dd.base.localFrameA={position:[x,y,spec.attachZ+STRUT_M],quaternion:[0,0,0,1]};dd.base.localFrameB={position:[0,0,0],quaternion:[0,0,0,1]};dd.base.collideConnected=false;
      dd.length=STRUT_M;dd.enableSpring=true;dd.hertz=st.hertz;dd.dampingRatio=st.dampingRatio;dd.enableLimit=false;dd.minLength=STRUT_M-spec.suspension.upper-.25;dd.maxLength=STRUT_M-spec.suspension.lower+.25;dd.enableMotor=false;
      try{strut=b3.b3CreateDistanceJoint(physics.world,dd);}catch(error){console.warn("damper strut",error);}}
    record.wheels.push({body,shape,rubber,joint,strut,front:Boolean(front),local,omega:0,angle:0,travel:null,load:0,fx:0,fy:0,kappa:0,alpha:0});physics.shapeRecords.set(physics.shapeKeyOf(shape),record);
  }

  // No "keep upright" constraint to the world: roll, pitch, tipping and flips
  // come only from mass distribution, tyres, springs and dampers.
  return true;
}
export function detachWheels(physics,record){const b3=physics.b3;for(const w of record.wheels||[]){physics.shapeRecords.delete(physics.shapeKeyOf(w.shape));if(w.rubber)physics.shapeRecords.delete(physics.shapeKeyOf(w.rubber));if(b3.b3Body_IsValid(w.body))b3.b3DestroyBody(w.body);}record.wheels=null;}

// Puts the wheels back under the chassis (teleports / resets).
export function placeWheels(physics,record){
  const b3=physics.b3,p=b3.b3Body_GetPosition([0,0,0],record.body),q=b3.b3Body_GetRotation([0,0,0,1],record.body),v=b3.b3Body_GetLinearVelocity([0,0,0],record.body);
  for(const w of record.wheels||[]){const o=rotate(q,w.local);b3.b3Body_SetTransform(w.body,[p[0]+o[0],p[1]+o[1],p[2]+o[2]],[...q]);b3.b3Body_SetLinearVelocity(w.body,[...v]);b3.b3Body_SetAngularVelocity(w.body,[0,0,0]);b3.b3Body_SetAwake?.(w.body,true);}
}

// AI driver: steer towards the route target, hold the target speed.
function aiInput(record,position,forward,vf){
  const t=record.target;const dx=t.position[0]-position[0],dy=t.position[1]-position[1],dist=Math.hypot(dx,dy);if(dist<.4)return{pedal:-.4*Math.sign(vf),steer:0,handbrake:false,maxSpeed:Math.max(4,t.speedMps*1.2),maxReverse:4};
  const fx=forward[0],fy=forward[1],cross=fx*dy-fy*dx,dot=fx*dx+fy*dy,err=Math.atan2(cross,dot),steer=clamp(err*1.9,-1,1);
  // a driver slows for the bend ahead: the arc to the target needs radius
  // R = d / (2·sin|err|); comfortable lateral ≈ 0.45 g -> v ≤ √(0.45·g·R)
  const R=dist/Math.max(1e-3,2*Math.abs(Math.sin(err))),vBend=Math.sqrt(.45*9.81*R);
  const want=Math.min(t.speedMps*Math.max(.25,Math.cos(err)**2),Math.max(2.5,vBend)),pedal=clamp((want-vf)*.45,-1,1);
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
  const stick=clamp(input.steer,-1,1),rackRate=(record.kind==="bus"?1.45:2.8)*dt;
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
  // Engine: low-gear wheel torque capped by the engine power P = T·ω (ω =
  // the wheel's own spin); rev limiter at maxSpeed. Traction control and ABS
  // act like a real car's ECU: they only cut engine / brake torque when the
  // wheel's slip ratio exceeds ~14 %.
  const driveSum=2*((spec.torque.front||0)+(spec.torque.rear||0))||1,tcs=spec.tcs!==false,abs=spec.abs!==false,left=rotate(q,[0,1,0]),up=rotate(q,[0,0,1]);
  const k=spec.mass/4*9.81/sagOf(spec),cDamp=2*BODY_DAMPING*Math.sqrt(k*spec.mass/4),mq=spec.mass/4,I=spec.wheelInertia||1.3,h=dt/TYRE_SUBSTEPS,force=[0,0,0],point=[0,0,0];
  // Steering: the rack turns the front wheels until the tyres' aligning
  // torque (lateral force × pneumatic + caster trail) and the caster/kingpin
  // self-centring (load × angle) balance the driver's hand torque + power
  // assist. Solved quasi-statically each frame (the column is much faster than
  // the car); the steering servo then holds that angle, rack speed limited.
  const fronts=[];for(const wheel of record.wheels)if(wheel.front){b3.b3Body_GetPosition(hubP,wheel.body);const a=rotate(q,wheel.local),pt=[hubP[0]-up[0]*r,hubP[1]-up[1]*r,hubP[2]-up[2]*r];b3.b3Body_GetWorldPointVelocity(patchV,body,pt);
    const pf=patchV[0]*forward[0]+patchV[1]*forward[1]+patchV[2]*forward[2],pl=patchV[0]*left[0]+patchV[1]*left[1]+patchV[2]*left[2];wheel.loadF=(wheel.loadF??mq*9.81)+(Math.max(0,wheel.load||0)-(wheel.loadF??mq*9.81))*Math.min(1,dt/.1);const N=wheel.loadF;fronts.push({pf,pl,N,muN:(spec.friction||1)*groundSurfaceAt(hubP[0],hubP[1]).mu*Math.pow(clamp(N/(mq*9.81),.2,3),-LOAD_SENSITIVITY)*N,kappa:wheel.kappa||0});}
  const alignAt=d=>{let M=0;for(const f of fronts){const V=Math.max(Math.abs(f.pf),V_REG),ca=Math.cos(d),sa=Math.sin(d),vx=f.pf*ca+f.pl*sa,vy=-f.pf*sa+f.pl*ca,ta=vy/Math.max(Math.abs(vx),V_REG);tyre(f.kappa,ta,f.muN,tf);M+=(CASTER_TRAIL+PNEUMATIC_TRAIL*Math.max(0,1-Math.abs(ta)/(TRAIL_COLLAPSE*ALPHA_PEAK)))*tf[1]+f.N*STEER_JACKING*Math.sin(d);}return M;};
  // equilibrium anywhere in −lock…+lock (countersteer included), nearest the
  // current rack position when there is more than one
  let steerEq=0;if(fronts.length&&(Math.abs(stick)>1e-3||speed>.5)){const T=stick*steerTorqueAt(spec,speed),L=spec.steerLock,n=40,f=d=>T-alignAt(d);let prevD=-L,prev=f(-L),best=null;
    if(prev<0)best=-L;
    for(let i=1;i<=n;i++){const d=-L+2*L*i/n,fd=f(d);if(fd===0||Math.sign(fd)!==Math.sign(prev)){let lo=prevD,hi=d,flo=prev;for(let it=0;it<12;it++){const m=(lo+hi)/2,fm=f(m);if(Math.sign(fm)===Math.sign(flo)){lo=m;flo=fm;}else hi=m;}const root=(lo+hi)/2;if(best===null||Math.abs(root-record.steerAngle)<Math.abs(best-record.steerAngle))best=root;}prevD=d;prev=fd;}
    steerEq=best===null?(prev>0?L:-L):best;}
  // column + hands + rack inertia/damping (lag), plus the EPS's speed-dependent
  // active damping (real EPS damp more at speed for stability); rack speed limit
  record.steerEqF=(record.steerEqF||0)+(steerEq-(record.steerEqF||0))*Math.min(1,dt/((spec.steerLag||.06)*(1+speed/(spec.steerDampSpeed||20))));record.steerAngle+=clamp(record.steerEqF-record.steerAngle,-rackRate,rackRate);record.steerTorque=stick*steerTorqueAt(spec,speed);
  for(const wheel of record.wheels){
    const j=wheel.joint;if(wheel.front)b3.b3WheelJoint_SetTargetSteeringAngle(j,record.steerAngle);
    // load: the suspension's actual spring + damper force on this wheel
    b3.b3Body_GetPosition(hubP,wheel.body);const a=rotate(q,wheel.local),travel=(hubP[0]-p[0]-a[0])*up[0]+(hubP[1]-p[1]-a[1])*up[1]+(hubP[2]-p[2]-a[2])*up[2];
    const rate=wheel.travel===null?0:clamp((travel-wheel.travel)/Math.max(dt,1e-4),-3,3);wheel.travel=travel;let N=k*travel+cDamp*rate;N=N>0?N+spec.wheelMass*9.81:0;wheel.load=N;
    // peak grip of this material pair: the tyre's grip factor x rubber on this ground
    const surface=groundSurfaceAt(hubP[0],hubP[1]);wheel.surface=surface.kind;const mu=(spec.friction||1)*surface.mu*Math.pow(clamp(N/(mq*9.81),.2,3),-LOAD_SENSITIVITY),muN=mu*N;
    // contact patch, its velocity, wheel heading
    const steerA=wheel.front&&typeof b3.b3WheelJoint_GetSteeringAngle==="function"?b3.b3WheelJoint_GetSteeringAngle(j):0,ca=Math.cos(steerA),sa=Math.sin(steerA);
    const fw=[ca*forward[0]+sa*left[0],ca*forward[1]+sa*left[1],ca*forward[2]+sa*left[2]],lw=[up[1]*fw[2]-up[2]*fw[1],up[2]*fw[0]-up[0]*fw[2],up[0]*fw[1]-up[1]*fw[0]];
    point[0]=hubP[0]-up[0]*r;point[1]=hubP[1]-up[1]*r;point[2]=hubP[2]-up[2]*r;b3.b3Body_GetWorldPointVelocity(patchV,body,point);
    const vx=patchV[0]*fw[0]+patchV[1]*fw[1]+patchV[2]*fw[2],vy=patchV[0]*lw[0]+patchV[1]*lw[1]+patchV[2]*lw[2],V=Math.max(Math.abs(vx),V_REG),tanA=vy/V;
    // torques on this wheel
    const drive=wheel.front?spec.torque.front:spec.torque.rear,share=drive/driveSum;
    let brakeT=(mode==="brake"?spec.brake*Math.abs(pedal):0)+(drive>0&&mode==="coast"?spec.coast:0)+spec.wheelMass*.15;if(handbrake&&!wheel.front)brakeT=Math.max(brakeT,spec.handbrake);
    let w=wheel.omega,fxSum=0,fySum=0;
    for(let n=0;n<TYRE_SUBSTEPS;n++){
      const kap=(w*r-vx)/V;let Td=0;
      if(drive>0&&(mode==="drive"||mode==="reverse")){const dir=mode==="drive"?1:-1,lim=mode==="drive"?maxSpeed:maxReverse;
        Td=dir*Math.abs(pedal)*Math.min(drive*(dir<0?.7:1),(spec.power||Infinity)*share/Math.max(4/r,Math.abs(w)));
        if(dir*w*r>lim)Td=0;if(tcs){const ks=dir*kap;if(ks>TCS_SLIP)Td*=clamp(1-(ks-TCS_SLIP)/.12,0,1);}}
      let Tb=brakeT;if(abs&&mode==="brake"&&Math.sign(w||vx)*kap<-ABS_SLIP)Tb*=clamp(1-(-Math.sign(w||vx)*kap-ABS_SLIP)/.12,.12,1);
      tyre(kap,tanA,muN,tf);const fx0=tyre(kap+.02/V*r,tanA,muN,tf2)&&tf[0];const J=-(tf2[0]-fx0)/(.02)*r;// dT/dω of the tyre (≤ 0)
      let wn=w+h*(Td-fx0*r)/(I-h*Math.min(0,J)*1);const db=h*Tb/I;wn=Math.abs(wn)<=db?0:wn-Math.sign(wn)*db;w=wn;
      tyre((w*r-vx)/V,tanA,muN,tf);fxSum+=tf[0];fySum+=tf[1];}
    wheel.omega=w;wheel.angle=(wheel.angle+w*dt)%(Math.PI*2);
    let fx=fxSum/TYRE_SUBSTEPS,fy=fySum/TYRE_SUBSTEPS;
    // an explicit force may not reverse the motion of the contact patch within
    // one frame (a locked wheel at walking pace, sideways creep at rest)
    const slipX=w*r-vx,limY=mq*Math.abs(vy)/dt+60;if(fx*vx<0&&Math.abs(w*r)<Math.abs(vx)){const limX=mq*Math.abs(vx)/dt+60;fx=clamp(fx,-limX,limX);}/* braking slip only, never drive force */fy=clamp(fy,-limY,limY);
    fx-=(spec.rollingResistance||0)*N*Math.tanh(vx*2);
    wheel.fx=fx;wheel.fy=fy;wheel.kappa=slipX/V;wheel.alpha=Math.atan(tanA);wheel.mu=mu;
    // tyre force on the wheel at the contact patch; the joints carry it into
    // the chassis (aligning torque: steering column model above)
    if(N>0){force[0]=fw[0]*fx+lw[0]*fy;force[1]=fw[1]*fx+lw[1]*fy;force[2]=fw[2]*fx+lw[2]*fy;b3.b3Body_ApplyForce(wheel.body,force,point,true);}
  }
  // aerodynamic drag at the centre of mass
  if(spec.dragArea&&speed>.5){const d=.5*1.2*spec.dragArea*speed;force[0]=-v[0]*d;force[1]=-v[1]*d;force[2]=-v[2]*d;b3.b3Body_ApplyForceToCenter(body,force,true);}
  if(pedal||input.steer||handbrake||speed>.05){b3.b3Body_SetAwake?.(body,true);}
  record.vf=vf;
}
const hubP=[0,0,0],patchV=[0,0,0],tf=[0,0],tf2=[0,0];
// Tyre force from slip ratio κ and tan(slip angle): normalised combined slip
// s on the friction ellipse; rises with slope 2 (cornering stiffness
// ≈ 2·μN/α_peak), peaks at s = 1, falls to SLIDE_GRIP when sliding.
function tyre(kappa,tanA,muN,out){
  const sx=kappa/KAPPA_PEAK,sy=tanA/ALPHA_PEAK,s=Math.hypot(sx,sy);if(s<1e-6||!(muN>0)){out[0]=0;out[1]=0;return true;}
  const g=s<1?s*(2-s):1-(1-SLIDE_GRIP)*Math.min(1,(s-1)/2.5),F=muN*g;out[0]=F*sx/s;out[1]=-F*sy/s;return true;
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
    const turn=Number.isFinite(w.angle)?w.angle:spin;w.spin=turn;qmul(cq,[0,0,Math.sin(steer/2),Math.cos(steer/2)],qb);qmul(qb,[0,Math.sin(turn/2),0,Math.cos(turn/2)],item.rotation);item.front=w.front;}
  result.length=wheels.length;return result;
}

