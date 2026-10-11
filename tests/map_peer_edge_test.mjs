import assert from 'node:assert/strict';
import {locateMapPeer} from '../sim/map_peer_edge.mjs';

const W=400,H=240,cx=200,cy=113;
const options={insetX:16,insetTop:16,insetBottom:30};
const at=(dx,dy)=>locateMapPeer(cx+dx,cy+dy,W,H,options);
for(const [dx,dy,arrow] of [[1000,0,'→'],[1000,1000,'↘'],[0,1000,'↓'],[-1000,1000,'↙'],[-1000,0,'←'],[-1000,-1000,'↖'],[0,-1000,'↑'],[1000,-1000,'↗']]){
  const hit=at(dx,dy);assert.equal(hit.offmap,true);assert.equal(hit.arrow,arrow);
  assert.ok(hit.x>=16&&hit.x<=384&&hit.y>=16&&hit.y<=210);
  // The edge marker must lie on the true ray from map center to peer.
  assert.ok(Math.abs((hit.x-cx)*dy-(hit.y-cy)*dx)<1e-7,JSON.stringify({dx,dy,hit}));
}
assert.deepEqual(at(10,-10),{x:210,y:103,offmap:false,arrow:'',rotationDeg:null});
const right=at(1000,0);assert.equal(right.x,384);assert.equal(right.y,cy);assert.ok(Math.abs(right.rotationDeg-90)<1e-7);
assert.equal(at(0,-1000).y,16);
assert.equal(at(0,1000).y,210);
assert.equal(locateMapPeer(Infinity,0,W,H),null);
assert.equal(locateMapPeer(500,0,0,H),null);
assert.equal(locateMapPeer(500,0,10,20),null);
console.log('Map peer edge directions and ray clipping: pass');
