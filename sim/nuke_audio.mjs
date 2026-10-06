import {getSharedCombatAudioContext} from "./combat_audio_bank.mjs";
import {AUDIO_SETTINGS_EVENT,loadAudioSettings,normalizeAudioSettings} from "./audio_settings.mjs";

// Nuke sound design, synthesized once into PCM buffers (no oscillators at
// runtime, nothing heavy on the detonation frame):
//   launch  – falling bomb whistle over the warhead flight
//   flash   – instant crack + hiss when the fireball appears (light arrives first)
//   blast   – the shockwave: hard transient, sub-bass boom, rolling rumble tail
// The blast is scheduled when the visual shockwave ring reaches the camera
// (343 m/s, same moment as the screen shake), so sound and picture line up.

export const NUKE_AUDIO_VERSION="procedural-pcm-shock-synced-v1";
const SAMPLE_RATE=24000;
const SPEED_OF_SOUND_MPS=343;
const TAU=Math.PI*2;

let buffers={},bufferContext=null,master=null,settings=normalizeAudioSettings(loadAudioSettings()),installed=false,pendingBlast=null;
const active=new Set();

function viewport(){return document.getElementById("viewport");}
function clamp(v,a,b){return Math.max(a,Math.min(b,Number(v)||0));}
function rng(seed){let state=seed>>>0||1;return()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return(state>>>0)/4294967296;};}
function normalize(data,target){let peak=1e-6;for(const v of data)peak=Math.max(peak,Math.abs(v));const gain=target/peak;for(let i=0;i<data.length;i++)data[i]=Math.tanh(data[i]*gain*1.2)/Math.tanh(1.2);return data;}

function renderLaunch(rate){
  const duration=1.6,data=new Float32Array(Math.ceil(duration*rate)),random=rng(0x1a7c);let phase=0,air=0;
  for(let i=0;i<data.length;i++){const t=i/rate,p=t/duration,f=1500-900*p*p;phase+=TAU*f/rate;const white=random()*2-1;air+=.25*(white-air);const amp=Math.min(1,t/.08)*Math.min(1,(duration-t)/.06)*(.35+.65*p);data[i]=(Math.sin(phase)*.55+Math.sin(phase*2.01)*.12+air*.25)*amp;}
  return normalize(data,.7);
}
function renderFlash(rate){
  const duration=1.5,data=new Float32Array(Math.ceil(duration*rate)),random=rng(0xf1a5);let low=0,phase=0;
  for(let i=0;i<data.length;i++){const t=i/rate,white=random()*2-1;low+=.08*(white-low);const hiss=(white-low)*Math.exp(-t*3.2),crack=white*Math.exp(-t*60);phase+=TAU*(70*Math.exp(-t*6)+30)/rate;const thump=Math.sin(phase)*Math.exp(-t*7);data[i]=crack*.9+hiss*.45+thump*.6;}
  return normalize(data,.8);
}
function renderBlast(rate){
  const duration=8.5,data=new Float32Array(Math.ceil(duration*rate)),random=rng(0xb1a57);let rumble=0,rumble2=0,phase=0,crackleEnv=0;
  for(let i=0;i<data.length;i++){
    const t=i/rate,white=random()*2-1;
    rumble+=.012*(white-rumble);rumble2+=.04*(white-rumble2);
    const transient=white*Math.exp(-t*38)*1.4;
    phase+=TAU*(58*Math.exp(-t*1.6)+24)/rate;const boom=Math.sin(phase+.6*Math.sin(phase*.31))*Math.exp(-t*1.15);
    const roll=1+.45*Math.sin(TAU*.9*t+1.3*Math.sin(TAU*.23*t));
    const tail=(rumble*3.2+rumble2*.9)*Math.min(1,t/.12)*Math.exp(-t*.42)*roll;
    if(random()<.0009*Math.exp(-t*.5))crackleEnv=1;crackleEnv*=.992;const crackle=white*crackleEnv*.35*Math.exp(-t*.35);
    data[i]=transient+boom*1.15+tail+crackle;
  }
  for(let i=data.length-Math.floor(rate*.4);i<data.length;i++)data[i]*=Math.max(0,(data.length-i)/(rate*.4));
  return normalize(data,.95);
}

