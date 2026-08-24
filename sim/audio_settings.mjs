import "./impact_explosion_overlay.mjs";

export const AUDIO_SETTINGS_KEY="arondight45AudioSettingsV1";
export const AUDIO_SETTINGS_EVENT="arondight45-audio-settings-change";
export const AUDIO_MIX_VERSION=3;
export const DEFAULT_AUDIO_SETTINGS=Object.freeze({soundEnabled:true,droneVolume:50,shotsVolume:82,fxVolume:72,footstepsVolume:30,vehicleVolume:58,ambientVolume:46,mixVersion:AUDIO_MIX_VERSION});
const clampPercent=value=>Math.max(0,Math.min(100,Math.round(Number(value)||0)));
export function normalizeAudioSettings(value={}){
  return{
    soundEnabled:value.soundEnabled===undefined?DEFAULT_AUDIO_SETTINGS.soundEnabled:Boolean(value.soundEnabled),
    droneVolume:clampPercent(value.droneVolume??DEFAULT_AUDIO_SETTINGS.droneVolume),
    shotsVolume:clampPercent(value.shotsVolume??DEFAULT_AUDIO_SETTINGS.shotsVolume),
    fxVolume:clampPercent(value.fxVolume??DEFAULT_AUDIO_SETTINGS.fxVolume),
    footstepsVolume:clampPercent(value.footstepsVolume??DEFAULT_AUDIO_SETTINGS.footstepsVolume),
    vehicleVolume:clampPercent(value.vehicleVolume??DEFAULT_AUDIO_SETTINGS.vehicleVolume),
    ambientVolume:clampPercent(value.ambientVolume??DEFAULT_AUDIO_SETTINGS.ambientVolume),
    mixVersion:AUDIO_MIX_VERSION,
  };
}
function migrateAudioSettings(value={}){
  if(Number(value?.mixVersion)>=AUDIO_MIX_VERSION)return normalizeAudioSettings(value);
  return normalizeAudioSettings({...value,
    droneVolume:value.droneVolume==null?DEFAULT_AUDIO_SETTINGS.droneVolume:Math.min(clampPercent(value.droneVolume),60),
    footstepsVolume:value.footstepsVolume==null?DEFAULT_AUDIO_SETTINGS.footstepsVolume:Math.min(clampPercent(value.footstepsVolume),36),
    vehicleVolume:value.vehicleVolume??DEFAULT_AUDIO_SETTINGS.vehicleVolume,
    ambientVolume:value.ambientVolume??DEFAULT_AUDIO_SETTINGS.ambientVolume,
    mixVersion:AUDIO_MIX_VERSION,
  });
}
export function loadAudioSettings(){
  try{
    const raw=localStorage.getItem(AUDIO_SETTINGS_KEY);
    if(raw){const parsed=JSON.parse(raw),next=migrateAudioSettings(parsed);if(Number(parsed?.mixVersion)!==AUDIO_MIX_VERSION)localStorage.setItem(AUDIO_SETTINGS_KEY,JSON.stringify(next));return next;}
    const legacy=localStorage.getItem("arondight45MotorSound"),next=normalizeAudioSettings({...DEFAULT_AUDIO_SETTINGS,soundEnabled:legacy!=="off"});localStorage.setItem(AUDIO_SETTINGS_KEY,JSON.stringify(next));localStorage.removeItem("arondight45MotorSound");return next;
  }catch{return normalizeAudioSettings(DEFAULT_AUDIO_SETTINGS);}
}
export function saveAudioSettings(settings,{notify=true}={}){
  const next=normalizeAudioSettings(settings);try{localStorage.setItem(AUDIO_SETTINGS_KEY,JSON.stringify(next));localStorage.removeItem("arondight45MotorSound");}catch{}
  if(notify&&typeof window!=="undefined")window.dispatchEvent(new CustomEvent(AUDIO_SETTINGS_EVENT,{detail:{...next}}));
  return next;
}
function slider(label,key){return `<div class="phone-settings-row"><label>${label}</label><output data-audio-out="${key}"></output><input data-audio-slider="${key}" type="range" min="0" max="100" step="1"><div class="phone-settings-scale"><span>MUTE</span><span>100%</span></div></div>`;}
export function mountAudioSettings({dialog,onChange=()=>{}}={}){
  if(!dialog)throw Error("audio settings dialog required");
  let settings=loadAudioSettings();
  const section=document.createElement("section");section.className="camera-settings-section audio-settings-section";section.dataset.audioSettings=String(AUDIO_MIX_VERSION);
  section.innerHTML=`<h4>AUDIO MIXER</h4><label class="phone-settings-toggle"><span>SOUND</span><input data-audio-enabled type="checkbox"></label>${slider("DRONE","drone")}${slider("SHOTS","shots")}${slider("FX / EXPLOSIONS","fx")}${slider("FOOTSTEPS","footsteps")}${slider("VEHICLE","vehicle")}${slider("AMBIENT / OTHER","ambient")}<p class="phone-settings-note">Independent mix. Drone and footsteps are intentionally restrained by default; every category stays adjustable.</p>`;
  const actions=dialog.querySelector(".phone-settings-actions");dialog.insertBefore(section,actions);
  const enabled=section.querySelector("[data-audio-enabled]"),inputs=Object.fromEntries(["drone","shots","fx","footsteps","vehicle","ambient"].map(key=>[key,section.querySelector(`[data-audio-slider="${key}"]`)]));
  const render=()=>{enabled.checked=settings.soundEnabled;for(const[key,input]of Object.entries(inputs)){const prop=`${key}Volume`;input.value=String(settings[prop]);section.querySelector(`[data-audio-out="${key}"]`).value=`${settings[prop]}%`;}section.dataset.masterEnabled=settings.soundEnabled?"1":"0";section.dataset.mixVersion=String(AUDIO_MIX_VERSION);};
  const apply=()=>{settings=saveAudioSettings({soundEnabled:enabled.checked,droneVolume:+inputs.drone.value,shotsVolume:+inputs.shots.value,fxVolume:+inputs.fx.value,footstepsVolume:+inputs.footsteps.value,vehicleVolume:+inputs.vehicle.value,ambientVolume:+inputs.ambient.value});render();onChange({...settings});};
  enabled.addEventListener("change",apply);for(const input of Object.values(inputs))input.addEventListener("input",apply);
  const external=event=>{settings=normalizeAudioSettings(event.detail||loadAudioSettings());render();onChange({...settings});};window.addEventListener(AUDIO_SETTINGS_EVENT,external);
  dialog.addEventListener("close",()=>{settings=loadAudioSettings();render();});dialog.querySelector("[data-reset]")?.addEventListener("click",()=>{settings=saveAudioSettings(DEFAULT_AUDIO_SETTINGS);render();onChange({...settings});});
  render();onChange({...settings});return{section,get settings(){return{...settings};},reload(){settings=loadAudioSettings();render();onChange({...settings});return{...settings};}};
}
