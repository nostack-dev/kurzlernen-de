import assert from "node:assert/strict";
import {LanVsSession} from "../sim/lan_vs.mjs";

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function meshHarness(){
  const rooms=new Map();let serial=0;
  function joinRoom(_config,roomId){
    const group=rooms.get(roomId)||new Set();rooms.set(roomId,group);const id=`player-${++serial}`,actions=new Map();
    const room={id,onPeerJoin:null,onPeerLeave:null,
      makeAction(name){const action={onMessage:null,send(data,{target}={}){for(const peer of group){if(peer===room)continue;if(target&&peer.id!==target)continue;peer._deliver(name,data,id);}return Promise.resolve();}};actions.set(name,action);return action;},
      _deliver(name,data,peerId){actions.get(name)?.onMessage?.(data,{peerId});},
      getSelfId(){return id;},
      getAuthorityId(){return [...group].map(peer=>peer.id).concat(id).sort()[0];},
      getPeers(){return Object.fromEntries([...group].filter(peer=>peer!==room).map(peer=>[peer.id,{connectionState:"connected",iceConnectionState:"connected",iceGatheringState:"complete",signalingState:"stable",addEventListener(){},getStats:async()=>new Map()}]));},
      ping:async()=>2,
      leave(){if(!group.has(room))return;group.delete(room);for(const peer of group)peer.onPeerLeave?.(id);}
    };
    for(const peer of group)peer.onPeerJoin?.(id);group.add(room);queueMicrotask(()=>{for(const peer of group)if(peer!==room)room.onPeerJoin?.(peer.id);});return room;
  }
  return async()=>({joinRoom,getRelaySockets:()=>({})});
}

const loadTransport=meshHarness(),events={a:[],b:[],c:[]},fx={a:[],b:[],c:[]};
const make=(key)=>new LanVsSession({loadTransport,transportName:"MeshTest",joinDiagnosticMs:0,onPeer:()=>{},onGame:(packet,peerId)=>events[key].push({packet,peerId}),onFx:(packet,peerId)=>fx[key].push({packet,peerId})});
const a=make("a"),b=make("b"),c=make("c");
await a.start("net-three-player");await b.start("net-three-player");await c.start("net-three-player");await sleep(20);
assert.equal(a.peerCount,2);assert.equal(b.peerCount,2);assert.equal(c.peerCount,2,"three players must remain connected in one room rather than replacing the first mate");
assert.equal(a.getPeerIds().length,2);assert.equal(new Set([a.getAuthorityId(),b.getAuthorityId(),c.getAuthorityId()]).size,1,"every participant must elect the same deterministic match authority");
assert.equal(a.sendGame({type:"state",playerId:a.getSelfId(),hp:75,killed:false,by:"",id:"state-a"}),true);await sleep(5);assert.equal(events.b.length,1);assert.equal(events.c.length,1);assert.equal(events.b[0].peerId,a.getSelfId());assert.equal(events.c[0].peerId,a.getSelfId());
const target=c.getSelfId();assert.equal(b.sendFx({type:"shot",id:"shot-b",from:[1,2,3],dir:[1,0,0],speed:210},{target}),true);await sleep(5);assert.equal(fx.a.length,0,"targeted reliable FX must not leak to other peers");assert.equal(fx.c.length,1);assert.equal(fx.c[0].peerId,b.getSelfId());
assert.equal(c.sendFx({type:"explosion",id:"boom-c",p:[4,5,6],playerId:c.getSelfId()}),true);await sleep(5);assert.equal(fx.a.length,1);assert.equal(fx.b.length,1,"explosions must broadcast to every other player");
const bId=b.getSelfId();b.stop();await sleep(5);assert.equal(a.peerCount,1);assert.equal(c.peerCount,1);assert.ok(!a.getPeerIds().includes(bId)&&!c.getPeerIds().includes(bId),"leaving one player must not tear down the remaining mesh");
a.stop();c.stop();

console.log("Three-player VS mesh smoke passed: two simultaneous mates per client, shared authority, broadcast game state, targeted shots and broadcast explosions.");
