import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {LanVsSession,LanVsFinder,sameNetworkRoomKey,sameNetworkRoomKeys,proximityRoomKeys,gestureRoomKeys,discoveryRoomKeys,networkMaterialFromCandidate} from "../sim/lan_vs.mjs";

function transportHarness(label="peer"){
  const rooms=new Map();let next=1;let callbackArgSeen=false;
  function joinRoom(_config,roomId,callbacks={}){
    callbackArgSeen=callbackArgSeen||typeof callbacks.onJoinError==="function";
    const id=`${label}-${next++}`,group=rooms.get(roomId)||new Set();rooms.set(roomId,group);const actions=new Map();
    const pc={connectionState:"connected",iceConnectionState:"connected",iceGatheringState:"complete",signalingState:"stable",addEventListener(){},getStats:async()=>new Map()};
    const room={id,onPeerJoin:null,onPeerLeave:null,makeAction(name){const action={onMessage:null,send(data,{target}={}){for(const peer of group){if(peer===room)continue;if(target&&peer.id!==target)continue;peer._deliver(name,data,id);}return Promise.resolve();}};actions.set(name,action);return action;},_deliver(name,data,peerId){actions.get(name)?.onMessage?.(data,{peerId});},getPeers(){return Object.fromEntries([...group].filter(peer=>peer!==room).map(peer=>[peer.id,pc]));},ping:async()=>3.5,leave(){group.delete(room);for(const peer of group)peer.onPeerLeave?.(id);}};
    for(const peer of group)peer.onPeerJoin?.(id);group.add(room);queueMicrotask(()=>{for(const peer of group)if(peer!==room)room.onPeerJoin?.(peer.id);});return room;
  }
  return{loadTransport:async()=>({joinRoom,getRelaySockets:()=>({"wss://relay.test":{readyState:1}})}),get callbackArgSeen(){return callbackArgSeen;}};
}
function failingTransport(){let callback=null;return{loadTransport:async()=>({joinRoom(_config,_roomId,callbacks={}){callback=callbacks.onJoinError;return{onPeerJoin:null,onPeerLeave:null,makeAction:()=>({onMessage:null,send:()=>Promise.resolve()}),getPeers:()=>({}),leave(){}};}}),trigger(){callback?.({peerId:"peer-x",error:new Error("ICE failed")});}};}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const overlap=(a,b)=>a.filter(v=>b.includes(v));
const fakeFetch=ip=>async()=>({ok:true,json:async()=>({ip})});

assert.equal(networkMaterialFromCandidate({type:"srflx",address:"203.0.113.7"}),"ipv4:203.0.113.7");
assert.equal(networkMaterialFromCandidate({type:"host",address:"192.168.4.21"}),"lan4p24:192.168.4");
const v6a=networkMaterialFromCandidate({type:"srflx",address:"2001:db8:abcd:42::1111"}),v6b=networkMaterialFromCandidate({type:"srflx",address:"2001:0db8:abcd:0042:9999::1"});
assert.equal(v6a,"ipv6p64:2001:0db8:abcd:0042");assert.equal(v6a,v6b,"IPv6 privacy interface IDs on the same /64 must converge");

const keysA=await sameNetworkRoomKeys({fetchFn:fakeFetch("198.51.100.20"),cryptoObj:webcrypto,networkMaterialsFn:async()=>["ipv6p64:2001:0db8:abcd:0042","ipv4:203.0.113.7"]});
const keysB=await sameNetworkRoomKeys({fetchFn:fakeFetch("198.51.100.21"),cryptoObj:webcrypto,networkMaterialsFn:async()=>["ipv6p64:2001:0db8:abcd:0042","ipv4:203.0.113.8"]});
assert.ok(overlap(keysA,keysB).length>=1,"same IPv6 LAN prefix must give both phones a common room despite different public IPv4");
const carrierA=await sameNetworkRoomKeys({fetchFn:fakeFetch("198.51.100.20"),cryptoObj:webcrypto,networkMaterialsFn:async()=>["ipv4:203.0.113.7"]});
const carrierB=await sameNetworkRoomKeys({fetchFn:fakeFetch("198.51.100.21"),cryptoObj:webcrypto,networkMaterialsFn:async()=>["ipv4:203.0.113.8"]});
assert.ok(overlap(carrierA,carrierB).length>=1,"same public /24 must provide a coarse hotspot/CGNAT fallback room when exact egress differs");
const legacy=await sameNetworkRoomKey({fetchFn:fakeFetch("203.0.113.7"),cryptoObj:webcrypto,networkMaterialsFn:async()=>["ipv4:203.0.113.7"]});assert.match(legacy,/^net-[0-9a-f]{24}$/);

