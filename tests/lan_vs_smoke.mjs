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

function deadTransport(){
  let next=1;
  const joinRoom=()=>{
    const id=`dead-${next++}`;
    return{id,onPeerJoin:null,onPeerLeave:null,onJoinError:null,makeAction:()=>({onMessage:null,send:()=>Promise.resolve()}),leave(){}};
  };
  return{loadTransport:async()=>({joinRoom})};
}

const calls=[];
const fakeFetch=ip=>async url=>{calls.push(String(url));return{ok:true,json:async()=>({ip})};};
const room=await sameNetworkRoomKey({fetchFn:fakeFetch("198.51.100.99"),cryptoObj:webcrypto,natAddressFn:async()=>"203.0.113.7"});
const sameRoom=await sameNetworkRoomKey({fetchFn:fakeFetch("198.51.100.100"),cryptoObj:webcrypto,natAddressFn:async()=>"203.0.113.7"});
const otherRoom=await sameNetworkRoomKey({fetchFn:fakeFetch("198.51.100.99"),cryptoObj:webcrypto,natAddressFn:async()=>"203.0.113.8"});
assert.equal(room,sameRoom,"same WebRTC NAT must produce the same automatic room");
assert.notEqual(room,otherRoom,"different NATs must not collide");
assert.match(room,/^net-[0-9a-f]{24}$/);
assert.equal(calls.length,0,"HTTP address service must not run when STUN already found the shared NAT");
const httpRoom=await sameNetworkRoomKey({fetchFn:fakeFetch("203.0.113.7"),cryptoObj:webcrypto,natAddressFn:async()=>null});
assert.equal(httpRoom,room,"HTTP IPv4 fallback must converge on the same room as STUN for the same NAT");
assert.ok(calls.every(url=>url.includes("api4.ipify.org")),"HTTP fallback must force shared IPv4 rather than per-device IPv6");

const harness=transportHarness();
let aPeer=0,bPeer=0,aPose=null,bPose=null,aOrigin=null,bOrigin=null,aLeft=0;
const a=new LanVsSession({...harness,onPeer:()=>aPeer++,onPose:p=>aPose=p,onOrigin:o=>aOrigin=o,onLeave:()=>aLeft++});
const b=new LanVsSession({...harness,onPeer:()=>bPeer++,onPose:p=>bPose=p,onOrigin:o=>bOrigin=o});
await a.start(room);await b.start(room);
await new Promise(r=>setTimeout(r,10));
assert.equal(aPeer,1);assert.equal(bPeer,1);
assert.equal(a.setOrigin({lon:9.17,lat:47.66,alt:411}),true);
assert.equal(b.setOrigin({lon:NaN,lat:47.66}),false);
await new Promise(r=>setTimeout(r,90));
assert.deepEqual(bOrigin,{lon:9.17,lat:47.66,alt:411});
assert.equal(aOrigin,null,"GPS-less peer must not invent an origin");
assert.equal(a.setPose({p:[1,2,NaN],q:[0,0,0,1]}),false);
assert.equal(a.setPose({p:[1,2,3],q:[0,0,0,1],g:[9.17,47.66]}),true);
assert.equal(b.setPose({p:[4,5,6],q:[0,0,.1,.99]}),true);
await new Promise(r=>setTimeout(r,140));
assert.deepEqual(aPose.p,[4,5,6]);assert.deepEqual(bPose.p,[1,2,3]);
assert.ok(aPose.seq>=1&&bPose.seq>=1);
const oldSeq=aPose.seq;
await new Promise(r=>setTimeout(r,70));
assert.ok(aPose.seq>oldSeq,"pose sequence did not advance");
b.stop();await new Promise(r=>setTimeout(r,5));assert.equal(aLeft,1);
a.stop();

// Real failure mode: both peers can sit in a healthy-looking Nostr room forever.
// Both must automatically abandon that path and converge on the same MQTT room.
const dead=deadTransport(),fallback=transportHarness(),fallbackRoom=room;
let faPeer=0,fbPeer=0,faPose=null,fbPose=null;const faTransports=[],fbTransports=[];
const fa=new LanVsSession({loadTransport:dead.loadTransport,loadFallbackTransport:fallback.loadTransport,fallbackAfterMs:20,onTransport:name=>faTransports.push(name),onPeer:()=>faPeer++,onPose:p=>faPose=p});
const fb=new LanVsSession({loadTransport:dead.loadTransport,loadFallbackTransport:fallback.loadTransport,fallbackAfterMs:20,onTransport:name=>fbTransports.push(name),onPeer:()=>fbPeer++,onPose:p=>fbPose=p});
await fa.start(fallbackRoom);await new Promise(r=>setTimeout(r,8));await fb.start(fallbackRoom);
await new Promise(r=>setTimeout(r,90));
assert.equal(faPeer,1,"peer A did not connect after primary signaling timeout");
assert.equal(fbPeer,1,"peer B did not connect after primary signaling timeout");
assert.deepEqual(faTransports,["Nostr","MQTT"]);
assert.deepEqual(fbTransports,["Nostr","MQTT"]);
assert.equal(fa.transportName,"MQTT");assert.equal(fb.transportName,"MQTT");
fa.setPose({p:[10,20,30],q:[0,0,0,1]});fb.setPose({p:[40,50,60],q:[0,0,0,1]});
await new Promise(r=>setTimeout(r,90));
assert.deepEqual(faPose?.p,[40,50,60]);assert.deepEqual(fbPose?.p,[10,20,30]);
fa.stop();fb.stop();

console.log("LAN VS deterministic smoke passed: automatic same-NAT room, no pair code, and Nostr -> MQTT signaling fallback");
