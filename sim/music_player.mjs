import {getSharedCombatAudioContext} from "./combat_audio_bank.mjs";
import {AUDIO_SETTINGS_EVENT,loadAudioSettings,normalizeAudioSettings} from "./audio_settings.mjs";

// Background music on its own track (separate gain bus from every sound
// effect), controlled by the MUSIC toggle + MUSIC VOLUME slider in settings.
// Streams a 128 kbit/s AAC file (the 48 MB source WAV would be far too heavy
// on phones). Web Audio gain is used instead of element.volume because iOS
// ignores HTMLMediaElement.volume.

export const MUSIC_PLAYER_VERSION="separate-music-bus-v1";
// Resolved against the page (the deployed build inlines this module into
// drone_simulator.html, so import.meta.url would not point into sim/).
export const DEFAULT_MUSIC_TRACK=new URL("./sim/audio/8_bits_only.m4a",globalThis.document?.baseURI||"https://kurzlernen.de/").href;
// Music sits clearly under the effects: 100% on the slider is still only
// ~45% of full scale, and the default slider value is 32%.
const MUSIC_HEADROOM=.45;
const FADE_S=1.2;

let installed=false,element=null,gain=null,context=null,settings=normalizeAudioSettings(loadAudioSettings()),started=false;

function viewport(){return document.getElementById("viewport");}
function targetLevel(){return settings.soundEnabled&&settings.musicEnabled?Math.max(0,Math.min(1,settings.musicVolume/100))*MUSIC_HEADROOM:0;}
function setStatus(state){const view=viewport();if(view){view.dataset.musicPlayer=MUSIC_PLAYER_VERSION;view.dataset.musicState=state;view.dataset.musicLevel=targetLevel().toFixed(3);}}

function ensureGraph(){
  if(gain)return true;
  context=getSharedCombatAudioContext({resume:true});if(!context)return false;
  element=new Audio();element.src=DEFAULT_MUSIC_TRACK;element.loop=true;element.preload="auto";element.crossOrigin="anonymous";element.setAttribute("playsinline","");
  try{const source=context.createMediaElementSource(element);gain=context.createGain();gain.gain.value=0;source.connect(gain).connect(context.destination);}
  catch{gain=null;element.volume=targetLevel();}
  return true;
}
function applyLevel(fade=FADE_S){
  const level=targetLevel();
  if(gain&&context){const now=context.currentTime;gain.gain.cancelScheduledValues(now);gain.gain.setValueAtTime(gain.gain.value,now);gain.gain.linearRampToValueAtTime(level,now+fade);}
  else if(element)element.volume=level;
  if(!element)return;
  if(level>0&&!document.hidden){if(element.paused)element.play().then(()=>setStatus("playing")).catch(()=>setStatus("blocked"));}
  else{clearTimeout(applyLevel.pauseTimer);applyLevel.pauseTimer=setTimeout(()=>{if(targetLevel()===0||document.hidden){element.pause();setStatus("paused");}},fade*1000+50);}
  setStatus(level>0?"playing":"muted");
}
// Browsers only allow audio after a user gesture: start on the first one.
function start(){
  if(started)return;started=true;
  if(!ensureGraph()){started=false;return;}
  context?.resume?.().catch(()=>{});applyLevel();
}

export function installMusicPlayer(){
  if(installed)return;installed=true;
  for(const type of["pointerdown","keydown","touchend"])window.addEventListener(type,start,{capture:true,passive:true});
  window.addEventListener(AUDIO_SETTINGS_EVENT,event=>{settings=normalizeAudioSettings(event?.detail||loadAudioSettings());if(started)applyLevel(.35);else setStatus("waiting-for-gesture");});
  document.addEventListener("visibilitychange",()=>{if(started)applyLevel(.4);},{passive:true});
  setStatus("waiting-for-gesture");
}
installMusicPlayer();
