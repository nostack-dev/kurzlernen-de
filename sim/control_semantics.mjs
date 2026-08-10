export const MAX_PHONE_EXPO=0.70;
export const MIN_GAME_CLEARANCE_M=0.5;
export const MAX_GAME_CLEARANCE_M=50.0;
export const MAX_GAME_CLEARANCE_RATE_MPS=5.0;
export const GAME_CLEARANCE_RATE_DEADBAND=0.08;
export const MIN_GAME_HORIZONTAL_SPEED_KMH=5;
export const MAX_GAME_HORIZONTAL_SPEED_KMH=54;
export const DEFAULT_GAME_HORIZONTAL_SPEED_KMH=36;
// UI/transport range mirrors the FC's hardware-side GAME clearance envelope.
// Height input is spring-centred target slew: release means HOLD. It never writes
// vehicle position/velocity and still crosses SBUS -> StateController -> motors.

const clampLevel=value=>Math.max(1,Math.min(10,Math.round(Number(value)||1)));
export const finenessToExpo=level=>MAX_PHONE_EXPO*((clampLevel(level)-1)/9);
export const expoToFineness=expo=>clampLevel(1+9*clampControl(Number(expo)||0,0,MAX_PHONE_EXPO)/MAX_PHONE_EXPO);
export const gameHorizontalSpeedScale=kmh=>clampControl(Number(kmh)||DEFAULT_GAME_HORIZONTAL_SPEED_KMH,MIN_GAME_HORIZONTAL_SPEED_KMH,MAX_GAME_HORIZONTAL_SPEED_KMH)/MAX_GAME_HORIZONTAL_SPEED_KMH;

export const DEFAULT_PHONE_SETTINGS=Object.freeze({
  leftFineness:10,
  rightFineness:10,
  lockLeftHorizontal:false,
  lockRightHorizontal:false,
  invertLeftHorizontal:false,
  invertRightHorizontal:false,
  invertRightVertical:true,
  defaultHoverAgl:1.2,
  maxHorizontalSpeedKmh:DEFAULT_GAME_HORIZONTAL_SPEED_KMH,
});

export function neutralControls(){return{roll:0,pitch:0,yaw:0,throttle:0,bodyPitch:0,arm:false};}
export function copyControls(c){
  const groundClearance=Number(c?.groundClearance),bodyPitch=Number(c?.bodyPitch);
  return{
    roll:+c?.roll||0,pitch:+c?.pitch||0,yaw:+c?.yaw||0,throttle:+c?.throttle||0,bodyPitch:Number.isFinite(bodyPitch)?clampControl(bodyPitch):0,arm:Boolean(c?.arm),
    gameMode:Boolean(c?.gameMode),
    groundClearance:Number.isFinite(groundClearance)?clampControl(groundClearance,MIN_GAME_CLEARANCE_M,MAX_GAME_CLEARANCE_M):2,
  };
}
export function clampControl(value,lo=-1,hi=1){return Math.max(lo,Math.min(hi,value));}
export function clearanceRateMps(input){
  const x=clampControl(Number(input)||0),magnitude=Math.abs(x);
  if(magnitude<=GAME_CLEARANCE_RATE_DEADBAND)return 0;
  const unit=(magnitude-GAME_CLEARANCE_RATE_DEADBAND)/(1-GAME_CLEARANCE_RATE_DEADBAND);
  const human=unit*(0.25+0.75*unit);
  return Math.sign(x)*MAX_GAME_CLEARANCE_RATE_MPS*human;
}
export function stepGroundClearanceTarget(current,input,dtSeconds){
  const base=clampControl(Number(current)||MIN_GAME_CLEARANCE_M,MIN_GAME_CLEARANCE_M,MAX_GAME_CLEARANCE_M);
  // Never integrate a stale held input across a long browser pause. Real command
  // sampling is fresh/periodic too; a delayed UI frame must not create a target jump.
  const dt=clampControl(Number(dtSeconds)||0,0,0.05);
  return clampControl(base+clearanceRateMps(input)*dt,MIN_GAME_CLEARANCE_M,MAX_GAME_CLEARANCE_M);
}
export function normalizePhoneSettings(settings={}){
  return{
    leftFineness:clampLevel(settings.leftFineness??DEFAULT_PHONE_SETTINGS.leftFineness),
    rightFineness:clampLevel(settings.rightFineness??DEFAULT_PHONE_SETTINGS.rightFineness),
    lockLeftHorizontal:Boolean(settings.lockLeftHorizontal),
    lockRightHorizontal:Boolean(settings.lockRightHorizontal),
    invertLeftHorizontal:Boolean(settings.invertLeftHorizontal),
    invertRightHorizontal:Boolean(settings.invertRightHorizontal),
    invertRightVertical:Boolean(settings.invertRightVertical),
    defaultHoverAgl:Math.round(clampControl(Number(settings.defaultHoverAgl??DEFAULT_PHONE_SETTINGS.defaultHoverAgl),MIN_GAME_CLEARANCE_M,MAX_GAME_CLEARANCE_M)*10)/10,
    maxHorizontalSpeedKmh:Math.round(clampControl(Number(settings.maxHorizontalSpeedKmh??DEFAULT_PHONE_SETTINGS.maxHorizontalSpeedKmh),MIN_GAME_HORIZONTAL_SPEED_KMH,MAX_GAME_HORIZONTAL_SPEED_KMH)),
  };
}

