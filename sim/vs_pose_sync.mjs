const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const finiteArray=(value,length)=>Array.isArray(value)&&value.length===length&&value.every(Number.isFinite);

export const VS_POSE_INTERPOLATION_DELAY_MS=90;
export const VS_POSE_MAX_EXTRAPOLATION_MS=100;
export const VS_POSE_STALE_HOLD_MS=3000;

export function normalizeVsOrigin(value){
  if(!value||!Number.isFinite(value.lon)||!Number.isFinite(value.lat)||Math.abs(value.lon)>180||Math.abs(value.lat)>90)return null;
  return Object.freeze({lon:Number(Number(value.lon).toFixed(7)),lat:Number(Number(value.lat).toFixed(7)),alt:Number((Number.isFinite(value.alt)?Number(value.alt):0).toFixed(1))});
}

export function vsOriginKey(value){
  const origin=normalizeVsOrigin(value);return origin?`${origin.lon.toFixed(7)}:${origin.lat.toFixed(7)}:${origin.alt.toFixed(1)}`:"";
}

export function chooseCanonicalVsOrigin(...values){
  const candidates=values.flat().map(normalizeVsOrigin).filter(Boolean),unique=new Map(candidates.map(origin=>[vsOriginKey(origin),origin]));
  return [...unique.entries()].sort(([a],[b])=>a<b?-1:a>b?1:0)[0]?.[1]||null;
}

export function vsFrameId(origin){return vsOriginKey(origin)||"local-metric";}

export function poseMatchesVsFrame(pose,origin){
  return typeof pose?.f!=="string"||pose.f===vsFrameId(origin);
}

function normalizeQuaternion(value){
  if(!finiteArray(value,4))return null;const length=Math.hypot(...value);return length>1e-9?value.map(component=>component/length):null;
}

function slerpQuaternion(a,b,t){
  let bx=b[0],by=b[1],bz=b[2],bw=b[3],dot=a[0]*bx+a[1]*by+a[2]*bz+a[3]*bw;
  if(dot<0){dot=-dot;bx=-bx;by=-by;bz=-bz;bw=-bw;}
  if(dot>.9995){const out=[a[0]+(bx-a[0])*t,a[1]+(by-a[1])*t,a[2]+(bz-a[2])*t,a[3]+(bw-a[3])*t],length=Math.hypot(...out)||1;return out.map(value=>value/length);}
  const theta=Math.acos(clamp(dot,-1,1)),sin=Math.sin(theta),wa=Math.sin((1-t)*theta)/sin,wb=Math.sin(t*theta)/sin;
  return[a[0]*wa+bx*wb,a[1]*wa+by*wb,a[2]*wa+bz*wb,a[3]*wa+bw*wb];
}

export class VsPoseTimeline{
  constructor({delayMs=VS_POSE_INTERPOLATION_DELAY_MS,maxExtrapolationMs=VS_POSE_MAX_EXTRAPOLATION_MS,staleMs=VS_POSE_STALE_HOLD_MS,maxSnapshots=12}={}){
    this.delayMs=Math.max(0,Number(delayMs)||0);this.maxExtrapolationMs=Math.max(0,Number(maxExtrapolationMs)||0);this.staleMs=Math.max(250,Number(staleMs)||VS_POSE_STALE_HOLD_MS);this.maxSnapshots=Math.max(2,Math.floor(Number(maxSnapshots)||12));this.snapshots=[];
  }
  reset(){this.snapshots.length=0;}
  push(pose,receivedMs=performance.now()){
    const p=finiteArray(pose?.p,3)?pose.p.map(Number):null,q=normalizeQuaternion(pose?.q),received=Number(receivedMs);if(!p||!q||!Number.isFinite(received))return false;
    const previous=this.snapshots.at(-1);if(previous&&received<=previous.receivedMs)return false;
    let velocity=finiteArray(pose?.v,3)?pose.v.map(Number):null;
    if(!velocity&&previous){const dt=(received-previous.receivedMs)/1000;if(dt>.001&&dt<1)velocity=p.map((value,index)=>(value-previous.p[index])/dt);}
    velocity??=[0,0,0];this.snapshots.push({p,q,v:velocity,receivedMs:received,sourceMs:Number.isFinite(pose?.t)?Number(pose.t):null});while(this.snapshots.length>this.maxSnapshots)this.snapshots.shift();return true;
  }
  sample(nowMs=performance.now()){
    const now=Number(nowMs),snapshots=this.snapshots;if(!snapshots.length||!Number.isFinite(now))return null;const latest=snapshots.at(-1),ageMs=Math.max(0,now-latest.receivedMs),targetMs=now-this.delayMs;
    let left=snapshots[0],right=null;for(let index=1;index<snapshots.length;index++){const candidate=snapshots[index];if(candidate.receivedMs>=targetMs){right=candidate;break;}left=candidate;}
    if(right){const span=Math.max(.001,right.receivedMs-left.receivedMs),alpha=clamp((targetMs-left.receivedMs)/span,0,1),velocity=left.v.map((value,index)=>value+(right.v[index]-value)*alpha),predictionMs=Math.min(this.delayMs,this.maxExtrapolationMs),position=left.p.map((value,index)=>value+(right.p[index]-value)*alpha+velocity[index]*predictionMs/1000);return{p:position,q:slerpQuaternion(left.q,right.q,alpha),ageMs,mode:"interpolate-predict",stale:ageMs>this.staleMs};}
    const extrapolationMs=clamp(now-latest.receivedMs,0,this.maxExtrapolationMs);return{p:latest.p.map((value,index)=>value+latest.v[index]*extrapolationMs/1000),q:[...latest.q],ageMs,mode:extrapolationMs>0?"extrapolate":"hold",stale:ageMs>this.staleMs};
  }
}
