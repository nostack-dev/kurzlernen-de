const finite=value=>Number.isFinite(Number(value));
const finitePoint=point=>Array.isArray(point)&&point.length>=2&&finite(point[0])&&finite(point[1]);
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

export const WORLD_SPAWN_BUILDING_CLEARANCE_M=1.25;
export const WORLD_SPAWN_GROUND_CLEARANCE_M=.035;
export const WORLD_RESPAWN_MIN_OFFSET_M=8;
export const WORLD_RESPAWN_MAX_OFFSET_M=32;
export const WORLD_SPAWN_MAX_SLOPE_DEG=32;

function pointInPolygon(point,ring){if(!finitePoint(point)||!Array.isArray(ring)||ring.length<3)return false;const[x,y]=point;let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if(!finitePoint(a)||!finitePoint(b))continue;const cross=(a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/((b[1]-a[1])||1e-12)+a[0];if(cross)inside=!inside;}return inside;}
function pointSegmentDistance(point,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],l2=dx*dx+dy*dy;if(l2<=1e-12)return Math.hypot(point[0]-a[0],point[1]-a[1]);const t=clamp(((point[0]-a[0])*dx+(point[1]-a[1])*dy)/l2,0,1),x=a[0]+dx*t,y=a[1]+dy*t;return Math.hypot(point[0]-x,point[1]-y);}
function polygonDistance(point,ring){if(pointInPolygon(point,ring))return 0;let best=Infinity;for(let i=0;i<ring.length;i++)best=Math.min(best,pointSegmentDistance(point,ring[i],ring[(i+1)%ring.length]));return best;}
function blockedByBuildings(point,groundZ,prisms,clearance){for(const prism of Array.isArray(prisms)?prisms:[]){const ring=prism?.points||[];if(ring.length<3)continue;const base=Number(prism.base),top=Number(prism.top);if(!finite(base)||!finite(top)||top<groundZ-.5)continue;if(polygonDistance(point,ring)<clearance)return true;}return false;}
function mulberry32(seed){let a=seed>>>0;return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function seedFrom(reference,seed){if(Number.isFinite(seed))return Number(seed)>>>0;const x=Math.round((Number(reference?.[0])||0)*100),y=Math.round((Number(reference?.[1])||0)*100),z=Math.round((Number(reference?.[2])||0)*100);return(Math.imul(x,73856093)^Math.imul(y,19349663)^Math.imul(z,83492791)^Date.now())>>>0;}

export function spawnCandidatePoints(reference,{randomized=false,seed,minOffsetM=WORLD_RESPAWN_MIN_OFFSET_M,maxOffsetM=WORLD_RESPAWN_MAX_OFFSET_M,maxSearchM=80,count=72}={}){
  const origin=[Number(reference?.[0])||0,Number(reference?.[1])||0],out=[];
  if(!randomized)out.push(origin);
  const rnd=mulberry32(seedFrom(reference,seed)),n=Math.max(12,Math.floor(count));
  if(randomized){for(let i=0;i<n;i++){const radius=minOffsetM+(maxOffsetM-minOffsetM)*Math.sqrt(rnd()),angle=rnd()*Math.PI*2;out.push([origin[0]+Math.cos(angle)*radius,origin[1]+Math.sin(angle)*radius]);}}
  else{for(let ring=1;ring<=8;ring++){const radius=Math.min(maxSearchM,ring*5);for(let i=0;i<12;i++){const angle=(i/12+ring*.173)*Math.PI*2;out.push([origin[0]+Math.cos(angle)*radius,origin[1]+Math.sin(angle)*radius]);}}}
  return out;
}

export function solveRaytracedSafeSpawn({reference=[0,0,0],terrainHeightAt,raycastDown,prisms=[],randomized=false,seed,airframeSupportM=.022,buildingClearanceM=WORLD_SPAWN_BUILDING_CLEARANCE_M,groundClearanceM=WORLD_SPAWN_GROUND_CLEARANCE_M,maxSlopeDeg=WORLD_SPAWN_MAX_SLOPE_DEG}={}){
  if(typeof terrainHeightAt!=='function'||typeof raycastDown!=='function')return null;const maxSlopeCos=Math.cos(clamp(Number(maxSlopeDeg)||WORLD_SPAWN_MAX_SLOPE_DEG,0,80)*Math.PI/180),candidates=spawnCandidatePoints(reference,{randomized,seed});
  for(let index=0;index<candidates.length;index++){
    const [x,y]=candidates[index],terrainZ=Number(terrainHeightAt(x,y));if(!finite(terrainZ))continue;if(blockedByBuildings([x,y],terrainZ,prisms,Math.max(.2,Number(buildingClearanceM)||WORLD_SPAWN_BUILDING_CLEARANCE_M)))continue;
    const ray=raycastDown(x,y,terrainZ);const hitZ=Number(ray?.z),normal=Array.isArray(ray?.normal)?ray.normal.map(Number):null;if(!finite(hitZ)||!normal||normal.length!==3||!normal.every(finite))continue;
    // The DEM and Box3D terrain must agree. A first hit substantially above DEM is
    // a roof/obstacle, not a valid launch surface.
    if(Math.abs(hitZ-terrainZ)>.40)continue;const normalLength=Math.hypot(...normal)||1;if(normal[2]/normalLength<maxSlopeCos)continue;
    const z=hitZ+Math.max(.005,Number(airframeSupportM)||.022)+Math.max(.005,Number(groundClearanceM)||WORLD_SPAWN_GROUND_CLEARANCE_M);
    return Object.freeze({position:Object.freeze([x,y,z]),terrainZ:hitZ,normal:Object.freeze(normal.map(value=>value/normalLength)),candidateIndex:index,randomized:Boolean(randomized)});
  }
  return null;
}
