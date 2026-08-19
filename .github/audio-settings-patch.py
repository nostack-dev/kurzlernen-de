from pathlib import Path


def replace_once(path, old, new):
    p=Path(path)
    text=p.read_text()
    count=text.count(old)
    if count!=1:
        raise SystemExit(f"{path}: expected exactly one replacement target, found {count}: {old[:120]!r}")
    p.write_text(text.replace(old,new,1))


def write(path, content):
    Path(path).write_text(content)


audio_module='''export const AUDIO_SETTINGS_KEY="arondight45AudioSettingsV1";
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
'''
write('sim/audio_settings.mjs',audio_module)

replace_once('sim/camera_settings.mjs',
'''// Camera settings remain render/optics-only. Flight/control timing is independent\n''',
'''import {mountAudioSettings} from "./audio_settings.mjs";\n\n// Camera settings remain render/optics-only. Flight/control timing is independent\n''')
replace_once('sim/camera_settings.mjs',
'''  let settings=loadCameraSettings();\n  const section=document.createElement("section");''',
'''  let settings=loadCameraSettings();\n  const audio=mountAudioSettings({dialog});\n  const section=document.createElement("section");''')
replace_once('sim/camera_settings.mjs',
'''  return{section,get settings(){return{...settings};},reload(){settings=loadCameraSettings();render();onChange({...settings});return{...settings};}};''',
'''  return{section,audio,get settings(){return{...settings};},reload(){settings=loadCameraSettings();render();onChange({...settings});return{...settings};}};''')

replace_once('sim/motor_sound.mjs',
'''const STATE_ARMED=1;''',
'''import {AUDIO_SETTINGS_EVENT,loadAudioSettings,normalizeAudioSettings,saveAudioSettings} from "./audio_settings.mjs";\n\nconst STATE_ARMED=1;''')
replace_once('sim/motor_sound.mjs',
'''    this.viewport=viewport;this.ctx=null;this.master=null;this.voices=[];this.enabled=localStorage.getItem("arondight45MotorSound")!=="off";this.unlocked=false;this.previousArmRequested=false;this.previousFcState=0;\n    this.viewport.dataset.motorAudioSource="motorOmega+motorTorque+propTorque+tipSpeed:hybridBladeMotor";\n    this.viewport.dataset.motorAudioContextState="uninitialized";this.viewport.dataset.motorAudioArmEvent="idle";this.viewport.dataset.motorAudioEscToneCount="0";''',
'''    const audio=loadAudioSettings();\n    this.viewport=viewport;this.ctx=null;this.master=null;this.voices=[];this.enabled=audio.soundEnabled;this.volume=audio.droneVolume/100;this.unlocked=false;this.previousArmRequested=false;this.previousFcState=0;\n    this.audioSettingsListener=event=>this.applyAudioSettings(event.detail);window.addEventListener(AUDIO_SETTINGS_EVENT,this.audioSettingsListener);\n    this.viewport.dataset.motorAudioSource="motorOmega+motorTorque+propTorque+tipSpeed:hybridBladeMotor";\n    this.viewport.dataset.motorAudioContextState="uninitialized";this.viewport.dataset.motorAudioArmEvent="idle";this.viewport.dataset.motorAudioEscToneCount="0";this.viewport.dataset.motorAudioEnabled=this.enabled?"1":"0";this.viewport.dataset.motorAudioVolumePct=String(audio.droneVolume);''')
replace_once('sim/motor_sound.mjs',
'''  syncState(){this.unlocked=this.isRunning();this.viewport.dataset.motorAudioContextState=this.ctx?.state||"uninitialized";return this.unlocked;}\n  ensure(){''',
'''  syncState(){this.unlocked=this.isRunning();this.viewport.dataset.motorAudioContextState=this.ctx?.state||"uninitialized";return this.unlocked;}\n  applyAudioSettings(value=loadAudioSettings()){const next=normalizeAudioSettings(value);this.enabled=next.soundEnabled;this.volume=next.droneVolume/100;this.viewport.dataset.motorAudioEnabled=this.enabled?"1":"0";this.viewport.dataset.motorAudioVolumePct=String(next.droneVolume);if((!this.enabled||this.volume<=0)&&this.master&&this.ctx)this.master.gain.setTargetAtTime(0,this.ctx.currentTime,.018);this.syncState();return next;}\n  ensure(){''')
replace_once('sim/motor_sound.mjs',
'''  setEnabled(value){this.enabled=Boolean(value);localStorage.setItem("arondight45MotorSound",this.enabled?"on":"off");if(!this.enabled&&this.master&&this.ctx)this.master.gain.setTargetAtTime(0,this.ctx.currentTime,.025);this.syncState();}''',
'''  setEnabled(value){const next=saveAudioSettings({...loadAudioSettings(),soundEnabled:Boolean(value)});this.applyAudioSettings(next);return this.enabled;}\n  setVolume(value){const next=saveAudioSettings({...loadAudioSettings(),droneVolume:Number(value)});this.applyAudioSettings(next);return next.droneVolume;}''')
replace_once('sim/motor_sound.mjs',
'''target=(this.enabled&&running)?.58*distanceGain:0;''',
'''target=(this.enabled&&running)?.58*this.volume*distanceGain:0;''')

