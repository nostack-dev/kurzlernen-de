import {clearDestruction} from "./world_destruction_state.mjs";

// One owner for the RESET buttons (#soloReset in the top bar, the mobile dock
// #mobileGameplayReset):
//  * single player: full reset — sim, vitals, music (own hooks) and the
//    world: nuked buildings are rebuilt, craters/debris/hazards cleared;
//  * multiplayer, alone in the map: the same full reset;
//  * multiplayer with others: a vote. Everybody else is asked; one "no" (or
//    no answer within 15 s) cancels, all "yes" resets the whole level for
//    everybody at once. Players respawn around the requester's position, each
//    in its own ring slot (spread out, never on top of each other); the spawn
//    guard keeps them out of walls and above ground.
// Only real user clicks are handled; programmatic .click() calls from other
// modules (death respawn, mobile dock forwarding) pass straight through.

export const GAME_RESET_VERSION="mp-vote-full-reset-v3-start-point";
import {VS_FX_EVENT} from "./lan_vs.mjs";
const VOTE_MS=15000,SLOT_R=7;let vote=null,serial=0;
const SP_COOLDOWN_MS=1200,MP_COOLDOWN_MS=6000,SELECTOR="#soloReset,#mobileGameplayReset";
let installed=false,lastResetAt=-Infinity;

