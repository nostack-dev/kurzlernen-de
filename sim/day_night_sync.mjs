// One time of day for everybody in a multiplayer session: the session authority (vs_multiplayer.mjs)
// sends its day/night phase every few seconds and right when a mate joins; the others follow it
// (a small drift is eased out, a big one jumps). Alone, nothing changes.
import {VS_FX_EVENT,VS_PEER_EVENT} from "./lan_vs.mjs";
export const DAY_NIGHT_SYNC_VERSION="authority-phase-v1";
const SEND_MS=4000;let installed=false,lastSent=-Infinity,serial=0;
const bridge=()=>globalThis.__arondightRealWorld||null;
const session=()=>{const s=bridge()?.vsSession;return s?.sendFx?s:s?.active?.sendFx?s.active:null;};
function amAuthority(){const mp=globalThis.__arondightVsMultiplayer;return Boolean(mp?.connected&&mp.authority&&mp.authority===mp.self);}
function send(){const s=session(),dn=globalThis.__dayNight;if(!s||!dn?.state)return;try{s.sendFx({type:"impact",objectId:"day-night",kind:"world-sync-day-night",id:`dn-${Date.now().toString(36)}-${(serial++).toString(36)}`,p:[0,0,0],phase:+dn.state.phase.toFixed(5)});}catch{}}
function onFx(e){const pk=e?.detail?.packet;if(pk?.objectId!=="day-night"||!Number.isFinite(pk.phase)||amAuthority())return;const dn=globalThis.__dayNight;if(!dn?.state)return;
  let d=pk.phase-dn.state.phase;d-=Math.round(d);if(Math.abs(d)<.0005)return;dn.skipTo?.(dn.state.phase+(Math.abs(d)<.01?d*.5:d));const v=document.getElementById("viewport");if(v)v.dataset.dayNightSync=`follow:${pk.phase.toFixed(3)}`;}
function tick(){const now=performance.now();if(amAuthority()&&now-lastSent>SEND_MS){lastSent=now;send();}setTimeout(tick,1000);}
export function installDayNightSync(){if(installed||typeof window==="undefined")return;installed=true;addEventListener(VS_FX_EVENT,onFx);addEventListener(VS_PEER_EVENT,ev=>{if(ev?.detail?.type==="join")lastSent=-Infinity;});tick();}
installDayNightSync();
