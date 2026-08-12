const APP_ID="arondight45-kurzlernen-vs-v3";
const SEND_MS=50;
const RELAY_REDUNDANCY=3;
const JOIN_DIAGNOSTIC_MS=12000;
const DEFAULT_TRANSPORTS=[
  {name:"Nostr",load:()=>import("trystero")},
  {name:"NostrRelay",load:()=>import("./nostr_data_relay.mjs")},
  {name:"Torrent",load:()=>import("@trystero-p2p/torrent")},
  {name:"MQTT",load:()=>import("@trystero-p2p/mqtt")},
  {name:"Broker",load:()=>import("./mqtt_data_relay.mjs")}
];
const DISCOVERY_MAX_ROOMS=8;
const PROXIMITY_CELL_M=800;
const GESTURE_BUCKET_MS=8000;
const GESTURE_DEFER_MS=650;
const FINDER_STAGE_MS=6500;
const FINDER_MAX_ROOMS_PER_STAGE=3;
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
    return Object.entries(sockets).map(([url,socket])=>({url,state:networkSocketState(socket),error:String(socket?.error||"")}));
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
    if(!this.timer)this.timer=setInterval(()=>{this.flushOrigin();this.flushPose();},this.transportName==="NostrRelay"?100:SEND_MS);
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
    const directRtc=!["Broker","NostrRelay"].includes(this.transportName);
    const roomConfig={appId:APP_ID,relayConfig:{redundancy:this.relayRedundancy},...(directRtc?{trickleIce:true,rtcConfig:{iceServers:STUN_ICE_SERVERS,iceTransportPolicy:"all",iceCandidatePoolSize:1,bundlePolicy:"max-bundle"}}:{})};
    this.diag("ice-config",{directRtc,trickleIce:directRtc,iceServers:directRtc?STUN_ICE_SERVERS.map(server=>server.urls):[]});
    room=joinRoom(roomConfig,this.roomId,{onJoinError});
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

