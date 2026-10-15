// Explicit-consent push-to-talk. No microphone opened on page load.
import {VS_FX_EVENT,VS_PEER_EVENT} from './lan_vs.mjs';
import {VOICE_RATE,VOICE_RADIUS_M,proximityGain,encodeMuLaw,decodeMuLaw,validVoicePacket} from './voice_codec.mjs';
import {voiceHudPosition} from './voice_hud_layout.mjs';
import {VOICE_KEY_PTT,VOICE_KEY_MUTE} from './voice_control_bindings.mjs';
export const PROXIMITY_VOICE_VERSION='mic-toggle-all-inputs-v7';
let stream=null,ctx=null,source=null,processor=null,silent=null,talking=false,micOn=false,muted=false,seq=0,buffer=[],installed=false,inputGeneration=0;
const lastSeq=new Map(),playheads=new Map();
// VOICE RANGE (settings): NÄHE (default) = only mates within 70 m hear you, louder the closer they are;
// ÜBERALL = like a team radio — your voice reaches every mate at full volume, wherever they are,
// and you hear everyone who reaches you. The choice travels in each packet (w), so both ends agree.
const VOICE_MODE_KEY='arondight.voiceRange.v1';
function voiceEverywhere(){try{return localStorage.getItem(VOICE_MODE_KEY)==='all';}catch{return false;}}
function setVoiceEverywhere(on){try{localStorage.setItem(VOICE_MODE_KEY,on?'all':'near');}catch{}}
function injectVoiceSetting(){const anchor=document.querySelector('[data-slider="left"]')?.closest('.phone-settings-row');if(!anchor||anchor.parentElement?.querySelector('[data-voice-range]'))return;
  const row=document.createElement('label');row.className='phone-settings-toggle';row.innerHTML='<span>VOICE ÜBERALL HÖRBAR (aus = nur in der Nähe, 70 m)</span><input data-voice-range type="checkbox">';
  anchor.before(row);const box=row.querySelector('input');box.checked=voiceEverywhere();box.addEventListener('change',()=>setVoiceEverywhere(box.checked));}
setInterval(()=>{try{injectVoiceSetting();}catch{}},1000);
const multiplayer=()=>globalThis.__arondightVsMultiplayer;
const session=()=>globalThis.__arondightRealWorld?.vsSession;
const selfPos=()=>{const b=globalThis.__arondightRealWorld,body=document.body;
  // The voice falloff follows the actual player, not the parked drone. Single
  // and multiplayer use the exact same gameplay/camera runtime.
  const p=body.classList.contains('jet-mode')?(globalThis.__jetMode?.state?.p||globalThis.__arondightStreamFocus):
    body.classList.contains('player-driving')?globalThis.__arondightVehicleDrive?.cameraAnchor:
    body.classList.contains('on-foot-mode')?globalThis.__arondightWalkMode?.position:null;
  const at=p||b?.airframeFor?.(b.threeScene)?.position;
  return at&&Number.isFinite(at.x)&&Number.isFinite(at.y)?[at.x,at.y,Number(at.z)||0]:null;};
