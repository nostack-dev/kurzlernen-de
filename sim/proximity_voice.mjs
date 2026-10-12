// Explicit-consent push-to-talk. No microphone opened on page load.
import {VS_FX_EVENT,VS_PEER_EVENT} from './lan_vs.mjs';
import {VOICE_RATE,VOICE_RADIUS_M,proximityGain,encodeMuLaw,decodeMuLaw,validVoicePacket} from './voice_codec.mjs';
import {voiceHudPosition} from './voice_hud_layout.mjs';
export const PROXIMITY_VOICE_VERSION='ptt-proximity-thumb-safe-v3';
let stream=null,ctx=null,source=null,processor=null,silent=null,talking=false,muted=false,seq=0,buffer=[],installed=false;
const lastSeq=new Map(),playheads=new Map();
const multiplayer=()=>globalThis.__arondightVsMultiplayer;
const session=()=>globalThis.__arondightRealWorld?.vsSession;
const selfPos=()=>{const b=globalThis.__arondightRealWorld;const p=b?.airframeFor?.(b.threeScene)?.position;return p&&[p.x,p.y,p.z].every(Number.isFinite)?[p.x,p.y,p.z]:null;};
const distance=id=>{const a=selfPos(),b=multiplayer()?.playerInfo?.(id)?.p;return a&&Array.isArray(b)&&b.length>=3&&b.every(Number.isFinite)?Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]):Infinity;};
const status=message=>{const el=document.getElementById('proximityVoiceStatus');if(el)el.textContent=message;};
function transmit(samples){const s=session();if(!talking||muted||!s?.sendFx)return;const bytes=new Uint8Array(samples.map(encodeMuLaw));let binary='';for(const n of bytes)binary+=String.fromCharCode(n);
  const packet={type:'voice',id:`v-${(seq++).toString(36)}`,seq,data:btoa(binary)};
  for(const id of s.getPeerIds?.()||[])if(distance(id)<=VOICE_RADIUS_M)s.sendFx(packet,{target:id});
}
function onAudio(e){if(!talking||muted)return;const input=e.inputBuffer.getChannelData(0),stride=e.inputBuffer.sampleRate/VOICE_RATE;for(let index=0;index<input.length;index+=stride){buffer.push(input[Math.floor(index)]);if(buffer.length===640){transmit(buffer);buffer=[];}}}
async function start(){if(muted||talking)return;if(!multiplayer()?.connected){status('Multiplayer nötig');return;}
  try{if(!ctx)ctx=new (window.AudioContext||window.webkitAudioContext)();await ctx.resume();
    if(!stream){stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});}
    if(!source){source=ctx.createMediaStreamSource(stream);processor=ctx.createScriptProcessor(2048,1,1);silent=ctx.createGain();silent.gain.value=0;source.connect(processor);processor.connect(silent);silent.connect(ctx.destination);processor.onaudioprocess=onAudio;}
    talking=true;status('SPRICHT · PTT');
  }catch{talking=false;status('Mikrofon nicht freigegeben');}}