replace_once('sim/flight_fire_fx.mjs',
'''import {integrateProjectile,traceProjectileWorldSegment,createProjectileHit} from "./projectile_ballistics.mjs";''',
'''import {integrateProjectile,traceProjectileWorldSegment,createProjectileHit} from "./projectile_ballistics.mjs";\nimport {AUDIO_SETTINGS_EVENT,loadAudioSettings,normalizeAudioSettings} from "./audio_settings.mjs";''')
replace_once('sim/flight_fire_fx.mjs',
'''  let active=null,nextShotAt=0,fireTimer=0,audioCtx=null,noiseBuffer=null;\n\n  function blocked(target)''',
'''  let active=null,nextShotAt=0,fireTimer=0,audioCtx=null,audioMaster=null,noiseBuffer=null,audioSettings=loadAudioSettings();\n  function applyAudioSettings(value=loadAudioSettings()){audioSettings=normalizeAudioSettings(value);viewport.dataset.fireAudioEnabled=audioSettings.soundEnabled?"1":"0";viewport.dataset.fireShotsVolumePct=String(audioSettings.shotsVolume);viewport.dataset.fireFxVolumePct=String(audioSettings.fxVolume);if(audioMaster&&audioCtx)audioMaster.gain.setTargetAtTime(audioSettings.soundEnabled?1:0,audioCtx.currentTime,.012);return audioSettings;}\n  const audioSettingsListener=event=>applyAudioSettings(event.detail);window.addEventListener(AUDIO_SETTINGS_EVENT,audioSettingsListener);applyAudioSettings(audioSettings);\n\n  function blocked(target)''')
replace_once('sim/flight_fire_fx.mjs',
'''  function ensureAudio(){\n    if(audioCtx)return audioCtx;const Ctx=window.AudioContext||window.webkitAudioContext;if(!Ctx)return null;audioCtx=new Ctx();noiseBuffer=audioCtx.createBuffer(1,Math.floor(audioCtx.sampleRate*.045),audioCtx.sampleRate);const data=noiseBuffer.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=(Math.random()*2-1)*(1-i/data.length);return audioCtx;\n  }''',
'''  function ensureAudio(){\n    if(audioCtx)return audioCtx;const Ctx=window.AudioContext||window.webkitAudioContext;if(!Ctx)return null;audioCtx=new Ctx();audioMaster=audioCtx.createGain();audioMaster.gain.value=audioSettings.soundEnabled?1:0;audioMaster.connect(audioCtx.destination);noiseBuffer=audioCtx.createBuffer(1,Math.floor(audioCtx.sampleRate*.045),audioCtx.sampleRate);const data=noiseBuffer.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=(Math.random()*2-1)*(1-i/data.length);return audioCtx;\n  }''')
replace_once('sim/flight_fire_fx.mjs',
'''  function shotSound(){\n    const ctx=ensureAudio();if(!ctx||!noiseBuffer)return;try{if(ctx.state==="suspended")ctx.resume();const t=ctx.currentTime,src=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),noiseGain=ctx.createGain(),thump=ctx.createOscillator(),thumpGain=ctx.createGain(),snap=ctx.createOscillator(),snapGain=ctx.createGain();src.buffer=noiseBuffer;filter.type="bandpass";filter.frequency.setValueAtTime(1700,t);filter.Q.value=.58;noiseGain.gain.setValueAtTime(.13,t);noiseGain.gain.exponentialRampToValueAtTime(.001,t+.052);thump.type="triangle";thump.frequency.setValueAtTime(155,t);thump.frequency.exponentialRampToValueAtTime(78,t+.06);thumpGain.gain.setValueAtTime(.07,t);thumpGain.gain.exponentialRampToValueAtTime(.001,t+.065);snap.type="square";snap.frequency.setValueAtTime(2600,t);snap.frequency.exponentialRampToValueAtTime(1100,t+.026);snapGain.gain.setValueAtTime(.021,t);snapGain.gain.exponentialRampToValueAtTime(.001,t+.032);src.connect(filter).connect(noiseGain).connect(ctx.destination);thump.connect(thumpGain).connect(ctx.destination);snap.connect(snapGain).connect(ctx.destination);src.start(t);src.stop(t+.06);thump.start(t);thump.stop(t+.07);snap.start(t);snap.stop(t+.035);}catch{}\n  }\n  function hitConfirmSound(){const ctx=ensureAudio();if(!ctx)return;try{if(ctx.state==="suspended")ctx.resume();const t=ctx.currentTime,osc=ctx.createOscillator(),gain=ctx.createGain(),tick=ctx.createOscillator(),tickGain=ctx.createGain();osc.type="sine";osc.frequency.setValueAtTime(900,t);osc.frequency.exponentialRampToValueAtTime(1500,t+.052);gain.gain.setValueAtTime(.065,t);gain.gain.exponentialRampToValueAtTime(.001,t+.075);tick.type="triangle";tick.frequency.setValueAtTime(2100,t);tick.frequency.exponentialRampToValueAtTime(1250,t+.035);tickGain.gain.setValueAtTime(.025,t);tickGain.gain.exponentialRampToValueAtTime(.001,t+.045);osc.connect(gain).connect(ctx.destination);tick.connect(tickGain).connect(ctx.destination);osc.start(t);osc.stop(t+.08);tick.start(t);tick.stop(t+.05);}catch{}}\n  function updateCrosshair()''',
'''  function shotSound(){\n    if(!audioSettings.soundEnabled||audioSettings.shotsVolume<=0)return;const level=audioSettings.shotsVolume/100,ctx=ensureAudio();if(!ctx||!noiseBuffer||!audioMaster)return;try{if(ctx.state==="suspended")ctx.resume();const t=ctx.currentTime,src=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),noiseGain=ctx.createGain(),thump=ctx.createOscillator(),thumpGain=ctx.createGain(),snap=ctx.createOscillator(),snapGain=ctx.createGain();src.buffer=noiseBuffer;filter.type="bandpass";filter.frequency.setValueAtTime(1700,t);filter.Q.value=.58;noiseGain.gain.setValueAtTime(.13*level,t);noiseGain.gain.exponentialRampToValueAtTime(.001,t+.052);thump.type="triangle";thump.frequency.setValueAtTime(155,t);thump.frequency.exponentialRampToValueAtTime(78,t+.06);thumpGain.gain.setValueAtTime(.07*level,t);thumpGain.gain.exponentialRampToValueAtTime(.001,t+.065);snap.type="square";snap.frequency.setValueAtTime(2600,t);snap.frequency.exponentialRampToValueAtTime(1100,t+.026);snapGain.gain.setValueAtTime(.021*level,t);snapGain.gain.exponentialRampToValueAtTime(.001,t+.032);src.connect(filter).connect(noiseGain).connect(audioMaster);thump.connect(thumpGain).connect(audioMaster);snap.connect(snapGain).connect(audioMaster);src.start(t);src.stop(t+.06);thump.start(t);thump.stop(t+.07);snap.start(t);snap.stop(t+.035);}catch{}\n  }\n  function hitConfirmSound(){if(!audioSettings.soundEnabled||audioSettings.fxVolume<=0)return;const level=audioSettings.fxVolume/100,ctx=ensureAudio();if(!ctx||!audioMaster)return;try{if(ctx.state==="suspended")ctx.resume();const t=ctx.currentTime,osc=ctx.createOscillator(),gain=ctx.createGain(),tick=ctx.createOscillator(),tickGain=ctx.createGain();osc.type="sine";osc.frequency.setValueAtTime(900,t);osc.frequency.exponentialRampToValueAtTime(1500,t+.052);gain.gain.setValueAtTime(.065*level,t);gain.gain.exponentialRampToValueAtTime(.001,t+.075);tick.type="triangle";tick.frequency.setValueAtTime(2100,t);tick.frequency.exponentialRampToValueAtTime(1250,t+.035);tickGain.gain.setValueAtTime(.025*level,t);tickGain.gain.exponentialRampToValueAtTime(.001,t+.045);osc.connect(gain).connect(audioMaster);tick.connect(tickGain).connect(audioMaster);osc.start(t);osc.stop(t+.08);tick.start(t);tick.stop(t+.05);}catch{}}\n  function damageSound(){if(!audioSettings.soundEnabled||audioSettings.fxVolume<=0)return;const level=audioSettings.fxVolume/100,ctx=ensureAudio();if(!ctx||!audioMaster)return;try{if(ctx.state==="suspended")ctx.resume();const t=ctx.currentTime,osc=ctx.createOscillator(),gain=ctx.createGain();osc.type="triangle";osc.frequency.setValueAtTime(125,t);osc.frequency.exponentialRampToValueAtTime(72,t+.07);gain.gain.setValueAtTime(.045*level,t);gain.gain.exponentialRampToValueAtTime(.001,t+.085);osc.connect(gain).connect(audioMaster);osc.start(t);osc.stop(t+.09);}catch{}}\n  function updateCrosshair()''')
replace_once('sim/flight_fire_fx.mjs',
'''  function damageFeedback(){damageVignette.classList.remove("active");void damageVignette.offsetWidth;damageVignette.classList.add("active");viewport.dataset.combatDamageFx=String((Number(viewport.dataset.combatDamageFx)||0)+1);}''',
'''  function damageFeedback(){damageSound();damageVignette.classList.remove("active");void damageVignette.offsetWidth;damageVignette.classList.add("active");viewport.dataset.combatDamageFx=String((Number(viewport.dataset.combatDamageFx)||0)+1);}''')
replace_once('sim/flight_fire_fx.mjs',
'''window.removeEventListener("arondight:combat-hit-confirm",hitConfirmListener);gamepadCrosshair.remove();''',
'''window.removeEventListener("arondight:combat-hit-confirm",hitConfirmListener);window.removeEventListener(AUDIO_SETTINGS_EVENT,audioSettingsListener);gamepadCrosshair.remove();''')