const viewport=()=>document.getElementById("viewport");
const bridge=()=>globalThis.__arondightRealWorld||null;
function session(){const s=bridge()?.vsSession;return s&&s.active!==false?s:null;}
function peers(){const s=session();if(!s)return[];try{return(s.getPeerIds?.()||[]).map(String);}catch{return[];}}
function selfId(){try{return String(session()?.getSelfId?.()||"");}catch{return"";}}
function multiplayer(){return peers().length>0;}
function send(extra){const s=session();if(!s?.sendFx)return false;try{return s.sendFx({type:"impact",objectId:"reset-vote",p:[0,0,0],id:`rv-${Date.now().toString(36)}-${(serial++).toString(36)}`,playerId:selfId()||undefined,...extra});}catch{return false;}}
function fullLocalReset(){clearDestruction();window.dispatchEvent(new CustomEvent("arondight:world-reset"));window.dispatchEvent(new CustomEvent("arondight:game-reset",{detail:{multiplayer:false}}));}
// everybody resets the world, then respawns in its slot around the meeting point
// Back to the start: the start mode (on foot, pistol) at this player's start
// point. Alone, the world origin itself goes back to the start (GPS / chosen
// place), so that is local (0,0). In a shared session the frame is the shared
// origin: the start point is placed inside it, each player in its own ring
// slot so nobody stands on anybody; the first free spot outside buildings.
// Place the player (on foot, start mode) at local (x,y) — the first free spot
// near it — and park the drone with it. Runs after the reset chain (sim reset,
// vitals, walker re-anchoring) has finished.
function spawnAt(bx,by,{slot=0,n=1,startMode=true}={}){
  let frames=0;const run=()=>{if(++frames<4){requestAnimationFrame(run);return;}
    const w=globalThis.__arondightWalkMode;if(startMode&&typeof globalThis.__arondightApplyStartMode==="function")globalThis.__arondightApplyStartMode();else if(w?.mode!=="foot")w?.setMode?.("foot",{persist:false,reason:"respawn"});
    if(w?.mode!=="foot"||!w.setPose)return;const a=slot/Math.max(1,n)*Math.PI*2+.4,r=slot===0?0:SLOT_R+(slot>5?SLOT_R:0),cx=bx+Math.cos(a)*r,cy=by+Math.sin(a)*r;let x=cx,y=cy;
    if(n>1){let found=false;for(let k=0;k<80;k++){const rr=k===0?r:5+(k%11),aa=k===0?a:a+k*2.399963229728653;const tx=bx+Math.cos(aa)*rr,ty=by+Math.sin(aa)*rr;if(!w.canWalkTo||w.canWalkTo(tx,ty)){x=tx;y=ty;found=true;break;}}if(!found){setData("gameResetSpawn","blocked-5-15m");return;}}
    else for(let k=0;k<48&&w.canWalkTo&&!w.canWalkTo(x,y);k++){const aa=k*2.399,rr=1.5+k*.9;x=cx+Math.cos(aa)*rr;y=cy+Math.sin(aa)*rr;}
    w.setPose({x,y,yaw:Number(w.yaw)||0,pitch:0});globalThis.__arondightPlayerVehicleRuntime?.teleportDrone?.({x,y,yaw:Number(w.yaw)||0});
    setData("gameResetSpawn",`${x.toFixed(1)},${y.toFixed(1)}`);};
  requestAnimationFrame(run);
}
globalThis.__arondightSpawnAt=spawnAt;
function spawnAtStart(slot=0,n=1){const base=bridge()?.startPointLocal?.()||[0,0];spawnAt(base[0],base[1],{slot,n});}
function commitReset(meet,order){
  const ids=(order||[]).map(String),me=selfId(),slot=Math.max(0,ids.indexOf(me)),n=Math.max(1,ids.length);
  const b=bridge(),geo=Array.isArray(meet)&&meet.length===2&&meet.every(Number.isFinite)&&b?.active&&Number.isFinite(b.originLon)&&Number.isFinite(b.originLat);
  let base=null;
  if(geo){const R=6378137,lat=b.originLat*Math.PI/180;base=[(meet[0]-b.originLon)*Math.PI/180*R*Math.max(.01,Math.cos(lat)),(meet[1]-b.originLat)*Math.PI/180*R];}
  else if(Array.isArray(meet?.p)&&meet.p.length>=2&&meet.p.slice(0,2).every(Number.isFinite)&&(!meet.f||meet.f===String(viewport()?.dataset?.vsSharedFrame||"local-metric")))base=meet.p;
  fullLocalReset();globalThis.__arondightVsMultiplayer?.resetLevelHealth?.(ids);document.getElementById("soloReset")?.click();
  if(base)spawnAt(base[0],base[1],{slot,n});else spawnAtStart(slot,n);
  setData("gameResetMeetSource",base?"shared-anchor":"fallback-local");
  setData("gameResetMode","multiplayer-full-vote");setData("gameResetSlot",`${slot}/${n}`);
}
function prompt(from,vid){
  document.getElementById("resetVoteDialog")?.remove();const d=document.createElement("div");d.id="resetVoteDialog";
  d.innerHTML=`<div class="rv-box"><b>LEVEL RESET?</b><p>Mitspieler ${String(from).slice(0,10)} möchte das ganze Level zurücksetzen.</p><div class="rv-row"><button type="button" data-yes>JA</button><button type="button" data-no>NEIN</button></div><small data-t>15</small></div>`;
  if(!document.querySelector("style[data-reset-vote]")){const st=document.createElement("style");st.dataset.resetVote="v1";st.textContent="#resetVoteDialog{position:fixed;inset:0;z-index:99;display:flex;align-items:center;justify-content:center;background:#0008;pointer-events:auto}#resetVoteDialog .rv-box{background:#11151bf0;border:1px solid #ffffff33;border-radius:14px;padding:18px 22px;color:#fff;font:600 14px/1.4 Inter,system-ui,sans-serif;min-width:260px;text-align:center}#resetVoteDialog b{font:900 18px/1 Inter,system-ui,sans-serif;letter-spacing:.08em}#resetVoteDialog .rv-row{display:flex;gap:12px;justify-content:center;margin-top:10px}#resetVoteDialog button{min-width:96px;height:44px;border-radius:10px;border:0;font:900 15px/1 Inter,system-ui,sans-serif;letter-spacing:.06em}#resetVoteDialog [data-yes]{background:#ff7a1a;color:#111}#resetVoteDialog [data-no]{background:#2a3038;color:#fff}#resetVoteDialog small{display:block;margin-top:8px;opacity:.6}";document.head.appendChild(st);}
  document.body.appendChild(d);const t0=performance.now(),tick=setInterval(()=>{const left=Math.max(0,Math.ceil((VOTE_MS-(performance.now()-t0))/1000));const el=d.querySelector("[data-t]");if(el)el.textContent=String(left);if(!left){done(false);}},250);
  const done=yes=>{clearInterval(tick);d.remove();send({kind:"answer",vid,to:from,yes:Boolean(yes)});};
  d.querySelector("[data-yes]").addEventListener("click",e=>{e.stopPropagation();done(true);});d.querySelector("[data-no]").addEventListener("click",e=>{e.stopPropagation();done(false);});
}
function onFx(event){const pk=event?.detail?.packet;if(pk?.objectId!=="reset-vote")return;const from=String(event?.detail?.peerId||pk.playerId||"");
  if(pk.kind==="request"&&from&&from!==selfId())prompt(from,pk.vid);
  else if(pk.kind==="answer"&&vote&&pk.vid===vote.vid&&(!pk.to||pk.to===selfId())){vote.answers.set(from,Boolean(pk.yes));if(!pk.yes)finishVote(false,"ABGELEHNT");else if(vote.peers.every(p=>vote.answers.get(p)===true))finishVote(true);}
  else if(pk.kind==="commit")commitReset(pk.meet,pk.order);
  else if(pk.kind==="cancel")document.getElementById("resetVoteDialog")?.remove();}
