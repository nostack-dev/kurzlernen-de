import {ControllerPeerLink,copySignal,shareSignal} from "./p2p_link.mjs";
import {QrScanner,renderQr} from "./qr_pairing.mjs";
import {neutralControls,armReady as sharedArmReady,normalizedPointer,applyStick,releaseStick,knobAxes,knobPercent} from "./control_semantics.mjs";

const $ = id => document.getElementById(id);
const ui = Object.fromEntries([
  "connection","connect","fullscreen","leftStick","leftKnob","leftValue","rightStick","rightKnob","rightValue","arm","kill","pairDialog","pairStatus","createOffer","offerCode","copyOffer","shareOffer","answerCode","applyAnswer","closePair","offerQr","answerVideo","answerCanvas","fcState","altitude","battery","motors"
].map(id=>[id,$(id)]));

const SEND_INTERVAL_MS = 20;
const peer = new ControllerPeerLink();
const answerScanner = new QrScanner(ui.answerVideo,ui.answerCanvas);
let controls=neutralControls();
let offerCreating=false;
let lastTelemetry={fc_state:"—"};

function setConnection(text,kind="warn"){ui.connection.textContent=text;ui.connection.className=`pill ${kind}`;}
function setPairStatus(text,kind="warn"){ui.pairStatus.textContent=text;ui.pairStatus.className=`pair-status ${kind}`;}
function armReady(){return sharedArmReady(lastTelemetry.fc_state,controls,peer.linked);}
function updateArm(){
  ui.arm.classList.remove("arming","armed");
  if(controls.arm){
    if(lastTelemetry.fc_state==="ARMED"){ui.arm.textContent="ARMED ✓";ui.arm.classList.add("armed");}
    else{ui.arm.textContent="ARMING…";ui.arm.classList.add("arming");}
    ui.arm.disabled=false;
    return;
  }
  ui.arm.textContent=lastTelemetry.fc_state==="CALIBRATING"?"CALIBRATING…":"ARM";
  ui.arm.disabled=!armReady();
}
function setKnob(knob,x,y){knob.style.left=`${knobPercent(x)}%`;knob.style.top=`${knobPercent(y)}%`;knob.style.transform="translate(-50%,-50%)";}
function updateSticks(){
  const left=knobAxes(controls,"left"),right=knobAxes(controls,"right");
  setKnob(ui.leftKnob,left.x,left.y);
  setKnob(ui.rightKnob,right.x,right.y);
  ui.leftValue.textContent=`T ${(controls.throttle*100).toFixed(0)}% · Y ${(controls.yaw*100).toFixed(0)}%`;
  ui.rightValue.textContent=`R ${(controls.roll*100).toFixed(0)}% · P ${(controls.pitch*100).toFixed(0)}%`;
  updateArm();
}
function publish(force=false){peer.publish(controls,force);}
function safetyNeutral(send=true){controls=neutralControls();updateSticks();if(send)publish(true);}
function bindStick(element,kind){
  let pointer=null;
  element.addEventListener("pointerdown",event=>{pointer=event.pointerId;element.setPointerCapture(pointer);apply(event);event.preventDefault();});
  element.addEventListener("pointermove",event=>{if(event.pointerId===pointer)apply(event);});
  const release=event=>{if(event.pointerId!==pointer)return;pointer=null;releaseStick(controls,kind);updateSticks();publish(true);};
  element.addEventListener("pointerup",release);element.addEventListener("pointercancel",release);
  function apply(event){applyStick(controls,kind,normalizedPointer(element,event));updateSticks();publish();}
}

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
    setConnection(label,"warn");ui.connect.textContent="SESSION ACTIVE";setPairStatus("Recent session retained for 5 minutes. Waiting for WebRTC to recover — no re-pairing yet.","warn");
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
  updateArm();
};

bindStick(ui.leftStick,"left");bindStick(ui.rightStick,"right");
ui.arm.onclick=()=>{
  if(controls.arm){controls.arm=false;updateArm();publish(true);return;}
  if(!armReady()){setConnection(lastTelemetry.fc_state==="CALIBRATING"?"WAIT · CALIBRATING":"ARM BLOCKED · THROTTLE 0 / CENTER STICKS","warn");return;}
  controls.arm=true;updateArm();publish(true);
};
ui.kill.onclick=()=>safetyNeutral(true);
ui.connect.onclick=async()=>{
  if(peer.linked){await disconnect();return;}
  if(peer.pc&&peer.recentlyLinked){ui.pairDialog.showModal();setPairStatus("Recent session is reconnecting automatically. No codes or QR scan needed unless it expires.","warn");return;}
  ui.pairDialog.showModal();await createOffer();
};
ui.createOffer.onclick=async()=>{await disconnect();ui.pairDialog.showModal();await createOffer();};
ui.applyAnswer.onclick=async()=>{try{await applyAnswerCode(ui.answerCode.value);}catch(error){setPairStatus(error.message,"bad");}};
ui.closePair.onclick=async()=>{await answerScanner.stop();ui.pairDialog.close();};
ui.copyOffer.onclick=async()=>{try{await copySignal(ui.offerCode.value);setPairStatus("Offer copied.","good");}catch(error){setPairStatus(error.message,"bad");}};
ui.shareOffer.onclick=async()=>{try{await shareSignal("Arondight45 controller offer",ui.offerCode.value);setPairStatus("Offer shared.","good");}catch(error){if(error?.name!=="AbortError")setPairStatus(error.message,"bad");}};
ui.fullscreen.onclick=async()=>{try{if(!document.fullscreenElement)await document.documentElement.requestFullscreen();else await document.exitFullscreen();try{await screen.orientation?.lock?.("landscape");}catch{}}catch{}};

addEventListener("pagehide",()=>safetyNeutral(true));
addEventListener("pageshow",()=>{safetyNeutral(false);publish(true);updateConnection();});
document.addEventListener("visibilitychange",()=>{if(document.hidden)safetyNeutral(true);else{publish(true);updateConnection();}});
setInterval(()=>publish(),SEND_INTERVAL_MS);
setInterval(updateConnection,250);

updateSticks();updateConnection();
