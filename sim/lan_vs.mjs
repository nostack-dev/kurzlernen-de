const APP_ID="arondight45-kurzlernen-vs-v3";
const SEND_MS=50;
const FALLBACK_AFTER_MS=4500;
const DEFAULT_PRIMARY_LOADER=()=>import("trystero");
const DEFAULT_FALLBACK_LOADER=()=>import("@trystero-p2p/mqtt");
const STUN_ICE_SERVERS=[{urls:["stun:stun.cloudflare.com:3478","stun:stun.cloudflare.com:53"]}];
const NETWORK_IPV4_URL="https://api4.ipify.org?format=json";

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
function srflxIpv4(candidate){
  if(!candidate)return null;
  if(candidate.type==="srflx"&&validIpv4(candidate.address))return candidate.address;
  const raw=String(candidate.candidate||candidate||"").trim(),parts=raw.split(/\s+/),typ=parts.indexOf("typ");
  return typ>4&&parts[typ+1]==="srflx"&&validIpv4(parts[4])?parts[4]:null;
}

async function webRtcNatIpv4({RTCPeerConnectionCtor=globalThis.RTCPeerConnection}={}){
  if(typeof RTCPeerConnectionCtor!=="function")return null;
  let pc=null,timer=0;
  try{
    pc=new RTCPeerConnectionCtor({iceServers:STUN_ICE_SERVERS,iceCandidatePoolSize:1});
    pc.createDataChannel("vs-discovery");
    return await new Promise((resolve,reject)=>{
      let settled=false;
      const finish=value=>{if(settled)return;settled=true;clearTimeout(timer);resolve(value||null);};
      timer=setTimeout(()=>finish(null),2600);
      pc.onicecandidate=event=>{
        const ip=srflxIpv4(event.candidate);
        if(ip)finish(ip);else if(!event.candidate)finish(null);
      };
      Promise.resolve(pc.createOffer())
        .then(offer=>pc.setLocalDescription(offer))
        .catch(reject);
    });
  }catch{return null;}finally{clearTimeout(timer);try{pc?.close?.();}catch{}}
}

