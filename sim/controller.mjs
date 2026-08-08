import {ControllerPeerLink,copySignal,shareSignal} from "./p2p_link.mjs";
import {QrScanner,renderQr} from "./qr_pairing.mjs";
import {neutralControls,armReady as sharedArmReady,normalizedPointer,endPointerDrag,applyStick,releaseStick,knobAxes,knobPercent,phoneAxis,inversePhoneAxis} from "./control_semantics.mjs";
import {loadPhoneControlSettings,mountPhoneControlSettings} from "./control_settings.mjs";

const $ = id => document.getElementById(id);
const clamp=(value,lo,hi)=>Math.max(lo,Math.min(hi,value));
const ui = Object.fromEntries([
  "connection","connect","fullscreen","leftStick","leftKnob","leftValue","rightStick","rightKnob","rightValue","arm","kill","pairDialog","pairStatus","createOffer","offerCode","copyOffer","shareOffer","answerCode","applyAnswer","closePair","offerQr","answerVideo","answerCanvas","fcState","altitude","battery","motors"
].map(id=>[id,$(id)]));

const SEND_INTERVAL_MS = 20;
const peer = new ControllerPeerLink();
const answerScanner = new QrScanner(ui.answerVideo,ui.answerCanvas);
let phoneSettings=loadPhoneControlSettings();
let offerCreating=false;
let lastTelemetry={fc_state:"—"};
let gameMode=localStorage.getItem("arondight45ControlMode")!=="manual";
let groundClearance=clamp(Number(localStorage.getItem("arondight45GroundClearance"))||2,.5,5);
let vectorDebugEls=null;

function neutralForMode(){return{...neutralControls(),gameMode,groundClearance,lookPitch:0};}
let controls=neutralForMode();

