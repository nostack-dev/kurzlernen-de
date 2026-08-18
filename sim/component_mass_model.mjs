const finite=value=>Number.isFinite(Number(value));
const positive=(value,name)=>{const n=Number(value);if(!(n>0))throw new Error(`${name} must be positive`);return n;};
const vec3=(value,name)=>{if(!Array.isArray(value)||value.length!==3||!value.every(finite))throw new Error(`${name} must be a finite vec3`);return value.map(Number);};
const zeroTensor=()=>[[0,0,0],[0,0,0],[0,0,0]];
const addTensor=(a,b)=>a.map((row,i)=>row.map((value,j)=>value+b[i][j]));
const boxTensor=(mass,[x,y,z])=>[[mass*(y*y+z*z)/12,0,0],[0,mass*(x*x+z*z)/12,0],[0,0,mass*(x*x+y*y)/12]];
const diskTensor=(mass,radius,thickness)=>[[mass*(3*radius*radius+thickness*thickness)/12,0,0],[0,mass*(3*radius*radius+thickness*thickness)/12,0],[0,0,mass*radius*radius/2]];
const parallelAxis=(mass,[x,y,z])=>[[mass*(y*y+z*z),-mass*x*y,-mass*x*z],[-mass*x*y,mass*(x*x+z*z),-mass*y*z],[-mass*x*z,-mass*y*z,mass*(x*x+y*y)]];

export const DEFAULT_COMPONENT_MASSES_KG=Object.freeze({
  frame:0.180,motorEach:0.035,propEach:0.005,battery:0.200,esc:0.030,fcRx:0.020,cameraVtx:0.030,wiringHardware:0.100,
});
export const DEFAULT_COMPONENT_PLACEMENT_M=Object.freeze({batteryX:0.015,batteryZ:-0.015,cameraX:-0.065,cameraZ:0.006});

export function buildQuadComponents({spanM,propDiameterM,massesKg=DEFAULT_COMPONENT_MASSES_KG,placementM=DEFAULT_COMPONENT_PLACEMENT_M}={}){
  const span=positive(spanM,'spanM'),propDiameter=positive(propDiameterM,'propDiameterM');
  const masses={...DEFAULT_COMPONENT_MASSES_KG,...massesKg},placement={...DEFAULT_COMPONENT_PLACEMENT_M,...placementM};
  for(const [key,value] of Object.entries(masses))positive(value,`massesKg.${key}`);
  for(const [key,value] of Object.entries(placement))if(!finite(value))throw new Error(`placementM.${key} must be finite`);
  const arm=span/(2*Math.sqrt(2)),motors=[[-arm,-arm,0],[-arm,arm,0],[arm,arm,0],[arm,-arm,0]],components=[];
  components.push({name:'frame',massKg:masses.frame,positionM:[0,0,0],shape:{type:'box',sizeM:[span*.62,span*.48,.018]}});
  motors.forEach((position,index)=>{
    components.push({name:`motor${index+1}`,massKg:masses.motorEach,positionM:position,shape:{type:'box',sizeM:[.036,.036,.025]}});
    components.push({name:`prop${index+1}`,massKg:masses.propEach,positionM:[position[0],position[1],.014],shape:{type:'disk',radiusM:propDiameter/2,thicknessM:.002}});
    components.push({name:`armHardware${index+1}`,massKg:masses.wiringHardware/4,positionM:[position[0]/2,position[1]/2,-.002],shape:{type:'box',sizeM:[span*.245,.016,.008]}});
  });
  components.push({name:'battery',massKg:masses.battery,positionM:[placement.batteryX,0,placement.batteryZ],shape:{type:'box',sizeM:[.105,.035,.032]}});
  components.push({name:'esc',massKg:masses.esc,positionM:[0,0,-.002],shape:{type:'box',sizeM:[.050,.050,.008]}});
  components.push({name:'fcRx',massKg:masses.fcRx,positionM:[0,0,.008],shape:{type:'box',sizeM:[.040,.040,.012]}});
  components.push({name:'cameraVtx',massKg:masses.cameraVtx,positionM:[placement.cameraX,0,placement.cameraZ],shape:{type:'box',sizeM:[.040,.030,.025]}});
  return components;
}

export function deriveRigidBodyMassProperties(components){
  if(!Array.isArray(components)||!components.length)throw new Error('components are required');
  let massKg=0,weighted=[0,0,0];
  for(const component of components){const mass=positive(component.massKg,`${component.name||'component'}.massKg`),position=vec3(component.positionM,`${component.name||'component'}.positionM`);massKg+=mass;for(let i=0;i<3;i++)weighted[i]+=mass*position[i];}
  const centerM=weighted.map(value=>value/massKg);let inertia=zeroTensor();
  for(const component of components){
    const mass=Number(component.massKg),position=component.positionM.map(Number),offset=position.map((value,i)=>value-centerM[i]);let local;
    if(component.shape?.type==='box'){const size=vec3(component.shape.sizeM,`${component.name}.shape.sizeM`).map((value,i)=>positive(value,`${component.name}.shape.sizeM[${i}]`));local=boxTensor(mass,size);}
    else if(component.shape?.type==='disk'){local=diskTensor(mass,positive(component.shape.radiusM,`${component.name}.radiusM`),positive(component.shape.thicknessM,`${component.name}.thicknessM`));}
    else throw new Error(`${component.name||'component'} has unsupported mass shape`);
    inertia=addTensor(inertia,addTensor(local,parallelAxis(mass,offset)));
  }
  const [Ixx,Iyy,Izz]=[inertia[0][0],inertia[1][1],inertia[2][2]];
  if(!(Ixx>0&&Iyy>0&&Izz>0&&Ixx+Iyy>Izz&&Ixx+Izz>Iyy&&Iyy+Izz>Ixx))throw new Error('derived inertia tensor is not physically valid');
  const det=inertia[0][0]*(inertia[1][1]*inertia[2][2]-inertia[1][2]*inertia[2][1])-inertia[0][1]*(inertia[1][0]*inertia[2][2]-inertia[1][2]*inertia[2][0])+inertia[0][2]*(inertia[1][0]*inertia[2][1]-inertia[1][1]*inertia[2][0]);
  if(!(det>0))throw new Error('derived inertia tensor is not positive definite');
  return Object.freeze({massKg,centerM:Object.freeze(centerM),inertiaTensorKgM2:Object.freeze(inertia.map(row=>Object.freeze(row))),Ixx,Iyy,Izz,components:Object.freeze(components.map(component=>Object.freeze({...component})))});
}

export function deriveQuadMassProperties(options){return deriveRigidBodyMassProperties(buildQuadComponents(options));}
