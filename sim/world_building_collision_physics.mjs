const finitePoint=point=>Array.isArray(point)&&point.length===2&&point.every(Number.isFinite);
const DEFAULT_LAUNCH_EXCLUSION_POINT=Object.freeze([0,0]);
const LAUNCH_AIRFRAME_CENTER_Z_M=.024;
const LAUNCH_AIRFRAME_HALF_Z_M=.022;
const IDENTITY_QUAT=Object.freeze([0,0,0,1]);

function pointInPolygon(point,ring){
  if(!finitePoint(point)||!Array.isArray(ring)||ring.length<3)return false;const[x,y]=point;let inside=false;
  for(let index=0,previous=ring.length-1;index<ring.length;previous=index++){
    const a=ring[index],b=ring[previous];if(!finitePoint(a)||!finitePoint(b))continue;
    const ax=a[0],ay=a[1],bx=b[0],by=b[1],cross=(ay>y)!==(by>y)&&x<(bx-ax)*(y-ay)/((by-ay)||1e-12)+ax;if(cross)inside=!inside;
  }
  return inside;
}
function overlapsLaunchVolume(prism,point=DEFAULT_LAUNCH_EXCLUSION_POINT){
  if(!pointInPolygon(point,prism?.points))return false;const base=Number(prism?.base),top=Number(prism?.top);if(!Number.isFinite(base)||!Number.isFinite(top))return false;
  return base<=LAUNCH_AIRFRAME_CENTER_Z_M+LAUNCH_AIRFRAME_HALF_Z_M&&top>=LAUNCH_AIRFRAME_CENTER_Z_M-LAUNCH_AIRFRAME_HALF_Z_M;
}
function launchHeightOverlaps(prism){
  const base=Number(prism?.base),top=Number(prism?.top);return Number.isFinite(base)&&Number.isFinite(top)&&base<=LAUNCH_AIRFRAME_CENTER_Z_M+LAUNCH_AIRFRAME_HALF_Z_M&&top>=LAUNCH_AIRFRAME_CENTER_Z_M-LAUNCH_AIRFRAME_HALF_Z_M;
}
function closestPointOnSegment(point,a,b){
  const dx=b[0]-a[0],dy=b[1]-a[1],length2=dx*dx+dy*dy;if(length2<=1e-12)return[...a];const t=Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dy)/length2));return[a[0]+dx*t,a[1]+dy*t];
}
function pointSegmentDistance(point,a,b){const q=closestPointOnSegment(point,a,b);return Math.hypot(point[0]-q[0],point[1]-q[1]);}
function prismEdgeDistance(point,prism){let best=Infinity;const ring=prism?.points||[];for(let index=0;index<ring.length;index++)best=Math.min(best,pointSegmentDistance(point,ring[index],ring[(index+1)%ring.length]));return best;}
function pointHasLaunchClearance(point,prisms,clearance){for(const prism of prisms){if(pointInPolygon(point,prism.points)||prismEdgeDistance(point,prism)<clearance)return false;}return true;}

export function normalizeBuildingCollisionSnapshot(value,{maxPrisms=512,maxVertices=24}={}){
  const prisms=[],limit=Math.max(1,Math.floor(Number(maxPrisms)||512)),vertexLimit=Math.max(3,Math.floor(Number(maxVertices)||24));for(const prism of Array.isArray(value?.prisms)?value.prisms:[]){if(prisms.length>=limit)break;const points=prism?.points;if(!Array.isArray(points)||points.length<3||points.length>vertexLimit||!points.every(finitePoint))continue;const base=Number(prism.base),top=Number(prism.top);if(!Number.isFinite(base)||!Number.isFinite(top)||top-base<.1)continue;let twiceArea=0;for(let index=0;index<points.length;index++){const a=points[index],b=points[(index+1)%points.length];twiceArea+=a[0]*b[1]-b[0]*a[1];}if(Math.abs(twiceArea)<.02)continue;prisms.push({buildingKey:String(prism.buildingKey||""),base,top,points:points.map(point=>[...point])});}
  return Object.freeze({hash:String(value?.hash||""),footprintCount:Math.max(0,Math.floor(Number(value?.footprintCount)||0)),prismCount:prisms.length,prisms});
}

