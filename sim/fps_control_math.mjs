import {FPS_DISPLAY_PITCH_LIMIT_RAD,FPS_HORIZONTAL_FOV_DEG,FPS_PITCH_LIMIT_RAD,FPS_WORLD_MAP_MAX_PITCH_DEG,FPS_WORLD_MAP_MIN_PITCH_DEG,fpsPitchRadToWorldMapPitchDeg,fpsVerticalFovDegForAspect} from "./camera_pitch_contract.mjs";

const TAU=Math.PI*2;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));
const smoothstep=value=>{const t=clamp(value,0,1);return t*t*(3-2*t);};

export {FPS_DISPLAY_PITCH_LIMIT_RAD,FPS_HORIZONTAL_FOV_DEG,FPS_PITCH_LIMIT_RAD,FPS_WORLD_MAP_MAX_PITCH_DEG,FPS_WORLD_MAP_MIN_PITCH_DEG,fpsPitchRadToWorldMapPitchDeg,fpsVerticalFovDegForAspect};

// Right stick, the way the big console/mobile shooters tune it (CoD "dynamic"): a small radial
// deadzone, then an anti-deadzone so the view moves the moment the stick leaves the drift zone,
// a mostly-linear centre (fine corrections are proportional, not swallowed by an expo curve) and
// a curve that only bends towards the rim for fast turns. The rate ramp is short (≈40 ms).
export const FPS_CONTROL_PROFILE=Object.freeze({
  innerDeadzone:.05,   // CoD default "right stick min" 5
  outerDeadzone:.97,
  antiDeadzone:.045,
  dynamicCurveStrength:.30,
  yawRateRadS:3.75,
  pitchRateRadS:3.40,
  touchStickYawRateRadS:4.20,
  touchStickPitchRateRadS:3.30,
  responseCurve:"dynamic",
  lookAccelerationRate:26,
  lookReleaseRate:40,
  assistYawWindowRad:7.0*Math.PI/180,
  assistPitchWindowRad:5.6*Math.PI/180,
  assistMaxDistanceM:90,
  assistSlowdownStrength:.30,
  assistCorrectionGain:4.0,
  assistMaxCorrectionRadS:.38,
});

export function wrapFpsAngleRad(value){
  let angle=(Number(value)||0)%TAU;if(angle>Math.PI)angle-=TAU;if(angle<-Math.PI)angle+=TAU;return angle;
}

export function shapeFpsStick(x,y,profile=FPS_CONTROL_PROFILE){
  const rawX=clamp(x,-1,1),rawY=clamp(y,-1,1),rawMagnitude=Math.min(1,Math.hypot(rawX,rawY)),inner=clamp(profile.innerDeadzone,0,.45),outer=clamp(profile.outerDeadzone,inner+.01,1);
  if(rawMagnitude<=inner)return{x:0,y:0,magnitude:0,rawMagnitude};
  // linear + cubic blend (k from the look-fineness setting), lifted by the anti-deadzone
  const n=clamp((rawMagnitude-inner)/(outer-inner),0,1),k=clamp(profile.dynamicCurveStrength,0,.60),anti=clamp(profile.antiDeadzone??0,0,.2),curve=profile.responseCurve==="dynamic"?fpsDynamicCurve(n)*(.5+k/.6*.5)+n*(1-(.5+k/.6*.5)):n*(1-k)+n*n*n*k,curved=n>=1?1:clamp(anti+(1-anti)*curve,0,1),scale=curved/Math.max(rawMagnitude,1e-9);
  return{x:rawX*scale,y:rawY*scale,magnitude:curved,rawMagnitude};
}

export function fpsStickVelocity(stick,profile=FPS_CONTROL_PROFILE,{touch=false}={}){
  const yawRate=touch?profile.touchStickYawRateRadS:profile.yawRateRadS,pitchRate=touch?profile.touchStickPitchRateRadS:profile.pitchRateRadS;
  return{yaw:(Number(stick?.x)||0)*yawRate,pitch:-(Number(stick?.y)||0)*pitchRate};
}