replace_once('tests/combat_center_fire_browser_smoke.mjs',
'''try{await page.setViewport({width:844,height:390,deviceScaleFactor:1});await page.goto(url.href,{waitUntil:"load",timeout:30000});await page.waitForFunction(()=>document.querySelector("#status")?.textContent?.includes("SIM ready"),{timeout:30000});await page.waitForFunction(()=>document.body.classList.contains("solo-flight")&&document.querySelector("#viewport")?.dataset.fireCrosshairMode==="center-fixed",{timeout:8000});\nconst cross=''',
'''try{await page.setViewport({width:844,height:390,deviceScaleFactor:1});await page.goto(url.href,{waitUntil:"load",timeout:30000});await page.waitForFunction(()=>document.querySelector("#status")?.textContent?.includes("SIM ready"),{timeout:30000});await page.waitForFunction(()=>document.body.classList.contains("solo-flight")&&document.querySelector("#viewport")?.dataset.fireCrosshairMode==="center-fixed",{timeout:8000});\nawait page.click("#soloTopbar .phone-settings-button");await page.waitForFunction(()=>document.querySelector(".phone-settings-dialog")?.open,{timeout:3000});const audioDefaults=await page.evaluate(()=>{const d=document.querySelector(".phone-settings-dialog");return{master:d?.querySelector("[data-audio-enabled]")?.checked,drone:d?.querySelector('[data-audio-slider="drone"]')?.value,shots:d?.querySelector('[data-audio-slider="shots"]')?.value,fx:d?.querySelector('[data-audio-slider="fx"]')?.value};});if(audioDefaults.master!==true||audioDefaults.drone!=="100"||audioDefaults.shots!=="100"||audioDefaults.fx!=="100")throw new Error(`audio menu defaults missing/wrong: ${JSON.stringify(audioDefaults)}`);for(const [name,value] of [["drone","37"],["shots","42"],["fx","58"]])await page.$eval(`.phone-settings-dialog [data-audio-slider="${name}"]`,(e,v)=>{e.value=v;e.dispatchEvent(new Event("input",{bubbles:true}));},value);await page.waitForFunction(()=>{const v=document.querySelector("#viewport"),s=JSON.parse(localStorage.getItem("arondight45AudioSettingsV1")||"{}");return s.droneVolume===37&&s.shotsVolume===42&&s.fxVolume===58&&v?.dataset.motorAudioVolumePct==="37"&&v.dataset.fireShotsVolumePct==="42"&&v.dataset.fireFxVolumePct==="58";},{timeout:3000});await page.click('.phone-settings-dialog [data-audio-enabled]');await page.waitForFunction(()=>{const v=document.querySelector("#viewport");return v?.dataset.motorAudioEnabled==="0"&&v.dataset.fireAudioEnabled==="0";},{timeout:3000});await page.click('.phone-settings-dialog [data-audio-enabled]');for(const name of ["drone","shots","fx"])await page.$eval(`.phone-settings-dialog [data-audio-slider="${name}"]`,e=>{e.value="100";e.dispatchEvent(new Event("input",{bubbles:true}));});await page.waitForFunction(()=>{const v=document.querySelector("#viewport"),s=JSON.parse(localStorage.getItem("arondight45AudioSettingsV1")||"{}");return s.soundEnabled===true&&s.droneVolume===100&&s.shotsVolume===100&&s.fxVolume===100&&v?.dataset.motorAudioEnabled==="1"&&v.dataset.fireAudioEnabled==="1";},{timeout:3000});await page.click('.phone-settings-dialog [data-close]');\nconst cross=''' )
replace_once('tests/combat_center_fire_browser_smoke.mjs',
'''console.log("Combat/camera browser E2E passed: fixed center fire, recoil/hit/damage FX, bounded external visual stabilizer and FPV self-occlusion guard.");''',
'''console.log("Combat/camera browser E2E passed: persistent master/drone/shots/FX audio controls, fixed center fire, recoil/hit/damage FX, bounded external visual stabilizer and FPV self-occlusion guard.");''')

# Remove the executor input files from the product commit. The temporary workflow
# is removed by the GitHub connector after this commit lands, because Actions
# tokens intentionally cannot rewrite workflow files.
for path in ['.github/audio-settings-patch.py','.github/audio-settings-trigger']:
    p=Path(path)
    if p.exists(): p.unlink()

print('audio settings patch applied')