function finishVote(ok,label=""){if(!vote)return;clearTimeout(vote.timer);const v=vote;vote=null;
  if(!ok){send({kind:"cancel",vid:v.vid});flash(v.button,label||"KEINE EINIGUNG");setData("gameResetVote","rejected");return;}
  const order=[selfId(),...v.peers].sort(),meet=globalThis.__arondightVsMeetingPoint?.()||(()=>{const s=session(),p=s?.pendingPose;return Array.isArray(p?.p)?{p:p.p.slice(),f:String(p.f||"local-metric")}:null;})();send({kind:"commit",vid:v.vid,meet,order});commitReset(meet,order);setData("gameResetVote","accepted");}
function startVote(button){const list=peers();if(vote)return;const vid=`v${Date.now().toString(36)}`;vote={vid,peers:list,answers:new Map(),button,timer:setTimeout(()=>finishVote(false,"KEINE ANTWORT"),VOTE_MS+1500)};send({kind:"request",vid});flash(button,"ABSTIMMUNG…");setData("gameResetVote","pending");}
function flash(button,text){if(!button)return;const original=button.dataset.resetLabel||button.textContent;button.dataset.resetLabel=original;button.textContent=text;clearTimeout(button.__resetFlash);button.__resetFlash=setTimeout(()=>{button.textContent=button.dataset.resetLabel;},900);}
function setData(key,value){const v=viewport();if(v)v.dataset[key]=String(value);}

// returns true when the reset chain should continue (the button's own click handlers run)
function handleReset(button){
  const now=performance.now(),mp=multiplayer(),cooldown=mp?MP_COOLDOWN_MS:SP_COOLDOWN_MS;
  if(now-lastResetAt<cooldown){flash(button,`WAIT ${Math.ceil((cooldown-(now-lastResetAt))/1000)}s`);setData("gameResetBlocked","cooldown");return false;}
  lastResetAt=now;setData("gameReset",GAME_RESET_VERSION);setData("gameResetMode",mp?"multiplayer-respawn":"single-full");setData("gameResets",(Number(viewport()?.dataset.gameResets)||0)+1);
  if(mp){startVote(button);return false;}
  // Alone (single player or alone in a session): back to the start origin, let the normal reset chain run, rebuild the world, respawn at the start.
  bridge()?.restoreStartOrigin?.();fullLocalReset();spawnAtStart(0,1);return true;
}
function onClick(event){
  const button=event.target instanceof Element?event.target.closest(SELECTOR):null;if(!button||!event.isTrusted)return;
  if(!handleReset(button)){event.preventDefault();event.stopImmediatePropagation();}
}
// the same as pressing RESET (keyboard: R / Enter after death)
globalThis.__arondightRequestReset=()=>{const button=document.getElementById("soloReset");if(handleReset(button))button?.click();};
export function installGameReset(){if(installed)return;installed=true;window.addEventListener("click",onClick,{capture:true});window.addEventListener(VS_FX_EVENT,onFx);setData("gameReset",GAME_RESET_VERSION);}
installGameReset();