const gameStyle=document.createElement("style");gameStyle.textContent=`
  .sticks{position:relative}
  body.game-state .sticks{grid-template-columns:minmax(0,1fr) 48px minmax(0,1fr);gap:clamp(8px,2vw,22px)}
  body.game-state .sticks>.stick-wrap:first-child{grid-column:1;grid-row:1}
  body.game-state .sticks>.stick-wrap:nth-child(2){grid-column:3;grid-row:1}
  body.game-state .stick-wrap{width:min(37vw,370px)}
  #gameModeButton.active{background:#17694f;border-color:#62d6aa;color:#fff}
  #gameClearance{position:relative;z-index:4;grid-column:2;grid-row:1;align-self:center;justify-self:center;width:48px;height:190px;border:1px solid #3a4964;border-radius:14px;background:#0b1420e8;box-shadow:0 8px 28px #0007;display:flex;flex-direction:column;align-items:center;padding:8px 5px;backdrop-filter:blur(8px);touch-action:none}
  #gameClearance[hidden]{display:none!important}
  #gameClearance strong{font:900 11px ui-monospace,SFMono-Regular,Menlo,monospace;color:#6be4b0;white-space:nowrap;margin:3px 0 5px}
  #gameClearance small{font:900 8px system-ui,-apple-system,sans-serif;color:#8fa1bb;letter-spacing:.08em;text-align:center}
  #gameClearanceSlider{position:relative;flex:1;width:34px;min-height:92px;display:grid;place-items:center;cursor:ns-resize;touch-action:none;user-select:none;-webkit-user-select:none;outline:none}
  #gameClearanceSlider:focus-visible{box-shadow:0 0 0 2px #64e0ae88;border-radius:8px}
  #gameClearanceSlider .clearance-track{position:relative;width:7px;height:100%;border-radius:999px;background:#17263a;border:1px solid #344660;overflow:visible}
  #gameClearanceFill{position:absolute;left:-1px;right:-1px;bottom:-1px;height:0;border-radius:999px;background:#2e8f6d;border:1px solid #64e0ae66;pointer-events:none}
  #gameClearanceThumb{position:absolute;left:50%;bottom:-7px;width:20px;height:14px;transform:translateX(-50%);border-radius:7px;background:#dce9f7;border:2px solid #64e0ae;box-shadow:0 2px 8px #0009;pointer-events:none}
  #gameSensorStatus{font:800 7px/1.15 system-ui,-apple-system,sans-serif;text-align:center;color:#ffd06d;max-width:42px;margin-top:5px}
  .state-vector-debug{margin:16px 0 4px;padding:12px;border:1px solid #ffffff25;border-radius:12px;background:#07101bc7}
  .state-vector-debug.inactive{opacity:.55}
  .state-vector-debug h4{margin:0 0 8px;font:900 12px system-ui,-apple-system,sans-serif;letter-spacing:.08em;color:#dbe8f6}
  .state-vector-legend{display:flex;gap:14px;align-items:center;margin-bottom:7px;font:900 11px ui-monospace,SFMono-Regular,Menlo,monospace}
  .state-vector-legend .soll,.state-vector-line.soll{color:#6be4b0}.state-vector-legend .ist,.state-vector-line.ist{color:#56b9ff}
  .state-vector-plot{display:block;width:100%;height:168px;border:1px solid #ffffff17;border-radius:10px;background:#0b1624}
  .state-vector-line{margin-top:7px;font:800 10.5px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-word}
  .state-vector-error{margin-top:7px;color:#c8d4e3;font:800 10px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace}
  .state-vector-note{margin-top:7px!important;margin-bottom:0!important;color:#7f93aa!important;font:10px/1.35 system-ui,-apple-system,sans-serif!important}
  @media(max-width:800px) and (orientation:portrait){body.game-state .sticks{grid-template-columns:minmax(0,1fr) 42px minmax(0,1fr);gap:6px}body.game-state .stick-wrap{width:min(38vw,310px)}#gameClearance{width:42px;height:170px;padding-left:3px;padding-right:3px}}
  @media(max-height:500px){body.game-state .sticks{grid-template-columns:minmax(0,1fr) 44px minmax(0,1fr);gap:10px}body.game-state .stick-wrap{width:min(34vw,310px)}#gameClearance{width:44px;height:150px;padding-top:5px;padding-bottom:5px}#gameClearanceSlider{min-height:74px}}
`;
document.head.appendChild(gameStyle);
const modeButton=document.createElement("button");modeButton.id="gameModeButton";modeButton.type="button";document.querySelector(".top").appendChild(modeButton);
const gameClearancePanel=document.createElement("div");gameClearancePanel.id="gameClearance";gameClearancePanel.innerHTML=`<small>HEIGHT</small><strong id="gameClearanceValue">2.0 m</strong><div id="gameClearanceSlider" role="slider" tabindex="0" aria-label="Ground clearance" aria-valuemin="0.5" aria-valuemax="5" aria-valuenow="2"><div class="clearance-track"><div id="gameClearanceFill"></div><div id="gameClearanceThumb"></div></div></div><div id="gameSensorStatus">SENSORS —</div>`;document.querySelector(".sticks").appendChild(gameClearancePanel);
const clearanceSlider=$("gameClearanceSlider"),clearanceValue=$("gameClearanceValue"),clearanceFill=$("gameClearanceFill"),clearanceThumb=$("gameClearanceThumb"),gameSensorStatus=$("gameSensorStatus");
let clearancePointer=null;

