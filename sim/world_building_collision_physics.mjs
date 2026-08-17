const finitePoint=point=>Array.isArray(point)&&point.length===2&&point.every(Number.isFinite);
const DEFAULT_LAUNCH_EXCLUSION_POINT=Object.freeze([0,0]);
const LAUNCH_AIRFRAME_CENTER_Z_M=.024;
const LAUNCH_AIRFRAME_HALF_Z_M=.022;

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

export function createWorldBuildingCollisionBodies(b3,world,value,{categoryBits=1n,maskBits=6n,rangefinderCategoryBits=4n,launchExclusionPoint=DEFAULT_LAUNCH_EXCLUSION_POINT}={}){
  const snapshot=normalizeBuildingCollisionSnapshot(value);if(!world||!snapshot.prisms.length)return{body:null,shapeCount:0,skippedLaunchPrisms:0,skippedLaunchBuildings:0,activePrisms:Object.freeze([]),...snapshot};
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
  const bodyDef=b3.b3DefaultBodyDef();bodyDef.type=b3.b3BodyType.b3_staticBody;bodyDef.position=[0,0,0];const body=b3.b3CreateBody(world,bodyDef),shapeDef=b3.b3DefaultShapeDef();shapeDef.baseMaterial.friction=.68;shapeDef.baseMaterial.restitution=.025;
  // Buildings are physical airframe obstacles, not the GAME altitude datum. The
  // downward NAV ray must keep measuring the stable launch/terrain plane; letting
  // it hit OSM roofs makes AGL jump by an entire building height at each roof edge
  // and feeds that discontinuity straight into the vertical controller while the
  // pilot is translating. Preserve airframe collision but exclude the rangefinder
  // query category from every building shape.
  const collisionMask=BigInt(maskBits)&~BigInt(rangefinderCategoryBits);
  shapeDef.filter={categoryBits:BigInt(categoryBits),maskBits:collisionMask,groupIndex:0};let shapeCount=0,skippedLaunchPrisms=0;const activePrisms=[];
  for(const prism of snapshot.prisms){
    const key=String(prism.buildingKey||"");
    const skipWholeBuilding=key&&launchExcludedBuildingKeys.has(key);
    const skipUnkeyedPrism=!key&&overlapsLaunchVolume(prism,launchExclusionPoint);
    if(skipWholeBuilding||skipUnkeyedPrism){skippedLaunchPrisms++;continue;}
    const vertices=[];for(const height of [prism.base,prism.top])for(const point of prism.points)vertices.push(point[0],point[1],height);const hull=b3.b3CreateHull(vertices);if(!hull)continue;try{b3.b3CreateHullShape(body,shapeDef,hull);shapeCount++;activePrisms.push(prism);}finally{b3.b3DestroyHull(hull);}
  }
  const skippedLaunchBuildings=launchExcludedBuildingKeys.size;
  if(!shapeCount){b3.b3DestroyBody(body);return{body:null,shapeCount:0,skippedLaunchPrisms,skippedLaunchBuildings,activePrisms:Object.freeze([]),...snapshot};}return{body,shapeCount,skippedLaunchPrisms,skippedLaunchBuildings,activePrisms:Object.freeze(activePrisms.slice()),...snapshot};
}

export function destroyWorldBuildingCollisionBodies(b3,state){if(state?.body&&b3.b3Body_IsValid(state.body))b3.b3DestroyBody(state.body);}
