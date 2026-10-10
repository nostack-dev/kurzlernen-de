// The game rules of a multiplayer session (drone nuke, launcher nuke) are the host's: the
// session authority sends its switches every few seconds, right when a mate joins and whenever
// it flips one; everybody else plays by them (world_options.mjs worldRule()). Leaving the
// session gives you your own switches back. Alone, nothing is sent.
import {VS_FX_EVENT,VS_PEER_EVENT} from "./lan_vs.mjs";
import {GAME_RULE_KEYS,worldOption,setHostRules,hostRulesActive,WORLD_OPTIONS_EVENT} from "./world_options.mjs";
export const GAME_RULES_SYNC_VERSION="host-rules-v1";
const SEND_MS=4000;let installed=false,lastSent=-Infinity,serial=0,lastHostAt=0;
const bridge=()=>globalThis.__arondightRealWorld||null;
const session=()=>{const s=bridge()?.vsSession;return s?.sendFx?s:s?.active?.sendFx?s.active:null;};
function mp(){return globalThis.__arondightVsMultiplayer||null;}
function amAuthority(){const m=mp();return Boolean(m?.connected&&m.authority&&m.authority===m.self);}
function ownRules(){return Object.fromEntries(GAME_RULE_KEYS.map(k=>[k,worldOption(k)]));}
function send(){const s=session();if(!s)return;try{s.sendFx({type:"impact",objectId:"game-rules",kind:"world-sync-rules",id:`gr-${Date.now().toString(36)}-${(serial++).toString(36)}`,p:[0,0,0],rules:ownRules()});}catch{}}
function onFx(e){const pk=e?.detail?.packet;if(pk?.objectId!=="game-rules"||!pk.rules||amAuthority())return;lastHostAt=performance.now();setHostRules(pk.rules);const v=document.getElementById("viewport");if(v)v.dataset.gameRules=`host:${GAME_RULE_KEYS.map(k=>`${k}=${pk.rules[k]?1:0}`).join(",")}`;}
function tick(){const now=performance.now(),m=mp();
  if(amAuthority()){if(hostRulesActive())setHostRules(null);if(now-lastSent>SEND_MS){lastSent=now;send();}}
  // out of the session (or the host went quiet for long): own rules again
  else if(hostRulesActive()&&(!m?.connected||now-lastHostAt>20000)){setHostRules(null);const v=document.getElementById("viewport");if(v)v.dataset.gameRules="own";}
  setTimeout(tick,1000);}
export function installGameRulesSync(){if(installed||typeof window==="undefined")return;installed=true;addEventListener(VS_FX_EVENT,onFx);addEventListener(VS_PEER_EVENT,ev=>{if(ev?.detail?.type==="join")lastSent=-Infinity;});addEventListener(WORLD_OPTIONS_EVENT,ev=>{if(GAME_RULE_KEYS.includes(ev?.detail?.key)&&amAuthority()){lastSent=performance.now();send();}});tick();}
installGameRulesSync();
