// Title screen: WORLD button under START opens the world options (who lives in the city, player
// abilities). Each switch is a big toggle row with a one-line explanation; changes apply live
// (sim/world_options.mjs). Works with mouse, touch, keyboard (Tab/Enter/Space) and the pad
// (D-pad moves, A toggles, B closes — pad_actions.mjs).
import {WORLD_OPTIONS,worldOption,setWorldOption,WORLD_OPTIONS_EVENT} from "./world_options.mjs";
export const WORLD_OPTIONS_MENU_VERSION="title-world-options-v1";
const CSS=`
#gameMenuWorld{margin-top:4px;min-width:min(64vw,300px);padding:11px 24px;font:800 clamp(13px,1.8vw,16px) "Inter",system-ui,sans-serif;letter-spacing:.28em;color:#eef0f2;background:#ffffff14;border:1px solid #ffffff40;border-radius:10px;cursor:pointer}
#gameMenuWorld:hover,#gameMenuWorld:focus-visible{background:#ffffff24;outline:none}
#worldOptionsPanel{position:absolute;inset:0;z-index:5;display:flex;align-items:center;justify-content:center;background:#0b0d10e8;backdrop-filter:blur(4px)}
#worldOptionsPanel[hidden]{display:none}
#worldOptionsPanel .wo-card{width:min(92vw,460px);max-height:calc(100dvh - 40px);overflow:auto;padding:18px 18px 14px;border:1px solid #ffffff2e;border-radius:14px;background:#12161ce6;text-align:left}
#worldOptionsPanel h2{margin:0 0 4px;font:900 italic 22px/1 "Inter",system-ui,sans-serif;letter-spacing:.06em;color:#ffb02e}
#worldOptionsPanel .wo-sub{margin:0 0 12px;font:600 12px/1.35 system-ui,sans-serif;color:#b9c3cc}
#worldOptionsPanel .wo-row{display:grid;grid-template-columns:1fr auto;align-items:center;gap:10px;width:100%;margin:0 0 6px;padding:10px 12px;border:1px solid #ffffff1f;border-radius:10px;background:#ffffff0a;color:#eef0f2;text-align:left;cursor:pointer;font:inherit}
#worldOptionsPanel .wo-row b{display:block;font:850 14px/1.1 system-ui,sans-serif;letter-spacing:.1em}
#worldOptionsPanel .wo-row small{display:block;margin-top:3px;font:500 11.5px/1.3 system-ui,sans-serif;color:#aab4be}
#worldOptionsPanel .wo-row i{width:44px;height:24px;border-radius:12px;background:#3a414b;position:relative}
#worldOptionsPanel .wo-row i::after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#dfe5ea}
html body #worldOptionsPanel .wo-row[aria-checked="false"] i{background:#3a414b!important}html body #worldOptionsPanel .wo-row[aria-checked="true"] i{background:#ff8a1f!important}#worldOptionsPanel .wo-row[aria-checked="true"] i::after{left:23px}
#worldOptionsPanel .wo-row:focus-visible,#worldOptionsPanel .wo-done:focus-visible,body.pad-input #worldOptionsPanel :focus{outline:3px solid #ffd76a;outline-offset:2px}
#worldOptionsPanel .wo-done{display:block;width:100%;margin-top:8px;padding:12px;border:0;border-radius:10px;background:linear-gradient(180deg,#ffb02e,#ff7a1a);color:#16120c;font:850 15px/1 system-ui,sans-serif;letter-spacing:.24em;cursor:pointer}`;
let panel=null;
function render(){if(!panel)return;for(const row of panel.querySelectorAll("[data-wo]"))row.setAttribute("aria-checked",String(worldOption(row.dataset.wo)));}
function open(){if(!panel)return;panel.hidden=false;render();panel.querySelector("[data-wo]")?.focus({preventScroll:true});}
function close(){if(!panel)return;panel.hidden=true;document.getElementById("gameMenuWorld")?.focus({preventScroll:true});}
function mount(){
  const menu=document.getElementById("gameMenu"),center=menu?.querySelector(".gm-center"),start=document.getElementById("gameMenuStart");if(!menu||!center||!start)return false;
  if(document.getElementById("gameMenuWorld"))return true;
  const st=document.createElement("style");st.dataset.worldOptionsMenu=WORLD_OPTIONS_MENU_VERSION;st.textContent=CSS;document.head.appendChild(st);
  const btn=document.createElement("button");btn.id="gameMenuWorld";btn.type="button";btn.textContent="WORLD";start.after(btn);
  panel=document.createElement("div");panel.id="worldOptionsPanel";panel.hidden=true;panel.setAttribute("role","dialog");panel.setAttribute("aria-label","World options");
  panel.innerHTML=`<div class="wo-card"><h2>WORLD</h2><p class="wo-sub">Who lives in the city, and what you can do. Changes apply right away, also in a running game.</p>${WORLD_OPTIONS.map(o=>`<button type="button" class="wo-row" role="switch" data-wo="${o.key}"><span><b>${o.label}</b><small>${o.help}</small></span><i></i></button>`).join("")}<button type="button" class="wo-done">DONE</button></div>`;
  menu.appendChild(panel);
  btn.addEventListener("click",e=>{e.preventDefault();open();});
  panel.addEventListener("click",e=>{const row=e.target.closest?.("[data-wo]");if(row){setWorldOption(row.dataset.wo,!worldOption(row.dataset.wo));render();return;}if(e.target.closest?.(".wo-done")||e.target===panel)close();});
  panel.addEventListener("keydown",e=>{if(e.key==="Escape"){e.preventDefault();e.stopPropagation();close();}});
  addEventListener(WORLD_OPTIONS_EVENT,render);
  globalThis.__arondightWorldOptionsMenu={open,close,get isOpen(){return!panel.hidden;}};
  return true;
}
function wait(){if(!mount())setTimeout(wait,200);}
if(typeof document!=="undefined"){if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",wait,{once:true});else wait();}
