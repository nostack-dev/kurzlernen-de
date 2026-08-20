import assert from "node:assert/strict";
import {LanVsSession} from "../sim/lan_vs.mjs";
import {findClearBuildingLaunchPoint,buildingLaunchPointClear} from "../sim/world_building_collision_physics.mjs";

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

const loadTransport=meshHarness(),events={a:[],b:[],c:[],d:[]},fx={a:[],b:[],c:[],d:[]};
const make=key=>new LanVsSession({loadTransport,transportName:"MeshTest",joinDiagnosticMs:0,onPeer:()=>{},onGame:(packet,peerId)=>events[key].push({packet,peerId}),onFx:(packet,peerId)=>fx[key].push({packet,peerId})});
const a=make("a"),b=make("b"),c=make("c"),d=make("d");
await a.start("net-four-player");await b.start("net-four-player");await c.start("net-four-player");await d.start("net-four-player");await sleep(25);
for(const session of[a,b,c,d])assert.equal(session.peerCount,3,"four players must remain simultaneously connected in one room");
assert.equal(new Set([a.getAuthorityId(),b.getAuthorityId(),c.getAuthorityId(),d.getAuthorityId()]).size,1,"every participant must elect the same deterministic match authority");
assert.equal(new Set([a.getSelfId(),b.getSelfId(),c.getSelfId(),d.getSelfId()]).size,4,"every player needs a unique network identity");

assert.equal(a.sendGame({type:"state",playerId:a.getSelfId(),hp:75,killed:false,by:"",id:"state-a"}),true);await sleep(5);for(const key of["b","c","d"])assert.equal(events[key].length,1,`broadcast game state must reach ${key}`);
const target=d.getSelfId();assert.equal(b.sendFx({type:"shot",id:"shot-b",from:[1,2,3],dir:[1,0,0],speed:210},{target}),true);await sleep(5);assert.equal(fx.a.length,0);assert.equal(fx.c.length,0);assert.equal(fx.d.length,1,"targeted reliable FX must reach exactly the requested peer");
assert.equal(c.sendFx({type:"explosion",id:"boom-c",p:[4,5,6],playerId:c.getSelfId()}),true);await sleep(5);assert.equal(fx.a.length,1);assert.equal(fx.b.length,1);assert.equal(fx.d.length,2,"explosions must broadcast to every other player");

const oldAuthority=a.getAuthorityId();assert.equal(oldAuthority,a.getSelfId());a.stop();await sleep(8);for(const session of[b,c,d])assert.equal(session.peerCount,2,"authority leaving must not tear down the remaining mesh");const migrated=[b.getAuthorityId(),c.getAuthorityId(),d.getAuthorityId()];assert.equal(new Set(migrated).size,1,"remaining players must converge on the same replacement authority");assert.notEqual(migrated[0],oldAuthority,"authority must migrate away from the disconnected player");

const huge={hash:"huge",prisms:[{buildingKey:"block",base:0,top:30,points:[[-500,-500],[500,-500],[500,500],[-500,500]]}]};const safe=findClearBuildingLaunchPoint(huge,{point:[0,0],clearanceM:1,maxSearchM:2});assert.equal(buildingLaunchPointClear(huge,safe,{clearanceM:1}),true,"guaranteed fallback launch point must be proven clear even when normal search radius cannot escape the building");assert.ok(Math.hypot(safe[0],safe[1])>500,"fallback must leave the full blocking footprint instead of returning the unsafe origin");

b.stop();c.stop();d.stop();
console.log("Four-player VS mesh smoke passed: simultaneous mates, unique identities, broadcast/targeted FX, authority migration and guaranteed collision-free WORLD spawn.");
