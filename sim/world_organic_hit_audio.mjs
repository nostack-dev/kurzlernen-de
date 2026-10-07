import {getSharedCombatAudioContext,playCombatAudio} from "./combat_audio_bank.mjs";
import {loadAudioSettings} from "./audio_settings.mjs";

export const ORGANIC_HIT_AUDIO_VERSION="prebaked-knack-v1";
let installed=false,lastAt=-Infinity;
function viewport(){return document.getElementById("viewport");}
function organic(kind){return ["person","human","animal","bird","life-person"].includes(String(kind||"").toLowerCase());}
function play(kind){
  const now=performance.now();if(now-lastAt<24)return false;lastAt=now;
  const settings=loadAudioSettings();if(settings.soundEnabled===false||Number(settings.fxVolume)<=0)return false;
  const ctx=getSharedCombatAudioContext({resume:true});if(!ctx)return false;
  const rate=kind==="bird"?1.16:kind==="animal" ? .94 : 1;
  const played=playCombatAudio(ctx,"crack",{gain:.34*Math.max(0,Math.min(1,Number(settings.fxVolume||100)/100)),playbackRate:rate,minIntervalMs:20});
  const v=viewport();if(played&&v){v.dataset.organicHitSound=ORGANIC_HIT_AUDIO_VERSION;v.dataset.organicHitSoundEvents=String((Number(v.dataset.organicHitSoundEvents)||0)+1);v.dataset.organicHitSoundLast=String(kind||"organic");}
  return played;
}
function onKill(event){const kind=String(event?.detail?.kind||"");if(organic(kind))play(kind);}
export function installOrganicHitAudio(){if(installed)return;installed=true;addEventListener("arondight:world-kill",onKill);}
installOrganicHitAudio();