export class LanVsSession{
  constructor(options={}){
    const customPrimary=Object.prototype.hasOwnProperty.call(options,"loadTransport");
    this.room=null;this.poseAction=null;this.originAction=null;this.combatAction=null;this.timer=0;this.fallbackTimer=0;this.peerId=null;this.roomId="";this.transportGeneration=0;this.transportName="";this.switchingFallback=false;
    this.onPeer=options.onPeer;this.onPose=options.onPose;this.onOrigin=options.onOrigin;this.onCombat=options.onCombat;this.onLeave=options.onLeave;this.onError=options.onError;this.onTransport=options.onTransport;
    this.pendingPose=null;this.pendingOrigin=null;this.originDirty=false;this.seq=0;this.lastRxSeq=0;this.sendBusy=false;this.originBusy=false;
    this.loadTransport=options.loadTransport||DEFAULT_PRIMARY_LOADER;
    this.loadFallbackTransport=Object.prototype.hasOwnProperty.call(options,"loadFallbackTransport")?options.loadFallbackTransport:(customPrimary?null:DEFAULT_FALLBACK_LOADER);
    this.fallbackAfterMs=Number.isFinite(options.fallbackAfterMs)?Math.max(0,Number(options.fallbackAfterMs)):FALLBACK_AFTER_MS;
  }
  async start(roomId){
    if(this.room||this.switchingFallback)return;
    if(typeof roomId!=="string"||!roomId)throw Error("VS room id required");
    this.roomId=roomId;
    if(!this.timer)this.timer=setInterval(()=>{this.flushOrigin();this.flushPose();},SEND_MS);
    try{
      await this.openTransport(this.loadTransport,"Nostr");
      this.armFallback();
    }catch(error){
      if(this.loadFallbackTransport){
        await this.switchToFallback(error);
      }else{
        this.stop();this.onError?.(error);throw error;
      }
    }
  }
  armFallback(){
    clearTimeout(this.fallbackTimer);this.fallbackTimer=0;
    if(!this.loadFallbackTransport||this.peerId||this.transportName!=="Nostr")return;
    this.fallbackTimer=setTimeout(()=>{if(!this.peerId)this.switchToFallback();},this.fallbackAfterMs);
  }
  async switchToFallback(primaryError=null){
    if(this.switchingFallback||this.peerId||!this.loadFallbackTransport||!this.roomId)return;
    this.switchingFallback=true;clearTimeout(this.fallbackTimer);this.fallbackTimer=0;
    const oldRoom=this.room;++this.transportGeneration;this.room=null;this.poseAction=null;this.originAction=null;this.combatAction=null;this.transportName="";
    try{oldRoom?.leave?.();}catch{}
    try{
      await this.openTransport(this.loadFallbackTransport,"MQTT");
    }catch(error){
      this.onError?.(error instanceof Error?error:Error(String(error||primaryError||"VS signaling unavailable")));
    }finally{this.switchingFallback=false;}
  }
  async openTransport(loader,name){
    if(typeof loader!=="function")throw Error("VS transport unavailable");
    const generation=++this.transportGeneration;
    this.onTransport?.(name);
    const {joinRoom}=await loader();
    if(generation!==this.transportGeneration)return;
    if(typeof joinRoom!=="function")throw Error(`${name} VS transport unavailable`);
    const room=joinRoom({appId:APP_ID},this.roomId);
    if(generation!==this.transportGeneration){try{room?.leave?.();}catch{}return;}
    this.room=room;this.transportName=name;
    const poseAction=room.makeAction("pose");
    if(!poseAction||typeof poseAction.send!=="function")throw Error("VS pose action unavailable");
    this.poseAction=poseAction;
    const originAction=room.makeAction("origin");
    if(!originAction||typeof originAction.send!=="function")throw Error("VS origin action unavailable");
    this.originAction=originAction;
    const combatAction=room.makeAction("combat");
    if(!combatAction||typeof combatAction.send!=="function")throw Error("VS combat action unavailable");
    this.combatAction=combatAction;
    const active=()=>generation===this.transportGeneration&&room===this.room;
    const adoptPeer=peerId=>{
      if(!active()||!peerId||this.peerId)return;
      this.peerId=peerId;this.lastRxSeq=0;this.originDirty=Boolean(this.pendingOrigin);clearTimeout(this.fallbackTimer);this.fallbackTimer=0;this.onPeer?.(peerId);
    };
    originAction.onMessage=(origin,{peerId}={})=>{if(!active()||!peerId||peerId!==this.peerId||!validOrigin(origin))return;this.onOrigin?.({...origin},peerId);};
    combatAction.onMessage=(packet,{peerId}={})=>{if(!active()||!peerId||!validCombat(packet))return;if(!this.peerId)adoptPeer(peerId);if(peerId!==this.peerId)return;this.onCombat?.({...packet},peerId);};
    poseAction.onMessage=(pose,{peerId}={})=>{
      if(!active()||!peerId||!validPose(pose))return;
      if(!this.peerId)adoptPeer(peerId);
      if(peerId!==this.peerId)return;
      const seq=Number(pose.seq)||0;
      if(seq&&seq<=this.lastRxSeq)return;
      if(seq)this.lastRxSeq=seq;
      this.onPose?.(pose,peerId);
    };
    room.onPeerJoin=peerId=>adoptPeer(peerId);
    room.onPeerLeave=peerId=>{
      if(!active()||peerId!==this.peerId)return;
      this.peerId=null;this.lastRxSeq=0;this.onLeave?.(peerId);
    };
    room.onJoinError=error=>{
      if(!active())return;
      const normalized=error instanceof Error?error:Error(String(error||"VS peer connection failed"));
      if(name==="Nostr"&&this.loadFallbackTransport&&!this.peerId)this.switchToFallback(normalized);
      else this.onError?.(normalized);
    };
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
  sendCombat(packet){
    if(!validCombat(packet)||!this.peerId||!this.combatAction)return false;
    Promise.resolve(this.combatAction.send({...packet},{target:this.peerId})).catch(error=>this.onError?.(error));
    return true;
  }
  stop(){
    clearInterval(this.timer);clearTimeout(this.fallbackTimer);this.timer=0;this.fallbackTimer=0;++this.transportGeneration;try{this.room?.leave?.();}catch{}this.room=null;this.poseAction=null;this.originAction=null;this.combatAction=null;this.peerId=null;this.roomId="";this.transportName="";this.switchingFallback=false;this.pendingPose=null;this.pendingOrigin=null;this.originDirty=false;this.seq=0;this.lastRxSeq=0;this.sendBusy=false;this.originBusy=false;
  }
}

async function hashRoomMaterial(material,cryptoObj){
  if(!cryptoObj?.subtle)throw Error("Secure room hashing unavailable");
  const bytes=new TextEncoder().encode(material);
  const digest=new Uint8Array(await cryptoObj.subtle.digest("SHA-256",bytes));
  return [...digest.slice(0,12)].map(v=>v.toString(16).padStart(2,"0")).join("");
}

export async function sameNetworkRoomKey({fetchFn=globalThis.fetch,cryptoObj=globalThis.crypto,natAddressFn=webRtcNatIpv4}={}){
  let address=null,lastError=null;
  try{address=await natAddressFn?.();}catch(error){lastError=error;}
  if(!validIpv4(address)){
    if(typeof fetchFn!=="function")throw lastError||Error("Network lookup unavailable");
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),3500);
    try{
      const response=await fetchFn(NETWORK_IPV4_URL,{cache:"no-store",signal:controller.signal});
      if(!response?.ok)throw Error(`Network lookup failed (${response?.status||0})`);
      const data=await response.json();address=String(data?.ip||"").trim();
      if(!validIpv4(address))throw Error("Network lookup returned invalid IPv4 address");
    }catch(error){lastError=error;}finally{clearTimeout(timeout);}
  }
  if(!validIpv4(address))throw lastError||Error("Could not determine shared network address");
  const key=await hashRoomMaterial(`arondight45-vs-network:${address}`,cryptoObj);
  return `net-${key}`;
}
