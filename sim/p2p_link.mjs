export const P2P_PROTOCOL = 5;
export const CONTROL_STALE_MS = 350;
export const SESSION_GRACE_MS = 5 * 60 * 1000;
export const P2P_MAX_GROUND_CLEARANCE_M = 50;

const clamp = (value,lo,hi) => Math.max(lo,Math.min(hi,value));
const rtcConfig = Object.freeze({iceServers:[],bundlePolicy:"max-bundle",iceCandidatePoolSize:4});

function assertWebRtc(){
  if(typeof RTCPeerConnection!=="function") throw new Error("This browser does not support WebRTC DataChannel.");
}

function bytesToBase64Url(bytes){
  let binary="";
  for(let i=0;i<bytes.length;i+=0x8000) binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
  return btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
}
function base64UrlToBytes(text){
  const normalized=String(text||"").trim().replace(/-/g,"+").replace(/_/g,"/");
  const padded=normalized+"=".repeat((4-normalized.length%4)%4);
  const binary=atob(padded),bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  return bytes;
}
export function encodeSignal(description){
  if(!description||!(description.type==="offer"||description.type==="answer")||typeof description.sdp!=="string") throw new Error("Invalid WebRTC description.");
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify({v:P2P_PROTOCOL,type:description.type,sdp:description.sdp})));
}
export function decodeSignal(code,expectedType){
  let value;
  try{value=JSON.parse(new TextDecoder().decode(base64UrlToBytes(code)));}catch{throw new Error("Invalid pairing code.");}
  if(value?.v!==P2P_PROTOCOL||value?.type!==expectedType||typeof value?.sdp!=="string"||!value.sdp.includes("m=application")) throw new Error(`Expected a P2P ${expectedType} code.`);
  return {type:value.type,sdp:value.sdp};
}

async function waitForIceComplete(pc,timeoutMs=10000){
  if(pc.iceGatheringState==="complete")return;
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{cleanup();reject(new Error("WebRTC ICE gathering timed out."));},timeoutMs);
    const check=()=>{if(pc.iceGatheringState==="complete"){cleanup();resolve();}};
    const cleanup=()=>{clearTimeout(timer);pc.removeEventListener("icegatheringstatechange",check);};
    pc.addEventListener("icegatheringstatechange",check);check();
  });
}
function newerSequence(a,b){return b===null||(a!==b&&(((a-b)>>>0)<0x80000000));}
function safeSend(channel,message){
  if(channel?.readyState!=="open")return false;
  if(channel.bufferedAmount>65536)return false;
  channel.send(JSON.stringify(message));return true;
}
function normalizedControl(control){
  const numeric=[control?.roll,control?.pitch,control?.yaw,control?.throttle,control?.bodyPitch].map(Number);
  if(!numeric.every(Number.isFinite))return null;
  const groundClearance=Number(control.groundClearance);
  return {
    roll:clamp(numeric[0],-1,1),pitch:clamp(numeric[1],-1,1),
    yaw:clamp(numeric[2],-1,1),throttle:clamp(numeric[3],0,1),bodyPitch:clamp(numeric[4],-1,1),
    arm:control.arm===true,gameMode:control.gameMode===true,
    groundClearance:Number.isFinite(groundClearance)?clamp(groundClearance,.5,P2P_MAX_GROUND_CLEARANCE_M):2,
  };
}
function latchedSafeControl(control){
  return {...control,roll:0,pitch:0,yaw:0,throttle:0,bodyPitch:0,arm:false};
}

