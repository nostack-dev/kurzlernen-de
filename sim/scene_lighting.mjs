// Real light from the things that glow (on top of the sun/moon, sky and environment light of
// stylized_world_style.mjs). Everything goes through the constant light pool (dynamic_lights.mjs),
// so no shader ever recompiles because a light appears:
//   * at dusk and night the nearest street lamps cast warm sodium light onto street, cars and people,
//   * your car's headlights light the road ahead after dark,
//   * every round you fire flashes the surroundings for a frame or two,
//   * blasts light up the block (bright, fast decay),
//   * a burning jetpack throws orange light on the ground below.
import {requestLight} from "./dynamic_lights.mjs";

export const SCENE_LIGHTING_VERSION="scene-lighting-v1";
const LAMP_LIGHTS=3,LAMP_RANGE_M=70;
let installed=false,flashUntil=0,lastLampPick=0,nearLamps=[];
const blasts=[];
const bridge=()=>globalThis.__arondightRealWorld||null;
function camera(){const b=bridge();return b?.presentedCamera?.()||b?.threeCamera||null;}
function night(){return Number(globalThis.__dayNight?.state?.night)||0;}
function pickLamps(cam,now){if(now-lastLampPick<350)return;lastLampPick=now;const all=globalThis.__streetLamps?.lamps?.()||[],out=[];for(const l of all){if(!l||l.state)continue;const d=Math.hypot(l.hx-cam.position.x,l.hy-cam.position.y);if(d>LAMP_RANGE_M)continue;out.push({l,d});}out.sort((a,b)=>a.d-b.d);nearLamps=out.slice(0,LAMP_LIGHTS).map(e=>e.l);}
function frame(){requestAnimationFrame(frame);const cam=camera();if(!cam)return;const now=performance.now(),n=night(),glow=Math.max(0,Math.min(1,(n-.15)/.5));
  if(glow>.01){pickLamps(cam,now);for(const l of nearLamps)if(!l.state)requestLight([l.hx,l.hy,l.z+5.75],{color:0xffb35a,intensity:46*glow,distance:26});}
  // headlights: a light pool ~7 m ahead of the car the player drives
  const D=globalThis.__arondightVehicleDrive;if(glow>.05&&D?.active){const p=D.pose;if(p?.position){const yaw=Number(p.yaw)||0;requestLight([p.position[0]+Math.cos(yaw)*7,p.position[1]+Math.sin(yaw)*7,p.position[2]+.9],{color:0xfff2d8,intensity:60*glow,distance:22});}}
  // muzzle flash: in front of the eye, for ~60 ms per shot
  if(now<flashUntil){const d=cam.getWorldDirection(cam.position.clone());requestLight([cam.position.x+d.x*.9,cam.position.y+d.y*.9,cam.position.z+d.z*.9-.1],{color:0xffc272,intensity:22,distance:13});}
  // blasts: bright, then a quick fade
  for(let i=blasts.length-1;i>=0;i--){const b=blasts[i],t=(now-b.at)/b.ms;if(t>=1){blasts.splice(i,1);continue;}requestLight(b.p,{color:0xffa04a,intensity:b.peak*(1-t)*(1-t),distance:b.r});}
  // jetpack flame under the player
  const J=globalThis.__arondightJetpack,W=globalThis.__arondightWalkMode;if(J?.thrusting&&W?.position&&W.mode==="foot")requestLight([W.position.x,W.position.y,W.position.z-1.6],{color:0xff8a2a,intensity:14,distance:9});}
function onFired(e){const d=e?.detail||{};if(d.mode!=="foot"||d.weapon==="fists"||d.weapon==="hand-grenade")return;flashUntil=performance.now()+(d.weapon==="sniper"?90:55);}
function onExplosion(e){const d=e?.detail||{},p=d.position;if(!Array.isArray(p))return;const r=Math.max(6,Number(d.radiusM)||8);if(blasts.length>=4)blasts.shift();blasts.push({p:[p[0],p[1],p[2]+1.5],at:performance.now(),ms:420,peak:220+r*18,r:r*4});}
export function installSceneLighting(){if(installed||typeof window==="undefined")return;installed=true;addEventListener("arondight:weapon-fired",onFired);addEventListener("arondight:world-explosion",onExplosion);requestAnimationFrame(frame);globalThis.__arondightSceneLighting={version:SCENE_LIGHTING_VERSION};}
installSceneLighting();
