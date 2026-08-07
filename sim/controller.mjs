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

function neutralForMode(){return{...neutralControls(),gameMode,groundClearance,lookPitch:0};}
let controls=neutralForMode();

const gameStyle=document.createElement("style");gameStyle.textContent=`
  .sticks{position:relative}
  body.game-state .stick-wrap{width:min(39vw,390px)}
  #gameModeButton.active{background:#17694f;border-color:#62d6aa;color:#fff}
  #gameClearance{position:absolute;z-index:4;left:50%;top:50%;transform:translate(-50%,-50%);width:64px;height:210px;border:1px solid #3a4964;border-radius:14px;background:#0b1420e8;box-shadow:0 8px 28px #0009;display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:9px 5px;backdrop-filter:blur(8px)}
  #gameClearance[hidden]{display:none!important}
  #gameClearance strong{font:900 14px ui-monospace,SFMono-Regular,Menlo,monospace;color:#6be4b0;white-space:nowrap}
  #gameClearance small{font:800 8px system-ui,-apple-system,sans-serif;color:#8fa1bb;letter-spacing:.08em;text-align:center}
  #gameClearance .range-shell{height:135px;width:38px;display:grid;place-items:center;overflow:visible}
  #gameClearance input{width:135px;transform:rotate(-90deg);accent-color:#6be4b0}
  #gameSensorStatus{font:800 8px/1.2 system-ui,-apple-system,sans-serif;text-align:center;color:#ffd06d;max-width:56px}
  @media(max-height:500px){#gameClearance{height:170px}#gameClearance .range-shell{height:100px}#gameClearance input{width:100px}}
`;
document.head.appendChild(gameStyle);
const modeButton=document.createElement("button");modeButton.id="gameModeButton";modeButton.type="button";document.querySelector(".top").appendChild(modeButton);
const gameClearancePanel=document.createElement("div");gameClearancePanel.id="gameClearance";gameClearancePanel.innerHTML=`<small>GROUND<br>CLEARANCE</small><strong id="gameClearanceValue">2.0 m</strong><div class="range-shell"><input id="gameClearanceSlider" type="range" min="0.5" max="5" step="0.1"></div><div id="gameSensorStatus">SENSORS —</div>`;document.querySelector(".sticks").appendChild(gameClearancePanel);
const clearanceSlider=$("gameClearanceSlider"),clearanceValue=$("gameClearanceValue"),gameSensorStatus=$("gameSensorStatus");
clearanceSlider.value=String(groundClearance);

function renderMode(){
  document.body.classList.toggle("game-state",gameMode);modeButton.classList.toggle("active",gameMode);modeButton.textContent=gameMode?"MODE · GAME":"MODE · MANUAL";gameClearancePanel.hidden=!gameMode;
  const labels={leftTop:document.querySelector("#leftStick~.axis-top"),leftBottom:document.querySelector("#leftStick~.axis-bottom")};
  const leftWrap=ui.leftStick.parentElement,rightWrap=ui.rightStick.parentElement;
  const leftLabels=leftWrap.querySelectorAll(".axis-label"),rightLabels=rightWrap.querySelectorAll(".axis-label");
  if(gameMode){
    leftLabels[0].textContent="FORWARD";leftLabels[1].textContent="REVERSE";leftLabels[2].textContent="STRAFE L";leftLabels[3].textContent="STRAFE R";
    rightLabels[0].textContent="CAM UP";rightLabels[1].textContent="CAM DOWN";rightLabels[2].textContent="TURN L";rightLabels[3].textContent="TURN R";
  }else{
    leftLabels[0].textContent="THROTTLE +";leftLabels[1].textContent="THROTTLE −";leftLabels[2].textContent="YAW L";leftLabels[3].textContent="YAW R";
    rightLabels[0].textContent="PITCH +";rightLabels[1].textContent="PITCH −";rightLabels[2].textContent="ROLL L";rightLabels[3].textContent="ROLL R";
  }
  clearanceValue.textContent=`${groundClearance.toFixed(1)} m`;updateSticks();
}

