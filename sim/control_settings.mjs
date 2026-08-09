import {DEFAULT_PHONE_SETTINGS,normalizePhoneSettings} from "./control_semantics.mjs";
import {installSoloFlightLayout} from "./solo_layout.mjs";

export const PHONE_SETTINGS_KEY="arondight45PhoneControlSettingsV5";
const OBSOLETE_KEYS=[
  "arondight45PhoneControlSettingsV1",
  "arondight45PhoneControlSettingsV2",
  "arondight45PhoneControlSettingsV3",
  "arondight45PhoneControlSettingsV4",
];

function clearObsoleteSettings(){
  try{for(const key of OBSOLETE_KEYS)localStorage.removeItem(key);}catch{}
}

export function loadPhoneControlSettings(){
  clearObsoleteSettings();
  try{
    const raw=localStorage.getItem(PHONE_SETTINGS_KEY);
    return raw?normalizePhoneSettings(JSON.parse(raw)):normalizePhoneSettings(DEFAULT_PHONE_SETTINGS);
  }catch{return normalizePhoneSettings(DEFAULT_PHONE_SETTINGS);}
}

export function savePhoneControlSettings(settings){
  const normalized=normalizePhoneSettings(settings);
  try{localStorage.setItem(PHONE_SETTINGS_KEY,JSON.stringify(normalized));}catch{}
  return normalized;
}

let styleInstalled=false;
function installStyle(){
  if(styleInstalled)return;styleInstalled=true;
  installSoloFlightLayout();
  const style=document.createElement("style");
  style.textContent=`
  .phone-settings-button{white-space:nowrap}
  .phone-settings-dialog{width:min(92vw,390px)!important;max-height:90dvh!important;overflow:auto!important;border:1px solid #ffffff44!important;border-radius:14px!important;background:#0b1420f4!important;color:#fff!important;padding:16px!important;box-shadow:0 20px 70px #000a!important}
  .phone-settings-dialog::backdrop{background:#0009;backdrop-filter:blur(5px)}
  .phone-settings-dialog h3{margin:0 0 5px;font:800 17px system-ui,-apple-system,sans-serif}
  .camera-settings-section,.world-settings-section{margin-top:18px;padding-top:4px;border-top:2px solid #ffffff2b}
  .camera-settings-section h4,.world-settings-section h4{margin:12px 0 4px;font:850 14px system-ui,-apple-system,sans-serif;letter-spacing:.08em;color:#6be4b0}
  .phone-settings-dialog p{margin:0 0 14px;color:#aebdd0;font:12px/1.4 system-ui,-apple-system,sans-serif}
  .phone-settings-row{display:grid;grid-template-columns:1fr auto;gap:5px 10px;align-items:center;margin:15px 0}
  .phone-settings-row label{font:750 13px system-ui,-apple-system,sans-serif}
  .phone-settings-row output{font:900 13px ui-monospace,SFMono-Regular,Menlo,monospace;min-width:40px;text-align:right}
  .phone-settings-row input[type=range]{grid-column:1/3;width:100%;accent-color:#6be4b0}
  .phone-settings-scale{grid-column:1/3;display:flex;justify-content:space-between;color:#8295ad;font:800 9px system-ui,-apple-system,sans-serif;letter-spacing:.08em;margin-top:-3px}
  .phone-settings-toggle{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:12px 0 8px;padding:10px 0;border-top:1px solid #ffffff22;border-bottom:1px solid #ffffff22;font:750 13px system-ui,-apple-system,sans-serif}
  .phone-settings-toggle input{width:22px;height:22px;accent-color:#6be4b0}
  .phone-settings-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}
  .phone-settings-actions button,.world-settings-actions button{border:1px solid #ffffff44;border-radius:9px;background:#162437;color:#fff;padding:8px 12px;font-weight:800}
  .phone-settings-note{font-size:11px!important;color:#8fa1b8!important}
  .world-settings-section label{font:750 13px system-ui,-apple-system,sans-serif;display:block;margin:12px 0 6px}
  .world-settings-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0}
  .world-settings-actions [data-world-use]{background:#175f49;border-color:#2e9b77}
  .world-settings-status{padding:9px 10px;margin:8px 0 10px;border:1px solid #ffffff2e;border-radius:9px;background:#07101a;color:#9db0c9;font:750 11px/1.35 system-ui,-apple-system,sans-serif}
  body.solo-flight #soloTopbar .world-mode-button{display:inline-flex!important;flex:0 0 auto;min-width:54px;min-height:28px;align-items:center;justify-content:center;white-space:nowrap}
  body.solo-flight #soloTopbar .world-mode-button[data-active="1"]{background:#175f49!important;border-color:#62d6aa!important;color:#fff!important}
  body.solo-flight #soloTopbar .world-mode-button[data-loading="1"]{background:#7b5a18!important;border-color:#ffd06d!important}
  @media(max-height:340px){body.solo-flight #soloTopbar .world-mode-button{min-width:48px;min-height:24px;font-size:10px;padding:4px 7px}}
  `;
  document.head.appendChild(style);
}

