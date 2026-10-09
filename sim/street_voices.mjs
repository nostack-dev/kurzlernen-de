// Street life you can hear: drivers honk and people tell you what they think of you.
//
//  honk(position, {kind, style})  a synthesized car/bus horn placed in 3-D (WebAudio panner at the
//                                 car, listener at the presented camera). Callers only honk with a
//                                 reason (blocked by someone standing in the lane, a near miss).
//  shout(position, {mood, seed})  a short spoken line (German, browser speech synthesis) in the
//                                 person's own voice (pitch/rate from their seed), as loud as the
//                                 distance allows, plus a speech bubble over the head — readable
//                                 with the sound off too.
// Both are rate-limited globally and per source, so the street never turns into a wall of noise.
import {AUDIO_SETTINGS_EVENT,loadAudioSettings} from "./audio_settings.mjs";
import * as THREE from "three";

export const STREET_VOICES_VERSION="street-voices-v1";
const LINES={
  bump:["Hey, pass doch auf!","Geht's noch?","Augen auf, Mann!","Was soll das denn?","Mann, ey!","Hast du keine Augen im Kopf?"],
  angry:["Na warte!","Jetzt reicht's mir!","Willst du Ärger?","Komm her, du Idiot!","Dir zeig ich's!","Du hast sie doch nicht alle!"],
  scared:["Hilfe!","Weg hier!","Der ist verrückt!","Lauf!","Polizei! Hilfe!"],
  nearmiss:["Bist du blind?!","Langsam, du Irrer!","Spinnst du?!","Pass doch auf, du Vollidiot!","Fahr doch nicht wie ein Henker!"],
  honked:["Ja ja, ist ja gut!","Reg dich ab!","Hup nicht so!","Selber!"],
};
const MAX_HEAR_M=38,SHOUT_GAP_MS=1400,SOURCE_GAP_MS=6000,HONK_GAP_MS=1200;
let installed=false,settings=loadAudioSettings(),ctx=null,bus=null,lastShout=-1e9,lastHonk=-1e9,deVoice=null,layer=null;
const lastBySource=new Map(),bubbles=[];
const tmp=new THREE.Vector3(),dir=new THREE.Vector3();
const bridge=()=>globalThis.__arondightRealWorld||null;
function camera(){const b=bridge();return b?.presentedCamera?.()||b?.threeCamera||null;}
function hearing(){return settings.soundEnabled?Math.max(0,Math.min(1,(Number(settings.fxVolume)||0)/100)):0;}
function distanceTo(p){const c=camera();return c?Math.hypot(p[0]-c.position.x,p[1]-c.position.y,(p[2]||0)-c.position.z):Infinity;}
function hash(s){let h=2166136261;for(const ch of String(s))h=Math.imul(h^ch.charCodeAt(0),16777619);return(h>>>0)/4294967296;}
function audio(){if(ctx)return ctx;const C=globalThis.AudioContext||globalThis.webkitAudioContext;if(!C)return null;try{ctx=(globalThis.__sharedAudioContext??=new C({latencyHint:"interactive"}));}catch{return null;}bus=ctx.createGain();bus.gain.value=1;bus.connect(ctx.destination);return ctx;}
function placeListener(){const c=camera(),a=ctx;if(!c||!a)return;const L=a.listener;c.getWorldDirection(dir);const t=a.currentTime;
  if(L.positionX){L.positionX.setValueAtTime(c.position.x,t);L.positionY.setValueAtTime(c.position.y,t);L.positionZ.setValueAtTime(c.position.z,t);L.forwardX.setValueAtTime(dir.x,t);L.forwardY.setValueAtTime(dir.y,t);L.forwardZ.setValueAtTime(dir.z,t);L.upX.setValueAtTime(0,t);L.upY.setValueAtTime(0,t);L.upZ.setValueAtTime(1,t);}
  else{L.setPosition?.(c.position.x,c.position.y,c.position.z);L.setOrientation?.(dir.x,dir.y,dir.z,0,0,1);}}