const distance=id=>{const a=selfPos(),b=multiplayer()?.playerInfo?.(id)?.p;return a&&Array.isArray(b)&&b.length>=3&&b.every(Number.isFinite)?Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]):Infinity;};
const status=message=>{const el=document.getElementById('proximityVoiceStatus');if(el)el.textContent=message;};
function unlockPlayback(){try{if(!ctx)ctx=new (window.AudioContext||window.webkitAudioContext)();void ctx.resume().catch(()=>{});}catch{}}
function transmit(samples){const s=session();if(!talking||muted||!s?.sendFx)return;const bytes=new Uint8Array(samples.map(encodeMuLaw));let binary='';for(const n of bytes)binary+=String.fromCharCode(n);
  const all=voiceEverywhere(),packet={type:'voice',id:`v-${(seq++).toString(36)}`,seq,data:btoa(binary),...(all?{w:1}:{})};
  for(const id of s.getPeerIds?.()||[])if((all||distance(id)<=VOICE_RADIUS_M)&&s.sendFx(packet,{target:id})){
    const v=document.getElementById('viewport');if(v){v.dataset.voiceTxPackets=String((Number(v.dataset.voiceTxPackets)||0)+1);v.dataset.voiceTxTarget=id;}
  }
}
function onAudio(e){if(!talking||muted)return;const input=e.inputBuffer.getChannelData(0),stride=e.inputBuffer.sampleRate/VOICE_RATE;for(let index=0;index<input.length;index+=stride){buffer.push(input[Math.floor(index)]);if(buffer.length===640){transmit(buffer);buffer=[];}}}
async function start(){if(muted||talking||!micOn)return;
  // In SOLO the same PTT stays usable; without a peer we capture only while
  // held and never send or advertise. MULTI solely starts public discovery.
  const generation=++inputGeneration;
  try{if(!ctx)ctx=new (window.AudioContext||window.webkitAudioContext)();await ctx.resume();
    if(generation!==inputGeneration)return; // released before the permission prompt
    if(!stream){
      const acquired=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
      if(generation!==inputGeneration){acquired.getTracks().forEach(track=>track.stop());return;}
      stream=acquired;
    }
    if(generation!==inputGeneration||!micOn)return; // disabled while awaiting permission
    if(!source){source=ctx.createMediaStreamSource(stream);processor=ctx.createScriptProcessor(2048,1,1);silent=ctx.createGain();silent.gain.value=0;source.connect(processor);processor.connect(silent);silent.connect(ctx.destination);processor.onaudioprocess=onAudio;}
    talking=true;status(multiplayer()?.connected?'MIC LIVE · verbunden':'MIC LIVE · kein Mitspieler');
  }catch{if(generation===inputGeneration){talking=false;status('Mikrofon nicht freigegeben');}}}
function stop(){++inputGeneration;talking=false;buffer=[];
  // Push-to-talk is *not* a persistent microphone session. Releasing the
  // button (or resetting) stops browser microphone tracks as well as sends.
  stream?.getTracks().forEach(track=>track.stop());stream=null;
  source?.disconnect();processor?.disconnect();silent?.disconnect();
  source=processor=silent=null;status(muted?'STUMM':micOn?'MIC AKTIVIERUNG…':'MIC AUS');
}
function mute(){muted=!muted;if(muted){micOn=false;stop();}if(!muted){
    // An explicit user tap also unlocks incoming playback on mobile browsers.
    unlockPlayback();
  }return muted;}
