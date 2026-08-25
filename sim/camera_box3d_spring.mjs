const finite3=value=>Array.isArray(value)&&value.length===3&&value.every(Number.isFinite);
const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));
const length3=value=>Math.hypot(Number(value?.[0])||0,Number(value?.[1])||0,Number(value?.[2])||0);
const sub3=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const lerp3=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];

export const CAMERA_SPRING_PROFILE=Object.freeze({
  halfExtents:Object.freeze([.13,.13,.11]),
  massKg:.22,
  frequencyHz:4.8,
  dampingRatio:1,
  maxAccelerationMps2:72,
  maxTargetVelocityMps:32,
  modeResetDistanceM:.75,
  teleportResetDistanceM:18,
  categoryBits:8n,
  terrainCategoryBits:1n,
  freeSnapDistanceM:.012,
  presentationDeadzoneM:.0018,
  presentationCutoffHz:10,
  releaseErrorM:.018,
  releaseFrames:3,
});

export function cameraSpringAcceleration(error,velocityError,{frequencyHz=CAMERA_SPRING_PROFILE.frequencyHz,dampingRatio=CAMERA_SPRING_PROFILE.dampingRatio,maxAccelerationMps2=CAMERA_SPRING_PROFILE.maxAccelerationMps2}={}){
  if(!finite3(error)||!finite3(velocityError))return[0,0,0];
  const omega=2*Math.PI*clamp(frequencyHz,.5,12),zeta=clamp(dampingRatio,.25,2),raw=[0,1,2].map(index=>omega*omega*error[index]+2*zeta*omega*velocityError[index]),magnitude=length3(raw),limit=clamp(maxAccelerationMps2,2,160);
  if(magnitude<=limit||magnitude<=1e-9)return raw;const scale=limit/magnitude;return raw.map(value=>value*scale);
}

