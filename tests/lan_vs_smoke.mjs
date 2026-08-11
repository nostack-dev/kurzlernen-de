import assert from "node:assert/strict";
import {LanVsSession,nearbyRoomKey} from "../sim/lan_vs.mjs";

function transportHarness(){
  const rooms=new Map();
  let next=1;
  function joinRoom(_config,roomId){
    const id=`peer-${next++}`;
    const group=rooms.get(roomId)||new Set();rooms.set(roomId,group);
    const receivers=new Map(),joins=[],leaves=[];
    const room={
      id,
      makeAction(name){
        const send=data=>{for(const peer of group)if(peer!==room)peer._deliver(name,data,id);};
        return[send,fn=>receivers.set(name,fn)];
      },
      _deliver(name,data,peerId){receivers.get(name)?.(data,peerId);},
      onPeerJoin(fn){joins.push(fn);},
      onPeerLeave(fn){leaves.push(fn);},
      leave(){group.delete(room);for(const peer of group)for(const fn of peer._leaves)fn(id);},
      _joins:joins,_leaves:leaves
    };
    for(const peer of group){for(const fn of peer._joins)fn(id);}
    group.add(room);
    queueMicrotask(()=>{for(const peer of group)if(peer!==room)for(const fn of joins)fn(peer.id);});
    return room;
  }
  return{loadTransport:async()=>({joinRoom})};
}

const harness=transportHarness();
const room=nearbyRoomKey(47.6601,9.1701);
assert.equal(room,nearbyRoomKey(47.6639,9.1749));
assert.throws(()=>nearbyRoomKey(NaN,9.17),/GPS/);
let aPeer=0,bPeer=0,aPose=null,bPose=null,aLeft=0;
const a=new LanVsSession({...harness,onPeer:()=>aPeer++,onPose:p=>aPose=p,onLeave:()=>aLeft++});
const b=new LanVsSession({...harness,onPeer:()=>bPeer++,onPose:p=>bPose=p});
await a.start(room);await b.start(room);
await new Promise(r=>setTimeout(r,10));
assert.equal(aPeer,1);assert.equal(bPeer,1);
a.setPose({p:[1,2,3],q:[0,0,0,1],g:[9.17,47.66]});
b.setPose({p:[4,5,6],q:[0,0,.1,.99],g:[9.171,47.661]});
await new Promise(r=>setTimeout(r,120));
assert.deepEqual(aPose.p,[4,5,6]);assert.deepEqual(bPose.p,[1,2,3]);
assert.ok(aPose.seq>=1&&bPose.seq>=1);
b.stop();await new Promise(r=>setTimeout(r,5));assert.equal(aLeft,1);
a.stop();
console.log("LAN VS deterministic two-peer smoke passed");
