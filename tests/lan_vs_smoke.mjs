import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {LanVsSession,LanVsFinder,sameNetworkRoomKey,sameNetworkRoomKeys,proximityRoomKeys,discoveryRoomKeys,networkMaterialFromCandidate} from "../sim/lan_vs.mjs";

function transportHarness(){
  const rooms=new Map();let next=1;
  function joinRoom(_config,roomId){
    const id=`peer-${next++}`,group=rooms.get(roomId)||new Set();rooms.set(roomId,group);const actions=new Map();
    const room={id,onPeerJoin:null,onPeerLeave:null,onJoinError:null,makeAction(name){const action={onMessage:null,send(data,{target}={}){for(const peer of group){if(peer===room)continue;if(target&&peer.id!==target)continue;peer._deliver(name,data,id);}return Promise.resolve();}};actions.set(name,action);return action;},_deliver(name,data,peerId){actions.get(name)?.onMessage?.(data,{peerId});},leave(){group.delete(room);for(const peer of group)peer.onPeerLeave?.(id);}};
    for(const peer of group)peer.onPeerJoin?.(id);group.add(room);queueMicrotask(()=>{for(const peer of group)if(peer!==room)room.onPeerJoin?.(peer.id);});return room;
  }
  return{loadTransport:async()=>({joinRoom})};
}
function deadTransport(){let next=1;const joinRoom=()=>{const id=`dead-${next++}`;return{id,onPeerJoin:null,onPeerLeave:null,onJoinError:null,makeAction:()=>({onMessage:null,send:()=>Promise.resolve()}),leave(){}};};return{loadTransport:async()=>({joinRoom})};}
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
const discovery=await discoveryRoomKeys({longitude:9.17,latitude:47.66,fetchFn:fakeFetch("203.0.113.7"),cryptoObj:webcrypto,networkMaterialsFn:async()=>["ipv4:203.0.113.7"]});assert.ok(discovery.length>=5&&discovery.length<=8);
let geoRequests=0;
const discoveredFromGestureGeo=await discoveryRoomKeys({fetchFn:null,cryptoObj:webcrypto,networkMaterialsFn:async()=>[],positionFn:async()=>{geoRequests++;return{coords:{longitude:9.17,latitude:47.66}};}});
assert.equal(geoRequests,1,"FIND MATE must actively request a best-effort proximity fix when no cached GPS exists");assert.equal(discoveredFromGestureGeo.length,4);
const discoveredNetworkOnly=await discoveryRoomKeys({fetchFn:fakeFetch("203.0.113.7"),cryptoObj:webcrypto,networkMaterialsFn:async()=>["ipv4:203.0.113.7"],positionFn:async()=>null});
assert.ok(discoveredNetworkOnly.length>=2,"GPS-less phone must still get automatic network discovery rooms");

const harness=transportHarness();let aPeer=0,bPeer=0,aPose=null,bPose=null,aOrigin=null,bOrigin=null,aCombat=null,bCombat=null,aLeft=0;
const a=new LanVsSession({...harness,onPeer:()=>aPeer++,onPose:p=>aPose=p,onOrigin:o=>aOrigin=o,onCombat:p=>aCombat=p,onLeave:()=>aLeft++}),b=new LanVsSession({...harness,onPeer:()=>bPeer++,onPose:p=>bPose=p,onOrigin:o=>bOrigin=o,onCombat:p=>bCombat=p});
await a.start(legacy);await b.start(legacy);await sleep(10);assert.equal(aPeer,1);assert.equal(bPeer,1);assert.equal(a.setOrigin({lon:9.17,lat:47.66,alt:411}),true);assert.equal(b.setOrigin({lon:NaN,lat:47.66}),false);await sleep(90);assert.deepEqual(bOrigin,{lon:9.17,lat:47.66,alt:411});assert.equal(aOrigin,null,"GPS-less peer must not invent an origin");assert.equal(a.setPose({p:[1,2,NaN],q:[0,0,0,1]}),false);assert.equal(a.setPose({p:[1,2,3],q:[0,0,0,1],g:[9.17,47.66]}),true);assert.equal(b.setPose({p:[4,5,6],q:[0,0,.1,.99]}),true);await sleep(140);assert.deepEqual(aPose.p,[4,5,6]);assert.deepEqual(bPose.p,[1,2,3]);assert.ok(aPose.seq>=1&&bPose.seq>=1);const oldSeq=aPose.seq;await sleep(70);assert.ok(aPose.seq>oldSeq);assert.equal(a.sendCombat({type:"hit",id:"hit-1",damage:25}),true);await sleep(5);assert.deepEqual(bCombat,{type:"hit",id:"hit-1",damage:25});assert.equal(b.sendCombat({type:"state",id:"hit-1",hp:75,killed:false}),true);await sleep(5);assert.deepEqual(aCombat,{type:"state",id:"hit-1",hp:75,killed:false});b.stop();await sleep(5);assert.equal(aLeft,1);a.stop();

const finderHarness=transportHarness(),shared=geoA[0];let faPeer=0,fbPeer=0,faPose=null,fbPose=null,faLeft=0;
const fa=new LanVsFinder({...finderHarness,onPeer:()=>faPeer++,onPose:p=>faPose=p,onLeave:()=>faLeft++}),fb=new LanVsFinder({...finderHarness,onPeer:()=>fbPeer++,onPose:p=>fbPose=p});
await fa.start(["net-only-a",shared,"geo-only-a"]);await fb.start(["net-only-b","geo-only-b",shared]);await sleep(20);assert.equal(faPeer,1);assert.equal(fbPeer,1);fa.setPose({p:[10,20,30],q:[0,0,0,1]});fb.setPose({p:[40,50,60],q:[0,0,0,1]});await sleep(90);assert.deepEqual(faPose?.p,[40,50,60]);assert.deepEqual(fbPose?.p,[10,20,30]);fb.stop();await sleep(5);assert.equal(faLeft,1);fa.stop();

const dead=deadTransport(),fallback=transportHarness();let xaPeer=0,xbPeer=0;const xaTransports=[],xbTransports=[];const xa=new LanVsSession({loadTransport:dead.loadTransport,loadFallbackTransport:fallback.loadTransport,fallbackAfterMs:20,onTransport:n=>xaTransports.push(n),onPeer:()=>xaPeer++}),xb=new LanVsSession({loadTransport:dead.loadTransport,loadFallbackTransport:fallback.loadTransport,fallbackAfterMs:20,onTransport:n=>xbTransports.push(n),onPeer:()=>xbPeer++});await xa.start(legacy);await sleep(8);await xb.start(legacy);await sleep(90);assert.equal(xaPeer,1);assert.equal(xbPeer,1);assert.deepEqual(xaTransports,["Nostr","MQTT"]);assert.deepEqual(xbTransports,["Nostr","MQTT"]);xa.stop();xb.stop();
console.log("LAN VS deterministic smoke passed: gesture proximity + IPv6/LAN/IPv4/coarse-hotspot discovery, Nostr -> MQTT fallback, pose/origin/combat");
