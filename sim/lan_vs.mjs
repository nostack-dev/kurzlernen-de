const APP_ID="arondight45-kurzlernen-vs-v3";
const SEND_MS=50;
const RELAY_REDUNDANCY=3;
const JOIN_DIAGNOSTIC_MS=12000;
const DATA_RELAY_FALLBACK_MS=2200;
const DATA_RELAY_HEARTBEAT_MS=1000;
const DATA_RELAY_PEER_TIMEOUT_MS=6000;
const DATA_RELAY_BROKERS=["wss://test.mosquitto.org:8081/mqtt","wss://broker.emqx.io:8084/mqtt"];
const DEFAULT_TRANSPORTS=[
  {name:"Nostr",load:()=>import("trystero")},
  {name:"MQTT",load:()=>import("@trystero-p2p/mqtt")},
  {name:"Torrent",load:()=>import("@trystero-p2p/torrent")}
];
const DEFAULT_DATA_RELAY_LOADER=()=>import("mqtt");
const DISCOVERY_MAX_ROOMS=8;
const PROXIMITY_CELL_M=800;
const GESTURE_BUCKET_MS=8000;
const GESTURE_DEFER_MS=650;
const GEO_DISCOVERY_TIMEOUT_MS=1800;
const GEO_DISCOVERY_MAX_AGE_MS=120000;
const EARTH_RADIUS_M=6378137;
const STUN_ICE_SERVERS=[
  {urls:["stun:stun.cloudflare.com:3478","stun:stun.cloudflare.com:53"]},
  {urls:"stun:stun.l.google.com:19302"}
];
const NETWORK_IPV4_URL="https://api4.ipify.org?format=json";
export const VS_NETWORK_EVENT="arondight45:vs-network";