function renderClearance(){
  const t=clamp((groundClearance-.5)/4.5,0,1);
  clearanceValue.textContent=`${groundClearance.toFixed(1)} m`;
  clearanceSlider.value=groundClearance.toFixed(1);
  clearanceSlider.setAttribute("aria-valuenow",groundClearance.toFixed(1));
  clearanceFill.style.height=`${(t*100).toFixed(2)}%`;
  clearanceThumb.style.bottom=`calc(${(t*100).toFixed(2)}% - 7px)`;
}
function setGroundClearance(value){
  groundClearance=clamp(Math.round(Number(value)*10)/10,.5,5);
  localStorage.setItem("arondight45GroundClearance",String(groundClearance));
  controls.groundClearance=groundClearance;
  renderClearance();renderVectorDebug();publish();
}
function clearanceFromPointer(event){
  const rect=clearanceSlider.getBoundingClientRect();
  const t=clamp((rect.bottom-event.clientY)/Math.max(1,rect.height),0,1);
  setGroundClearance(.5+t*4.5);
}
clearanceSlider.addEventListener("pointerdown",event=>{
  clearancePointer=event.pointerId;clearanceSlider.setPointerCapture(clearancePointer);clearanceFromPointer(event);event.preventDefault();
});
clearanceSlider.addEventListener("pointermove",event=>{if(event.pointerId===clearancePointer){clearanceFromPointer(event);event.preventDefault();}});
const releaseClearance=event=>{if(event.pointerId!==clearancePointer)return;try{clearanceSlider.releasePointerCapture(clearancePointer);}catch{}clearancePointer=null;event.preventDefault();};
clearanceSlider.addEventListener("pointerup",releaseClearance);clearanceSlider.addEventListener("pointercancel",releaseClearance);
clearanceSlider.addEventListener("input",()=>{const value=Number(clearanceSlider.value);if(Number.isFinite(value))setGroundClearance(value);});
clearanceSlider.addEventListener("keydown",event=>{
  if(!["ArrowUp","ArrowRight","ArrowDown","ArrowLeft","Home","End"].includes(event.key))return;
  event.preventDefault();
  if(event.key==="Home")setGroundClearance(.5);
  else if(event.key==="End")setGroundClearance(5);
  else setGroundClearance(groundClearance+(["ArrowUp","ArrowRight"].includes(event.key)?.1:-.1));
});

function quantizedCentered(value){const raw=Math.round(992+820*clamp(Number(value)||0,-1,1));return clamp((raw-992)/820,-1,1);}
function stateShape(value,deadband,expo){const x=clamp(Number(value)||0,-1,1),a=Math.abs(x);if(a<=deadband)return 0;const t=(a-deadband)/(1-deadband),v=t*(1-expo)+t*t*t*expo;return Math.sign(x)*clamp(v,0,1);}
function desiredGameState(){
  let right=stateShape(quantizedCentered(controls.roll),.035,.25),forward=stateShape(quantizedCentered(controls.pitch),.035,.25);
  const magnitude=Math.hypot(forward,right);if(magnitude>1){forward/=magnitude;right/=magnitude;}
  return{forward:forward*5,right:right*5,agl:groundClearance,yawRate:stateShape(quantizedCentered(controls.yaw),.045,.20)*140};
}
function measuredGameState(){
  const vx=Number(lastTelemetry.nav_vx_mps),vy=Number(lastTelemetry.nav_vy_mps),vz=Number(lastTelemetry.nav_vz_mps),yaw=Number(lastTelemetry.yaw_deg);
  if(lastTelemetry.navigation_valid!==true||![vx,vy,vz,yaw].every(Number.isFinite))return{valid:false};
  const radians=yaw*Math.PI/180,c=Math.cos(radians),s=Math.sin(radians);
  return{valid:true,forward:-c*vx-s*vy,right:s*vx-c*vy,vertical:vz,agl:Number(lastTelemetry.agl_m),roll:Number(lastTelemetry.roll_deg),pitch:Number(lastTelemetry.pitch_deg),yaw};
}
function vectorPoint(forward,right){const magnitude=Math.hypot(forward,right),scale=magnitude>5?5/magnitude:1;return{x:right*scale/5*82,y:-forward*scale/5*82};}
function fmt(value,digits=2){return Number.isFinite(value)?`${value>=0?"+":""}${value.toFixed(digits)}`:"—";}
function renderVectorDebug(){
  if(!vectorDebugEls)return;
  const target=desiredGameState(),actual=measuredGameState(),tp=vectorPoint(target.forward,target.right),ap=actual.valid?vectorPoint(actual.forward,actual.right):{x:0,y:0};
  vectorDebugEls.panel.classList.toggle("inactive",!gameMode);
  vectorDebugEls.target.setAttribute("x2",tp.x.toFixed(2));vectorDebugEls.target.setAttribute("y2",tp.y.toFixed(2));
  vectorDebugEls.actual.setAttribute("x2",ap.x.toFixed(2));vectorDebugEls.actual.setAttribute("y2",ap.y.toFixed(2));vectorDebugEls.actual.style.opacity=actual.valid?"1":".18";
  vectorDebugEls.soll.textContent=`SOLL  v[F ${fmt(target.forward)} | R ${fmt(target.right)}] m/s  |v| ${Math.hypot(target.forward,target.right).toFixed(2)}  AGL* ${target.agl.toFixed(1)} m  YAW-RATE* ${fmt(target.yawRate,1)}°/s`;
  vectorDebugEls.ist.textContent=actual.valid?`IST   v[F ${fmt(actual.forward)} | R ${fmt(actual.right)} | Z ${fmt(actual.vertical)}] m/s  |vXY| ${Math.hypot(actual.forward,actual.right).toFixed(2)}  AGL ${Number.isFinite(actual.agl)?actual.agl.toFixed(2):"—"} m  R/P/Y ${fmt(actual.roll,1)} / ${fmt(actual.pitch,1)} / ${fmt(actual.yaw,1)}°`:`IST   NAV / VEKTOR —`;
  vectorDebugEls.error.textContent=actual.valid?`FEHLER Δv = [F ${fmt(target.forward-actual.forward)} | R ${fmt(target.right-actual.right)}] m/s  |ΔvXY| ${Math.hypot(target.forward-actual.forward,target.right-actual.right).toFixed(2)}  ΔAGL ${fmt(target.agl-actual.agl)} m`:`FEHLER — wartet auf navigation_valid`;
}

