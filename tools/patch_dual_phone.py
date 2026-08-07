from pathlib import Path

p = Path("sim/simulator.mjs")
s = p.read_text()

def rep(old: str, new: str, label: str):
    global s
    count = s.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, got {count}")
    s = s.replace(old, new)

rep(
    '"modeInfo","connect","run","reset","status","tMode","tController","fcState","simTime","altitude","velocity","attitude","motors","rpm","battery","current","processing","rtt","speed","armSwitch","throttle","logFile","fit","fitProgress","fitStatus","logSamples","touchRoll","touchPitch","touchYaw","touchThrottle","touchArm","exportLog"',
    '"modeInfo","connect","run","reset","status","tMode","tController","fcState","simTime","altitude","velocity","attitude","motors","rpm","battery","current","processing","rtt","speed","armSwitch","throttle","logFile","fit","fitProgress","fitStatus","logSamples","touchRoll","touchPitch","touchYaw","touchThrottle","touchArm","exportLog","remoteRoom","inputSource","remoteConnect","remoteStatus","controllerLink"',
    "ui ids",
)

marker = "class Noise {"
if s.count(marker) != 1:
    raise SystemExit("Noise marker not unique")
remote = r'''class RemoteControlLink {
  constructor(){this.socket=null;this.room="";this.control=null;this.lastControlWall=0;this.controllerPresent=false;this.onState=null;}
  relayUrl(){
    const params=new URLSearchParams(location.search),explicit=params.get("relay")||localStorage.getItem("arondight45ControlRelay")||"";
    if(explicit)return explicit;
    if(location.protocol==="http:"&&location.port)return`ws://${location.host}/control`;
    if(location.protocol==="https:"&&location.port)return`wss://${location.host}/control`;
    return"";
  }
  async connect(room){
    await this.disconnect();this.room=room;const url=this.relayUrl();if(!url)throw Error("No control relay. Run tools/s31_hil_bridge.mjs --sim-only and open its LAN VIEW URL.");
    if(location.protocol==="https:"&&url.startsWith("ws://"))throw Error("HTTPS cannot use a local ws:// relay. Open the HTTP LAN VIEW URL printed by the bridge.");
    localStorage.setItem("arondight45ControlRelay",url);localStorage.setItem("arondight45Room",room);
    const ws=new WebSocket(url);this.socket=ws;
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error("Remote-control relay timeout")),5000);ws.onopen=()=>{clearTimeout(timer);resolve();};ws.onerror=()=>{clearTimeout(timer);reject(Error("Cannot reach remote-control relay"));};});
    ws.onmessage=event=>{let message;try{message=JSON.parse(event.data);}catch{return;}if(message.type==="peer"){this.controllerPresent=Boolean(message.controller);this.onState?.();return;}if(message.type!=="control"||message.protocol!==1||message.room!==this.room)return;const numeric=[message.roll,message.pitch,message.yaw,message.throttle].map(Number);if(!numeric.every(Number.isFinite))return;this.control={roll:clamp(numeric[0],-1,1),pitch:clamp(numeric[1],-1,1),yaw:clamp(numeric[2],-1,1),throttle:clamp(numeric[3],0,1),arm:message.arm===true};this.lastControlWall=performance.now();this.controllerPresent=true;this.onState?.();};
    ws.onclose=()=>{if(this.socket===ws){this.socket=null;this.control=null;this.controllerPresent=false;this.onState?.();}};
    ws.onerror=()=>this.onState?.();
    ws.send(JSON.stringify({type:"join",protocol:1,role:"simulator",room:this.room}));this.onState?.();
  }
  current(){return this.socket?.readyState===WebSocket.OPEN&&this.controllerPresent&&this.control&&performance.now()-this.lastControlWall<=350?this.control:null;}
  sendTelemetry(payload){if(this.socket?.readyState===WebSocket.OPEN)this.socket.send(JSON.stringify({type:"telemetry",protocol:1,room:this.room,...payload}));}
  async disconnect(){const ws=this.socket;this.socket=null;this.control=null;this.controllerPresent=false;if(ws)try{ws.close(1000,"view disconnect");}catch{}this.onState?.();}
}

'''
s = s.replace(marker, remote + marker)

rep(
    "const keys=new Set();let arm=false,throttle=0,realLog=[],sessionLog=[];",
    'const keys=new Set();let localArm=false,localThrottle=0,arm=false,throttle=0,realLog=[],sessionLog=[];let inputSource="remote",effectiveInput={roll:0,pitch:0,yaw:0,throttle:0,arm:false},lastRemoteTelemetry=0;const remoteLink=new RemoteControlLink();',
    "global control state",
)
rep(
    "physics.reset(defaultParams(),initial);sequence=1;simTime=0;resetFlag=true;latest={motors:[1000,1000,1000,1000],attitude:[0,0,0],state:0,processingUs:0};throttle=0;arm=false;replayIndex=0;sessionLog=[];",
    "physics.reset(defaultParams(),initial);sequence=1;simTime=0;resetFlag=true;latest={motors:[1000,1000,1000,1000],attitude:[0,0,0],state:0,processingUs:0};localThrottle=throttle=0;localArm=arm=false;effectiveInput={roll:0,pitch:0,yaw:0,throttle:0,arm:false};replayIndex=0;sessionLog=[];",
    "reset control state",
)