// Horn: two detuned reed tones (a real horn pair is about a major third apart) through a bright
// band-pass; "toot" = short, "double" = two short, "long" = held.
export function honk(position,{kind="car",style="toot",source=""}={}){
  const now=performance.now();if(!Array.isArray(position)||now-lastHonk<HONK_GAP_MS)return false;const key=`h:${source}`;if(source&&now-(lastBySource.get(key)||-1e9)<4000)return false;
  const vol=hearing(),d=distanceTo(position);if(vol<=0||d>160)return false;const a=audio();if(!a||a.state!=="running")return false;lastHonk=now;if(source)lastBySource.set(key,now);placeListener();
  const t0=a.currentTime+.01,bus2=kind==="bus",f1=bus2?233:415,f2=bus2?294:523,pan=a.createPanner();pan.panningModel="equalpower";pan.distanceModel="inverse";pan.refDistance=bus2?9:6;pan.maxDistance=400;pan.rolloffFactor=1.1;
  if(pan.positionX){pan.positionX.setValueAtTime(position[0],t0);pan.positionY.setValueAtTime(position[1],t0);pan.positionZ.setValueAtTime(position[2]||1,t0);}else pan.setPosition(position[0],position[1],position[2]||1);
  const band=a.createBiquadFilter();band.type="bandpass";band.frequency.value=bus2?900:1500;band.Q.value=.7;const shape=a.createWaveShaper(),curve=new Float32Array(256);for(let i=0;i<256;i++){const x=i/127.5-1;curve[i]=Math.tanh(2.2*x);}shape.curve=curve;
  const g=a.createGain();g.gain.value=0;shape.connect(band).connect(g).connect(pan).connect(bus);
  const parts=style==="long"?[[0,.75]]:style==="double"?[[0,.16],[.24,.2]]:[[0,.24]];const end=parts[parts.length-1][0]+parts[parts.length-1][1];
  for(const[f,detune]of[[f1,-6],[f2,5]]){const o=a.createOscillator();o.type="sawtooth";o.frequency.value=f;o.detune.value=detune;const og=a.createGain();og.gain.value=.5;o.connect(og).connect(shape);o.start(t0);o.stop(t0+end+.1);}
  const peak=.34*vol;for(const[s,len]of parts){g.gain.setValueAtTime(0,t0+s);g.gain.linearRampToValueAtTime(peak,t0+s+.012);g.gain.setValueAtTime(peak,t0+s+len-.03);g.gain.linearRampToValueAtTime(0,t0+s+len);}
  const v=document.getElementById("viewport");if(v){v.dataset.streetHonks=String((Number(v.dataset.streetHonks)||0)+1);v.dataset.streetVoices=STREET_VOICES_VERSION;}return true;}

function pickVoice(){if(deVoice!==null||typeof speechSynthesis==="undefined")return deVoice;const vs=speechSynthesis.getVoices?.()||[];if(!vs.length)return null;deVoice=vs.find(v=>/^de(-|_|$)/i.test(v.lang)&&/de-DE/i.test(v.lang))||vs.find(v=>/^de/i.test(v.lang))||false;return deVoice;}
export function shout(position,{mood="bump",seed="",text=""}={}){
  const now=performance.now();if(!Array.isArray(position))return false;const key=`s:${seed}`;if(now-lastShout<SHOUT_GAP_MS||(seed&&now-(lastBySource.get(key)||-1e9)<SOURCE_GAP_MS))return false;
  const d=distanceTo(position);if(d>MAX_HEAR_M)return false;const lines=LINES[mood]||LINES.bump,r=hash(`${seed}:${Math.floor(now/997)}`),line=text||lines[Math.floor(r*lines.length)%lines.length];lastShout=now;if(seed)lastBySource.set(key,now);
  bubble(position,line,mood);
  const vol=hearing()*Math.max(0,1-d/MAX_HEAR_M);
  if(vol>.03&&typeof speechSynthesis!=="undefined"&&typeof SpeechSynthesisUtterance!=="undefined"){try{if(speechSynthesis.speaking)speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(line),k=hash(seed||line);u.lang="de-DE";const voice=pickVoice();if(voice)u.voice=voice;u.pitch=.65+k*.8;u.rate=mood==="scared"?1.35:1.12+hash(`${seed}r`)*.2;u.volume=Math.min(1,.25+vol*.9);speechSynthesis.speak(u);}catch{}}
  const v=document.getElementById("viewport");if(v)v.dataset.streetShouts=String((Number(v.dataset.streetShouts)||0)+1);return true;}