function renderMode(){
  document.body.classList.toggle("game-state",gameMode);modeButton.classList.toggle("active",gameMode);modeButton.textContent=gameMode?"MODE · GAME":"MODE · MANUAL";gameClearancePanel.hidden=!gameMode;
  const leftWrap=ui.leftStick.parentElement,rightWrap=ui.rightStick.parentElement;
  const leftLabels=leftWrap.querySelectorAll(".axis-label"),rightLabels=rightWrap.querySelectorAll(".axis-label");
  if(gameMode){
    leftLabels[0].textContent="FORWARD";leftLabels[1].textContent="REVERSE";leftLabels[2].textContent="STRAFE L";leftLabels[3].textContent="STRAFE R";
    rightLabels[0].textContent="CAM UP";rightLabels[1].textContent="CAM DOWN";rightLabels[2].textContent="TURN L";rightLabels[3].textContent="TURN R";
  }else{
    leftLabels[0].textContent="THROTTLE +";leftLabels[1].textContent="THROTTLE −";leftLabels[2].textContent="YAW L";leftLabels[3].textContent="YAW R";
    rightLabels[0].textContent="PITCH +";rightLabels[1].textContent="PITCH −";rightLabels[2].textContent="ROLL L";rightLabels[3].textContent="ROLL R";
  }
  renderClearance();updateSticks();renderVectorDebug();
}

