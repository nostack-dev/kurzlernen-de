// HEADSHOT: where a bullet lands on a person, and what a head hit feels like.
//   headZone(hit)      → "head" when a round (sniper, Glock, MP) lands in the head of a living humanoid:
//                        a mate's head hitbox (vsHitZone), or the top of a person / zombie / cop / soldier
//                        hit capsule (chin up: the top 14 % of the body, 21–30 cm).
//   vehicleHit(hit)    → the car / bus a round struck (its root, a stable key, engine-bay hit or not).
//   announceHeadshot() → the head-hit crack, a bold "HEADSHOT" pop at the top centre of the view and an
//                        original announcer line ("Headshot!", synthesised offline from the CMU flite
//                        voice and processed: pitch down, saturation, compression, arena slap + room tail;
//                        sim/audio/headshot_announcer.mp3). The voice comes at most once per 1.2 s; the pop
//                        text and the crack come with every head hit. Sound respects the effects switch.
// Prebaked buffers only (no oscillators on the hit path), through the shared AudioContext.
import {loadAudioSettings,AUDIO_SETTINGS_EVENT,normalizeAudioSettings} from "./audio_settings.mjs";
import {getSharedCombatAudioContext} from "./combat_audio_bank.mjs";

export const HEADSHOT_FEEDBACK_VERSION="headshot-zone-announcer-v1";
export const HEADSHOT_VOICE_URL=new URL("./sim/audio/headshot_announcer.mp3",globalThis.document?.baseURI||globalThis.location?.href||"http://localhost/").href;
const VOICE_MIN_INTERVAL_MS=1200,POP_MS=1150,HEAD_PROXIES=new Set(["PERSON_HIT_PROXY","ZOMBIE_HIT_PROXY","POLICE_OFFICER_HIT_PROXY","MILITARY_SOLDIER_HIT_PROXY"]);
let installed=false,audioSettings=null,voiceBytes=null,voiceFetch=null,voiceBuffer=null,voiceDecoding=null,crackBuffer=null,crackCtx=null,lastVoiceAt=-Infinity,pop=null,popTimer=0,count=0,streak=0,lastHeadAt=-Infinity;
const viewport=()=>document.getElementById("viewport");
const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number(v)||0));

// ---------------------------------------------------------------- zones
function zoneOf(hit){for(let n=hit?.object;n;n=n.parent){const z=n.userData?.vsHitZone;if(z)return String(z);}return"";}
function proxyOf(hit){for(let n=hit?.object,i=0;n&&i<4;n=n.parent,i++)if(HEAD_PROXIES.has(n.name))return n;return null;}
// is this object drawn in the live scene (not detached, not hidden by itself or a parent)?
export function liveInScene(object){for(let n=object;n;n=n.parent){if(n.visible===false)return false;if(n.isScene)return true;}return false;}
const _min={x:0,y:0,z:0},_max={x:0,y:0,z:0};
function worldZRange(mesh){const g=mesh?.geometry;if(!g)return null;if(!g.boundingBox)g.computeBoundingBox?.();const b=g.boundingBox;if(!b)return null;mesh.updateWorldMatrix?.(true,false);const e=mesh.matrixWorld.elements;let lo=Infinity,hi=-Infinity;
  for(let i=0;i<8;i++){const x=i&1?b.max.x:b.min.x,y=i&2?b.max.y:b.min.y,z=i&4?b.max.z:b.min.z,wz=e[2]*x+e[6]*y+e[10]*z+e[14];if(wz<lo)lo=wz;if(wz>hi)hi=wz;}return{lo,hi};}
export function headZone(hit){if(!hit)return"";const zone=zoneOf(hit);if(zone)return zone==="head"?"head":"";
  const proxy=proxyOf(hit),point=hit.point;if(!proxy||!point||!Number.isFinite(Number(point.z)))return"";const r=worldZRange(proxy);if(!r)return"";const h=r.hi-r.lo;
  if(h<1.2||h>2.6)return""; /* lying, crouched into a heap, or not a standing human */
  const head=clamp(h*.14,.21,.3);return Number(point.z)>=r.hi-head?"head":"";}
