import mqtt from "mqtt";

const BROKERS=[
  "wss://test.mosquitto.org:8081/mqtt",
  "wss://broker.emqx.io:8084/mqtt",
  "wss://public:public@public.cloud.shiftr.io"
];
const PROTOCOL_VERSION=1;
const HELLO_MS=1000;
const HEARTBEAT_MS=5000;
const CONNECT_ERROR_MS=10000;
const MAX_PACKET_BYTES=32768;
const MAX_SEEN=1024;
const roomsByTopic=new Map();
const brokerStates=new Map(BROKERS.map(url=>[url,{readyState:0,error:""}]));
let clients=null;

function clean(value){return String(value||"").replace(/[^a-zA-Z0-9_.-]/g,"_").slice(0,128);}
function randomId(){
  try{return globalThis.crypto?.randomUUID?.().replaceAll("-","")||randomBytes();}catch{return randomBytes();}
}
function randomBytes(){
  const bytes=new Uint8Array(16);try{globalThis.crypto?.getRandomValues?.(bytes);}catch{for(let i=0;i<bytes.length;i++)bytes[i]=Math.floor(Math.random()*256);}
  return [...bytes].map(v=>v.toString(16).padStart(2,"0")).join("");
}
function packetId(){return `${Date.now().toString(36)}-${randomId().slice(0,12)}`;}
function parsePayload(payload){
  try{
    const text=typeof payload==="string"?payload:new TextDecoder().decode(payload);
    if(text.length>MAX_PACKET_BYTES)return null;
    const value=JSON.parse(text);
    return value&&value.v===PROTOCOL_VERSION&&typeof value.id==="string"&&typeof value.kind==="string"?value:null;
  }catch{return null;}
}
function statusObject(url){return brokerStates.get(url)||{readyState:3,error:"missing"};}
export function getRelaySockets(){return Object.fromEntries(BROKERS.map(url=>[url,{...statusObject(url)}]));}

function ensureClients(){
  if(clients)return clients;
  clients=BROKERS.map((url,index)=>{
    const state=statusObject(url);
    const client=mqtt.connect(url,{clientId:`a45relay-${randomId().slice(0,20)}-${index}`,clean:true,reconnectPeriod:1000,connectTimeout:5000,keepalive:20,protocolVersion:4,resubscribe:true});
    client.on("connect",()=>{
      state.readyState=1;state.error="";
      for(const [topic,set] of roomsByTopic){client.subscribe(topic,{qos:0},error=>{if(error){state.error=String(error?.message||error);return;}for(const room of set)room._announce();});}
    });
    client.on("reconnect",()=>{state.readyState=0;});
    client.on("offline",()=>{state.readyState=0;});
    client.on("close",()=>{state.readyState=3;});
    client.on("error",error=>{state.error=String(error?.message||error||"broker error");if(!client.connected)state.readyState=0;});
    client.on("message",(topic,payload)=>{
      const packet=parsePayload(payload);if(!packet)return;
      const set=roomsByTopic.get(topic);if(!set)return;
      for(const room of [...set])room._receive(packet);
    });
    return{url,client};
  });
  return clients;
}
function subscribeRoom(room){
  let set=roomsByTopic.get(room.topic);if(!set){set=new Set();roomsByTopic.set(room.topic,set);}set.add(room);
  for(const {client,url} of ensureClients())if(client.connected)client.subscribe(room.topic,{qos:0},error=>{const state=statusObject(url);if(error){state.error=String(error?.message||error);return;}room._announce();});
}
function closeClientsIfIdle(){
  if(roomsByTopic.size||!clients)return;
  const closing=clients;clients=null;
  for(const {client,url} of closing){const state=statusObject(url);try{client.end(true,{},()=>{});}catch{}state.readyState=3;}
}
function unsubscribeRoom(room){
  const set=roomsByTopic.get(room.topic);if(!set)return;set.delete(room);
  if(set.size)return;
  roomsByTopic.delete(room.topic);
  for(const {client} of clients||[])if(client.connected)client.unsubscribe(room.topic,()=>{});
  closeClientsIfIdle();
}
function publish(topic,packet){
  const text=JSON.stringify(packet);if(text.length>MAX_PACKET_BYTES)return Promise.reject(Error("VS broker packet too large"));
  const open=(clients||ensureClients()).filter(({client})=>client.connected);
  if(!open.length)return Promise.reject(Error("VS broker relay not connected"));
  return Promise.allSettled(open.map(({client})=>new Promise((resolve,reject)=>client.publish(topic,text,{qos:0,retain:false},error=>error?reject(error):resolve())))).then(results=>{
    if(results.every(result=>result.status==="rejected"))throw results[0].reason||Error("VS broker relay publish failed");
  });
}
function fakePeer(){return{connectionState:"connected",iceConnectionState:"broker-relay",iceGatheringState:"complete",signalingState:"stable",addEventListener(){},getStats:async()=>new Map()};}