function setConnection(text,kind="warn"){ui.connection.textContent=text;ui.connection.className=`pill ${kind}`;}
function setPairStatus(text,kind="warn"){ui.pairStatus.textContent=text;ui.pairStatus.className=`pair-status ${kind}`;}
function armReady(){
  if(gameMode&&lastTelemetry.navigation_valid!==true)return false;
  return sharedArmReady(lastTelemetry.fc_state,controls,peer.linked,phoneSettings);
}
function updateArm(){
  ui.arm.classList.remove("arming","armed");
  if(controls.arm){
    if(lastTelemetry.fc_state==="ARMED"){ui.arm.textContent="ARMED ✓";ui.arm.classList.add("armed");}
    else{ui.arm.textContent="ARM REQUESTED…";ui.arm.classList.add("arming");}
    ui.arm.disabled=false;
    return;
  }
  ui.arm.textContent=lastTelemetry.fc_state==="CALIBRATING"?"CALIBRATING…":"ARM";
  ui.arm.disabled=!armReady();
}
function setKnob(knob,x,y){knob.style.left=`${knobPercent(x)}%`;knob.style.top=`${knobPercent(y)}%`;knob.style.transform="translate(-50%,-50%)";}
function updateSticks(){
  let left,right;
  if(gameMode){
    left={x:phoneSettings.lockLeftHorizontal?0:inversePhoneAxis(controls.roll,phoneSettings.leftFineness),y:-inversePhoneAxis(controls.pitch,phoneSettings.leftFineness)};
    right={x:-inversePhoneAxis(controls.yaw,phoneSettings.rightFineness),y:phoneSettings.lockRightHorizontal?0:-inversePhoneAxis(controls.lookPitch||0,phoneSettings.rightFineness)};
    ui.leftValue.textContent=`FWD ${(controls.pitch*5).toFixed(1)} · STR ${(controls.roll*5).toFixed(1)} m/s`;
    ui.rightValue.textContent=`TURN ${(controls.yaw*100).toFixed(0)}% · CAM ${((controls.lookPitch||0)*100).toFixed(0)}%`;
  }else{
    left=knobAxes(controls,"left",phoneSettings);right=knobAxes(controls,"right",phoneSettings);
    ui.leftValue.textContent=`T ${(controls.throttle*100).toFixed(0)}% · Y ${(controls.yaw*100).toFixed(0)}%`;
    ui.rightValue.textContent=`R ${(controls.roll*100).toFixed(0)}% · P ${(controls.pitch*100).toFixed(0)}%`;
  }
  setKnob(ui.leftKnob,left.x,left.y);setKnob(ui.rightKnob,right.x,right.y);updateArm();renderVectorDebug();
}
function publish(){controls.gameMode=gameMode;controls.groundClearance=groundClearance;peer.publish(controls);}
function safetyNeutral(send=true){controls=neutralForMode();updateSticks();if(send)publish();}
function bindStick(element,kind){
  let pointer=null;
  element.addEventListener("pointerdown",event=>{pointer=event.pointerId;element.setPointerCapture(pointer);apply(event);event.preventDefault();});
  element.addEventListener("pointermove",event=>{if(event.pointerId===pointer)apply(event);});
  const release=event=>{if(event.pointerId!==pointer)return;endPointerDrag(element,event.pointerId);pointer=null;
    if(gameMode){if(kind==="left"){controls.roll=0;controls.pitch=0;controls.throttle=0;}else{controls.yaw=0;controls.lookPitch=0;}}
    else releaseStick(controls,kind);
    updateSticks();publish();event.preventDefault();};
  element.addEventListener("pointerup",release);element.addEventListener("pointercancel",release);
  function apply(event){
    const point=normalizedPointer(element,event);
    if(gameMode){
      if(kind==="left"){
        controls.roll=phoneSettings.lockLeftHorizontal?0:phoneAxis(point.x,phoneSettings.leftFineness);
        controls.pitch=phoneAxis(-point.y,phoneSettings.leftFineness);
        controls.throttle=0;
      }else{
        controls.yaw=phoneAxis(-point.x,phoneSettings.rightFineness);
        controls.lookPitch=phoneSettings.lockRightHorizontal?0:phoneAxis(-point.y,phoneSettings.rightFineness);
      }
    }else applyStick(controls,kind,point,phoneSettings);
    updateSticks();publish();
  }
}

modeButton.onclick=()=>{
  controls.arm=false;gameMode=!gameMode;localStorage.setItem("arondight45ControlMode",gameMode?"game":"manual");controls=neutralForMode();renderMode();publish();
};

