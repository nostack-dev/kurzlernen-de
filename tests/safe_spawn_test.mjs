import assert from 'node:assert/strict';
import {findSafeSpawn,SAFE_SPAWN_RESPAWN_MIN_M} from '../sim/safe_spawn.mjs';

const building=(x,y)=>Math.abs(x)<5&&Math.abs(y)<5;
const terrain=(x,y)=>.015*x+.01*y;
const probe=(x,y)=>{const z=terrain(x,y);return{terrainZ:z,obstructionZ:building(x,y)?z+12:z,normalZ:.999};};
const initial=findSafeSpawn({around:[0,0,0],mode:'initial',seed:1,clearanceRadiusM:.25,probe});
assert.ok(initial,'initial spawn should be found');assert.ok(Math.hypot(initial.x,initial.y)>5.2,`initial spawn remained inside building: ${JSON.stringify(initial)}`);assert.ok(initial.z>terrain(initial.x,initial.y));

const respawn=findSafeSpawn({around:[40,-10,7],mode:'respawn',seed:12345,clearanceRadiusM:.22,probe:(x,y)=>({terrainZ:terrain(x,y),obstructionZ:terrain(x,y),normalZ:.999})});
assert.ok(respawn,'respawn should be found');assert.ok(respawn.offsetM>=SAFE_SPAWN_RESPAWN_MIN_M,`respawn offset too small: ${respawn.offsetM}`);assert.ok(respawn.offsetM<=36,`first safe respawn should remain in fight ring: ${respawn.offsetM}`);
const repeat=findSafeSpawn({around:[40,-10,7],mode:'respawn',seed:12345,clearanceRadiusM:.22,probe:(x,y)=>({terrainZ:terrain(x,y),obstructionZ:terrain(x,y),normalZ:.999})});assert.deepEqual(repeat,respawn,'seeded respawn search must be deterministic for regression tests');

const steep=findSafeSpawn({around:[0,0,0],mode:'initial',probe:()=>({terrainZ:0,obstructionZ:0,normalZ:.6})});assert.equal(steep,null,'unsafe steep terrain must be rejected');
const buried=findSafeSpawn({around:[0,0,0],mode:'initial',probe:()=>({terrainZ:0,obstructionZ:3,normalZ:1})});assert.equal(buried,null,'building/obstruction above terrain must be rejected');
console.log(`Safe spawn passed: initial offset ${initial.offsetM.toFixed(1)} m, respawn offset ${respawn.offsetM.toFixed(1)} m.`);
