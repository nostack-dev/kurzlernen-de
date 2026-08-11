const APP_ID="arondight45-kurzlernen-vs-v1";
const SEND_MS=50;

export class LanVsSession{
  constructor({onPeer,onPose,onLeave,onError}={}){this.room=null;this.sendPoseAction=null;this.timer=0;this.peerId=null;this.onPeer=onPeer;this.onPose=onPose;this.onLeave=onLeave;this.onError=onError;this.pendingPose=null;}
  async start(roomId){
    if(this.room)return;
    try{
      const {joinRoom}=await import("https://esm.run/trystero@0.25.1");
      const room=joinRoom({appId:APP_ID},roomId);
      this.room=room;
      const [sendPose,getPose]=room.makeAction("pose");this.sendPoseAction=sendPose;
      getPose((pose,peerId)=>{if(peerId===this.peerId||!this.peerId){this.peerId=peerId;this.onPeer?.(peerId);this.onPose?.(pose,peerId);}});
      room.onPeerJoin=peerId=>{if(!this.peerId){this.peerId=peerId;this.onPeer?.(peerId);}};
      room.onPeerLeave=peerId=>{if(peerId===this.peerId){this.peerId=null;this.onLeave?.(peerId);}};
      this.timer=setInterval(()=>{if(this.pendingPose&&this.sendPoseAction)this.sendPoseAction(this.pendingPose);},SEND_MS);
    }catch(error){this.stop();this.onError?.(error);throw error;}
  }
  setPose(pose){this.pendingPose=pose;}
  stop(){clearInterval(this.timer);this.timer=0;this.room?.leave?.();this.room=null;this.sendPoseAction=null;this.peerId=null;this.pendingPose=null;}
}

export function nearbyRoomKey(latitude,longitude){
  if(!Number.isFinite(latitude)||!Number.isFinite(longitude))return "training-nearby";
  // ~110 m cells: nearby matchmaking without exposing precise GPS in signalling.
  return `geo-${latitude.toFixed(3)}-${longitude.toFixed(3)}`;
}
