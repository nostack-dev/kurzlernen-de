import {getSharedCombatAudioContext} from "./combat_audio_bank.mjs";
import {AUDIO_SETTINGS_EVENT,loadAudioSettings,normalizeAudioSettings} from "./audio_settings.mjs";

// Background music on its own track (separate gain bus from every sound
// effect), controlled by the MUSIC toggle + MUSIC VOLUME slider in settings.
// Streams a 128 kbit/s AAC file (the 48 MB source WAV would be far too heavy
// on phones). Web Audio gain is used instead of element.volume because iOS
// ignores HTMLMediaElement.volume.
//
// Reliability: browsers may refuse play() or keep the AudioContext
// suspended until a gesture; the old version tried exactly once and then
// stayed silent. Now every user gesture re-checks and repairs playback, fades
// are scheduled from the current gain (no jumps), and RESET / START restart
// the track from the beginning with a short fade-in.

export const MUSIC_PLAYER_VERSION="separate-music-bus-v2";
// Resolved against the page (the deployed build inlines this module into
// drone_simulator.html, so import.meta.url would not point into sim/).
export const DEFAULT_MUSIC_TRACK=new URL("./sim/audio/8_bits_only.m4a",globalThis.document?.baseURI||"https://kurzlernen.de/").href;
// Music sits clearly under the effects: 100% on the slider is ~45% of full
// scale, and the default slider value is 32%.
const MUSIC_HEADROOM=.45,FADE_S=.9;

let installed=false,element=null,gain=null,context=null,settings=normalizeAudioSettings(loadAudioSettings()),unlocked=false,pauseTimer=0;

function viewport(){return document.getElementById("viewport");}
function wanted(){return settings.musicEnabled&&settings.musicVolume>0&&!document.hidden&&!globalThis.__arondightRadioPlaying;} /* the car radio (car_radio.mjs) takes over while it plays */
function targetLevel(){return wanted()?Math.min(1,settings.musicVolume/100)*MUSIC_HEADROOM:0;}
function setStatus(state){const view=viewport();if(view){view.dataset.musicPlayer=MUSIC_PLAYER_VERSION;view.dataset.musicState=state;view.dataset.musicLevel=targetLevel().toFixed(3);}}

function ensureGraph(){
  if(element)return true;
  context=getSharedCombatAudioContext({resume:true});
  // Adopt the menu's element (already playing since the page loaded).
  element=globalThis.__oppMusicElement||null;
  if(!element){element=new Audio();element.src=DEFAULT_MUSIC_TRACK;element.loop=true;element.preload="auto";element.setAttribute("playsinline","");element.setAttribute("webkit-playsinline","");}
  element.addEventListener("playing",()=>setStatus("playing"));element.addEventListener("pause",()=>setStatus(wanted()?"paused-unexpected":"paused"));
  // Route through a Web Audio gain (iOS ignores element.volume) — but only
  // once the context is running, otherwise rerouting would mute music that
  // is already playing. Until then element.volume is used.
  connectGain();
  return true;
}
function connectGain(){
  // Rerouting a playing element through Web Audio causes an audible drop-out,
  // so the menu element keeps its direct output (element.volume) for good.
  if(gain||!context||context.state!=="running"||!element||element===globalThis.__oppMusicElement)return;
  try{const source=context.createMediaElementSource(element);gain=context.createGain();gain.gain.value=element.paused?0:element.volume;element.volume=1;source.connect(gain).connect(context.destination);}catch{gain=null;}
}
function ramp(level,seconds){
  if(gain&&context){const now=context.currentTime,param=gain.gain;param.cancelScheduledValues(now);param.setValueAtTime(param.value,now);param.linearRampToValueAtTime(level,now+Math.max(.02,seconds));}
  else if(element)element.volume=level;
}
function apply(fade=FADE_S){
  if(!unlocked||!ensureGraph())return;clearTimeout(pauseTimer);connectGain();
  const level=targetLevel();
  if(level>0){
    if(context?.state==="suspended")context.resume?.().catch(()=>{});
    if(element.paused){const p=element.play();p?.catch?.(()=>setStatus("blocked-retry-on-tap"));}
    ramp(level,fade);
  }else{ramp(0,fade);pauseTimer=setTimeout(()=>{if(targetLevel()===0)element.pause();},fade*1000+80);}
  setStatus(level>0?"playing":"muted");
}
// Restart from the top (RESET, START): quick fade out, rewind, fade in.
export function restartMusic(){
  if(!unlocked||!ensureGraph())return;ramp(0,.12);
  setTimeout(()=>{try{element.currentTime=0;}catch{}apply(1.4);},140);
}
// Every gesture is a chance to (re)unlock audio; this is what makes the
// track come back if the browser blocked it once.
function onGesture(){
  unlocked=true;if(!ensureGraph())return;
  if(wanted()&&(element.paused||context?.state!=="running"))apply();
}

export function installMusicPlayer(){
  if(installed)return;installed=true;
  for(const type of["pointerdown","keydown","touchend"])window.addEventListener(type,onGesture,{capture:true,passive:true});
  window.addEventListener("click",event=>{const t=event.target instanceof Element?event.target:null;if(t?.closest?.("#soloReset,#mobileGameplayReset"))restartMusic();},{capture:true,passive:true});
  // START keeps the menu music running (no restart); RESET restarts it.
  window.addEventListener("arondight:game-start",()=>{unlocked=true;apply(.6);});
  window.addEventListener(AUDIO_SETTINGS_EVENT,event=>{settings=normalizeAudioSettings(event?.detail||loadAudioSettings());apply(.35);});
  document.addEventListener("visibilitychange",()=>apply(.4),{passive:true});
  setStatus("waiting-for-gesture");
}
installMusicPlayer();
