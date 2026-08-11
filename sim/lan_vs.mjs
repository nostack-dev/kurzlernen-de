const APP_ID="arondight45-kurzlernen-vs-v3";
const SEND_MS=50;
const DEFAULT_LOADER=()=>import("trystero");

function finiteArray(value,length){return Array.isArray(value)&&value.length===length&&value.every(Number.isFinite);}
function validPose(pose){return Boolean(pose&&finiteArray(pose.p,3)&&finiteArray(pose.q,4)&&(!pose.g||finiteArray(pose.g,2)));}
function validOrigin(origin){return Boolean(origin&&Number.isFinite(origin.lon)&&Number.isFinite(origin.lat)&&Math.abs(origin.lon)<=180&&Math.abs(origin.lat)<=90&&(!("alt" in origin)||Number.isFinite(origin.alt)));}

export class LanVsSession{
  constructor({onPeer,onPose,onOrigin,onLeave,onError,loadTransport=DEFAULT_LOADER}={}){
    this.room=null;this.poseAction=null;this.originAction=null;this.timer=0;this.peerId=null;this.onPeer=onPeer;this.onPose=onPose;this.onOrigin=onOrigin;this.onLeave=onLeave;this.onError=onError;this.pendingPose=null;this.pendingOrigin=null;this.originDirty=false;this.loadTransport=loadTransport;this.seq=0;this.lastRxSeq=0;this.sendBusy=false;this.originBusy=false;
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
      const originAction=room.makeAction("origin");
      if(!originAction||typeof originAction.send!=="function")throw Error("VS origin action unavailable");
      this.originAction=originAction;
      originAction.onMessage=(origin,{peerId}={})=>{if(!peerId||peerId!==this.peerId||!validOrigin(origin))return;this.onOrigin?.({...origin},peerId);};
      poseAction.onMessage=(pose,{peerId}={})=>{
        if(!peerId||!validPose(pose))return;
        if(!this.peerId){this.peerId=peerId;this.lastRxSeq=0;this.originDirty=Boolean(this.pendingOrigin);this.onPeer?.(peerId);}
        if(peerId!==this.peerId)return;
        const seq=Number(pose.seq)||0;
        if(seq&&seq<=this.lastRxSeq)return;
        if(seq)this.lastRxSeq=seq;
        this.onPose?.(pose,peerId);
      };
      room.onPeerJoin=peerId=>{
        if(!peerId||this.peerId)return;
        this.peerId=peerId;this.lastRxSeq=0;this.originDirty=Boolean(this.pendingOrigin);this.onPeer?.(peerId);
      };
      room.onPeerLeave=peerId=>{
        if(peerId!==this.peerId)return;
        this.peerId=null;this.lastRxSeq=0;this.onLeave?.(peerId);
      };
      room.onJoinError=error=>this.onError?.(error instanceof Error?error:Error(String(error||"VS peer connection failed")));
      this.timer=setInterval(()=>{this.flushOrigin();this.flushPose();},SEND_MS);
    }catch(error){
      this.stop();this.onError?.(error);throw error;
    }
  }
  flushOrigin(){
    if(this.originBusy||!this.peerId||!this.pendingOrigin||!this.originDirty||!this.originAction)return;
    const packet={...this.pendingOrigin};this.originBusy=true;
    Promise.resolve(this.originAction.send(packet,{target:this.peerId}))
      .then(()=>{this.originDirty=false;})
      .catch(error=>this.onError?.(error))
      .finally(()=>{this.originBusy=false;});
  }
  flushPose(){
    if(this.sendBusy||!this.peerId||!this.pendingPose||!this.poseAction)return;
    const packet={...this.pendingPose,seq:++this.seq};
    this.sendBusy=true;
    Promise.resolve(this.poseAction.send(packet,{target:this.peerId}))
      .catch(error=>this.onError?.(error))
      .finally(()=>{this.sendBusy=false;});
  }
  setOrigin(origin){
    if(!validOrigin(origin))return false;
    const next={lon:Number(origin.lon),lat:Number(origin.lat),...(("alt" in origin)?{alt:Number(origin.alt)}:{})};
    const old=this.pendingOrigin;
    if(!old||old.lon!==next.lon||old.lat!==next.lat||old.alt!==next.alt){this.pendingOrigin=next;this.originDirty=true;}
    return true;
  }
  setPose(pose){
    if(!validPose(pose))return false;
    this.pendingPose={...pose,p:[...pose.p],q:[...pose.q],...(pose.g?{g:[...pose.g]}:{})};
    return true;
  }
  stop(){
    clearInterval(this.timer);this.timer=0;this.room?.leave?.();this.room=null;this.poseAction=null;this.originAction=null;this.peerId=null;this.pendingPose=null;this.pendingOrigin=null;this.originDirty=false;this.seq=0;this.lastRxSeq=0;this.sendBusy=false;this.originBusy=false;
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
