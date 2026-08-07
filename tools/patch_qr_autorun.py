from pathlib import Path

p=Path('sim/simulator.mjs')
s=p.read_text()

old='import {ViewPeerLink,copySignal,shareSignal} from "./p2p_link.mjs";\n'
new=old+'import {QrScanner,renderQr} from "./qr_pairing.mjs";\n'
assert old in s and 'qr_pairing.mjs' not in s
s=s.replace(old,new,1)

old_ids='"modeInfo","connect","run","reset","status","tMode","tController","fcState","simTime","altitude","velocity","attitude","motors","rpm","battery","current","processing","rtt","speed","armSwitch","throttle","logFile","fit","fitProgress","fitStatus","logSamples","touchRoll","touchPitch","touchYaw","touchThrottle","touchArm","exportLog","inputSource","remoteConnect","remoteStatus","controllerLink","pairDialog","remoteOffer","remoteAnswer","acceptOffer","copyAnswer","shareAnswer","pairStatus","closePair"'
new_ids='"modeInfo","connect","run","reset","status","tMode","tController","fcState","simTime","altitude","velocity","attitude","motors","rpm","battery","current","processing","rtt","speed","armSwitch","throttle","logFile","fit","fitProgress","fitStatus","logSamples","touchRoll","touchPitch","touchYaw","touchThrottle","touchArm","exportLog","inputSource","remoteConnect","remoteStatus","controllerLink","pairDialog","remoteOffer","remoteAnswer","acceptOffer","copyAnswer","shareAnswer","pairStatus","closePair","offerVideo","offerCanvas","answerQr"'
assert old_ids in s
s=s.replace(old_ids,new_ids,1)

old='let wallStart=performance.now(),simStart=0,replayIndex=0;\nconst keys=new Set();let localArm=false,localThrottle=0,arm=false,throttle=0,realLog=[],sessionLog=[];let inputSource="remote",effectiveInput={roll:0,pitch:0,yaw:0,throttle:0,arm:false},lastRemoteTelemetry=0;const remoteLink=new ViewPeerLink();'
new='let wallStart=performance.now(),simStart=0,replayIndex=0;\nconst keys=new Set();let localArm=false,localThrottle=0,arm=false,throttle=0,realLog=[],sessionLog=[];let inputSource="remote",effectiveInput={roll:0,pitch:0,yaw:0,throttle:0,arm:false},lastRemoteTelemetry=0,remoteAutoStarted=false;const remoteLink=new ViewPeerLink();const offerScanner=new QrScanner(ui.offerVideo,ui.offerCanvas);'
assert old in s
s=s.replace(old,new,1)

s=s.replace('ui.touchArm.textContent="ARM switch: LOW";','ui.touchArm.textContent="ARM request: OFF";',1)
s=s.replace('ui.armSwitch.textContent=arm?"HIGH":"LOW";','ui.armSwitch.textContent=arm?"ON":"OFF";',1)
s=s.replace('ui.touchArm.textContent=`ARM switch: ${localArm?"HIGH":"LOW"}`','ui.touchArm.textContent=`ARM request: ${localArm?"ON":"OFF"}`')

old='ui.run.onclick=()=>{if(mode!=="replay"&&!backend)return;if(mode==="replay"&&!realLog.length)return;running=!running;ui.run.textContent=running?"Pause":"Start";if(running){wallStart=performance.now();simStart=simTime;loop().catch(error=>{running=false;ui.run.textContent="Start";setStatus(error.message,"bad");});}};'
new='''function startRun(){\n  if(running)return true;if(mode!=="replay"&&!backend)return false;if(mode==="replay"&&!realLog.length)return false;\n  running=true;ui.run.textContent="Pause";wallStart=performance.now();simStart=simTime;loop().catch(error=>{running=false;ui.run.textContent="Start";setStatus(error.message,"bad");});return true;\n}\nfunction stopRun(){running=false;ui.run.textContent="Start";}\nui.run.onclick=()=>{if(running)stopRun();else startRun();};'''
assert old in s
s=s.replace(old,new,1)

old='ui.reset.onclick=()=>{running=false;ui.run.textContent="Start";resetSimulation(mode==="replay"&&realLog.length?realLog[0]:null);};'
new='ui.reset.onclick=()=>{stopRun();remoteAutoStarted=false;resetSimulation(mode==="replay"&&realLog.length?realLog[0]:null);};'
assert old in s
s=s.replace(old,new,1)