function playing(){return document.body.classList.contains('solo-flight')&&!document.querySelector('dialog[open],#resetVoteDialog,#quitConfirmDialog,#worldMapFull[open]');}
function syncMicUi(){
  const button=document.getElementById('proximityVoicePtt');
  if(button){button.textContent=micOn?'🎙':'🎤';button.setAttribute('aria-pressed',String(micOn));
    button.setAttribute('aria-label',micOn?'Mikrofon ausschalten':'Mikrofon einschalten');button.title=micOn?'MIC ON · ausschalten':'MIC OFF · einschalten';}
  document.getElementById('viewport')?.setAttribute('data-voice-mic',micOn?'on':'off');
}
function toggleMic(){
  if(!playing())return false;
  if(micOn){micOn=false;stop();}
  else{if(muted){mute();const m=document.getElementById('proximityVoiceMute');if(m){m.textContent='🔈';m.setAttribute('aria-pressed','false');}}
    micOn=true;void start();}
  syncMicUi();return micOn;
}
function releasePtt(){micOn=false;stop();syncMicUi();}
function toggleMute(){
  const value=mute();syncMicUi();
  const button=document.getElementById('proximityVoiceMute');
  if(button){button.textContent=value?'🔇':'🔈';button.setAttribute('aria-pressed',String(value));button.setAttribute('aria-label',value?'Unmute voice chat':'Mute voice chat');}
  document.getElementById('viewport')?.setAttribute('data-voice-muted',value?'1':'0');
  document.getElementById('proximityVoicePtt')?.setAttribute('aria-pressed','false');
  return value;
}
function receive(e){const {peerId,packet}=e.detail||{};if(!peerId||!validVoicePacket(packet)||muted||!multiplayer()?.connected)return;
  const gain=packet.w===1||voiceEverywhere()?Math.max(.85,proximityGain(distance(peerId))):proximityGain(distance(peerId));if(!gain)return;const previous=lastSeq.get(peerId)??-1;if(packet.seq<=previous)return;lastSeq.set(peerId,packet.seq);
  try{if(!ctx)ctx=new (window.AudioContext||window.webkitAudioContext)();if(ctx.state!=='running')return;
    const raw=atob(packet.data);if(raw.length>800)return;const audio=ctx.createBuffer(1,raw.length,VOICE_RATE),ch=audio.getChannelData(0);for(let i=0;i<raw.length;i++)ch[i]=decodeMuLaw(raw.charCodeAt(i));
    const src=ctx.createBufferSource(),volume=ctx.createGain();src.buffer=audio;volume.gain.value=gain;volume.__audioBusExempt=true;/* voice chat is not an effect */src.connect(volume).connect(ctx.destination);const v=document.getElementById('viewport');if(v){v.dataset.voiceRxPackets=String((Number(v.dataset.voiceRxPackets)||0)+1);v.dataset.voiceRxPeer=peerId;}
    const t=Math.max(ctx.currentTime+.03,Math.min(ctx.currentTime+.15,playheads.get(peerId)||0));src.start(t);playheads.set(peerId,t+audio.duration);
    const indicator=document.getElementById('proximityVoiceSpeaking');if(indicator){indicator.textContent=`🔊 P${(multiplayer()?.playerInfo?.(peerId)?.index)||'?'}`;indicator.hidden=false;setTimeout(()=>{if(indicator.textContent.startsWith('🔊'))indicator.hidden=true;},450);}
  }catch{} }
