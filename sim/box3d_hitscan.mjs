import Box3DFactory from "box3d.js/dist/box3d.inline.mjs";
import {createWorldBuildingCollisionBodies,destroyWorldBuildingCollisionBodies} from "./world_building_collision_physics.mjs";

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
    const bodyDef=b3.b3DefaultBodyDef();bodyDef.position=[0,0,-GROUND_HALF_THICKNESS_M];
    this.ground=b3.b3CreateBody(this.world,bodyDef);const shapeDef=b3.b3DefaultShapeDef();
    shapeDef.filter={categoryBits:COLLISION_WORLD,maskBits:QUERY_HITSCAN,groupIndex:0};
    b3.b3CreateBoxShape(this.ground,shapeDef,GROUND_HALF_SIZE_M,GROUND_HALF_SIZE_M,GROUND_HALF_THICKNESS_M);
  }
  sync(snapshot){
    const hash=String(snapshot?.hash||"");if(hash===this.snapshotHash)return;
    if(this.buildings)destroyWorldBuildingCollisionBodies(b3,this.buildings);this.buildings=null;this.snapshotHash=hash;
    if(Array.isArray(snapshot?.prisms)&&snapshot.prisms.length){
      this.buildings=createWorldBuildingCollisionBodies(b3,this.world,snapshot,{categoryBits:COLLISION_WORLD,maskBits:QUERY_HITSCAN,rangefinderCategoryBits:0n});
    }
  }
  cast(origin,direction,maxDistance=650,snapshot=null){
    if(snapshot)this.sync(snapshot);if(!finite3(origin))return null;const unit=normalizedDirection(direction);if(!unit)return null;
    const distance=Math.max(.01,Math.min(MAX_RAY_M,Number(maxDistance)||650));const delta=unit.map(value=>value*distance);
    const filter=b3.b3DefaultQueryFilter();filter.categoryBits=QUERY_HITSCAN;filter.maskBits=COLLISION_WORLD;
    const hit=b3.b3World_CastRayClosest(this.world,origin,delta,filter);if(!hit?.hit)return null;
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
