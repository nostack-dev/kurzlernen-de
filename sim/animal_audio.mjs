import {getSharedCombatAudioContext} from "./combat_audio_bank.mjs";
import {loadAudioSettings} from "./audio_settings.mjs";

// Procedural animal voices (WebAudio, no samples): bird squawk, dog yelp,
// cat meow, the black cat's hiss and attack scream. Played on hits/kills and
// by the black cat when it charges.
export const ANIMAL_AUDIO_VERSION="synth-animal-voices-v1";
function ctxAndGain(){const s=loadAudioSettings();if(s.soundEnabled===false||Number(s.fxVolume)<=0)return null;const ctx=getSharedCombatAudioContext({resume:true});if(!ctx)return null;const out=ctx.createGain();out.gain.value=.55*Math.max(0,Math.min(1,Number(s.fxVolume??72)/100));out.connect(ctx.destination);return{ctx,out};}
function tone(ctx,out,{type="sawtooth",f0,f1,t0=0,dur=.2,gain=.3,fm=0,fmf=0,filter=3000}){const t=ctx.currentTime+t0,o=ctx.createOscillator(),g=ctx.createGain(),bq=ctx.createBiquadFilter();o.type=type;o.frequency.setValueAtTime(f0,t);o.frequency.exponentialRampToValueAtTime(Math.max(30,f1),t+dur);
  if(fm){const m=ctx.createOscillator(),mg=ctx.createGain();m.frequency.value=fmf;mg.gain.value=fm;m.connect(mg);mg.connect(o.frequency);m.start(t);m.stop(t+dur+.02);}
  bq.type="bandpass";bq.frequency.value=filter;bq.Q.value=1.2;g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(gain,t+.012);g.gain.exponentialRampToValueAtTime(.001,t+dur);o.connect(bq);bq.connect(g);g.connect(out);o.start(t);o.stop(t+dur+.03);}
function noise(ctx,out,{t0=0,dur=.3,gain=.2,f=3000,q=.8}){const t=ctx.currentTime+t0,n=Math.ceil(ctx.sampleRate*dur),buf=ctx.createBuffer(1,n,ctx.sampleRate),d=buf.getChannelData(0);for(let i=0;i<n;i++)d[i]=Math.random()*2-1;const s=ctx.createBufferSource(),bq=ctx.createBiquadFilter(),g=ctx.createGain();s.buffer=buf;bq.type="bandpass";bq.frequency.value=f;bq.Q.value=q;g.gain.setValueAtTime(gain,t);g.gain.exponentialRampToValueAtTime(.001,t+dur);s.connect(bq);bq.connect(g);g.connect(out);s.start(t);}
export function playAnimal(kind){const a=ctxAndGain();if(!a)return false;const{ctx,out}=a;
  if(kind==="bird"){tone(ctx,out,{type:"square",f0:2600,f1:1400,dur:.12,gain:.18,filter:2600});tone(ctx,out,{type:"square",f0:2900,f1:1100,t0:.13,dur:.16,gain:.16,filter:2400});noise(ctx,out,{t0:.02,dur:.25,gain:.05,f:5000});}
  else if(kind==="dog"){tone(ctx,out,{f0:900,f1:520,dur:.16,gain:.32,filter:1200,fm:60,fmf:38});tone(ctx,out,{f0:1100,f1:380,t0:.18,dur:.3,gain:.24,filter:1100,fm:90,fmf:30});}
  else if(kind==="cat"){tone(ctx,out,{type:"triangle",f0:520,f1:820,dur:.22,gain:.22,filter:1500,fm:25,fmf:7});tone(ctx,out,{type:"triangle",f0:820,f1:430,t0:.2,dur:.35,gain:.2,filter:1300,fm:30,fmf:6});}
  else if(kind==="hiss"){noise(ctx,out,{dur:.7,gain:.35,f:4200,q:.6});tone(ctx,out,{f0:300,f1:180,dur:.6,gain:.08,filter:600});}
  else if(kind==="screech"){tone(ctx,out,{f0:900,f1:1900,dur:.25,gain:.4,filter:1800,fm:220,fmf:44});tone(ctx,out,{f0:1900,f1:600,t0:.24,dur:.45,gain:.38,filter:1600,fm:260,fmf:52});noise(ctx,out,{dur:.6,gain:.25,f:3000});}
  return true;}
globalThis.__animalAudio={play:playAnimal,version:ANIMAL_AUDIO_VERSION};
