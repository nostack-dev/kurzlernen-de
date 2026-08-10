export const FLIGHT_LOGBOOK_KEY="arondight45FlightLogbookV1";
const MAX_FLIGHTS=50;
const PATH_INTERVAL_S=.5;
const MAX_PATH_POINTS=600;
const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
const finite=(...values)=>values.every(Number.isFinite);

function loadEntries(){
  try{
    const raw=JSON.parse(localStorage.getItem(FLIGHT_LOGBOOK_KEY)||"[]");
    return Array.isArray(raw)?raw.slice(0,MAX_FLIGHTS):[];
  }catch{return[];}
}
function saveEntries(entries){
  try{localStorage.setItem(FLIGHT_LOGBOOK_KEY,JSON.stringify(entries.slice(0,MAX_FLIGHTS)));}catch{}
}
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

export class FlightLogbook{
  constructor({parent=null}={}){
    this.entries=loadEntries();this.active=null;this.lastArmed=false;this.button=null;this.dialog=null;this.list=null;this.mount(parent);
  }
  mount(parent){
    if(!parent||this.button)return;
    const button=document.createElement("button");button.id="soloLogbook";button.type="button";button.textContent="LOGBOOK";button.setAttribute("aria-label","Open flight logbook");
    parent.insertBefore(button,parent.querySelector("#soloCamera")||null);this.button=button;
    const dialog=document.createElement("dialog");dialog.id="flightLogbookDialog";dialog.className="flight-logbook-dialog";dialog.innerHTML=`
      <h3>FLIGHT LOGBOOK</h3>
      <p>Local flight sessions from the real FC state. Logging is telemetry-only and never feeds the controller or physics.</p>
      <div class="flight-logbook-list" data-flight-logbook-list></div>
      <div class="phone-settings-actions"><button type="button" data-flight-export>EXPORT JSON</button><button type="button" data-flight-clear>CLEAR</button><button type="button" data-flight-close>CLOSE</button></div>`;
    document.body.appendChild(dialog);this.dialog=dialog;this.list=dialog.querySelector("[data-flight-logbook-list]");
    const style=document.createElement("style");style.textContent=`
      .flight-logbook-dialog{width:min(94vw,560px);max-height:88dvh;overflow:auto;border:1px solid #ffffff44;border-radius:14px;background:#0b1420f7;color:#fff;padding:16px;box-shadow:0 20px 70px #000b}
      .flight-logbook-dialog::backdrop{background:#0009;backdrop-filter:blur(4px)}.flight-logbook-dialog h3{margin:0 0 4px}.flight-logbook-dialog>p{color:#9eb0c6;font:12px/1.4 system-ui}
      .flight-logbook-list{display:grid;gap:8px}.flight-logbook-empty{padding:18px;border:1px dashed #ffffff33;border-radius:10px;color:#91a4ba;text-align:center;font:800 12px system-ui}
      .flight-log-entry{display:grid;grid-template-columns:1fr auto;gap:3px 12px;padding:10px;border:1px solid #ffffff25;border-radius:10px;background:#101d2b}.flight-log-entry strong{font:850 12px system-ui}.flight-log-entry time{font:750 10px ui-monospace,monospace;color:#91a7bc}.flight-log-entry .stats{grid-column:1/3;color:#c7d5e3;font:700 10px/1.45 ui-monospace,monospace}.flight-log-entry .reason{font:850 9px system-ui;color:#ffd06d;letter-spacing:.04em}
      body.solo-flight #soloLogbook{background:#263b51dd!important}
    `;document.head.appendChild(style);
    button.onclick=()=>{this.render();dialog.showModal();};
    dialog.querySelector("[data-flight-close]").onclick=()=>dialog.close();
    dialog.querySelector("[data-flight-export]").onclick=()=>downloadJson(`arondight45-flight-logbook-${new Date().toISOString().replaceAll(":","-")}.json`,{version:1,exportedAt:new Date().toISOString(),flights:this.entries});
    dialog.querySelector("[data-flight-clear]").onclick=()=>{this.entries=[];saveEntries(this.entries);this.render();};
    this.render();
  }
  render(){
    if(this.button)this.button.textContent=this.entries.length?`LOGBOOK · ${this.entries.length}`:"LOGBOOK";
    if(!this.list)return;
    if(!this.entries.length){this.list.innerHTML='<div class="flight-logbook-empty">NO FLIGHTS LOGGED YET</div>';return;}
    this.list.innerHTML=this.entries.map(entry=>`<article class="flight-log-entry"><strong>${entry.worldMode==="real"?"WORLD":"TRAINING"} · ${durationText(entry.durationS)}</strong><span class="reason">${reasonLabel(entry.endReason)}</span><time>${new Date(entry.startedAt).toLocaleString()}</time><span></span><div class="stats">DIST ${entry.distanceM.toFixed(1)} m · MAX ${entry.maxSpeedMps.toFixed(1)} m/s · AGL ${entry.maxAglM.toFixed(1)} m<br>FWD ${entry.maxForwardMps.toFixed(1)} · STRAFE ${entry.maxRightMps.toFixed(1)} m/s · BAT ${entry.batteryStartV.toFixed(2)}→${entry.batteryEndV.toFixed(2)} V</div></article>`).join("");
  }
  begin(sample){
    const t=Number(sample.simTime)||0,z=Number(sample.z)||0,battery=Number(sample.batteryV)||0;
    this.active={
      id:`${Date.now()}-${Math.random().toString(36).slice(2,8)}`,startedAt:new Date().toISOString(),simStart:t,lastSim:t,lastPathSim:-Infinity,
      worldMode:sample.worldMode==="real"?"real":"training",worldOrigin:sample.worldOrigin||null,
      distanceM:0,maxSpeedMps:0,maxAglM:Math.max(0,Number(sample.agl)||z),maxAltitudeM:z,maxForwardMps:0,maxRightMps:0,
      batteryStartV:battery,batteryEndV:battery,batteryMinV:battery,lastPosition:finite(Number(sample.x),Number(sample.y),z)?[Number(sample.x),Number(sample.y),z]:null,path:[],samples:0,
    };
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
    const armed=Boolean(sample.armed);
    if(armed&&!this.lastArmed)this.begin(sample);
    if(armed&&this.active)this.record(sample);
    if(!armed&&this.lastArmed&&this.active)this.finish(sample.disarmReason||"FC_DISARM",sample);
    this.lastArmed=armed;
  }
  finish(reason="RUN_STOPPED",sample=null){
    if(!this.active){this.lastArmed=false;return null;}
    if(sample)this.record(sample,true);
    const flight=this.active;flight.endedAt=new Date().toISOString();flight.durationS=Math.max(0,flight.lastSim-flight.simStart);flight.endReason=String(reason||"FC_DISARM");delete flight.lastPosition;delete flight.lastPathSim;delete flight.lastSim;delete flight.simStart;
    const frozen={...flight,distanceM:+flight.distanceM.toFixed(3),maxSpeedMps:+flight.maxSpeedMps.toFixed(3),maxAglM:+flight.maxAglM.toFixed(3),maxAltitudeM:+flight.maxAltitudeM.toFixed(3),maxForwardMps:+flight.maxForwardMps.toFixed(3),maxRightMps:+flight.maxRightMps.toFixed(3),batteryStartV:+flight.batteryStartV.toFixed(3),batteryEndV:+flight.batteryEndV.toFixed(3),batteryMinV:+flight.batteryMinV.toFixed(3)};
    this.entries=[frozen,...this.entries].slice(0,MAX_FLIGHTS);saveEntries(this.entries);this.active=null;this.lastArmed=false;this.render();return frozen;
  }
  clear(){this.entries=[];saveEntries(this.entries);this.render();}
  snapshot(){return{active:this.active?{...this.active}:null,entries:this.entries.map(entry=>({...entry}))};}
}
