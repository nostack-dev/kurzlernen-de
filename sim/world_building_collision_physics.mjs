const finitePoint=point=>Array.isArray(point)&&point.length===2&&point.every(Number.isFinite);
const DEFAULT_LAUNCH_EXCLUSION_POINT=Object.freeze([0,0]);

function pointInPolygon(point,ring){
  if(!finitePoint(point)||!Array.isArray(ring)||ring.length<3)return false;const[x,y]=point;let inside=false;
  for(let index=0,previous=ring.length-1;index<ring.length;previous=index++){
    const a=ring[index],b=ring[previous];if(!finitePoint(a)||!finitePoint(b))continue;const ax=a[0],ay=a[1],bx=b[0],by=b[1],cross=(ay>y)!==(by>y)&&x<(bx-ax)*(y-ay)/((by-ay)||1e-12)+ax;if(cross)inside=!inside;
  }
  return inside;
}
function closestPointOnSegment(point,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],length2=dx*dx+dy*dy;if(length2<=1e-12)return[...a];const t=Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dy)/length2));return[a[0]+dx*t,a[1]+dy*t];}
function pointSegmentDistance(point,a,b){const q=closestPointOnSegment(point,a,b);return Math.hypot(point[0]-q[0],point[1]-q[1]);}
function prismEdgeDistance(point,prism){let best=Infinity;const ring=prism?.points||[];for(let index=0;index<ring.length;index++)best=Math.min(best,pointSegmentDistance(point,ring[index],ring[(index+1)%ring.length]));return best;}
function pointHasLaunchClearance(point,prisms,clearance){for(const prism of prisms){if(pointInPolygon(point,prism.points)||prismEdgeDistance(point,prism)<clearance)return false;}return true;}

export function normalizeBuildingCollisionSnapshot(value,{maxPrisms=512,maxVertices=24}={}){
  const prisms=[],limit=Math.max(1,Math.floor(Number(maxPrisms)||512)),vertexLimit=Math.max(3,Math.floor(Number(maxVertices)||24));for(const prism of Array.isArray(value?.prisms)?value.prisms:[]){if(prisms.length>=limit)break;const points=prism?.points;if(!Array.isArray(points)||points.length<3||points.length>vertexLimit||!points.every(finitePoint))continue;const base=Number(prism.base),top=Number(prism.top);if(!Number.isFinite(base)||!Number.isFinite(top)||top-base<.1)continue;let twiceArea=0;for(let index=0;index<points.length;index++){const a=points[index],b=points[(index+1)%points.length];twiceArea+=a[0]*b[1]-b[0]*a[1];}if(Math.abs(twiceArea)<.02)continue;prisms.push({buildingKey:String(prism.buildingKey||""),base,top,points:points.map(point=>[...point])});}
  return Object.freeze({hash:String(value?.hash||""),footprintCount:Math.max(0,Math.floor(Number(value?.footprintCount)||0)),prismCount:prisms.length,prisms});
}

export function buildingLaunchPointClear(value,point,{clearanceM=.9}={}){
  const snapshot=normalizeBuildingCollisionSnapshot(value),candidate=finitePoint(point)?[Number(point[0]),Number(point[1])]:[0,0],clearance=Math.max(.15,Number(clearanceM)||.9);return pointHasLaunchClearance(candidate,snapshot.prisms,clearance);
}

export function findClearBuildingLaunchPoint(value,{point=DEFAULT_LAUNCH_EXCLUSION_POINT,clearanceM=.9,maxSearchM=180}={}){
  const snapshot=normalizeBuildingCollisionSnapshot(value),origin=finitePoint(point)?[Number(point[0]),Number(point[1])]:[0,0],clearance=Math.max(.15,Number(clearanceM)||.9),active=snapshot.prisms;
  if(!active.length||pointHasLaunchClearance(origin,active,clearance))return origin;
  const directlyBlocking=active.filter(prism=>pointInPolygon(origin,prism.points)||prismEdgeDistance(origin,prism)<clearance),blockingSet=new Set(directlyBlocking),blockingKeys=new Set(directlyBlocking.map(prism=>String(prism.buildingKey||"")).filter(Boolean));
  const blockers=active.filter(prism=>blockingSet.has(prism)||(prism.buildingKey&&blockingKeys.has(String(prism.buildingKey)))),pad=clearance+.18,candidates=[];
  for(const prism of blockers){const ring=prism.points;for(let index=0;index<ring.length;index++){const a=ring[index],b=ring[(index+1)%ring.length],q=closestPointOnSegment(origin,a,b),dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);if(length<=1e-9)continue;const nx=-dy/length,ny=dx/length;candidates.push([q[0]+nx*pad,q[1]+ny*pad],[q[0]-nx*pad,q[1]-ny*pad]);const radialX=q[0]-origin[0],radialY=q[1]-origin[1],radialLength=Math.hypot(radialX,radialY);if(radialLength>1e-9)candidates.push([q[0]+radialX/radialLength*pad,q[1]+radialY/radialLength*pad]);}}
  candidates.sort((a,b)=>Math.hypot(a[0]-origin[0],a[1]-origin[1])-Math.hypot(b[0]-origin[0],b[1]-origin[1]));for(const candidate of candidates)if(pointHasLaunchClearance(candidate,active,clearance))return candidate;
  const maxSearch=Math.max(10,Number(maxSearchM)||180),step=Math.max(1.25,clearance*1.4);for(let radius=step;radius<=maxSearch;radius+=step){const samples=Math.max(32,Math.ceil(radius*Math.PI/1.5));for(let index=0;index<samples;index++){const angle=index/samples*Math.PI*2,candidate=[origin[0]+Math.cos(angle)*radius,origin[1]+Math.sin(angle)*radius];if(pointHasLaunchClearance(candidate,active,clearance))return candidate;}}
  let furthest=0;for(const prism of active)for(const p of prism.points)furthest=Math.max(furthest,Math.hypot(p[0]-origin[0],p[1]-origin[1]));const guaranteedRadius=furthest+clearance*2+1;const guaranteed=[origin[0]+guaranteedRadius,origin[1]];if(pointHasLaunchClearance(guaranteed,active,clearance))return guaranteed;
  for(let index=0;index<64;index++){const angle=index/64*Math.PI*2,candidate=[origin[0]+Math.cos(angle)*guaranteedRadius,origin[1]+Math.sin(angle)*guaranteedRadius];if(pointHasLaunchClearance(candidate,active,clearance))return candidate;}
  throw Error("No collision-free WORLD launch point could be proven");
}

