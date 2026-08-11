import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {LanVsSession,sameNetworkRoomKey} from "../sim/lan_vs.mjs";

function transportHarness(){
  const rooms=new Map();
  let next=1;
  function joinRoom(_config,roomId){
    const id=`peer-${next++}`;
    const group=rooms.get(roomId)||new Set();rooms.set(roomId,group);
    const actions=new Map();
    const room={
      id,
      onPeerJoin:null,
      onPeerLeave:null,
      onJoinError:null,
      makeAction(name){
        const action={
          onMessage:null,
          send(data,{target}={}){
            for(const peer of group){
              if(peer===room)continue;
              if(target&&peer.id!==target)continue;
              peer._deliver(name,data,id);
            }
            return Promise.resolve();
          }
        };
        actions.set(name,action);
        return action;
      },
      _deliver(name,data,peerId){actions.get(name)?.onMessage?.(data,{peerId});},
      leave(){group.delete(room);for(const peer of group)peer.onPeerLeave?.(id);}
    };
    for(const peer of group)peer.onPeerJoin?.(id);
    group.add(room);
    queueMicrotask(()=>{for(const peer of group)if(peer!==room)room.onPeerJoin?.(peer.id);});
    return room;
  }
  return{loadTransport:async()=>({joinRoom})};
}

const fakeFetch=ip=>async()=>({ok:true,json:async()=>({ip})});
const room=await sameNetworkRoomKey({fetchFn:fakeFetch("203.0.113.7"),cryptoObj:webcrypto});
const sameRoom=await sameNetworkRoomKey({fetchFn:fakeFetch("203.0.113.7"),cryptoObj:webcrypto});
const otherRoom=await sameNetworkRoomKey({fetchFn:fakeFetch("203.0.113.8"),cryptoObj:webcrypto});
assert.equal(room,sameRoom);
assert.notEqual(room,otherRoom);
assert.match(room,/^net-[0-9a-f]{24}$/);
assert.ok(!room.includes("203.0.113.7"));

const harness=transportHarness();
let aPeer=0,bPeer=0,aPose=null,bPose=null,aLeft=0;
const a=new LanVsSession({...harness,onPeer:()=>aPeer++,onPose:p=>aPose=p,onLeave:()=>aLeft++});
const b=new LanVsSession({...harness,onPeer:()=>bPeer++,onPose:p=>bPose=p});
await a.start(room);await b.start(room);
await new Promise(r=>setTimeout(r,10));
assert.equal(aPeer,1);assert.equal(bPeer,1);
assert.equal(a.setPose({p:[1,2,NaN],q:[0,0,0,1]}),false);
assert.equal(a.setPose({p:[1,2,3],q:[0,0,0,1],g:[9.17,47.66]}),true);
assert.equal(b.setPose({p:[4,5,6],q:[0,0,.1,.99],g:[9.171,47.661]}),true);
await new Promise(r=>setTimeout(r,140));
assert.deepEqual(aPose.p,[4,5,6]);assert.deepEqual(bPose.p,[1,2,3]);
assert.ok(aPose.seq>=1&&bPose.seq>=1);
const oldSeq=aPose.seq;
await new Promise(r=>setTimeout(r,70));
assert.ok(aPose.seq>oldSeq,"pose sequence did not advance");
b.stop();await new Promise(r=>setTimeout(r,5));assert.equal(aLeft,1);
a.stop();
console.log("LAN VS deterministic Trystero-0.25 two-peer smoke passed");
