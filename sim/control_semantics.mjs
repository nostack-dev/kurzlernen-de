export const ARM_LIMITS=Object.freeze({throttle:0.035,roll:0.12,pitch:0.12,yaw:0.15});
export const MIN_PHONE_GAIN=0.35;

const clampLevel=value=>Math.max(1,Math.min(10,Math.round(Number(value)||1)));
export function fineLevelToSensitivity(level){
  const t=(clampLevel(level)-1)/9;
  return 1-t*(1-MIN_PHONE_GAIN);
}
export function sensitivityToFineLevel(value){
  const gain=clampControl(Number(value),MIN_PHONE_GAIN,1);
  return clampLevel(1+9*(1-gain)/(1-MIN_PHONE_GAIN));
}

// Human defaults: LEFT/YAW 8/10 fine, RIGHT/ROLL+PITCH 9/10 fine.
// This is transmitter throw, not a second expo: the real FC already owns
// deadband/expo. Lower phone gain simply maps the short touchscreen travel to
// a smaller fraction of a physical RC stick without changing FC or physics.
export const DEFAULT_PHONE_SETTINGS=Object.freeze({
  leftSensitivity:fineLevelToSensitivity(8),
  rightSensitivity:fineLevelToSensitivity(9),
});

export function neutralControls(){return{roll:0,pitch:0,yaw:0,throttle:0,arm:false};}
export function copyControls(c){return{roll:+c.roll||0,pitch:+c.pitch||0,yaw:+c.yaw||0,throttle:+c.throttle||0,arm:Boolean(c.arm)};}
export function clampControl(value,lo=-1,hi=1){return Math.max(lo,Math.min(hi,value));}
export function normalizePhoneSettings(settings={}){
  const left=Number(settings.leftSensitivity),right=Number(settings.rightSensitivity);
  return{
    leftSensitivity:clampControl(Number.isFinite(left)?left:DEFAULT_PHONE_SETTINGS.leftSensitivity,MIN_PHONE_GAIN,1),
    rightSensitivity:clampControl(Number.isFinite(right)?right:DEFAULT_PHONE_SETTINGS.rightSensitivity,MIN_PHONE_GAIN,1),
  };
}

// Linear phone-stick throw. The FC applies its own canonical deadband and expo.
// 1/10 fineness => gain 1.00 (full RC stick); 10/10 => gain 0.35.
export function phoneAxis(value,sensitivity=1){
  return clampControl(value)*clampControl(sensitivity,MIN_PHONE_GAIN,1);
}
export function inversePhoneAxis(value,sensitivity=1){
  const gain=clampControl(sensitivity,MIN_PHONE_GAIN,1);
  return clampControl(clampControl(value)/gain);
}

export function armReady(fcState,controls,available=true,settings=DEFAULT_PHONE_SETTINGS){
  // Arming follows actual gimbal displacement, not the reduced RC throw.
  const cfg=normalizePhoneSettings(settings);
  const rawRoll=inversePhoneAxis(controls.roll,cfg.rightSensitivity),rawPitch=inversePhoneAxis(controls.pitch,cfg.rightSensitivity),rawYaw=inversePhoneAxis(controls.yaw,cfg.leftSensitivity);
  return Boolean(available)&&fcState==="DISARMED"&&controls.throttle<=ARM_LIMITS.throttle&&Math.abs(rawRoll)<ARM_LIMITS.roll&&Math.abs(rawPitch)<ARM_LIMITS.pitch&&Math.abs(rawYaw)<ARM_LIMITS.yaw;
}
export function normalizedPointer(element,event){
  const rect=element.getBoundingClientRect(),cx=rect.left+rect.width/2,cy=rect.top+rect.height/2,r=Math.max(1,Math.min(rect.width,rect.height)*.42);
  let x=(event.clientX-cx)/r,y=(event.clientY-cy)/r;const length=Math.hypot(x,y);if(length>1){x/=length;y/=length;}
  return{x:clampControl(x),y:clampControl(y)};
}
export function applyStick(controls,kind,point,settings=DEFAULT_PHONE_SETTINGS){
  const cfg=normalizePhoneSettings(settings);
  if(kind==="left"){
    controls.yaw=phoneAxis(point.x,cfg.leftSensitivity);
    controls.throttle=clampControl((1-point.y)/2,0,1);
  }else{
    // Screen-right commands a physical bank to the right. Body roll sign is
    // opposite screen X, so invert only the command; phone gain is input-only.
    controls.roll=phoneAxis(-point.x,cfg.rightSensitivity);
    controls.pitch=phoneAxis(-point.y,cfg.rightSensitivity);
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
  // Undo only the phone throw for drawing, so the knob remains under the finger.
  return kind==="left"
    ?{x:inversePhoneAxis(controls.yaw,cfg.leftSensitivity),y:1-2*controls.throttle}
    :{x:-inversePhoneAxis(controls.roll,cfg.rightSensitivity),y:-inversePhoneAxis(controls.pitch,cfg.rightSensitivity)};
}
export function knobPercent(value){return 50+clampControl(value)*42;}
