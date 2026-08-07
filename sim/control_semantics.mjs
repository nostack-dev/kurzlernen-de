export const ARM_LIMITS=Object.freeze({throttle:0.035,roll:0.12,pitch:0.12,yaw:0.15});
export const DEFAULT_PHONE_SETTINGS=Object.freeze({leftSensitivity:0.30,rightSensitivity:0.10});

export function neutralControls(){return{roll:0,pitch:0,yaw:0,throttle:0,arm:false};}
export function copyControls(c){return{roll:+c.roll||0,pitch:+c.pitch||0,yaw:+c.yaw||0,throttle:+c.throttle||0,arm:Boolean(c.arm)};}
export function clampControl(value,lo=-1,hi=1){return Math.max(lo,Math.min(hi,value));}
export function normalizePhoneSettings(settings={}){
  const left=Number(settings.leftSensitivity),right=Number(settings.rightSensitivity);
  return{
    leftSensitivity:clampControl(Number.isFinite(left)?left:DEFAULT_PHONE_SETTINGS.leftSensitivity,0.10,1),
    rightSensitivity:clampControl(Number.isFinite(right)?right:DEFAULT_PHONE_SETTINGS.rightSensitivity,0.10,1),
  };
}

// Phone gimbals have far less physical travel than a real transmitter. The
// fifth-power blend makes the centre genuinely fine while preserving exact
// +/-1 endpoints, so maximum FC authority and all aircraft physics are untouched.
export function phoneAxis(value,sensitivity=1){
  const x=clampControl(value),s=clampControl(sensitivity,0.10,1),fine=x*x*x*x*x;
  return clampControl(x*s+fine*(1-s));
}
export function inversePhoneAxis(value,sensitivity=1){
  const target=Math.abs(clampControl(value));if(target===0||target===1)return Math.sign(value)*target;
  const s=clampControl(sensitivity,0.10,1),sign=Math.sign(value);let lo=0,hi=1;
  for(let i=0;i<24;i++){const mid=(lo+hi)/2,fine=mid*mid*mid*mid*mid,shaped=mid*s+fine*(1-s);if(shaped<target)lo=mid;else hi=mid;}
  return sign*(lo+hi)/2;
}

export function armReady(fcState,controls,available=true,settings=DEFAULT_PHONE_SETTINGS){
  // Arming follows actual gimbal displacement, not the sensitivity-shaped command.
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
    // opposite screen X, so invert only the command; sensitivity is input-only.
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
  // Invert only the response curve for drawing so the knob stays exactly under
  // the finger even though the command around centre is deliberately finer.
  return kind==="left"
    ?{x:inversePhoneAxis(controls.yaw,cfg.leftSensitivity),y:1-2*controls.throttle}
    :{x:-inversePhoneAxis(controls.roll,cfg.rightSensitivity),y:-inversePhoneAxis(controls.pitch,cfg.rightSensitivity)};
}
export function knobPercent(value){return 50+clampControl(value)*42;}