export function findClearBuildingLaunchPoint(value,{point=DEFAULT_LAUNCH_EXCLUSION_POINT,clearanceM=.75,maxSearchM=80}={}){
  const snapshot=normalizeBuildingCollisionSnapshot(value),origin=finitePoint(point)?[Number(point[0]),Number(point[1])]:[0,0],clearance=Math.max(.10,Number(clearanceM)||.75),active=snapshot.prisms.filter(launchHeightOverlaps);
  if(!active.length||pointHasLaunchClearance(origin,active,clearance))return origin;
  const directlyBlocking=active.filter(prism=>pointInPolygon(origin,prism.points)||prismEdgeDistance(origin,prism)<clearance),blockingSet=new Set(directlyBlocking),blockingKeys=new Set(directlyBlocking.map(prism=>String(prism.buildingKey||"")).filter(Boolean));
  const blockers=active.filter(prism=>blockingSet.has(prism)||(prism.buildingKey&&blockingKeys.has(String(prism.buildingKey)))),pad=clearance+.05,candidates=[];
  for(const prism of blockers){
    const ring=prism.points;for(let index=0;index<ring.length;index++){
      const a=ring[index],b=ring[(index+1)%ring.length],q=closestPointOnSegment(origin,a,b),dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);if(length<=1e-9)continue;
      const nx=-dy/length,ny=dx/length;candidates.push([q[0]+nx*pad,q[1]+ny*pad],[q[0]-nx*pad,q[1]-ny*pad]);
      const radialX=q[0]-origin[0],radialY=q[1]-origin[1],radialLength=Math.hypot(radialX,radialY);if(radialLength>1e-9)candidates.push([q[0]+radialX/radialLength*pad,q[1]+radialY/radialLength*pad]);
    }
  }
  candidates.sort((a,b)=>Math.hypot(a[0]-origin[0],a[1]-origin[1])-Math.hypot(b[0]-origin[0],b[1]-origin[1]));
  for(const candidate of candidates)if(pointHasLaunchClearance(candidate,active,clearance))return candidate;
  const maxSearch=Math.max(5,Number(maxSearchM)||80),blockerExtent=Math.max(clearance*2,...blockers.flatMap(prism=>prism.points.map(p=>Math.hypot(p[0]-origin[0],p[1]-origin[1])))),baseRadius=Math.min(maxSearch,blockerExtent+pad);
  for(const scale of [1,1.25,1.5,2]){const radius=Math.min(maxSearch,baseRadius*scale);for(let index=0;index<48;index++){const angle=index/48*Math.PI*2,candidate=[origin[0]+Math.cos(angle)*radius,origin[1]+Math.sin(angle)*radius];if(pointHasLaunchClearance(candidate,active,clearance))return candidate;}if(radius>=maxSearch)break;}
  return origin;
}

function destroyCompoundResources(b3,{body=null,compound=null,hulls=[]}={}){
  if(body&&b3.b3Body_IsValid(body))b3.b3DestroyBody(body);
  if(compound)b3.b3DestroyCompound(compound);
  for(const hull of hulls||[])if(hull)b3.b3DestroyHull(hull);
}

function prismCompoundChild(b3,prism){
  const pointCount=prism.points.length,cx=prism.points.reduce((sum,point)=>sum+point[0],0)/pointCount,cy=prism.points.reduce((sum,point)=>sum+point[1],0)/pointCount,cz=(prism.base+prism.top)*.5,vertices=[];
  for(const z of [prism.base-cz,prism.top-cz])for(const point of prism.points)vertices.push(point[0]-cx,point[1]-cy,z);
  const hull=b3.b3CreateHull(vertices);if(!hull)return null;
  return{hull,transform:{position:[cx,cy,cz],quaternion:[...IDENTITY_QUAT]}};
}