async function applyAnswerCode(code){
  ui.answerCode.value=code;
  await peer.applyAnswer(code);
  setPairStatus("Answer detected. Establishing direct DataChannel…","good");
  updateConnection();
}
async function createOffer(){
  if(offerCreating)return;offerCreating=true;ui.createOffer.disabled=true;setPairStatus("Creating direct P2P session…");
  try{
    safetyNeutral(false);ui.answerCode.value="";ui.offerCode.value=await peer.createOffer();renderQr(ui.offerQr,ui.offerCode.value);
    setPairStatus("Show the QR to the VIEW phone. This camera is already scanning for its answer.","good");
    try{
      await answerScanner.start(async code=>{
        try{await applyAnswerCode(code);return true;}catch{return false;}
      });
    }catch(error){setPairStatus(`QR is ready. Camera scan unavailable: ${error.message}. Manual fallback remains below.`,"warn");}
  }catch(error){setPairStatus(error.message,"bad");}
  finally{offerCreating=false;ui.createOffer.disabled=false;updateConnection();}
}
async function disconnect(){safetyNeutral(true);await answerScanner.stop();await peer.disconnect();ui.offerCode.value="";ui.answerCode.value="";ui.offerQr.hidden=true;updateConnection();}
function updateConnection(){
  const label=peer.stateLabel();
  if(peer.linked){
    setConnection("P2P LINKED","good");ui.connect.textContent="DISCONNECT";setPairStatus("Direct control active. Normal short interruptions reconnect automatically without pairing.","good");
    if(ui.pairDialog.open){answerScanner.stop();ui.pairDialog.close();}
  }else if(peer.pc&&peer.recentlyLinked){
    setConnection(label,"warn");ui.connect.textContent="SESSION ACTIVE";setPairStatus("Recent peer session is reconnecting. Re-pair only if the underlying WebRTC session cannot recover.","warn");
  }else if(peer.pc){setConnection(label,"warn");ui.connect.textContent="PAIRING…";}
  else{setConnection("DISCONNECTED","warn");ui.connect.textContent="CONNECT";}
  updateArm();
}

peer.onState=()=>{updateConnection();if(!peer.linked)safetyNeutral(false);};
peer.onTelemetry=message=>{
  const previousFcState=lastTelemetry.fc_state;
  lastTelemetry=message;
  if(previousFcState==="ARMED"&&message.fc_state!=="ARMED"&&controls.arm){
    controls.arm=false;
    publish();
  }
  ui.fcState.textContent=message.fc_state||"—";
  ui.altitude.textContent=Number.isFinite(message.altitude)?`${message.altitude.toFixed(2)} m`:"—";
  ui.battery.textContent=Number.isFinite(message.battery_v)?`${message.battery_v.toFixed(2)} V`:"—";
  ui.motors.textContent=Array.isArray(message.motors)?message.motors.map(Math.round).join(" "):"—";
  if(gameMode){
    const valid=message.navigation_valid===true;
    gameSensorStatus.textContent=valid?`AGL ${Number(message.agl_m??message.altitude).toFixed(1)} m`:(message.game_mode?"NAV INVALID":"STATE READY");
    gameSensorStatus.style.color=valid?"#64e0ae":"#ffd06d";
  }
  updateArm();renderVectorDebug();
};

bindStick(ui.leftStick,"left");bindStick(ui.rightStick,"right");
ui.arm.onclick=()=>{
  if(controls.arm){controls.arm=false;updateArm();publish();return;}
  if(!armReady()){setConnection(lastTelemetry.fc_state==="CALIBRATING"?"WAIT · CALIBRATING":"ARM REQUEST UNAVAILABLE","warn");return;}
  controls.arm=true;updateArm();publish();
};
ui.kill.onclick=()=>safetyNeutral(true);
ui.connect.onclick=async()=>{
  if(peer.linked){await disconnect();return;}
  if(peer.pc&&peer.recentlyLinked){ui.pairDialog.showModal();setPairStatus("Recent peer session is reconnecting. Re-pair only if the underlying WebRTC session cannot recover.","warn");return;}
  ui.pairDialog.showModal();await createOffer();
};
ui.createOffer.onclick=async()=>{await disconnect();ui.pairDialog.showModal();await createOffer();};
ui.applyAnswer.onclick=async()=>{try{await applyAnswerCode(ui.answerCode.value);}catch(error){setPairStatus(error.message,"bad");}};
ui.closePair.onclick=async()=>{await answerScanner.stop();ui.pairDialog.close();};
ui.copyOffer.onclick=async()=>{try{await copySignal(ui.offerCode.value);setPairStatus("Offer copied.","good");}catch(error){setPairStatus(error.message,"bad");}};
ui.shareOffer.onclick=async()=>{try{await shareSignal("Arondight45 controller offer",ui.offerCode.value);setPairStatus("Offer shared.","good");}catch(error){if(error?.name!=="AbortError")setPairStatus(error.message,"bad");}};
ui.fullscreen.onclick=async()=>{try{if(!document.fullscreenElement)await document.documentElement.requestFullscreen();else await document.exitFullscreen();try{await screen.orientation?.lock?.("landscape");}catch{}}catch{}};

