import {SimplePool} from "nostr-tools/pool";
import {finalizeEvent,generateSecretKey} from "nostr-tools/pure";

const RELAYS=[
  "wss://relay-rpi.edufeed.org",
  "wss://relay2.angor.io",
  "wss://top.testrelay.top",
  "wss://relay.primal.net"
];
const EVENT_KIND=25045;
const PROTOCOL_VERSION=3;
const HELLO_MS=1000;
const HEARTBEAT_MS=5000;
const CONNECT_ERROR_MS=12000;
const DISCONNECT_GRACE_MS=4500;
const MAX_PACKET_BYTES=32768;
const MAX_SEEN=2048;
const POSE_BUFFER_LIMIT_BYTES=65536;
const STUN_ICE_SERVERS=[
  {urls:["stun:stun.cloudflare.com:3478","stun:stun.cloudflare.com:53"]},
  {urls:"stun:stun.l.google.com:19302"}
];
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
function ensurePool(){
  if(pool)return pool;
  pool=new SimplePool({enablePing:true,enableReconnect:true});
  pool.onRelayConnectionSuccess=url=>{const normalized=String(url).replace(/\/$/,""),state=statusObject(normalized);state.readyState=1;state.error="";emitNetwork("signal-relay-open",{relay:normalized});};
  pool.onRelayConnectionFailure=url=>{const normalized=String(url).replace(/\/$/,""),state=statusObject(normalized);state.readyState=3;state.error="connection failure";emitNetwork("signal-relay-error",{relay:normalized,error:state.error});};
  signerKey=generateSecretKey();
  return pool;
}
function closePoolIfIdle(){if(rooms.size||!pool)return;try{pool.close(RELAYS);}catch{}try{pool.destroy?.();}catch{}pool=null;signerKey=null;for(const state of relayStates.values()){state.readyState=3;state.error="";}}
function parseEvent(event){try{const text=String(event?.content||"");if(text.length>MAX_PACKET_BYTES)return null;const value=JSON.parse(text);return value&&value.v===PROTOCOL_VERSION&&typeof value.id==="string"&&typeof value.kind==="string"?value:null;}catch{return null;}}
function candidateProtocol(candidate){const direct=String(candidate?.protocol||"").toLowerCase();if(direct)return direct;const parts=String(candidate?.candidate||"").trim().split(/\s+/);return String(parts[2]||"").toLowerCase();}
function rtcCtor(config){return config?.RTCPeerConnectionCtor||globalThis.RTCPeerConnection;}
function channelOpen(channel){return Boolean(channel&&channel.readyState==="open");}
function safeParse(text){try{return JSON.parse(String(text));}catch{return null;}}
function peerSnapshot(pc,isHost){if(!pc)return null;pc.__a45HostAuthority=Boolean(isHost);pc.__a45Transport="direct-p2p-udp";return pc;}

