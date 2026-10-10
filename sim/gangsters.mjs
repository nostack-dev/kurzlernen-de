// Street gangsters (pedestrian_agents.mjs decides who carries what: a few aggressive people carry
// a knife, very few a gun). This module turns their attacks into the world: the pistol shot of a
// gangster (muzzle flash light, tracer, 3-D bang, a hit or a miss that strikes what is behind you)
// and the knife stab (a slash and a dull hit). Other people run from gangster gunfire like from yours.
import * as THREE from "three";
import {requestLight} from "./dynamic_lights.mjs";
import {getSharedCombatAudioContext,playCombatAudio} from "./combat_audio_bank.mjs";

export const GANGSTERS_VERSION="street-gangsters-v1";
const DAMAGE_GUN=10;
let installed=false,root=null;const tracers=[];
const bridge=()=>globalThis.__arondightRealWorld||null;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function cam(){const b=bridge();return b?.presentedCamera?.()||b?.threeCamera||null;}
function ensureRoot(){const scene=bridge()?.threeScene;if(!scene)return null;if(root?.parent===scene)return root;root=new THREE.Group();root.name="GANGSTER_FX";root.userData.flightFireIgnore=true;scene.add(root);tracers.length=0;return root;}
function tracer(from,to){const r=ensureRoot();if(!r)return;let t=tracers.find(x=>!x.mesh.visible);if(!t){if(tracers.length>=8)t=tracers[0];else{const m=new THREE.Mesh(new THREE.CylinderGeometry(.012,.012,1,5,1,true),new THREE.MeshBasicMaterial({color:0xffd27a,transparent:true,opacity:.85,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false}));m.userData.flightFireIgnore=true;m.raycast=()=>{};m.frustumCulled=false;r.add(m);t={mesh:m,until:0};tracers.push(t);}}
  const d=new THREE.Vector3().subVectors(to,from),len=d.length();if(len<.1)return;t.mesh.position.copy(from).addScaledVector(d,.5);t.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());t.mesh.scale.set(1,len,1);t.mesh.visible=true;t.until=performance.now()+70;}
function step(){requestAnimationFrame(step);const now=performance.now();for(const t of tracers)if(t.mesh.visible&&now>t.until)t.mesh.visible=false;}
function audioGain(p,base){const c=cam();const d=c?Math.hypot(p[0]-c.position.x,p[1]-c.position.y,p[2]-c.position.z):20;return clamp(base/(1+d*.06),.03,base);}
function bang(p){try{const ctx=getSharedCombatAudioContext();if(!ctx||ctx.state!=="running")return;playCombatAudio(ctx,"pistol",{gain:audioGain(p,.6),playbackRate:.92+Math.random()*.1,minIntervalMs:25});}catch{}}
// knife: a short airy slash and a dull, wet thud
function stabSound(p){const c=globalThis.__sharedAudioContext;if(!c||c.state!=="running")return;try{const t=c.currentTime,out=c.createGain();out.gain.value=audioGain(p,.7);out.connect(c.destination);
  const n=c.createBuffer(1,c.sampleRate*.22,c.sampleRate),ch=n.getChannelData(0);for(let i=0;i<ch.length;i++)ch[i]=(Math.random()*2-1)*Math.sin(Math.PI*i/ch.length);const s=c.createBufferSource(),bp=c.createBiquadFilter();bp.type="bandpass";bp.Q.value=1.4;bp.frequency.setValueAtTime(1800,t);bp.frequency.exponentialRampToValueAtTime(5200,t+.16);s.buffer=n;s.connect(bp).connect(out);s.start(t);
  const o=c.createOscillator(),g=c.createGain();o.type="sine";o.frequency.setValueAtTime(130,t+.12);o.frequency.exponentialRampToValueAtTime(55,t+.3);g.gain.setValueAtTime(0,t);g.gain.setValueAtTime(.8,t+.12);g.gain.exponentialRampToValueAtTime(.001,t+.34);o.connect(g).connect(out);o.start(t+.1);o.stop(t+.36);}catch{}}
