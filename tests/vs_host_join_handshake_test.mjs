import assert from "node:assert/strict";
import {LanVsSession} from "../sim/lan_vs.mjs";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function harness(){
 const rooms=new Set();let serial=0;
 return async()=>({joinRoom(_config,_id){
   const id=`p-${++serial}`,actions=new Map();
   const room={id,makeAction(name){const action={onMessage:null,send(packet,{target}={}){
     for(const r of rooms)if(r!==room&&(!target||r.id===target))r._deliver(name,packet,id);
     return Promise.resolve();}};actions.set(name,action);return action;},
     _deliver(name,packet,peerId){actions.get(name)?.onMessage?.(packet,{peerId});},
     getSelfId(){return id;},getPeers(){return{};},leave(){rooms.delete(room);for(const r of rooms)r.onPeerLeave?.(id);}};
   // Notify the previous peer before this room has any action handlers.
   for(const r of rooms)r.onPeerJoin?.(id);
   rooms.add(room);
   queueMicrotask(()=>{for(const r of rooms)if(r!==room)room.onPeerJoin?.(r.id);});
   return room;
 }});
}
const loadTransport=harness();
const all=Array.from({length:4},()=>new LanVsSession({loadTransport,joinDiagnosticMs:0}));
for(const peer of all){await peer.start('shared');await sleep(3);}
await sleep(25);
for(const peer of all){
 assert.equal(peer.peerCount,3);
 assert.equal(peer.peerJoinedAt.size,3,'timestamps must arrive despite early notification');
 assert.equal(peer.getAuthorityId(),all[0].getSelfId(),'oldest joiner must be elected everywhere');
}
all[0].stop();await sleep(10);
for(const peer of all.slice(1))assert.equal(peer.getAuthorityId(),all[1].getSelfId(),'next joiner must take over');
all.slice(1).forEach(peer=>peer.stop());
console.log('Host handshake: four players converge after lost early announcement.');
