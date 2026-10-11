import assert from 'node:assert/strict';
import {JetSeatCoordinator} from '../sim/jet_seat_coordinator.mjs';
class FakeNet{
  constructor(){this.rooms=new Map();}
  session(id){
    const room={makeAction:(name)=>{const action={onMessage:null,send:(packet,opts={})=>new Promise(resolve=>{queueMicrotask(()=>{for(const [other,actions] of this.rooms){if(other===id || (opts.target&&opts.target!==other))continue;actions[name]?.onMessage?.(packet,{peerId:id});}resolve();});})};
      const map=this.rooms.get(id)||{};map[name]=action;this.rooms.set(id,map);return action;}};
    return {room,active:null,getSelfId:()=>id,getAuthorityId:()=> 'A'};
  }
}
const net=new FakeNet(),a=new JetSeatCoordinator(()=>sessionA),b=new JetSeatCoordinator(()=>sessionB),c=new JetSeatCoordinator(()=>sessionC);
const sessionA=net.session('A'),sessionB=net.session('B'),sessionC=net.session('C');
a.ensure();b.ensure();c.ensure();
assert.equal((await a.claim('A','jet-1','pilot')).ok,true);
await new Promise(r=>setTimeout(r,0));
assert.equal((await b.claim('A','jet-1','passenger')).ok,true);
assert.equal((await c.claim('A','jet-1','passenger')).ok,false);
assert.equal(a.get('A','jet-1').pilot,'A');
assert.equal(b.get('A','jet-1').passenger,'B');
assert.equal((await b.claim('C','jet-2','pilot')).ok,false);
assert.equal((await a.release('A','jet-1','pilot')).ok,true);
await new Promise(r=>setTimeout(r,0));
assert.equal(b.get('A','jet-1').passenger,null);
console.log('Elected-peer jet seat claims and releases: pass');
