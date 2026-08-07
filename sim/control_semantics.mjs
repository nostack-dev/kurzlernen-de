export const ARM_LIMITS=Object.freeze({throttle:0.035,roll:0.12,pitch:0.12,yaw:0.15});

export function neutralControls(){return{roll:0,pitch:0,yaw:0,throttle:0,arm:false};}
export function copyControls(c){return{roll:+c.roll||0,pitch:+c.pitch||0,yaw:+c.yaw||0,throttle:+c.throttle||0,arm:Boolean(c.arm)};}
export function clampControl(value,lo=-1,hi=1){return Math.max(lo,Math.min(hi,value));}
export function armReady(fcState,controls,available=true){
  return Boolean(available)&&fcState==="DISARMED"&&controls.throttle<=ARM_LIMITS.throttle&&Math.abs(controls.roll)<ARM_LIMITS.roll&&Math.abs(controls.pitch)<ARM_LIMITS.pitch&&Math.abs(controls.yaw)<ARM_LIMITS.yaw;
}
export function normalizedPointer(element,event){
  const rect=element.getBoundingClientRect(),cx=rect.left+rect.width/2,cy=rect.top+rect.height/2,r=Math.max(1,Math.min(rect.width,rect.height)*.42);
  let x=(event.clientX-cx)/r,y=(event.clientY-cy)/r;const length=Math.hypot(x,y);if(length>1){x/=length;y/=length;}
  return{x:clampControl(x),y:clampControl(y)};
}
export function applyStick(controls,kind,point){
  if(kind==="left"){
    controls.yaw=clampControl(point.x);
    controls.throttle=clampControl((1-point.y)/2,0,1);
  }else{
    // Screen-right must command a physical bank to the right. The flight/body
    // roll convention is opposite to screen X, so invert only the command.
    controls.roll=clampControl(-point.x);
    controls.pitch=clampControl(-point.y);
  }
  return controls;
}
export function releaseStick(controls,kind){
  if(kind==="left")controls.yaw=0;
  else{controls.roll=0;controls.pitch=0;}
  return controls;
}
export function knobAxes(controls,kind){
  // Undo the roll sign conversion for drawing so the right-stick knob remains
  // exactly under the user's finger while the FC receives the corrected sign.
  return kind==="left"?{x:controls.yaw,y:1-2*controls.throttle}:{x:-controls.roll,y:-controls.pitch};
}
export function knobPercent(value){return 50+clampControl(value)*42;}