export function phoneAxis(value,fineness=1){
  const x=clampControl(value),expo=finenessToExpo(fineness);
  return clampControl(x*(1-expo)+x*x*x*expo);
}
export function inversePhoneAxis(value,fineness=1){
  const target=Math.abs(clampControl(value));
  if(target===0||target===1)return Math.sign(value)*target;
  const expo=finenessToExpo(fineness),sign=Math.sign(value);
  let lo=0,hi=1;
  for(let i=0;i<28;i++){
    const mid=(lo+hi)/2,shaped=mid*(1-expo)+mid*mid*mid*expo;
    if(shaped<target)lo=mid;else hi=mid;
  }
  return sign*(lo+hi)/2;
}

export function armReady(fcState,_controls,available=true){
  return Boolean(available)&&fcState==="DISARMED";
}

function constrainUnit(x,y){
  const length=Math.hypot(x,y);
  if(length>1){x/=length;y/=length;}
  return{x:clampControl(x),y:clampControl(y)};
}

function renderedKnobAxes(element){
  const knob=element.querySelector?.(".knob,.solo-knob");
  const left=parseFloat(knob?.style?.left??"");
  const top=parseFloat(knob?.style?.top??"");
  return{
    x:Number.isFinite(left)?clampControl((left-50)/42):0,
    y:Number.isFinite(top)?clampControl((top-50)/42):0,
  };
}

const pointerDrags=new WeakMap();
export function normalizedPointer(element,event){
  const rect=element.getBoundingClientRect();
  const radius=Math.max(1,Math.min(rect.width,rect.height)*.42);
  if(event.type==="pointerdown"){
    const base=renderedKnobAxes(element);
    pointerDrags.set(element,{pointerId:event.pointerId,x:event.clientX,y:event.clientY,base});
    return base;
  }
  const drag=pointerDrags.get(element);
  if(drag&&drag.pointerId===event.pointerId){
    return constrainUnit(
      drag.base.x+(event.clientX-drag.x)/radius,
      drag.base.y+(event.clientY-drag.y)/radius,
    );
  }
  const cx=rect.left+rect.width/2,cy=rect.top+rect.height/2;
  return constrainUnit((event.clientX-cx)/radius,(event.clientY-cy)/radius);
}
export function endPointerDrag(element,pointerId){
  const drag=pointerDrags.get(element);
  if(!drag||pointerId==null||drag.pointerId===pointerId)pointerDrags.delete(element);
}

