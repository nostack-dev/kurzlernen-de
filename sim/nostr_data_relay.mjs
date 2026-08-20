import {SimplePool} from "nostr-tools/pool";
import {finalizeEvent,generateSecretKey,verifyEvent} from "nostr-tools/pure";
import {DirectUdpPeer} from "./direct_udp_peer.mjs";

const RELAYS=[
  "wss://relay-rpi.edufeed.org",
  "wss://relay2.angor.io",
  "wss://top.testrelay.top",
  "wss://relay.primal.net"
];
const EVENT_KIND=25045;
const PROTOCOL_VERSION=5;
const HELLO_MS=1000;
const HEARTBEAT_MS=5000;
const CONNECT_ERROR_MS=15000;
const SIGNAL_FRESH_MS=10000;
const PROBE_TTL_MS=4000;
const MAX_PACKET_BYTES=32768;
const MAX_SEEN=4096;
const MAX_PEERS=8;
const rooms=new Set();
const relayStates=new Map(RELAYS.map(url=>[url,{readyState:0,error:""}]));
let pool=null;
let signerKey=null;

function clean(value){return String(value||"").replace(/[^a-zA-Z0-9_.-]/g,"_").slice(0,128);}
function randomId(){try{return globalThis.crypto?.randomUUID?.().replaceAll("-","")||randomBytes();}catch{return randomBytes();}}
function randomBytes(){const bytes=new Uint8Array(16);try{globalThis.crypto?.getRandomValues?.(bytes);}catch{for(let i=0;i<bytes.length;i++)bytes[i]=Math.floor(Math.random()*256);}return [...bytes].map(v=>v.toString(16).padStart(2,"0")).join("");}
function packetId(){return `${Date.now().toString(36)}-${randomId().slice(0,12)}`;}
function errorText(error){return String(error?.message||error||"unknown error");}
function emitNetwork(stage,detail={}){try{if(typeof globalThis.dispatchEvent==="function"&&typeof globalThis.CustomEvent==="function")globalThis.dispatchEvent(new CustomEvent("arondight45:vs-network",{detail:{at:new Date().toISOString(),stage,transport:"DirectP2PUDP",...detail}}));}catch{}}
function statusObject(url){return relayStates.get(url)||{readyState:3,error:"missing"};}
function refreshRelayStates(){try{const status=pool?.listConnectionStatus?.();if(status)for(const url of RELAYS){const connected=Boolean(status.get(url)||status.get(`${url}/`)),state=statusObject(url);if(connected){state.readyState=1;state.error="";}else if(state.readyState===1)state.readyState=0;}}catch{}}
export function getRelaySockets(){refreshRelayStates();return Object.fromEntries(RELAYS.map(url=>[url,{...statusObject(url)}]));}
function ensurePool(){if(pool)return pool;pool=new SimplePool({enablePing:true,enableReconnect:true});pool.onRelayConnectionSuccess=url=>{const normalized=String(url).replace(/\/$/,""),state=statusObject(normalized);state.readyState=1;state.error="";emitNetwork("signal-relay-open",{relay:normalized});};pool.onRelayConnectionFailure=url=>{const normalized=String(url).replace(/\/$/,""),state=statusObject(normalized);state.readyState=3;state.error="connection failure";emitNetwork("signal-relay-error",{relay:normalized,error:state.error});};signerKey=generateSecretKey();return pool;}
function closePoolIfIdle(){if(rooms.size||!pool)return;try{pool.close(RELAYS);}catch{}try{pool.destroy?.();}catch{}pool=null;signerKey=null;for(const state of relayStates.values()){state.readyState=3;state.error="";}}
function parseEvent(event){try{if(!event||!verifyEvent(event))return null;const text=String(event.content||"");if(text.length>MAX_PACKET_BYTES)return null;const value=JSON.parse(text),ts=Number(value?.ts);if(!value||value.v!==PROTOCOL_VERSION||typeof value.id!=="string"||typeof value.kind!=="string"||!Number.isFinite(ts))return null;const age=Date.now()-ts;if(age>SIGNAL_FRESH_MS||age< -5000)return null;return{...value,_pubkey:String(event.pubkey||"")};}catch{return null;}}
function signalPayload(signal){const out={};for(const [key,value] of Object.entries(signal||{}))if(key!=="kind")out[key]=value;return out;}

