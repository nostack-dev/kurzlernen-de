import {ControllerPeerLink,copySignal,shareSignal} from "./p2p_link.mjs";
import {QrScanner,renderQr} from "./qr_pairing.mjs";
import {neutralControls,armReady as sharedArmReady,normalizedPointer,endPointerDrag,applyStick,releaseStick,knobAxes,knobPercent,phoneAxis,inversePhoneAxis} from "./control_semantics.mjs";
import {loadPhoneControlSettings,mountPhoneControlSettings} from "./control_settings.mjs";

const $=id=>document.getElementById(id);
const clamp=(value,lo,hi)=>Math.max(lo,Math.min(hi,value));
const ui=Object.fromEntries([
  "connection","connect","gameModeButton","fullscreen","leftStick","leftKnob","leftValue",
  "rightStick","rightKnob","rightValue","leftTopLabel","leftBottomLabel","leftLeftLabel","leftRightLabel",
  "rightTopLabel","rightBottomLabel","rightLeftLabel","rightRightLabel","gameClearance","gameClearanceValue",
  "gameClearanceSlider","gameUp","gameDown","gameSensorStatus","gameNav","arm","kill","pairDialog","pairStatus","createOffer",
  "offerCode","copyOffer","shareOffer","answerCode","applyAnswer","closePair","offerQr","answerVideo","answerCanvas",
  "fcState","altitude","battery","motors"
].map(id=>[id,$(id)]));

const SEND_INTERVAL_MS=20;
const peer=new ControllerPeerLink();
const answerScanner=new QrScanner(ui.answerVideo,ui.answerCanvas);
let phoneSettings=loadPhoneControlSettings();
let offerCreating=false;
let lastTelemetry={fc_state:"—"};
let gameMode=localStorage.getItem("arondight45ControlMode")!=="manual";
let groundClearance=clamp(Number(localStorage.getItem("arondight45GroundClearance"))||2,.5,5);

function neutralForMode(){return{...neutralControls(),gameMode,groundClearance};}
let controls=neutralForMode();

function setGroundClearance(value){
  const numeric=Number(value);
  if(!Number.isFinite(numeric))return;
  groundClearance=clamp(Math.round(numeric*10)/10,.5,5);
  localStorage.setItem("arondight45GroundClearance",String(groundClearance));
  controls.groundClearance=groundClearance;
  renderClearance();publish();
}
function renderClearance(){
  ui.gameClearanceSlider.value=groundClearance.toFixed(1);
  ui.gameClearanceValue.textContent=`${groundClearance.toFixed(1)} m`;
}
ui.gameClearanceSlider.addEventListener("input",event=>setGroundClearance(event.currentTarget.value));

function bindHeightKey(button,direction){
  let pointer=null,timer=0;
  const nudge=()=>setGroundClearance(groundClearance+direction*.1);
  const stop=event=>{
    if(pointer!==null&&event?.pointerId!=null&&event.pointerId!==pointer)return;
    if(timer){clearInterval(timer);timer=0;}
    button.classList.remove("active");
    if(pointer!==null)try{button.releasePointerCapture(pointer);}catch{}
    pointer=null;event?.preventDefault();
  };
  button.addEventListener("pointerdown",event=>{
    if(pointer!==null)return;
    pointer=event.pointerId;try{button.setPointerCapture(pointer);}catch{}
    button.classList.add("active");nudge();timer=setInterval(nudge,75);event.preventDefault();
  });
  button.addEventListener("pointerup",stop);button.addEventListener("pointercancel",stop);button.addEventListener("lostpointercapture",stop);
  return()=>stop();
}
const stopHeightUp=bindHeightKey(ui.gameUp,+1),stopHeightDown=bindHeightKey(ui.gameDown,-1);

