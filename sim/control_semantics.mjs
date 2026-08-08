export const MAX_PHONE_EXPO=0.70;

const clampLevel=value=>Math.max(1,Math.min(10,Math.round(Number(value)||1)));
export const finenessToExpo=level=>MAX_PHONE_EXPO*((clampLevel(level)-1)/9);
export const expoToFineness=expo=>clampLevel(1+9*clampControl(Number(expo)||0,0,MAX_PHONE_EXPO)/MAX_PHONE_EXPO);

export const DEFAULT_PHONE_SETTINGS=Object.freeze({
  leftFineness:7,
  rightFineness:10,
  lockLeftHorizontal:false,
  lockRightHorizontal:false,
  invertRightHorizontal:false,
});

export function neutralControls(){return{roll:0,pitch:0,yaw:0,throttle:0,bodyPitch:0,arm:false};}
export function copyControls(c){
  const groundClearance=Number(c?.groundClearance),bodyPitch=Number(c?.bodyPitch);
  return{
    roll:+c?.roll||0,pitch:+c?.pitch||0,yaw:+c?.yaw||0,throttle:+c?.throttle||0,bodyPitch:Number.isFinite(bodyPitch)?clampControl(bodyPitch):0,arm:Boolean(c?.arm),
    gameMode:Boolean(c?.gameMode),
    groundClearance:Number.isFinite(groundClearance)?clampControl(groundClearance,.5,5):2,
  };
}
export function clampControl(value,lo=-1,hi=1){return Math.max(lo,Math.min(hi,value));}
export function normalizePhoneSettings(settings={}){
  return{
    leftFineness:clampLevel(settings.leftFineness??DEFAULT_PHONE_SETTINGS.leftFineness),
    rightFineness:clampLevel(settings.rightFineness??DEFAULT_PHONE_SETTINGS.rightFineness),
    lockLeftHorizontal:Boolean(settings.lockLeftHorizontal),
    lockRightHorizontal:Boolean(settings.lockRightHorizontal),
    invertRightHorizontal:Boolean(settings.invertRightHorizontal),
  };
}

// Standard cubic transmitter-style expo for the phone input adapter only.
// It preserves the exact center and exact +/-1 endpoints, so sensitivity never
// removes controller authority. The shared C++ flight controller remains the
// sole source of aircraft control law and applies its own RC shaping.
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

// This is deliberately only a UI availability check. It never mirrors throttle,
// stick, attitude or IMU arming thresholds. Every real arming gate lives once,
// inside the shared C++ fc::Runtime used by production, HIL and SIL/WASM.
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
function invertRightHorizontalFor(element){
  if(typeof document==="undefined")return false;
  return document.documentElement?.dataset?.rightHorizontalInverted==="1"&&(element?.id==="rightStick"||element?.id==="soloRight");
}

// Virtual gimbals are displacement controls, not absolute touch pads.
// On pointer-down the current rendered stick position is captured; subsequent
// movement adds finger displacement to that position. This prevents a re-touch
// from teleporting retained throttle while keeping the right stick natural.
const pointerDrags=new WeakMap();
export function normalizedPointer(element,event){
  const rect=element.getBoundingClientRect();
  const radius=Math.max(1,Math.min(rect.width,rect.height)*.42);
  const horizontalSign=invertRightHorizontalFor(element)?-1:1;
  if(event.type==="pointerdown"){
    const base=renderedKnobAxes(element);
    pointerDrags.set(element,{pointerId:event.pointerId,x:event.clientX,y:event.clientY,base,horizontalSign});
    return base;
  }
  const drag=pointerDrags.get(element);
  if(drag&&drag.pointerId===event.pointerId){
    return constrainUnit(
      drag.base.x+drag.horizontalSign*(event.clientX-drag.x)/radius,
      drag.base.y+(event.clientY-drag.y)/radius,
    );
  }
  const cx=rect.left+rect.width/2,cy=rect.top+rect.height/2;
  return constrainUnit(horizontalSign*(event.clientX-cx)/radius,(event.clientY-cy)/radius);
}
export function endPointerDrag(element,pointerId){
  const drag=pointerDrags.get(element);
  if(!drag||pointerId==null||drag.pointerId===pointerId)pointerDrags.delete(element);
}

export function applyStick(controls,kind,point,settings=DEFAULT_PHONE_SETTINGS){
  const cfg=normalizePhoneSettings(settings);
  if(kind==="left"){
    controls.yaw=cfg.lockLeftHorizontal?0:phoneAxis(point.x,cfg.leftFineness);
    controls.throttle=clampControl((1-point.y)/2,0,1);
  }else{
    // Screen-right must command a physical bank to the right. The established
    // body-roll convention is opposite screen X, hence this single sign flip.
    controls.roll=phoneAxis(-point.x,cfg.rightFineness);
    controls.pitch=cfg.lockRightHorizontal?0:phoneAxis(-point.y,cfg.rightFineness);
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
  return kind==="left"
    ?{x:cfg.lockLeftHorizontal?0:inversePhoneAxis(controls.yaw,cfg.leftFineness),y:1-2*controls.throttle}
    :{x:-inversePhoneAxis(controls.roll,cfg.rightFineness),y:cfg.lockRightHorizontal?0:-inversePhoneAxis(controls.pitch,cfg.rightFineness)};
}
export function knobPercent(value){return 50+clampControl(value)*42;}