export function dampFpsLookVelocity(current,target,dt,profile=FPS_CONTROL_PROFILE){
  return integrateFpsLookVelocity(current,target,Math.min(.05,Math.max(0,Number(dt)||0)),profile).velocity;
}

export function integrateFpsLookVelocity(current,target,dt,profile=FPS_CONTROL_PROFILE){
  const from=Number(current)||0,to=Number(target)||0,delta=Math.max(0,Math.min(.25,Number(dt)||0));if(delta<=0)return{velocity:from,angleDelta:0};
  const reversing=from*to<0,growing=Math.abs(to)>Math.abs(from),rate=Math.max(1,Number(reversing?profile.lookReleaseRate:growing?profile.lookAccelerationRate:profile.lookReleaseRate)||1),decay=Math.exp(-rate*delta);
  return{velocity:to+(from-to)*decay,angleDelta:to*delta+(from-to)*(1-decay)/rate};
}

export function fpsAimAssist({yawError=0,pitchError=0,distanceM=0,stickMagnitude=0,inputYaw=0,inputPitch=0}={},profile=FPS_CONTROL_PROFILE){
  const yaw=wrapFpsAngleRad(yawError),pitch=Number(pitchError)||0,distance=Math.max(0,Number(distanceM)||0),input=Math.max(0,Math.min(1,Number(stickMagnitude)||0));
  const ellipse=Math.hypot(yaw/Math.max(.001,profile.assistYawWindowRad),pitch/Math.max(.001,profile.assistPitchWindowRad));
  if(input<=.02||ellipse>=1||distance>profile.assistMaxDistanceM)return{active:false,slowdown:1,correctionYaw:0,correctionPitch:0,strength:0,tracking:0};
  const proximity=smoothstep(1-ellipse),distanceT=clamp((distance-8)/Math.max(1,profile.assistMaxDistanceM-8),0,1),distanceScale=1-.65*smoothstep(distanceT),inputLength=Math.hypot(inputYaw,inputPitch),errorLength=Math.hypot(yaw,pitch);
  const tracking=errorLength<.002||inputLength<1e-6?1:clamp((inputYaw*yaw+inputPitch*pitch)/(inputLength*errorLength),0,1),trackingScale=.35+.65*tracking,activation=proximity*distanceScale*input*trackingScale;
  const maxCorrection=Math.max(0,profile.assistMaxCorrectionRadS),correctionYaw=clamp(yaw*profile.assistCorrectionGain*activation,-maxCorrection,maxCorrection),correctionPitch=clamp(pitch*profile.assistCorrectionGain*activation,-maxCorrection,maxCorrection),slowdown=1-profile.assistSlowdownStrength*proximity*distanceScale;
  return{active:true,slowdown,correctionYaw,correctionPitch,strength:activation,tracking};
}

// Touch drag (Call of Duty Mobile style): the look thumb drives the camera 1:1 — no deadzone, no
// smoothing, every pixel counts from the first one. Base rate ≈ 0.39°/px horizontal (a relaxed
// thumb swipe across the right half of a phone turns ~120°), vertical slightly lower. Fast flicks
// get a gentle boost up to 1.35× (a full 180° without re-grabbing) while slow, careful drags stay
// exactly linear — CoD Mobile's "fixed speed" feel with a little help for flicks.
export function fpsTouchLookDelta(dx,dy,{yawPerPx=.0068,pitchPerPx=.0059,speedPxS=NaN}={}){
  const x=Number(dx)||0,y=Number(dy)||0,speed=Number.isFinite(speedPxS)?smoothstep((speedPxS-700)/2200):smoothstep((Math.hypot(x,y)-14)/30),gain=1+.35*speed;
  return{yaw:x*yawPerPx*gain,pitch:-y*pitchPerPx*gain,gain};
}

