import assert from 'node:assert/strict';
import {groupSpawnCenter} from '../sim/vs_group_spawn.mjs';
assert.equal(groupSpawnCenter([]),null);
assert.deepEqual(groupSpawnCenter([[0,0],[5,0],[0,6],[1200,1200]]),[0,0]);
assert.deepEqual(groupSpawnCenter([[900,0],[0,0],[8,0],[16,0],[900,8],[900,16],[900,24]]),[900,8]);
assert.deepEqual(groupSpawnCenter([[0,0],[NaN,4],[10,0]]),[0,0]);
console.log('Shared-frame majority cluster spawn: pass');