class PeerBase{
  constructor(){
    this.pc=null;
    this.channel=null;
    this.onState=null;
    this.lastLinkedWall=0;
    this.everLinked=false;
  }
  // The DataChannel is the transport. RTCPeerConnection.connectionState may
  // transiently remain "disconnected" while SCTP is already passing fresh data.
  // Failed/closed are terminal; freshness is enforced independently by the
  // 350 ms control heartbeat on the VIEW side.
  get linked(){
    return this.channel?.readyState==="open"&&this.pc!=null&&!['failed','closed'].includes(this.pc.connectionState);
  }
  get recentlyLinked(){return this.everLinked&&performance.now()-this.lastLinkedWall<=SESSION_GRACE_MS;}
  get sessionRemainingMs(){return this.recentlyLinked?Math.max(0,SESSION_GRACE_MS-(performance.now()-this.lastLinkedWall)):0;}
  _markLinked(){
    if(this.linked){
      this.everLinked=true;
      this.lastLinkedWall=performance.now();
    }
  }
  _newPeer(){
    assertWebRtc();
    const pc=new RTCPeerConnection(rtcConfig);this.pc=pc;
    pc.onconnectionstatechange=()=>{this._markLinked();this._connectionChanged();this.onState?.();};
    pc.oniceconnectionstatechange=()=>this.onState?.();
    return pc;
  }
  _connectionChanged(){}
  _attachChannel(channel){
    if(this.channel&&this.channel!==channel&&this.channel.readyState!=="closed")try{this.channel.close();}catch{}
    this.channel=channel;channel.binaryType="arraybuffer";
    channel.onopen=()=>{this._markLinked();this.onState?.();};
    channel.onclose=()=>{if(this.channel===channel)this.channel=null;this._channelClosed();this.onState?.();};
    channel.onerror=()=>this.onState?.();
  }
  _channelClosed(){}
  async disconnect(){
    const channel=this.channel,pc=this.pc;this.channel=null;this.pc=null;
    try{channel?.close();}catch{}try{pc?.close();}catch{}
    this.lastLinkedWall=0;this.everLinked=false;
    this._channelClosed();this.onState?.();
  }
  stateLabel(){
    if(this.linked)return"P2P LINKED";
    if(this.pc&&this.recentlyLinked){
      const seconds=Math.ceil(this.sessionRemainingMs/1000);
      return`RECONNECTING · SESSION HELD ${seconds}s`;
    }
    if(this.pc)return`P2P ${String(this.pc.connectionState||"connecting").toUpperCase()}`;
    return"P2P DISCONNECTED";
  }
}

export class ViewPeerLink extends PeerBase{
  constructor(){super();this.control=null;this.lastControlWall=0;this.lastSequence=null;this.staleArmLatch=false;this.telemetrySequence=1;}
  _channelClosed(){
    if(this.control?.arm===true)this.staleArmLatch=true;
    this.control=null;this.lastControlWall=0;this.lastSequence=null;
  }
  _connectionChanged(){
    // "disconnected" is transient in WebRTC. Freshness is independently enforced by
    // CONTROL_STALE_MS, so only terminal peer states erase the last control sample here.
    if(!this.pc||["failed","closed"].includes(this.pc.connectionState)){
      if(this.control?.arm===true)this.staleArmLatch=true;
      this.control=null;this.lastControlWall=0;this.lastSequence=null;
    }
  }
  _attachChannel(channel){
    super._attachChannel(channel);
    channel.onmessage=event=>{
      let message;try{message=JSON.parse(event.data);}catch{return;}
      if(message?.type!=="control"||message.protocol!==P2P_PROTOCOL)return;
      const sequence=Number(message.sequence)>>>0;
      if(!newerSequence(sequence,this.lastSequence))return;
      const control=normalizedControl(message);if(!control)return;
      this.lastSequence=sequence;
      this.control=control;
      this.lastControlWall=performance.now();this._markLinked();this.onState?.();
    };
  }
  async acceptOffer(code){
    await this.disconnect();
    const pc=this._newPeer();pc.ondatachannel=event=>this._attachChannel(event.channel);
    await pc.setRemoteDescription(decodeSignal(code,"offer"));
    await pc.setLocalDescription(await pc.createAnswer());
    await waitForIceComplete(pc);
    return encodeSignal(pc.localDescription);
  }
  current(){
    if(!this.linked||!this.control)return null;
    if(performance.now()-this.lastControlWall>CONTROL_STALE_MS){
      if(this.control.arm===true)this.staleArmLatch=true;
      return null;
    }
    // A real stale/drop must never synthesize a fresh ARM low->high sequence that
    // automatically rearms the FC when the heartbeat resumes. Until the controller
    // explicitly publishes ARM=false once, expose only a fresh neutral/safe control.
    if(this.staleArmLatch){
      if(this.control.arm===true)return latchedSafeControl(this.control);
      this.staleArmLatch=false;
    }
    return this.control;
  }
  sendTelemetry(payload){return safeSend(this.channel,{type:"telemetry",protocol:P2P_PROTOCOL,...payload,telemetrySequence:(this.telemetrySequence++>>>0)});}
  async disconnect(){this.staleArmLatch=false;await super.disconnect();}
}