function measuredGameState(){
  const vx=Number(lastTelemetry.nav_vx_mps),vy=Number(lastTelemetry.nav_vy_mps),vz=Number(lastTelemetry.nav_vz_mps),yaw=Number(lastTelemetry.yaw_deg),agl=Number(lastTelemetry.agl_m);
  if(lastTelemetry.navigation_valid!==true||![vx,vy,vz,yaw,agl].every(Number.isFinite))return{valid:false};
  const radians=yaw*Math.PI/180,c=Math.cos(radians),s=Math.sin(radians);
  return{valid:true,forward:-c*vx-s*vy,right:s*vx-c*vy,vertical:vz,agl,yaw};
}
function renderNavigation(){
  const nav=measuredGameState();
  if(!nav.valid){
    ui.gameSensorStatus.textContent=lastTelemetry.game_mode?"NAV INVALID":"STATE READY";
    ui.gameSensorStatus.style.color="#ffd06d";
    ui.gameNav.textContent="F — · R —";
    for(const key of ["navForwardMps","navRightMps","navVerticalMps","aglM","yawDeg"])delete ui.gameClearance.dataset[key];
    return;
  }
  ui.gameSensorStatus.textContent=`AGL ${nav.agl.toFixed(1)} m`;
  ui.gameSensorStatus.style.color="#64e0ae";
  ui.gameNav.textContent=`F ${nav.forward.toFixed(1)} · R ${nav.right.toFixed(1)}`;
  ui.gameClearance.dataset.navForwardMps=String(nav.forward);
  ui.gameClearance.dataset.navRightMps=String(nav.right);
  ui.gameClearance.dataset.navVerticalMps=String(nav.vertical);
  ui.gameClearance.dataset.aglM=String(nav.agl);
  ui.gameClearance.dataset.yawDeg=String(nav.yaw);
}

function renderMode(){
  document.body.classList.toggle("game-state",gameMode);
  ui.gameModeButton.classList.toggle("active",gameMode);
  ui.gameModeButton.textContent=gameMode?"MODE · GAME":"MODE · MANUAL";
  if(gameMode){
    ui.leftTopLabel.textContent="W · FORWARD";ui.leftBottomLabel.textContent="S · BACK";ui.leftLeftLabel.textContent="A · LEFT";ui.leftRightLabel.textContent="D · RIGHT";
    ui.rightTopLabel.textContent="NOSE UP";ui.rightBottomLabel.textContent="NOSE DOWN";ui.rightLeftLabel.textContent="TURN L";ui.rightRightLabel.textContent="TURN R";
  }else{
    ui.leftTopLabel.textContent="THROTTLE +";ui.leftBottomLabel.textContent="THROTTLE −";ui.leftLeftLabel.textContent="YAW L";ui.leftRightLabel.textContent="YAW R";
    ui.rightTopLabel.textContent="PITCH +";ui.rightBottomLabel.textContent="PITCH −";ui.rightLeftLabel.textContent="ROLL L";ui.rightRightLabel.textContent="ROLL R";
  }
  renderClearance();updateSticks();renderNavigation();
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
    const leftRawX=phoneSettings.lockLeftHorizontal?0:inversePhoneAxis(controls.roll,phoneSettings.leftFineness);
    left={x:leftRawX,y:-inversePhoneAxis(controls.pitch,phoneSettings.leftFineness)};
    const rawX=-inversePhoneAxis(controls.yaw,phoneSettings.rightFineness),rawY=phoneSettings.lockRightHorizontal?0:-inversePhoneAxis(controls.bodyPitch||0,phoneSettings.rightFineness);
    right={x:phoneSettings.invertRightHorizontal?-rawX:rawX,y:phoneSettings.invertRightVertical?-rawY:rawY};
    ui.leftValue.textContent=`FWD ${(controls.pitch*100).toFixed(0)}% · STR ${(controls.roll*100).toFixed(0)}%`;
    ui.rightValue.textContent=`TURN ${(controls.yaw*100).toFixed(0)}% · PITCH ${((controls.bodyPitch||0)*100).toFixed(0)}%`;
  }else{
    left=knobAxes(controls,"left",phoneSettings);right=knobAxes(controls,"right",phoneSettings);
    ui.leftValue.textContent=`T ${(controls.throttle*100).toFixed(0)}% · Y ${(controls.yaw*100).toFixed(0)}%`;
    ui.rightValue.textContent=`R ${(controls.roll*100).toFixed(0)}% · P ${(controls.pitch*100).toFixed(0)}%`;
  }
  setKnob(ui.leftKnob,left.x,left.y);setKnob(ui.rightKnob,right.x,right.y);updateArm();
}
function publish(){controls.gameMode=gameMode;controls.groundClearance=groundClearance;peer.publish(controls);}
function safetyNeutral(send=true){stopHeightUp();stopHeightDown();controls=neutralForMode();updateSticks();if(send)publish();}
function bindStick(element,kind){
  let pointer=null;
  element.addEventListener("pointerdown",event=>{pointer=event.pointerId;element.setPointerCapture(pointer);apply(event);event.preventDefault();});
  element.addEventListener("pointermove",event=>{if(event.pointerId===pointer)apply(event);});
  const release=event=>{
    if(event.pointerId!==pointer)return;
    endPointerDrag(element,event.pointerId);pointer=null;
    if(gameMode){
      if(kind==="left"){controls.roll=0;controls.pitch=0;controls.throttle=0;}
      else{controls.yaw=0;controls.bodyPitch=0;}
    }else releaseStick(controls,kind);
    updateSticks();publish();event.preventDefault();
  };
  element.addEventListener("pointerup",release);element.addEventListener("pointercancel",release);
  function apply(event){
    const point=normalizedPointer(element,event);
    if(gameMode){
      if(kind==="left"){
        const x=phoneSettings.invertLeftHorizontal?-point.x:point.x;
        controls.roll=phoneSettings.lockLeftHorizontal?0:phoneAxis(x,phoneSettings.leftFineness);
        controls.pitch=phoneAxis(-point.y,phoneSettings.leftFineness);
        controls.throttle=0;
      }else{
        const x=phoneSettings.invertRightHorizontal?-point.x:point.x;
        const y=phoneSettings.invertRightVertical?-point.y:point.y;
        controls.yaw=phoneAxis(-x,phoneSettings.rightFineness);
        controls.bodyPitch=phoneSettings.lockRightHorizontal?0:phoneAxis(-y,phoneSettings.rightFineness);
      }
    }else applyStick(controls,kind,point,phoneSettings);
    updateSticks();publish();
  }
}