export class LanVsFinder{
  constructor(options={}){
    this.options=options;this.children=[];this.currentStageChildren=[];this.active=null;this.roomIds=[];this.stageRoomIds=[];this.pendingPose=null;this.pendingOrigin=null;this.started=false;this.failedChildren=new Set();this.stageErrors=[];this.stageTimer=0;this.stageResolve=null;this.stageEpoch=0;this.stageTask=null;
    this.stageMs=Number.isFinite(options.stageMs)?Math.max(250,Number(options.stageMs)):FINDER_STAGE_MS;
    this.maxRoomsPerStage=Number.isFinite(options.maxRoomsPerStage)?Math.max(1,Math.floor(options.maxRoomsPerStage)):FINDER_MAX_ROOMS_PER_STAGE;
    if(Array.isArray(options.transportStrategies)&&options.transportStrategies.length)this.transportStrategies=options.transportStrategies;
    else if(typeof options.loadTransport==="function")this.transportStrategies=[{name:String(options.transportName||"Custom"),load:options.loadTransport}];
    else this.transportStrategies=DEFAULT_TRANSPORTS;
  }
  chooseStageRooms(ids){
    const gesture=ids.filter(id=>id.startsWith("tap-")),trusted=ids.filter(id=>!id.startsWith("tap-")),out=[];
    for(const id of gesture.slice(0,2))if(!out.includes(id))out.push(id);
    for(const id of trusted)if(out.length<this.maxRoomsPerStage&&!out.includes(id))out.push(id);
    for(const id of gesture.slice(2))if(out.length<this.maxRoomsPerStage&&!out.includes(id))out.push(id);
    return out.slice(0,this.maxRoomsPerStage);
  }
  makeChild(roomId,strategy){
    let child=null;const opts=this.options;
    child=new LanVsSession({
      loadTransport:strategy.load,transportName:strategy.name,
      ...(Number.isFinite(opts.relayRedundancy)?{relayRedundancy:opts.relayRedundancy}:{}),...(Number.isFinite(opts.joinDiagnosticMs)?{joinDiagnosticMs:opts.joinDiagnosticMs}:{}),
      onTransport:name=>{if(!this.active||this.active===child)opts.onTransport?.(name,roomId);},onDiagnostic:event=>opts.onDiagnostic?.(event,roomId,strategy.name),onPeer:peerId=>this.adopt(child,peerId,roomId,strategy.name),
      onPose:(pose,peerId)=>{if(this.active===child)opts.onPose?.(pose,peerId);},onOrigin:(origin,peerId)=>{if(this.active===child)opts.onOrigin?.(origin,peerId);},onCombat:(packet,peerId)=>{if(this.active===child)opts.onCombat?.(packet,peerId);},onLeave:peerId=>{if(this.active===child)opts.onLeave?.(peerId);},
      onError:error=>{
        if(this.active===child){opts.onError?.(error);return;}
        this.failedChildren.add(child);this.stageErrors.push(error);
        if(this.currentStageChildren.length&&this.currentStageChildren.every(item=>this.failedChildren.has(item)))this.wakeStage("all-error");
      }
    });
    if(this.pendingPose)child.setPose(this.pendingPose);if(this.pendingOrigin)child.setOrigin(this.pendingOrigin);return child;
  }
  wakeStage(reason="wake"){
    if(!this.stageResolve)return;const resolve=this.stageResolve;this.stageResolve=null;clearTimeout(this.stageTimer);this.stageTimer=0;resolve(reason);
  }
  waitStage(epoch){
    if(this.active||!this.started||epoch!==this.stageEpoch)return Promise.resolve("cancel");
    return new Promise(resolve=>{this.stageResolve=resolve;this.stageTimer=setTimeout(()=>{if(this.stageResolve===resolve)this.stageResolve=null;this.stageTimer=0;resolve("timeout");},this.stageMs);});
  }
  adopt(child,peerId,roomId,transportName){
    if(this.active&&this.active!==child){child.stop(false);return;}
    if(!this.active){
      this.active=child;this.wakeStage("peer");
      for(const other of this.children)if(other!==child)other.stop(false);
      this.children=[child];this.currentStageChildren=[child];this.failedChildren.clear();this.stageErrors=[];
      emitNetworkEvent("finder-selected",{roomId,transport:transportName,peerId,maxConcurrent:this.maxRoomsPerStage});
    }
    this.options.onPeer?.(peerId,roomId,transportName);
  }
  async runStages(epoch){
    let lastError=null;
    for(let index=0;index<this.transportStrategies.length;index++){
      if(!this.started||epoch!==this.stageEpoch||this.active)return;
      const strategy=this.transportStrategies[index];this.failedChildren.clear();this.stageErrors=[];
      const rooms=this.stageRoomIds.filter(id=>!strategy.trustedOnly||!id.startsWith("tap-"));
      if(!rooms.length)continue;
      const children=rooms.map(roomId=>this.makeChild(roomId,strategy));this.children=children;this.currentStageChildren=children;
      emitNetworkEvent("finder-stage-start",{stage:index+1,transport:strategy.name,roomIds:rooms,maxConcurrent:children.length});
      const results=await Promise.allSettled(children.map((child,i)=>child.start(rooms[i])));
      for(const result of results)if(result.status==="rejected")lastError=result.reason;
      if(this.active||!this.started||epoch!==this.stageEpoch)return;
      const allStartRejected=results.every(result=>result.status==="rejected");
      const allJoinFailed=this.currentStageChildren.length>0&&this.currentStageChildren.every(child=>this.failedChildren.has(child));
      if(!allStartRejected&&!allJoinFailed){
        const reason=await this.waitStage(epoch);
        if(this.active||!this.started||epoch!==this.stageEpoch)return;
        emitNetworkEvent("finder-stage-end",{stage:index+1,transport:strategy.name,reason,errors:this.stageErrors.map(error=>errorMessage(error)).slice(-4)});
      }else emitNetworkEvent("finder-stage-end",{stage:index+1,transport:strategy.name,reason:allStartRejected?"start-failed":"all-error",errors:(this.stageErrors.length?this.stageErrors:results.filter(result=>result.status==="rejected").map(result=>result.reason)).map(error=>errorMessage(error)).slice(-4)});
      for(const child of children)child.stop(false);this.children=[];this.currentStageChildren=[];
      if(this.stageErrors.length)lastError=this.stageErrors[this.stageErrors.length-1];
    }
    if(this.started&&epoch===this.stageEpoch&&!this.active){
      const error=lastError instanceof Error?lastError:Error("VS peer not reachable after staged direct/NostrRelay/Torrent/MQTT/Broker attempts");
      emitNetworkEvent("finder-exhausted",{error:errorMessage(error),roomIds:this.stageRoomIds,transportNames:this.transportStrategies.map(item=>item.name)});
      this.options.onError?.(error);
    }
  }
  async start(roomIds){
    if(this.started)return;this.started=true;
    const ids=[...new Set((Array.isArray(roomIds)?roomIds:[roomIds]).filter(id=>typeof id==="string"&&id))].slice(0,DISCOVERY_MAX_ROOMS);
    if(!ids.length){this.started=false;throw Error("VS discovery produced no room candidates");}
    this.roomIds=ids;this.stageRoomIds=this.chooseStageRooms(ids);
    if(!this.stageRoomIds.length){this.started=false;throw Error("VS discovery produced no staged room candidates");}
    const epoch=++this.stageEpoch;
    emitNetworkEvent("finder-start",{roomCount:ids.length,selectedRoomIds:this.stageRoomIds,transportNames:this.transportStrategies.map(item=>item.name),maxConcurrent:this.maxRoomsPerStage,mode:"staged-mobile"});
    this.stageTask=this.runStages(epoch).catch(error=>{if(this.started&&epoch===this.stageEpoch&&!this.active){emitNetworkEvent("finder-error",{error:errorMessage(error)});this.options.onError?.(error);}});
    await Promise.resolve();
  }
  setOrigin(origin){if(!validOrigin(origin))return false;this.pendingOrigin={...origin};for(const child of this.active?[this.active]:this.children)child.setOrigin(origin);return true;}
  setPose(pose){if(!validPose(pose))return false;this.pendingPose={...pose,p:[...pose.p],q:[...pose.q],...(pose.g?{g:[...pose.g]}:{})};for(const child of this.active?[this.active]:this.children)child.setPose(pose);return true;}
  sendCombat(packet){return this.active?.sendCombat(packet)||false;}
  stop(){
    this.started=false;++this.stageEpoch;this.wakeStage("stop");clearTimeout(this.stageTimer);this.stageTimer=0;
    for(const child of this.children)child.stop(false);this.children=[];this.currentStageChildren=[];this.active=null;this.roomIds=[];this.stageRoomIds=[];this.pendingPose=null;this.pendingOrigin=null;this.failedChildren.clear();this.stageErrors=[];this.stageTask=null;emitNetworkEvent("finder-stop");
  }
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