export function createWorldBuildingCollisionBodies(b3,world,value,{categoryBits=1n,maskBits=6n,rangefinderCategoryBits=4n,launchExclusionPoint=DEFAULT_LAUNCH_EXCLUSION_POINT}={}){
  const snapshot=normalizeBuildingCollisionSnapshot(value);if(!world||!snapshot.prisms.length)return{body:null,compound:null,hulls:Object.freeze([]),shapeCount:0,broadphaseShapeCount:0,compoundChildCount:0,skippedLaunchPrisms:0,skippedLaunchBuildings:0,activePrisms:Object.freeze([]),...snapshot};
  // Concave/holed OSM buildings are decomposed into several convex prisms. If the
  // launch point lands in any one of those prisms, the whole source building must
  // be excluded. Skipping only the containing triangle creates an invisible solid
  // seam at its neighbour: lateral strafe then chatters against that seam and can
  // appear to stop responding even though the stick/FC command is still valid.
  const launchExcludedBuildingKeys=new Set();
  for(const prism of snapshot.prisms){
    if(!overlapsLaunchVolume(prism,launchExclusionPoint))continue;
    const key=String(prism.buildingKey||"");if(key)launchExcludedBuildingKeys.add(key);
  }

  // Box3D v0.1 compounds are explicitly designed for large static geometry: one
  // global static broadphase proxy owns an internal BVH of convex children. Keep
  // the compound data and its hulls alive for the lifetime of the shape; rebuilding
  // hundreds of global static proxies whenever OSM tiles change defeats Box3D's
  // temporal coherence and makes CCD/ray queries traverse a much larger top-level tree.
  const hulls=[],children=[],activePrisms=[];let skippedLaunchPrisms=0;
  try{
    for(const prism of snapshot.prisms){
      const key=String(prism.buildingKey||""),skipWholeBuilding=key&&launchExcludedBuildingKeys.has(key),skipUnkeyedPrism=!key&&overlapsLaunchVolume(prism,launchExclusionPoint);
      if(skipWholeBuilding||skipUnkeyedPrism){skippedLaunchPrisms++;continue;}
      const child=prismCompoundChild(b3,prism);if(!child)continue;hulls.push(child.hull);children.push(child);activePrisms.push(prism);
    }
    const skippedLaunchBuildings=launchExcludedBuildingKeys.size;
    if(!children.length)return{body:null,compound:null,hulls:Object.freeze([]),shapeCount:0,broadphaseShapeCount:0,compoundChildCount:0,skippedLaunchPrisms,skippedLaunchBuildings,activePrisms:Object.freeze([]),...snapshot};

    const compound=b3.b3CreateCompound({hulls:children});if(!compound){for(const hull of hulls)b3.b3DestroyHull(hull);return{body:null,compound:null,hulls:Object.freeze([]),shapeCount:0,broadphaseShapeCount:0,compoundChildCount:0,skippedLaunchPrisms,skippedLaunchBuildings,activePrisms:Object.freeze([]),...snapshot};}
    const bodyDef=b3.b3DefaultBodyDef();bodyDef.type=b3.b3BodyType.b3_staticBody;bodyDef.position=[0,0,0];const body=b3.b3CreateBody(world,bodyDef),shapeDef=b3.b3DefaultShapeDef();shapeDef.baseMaterial.friction=.68;shapeDef.baseMaterial.restitution=.025;
    // Buildings are physical airframe obstacles, not the GAME altitude datum. The
    // downward NAV ray must keep measuring the stable launch/terrain plane; letting
    // it hit OSM roofs makes AGL jump by an entire building height at each roof edge.
    const collisionMask=BigInt(maskBits)&~BigInt(rangefinderCategoryBits);shapeDef.filter={categoryBits:BigInt(categoryBits),maskBits:collisionMask,groupIndex:0};
    b3.b3CreateCompoundShape(body,shapeDef,compound);
    return{body,compound,hulls:Object.freeze(hulls.slice()),shapeCount:activePrisms.length,broadphaseShapeCount:1,compoundChildCount:activePrisms.length,skippedLaunchPrisms,skippedLaunchBuildings,activePrisms:Object.freeze(activePrisms.slice()),...snapshot};
  }catch(error){
    // If creation failed before ownership was returned, release all temporary hulls.
    for(const hull of hulls)try{b3.b3DestroyHull(hull);}catch{}throw error;
  }
}

export function resolveBox3dCameraPath(b3,world,anchor,desired,{queryCategoryBits=8n,terrainCategoryBits=1n,clearanceM=.08}={}){
  const from=Array.isArray(anchor)?anchor.map(Number):[],to=Array.isArray(desired)?desired.map(Number):[];if(from.length!==3||to.length!==3||![...from,...to].every(Number.isFinite))return{position:to.length===3?to:[0,0,0],collided:false,fraction:1,hitDistanceM:0};
  const delta=[to[0]-from[0],to[1]-from[1],to[2]-from[2]],distance=Math.hypot(...delta);if(!world||distance<1e-6)return{position:[...to],collided:false,fraction:1,hitDistanceM:distance};
  const filter=b3.b3DefaultQueryFilter();filter.categoryBits=BigInt(queryCategoryBits);filter.maskBits=BigInt(terrainCategoryBits);const hit=b3.b3World_CastRayClosest(world,from,delta,filter),fraction=Number(hit?.fraction);
  if(!hit?.hit||!Number.isFinite(fraction)||fraction<0||fraction>1)return{position:[...to],collided:false,fraction:1,hitDistanceM:distance};
  const hitDistance=Math.max(0,Math.min(distance,fraction*distance)),safeDistance=Math.max(0,hitDistance-Math.max(.01,Number(clearanceM)||.08)),scale=safeDistance/distance;return{position:[from[0]+delta[0]*scale,from[1]+delta[1]*scale,from[2]+delta[2]*scale],collided:true,fraction,hitDistanceM:hitDistance};
}

export function destroyWorldBuildingCollisionBodies(b3,state){destroyCompoundResources(b3,state);}
