from pathlib import Path

p=Path('sim/lan_vs.mjs');s=p.read_text()
s=s.replace('const STUN_ICE_SERVERS=[{urls:["stun:stun.cloudflare.com:3478","stun:stun.cloudflare.com:53"]}];', '''const DISCOVERY_MAX_ROOMS=8;\nconst PROXIMITY_CELL_M=800;\nconst EARTH_RADIUS_M=6378137;\nconst STUN_ICE_SERVERS=[\n  {urls:["stun:stun.cloudflare.com:3478","stun:stun.cloudflare.com:53"]},\n  {urls:"stun:stun.l.google.com:19302"}\n];''')
a=s.index('function srflxIpv4')
b=s.index('\n\nexport class LanVsSession',a)
helpers=r'''function privateIpv4(value){
  if(!validIpv4(value))return false;
  const [a,b]=value.split(".").map(Number);
  return a===10||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===169&&b===254);
}
function ipv4Subnet24(value){
  if(!validIpv4(value))return null;
  const parts=value.split(".");return `${parts[0]}.${parts[1]}.${parts[2]}`;
}
function ipv6Parts(value){
  let raw=String(value||"").trim().toLowerCase();
  if(raw.startsWith("[")&&raw.endsWith("]"))raw=raw.slice(1,-1);
  raw=raw.split("%")[0];if(!raw.includes(":")||raw.includes("."))return null;
  const halves=raw.split("::");if(halves.length>2)return null;
  const left=halves[0]?halves[0].split(":"):[],right=halves.length===2&&halves[1]?halves[1].split(":"):[];
  if(!left.concat(right).every(part=>/^[0-9a-f]{1,4}$/.test(part)))return null;
  const missing=8-left.length-right.length;if(halves.length===1&&missing!==0)return null;if(halves.length===2&&missing<1)return null;
  const parts=[...left,...Array(Math.max(0,missing)).fill("0"),...right].map(part=>Number.parseInt(part||"0",16));
  return parts.length===8&&parts.every(v=>Number.isInteger(v)&&v>=0&&v<=0xffff)?parts:null;
}
function ipv6Prefix64(value){
  const parts=ipv6Parts(value);if(!parts)return null;
  return parts.slice(0,4).map(v=>v.toString(16).padStart(4,"0")).join(":");
}
function candidateRecord(candidate){
  if(!candidate)return null;
  let type=String(candidate.type||"").toLowerCase(),address=String(candidate.address||"").trim();
  if(!type||!address){const raw=String(candidate.candidate||candidate||"").trim(),parts=raw.split(/\s+/),typ=parts.indexOf("typ");if(typ>4){type=type||String(parts[typ+1]||"").toLowerCase();address=address||String(parts[4]||"").trim();}}
  return type&&address?{type,address}:null;
}
export function networkMaterialFromCandidate(candidate){
  const record=candidateRecord(candidate);if(!record)return null;const {type,address}=record;
  if(validIpv4(address)){if(type==="srflx")return `ipv4:${address}`;if(type==="host"&&privateIpv4(address))return `lan4p24:${ipv4Subnet24(address)}`;return null;}
  const prefix=ipv6Prefix64(address);if(prefix&&(type==="srflx"||type==="host"))return `ipv6p64:${prefix}`;return null;
}
async function webRtcNetworkMaterials({RTCPeerConnectionCtor=globalThis.RTCPeerConnection}={}){
  if(typeof RTCPeerConnectionCtor!=="function")return[];let pc=null,timer=0;
  try{
    pc=new RTCPeerConnectionCtor({iceServers:STUN_ICE_SERVERS,iceCandidatePoolSize:2});pc.createDataChannel("vs-discovery");
    return await new Promise((resolve,reject)=>{const materials=new Set();let settled=false;const finish=()=>{if(settled)return;settled=true;clearTimeout(timer);resolve([...materials].sort());};timer=setTimeout(finish,3600);pc.onicecandidate=event=>{if(!event.candidate){finish();return;}const material=networkMaterialFromCandidate(event.candidate);if(material)materials.add(material);};Promise.resolve(pc.createOffer()).then(offer=>pc.setLocalDescription(offer)).catch(reject);});
  }catch{return[];}finally{clearTimeout(timer);try{pc?.close?.();}catch{}}
}'''
s=s[:a]+helpers+s[b:]
marker='\n\nasync function hashRoomMaterial(material,cryptoObj){'
idx=s.index(marker)
finder=r'''

export class LanVsFinder{
  constructor(options={}){this.options=options;this.children=[];this.active=null;this.roomIds=[];this.pendingPose=null;this.pendingOrigin=null;this.started=false;this.failedChildren=new Set();}
  makeChild(roomId){
    let child=null;const opts=this.options;
    child=new LanVsSession({
      ...(Object.prototype.hasOwnProperty.call(opts,"loadTransport")?{loadTransport:opts.loadTransport}:{}),
      ...(Object.prototype.hasOwnProperty.call(opts,"loadFallbackTransport")?{loadFallbackTransport:opts.loadFallbackTransport}:{}),
      ...(Number.isFinite(opts.fallbackAfterMs)?{fallbackAfterMs:opts.fallbackAfterMs}:{}),
      onTransport:name=>{if(!this.active||this.active===child)opts.onTransport?.(name,roomId);},
      onPeer:peerId=>this.adopt(child,peerId,roomId),
      onPose:(pose,peerId)=>{if(this.active===child)opts.onPose?.(pose,peerId);},
      onOrigin:(origin,peerId)=>{if(this.active===child)opts.onOrigin?.(origin,peerId);},
      onCombat:(packet,peerId)=>{if(this.active===child)opts.onCombat?.(packet,peerId);},
      onLeave:peerId=>{if(this.active===child)opts.onLeave?.(peerId);},
      onError:error=>{if(this.active===child)opts.onError?.(error);else{this.failedChildren.add(child);if(!this.active&&this.children.length&&this.failedChildren.size>=this.children.length)opts.onError?.(error);}}
    });
    if(this.pendingPose)child.setPose(this.pendingPose);if(this.pendingOrigin)child.setOrigin(this.pendingOrigin);return child;
  }
  adopt(child,peerId,roomId){
    if(this.active&&this.active!==child){child.stop();return;}
    if(!this.active){this.active=child;for(const other of this.children)if(other!==child)other.stop();this.children=[child];this.failedChildren.clear();}
    this.options.onPeer?.(peerId,roomId);
  }
  async start(roomIds){
    if(this.started)return;this.started=true;const ids=[...new Set((Array.isArray(roomIds)?roomIds:[roomIds]).filter(id=>typeof id==="string"&&id))].slice(0,DISCOVERY_MAX_ROOMS);if(!ids.length){this.started=false;throw Error("VS discovery produced no room candidates");}this.roomIds=ids;const children=ids.map(id=>this.makeChild(id));this.children=children;const results=await Promise.allSettled(children.map((child,index)=>child.start(ids[index])));if(!this.active&&results.every(result=>result.status==="rejected")){const reason=results.find(result=>result.status==="rejected")?.reason||Error("VS signaling unavailable");this.stop();throw reason;}
  }
  setOrigin(origin){if(!validOrigin(origin))return false;this.pendingOrigin={...origin};for(const child of this.active?[this.active]:this.children)child.setOrigin(origin);return true;}
  setPose(pose){if(!validPose(pose))return false;this.pendingPose={...pose,p:[...pose.p],q:[...pose.q],...(pose.g?{g:[...pose.g]}:{})};for(const child of this.active?[this.active]:this.children)child.setPose(pose);return true;}
  sendCombat(packet){return this.active?.sendCombat(packet)||false;}
  stop(){for(const child of this.children)child.stop();this.children=[];this.active=null;this.roomIds=[];this.pendingPose=null;this.pendingOrigin=null;this.started=false;this.failedChildren.clear();}
}'''
s=s[:idx]+finder+s[idx:]
start=s.index('export async function sameNetworkRoomKey')
bottom=r'''export async function sameNetworkRoomKeys({fetchFn=globalThis.fetch,cryptoObj=globalThis.crypto,networkMaterialsFn=webRtcNetworkMaterials}={}){
  const materials=new Set();let lastError=null;
  try{for(const material of await networkMaterialsFn?.()||[])if(typeof material==="string"&&material)materials.add(material);}catch(error){lastError=error;}
  if(typeof fetchFn==="function"){
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),3500);
    try{const response=await fetchFn(NETWORK_IPV4_URL,{cache:"no-store",signal:controller.signal});if(!response?.ok)throw Error(`Network lookup failed (${response?.status||0})`);const data=await response.json(),address=String(data?.ip||"").trim();if(!validIpv4(address))throw Error("Network lookup returned invalid IPv4 address");materials.add(`ipv4:${address}`);}catch(error){lastError=error;}finally{clearTimeout(timeout);}
  }
  if(!materials.size)throw lastError||Error("Could not determine shared network identity");const keys=[];for(const material of [...materials].sort()){const key=await hashRoomMaterial(`arondight45-vs-discovery-v4:${material}`,cryptoObj);keys.push(`net-${key}`);}return [...new Set(keys)];
}
export async function sameNetworkRoomKey(options={}){const keys=await sameNetworkRoomKeys(options);return keys[0];}
export async function proximityRoomKeys({longitude,latitude,cryptoObj=globalThis.crypto}={}){
  if(!Number.isFinite(longitude)||!Number.isFinite(latitude)||Math.abs(longitude)>180||Math.abs(latitude)>85)return[];const lonRad=longitude*Math.PI/180,latRad=latitude*Math.PI/180,x=EARTH_RADIUS_M*lonRad,y=EARTH_RADIUS_M*Math.log(Math.tan(Math.PI/4+latRad/2)),half=PROXIMITY_CELL_M/2,shifts=[[0,0],[half,0],[0,half],[half,half]],keys=[];
  for(let i=0;i<shifts.length;i++){const [sx,sy]=shifts[i],ix=Math.floor((x+sx)/PROXIMITY_CELL_M),iy=Math.floor((y+sy)/PROXIMITY_CELL_M),key=await hashRoomMaterial(`arondight45-vs-discovery-v4:geo:${PROXIMITY_CELL_M}:${i}:${ix}:${iy}`,cryptoObj);keys.push(`net-${key}`);}return [...new Set(keys)];
}
export async function discoveryRoomKeys({longitude,latitude,fetchFn=globalThis.fetch,cryptoObj=globalThis.crypto,networkMaterialsFn=webRtcNetworkMaterials}={}){
  const geo=await proximityRoomKeys({longitude,latitude,cryptoObj}),network=await sameNetworkRoomKeys({fetchFn,cryptoObj,networkMaterialsFn}).catch(()=>[]),keys=[...geo,...network];if(!keys.length)throw Error("No automatic proximity/network discovery path available");return [...new Set(keys)].slice(0,DISCOVERY_MAX_ROOMS);
}
'''
s=s[:start]+bottom
p.write_text(s)

