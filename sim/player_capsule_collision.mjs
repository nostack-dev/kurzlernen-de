export const PLAYER_CAPSULE_RADIUS_M=.28;
export const PLAYER_CAPSULE_HEIGHT_M=1.72;
export const PLAYER_CAPSULE_QUERY_CATEGORY=8n;
export const PLAYER_CAPSULE_TERRAIN_CATEGORY=1n;
const CONTACT_MARGIN_M=.008;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number(v)||0));
const finitePoint=p=>p&&Number.isFinite(Number(p.x))&&Number.isFinite(Number(p.y));

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
  const bodies=[engine.ground,engine.buildingState?.body].filter(Boolean);let touched=0;
  for(const body of bodies)for(const shape of bodyShapes(b3,body)){
    const current=b3.b3Shape_GetFilter(shape);if(!current)continue;
    const category=BigInt(current.categoryBits??0n);if((category&PLAYER_CAPSULE_TERRAIN_CATEGORY)===0n)continue;
    const mask=BigInt(current.maskBits??0n);if((mask&PLAYER_CAPSULE_QUERY_CATEGORY)!==0n)continue;
    b3.b3Shape_SetFilter(shape,{...current,categoryBits:category,maskBits:mask|PLAYER_CAPSULE_QUERY_CATEGORY},false);touched++;
  }
  return touched>0||bodies.length>0;
}

function castFraction(b3,world,origin,delta,{radiusM=PLAYER_CAPSULE_RADIUS_M,heightM=PLAYER_CAPSULE_HEIGHT_M}={}){
  if(typeof b3?.b3World_CastMover!=="function")return null;
  const radius=clamp(radiusM,.18,.45),height=Math.max(radius*2+.20,Number(heightM)||PLAYER_CAPSULE_HEIGHT_M),capsule={center1:[0,0,radius],center2:[0,0,height-radius],radius};
  const filter=typeof b3.b3DefaultQueryFilter==="function"?b3.b3DefaultQueryFilter():{};filter.categoryBits=PLAYER_CAPSULE_QUERY_CATEGORY;filter.maskBits=PLAYER_CAPSULE_TERRAIN_CATEGORY;
  const fraction=Number(b3.b3World_CastMover(world,[Number(origin.x)||0,Number(origin.y)||0,0],capsule,[Number(delta.x)||0,Number(delta.y)||0,0],filter,null,null));
  return Number.isFinite(fraction)?clamp(fraction,0,1):null;
}
function safeTravel(start,delta,fraction){const length=Math.hypot(delta.x,delta.y);if(length<1e-8)return{x:start.x,y:start.y};const allowed=Math.max(0,length*fraction-CONTACT_MARGIN_M),scale=clamp(allowed/length,0,1);return{x:start.x+delta.x*scale,y:start.y+delta.y*scale};}
function castStep(b3,world,start,delta,options){const fraction=castFraction(b3,world,start,delta,options);if(fraction===null)return null;return{fraction,point:safeTravel(start,delta,fraction)};}
function axisSlide(b3,world,start,remaining,firstAxis,options){let point={...start};for(const axis of[firstAxis,firstAxis==="x"?"y":"x"]){const delta={x:axis==="x"?remaining.x:0,y:axis==="y"?remaining.y:0};if(Math.hypot(delta.x,delta.y)<1e-7)continue;const step=castStep(b3,world,point,delta,options);if(!step)return null;point=step.point;}return point;}

export function resolvePlayerCapsuleMove(engine,from,to,options={}){
  if(!finitePoint(from)||!finitePoint(to))return null;const b3=engine?.b3,world=engine?.world;if(!b3||!world||typeof b3.b3World_CastMover!=="function")return null;
  ensurePlayerQueryAcceptedByTerrain(engine);
  const desired={x:Number(to.x)-Number(from.x),y:Number(to.y)-Number(from.y)},direct=castStep(b3,world,from,desired,options);if(!direct)return null;
  if(direct.fraction>=.9999)return{x:Number(to.x),y:Number(to.y),blocked:false,fraction:1,source:"box3d-capsule-mover-v1"};
  const remaining={x:Number(to.x)-direct.point.x,y:Number(to.y)-direct.point.y},xy=axisSlide(b3,world,direct.point,remaining,"x",options),yx=axisSlide(b3,world,direct.point,remaining,"y",options),distance=p=>p?Math.hypot(Number(to.x)-p.x,Number(to.y)-p.y):Infinity,best=distance(xy)<=distance(yx)?xy:yx,point=best||direct.point;
  return{x:point.x,y:point.y,blocked:true,fraction:direct.fraction,source:"box3d-capsule-mover-v1"};
}