export class ControllerPeerLink extends PeerBase{
  constructor(){super();this.sequence=1;this.onTelemetry=null;this.reopenTimer=0;this.lastPublishedControl=null;this.lastTelemetrySequence=null;}
  _makeControlChannel(){
    if(!this.pc||this.pc.connectionState!=="connected"||this.channel?.readyState==="open"||this.channel?.readyState==="connecting")return;
    const channel=this.pc.createDataChannel("arondight45-control",{ordered:false,maxRetransmits:0});
    this._attachChannel(channel);
  }
  _connectionChanged(){
    if(this.pc?.connectionState==="connected"&&!this.channel){
      clearTimeout(this.reopenTimer);
      this.reopenTimer=setTimeout(()=>this._makeControlChannel(),80);
    }
  }
  _channelClosed(){
    clearTimeout(this.reopenTimer);
    if(this.pc?.connectionState==="connected")this.reopenTimer=setTimeout(()=>this._makeControlChannel(),120);
  }
  _attachChannel(channel){
    super._attachChannel(channel);
    channel.onmessage=event=>{
      let message;try{message=JSON.parse(event.data);}catch{return;}
      if(message?.type!=="telemetry"||message.protocol!==P2P_PROTOCOL)return;
      const telemetrySequence=Number(message.telemetrySequence);
      if(!Number.isInteger(telemetrySequence)||telemetrySequence<0||telemetrySequence>0xffffffff)return;
      const sequence=telemetrySequence>>>0;
      if(!newerSequence(sequence,this.lastTelemetrySequence))return;
      this.lastTelemetrySequence=sequence;
      this._markLinked();this.onTelemetry?.(message);
      // The normal 20 ms publisher remains primary. This telemetry-paced reply is
      // an independent keepalive tied to actual VIEW activity, so browser timer
      // throttling cannot create a false >350 ms control stale while the flight view
      // itself is demonstrably alive and exchanging telemetry.
      if(this.lastPublishedControl)this.publish(this.lastPublishedControl);
    };
  }
  async createOffer(){
    await this.disconnect();
    const pc=this._newPeer();
    const channel=pc.createDataChannel("arondight45-control",{ordered:false,maxRetransmits:0});this._attachChannel(channel);
    await pc.setLocalDescription(await pc.createOffer());
    await waitForIceComplete(pc);
    return encodeSignal(pc.localDescription);
  }
  async applyAnswer(code){
    if(!this.pc)throw new Error("Create an offer first.");
    await this.pc.setRemoteDescription(decodeSignal(code,"answer"));
  }
  publish(control){
    if(!this.channel&&this.pc?.connectionState==="connected")this._makeControlChannel();
    const normalized=normalizedControl(control);if(!normalized)return false;
    this.lastPublishedControl=normalized;
    return safeSend(this.channel,{
      type:"control",protocol:P2P_PROTOCOL,sequence:(this.sequence++>>>0),...normalized,
    });
  }
  async disconnect(){this.lastPublishedControl=null;this.lastTelemetrySequence=null;await super.disconnect();}
}

export async function copySignal(text){
  if(!text)throw new Error("No pairing code available.");
  await navigator.clipboard.writeText(text);
}
export async function shareSignal(title,text){
  if(!text)throw new Error("No pairing code available.");
  if(typeof navigator.share==="function")return navigator.share({title,text});
  return copySignal(text);
}
