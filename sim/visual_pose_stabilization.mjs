const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));

export const EXTERNAL_AIRFRAME_VISUAL_PROFILES=Object.freeze({
  follow:Object.freeze({offsetRate:9.0,rotationRate:12.0,softPositionErrorM:.025,maxPositionErrorM:.10,errorRecoveryRate:9.0,softRotationErrorRad:3*Math.PI/180,maxRotationErrorRad:10*Math.PI/180,rotationRecoveryRate:10.0}),
  third:Object.freeze({offsetRate:5.2,rotationRate:7.0,softPositionErrorM:.050,maxPositionErrorM:.18,errorRecoveryRate:7.0,softRotationErrorRad:5*Math.PI/180,maxRotationErrorRad:14*Math.PI/180,rotationRecoveryRate:7.5}),
});

export function visualDampingAlpha(ratePerSecond,dtSeconds){
  const rate=Math.max(0,Number(ratePerSecond)||0),dt=clamp(dtSeconds,0,.1);
  return rate>0&&dt>0?1-Math.exp(-rate*dt):0;
}
function finite3(value){return value?.length>=3&&value.slice(0,3).every(Number.isFinite);}
function finite4(value){return value?.length>=4&&value.slice(0,4).every(Number.isFinite);}
function normalizeQuat(target,source){
  const x=Number(source?.[0]),y=Number(source?.[1]),z=Number(source?.[2]),w=Number(source?.[3]),length=Math.hypot(x,y,z,w);
  if(!(length>1e-9)){target[0]=target[1]=target[2]=0;target[3]=1;return target;}
  target[0]=x/length;target[1]=y/length;target[2]=z/length;target[3]=w/length;return target;
}
function slerpQuat(target,a,b,t){
  let bx=b[0],by=b[1],bz=b[2],bw=b[3],dot=a[0]*bx+a[1]*by+a[2]*bz+a[3]*bw;
  if(dot<0){dot=-dot;bx=-bx;by=-by;bz=-bz;bw=-bw;}
  dot=clamp(dot,-1,1);
  if(dot>.9995){target[0]=a[0]+(bx-a[0])*t;target[1]=a[1]+(by-a[1])*t;target[2]=a[2]+(bz-a[2])*t;target[3]=a[3]+(bw-a[3])*t;return normalizeQuat(target,target);}
  const theta=Math.acos(dot),sinTheta=Math.sin(theta),aScale=Math.sin((1-t)*theta)/sinTheta,bScale=Math.sin(t*theta)/sinTheta;
  target[0]=a[0]*aScale+bx*bScale;target[1]=a[1]*aScale+by*bScale;target[2]=a[2]*aScale+bz*bScale;target[3]=a[3]*aScale+bw*bScale;return normalizeQuat(target,target);
}
function quatAngle(a,b){return 2*Math.acos(clamp(Math.abs(a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3]),-1,1));}

export class StabilizedExternalAirframeVisual{
  constructor(profiles=EXTERNAL_AIRFRAME_VISUAL_PROFILES){this.profiles=profiles;this.offset=[0,0,0];this.quaternion=[0,0,0,1];this.outputPosition=[0,0,0];this.mode="";this.initialized=false;}
  invalidate(){this.initialized=false;this.mode="";}
  reset({position,quaternion,cameraAnchor,mode="follow"}){
    if(!finite3(position)||!finite3(cameraAnchor)||!finite4(quaternion))throw new Error("external visual pose must be finite");
    for(let i=0;i<3;i++){this.offset[i]=Number(position[i])-Number(cameraAnchor[i]);this.outputPosition[i]=Number(position[i]);}
    normalizeQuat(this.quaternion,quaternion);this.mode=mode;this.initialized=true;return this.state();
  }
  update({position,quaternion,cameraAnchor,mode="follow",dt=1/60}){
    if(!finite3(position)||!finite3(cameraAnchor)||!finite4(quaternion))throw new Error("external visual pose must be finite");
    const profile=this.profiles[mode]||this.profiles.follow;
    if(!this.initialized||this.mode!==mode)return this.reset({position,quaternion,cameraAnchor,mode});
    const step=clamp(dt,0,.1),alpha=visualDampingAlpha(profile.offsetRate,step),rawOffset=[position[0]-cameraAnchor[0],position[1]-cameraAnchor[1],position[2]-cameraAnchor[2]];
    for(let i=0;i<3;i++)this.offset[i]+=(rawOffset[i]-this.offset[i])*alpha;
    let ex=rawOffset[0]-this.offset[0],ey=rawOffset[1]-this.offset[1],ez=rawOffset[2]-this.offset[2],error=Math.hypot(ex,ey,ez);
    if(error>profile.softPositionErrorM){const excess=error-profile.softPositionErrorM,recovery=visualDampingAlpha(profile.errorRecoveryRate,step),correction=excess*recovery/error;this.offset[0]+=ex*correction;this.offset[1]+=ey*correction;this.offset[2]+=ez*correction;}
    ex=rawOffset[0]-this.offset[0];ey=rawOffset[1]-this.offset[1];ez=rawOffset[2]-this.offset[2];error=Math.hypot(ex,ey,ez);
    if(error>profile.maxPositionErrorM){const correction=(error-profile.maxPositionErrorM)/error;this.offset[0]+=ex*correction;this.offset[1]+=ey*correction;this.offset[2]+=ez*correction;}
    const target=[0,0,0,1];normalizeQuat(target,quaternion);slerpQuat(this.quaternion,this.quaternion,target,visualDampingAlpha(profile.rotationRate,step));
    let angleError=quatAngle(this.quaternion,target);if(angleError>profile.softRotationErrorRad){const excess=angleError-profile.softRotationErrorRad,recovery=visualDampingAlpha(profile.rotationRecoveryRate,step);slerpQuat(this.quaternion,this.quaternion,target,clamp(excess*recovery/angleError,0,1));}
    angleError=quatAngle(this.quaternion,target);if(angleError>profile.maxRotationErrorRad)slerpQuat(this.quaternion,this.quaternion,target,1-profile.maxRotationErrorRad/angleError);
    for(let i=0;i<3;i++)this.outputPosition[i]=cameraAnchor[i]+this.offset[i];
    return this.state(position,target);
  }
  state(rawPosition=null,rawQuaternion=null){
    const positionErrorM=rawPosition?Math.hypot(rawPosition[0]-this.outputPosition[0],rawPosition[1]-this.outputPosition[1],rawPosition[2]-this.outputPosition[2]):0;
    const rotationErrorRad=rawQuaternion?quatAngle(this.quaternion,rawQuaternion):0;
    return{position:this.outputPosition,quaternion:this.quaternion,mode:this.mode,positionErrorM,rotationErrorRad};
  }
}