old_controls = r'''function controls(){
  let roll=+ui.touchRoll.value,pitch=+ui.touchPitch.value,yaw=+ui.touchYaw.value;
  if(keys.has("KeyD"))roll=1;if(keys.has("KeyA"))roll=-1;if(keys.has("KeyW"))pitch=1;if(keys.has("KeyS"))pitch=-1;if(keys.has("KeyE"))yaw=1;if(keys.has("KeyQ"))yaw=-1;
  if(keys.has("KeyR"))throttle=clamp(throttle+1.2*DT,0,1);else if(keys.has("KeyF"))throttle=clamp(throttle-1.2*DT,0,1);else throttle=+ui.touchThrottle.value;
  const channels=new Array(16).fill(992);channels[0]=Math.round(992+820*roll);channels[1]=Math.round(992+820*pitch);channels[2]=Math.round(172+1639*throttle);channels[3]=Math.round(992+820*yaw);channels[4]=arm?1811:172;return encodeSbus(channels);
}'''
new_controls = r'''function localControlState(){
  let roll=+ui.touchRoll.value,pitch=+ui.touchPitch.value,yaw=+ui.touchYaw.value;
  if(keys.has("KeyD"))roll=1;if(keys.has("KeyA"))roll=-1;if(keys.has("KeyW"))pitch=1;if(keys.has("KeyS"))pitch=-1;if(keys.has("KeyE"))yaw=1;if(keys.has("KeyQ"))yaw=-1;
  if(keys.has("KeyR"))localThrottle=clamp(localThrottle+1.2*DT,0,1);else if(keys.has("KeyF"))localThrottle=clamp(localThrottle-1.2*DT,0,1);else localThrottle=+ui.touchThrottle.value;
  return{roll,pitch,yaw,throttle:localThrottle,arm:localArm};
}
function activeControlState(){
  const neutral={roll:0,pitch:0,yaw:0,throttle:0,arm:false};
  effectiveInput=inputSource==="remote"?(remoteLink.current()||neutral):localControlState();
  arm=effectiveInput.arm;throttle=effectiveInput.throttle;return effectiveInput;
}
function controls(){
  const c=activeControlState(),channels=new Array(16).fill(992);channels[0]=Math.round(992+820*c.roll);channels[1]=Math.round(992+820*c.pitch);channels[2]=Math.round(172+1639*c.throttle);channels[3]=Math.round(992+820*c.yaw);channels[4]=c.arm?1811:172;return encodeSbus(channels);
}'''
rep(old_controls, new_controls, "controls")

start = s.index("function render(){")
end = s.index("\nrender();", start)
render = r'''function render(){
  requestAnimationFrame(render);physics.render();const state=physics.state(),position=physics.position(),target=new THREE.Vector3(...position),desired=target.clone().add(new THREE.Vector3(3.3,-4.2,2.4));camera.position.lerp(desired,.025);camera.lookAt(target);
  const fcState=latest.state,fault=fcState>>8&255,stateText=fcState&STATE_FAULT?`FAULT ${fault}`:fcState&STATE_CALIBRATING?"CALIBRATING":fcState&STATE_ARMED?"ARMED":"DISARMED";ui.fcState.textContent=stateText;ui.fcState.className=fcState&STATE_FAULT?"bad":fcState&STATE_ARMED?"good":"warn";
  ui.simTime.textContent=simTime.toFixed(3)+" s";ui.altitude.textContent=Math.max(0,state.z).toFixed(3)+" m";ui.velocity.textContent=state.speed.toFixed(3)+" m/s";ui.attitude.textContent=latest.attitude.map(x=>x.toFixed(1)).join(" / ")+"°";ui.motors.textContent=latest.motors.map(x=>Math.round(x)).join(" ");ui.rpm.textContent=physics.motorOmega.map(w=>Math.round(w*60/(2*Math.PI))).join(" ");ui.battery.textContent=physics.batteryVoltage.toFixed(2)+" V";ui.current.textContent=physics.batteryCurrent.toFixed(1)+" A";ui.processing.textContent=latest.processingUs+" μs";ui.armSwitch.textContent=arm?"HIGH":"LOW";ui.throttle.textContent=(throttle*100).toFixed(1)+"%";
  const now=performance.now();if(now-lastRemoteTelemetry>=100){lastRemoteTelemetry=now;remoteLink.sendTelemetry({fc_state:stateText,mode,sim_time:simTime,altitude:Math.max(0,state.z),speed:state.speed,battery_v:physics.batteryVoltage,current_a:physics.batteryCurrent,motors:latest.motors,rpm:physics.motorOmega.map(w=>w*60/(2*Math.PI)),armed:Boolean(fcState&STATE_ARMED),fault});}
  const wall=(now-wallStart)/1000;ui.speed.textContent=(wall>0?(simTime-simStart)/wall:0).toFixed(2)+"×";renderer.render(scene,camera);
}'''
s = s[:start] + render + s[end:]