p=Path('sim/real_world_bootstrap.mjs');s=p.read_text()
s=s.replace('import {LanVsSession,sameNetworkRoomKey} from "./lan_vs.mjs";','import {LanVsFinder,discoveryRoomKeys} from "./lan_vs.mjs";')
old='try{const roomId=await sameNetworkRoomKey();if(!this.vsStarting)return;const session=new LanVsSession({'
new='try{const deviceCoords=!this.vsWorldFromMate&&Number.isFinite(this.originLon)&&Number.isFinite(this.originLat)?{longitude:this.originLon,latitude:this.originLat}:this.lastLocation?.coords&&Number.isFinite(this.lastLocation.coords.longitude)&&Number.isFinite(this.lastLocation.coords.latitude)?{longitude:this.lastLocation.coords.longitude,latitude:this.lastLocation.coords.latitude}:{};const roomIds=await discoveryRoomKeys(deviceCoords);const viewport=$("viewport");if(viewport)viewport.dataset.vsDiscoveryRooms=String(roomIds.length);if(!this.vsStarting)return;const session=new LanVsFinder({'
assert s.count(old)==1,s.count(old);s=s.replace(old,new,1)
assert s.count('await session.start(roomId);')==1;s=s.replace('await session.start(roomId);','await session.start(roomIds);',1)
p.write_text(s)

