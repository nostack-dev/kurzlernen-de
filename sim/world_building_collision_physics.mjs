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

export function normalizeBuildingCollisionSnapshot(value,{maxPrisms=512,maxVertices=24}={}){
  const prisms=[],limit=Math.max(1,Math.floor(Number(maxPrisms)||512)),vertexLimit=Math.max(3,Math.floor(Number(maxVertices)||24));for(const prism of Array.isArray(value?.prisms)?value.prisms:[]){if(prisms.length>=limit)break;const points=prism?.points;if(!Array.isArray(points)||points.length<3||points.length>vertexLimit||!points.every(finitePoint))continue;const base=Number(prism.base),top=Number(prism.top);if(!Number.isFinite(base)||!Number.isFinite(top)||top-base<.1)continue;let twiceArea=0;for(let index=0;index<points.length;index++){const a=points[index],b=points[(index+1)%points.length];twiceArea+=a[0]*b[1]-b[0]*a[1];}if(Math.abs(twiceArea)<.02)continue;prisms.push({buildingKey:String(prism.buildingKey||""),base,top,points:points.map(point=>[...point])});}
  return Object.freeze({hash:String(value?.hash||""),footprintCount:Math.max(0,Math.floor(Number(value?.footprintCount)||0)),prismCount:prisms.length,prisms});
}

export function createWorldBuildingCollisionBodies(b3,world,value,{categoryBits=1n,maskBits=6n,launchExclusionPoint=DEFAULT_LAUNCH_EXCLUSION_POINT}={}){
  const snapshot=normalizeBuildingCollisionSnapshot(value);if(!world||!snapshot.prisms.length)return{body:null,shapeCount:0,skippedLaunchPrisms:0,skippedLaunchBuildings:0,...snapshot};
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
  shapeDef.filter={categoryBits,maskBits,groupIndex:0};let shapeCount=0,skippedLaunchPrisms=0;
  for(const prism of snapshot.prisms){
    const key=String(prism.buildingKey||"");
    const skipWholeBuilding=key&&launchExcludedBuildingKeys.has(key);
    const skipUnkeyedPrism=!key&&overlapsLaunchVolume(prism,launchExclusionPoint);
    if(skipWholeBuilding||skipUnkeyedPrism){skippedLaunchPrisms++;continue;}
    const vertices=[];for(const height of [prism.base,prism.top])for(const point of prism.points)vertices.push(point[0],point[1],height);const hull=b3.b3CreateHull(vertices);if(!hull)continue;try{b3.b3CreateHullShape(body,shapeDef,hull);shapeCount++;}finally{b3.b3DestroyHull(hull);}
  }
  const skippedLaunchBuildings=launchExcludedBuildingKeys.size;
  if(!shapeCount){b3.b3DestroyBody(body);return{body:null,shapeCount:0,skippedLaunchPrisms,skippedLaunchBuildings,...snapshot};}return{body,shapeCount,skippedLaunchPrisms,skippedLaunchBuildings,...snapshot};
}

export function destroyWorldBuildingCollisionBodies(b3,state){if(state?.body&&b3.b3Body_IsValid(state.body))b3.b3DestroyBody(state.body);}