rep(
    'addEventListener("keydown",event=>{if(event.code==="Space"&&!event.repeat){arm=!arm;ui.touchArm.textContent=`ARM switch: ${arm?"HIGH":"LOW"}`;event.preventDefault();}keys.add(event.code);});addEventListener("keyup",event=>keys.delete(event.code));ui.touchArm.onclick=()=>{arm=!arm;ui.touchArm.textContent=`ARM switch: ${arm?"HIGH":"LOW"}`;};',
    'addEventListener("keydown",event=>{if(event.code==="Space"&&!event.repeat){localArm=!localArm;ui.touchArm.textContent=`ARM switch: ${localArm?"HIGH":"LOW"}`;event.preventDefault();}keys.add(event.code);});addEventListener("keyup",event=>keys.delete(event.code));ui.touchArm.onclick=()=>{localArm=!localArm;ui.touchArm.textContent=`ARM switch: ${localArm?"HIGH":"LOW"}`;};',
    "local arm handlers",
)

remote_init = r'''function randomRoom(){const alphabet="ABCDEFGHJKLMNPQRSTUVWXYZ23456789",bytes=new Uint8Array(6);crypto.getRandomValues(bytes);return[...bytes].map(value=>alphabet[value%alphabet.length]).join("");}
function cleanRoom(value){return String(value||"").toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,12);}
function controllerUrl(){const url=new URL("./drone_controller.html",location.href);url.searchParams.set("room",cleanRoom(ui.remoteRoom.value));const relay=remoteLink.relayUrl();if(relay)url.searchParams.set("relay",relay);return url.toString();}
function updateRemoteUI(){
  const linked=remoteLink.controllerPresent,current=remoteLink.current();ui.controllerLink.href=controllerUrl();
  if(!remoteLink.socket){ui.remoteStatus.textContent=inputSource==="remote"?"REMOTE selected · relay disconnected · fail-safe ARM LOW / throttle 0.":"LOCAL FALLBACK selected.";ui.remoteStatus.className="statusline warn";ui.remoteConnect.textContent="Connect remote";return;}
  ui.remoteConnect.textContent="Disconnect remote";
  if(linked&&current){ui.remoteStatus.textContent=`REMOTE LINKED · room ${remoteLink.room} · packets fresh`;ui.remoteStatus.className="statusline good";}
  else if(linked){ui.remoteStatus.textContent=`Controller link stale (>350 ms) · fail-safe ARM LOW / throttle 0`;ui.remoteStatus.className="statusline bad";}
  else{ui.remoteStatus.textContent=`Relay connected · room ${remoteLink.room} · waiting for controller phone`;ui.remoteStatus.className="statusline warn";}
}
async function connectRemote(){
  if(remoteLink.socket){await remoteLink.disconnect();updateRemoteUI();return;}
  const room=cleanRoom(ui.remoteRoom.value)||randomRoom();ui.remoteRoom.value=room;localStorage.setItem("arondight45Room",room);try{await remoteLink.connect(room);inputSource="remote";ui.inputSource.value="remote";updateRemoteUI();}catch(error){ui.remoteStatus.textContent=error.message;ui.remoteStatus.className="statusline bad";}
}
remoteLink.onState=updateRemoteUI;ui.remoteConnect.onclick=connectRemote;ui.remoteRoom.oninput=()=>{ui.remoteRoom.value=cleanRoom(ui.remoteRoom.value);updateRemoteUI();};ui.inputSource.onchange=()=>{inputSource=ui.inputSource.value;localArm=false;localThrottle=0;arm=false;throttle=0;updateRemoteUI();};
const remoteParams=new URLSearchParams(location.search),initialRoom=cleanRoom(remoteParams.get("room")||localStorage.getItem("arondight45Room")||randomRoom());ui.remoteRoom.value=initialRoom;inputSource=ui.inputSource.value;updateRemoteUI();setInterval(updateRemoteUI,250);

'''
rep('const fitted=localStorage.getItem("arondight45FittedPhysics");', remote_init + 'const fitted=localStorage.getItem("arondight45FittedPhysics");', "remote initialization")
rep('await switchMode("sim");', 'await switchMode("sim");\nif(remoteParams.get("room")&&remoteLink.relayUrl())await connectRemote();', "auto remote connect")

p.write_text(s)
