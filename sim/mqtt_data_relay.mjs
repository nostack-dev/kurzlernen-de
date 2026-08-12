import mqtt from "mqtt";

const BROKERS=[
  "wss://public.cloud.shiftr.io",
  "wss://test.mosquitto.org:8081/mqtt",
  "wss://broker.emqx.io:8084/mqtt"
];
const PROTOCOL_VERSION=2;
const HELLO_MS=1000;
const HEARTBEAT_MS=5000;
const CONNECT_ERROR_MS=18000;
const MAX_PACKET_BYTES=32768;
const MAX_SEEN=1024;
const roomsByTopic=new Map();
const brokerStates=new Map(BROKERS.map(url=>[url,{readyState:0,error:""}]));
let clients=null;

function clean(value){return String(value||"").replace(/[^a-zA-Z0-9_.-]/g,"_").slice(0,128);}
function randomId(){try{return globalThis.crypto?.randomUUID?.().replaceAll("-","")||randomBytes();}catch{return randomBytes();}}
function randomBytes(){const bytes=new Uint8Array(16);try{globalThis.crypto?.getRandomValues?.(bytes);}catch{for(let i=0;i<bytes.length;i++)bytes[i]=Math.floor(Math.random()*256);}return [...bytes].map(v=>v.toString(16).padStart(2,"0")).join("");}
function packetId(){return `${Date.now().toString(36)}-${randomId().slice(0,12)}`;}
function parsePayload(payload){
  try{const text=typeof payload==="string"?payload:new TextDecoder().decode(payload);if(text.length>MAX_PACKET_BYTES)return null;const value=JSON.parse(text);return value&&value.v===PROTOCOL_VERSION&&typeof value.id==="string"&&typeof value.kind==="string"?value:null;}catch{return null;}
}
function packetQos(packet){return packet?.kind==="sealed"&&packet?.fast?0:1;}
function statusObject(url){return brokerStates.get(url)||{readyState:3,error:"missing"};}
export function getRelaySockets(){return Object.fromEntries(BROKERS.map(url=>[url,{...statusObject(url)}]));}
function bytesToBase64(bytes){let raw="";for(let i=0;i<bytes.length;i++)raw+=String.fromCharCode(bytes[i]);return btoa(raw);}
function base64ToBytes(value){const raw=atob(String(value||"")),out=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);return out;}
async function generateIdentity(){
  const subtle=globalThis.crypto?.subtle;if(!subtle)throw Error("WebCrypto unavailable for VS relay encryption");
  const pair=await subtle.generateKey({name:"ECDH",namedCurve:"P-256"},true,["deriveKey"]),publicJwk=await subtle.exportKey("jwk",pair.publicKey);return{pair,publicJwk};
}
async function derivePeerKey(privateKey,publicJwk){
  const subtle=globalThis.crypto?.subtle;if(!subtle)throw Error("WebCrypto unavailable for VS relay encryption");
  const peerPublic=await subtle.importKey("jwk",publicJwk,{name:"ECDH",namedCurve:"P-256"},false,[]);
  return subtle.deriveKey({name:"ECDH",public:peerPublic},privateKey,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
}
async function seal(key,value){
  const iv=globalThis.crypto.getRandomValues(new Uint8Array(12)),plain=new TextEncoder().encode(JSON.stringify(value)),cipher=new Uint8Array(await globalThis.crypto.subtle.encrypt({name:"AES-GCM",iv},key,plain));
  return{iv:bytesToBase64(iv),box:bytesToBase64(cipher)};
}
async function openSealed(key,iv,box){
  const plain=await globalThis.crypto.subtle.decrypt({name:"AES-GCM",iv:base64ToBytes(iv)},key,base64ToBytes(box));return JSON.parse(new TextDecoder().decode(plain));
}

function ensureClients(){
  if(clients)return clients;
  clients=BROKERS.map((url,index)=>{
    const state=statusObject(url);
    const auth=url==="wss://public.cloud.shiftr.io"?{username:"public",password:"public"}:{};
    const client=mqtt.connect(url,{...auth,forceNativeWebSocket:true,clientId:`a45-${randomId().slice(0,12)}${index}`,clean:true,reconnectPeriod:1200,connectTimeout:10000,keepalive:20,protocolVersion:4,resubscribe:true});
    client.on("connect",()=>{
      state.readyState=1;state.error="";
      for(const [topic,set] of roomsByTopic)client.subscribe(topic,{qos:1},error=>{if(error){state.error=String(error?.message||error);return;}for(const room of set)room._announce();});
    });
    client.on("reconnect",()=>{state.readyState=0;});
    client.on("offline",()=>{state.readyState=0;});
    client.on("close",()=>{state.readyState=3;});
    client.on("error",error=>{state.error=String(error?.message||error||"broker error");if(!client.connected)state.readyState=0;});
    client.on("message",(topic,payload)=>{const packet=parsePayload(payload);if(!packet)return;const set=roomsByTopic.get(topic);if(!set)return;for(const room of [...set])room._receive(packet);});
    return{url,client};
  });
  return clients;
}
function subscribeRoom(room){
  let set=roomsByTopic.get(room.topic);if(!set){set=new Set();roomsByTopic.set(room.topic,set);}set.add(room);
  for(const {client,url} of ensureClients())if(client.connected)client.subscribe(room.topic,{qos:1},error=>{const state=statusObject(url);if(error){state.error=String(error?.message||error);return;}room._announce();});
}
function closeClientsIfIdle(){
  if(roomsByTopic.size||!clients)return;const closing=clients;clients=null;
  for(const {client,url} of closing){const state=statusObject(url);try{client.end(true,{},()=>{});}catch{}state.readyState=3;}
}
function unsubscribeRoom(room){
  const set=roomsByTopic.get(room.topic);if(!set)return;set.delete(room);if(set.size)return;roomsByTopic.delete(room.topic);
  for(const {client} of clients||[])if(client.connected)client.unsubscribe(room.topic,()=>{});closeClientsIfIdle();
}
function publish(topic,packet){
  const text=JSON.stringify(packet);if(text.length>MAX_PACKET_BYTES)return Promise.reject(Error("VS broker packet too large"));
  const open=(clients||ensureClients()).filter(({client})=>client.connected);if(!open.length)return Promise.reject(Error("VS broker relay not connected"));
  const qos=packetQos(packet);
  return Promise.allSettled(open.map(({client})=>new Promise((resolve,reject)=>client.publish(topic,text,{qos,retain:false},error=>error?reject(error):resolve())))).then(results=>{if(results.every(result=>result.status==="rejected"))throw results[0].reason||Error("VS broker relay publish failed");});
}
function fakePeer(){return{connectionState:"connected",iceConnectionState:"broker-relay-e2ee",iceGatheringState:"complete",signalingState:"stable",addEventListener(){},getStats:async()=>new Map()};}

class RelayRoom{
  constructor(config,roomId,callbacks={}){
    this.appId=clean(config?.appId||"app");this.roomId=clean(roomId);this.topic=`arondight45/vs-data/v1/${this.appId}/${this.roomId}`;
    this.id=randomId();this.actions=new Map();this.peers=new Set();this.peerKeys=new Map();this.peerPublicKeys=new Map();this.seen=new Set();this.pendingPings=new Map();this.closed=false;this._onPeerJoin=null;this._onPeerLeave=null;this.onJoinError=callbacks?.onJoinError;
    this.cryptoReady=generateIdentity().then(identity=>{this.identity=identity;return identity;}).catch(error=>{this.onJoinError?.({peerId:"",error});throw error;});
    subscribeRoom(this);
    this.helloTimer=setInterval(()=>this._announce(),HELLO_MS);this.heartbeatTimer=setInterval(()=>this._announce(),HEARTBEAT_MS);
    this.errorTimer=setTimeout(()=>{if(!this.closed&&!this.peers.size&&!(clients||[]).some(({client})=>client.connected))this.onJoinError?.({peerId:"",error:Error("MQTT data relay brokers unavailable")});},CONNECT_ERROR_MS);
    queueMicrotask(()=>this._announce());
  }
  set onPeerJoin(fn){this._onPeerJoin=typeof fn==="function"?fn:null;if(this._onPeerJoin)for(const peerId of this.peers)queueMicrotask(()=>this._onPeerJoin?.(peerId));}
  get onPeerJoin(){return this._onPeerJoin;}
  set onPeerLeave(fn){this._onPeerLeave=typeof fn==="function"?fn:null;}
  get onPeerLeave(){return this._onPeerLeave;}
  _base(kind,target=""){return{v:PROTOCOL_VERSION,kind,id:this.id,msgId:packetId(),target:String(target||""),ts:Date.now()};}
  _announce(){if(this.closed)return;this.cryptoReady.then(()=>publish(this.topic,{...this._base("hello"),key:this.identity.publicJwk})).catch(()=>{});}
  _remember(msgId){if(!msgId||this.seen.has(msgId))return false;this.seen.add(msgId);if(this.seen.size>MAX_SEEN)this.seen.delete(this.seen.values().next().value);return true;}
  async _adopt(peerId,publicJwk){
    if(!peerId||peerId===this.id)return;
    if(this.peers.has(peerId)){if(publicJwk&&!this.peerPublicKeys.has(peerId))this.peerPublicKeys.set(peerId,publicJwk);return;}
    if(!publicJwk||typeof publicJwk!=="object")return;
    await this.cryptoReady;
    const key=await derivePeerKey(this.identity.pair.privateKey,publicJwk);
    if(this.closed)return;
    this.peerPublicKeys.set(peerId,publicJwk);this.peerKeys.set(peerId,key);this.peers.add(peerId);this._onPeerJoin?.(peerId);
    publish(this.topic,{...this._base("hello",peerId),key:this.identity.publicJwk}).catch(()=>{});
  }
  _receive(packet){this._receiveAsync(packet).catch(error=>this.onJoinError?.({peerId:String(packet?.id||""),error}));}
  async _receiveAsync(packet){
    if(this.closed||packet.id===this.id||!this._remember(packet.msgId))return;if(packet.target&&packet.target!==this.id)return;
    if(packet.kind==="hello"){await this._adopt(packet.id,packet.key);return;}
    if(packet.kind==="bye"){if(this.peers.delete(packet.id))this._onPeerLeave?.(packet.id);this.peerKeys.delete(packet.id);this.peerPublicKeys.delete(packet.id);return;}
    if(!this.peers.has(packet.id))return;
    if(packet.kind==="sealed"){
      const key=this.peerKeys.get(packet.id);if(!key)return;
      const payload=await openSealed(key,packet.iv,packet.box);this.actions.get(String(payload?.action||""))?.onMessage?.(payload?.data,{peerId:packet.id});
    }else if(packet.kind==="ping")publish(this.topic,{...this._base("pong",packet.id),nonce:packet.nonce}).catch(()=>{});
    else if(packet.kind==="pong"){const pending=this.pendingPings.get(packet.nonce);if(pending){this.pendingPings.delete(packet.nonce);pending.resolve(performance.now()-pending.started);}}
  }
  async _sendAction(action,data,target){
    const targets=target?[String(target)]:[...this.peers];if(!targets.length)throw Error("VS broker peer unavailable");
    const results=await Promise.allSettled(targets.map(async peerId=>{
      const key=this.peerKeys.get(peerId);if(!key)throw Error("VS broker encryption key unavailable");
      const encrypted=await seal(key,{action,data});return publish(this.topic,{...this._base("sealed",peerId),fast:action==="pose",...encrypted});
    }));
    if(results.every(result=>result.status==="rejected"))throw results[0].reason||Error("VS broker encrypted send failed");
  }
  makeAction(name){const key=String(name||"");const action={onMessage:null,send:(data,{target}={})=>this._sendAction(key,data,target)};this.actions.set(key,action);return action;}
  getPeers(){return Object.fromEntries([...this.peers].map(peerId=>[peerId,fakePeer()]));}
  ping(peerId){
    if(!this.peers.has(peerId))return Promise.reject(Error("VS broker peer unavailable"));
    const nonce=packetId();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pendingPings.delete(nonce);reject(Error("VS broker ping timeout"));},3000);this.pendingPings.set(nonce,{started:performance.now(),resolve:value=>{clearTimeout(timer);resolve(value);}});publish(this.topic,{...this._base("ping",peerId),nonce}).catch(error=>{clearTimeout(timer);this.pendingPings.delete(nonce);reject(error);});});
  }
  leave(){
    if(this.closed)return;this.closed=true;clearInterval(this.helloTimer);clearInterval(this.heartbeatTimer);clearTimeout(this.errorTimer);
    publish(this.topic,this._base("bye")).catch(()=>{});unsubscribeRoom(this);for(const {resolve} of this.pendingPings.values())resolve(NaN);this.pendingPings.clear();this.peers.clear();this.peerKeys.clear();this.peerPublicKeys.clear();
  }
}

export function joinRoom(config,roomId,callbacks={}){const id=String(roomId||"");if(!/^(?:net|tap)-/.test(id))throw Error("MQTT data relay requires an automatic network/proximity/gesture room");return new RelayRoom(config,id,callbacks);}
