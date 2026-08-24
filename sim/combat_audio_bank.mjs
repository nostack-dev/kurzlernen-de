export const COMBAT_AUDIO_BANK_VERSION="prebaked-pcm-buffer-bank-v1";
export const COMBAT_AUDIO_SAMPLE_RATE=44100;

const TAU=Math.PI*2;
const BANK_VARIANTS=Object.freeze({shot:3,hit:4,damage:2,scream:4,explosion:2,step:3,reward:3,fail:2});
const contextBanks=new WeakMap();
let sharedContext=null;

function rng(seed){let state=seed>>>0||1;return()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return(state>>>0)/4294967296;};}
const envelope=(time,attack,release,duration)=>Math.min(1,time/Math.max(.001,attack))*Math.min(1,(duration-time)/Math.max(.001,release));
const softClip=value=>Math.tanh(value*1.35);
function finish(data,target=.92){let peak=1e-6;for(const value of data)peak=Math.max(peak,Math.abs(value));const gain=target/peak;for(let i=0;i<data.length;i++)data[i]=softClip(data[i]*gain);return data;}

function renderShot(sampleRate,variant){
  const duration=.115+variant*.006,data=new Float32Array(Math.ceil(duration*sampleRate)),random=rng(0x45a391+variant*977),delay=Math.floor(sampleRate*(.014+variant*.0015));let low=0,phase=0;
  for(let i=0;i<data.length;i++){
    const t=i/sampleRate,p=t/duration,white=random()*2-1;low+=.12*(white-low);const crack=(white-low)*Math.exp(-t/Math.max(.006,.012+variant*.001));
    const frequency=205*Math.exp(-t*19)+58;phase+=TAU*frequency/sampleRate;const body=Math.sin(phase+.18*Math.sin(phase*.47))*Math.exp(-t*25);
    const echo=i>=delay?data[i-delay]*(.20-variant*.018):0;data[i]=crack*.72+body*.54+echo;
  }
  return finish(data,.88);
}

function renderHit(sampleRate,variant){
  const duration=.105+variant*.009,data=new Float32Array(Math.ceil(duration*sampleRate)),random=rng(0x91cdef+variant*733),delay=Math.floor(sampleRate*(.008+variant*.001));let low=0,phase=0;
  for(let i=0;i<data.length;i++){
    const t=i/sampleRate,white=random()*2-1;low+=.20*(white-low);const surface=(white*.35+low*.65)*Math.exp(-t*(37-variant*2));
    const frequency=(112+variant*9)*Math.exp(-t*13)+46;phase+=TAU*frequency/sampleRate;const thud=Math.sin(phase)*Math.exp(-t*30);
    const slap=i>=delay?data[i-delay]*.16:0;data[i]=surface*.78+thud*.58+slap;
  }
  return finish(data,.82);
}

function renderDamage(sampleRate,variant){
  const duration=.21+variant*.035,data=new Float32Array(Math.ceil(duration*sampleRate)),random=rng(0x7ad0b1+variant*811);let low=0,phase=0;
  for(let i=0;i<data.length;i++){
    const t=i/sampleRate,white=random()*2-1;low+=.065*(white-low);const frequency=(92+variant*12)*Math.exp(-t*8)+31;phase+=TAU*frequency/sampleRate;
    const pressure=Math.sin(phase+.3*Math.sin(phase*.5))*Math.exp(-t*13),rush=low*Math.exp(-t*8);data[i]=pressure*.70+rush*.76;
  }
  return finish(data,.86);
}