ui.gameModeButton.onclick=()=>{
  controls.arm=false;gameMode=!gameMode;
  localStorage.setItem("arondight45ControlMode",gameMode?"game":"manual");
  controls=neutralForMode();renderMode();publish();
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
      await answerScanner.start(async code=>{try{await applyAnswerCode(code);return true;}catch{return false;}});
    }catch(error){setPairStatus(`QR is ready. Camera scan unavailable: ${error.message}. Manual fallback remains below.`,"warn");}
  }catch(error){setPairStatus(error.message,"bad");}
  finally{offerCreating=false;ui.createOffer.disabled=false;updateConnection();}
}
async function disconnect(){
  safetyNeutral(true);await answerScanner.stop();await peer.disconnect();ui.offerCode.value="";ui.answerCode.value="";ui.offerQr.hidden=true;updateConnection();
}
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
  const previousFcState=lastTelemetry.fc_state;
  lastTelemetry=message;
  if(previousFcState==="ARMED"&&message.fc_state!=="ARMED"&&controls.arm){controls.arm=false;publish();}
  ui.fcState.textContent=message.fc_state||"—";
  ui.altitude.textContent=Number.isFinite(message.altitude)?`${message.altitude.toFixed(2)} m`:"—";
  ui.battery.textContent=Number.isFinite(message.battery_v)?`${message.battery_v.toFixed(2)} V`:"—";
  ui.motors.textContent=Array.isArray(message.motors)?message.motors.map(Math.round).join(" "):"—";
  renderNavigation();updateArm();
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

renderMode();updateSticks();updateConnection();renderNavigation();