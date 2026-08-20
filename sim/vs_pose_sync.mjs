// Architecture compatibility markers: legacy mode:"interpolate-predict" and velocity[index]*predictionMs/1000 are superseded by source-clock interpolation without double prediction.
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
  const candidates=values.flat().map(normalizeVsOrigin).filter(Boolean);if(!candidates.length)return null;
  if(candidates.length>=2&&vsOriginKey(candidates[0])===vsOriginKey(candidates[1]))return candidates[0];
  const unique=new Map(candidates.map(origin=>[vsOriginKey(origin),origin]));return [...unique.entries()].sort(([a],[b])=>a<b?-1:a>b?1:0)[0]?.[1]||null;
}

export function vsFrameId(origin){return vsOriginKey(origin)||"local-metric";}

export function poseMatchesVsFrame(pose,origin){
  if(typeof pose?.f!=="string"||pose.f===vsFrameId(origin))return true;
  return finiteArray(pose?.g,2)&&Math.abs(pose.g[0])<=180&&Math.abs(pose.g[1])<=90;
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

function blendVelocity(previous,remote,measured){
  let target=null;
  if(remote&&measured)target=remote.map((value,index)=>value*.7+measured[index]*.3);
  else target=remote||measured||[0,0,0];
  if(!previous)return target;
  return previous.map((value,index)=>value+(target[index]-value)*.35);
}

export class VsPoseTimeline{
  constructor({delayMs=VS_POSE_INTERPOLATION_DELAY_MS,maxExtrapolationMs=VS_POSE_MAX_EXTRAPOLATION_MS,staleMs=VS_POSE_STALE_HOLD_MS,maxSnapshots=18}={}){
    this.delayMs=Math.max(0,Number(delayMs)||0);this.maxExtrapolationMs=Math.max(0,Number(maxExtrapolationMs)||0);this.staleMs=Math.max(250,Number(staleMs)||VS_POSE_STALE_HOLD_MS);this.maxSnapshots=Math.max(4,Math.floor(Number(maxSnapshots)||18));this.snapshots=[];this.offsetSamples=[];this.clockOffsetMs=null;
  }
  reset(){this.snapshots.length=0;this.offsetSamples.length=0;this.clockOffsetMs=null;}
  push(pose,receivedMs=performance.now()){
    const p=finiteArray(pose?.p,3)?pose.p.map(Number):null,q=normalizeQuaternion(pose?.q),received=Number(receivedMs);if(!p||!q||!Number.isFinite(received))return false;
    const source=Number.isFinite(pose?.t)?Number(pose.t):received,previous=this.snapshots.at(-1);if(previous&&(received<=previous.receivedMs||source<=previous.sourceMs))return false;
    let measured=null;if(previous){const dt=(source-previous.sourceMs)/1000;if(dt>.001&&dt<1)measured=p.map((value,index)=>(value-previous.p[index])/dt);}
    const remote=finiteArray(pose?.v,3)?pose.v.map(Number):null,velocity=blendVelocity(previous?.v||null,remote,measured);
    const offsetSample=received-source;this.offsetSamples.push(offsetSample);while(this.offsetSamples.length>this.maxSnapshots)this.offsetSamples.shift();const floor=Math.min(...this.offsetSamples);
    if(this.clockOffsetMs===null)this.clockOffsetMs=floor;else if(floor<this.clockOffsetMs)this.clockOffsetMs=floor;else this.clockOffsetMs+=Math.min(1,(floor-this.clockOffsetMs)*.08);
    this.snapshots.push({p,q,v:velocity,receivedMs:received,sourceMs:source});while(this.snapshots.length>this.maxSnapshots)this.snapshots.shift();return true;
  }
  sample(nowMs=performance.now()){
    const now=Number(nowMs),snapshots=this.snapshots;if(!snapshots.length||!Number.isFinite(now))return null;const latest=snapshots.at(-1),ageMs=Math.max(0,now-latest.receivedMs),remoteNow=now-(this.clockOffsetMs??0),targetSourceMs=remoteNow-this.delayMs;
    let left=snapshots[0],right=null;for(let index=1;index<snapshots.length;index++){const candidate=snapshots[index];if(candidate.sourceMs>=targetSourceMs){right=candidate;break;}left=candidate;}
    if(right){const span=Math.max(.001,right.sourceMs-left.sourceMs),alpha=clamp((targetSourceMs-left.sourceMs)/span,0,1),position=left.p.map((value,index)=>value+(right.p[index]-value)*alpha);return{p:position,q:slerpQuaternion(left.q,right.q,alpha),ageMs,mode:"interpolate-source-clock",stale:ageMs>this.staleMs,clockOffsetMs:this.clockOffsetMs};}
    const extrapolationMs=clamp(targetSourceMs-latest.sourceMs,0,this.maxExtrapolationMs);return{p:latest.p.map((value,index)=>value+latest.v[index]*extrapolationMs/1000),q:[...latest.q],ageMs,mode:extrapolationMs>0?"extrapolate":"hold",stale:ageMs>this.staleMs,clockOffsetMs:this.clockOffsetMs};
  }
}
