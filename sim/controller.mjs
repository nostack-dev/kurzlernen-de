import {ControllerPeerLink,copySignal,shareSignal} from "./p2p_link.mjs";

const $ = id => document.getElementById(id);
const clamp = (value,lo,hi) => Math.max(lo,Math.min(hi,value));
const ui = Object.fromEntries([
  "connection","connect","fullscreen","leftStick","leftKnob","leftValue","rightStick","rightKnob","rightValue","arm","kill","pairDialog","pairStatus","createOffer","offerCode","copyOffer","shareOffer","answerCode","applyAnswer","closePair","fcState","altitude","battery","motors"
].map(id=>[id,$(id)]));

const SEND_INTERVAL_MS = 20;
const peer = new ControllerPeerLink();
let controls={roll:0,pitch:0,yaw:0,throttle:0,arm:false};
let offerCreating=false;

function setConnection(text,kind="warn"){ui.connection.textContent=text;ui.connection.className=`pill ${kind}`;}
function setPairStatus(text,kind="warn"){ui.pairStatus.textContent=text;ui.pairStatus.className=`pair-status ${kind}`;}
function updateArm(){ui.arm.textContent=controls.arm?"ARM HIGH":"ARM LOW";ui.arm.classList.toggle("high",controls.arm);}
function setKnob(knob,x,y){knob.style.left=`${50+clamp(x,-1,1)*42}%`;knob.style.top=`${50+clamp(y,-1,1)*42}%`;knob.style.transform="translate(-50%,-50%)";}
function updateSticks(){
  setKnob(ui.leftKnob,controls.yaw,1-2*controls.throttle);
  setKnob(ui.rightKnob,controls.roll,-controls.pitch);
  ui.leftValue.textContent=`T ${(controls.throttle*100).toFixed(0)}% · Y ${(controls.yaw*100).toFixed(0)}%`;
  ui.rightValue.textContent=`R ${(controls.roll*100).toFixed(0)}% · P ${(controls.pitch*100).toFixed(0)}%`;
}
function publish(force=false){peer.publish(controls,force);}
function safetyNeutral(send=true){controls={roll:0,pitch:0,yaw:0,throttle:0,arm:false};updateSticks();updateArm();if(send)publish(true);}
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
  function apply(event){const p=normalizedPointer(element,event);if(kind==="left"){controls.yaw=p.x;controls.throttle=clamp((1-p.y)/2,0,1);}else{controls.roll=p.x;controls.pitch=-p.y;}updateSticks();publish();}
}

async function createOffer(){
  if(offerCreating)return;offerCreating=true;ui.createOffer.disabled=true;setPairStatus("Creating direct P2P offer…");
  try{
    safetyNeutral(false);ui.answerCode.value="";ui.offerCode.value=await peer.createOffer();
    setPairStatus("Offer ready. Send it to the VIEW phone, then paste its answer below.","good");
  }catch(error){setPairStatus(error.message,"bad");}
  finally{offerCreating=false;ui.createOffer.disabled=false;updateConnection();}
}
async function applyAnswer(){
  try{await peer.applyAnswer(ui.answerCode.value);setPairStatus("Answer applied. Waiting for direct DataChannel…");updateConnection();}
  catch(error){setPairStatus(error.message,"bad");}
}
async function disconnect(){safetyNeutral(true);await peer.disconnect();ui.offerCode.value="";ui.answerCode.value="";updateConnection();}
function updateConnection(){
  const label=peer.stateLabel();
  if(peer.linked){setConnection("P2P LINKED","good");ui.connect.textContent="Disconnect";setPairStatus("Direct phone-to-phone control link active. No relay/server in the data path.","good");if(ui.pairDialog.open)ui.pairDialog.close();}
  else if(peer.pc){setConnection(label,"warn");ui.connect.textContent="Pairing…";}
  else{setConnection("DISCONNECTED","warn");ui.connect.textContent="Connect";}
}

peer.onState=()=>{updateConnection();if(!peer.linked)safetyNeutral(false);};
peer.onTelemetry=message=>{
  ui.fcState.textContent=message.fc_state||"—";
  ui.altitude.textContent=Number.isFinite(message.altitude)?`${message.altitude.toFixed(2)} m`:"—";
  ui.battery.textContent=Number.isFinite(message.battery_v)?`${message.battery_v.toFixed(2)} V`:"—";
  ui.motors.textContent=Array.isArray(message.motors)?message.motors.map(Math.round).join(" "):"—";
};

bindStick(ui.leftStick,"left");bindStick(ui.rightStick,"right");
ui.arm.onclick=()=>{controls.arm=!controls.arm;updateArm();publish(true);};
ui.kill.onclick=()=>safetyNeutral(true);
ui.connect.onclick=async()=>{if(peer.pc){await disconnect();return;}ui.pairDialog.showModal();await createOffer();};
ui.createOffer.onclick=createOffer;
ui.applyAnswer.onclick=applyAnswer;
ui.closePair.onclick=()=>ui.pairDialog.close();
ui.copyOffer.onclick=async()=>{try{await copySignal(ui.offerCode.value);setPairStatus("Offer copied.","good");}catch(error){setPairStatus(error.message,"bad");}};
ui.shareOffer.onclick=async()=>{try{await shareSignal("Arondight45 controller offer",ui.offerCode.value);setPairStatus("Offer shared.","good");}catch(error){if(error?.name!=="AbortError")setPairStatus(error.message,"bad");}};
ui.fullscreen.onclick=async()=>{try{if(!document.fullscreenElement)await document.documentElement.requestFullscreen();else await document.exitFullscreen();try{await screen.orientation?.lock?.("landscape");}catch{}}catch{}};

addEventListener("pagehide",()=>safetyNeutral(true));
document.addEventListener("visibilitychange",()=>{if(document.hidden)safetyNeutral(true);});
setInterval(()=>publish(),SEND_INTERVAL_MS);

updateSticks();updateArm();updateConnection();
