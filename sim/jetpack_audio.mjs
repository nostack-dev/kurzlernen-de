// Jetpack sound. The second press of JUMP in the air is the ignition: a hard "whoomp" (pressure
// thump + flame burst + igniter click), a warm orange flash at the screen edges and a little kick.
// While the pack burns: a rocket roar (filtered noise with flame crackle) whose level and colour
// follow the thrust, fading out when it cuts. Other players' jetpacks roar in 3-D at their
// position. Respects the sound switch and the effects volume.
import {AUDIO_SETTINGS_EVENT,loadAudioSettings} from "./audio_settings.mjs";

export const JETPACK_AUDIO_VERSION="jetpack-audio-v1";
let installed=false,settings=loadAudioSettings(),ctx=null,noise=null,loop=null,flash=null;
const remote=new Map();
const bridge=()=>globalThis.__arondightRealWorld||null;
function vol(){return settings.soundEnabled?Math.max(0,Math.min(1,(Number(settings.fxVolume)||0)/100)):0;}
function audio(){const a=globalThis.__sharedAudioContext;if(!a||a.state!=="running")return null;if(a!==ctx){ctx=a;noise=null;loop=null;remote.clear();}if(!noise){const n=a.createBuffer(1,a.sampleRate*2,a.sampleRate),d=n.getChannelData(0);let b=0;for(let i=0;i<d.length;i++){const w=Math.random()*2-1;b=.97*b+.03*w;d[i]=w*.55+b*2.2;}noise=n;}return a;}
// one roaring voice: noise → band-pass (flame colour) → low-pass → crackle (random AM) → gain [→ panner]
function voice(a,{spatial=false}={}){const src=a.createBufferSource();src.buffer=noise;src.loop=true;src.loopStart=Math.random();const bp=a.createBiquadFilter();bp.type="bandpass";bp.frequency.value=520;bp.Q.value=.6;const lp=a.createBiquadFilter();lp.type="lowpass";lp.frequency.value=2600;
  const crack=a.createGain();crack.gain.value=1;const g=a.createGain();g.gain.value=0;src.connect(bp).connect(lp).connect(crack).connect(g);let out=g,pan=null;if(spatial){pan=a.createPanner();pan.panningModel="equalpower";pan.distanceModel="inverse";pan.refDistance=4;pan.rolloffFactor=1.1;g.connect(pan);out=pan;}out.connect(a.destination);src.start();return{src,bp,lp,crack,g,pan,level:0};}
function drive(v,a,level,dt){const t=a.currentTime;v.level+=(level-v.level)*Math.min(1,dt*(level>v.level?18:7));v.g.gain.setTargetAtTime(v.level*.36*vol(),t,.03);v.bp.frequency.setTargetAtTime(380+v.level*520,t,.05);v.lp.frequency.setTargetAtTime(1400+v.level*2600,t,.05);v.crack.gain.setTargetAtTime(.75+Math.random()*.5,t,.012);}
function ignition(){const a=audio();showFlash();if(!a||vol()<=0)return;const t=a.currentTime,v=vol();
  // pressure thump
  const o=a.createOscillator(),og=a.createGain();o.type="sine";o.frequency.setValueAtTime(95,t);o.frequency.exponentialRampToValueAtTime(38,t+.25);og.gain.setValueAtTime(.55*v,t);og.gain.exponentialRampToValueAtTime(.001,t+.32);o.connect(og).connect(a.destination);o.start(t);o.stop(t+.35);
  // flame burst (noise, opening filter)
  const s=a.createBufferSource();s.buffer=noise;const f=a.createBiquadFilter();f.type="lowpass";f.frequency.setValueAtTime(300,t);f.frequency.exponentialRampToValueAtTime(5200,t+.09);f.frequency.exponentialRampToValueAtTime(1500,t+.4);const sg=a.createGain();sg.gain.setValueAtTime(0,t);sg.gain.linearRampToValueAtTime(.62*v,t+.025);sg.gain.exponentialRampToValueAtTime(.001,t+.5);s.connect(f).connect(sg).connect(a.destination);s.start(t,Math.random());s.stop(t+.55);
  // igniter click
  const c=a.createOscillator(),cg=a.createGain();c.type="square";c.frequency.value=2400;cg.gain.setValueAtTime(.12*v,t);cg.gain.exponentialRampToValueAtTime(.001,t+.03);c.connect(cg).connect(a.destination);c.start(t);c.stop(t+.04);}
function showFlash(){const v=document.getElementById("viewport");if(!v)return;if(!flash?.isConnected){flash=document.createElement("div");flash.id="jetpackIgnitionFlash";flash.style.cssText="position:absolute;inset:0;pointer-events:none;z-index:9;opacity:0;transition:opacity .35s ease-out;box-shadow:inset 0 -90px 120px -40px #ff9a2e,inset 0 0 70px 0 #ff7a1e66";v.appendChild(flash);}
  flash.style.transition="none";flash.style.opacity="1";requestAnimationFrame(()=>{flash.style.transition="opacity .45s ease-out";flash.style.opacity="0";});v.dataset.jetpackIgnitions=String((Number(v.dataset.jetpackIgnitions)||0)+1);}
let last=performance.now();
function frame(){requestAnimationFrame(frame);const now=performance.now(),dt=Math.min(.1,(now-last)/1000);last=now;const a=audio();if(!a)return;
  const jet=globalThis.__arondightJetpack,walk=globalThis.__arondightWalkMode,on=Boolean(jet?.thrusting)&&walk?.mode==="foot"&&!walk?.dead,level=on?Math.max(.35,Math.min(1,(Number(jet.acc)||13.8)/21)):0;
  if(level>0&&!loop)loop=voice(a);if(loop){drive(loop,a,level,dt);if(level===0&&loop.level<.01){try{loop.src.stop();}catch{}loop=null;}}
  // other players' jetpacks, in 3-D (player_vehicle_runtime_v2 publishes where they burn)
  const cam=bridge()?.presentedCamera?.()||bridge()?.threeCamera,jets=globalThis.__arondightRemoteJetPos;if(cam&&a.listener.positionX){a.listener.positionX.value=cam.position.x;a.listener.positionY.value=cam.position.y;a.listener.positionZ.value=cam.position.z;}
  if(jets)for(const[id,p]of jets){const live=now-p.at<300&&cam&&Math.hypot(p.x-cam.position.x,p.y-cam.position.y)<120;let v=remote.get(id);if(live&&!v){v=voice(a,{spatial:true});remote.set(id,v);}if(!v)continue;if(v.pan?.positionX){v.pan.positionX.value=p.x;v.pan.positionY.value=p.y;v.pan.positionZ.value=p.z;}drive(v,a,live?.8:0,dt);if(!live&&v.level<.01){try{v.src.stop();}catch{}remote.delete(id);}}}
export function installJetpackAudio(){if(installed||typeof window==="undefined")return;installed=true;addEventListener("arondight:player-jetpack",ignition);addEventListener(AUDIO_SETTINGS_EVENT,()=>{settings=loadAudioSettings();});requestAnimationFrame(frame);}
installJetpackAudio();