function stop(){talking=false;buffer=[];status(muted?'STUMM':'PTT halten');}
function mute(){muted=!muted;stop();if(muted){stream?.getTracks().forEach(track=>track.stop());stream=null;source?.disconnect();processor?.disconnect();silent?.disconnect();source=processor=silent=null;}return muted;}
function receive(e){const {peerId,packet}=e.detail||{};if(!peerId||!validVoicePacket(packet)||muted||!multiplayer()?.connected)return;
  const gain=proximityGain(distance(peerId));if(!gain)return;const previous=lastSeq.get(peerId)??-1;if(packet.seq<=previous)return;lastSeq.set(peerId,packet.seq);
  try{if(!ctx)ctx=new (window.AudioContext||window.webkitAudioContext)();if(ctx.state!=='running')return;
    const raw=atob(packet.data);if(raw.length>800)return;const audio=ctx.createBuffer(1,raw.length,VOICE_RATE),ch=audio.getChannelData(0);for(let i=0;i<raw.length;i++)ch[i]=decodeMuLaw(raw.charCodeAt(i));
    const src=ctx.createBufferSource(),volume=ctx.createGain();src.buffer=audio;volume.gain.value=gain;src.connect(volume).connect(ctx.destination);
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
#viewport #proximityVoiceBar button:focus-visible{outline:3px solid #ffd76a;outline-offset:2px}
#proximityVoiceBar #proximityVoiceStatus{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
#proximityVoiceBar #proximityVoiceSpeaking{position:absolute;top:auto;bottom:calc(100% + 4px);left:0;background:#112a34d9;padding:2px 5px;border-radius:7px;color:#c6ffe6;font:750 10px system-ui,sans-serif;pointer-events:none}
#proximityVoiceBar #proximityVoiceSpeaking[hidden]{display:none!important}`;
  document.head.appendChild(style);
  const bar=document.createElement('div');bar.id='proximityVoiceBar';bar.hidden=true;
  const ptt=document.createElement('button');ptt.id='proximityVoicePtt';ptt.type='button';ptt.textContent='🎙';ptt.setAttribute('aria-label','Push to talk: hold to speak');ptt.setAttribute('title','PTT halten');ptt.setAttribute('aria-pressed','false');
  ptt.addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();ptt.setPointerCapture?.(e.pointerId);ptt.setAttribute('aria-pressed','true');start();});
  for(const ev of ['pointerup','pointercancel','lostpointercapture'])ptt.addEventListener(ev,()=>{ptt.setAttribute('aria-pressed','false');stop();});
  const m=document.createElement('button');m.id='proximityVoiceMute';m.type='button';m.textContent='🔈';m.setAttribute('aria-label','Mute voice chat');m.setAttribute('title','Voice mute');m.setAttribute('aria-pressed','false');
  m.onclick=()=>{const value=mute();m.textContent=value?'🔇':'🔈';m.setAttribute('aria-pressed',String(value));m.setAttribute('aria-label',value?'Unmute voice chat':'Mute voice chat');};
  const state=document.createElement('span');state.id='proximityVoiceStatus';state.textContent='PTT halten';state.setAttribute('role','status');state.setAttribute('aria-live','polite');
  const indicator=document.createElement('span');indicator.id='proximityVoiceSpeaking';indicator.hidden=true;bar.append(ptt,m,state,indicator);view.append(bar);
  const viewportRect=el=>{if(!el||!el.offsetParent||getComputedStyle(el).visibility==='hidden')return null;
    let x=0,y=0,node=el;while(node&&node!==view){x+=node.offsetLeft;y+=node.offsetTop;node=node.offsetParent;}
    if(node!==view)return null;return{left:x,top:y,right:x+el.offsetWidth,bottom:y+el.offsetHeight};};
  const updateLayout=()=>{
    // Voice is unavailable outside multiplayer; don't spend HUD real estate on dead controls.
    if(!document.body.classList.contains('solo-flight')||!multiplayer()?.connected){bar.hidden=true;return;}
    if(document.body.classList.contains('desktop-input')){bar.hidden=false;bar.style.removeProperty('left');bar.style.removeProperty('top');return;}
    const h=view.clientHeight,w=view.clientWidth,small=h<=360,size=small?34:38,blocked=[];
    for(const id of ['footMove','footLook','soloLeft','soloRight','footJump','thumbWeapon','mobileGameplayMode','mobileGameplayDock','mobileGameplayReset','mobileGameplayMultiplayer','mobileGameplayMultiplayerStatus','soloArm','soloKill','soloClearance','airStrikeButton','wantedEmpButton','playerVitalsHud','gameplayScorePill','jetpackFuel']){
      const r=viewportRect(document.getElementById(id));if(r)blocked.push(r);
    }
    const pos=voiceHudPosition({width:w,height:h,move:viewportRect(document.getElementById('footMove'))||viewportRect(document.getElementById('soloLeft')),look:viewportRect(document.getElementById('footLook'))||viewportRect(document.getElementById('soloRight')),blocked,size});
    bar.hidden=!pos;
    if(pos){bar.style.setProperty('left',pos.x+'px','important');bar.style.setProperty('top',pos.y+'px','important');bar.dataset.edgePlacement=pos.side;bar.dataset.thumbSafe='1';}
  };
  const loop=()=>{if(!bar.isConnected)return;try{updateLayout();}catch(e){console.warn('voice hud layout',e);}setTimeout(loop,250);};loop();
  addEventListener('resize',updateLayout);
  addEventListener('keydown',e=>{if(e.code==='KeyV'&&!e.repeat&&!e.target?.closest?.('input,textarea,dialog'))start();});addEventListener('keyup',e=>{if(e.code==='KeyV')stop();});
}
export function installProximityVoice(){if(installed||typeof window==='undefined')return;installed=true;addEventListener(VS_FX_EVENT,receive);addEventListener(VS_PEER_EVENT,e=>{if(e.detail?.type==='leave'){lastSeq.delete(e.detail.peerId);playheads.delete(e.detail.peerId);}if(!multiplayer()?.connected)stop();});addEventListener('arondight:world-reset',()=>{stop();mute();});if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();}
installProximityVoice();