function mountSoloWorldSettings({parent,dialog,settingsButton}){
  if(parent?.id!=="soloTopbar"||!dialog)return null;
  const bridge=globalThis.__arondightRealWorld;if(!bridge)return null;
  const section=document.createElement("section");section.className="world-settings-section";section.dataset.worldSettings="openfreemap-osm-3d";section.innerHTML=`
    <h4>REAL WORLD</h4>
    <p class="phone-settings-note">OpenFreeMap + OpenStreetMap. No account, API key, billing setup, backend or proxy is required.</p>
    <div class="world-settings-status" data-world-status>TRAINING RANGE · local metric world</div>
    <div class="world-settings-actions"><button type="button" data-world-use>USE MY GPS LOCATION</button><button type="button" data-world-training>TRAINING RANGE</button></div>
    <label class="phone-settings-toggle"><span>WORLD GRID</span><input data-world-grid type="checkbox"></label>
    <label class="phone-settings-toggle"><span>KEEP 360° LOOK ORIENTATION</span><input data-world-keep-look type="checkbox"></label>
    <label class="phone-settings-toggle"><span>MINIMAP FOLLOWS 360° CAMERA</span><input data-world-minimap-follow type="checkbox"></label>
    <p class="phone-settings-note">WORLD GRID is a render-only local metre reference. 360° LOOK is camera-only: OFF snaps smoothly back on release; ON keeps the released orientation. MINIMAP follow ON rotates the cached mini 3D map with the camera; OFF keeps north-up. FPV stays rigidly mounted and cannot be virtually panned.</p>
    <p class="phone-settings-note">OSM map/building data is render/geospatial context only. Motor, sensor, FC and rigid-body physics stay on the same hardware-fit digital-twin path; map geometry is not collision truth.</p>`;
  const actions=dialog.querySelector(".phone-settings-actions");dialog.insertBefore(section,actions);
  const status=section.querySelector("[data-world-status]"),use=section.querySelector("[data-world-use]"),training=section.querySelector("[data-world-training]"),grid=section.querySelector("[data-world-grid]"),keepLook=section.querySelector("[data-world-keep-look]"),minimapFollow=section.querySelector("[data-world-minimap-follow]");
  const worldButton=document.createElement("button");worldButton.id="soloWorld";worldButton.type="button";worldButton.className="world-mode-button";worldButton.setAttribute("aria-label","Toggle real-world GPS map");parent.insertBefore(worldButton,settingsButton||null);
  const mainStatus=document.getElementById("realWorldStatus");
  const syncStatus=()=>{const text=mainStatus?.textContent?.trim();if(text)status.textContent=text;if(mainStatus){status.classList.toggle("good",mainStatus.classList.contains("good"));status.classList.toggle("warn",mainStatus.classList.contains("warn"));status.classList.toggle("bad",mainStatus.classList.contains("bad"));}};
  if(mainStatus)new MutationObserver(syncStatus).observe(mainStatus,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:["class"]});
  const renderButton=()=>{worldButton.dataset.active=bridge.active?"1":"0";worldButton.dataset.loading=bridge.loading?"1":"0";worldButton.textContent=bridge.loading?"WORLD…":bridge.active?"WORLD ✓":"WORLD";grid.checked=bridge.gridEnabled!==false;keepLook.checked=Boolean(bridge.keepLookOrientation);minimapFollow.checked=bridge.minimapFollowLook!==false;syncStatus();};
  const activate=async()=>{try{const pending=bridge.activate();renderButton();await pending;}catch(error){if(typeof bridge.fail==="function")bridge.fail(error);else status.textContent=`REAL WORLD unavailable · ${error?.message||error}`;}renderButton();};
  use.addEventListener("click",activate);training.addEventListener("click",()=>{bridge.deactivate();renderButton();});grid.addEventListener("change",()=>{bridge.setGridEnabled?.(grid.checked);renderButton();});keepLook.addEventListener("change",()=>{bridge.setKeepLookOrientation?.(keepLook.checked);renderButton();});minimapFollow.addEventListener("change",()=>{bridge.setMinimapFollowLook?.(minimapFollow.checked);renderButton();});dialog.querySelector("[data-reset]")?.addEventListener("click",()=>{bridge.setGridEnabled?.(true);bridge.setKeepLookOrientation?.(false);bridge.setMinimapFollowLook?.(true);bridge.resetLook?.(true);renderButton();});
  worldButton.addEventListener("click",async()=>{if(bridge.loading)return;if(bridge.active){bridge.deactivate();renderButton();return;}await activate();});
  settingsButton?.addEventListener("click",()=>requestAnimationFrame(renderButton));
  new MutationObserver(()=>{if(document.body.classList.contains("solo-flight"))renderButton();}).observe(document.body,{attributes:true,attributeFilter:["class"]});
  renderButton();return{section,button:worldButton,activate};
}

