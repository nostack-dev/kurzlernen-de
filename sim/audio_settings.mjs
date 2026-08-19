export const AUDIO_SETTINGS_KEY="arondight45AudioSettingsV1";
export const AUDIO_SETTINGS_EVENT="arondight45-audio-settings-change";
export const DEFAULT_AUDIO_SETTINGS=Object.freeze({soundEnabled:true,droneVolume:100,shotsVolume:100,fxVolume:100});
const clampPercent=value=>Math.max(0,Math.min(100,Math.round(Number(value)||0)));
export function normalizeAudioSettings(value={}){
  return{
    soundEnabled:value.soundEnabled===undefined?DEFAULT_AUDIO_SETTINGS.soundEnabled:Boolean(value.soundEnabled),
    droneVolume:clampPercent(value.droneVolume??DEFAULT_AUDIO_SETTINGS.droneVolume),
    shotsVolume:clampPercent(value.shotsVolume??DEFAULT_AUDIO_SETTINGS.shotsVolume),
    fxVolume:clampPercent(value.fxVolume??DEFAULT_AUDIO_SETTINGS.fxVolume),
  };
}
export function loadAudioSettings(){
  try{
    const raw=localStorage.getItem(AUDIO_SETTINGS_KEY);
    if(raw)return normalizeAudioSettings(JSON.parse(raw));
    const legacy=localStorage.getItem("arondight45MotorSound");
    return normalizeAudioSettings({...DEFAULT_AUDIO_SETTINGS,soundEnabled:legacy!=="off"});
  }catch{return normalizeAudioSettings(DEFAULT_AUDIO_SETTINGS);}
}
export function saveAudioSettings(settings,{notify=true}={}){
  const next=normalizeAudioSettings(settings);try{localStorage.setItem(AUDIO_SETTINGS_KEY,JSON.stringify(next));localStorage.removeItem("arondight45MotorSound");}catch{}
  if(notify&&typeof window!=="undefined")window.dispatchEvent(new CustomEvent(AUDIO_SETTINGS_EVENT,{detail:{...next}}));
  return next;
}
export function mountAudioSettings({dialog,onChange=()=>{}}={}){
  if(!dialog)throw Error("audio settings dialog required");
  let settings=loadAudioSettings();
  const section=document.createElement("section");section.className="camera-settings-section audio-settings-section";section.dataset.audioSettings="1";
  section.innerHTML=`
    <h4>AUDIO</h4>
    <label class="phone-settings-toggle"><span>SOUND</span><input data-audio-enabled type="checkbox"></label>
    <div class="phone-settings-row"><label>DRONE VOLUME</label><output data-audio-out="drone"></output><input data-audio-slider="drone" type="range" min="0" max="100" step="1"><div class="phone-settings-scale"><span>MUTE</span><span>100%</span></div></div>
    <div class="phone-settings-row"><label>SHOTS VOLUME</label><output data-audio-out="shots"></output><input data-audio-slider="shots" type="range" min="0" max="100" step="1"><div class="phone-settings-scale"><span>MUTE</span><span>100%</span></div></div>
    <div class="phone-settings-row"><label>FX VOLUME</label><output data-audio-out="fx"></output><input data-audio-slider="fx" type="range" min="0" max="100" step="1"><div class="phone-settings-scale"><span>MUTE</span><span>100%</span></div></div>
    <p class="phone-settings-note">SOUND is the master mute. DRONE controls motors + ESC tones, SHOTS controls weapon fire, and FX controls hit-confirm / incoming-hit audio. Visual hit feedback stays active when sound is muted.</p>`;
  const actions=dialog.querySelector(".phone-settings-actions");dialog.insertBefore(section,actions);
  const enabled=section.querySelector("[data-audio-enabled]"),drone=section.querySelector('[data-audio-slider="drone"]'),shots=section.querySelector('[data-audio-slider="shots"]'),fx=section.querySelector('[data-audio-slider="fx"]');
  const droneOut=section.querySelector('[data-audio-out="drone"]'),shotsOut=section.querySelector('[data-audio-out="shots"]'),fxOut=section.querySelector('[data-audio-out="fx"]');
  const render=()=>{enabled.checked=settings.soundEnabled;drone.value=String(settings.droneVolume);shots.value=String(settings.shotsVolume);fx.value=String(settings.fxVolume);droneOut.value=`${settings.droneVolume}%`;shotsOut.value=`${settings.shotsVolume}%`;fxOut.value=`${settings.fxVolume}%`;section.dataset.masterEnabled=settings.soundEnabled?"1":"0";};
  const apply=()=>{settings=saveAudioSettings({soundEnabled:enabled.checked,droneVolume:+drone.value,shotsVolume:+shots.value,fxVolume:+fx.value});render();onChange({...settings});};
  enabled.addEventListener("change",apply);for(const input of [drone,shots,fx])input.addEventListener("input",apply);
  const external=event=>{settings=normalizeAudioSettings(event.detail||loadAudioSettings());render();onChange({...settings});};window.addEventListener(AUDIO_SETTINGS_EVENT,external);
  dialog.addEventListener("close",()=>{settings=loadAudioSettings();render();});
  dialog.querySelector("[data-reset]")?.addEventListener("click",()=>{settings=saveAudioSettings(DEFAULT_AUDIO_SETTINGS);render();onChange({...settings});});
  render();onChange({...settings});
  return{section,get settings(){return{...settings};},reload(){settings=loadAudioSettings();render();onChange({...settings});return{...settings};}};
}
