export const FLIGHT_LOGBOOK_KEY="arondight45FlightLogbookV1";
export const NETWORK_LOG_KEY="arondight45NetworkLogV1";
const VS_NETWORK_EVENT="arondight45:vs-network";
const MAX_FLIGHTS=50;
const MAX_NETWORK_EVENTS=120;
const PATH_INTERVAL_S=.5;
const MAX_PATH_POINTS=600;
const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
const finite=(...values)=>values.every(Number.isFinite);
const escapeHtml=value=>String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));

function loadJsonArray(key,max){try{const raw=JSON.parse(localStorage.getItem(key)||"[]");return Array.isArray(raw)?raw.slice(0,max):[];}catch{return[];}}
function saveJsonArray(key,entries,max){try{localStorage.setItem(key,JSON.stringify(entries.slice(0,max)));}catch{}}
function loadEntries(){return loadJsonArray(FLIGHT_LOGBOOK_KEY,MAX_FLIGHTS);}
function saveEntries(entries){saveJsonArray(FLIGHT_LOGBOOK_KEY,entries,MAX_FLIGHTS);}
function loadNetworkEvents(){return loadJsonArray(NETWORK_LOG_KEY,MAX_NETWORK_EVENTS);}
function saveNetworkEvents(entries){saveJsonArray(NETWORK_LOG_KEY,entries,MAX_NETWORK_EVENTS);}
function downloadJson(name,value){
  const blob=new Blob([JSON.stringify(value,null,2)],{type:"application/json"}),url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function bodyVelocity(sample){
  const yaw=(Number(sample.yawDeg)||0)*Math.PI/180,c=Math.cos(yaw),s=Math.sin(yaw),vx=Number(sample.vx)||0,vy=Number(sample.vy)||0;
  return{forward:-c*vx-s*vy,right:-s*vx+c*vy};
}
function reasonLabel(reason){return String(reason||"FC_DISARM").replaceAll("_"," ");}
function durationText(seconds){const s=Math.max(0,Number(seconds)||0),m=Math.floor(s/60),r=s-m*60;return m?`${m}m ${r.toFixed(1)}s`:`${r.toFixed(1)}s`;}
function compactId(value){const text=String(value||"");return text.length>18?`${text.slice(0,8)}…${text.slice(-6)}`:text;}
function normalizeNetworkEvent(detail={}){
  const value=detail&&typeof detail==="object"?detail:{};
  return{
    at:String(value.at||new Date().toISOString()),stage:String(value.stage||"network"),transport:String(value.transport||""),roomId:String(value.roomId||""),peerId:String(value.peerId||""),
    error:String(value.error||""),relayRedundancy:Number(value.relayRedundancy)||0,rttMs:Number.isFinite(Number(value.rttMs))?Number(value.rttMs):null,
    connectionState:String(value.connectionState||""),iceConnectionState:String(value.iceConnectionState||""),iceGatheringState:String(value.iceGatheringState||""),signalingState:String(value.signalingState||""),
    address:String(value.address||""),candidateType:String(value.candidateType||""),material:String(value.material||""),
    materials:Array.isArray(value.materials)?value.materials.map(String).slice(0,12):[],roomIds:Array.isArray(value.roomIds)?value.roomIds.map(String).slice(0,12):[],
    relays:Array.isArray(value.relays)?value.relays.slice(0,12).map(item=>({url:String(item?.url||""),state:String(item?.state||"")})):[],
    selectedPair:value.selectedPair&&typeof value.selectedPair==="object"?value.selectedPair:null,
    roomCount:Number(value.roomCount)||0,trustedRooms:Number(value.trustedRooms)||0,gestureRooms:Number(value.gestureRooms)||0,
    transportNames:Array.isArray(value.transportNames)?value.transportNames.map(String).slice(0,8):[]
  };
}
function networkSignature(event){const copy={...event,at:""};return JSON.stringify(copy);}
function pairText(pair){
  if(!pair)return"";const local=pair.local||{},remote=pair.remote||{};
  const endpoint=value=>[value.candidateType,value.protocol,value.address,value.port||""].filter(Boolean).join("/");
  const a=endpoint(local),b=endpoint(remote);return a||b?`PAIR ${a||"?"} ↔ ${b||"?"}`:"";
}
function networkDetailText(event){
  const parts=[];
  if(event.error)parts.push(`ERROR ${event.error}`);
  if(event.connectionState||event.iceConnectionState)parts.push(`PC ${event.connectionState||"—"} · ICE ${event.iceConnectionState||"—"}`);
  if(event.iceGatheringState||event.signalingState)parts.push(`GATHER ${event.iceGatheringState||"—"} · SDP ${event.signalingState||"—"}`);
  if(event.rttMs!==null)parts.push(`RTT ${event.rttMs.toFixed(1)} ms`);
  if(event.address||event.candidateType||event.material)parts.push([event.candidateType,event.address,event.material].filter(Boolean).join(" · "));
  if(event.materials.length)parts.push(`NET ${event.materials.join(", ")}`);
  if(event.relays.length)parts.push(`RELAYS ${event.relays.map(item=>`${item.state} ${item.url}`).join(" | ")}`);
  const pair=pairText(event.selectedPair);if(pair)parts.push(pair);
  if(event.roomCount)parts.push(`ROOMS ${event.roomCount} · TRUSTED ${event.trustedRooms} · TAP ${event.gestureRooms}`);
  if(event.transportNames.length)parts.push(`TRANSPORTS ${event.transportNames.join("+")}`);
  return parts.join(" · ")||"—";
}

export class FlightLogbook{
  constructor({parent=null}={}){
    this.entries=loadEntries();this.networkEvents=loadNetworkEvents();this.active=null;this.lastArmed=false;this.button=null;this.dialog=null;this.list=null;this.networkList=null;this.lastNetworkSignature="";this.lastNetworkAt=0;
    this.networkListener=event=>this.recordNetwork(event?.detail||{});try{globalThis.addEventListener?.(VS_NETWORK_EVENT,this.networkListener);}catch{}
    this.mount(parent);
  }
  mount(parent){
    if(!parent||this.button)return;
    const button=document.createElement("button");button.id="soloLogbook";button.type="button";button.textContent="LOGBOOK";button.setAttribute("aria-label","Open flight and network logbook");
    parent.insertBefore(button,parent.querySelector("#soloCamera")||null);this.button=button;
    const dialog=document.createElement("dialog");dialog.id="flightLogbookDialog";dialog.className="flight-logbook-dialog";dialog.innerHTML=`
      <h3>FLIGHT / NETWORK LOGBOOK</h3>
      <p>Local telemetry only. Network diagnostics and flight records never feed the controller or physics.</p>
      <h4>NETWORK / VS</h4><div class="network-logbook-list" data-network-logbook-list></div>
      <h4>FLIGHTS</h4><div class="flight-logbook-list" data-flight-logbook-list></div>
      <div class="phone-settings-actions"><button type="button" data-flight-export>EXPORT JSON</button><button type="button" data-flight-clear>CLEAR</button><button type="button" data-flight-close>CLOSE</button></div>`;
    document.body.appendChild(dialog);this.dialog=dialog;this.list=dialog.querySelector("[data-flight-logbook-list]");this.networkList=dialog.querySelector("[data-network-logbook-list]");
    const style=document.createElement("style");style.textContent=`
      .flight-logbook-dialog{width:min(96vw,720px);max-height:90dvh;overflow:auto;border:1px solid #ffffff44;border-radius:14px;background:#0b1420f7;color:#fff;padding:16px;box-shadow:0 20px 70px #000b}
      .flight-logbook-dialog::backdrop{background:#0009;backdrop-filter:blur(4px)}.flight-logbook-dialog h3{margin:0 0 4px}.flight-logbook-dialog h4{margin:14px 0 6px;font:900 10px system-ui;letter-spacing:.12em;color:#8fe8ff}.flight-logbook-dialog>p{color:#9eb0c6;font:12px/1.4 system-ui}
      .flight-logbook-list,.network-logbook-list{display:grid;gap:8px}.flight-logbook-empty{padding:18px;border:1px dashed #ffffff33;border-radius:10px;color:#91a4ba;text-align:center;font:800 12px system-ui}
      .flight-log-entry,.network-log-entry{display:grid;grid-template-columns:1fr auto;gap:3px 12px;padding:10px;border:1px solid #ffffff25;border-radius:10px;background:#101d2b}.flight-log-entry strong,.network-log-entry strong{font:850 12px system-ui}.flight-log-entry time,.network-log-entry time{font:750 10px ui-monospace,monospace;color:#91a7bc}.flight-log-entry .stats,.network-log-entry .stats{grid-column:1/3;color:#c7d5e3;font:700 10px/1.45 ui-monospace,monospace;overflow-wrap:anywhere}.flight-log-entry .reason,.network-log-entry .reason{font:850 9px system-ui;color:#ffd06d;letter-spacing:.04em}.network-log-entry.good{border-color:#5ce6a844}.network-log-entry.bad{border-color:#ff667755}.network-log-entry .stats{color:#b9d8e9}
      body.solo-flight #soloLogbook{background:#263b51dd!important}
    `;document.head.appendChild(style);
    button.onclick=()=>{this.render();dialog.showModal();};
    dialog.querySelector("[data-flight-close]").onclick=()=>dialog.close();
    dialog.querySelector("[data-flight-export]").onclick=()=>downloadJson(`arondight45-flight-network-logbook-${new Date().toISOString().replaceAll(":","-")}.json`,{version:2,exportedAt:new Date().toISOString(),networkEvents:this.networkEvents,flights:this.entries});
    dialog.querySelector("[data-flight-clear]").onclick=()=>{this.entries=[];this.networkEvents=[];saveEntries(this.entries);saveNetworkEvents(this.networkEvents);this.render();};
    this.render();
  }
  recordNetwork(detail){
    const event=normalizeNetworkEvent(detail),signature=networkSignature(event),now=Date.now();
    if(signature===this.lastNetworkSignature&&now-this.lastNetworkAt<500)return false;
    this.lastNetworkSignature=signature;this.lastNetworkAt=now;this.networkEvents=[event,...this.networkEvents].slice(0,MAX_NETWORK_EVENTS);saveNetworkEvents(this.networkEvents);this.render();return true;
  }
  renderNetwork(){
    if(!this.networkList)return;
    if(!this.networkEvents.length){this.networkList.innerHTML='<div class="flight-logbook-empty">NO NETWORK EVENTS YET</div>';return;}
    this.networkList.innerHTML=this.networkEvents.map(event=>{
      const good=/peer-join|peer-network|peer-rtt|finder-selected/.test(event.stage),bad=/error/.test(event.stage),badge=[event.transport,compactId(event.roomId),compactId(event.peerId)].filter(Boolean).join(" · ")||"LOCAL";
      return `<article class="network-log-entry ${good?"good":bad?"bad":""}"><strong>${escapeHtml(event.stage.toUpperCase())}</strong><span class="reason">${escapeHtml(badge)}</span><time>${escapeHtml(new Date(event.at).toLocaleString())}</time><span></span><div class="stats">${escapeHtml(networkDetailText(event))}</div></article>`;
    }).join("");
  }
  render(){
    if(this.button){const n=this.networkEvents.length,f=this.entries.length;this.button.textContent=n||f?`LOGBOOK · ${f}F/${n}N`:"LOGBOOK";}
    this.renderNetwork();
    if(!this.list)return;
    if(!this.entries.length){this.list.innerHTML='<div class="flight-logbook-empty">NO FLIGHTS LOGGED YET</div>';return;}
    this.list.innerHTML=this.entries.map(entry=>`<article class="flight-log-entry"><strong>${entry.worldMode==="real"?"WORLD":"TRAINING"} · ${durationText(entry.durationS)}</strong><span class="reason">${escapeHtml(reasonLabel(entry.endReason))}</span><time>${escapeHtml(new Date(entry.startedAt).toLocaleString())}</time><span></span><div class="stats">DIST ${entry.distanceM.toFixed(1)} m · MAX ${entry.maxSpeedMps.toFixed(1)} m/s · AGL ${entry.maxAglM.toFixed(1)} m<br>FWD ${entry.maxForwardMps.toFixed(1)} · STRAFE ${entry.maxRightMps.toFixed(1)} m/s · BAT ${entry.batteryStartV.toFixed(2)}→${entry.batteryEndV.toFixed(2)} V</div></article>`).join("");
  }
  begin(sample){
    const t=Number(sample.simTime)||0,z=Number(sample.z)||0,battery=Number(sample.batteryV)||0;
    this.active={id:`${Date.now()}-${Math.random().toString(36).slice(2,8)}`,startedAt:new Date().toISOString(),simStart:t,lastSim:t,lastPathSim:-Infinity,worldMode:sample.worldMode==="real"?"real":"training",worldOrigin:sample.worldOrigin||null,distanceM:0,maxSpeedMps:0,maxAglM:Math.max(0,Number(sample.agl)||z),maxAltitudeM:z,maxForwardMps:0,maxRightMps:0,batteryStartV:battery,batteryEndV:battery,batteryMinV:battery,lastPosition:finite(Number(sample.x),Number(sample.y),z)?[Number(sample.x),Number(sample.y),z]:null,path:[],samples:0};
    this.record(sample,true);
  }
  record(sample,forcePath=false){
    const flight=this.active;if(!flight)return;
    const t=Number(sample.simTime)||0,x=Number(sample.x),y=Number(sample.y),z=Number(sample.z),speed=Math.max(0,Number(sample.speed)||0),aglValue=Number(sample.agl),aglValid=sample.aglValid!==false&&Number.isFinite(aglValue),agl=aglValid?Math.max(0,aglValue):null,battery=Number(sample.batteryV)||flight.batteryEndV;
    if(t+1e-6<flight.lastSim){this.finish("SIM_RESET",null);return;}
    if(finite(x,y,z)&&flight.lastPosition){const dx=x-flight.lastPosition[0],dy=y-flight.lastPosition[1],dz=z-flight.lastPosition[2],step=Math.hypot(dx,dy,dz);if(step<20)flight.distanceM+=step;flight.lastPosition=[x,y,z];}else if(finite(x,y,z))flight.lastPosition=[x,y,z];
    const body=bodyVelocity(sample);flight.maxSpeedMps=Math.max(flight.maxSpeedMps,speed);if(aglValid)flight.maxAglM=Math.max(flight.maxAglM,agl);flight.maxAltitudeM=Math.max(flight.maxAltitudeM,z);flight.maxForwardMps=Math.max(flight.maxForwardMps,Math.abs(body.forward));flight.maxRightMps=Math.max(flight.maxRightMps,Math.abs(body.right));flight.batteryEndV=battery;flight.batteryMinV=flight.samples?Math.min(flight.batteryMinV,battery):battery;flight.samples++;flight.lastSim=t;
    if(forcePath||t-flight.lastPathSim>=PATH_INTERVAL_S){flight.lastPathSim=t;if(flight.path.length<MAX_PATH_POINTS)flight.path.push({t:+(t-flight.simStart).toFixed(2),x:+(x||0).toFixed(2),y:+(y||0).toFixed(2),agl:aglValid?+agl.toFixed(2):null,z:+z.toFixed(2)});}
  }
  observe(sample){
    const armed=Boolean(sample.armed);if(armed&&!this.lastArmed)this.begin(sample);if(armed&&this.active)this.record(sample);if(!armed&&this.lastArmed&&this.active)this.finish(sample.disarmReason||"FC_DISARM",sample);this.lastArmed=armed;
  }
  finish(reason="RUN_STOPPED",sample=null){
    if(!this.active){this.lastArmed=false;return null;}if(sample)this.record(sample,true);
    const flight=this.active;flight.endedAt=new Date().toISOString();flight.durationS=Math.max(0,flight.lastSim-flight.simStart);flight.endReason=String(reason||"FC_DISARM");delete flight.lastPosition;delete flight.lastPathSim;delete flight.lastSim;delete flight.simStart;
    const frozen={...flight,distanceM:+flight.distanceM.toFixed(3),maxSpeedMps:+flight.maxSpeedMps.toFixed(3),maxAglM:+flight.maxAglM.toFixed(3),maxAltitudeM:+flight.maxAltitudeM.toFixed(3),maxForwardMps:+flight.maxForwardMps.toFixed(3),maxRightMps:+flight.maxRightMps.toFixed(3),batteryStartV:+flight.batteryStartV.toFixed(3),batteryEndV:+flight.batteryEndV.toFixed(3),batteryMinV:+flight.batteryMinV.toFixed(3)};
    this.entries=[frozen,...this.entries].slice(0,MAX_FLIGHTS);saveEntries(this.entries);this.active=null;this.lastArmed=false;this.render();return frozen;
  }
  clear(){this.entries=[];this.networkEvents=[];saveEntries(this.entries);saveNetworkEvents(this.networkEvents);this.render();}
  snapshot(){return{active:this.active?{...this.active}:null,entries:this.entries.map(entry=>({...entry})),networkEvents:this.networkEvents.map(entry=>({...entry}))};}
}
