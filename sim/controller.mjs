const $ = id => document.getElementById(id);
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const ui = Object.fromEntries([
  "connection","connect","fullscreen","leftStick","leftKnob","leftValue","rightStick","rightKnob","rightValue","arm","kill","room","copyLink","pairStatus","fcState","altitude","battery","motors"
].map(id => [id,$(id)]));

const CONTROL_PROTOCOL = 1;
const SEND_INTERVAL_MS = 20;
let socket = null;
let sequence = 1;
let connected = false;
let simConnected = false;
let controls = {roll:0,pitch:0,yaw:0,throttle:0,arm:false};

function randomRoom(){
  const alphabet="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes=new Uint8Array(6);crypto.getRandomValues(bytes);
  return [...bytes].map(value=>alphabet[value%alphabet.length]).join("");
}
function sanitizeRoom(value){return String(value||"").toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,12);}
function relayUrl(){
  const params=new URLSearchParams(location.search);
  const explicit=params.get("relay")||localStorage.getItem("arondight45ControlRelay")||"";
  if(explicit)return explicit;
  if(location.protocol==="http:"&&location.port)return`ws://${location.host}/control`;
  if(location.protocol==="https:"&&location.port)return`wss://${location.host}/control`;
  return"";
}
function room(){return sanitizeRoom(ui.room.value);}
function setConnection(text,kind="warn"){
  ui.connection.textContent=text;ui.connection.className=`pill ${kind}`;
}
function updatePairText(){
  const relay=relayUrl();
  if(connected&&simConnected)ui.pairStatus.textContent=`Room ${room()} · simulator linked`;
  else if(connected)ui.pairStatus.textContent=`Room ${room()} · waiting for simulator`;
  else if(!relay)ui.pairStatus.textContent="Open both pages from the LAN server, or provide ?relay=wss://…";
  else ui.pairStatus.textContent=`Relay ${relay} · room ${room()}`;
}
function controllerLink(){
  const url=new URL(location.href);url.searchParams.set("room",room());
  const relay=relayUrl();if(relay)url.searchParams.set("relay",relay);
  return url.toString();
}
function publish(force=false){
  if(!socket||socket.readyState!==WebSocket.OPEN)return;
  socket.send(JSON.stringify({type:"control",protocol:CONTROL_PROTOCOL,room:room(),sequence:sequence++,sent_ms:performance.now(),...controls,force}));
}
function safetyNeutral(send=true){
  controls={roll:0,pitch:0,yaw:0,throttle:0,arm:false};
  updateSticks();updateArm();if(send)publish(true);
}
function updateArm(){ui.arm.textContent=controls.arm?"ARM HIGH":"ARM LOW";ui.arm.classList.toggle("high",controls.arm);}
function setKnob(knob,x,y){knob.style.transform=`translate(calc(-50% + ${x*50}%),calc(-50% + ${y*50}%))`;}
function updateSticks(){
  setKnob(ui.leftKnob,controls.yaw,1-2*controls.throttle);
  setKnob(ui.rightKnob,controls.roll,-controls.pitch);
  ui.leftValue.textContent=`T ${(controls.throttle*100).toFixed(0)}% · Y ${(controls.yaw*100).toFixed(0)}%`;
  ui.rightValue.textContent=`R ${(controls.roll*100).toFixed(0)}% · P ${(controls.pitch*100).toFixed(0)}%`;
}
function normalizedPointer(element,event){
  const rect=element.getBoundingClientRect(),cx=rect.left+rect.width/2,cy=rect.top+rect.height/2,r=Math.max(1,Math.min(rect.width,rect.height)*.42);
  let x=(event.clientX-cx)/r,y=(event.clientY-cy)/r;const length=Math.hypot(x,y);if(length>1){x/=length;y/=length;}return{x:clamp(x,-1,1),y:clamp(y,-1,1)};
}
function bindStick(element,kind){
  let pointer=null;
  element.addEventListener("pointerdown",event=>{pointer=event.pointerId;element.setPointerCapture(pointer);apply(event);event.preventDefault();});
  element.addEventListener("pointermove",event=>{if(event.pointerId===pointer)apply(event);});
  const release=event=>{if(event.pointerId!==pointer)return;pointer=null;if(kind==="left")controls.yaw=0;else{controls.roll=0;controls.pitch=0;}updateSticks();publish(true);};
  element.addEventListener("pointerup",release);element.addEventListener("pointercancel",release);
  function apply(event){
    const p=normalizedPointer(element,event);
    if(kind==="left"){controls.yaw=p.x;controls.throttle=clamp((1-p.y)/2,0,1);}else{controls.roll=p.x;controls.pitch=-p.y;}
    updateSticks();publish();
  }
}