const settingsUi=mountPhoneControlSettings({
  parent:document.querySelector(".top"),
  buttonText:"SETTINGS",
  onChange:next=>{phoneSettings=next;safetyNeutral(true);},
});
const vectorDebug=document.createElement("section");vectorDebug.id="stateVectorDebug";vectorDebug.className="state-vector-debug";vectorDebug.innerHTML=`
  <h4>STATE VECTOR DEBUG</h4>
  <div class="state-vector-legend"><span class="soll">● SOLL</span><span class="ist">● IST</span></div>
  <svg class="state-vector-plot" viewBox="-100 -100 200 200" role="img" aria-label="Soll- und Ist-Geschwindigkeitsvektor">
    <defs>
      <marker id="stateSollArrow" markerWidth="7" markerHeight="7" refX="5.5" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 Z" fill="#6be4b0"/></marker>
      <marker id="stateIstArrow" markerWidth="7" markerHeight="7" refX="5.5" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 Z" fill="#56b9ff"/></marker>
    </defs>
    <circle cx="0" cy="0" r="82" fill="none" stroke="#ffffff1d" stroke-width="1"/>
    <circle cx="0" cy="0" r="41" fill="none" stroke="#ffffff12" stroke-width="1"/>
    <line x1="-88" y1="0" x2="88" y2="0" stroke="#ffffff23" stroke-width="1"/>
    <line x1="0" y1="-88" x2="0" y2="88" stroke="#ffffff23" stroke-width="1"/>
    <text x="0" y="-89" fill="#8fa1bb" font-size="8" text-anchor="middle">FORWARD</text>
    <text x="91" y="3" fill="#8fa1bb" font-size="8" text-anchor="start">RIGHT</text>
    <line data-vector-soll x1="0" y1="0" x2="0" y2="0" stroke="#6be4b0" stroke-width="4" stroke-linecap="round" marker-end="url(#stateSollArrow)"/>
    <line data-vector-ist x1="0" y1="0" x2="0" y2="0" stroke="#56b9ff" stroke-width="3" stroke-linecap="round" stroke-dasharray="7 4" marker-end="url(#stateIstArrow)"/>
    <circle cx="0" cy="0" r="3" fill="#fff"/>
  </svg>
  <div class="state-vector-line soll" data-vector-soll-text></div>
  <div class="state-vector-line ist" data-vector-ist-text></div>
  <div class="state-vector-error" data-vector-error></div>
  <p class="state-vector-note">Overlay uses the actual FC navigation sensor input, not Box3D truth. 82 px = 5 m/s. Roll/pitch are internal actuator coordinates; the user target remains velocity + AGL + yaw-rate.</p>`;
settingsUi.dialog.insertBefore(vectorDebug,settingsUi.dialog.querySelector(".phone-settings-actions"));
vectorDebugEls={panel:vectorDebug,target:vectorDebug.querySelector("[data-vector-soll]"),actual:vectorDebug.querySelector("[data-vector-ist]"),soll:vectorDebug.querySelector("[data-vector-soll-text]"),ist:vectorDebug.querySelector("[data-vector-ist-text]"),error:vectorDebug.querySelector("[data-vector-error]")};

addEventListener("pagehide",()=>safetyNeutral(true));
addEventListener("pageshow",()=>{phoneSettings=loadPhoneControlSettings();safetyNeutral(false);publish();updateConnection();});
document.addEventListener("visibilitychange",()=>{if(document.hidden)safetyNeutral(true);else{phoneSettings=loadPhoneControlSettings();publish();updateConnection();}});
setInterval(()=>publish(),SEND_INTERVAL_MS);
setInterval(updateConnection,250);
setInterval(renderVectorDebug,100);

renderMode();updateSticks();updateConnection();renderVectorDebug();