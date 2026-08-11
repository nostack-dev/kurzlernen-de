const APP_ID="arondight45-kurzlernen-vs-v3";
const SEND_MS=50;
const DEFAULT_LOADER=()=>import("trystero");

function finiteArray(value,length){return Array.isArray(value)&&value.length===length&&value.every(Number.isFinite);}
function validPose(pose){return Boolean(pose&&finiteArray(pose.p,3)&&finiteArray(pose.q,4)&&(!pose.g||finiteArray(pose.g,2)));}

export class LanVsSession{
  constructor({onPeer,onPose,onLeave,onError,loadTransport=DEFAULT_LOADER}={}){
    this.room=null;this.poseAction=null;this.timer=0;this.peerId=null;this.onPeer=onPeer;this.onPose=onPose;this.onLeave=onLeave;this.onError=onError;this.pendingPose=null;this.loadTransport=loadTransport;this.seq=0;this.lastRxSeq=0;this.sendBusy=false;
  }
  async start(roomId){
    if(this.room)return;
    if(typeof roomId!=="string"||!roomId)throw Error("VS room id required");
    try{
      const {joinRoom}=await this.loadTransport();
      if(typeof joinRoom!=="function")throw Error("VS transport unavailable");
      const room=joinRoom({appId:APP_ID},roomId);
      this.room=room;
      const poseAction=room.makeAction("pose");
      if(!poseAction||typeof poseAction.send!=="function")throw Error("VS pose action unavailable");
      this.poseAction=poseAction;
      poseAction.onMessage=(pose,{peerId}={})=>{
        if(!peerId||!validPose(pose))return;
        if(!this.peerId){this.peerId=peerId;this.lastRxSeq=0;this.onPeer?.(peerId);}
        if(peerId!==this.peerId)return;
        const seq=Number(pose.seq)||0;
        if(seq&&seq<=this.lastRxSeq)return;
        if(seq)this.lastRxSeq=seq;
        this.onPose?.(pose,peerId);
      };
      room.onPeerJoin=peerId=>{
        if(!peerId||this.peerId)return;
        this.peerId=peerId;this.lastRxSeq=0;this.onPeer?.(peerId);
      };
      room.onPeerLeave=peerId=>{
        if(peerId!==this.peerId)return;
        this.peerId=null;this.lastRxSeq=0;this.onLeave?.(peerId);
      };
      room.onJoinError=error=>this.onError?.(error instanceof Error?error:Error(String(error||"VS peer connection failed")));
      this.timer=setInterval(()=>this.flushPose(),SEND_MS);
    }catch(error){
      this.stop();this.onError?.(error);throw error;
    }
  }
  flushPose(){
    if(this.sendBusy||!this.peerId||!this.pendingPose||!this.poseAction)return;
    const packet={...this.pendingPose,seq:++this.seq};
    this.sendBusy=true;
    Promise.resolve(this.poseAction.send(packet,{target:this.peerId}))
      .catch(error=>this.onError?.(error))
      .finally(()=>{this.sendBusy=false;});
  }
  setPose(pose){
    if(!validPose(pose))return false;
    this.pendingPose={...pose,p:[...pose.p],q:[...pose.q],...(pose.g?{g:[...pose.g]}:{})};
    return true;
  }
  stop(){
    clearInterval(this.timer);this.timer=0;this.room?.leave?.();this.room=null;this.poseAction=null;this.peerId=null;this.pendingPose=null;this.seq=0;this.lastRxSeq=0;this.sendBusy=false;
  }
}

const NETWORK_IP_URL="https://api.ipify.org?format=json";

export async function sameNetworkRoomKey({fetchFn=globalThis.fetch,cryptoObj=globalThis.crypto}={}){
  if(typeof fetchFn!=="function")throw Error("Network lookup unavailable");
  if(!cryptoObj?.subtle)throw Error("Secure room hashing unavailable");
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),5000);
  try{
    const response=await fetchFn(NETWORK_IP_URL,{cache:"no-store",signal:controller.signal});
    if(!response?.ok)throw Error(`Network lookup failed (${response?.status||0})`);
    const data=await response.json();
    const ip=String(data?.ip||"").trim();
    if(!ip||ip.length>64||!/^[0-9a-fA-F:.]+$/.test(ip))throw Error("Network lookup returned invalid address");
    const bytes=new TextEncoder().encode(`arondight45-vs-network:${ip}`);
    const digest=new Uint8Array(await cryptoObj.subtle.digest("SHA-256",bytes));
    const key=[...digest.slice(0,12)].map(v=>v.toString(16).padStart(2,"0")).join("");
    return `net-${key}`;
  }finally{clearTimeout(timeout);}
}
