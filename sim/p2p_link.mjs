export const P2P_PROTOCOL = 2;
export const CONTROL_STALE_MS = 350;

const clamp = (value,lo,hi) => Math.max(lo,Math.min(hi,value));
const rtcConfig = Object.freeze({iceServers:[],bundlePolicy:"max-bundle"});

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

class PeerBase{
  constructor(){this.pc=null;this.channel=null;this.onState=null;}
  get linked(){return this.channel?.readyState==="open"&&this.pc?.connectionState==="connected";}
  _newPeer(){
    assertWebRtc();
    const pc=new RTCPeerConnection(rtcConfig);this.pc=pc;
    pc.onconnectionstatechange=()=>{this._connectionChanged();this.onState?.();};
    pc.oniceconnectionstatechange=()=>this.onState?.();
    return pc;
  }
  _connectionChanged(){}
  _attachChannel(channel){
    this.channel=channel;channel.binaryType="arraybuffer";
    channel.onopen=()=>this.onState?.();channel.onclose=()=>{this._channelClosed();this.onState?.();};channel.onerror=()=>this.onState?.();
  }
  _channelClosed(){}
  async disconnect(){
    const channel=this.channel,pc=this.pc;this.channel=null;this.pc=null;
    try{channel?.close();}catch{}try{pc?.close();}catch{}
    this._channelClosed();this.onState?.();
  }
  stateLabel(){
    if(this.linked)return"P2P LINKED";
    if(this.pc)return`P2P ${String(this.pc.connectionState||"connecting").toUpperCase()}`;
    return"P2P DISCONNECTED";
  }
}

export class ViewPeerLink extends PeerBase{
  constructor(){super();this.control=null;this.lastControlWall=0;this.lastSequence=null;}
  _channelClosed(){this.control=null;this.lastControlWall=0;this.lastSequence=null;}
  _connectionChanged(){if(!this.pc||["failed","disconnected","closed"].includes(this.pc.connectionState))this._channelClosed();}
  _attachChannel(channel){
    super._attachChannel(channel);
    channel.onmessage=event=>{
      let message;try{message=JSON.parse(event.data);}catch{return;}
      if(message?.type!=="control"||message.protocol!==P2P_PROTOCOL)return;
      const sequence=Number(message.sequence)>>>0;
      if(!newerSequence(sequence,this.lastSequence))return;
      const numeric=[message.roll,message.pitch,message.yaw,message.throttle].map(Number);
      if(!numeric.every(Number.isFinite))return;
      this.lastSequence=sequence;
      this.control={roll:clamp(numeric[0],-1,1),pitch:clamp(numeric[1],-1,1),yaw:clamp(numeric[2],-1,1),throttle:clamp(numeric[3],0,1),arm:message.arm===true};
      this.lastControlWall=performance.now();this.onState?.();
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
  current(){return this.linked&&this.control&&performance.now()-this.lastControlWall<=CONTROL_STALE_MS?this.control:null;}
  sendTelemetry(payload){return safeSend(this.channel,{type:"telemetry",protocol:P2P_PROTOCOL,...payload});}
}

export class ControllerPeerLink extends PeerBase{
  constructor(){super();this.sequence=1;this.onTelemetry=null;}
  _attachChannel(channel){
    super._attachChannel(channel);
    channel.onmessage=event=>{
      let message;try{message=JSON.parse(event.data);}catch{return;}
      if(message?.type!=="telemetry"||message.protocol!==P2P_PROTOCOL)return;
      this.onTelemetry?.(message);
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
  publish(control,force=false){
    const numeric=[control.roll,control.pitch,control.yaw,control.throttle].map(Number);
    if(!numeric.every(Number.isFinite))return false;
    return safeSend(this.channel,{type:"control",protocol:P2P_PROTOCOL,sequence:(this.sequence++>>>0),roll:clamp(numeric[0],-1,1),pitch:clamp(numeric[1],-1,1),yaw:clamp(numeric[2],-1,1),throttle:clamp(numeric[3],0,1),arm:control.arm===true,force});
  }
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
