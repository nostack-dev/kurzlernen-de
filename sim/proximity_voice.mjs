// Explicit-consent push-to-talk. No microphone opened on page load.
import {VS_FX_EVENT,VS_PEER_EVENT} from './lan_vs.mjs';
import {VOICE_RATE,VOICE_RADIUS_M,proximityGain,encodeMuLaw,decodeMuLaw,validVoicePacket} from './voice_codec.mjs';
export const PROXIMITY_VOICE_VERSION='ptt-proximity-v1';
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
  const bar=document.createElement('div');bar.id='proximityVoiceBar';bar.style.cssText='position:absolute;bottom:96px;left:max(12px,env(safe-area-inset-left));z-index:34;display:flex;align-items:center;gap:5px;pointer-events:auto';
  const ptt=document.createElement('button');ptt.id='proximityVoicePtt';ptt.type='button';ptt.textContent='🎙 PTT';ptt.style.cssText='touch-action:none;background:#14252a;color:white;border:1px solid #66ffaa;border-radius:9px;padding:9px';
  ptt.addEventListener('pointerdown',e=>{e.preventDefault();ptt.setPointerCapture?.(e.pointerId);start();});for(const ev of ['pointerup','pointercancel','lostpointercapture'])ptt.addEventListener(ev,stop);
  const m=document.createElement('button');m.id='proximityVoiceMute';m.type='button';m.textContent='MUTE';m.onclick=()=>{m.textContent=mute()?'UNMUTE':'MUTE';};
  const state=document.createElement('span');state.id='proximityVoiceStatus';state.textContent='PTT halten';state.style.cssText='color:#fff;background:#001a;padding:4px;font-size:11px';
  const indicator=document.createElement('span');indicator.id='proximityVoiceSpeaking';indicator.hidden=true;indicator.style.color='#aaffbf';bar.append(ptt,m,state,indicator);view.append(bar);
  addEventListener('keydown',e=>{if(e.code==='KeyV'&&!e.repeat&&!e.target?.closest?.('input,textarea,dialog'))start();});addEventListener('keyup',e=>{if(e.code==='KeyV')stop();});
}
export function installProximityVoice(){if(installed||typeof window==='undefined')return;installed=true;addEventListener(VS_FX_EVENT,receive);addEventListener(VS_PEER_EVENT,e=>{if(e.detail?.type==='leave'){lastSeq.delete(e.detail.peerId);playheads.delete(e.detail.peerId);}if(!multiplayer()?.connected)stop();});addEventListener('arondight:world-reset',()=>{stop();mute();});if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();}
installProximityVoice();