// ---------------------------------------------------------------- vehicles
// the car / bus a hit belongs to: the top-most vehicle node above the struck mesh (or the Box3D body id)
export function vehicleHit(hit){let root=null,kind="",police=false;for(let n=hit?.object;n&&!n.isScene;n=n.parent){const u=n.userData||{},k=String(u.worldPopulationKind||u.worldLifeKind||"");if(u.policeCruiser){root=n;kind="car";police=true;}else if(k==="car"||k==="bus"){root=n;kind=k;}else if(u.gtaDrivableVehicle&&!kind){root=n;kind="car";}}
  if(!kind){const pk=String(hit?.physicsKind||"");if(pk==="car"||pk==="bus")kind=pk;else return null;}
  const key=String(hit?.physicsId||root?.userData?.worldPopulationId||root?.userData?.policeCruiser||root?.uuid||"");let engine=false;
  if(root&&hit?.point){/* the engine sits in the nose (local +X, where the critical smoke comes out): a hit there does more */root.updateWorldMatrix?.(true,false);const inv=root.matrixWorld.clone().invert(),p=hit.point.clone().applyMatrix4(inv),s=root.scale?.x||1,nose=kind==="bus"?2.1:.85;engine=p.x*s>=nose&&p.z*s<1.35;}
  return{root,kind,police,key,engine};}

// ---------------------------------------------------------------- audio
function settings(){return audioSettings||(audioSettings=loadAudioSettings());}
function prefetchVoice(){if(voiceBytes||voiceFetch||typeof fetch!=="function")return voiceFetch;voiceFetch=fetch(HEADSHOT_VOICE_URL).then(r=>r.ok?r.arrayBuffer():null).then(b=>{voiceBytes=b;return b;}).catch(()=>null);return voiceFetch;}
function decodeVoice(ctx){if(voiceBuffer||voiceDecoding)return voiceDecoding;voiceDecoding=(voiceBytes?Promise.resolve(voiceBytes):prefetchVoice()).then(bytes=>{if(!bytes)return null;return new Promise((res)=>{try{const p=ctx.decodeAudioData(bytes.slice(0),b=>res(b),()=>res(null));if(p?.then)p.then(res,()=>res(null));}catch{res(null);}});}).then(b=>{voiceBuffer=b;if(!b)voiceDecoding=null;return b;});return voiceDecoding;}
// a head hit: a hard bone crack on top of a wet, low thump (rendered once into a buffer)
function renderCrack(rate){const n=Math.floor(rate*.32),d=new Float32Array(n);let s=1234567,lp=0,bp1=0,bp2=0,ph=0;const rnd=()=>((s=(Math.imul(s,1103515245)+12345)>>>0)/4294967296)*2-1;
  for(let i=0;i<n;i++){const t=i/rate,crack=rnd()*Math.exp(-t/.0045)*1.15,f=105*Math.exp(-t/.05)+48;ph+=f/rate;const thump=Math.sin(2*Math.PI*ph)*Math.exp(-t/.075)*Math.min(1,t/.0015)*.9;
    const raw=rnd();lp+=.18*(raw-lp);bp1+=.35*(lp-bp1);bp2=lp-bp1;const splat=bp2*Math.exp(-Math.max(0,t-.008)/.06)*(t>.006?1:0)*.8;d[i]=Math.tanh((crack+thump+splat)*1.6)*.92;}
  const f=Math.floor(rate*.03);for(let i=0;i<f;i++)d[n-1-i]*=i/f;return d;}
function crackFor(ctx){if(crackBuffer&&crackCtx===ctx)return crackBuffer;const data=renderCrack(ctx.sampleRate||44100),b=ctx.createBuffer(1,data.length,ctx.sampleRate||44100);b.getChannelData(0).set(data);crackBuffer=b;crackCtx=ctx;return b;}
function playBuffer(ctx,buffer,gain,when=0,rate=1){try{const src=ctx.createBufferSource(),amp=ctx.createGain();src.buffer=buffer;src.playbackRate.value=rate;amp.gain.value=gain;src.connect(amp).connect(ctx.destination);src.onended=()=>{try{src.disconnect();amp.disconnect();}catch{}};src.start(ctx.currentTime+Math.max(0,when));return true;}catch{return false;}}
function playSounds(voice){const a=settings();if(!a.soundEnabled)return{crack:false,voice:false};const fx=clamp(a.fxVolume,0,100)/100,shots=clamp(a.shotsVolume,0,100)/100;const ctx=getSharedCombatAudioContext({resume:true});if(!ctx)return{crack:false,voice:false};
  const go=()=>{const out={crack:false,voice:false};if(fx>0||shots>0)out.crack=playBuffer(ctx,crackFor(ctx),.62*Math.max(fx,shots),0,.94+Math.random()*.1);
    if(voice&&fx>0){const g=1.15*Math.max(.35,fx);if(voiceBuffer)out.voice=playBuffer(ctx,voiceBuffer,g,.09);else{out.voice=true;/* first headshot: decode now, speak as soon as it is ready */decodeVoice(ctx)?.then(b=>{if(b)playBuffer(ctx,b,g,.02);});}}return out;};
  if(ctx.state==="suspended"){ctx.resume?.().then(go).catch(()=>{});return{crack:true,voice};}return go();}

