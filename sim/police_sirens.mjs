// Police sirens: the cruisers play a German two-tone horn ("Martinshorn", B♭4 466 Hz / E♭5 622 Hz,
// ~0.65 s per tone), the police drones a soft electronic rising whoop. Both are positional: the
// nearest unit drives one voice each, the level falls off with distance, far sirens lose their top
// (air absorption) and a passing car bends the pitch (Doppler). Deliberately quiet — present in
// the mix, never on top of it — and silent when nobody is chasing, in a menu or with sound off.
import {AUDIO_SETTINGS_EVENT,loadAudioSettings} from "./audio_settings.mjs";
import {getSharedCombatAudioContext} from "./combat_audio_bank.mjs";

export const POLICE_SIRENS_VERSION="police-sirens-v1";
const HORN_LOW=466.16,HORN_HIGH=622.25,HORN_TONE_S=.66;
const CAR_GAIN=.06,DRONE_GAIN=.032,AUDIBLE_M=260,SOUND_MPS=343;
let installed=false,settings=loadAudioSettings(),car=null,drone=null,last=performance.now();
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const bridge=()=>globalThis.__arondightRealWorld||null;
function listener(){const b=bridge(),c=b?.presentedCamera?.()||b?.threeCamera;return c?.position||null;}
function level(){if(!settings.soundEnabled)return 0;return clamp((Number(settings.fxVolume)||0)/72,0,1.4);}

function voice(ctx,kind){
  const out=ctx.createGain();out.gain.value=0;const lp=ctx.createBiquadFilter();lp.type="lowpass";lp.frequency.value=4200;lp.Q.value=.4;lp.connect(out);out.connect(ctx.destination);
  const oscs=[];
  if(kind==="car"){ // a compressor horn: a buzzy fundamental, a bright formant, a hint of second horn detune
    const bp=ctx.createBiquadFilter();bp.type="peaking";bp.frequency.value=1650;bp.Q.value=.9;bp.gain.value=7;bp.connect(lp);
    for(const [type,det,g] of [["sawtooth",0,.5],["square",7,.22],["triangle",-5,.45]]){const o=ctx.createOscillator(),og=ctx.createGain();o.type=type;o.detune.value=det;o.frequency.value=HORN_LOW;og.gain.value=g;o.connect(og).connect(bp);o.start();oscs.push(o);}
  }else{ // drone: clean, airy whoop
    for(const [type,det,g] of [["sine",0,.8],["triangle",4,.35]]){const o=ctx.createOscillator(),og=ctx.createGain();o.type=type;o.detune.value=det;o.frequency.value=900;og.gain.value=g;o.connect(og).connect(lp);o.start();oscs.push(o);}
  }
  return{kind,out,lp,oscs,lastD:null,doppler:1,gain:0};
}
function nearest(points,at){let best=null,bd=Infinity;for(const p of points){const d=Math.hypot(p.x-at.x,p.y-at.y,(p.z||0)-at.z);if(d<bd){bd=d;best=p;}}return best?{p:best,d:bd}:null;}
function cruisers(){const out=[];for(const u of globalThis.__policeGroundUnits?.units||[]){if(!u?.lights||u.state==="wreck"||u.state==="abandoned"||u.state==="leave"||u.car?.group?.userData?.playerDriven)continue;const p=u.pose?.position;if(p)out.push({x:p[0],y:p[1],z:p[2]+.9});}return out;}
function drones(){const out=[];for(const d of globalThis.__arondightWantedSystem?.drones||[]){if(!d?.active||d.retreating||d.empDisabled)continue;const p=d.root?.position;if(p)out.push({x:p.x,y:p.y,z:p.z});}return out;}

function drive(v,target,at,ctx,dt,base,pitchAt){
  const t=ctx.currentTime;let g=0;
  if(target&&target.d<AUDIBLE_M){g=base*level()/(1+(target.d/14)**1.25);
    // Doppler from the change of distance; smoothed so a teleport or a new nearest unit never chirps
    if(v.lastD!=null&&dt>0){const vr=clamp((target.d-v.lastD)/dt,-60,60);v.doppler+=(SOUND_MPS/(SOUND_MPS+vr)-v.doppler)*Math.min(1,dt*4);}v.lastD=target.d;
    v.lp.frequency.setTargetAtTime(clamp(5200-target.d*16,900,5200),t,.08);
  }else v.lastD=null;
  if(document.hidden||globalThis.__arondightPadBlocked?.())g=0;
  v.out.gain.setTargetAtTime(g,t,g>v.gain?.35:.25);v.gain=g;
  const f=pitchAt(t)*v.doppler;for(const o of v.oscs)o.frequency.setTargetAtTime(f,t,v.kind==="car"?.014:.03);
}
// the horn alternates tones; units are not in sync with each other, but one voice keeps its own beat
const hornAt=t=>Math.floor(t/HORN_TONE_S)%2?HORN_HIGH:HORN_LOW;
// whoop: rises 760 → 1480 Hz over 0.7 s with an easing, then a short pause on the low tone
const whoopAt=t=>{const u=(t%1.05)/.7;return u>=1?760:760+720*Math.sin(u*Math.PI/2)**1.4;};

function frame(now=performance.now()){
  requestAnimationFrame(frame);const dt=Math.min(.25,Math.max(0,(now-last)/1000));last=now;
  const at=listener(),cs=at?cruisers():[],ds=at?drones():[];
  if(!cs.length&&!ds.length&&!car&&!drone)return;
  const ctx=getSharedCombatAudioContext();if(!ctx||ctx.state!=="running")return;
  if(cs.length||car){car??=voice(ctx,"car");drive(car,at&&cs.length?nearest(cs,at):null,at,ctx,dt,CAR_GAIN,hornAt);}
  if(ds.length||drone){drone??=voice(ctx,"drone");drive(drone,at&&ds.length?nearest(ds,at):null,at,ctx,dt,DRONE_GAIN,whoopAt);}
  const v=document.getElementById("viewport");if(v){v.dataset.policeSirenCar=car?car.gain.toFixed(4):"0";v.dataset.policeSirenDrone=drone?drone.gain.toFixed(4):"0";}
}
export function installPoliceSirens(){if(installed||typeof window==="undefined")return;installed=true;addEventListener(AUDIO_SETTINGS_EVENT,e=>{settings={...settings,...(e?.detail||loadAudioSettings())};});requestAnimationFrame(frame);globalThis.__policeSirens={version:POLICE_SIRENS_VERSION,get car(){return car?.gain||0;},get drone(){return drone?.gain||0;}};}
installPoliceSirens();
