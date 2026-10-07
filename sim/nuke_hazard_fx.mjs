import {getSharedCombatAudioContext} from "./combat_audio_bank.mjs";
import {actorRoots} from "./world_actor_roots.mjs";
import {AUDIO_SETTINGS_EVENT,loadAudioSettings,normalizeAudioSettings} from "./audio_settings.mjs";

// What it feels like to be near ground zero after the bang:
//  * aftershock camera shakes ride on the rolling rumble/crackle,
//  * "hellfire" proximity: the closer to ground zero, the stronger a burning
//    vignette, rising embers and a constant tremor — the drone can still fly
//    through, a pilot on foot gets burned,
//  * Geiger counter: quiet clicks whose rate follows the local dose rate, and
//    a minimal ☢ chip in the vitals HUD. The drone is largely immune.

export const NUKE_HAZARD_VERSION="aftershock+hellfire+geiger-v1";
const HELL_RADIUS_M=290,RAD_CORE_M=160,RAD_TAU_S=420,HEAT_HOLD_S=35,HEAT_TAU_S=150;
const zones=[];let installed=false,settings=normalizeAudioSettings(loadAudioSettings()),overlay=null,embers=null,ectx=null,chip=null,clickCtx=null,lastFrame=performance.now(),emberList=[];

const viewport=()=>document.getElementById("viewport");
const bridge=()=>globalThis.__arondightRealWorld||null;
const walk=()=>globalThis.__arondightWalkMode||null;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number(v)||0));
function onFoot(){return walk()?.mode==="foot"&&!globalThis.__arondightVehicleDrive?.active;}
function listener(){const w=walk();if(onFoot()&&w?.position)return{x:+w.position.x||0,y:+w.position.y||0};const c=bridge()?.threeCamera;return c?{x:c.position.x,y:c.position.y}:null;}

// -------- shake (same compositor-only transform as the main blast shake)
function shake(strength,duration=520){
  const targets=[bridge()?.threeRenderer?.domElement||viewport()?.querySelector("canvas"),document.getElementById("geoViewport")].filter(el=>el?.animate),px=2+9*strength;
  for(const el of targets){if(el.getAnimations?.().some(a=>a.id==="nuke-shake"&&a.playState==="running"))continue;const a=el.animate([{transform:"translate3d(0,0,0)"},{transform:`translate3d(${px}px,${-px*.5}px,0)`,offset:.2},{transform:`translate3d(${-px*.8}px,${px*.4}px,0)`,offset:.45},{transform:`translate3d(${px*.4}px,${px*.3}px,0)`,offset:.7},{transform:"translate3d(0,0,0)"}],{duration,easing:"ease-out"});a.id="nuke-aftershock";}
}
function onArrival(event){const s=clamp(event?.detail?.strength,.1,1);[[1900,.42],[3050,.3],[4450,.22],[6150,.15],[8300,.1]].forEach(([ms,k])=>setTimeout(()=>shake(s*k+.04,420+300*k),ms));}

// ---------------------------------------------------------- dose / heat
function fields(now){
  const p=listener();if(!p||!zones.length)return{heat:0,dose:0};let heat=0,dose=0;
  for(const z of zones){const age=(now-z.born)/1000,d=Math.hypot(p.x-z.x,p.y-z.y);
    const heatAge=age<HEAT_HOLD_S?1:.35+.65*Math.exp(-(age-HEAT_HOLD_S)/HEAT_TAU_S);heat=Math.max(heat,heatAge*clamp(1-d/HELL_RADIUS_M,0,1)**1.4);
    dose+=900*Math.exp(-age/RAD_TAU_S)/(1+(d/RAD_CORE_M)**2);}
  return{heat,dose};
}

