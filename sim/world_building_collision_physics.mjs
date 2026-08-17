const finitePoint=point=>Array.isArray(point)&&point.length===2&&point.every(Number.isFinite);

export function normalizeBuildingCollisionSnapshot(value,{maxPrisms=512,maxVertices=24}={}){
  const prisms=[],limit=Math.max(1,Math.floor(Number(maxPrisms)||512)),vertexLimit=Math.max(3,Math.floor(Number(maxVertices)||24));for(const prism of Array.isArray(value?.prisms)?value.prisms:[]){if(prisms.length>=limit)break;const points=prism?.points;if(!Array.isArray(points)||points.length<3||points.length>vertexLimit||!points.every(finitePoint))continue;const base=Number(prism.base),top=Number(prism.top);if(!Number.isFinite(base)||!Number.isFinite(top)||top-base<.1)continue;let twiceArea=0;for(let index=0;index<points.length;index++){const a=points[index],b=points[(index+1)%points.length];twiceArea+=a[0]*b[1]-b[0]*a[1];}if(Math.abs(twiceArea)<.02)continue;prisms.push({buildingKey:String(prism.buildingKey||""),base,top,points:points.map(point=>[...point])});}
  return Object.freeze({hash:String(value?.hash||""),footprintCount:Math.max(0,Math.floor(Number(value?.footprintCount)||0)),prismCount:prisms.length,prisms});
}

export function createWorldBuildingCollisionBodies(b3,world,value,{categoryBits=1n,maskBits=6n}={}){
  const snapshot=normalizeBuildingCollisionSnapshot(value);if(!world||!snapshot.prisms.length)return{body:null,shapeCount:0,...snapshot};const bodyDef=b3.b3DefaultBodyDef();bodyDef.type=b3.b3BodyType.b3_staticBody;bodyDef.position=[0,0,0];const body=b3.b3CreateBody(world,bodyDef),shapeDef=b3.b3DefaultShapeDef();shapeDef.baseMaterial.friction=.68;shapeDef.baseMaterial.restitution=.025;shapeDef.filter={categoryBits,maskBits,groupIndex:0};let shapeCount=0;
  for(const prism of snapshot.prisms){const vertices=[];for(const height of [prism.base,prism.top])for(const point of prism.points)vertices.push(point[0],point[1],height);const hull=b3.b3CreateHull(vertices);if(!hull)continue;try{b3.b3CreateHullShape(body,shapeDef,hull);shapeCount++;}finally{b3.b3DestroyHull(hull);}}
  if(!shapeCount){b3.b3DestroyBody(body);return{body:null,shapeCount:0,...snapshot};}return{body,shapeCount,...snapshot};
}

export function destroyWorldBuildingCollisionBodies(b3,state){if(state?.body&&b3.b3Body_IsValid(state.body))b3.b3DestroyBody(state.body);}