function hurtFlash(){const v=document.getElementById("viewport");if(!v)return;let f=document.getElementById("gangsterHitFlash");if(!f){f=document.createElement("div");f.id="gangsterHitFlash";f.style.cssText="position:absolute;inset:0;pointer-events:none;z-index:9;opacity:0;box-shadow:inset 0 0 120px 30px #b0101a;transition:opacity .4s ease-out";v.appendChild(f);}f.style.transition="none";f.style.opacity=".85";requestAnimationFrame(()=>{f.style.transition="opacity .5s ease-out";f.style.opacity="0";});}
function onShot(e){const d=e?.detail||{},p=d.from,W=globalThis.__arondightWalkMode;if(!Array.isArray(p))return;
  if(d.target){/* a street fight that went too far: he shoots at the other man */const t=d.target,yaw=Number(d.yaw)||0,from=new THREE.Vector3(p[0]+Math.cos(yaw)*.5,p[1]+Math.sin(yaw)*.5,(Number(p[2])||0)+1.42),to=new THREE.Vector3(t.x,t.y,(Number(t.z)||0)+1.1);const hit=Math.random()<.45;if(!hit){to.x+=(Math.random()-.5)*2;to.y+=(Math.random()-.5)*2;}
    tracer(from,to);bang([from.x,from.y,from.z]);requestLight([from.x,from.y,from.z],{color:0xffc272,intensity:18,distance:11});if(hit){globalThis.__arondightProceduralPopulation?.punch?.(t.id,{dir:[to.x-from.x,to.y-from.y,0],damage:70,momentumNs:20});globalThis.__arondightBlood?.([to.x,to.y,to.z]);}
    window.dispatchEvent(new CustomEvent("arondight:gangster-gunfire",{detail:{position:[from.x,from.y,from.z],id:d.id}}));return;}
  if(!W?.position)return;
  const yaw=Number(d.yaw)||0,fx=Math.cos(yaw),fy=Math.sin(yaw),from=new THREE.Vector3(p[0]+fx*.5-fy*.1,p[1]+fy*.5+fx*.1,(Number(p[2])||0)+1.42);
  const aim=new THREE.Vector3(W.position.x,W.position.y,W.position.z-.35),dist=from.distanceTo(aim),speed=Number(d.playerSpeedMps)||0;
  // a street pistol at 6-30 m, fired one-handed at someone who may be moving: often a miss
  const chance=clamp(.52-dist*.014-speed*.045,.08,.48);let to;
  if(Math.random()<chance){to=aim;globalThis.__arondightPlayerDamageModel?.damage?.(DAMAGE_GUN,"gun:pedestrian");window.dispatchEvent(new CustomEvent("arondight:combat-damage",{detail:{damage:DAMAGE_GUN,source:"gun:pedestrian",target:"player"}}));hurtFlash();}
  else{to=new THREE.Vector3(aim.x+(Math.random()-.5)*2.2,aim.y+(Math.random()-.5)*2.2,aim.z+(Math.random()-.55)*1.3);const dir=to.clone().sub(from).normalize();to.copy(from).addScaledVector(dir,dist+8);try{globalThis.__worldImpacts?.bullet?.({origin:from,direction:dir},null,{maxDistance:dist+14});}catch{}}
  tracer(from,to);bang([from.x,from.y,from.z]);requestLight([from.x,from.y,from.z],{color:0xffc272,intensity:18,distance:11});
  window.dispatchEvent(new CustomEvent("arondight:gangster-gunfire",{detail:{position:[from.x,from.y,from.z],id:d.id}}));
  const v=document.getElementById("viewport");if(v)v.dataset.gangsterShots=String((Number(v.dataset.gangsterShots)||0)+1);}
function onStab(e){const at=e?.detail?.at;if(Array.isArray(at)){stabSound(at);hurtFlash();}const v=document.getElementById("viewport");if(v)v.dataset.gangsterStabs=String((Number(v.dataset.gangsterStabs)||0)+1);}
export function installGangsters(){if(installed||typeof window==="undefined")return;installed=true;addEventListener("arondight:pedestrian-shot",onShot);addEventListener("arondight:pedestrian-stab",onStab);requestAnimationFrame(step);globalThis.__arondightGangsters={version:GANGSTERS_VERSION};}
installGangsters();