// ------------------------------------------------------------ overlays
function ensureOverlay(){
  const view=viewport();if(!view)return false;if(overlay?.isConnected)return true;
  overlay=document.createElement("i");overlay.id="nukeHellfireOverlay";overlay.setAttribute("aria-hidden","true");
  overlay.style.cssText="position:absolute;inset:0;z-index:78;pointer-events:none;opacity:0;border:3px solid #ff2d55;box-sizing:border-box;will-change:opacity";
  embers=document.createElement("canvas");embers.id="nukeEmberOverlay";embers.setAttribute("aria-hidden","true");embers.style.cssText="position:absolute;inset:0;width:100%;height:100%;z-index:79;pointer-events:none";
  view.append(overlay,embers);ectx=embers.getContext("2d");return true;
}
function drawEmbers(heat,dt){
  if(!ectx)return;const w=embers.clientWidth|0,h=embers.clientHeight|0;if(!w||!h)return;const scale=.5;if(embers.width!==Math.round(w*scale)){embers.width=Math.round(w*scale);embers.height=Math.round(h*scale);}
  const W=embers.width,H=embers.height;ectx.clearRect(0,0,W,H);if(heat<.03&&!emberList.length)return;
  const want=Math.round(70*heat);while(emberList.length<want)emberList.push({x:Math.random()*W,y:H+Math.random()*H*.3,v:20+Math.random()*60,r:.6+Math.random()*1.8,life:1});
  ectx.globalCompositeOperation="lighter";
  for(let i=emberList.length-1;i>=0;i--){const e=emberList[i];e.y-=e.v*dt;e.x+=Math.sin(e.y*.05)*12*dt;e.life-=dt*.35;if(e.y<-5||e.life<=0||emberList.length>want+5){emberList.splice(i,1);continue;}
    ectx.fillStyle=`rgba(255,${120+Math.random()*80|0},30,${.35+.5*e.life})`;ectx.beginPath();ectx.arc(e.x,e.y,e.r,0,6.283);ectx.fill();}
}
function ensureChip(){
  if(chip?.isConnected)return chip;const host=document.getElementById("playerVitalsHud")||viewport();if(!host)return null;
  chip=document.createElement("span");chip.id="geigerChip";chip.setAttribute("aria-label","Radiation level");
  chip.style.cssText="display:inline-flex;align-items:center;gap:4px;margin-left:8px;font:800 9px ui-monospace,Menlo,monospace;letter-spacing:.06em;color:#b6ff3d;opacity:0;transition:opacity .4s";
  chip.innerHTML='<b style="font-size:11px">☢</b><i style="display:inline-block;width:34px;height:4px;border-radius:2px;background:#1f3a24;overflow:hidden"><i data-bar style="display:block;height:100%;width:0;background:#b6ff3d"></i></i><span data-cps>0</span>';
  host.appendChild(chip);return chip;
}

// ------------------------------------------------------------- geiger
// Realistic Geiger–Müller clicks: each discharge is a sharp asymmetric
// spike that rings the small speaker cone (~1.6–2.4 kHz, ~4 ms) with a faint
// low body thump. Several variants, random level and pitch, scheduled on the
// audio clock (not per video frame) with the tube's dead time, so high rates
// turn into the familiar irregular crackle instead of a robotic buzz.
let clickVariants=null,nextClickTime=0,geigerBus=null;
function buildClicks(ctx){
  const rate=ctx.sampleRate,variants=[];
  for(let v=0;v<5;v++){const n=Math.round(rate*.012),buf=ctx.createBuffer(1,n,rate),d=buf.getChannelData(0),ring=1600+v*190+Math.random()*120,decay=900+v*120;
    for(let i=0;i<n;i++){const t=i/rate;const spike=t<.00025?1-t/.00025:0;d[i]=spike*.9+Math.sin(2*Math.PI*ring*t)*Math.exp(-t*decay)*.55+Math.sin(2*Math.PI*(380+v*25)*t)*Math.exp(-t*420)*.18+(Math.random()*2-1)*Math.exp(-t*3000)*.25;}
    variants.push(buf);}
  return variants;
}
function scheduleClicks(cps){
  if(!settings.soundEnabled||settings.fxVolume<=0||cps<=.2)return;const ctx=getSharedCombatAudioContext();if(!ctx||ctx.state!=="running")return;
  if(clickCtx!==ctx){clickCtx=ctx;clickVariants=buildClicks(ctx);geigerBus=ctx.createBiquadFilter();geigerBus.type="highpass";geigerBus.frequency.value=220;geigerBus.connect(ctx.destination);nextClickTime=ctx.currentTime;}
  const horizon=ctx.currentTime+.12,level=(.06+.05*Math.min(1,cps/30))*settings.fxVolume/100;if(nextClickTime<ctx.currentTime)nextClickTime=ctx.currentTime+Math.random()*.02;
  while(nextClickTime<horizon){
    const src=ctx.createBufferSource(),amp=ctx.createGain();src.buffer=clickVariants[(Math.random()*clickVariants.length)|0];src.playbackRate.value=.94+Math.random()*.12;amp.gain.value=level*(.6+Math.random()*.4);
    src.connect(amp).connect(geigerBus);src.onended=()=>{try{src.disconnect();amp.disconnect();}catch{}};src.start(nextClickTime);
    nextClickTime+=Math.max(.0025,-Math.log(1-Math.random())/cps);
  }
}