// ---------------------------------------------------------------- HUD
const CSS=`#headshotPop{position:absolute;left:50%;top:max(25%,84px);z-index:26;pointer-events:none;transform:translate(-50%,0);display:none;text-align:center;white-space:nowrap;
font:italic 900 clamp(30px,7.4vmin,62px)/1 "Barlow Condensed",Impact,"Arial Narrow",system-ui,sans-serif;letter-spacing:.06em;color:#ffe27a;
-webkit-text-stroke:1.5px #4a0700;paint-order:stroke fill;text-shadow:0 0 2px #000,0 3px 0 #7d0d00,0 0 18px #ff3b1fcc,0 0 40px #ff3b1f66}
#headshotPop small{display:block;margin-top:4px;font:800 clamp(11px,2.4vmin,16px)/1 "Barlow Condensed",system-ui,sans-serif;letter-spacing:.32em;color:#fff;-webkit-text-stroke:0;text-shadow:0 1px 3px #000}
#headshotPop.show{display:block;animation:headshotPop ${POP_MS}ms cubic-bezier(.2,.9,.25,1) both}
@keyframes headshotPop{0%{opacity:.85;transform:translate(-50%,0) scale(1.9) rotate(-4deg);filter:blur(1.5px)}12%{opacity:1;transform:translate(-50%,0) scale(.94) rotate(-2deg);filter:none}20%{transform:translate(-50%,0) scale(1.06) rotate(-2deg)}28%{transform:translate(-50%,0) scale(1) rotate(-2deg)}78%{opacity:1;transform:translate(-50%,-2px) scale(1) rotate(-2deg)}100%{opacity:0;transform:translate(-50%,-14px) scale(.96) rotate(-2deg)}}
@media (prefers-reduced-motion:reduce){#headshotPop.show{animation-duration:900ms;animation-name:headshotFade}@keyframes headshotFade{0%,80%{opacity:1}100%{opacity:0}}}`;
function ensurePop(){if(pop?.isConnected)return pop;const v=viewport();if(!v)return null;if(!document.querySelector("style[data-headshot-pop]")){const st=document.createElement("style");st.dataset.headshotPop=HEADSHOT_FEEDBACK_VERSION;st.textContent=CSS;document.head.appendChild(st);}
  pop=document.createElement("div");pop.id="headshotPop";pop.setAttribute("role","status");pop.setAttribute("aria-live","polite");v.appendChild(pop);return pop;}
function showPop(n){const el=ensurePop();if(!el)return false;el.innerHTML=`HEADSHOT${n>1?`<small>×${n}</small>`:""}`;el.classList.remove("show");void el.offsetWidth;el.classList.add("show");clearTimeout(popTimer);popTimer=setTimeout(()=>el.classList.remove("show"),POP_MS+40);return true;}

// a confirmed head hit (the round reached a living head)
export function announceHeadshot({weapon="",target="",remote=false}={}){const now=performance.now();count++;streak=now-lastHeadAt<4000?streak+1:1;lastHeadAt=now;
  const voice=now-lastVoiceAt>=VOICE_MIN_INTERVAL_MS;if(voice)lastVoiceAt=now;const shown=showPop(streak);const sound=playSounds(voice);
  const v=viewport();if(v){v.dataset.headshots=String(count);v.dataset.headshotLast=`${weapon}:${target}${remote?":remote":""}`;v.dataset.headshotVoice=voice?"1":"0";v.dataset.headshotFeedback=HEADSHOT_FEEDBACK_VERSION;}
  try{window.dispatchEvent(new CustomEvent("arondight:headshot",{detail:{weapon,target,remote,streak,voice}}));}catch{}
  return{shown,voice,sound};}

export function installHeadshotFeedback(){if(installed||typeof window==="undefined")return;installed=true;
  addEventListener(AUDIO_SETTINGS_EVENT,e=>{audioSettings=normalizeAudioSettings(e.detail||loadAudioSettings());});
  // the line is tiny (~12 KB): fetch it when the browser is idle, decode it with the first shot fired
  const idle=globalThis.requestIdleCallback||(f=>setTimeout(f,1500));idle(()=>prefetchVoice());
  addEventListener("arondight:weapon-fired",()=>{const ctx=getSharedCombatAudioContext();if(ctx)decodeVoice(ctx);},{once:true});
  globalThis.__arondightHeadshot={zone:headZone,vehicle:vehicleHit,announce:announceHeadshot,get count(){return count;},get voiceReady(){return Boolean(voiceBuffer);},version:HEADSHOT_FEEDBACK_VERSION};}
installHeadshotFeedback();