start=s.index('function updateRemoteUI(){')
end=s.index('\n\nconst fitted=',start)
replacement=r'''function updateRemoteUI(){
  const current=remoteLink.current();ui.controllerLink.href="./drone_controller.html";
  if(inputSource==="local"){ui.remoteStatus.textContent="LOCAL FALLBACK selected. P2P controller input is ignored.";ui.remoteStatus.className="statusline warn";}
  else if(remoteLink.linked&&current){
    ui.remoteStatus.textContent="P2P LINKED · direct control fresh";ui.remoteStatus.className="statusline good";
    if(mode==="sim"&&backend&&!running&&simTime===0&&!remoteAutoStarted){remoteAutoStarted=true;startRun();setStatus("SIM running · remote controller linked. Calibrating flight core…","good");}
  }
  else if(remoteLink.linked){ui.remoteStatus.textContent="P2P link alive but control stale (>350 ms) · fail-safe ARM OFF / throttle 0";ui.remoteStatus.className="statusline bad";}
  else if(remoteLink.pc&&remoteLink.recentlyLinked){ui.remoteStatus.textContent=`${remoteLink.stateLabel()} · fail-safe active · automatic recovery, no re-pairing`;ui.remoteStatus.className="statusline warn";}
  else if(remoteLink.pc){ui.remoteStatus.textContent=`${remoteLink.stateLabel()} · waiting for direct DataChannel`;ui.remoteStatus.className="statusline warn";}
  else{ui.remoteStatus.textContent="P2P disconnected · fail-safe ARM OFF / throttle 0.";ui.remoteStatus.className="statusline warn";}
  ui.remoteConnect.textContent=remoteLink.linked?"DISCONNECT":remoteLink.pc&&remoteLink.recentlyLinked?"SESSION ACTIVE":"PAIR CONTROLLER";
  if(remoteLink.linked&&ui.pairDialog.open){offerScanner.stop();ui.pairDialog.close();}
}
async function acceptControllerOffer(code=ui.remoteOffer.value){
  ui.acceptOffer.disabled=true;ui.pairStatus.textContent="Controller QR detected · creating direct WebRTC answer…";ui.pairStatus.className="statusline warn";
  try{
    ui.remoteOffer.value=code;ui.remoteAnswer.value=await remoteLink.acceptOffer(code);renderQr(ui.answerQr,ui.remoteAnswer.value);
    inputSource="remote";ui.inputSource.value="remote";localArm=false;localThrottle=0;arm=false;throttle=0;
    ui.pairStatus.textContent="Answer ready. Hold this QR toward the controller phone — it scans automatically.";ui.pairStatus.className="statusline good";
    return true;
  }catch(error){ui.pairStatus.textContent=error.message;ui.pairStatus.className="statusline bad";return false;}
  finally{ui.acceptOffer.disabled=false;updateRemoteUI();}
}
async function startOfferScanner(){
  ui.answerQr.hidden=true;ui.remoteOffer.value="";ui.remoteAnswer.value="";ui.pairStatus.textContent="Camera active · point it at the controller OFFER QR.";ui.pairStatus.className="statusline warn";
  try{await offerScanner.start(async code=>acceptControllerOffer(code));}
  catch(error){ui.pairStatus.textContent=`Camera unavailable: ${error.message}. Manual fallback is below.`;ui.pairStatus.className="statusline bad";}
}
async function toggleRemote(){
  if(remoteLink.linked){await remoteLink.disconnect();remoteAutoStarted=false;updateRemoteUI();return;}
  if(remoteLink.pc&&remoteLink.recentlyLinked){ui.pairDialog.showModal();ui.pairStatus.textContent="Recent session is reconnecting automatically. No QR scan needed unless it expires.";ui.pairStatus.className="statusline warn";return;}
  ui.pairDialog.showModal();await startOfferScanner();
}
remoteLink.onState=updateRemoteUI;
ui.remoteConnect.onclick=toggleRemote;
ui.acceptOffer.onclick=()=>acceptControllerOffer();
ui.copyAnswer.onclick=async()=>{try{await copySignal(ui.remoteAnswer.value);ui.pairStatus.textContent="Answer copied.";ui.pairStatus.className="statusline good";}catch(error){ui.pairStatus.textContent=error.message;ui.pairStatus.className="statusline bad";}};
ui.shareAnswer.onclick=async()=>{try{await shareSignal("Arondight45 VIEW answer",ui.remoteAnswer.value);ui.pairStatus.textContent="Answer shared.";ui.pairStatus.className="statusline good";}catch(error){if(error?.name!=="AbortError"){ui.pairStatus.textContent=error.message;ui.pairStatus.className="statusline bad";}}};
ui.closePair.onclick=async()=>{await offerScanner.stop();ui.pairDialog.close();};
ui.inputSource.onchange=()=>{inputSource=ui.inputSource.value;localArm=false;localThrottle=0;arm=false;throttle=0;updateRemoteUI();};
inputSource=ui.inputSource.value;updateRemoteUI();setInterval(updateRemoteUI,250);'''
s=s[:start]+replacement+s[end:]

assert 'new QrScanner' in s
assert 'renderQr(ui.answerQr' in s
assert 'automatic recovery, no re-pairing' in s
assert 'function startRun()' in s
assert 'ARM switch: LOW' not in s
p.write_text(s)
