// Multiplayer HUD for the fun loop (vs_multiplayer.mjs decides, this only shows):
//   kill feed (top right): who got whom, with what, headshots marked
//   score (top left, under MULTI): every player in their colour, kills / deaths, you highlighted
//   hit marker: an X on the crosshair when your round hurt a mate, red when it killed
//   damage direction: a red arc on the edge pointing where the hit came from
//   spawn protection: a short shimmer after you respawn
import * as THREE from "three";
export const MP_FUN_HUD_VERSION="mp-fun-hud-v1";
let installed=false,root=null,feed=null,board=null,marker=null,hurt=null,shield=null,lastBoard="";
const WEAPON_LABEL={smg:"MP",glock:"GLOCK",sniper:"SNIPER",grenade:"RAKETE",fists:"FÄUSTE",gun:"DROHNE","5.56":"DROHNE",missile:"RAKETE",explosion:"EXPLOSION"};
const $=id=>document.getElementById(id);
const CSS=`
#mpFunHud{position:absolute;inset:0;pointer-events:none;z-index:16;font-family:Inter,system-ui,sans-serif}
#mpKillFeed{position:absolute;right:max(10px,env(safe-area-inset-right));top:max(58px,calc(env(safe-area-inset-top) + 52px));display:flex;flex-direction:column;align-items:flex-end;gap:4px}
#mpKillFeed div{padding:4px 9px;border-radius:7px;background:#070b10c4;color:#fff;font:800 12px/1.2 Inter,system-ui,sans-serif;letter-spacing:.03em;white-space:nowrap;animation:mpFeedIn .18s ease-out;transition:opacity .4s}
#mpKillFeed div.me{box-shadow:0 0 0 1.5px #ffd76a}#mpKillFeed b{font-weight:900}#mpKillFeed i{font-style:normal;opacity:.75;margin:0 6px}#mpKillFeed em{font-style:normal;color:#ff5a46;margin-left:5px}
@keyframes mpFeedIn{from{transform:translateX(16px);opacity:0}}
#mpScore{position:absolute;left:max(10px,env(safe-area-inset-left));top:max(96px,calc(env(safe-area-inset-top) + 90px));display:flex;flex-direction:column;gap:2px;padding:5px 7px;border-radius:8px;background:#070b10a8;color:#fff;font:800 11px/1.25 Inter,system-ui,sans-serif;font-variant-numeric:tabular-nums}
#mpScore[hidden]{display:none}#mpScore span{display:flex;gap:8px;justify-content:space-between}#mpScore span.me{color:#ffd76a}#mpScore u{text-decoration:none;display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px;vertical-align:middle}
#mpHitMarker{position:absolute;left:50%;top:50%;width:26px;height:26px;margin:-13px 0 0 -13px;opacity:0;transition:opacity .12s}
#mpHitMarker::before,#mpHitMarker::after{content:"";position:absolute;left:12px;top:0;width:2.5px;height:26px;background:#fff;box-shadow:0 0 3px #000;transform:rotate(45deg)}#mpHitMarker::after{transform:rotate(-45deg)}
#mpHitMarker.kill::before,#mpHitMarker.kill::after{background:#ff3b2f}#mpHitMarker.head::before,#mpHitMarker.head::after{background:#ffd76a}
#mpHitMarker.show{opacity:1;transition:none}
#mpHurt{position:absolute;left:50%;top:50%;width:min(56vmin,340px);height:min(56vmin,340px);margin:calc(min(56vmin,340px)/-2) 0 0 calc(min(56vmin,340px)/-2);border-radius:50%;opacity:0;transition:opacity .6s;background:conic-gradient(from calc(var(--a) - 22deg),#ff2b1f 0deg,#ff2b1fcc 44deg,transparent 44deg);-webkit-mask:radial-gradient(circle,transparent 62%,#000 63%,#000 70%,transparent 71%);mask:radial-gradient(circle,transparent 62%,#000 63%,#000 70%,transparent 71%)}
#mpHurt.show{opacity:.9;transition:none}
#mpShield{position:absolute;inset:0;opacity:0;transition:opacity .5s;box-shadow:inset 0 0 60px 10px #7fd4ffaa}#mpShield.show{opacity:1}
#mpShield b{position:absolute;left:50%;top:22%;transform:translateX(-50%);font:900 13px/1 Inter,system-ui,sans-serif;letter-spacing:.2em;color:#bfeaff;text-shadow:0 1px 3px #000}`;
function info(id){return globalThis.__arondightVsMultiplayer?.playerInfo?.(id)||{index:"?",color:"#fff",self:false};}
function name(id){const i=info(id);return`<b style="color:${i.color}">${i.self?"DU":`P${i.index}`}</b>`;}
function mount(){const v=$("viewport");if(!v)return false;const st=document.createElement("style");st.dataset.mpFunHud=MP_FUN_HUD_VERSION;st.textContent=CSS;document.head.appendChild(st);
  root=document.createElement("div");root.id="mpFunHud";root.innerHTML='<div id="mpKillFeed"></div><div id="mpScore" hidden></div><div id="mpHitMarker"></div><div id="mpHurt"></div><div id="mpShield"><b>GESCHÜTZT</b></div>';v.appendChild(root);
  feed=$("mpKillFeed");board=$("mpScore");marker=$("mpHitMarker");hurt=$("mpHurt");shield=$("mpShield");return true;}
