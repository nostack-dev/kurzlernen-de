// Mouse look, like every PC shooter: one sensitivity (20–300 %, default 100 %) and "invert Y".
// Stored per browser; desktop_controls.mjs scales the raw pointer-lock deltas with it for every mode
// (on foot, drone, car look, jet). The two rows appear in SETTINGS right above the stick sliders.
export const MOUSE_SETTINGS_VERSION="mouse-sensitivity-v1";
const KEY="arondight.mouse.v1",clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
let cache=null;
export function loadMouseSettings(){if(cache)return cache;let s={};try{s=JSON.parse(localStorage.getItem(KEY)||"{}")||{};}catch{}cache={sensitivityPercent:clamp(Math.round(Number(s.sensitivityPercent)||100),20,300),invertY:Boolean(s.invertY)};return cache;}
export function saveMouseSettings(next){cache={...loadMouseSettings(),...next};cache.sensitivityPercent=clamp(Math.round(Number(cache.sensitivityPercent)||100),20,300);try{localStorage.setItem(KEY,JSON.stringify(cache));}catch{}return cache;}
export function scaleMouseDelta(dx,dy){const s=loadMouseSettings(),k=s.sensitivityPercent/100;return[dx*k,dy*k*(s.invertY?-1:1)];}
function inject(){
  const anchor=document.querySelector('[data-slider="left"]')?.closest(".phone-settings-row");if(!anchor||anchor.parentElement?.querySelector("[data-mouse-sens]"))return;
  const s=loadMouseSettings(),row=document.createElement("div");row.className="phone-settings-row";row.dataset.mouseRow="1";
  row.innerHTML='<label>MAUS-EMPFINDLICHKEIT</label><output data-mouse-out></output><input data-mouse-sens type="range" min="20" max="300" step="5"><div class="phone-settings-scale"><span>20%</span><span>300%</span></div>';
  const inv=document.createElement("label");inv.className="phone-settings-toggle";inv.dataset.mouseRow="1";inv.innerHTML='<span>MAUS Y INVERTIEREN</span><input data-mouse-invert type="checkbox">';
  anchor.before(row,inv);const range=row.querySelector("input"),out=row.querySelector("output"),box=inv.querySelector("input");
  const show=()=>{out.textContent=`${range.value}%`;};range.value=String(s.sensitivityPercent);box.checked=s.invertY;show();
  range.addEventListener("input",()=>{saveMouseSettings({sensitivityPercent:Number(range.value)});show();});box.addEventListener("change",()=>saveMouseSettings({invertY:box.checked}));
}
export function installMouseSettings(){if(typeof document==="undefined"||globalThis.__arondightMouseSettings)return;globalThis.__arondightMouseSettings={version:MOUSE_SETTINGS_VERSION,get:loadMouseSettings,set:saveMouseSettings};const tick=()=>{try{inject();}catch{}setTimeout(tick,1000);};tick();}
installMouseSettings();
