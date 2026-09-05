export const WANTED_MAX_STARS=5;
export const WANTED_HEAT_THRESHOLDS=Object.freeze([2,4,7,11,16]);
export const WANTED_EMP_RANGE_M=30;
export const WANTED_EMP_COOLDOWN_MS=18000;
export const WANTED_POLICE_MAX_FIRE_RANGE_M=35;

const CRIME_SEVERITY=Object.freeze({
  person:2,
  player:2,
  car:1,
  bus:2,
  "police-drone":3,
  bird:0,
});

export function wantedCrimeSeverity(kind){
  return Math.max(0,Math.floor(Number(CRIME_SEVERITY[String(kind||"").toLowerCase()])||0));
}

export function wantedStarsForHeat(heat){
  const value=Math.max(0,Math.floor(Number(heat)||0));
  let stars=0;
  for(const threshold of WANTED_HEAT_THRESHOLDS)if(value>=threshold)stars++;
  return Math.min(WANTED_MAX_STARS,stars);
}

export function wantedPoliceCount(stars){
  return Math.max(0,Math.min(WANTED_MAX_STARS,Math.floor(Number(stars)||0)));
}

export function wantedDetectionRadiusM(stars){
  const level=Math.max(0,Math.min(WANTED_MAX_STARS,Math.floor(Number(stars)||0)));
  return level?52+level*7:0;
}

export function wantedEscapeDurationMs(stars){
  const level=Math.max(0,Math.min(WANTED_MAX_STARS,Math.floor(Number(stars)||0)));
  return level?6000+level*900:0;
}

export function wantedPoliceDamage(stars){
  const level=Math.max(1,Math.min(WANTED_MAX_STARS,Math.floor(Number(stars)||1)));
  return Math.min(6,4+Math.floor((level-1)/2));
}

export function wantedPoliceSpawnRadiusM(index=0){
  return 58+Math.max(0,Math.floor(Number(index)||0)%3)*8;
}

export function wantedPoliceArrivalDelayMs(stars){
  const level=Math.max(1,Math.min(WANTED_MAX_STARS,Math.floor(Number(stars)||1)));
  return Math.max(3000,3900-level*160);
}

export function wantedPoliceEngageDelayMs(stars){
  const level=Math.max(1,Math.min(WANTED_MAX_STARS,Math.floor(Number(stars)||1)));
  return Math.max(2500,3300-level*130);
}

export function wantedPoliceWaveBreakMs(stars){
  const level=Math.max(1,Math.min(WANTED_MAX_STARS,Math.floor(Number(stars)||1)));
  return 5600-level*240;
}

export function wantedPoliceFireRangeM(stars){
  const level=Math.max(1,Math.min(WANTED_MAX_STARS,Math.floor(Number(stars)||1)));
  return Math.min(WANTED_POLICE_MAX_FIRE_RANGE_M,28+level*1.4);
}

export function wantedPoliceShotIntervalMs(stars){
  const level=Math.max(1,Math.min(WANTED_MAX_STARS,Math.floor(Number(stars)||1)));
  return Math.max(1750,2450-level*120);
}

export function wantedPoliceHitChance({stars=1,distanceM=0,playerSpeedMps=0}={}){
  const level=Math.max(1,Math.min(WANTED_MAX_STARS,Math.floor(Number(stars)||1))),distance=Math.max(0,Number(distanceM)||0),speed=Math.max(0,Number(playerSpeedMps)||0),distancePenalty=Math.min(1,Math.max(0,(distance-7)/38))*.22,movementPenalty=Math.min(1,speed/7.2)*.24;
  return Math.max(.20,Math.min(.68,.52+level*.025-distancePenalty-movementPenalty));
}

export function wantedEmpImpulseNs(distanceM){
  const distance=Number(distanceM);if(!Number.isFinite(distance)||distance<0||distance>WANTED_EMP_RANGE_M)return 0;
  const t=Math.min(1,distance/WANTED_EMP_RANGE_M),smooth=t*t*(3-2*t);return 54+72*(1-smooth);
}