export class CameraBox3dSpring{
  constructor({b3,world,profile=CAMERA_SPRING_PROFILE}={}){
    if(!b3?.b3CreateBody||!world)throw new Error("CameraBox3dSpring requires an active Box3D world");
    this.b3=b3;this.world=world;this.profile={...CAMERA_SPRING_PROFILE,...profile,halfExtents:[...(profile?.halfExtents||CAMERA_SPRING_PROFILE.halfExtents)],categoryBits:BigInt(profile?.categoryBits??CAMERA_SPRING_PROFILE.categoryBits),terrainCategoryBits:BigInt(profile?.terrainCategoryBits??CAMERA_SPRING_PROFILE.terrainCategoryBits)};this.body=null;this.shape=null;this.lastDesired=null;this.lastNow=-Infinity;this.mode="";this.resets=0;this.updates=0;this.blocked=false;this.clearFrames=0;this.presentedPosition=null;this.presentationNow=-Infinity;
  }
  valid(){return Boolean(this.body&&this.b3.b3Body_IsValid?.(this.body)!==false);}
  destroy(){if(this.valid())this.b3.b3DestroyBody(this.body);this.body=null;this.shape=null;this.lastDesired=null;this.lastNow=-Infinity;this.mode="";this.blocked=false;this.clearFrames=0;this.presentedPosition=null;this.presentationNow=-Infinity;}
  pathClear(from,to){
    if(!finite3(from)||!finite3(to))return false;const delta=sub3(to,from),distance=length3(delta);if(distance<1e-5)return true;const b3=this.b3,filter=b3.b3DefaultQueryFilter();filter.categoryBits=this.profile.categoryBits;filter.maskBits=this.profile.terrainCategoryBits;
    if(typeof b3.b3World_CastMover==="function"){const radius=Math.max(...this.profile.halfExtents),mover={center1:[0,0,0],center2:[0,0,0],radius},fraction=Number(b3.b3World_CastMover(this.world,from,mover,delta,filter,()=>true));return !Number.isFinite(fraction)||fraction>=1-1e-5;}
    if(typeof b3.b3World_CastRayClosest==="function"){const hit=b3.b3World_CastRayClosest(this.world,from,delta,filter);return !hit?.hit;}
    return false;
  }
  create(position){
    const p=finite3(position)?position:[0,0,1],b3=this.b3,bodyDef=b3.b3DefaultBodyDef();bodyDef.type=b3.b3BodyType.b3_dynamicBody;bodyDef.position=[...p];bodyDef.gravityScale=0;bodyDef.linearDamping=.28;bodyDef.angularDamping=8;bodyDef.enableSleep=false;bodyDef.isBullet=true;bodyDef.fixedRotation=true;this.body=b3.b3CreateBody(this.world,bodyDef);
    const shapeDef=b3.b3DefaultShapeDef(),half=this.profile.halfExtents,volume=8*half[0]*half[1]*half[2];shapeDef.density=Math.max(.01,this.profile.massKg/Math.max(.001,volume));shapeDef.baseMaterial.friction=.035;shapeDef.baseMaterial.restitution=0;shapeDef.enableContactEvents=false;shapeDef.enableHitEvents=false;shapeDef.filter={categoryBits:this.profile.categoryBits,maskBits:this.profile.terrainCategoryBits,groupIndex:0};this.shape=b3.b3CreateBoxShape(this.body,shapeDef,...half);return this.body;
  }
  setPose(position,{countReset=true}={}){if(!this.valid()||!finite3(position))return false;this.b3.b3Body_SetTransform(this.body,[...position],[0,0,0,1]);this.b3.b3Body_SetLinearVelocity(this.body,[0,0,0]);this.b3.b3Body_SetAngularVelocity(this.body,[0,0,0]);this.b3.b3Body_SetAwake?.(this.body,true);if(countReset)this.resets++;return true;}
  pose(){if(!this.valid())return null;const position=this.b3.b3Body_GetPosition([0,0,0],this.body),velocity=this.b3.b3Body_GetLinearVelocity([0,0,0],this.body);return{position:[...position],velocity:[...velocity]};}
  stabilize(raw,anchor,now){
    if(!finite3(raw))return raw;if(!finite3(this.presentedPosition)){this.presentedPosition=[...raw];this.presentationNow=Number(now)||0;return[...raw];}
    const delta=length3(sub3(raw,this.presentedPosition)),sampleNow=Number(now)||0,dt=clamp((sampleNow-this.presentationNow)/1000,1/240,.05);this.presentationNow=sampleNow;
    if(delta<=this.profile.presentationDeadzoneM)return[...this.presentedPosition];
    const alpha=1-Math.exp(-2*Math.PI*clamp(this.profile.presentationCutoffHz,2,30)*dt),candidate=lerp3(this.presentedPosition,raw,alpha),safe=finite3(anchor)&&this.pathClear(anchor,candidate)?candidate:raw;this.presentedPosition=[...safe];return[...safe];
  }
  update({anchor,desired,now=performance.now?.()??Date.now(),mode="camera"}={}){
    if(!finite3(desired))return null;const safeAnchor=finite3(anchor)?anchor:desired,nextMode=String(mode||"camera"),sampleNow=Number(now)||0;
    if(!this.valid()){
      const initialClear=this.pathClear(safeAnchor,desired),seed=initialClear?desired:safeAnchor;this.create(seed);this.blocked=!initialClear;this.clearFrames=0;this.lastDesired=[...desired];this.lastNow=sampleNow;this.mode=nextMode;this.presentedPosition=[...seed];this.presentationNow=sampleNow;
      if(initialClear)return this.result(desired,{anchor:safeAnchor,now:sampleNow,positionOverride:desired,freeFollow:true});
    }
    let current=this.pose();const modeChanged=this.mode&&this.mode!==nextMode;if(modeChanged){this.blocked=false;this.clearFrames=0;this.presentedPosition=null;}
    const anchorClear=this.pathClear(safeAnchor,desired),bodyClear=current?this.pathClear(current.position,desired):anchorClear,obstructed=!anchorClear||!bodyClear;
    if(!this.blocked&&!obstructed){
      if(!current||length3(sub3(desired,current.position))>=this.profile.freeSnapDistanceM){this.setPose(desired,{countReset:false});current=this.pose();}
      this.lastDesired=[...desired];this.lastNow=sampleNow;this.mode=nextMode;this.clearFrames=0;this.presentedPosition=[...desired];this.presentationNow=sampleNow;return this.result(desired,{anchor:safeAnchor,now:sampleNow,positionOverride:desired,freeFollow:true});
    }
    if(obstructed){this.blocked=true;this.clearFrames=0;}else this.clearFrames++;
    current=this.pose();const desiredJump=this.lastDesired?length3(sub3(desired,this.lastDesired)):0;
    if(desiredJump>=this.profile.teleportResetDistanceM&&this.pathClear(current?.position||safeAnchor,desired)&&anchorClear){this.blocked=false;this.clearFrames=0;this.setPose(desired);this.lastDesired=[...desired];this.lastNow=sampleNow;this.mode=nextMode;this.presentedPosition=[...desired];this.presentationNow=sampleNow;return this.result(desired,{anchor:safeAnchor,now:sampleNow,positionOverride:desired,freeFollow:true});}
    const dt=clamp((sampleNow-this.lastNow)/1000,1/240,.05),desiredVelocity=this.lastDesired?sub3(desired,this.lastDesired).map(value=>clamp(value/dt,-this.profile.maxTargetVelocityMps,this.profile.maxTargetVelocityMps)):[0,0,0],velocity=current?.velocity||[0,0,0],error=sub3(desired,current?.position||desired),velocityError=sub3(desiredVelocity,velocity),acceleration=cameraSpringAcceleration(error,velocityError,this.profile),force=acceleration.map(value=>value*this.profile.massKg);
    this.b3.b3Body_ApplyForceToCenter(this.body,force,true);this.lastDesired=[...desired];this.lastNow=sampleNow;this.mode=nextMode;this.updates++;
    current=this.pose();const releaseThreshold=Math.max(this.profile.releaseErrorM,Math.max(...this.profile.halfExtents)*.18);if(this.blocked&&!obstructed&&this.clearFrames>=this.profile.releaseFrames&&current&&length3(sub3(desired,current.position))<=releaseThreshold){this.blocked=false;this.clearFrames=0;this.setPose(desired,{countReset:false});this.presentedPosition=[...desired];this.presentationNow=sampleNow;return this.result(desired,{anchor:safeAnchor,now:sampleNow,positionOverride:desired,freeFollow:true});}
    return this.result(desired,{anchor:safeAnchor,now:sampleNow,stabilize:true,obstructed});
  }
  result(desired,{anchor=null,now=this.lastNow,positionOverride=null,stabilize=false,freeFollow=false,obstructed=this.blocked}={}){const pose=this.pose(),physicalPosition=pose?.position||[...desired],position=finite3(positionOverride)?[...positionOverride]:stabilize?this.stabilize(physicalPosition,anchor,now):[...physicalPosition],compressionM=length3(sub3(desired,physicalPosition)),radiusM=Math.max(...this.profile.halfExtents);return{position,physicalPosition:[...physicalPosition],velocity:pose?.velocity||[0,0,0],compressionM,collided:Boolean(this.blocked||obstructed),obstructed:Boolean(obstructed),freeFollow:Boolean(freeFollow),cameraRadiusM:radiusM,resets:this.resets,updates:this.updates,physics:"box3d-dynamic-spring-v1",presentation:"clear-exact+blocked-deadzone-v1"};}
}