const geoA=await proximityRoomKeys({longitude:9.170000,latitude:47.660000,cryptoObj:webcrypto}),geoB=await proximityRoomKeys({longitude:9.170650,latitude:47.660450,cryptoObj:webcrypto}),geoFar=await proximityRoomKeys({longitude:9.30,latitude:47.80,cryptoObj:webcrypto});
assert.ok(overlap(geoA,geoB).length>=1,"phones tens of metres apart must share at least one proximity room even at grid boundaries");assert.equal(overlap(geoA,geoFar).length,0,"distant phones must not collide in proximity rooms");
const tapA=await gestureRoomKeys({gestureTimeMs:7990,cryptoObj:webcrypto}),tapB=await gestureRoomKeys({gestureTimeMs:8010,cryptoObj:webcrypto});assert.ok(overlap(tapA,tapB).length>=1,"FIND MATE taps across an 8-second bucket boundary must overlap");
const zeroGpsA=await discoveryRoomKeys({fetchFn:fakeFetch("203.0.113.9"),cryptoObj:webcrypto,networkMaterialsFn:async()=>["ipv4:203.0.113.9"],positionFn:async()=>null,gestureTimeMs:10000});
const zeroGpsB=await discoveryRoomKeys({fetchFn:fakeFetch("198.51.100.44"),cryptoObj:webcrypto,networkMaterialsFn:async()=>["ipv4:198.51.100.44"],positionFn:async()=>null,gestureTimeMs:10500});
assert.ok(overlap(zeroGpsA,zeroGpsB).some(key=>key.startsWith("tap-")),"0-GPS phones with completely different network identities must retain a zero-touch rendezvous room");
let geoRequests=0;const discoveredFromGestureGeo=await discoveryRoomKeys({fetchFn:null,cryptoObj:webcrypto,networkMaterialsFn:async()=>[],positionFn:async()=>{geoRequests++;return{coords:{longitude:9.17,latitude:47.66}};},gestureTimeMs:10000});assert.equal(geoRequests,1);assert.ok(discoveredFromGestureGeo.some(key=>key.startsWith("tap-")));

const harness=transportHarness();let aPeer=0,bPeer=0,aPose=null,bPose=null,aOrigin=null,bOrigin=null,aCombat=null,bCombat=null,aLeft=0;const diagnostics=[];
const a=new LanVsSession({loadTransport:harness.loadTransport,transportName:"Test",joinDiagnosticMs:0,onDiagnostic:event=>diagnostics.push(event),onPeer:()=>aPeer++,onPose:p=>aPose=p,onOrigin:o=>aOrigin=o,onCombat:p=>aCombat=p,onLeave:()=>aLeft++}),b=new LanVsSession({loadTransport:harness.loadTransport,transportName:"Test",joinDiagnosticMs:0,onPeer:()=>bPeer++,onPose:p=>bPose=p,onOrigin:o=>bOrigin=o,onCombat:p=>bCombat=p});
await a.start(legacy);await b.start(legacy);await sleep(10);assert.equal(harness.callbackArgSeen,true,"Trystero 0.25 onJoinError must be passed as joinRoom's third callbacks argument");assert.equal(aPeer,1);assert.equal(bPeer,1);assert.ok(diagnostics.some(event=>event.stage==="transport-ready"));assert.ok(diagnostics.some(event=>event.stage==="peer-join"));
assert.equal(a.setOrigin({lon:9.17,lat:47.66,alt:411}),true);assert.equal(b.setOrigin({lon:NaN,lat:47.66}),false);await sleep(90);assert.deepEqual(bOrigin,{lon:9.17,lat:47.66,alt:411});assert.equal(aOrigin,null,"GPS-less peer must not invent an origin");assert.equal(a.setPose({p:[1,2,NaN],q:[0,0,0,1]}),false);assert.equal(a.setPose({p:[1,2,3],q:[0,0,0,1],v:[4,5,6],g:[9.17,47.66],t:1234,f:"9.1700000:47.6600000:411.0"}),true);assert.equal(b.setPose({p:[4,5,6],q:[0,0,.1,.99],v:[-1,0,2],t:1250,f:"local-metric"}),true);await sleep(140);assert.deepEqual(aPose.p,[4,5,6]);assert.deepEqual(aPose.v,[-1,0,2]);assert.equal(aPose.f,"local-metric");assert.deepEqual(bPose.p,[1,2,3]);assert.deepEqual(bPose.v,[4,5,6]);assert.equal(bPose.f,"9.1700000:47.6600000:411.0");assert.ok(aPose.seq>=1&&bPose.seq>=1);const oldSeq=aPose.seq;await sleep(70);assert.ok(aPose.seq>=oldSeq+2,"direct pose stream must run at about 30 Hz");assert.equal(a.sendCombat({type:"hit",id:"hit-1",damage:25}),true);await sleep(5);assert.deepEqual(bCombat,{type:"hit",id:"hit-1",damage:25});assert.equal(b.sendCombat({type:"state",id:"hit-1",hp:75,killed:false}),true);await sleep(5);assert.deepEqual(aCombat,{type:"state",id:"hit-1",hp:75,killed:false});b.stop();await sleep(5);assert.equal(aLeft,1);a.stop();

