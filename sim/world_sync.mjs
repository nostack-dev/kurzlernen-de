import {VS_FX_EVENT} from "./lan_vs.mjs";
import {onDestruction,damageByFeature,setFeatureDamage,commitDestruction} from "./world_destruction_state.mjs";

// Multiplayer world sync over the existing VS fx channel:
//  * NUKE: the dropper sends ground zero as geographic coordinates (lon/lat)
//    plus canonical metres; every peer converts it into its own local frame
//    and runs the full impact locally (cloud, shock front, destruction,
//    crater terrain, sound, shake) — so both players see the same blast at
//    the same real-world spot even when their local map origins differ.
//  * BUILDING DAMAGE: sent per map feature id (identical on every client;
//    the local geometry keys are not). Changes go out right after they
//    happen, and the full state is re-sent every few seconds so a player who
//    joins later converges to the same ruined city.
// Packets use type "impact"/"explosion" (accepted by the transport) with an
// objectId and a "world-sync-*" kind so other fx listeners ignore them.

export const WORLD_SYNC_VERSION="geo-nuke+feature-damage-sync-v1";
const FULL_STATE_MS=5000,MAX_ENTRIES=400;
let installed=false,sent=new Map(),lastFull=-Infinity,applyingRemote=false;

const bridge=()=>globalThis.__arondightRealWorld||null;
const session=()=>{const s=bridge()?.vsSession;return s?.sendFx?s:s?.active?.sendFx?s.active:null;};
const viewport=()=>document.getElementById("viewport");
function setData(key,value){const v=viewport();if(v)v.dataset[key]=String(value);}
function uid(prefix){return`${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;}
function send(packet){const s=session();if(!s)return false;try{return Boolean(s.sendFx(packet));}catch{return false;}}

// ---- nuke
function onLocalNuke(event){
  const d=event?.detail||{};if(d.remote)return;const p=d.position;if(!Array.isArray(p))return;const b=bridge();
  const geo=b?.active&&typeof b.unprojectMeters==="function"?b.unprojectMeters(+p[0],+p[1]):null,id=uid("nuke");
  if(send({type:"explosion",id,objectId:id,kind:"world-sync-nuke",p:[+p[0]||0,+p[1]||0,0],geo:geo?[+geo[0],+geo[1]]:null}))setData("worldSyncNukesSent",(Number(viewport()?.dataset.worldSyncNukesSent)||0)+1);
}
function applyRemoteNuke(packet){
  const b=bridge();let local=null;
  if(b?.active&&Array.isArray(packet.geo)&&packet.geo.every(Number.isFinite)&&typeof b.projectLngLat==="function"){const m=b.projectLngLat(packet.geo[0],packet.geo[1]);local=[m[0],m[1],0];}
  else if(Array.isArray(packet.p))local=[+packet.p[0]||0,+packet.p[1]||0,0];
  if(!local)return;window.dispatchEvent(new CustomEvent("arondight:remote-nuke",{detail:{position:local}}));
  setData("worldSyncNukesReceived",(Number(viewport()?.dataset.worldSyncNukesReceived)||0)+1);
}

// ---- building damage
function snapshot(onlyChanged){
  const entries=[];for(const[id,d]of damageByFeature()){const prev=sent.get(id);if(onlyChanged&&prev&&prev.top<=d.top&&(prev.leveled||!d.leveled))continue;entries.push([id,+d.top.toFixed(2),d.leveled?1:0]);if(entries.length>=MAX_ENTRIES)break;}
  return entries;
}
function sendDamage(onlyChanged){
  if(!session())return;const entries=snapshot(onlyChanged);if(!entries.length)return;
  if(send({type:"impact",id:uid("bdmg"),objectId:"world-sync-damage",kind:"world-sync-damage",p:[0,0,0],damage:entries})){for(const[id,top,leveled]of entries)sent.set(id,{top,leveled:Boolean(leveled)});setData("worldSyncDamageSent",entries.length);}
}
function applyRemoteDamage(packet){
  if(!Array.isArray(packet.damage))return;let changed=false;
  for(const entry of packet.damage){if(!Array.isArray(entry))continue;const[id,top,leveled]=entry;if(typeof id!=="string"||!Number.isFinite(top))continue;if(setFeatureDamage(id,{top,leveled:Boolean(leveled)})){changed=true;sent.set(id,{top,leveled:Boolean(leveled)});}}
  if(changed){applyingRemote=true;try{commitDestruction();}finally{applyingRemote=false;}setData("worldSyncDamageReceived",packet.damage.length);}
}

function onFx(event){const packet=event?.detail?.packet;if(!packet||typeof packet.kind!=="string")return;if(packet.kind==="world-sync-nuke")applyRemoteNuke(packet);else if(packet.kind==="world-sync-damage")applyRemoteDamage(packet);}
function tick(now){if(session()&&now-lastFull>FULL_STATE_MS){lastFull=now;sendDamage(false);}requestAnimationFrame(tick);}

export function installWorldSync(){
  if(installed)return;installed=true;
  window.addEventListener("arondight:nuke-impact",onLocalNuke);
  window.addEventListener(VS_FX_EVENT,onFx);
  onDestruction(()=>{if(!applyingRemote)queueMicrotask(()=>sendDamage(true));});
  window.addEventListener("arondight:world-reset",()=>{sent.clear();});
  setData("worldSync",WORLD_SYNC_VERSION);requestAnimationFrame(tick);
}
installWorldSync();
