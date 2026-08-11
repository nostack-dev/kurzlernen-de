const APP_ID="arondight45-kurzlernen-vs-v2";
const SEND_MS=50;
const DEFAULT_LOADER=()=>import("https://esm.run/trystero@0.25.1");

export class LanVsSession{
  constructor({onPeer,onPose,onLeave,onError,loadTransport=DEFAULT_LOADER}={}){
    this.room=null;this.sendPoseAction=null;this.timer=0;this.peerId=null;this.onPeer=onPeer;this.onPose=onPose;this.onLeave=onLeave;this.onError=onError;this.pendingPose=null;this.loadTransport=loadTransport;this.seq=0;
  }
  async start(roomId){
    if(this.room)return;
    if(typeof roomId!=="string"||!roomId)throw Error("VS room id required");
    try{
      const {joinRoom}=await this.loadTransport();
      if(typeof joinRoom!=="function")throw Error("VS transport unavailable");
      const room=joinRoom({appId:APP_ID},roomId);
      this.room=room;
      const [sendPose,getPose]=room.makeAction("pose");
      this.sendPoseAction=sendPose;
      getPose((pose,peerId)=>{
        if(!peerId)return;
        if(!this.peerId){this.peerId=peerId;this.onPeer?.(peerId);}
        if(peerId===this.peerId)this.onPose?.(pose,peerId);
      });
      room.onPeerJoin(peerId=>{
        if(!this.peerId){this.peerId=peerId;this.onPeer?.(peerId);}
      });
      room.onPeerLeave(peerId=>{
        if(peerId===this.peerId){this.peerId=null;this.onLeave?.(peerId);}
      });
      this.timer=setInterval(()=>{
        if(this.pendingPose&&this.sendPoseAction)this.sendPoseAction({...this.pendingPose,seq:++this.seq});
      },SEND_MS);
    }catch(error){
      this.stop();this.onError?.(error);throw error;
    }
  }
  setPose(pose){
    if(!pose||!Array.isArray(pose.p)||pose.p.length!==3||!Array.isArray(pose.q)||pose.q.length!==4)return;
    this.pendingPose=pose;
  }
  stop(){
    clearInterval(this.timer);this.timer=0;this.room?.leave?.();this.room=null;this.sendPoseAction=null;this.peerId=null;this.pendingPose=null;this.seq=0;
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