async function connect(){
  if(socket){socket.close(1000,"user disconnect");socket=null;connected=false;simConnected=false;safetyNeutral(false);setConnection("DISCONNECTED");ui.connect.textContent="Connect";updatePairText();return;}
  const relay=relayUrl();
  if(!relay){setConnection("NO RELAY","bad");ui.pairStatus.textContent="Run the LAN server and open the controller URL it prints.";return;}
  const r=room();if(!r){ui.room.value=randomRoom();return connect();}
  localStorage.setItem("arondight45Room",r);localStorage.setItem("arondight45ControlRelay",relay);
  setConnection("CONNECTING…");
  const ws=new WebSocket(relay);socket=ws;
  const timer=setTimeout(()=>{if(ws.readyState!==WebSocket.OPEN)ws.close();},5000);
  ws.onopen=()=>{clearTimeout(timer);connected=true;ui.connect.textContent="Disconnect";setConnection("WAITING FOR SIM");ws.send(JSON.stringify({type:"join",protocol:CONTROL_PROTOCOL,role:"controller",room:r}));publish(true);updatePairText();};
  ws.onmessage=event=>{
    let message;try{message=JSON.parse(event.data);}catch{return;}
    if(message.type==="peer"){simConnected=Boolean(message.simulator);setConnection(simConnected?"SIM LINKED":"WAITING FOR SIM",simConnected?"good":"warn");updatePairText();return;}
    if(message.type==="telemetry"){
      simConnected=true;setConnection("SIM LINKED","good");
      ui.fcState.textContent=message.fc_state||"—";ui.altitude.textContent=Number.isFinite(message.altitude)?`${message.altitude.toFixed(2)} m`:"—";ui.battery.textContent=Number.isFinite(message.battery_v)?`${message.battery_v.toFixed(2)} V`:"—";ui.motors.textContent=Array.isArray(message.motors)?message.motors.map(Math.round).join(" "):"—";updatePairText();
    }
  };
  ws.onerror=()=>setConnection("CONNECTION ERROR","bad");
  ws.onclose=()=>{clearTimeout(timer);if(socket===ws)socket=null;connected=false;simConnected=false;safetyNeutral(false);setConnection("DISCONNECTED","bad");ui.connect.textContent="Connect";updatePairText();};
}

bindStick(ui.leftStick,"left");bindStick(ui.rightStick,"right");
ui.arm.onclick=()=>{controls.arm=!controls.arm;updateArm();publish(true);};
ui.kill.onclick=()=>safetyNeutral(true);
ui.connect.onclick=connect;
ui.room.oninput=()=>{ui.room.value=sanitizeRoom(ui.room.value);updatePairText();};
ui.copyLink.onclick=async()=>{try{await navigator.clipboard.writeText(controllerLink());ui.pairStatus.textContent="Controller link copied.";}catch{ui.pairStatus.textContent=controllerLink();}};
ui.fullscreen.onclick=async()=>{try{if(!document.fullscreenElement)await document.documentElement.requestFullscreen();else await document.exitFullscreen();try{await screen.orientation?.lock?.("landscape");}catch{}}catch{}};

addEventListener("pagehide",()=>safetyNeutral(true));
document.addEventListener("visibilitychange",()=>{if(document.hidden)safetyNeutral(true);});
setInterval(()=>publish(),SEND_INTERVAL_MS);

const params=new URLSearchParams(location.search);
ui.room.value=sanitizeRoom(params.get("room")||localStorage.getItem("arondight45Room")||randomRoom());
updateSticks();updateArm();updatePairText();
if(relayUrl()&&params.get("room"))connect();
