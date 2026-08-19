const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));

export const EXTERNAL_CAMERA_PROFILES=Object.freeze({
  follow:Object.freeze({positionRate:4.8,velocityRate:7.0,headingRate:7.5,maxLagM:.18,lagRecoveryRate:8.0,teleportM:6}),
  third:Object.freeze({positionRate:3.6,velocityRate:5.2,headingRate:3.8,maxLagM:.36,lagRecoveryRate:7.0,teleportM:6}),
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
  update({position,velocity=[0,0,0],heading=[-1,0,0],mode="follow",dt=1/60}){
    if(!finite3(position))throw new Error("camera rig position must be finite");
    const profile=this.profiles[mode]||this.profiles.follow,sourceVelocity=finite3(velocity)?velocity:[0,0,0];
    const distance=Math.hypot(position[0]-this.anchor[0],position[1]-this.anchor[1],position[2]-this.anchor[2]);
    if(!this.initialized||this.mode!==mode||distance>profile.teleportM)return this.reset({position,velocity:sourceVelocity,heading,mode}).state();
    const step=clamp(dt,0,.1),velocityAlpha=dampingAlpha(profile.velocityRate,step),positionAlpha=dampingAlpha(profile.positionRate,step),headingAlpha=dampingAlpha(profile.headingRate,step);
    for(let i=0;i<3;i++){
      this.velocity[i]+=(sourceVelocity[i]-this.velocity[i])*velocityAlpha;
      this.anchor[i]+=this.velocity[i]*step;
      this.anchor[i]+=(position[i]-this.anchor[i])*positionAlpha;
    }
    const lag=[position[0]-this.anchor[0],position[1]-this.anchor[1],position[2]-this.anchor[2]],lagLength=Math.hypot(...lag);
    if(lagLength>profile.maxLagM){const excess=lagLength-profile.maxLagM,recoveryAlpha=dampingAlpha(profile.lagRecoveryRate||8,step),correction=excess*recoveryAlpha/lagLength;for(let i=0;i<3;i++)this.anchor[i]+=lag[i]*correction;}
    const targetHeading=[0,0,0];normalizeHorizontal3(targetHeading,heading,this.heading);const currentYaw=Math.atan2(this.heading[1],this.heading[0]),targetYaw=Math.atan2(targetHeading[1],targetHeading[0]),yawDelta=Math.atan2(Math.sin(targetYaw-currentYaw),Math.cos(targetYaw-currentYaw)),nextYaw=currentYaw+yawDelta*headingAlpha;this.heading[0]=Math.cos(nextYaw);this.heading[1]=Math.sin(nextYaw);this.heading[2]=0;
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