class DirectUdpRoom{
  constructor(config,roomId,callbacks={}){
    this.config=config||{};this.appId=clean(config?.appId||"app");this.roomId=clean(roomId);this.tag=`a45-vs-p2p-${this.appId}-${this.roomId}`;
    this.id=randomId();this.peerId="";this.isHost=false;this.pc=null;this.poseChannel=null;this.controlChannel=null;this.actions=new Map();this.seen=new Set();this.pendingCandidates=[];this.pendingPings=new Map();this.closed=false;this.ready=false;this.offerStarted=false;this.restartInFlight=false;this._onPeerJoin=null;this._onPeerLeave=null;this.onJoinError=callbacks?.onJoinError;this.disconnectTimer=0;this.errorTimer=0;this.helloTimer=0;this.heartbeatTimer=0;
    const RTC=rtcCtor(this.config);if(typeof RTC!=="function")throw Error("Direct UDP WebRTC unavailable");
    const p=ensurePool();rooms.add(this);
    this.subscription=p.subscribe(RELAYS,{kinds:[EVENT_KIND],"#t":[this.tag],since:Math.floor(Date.now()/1000)-5},{onevent:event=>{const packet=parseEvent(event);if(packet)this._receiveSignal(packet);},onclose:items=>{for(const item of items||[]){const url=String(item?.url||"").replace(/\/$/,""),state=statusObject(url);state.readyState=3;state.error=String(item?.reason||"subscription closed");emitNetwork("signal-subscription-close",{relay:url,error:state.error,roomId:this.roomId});}}});
    this.helloTimer=setInterval(()=>this._announce(),HELLO_MS);this.heartbeatTimer=setInterval(()=>{if(!this.ready)this._announce();},HEARTBEAT_MS);
    this.errorTimer=setTimeout(()=>{if(!this.closed&&!this.ready){const error=Error(this.peerId?"Direct UDP peer connection timed out":"Direct UDP peer not found");emitNetwork("direct-udp-timeout",{roomId:this.roomId,peerId:this.peerId});this.onJoinError?.({peerId:this.peerId,error});}},CONNECT_ERROR_MS);
    queueMicrotask(()=>this._announce());
  }
  set onPeerJoin(fn){this._onPeerJoin=typeof fn==="function"?fn:null;if(this._onPeerJoin&&this.ready&&this.peerId)queueMicrotask(()=>this._onPeerJoin?.(this.peerId));}
  get onPeerJoin(){return this._onPeerJoin;}
  set onPeerLeave(fn){this._onPeerLeave=typeof fn==="function"?fn:null;}
  get onPeerLeave(){return this._onPeerLeave;}
  _base(kind,target=""){return{v:PROTOCOL_VERSION,kind,id:this.id,msgId:packetId(),target:String(target||""),ts:Date.now()};}
  _remember(msgId){if(!msgId||this.seen.has(msgId))return false;this.seen.add(msgId);if(this.seen.size>MAX_SEEN)this.seen.delete(this.seen.values().next().value);return true;}
  async _publishSignal(packet){
    if(this.closed)throw Error("Direct UDP room closed");const text=JSON.stringify(packet);if(text.length>MAX_PACKET_BYTES)throw Error("Direct UDP signaling packet too large");
    const p=ensurePool(),event=finalizeEvent({kind:EVENT_KIND,created_at:Math.floor(Date.now()/1000),tags:[["t",this.tag],["expiration",String(Math.floor(Date.now()/1000)+30)]],content:text},signerKey);
    const attempts=RELAYS.map(url=>p.publish([url],event,{maxWait:2500})[0].then(()=>{const normalized=url.replace(/\/$/,""),state=statusObject(normalized);state.readyState=1;state.error="";return normalized;}).catch(error=>{const normalized=url.replace(/\/$/,""),state=statusObject(normalized);state.readyState=3;state.error=errorText(error);throw error;}));
    return Promise.any(attempts);
  }
  _announce(){if(this.closed||this.ready)return;this._publishSignal(this._base("hello")).catch(()=>{});}
  _receiveSignal(packet){this._receiveSignalAsync(packet).catch(error=>{emitNetwork("signal-handle-error",{roomId:this.roomId,error:errorText(error)});this.onJoinError?.({peerId:String(packet?.id||""),error});});}
  async _receiveSignalAsync(packet){
    if(this.closed||packet.id===this.id||!this._remember(packet.msgId))return;if(packet.target&&packet.target!==this.id)return;
    if(packet.kind==="hello"){
      if(this.peerId&&packet.id!==this.peerId)return;
      if(!this.peerId){this.peerId=packet.id;this.isHost=this.id<packet.id;emitNetwork("authority-elected",{roomId:this.roomId,peerId:this.peerId,role:this.isHost?"host":"client"});await this._ensureRtc();}
      if(this.isHost&&!this.offerStarted)await this._startOffer(false);return;
    }
    if(packet.id!==this.peerId)return;if(packet.kind==="bye"){this._peerGone("signal-bye");return;}await this._ensureRtc();
    if(packet.kind==="description"){
      const description=packet.description;if(!description||typeof description.type!=="string"||typeof description.sdp!=="string")return;
      await this.pc.setRemoteDescription(description);await this._flushCandidates();
      if(description.type==="offer"){const answer=await this.pc.createAnswer();await this.pc.setLocalDescription(answer);await this._publishSignal({...this._base("description",this.peerId),description:{type:this.pc.localDescription.type,sdp:this.pc.localDescription.sdp}});}return;
    }
    if(packet.kind==="candidate"){const candidate=packet.candidate;if(!candidate||candidateProtocol(candidate)!=="udp")return;if(this.pc.remoteDescription)await this.pc.addIceCandidate(candidate);else this.pendingCandidates.push(candidate);}
  }
  async _ensureRtc(){
    if(this.pc)return;const RTC=rtcCtor(this.config),pc=new RTC({iceServers:STUN_ICE_SERVERS,iceTransportPolicy:"all",bundlePolicy:"max-bundle",rtcpMuxPolicy:"require",iceCandidatePoolSize:2});this.pc=pc;
    const pose=pc.createDataChannel("pose",{negotiated:true,id:0,ordered:false,maxRetransmits:0});
    const control=pc.createDataChannel("control",{negotiated:true,id:1,ordered:true});
    pose.binaryType="arraybuffer";control.binaryType="arraybuffer";pose.bufferedAmountLowThreshold=0;control.bufferedAmountLowThreshold=0;this.poseChannel=pose;this.controlChannel=control;
    pose.onopen=()=>this._maybeReady();control.onopen=()=>this._maybeReady();pose.onclose=()=>this._channelClosed("pose");control.onclose=()=>this._channelClosed("control");pose.onerror=()=>emitNetwork("pose-channel-error",{roomId:this.roomId,peerId:this.peerId});control.onerror=()=>emitNetwork("control-channel-error",{roomId:this.roomId,peerId:this.peerId});pose.onmessage=event=>this._receiveGameplay("pose",event.data);control.onmessage=event=>this._receiveControl(event.data);
    pc.onicecandidate=event=>{const candidate=event.candidate;if(!candidate)return;if(candidateProtocol(candidate)!=="udp"){emitNetwork("ice-candidate-rejected",{roomId:this.roomId,protocol:candidateProtocol(candidate)||"unknown"});return;}const json=typeof candidate.toJSON==="function"?candidate.toJSON():{candidate:candidate.candidate,sdpMid:candidate.sdpMid,sdpMLineIndex:candidate.sdpMLineIndex,usernameFragment:candidate.usernameFragment};this._publishSignal({...this._base("candidate",this.peerId),candidate:json}).catch(()=>{});};
    pc.onconnectionstatechange=()=>this._connectionChanged();pc.oniceconnectionstatechange=()=>this._connectionChanged();
  }
  async _startOffer(iceRestart=false){if(this.closed||!this.pc||!this.peerId)return;if(!iceRestart)this.offerStarted=true;const offer=await this.pc.createOffer(iceRestart?{iceRestart:true}:{});await this.pc.setLocalDescription(offer);await this._publishSignal({...this._base("description",this.peerId),description:{type:this.pc.localDescription.type,sdp:this.pc.localDescription.sdp}});emitNetwork(iceRestart?"ice-restart-offer":"direct-udp-offer",{roomId:this.roomId,peerId:this.peerId,role:this.isHost?"host":"client"});}
  async _flushCandidates(){if(!this.pc?.remoteDescription)return;const queue=this.pendingCandidates.splice(0);for(const candidate of queue)try{await this.pc.addIceCandidate(candidate);}catch(error){emitNetwork("ice-candidate-add-error",{error:errorText(error)});}}
  _maybeReady(){if(this.closed||this.ready||!this.peerId||!channelOpen(this.poseChannel)||!channelOpen(this.controlChannel))return;this.ready=true;clearTimeout(this.errorTimer);this.errorTimer=0;clearInterval(this.helloTimer);clearInterval(this.heartbeatTimer);this.helloTimer=0;this.heartbeatTimer=0;emitNetwork("direct-udp-ready",{roomId:this.roomId,peerId:this.peerId,role:this.isHost?"host":"client",pose:{ordered:this.poseChannel.ordered,maxRetransmits:this.poseChannel.maxRetransmits},control:{ordered:this.controlChannel.ordered,maxRetransmits:this.controlChannel.maxRetransmits}});this._onPeerJoin?.(this.peerId);}
  _connectionChanged(){if(this.closed||!this.pc)return;const state=String(this.pc.connectionState||this.pc.iceConnectionState||"");emitNetwork("direct-udp-state",{roomId:this.roomId,peerId:this.peerId,state,iceState:String(this.pc.iceConnectionState||"")});if(state==="connected"){clearTimeout(this.disconnectTimer);this.disconnectTimer=0;this.restartInFlight=false;this._maybeReady();return;}if(state==="failed"){this._restartOrLeave("failed");return;}if(state==="disconnected"&&!this.disconnectTimer)this.disconnectTimer=setTimeout(()=>{this.disconnectTimer=0;this._restartOrLeave("disconnected");},DISCONNECT_GRACE_MS);if(state==="closed")this._peerGone("closed");}
  _restartOrLeave(reason){if(this.closed||!this.peerId)return;if(this.isHost&&!this.restartInFlight){this.restartInFlight=true;Promise.resolve(this._startOffer(true)).catch(error=>{emitNetwork("ice-restart-error",{error:errorText(error)});this._peerGone(reason);}).finally(()=>{setTimeout(()=>{this.restartInFlight=false;},2000);});return;}if(!this.isHost)this._peerGone(reason);}
  _channelClosed(channel){if(this.closed)return;emitNetwork("direct-udp-channel-close",{roomId:this.roomId,peerId:this.peerId,channel});if(this.ready)this._peerGone(`${channel}-closed`);}
  _peerGone(reason){if(this.closed)return;const peerId=this.peerId,wasReady=this.ready;this.ready=false;this.peerId="";this.isHost=false;this.offerStarted=false;clearTimeout(this.disconnectTimer);this.disconnectTimer=0;try{this.pc?.close?.();}catch{}this.pc=null;this.poseChannel=null;this.controlChannel=null;this.pendingCandidates=[];for(const pending of this.pendingPings.values())pending.reject?.(Error("Direct UDP peer left"));this.pendingPings.clear();if(wasReady&&peerId)this._onPeerLeave?.(peerId);emitNetwork("direct-udp-peer-left",{roomId:this.roomId,peerId,reason});if(!this.closed){clearInterval(this.helloTimer);clearInterval(this.heartbeatTimer);this.helloTimer=setInterval(()=>this._announce(),HELLO_MS);this.heartbeatTimer=setInterval(()=>{if(!this.ready)this._announce();},HEARTBEAT_MS);this._announce();}}
  _receiveGameplay(action,data){if(!this.ready||!this.peerId)return;const payload=safeParse(data);if(!payload)return;this.actions.get(action)?.onMessage?.(payload,{peerId:this.peerId});}
  _receiveControl(data){if(!this.ready||!this.peerId)return;const packet=safeParse(data);if(!packet||typeof packet.a!=="string")return;if(packet.a==="__ping"){this._sendControl({a:"__pong",n:packet.n}).catch(()=>{});return;}if(packet.a==="__pong"){const pending=this.pendingPings.get(packet.n);if(pending){this.pendingPings.delete(packet.n);pending.resolve(performance.now()-pending.started);}return;}this.actions.get(packet.a)?.onMessage?.(packet.d,{peerId:this.peerId});}
  _sendControl(packet){if(!channelOpen(this.controlChannel))return Promise.reject(Error("Direct UDP reliable channel unavailable"));try{this.controlChannel.send(JSON.stringify(packet));return Promise.resolve();}catch(error){return Promise.reject(error);}}
  _sendAction(action,data,target){if(!this.ready||!this.peerId)return Promise.reject(Error("Direct UDP peer unavailable"));if(target&&String(target)!==this.peerId)return Promise.reject(Error("Direct UDP target peer unavailable"));if(action==="pose"){if(!channelOpen(this.poseChannel))return Promise.reject(Error("Direct UDP pose channel unavailable"));if(this.poseChannel.bufferedAmount>POSE_BUFFER_LIMIT_BYTES){emitNetwork("pose-drop-backpressure",{roomId:this.roomId,peerId:this.peerId,bufferedAmount:this.poseChannel.bufferedAmount});return Promise.resolve();}try{this.poseChannel.send(JSON.stringify(data));return Promise.resolve();}catch(error){return Promise.reject(error);}}return this._sendControl({a:action,d:data});}
  makeAction(name){const key=String(name||"");const action={onMessage:null,send:(data,{target}={})=>this._sendAction(key,data,target)};this.actions.set(key,action);return action;}
  getPeers(){return this.ready&&this.peerId?{[this.peerId]:peerSnapshot(this.pc,this.isHost)}:{};}
  ping(peerId){if(!this.ready||peerId!==this.peerId)return Promise.reject(Error("Direct UDP peer unavailable"));const nonce=packetId();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pendingPings.delete(nonce);reject(Error("Direct UDP ping timeout"));},3000);this.pendingPings.set(nonce,{started:performance.now(),resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});this._sendControl({a:"__ping",n:nonce}).catch(error=>{clearTimeout(timer);this.pendingPings.delete(nonce);reject(error);});});}
  leave(){if(this.closed)return;const goodbye=this.peerId?this._publishSignal(this._base("bye",this.peerId)).catch(()=>{}):Promise.resolve();this.closed=true;clearInterval(this.helloTimer);clearInterval(this.heartbeatTimer);clearTimeout(this.errorTimer);clearTimeout(this.disconnectTimer);this.helloTimer=0;this.heartbeatTimer=0;this.errorTimer=0;this.disconnectTimer=0;try{this.subscription?.close?.("room leave");}catch{}try{this.pc?.close?.();}catch{}rooms.delete(this);for(const pending of this.pendingPings.values())pending.reject?.(Error("Direct UDP room closed"));this.pendingPings.clear();this.actions.clear();this.peerId="";this.pc=null;this.poseChannel=null;this.controlChannel=null;goodbye.finally(()=>closePoolIfIdle());}
}

export function joinRoom(config,roomId,callbacks={}){const id=String(roomId||"");if(!/^(?:net|tap)-/.test(id))throw Error("Direct UDP matchmaking requires an automatic network/proximity/gesture room");return new DirectUdpRoom(config,id,callbacks);}