// speech bubbles, projected over the speaker's head every frame until they fade
function ensureLayer(){if(layer?.isConnected)return layer;const v=document.getElementById("viewport");if(!v)return null;layer=document.createElement("div");layer.id="streetVoiceBubbles";v.appendChild(layer);
  const st=document.createElement("style");st.dataset.streetVoices=STREET_VOICES_VERSION;st.textContent=`#streetVoiceBubbles{position:absolute;inset:0;pointer-events:none;z-index:12;overflow:hidden}
#streetVoiceBubbles div{position:absolute;left:0;top:0;transform:translate(-50%,-100%);padding:4px 9px;border-radius:10px;background:#fffffff0;color:#111;font:800 12px/1.2 Inter,system-ui,sans-serif;white-space:nowrap;box-shadow:0 3px 10px #0006;transition:opacity .35s}
#streetVoiceBubbles div::after{content:"";position:absolute;left:50%;bottom:-6px;margin-left:-6px;border:6px solid transparent;border-bottom:0;border-top-color:#fffffff0}
#streetVoiceBubbles div.angry,#streetVoiceBubbles div.nearmiss{background:#ffe2dcf2;color:#7a0d00}#streetVoiceBubbles div.angry::after,#streetVoiceBubbles div.nearmiss::after{border-top-color:#ffe2dcf2}`;document.head.appendChild(st);return layer;}
function bubble(position,text,mood){const l=ensureLayer();if(!l)return;while(bubbles.length>=3){const b=bubbles.shift();b.el.remove();}const el=document.createElement("div");el.className=mood;el.textContent=text;l.appendChild(el);bubbles.push({el,p:[position[0],position[1],(position[2]||0)+2.05],until:performance.now()+2100});}
function frame(){requestAnimationFrame(frame);if(!bubbles.length)return;const c=camera(),v=document.getElementById("viewport");if(!c||!v)return;const w=v.clientWidth,h=v.clientHeight,now=performance.now();
  for(let i=bubbles.length-1;i>=0;i--){const b=bubbles[i];if(now>b.until){b.el.remove();bubbles.splice(i,1);continue;}tmp.set(b.p[0],b.p[1],b.p[2]).project(c);const vis=tmp.z<1&&Math.abs(tmp.x)<1.1&&Math.abs(tmp.y)<1.1;b.el.style.opacity=vis?(now>b.until-350?"0":"1"):"0";if(vis)b.el.style.transform=`translate(${((tmp.x+1)/2*w).toFixed(1)}px,${((1-tmp.y)/2*h).toFixed(1)}px) translate(-50%,-100%)`;}}
export function installStreetVoices(){if(installed||typeof window==="undefined")return;installed=true;addEventListener(AUDIO_SETTINGS_EVENT,e=>{settings=loadAudioSettings();if(!settings.soundEnabled)try{speechSynthesis?.cancel();}catch{}});try{speechSynthesis?.addEventListener?.("voiceschanged",()=>{deVoice=null;});}catch{}requestAnimationFrame(frame);globalThis.__arondightStreetVoices={honk,shout,version:STREET_VOICES_VERSION};}
installStreetVoices();
