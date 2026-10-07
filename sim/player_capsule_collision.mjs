import {staticGroundHeightAt} from "./terrain_craters.mjs";
export const PLAYER_CAPSULE_RADIUS_M=.28;
export const PLAYER_CAPSULE_HEIGHT_M=1.72;
export const PLAYER_CAPSULE_QUERY_CATEGORY=8n;
export const PLAYER_CAPSULE_TERRAIN_CATEGORY=1n;
const CONTACT_MARGIN_M=.008;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number(v)||0));
const finitePoint=p=>p&&Number.isFinite(Number(p.x))&&Number.isFinite(Number(p.y));
const acceptMoverShape=()=>true;

function bodyShapes(b3,body){
  if(!body||typeof b3?.b3Body_GetShapes!=="function")return[];
  const value=b3.b3Body_GetShapes(body);if(!value)return[];
  if(Array.isArray(value))return value;
  const size=typeof value.size==="function"?Number(value.size()):Number(value.size??value.length);
  if(Number.isFinite(size)&&typeof value.get==="function"){const out=[];for(let i=0;i<size;i++)out.push(value.get(i));return out;}
  if(Number.isFinite(size)){const out=[];for(let i=0;i<size;i++)if(value[i])out.push(value[i]);return out;}
  return[];
}

export function ensurePlayerQueryAcceptedByTerrain(engine){
  const b3=engine?.b3;if(!b3||typeof b3.b3Shape_GetFilter!=="function"||typeof b3.b3Shape_SetFilter!=="function")return false;
  const buildingBody=engine.buildingState?.body||null;if(engine.__playerCapsuleGround===engine.ground&&engine.__playerCapsuleBuildingBody===buildingBody)return true;
  const bodies=[...(engine.terrainBodies||[engine.ground]),buildingBody].filter(Boolean);let touched=0;
  for(const body of bodies)for(const shape of bodyShapes(b3,body)){
    const current=b3.b3Shape_GetFilter(shape);if(!current)continue;
    const category=BigInt(current.categoryBits??0n);if((category&PLAYER_CAPSULE_TERRAIN_CATEGORY)===0n)continue;
    const mask=BigInt(current.maskBits??0n);if((mask&PLAYER_CAPSULE_QUERY_CATEGORY)!==0n)continue;
    b3.b3Shape_SetFilter(shape,{...current,categoryBits:category,maskBits:mask|PLAYER_CAPSULE_QUERY_CATEGORY},false);touched++;
  }
  engine.__playerCapsuleGround=engine.ground;engine.__playerCapsuleBuildingBody=buildingBody;engine.__playerCapsuleTerrainFilterUpdates=(Number(engine.__playerCapsuleTerrainFilterUpdates)||0)+touched;
  return bodies.length>0;
}

function moverOptions(options){
  const radius=clamp(options.radiusM??PLAYER_CAPSULE_RADIUS_M,.18,.45),height=Math.max(radius*2+.20,Number(options.heightM)||PLAYER_CAPSULE_HEIGHT_M);
  return {center1:[0,0,radius],center2:[0,0,height-radius],radius};
}
function feetAt(p,options){return (options.groundHeightAt||staticGroundHeightAt)(p.x,p.y)+.02;}
function moveOnPlanes(b3,world,from,to,options){
  const capsule=moverOptions(options),filter=b3.b3DefaultQueryFilter();filter.categoryBits=PLAYER_CAPSULE_QUERY_CATEGORY;filter.maskBits=PLAYER_CAPSULE_TERRAIN_CATEGORY;
  let p=[Number(from.x),Number(from.y),feetAt(from,options)],target=[Number(to.x),Number(to.y),feetAt(to,options)],fraction=1;
  // Official Box3D mover sequence: gather planes, solve penetration/slide,
  // then sweep the capsule. Unlike axis casts, this can leave an overlap.
  for(let iteration=0;iteration<5;iteration++){
    const planes=[];
    b3.b3World_CollideMover(world,p,capsule,filter,(_shape,buffer)=>{
      for(let i=0;i<buffer.count;i++){const k=i*7,d=buffer.data;planes.push({plane:{normal:[d[k],d[k+1],d[k+2]],offset:d[k+3]},pushLimit:3.4e38,push:0,clipVelocity:true});}return true;
    });
    const result=b3.b3SolvePlanes(target.map((v,i)=>v-p[i]),planes),delta=result.delta;
    if(!delta.every(Number.isFinite))return null;
    const f=Number(b3.b3World_CastMover(world,p,capsule,delta,filter,acceptMoverShape,null));if(!Number.isFinite(f))return null;
    fraction=Math.min(fraction,clamp(f,0,1));const length=Math.hypot(...delta),scale=f<1?Math.max(0,f-CONTACT_MARGIN_M/Math.max(length,1e-8)):1;
    p=p.map((v,i)=>v+delta[i]*scale);if(length*scale<1e-5)break;
  }
  const blocked=Math.hypot(p[0]-to.x,p[1]-to.y)>.002;
  return {x:p[0],y:p[1],blocked,fraction:blocked?Math.min(fraction,.999):1,source:"box3d-capsule-mover-v1"};
}

export function resolvePlayerCapsuleMove(engine,from,to,options={}){
  if(!finitePoint(from)||!finitePoint(to))return null;const b3=engine?.b3,world=engine?.world;if(!b3||!world||typeof b3.b3World_CastMover!=="function")return null;
  ensurePlayerQueryAcceptedByTerrain(engine);
  if(typeof b3.b3World_CollideMover!=="function"||typeof b3.b3SolvePlanes!=="function")return null;
  return moveOnPlanes(b3,world,from,to,options);
}