function finiteArray(value,length){return Array.isArray(value)&&value.length===length&&value.every(Number.isFinite);}
function validPose(pose){return Boolean(pose&&finiteArray(pose.p,3)&&finiteArray(pose.q,4)&&(!pose.g||finiteArray(pose.g,2)));}
function validOrigin(origin){return Boolean(origin&&Number.isFinite(origin.lon)&&Number.isFinite(origin.lat)&&Math.abs(origin.lon)<=180&&Math.abs(origin.lat)<=90&&(!("alt" in origin)||Number.isFinite(origin.alt)));}
function validCombat(packet){
  if(!packet||typeof packet!=="object"||typeof packet.type!=="string")return false;
  const idOk=typeof packet.id==="string"&&packet.id.length>=1&&packet.id.length<=64;
  if(packet.type==="hit")return idOk&&Number.isFinite(packet.damage)&&packet.damage>0&&packet.damage<=100;
  if(packet.type==="state")return idOk&&Number.isFinite(packet.hp)&&packet.hp>=0&&packet.hp<=100&&typeof packet.killed==="boolean";
  if(packet.type==="respawn")return Number.isFinite(packet.hp)&&packet.hp>=0&&packet.hp<=100;
  return false;
}
function validIpv4(value){
  const parts=String(value||"").trim().split(".");
  return parts.length===4&&parts.every(part=>/^\d{1,3}$/.test(part)&&Number(part)>=0&&Number(part)<=255);
}
function privateIpv4(value){
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
function errorMessage(error){
  const source=error?.error||error;
  return String(source?.message||source||"unknown error");
}
function eventPayload(stage,detail={}){return{at:new Date().toISOString(),stage:String(stage||"unknown"),...detail};}
function emitNetworkEvent(stage,detail={}){
  const payload=eventPayload(stage,detail);
  try{if(typeof globalThis.dispatchEvent==="function"&&typeof globalThis.CustomEvent==="function")globalThis.dispatchEvent(new CustomEvent(VS_NETWORK_EVENT,{detail:payload}));}catch{}
  return payload;
}
function networkSocketState(value){
  if(!value)return"missing";
  const state=Number(value.readyState);
  return state===0?"connecting":state===1?"open":state===2?"closing":state===3?"closed":String(state);
}
function relaySnapshot(getRelaySockets){
  try{
    const sockets=typeof getRelaySockets==="function"?getRelaySockets():null;
    if(!sockets||typeof sockets!=="object")return[];
    return Object.entries(sockets).map(([url,socket])=>({url,state:networkSocketState(socket)}));
  }catch(error){return[{url:"relay-diagnostics",state:`error:${errorMessage(error)}`}];}
}
function candidateSummary(record){
  if(!record)return null;
  return{candidateType:String(record.candidateType||record.type||""),protocol:String(record.protocol||""),address:String(record.address||record.ip||""),port:Number(record.port)||0,networkType:String(record.networkType||""),relayProtocol:String(record.relayProtocol||"")};
}
function statsRecords(report){
  const records=[];
  try{report?.forEach?.(value=>records.push(value));}catch{}
  if(!records.length&&report&&typeof report[Symbol.iterator]==="function")try{for(const [,value] of report)records.push(value);}catch{}
  return records;
}
async function peerNetworkSnapshot(pc){
  const out={connectionState:String(pc?.connectionState||""),iceConnectionState:String(pc?.iceConnectionState||""),iceGatheringState:String(pc?.iceGatheringState||""),signalingState:String(pc?.signalingState||"")};
  if(!pc||typeof pc.getStats!=="function")return out;
  try{
    const records=statsRecords(await pc.getStats()),byId=new Map(records.map(record=>[record.id,record]));
    let pair=null;
    const transport=records.find(record=>record.type==="transport"&&record.selectedCandidatePairId);
    if(transport)pair=byId.get(transport.selectedCandidatePairId)||null;
    if(!pair)pair=records.find(record=>record.type==="candidate-pair"&&record.state==="succeeded"&&record.nominated)||records.find(record=>record.type==="candidate-pair"&&record.state==="succeeded")||null;
    if(pair){
      const local=byId.get(pair.localCandidateId),remote=byId.get(pair.remoteCandidateId);
      out.selectedPair={local:candidateSummary(local),remote:candidateSummary(remote),currentRoundTripTime:Number(pair.currentRoundTripTime)||0,availableOutgoingBitrate:Number(pair.availableOutgoingBitrate)||0};
    }
  }catch(error){out.statsError=errorMessage(error);}
  return out;
}
function randomPeerId(cryptoObj=globalThis.crypto){
  const bytes=new Uint8Array(12);
  try{cryptoObj?.getRandomValues?.(bytes);}catch{for(let i=0;i<bytes.length;i++)bytes[i]=Math.floor(Math.random()*256);}
  if(!bytes.some(Boolean))for(let i=0;i<bytes.length;i++)bytes[i]=Math.floor(Math.random()*256);
  return[...bytes].map(v=>v.toString(16).padStart(2,"0")).join("");
}
function relayRoomLevel(roomId){return String(roomId||"").replace(/[^A-Za-z0-9_-]/g,"_").slice(0,96);}
function relayTopic(roomId){return`arondight45/vs-data/v1/${relayRoomLevel(roomId)}`;}
function decodePayload(value){
  try{const text=typeof value==="string"?value:new TextDecoder().decode(value);return JSON.parse(text);}catch{return null;}
}

export function networkMaterialFromCandidate(candidate){
  const record=candidateRecord(candidate);if(!record)return null;const {type,address}=record;
  if(validIpv4(address)){if(type==="srflx")return `ipv4:${address}`;if(type==="host"&&privateIpv4(address))return `lan4p24:${ipv4Subnet24(address)}`;return null;}
  const prefix=ipv6Prefix64(address);if(prefix&&(type==="srflx"||type==="host"))return `ipv6p64:${prefix}`;return null;
}
function addExpandedNetworkMaterial(target,material){
  if(typeof material!=="string"||!material)return;
  target.add(material);
  if(material.startsWith("ipv4:")){const address=material.slice(5),prefix=ipv4Subnet24(address);if(prefix)target.add(`ipv4p24:${prefix}`);}
}
async function webRtcNetworkMaterials({RTCPeerConnectionCtor=globalThis.RTCPeerConnection}={}){
  if(typeof RTCPeerConnectionCtor!=="function"){emitNetworkEvent("discovery-webrtc-unavailable");return[];}
  let pc=null,timer=0;
  try{
    pc=new RTCPeerConnectionCtor({iceServers:STUN_ICE_SERVERS,iceCandidatePoolSize:2});pc.createDataChannel("vs-discovery");
    return await new Promise((resolve,reject)=>{
      const materials=new Set();let settled=false;
      const finish=()=>{if(settled)return;settled=true;clearTimeout(timer);const list=[...materials].sort();emitNetworkEvent("discovery-ice-complete",{materials:list,iceGatheringState:String(pc?.iceGatheringState||"")});resolve(list);};
      timer=setTimeout(finish,3600);
      pc.onicecandidate=event=>{
        if(!event.candidate){finish();return;}
        const record=candidateRecord(event.candidate),material=networkMaterialFromCandidate(event.candidate);
        emitNetworkEvent("discovery-ice-candidate",{candidateType:record?.type||"",address:record?.address||"",material:material||""});
        if(material)addExpandedNetworkMaterial(materials,material);
      };
      Promise.resolve(pc.createOffer()).then(offer=>pc.setLocalDescription(offer)).catch(reject);
    });
  }catch(error){emitNetworkEvent("discovery-ice-error",{error:errorMessage(error)});return[];}finally{clearTimeout(timer);try{pc?.close?.();}catch{}}
}
function normalizePosition(value){
  const source=value?.coords||value||{},longitude=Number(source.longitude),latitude=Number(source.latitude);
  return Number.isFinite(longitude)&&Number.isFinite(latitude)&&Math.abs(longitude)<=180&&Math.abs(latitude)<=85?{longitude,latitude}:null;
}
async function browserPosition({geolocation=globalThis.navigator?.geolocation}={}){
  if(!geolocation||typeof geolocation.getCurrentPosition!=="function"){emitNetworkEvent("discovery-geo-unavailable");return null;}
  return await new Promise(resolve=>{
    let settled=false;const finish=(value,error="")=>{if(settled)return;settled=true;const normalized=normalizePosition(value);emitNetworkEvent(normalized?"discovery-geo-ready":"discovery-geo-missing",{error:String(error||"")});resolve(normalized);};
    try{geolocation.getCurrentPosition(value=>finish(value),error=>finish(null,error?.message||error),{enableHighAccuracy:false,timeout:GEO_DISCOVERY_TIMEOUT_MS,maximumAge:GEO_DISCOVERY_MAX_AGE_MS});}catch(error){finish(null,errorMessage(error));}
  });
}

export class LanVsSession{
  constructor(options={}){
    const customPrimary=Object.prototype.hasOwnProperty.call(options,"loadTransport");
    this.room=null;this.poseAction=null;this.originAction=null;this.combatAction=null;this.timer=0;this.joinTimer=0;this.peerId=null;this.roomId="";this.transportGeneration=0;
    this.onPeer=options.onPeer;this.onPose=options.onPose;this.onOrigin=options.onOrigin;this.onCombat=options.onCombat;this.onLeave=options.onLeave;this.onError=options.onError;this.onTransport=options.onTransport;this.onDiagnostic=options.onDiagnostic;
    this.pendingPose=null;this.pendingOrigin=null;this.originDirty=false;this.seq=0;this.lastRxSeq=0;this.sendBusy=false;this.originBusy=false;
    this.loadTransport=options.loadTransport||DEFAULT_TRANSPORTS[0].load;
    this.transportName=String(options.transportName||(customPrimary?"Custom":"Nostr"));
    this.relayRedundancy=Number.isFinite(options.relayRedundancy)?Math.max(1,Math.floor(options.relayRedundancy)):RELAY_REDUNDANCY;
    this.joinDiagnosticMs=Number.isFinite(options.joinDiagnosticMs)?Math.max(0,Number(options.joinDiagnosticMs)):JOIN_DIAGNOSTIC_MS;
    this.getRelaySockets=null;
  }
  diag(stage,detail={}){const payload=emitNetworkEvent(stage,{transport:this.transportName,roomId:this.roomId,...detail});this.onDiagnostic?.(payload);return payload;}
  async start(roomId){
    if(this.room)return;
    if(typeof roomId!=="string"||!roomId)throw Error("VS room id required");
    this.roomId=roomId;
    if(!this.timer)this.timer=setInterval(()=>{this.flushOrigin();this.flushPose();},SEND_MS);
    this.diag("transport-start",{relayRedundancy:this.relayRedundancy});this.onTransport?.(this.transportName);
    try{
      await this.openTransport();
      clearTimeout(this.joinTimer);this.joinTimer=0;
      if(this.joinDiagnosticMs)this.joinTimer=setTimeout(()=>{if(!this.peerId)this.diag("peer-not-found-yet",{relays:relaySnapshot(this.getRelaySockets)});},this.joinDiagnosticMs);
    }catch(error){
      this.diag("transport-error",{error:errorMessage(error),relays:relaySnapshot(this.getRelaySockets)});
      this.stop(false);this.onError?.(error);throw error;
    }
  }
  async openTransport(){
    if(typeof this.loadTransport!=="function")throw Error("VS transport unavailable");
    const generation=++this.transportGeneration,{joinRoom,getRelaySockets}=await this.loadTransport();
    if(generation!==this.transportGeneration)return;
    if(typeof joinRoom!=="function")throw Error(`${this.transportName} VS transport unavailable`);
    this.getRelaySockets=typeof getRelaySockets==="function"?getRelaySockets:null;
    let room=null;
    const active=()=>generation===this.transportGeneration&&room&&room===this.room;
    const onJoinError=details=>{
      if(!active())return;
      const error=details?.error instanceof Error?details.error:Error(errorMessage(details));
      this.diag("join-error",{peerId:String(details?.peerId||""),error:errorMessage(error),relays:relaySnapshot(this.getRelaySockets)});
      this.onError?.(error);
    };
    room=joinRoom({appId:APP_ID,relayConfig:{redundancy:this.relayRedundancy}},this.roomId,{onJoinError});
    if(generation!==this.transportGeneration){try{room?.leave?.();}catch{}return;}
    this.room=room;
    const poseAction=room.makeAction("pose");if(!poseAction||typeof poseAction.send!=="function")throw Error("VS pose action unavailable");this.poseAction=poseAction;
    const originAction=room.makeAction("origin");if(!originAction||typeof originAction.send!=="function")throw Error("VS origin action unavailable");this.originAction=originAction;
    const combatAction=room.makeAction("combat");if(!combatAction||typeof combatAction.send!=="function")throw Error("VS combat action unavailable");this.combatAction=combatAction;
    this.diag("transport-ready",{relays:relaySnapshot(this.getRelaySockets)});
    const adoptPeer=peerId=>{
      if(!active()||!peerId||this.peerId)return;
      this.peerId=peerId;this.lastRxSeq=0;this.originDirty=Boolean(this.pendingOrigin);clearTimeout(this.joinTimer);this.joinTimer=0;
      this.diag("peer-join",{peerId});this.observePeerNetwork(peerId,room);this.onPeer?.(peerId);
    };
    originAction.onMessage=(origin,{peerId}={})=>{if(!active()||!peerId||peerId!==this.peerId||!validOrigin(origin))return;this.onOrigin?.({...origin},peerId);};
    combatAction.onMessage=(packet,{peerId}={})=>{if(!active()||!peerId||!validCombat(packet))return;if(!this.peerId)adoptPeer(peerId);if(peerId!==this.peerId)return;this.onCombat?.({...packet},peerId);};
    poseAction.onMessage=(pose,{peerId}={})=>{
      if(!active()||!peerId||!validPose(pose))return;if(!this.peerId)adoptPeer(peerId);if(peerId!==this.peerId)return;
      const seq=Number(pose.seq)||0;if(seq&&seq<=this.lastRxSeq)return;if(seq)this.lastRxSeq=seq;this.onPose?.(pose,peerId);
    };
    room.onPeerJoin=peerId=>adoptPeer(peerId);
    room.onPeerLeave=peerId=>{if(!active()||peerId!==this.peerId)return;this.diag("peer-leave",{peerId});this.peerId=null;this.lastRxSeq=0;this.onLeave?.(peerId);};
  }
  observePeerNetwork(peerId,room){
    let pc=null;try{const peers=room.getPeers?.();pc=peers?.[peerId]||peers?.get?.(peerId)||null;}catch{}
    const emit=()=>peerNetworkSnapshot(pc).then(snapshot=>{if(peerId===this.peerId)this.diag("peer-network",{peerId,...snapshot});}).catch(()=>{});
    emit();setTimeout(emit,800);
    for(const name of ["connectionstatechange","iceconnectionstatechange","icegatheringstatechange","signalingstatechange"])try{pc?.addEventListener?.(name,emit);}catch{}
    try{Promise.resolve(room.ping?.(peerId)).then(rtt=>{if(peerId===this.peerId&&Number.isFinite(rtt))this.diag("peer-rtt",{peerId,rttMs:+Number(rtt).toFixed(2)});}).catch(()=>{});}catch{}
  }
  flushOrigin(){
    if(this.originBusy||!this.peerId||!this.pendingOrigin||!this.originDirty||!this.originAction)return;
    const packet={...this.pendingOrigin};this.originBusy=true;
    Promise.resolve(this.originAction.send(packet,{target:this.peerId})).then(()=>{this.originDirty=false;}).catch(error=>{this.diag("send-origin-error",{error:errorMessage(error)});this.onError?.(error);}).finally(()=>{this.originBusy=false;});
  }
  flushPose(){
    if(this.sendBusy||!this.peerId||!this.pendingPose||!this.poseAction)return;
    const packet={...this.pendingPose,seq:++this.seq};this.sendBusy=true;
    Promise.resolve(this.poseAction.send(packet,{target:this.peerId})).catch(error=>{this.diag("send-pose-error",{error:errorMessage(error)});this.onError?.(error);}).finally(()=>{this.sendBusy=false;});
  }
  setOrigin(origin){
    if(!validOrigin(origin))return false;
    const next={lon:Number(origin.lon),lat:Number(origin.lat),...(("alt" in origin)?{alt:Number(origin.alt)}:{})},old=this.pendingOrigin;
    if(!old||old.lon!==next.lon||old.lat!==next.lat||old.alt!==next.alt){this.pendingOrigin=next;this.originDirty=true;}return true;
  }
  setPose(pose){if(!validPose(pose))return false;this.pendingPose={...pose,p:[...pose.p],q:[...pose.q],...(pose.g?{g:[...pose.g]}:{})};return true;}
  sendCombat(packet){
    if(!validCombat(packet)||!this.peerId||!this.combatAction)return false;
    Promise.resolve(this.combatAction.send({...packet},{target:this.peerId})).catch(error=>{this.diag("send-combat-error",{error:errorMessage(error)});this.onError?.(error);});return true;
  }
  stop(log=true){
    clearInterval(this.timer);clearTimeout(this.joinTimer);this.timer=0;this.joinTimer=0;
    const hadRoom=Boolean(this.room),peerId=this.peerId;++this.transportGeneration;try{this.room?.leave?.();}catch{}
    this.room=null;this.poseAction=null;this.originAction=null;this.combatAction=null;this.peerId=null;this.getRelaySockets=null;this.pendingPose=null;this.pendingOrigin=null;this.originDirty=false;this.seq=0;this.lastRxSeq=0;this.sendBusy=false;this.originBusy=false;
    if(log&&hadRoom)this.diag("transport-stop",{peerId:String(peerId||"")});this.roomId="";
  }
}

export class MqttDataRelay{
  constructor(options={}){
    this.onPeer=options.onPeer;this.onPose=options.onPose;this.onOrigin=options.onOrigin;this.onCombat=options.onCombat;this.onLeave=options.onLeave;this.onError=options.onError;this.onTransport=options.onTransport;this.onDiagnostic=options.onDiagnostic;
    this.loadMqtt=options.loadMqtt||DEFAULT_DATA_RELAY_LOADER;this.brokerUrls=Array.isArray(options.brokerUrls)&&options.brokerUrls.length?[...new Set(options.brokerUrls)]:DATA_RELAY_BROKERS;
    this.localId=String(options.localId||randomPeerId());this.clients=[];this.roomIds=[];this.peerId=null;this.peerRoomId="";this.started=false;this.timer=0;this.lastHelloMs=0;this.lastPeerSeenMs=0;this.pendingPose=null;this.pendingOrigin=null;this.originDirty=false;this.seq=0;this.lastRxSeq=0;this.seenCombat=new Set();
  }
  diag(stage,detail={}){const payload=emitNetworkEvent(stage,{transport:"MQTT DATA RELAY",roomId:this.peerRoomId||"",peerId:this.peerId||"",...detail});this.onDiagnostic?.(payload);return payload;}
  async start(roomIds){
    if(this.started)return;this.started=true;this.roomIds=[...new Set((Array.isArray(roomIds)?roomIds:[roomIds]).filter(Boolean))].slice(0,DISCOVERY_MAX_ROOMS);if(!this.roomIds.length){this.started=false;throw Error("MQTT data relay requires room ids");}
    this.diag("data-relay-start",{brokers:this.brokerUrls,roomCount:this.roomIds.length});this.onTransport?.("MQTT DATA RELAY");
    try{
      const mod=await this.loadMqtt(),connect=mod?.connect||mod?.default?.connect;if(typeof connect!=="function")throw Error("MQTT browser client unavailable");
      for(let i=0;i<this.brokerUrls.length;i++)this.openBroker(connect,this.brokerUrls[i],i);
      this.timer=setInterval(()=>this.tick(),SEND_MS);
    }catch(error){this.started=false;this.diag("data-relay-error",{error:errorMessage(error)});this.onError?.(error);throw error;}
  }
  openBroker(connect,url,index){
    let client;
    try{client=connect(url,{clientId:`a45_${this.localId}_${index}`,clean:true,keepalive:15,reconnectPeriod:1000,connectTimeout:5000,protocolVersion:4,forceNativeWebSocket:true,resubscribe:true});}catch(error){this.diag("data-relay-broker-error",{broker:url,error:errorMessage(error)});return;}
    const entry={url,client,open:false};this.clients.push(entry);
    client.on?.("connect",()=>{
      entry.open=true;this.diag("data-relay-broker-open",{broker:url});
      const topics=this.roomIds.map(id=>`${relayTopic(id)}/+`);
      try{client.subscribe(topics,{qos:0},error=>{if(error)this.diag("data-relay-subscribe-error",{broker:url,error:errorMessage(error)});else this.publishHello(true);});}catch(error){this.diag("data-relay-subscribe-error",{broker:url,error:errorMessage(error)});}
    });
    client.on?.("message",(topic,payload,packet)=>this.handleMessage(topic,payload,packet));
    client.on?.("error",error=>this.diag("data-relay-broker-error",{broker:url,error:errorMessage(error)}));
    client.on?.("close",()=>{if(entry.open)this.diag("data-relay-broker-close",{broker:url});entry.open=false;});
    client.on?.("offline",()=>{entry.open=false;this.diag("data-relay-broker-offline",{broker:url});});
  }
  publish(roomId,packet,qos=0){
    if(!this.started)return false;const body=JSON.stringify({v:1,id:this.localId,...packet});let sent=false;
    for(const entry of this.clients){if(!entry.open&&!entry.client?.connected)continue;try{entry.client.publish(`${relayTopic(roomId)}/${this.localId}`,body,{qos,retain:false});sent=true;}catch(error){this.diag("data-relay-publish-error",{broker:entry.url,error:errorMessage(error)});}}
    return sent;
  }
  publishHello(force=false){
    const now=Date.now();if(!force&&now-this.lastHelloMs<DATA_RELAY_HEARTBEAT_MS)return;this.lastHelloMs=now;
    for(const roomId of this.peerRoomId?[this.peerRoomId]:this.roomIds)this.publish(roomId,{type:this.peerId?"heartbeat":"hello",ts:now},0);
  }
  handleMessage(topic,payload,packet){
    if(packet?.retain)return;const data=decodePayload(payload);if(!data||data.v!==1||typeof data.id!=="string"||data.id===this.localId)return;
    const prefix="arondight45/vs-data/v1/",raw=String(topic||"");if(!raw.startsWith(prefix))return;const rest=raw.slice(prefix.length),slash=rest.indexOf("/");if(slash<1)return;const roomLevel=rest.slice(0,slash),roomId=this.roomIds.find(id=>relayRoomLevel(id)===roomLevel);if(!roomId)return;
    if(!this.peerId)this.adoptPeer(data.id,roomId);if(data.id!==this.peerId||roomId!==this.peerRoomId)return;this.lastPeerSeenMs=Date.now();
    if(data.type==="hello"||data.type==="heartbeat")return;
    if(data.type==="bye"){const old=this.peerId;this.peerId=null;this.peerRoomId="";this.lastRxSeq=0;this.diag("data-relay-peer-leave",{peerId:old});this.onLeave?.(old);return;}
    if(data.type==="pose"&&validPose(data.pose)){const seq=Number(data.seq)||0;if(seq&&seq<=this.lastRxSeq)return;if(seq)this.lastRxSeq=seq;this.onPose?.({...data.pose,seq},this.peerId);return;}
    if(data.type==="origin"&&validOrigin(data.origin)){this.onOrigin?.({...data.origin},this.peerId);return;}
    if(data.type==="combat"&&validCombat(data.packet)){const key=String(data.mid||"");if(key&&this.seenCombat.has(key))return;if(key){this.seenCombat.add(key);while(this.seenCombat.size>256)this.seenCombat.delete(this.seenCombat.values().next().value);}this.onCombat?.({...data.packet},this.peerId);}
  }
  adoptPeer(peerId,roomId){
    if(this.peerId)return;this.peerId=peerId;this.peerRoomId=roomId;this.lastPeerSeenMs=Date.now();this.lastRxSeq=0;this.originDirty=Boolean(this.pendingOrigin);this.diag("data-relay-peer",{peerId,roomId,mode:"broker-relay"});this.onPeer?.(peerId,roomId,"MQTT DATA RELAY");this.publishHello(true);
  }
  tick(){
    if(!this.started)return;this.publishHello();
    if(this.peerId&&Date.now()-this.lastPeerSeenMs>DATA_RELAY_PEER_TIMEOUT_MS){const old=this.peerId;this.peerId=null;this.peerRoomId="";this.lastRxSeq=0;this.diag("data-relay-peer-timeout",{peerId:old});this.onLeave?.(old);return;}
    if(!this.peerId)return;
    if(this.originDirty&&this.pendingOrigin&&this.publish(this.peerRoomId,{type:"origin",origin:this.pendingOrigin,ts:Date.now()},0))this.originDirty=false;
    if(this.pendingPose){const seq=++this.seq;this.publish(this.peerRoomId,{type:"pose",pose:this.pendingPose,seq,ts:Date.now()},0);}
  }
  setOrigin(origin){if(!validOrigin(origin))return false;const next={lon:Number(origin.lon),lat:Number(origin.lat),...(("alt" in origin)?{alt:Number(origin.alt)}:{})},old=this.pendingOrigin;if(!old||old.lon!==next.lon||old.lat!==next.lat||old.alt!==next.alt){this.pendingOrigin=next;this.originDirty=true;}return true;}
  setPose(pose){if(!validPose(pose))return false;this.pendingPose={...pose,p:[...pose.p],q:[...pose.q],...(pose.g?{g:[...pose.g]}:{})};return true;}
  sendCombat(packet){if(!validCombat(packet)||!this.peerId||!this.peerRoomId)return false;const mid=`${this.localId}-${Date.now().toString(36)}-${(++this.seq).toString(36)}`;return this.publish(this.peerRoomId,{type:"combat",packet:{...packet},mid,ts:Date.now()},0);}
  stop(log=true){
    clearInterval(this.timer);this.timer=0;if(this.started&&this.peerId&&this.peerRoomId)this.publish(this.peerRoomId,{type:"bye",ts:Date.now()},0);for(const entry of this.clients)try{entry.client?.end?.(true);}catch{}const had=this.started,peerId=this.peerId;this.clients=[];this.roomIds=[];this.peerId=null;this.peerRoomId="";this.started=false;this.pendingPose=null;this.pendingOrigin=null;this.originDirty=false;this.seq=0;this.lastRxSeq=0;this.seenCombat.clear();if(log&&had)this.diag("data-relay-stop",{peerId:String(peerId||"")});
  }
}

export class LanVsFinder{
  constructor(options={}){
    this.options=options;this.children=[];this.active=null;this.roomIds=[];this.pendingPose=null;this.pendingOrigin=null;this.started=false;this.failedChildren=new Set();this.gestureDeferMs=Number.isFinite(options.gestureDeferMs)?Math.max(0,Number(options.gestureDeferMs)):GESTURE_DEFER_MS;this.dataRelayDelayMs=Number.isFinite(options.dataRelayDelayMs)?Math.max(0,Number(options.dataRelayDelayMs)):DATA_RELAY_FALLBACK_MS;this.dataRelayTimer=0;this.dataRelay=null;
    if(Array.isArray(options.transportStrategies)&&options.transportStrategies.length)this.transportStrategies=options.transportStrategies;
    else if(typeof options.loadTransport==="function")this.transportStrategies=[{name:String(options.transportName||"Custom"),load:options.loadTransport}];
    else this.transportStrategies=DEFAULT_TRANSPORTS;
    this.dataRelayEnabled=options.dataRelayEnabled!==false;this.loadMqtt=options.loadMqtt||DEFAULT_DATA_RELAY_LOADER;this.dataRelayBrokerUrls=options.dataRelayBrokerUrls;
  }
  makeChild(roomId,strategy){
    let child=null;const opts=this.options;
    child=new LanVsSession({
      loadTransport:strategy.load,transportName:strategy.name,
      ...(Number.isFinite(opts.relayRedundancy)?{relayRedundancy:opts.relayRedundancy}:{}),...(Number.isFinite(opts.joinDiagnosticMs)?{joinDiagnosticMs:opts.joinDiagnosticMs}:{}),
      onTransport:name=>{if(!this.active||this.active===child)opts.onTransport?.(name,roomId);},onDiagnostic:event=>opts.onDiagnostic?.(event,roomId,strategy.name),onPeer:peerId=>this.adopt(child,peerId,roomId,strategy.name),
      onPose:(pose,peerId)=>{if(this.active===child)opts.onPose?.(pose,peerId);},onOrigin:(origin,peerId)=>{if(this.active===child)opts.onOrigin?.(origin,peerId);},onCombat:(packet,peerId)=>{if(this.active===child)opts.onCombat?.(packet,peerId);},onLeave:peerId=>{if(this.active===child)opts.onLeave?.(peerId);},
      onError:error=>{if(this.active===child)opts.onError?.(error);else{this.failedChildren.add(child);this.ensureDataRelay("webrtc-join-error");}}
    });
    if(this.pendingPose)child.setPose(this.pendingPose);if(this.pendingOrigin)child.setOrigin(this.pendingOrigin);return child;
  }
  makeDataRelay(){
    const opts=this.options;let relay=null;relay=new MqttDataRelay({loadMqtt:this.loadMqtt,...(this.dataRelayBrokerUrls?{brokerUrls:this.dataRelayBrokerUrls}:{}),onTransport:name=>{if(!this.active||this.active===relay)opts.onTransport?.(name,this.roomIds[0]||"");},onDiagnostic:event=>opts.onDiagnostic?.(event,event.roomId||"","MQTT DATA RELAY"),onPeer:(peerId,roomId)=>this.adopt(relay,peerId,roomId,"MQTT DATA RELAY"),onPose:(pose,peerId)=>{if(this.active===relay)opts.onPose?.(pose,peerId);},onOrigin:(origin,peerId)=>{if(this.active===relay)opts.onOrigin?.(origin,peerId);},onCombat:(packet,peerId)=>{if(this.active===relay)opts.onCombat?.(packet,peerId);},onLeave:peerId=>{if(this.active===relay)opts.onLeave?.(peerId);},onError:error=>{if(this.active===relay||(!this.active&&this.failedChildren.size>=this.children.filter(child=>child!==relay).length))opts.onError?.(error);}});if(this.pendingPose)relay.setPose(this.pendingPose);if(this.pendingOrigin)relay.setOrigin(this.pendingOrigin);return relay;
  }
  ensureDataRelay(reason="timeout"){
    if(!this.started||this.active||!this.dataRelayEnabled||this.dataRelay)return;
    clearTimeout(this.dataRelayTimer);this.dataRelayTimer=0;const relay=this.makeDataRelay();this.dataRelay=relay;this.children.push(relay);emitNetworkEvent("finder-data-relay-fallback",{reason,roomCount:this.roomIds.length});relay.start(this.roomIds).catch(error=>{if(this.dataRelay===relay)this.dataRelay=null;this.children=this.children.filter(child=>child!==relay);this.options.onError?.(error);});
  }
  adopt(child,peerId,roomId,transportName){
    if(this.active&&this.active!==child){child.stop(false);return;}
    if(!this.active){this.active=child;clearTimeout(this.dataRelayTimer);this.dataRelayTimer=0;for(const other of this.children)if(other!==child)other.stop(false);this.children=[child];this.dataRelay=child instanceof MqttDataRelay?child:null;this.failedChildren.clear();emitNetworkEvent("finder-selected",{roomId,transport:transportName,peerId});}
    this.options.onPeer?.(peerId,roomId,transportName);
  }
  async start(roomIds){
    if(this.started)return;this.started=true;
    const ids=[...new Set((Array.isArray(roomIds)?roomIds:[roomIds]).filter(id=>typeof id==="string"&&id))].slice(0,DISCOVERY_MAX_ROOMS);if(!ids.length){this.started=false;throw Error("VS discovery produced no room candidates");}
    this.roomIds=ids;
    const makeEntries=list=>list.flatMap(id=>this.transportStrategies.map(strategy=>({id,strategy,child:this.makeChild(id,strategy)}))),trustedIds=ids.filter(id=>!id.startsWith("tap-")),gestureIds=ids.filter(id=>id.startsWith("tap-")),trusted=makeEntries(trustedIds),gesture=makeEntries(gestureIds),entries=[...trusted,...gesture];this.children=entries.map(entry=>entry.child);
    emitNetworkEvent("finder-start",{roomCount:ids.length,transportNames:[...this.transportStrategies.map(item=>item.name),...(this.dataRelayEnabled?["MQTT DATA RELAY"]:[])],trustedRooms:trustedIds.length,gestureRooms:gestureIds.length});
    if(this.dataRelayEnabled)this.dataRelayTimer=setTimeout(()=>this.ensureDataRelay("webrtc-timeout"),this.dataRelayDelayMs);
    const results=[],startEntries=async list=>{if(!list.length)return[];return Promise.allSettled(list.map(entry=>entry.child.start(entry.id)));};
    results.push(...await startEntries(trusted));
    if(!this.active&&gesture.length){await new Promise(resolve=>setTimeout(resolve,this.gestureDeferMs));if(this.started&&!this.active)results.push(...await startEntries(gesture));}
    if(!this.active&&this.started&&results.length&&results.every(result=>result.status==="rejected")){this.ensureDataRelay("signaling-unavailable");if(!this.dataRelay){const reason=results.find(result=>result.status==="rejected")?.reason||Error("VS signaling unavailable");this.stop();throw reason;}}
  }
  setOrigin(origin){if(!validOrigin(origin))return false;this.pendingOrigin={...origin};for(const child of this.active?[this.active]:this.children)child.setOrigin(origin);return true;}
  setPose(pose){if(!validPose(pose))return false;this.pendingPose={...pose,p:[...pose.p],q:[...pose.q],...(pose.g?{g:[...pose.g]}:{})};for(const child of this.active?[this.active]:this.children)child.setPose(pose);return true;}
  sendCombat(packet){return this.active?.sendCombat(packet)||false;}
  stop(){clearTimeout(this.dataRelayTimer);this.dataRelayTimer=0;for(const child of this.children)child.stop(false);this.children=[];this.active=null;this.dataRelay=null;this.roomIds=[];this.pendingPose=null;this.pendingOrigin=null;this.started=false;this.failedChildren.clear();emitNetworkEvent("finder-stop");}
}

async function hashRoomMaterial(material,cryptoObj){
  if(!cryptoObj?.subtle)throw Error("Secure room hashing unavailable");
  const bytes=new TextEncoder().encode(material),digest=new Uint8Array(await cryptoObj.subtle.digest("SHA-256",bytes));return [...digest.slice(0,12)].map(v=>v.toString(16).padStart(2,"0")).join("");
}
export async function gestureRoomKeys({gestureTimeMs=Date.now(),cryptoObj=globalThis.crypto}={}){
  const time=Number(gestureTimeMs);if(!Number.isFinite(time)||time<0)return[];const bucket=Math.floor(time/GESTURE_BUCKET_MS),keys=[];
  for(const slot of [bucket,bucket-1]){const key=await hashRoomMaterial(`arondight45-vs-discovery-v6:gesture:${GESTURE_BUCKET_MS}:${slot}`,cryptoObj);keys.push(`tap-${key}`);}return [...new Set(keys)];
}
export async function sameNetworkRoomKeys({fetchFn=globalThis.fetch,cryptoObj=globalThis.crypto,networkMaterialsFn=webRtcNetworkMaterials}={}){
  const materials=new Set();let lastError=null;
  try{for(const material of await networkMaterialsFn?.()||[])addExpandedNetworkMaterial(materials,material);}catch(error){lastError=error;emitNetworkEvent("discovery-network-material-error",{error:errorMessage(error)});}
  if(typeof fetchFn==="function"){
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),3500);
    try{const response=await fetchFn(NETWORK_IPV4_URL,{cache:"no-store",signal:controller.signal});if(!response?.ok)throw Error(`Network lookup failed (${response?.status||0})`);const data=await response.json(),address=String(data?.ip||"").trim();if(!validIpv4(address))throw Error("Network lookup returned invalid IPv4 address");emitNetworkEvent("discovery-public-ip",{address});addExpandedNetworkMaterial(materials,`ipv4:${address}`);}catch(error){lastError=error;emitNetworkEvent("discovery-public-ip-error",{error:errorMessage(error)});}finally{clearTimeout(timeout);}
  }
  if(!materials.size)throw lastError||Error("Could not determine shared network identity");const sorted=[...materials].sort();emitNetworkEvent("discovery-network-materials",{materials:sorted});const keys=[];for(const material of sorted){const key=await hashRoomMaterial(`arondight45-vs-discovery-v5:${material}`,cryptoObj);keys.push(`net-${key}`);}return [...new Set(keys)];
}
export async function sameNetworkRoomKey(options={}){const keys=await sameNetworkRoomKeys(options);return keys[0];}
export async function proximityRoomKeys({longitude,latitude,cryptoObj=globalThis.crypto}={}){
  if(!Number.isFinite(longitude)||!Number.isFinite(latitude)||Math.abs(longitude)>180||Math.abs(latitude)>85)return[];const lonRad=longitude*Math.PI/180,latRad=latitude*Math.PI/180,x=EARTH_RADIUS_M*lonRad,y=EARTH_RADIUS_M*Math.log(Math.tan(Math.PI/4+latRad/2)),half=PROXIMITY_CELL_M/2,shifts=[[0,0],[half,0],[0,half],[half,half]],keys=[];
  for(let i=0;i<shifts.length;i++){const [sx,sy]=shifts[i],ix=Math.floor((x+sx)/PROXIMITY_CELL_M),iy=Math.floor((y+sy)/PROXIMITY_CELL_M),key=await hashRoomMaterial(`arondight45-vs-discovery-v5:geo:${PROXIMITY_CELL_M}:${i}:${ix}:${iy}`,cryptoObj);keys.push(`net-${key}`);}return [...new Set(keys)];
}
export async function discoveryRoomKeys({longitude,latitude,fetchFn=globalThis.fetch,cryptoObj=globalThis.crypto,networkMaterialsFn=webRtcNetworkMaterials,positionFn=browserPosition,gestureTimeMs=Date.now()}={}){
  const gesturePromise=gestureRoomKeys({gestureTimeMs,cryptoObj});let position=normalizePosition({longitude,latitude});if(!position&&typeof positionFn==="function")try{position=normalizePosition(await positionFn());}catch(error){emitNetworkEvent("discovery-geo-error",{error:errorMessage(error)});}
  const [gesture,geo,network]=await Promise.all([gesturePromise,position?proximityRoomKeys({...position,cryptoObj}):Promise.resolve([]),sameNetworkRoomKeys({fetchFn,cryptoObj,networkMaterialsFn}).catch(()=>[])]);
  const trusted=[...new Set([...network.slice(0,3),...geo.slice(0,3)])].slice(0,Math.max(0,DISCOVERY_MAX_ROOMS-gesture.length)),keys=[...trusted,...gesture];if(!keys.length)throw Error("No automatic proximity/network/gesture discovery path available");const unique=[...new Set(keys)].slice(0,DISCOVERY_MAX_ROOMS);emitNetworkEvent("discovery-plan",{roomIds:unique,networkRooms:network.length,geoRooms:geo.length,gestureRooms:gesture.length});return unique;
}
