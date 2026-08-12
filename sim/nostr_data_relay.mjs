import {SimplePool} from "nostr-tools/pool";
import {finalizeEvent,generateSecretKey} from "nostr-tools/pure";

const RELAYS=[
  "wss://relay-rpi.edufeed.org",
  "wss://relay2.angor.io",
  "wss://top.testrelay.top",
  "wss://relay.primal.net"
];
const EVENT_KIND=25045;
const PROTOCOL_VERSION=1;
const HELLO_MS=1000;
const HEARTBEAT_MS=5000;
const PEER_TIMEOUT_MS=16000;
const CONNECT_ERROR_MS=12000;
const MAX_PACKET_BYTES=32768;
const MAX_SEEN=2048;
const rooms=new Set();
const relayStates=new Map(RELAYS.map(url=>[url,{readyState:0,error:""}]));
let pool=null;
let signerKey=null;

function clean(value){return String(value||"").replace(/[^a-zA-Z0-9_.-]/g,"_").slice(0,128);}
function randomId(){try{return globalThis.crypto?.randomUUID?.().replaceAll("-","")||randomBytes();}catch{return randomBytes();}}
function randomBytes(){const bytes=new Uint8Array(16);try{globalThis.crypto?.getRandomValues?.(bytes);}catch{for(let i=0;i<bytes.length;i++)bytes[i]=Math.floor(Math.random()*256);}return [...bytes].map(v=>v.toString(16).padStart(2,"0")).join("");}
function packetId(){return `${Date.now().toString(36)}-${randomId().slice(0,12)}`;}
function emitNetwork(stage,detail={}){try{if(typeof globalThis.dispatchEvent==="function"&&typeof globalThis.CustomEvent==="function")globalThis.dispatchEvent(new CustomEvent("arondight45:vs-network",{detail:{at:new Date().toISOString(),stage,transport:"NostrRelay",...detail}}));}catch{}}
function statusObject(url){return relayStates.get(url)||{readyState:3,error:"missing"};}
function refreshRelayStates(){
  try{const status=pool?.listConnectionStatus?.();if(status)for(const url of RELAYS){const connected=Boolean(status.get(url)||status.get(`${url}/`));const state=statusObject(url);if(connected){state.readyState=1;state.error="";}else if(state.readyState===1)state.readyState=0;}}catch{}
}
export function getRelaySockets(){refreshRelayStates();return Object.fromEntries(RELAYS.map(url=>[url,{...statusObject(url)}]));}
function ensurePool(){
  if(pool)return pool;
  pool=new SimplePool({enablePing:true,enableReconnect:true});
  pool.onRelayConnectionSuccess=url=>{const state=statusObject(String(url).replace(/\/$/,""));state.readyState=1;state.error="";emitNetwork("nostr-relay-open",{relay:String(url)});};
  pool.onRelayConnectionFailure=url=>{const normalized=String(url).replace(/\/$/,""),state=statusObject(normalized);state.readyState=3;state.error="connection failure";emitNetwork("nostr-relay-error",{relay:String(url),error:state.error});};
  signerKey=generateSecretKey();
  return pool;
}
function closePoolIfIdle(){if(rooms.size||!pool)return;try{pool.close(RELAYS);}catch{}try{pool.destroy?.();}catch{}pool=null;signerKey=null;for(const state of relayStates.values()){state.readyState=3;state.error="";}}
function bytesToBase64(bytes){let raw="";for(let i=0;i<bytes.length;i++)raw+=String.fromCharCode(bytes[i]);return btoa(raw);}
function base64ToBytes(value){const raw=atob(String(value||"")),out=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);return out;}
async function generateIdentity(){
  const subtle=globalThis.crypto?.subtle;if(!subtle)throw Error("WebCrypto unavailable for Nostr VS relay encryption");
  const pair=await subtle.generateKey({name:"ECDH",namedCurve:"P-256"},true,["deriveKey"]),publicJwk=await subtle.exportKey("jwk",pair.publicKey);return{pair,publicJwk};
}
async function derivePeerKey(privateKey,publicJwk){
  const subtle=globalThis.crypto?.subtle;if(!subtle)throw Error("WebCrypto unavailable for Nostr VS relay encryption");
  const peerPublic=await subtle.importKey("jwk",publicJwk,{name:"ECDH",namedCurve:"P-256"},false,[]);
  return subtle.deriveKey({name:"ECDH",public:peerPublic},privateKey,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
}
async function seal(key,value){const iv=globalThis.crypto.getRandomValues(new Uint8Array(12)),plain=new TextEncoder().encode(JSON.stringify(value)),cipher=new Uint8Array(await globalThis.crypto.subtle.encrypt({name:"AES-GCM",iv},key,plain));return{iv:bytesToBase64(iv),box:bytesToBase64(cipher)};}
async function openSealed(key,iv,box){const plain=await globalThis.crypto.subtle.decrypt({name:"AES-GCM",iv:base64ToBytes(iv)},key,base64ToBytes(box));return JSON.parse(new TextDecoder().decode(plain));}
function parseEvent(event){try{const text=String(event?.content||"");if(text.length>MAX_PACKET_BYTES)return null;const value=JSON.parse(text);return value&&value.v===PROTOCOL_VERSION&&typeof value.id==="string"&&typeof value.kind==="string"?value:null;}catch{return null;}}
function fakePeer(){return{connectionState:"connected",iceConnectionState:"nostr-relay-e2ee",iceGatheringState:"complete",signalingState:"stable",addEventListener(){},getStats:async()=>new Map()};}

class NostrRelayRoom{
  constructor(config,roomId,callbacks={}){
    this.appId=clean(config?.appId||"app");this.roomId=clean(roomId);this.tag=`a45-vs-${this.appId}-${this.roomId}`;
    this.id=randomId();this.actions=new Map();this.peers=new Set();this.peerKeys=new Map();this.peerPublicKeys=new Map();this.peerSeen=new Map();this.seen=new Set();this.pendingPings=new Map();this.closed=false;this._onPeerJoin=null;this._onPeerLeave=null;this.onJoinError=callbacks?.onJoinError;this.preferredRelay="";
    this.cryptoReady=generateIdentity().then(identity=>{this.identity=identity;return identity;}).catch(error=>{this.onJoinError?.({peerId:"",error});throw error;});
    const p=ensurePool();rooms.add(this);
    this.subscription=p.subscribe(RELAYS,{kinds:[EVENT_KIND],"#t":[this.tag],since:Math.floor(Date.now()/1000)-5},{
      onevent:event=>{const packet=parseEvent(event);if(packet)this._receive(packet);},
      onclose:items=>{for(const item of items||[]){const url=String(item?.url||"").replace(/\/$/,""),state=statusObject(url);state.readyState=3;state.error=String(item?.reason||"subscription closed");emitNetwork("nostr-relay-subscription-close",{relay:url,error:state.error,roomId:this.roomId});}}
    });
    this.helloTimer=setInterval(()=>this._announce(),HELLO_MS);this.heartbeatTimer=setInterval(()=>this._announce(),HEARTBEAT_MS);this.sweepTimer=setInterval(()=>this._sweepPeers(),5000);
    this.errorTimer=setTimeout(()=>{if(!this.closed&&!this.peers.size&&!Object.values(getRelaySockets()).some(state=>state.readyState===1)){const error=Error("Nostr data relays unavailable");emitNetwork("nostr-relays-unavailable",{roomId:this.roomId,relays:getRelaySockets()});this.onJoinError?.({peerId:"",error});}},CONNECT_ERROR_MS);
    queueMicrotask(()=>this._announce());
  }
  set onPeerJoin(fn){this._onPeerJoin=typeof fn==="function"?fn:null;if(this._onPeerJoin)for(const peerId of this.peers)queueMicrotask(()=>this._onPeerJoin?.(peerId));}
  get onPeerJoin(){return this._onPeerJoin;}
  set onPeerLeave(fn){this._onPeerLeave=typeof fn==="function"?fn:null;}
  get onPeerLeave(){return this._onPeerLeave;}
  _base(kind,target=""){return{v:PROTOCOL_VERSION,kind,id:this.id,msgId:packetId(),target:String(target||""),ts:Date.now()};}
  _remember(msgId){if(!msgId||this.seen.has(msgId))return false;this.seen.add(msgId);if(this.seen.size>MAX_SEEN)this.seen.delete(this.seen.values().next().value);return true;}
  _touch(peerId){if(peerId)this.peerSeen.set(peerId,Date.now());}
  _sweepPeers(){const now=Date.now();for(const peerId of [...this.peers])if(now-(this.peerSeen.get(peerId)||0)>PEER_TIMEOUT_MS){this.peers.delete(peerId);this.peerSeen.delete(peerId);this.peerKeys.delete(peerId);this.peerPublicKeys.delete(peerId);this._onPeerLeave?.(peerId);emitNetwork("nostr-relay-peer-timeout",{peerId,roomId:this.roomId});}}
  async _publish(packet,fast=false){
    if(this.closed)throw Error("Nostr data relay room closed");
    const text=JSON.stringify(packet);if(text.length>MAX_PACKET_BYTES)throw Error("Nostr VS relay packet too large");
    const p=ensurePool(),event=finalizeEvent({kind:EVENT_KIND,created_at:Math.floor(Date.now()/1000),tags:[["t",this.tag],["expiration",String(Math.floor(Date.now()/1000)+30)]],content:text},signerKey);
    const targets=fast&&this.preferredRelay?[this.preferredRelay]:RELAYS;
    const attempts=targets.map(url=>p.publish([url],event,{maxWait:2500})[0].then(()=>{const normalized=url.replace(/\/$/,""),state=statusObject(normalized);state.readyState=1;state.error="";this.preferredRelay=normalized;return normalized;}).catch(error=>{const normalized=url.replace(/\/$/,""),state=statusObject(normalized);state.readyState=3;state.error=String(error?.message||error||"publish failed");throw error;}));
    try{return await Promise.any(attempts);}catch(error){if(fast&&this.preferredRelay){this.preferredRelay="";return this._publish(packet,false);}throw error;}
  }
  _announce(){if(this.closed)return;this.cryptoReady.then(()=>this._publish({...this._base("hello"),key:this.identity.publicJwk},false)).catch(()=>{});}
  async _adopt(peerId,publicJwk){
    if(!peerId||peerId===this.id)return;this._touch(peerId);
    if(this.peers.has(peerId)){if(publicJwk&&!this.peerPublicKeys.has(peerId))this.peerPublicKeys.set(peerId,publicJwk);return;}
    if(!publicJwk||typeof publicJwk!=="object")return;await this.cryptoReady;
    const key=await derivePeerKey(this.identity.pair.privateKey,publicJwk);if(this.closed)return;
    this.peerPublicKeys.set(peerId,publicJwk);this.peerKeys.set(peerId,key);this.peers.add(peerId);this._touch(peerId);clearTimeout(this.errorTimer);this._onPeerJoin?.(peerId);emitNetwork("nostr-relay-peer-join",{peerId,roomId:this.roomId,relay:this.preferredRelay});
    this._publish({...this._base("hello",peerId),key:this.identity.publicJwk},false).catch(()=>{});
  }
  _receive(packet){this._receiveAsync(packet).catch(error=>this.onJoinError?.({peerId:String(packet?.id||""),error}));}
  async _receiveAsync(packet){
    if(this.closed||packet.id===this.id||!this._remember(packet.msgId))return;if(packet.target&&packet.target!==this.id)return;this._touch(packet.id);
    if(packet.kind==="hello"){await this._adopt(packet.id,packet.key);return;}
    if(packet.kind==="bye"){if(this.peers.delete(packet.id))this._onPeerLeave?.(packet.id);this.peerSeen.delete(packet.id);this.peerKeys.delete(packet.id);this.peerPublicKeys.delete(packet.id);return;}
    if(!this.peers.has(packet.id))return;
    if(packet.kind==="sealed"){
      const key=this.peerKeys.get(packet.id);if(!key)return;const payload=await openSealed(key,packet.iv,packet.box);this.actions.get(String(payload?.action||""))?.onMessage?.(payload?.data,{peerId:packet.id});
    }else if(packet.kind==="ping")this._publish({...this._base("pong",packet.id),nonce:packet.nonce},false).catch(()=>{});
    else if(packet.kind==="pong"){const pending=this.pendingPings.get(packet.nonce);if(pending){this.pendingPings.delete(packet.nonce);pending.resolve(performance.now()-pending.started);}}
  }
  async _sendAction(action,data,target){
    const targets=target?[String(target)]:[...this.peers];if(!targets.length)throw Error("Nostr VS relay peer unavailable");
    const results=await Promise.allSettled(targets.map(async peerId=>{const key=this.peerKeys.get(peerId);if(!key)throw Error("Nostr VS relay encryption key unavailable");const encrypted=await seal(key,{action,data});return this._publish({...this._base("sealed",peerId),fast:action==="pose",...encrypted},action==="pose");}));
    if(results.every(result=>result.status==="rejected"))throw results[0].reason||Error("Nostr VS relay encrypted send failed");
  }
  makeAction(name){const key=String(name||"");const action={onMessage:null,send:(data,{target}={})=>this._sendAction(key,data,target)};this.actions.set(key,action);return action;}
  getPeers(){return Object.fromEntries([...this.peers].map(peerId=>[peerId,fakePeer()]));}
  ping(peerId){
    if(!this.peers.has(peerId))return Promise.reject(Error("Nostr VS relay peer unavailable"));
    const nonce=packetId();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pendingPings.delete(nonce);reject(Error("Nostr VS relay ping timeout"));},4000);this.pendingPings.set(nonce,{started:performance.now(),resolve:value=>{clearTimeout(timer);resolve(value);}});this._publish({...this._base("ping",peerId),nonce},false).catch(error=>{clearTimeout(timer);this.pendingPings.delete(nonce);reject(error);});});
  }
  leave(){
    if(this.closed)return;this.closed=true;clearInterval(this.helloTimer);clearInterval(this.heartbeatTimer);clearInterval(this.sweepTimer);clearTimeout(this.errorTimer);this._publish(this._base("bye"),false).catch(()=>{});try{this.subscription?.close?.("room leave");}catch{}rooms.delete(this);for(const {resolve} of this.pendingPings.values())resolve(NaN);this.pendingPings.clear();this.peers.clear();this.peerKeys.clear();this.peerPublicKeys.clear();this.peerSeen.clear();closePoolIfIdle();
  }
}

export function joinRoom(config,roomId,callbacks={}){const id=String(roomId||"");if(!/^(?:net|tap)-/.test(id))throw Error("Nostr data relay requires an automatic network/proximity/gesture room");return new NostrRelayRoom(config,id,callbacks);}