// Controller response curve, CoD "Dynamic": an S-shaped mapping from stick deflection to turn
// rate — quick off the centre for micro-corrections, a long gentle middle for tracking, and a
// steep last quarter for fast turns. Monotone cubic Hermite through (0,0) (.3,.24) (.7,.5) (.9,.89) (1,1).
const DYN=[[0,0,1.0],[.3,.24,.62],[.7,.5,1.1],[.9,.89,1.5],[1,1,1.0]];
export function fpsDynamicCurve(n){const x=clamp(n,0,1);for(let i=0;i<DYN.length-1;i++){const[a,fa,da]=DYN[i],[b,fb,db]=DYN[i+1];if(x<=b){const h=b-a,t=(x-a)/h,t2=t*t,t3=t2*t;return clamp((2*t3-3*t2+1)*fa+(t3-2*t2+t)*h*da+(-2*t3+3*t2)*fb+(t3-t2)*h*db,0,1);}}return 1;}

export function createFpsCameraMotionState(){
  return{bobPhase:0,bobWeight:0,bobX:0,bobZ:0,bobYaw:0,bobPitch:0,bobRoll:0,recoilPitch:0,recoilYaw:0,recoilRoll:0,shakeEnergy:0,shakePhase:0,shakeX:0,shakeZ:0,shakeYaw:0,shakePitch:0,shakeRoll:0,shotSerial:0};
}

export function resetFpsCameraMotion(state){Object.assign(state,createFpsCameraMotionState());return state;}

export function addFpsShotImpulse(state){
  const serial=++state.shotSerial,noise=Math.sin(serial*12.9898)*43758.5453,fraction=noise-Math.floor(noise),signed=fraction*2-1;
  state.recoilPitch=clamp(state.recoilPitch+.016,0,.050);state.recoilYaw=clamp(state.recoilYaw+signed*.0042,-.012,.012);state.recoilRoll=clamp(state.recoilRoll-signed*.006,-.018,.018);state.shakeEnergy=clamp(state.shakeEnergy+.78,0,1.35);return state;
}

export function stepFpsCameraMotion(state,{dt=0,speedMps=0,sprinting=false}={}){
  const delta=clamp(dt,0,.05),speed=Math.max(0,Number(speedMps)||0),moving=clamp(speed/(sprinting?7.2:4.8),0,1),weightTarget=speed>.12?moving:0,weightRate=weightTarget>state.bobWeight?9:13;
  state.bobWeight=weightTarget+(state.bobWeight-weightTarget)*Math.exp(-weightRate*delta);state.bobPhase=(state.bobPhase+TAU*(1.42+speed*.105)*delta)%(TAU*1024);
  const bobScale=state.bobWeight*(sprinting?1.20:1),phase=state.bobPhase;
  state.bobX=Math.sin(phase)*.014*bobScale;state.bobZ=-Math.cos(phase*2)*.017*bobScale;state.bobYaw=Math.sin(phase)*.0017*bobScale;state.bobPitch=Math.sin(phase*2)*.0031*bobScale;state.bobRoll=Math.sin(phase)*.0044*bobScale;
  state.recoilPitch*=Math.exp(-8.5*delta);state.recoilYaw*=Math.exp(-11.5*delta);state.recoilRoll*=Math.exp(-13*delta);state.shakeEnergy*=Math.exp(-15*delta);state.shakePhase=(state.shakePhase+delta*54)%(TAU*1024);
  const shake=state.shakeEnergy,sp=state.shakePhase;state.shakeX=(Math.sin(sp*.83)+Math.sin(sp*1.91)*.35)*.0024*shake;state.shakeZ=Math.sin(sp*1.37)*.0020*shake;state.shakeYaw=Math.sin(sp*1.13)*.0015*shake;state.shakePitch=Math.sin(sp*.79)*.0012*shake;state.shakeRoll=(Math.sin(sp*1.61)+Math.sin(sp*.47)*.4)*.0028*shake;return state;
}
