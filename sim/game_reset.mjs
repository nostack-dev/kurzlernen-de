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

export const GAME_RESET_VERSION="mp-vote-full-reset-v2";
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
function commitReset(meet,order){
  fullLocalReset();const ids=(order||[]).map(String),me=selfId(),slot=Math.max(0,ids.indexOf(me)),n=Math.max(1,ids.length),a=slot/n*Math.PI*2+.4,r=slot===0?0:SLOT_R+(slot>5?SLOT_R:0);
  const ok=Array.isArray(meet)&&globalThis.__arondightVsRespawnAtGeo?.(+meet[0],+meet[1],Math.cos(a)*r,Math.sin(a)*r);if(!ok)document.getElementById("soloReset")?.click();
  setTimeout(()=>globalThis.__arondightWalkMode?.setMode?.("drone",{persist:true,reason:"mp-reset"}),80);setData("gameResetMode","multiplayer-full-vote");setData("gameResetSlot",`${slot}/${n}`);
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
  const order=[selfId(),...v.peers].sort(),meet=globalThis.__arondightVsMeetingPoint?.();send({kind:"commit",vid:v.vid,meet,order});commitReset(meet,order);setData("gameResetVote","accepted");}
function startVote(button){const list=peers();if(vote)return;const vid=`v${Date.now().toString(36)}`;vote={vid,peers:list,answers:new Map(),button,timer:setTimeout(()=>finishVote(false,"KEINE ANTWORT"),VOTE_MS+1500)};send({kind:"request",vid});flash(button,"ABSTIMMUNG…");setData("gameResetVote","pending");}
function flash(button,text){if(!button)return;const original=button.dataset.resetLabel||button.textContent;button.dataset.resetLabel=original;button.textContent=text;clearTimeout(button.__resetFlash);button.__resetFlash=setTimeout(()=>{button.textContent=button.dataset.resetLabel;},900);}
function setData(key,value){const v=viewport();if(v)v.dataset[key]=String(value);}

function onClick(event){
  const button=event.target instanceof Element?event.target.closest(SELECTOR):null;if(!button||!event.isTrusted)return;
  const now=performance.now(),mp=multiplayer(),cooldown=mp?MP_COOLDOWN_MS:SP_COOLDOWN_MS;
  if(now-lastResetAt<cooldown){event.preventDefault();event.stopImmediatePropagation();flash(button,`WAIT ${Math.ceil((cooldown-(now-lastResetAt))/1000)}s`);setData("gameResetBlocked","cooldown");return;}
  lastResetAt=now;setData("gameReset",GAME_RESET_VERSION);setData("gameResetMode",mp?"multiplayer-respawn":"single-full");setData("gameResets",(Number(viewport()?.dataset.gameResets)||0)+1);
  if(mp){event.preventDefault();event.stopImmediatePropagation();startVote(button);return;}
  // Alone (single player or alone in a session): let the normal reset chain run, then rebuild the world.
  fullLocalReset();
}
export function installGameReset(){if(installed)return;installed=true;window.addEventListener("click",onClick,{capture:true});window.addEventListener(VS_FX_EVENT,onFx);setData("gameReset",GAME_RESET_VERSION);}
installGameReset();