export function mountPhoneControlSettings({parent,buttonText="SETTINGS",onChange=()=>{}}={}){
  if(!parent)throw Error("settings parent required");
  installStyle();
  let settings=loadPhoneControlSettings();
  const button=document.createElement("button");
  button.type="button";button.className="phone-settings-button";button.textContent=buttonText;button.setAttribute("aria-label","Phone control settings");
  const dialog=document.createElement("dialog");dialog.className="phone-settings-dialog";
  dialog.innerHTML=`
    <h3>PHONE CONTROLS</h3>
    <p>Higher fineness softens only the centre of each virtual stick. Full stick always stays full command.</p>
    <div class="phone-settings-row">
      <label>LEFT STICK FINENESS</label><output data-out="left"></output>
      <input data-slider="left" type="range" min="1" max="10" step="1">
      <div class="phone-settings-scale"><span>DIRECT</span><span>MAX FINE</span></div>
    </div>
    <div class="phone-settings-row">
      <label>RIGHT STICK FINENESS</label><output data-out="right"></output>
      <input data-slider="right" type="range" min="1" max="10" step="1">
      <div class="phone-settings-scale"><span>DIRECT</span><span>MAX FINE</span></div>
    </div>
    <div class="phone-settings-row">
      <label>DEFAULT HOVER ABOVE GROUND</label><output data-out="hover"></output>
      <input data-slider="hover" type="range" min="0.5" max="50" step="0.1">
      <div class="phone-settings-scale"><span>0.5 m</span><span>50.0 m</span></div>
    </div>
    <label class="phone-settings-toggle"><span>INVERT LEFT STICK HORIZONTAL (L/R)</span><input data-invert-left-horizontal type="checkbox"></label>
    <label class="phone-settings-toggle"><span>INVERT RIGHT STICK HORIZONTAL (L/R)</span><input data-invert-right-horizontal type="checkbox"></label>
    <label class="phone-settings-toggle"><span>INVERT RIGHT STICK VERTICAL (UP/DOWN)</span><input data-invert-right-vertical type="checkbox"></label>
    <label class="phone-settings-toggle"><span>LOCK LEFT STICK HORIZONTAL AXIS</span><input data-lock-left-horizontal type="checkbox"></label>
    <label class="phone-settings-toggle"><span>LOCK RIGHT STICK VERTICAL AXIS</span><input data-lock-horizontal type="checkbox"></label>
    <p class="phone-settings-note">Left X invert reverses MANUAL yaw / GAME strafe. Right X/Y invert independently reverse TURN and body pitch. All phone-input settings are stored locally on this device and never modify flight-controller code or aircraft physics.</p>
    <div class="phone-settings-actions"><button type="button" data-reset>DEFAULT</button><button type="button" data-close>CLOSE</button></div>`;
  document.body.appendChild(dialog);parent.appendChild(button);
  const left=dialog.querySelector('[data-slider="left"]'),right=dialog.querySelector('[data-slider="right"]'),hover=dialog.querySelector('[data-slider="hover"]');
  const leftOut=dialog.querySelector('[data-out="left"]'),rightOut=dialog.querySelector('[data-out="right"]'),hoverOut=dialog.querySelector('[data-out="hover"]');
  const invertLeft=dialog.querySelector("[data-invert-left-horizontal]"),invertRight=dialog.querySelector("[data-invert-right-horizontal]"),invertRightVertical=dialog.querySelector("[data-invert-right-vertical]"),lockLeft=dialog.querySelector("[data-lock-left-horizontal]"),lock=dialog.querySelector("[data-lock-horizontal]");
  const render=()=>{
    left.value=String(settings.leftFineness);right.value=String(settings.rightFineness);hover.value=String(settings.defaultHoverAgl);
    leftOut.value=`${left.value}/10`;rightOut.value=`${right.value}/10`;hoverOut.value=`${Number(hover.value).toFixed(1)} m`;invertLeft.checked=settings.invertLeftHorizontal;invertRight.checked=settings.invertRightHorizontal;invertRightVertical.checked=settings.invertRightVertical;lockLeft.checked=settings.lockLeftHorizontal;lock.checked=settings.lockRightHorizontal;
  };
  const apply=()=>{
    settings=savePhoneControlSettings({
      leftFineness:Number(left.value),
      rightFineness:Number(right.value),
      defaultHoverAgl:Number(hover.value),
      invertLeftHorizontal:invertLeft.checked,
      invertRightHorizontal:invertRight.checked,
      invertRightVertical:invertRightVertical.checked,
      lockLeftHorizontal:lockLeft.checked,
      lockRightHorizontal:lock.checked,
    });
    render();onChange({...settings});
  };
  left.addEventListener("input",apply);right.addEventListener("input",apply);hover.addEventListener("input",apply);invertLeft.addEventListener("change",apply);invertRight.addEventListener("change",apply);invertRightVertical.addEventListener("change",apply);lockLeft.addEventListener("change",apply);lock.addEventListener("change",apply);
  dialog.querySelector("[data-reset]").onclick=()=>{settings=savePhoneControlSettings(DEFAULT_PHONE_SETTINGS);render();onChange({...settings});};
  dialog.querySelector("[data-close]").onclick=()=>dialog.close();
  button.onclick=()=>{settings=loadPhoneControlSettings();render();dialog.showModal();};
  const world=mountSoloWorldSettings({parent,dialog,settingsButton:button});
  render();
  return{button,dialog,world,get settings(){return{...settings};},reload(){settings=loadPhoneControlSettings();render();return{...settings};}};
}
