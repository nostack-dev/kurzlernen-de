const TAU=Math.PI*2;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));
const smoothstep=value=>{const t=clamp(value,0,1);return t*t*(3-2*t);};

// Leave a tiny margin below 90 degrees so THREE.Camera.lookAt never becomes
// collinear with the Z-up vector, while still allowing a practically vertical view.
export const FPS_PITCH_LIMIT_RAD=Math.PI/2-.012;
export const FPS_DISPLAY_PITCH_LIMIT_RAD=Math.PI/2-.006;

export const FPS_CONTROL_PROFILE=Object.freeze({
  innerDeadzone:.075,
  outerDeadzone:.98,
  dynamicCurveStrength:.045,
  yawRateRadS:3.80,
  pitchRateRadS:3.42,
  touchStickYawRateRadS:2.88,
  touchStickPitchRateRadS:2.58,
  lookAccelerationRate:20,
  lookReleaseRate:38,
  assistYawWindowRad:6.5*Math.PI/180,
  assistPitchWindowRad:5.0*Math.PI/180,
  assistMaxDistanceM:90,
  assistSlowdownStrength:.34,
  assistCorrectionGain:4.0,
  assistMaxCorrectionRadS:.38,
});

export function wrapFpsAngleRad(value){
  let angle=(Number(value)||0)%TAU;if(angle>Math.PI)angle-=TAU;if(angle<-Math.PI)angle+=TAU;return angle;
}

export function shapeFpsStick(x,y,profile=FPS_CONTROL_PROFILE){
  const rawX=clamp(x,-1,1),rawY=clamp(y,-1,1),rawMagnitude=Math.min(1,Math.hypot(rawX,rawY)),inner=clamp(profile.innerDeadzone,0,.45),outer=clamp(profile.outerDeadzone,inner+.01,1);
  if(rawMagnitude<=inner)return{x:0,y:0,magnitude:0,rawMagnitude};
  const normalized=clamp((rawMagnitude-inner)/(outer-inner),0,1),strength=clamp(profile.dynamicCurveStrength,0,.12),curved=clamp(normalized+Math.sin(normalized*TAU)*strength,0,1),scale=curved/Math.max(rawMagnitude,1e-9);
  return{x:rawX*scale,y:rawY*scale,magnitude:curved,rawMagnitude};
}

export function fpsStickVelocity(stick,profile=FPS_CONTROL_PROFILE,{touch=false}={}){
  const yawRate=touch?profile.touchStickYawRateRadS:profile.yawRateRadS,pitchRate=touch?profile.touchStickPitchRateRadS:profile.pitchRateRadS;
  return{yaw:(Number(stick?.x)||0)*yawRate,pitch:-(Number(stick?.y)||0)*pitchRate};
}

export function dampFpsLookVelocity(current,target,dt,profile=FPS_CONTROL_PROFILE){
  const from=Number(current)||0,to=Number(target)||0,delta=Math.max(0,Math.min(.05,Number(dt)||0));if(delta<=0)return from;
  const reversing=from*to<0,growing=Math.abs(to)>Math.abs(from),rate=reversing?profile.lookReleaseRate:growing?profile.lookAccelerationRate:profile.lookReleaseRate;
  return to+(from-to)*Math.exp(-Math.max(1,Number(rate)||1)*delta);
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

export function fpsTouchLookDelta(dx,dy,{yawPerPx=.00425,pitchPerPx=.00382}={}){
  const x=Number(dx)||0,y=Number(dy)||0,speed=smoothstep(Math.hypot(x,y)/20),gain=.82+.28*speed;
  return{yaw:x*yawPerPx*gain,pitch:-y*pitchPerPx*gain,gain};
}

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
