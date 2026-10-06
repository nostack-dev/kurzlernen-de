import {clearDestruction} from "./world_destruction_state.mjs";

// One owner for the RESET buttons (#soloReset in the top bar, the mobile dock
// #mobileGameplayReset):
//  * single player: full reset — sim, vitals, music (own hooks) and the
//    world: nuked buildings are rebuilt, craters/debris/hazards cleared;
//  * multiplayer: a reset is a respawn. It relocates to a random nearby spot
//    (never the shared origin or onto the peer), resyncs the peer with a
//    full-health "respawn" message and leaves the shared world untouched so
//    both players keep seeing the same city. A cooldown stops reset-spam
//    from being used to heal mid-fight or to flood the session.
// Only real user clicks are handled; programmatic .click() calls from other
// modules (death respawn, mobile dock forwarding) pass straight through.

export const GAME_RESET_VERSION="mp-safe-reset-v1";
const SP_COOLDOWN_MS=1200,MP_COOLDOWN_MS=6000,SELECTOR="#soloReset,#mobileGameplayReset";
let installed=false,lastResetAt=-Infinity;

const viewport=()=>document.getElementById("viewport");
const bridge=()=>globalThis.__arondightRealWorld||null;
function multiplayer(){const s=bridge()?.vsSession;return Boolean(s&&s.active!==false);}
function flash(button,text){if(!button)return;const original=button.dataset.resetLabel||button.textContent;button.dataset.resetLabel=original;button.textContent=text;clearTimeout(button.__resetFlash);button.__resetFlash=setTimeout(()=>{button.textContent=button.dataset.resetLabel;},900);}
function setData(key,value){const v=viewport();if(v)v.dataset[key]=String(value);}

function onClick(event){
  const button=event.target instanceof Element?event.target.closest(SELECTOR):null;if(!button||!event.isTrusted)return;
  const now=performance.now(),mp=multiplayer(),cooldown=mp?MP_COOLDOWN_MS:SP_COOLDOWN_MS;
  if(now-lastResetAt<cooldown){event.preventDefault();event.stopImmediatePropagation();flash(button,`WAIT ${Math.ceil((cooldown-(now-lastResetAt))/1000)}s`);setData("gameResetBlocked","cooldown");return;}
  lastResetAt=now;setData("gameReset",GAME_RESET_VERSION);setData("gameResetMode",mp?"multiplayer-respawn":"single-full");setData("gameResets",(Number(viewport()?.dataset.gameResets)||0)+1);
  if(mp){
    event.preventDefault();event.stopImmediatePropagation();
    const ok=Boolean(globalThis.__arondightVsResetRespawn?.());if(!ok)document.getElementById("soloReset")?.click();
    setTimeout(()=>globalThis.__arondightWalkMode?.setMode?.("drone",{persist:true,reason:"mp-reset"}),80);
    window.dispatchEvent(new CustomEvent("arondight:game-reset",{detail:{multiplayer:true}}));
    return;
  }
  // Single player: let the normal reset chain run, then rebuild the world.
  clearDestruction();window.dispatchEvent(new CustomEvent("arondight:world-reset"));
  window.dispatchEvent(new CustomEvent("arondight:game-reset",{detail:{multiplayer:false}}));
}
export function installGameReset(){if(installed)return;installed=true;window.addEventListener("click",onClick,{capture:true});setData("gameReset",GAME_RESET_VERSION);}
installGameReset();
