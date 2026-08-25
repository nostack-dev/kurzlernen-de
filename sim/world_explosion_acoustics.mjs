import {AUDIO_SETTINGS_EVENT,loadAudioSettings,normalizeAudioSettings} from "./audio_settings.mjs";
import {getSharedCombatAudioContext,playCombatAudio} from "./combat_audio_bank.mjs";

const FAR_FIELD_START_M=24;
const FAR_FIELD_REFERENCE_M=115;
const FAR_FIELD_MAX_M=520;
let installed=false,settings=loadAudioSettings();

function viewport(){return document.getElementById("viewport");}
function bridge(){return globalThis.__arondightRealWorld||null;}
function walk(){return globalThis.__arondightWalkMode||null;}
function drive(){return globalThis.__arondightVehicleDrive||null;}
function clamp(value,min,max){return Math.max(min,Math.min(max,Number(value)||0));}
function listener(){const car=drive()?.cameraAnchor;if(drive()?.active&&car)return car;const w=walk();if(w?.mode==="foot"&&w.position)return w.position;return bridge()?.threeCamera?.position||null;}
function distanceTo(position){const l=listener(),p=Array.isArray(position)?position:null;if(!l||!p||p.length<3)return 0;return Math.hypot((Number(p[0])||0)-(Number(l.x)||0),(Number(p[1])||0)-(Number(l.y)||0),(Number(p[2])||0)-(Number(l.z)||0));}
function farGain(distance){if(distance<FAR_FIELD_START_M||distance>FAR_FIELD_MAX_M)return 0;const normalized=Math.max(.01,distance/FAR_FIELD_REFERENCE_M);return clamp(.31/Math.pow(normalized,.82),.045,.34);}
function onExplosion(event){
  const detail=event?.detail||{},position=detail.position,d=distanceTo(position),gain=farGain(d)*clamp(settings.fxVolume??100,0,100)/100;if(!settings.soundEnabled||gain<=0)return;
  const ctx=getSharedCombatAudioContext({resume:true});if(!ctx)return;const delayMs=clamp(d/343*1000,0,850),play=()=>{const played=playCombatAudio(ctx,"explosion",{gain,playbackRate:.84,minIntervalMs:0}),v=viewport();if(v){v.dataset.explosionFarField="inverse-power-air-propagation-v1";v.dataset.explosionFarDistanceM=d.toFixed(1);v.dataset.explosionFarGain=gain.toFixed(3);if(played)v.dataset.explosionFarSounds=String((Number(v.dataset.explosionFarSounds)||0)+1);}};if(delayMs>18)setTimeout(play,delayMs);else play();
}
export function installWorldExplosionAcoustics(){if(installed)return;installed=true;addEventListener("arondight:world-explosion",onExplosion);addEventListener(AUDIO_SETTINGS_EVENT,event=>{settings=normalizeAudioSettings(event.detail||loadAudioSettings());});const v=viewport();if(v){v.dataset.explosionAcoustics="near+far-field-v1";v.dataset.explosionFarFieldStartM=String(FAR_FIELD_START_M);v.dataset.explosionFarFieldMaxM=String(FAR_FIELD_MAX_M);}}
installWorldExplosionAcoustics();