class DirectUdpRoom{
  constructor(config,roomId,callbacks={}){
    this.config=config||{};this.appId=clean(config?.appId||"app");this.roomId=clean(roomId);this.tag=`a45-vs-p2p5-${this.appId}-${this.roomId}`;this.id=randomId();this.peers=new Map();this.actions=new Map();this.pendingProbes=new Map();this.seen=new Set();this.closed=false;this._onPeerJoin=null;this._onPeerLeave=null;this.onJoinError=callbacks?.onJoinError;this.helloTimer=0;this.heartbeatTimer=0;this.errorTimer=0;
    const p=ensurePool();rooms.add(this);this.subscription=p.subscribe(RELAYS,{kinds:[EVENT_KIND],"#t":[this.tag],since:Math.floor(Date.now()/1000)-3},{onevent:event=>{const packet=parseEvent(event);if(packet)this._receiveSignal(packet);},onclose:items=>{for(const item of items||[]){const url=String(item?.url||"").replace(/\/$/,""),state=statusObject(url);state.readyState=3;state.error=String(item?.reason||"subscription closed");emitNetwork("signal-subscription-close",{relay:url,error:state.error,roomId:this.roomId});}}});this._armDiscovery();
  }
  get peerId(){return this.readyPeerIds()[0]||"";}
  get ready(){return this.readyPeerIds().length>0;}
  set onPeerJoin(fn){this._onPeerJoin=typeof fn==="function"?fn:null;if(this._onPeerJoin)for(const peerId of this.readyPeerIds())queueMicrotask(()=>this._onPeerJoin?.(peerId));}
  get onPeerJoin(){return this._onPeerJoin;}
  set onPeerLeave(fn){this._onPeerLeave=typeof fn==="function"?fn:null;}
  get onPeerLeave(){return this._onPeerLeave;}
  readyPeerIds(){return [...this.peers].filter(([,entry])=>entry.ready).map(([peerId])=>peerId).sort();}
  getSelfId(){return this.id;}
  getAuthorityId(){return [this.id,...this.readyPeerIds()].sort()[0]||this.id;}
  _base(kind,target=""){return{v:PROTOCOL_VERSION,kind,id:this.id,msgId:packetId(),target:String(target||""),ts:Date.now()};}
  _remember(msgId){if(!msgId||this.seen.has(msgId))return false;this.seen.add(msgId);if(this.seen.size>MAX_SEEN)this.seen.delete(this.seen.values().next().value);return true;}
  _armDiscovery(){if(this.closed)return;clearInterval(this.helloTimer);clearInterval(this.heartbeatTimer);clearTimeout(this.errorTimer);this.helloTimer=setInterval(()=>this._announce(),HELLO_MS);this.heartbeatTimer=setInterval(()=>this._announce(),HEARTBEAT_MS);this.errorTimer=setTimeout(()=>{if(this.closed||this.ready)return;const error=Error("Direct UDP peers not found");emitNetwork("direct-udp-timeout",{roomId:this.roomId,peerCount:this.readyPeerIds().length,relays:getRelaySockets()});this.onJoinError?.({peerId:"",error});},CONNECT_ERROR_MS);queueMicrotask(()=>this._announce());}
  _stopDiscoveryTimers(){clearInterval(this.helloTimer);clearInterval(this.heartbeatTimer);clearTimeout(this.errorTimer);this.helloTimer=0;this.heartbeatTimer=0;this.errorTimer=0;}
  async _publishSignal(packet){if(this.closed)throw Error("Direct UDP signaling room closed");const text=JSON.stringify(packet);if(text.length>MAX_PACKET_BYTES)throw Error("Direct UDP signaling packet too large");const p=ensurePool(),event=finalizeEvent({kind:EVENT_KIND,created_at:Math.floor(Date.now()/1000),tags:[["t",this.tag],["expiration",String(Math.floor(Date.now()/1000)+30)]],content:text},signerKey),attempts=RELAYS.map(url=>p.publish([url],event,{maxWait:2500})[0].then(()=>{const normalized=url.replace(/\/$/,""),state=statusObject(normalized);state.readyState=1;state.error="";return normalized;}).catch(error=>{const normalized=url.replace(/\/$/,""),state=statusObject(normalized);state.readyState=3;state.error=errorText(error);throw error;}));return Promise.any(attempts);}
  _announce(){if(this.closed||this.peers.size>=MAX_PEERS)return;this._publishSignal(this._base("hello")).catch(()=>{});}
  _probe(peerId,pubkey){if(this.closed||this.peers.has(peerId)||this.peers.size>=MAX_PEERS||!peerId||peerId===this.id||!pubkey)return;const previous=this.pendingProbes.get(peerId),now=Date.now();if(previous&&previous.pubkey===pubkey&&now-previous.at<PROBE_TTL_MS)return;const nonce=packetId();this.pendingProbes.set(peerId,{nonce,pubkey,at:now});for(const [id,probe] of this.pendingProbes)if(now-probe.at>PROBE_TTL_MS)this.pendingProbes.delete(id);this._publishSignal({...this._base("probe",peerId),nonce}).catch(()=>{});emitNetwork("signal-probe",{roomId:this.roomId,peerId});}
  _receiveSignal(packet){this._receiveSignalAsync(packet).catch(error=>{emitNetwork("signal-handle-error",{roomId:this.roomId,peerId:String(packet?.id||""),error:errorText(error)});this.onJoinError?.({peerId:String(packet?.id||""),error});});}
  async _receiveSignalAsync(packet){if(this.closed||packet.id===this.id||!packet._pubkey||!this._remember(packet.msgId))return;if(packet.target&&packet.target!==this.id)return;
    if(packet.kind==="hello"){if(!this.peers.has(packet.id))this._probe(packet.id,packet._pubkey);return;}
    if(packet.kind==="probe"){if(typeof packet.nonce!=="string"||!packet.nonce)return;await this._publishSignal({...this._base("probe-ack",packet.id),nonce:packet.nonce});return;}
    if(packet.kind==="probe-ack"){const probe=this.pendingProbes.get(packet.id);if(this.peers.has(packet.id)||!probe||probe.nonce!==packet.nonce||probe.pubkey!==packet._pubkey||Date.now()-probe.at>PROBE_TTL_MS)return;this.pendingProbes.delete(packet.id);await this._adoptPeer(packet.id,packet._pubkey);return;}
    const entry=this.peers.get(packet.id);if(!entry||packet._pubkey!==entry.pubkey)return;if(packet.kind==="bye"){this._peerGone(packet.id,"signal-bye");return;}if(["description","candidate","restart-needed"].includes(packet.kind))await entry.engine?.handleSignal({kind:packet.kind,...signalPayload(packet)});
  }
  async _adoptPeer(peerId,pubkey){if(this.closed||this.peers.has(peerId)||this.peers.size>=MAX_PEERS||!peerId||!pubkey)return;const entry={pubkey,engine:null,ready:false};this.peers.set(peerId,entry);emitNetwork("mesh-peer-adopting",{roomId:this.roomId,peerId,peerCount:this.peers.size,authorityId:this.getAuthorityId()});const engine=new DirectUdpPeer({localId:this.id,peerId,RTCPeerConnectionCtor:this.config?.RTCPeerConnectionCtor,iceServers:this.config?.iceServers,sendSignal:signal=>this._publishSignal({...this._base(signal.kind,peerId),...signalPayload(signal)}),onReady:()=>{if(this.closed||this.peers.get(peerId)!==entry)return;entry.ready=true;clearTimeout(this.errorTimer);this.errorTimer=0;emitNetwork("direct-udp-ready",{roomId:this.roomId,peerId,peerCount:this.readyPeerIds().length,authorityId:this.getAuthorityId(),role:engine.isHost?"pair-host":"pair-client"});this._onPeerJoin?.(peerId);},onLeave:(_id,reason)=>this._peerGone(peerId,reason||"peer-engine-left"),onAction:(action,data)=>{if(this.closed||this.peers.get(peerId)!==entry||!entry.ready)return;this.actions.get(String(action||""))?.onMessage?.(data,{peerId});},onDiagnostic:detail=>emitNetwork(detail.stage,{roomId:this.roomId,...detail})});entry.engine=engine;try{await engine.start();}catch(error){this._peerGone(peerId,"peer-engine-start-error");throw error;}}
  _peerGone(peerId,reason){if(this.closed||!peerId)return;const entry=this.peers.get(peerId);if(!entry)return;this.peers.delete(peerId);this.pendingProbes.delete(peerId);try{entry.engine?.close?.(reason,false);}catch{}if(entry.ready)this._onPeerLeave?.(peerId);emitNetwork("direct-udp-peer-left",{roomId:this.roomId,peerId,reason,peerCount:this.readyPeerIds().length,authorityId:this.getAuthorityId()});}
  makeAction(name){const key=String(name||"");const action={onMessage:null,send:(data,{target}={})=>{const targetId=String(target||"");if(targetId){const entry=this.peers.get(targetId);if(!entry?.ready||!entry.engine)return Promise.reject(Error("Direct UDP target peer unavailable"));return entry.engine.sendAction(key,data);}const ready=[...this.peers.values()].filter(entry=>entry.ready&&entry.engine);if(!ready.length)return Promise.reject(Error("Direct UDP peers unavailable"));return Promise.all(ready.map(entry=>entry.engine.sendAction(key,data))).then(()=>undefined);}};this.actions.set(key,action);return action;}
  getPeers(){return Object.fromEntries([...this.peers].filter(([,entry])=>entry.ready&&entry.engine?.pc).map(([peerId,entry])=>[peerId,entry.engine.pc]));}
  ping(peerId){const entry=this.peers.get(String(peerId||""));if(!entry?.ready||!entry.engine)return Promise.reject(Error("Direct UDP peer unavailable"));return entry.engine.ping();}
  leave(){if(this.closed)return;const goodbye=Promise.allSettled(this.readyPeerIds().map(peerId=>this._publishSignal(this._base("bye",peerId))));this.closed=true;this._stopDiscoveryTimers();try{this.subscription?.close?.("room leave");}catch{}for(const entry of this.peers.values())try{entry.engine?.close?.("room leave",false);}catch{}this.peers.clear();this.pendingProbes.clear();this.actions.clear();rooms.delete(this);goodbye.finally(()=>closePoolIfIdle());}
}

export function joinRoom(config,roomId,callbacks={}){const id=String(roomId||"");if(!/^(?:net|tap)-/.test(id))throw Error("Direct UDP matchmaking requires an automatic network/proximity/gesture room");return new DirectUdpRoom(config,id,callbacks);}