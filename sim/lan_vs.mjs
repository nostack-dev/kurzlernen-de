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

// Browsers cannot read the Wi-Fi SSID. A coarse nearby GPS cell is therefore only
// the zero-setup rendezvous key; once peers meet, flight pose traffic is WebRTC P2P.
// ~1.1 km latitude cells avoid two people on the same WLAN landing in adjacent
// 100 m cells because of normal phone GPS error.
export function nearbyRoomKey(latitude,longitude){
  if(!Number.isFinite(latitude)||!Number.isFinite(longitude))throw Error("GPS required for nearby matchmaking");
  return `geo-${latitude.toFixed(2)}-${longitude.toFixed(2)}`;
}
