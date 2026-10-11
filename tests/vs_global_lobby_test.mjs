import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {discoveryRoomKeys,publicLobbyRoomKey} from '../sim/lan_vs.mjs';
const cryptoObj=globalThis.crypto||webcrypto;
const fakeNetwork=async()=>[];
const shared=await publicLobbyRoomKey({cryptoObj});
assert.match(shared,/^net-[0-9a-f]{24}$/);
const clients=await Promise.all([
  {longitude:9.1,latitude:47.2,gestureTimeMs:1},
  {longitude:-122.4,latitude:37.7,gestureTimeMs:60_000},
  {longitude:13.4,latitude:52.5,gestureTimeMs:180_000},
].map(x=>discoveryRoomKeys({...x,cryptoObj,networkMaterialsFn:fakeNetwork,fetchFn:async()=>({ok:false})})));
for(const ids of clients)assert.deepEqual(ids,[shared]);
console.log('3-client shared lobby: pass');
