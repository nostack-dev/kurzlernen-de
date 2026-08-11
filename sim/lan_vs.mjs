const APP_ID="arondight45-kurzlernen-vs-v3";
const SEND_MS=50;
const FALLBACK_AFTER_MS=2200;
const DEFAULT_PRIMARY_LOADER=()=>import("trystero");
const DEFAULT_FALLBACK_LOADER=()=>import("@trystero-p2p/mqtt");
const DISCOVERY_MAX_ROOMS=8;
const PROXIMITY_CELL_M=800;
const GESTURE_BUCKET_MS=8000;
const GESTURE_DEFER_MS=650;
const GEO_DISCOVERY_TIMEOUT_MS=1800;
const GEO_DISCOVERY_MAX_AGE_MS=120000;
const EARTH_RADIUS_M=6378137;
const STUN_ICE_SERVERS=[
  {urls:["stun:stun.cloudflare.com:3478","stun:stun.cloudflare.com:53"]},
  {urls:"stun:stun.l.google.com:19302"}
];
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
function privateIpv4(value){
  if(!validIpv4(value))return false;
  const [a,b]=value.split(".").map(Number);
  return a===10||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===169&&b===254);
}
function ipv4Subnet24(value){
  if(!validIpv4(value))return null;
  const parts=value.split(".");return `${parts[0]}.${parts[1]}.${parts[2]}`;
}
function ipv6Parts(value){
  let raw=String(value||"").trim().toLowerCase();
  if(raw.startsWith("[")&&raw.endsWith("]"))raw=raw.slice(1,-1);
  raw=raw.split("%")[0];if(!raw.includes(":")||raw.includes("."))return null;
  const halves=raw.split("::");if(halves.length>2)return null;
  const left=halves[0]?halves[0].split(":"):[],right=halves.length===2&&halves[1]?halves[1].split(":"):[];
  if(!left.concat(right).every(part=>/^[0-9a-f]{1,4}$/.test(part)))return null;
  const missing=8-left.length-right.length;if(halves.length===1&&missing!==0)return null;if(halves.length===2&&missing<1)return null;
  const parts=[...left,...Array(Math.max(0,missing)).fill("0"),...right].map(part=>Number.parseInt(part||"0",16));
  return parts.length===8&&parts.every(v=>Number.isInteger(v)&&v>=0&&v<=0xffff)?parts:null;
}
function ipv6Prefix64(value){
  const parts=ipv6Parts(value);if(!parts)return null;
  return parts.slice(0,4).map(v=>v.toString(16).padStart(4,"0")).join(":");
}
function candidateRecord(candidate){
  if(!candidate)return null;
  let type=String(candidate.type||"").toLowerCase(),address=String(candidate.address||"").trim();
  if(!type||!address){const raw=String(candidate.candidate||candidate||"").trim(),parts=raw.split(/\s+/),typ=parts.indexOf("typ");if(typ>4){type=type||String(parts[typ+1]||"").toLowerCase();address=address||String(parts[4]||"").trim();}}
  return type&&address?{type,address}:null;
}
export function networkMaterialFromCandidate(candidate){
  const record=candidateRecord(candidate);if(!record)return null;const {type,address}=record;
  if(validIpv4(address)){if(type==="srflx")return `ipv4:${address}`;if(type==="host"&&privateIpv4(address))return `lan4p24:${ipv4Subnet24(address)}`;return null;}
  const prefix=ipv6Prefix64(address);if(prefix&&(type==="srflx"||type==="host"))return `ipv6p64:${prefix}`;return null;
}
function addExpandedNetworkMaterial(target,material){
  if(typeof material!=="string"||!material)return;
  target.add(material);
  if(material.startsWith("ipv4:")){
    const address=material.slice(5),prefix=ipv4Subnet24(address);
    if(prefix)target.add(`ipv4p24:${prefix}`);
  }
}
async function webRtcNetworkMaterials({RTCPeerConnectionCtor=globalThis.RTCPeerConnection}={}){
  if(typeof RTCPeerConnectionCtor!=="function")return[];let pc=null,timer=0;
  try{
    pc=new RTCPeerConnectionCtor({iceServers:STUN_ICE_SERVERS,iceCandidatePoolSize:2});pc.createDataChannel("vs-discovery");
    return await new Promise((resolve,reject)=>{const materials=new Set();let settled=false;const finish=()=>{if(settled)return;settled=true;clearTimeout(timer);resolve([...materials].sort());};timer=setTimeout(finish,3600);pc.onicecandidate=event=>{if(!event.candidate){finish();return;}const material=networkMaterialFromCandidate(event.candidate);if(material)addExpandedNetworkMaterial(materials,material);};Promise.resolve(pc.createOffer()).then(offer=>pc.setLocalDescription(offer)).catch(reject);});
  }catch{return[];}finally{clearTimeout(timer);try{pc?.close?.();}catch{}}
}
function normalizePosition(value){
  const source=value?.coords||value||{},longitude=Number(source.longitude),latitude=Number(source.latitude);
  return Number.isFinite(longitude)&&Number.isFinite(latitude)&&Math.abs(longitude)<=180&&Math.abs(latitude)<=85?{longitude,latitude}:null;
}
async function browserPosition({geolocation=globalThis.navigator?.geolocation}={}){
  if(!geolocation||typeof geolocation.getCurrentPosition!=="function")return null;
  return await new Promise(resolve=>{
    let settled=false;const finish=value=>{if(settled)return;settled=true;resolve(normalizePosition(value));};
    try{geolocation.getCurrentPosition(finish,()=>finish(null),{enableHighAccuracy:false,timeout:GEO_DISCOVERY_TIMEOUT_MS,maximumAge:GEO_DISCOVERY_MAX_AGE_MS});}catch{finish(null);}
  });
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

export class LanVsFinder{
  constructor(options={}){this.options=options;this.children=[];this.active=null;this.roomIds=[];this.pendingPose=null;this.pendingOrigin=null;this.started=false;this.failedChildren=new Set();this.gestureDeferMs=Number.isFinite(options.gestureDeferMs)?Math.max(0,Number(options.gestureDeferMs)):GESTURE_DEFER_MS;}
  makeChild(roomId){
    let child=null;const opts=this.options;
    child=new LanVsSession({
      ...(Object.prototype.hasOwnProperty.call(opts,"loadTransport")?{loadTransport:opts.loadTransport}:{}),
      ...(Object.prototype.hasOwnProperty.call(opts,"loadFallbackTransport")?{loadFallbackTransport:opts.loadFallbackTransport}:{}),
      ...(Number.isFinite(opts.fallbackAfterMs)?{fallbackAfterMs:opts.fallbackAfterMs}:{}),
      onTransport:name=>{if(!this.active||this.active===child)opts.onTransport?.(name,roomId);},
      onPeer:peerId=>this.adopt(child,peerId,roomId),
      onPose:(pose,peerId)=>{if(this.active===child)opts.onPose?.(pose,peerId);},
      onOrigin:(origin,peerId)=>{if(this.active===child)opts.onOrigin?.(origin,peerId);},
      onCombat:(packet,peerId)=>{if(this.active===child)opts.onCombat?.(packet,peerId);},
      onLeave:peerId=>{if(this.active===child)opts.onLeave?.(peerId);},
      onError:error=>{if(this.active===child)opts.onError?.(error);else{this.failedChildren.add(child);if(!this.active&&this.children.length&&this.failedChildren.size>=this.children.length)opts.onError?.(error);}}
    });
    if(this.pendingPose)child.setPose(this.pendingPose);if(this.pendingOrigin)child.setOrigin(this.pendingOrigin);return child;
  }
  adopt(child,peerId,roomId){
    if(this.active&&this.active!==child){child.stop();return;}
    if(!this.active){this.active=child;for(const other of this.children)if(other!==child)other.stop();this.children=[child];this.failedChildren.clear();}
    this.options.onPeer?.(peerId,roomId);
  }
  async start(roomIds){
    if(this.started)return;
    this.started=true;
    const ids=[...new Set((Array.isArray(roomIds)?roomIds:[roomIds]).filter(id=>typeof id==="string"&&id))].slice(0,DISCOVERY_MAX_ROOMS);
    if(!ids.length){this.started=false;throw Error("VS discovery produced no room candidates");}
    this.roomIds=ids;
    const entries=ids.map(id=>({id,child:this.makeChild(id)}));
    this.children=entries.map(entry=>entry.child);
    const trusted=entries.filter(entry=>!entry.id.startsWith("tap-")),gesture=entries.filter(entry=>entry.id.startsWith("tap-"));
    const results=[];
    const startEntries=async list=>{if(!list.length)return[];return Promise.allSettled(list.map(entry=>entry.child.start(entry.id)));};
    results.push(...await startEntries(trusted));
    if(!this.active&&gesture.length){
      await new Promise(resolve=>setTimeout(resolve,this.gestureDeferMs));
      if(this.started&&!this.active)results.push(...await startEntries(gesture));
    }
    if(!this.active&&this.started&&results.length&&results.every(result=>result.status==="rejected")){
      const reason=results.find(result=>result.status==="rejected")?.reason||Error("VS signaling unavailable");this.stop();throw reason;
    }
  }
  setOrigin(origin){if(!validOrigin(origin))return false;this.pendingOrigin={...origin};for(const child of this.active?[this.active]:this.children)child.setOrigin(origin);return true;}
  setPose(pose){if(!validPose(pose))return false;this.pendingPose={...pose,p:[...pose.p],q:[...pose.q],...(pose.g?{g:[...pose.g]}:{})};for(const child of this.active?[this.active]:this.children)child.setPose(pose);return true;}
  sendCombat(packet){return this.active?.sendCombat(packet)||false;}
  stop(){for(const child of this.children)child.stop();this.children=[];this.active=null;this.roomIds=[];this.pendingPose=null;this.pendingOrigin=null;this.started=false;this.failedChildren.clear();}
}

async function hashRoomMaterial(material,cryptoObj){
  if(!cryptoObj?.subtle)throw Error("Secure room hashing unavailable");
  const bytes=new TextEncoder().encode(material);
  const digest=new Uint8Array(await cryptoObj.subtle.digest("SHA-256",bytes));
  return [...digest.slice(0,12)].map(v=>v.toString(16).padStart(2,"0")).join("");
}

export async function gestureRoomKeys({gestureTimeMs=Date.now(),cryptoObj=globalThis.crypto}={}){
  const time=Number(gestureTimeMs);if(!Number.isFinite(time)||time<0)return[];
  const bucket=Math.floor(time/GESTURE_BUCKET_MS),keys=[];
  for(const slot of [bucket,bucket-1]){
    const key=await hashRoomMaterial(`arondight45-vs-discovery-v6:gesture:${GESTURE_BUCKET_MS}:${slot}`,cryptoObj);keys.push(`tap-${key}`);
  }
  return [...new Set(keys)];
}

export async function sameNetworkRoomKeys({fetchFn=globalThis.fetch,cryptoObj=globalThis.crypto,networkMaterialsFn=webRtcNetworkMaterials}={}){
  const materials=new Set();let lastError=null;
  try{for(const material of await networkMaterialsFn?.()||[])addExpandedNetworkMaterial(materials,material);}catch(error){lastError=error;}
  if(typeof fetchFn==="function"){
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),3500);
    try{const response=await fetchFn(NETWORK_IPV4_URL,{cache:"no-store",signal:controller.signal});if(!response?.ok)throw Error(`Network lookup failed (${response?.status||0})`);const data=await response.json(),address=String(data?.ip||"").trim();if(!validIpv4(address))throw Error("Network lookup returned invalid IPv4 address");addExpandedNetworkMaterial(materials,`ipv4:${address}`);}catch(error){lastError=error;}finally{clearTimeout(timeout);}
  }
  if(!materials.size)throw lastError||Error("Could not determine shared network identity");const keys=[];for(const material of [...materials].sort()){const key=await hashRoomMaterial(`arondight45-vs-discovery-v5:${material}`,cryptoObj);keys.push(`net-${key}`);}return [...new Set(keys)];
}
export async function sameNetworkRoomKey(options={}){const keys=await sameNetworkRoomKeys(options);return keys[0];}
export async function proximityRoomKeys({longitude,latitude,cryptoObj=globalThis.crypto}={}){
  if(!Number.isFinite(longitude)||!Number.isFinite(latitude)||Math.abs(longitude)>180||Math.abs(latitude)>85)return[];const lonRad=longitude*Math.PI/180,latRad=latitude*Math.PI/180,x=EARTH_RADIUS_M*lonRad,y=EARTH_RADIUS_M*Math.log(Math.tan(Math.PI/4+latRad/2)),half=PROXIMITY_CELL_M/2,shifts=[[0,0],[half,0],[0,half],[half,half]],keys=[];
  for(let i=0;i<shifts.length;i++){const [sx,sy]=shifts[i],ix=Math.floor((x+sx)/PROXIMITY_CELL_M),iy=Math.floor((y+sy)/PROXIMITY_CELL_M),key=await hashRoomMaterial(`arondight45-vs-discovery-v5:geo:${PROXIMITY_CELL_M}:${i}:${ix}:${iy}`,cryptoObj);keys.push(`net-${key}`);}return [...new Set(keys)];
}
export async function discoveryRoomKeys({longitude,latitude,fetchFn=globalThis.fetch,cryptoObj=globalThis.crypto,networkMaterialsFn=webRtcNetworkMaterials,positionFn=browserPosition,gestureTimeMs=Date.now()}={}){
  const gesturePromise=gestureRoomKeys({gestureTimeMs,cryptoObj});
  let position=normalizePosition({longitude,latitude});
  if(!position&&typeof positionFn==="function"){
    try{position=normalizePosition(await positionFn());}catch{}
  }
  const [gesture,geo,network]=await Promise.all([
    gesturePromise,
    position?proximityRoomKeys({...position,cryptoObj}):Promise.resolve([]),
    sameNetworkRoomKeys({fetchFn,cryptoObj,networkMaterialsFn}).catch(()=>[])
  ]);
  const trusted=[...new Set([...geo,...network])].slice(0,Math.max(0,DISCOVERY_MAX_ROOMS-gesture.length));
  const keys=[...trusted,...gesture];if(!keys.length)throw Error("No automatic proximity/network/gesture discovery path available");return [...new Set(keys)].slice(0,DISCOVERY_MAX_ROOMS);
}
