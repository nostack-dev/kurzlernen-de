import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Exercise the actual reconcilePeers function in isolation. Importing the full
// graphics runtime in Node would require a DOM / WebGL environment.
const source = readFileSync(new URL('../sim/vs_multiplayer.mjs',import.meta.url),'utf8');
const match=source.match(/^function reconcilePeers\(\)\{[\s\S]*?^\}/m);
assert.ok(match, 'reconcilePeers must exist in the multiplayer runtime');

function scenario(roster, initial){
  const peers=new Map(initial.map(id=>[id, {id}])),removed=[],seen=[];
  const s=roster===null?null:{getPeerIds:()=>roster};
  const context={
    session:()=>s,
    activeSession:()=>s,
    peers,
    removePeer(id){removed.push(id);peers.delete(id);},
    recordFor(id){seen.push(id);if(!peers.has(id))peers.set(id,{id});}
  };
  vm.runInNewContext(match[0]+'\nreconcilePeers();',context,{timeout:1000});
  return {ids:[...peers.keys()].sort(),removed,seen};
}

// These used to fail: !ids.length returned early and preserved ghost players.
assert.deepEqual(scenario([],['mate1','mate2']).ids,[],'empty roster must remove everyone');
assert.deepEqual(scenario(null,['mate1']).ids,[],'stopped session must remove everyone');
assert.deepEqual(scenario(['mate2'],['mate1','mate2']).ids,['mate2'],'departing mate must be removed');
assert.deepEqual(scenario(['mate2'],[]).ids,['mate2'],'new mate must be admitted');
assert.deepEqual(scenario(undefined,['mate1']).ids,['mate1'],'unknown roster must not erase peers');
assert.deepEqual(scenario([],[]).ids,[],'empty cleanup must be idempotent');
console.log('VS peer reconciliation: pass');