const failing=failingTransport();let joinError="";const broken=new LanVsSession({loadTransport:failing.loadTransport,transportName:"Fail",joinDiagnosticMs:0,onError:error=>joinError=error.message});await broken.start("net-fail");failing.trigger();await sleep(0);assert.equal(joinError,"ICE failed","real WebRTC join failures must escape WAITING and surface to the UI/logbook");broken.stop();

const strategyOne=transportHarness("one"),strategyTwo=transportHarness("two"),sharedNetwork="net-shared-network",strategies=[{name:"One",load:strategyOne.loadTransport},{name:"Two",load:strategyTwo.loadTransport}];let faPeer=0,fbPeer=0,faPose=null,fbPose=null,faLeft=0,faTransport="",fbTransport="";
const priorityProbe=new LanVsFinder({transportStrategies:strategies,maxRoomsPerStage:3});assert.deepEqual(priorityProbe.chooseStageRooms(["tap-a","tap-b",sharedNetwork,"net-only-a"]),[sharedNetwork,"net-only-a","tap-a"]);
const fa=new LanVsFinder({transportStrategies:strategies,stageMs:250,retryMs:25,joinDiagnosticMs:0,onPeer:(_peer,_room,transport)=>{faPeer++;faTransport=transport;},onPose:p=>faPose=p,onLeave:()=>faLeft++}),fb=new LanVsFinder({transportStrategies:strategies,stageMs:250,retryMs:25,joinDiagnosticMs:0,onPeer:(_peer,_room,transport)=>{fbPeer++;fbTransport=transport;},onPose:p=>fbPose=p});
await fa.start(["tap-a",sharedNetwork,"net-only-a"]);await fb.start(["tap-b",sharedNetwork,"net-only-b"]);await sleep(20);assert.equal(faPeer,1);assert.equal(fbPeer,1);assert.equal(faTransport,fbTransport,"first successful parallel signaling strategy must converge on both peers");assert.equal(fa.children.length,1,"losing room/transport sessions must be closed after peer selection");assert.equal(fb.children.length,1);fa.setPose({p:[10,20,30],q:[0,0,0,1]});fb.setPose({p:[40,50,60],q:[0,0,0,1]});await sleep(90);assert.deepEqual(faPose?.p,[40,50,60]);assert.deepEqual(fbPose?.p,[10,20,30]);fb.stop();await sleep(10);assert.equal(faLeft,1);
const fc=new LanVsFinder({transportStrategies:strategies,stageMs:250,retryMs:25,joinDiagnosticMs:0,onPeer:()=>{},onPose:()=>{}});await sleep(45);await fc.start(["tap-c",sharedNetwork,"net-only-c"]);await sleep(90);assert.ok(faPeer>=2,"finder must automatically recover and pair with a replacement peer after peer loss");fc.stop();fa.stop();

console.log("LAN VS deterministic smoke passed: same-network rooms first and automatic peer-loss recovery.");

await import("./staged_vs_smoke.mjs");