class RelayRoom{
  constructor(config,roomId,callbacks={}){
    this.appId=clean(config?.appId||"app");this.roomId=clean(roomId);this.topic=`arondight45/vs-data/v1/${this.appId}/${this.roomId}`;
    this.id=randomId();this.actions=new Map();this.peers=new Set();this.seen=new Set();this.pendingPings=new Map();this.closed=false;this._onPeerJoin=null;this._onPeerLeave=null;this.onJoinError=callbacks?.onJoinError;
    subscribeRoom(this);
    this.helloTimer=setInterval(()=>this._announce(),HELLO_MS);
    this.heartbeatTimer=setInterval(()=>this._announce(),HEARTBEAT_MS);
    this.errorTimer=setTimeout(()=>{if(!this.closed&&!this.peers.size&&!(clients||[]).some(({client})=>client.connected))this.onJoinError?.({peerId:"",error:Error("MQTT data relay brokers unavailable")});},CONNECT_ERROR_MS);
    queueMicrotask(()=>this._announce());
  }
  set onPeerJoin(fn){this._onPeerJoin=typeof fn==="function"?fn:null;if(this._onPeerJoin)for(const peerId of this.peers)queueMicrotask(()=>this._onPeerJoin?.(peerId));}
  get onPeerJoin(){return this._onPeerJoin;}
  set onPeerLeave(fn){this._onPeerLeave=typeof fn==="function"?fn:null;}
  get onPeerLeave(){return this._onPeerLeave;}
  _base(kind,target=""){return{v:PROTOCOL_VERSION,kind,id:this.id,msgId:packetId(),target:String(target||""),ts:Date.now()};}
  _announce(){if(!this.closed)publish(this.topic,this._base("hello")).catch(()=>{});}
  _remember(msgId){if(!msgId||this.seen.has(msgId))return false;this.seen.add(msgId);if(this.seen.size>MAX_SEEN)this.seen.delete(this.seen.values().next().value);return true;}
  _adopt(peerId){if(!peerId||peerId===this.id||this.peers.has(peerId))return;this.peers.add(peerId);this._onPeerJoin?.(peerId);publish(this.topic,this._base("hello",peerId)).catch(()=>{});}
  _receive(packet){
    if(this.closed||packet.id===this.id||!this._remember(packet.msgId))return;
    if(packet.target&&packet.target!==this.id)return;
    if(packet.kind==="hello"){this._adopt(packet.id);return;}
    if(packet.kind==="bye"){if(this.peers.delete(packet.id))this._onPeerLeave?.(packet.id);return;}
    this._adopt(packet.id);
    if(packet.kind==="action")this.actions.get(String(packet.action||""))?.onMessage?.(packet.data,{peerId:packet.id});
    else if(packet.kind==="ping")publish(this.topic,{...this._base("pong",packet.id),nonce:packet.nonce}).catch(()=>{});
    else if(packet.kind==="pong"){
      const pending=this.pendingPings.get(packet.nonce);if(pending){this.pendingPings.delete(packet.nonce);pending.resolve(performance.now()-pending.started);}
    }
  }
  makeAction(name){
    const key=String(name||"");const action={onMessage:null,send:(data,{target}={})=>publish(this.topic,{...this._base("action",target),action:key,data})};this.actions.set(key,action);return action;
  }
  getPeers(){return Object.fromEntries([...this.peers].map(peerId=>[peerId,fakePeer()]));}
  ping(peerId){
    if(!this.peers.has(peerId))return Promise.reject(Error("VS broker peer unavailable"));
    const nonce=packetId();return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pendingPings.delete(nonce);reject(Error("VS broker ping timeout"));},3000);
      this.pendingPings.set(nonce,{started:performance.now(),resolve:value=>{clearTimeout(timer);resolve(value);}});
      publish(this.topic,{...this._base("ping",peerId),nonce}).catch(error=>{clearTimeout(timer);this.pendingPings.delete(nonce);reject(error);});
    });
  }
  leave(){
    if(this.closed)return;this.closed=true;clearInterval(this.helloTimer);clearInterval(this.heartbeatTimer);clearTimeout(this.errorTimer);
    publish(this.topic,this._base("bye")).catch(()=>{});unsubscribeRoom(this);
    for(const {resolve} of this.pendingPings.values())resolve(NaN);this.pendingPings.clear();this.peers.clear();
  }
}

export function joinRoom(config,roomId,callbacks={}){
  if(!String(roomId||"").startsWith("net-"))throw Error("MQTT data relay requires a trusted network/proximity room");
  return new RelayRoom(config,roomId,callbacks);
}
