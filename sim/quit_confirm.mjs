// "Back to the main menu?" — Esc (keyboard) and EXIT TO TITLE (menu, pad, touch) ask first, in one
// small modal: JA / NEIN, Enter or Y = yes, Esc or N = no, Ⓐ / Ⓑ on the pad (pad_actions.mjs),
// a tap or a click. Nothing else of the game is covered.
export const QUIT_CONFIRM_VERSION="quit-confirm-v1";
let installed=false;
const CSS=`#quitConfirmDialog{position:fixed;inset:0;z-index:99;display:flex;align-items:center;justify-content:center;background:transparent;pointer-events:auto}
#quitConfirmDialog .qc-box{background:#11151bf2;border:1px solid #ffffff33;border-radius:14px;padding:18px 22px;color:#fff;font:600 14px/1.4 Inter,system-ui,sans-serif;min-width:260px;text-align:center;box-shadow:0 12px 40px #000a}
#quitConfirmDialog b{display:block;font:900 17px/1.2 Inter,system-ui,sans-serif;letter-spacing:.08em;margin-bottom:12px}
#quitConfirmDialog .qc-row{display:flex;gap:12px;justify-content:center}
#quitConfirmDialog button{min-width:104px;height:46px;border-radius:10px;border:0;font:900 15px/1 Inter,system-ui,sans-serif;letter-spacing:.06em;cursor:pointer}
#quitConfirmDialog [data-yes]{background:#ff7a1a;color:#111}#quitConfirmDialog [data-no]{background:#2a3038;color:#fff}
#quitConfirmDialog button:focus-visible,body.pad-input #quitConfirmDialog button:focus{outline:3px solid #ffd76a;outline-offset:2px}
#quitConfirmDialog small{display:block;margin-top:10px;opacity:.7;font-size:11px}`;
export function isQuitConfirmOpen(){return Boolean(document.getElementById("quitConfirmDialog"));}
export function openQuitConfirm(){if(isQuitConfirmOpen())return true;if(!document.querySelector("style[data-quit-confirm]")){const st=document.createElement("style");st.dataset.quitConfirm=QUIT_CONFIRM_VERSION;st.textContent=CSS;document.head.appendChild(st);}
  const wasLocked=Boolean(document.pointerLockElement);if(wasLocked){globalThis.__arondightQuietUnlockUntil=performance.now()+1500;try{document.exitPointerLock?.();}catch{}}
  const d=document.createElement("div");d.id="quitConfirmDialog";d.setAttribute("role","dialog");d.setAttribute("aria-modal","true");
  d.innerHTML=`<div class="qc-box"><b>ZURÜCK ZUM HAUPTMENÜ?</b><div class="qc-row"><button type="button" data-yes>JA</button><button type="button" data-no>NEIN</button></div><small>Enter / Ⓐ = JA · Esc / Ⓑ = NEIN</small></div>`;document.body.appendChild(d);
  const close=yes=>{removeEventListener("keydown",key,true);d.remove();if(yes){document.getElementById("soloExit")?.click();return;}if(document.body.classList.contains("desktop-input")&&!document.querySelector("dialog[open]"))try{document.getElementById("viewport")?.requestPointerLock?.();}catch{}};
  const key=e=>{const k=e.code;if(k==="Enter"||k==="KeyY"||k==="KeyJ"){e.preventDefault();e.stopImmediatePropagation();close(true);}else if(k==="Escape"||k==="KeyN"){e.preventDefault();e.stopImmediatePropagation();close(false);}};
  addEventListener("keydown",key,true);d.querySelector("[data-yes]").addEventListener("click",e=>{e.stopPropagation();close(true);});d.querySelector("[data-no]").addEventListener("click",e=>{e.stopPropagation();close(false);});
  d.addEventListener("pointerdown",e=>e.stopPropagation());d.querySelector("[data-yes]")?.focus({preventScroll:true});return true;}
export function installQuitConfirm(){if(installed||typeof window==="undefined")return;installed=true;globalThis.__arondightQuitConfirm={open:openQuitConfirm,get isOpen(){return isQuitConfirmOpen();}};}
installQuitConfirm();