export function applyGameStick(controls,kind,point,settings=DEFAULT_PHONE_SETTINGS){
  const cfg=normalizePhoneSettings(settings),speedScale=gameHorizontalSpeedScale(cfg.maxHorizontalSpeedKmh);
  if(kind==="left"){
    const x=cfg.invertLeftHorizontal?-point.x:point.x;
    controls.roll=cfg.lockLeftHorizontal?0:phoneAxis(x,cfg.leftFineness)*speedScale;
    controls.pitch=phoneAxis(-point.y,cfg.leftFineness)*speedScale;
    controls.throttle=0;
  }else{
    const x=cfg.invertRightHorizontal?-point.x:point.x;
    const y=cfg.invertRightVertical?-point.y:point.y;
    controls.yaw=phoneAxis(-x,cfg.rightFineness);
    controls.bodyPitch=cfg.lockRightHorizontal?0:phoneAxis(-y,cfg.rightFineness);
  }
  return controls;
}
export function gameKnobAxes(controls,kind,settings=DEFAULT_PHONE_SETTINGS){
  const cfg=normalizePhoneSettings(settings),speedScale=gameHorizontalSpeedScale(cfg.maxHorizontalSpeedKmh);
  if(kind==="left"){
    const scaledRoll=speedScale>0?clampControl(controls.roll/speedScale):0,scaledPitch=speedScale>0?clampControl(controls.pitch/speedScale):0;
    const rawX=cfg.lockLeftHorizontal?0:inversePhoneAxis(scaledRoll,cfg.leftFineness);
    return{x:cfg.invertLeftHorizontal?-rawX:rawX,y:-inversePhoneAxis(scaledPitch,cfg.leftFineness)};
  }
  const rawX=-inversePhoneAxis(controls.yaw,cfg.rightFineness);
  const rawY=cfg.lockRightHorizontal?0:-inversePhoneAxis(controls.bodyPitch||0,cfg.rightFineness);
  return{x:cfg.invertRightHorizontal?-rawX:rawX,y:cfg.invertRightVertical?-rawY:rawY};
}

export function applyStick(controls,kind,point,settings=DEFAULT_PHONE_SETTINGS){
  const cfg=normalizePhoneSettings(settings);
  if(kind==="left"){
    const x=cfg.invertLeftHorizontal?-point.x:point.x;
    controls.yaw=cfg.lockLeftHorizontal?0:phoneAxis(x,cfg.leftFineness);
    controls.throttle=clampControl((1-point.y)/2,0,1);
  }else{
    const x=cfg.invertRightHorizontal?-point.x:point.x;
    const y=cfg.invertRightVertical?-point.y:point.y;
    controls.roll=phoneAxis(-x,cfg.rightFineness);
    controls.pitch=cfg.lockRightHorizontal?0:phoneAxis(-y,cfg.rightFineness);
  }
  return controls;
}
export function releaseStick(controls,kind){
  if(kind==="left")controls.yaw=0;
  else{controls.roll=0;controls.pitch=0;}
  return controls;
}
export function knobAxes(controls,kind,settings=DEFAULT_PHONE_SETTINGS){
  const cfg=normalizePhoneSettings(settings);
  if(kind==="left"){
    const rawX=cfg.lockLeftHorizontal?0:inversePhoneAxis(controls.yaw,cfg.leftFineness);
    return{x:cfg.invertLeftHorizontal?-rawX:rawX,y:1-2*controls.throttle};
  }
  const rawX=-inversePhoneAxis(controls.roll,cfg.rightFineness),rawY=cfg.lockRightHorizontal?0:-inversePhoneAxis(controls.pitch,cfg.rightFineness);
  return{x:cfg.invertRightHorizontal?-rawX:rawX,y:cfg.invertRightVertical?-rawY:rawY};
}
export function knobPercent(value){return 50+clampControl(value)*42;}
