const APP_ID="arondight45-kurzlernen-vs-v3";
const SEND_MS=50;
const FALLBACK_AFTER_MS=4500;
const DEFAULT_PRIMARY_LOADER=()=>import("trystero");
const DEFAULT_FALLBACK_LOADER=()=>import("@trystero-p2p/mqtt");

function finiteArray(value,length){return Array.isArray(value)&&value.length===length&&value.every(Number.isFinite);}
function validPose(pose){return Boolean(pose&&finiteArray(pose.p,3)&&finiteArray(pose.q,4)&&(!pose.g||finiteArray(pose.g,2)));}
function validOrigin(origin){return Boolean(origin&&Number.isFinite(origin.lon)&&Number.isFinite(origin.lat)&&Math.abs(origin.lon)<=180&&Math.abs(origin.lat)<=90&&(!("alt" in origin)||Number.isFinite(origin.alt)));}

export class LanVsSession{
  constructor(options={}){
    const customPrimary=Object.prototype.hasOwnProperty.call(options,"loadTransport");
    this.room=null;this.poseAction=null;this.originAction=null;this.timer=0;this.fallbackTimer=0;this.peerId=null;this.roomId="";this.transportGeneration=0;this.transportName="";this.switchingFallback=false;
    this.onPeer=options.onPeer;this.onPose=options.onPose;this.onOrigin=options.onOrigin;this.onLeave=options.onLeave;this.onError=options.onError;this.onTransport=options.onTransport;
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
    const oldRoom=this.room;++this.transportGeneration;this.room=null;this.poseAction=null;this.originAction=null;this.transportName="";
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
    const active=()=>generation===this.transportGeneration&&room===this.room;
    const adoptPeer=peerId=>{
      if(!active()||!peerId||this.peerId)return;
      this.peerId=peerId;this.lastRxSeq=0;this.originDirty=Boolean(this.pendingOrigin);clearTimeout(this.fallbackTimer);this.fallbackTimer=0;this.onPeer?.(peerId);
    };
    originAction.onMessage=(origin,{peerId}={})=>{if(!active()||!peerId||peerId!==this.peerId||!validOrigin(origin))return;this.onOrigin?.({...origin},peerId);};
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
  stop(){
    clearInterval(this.timer);clearTimeout(this.fallbackTimer);this.timer=0;this.fallbackTimer=0;++this.transportGeneration;try{this.room?.leave?.();}catch{}this.room=null;this.poseAction=null;this.originAction=null;this.peerId=null;this.roomId="";this.transportName="";this.switchingFallback=false;this.pendingPose=null;this.pendingOrigin=null;this.originDirty=false;this.seq=0;this.lastRxSeq=0;this.sendBusy=false;this.originBusy=false;
  }
}

const NETWORK_IP_URLS=["https://api4.ipify.org?format=json","https://api.ipify.org?format=json"];

async function hashRoomMaterial(material,cryptoObj){
  if(!cryptoObj?.subtle)throw Error("Secure room hashing unavailable");
  const bytes=new TextEncoder().encode(material);
  const digest=new Uint8Array(await cryptoObj.subtle.digest("SHA-256",bytes));
  return [...digest.slice(0,12)].map(v=>v.toString(16).padStart(2,"0")).join("");
}

export async function manualRoomKey(code,{cryptoObj=globalThis.crypto}={}){
  const normalized=String(code||"").trim().toUpperCase().replace(/[^A-Z0-9]/g,"");
  if(normalized.length<4||normalized.length>12)throw Error("Pair code must be 4-12 letters or digits");
  return `code-${await hashRoomMaterial(`arondight45-vs-code:${normalized}`,cryptoObj)}`;
}

export async function sameNetworkRoomKey({fetchFn=globalThis.fetch,cryptoObj=globalThis.crypto}={}){
  if(typeof fetchFn!=="function")throw Error("Network lookup unavailable");
  let lastError=null;
  for(const url of NETWORK_IP_URLS){
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),3500);
    try{
      const response=await fetchFn(url,{cache:"no-store",signal:controller.signal});
      if(!response?.ok)throw Error(`Network lookup failed (${response?.status||0})`);
      const data=await response.json();
      const ip=String(data?.ip||"").trim();
      if(!ip||ip.length>64||!/^[0-9a-fA-F:.]+$/.test(ip))throw Error("Network lookup returned invalid address");
      const key=await hashRoomMaterial(`arondight45-vs-network:${ip}`,cryptoObj);
      return `net-${key}`;
    }catch(error){lastError=error;}finally{clearTimeout(timeout);}
  }
  throw lastError||Error("Network lookup unavailable");
}