function gaussian(value,center,width){const x=(value-center)/width;return Math.exp(-.5*x*x);}
function renderScream(sampleRate,variant){
  const duration=.56+variant*.055,data=new Float32Array(Math.ceil(duration*sampleRate)),random=rng(0xc0ffee+variant*1297),base=[238,276,218,258][variant%4],formants=[[760,1280,2480],[870,1430,2670],[690,1130,2320],[820,1510,2580]][variant%4];let phase=0,breath=0;
  for(let i=0;i<data.length;i++){
    const t=i/sampleRate,p=t/duration,rise=Math.sin(Math.min(1,p/.34)*Math.PI/2),fall=Math.max(0,(p-.42)/.58),f0=base*(.82+.34*rise-.35*fall)*(1+.018*Math.sin(TAU*(5.1+variant*.35)*t));phase+=TAU*f0/sampleRate;
    let voice=0;for(let harmonic=1;harmonic<=12;harmonic++){const hz=f0*harmonic,shape=.18+1.35*gaussian(hz,formants[0],260)+1.02*gaussian(hz,formants[1],390)+.55*gaussian(hz,formants[2],620);voice+=Math.sin(phase*harmonic+harmonic*.31*variant)*shape/Math.pow(harmonic,.82);}
    const white=random()*2-1;breath+=.14*(white-breath);const air=(white-breath)*(.18+.22*rise),amp=envelope(t,.024,.15,duration)*(.72+.28*Math.sin(Math.PI*p));data[i]=(voice*.30+air)*amp;
  }
  return finish(data,.90);
}

function renderExplosion(sampleRate,variant){
  const duration=.76+variant*.08,data=new Float32Array(Math.ceil(duration*sampleRate)),random=rng(0xb0057+variant*1901);let rumble=0,phase=0;
  for(let i=0;i<data.length;i++){
    const t=i/sampleRate,white=random()*2-1;rumble+=.035*(white-rumble);const crack=(white-rumble)*Math.exp(-t*24),frequency=(88+variant*13)*Math.exp(-t*5.7)+22;phase+=TAU*frequency/sampleRate;const boom=Math.sin(phase+.45*Math.sin(phase*.37))*Math.exp(-t*4.7),tail=rumble*Math.exp(-t*3.1);data[i]=crack*.50+boom*.82+tail*1.1;
  }
  return finish(data,.94);
}

function renderStep(sampleRate,variant){
  const duration=.075+variant*.008,data=new Float32Array(Math.ceil(duration*sampleRate)),random=rng(0x57e9+variant*431);let low=0,phase=0;
  for(let i=0;i<data.length;i++){const t=i/sampleRate,white=random()*2-1;low+=.09*(white-low);phase+=TAU*(78+variant*9)*Math.exp(-t*12)/sampleRate;data[i]=(low*.92+Math.sin(phase)*.36)*Math.exp(-t*38);}
  return finish(data,.72);
}

function renderReward(sampleRate,variant){
  const duration=.42+variant*.035,data=new Float32Array(Math.ceil(duration*sampleRate)),notes=[[392,494,659],[440,554,698],[494,622,784]][variant%3],phases=[0,0,0];
  for(let i=0;i<data.length;i++){const t=i/sampleRate,p=t/duration;let value=0;for(let n=0;n<notes.length;n++){const onset=n*.072,age=t-onset;if(age<0)continue;const frequency=notes[n]*(1+.008*Math.exp(-age*18));phases[n]+=TAU*frequency/sampleRate;const amp=Math.min(1,age/.008)*Math.exp(-age*(5.4+n*.35));value+=(Math.sin(phases[n])+.24*Math.sin(phases[n]*2))*amp;}const shimmer=Math.sin(TAU*(1450+variant*120)*t)*Math.exp(-t*10)*.12;data[i]=(value*.42+shimmer)*Math.min(1,t/.006)*Math.min(1,(duration-t)/.055)*(1-.12*p);}
  return finish(data,.82);
}

function renderFail(sampleRate,variant){
  const duration=.31+variant*.04,data=new Float32Array(Math.ceil(duration*sampleRate)),random=rng(0xfa11ed+variant*821);let phase=0,low=0;
  for(let i=0;i<data.length;i++){const t=i/sampleRate,p=t/duration,white=random()*2-1;low+=.055*(white-low);const frequency=(210+variant*26)*(1-p*.72)+42;phase+=TAU*frequency/sampleRate;data[i]=(Math.sin(phase)*.58+low*.48)*Math.min(1,t/.012)*Math.min(1,(duration-t)/.09)*Math.exp(-t*2.8);}
  return finish(data,.78);
}