function onKill(e){const d=e.detail||{};if(!feed)return;const row=document.createElement("div"),self=d.self,me=d.victim===self||d.by===self,w=WEAPON_LABEL[String(d.weapon||"").split(":")[0]]||(d.weapon?String(d.weapon).toUpperCase().slice(0,10):"");
  row.className=me?"me":"";row.innerHTML=!d.by||d.by===d.victim?`${name(d.victim)}<i>✕</i>${w||"UNFALL"}`:`${name(d.by)}<i>${w||"✕"}</i>${name(d.victim)}${d.zone==="head"?"<em>KOPF</em>":""}`;
  feed.prepend(row);while(feed.children.length>5)feed.lastChild.remove();setTimeout(()=>{row.style.opacity="0";setTimeout(()=>row.remove(),450);},5200);renderBoard(true);}
let markerTimer=0;function onHit(e){const d=e.detail||{};if(!marker)return;marker.className=`show${d.killed?" kill":""}${d.zone==="head"?" head":""}`;clearTimeout(markerTimer);markerTimer=setTimeout(()=>{marker.className=d.killed?"kill":"";},d.killed?260:110);}
const shooterPos=new THREE.Vector3(),camDir=new THREE.Vector3();let hurtTimer=0;
function onHurt(e){const d=e.detail||{};if(!hurt)return;const b=globalThis.__arondightRealWorld,cam=b?.presentedCamera?.()||b?.threeCamera;let ang=0;
  if(cam&&globalThis.__arondightRemoteAnchor?.(d.by,shooterPos)){cam.getWorldDirection(camDir);const yawTo=Math.atan2(shooterPos.y-cam.position.y,shooterPos.x-cam.position.x),yawFwd=Math.atan2(camDir.y,camDir.x);ang=(yawFwd-yawTo)*180/Math.PI;}
  hurt.style.setProperty("--a",`${ang.toFixed(0)}deg`);hurt.className="show";clearTimeout(hurtTimer);hurtTimer=setTimeout(()=>{hurt.className="";},140);}
function onProtected(e){if(!shield)return;shield.className="show";setTimeout(()=>{shield.className="";},Number(e.detail?.ms)||2500);}
function renderBoard(force=false){if(!board)return;const mp=globalThis.__arondightVsMultiplayer,on=Boolean(mp?.connected);if(!on){if(!board.hidden)board.hidden=true;return;}const list=(mp.scores?.()||[]).slice().sort((a,b)=>b.k-a.k||a.d-b.d);
  const html=list.map(p=>`<span class="${p.self?"me":""}"><span><u style="background:${p.color}"></u>${p.self?"DU":`P${p.index}`}</span><span>${p.k} / ${p.d}</span></span>`).join("");if(force||html!==lastBoard){lastBoard=html;board.innerHTML=html;}if(board.hidden)board.hidden=false;}
export function installMpFunHud(){if(installed||typeof window==="undefined")return;installed=true;const boot=()=>{if(!mount()){setTimeout(boot,300);return;}addEventListener("arondight:vs-kill",onKill);addEventListener("arondight:vs-hitmarker",onHit);addEventListener("arondight:vs-hurt",onHurt);addEventListener("arondight:vs-protected",onProtected);setInterval(renderBoard,700);};boot();}
installMpFunHud();
