const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));

// External cameras are presentation-frame locked. The old inertial translation
// filter deliberately allowed 18–26 cm of camera-anchor lag, which made the
// already-current aircraft visibly pull through FOLLOW/THIRD. Keep the exported
// profile surface for diagnostics/tests, but make translational lag an invariant:
// zero metres in every external mode.
export const EXTERNAL_CAMERA_PROFILES=Object.freeze({
  follow:Object.freeze({maxLagM:0}),
  third:Object.freeze({maxLagM:0}),
});

export function dampingAlpha(ratePerSecond,dtSeconds){
  const rate=Math.max(0,Number(ratePerSecond)||0),dt=clamp(dtSeconds,0,.1);
  return rate>0&&dt>0?1-Math.exp(-rate*dt):0;
}

function finite3(value){return value?.length>=3&&value.slice(0,3).every(Number.isFinite);}
function copy3(target,source){target[0]=Number(source[0]);target[1]=Number(source[1]);target[2]=Number(source[2]);return target;}
function normalize3(target,source,fallback=[-1,0,0]){
  const x=Number(source?.[0]),y=Number(source?.[1]),z=Number(source?.[2]),length=Math.hypot(x,y,z);
  if(!(length>1e-9)){copy3(target,fallback);return target;}
  target[0]=x/length;target[1]=y/length;target[2]=z/length;return target;
}
function normalizeHorizontal3(target,source,fallback=[-1,0,0]){
  const x=Number(source?.[0]),y=Number(source?.[1]),length=Math.hypot(x,y);
  if(!(length>1e-9)){const fx=Number(fallback?.[0]),fy=Number(fallback?.[1]),fallbackLength=Math.hypot(fx,fy)||1;target[0]=fx/fallbackLength;target[1]=fy/fallbackLength;target[2]=0;return target;}
  target[0]=x/length;target[1]=y/length;target[2]=0;return target;
}

export class StabilizedExternalCameraRig{
  constructor(profiles=EXTERNAL_CAMERA_PROFILES){
    this.profiles=profiles;this.anchor=[0,0,0];this.velocity=[0,0,0];this.heading=[-1,0,0];this.mode="";this.initialized=false;
  }
  invalidate(){this.initialized=false;this.mode="";}
  reset({position,velocity=[0,0,0],heading=[-1,0,0],mode="follow"}){
    if(!finite3(position))throw new Error("camera rig position must be finite");
    copy3(this.anchor,position);copy3(this.velocity,finite3(velocity)?velocity:[0,0,0]);normalizeHorizontal3(this.heading,heading);this.mode=mode;this.initialized=true;return this;
  }
  update({position,velocity=[0,0,0],heading=[-1,0,0],mode="follow"}){
    if(!finite3(position))throw new Error("camera rig position must be finite");
    const sourceVelocity=finite3(velocity)?velocity:[0,0,0];
    if(!this.initialized||this.mode!==mode)return this.reset({position,velocity:sourceVelocity,heading,mode}).state();

    // This is the critical invariant: FOLLOW and THIRD use the exact same
    // interpolated presentation translation as the visible aircraft on this
    // frame. No extra chase-camera spring, prediction or bounded positional lag.
    copy3(this.anchor,position);
    copy3(this.velocity,sourceVelocity);
    normalizeHorizontal3(this.heading,heading,this.heading);
    this.mode=mode;
    return this.state();
  }
  state(){return{anchor:this.anchor,velocity:this.velocity,heading:this.heading,mode:this.mode};}
}

export function externalCameraFrame(anchor,heading,{back,up,lookAhead,lookUp}={}){
  if(!finite3(anchor)||!finite3(heading))throw new Error("camera frame requires finite anchor and heading");
  const h=[0,0,0];normalize3(h,heading);const b=Number(back)||0,u=Number(up)||0,a=Number(lookAhead)||0,l=Number(lookUp)||0;
  return{
    position:[anchor[0]-h[0]*b,anchor[1]-h[1]*b,anchor[2]-h[2]*b+u],
    target:[anchor[0]+h[0]*a,anchor[1]+h[1]*a,anchor[2]+h[2]*a+l],
  };
}