Path('tests/lan_vs_smoke.mjs').write_text(r'''import assert from "node:assert/strict";
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
const legacy=await sameNetworkRoomKey({fetchFn:fakeFetch("203.0.113.7"),cryptoObj:webcrypto,networkMaterialsFn:async()=>["ipv4:203.0.113.7"]});assert.match(legacy,/^net-[0-9a-f]{24}$/);

const geoA=await proximityRoomKeys({longitude:9.170000,latitude:47.660000,cryptoObj:webcrypto}),geoB=await proximityRoomKeys({longitude:9.170650,latitude:47.660450,cryptoObj:webcrypto}),geoFar=await proximityRoomKeys({longitude:9.30,latitude:47.80,cryptoObj:webcrypto});
assert.ok(overlap(geoA,geoB).length>=1,"phones tens of metres apart must share at least one proximity room even at grid boundaries");assert.equal(overlap(geoA,geoFar).length,0,"distant phones must not collide in proximity rooms");
const discovery=await discoveryRoomKeys({longitude:9.17,latitude:47.66,fetchFn:fakeFetch("203.0.113.7"),cryptoObj:webcrypto,networkMaterialsFn:async()=>["ipv4:203.0.113.7"]});assert.ok(discovery.length>=5&&discovery.length<=8);

const harness=transportHarness();let aPeer=0,bPeer=0,aPose=null,bPose=null,aOrigin=null,bOrigin=null,aCombat=null,bCombat=null,aLeft=0;
const a=new LanVsSession({...harness,onPeer:()=>aPeer++,onPose:p=>aPose=p,onOrigin:o=>aOrigin=o,onCombat:p=>aCombat=p,onLeave:()=>aLeft++}),b=new LanVsSession({...harness,onPeer:()=>bPeer++,onPose:p=>bPose=p,onOrigin:o=>bOrigin=o,onCombat:p=>bCombat=p});
await a.start(legacy);await b.start(legacy);await sleep(10);assert.equal(aPeer,1);assert.equal(bPeer,1);assert.equal(a.setOrigin({lon:9.17,lat:47.66,alt:411}),true);assert.equal(b.setOrigin({lon:NaN,lat:47.66}),false);await sleep(90);assert.deepEqual(bOrigin,{lon:9.17,lat:47.66,alt:411});assert.equal(aOrigin,null,"GPS-less peer must not invent an origin");assert.equal(a.setPose({p:[1,2,NaN],q:[0,0,0,1]}),false);assert.equal(a.setPose({p:[1,2,3],q:[0,0,0,1],g:[9.17,47.66]}),true);assert.equal(b.setPose({p:[4,5,6],q:[0,0,.1,.99]}),true);await sleep(140);assert.deepEqual(aPose.p,[4,5,6]);assert.deepEqual(bPose.p,[1,2,3]);assert.ok(aPose.seq>=1&&bPose.seq>=1);const oldSeq=aPose.seq;await sleep(70);assert.ok(aPose.seq>oldSeq);assert.equal(a.sendCombat({type:"hit",id:"hit-1",damage:25}),true);await sleep(5);assert.deepEqual(bCombat,{type:"hit",id:"hit-1",damage:25});assert.equal(b.sendCombat({type:"state",id:"hit-1",hp:75,killed:false}),true);await sleep(5);assert.deepEqual(aCombat,{type:"state",id:"hit-1",hp:75,killed:false});b.stop();await sleep(5);assert.equal(aLeft,1);a.stop();

const finderHarness=transportHarness(),shared=geoA[0];let faPeer=0,fbPeer=0,faPose=null,fbPose=null,faLeft=0;
const fa=new LanVsFinder({...finderHarness,onPeer:()=>faPeer++,onPose:p=>faPose=p,onLeave:()=>faLeft++}),fb=new LanVsFinder({...finderHarness,onPeer:()=>fbPeer++,onPose:p=>fbPose=p});
await fa.start(["net-only-a",shared,"geo-only-a"]);await fb.start(["net-only-b","geo-only-b",shared]);await sleep(20);assert.equal(faPeer,1);assert.equal(fbPeer,1);fa.setPose({p:[10,20,30],q:[0,0,0,1]});fb.setPose({p:[40,50,60],q:[0,0,0,1]});await sleep(90);assert.deepEqual(faPose?.p,[40,50,60]);assert.deepEqual(fbPose?.p,[10,20,30]);fb.stop();await sleep(5);assert.equal(faLeft,1);fa.stop();

const dead=deadTransport(),fallback=transportHarness();let xaPeer=0,xbPeer=0;const xaTransports=[],xbTransports=[];const xa=new LanVsSession({loadTransport:dead.loadTransport,loadFallbackTransport:fallback.loadTransport,fallbackAfterMs:20,onTransport:n=>xaTransports.push(n),onPeer:()=>xaPeer++}),xb=new LanVsSession({loadTransport:dead.loadTransport,loadFallbackTransport:fallback.loadTransport,fallbackAfterMs:20,onTransport:n=>xbTransports.push(n),onPeer:()=>xbPeer++});await xa.start(legacy);await sleep(8);await xb.start(legacy);await sleep(90);assert.equal(xaPeer,1);assert.equal(xbPeer,1);assert.deepEqual(xaTransports,["Nostr","MQTT"]);assert.deepEqual(xbTransports,["Nostr","MQTT"]);xa.stop();xb.stop();
console.log("LAN VS deterministic smoke passed: proximity + IPv6/LAN/IPv4 multi-room discovery, Nostr -> MQTT fallback, pose/origin/combat");
''')

p=Path('tests/architecture_invariants.mjs');s=p.read_text()
anchor='requireText("sim/lan_vs.mjs","stun:stun.cloudflare.com:3478","same-network discovery must try WebRTC/STUN NAT identity before HTTP heuristics");\n'
extra='''requireText("sim/lan_vs.mjs","export class LanVsFinder","VS discovery must search multiple automatic candidate rooms and collapse to the first real mate");\nrequireText("sim/lan_vs.mjs","PROXIMITY_CELL_M=800","nearby phones must have an automatic GPS-proximity discovery path independent of WAN identity");\nrequireText("sim/lan_vs.mjs","ipv6p64:","same-WLAN discovery must normalize IPv6 privacy addresses to their shared /64 prefix");\nrequireText("sim/real_world_bootstrap.mjs","discoveryRoomKeys(deviceCoords)","FIND MATE must use proximity plus network candidate discovery instead of one WAN room");\n'''
assert anchor in s
s=s.replace(anchor,anchor+extra,1)
p.write_text(s)