function setConnection(text,kind="warn"){ui.connection.textContent=text;ui.connection.className=`pill ${kind}`;}
function setPairStatus(text,kind="warn"){ui.pairStatus.textContent=text;ui.pairStatus.className=`pair-status ${kind}`;}
function armReady(){return sharedArmReady(lastTelemetry.fc_state,controls,peer.linked,phoneSettings);}
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
    left={x:inversePhoneAxis(controls.roll,phoneSettings.leftFineness),y:-inversePhoneAxis(controls.pitch,phoneSettings.leftFineness)};
    right={x:inversePhoneAxis(controls.yaw,phoneSettings.rightFineness),y:-inversePhoneAxis(controls.lookPitch||0,phoneSettings.rightFineness)};
    ui.leftValue.textContent=`FWD ${(controls.pitch*5).toFixed(1)} · STR ${(controls.roll*5).toFixed(1)} m/s`;
    ui.rightValue.textContent=`TURN ${(controls.yaw*100).toFixed(0)}% · CAM ${((controls.lookPitch||0)*100).toFixed(0)}%`;
  }else{
    left=knobAxes(controls,"left",phoneSettings);right=knobAxes(controls,"right",phoneSettings);
    ui.leftValue.textContent=`T ${(controls.throttle*100).toFixed(0)}% · Y ${(controls.yaw*100).toFixed(0)}%`;
    ui.rightValue.textContent=`R ${(controls.roll*100).toFixed(0)}% · P ${(controls.pitch*100).toFixed(0)}%`;
  }
  setKnob(ui.leftKnob,left.x,left.y);setKnob(ui.rightKnob,right.x,right.y);updateArm();
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
        controls.roll=phoneAxis(point.x,phoneSettings.leftFineness);
        controls.pitch=phoneAxis(-point.y,phoneSettings.leftFineness);
        controls.throttle=0;
      }else{
        controls.yaw=phoneAxis(point.x,phoneSettings.rightFineness);
        controls.lookPitch=phoneAxis(-point.y,phoneSettings.rightFineness);
      }
    }else applyStick(controls,kind,point,phoneSettings);
    updateSticks();publish();
  }
}

modeButton.onclick=()=>{
  controls.arm=false;gameMode=!gameMode;localStorage.setItem("arondight45ControlMode",gameMode?"game":"manual");controls=neutralForMode();renderMode();publish();
};
clearanceSlider.oninput=()=>{groundClearance=clamp(Number(clearanceSlider.value),.5,5);localStorage.setItem("arondight45GroundClearance",String(groundClearance));controls.groundClearance=groundClearance;clearanceValue.textContent=`${groundClearance.toFixed(1)} m`;publish();};

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
    setConnection(label,"warn");ui.connect.textContent="SESSION ACTIVE";setPairStatus("Recent peer session retained for up to 5 minutes while this WebRTC connection remains recoverable.","warn");
  }else if(peer.pc){setConnection(label,"warn");ui.connect.textContent="PAIRING…";}
  else{setConnection("DISCONNECTED","warn");ui.connect.textContent="CONNECT";}
  updateArm();
}

peer.onState=()=>{updateConnection();if(!peer.linked)safetyNeutral(false);};
peer.onTelemetry=message=>{
  lastTelemetry=message;
  ui.fcState.textContent=message.fc_state||"—";
  ui.altitude.textContent=Number.isFinite(message.altitude)?`${message.altitude.toFixed(2)} m`:"—";
  ui.battery.textContent=Number.isFinite(message.battery_v)?`${message.battery_v.toFixed(2)} V`:"—";
  ui.motors.textContent=Array.isArray(message.motors)?message.motors.map(Math.round).join(" "):"—";
  if(gameMode){
    const valid=message.navigation_valid===true;
    gameSensorStatus.textContent=valid?`AGL ${Number(message.agl_m??message.altitude).toFixed(1)} m`:(message.game_mode?"NAV INVALID":"STATE READY");
    gameSensorStatus.style.color=valid?"#64e0ae":"#ffd06d";
  }
  updateArm();
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

mountPhoneControlSettings({
  parent:document.querySelector(".top"),
  buttonText:"SETTINGS",
  onChange:next=>{phoneSettings=next;safetyNeutral(true);},
});

addEventListener("pagehide",()=>safetyNeutral(true));
addEventListener("pageshow",()=>{phoneSettings=loadPhoneControlSettings();safetyNeutral(false);publish();updateConnection();});
document.addEventListener("visibilitychange",()=>{if(document.hidden)safetyNeutral(true);else{phoneSettings=loadPhoneControlSettings();publish();updateConnection();}});
setInterval(()=>publish(),SEND_INTERVAL_MS);
setInterval(updateConnection,250);

renderMode();updateSticks();updateConnection();