// Keep pursuers near the player's normal sightline instead of stacking them overhead.
// Slots stay deliberately non-uniform so multiple drones never form an artificial flat plane.
const POLICE_ALTITUDE_FORMATION_M=Object.freeze([0,.08,-.08,.15,-.15]);

export function wantedPoliceAltitudeOffsetM(index=0,phase="pursuit"){
  const slot=POLICE_ALTITUDE_FORMATION_M[Math.max(0,Math.floor(Number(index)||0))%POLICE_ALTITUDE_FORMATION_M.length];
  return (String(phase)==="searching"?.53:.18)+slot;
}

export function wantedPointInRing(x,y,ring){
  let inside=false;if(!Array.isArray(ring)||ring.length<3)return false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j],ax=Number(a?.[0]),ay=Number(a?.[1]),bx=Number(b?.[0]),by=Number(b?.[1]);if(!Number.isFinite(ax+ay+bx+by))continue;const crosses=(ay>y)!==(by>y)&&x<(bx-ax)*(y-ay)/((by-ay)||1e-12)+ax;if(crosses)inside=!inside;}
  return inside;
}

function edgeIntersectionT(ax,ay,bx,by,cx,cy,dx,dy){
  const rx=bx-ax,ry=by-ay,sx=dx-cx,sy=dy-cy,den=rx*sy-ry*sx;if(Math.abs(den)<1e-9)return null;
  const qx=cx-ax,qy=cy-ay,t=(qx*sy-qy*sx)/den,u=(qx*ry-qy*rx)/den;return t>=0&&t<=1&&u>=0&&u<=1?t:null;
}

function prismBlocksLine(prism,from,to){
  const base=Number(prism?.base)||0,top=Number(prism?.top)||0;if(top<Math.min(from.z,to.z)||base>Math.max(from.z,to.z))return false;
  const ring=prism?.points;if(!Array.isArray(ring)||ring.length<3)return false;const ts=[];
  if(wantedPointInRing(from.x,from.y,ring))ts.push(0);if(wantedPointInRing(to.x,to.y,ring))ts.push(1);
  for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],t=edgeIntersectionT(from.x,from.y,to.x,to.y,Number(a?.[0]),Number(a?.[1]),Number(b?.[0]),Number(b?.[1]));if(t!==null)ts.push(t);}
  if(!ts.length)return false;ts.sort((a,b)=>a-b);const samples=[...ts];for(let i=1;i<ts.length;i++)samples.push((ts[i-1]+ts[i])*.5);
  for(const t of samples){const x=from.x+(to.x-from.x)*t,y=from.y+(to.y-from.y)*t,z=from.z+(to.z-from.z)*t;if((wantedPointInRing(x,y,ring)||ts.includes(t))&&z>=base-.08&&z<=top+.12)return true;}
  return false;
}

export function wantedLineBlockedByPrisms(from,to,prisms=[]){
  if(!from||!to)return false;
  for(const prism of Array.isArray(prisms)?prisms:[])if(prismBlocksLine(prism,from,to))return true;
  return false;
}

export function wantedSearchState({stars=0,seesPlayer=false,now=0,lastContactAt=0}={}){
  const level=Math.max(0,Math.min(WANTED_MAX_STARS,Math.floor(Number(stars)||0)));
  if(level<=0)return{phase:"clear",escaped:false,elapsedMs:0,remainingMs:0,lastContactAt:Number(lastContactAt)||0};
  const current=Math.max(0,Number(now)||0),contact=Math.max(0,Number(lastContactAt)||0);
  if(seesPlayer)return{phase:"pursuit",escaped:false,elapsedMs:0,remainingMs:wantedEscapeDurationMs(level),lastContactAt:current};
  const elapsed=Math.max(0,current-contact),duration=wantedEscapeDurationMs(level),escaped=elapsed>=duration;
  return{phase:escaped?"escaped":"searching",escaped,elapsedMs:elapsed,remainingMs:Math.max(0,duration-elapsed),lastContactAt:contact};
}
