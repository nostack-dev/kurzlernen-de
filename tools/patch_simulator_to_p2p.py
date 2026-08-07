from pathlib import Path

path=Path('sim/simulator.mjs')
s=path.read_text()

old='import createCore from "../generated/flight_core.mjs";\n'
new=old+'import {ViewPeerLink,copySignal,shareSignal} from "./p2p_link.mjs";\n'
assert old in s and 'ViewPeerLink' not in s
s=s.replace(old,new,1)

old_ids='"modeInfo","connect","run","reset","status","tMode","tController","fcState","simTime","altitude","velocity","attitude","motors","rpm","battery","current","processing","rtt","speed","armSwitch","throttle","logFile","fit","fitProgress","fitStatus","logSamples","touchRoll","touchPitch","touchYaw","touchThrottle","touchArm","exportLog","remoteRoom","inputSource","remoteConnect","remoteStatus","controllerLink"'
new_ids='"modeInfo","connect","run","reset","status","tMode","tController","fcState","simTime","altitude","velocity","attitude","motors","rpm","battery","current","processing","rtt","speed","armSwitch","throttle","logFile","fit","fitProgress","fitStatus","logSamples","touchRoll","touchPitch","touchYaw","touchThrottle","touchArm","exportLog","inputSource","remoteConnect","remoteStatus","controllerLink","pairDialog","remoteOffer","remoteAnswer","acceptOffer","copyAnswer","shareAnswer","pairStatus","closePair"'
assert old_ids in s
s=s.replace(old_ids,new_ids,1)

start=s.index('class RemoteControlLink {')
end=s.index('\n\nclass Noise {',start)
s=s[:start]+s[end+2:]

old='const remoteLink=new RemoteControlLink();'
assert old in s
s=s.replace(old,'const remoteLink=new ViewPeerLink();',1)

start=s.index('function randomRoom(){')
end=s.index('\n\nconst fitted=',start)
replacement=r'''function updateRemoteUI(){
  const current=remoteLink.current();ui.controllerLink.href="./drone_controller.html";
  if(inputSource==="local"){ui.remoteStatus.textContent="LOCAL FALLBACK selected. P2P controller input is ignored.";ui.remoteStatus.className="statusline warn";}
  else if(remoteLink.linked&&current){ui.remoteStatus.textContent="P2P LINKED · control packets fresh · direct phone-to-phone DataChannel";ui.remoteStatus.className="statusline good";}
  else if(remoteLink.linked){ui.remoteStatus.textContent="P2P link alive but control stale (>350 ms) · fail-safe ARM LOW / throttle 0";ui.remoteStatus.className="statusline bad";}
  else if(remoteLink.pc){ui.remoteStatus.textContent=`${remoteLink.stateLabel()} · waiting for direct DataChannel`;ui.remoteStatus.className="statusline warn";}
  else{ui.remoteStatus.textContent="P2P disconnected · fail-safe ARM LOW / throttle 0. No relay/server is required.";ui.remoteStatus.className="statusline warn";}
  ui.remoteConnect.textContent=remoteLink.pc?"Disconnect P2P":"Pair controller phone";
  if(remoteLink.linked&&ui.pairDialog.open)ui.pairDialog.close();
}
async function acceptControllerOffer(){
  ui.acceptOffer.disabled=true;ui.pairStatus.textContent="Creating direct WebRTC answer…";ui.pairStatus.className="statusline warn";
  try{
    ui.remoteAnswer.value=await remoteLink.acceptOffer(ui.remoteOffer.value);
    inputSource="remote";ui.inputSource.value="remote";localArm=false;localThrottle=0;arm=false;throttle=0;
    ui.pairStatus.textContent="Answer ready. Send it back to the controller phone and tap Apply answer there.";ui.pairStatus.className="statusline good";
  }catch(error){ui.pairStatus.textContent=error.message;ui.pairStatus.className="statusline bad";}
  finally{ui.acceptOffer.disabled=false;updateRemoteUI();}
}
async function toggleRemote(){
  if(remoteLink.pc){await remoteLink.disconnect();ui.remoteOffer.value="";ui.remoteAnswer.value="";updateRemoteUI();return;}
  ui.pairDialog.showModal();
}
remoteLink.onState=updateRemoteUI;
ui.remoteConnect.onclick=toggleRemote;
ui.acceptOffer.onclick=acceptControllerOffer;
ui.copyAnswer.onclick=async()=>{try{await copySignal(ui.remoteAnswer.value);ui.pairStatus.textContent="Answer copied.";ui.pairStatus.className="statusline good";}catch(error){ui.pairStatus.textContent=error.message;ui.pairStatus.className="statusline bad";}};
ui.shareAnswer.onclick=async()=>{try{await shareSignal("Arondight45 VIEW answer",ui.remoteAnswer.value);ui.pairStatus.textContent="Answer shared.";ui.pairStatus.className="statusline good";}catch(error){if(error?.name!=="AbortError"){ui.pairStatus.textContent=error.message;ui.pairStatus.className="statusline bad";}}};
ui.closePair.onclick=()=>ui.pairDialog.close();
ui.inputSource.onchange=()=>{inputSource=ui.inputSource.value;localArm=false;localThrottle=0;arm=false;throttle=0;updateRemoteUI();};
inputSource=ui.inputSource.value;updateRemoteUI();setInterval(updateRemoteUI,250);'''
s=s[:start]+replacement+s[end:]

assert 'RemoteControlLink' not in s
assert 'remoteRoom' not in s
assert '/control' not in s
assert 'new ViewPeerLink()' in s
assert 'acceptControllerOffer' in s
assert 'new WebSocket' in s  # Optional physical HIL LAN backend remains separate from SIM phone control.
path.write_text(s)
