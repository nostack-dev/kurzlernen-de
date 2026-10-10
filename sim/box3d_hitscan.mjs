import Box3DFactory from "box3d.js/inline";
import {terrainRayDistance,terrainNormalAt} from "./terrain_craters.mjs";
import {createWorldBuildingCollisionBodies,destroyWorldBuildingCollisionBodies,updateWorldBuildingCollisionBodies} from "./world_building_collision_physics.mjs";

const QUERY_HITSCAN=16n;
const COLLISION_WORLD=1n;
const GROUND_HALF_SIZE_M=10000;
const GROUND_HALF_THICKNESS_M=.05;
const MAX_RAY_M=2000;

const b3=await Box3DFactory();

function finite3(value){return Array.isArray(value)&&value.length===3&&value.every(Number.isFinite);}
function normalizedDirection(value){
  if(!finite3(value))return null;const length=Math.hypot(value[0],value[1],value[2]);
  if(length<1e-9)return null;return[value[0]/length,value[1]/length,value[2]/length];
}

export class Box3dHitscanWorld{
  constructor(){
    const worldDef=b3.b3DefaultWorldDef();worldDef.gravity=[0,0,0];worldDef.enableSleep=false;worldDef.enableContinuous=true;
    this.world=b3.b3CreateWorld(worldDef);this.buildings=null;this.snapshotHash="";
    // the ground is the shared terrain surface (terrainRayDistance), not a flat z=0 plane
    this.ground=null;
  }
  sync(snapshot){
    const hash=String(snapshot?.hash||"");if(hash===this.snapshotHash)return;
    this.snapshotHash=hash;
    if(Array.isArray(snapshot?.prisms)){
      /* createWorldBuildingCollisionBodies is the one-shot form; moving play updates incrementally */this.buildings=updateWorldBuildingCollisionBodies(b3,this.world,this.buildings,snapshot,{categoryBits:COLLISION_WORLD,maskBits:QUERY_HITSCAN,rangefinderCategoryBits:0n});
    }
  }
  cast(origin,direction,maxDistance=650,snapshot=null){
    if(snapshot)this.sync(snapshot);if(!finite3(origin))return null;const unit=normalizedDirection(direction);if(!unit)return null;
    const distance=Math.max(.01,Math.min(MAX_RAY_M,Number(maxDistance)||650));const delta=unit.map(value=>value*distance);
    const filter=b3.b3DefaultQueryFilter();filter.categoryBits=QUERY_HITSCAN;filter.maskBits=COLLISION_WORLD;
    const hit=b3.b3World_CastRayClosest(this.world,origin,delta,filter),tt=terrainRayDistance({x:origin[0],y:origin[1],z:origin[2]},{x:unit[0],y:unit[1],z:unit[2]},distance);
    if(tt!==null&&(!hit?.hit||tt<distance*Number(hit.fraction))){const p=[origin[0]+unit[0]*tt,origin[1]+unit[1]*tt,origin[2]+unit[2]*tt];return{point:p,normal:terrainNormalAt(p[0],p[1]),fraction:tt/distance,distanceM:tt,terrain:true};}
    if(!hit?.hit)return null;
    const fraction=Number(hit.fraction);if(!Number.isFinite(fraction)||fraction<0||fraction>1)return null;
    const point=finite3(hit.point)?hit.point:[origin[0]+delta[0]*fraction,origin[1]+delta[1]*fraction,origin[2]+delta[2]*fraction];
    const normal=finite3(hit.normal)?hit.normal:[0,0,1];
    return{point:[...point],normal:[...normal],fraction,distanceM:distance*fraction};
  }
  dispose(){
    if(this.buildings)destroyWorldBuildingCollisionBodies(b3,this.buildings);this.buildings=null;
    if(this.ground&&b3.b3Body_IsValid(this.ground))b3.b3DestroyBody(this.ground);this.ground=null;
    if(this.world)b3.b3DestroyWorld(this.world);this.world=null;
  }
}
