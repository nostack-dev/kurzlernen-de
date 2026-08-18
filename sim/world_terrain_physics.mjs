import {normalizeTerrainSnapshot} from './world_terrain.mjs';

export function destroyWorldTerrainCollision(b3,state){if(!state)return null;try{if(state.body)b3.b3DestroyBody(state.body);}catch{}return null;}

export function createWorldTerrainCollision(b3,world,snapshot,{categoryBits=1n,maskBits=14n,friction=.78,restitution=.02}={}){
  const normalized=normalizeTerrainSnapshot(snapshot);if(!normalized||!world)return null;const bodyDef=b3.b3DefaultBodyDef(),body=b3.b3CreateBody(world,bodyDef),shapeDef=b3.b3DefaultShapeDef();shapeDef.baseMaterial.friction=friction;shapeDef.baseMaterial.restitution=restitution;shapeDef.filter={categoryBits,maskBits,groupIndex:0};const meshData=b3.b3CreateMesh(new Float32Array(normalized.positions),new Uint32Array(normalized.indices));if(!meshData){b3.b3DestroyBody(body);throw new Error('Box3D rejected WORLD terrain mesh');}const shape=b3.b3CreateMeshShape(body,shapeDef,meshData,[1,1,1]);meshData.delete?.();return{body,shape,hash:normalized.hash,triangleCount:normalized.indices.length/3,snapshot:normalized};
}