// Each sound is rendered at the lowest rate its content needs; the blast is
// mostly sub-bass and rumble, so 16 kHz keeps its one-time synthesis cheap.
const RENDERERS={launch:[renderLaunch,SAMPLE_RATE],flash:[renderFlash,SAMPLE_RATE],blast:[renderBlast,16000]};
const pcm={};
function ensurePcm(kind){if(!pcm[kind]){const [render,rate]=RENDERERS[kind];pcm[kind]={data:render(rate),rate};}return pcm[kind];}
function ensureMaster(context){
  if(!context)return false;
  if(bufferContext!==context){buffers={};bufferContext=context;const compressor=context.createDynamicsCompressor();compressor.threshold.value=-10;compressor.knee.value=12;compressor.ratio.value=4;compressor.attack.value=.003;compressor.release.value=.35;compressor.connect(context.destination);master=compressor;}
  return true;
}
function bufferFor(context,kind){if(!buffers[kind]){const {data,rate}=ensurePcm(kind),buffer=context.createBuffer(1,data.length,rate);if(buffer.copyToChannel)buffer.copyToChannel(data,0);else buffer.getChannelData(0).set(data);buffers[kind]=buffer;}return buffers[kind];}
function level(){return settings.soundEnabled?clamp(settings.fxVolume/100,0,1):0;}
function context({resume=false}={}){return getSharedCombatAudioContext({resume});}

function play(kind,{when=0,gain=1,distanceM=0,rate=1,stopAfterS=null}={}){
  const volume=level()*gain;if(volume<=0)return false;const ctx=context({resume:true});if(!ctx||!ensureMaster(ctx))return false;
  if(ctx.state!=="running"){ctx.resume?.().catch(()=>{});if(ctx.state!=="running")return false;}
  try{
    const source=ctx.createBufferSource(),amp=ctx.createGain(),filter=ctx.createBiquadFilter(),start=ctx.currentTime+Math.max(0,when);
    source.buffer=bufferFor(ctx,kind);source.playbackRate.value=rate;
    // Distance darkens the sound (air absorbs highs) more than it quiets it.
    const d=Math.max(0,Number(distanceM)||0);filter.type="lowpass";filter.frequency.value=clamp(16000/(1+d/90),900,16000);filter.Q.value=.5;
    amp.gain.value=volume*clamp(1-d/1600,.35,1);
    source.connect(filter).connect(amp).connect(master);
    source.onended=()=>{active.delete(source);try{source.disconnect();filter.disconnect();amp.disconnect();}catch{}};
    source.start(start);if(stopAfterS)source.stop(start+stopAfterS);active.add(source);
    const view=viewport();if(view){view.dataset.nukeAudio=NUKE_AUDIO_VERSION;view.dataset.nukeAudioLast=kind;view.dataset.nukeAudioPlays=String((Number(view.dataset.nukeAudioPlays)||0)+1);}
    return true;
  }catch{return false;}
}

// Speed the whistle up so its pitch has fallen all the way by the time the
// warhead lands, then cut it exactly at impact.
function onLaunch(event){const seconds=clamp(event?.detail?.durationMs,300,2000)/1000;play("launch",{gain:.32,rate:clamp(1.6/seconds,1,2.2),stopAfterS:seconds});}
function onImpact(event){
  const distance=Number(event?.detail?.cameraDistanceM);const d=Number.isFinite(distance)?distance:150;
  play("flash",{gain:.55,distanceM:d*.4});
  // Fallback timing if the visual shockwave never reports arrival (e.g. tab hidden).
  clearTimeout(pendingBlast);pendingBlast=setTimeout(()=>{pendingBlast=null;play("blast",{gain:1,distanceM:d});},Math.min(2400,d/SPEED_OF_SOUND_MPS*1000+250));
}
function onShockArrival(event){if(pendingBlast===null)return;clearTimeout(pendingBlast);pendingBlast=null;play("blast",{gain:1,distanceM:Number(event?.detail?.distanceM)||0});}
function unlock(){const ctx=context({resume:true});if(ctx)ensureMaster(ctx);}

export function installNukeAudio(){
  if(installed)return;installed=true;
  window.addEventListener("arondight:nuke-launch",onLaunch);
  window.addEventListener("arondight:nuke-impact",onImpact);
  window.addEventListener("arondight:nuke-shockwave-arrival",onShockArrival);
  window.addEventListener(AUDIO_SETTINGS_EVENT,event=>{settings=normalizeAudioSettings(event?.detail||loadAudioSettings());if(!level())for(const source of active){try{source.stop();}catch{}}});
  window.addEventListener("pointerdown",unlock,{capture:true,passive:true,once:true});
  // Synthesize the PCM while the game is idle, never on the detonation frame.
  const idle=globalThis.requestIdleCallback||(fn=>setTimeout(fn,1500));for(const kind of Object.keys(RENDERERS))idle(()=>ensurePcm(kind),{timeout:8000});
  const view=viewport();if(view)view.dataset.nukeAudio=NUKE_AUDIO_VERSION;
}
installNukeAudio();
