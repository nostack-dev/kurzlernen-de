// Forces between players over the network. A player's body is simulated on his own machine, so a
// push or a pull from someone else travels there: the sender says what happens (a velocity change,
// or "hold at this point" for the gravity gun), the receiver applies it to himself with the same
// physics as everything else, and his replicated pose shows it to everybody.
//
//   push  {dv:[x,y,z] m/s, dmg, src}       — gravity-gun punt
//   hold  {at:<net point>}  every ~100 ms   — gravity-gun grab (stops by itself when packets stop)
import {VS_FX_EVENT} from "./lan_vs.mjs";

export const PLAYER_PUSH_VERSION="net-player-push-v1";
let installed=false,serial=0;
const bridge=()=>globalThis.__arondightRealWorld||null;
const session=()=>{const s=bridge()?.vsSession;return s?.sendFx?s:s?.active?.sendFx?s.active:null;};
function selfId(){try{return String(bridge()?.vsSession?.getSelfId?.()||"");}catch{return"";}}
function send(kind,to,extra){const s=session();if(!s||!to)return false;try{return Boolean(s.sendFx({type:"impact",objectId:"player-push",kind,id:`pp-${Date.now().toString(36)}-${(serial++).toString(36)}`,p:[0,0,0],to:String(to),from:selfId(),...extra},{target:String(to)}));}catch{return false;}}
export function pushMate(id,dv,{damage=0,source="push"}={}){return send("push",id,{dv:dv.map(v=>+(+v).toFixed(3)),dmg:Math.max(0,Math.min(100,Math.round(damage))),src:String(source).slice(0,24)});}
export function holdMate(id,localPoint){const f=globalThis.__arondightVsNetFrame;if(!f)return false;return send("hold",id,{at:f.toNet(localPoint)});}
export function releaseMate(id){return send("release",id,{});}
function onFx(event){const pk=event?.detail?.packet;if(pk?.objectId!=="player-push"||String(pk.to||"")!==selfId())return;const w=globalThis.__arondightWalkMode;if(!w)return;
  if(pk.kind==="push"&&Array.isArray(pk.dv)&&pk.dv.length===3&&pk.dv.every(Number.isFinite)){const dv=pk.dv.map(v=>Math.max(-40,Math.min(40,v)));w.push?.({x:dv[0],y:dv[1],z:dv[2]});if(pk.dmg>0)globalThis.__arondightPlayerDamageModel?.damage?.(pk.dmg,`push:${pk.src||"mate"}`);}
  else if(pk.kind==="hold"&&pk.at){const p=globalThis.__arondightVsNetFrame?.fromNet?.(pk.at);if(p&&p.every(Number.isFinite))w.hold?.(p,350);}
  else if(pk.kind==="release")w.hold?.(null);}
export function installPlayerPush(){if(installed||typeof window==="undefined")return;installed=true;addEventListener(VS_FX_EVENT,onFx);globalThis.__arondightPlayerPush={pushMate,holdMate,releaseMate};}
installPlayerPush();
