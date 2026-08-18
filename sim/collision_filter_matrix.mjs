export const COLLISION_TERRAIN=1n;
export const COLLISION_AIRFRAME=2n;
export const QUERY_RANGEFINDER=4n;
export const QUERY_CAMERA=8n;
export const QUERY_SPAWN=16n;

export const AIRFRAME_MASK=COLLISION_TERRAIN;
export const TERRAIN_MASK=COLLISION_AIRFRAME|QUERY_RANGEFINDER|QUERY_CAMERA|QUERY_SPAWN;
export const BUILDING_MASK=COLLISION_AIRFRAME|QUERY_CAMERA|QUERY_SPAWN;

export const COLLISION_FILTER_MATRIX=Object.freeze({
  terrain:Object.freeze({categoryBits:COLLISION_TERRAIN,maskBits:TERRAIN_MASK}),
  building:Object.freeze({categoryBits:COLLISION_TERRAIN,maskBits:BUILDING_MASK}),
  airframe:Object.freeze({categoryBits:COLLISION_AIRFRAME,maskBits:AIRFRAME_MASK}),
  rangefinder:Object.freeze({categoryBits:QUERY_RANGEFINDER,maskBits:COLLISION_TERRAIN}),
  camera:Object.freeze({categoryBits:QUERY_CAMERA,maskBits:COLLISION_TERRAIN}),
  spawn:Object.freeze({categoryBits:QUERY_SPAWN,maskBits:COLLISION_TERRAIN}),
});

export function collisionFilterSummary(){return Object.freeze({terrain:Number(TERRAIN_MASK),building:Number(BUILDING_MASK),airframe:Number(AIRFRAME_MASK),rangefinder:Number(QUERY_RANGEFINDER),camera:Number(QUERY_CAMERA),spawn:Number(QUERY_SPAWN)});}