const renderers={shot:renderShot,hit:renderHit,damage:renderDamage,scream:renderScream,explosion:renderExplosion,step:renderStep,reward:renderReward,fail:renderFail};
export function createCombatPcmBank(sampleRate=COMBAT_AUDIO_SAMPLE_RATE){
  const rate=Math.max(8000,Math.round(Number(sampleRate)||COMBAT_AUDIO_SAMPLE_RATE)),bank={};
  for(const [kind,count] of Object.entries(BANK_VARIANTS))bank[kind]=Array.from({length:count},(_,variant)=>renderers[kind](rate,variant));
  return{sampleRate:rate,samples:bank};
}

const prebaked=createCombatPcmBank();
export function combatPcmSummary(){const summary={version:COMBAT_AUDIO_BANK_VERSION,sampleRate:prebaked.sampleRate,kinds:{}};for(const [kind,variants] of Object.entries(prebaked.samples))summary.kinds[kind]=variants.map(data=>data.length);return summary;}

export function prepareCombatAudio(context){
  if(!context?.createBuffer)return null;let state=contextBanks.get(context);if(state)return state;
  const buffers={};for(const [kind,variants] of Object.entries(prebaked.samples))buffers[kind]=variants.map(data=>{const buffer=context.createBuffer(1,data.length,prebaked.sampleRate);buffer.copyToChannel?.(data,0);if(!buffer.copyToChannel)buffer.getChannelData(0).set(data);return buffer;});
  state={buffers,cursors:{},lastPlayed:{},plays:0};contextBanks.set(context,state);return state;
}

export function getSharedCombatAudioContext({resume=false}={}){
  const Ctx=globalThis.AudioContext||globalThis.webkitAudioContext;if(!Ctx)return null;
  try{sharedContext??=new Ctx({latencyHint:"interactive"});prepareCombatAudio(sharedContext);if(resume&&sharedContext.state==="suspended")sharedContext.resume().catch(()=>{});return sharedContext;}catch{return null;}
}

export function playCombatAudio(context,kind,{destination=null,gain=1,playbackRate=1,minIntervalMs=0}={}){
  const state=prepareCombatAudio(context),variants=state?.buffers?.[kind];if(!variants?.length)return false;
  if(context.state==="suspended"){context.resume?.().then(()=>playCombatAudio(context,kind,{destination,gain,playbackRate,minIntervalMs})).catch(()=>{});return true;}
  if(context.state!=="running")return false;
  const now=context.currentTime,nowMs=now*1000,previous=Number(state.lastPlayed[kind]),last=Number.isFinite(previous)?previous:-Infinity;if(nowMs-last<Math.max(0,minIntervalMs))return false;state.lastPlayed[kind]=nowMs;
  try{const cursor=state.cursors[kind]||0,source=context.createBufferSource(),amp=context.createGain();source.buffer=variants[cursor%variants.length];state.cursors[kind]=cursor+1;source.playbackRate.value=Math.max(.5,Math.min(1.75,Number(playbackRate)||1));amp.gain.value=Math.max(0,Math.min(2,Number(gain)||0));source.connect(amp).connect(destination||context.destination);source.onended=()=>{try{source.disconnect();amp.disconnect();}catch{}};source.start(now);state.plays++;const viewport=globalThis.document?.getElementById?.("viewport");if(viewport){viewport.dataset.combatAudioBank=COMBAT_AUDIO_BANK_VERSION;viewport.dataset.combatAudioRuntimeOscillators="0";viewport.dataset.combatAudioSamplePlays=String(state.plays);}return true;}catch{return false;}
}
