export const COMBAT_AUDIO_BANK_VERSION="prebaked-pcm-buffer-bank-v3"; // pistol: hard 9 mm N-wave report v4
export const COMBAT_AUDIO_SAMPLE_RATE=44100;

const TAU=Math.PI*2;
const BANK_VARIANTS=Object.freeze({shot:3,pistol:4,hit:4,crack:4,damage:2,scream:4,explosion:2,step:3,bounce:4,reward:3,fail:2});
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

function renderPistol(sampleRate,variant){
  // Hard, realistic 9 mm handgun report (Glock 17 class), built from what a
  // recording of one actually contains:
  //  1. muzzle blast N-wave: ~0.3 ms rise to the peak, ~1 ms linear fall
  //     through zero into a negative lobe — the "crack" that makes it hard;
  //  2. broadband blast noise (band 0.3–6 kHz) dying in ~10 ms;
  //  3. pressure thump: 150 -> 55 Hz sweep, ~30 ms — the punch in the chest;
  //  4. slide cycling: two short metallic clacks (~24 ms, ~48 ms), 2.3/3.6 kHz;
  //  5. urban slap-back: early reflections from walls (14–80 ms, low-passed)
  //     and a short diffuse street tail (~0.35 s).
  // Hard-clipped like a close mic'd shot (tanh drive), then normalised.
  const duration=.46+variant*.012,data=new Float32Array(Math.ceil(duration*sampleRate)),random=rng(0x61c0a7+variant*7919),dry=new Float32Array(data.length);
  const rise=.00028+variant*.00002,fall=.00105+variant*.00006;let hp=0,lpA=0,lpB=0,tail=0,phase=0,ring1=0,ring2=0;
  for(let n=0;n<data.length;n++){
    const t=n/sampleRate,white=random()*2-1;
    let nwave=0;if(t<rise)nwave=t/rise;else if(t<rise+fall)nwave=1-1.6*(t-rise)/fall;else if(t<rise+fall*1.9)nwave=-.6*(1-(t-rise-fall)/(fall*.9));
    lpA+=.55*(white-lpA);hp=white-lpA;lpB+=.22*(lpA-lpB);const band=lpA-lpB;
    const blast=(band*.9+hp*.55)*Math.exp(-t/.0105);
    const f=150*Math.exp(-t*24)+55;phase+=TAU*f/sampleRate;const thump=Math.sin(phase)*Math.exp(-t/.030)*(1-Math.exp(-t/.0009));
    let mech=0;for(const[at,f1,f2,g]of[[.0235+variant*.0011,2300,3610,1],[.0478+variant*.0017,1980,3120,.7]]){const u=t-at;if(u>=0&&u<.02)mech+=g*(Math.sin(TAU*f1*u)+.6*Math.sin(TAU*f2*u)+.4*(random()*2-1))*Math.exp(-u/.0042);}
    dry[n]=nwave*1.25+blast*.95+thump*.85+mech*.22;
  }
  // reflections + street tail
  const taps=[[.0142,.42],[.0235,.30],[.0371,.24],[.0516,.17],[.0784,.11]].map(([d,g])=>[Math.floor((d+variant*.0007)*sampleRate),g]);
  for(let n=0;n<data.length;n++){
    const t=n/sampleRate;let v=dry[n];for(const[d,g]of taps)if(n>=d){ring1+=0;v+=g*dry[n-d]*.8;}
    ring2+=.08*((random()*2-1)-ring2);tail+=.15*(ring2-tail);const diffuse=t>.012?tail*.34*Math.exp(-(t-.012)/.11):0;
    data[n]=v+diffuse;
  }
  // low-pass the reflections a bit (walls absorb highs) while keeping the dry crack
  let lp=0;for(let n=0;n<data.length;n++){lp+=.45*(data[n]-lp);data[n]=dry[n]+(lp-dry[n]*.45);}
  for(let n=0;n<data.length;n++)data[n]=Math.tanh(data[n]*2.2);
  return finish(data,.99);
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

function renderCrack(sampleRate,variant){
  const duration=.082+variant*.006,data=new Float32Array(Math.ceil(duration*sampleRate)),random=rng(0xc12ac7+variant*991);let low=0,phase=0;
  for(let i=0;i<data.length;i++){
    const t=i/sampleRate,white=random()*2-1;low+=.08*(white-low);const snap=(white-low)*Math.exp(-t*(92-variant*4));
    const frequency=(760+variant*85)*Math.exp(-t*24)+(135+variant*13);phase+=TAU*frequency/sampleRate;
    const wood=(Math.sin(phase)+.28*Math.sin(phase*2.07+.4))*Math.exp(-t*(42-variant*2));
    data[i]=snap*.82+wood*.52;
  }
  return finish(data,.84);
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

function renderBounce(sampleRate,variant){
  const duration=.13+variant*.012,data=new Float32Array(Math.ceil(duration*sampleRate)),random=rng(0xb01ce+variant*593),delay=Math.floor(sampleRate*(.017+variant*.0015));let phase=0,ring=0,low=0;
  for(let i=0;i<data.length;i++){
    const t=i/sampleRate,white=random()*2-1;low+=.16*(white-low);const click=(white-low)*Math.exp(-t*68);
    const frequency=(330+variant*22)*Math.exp(-t*8.5)+(118+variant*7);phase+=TAU*frequency/sampleRate;ring=Math.sin(phase)+.34*Math.sin(phase*2.02+.4);
    const body=ring*Math.exp(-t*(20-variant*.8)),echo=i>=delay?data[i-delay]*(.17-variant*.012):0;
    data[i]=click*.28+body*.82+echo;
  }
  return finish(data,.76);
}

// Reward / fail cues composed to sit inside the soundtrack ("8 Bits Only":
// E♭ minor, ~176 BPM): notes from E♭ minor, timed on 16ths of that tempo,
// a soft rounded pulse (filtered, no clicks) over a quiet sine sub, and a
// dotted-8th echo — dark tactical HUD confirmations, not cartoon jingles.
const NOTE=n=>440*Math.pow(2,(n-69)/12);
const SIXTEENTH=60/176/4;
function renderCue(sampleRate,{notes,lengths=null,cutoff=2600,echo=.3,level=.75}){
  const total=notes.reduce((sum,_,i)=>sum+(lengths?.[i]??1),0)*SIXTEENTH,tail=SIXTEENTH*6,dry=new Float32Array(Math.ceil((total+tail)*sampleRate));
  let t0=0;
  for(let n=0;n<notes.length;n++){
    const len=(lengths?.[n]??1)*SIXTEENTH,note=notes[n];if(note===null){t0+=len;continue;}
    const f=NOTE(note),start=Math.floor(t0*sampleRate),dur=len*1.6,count=Math.floor(dur*sampleRate);let phase=0,sub=0,lp=0;
    for(let i=0;i<count&&start+i<dry.length;i++){
      const t=i/sampleRate,env=Math.min(1,t/.006)*Math.exp(-t/(len*.75));
      phase+=f/sampleRate;sub+=f*.5/sampleRate;
      const pulse=(phase%1)<.5?1:-1,alpha=Math.min(1,2*Math.PI*cutoff*(1-.5*t/dur)/sampleRate);lp+=alpha*(pulse-lp);
      dry[start+i]+=(lp*.55+Math.sin(2*Math.PI*sub)*.28)*env;
    }
    t0+=len;
  }
  const data=new Float32Array(dry.length),delay=Math.floor(SIXTEENTH*3*sampleRate);
  for(let i=0;i<data.length;i++){const e1=i>=delay?dry[i-delay]*echo:0,e2=i>=2*delay?dry[i-2*delay]*echo*echo:0;data[i]=dry[i]+e1+e2;}
  const fade=Math.floor(.04*sampleRate);for(let i=0;i<fade;i++)data[data.length-1-i]*=i/fade;
  return finish(data,level);
}
// E♭ minor: E♭ F G♭ A♭ B♭ C♭ D♭ (63 65 66 68 70 71 73 / 75 …)
function renderReward(sampleRate,variant){
  const v=variant%3;
  if(v===0)return renderCue(sampleRate,{notes:[70,75],lengths:[1,2],cutoff:2400});                 // B♭→E♭: clean confirm
  if(v===1)return renderCue(sampleRate,{notes:[63,66,70,75],lengths:[1,1,1,2],cutoff:2800});        // E♭m arpeggio: hit/kill
  return renderCue(sampleRate,{notes:[66,70,73,78,null,82],lengths:[1,1,1,1,1,3],cutoff:3200,echo:.36}); // streak: G♭ B♭ D♭ G♭ … B♭
}
function renderFail(sampleRate,variant){
  const v=variant%2;
  if(v===0)return renderCue(sampleRate,{notes:[70,69,66],lengths:[1,1,3],cutoff:1400,echo:.22,level:.7});   // B♭→A→G♭: denied
  return renderCue(sampleRate,{notes:[63,58,51],lengths:[1,1,4],cutoff:1100,echo:.2,level:.72});           // falling E♭ octaves: lost
}

const renderers={shot:renderShot,pistol:renderPistol,hit:renderHit,crack:renderCrack,damage:renderDamage,scream:renderScream,explosion:renderExplosion,step:renderStep,bounce:renderBounce,reward:renderReward,fail:renderFail};
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
  try{sharedContext??=globalThis.__sharedAudioContext||new Ctx({latencyHint:"interactive"});globalThis.__sharedAudioContext=sharedContext;prepareCombatAudio(sharedContext);if(resume&&sharedContext.state==="suspended")sharedContext.resume().catch(()=>{});return sharedContext;}catch{return null;}
}

export function playCombatAudio(context,kind,{destination=null,gain=1,playbackRate=1,minIntervalMs=0}={}){
  const state=prepareCombatAudio(context),variants=state?.buffers?.[kind];if(!variants?.length)return false;
  if(context.state==="suspended"){context.resume?.().then(()=>playCombatAudio(context,kind,{destination,gain,playbackRate,minIntervalMs})).catch(()=>{});return true;}
  if(context.state!=="running")return false;
  const now=context.currentTime,nowMs=now*1000,previous=Number(state.lastPlayed[kind]),last=Number.isFinite(previous)?previous:-Infinity;if(nowMs-last<Math.max(0,minIntervalMs))return false;state.lastPlayed[kind]=nowMs;
  try{const cursor=state.cursors[kind]||0,source=context.createBufferSource(),amp=context.createGain();source.buffer=variants[cursor%variants.length];state.cursors[kind]=cursor+1;source.playbackRate.value=Math.max(.5,Math.min(1.75,Number(playbackRate)||1));amp.gain.value=Math.max(0,Math.min(2,Number(gain)||0));source.connect(amp).connect(destination||context.destination);source.onended=()=>{try{source.disconnect();amp.disconnect();}catch{}};source.start(now);state.plays++;const viewport=globalThis.document?.getElementById?.("viewport");if(viewport){viewport.dataset.combatAudioBank=COMBAT_AUDIO_BANK_VERSION;viewport.dataset.combatAudioRuntimeOscillators="0";viewport.dataset.combatAudioSamplePlays=String(state.plays);}return true;}catch{return false;}
}