function mount(){const view=document.getElementById('viewport');if(!view||document.getElementById('proximityVoicePtt'))return;
  const style=document.createElement('style');style.dataset.proximityVoiceHud=PROXIMITY_VOICE_VERSION;
  style.textContent=`body:not(.solo-flight) #proximityVoiceBar{display:none!important}
#viewport #proximityVoiceBar{position:absolute;top:max(8px,var(--solo-safe-top,env(safe-area-inset-top)));left:clamp(180px,27vw,320px);bottom:auto;z-index:100002;display:flex;align-items:center;gap:6px;pointer-events:none}
#viewport #proximityVoiceBar[hidden]{display:none!important}
body.solo-flight:not(.desktop-input) #viewport #proximityVoiceBar{flex-direction:column;gap:5px;align-items:center}
body.solo-flight:not(.desktop-input) #viewport #proximityVoiceBar button{width:38px;height:38px;min-width:38px;min-height:38px}
@media(max-height:360px){body.solo-flight:not(.desktop-input) #viewport #proximityVoiceBar button{width:34px;height:34px;min-width:34px;min-height:34px}}
#viewport #proximityVoiceBar button{width:38px;height:38px;min-width:38px;min-height:38px;padding:0;border-radius:50%!important;border:1.5px solid #94d4ea90;background:#132b3ddb;color:#eaf8ff;box-shadow:0 3px 12px #0007;font:800 19px/1 system-ui,sans-serif;display:grid;place-items:center;pointer-events:auto;touch-action:none}
#viewport #proximityVoicePtt[aria-pressed="true"]{background:#1b674f;border-color:#91ffd7}
#viewport #proximityVoiceMute[aria-pressed="true"]{background:#60332c;border-color:#ffa998}
/* Keyboard+mouse: full-size mouse targets below the top utility row, not
   two tiny 38px touch icons. Pad uses the same buttons with alternate labels. */
body.desktop-input.solo-flight #viewport #proximityVoiceBar{
  top:max(56px,calc(var(--solo-safe-top,env(safe-area-inset-top)) + 48px));
  gap:8px;flex-direction:row;align-items:center
}
body.desktop-input.solo-flight #viewport #proximityVoiceBar button{
  width:auto!important;min-width:116px;height:39px!important;min-height:39px;
  padding:0 10px!important;display:inline-flex;flex-direction:row;
  align-items:center;gap:8px;border-radius:9px!important;
  font-size:16px!important;font-weight:850
}
body.desktop-input.solo-flight #viewport #proximityVoiceBar button::after{
  color:#e8f6ff;font:850 11px/1 system-ui,sans-serif;letter-spacing:.035em;
  white-space:nowrap
}
body.desktop-input.solo-flight:not(.pad-input) #proximityVoicePtt::after{content:"H · MIC ON/OFF"}
body.desktop-input.solo-flight:not(.pad-input) #proximityVoiceMute::after{content:"K · MUTE"}
body.desktop-input.solo-flight.pad-input #proximityVoicePtt::after{content:"R3 · MIC ON/OFF"}
body.desktop-input.solo-flight.pad-input #proximityVoiceMute::after{content:"R3+Y · MUTE"}
#viewport #proximityVoiceBar button:focus-visible{outline:3px solid #ffd76a;outline-offset:2px}
#proximityVoiceBar #proximityVoiceStatus{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
#proximityVoiceBar #proximityVoiceSpeaking{position:absolute;top:auto;bottom:calc(100% + 4px);left:0;background:#112a34d9;padding:2px 5px;border-radius:7px;color:#c6ffe6;font:750 10px system-ui,sans-serif;pointer-events:none}
#proximityVoiceBar #proximityVoiceSpeaking[hidden]{display:none!important}`;
  document.head.appendChild(style);
  // Joining MULTI is itself a user gesture. Unlock incoming audio here so
  // peers are audible without first speaking or toggling MUTE. This never
  // requests mic permission and never advertises a SOLO session.
  view.addEventListener('pointerdown',event=>{
    if(event.target instanceof Element&&event.target.closest('#mobileGameplayMultiplayer,#lanVsButton'))unlockPlayback();
  },{capture:true});
  const bar=document.createElement('div');bar.id='proximityVoiceBar';bar.hidden=true;
  const ptt=document.createElement('button');ptt.id='proximityVoicePtt';ptt.type='button';ptt.textContent='🎤';ptt.setAttribute('aria-label','Mikrofon einschalten');ptt.setAttribute('title','MIC OFF · einschalten');ptt.setAttribute('aria-pressed','false');
  ptt.addEventListener('pointerdown',e=>e.stopPropagation());ptt.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();toggleMic();});
  const m=document.createElement('button');m.id='proximityVoiceMute';m.type='button';m.textContent='🔈';m.setAttribute('aria-label','Mute voice chat');m.setAttribute('title','Voice mute');m.setAttribute('aria-pressed','false');
  m.onclick=()=>toggleMute();
  const state=document.createElement('span');state.id='proximityVoiceStatus';state.textContent='MIC AUS';state.setAttribute('role','status');state.setAttribute('aria-live','polite');
  const indicator=document.createElement('span');indicator.id='proximityVoiceSpeaking';indicator.hidden=true;bar.append(ptt,m,state,indicator);view.append(bar);
  const viewportRect=el=>{if(!el||!el.offsetParent||getComputedStyle(el).visibility==='hidden')return null;
    let x=0,y=0,node=el;while(node&&node!==view){x+=node.offsetLeft;y+=node.offsetTop;node=node.offsetParent;}
    if(node!==view)return null;return{left:x,top:y,right:x+el.offsetWidth,bottom:y+el.offsetHeight};};
  const updateLayout=()=>{
    // SOLO and MULTI have the same voice controls; only public discovery differs.
    if(!document.body.classList.contains('solo-flight')){if(micOn)releasePtt();bar.hidden=true;return;}
    if(document.body.classList.contains('edge-hud')){bar.hidden=false;return;} /* edge_hud_layout.mjs puts it into the top bar */
    if(document.body.classList.contains('desktop-input')){bar.hidden=false;bar.style.removeProperty('left');bar.style.removeProperty('top');return;}
    const h=view.clientHeight,w=view.clientWidth,small=h<=360,size=small?34:38,blocked=[];
    for(const id of ['footMove','footLook','soloLeft','soloRight','footJump','thumbWeapon','mobileGameplayMode','enterCarButton','enterJetButton','mobileGameplayDock','mobileGameplayReset','mobileGameplayMultiplayer','mobileGameplayMultiplayerStatus','soloArm','soloKill','soloClearance','airStrikeButton','handGrenadeBtn','soloExit','gameExitButton','wantedEmpButton','playerVitalsHud','gameplayScorePill','jetpackFuel']){
      const r=viewportRect(document.getElementById(id));if(r)blocked.push(r);
    }
    // Score/FLOW are text, but still occupy pixels and should never be
    // covered by voice controls in compact landscape.
    for(const selector of ['#sandboxHud .sb-score','#sandboxHud .sb-flow']){
      const el=document.querySelector(selector);
      if(el&&getComputedStyle(el).display!=='none'){
        const r=viewportRect(el);if(r)blocked.push(r);
      }
    }
    const pos=voiceHudPosition({width:w,height:h,move:viewportRect(document.getElementById('footMove'))||viewportRect(document.getElementById('soloLeft')),look:viewportRect(document.getElementById('footLook'))||viewportRect(document.getElementById('soloRight')),blocked,size});
    bar.hidden=!pos;
    if(pos){bar.style.setProperty('left',pos.x+'px','important');bar.style.setProperty('top',pos.y+'px','important');bar.dataset.edgePlacement=pos.side;bar.dataset.thumbSafe='1';}
  };
  const loop=()=>{if(!bar.isConnected)return;try{updateLayout();}catch(e){console.warn('voice hud layout',e);}setTimeout(loop,250);};loop();
  addEventListener('resize',updateLayout);
  // Keyboard input is game-wide even while mouse pointer lock is active.
  // V remains the foot/drone shortcut, T the grenade and P multiplayer.
  addEventListener('keydown',e=>{
    if(e.__synthetic||e.repeat||e.ctrlKey||e.altKey||e.metaKey||!playing()||e.target?.closest?.('input,textarea,select,[contenteditable],dialog'))return;
    if(e.code===VOICE_KEY_PTT){e.preventDefault();toggleMic();}
    else if(e.code===VOICE_KEY_MUTE){e.preventDefault();toggleMute();}
  });
  addEventListener('blur',releasePtt);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)releasePtt();});
  globalThis.__arondightVoiceControls={
    setPadTalk:held=>{if(held)toggleMic();},
    toggleMic,
    toggleMute,
    get muted(){return muted;},
    get talking(){return talking;},
    get micOn(){return micOn;}
  };
}
export function installProximityVoice(){if(installed||typeof window==='undefined')return;installed=true;addEventListener(VS_FX_EVENT,receive);addEventListener(VS_PEER_EVENT,e=>{if(e.detail?.type==='leave'){lastSeq.delete(e.detail.peerId);playheads.delete(e.detail.peerId);}if(!multiplayer()?.connected&&heldInputs.size)releasePtt();});addEventListener('arondight:world-reset',()=>{releasePtt();/* preserve the player's explicit mute setting */});if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();}
installProximityVoice();
