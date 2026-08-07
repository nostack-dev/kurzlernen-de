export const ARM_LIMITS=Object.freeze({throttle:0.035,roll:0.12,pitch:0.12,yaw:0.15});
export const PHONE_EXPO=0.55;

export function neutralControls(){return{roll:0,pitch:0,yaw:0,throttle:0,arm:false};}
export function copyControls(c){return{roll:+c.roll||0,pitch:+c.pitch||0,yaw:+c.yaw||0,throttle:+c.throttle||0,arm:Boolean(c.arm)};}
export function clampControl(value,lo=-1,hi=1){return Math.max(lo,Math.min(hi,value));}

// Phone gimbals have very short physical travel compared with a real RC stick.
// Expo changes only the input-device response: center becomes finer while the
// endpoints remain exactly +/-1, so maximum FC command authority is untouched.
export function phoneAxis(value,expo=PHONE_EXPO){
  const x=clampControl(value),e=clampControl(expo,0,1);
  return clampControl(x*(1-e)+x*x*x*e);
}
export function inversePhoneAxis(value,expo=PHONE_EXPO){
  const target=Math.abs(clampControl(value));if(target===0||target===1)return Math.sign(value)*target;
  const e=clampControl(expo,0,1),sign=Math.sign(value);let lo=0,hi=1;
  for(let i=0;i<22;i++){const mid=(lo+hi)/2,shaped=mid*(1-e)+mid*mid*mid*e;if(shaped<target)lo=mid;else hi=mid;}
  return sign*(lo+hi)/2;
}

export function armReady(fcState,controls,available=true){
  // Arming is based on actual gimbal displacement, not the expo-reduced command.
  const rawRoll=inversePhoneAxis(controls.roll),rawPitch=inversePhoneAxis(controls.pitch),rawYaw=inversePhoneAxis(controls.yaw);
  return Boolean(available)&&fcState==="DISARMED"&&controls.throttle<=ARM_LIMITS.throttle&&Math.abs(rawRoll)<ARM_LIMITS.roll&&Math.abs(rawPitch)<ARM_LIMITS.pitch&&Math.abs(rawYaw)<ARM_LIMITS.yaw;
}
export function normalizedPointer(element,event){
  const rect=element.getBoundingClientRect(),cx=rect.left+rect.width/2,cy=rect.top+rect.height/2,r=Math.max(1,Math.min(rect.width,rect.height)*.42);
  let x=(event.clientX-cx)/r,y=(event.clientY-cy)/r;const length=Math.hypot(x,y);if(length>1){x/=length;y/=length;}
  return{x:clampControl(x),y:clampControl(y)};
}
export function applyStick(controls,kind,point){
  if(kind==="left"){
    controls.yaw=phoneAxis(point.x);
    controls.throttle=clampControl((1-point.y)/2,0,1);
  }else{
    // Screen-right commands a physical bank to the right. Body roll sign is
    // opposite screen X, so invert the command and then apply phone-gimbal expo.
    controls.roll=phoneAxis(-point.x);
    controls.pitch=phoneAxis(-point.y);
  }
  return controls;
}
export function releaseStick(controls,kind){
  if(kind==="left")controls.yaw=0;
  else{controls.roll=0;controls.pitch=0;}
  return controls;
}
export function knobAxes(controls,kind){
  // Invert the response curve only for drawing so the knob remains exactly
  // under the finger even though the command around center is less sensitive.
  return kind==="left"?{x:inversePhoneAxis(controls.yaw),y:1-2*controls.throttle}:{x:-inversePhoneAxis(controls.roll),y:-inversePhoneAxis(controls.pitch)};
}
export function knobPercent(value){return 50+clampControl(value)*42;}