export function createWorldBuildingCollisionBodies(b3,world,value,{categoryBits=1n,maskBits=6n,rangefinderCategoryBits=4n,launchExclusionPoint=DEFAULT_LAUNCH_EXCLUSION_POINT}={}){
  const snapshot=normalizeBuildingCollisionSnapshot(value);void launchExclusionPoint;if(!world||!snapshot.prisms.length)return{body:null,shapeCount:0,skippedLaunchPrisms:0,skippedLaunchBuildings:0,activePrisms:Object.freeze([]),...snapshot};
  const bodyDef=b3.b3DefaultBodyDef();bodyDef.type=b3.b3BodyType.b3_staticBody;bodyDef.position=[0,0,0];const body=b3.b3CreateBody(world,bodyDef),shapeDef=b3.b3DefaultShapeDef();shapeDef.baseMaterial.friction=.68;shapeDef.baseMaterial.restitution=.025;const collisionMask=BigInt(maskBits)&~BigInt(rangefinderCategoryBits);shapeDef.filter={categoryBits:BigInt(categoryBits),maskBits:collisionMask,groupIndex:0};let shapeCount=0;const activePrisms=[];
  for(const prism of snapshot.prisms){const vertices=[];for(const height of[prism.base,prism.top])for(const point of prism.points)vertices.push(point[0],point[1],height);const hull=b3.b3CreateHull(vertices);if(!hull)continue;try{b3.b3CreateHullShape(body,shapeDef,hull);shapeCount++;activePrisms.push(prism);}finally{b3.b3DestroyHull(hull);}}
  if(!shapeCount){b3.b3DestroyBody(body);return{body:null,shapeCount:0,skippedLaunchPrisms:0,skippedLaunchBuildings:0,activePrisms:Object.freeze([]),...snapshot};}return{body,shapeCount,skippedLaunchPrisms:0,skippedLaunchBuildings:0,activePrisms:Object.freeze(activePrisms.slice()),...snapshot};
}

export function resolveBox3dCameraPath(b3,world,anchor,desired,{queryCategoryBits=8n,terrainCategoryBits=1n,clearanceM=.035,cameraRadiusM=.09}={}){
  const from=Array.isArray(anchor)?anchor.map(Number):[],to=Array.isArray(desired)?desired.map(Number):[];if(from.length!==3||to.length!==3||![...from,...to].every(Number.isFinite))return{position:to.length===3?to:[0,0,0],collided:false,fraction:1,hitDistanceM:0,cameraRadiusM:0};
  const delta=[to[0]-from[0],to[1]-from[1],to[2]-from[2]],distance=Math.hypot(...delta);if(!world||distance<1e-6)return{position:[...to],collided:false,fraction:1,hitDistanceM:distance,cameraRadiusM:0};
  const filter=b3.b3DefaultQueryFilter();filter.categoryBits=BigInt(queryCategoryBits);filter.maskBits=BigInt(terrainCategoryBits);const requestedRadius=Math.max(.012,Number(cameraRadiusM)||.09),startGroundBudget=Math.max(.012,from[2]-.006),radius=Math.min(requestedRadius,startGroundBudget);let fraction=1,hit=false;
  if(typeof b3.b3World_CastMover==="function"){const mover={center1:[0,0,0],center2:[0,0,0],radius};const castFraction=Number(b3.b3World_CastMover(world,from,mover,delta,filter,()=>true));if(Number.isFinite(castFraction)&&castFraction>=0&&castFraction<=1){fraction=castFraction;hit=castFraction<1-1e-6;}}
  else{const ray=b3.b3World_CastRayClosest(world,from,delta,filter),rayFraction=Number(ray?.fraction);if(ray?.hit&&Number.isFinite(rayFraction)&&rayFraction>=0&&rayFraction<=1){fraction=rayFraction;hit=true;}}
  if(!hit)return{position:[...to],collided:false,fraction:1,hitDistanceM:distance,cameraRadiusM:radius};const hitDistance=Math.max(0,Math.min(distance,fraction*distance)),margin=Math.max(.005,Number(clearanceM)||.035),safeDistance=Math.max(0,hitDistance-margin),safeScale=safeDistance/distance;return{position:[from[0]+delta[0]*safeScale,from[1]+delta[1]*safeScale,from[2]+delta[2]*safeScale],collided:true,fraction,hitDistanceM:hitDistance,cameraRadiusM:radius};
}

export function destroyWorldBuildingCollisionBodies(b3,state){if(state?.body&&b3.b3Body_IsValid(state.body))b3.b3DestroyBody(state.body);}
