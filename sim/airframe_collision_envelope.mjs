export const PROPELLER_SWEEP_SEGMENTS=16;
export const PROPELLER_SWEEP_HALF_THICKNESS_M=.002;

function finitePoint(point){return Array.isArray(point)&&point.length===3&&point.every(Number.isFinite);}

export function propellerSweepRadius(diameter){
  const value=Number(diameter);if(!(value>0))throw Error("propeller diameter must be positive");return value/2;
}

export function propellerSweepVertices(position,diameter,{segments=PROPELLER_SWEEP_SEGMENTS,halfThickness=PROPELLER_SWEEP_HALF_THICKNESS_M}={}){
  if(!finitePoint(position))throw Error("propeller motor position must be a finite xyz point");
  const radius=propellerSweepRadius(diameter),count=Math.max(8,Math.floor(Number(segments)||PROPELLER_SWEEP_SEGMENTS)),halfZ=Math.max(.0005,Number(halfThickness)||PROPELLER_SWEEP_HALF_THICKNESS_M),vertices=[];
  for(const z of [-halfZ,halfZ])for(let index=0;index<count;index++){const angle=index/count*Math.PI*2;vertices.push(position[0]+Math.cos(angle)*radius,position[1]+Math.sin(angle)*radius,position[2]+z);}
  return vertices;
}

export function addPropellerSweepColliders(b3,body,shapeDef,motorPositions,diameter,options={}){
  if(!b3||!body||!shapeDef)throw Error("Box3D body and shape definition are required");
  let shapeCount=0;
  for(const position of Array.isArray(motorPositions)?motorPositions:[]){
    if(!finitePoint(position))continue;
    const hull=b3.b3CreateHull(propellerSweepVertices(position,diameter,options));if(!hull)throw Error("Box3D failed to build propeller sweep hull");
    try{b3.b3CreateHullShape(body,shapeDef,hull);shapeCount++;}finally{b3.b3DestroyHull(hull);}
  }
  return shapeCount;
}