function frame(now){
  const dt=clamp((now-lastFrame)/1000,0,.1);lastFrame=now;
  if(zones.length){
    const{heat,dose}=fields(now),foot=onFoot();
    if(ensureOverlay()){const flicker=.86+.14*Math.sin(now*.017)*Math.sin(now*.0053);overlay.style.opacity=String((heat*.8*flicker).toFixed(3));drawEmbers(heat,dt);}
    if(heat>.45&&Math.random()<dt*2.2*heat)shake(.12+.35*heat,260);
        const cps=Math.min(80,dose*.06);scheduleClicks(cps);
    const c=ensureChip();if(c){c.style.opacity=cps>.4?"1":"0";const bar=c.querySelector("[data-bar]"),label=c.querySelector("[data-cps]");if(bar){bar.style.width=`${Math.min(100,cps/55*100).toFixed(0)}%`;bar.style.background=cps>25?"#ff2a4d":cps>8?"#ffb020":"#b6ff3d";}if(label)label.textContent=`${cps.toFixed(cps<10?1:0)}`;}
    // Damage: pilot on foot burns and gets irradiated; the drone is largely immune.
    const vitals=globalThis.__arondightPlayerVitals;if(foot&&dt>0&&!globalThis.__arondightPlayerShield?.nukeImmune?.()){const dps=heat>.2?28*heat*heat:0,rad=Math.min(6,dose*.004);if(dps+rad>.05)vitals?.player?.damage?.((dps+rad)*dt,"nuke:hazard");}
    const v=viewport();if(v){const h=heat.toFixed(2),r=cps.toFixed(1);if(v.dataset.nukeHellfire!==h)v.dataset.nukeHellfire=h;if(v.dataset.geigerCps!==r)v.dataset.geigerCps=r;}
  }
  requestAnimationFrame(frame);
}
// Panic: people inside the fallout zone run away from ground zero. Applied in
// the pre-render hook (after every population update) as an accumulated
// offset, so it works whether or not their own module rewrites positions.
const PANIC_RADIUS_M=900,PANIC_S=45,RUN_MPS=6.5;let panicRoots=[],panicScan=-Infinity,panicFrame=performance.now();
function panic(scene){
  const now=performance.now(),dt=Math.min(.1,(now-panicFrame)/1000);panicFrame=now;const zone=zones.at(-1);if(!zone||(now-zone.born)/1000>PANIC_S||!scene)return;
  if(now-panicScan>1000){panicScan=now;panicRoots=[...actorRoots(scene).values()].filter(a=>a.kind==="person").map(a=>a.root);}
  for(const r of panicRoots){if(!r.parent||r.visible===false)continue;const u=r.userData,p=r.position;
    const fresh=!u.panicLast||Math.abs(p.x-u.panicLast.x)>1e-6||Math.abs(p.y-u.panicLast.y)>1e-6;const ox=u.panicOffset?.x||0,oy=u.panicOffset?.y||0;
    const bx=fresh?p.x:p.x-ox,by=fresh?p.y:p.y-oy,dx=bx+ox-zone.x,dy=by+oy-zone.y,d=Math.hypot(dx,dy);if(d>PANIC_RADIUS_M&&!u.panicOffset)continue;
    const step=RUN_MPS*dt*(d<PANIC_RADIUS_M?1:0),nx=d>1e-3?dx/d:1,ny=d>1e-3?dy/d:0;u.panicOffset={x:ox+nx*step,y:oy+ny*step};
    p.x=bx+u.panicOffset.x;p.y=by+u.panicOffset.y;r.rotation.z=Math.atan2(-nx,ny);u.panicLast={x:p.x,y:p.y};}
}
export function installNukeHazardFx(){
  if(installed)return;installed=true;
  window.addEventListener("arondight:nuke-impact",e=>{const p=e?.detail?.position;if(Array.isArray(p))zones.push({x:+p[0]||0,y:+p[1]||0,born:performance.now()});while(zones.length>4)zones.shift();});
  window.addEventListener("arondight:nuke-shockwave-arrival",onArrival);
  const attach=()=>{const b=bridge();if(typeof b?.addPreRenderHook!=="function")return requestAnimationFrame(attach);b.addPreRenderHook(scene=>panic(scene));};attach();
  window.addEventListener("arondight:world-reset",()=>{zones.length=0;for(const r of panicRoots){if(r.userData.panicOffset){r.position.x-=r.userData.panicOffset.x;r.position.y-=r.userData.panicOffset.y;delete r.userData.panicOffset;delete r.userData.panicLast;}}panicRoots=[];emberList.length=0;if(overlay)overlay.style.opacity="0";ectx?.clearRect(0,0,embers.width,embers.height);if(chip)chip.style.opacity="0";});
  window.addEventListener(AUDIO_SETTINGS_EVENT,e=>{settings=normalizeAudioSettings(e?.detail||loadAudioSettings());});
  const v=viewport();if(v)v.dataset.nukeHazard=NUKE_HAZARD_VERSION;requestAnimationFrame(frame);
}
installNukeHazardFx();
