import {normalizeTerrainSnapshot} from './world_terrain.mjs';
import {COLLISION_TERRAIN,TERRAIN_MASK} from './collision_filter_matrix.mjs';

export function destroyWorldTerrainCollision(b3,state){if(state?.body&&b3.b3Body_IsValid(state.body))b3.b3DestroyBody(state.body);if(state?.mesh)b3.b3DestroyMesh(state.mesh);}

export function createWorldTerrainCollision(b3,world,snapshot,{categoryBits=COLLISION_TERRAIN,maskBits=TERRAIN_MASK,friction=.78,restitution=.02}={}){
  const terrain=normalizeTerrainSnapshot(snapshot);if(!world||!terrain)return null;const triangles=terrain.triangles;if(!triangles.length)return null;const mesh=b3.b3CreateMesh(triangles);if(!mesh)throw new Error('Box3D terrain mesh creation failed');let body=null;try{const bodyDef=b3.b3DefaultBodyDef();bodyDef.type=b3.b3BodyType.b3_staticBody;bodyDef.position=[0,0,0];body=b3.b3CreateBody(world,bodyDef);const shapeDef=b3.b3DefaultShapeDef();shapeDef.baseMaterial.friction=friction;shapeDef.baseMaterial.restitution=restitution;shapeDef.filter={categoryBits:BigInt(categoryBits),maskBits:BigInt(maskBits),groupIndex:0};const shape=b3.b3CreateMeshShape(body,shapeDef,mesh);return{body,shape,mesh,triangleCount:terrain.triangleCount,hash:terrain.hash,minZ:terrain.minZ,maxZ:terrain.maxZ};}catch(error){if(body&&b3.b3Body_IsValid(body))b3.b3DestroyBody(body);b3.b3DestroyMesh(mesh);throw error;}
}
