import {DEFAULT_PHONE_SETTINGS,normalizePhoneSettings,MIN_GAME_HORIZONTAL_SPEED_KMH,MAX_GAME_HORIZONTAL_SPEED_KMH} from "./control_semantics.mjs";
import {installSoloFlightLayout} from "./solo_layout.mjs";
import {findXboxGamepad} from "./xbox_gamepad.mjs";
import {createSettingsGamepadNavigator} from "./settings_controller_nav.mjs";

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
  .phone-settings-dialog{width:min(92vw,390px)!important;max-height:calc(100dvh - max(16px,env(safe-area-inset-top)) - max(16px,env(safe-area-inset-bottom)))!important;overflow-x:hidden!important;overflow-y:auto!important;overscroll-behavior:contain!important;-webkit-overflow-scrolling:touch!important;scrollbar-gutter:stable!important;touch-action:pan-y!important;border:1px solid #ffffff44!important;border-radius:14px!important;background:#0b1420f4!important;color:#fff!important;padding:16px!important;box-shadow:0 20px 70px #000a!important}
  .phone-settings-dialog::backdrop{background:#0009;backdrop-filter:blur(5px)}
  .phone-settings-titlebar{position:sticky;top:-16px;z-index:8;display:flex;align-items:center;justify-content:space-between;gap:12px;margin:-16px -16px 10px;padding:14px 14px 10px 16px;background:linear-gradient(180deg,#0b1420 72%,#0b1420e8 88%,#0b142000);}
  .phone-settings-dialog h3{margin:0;font:800 17px system-ui,-apple-system,sans-serif}
  .phone-settings-close-top{flex:0 0 auto;width:40px;height:40px;border:1px solid #ffffff55;border-radius:10px;background:#162437;color:#fff;font:900 18px/1 system-ui,-apple-system,sans-serif}
  .phone-settings-dialog :is(button,input,select,textarea):focus-visible{outline:3px solid #6be4b0!important;outline-offset:3px!important}
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
  .phone-settings-toggle.fullscreen-inactive{opacity:.52}
  .phone-settings-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:16px;padding-bottom:max(2px,env(safe-area-inset-bottom))}
  .phone-settings-actions button,.world-settings-actions button{border:1px solid #ffffff44;border-radius:9px;background:#162437;color:#fff;padding:8px 12px;font-weight:800}
  .phone-settings-note{font-size:11px!important;color:#8fa1b8!important}
  .world-settings-section label{font:750 13px system-ui,-apple-system,sans-serif;display:block;margin:12px 0 6px}
  .world-settings-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0}
  .world-settings-actions [data-world-use]{background:#175f49;border-color:#2e9b77}
  .world-settings-status{padding:9px 10px;margin:8px 0 10px;border:1px solid #ffffff2e;border-radius:9px;background:#07101a;color:#9db0c9;font:750 11px/1.35 system-ui,-apple-system,sans-serif}
  body.solo-flight #soloTopbar .world-mode-button{display:inline-flex!important;flex:0 0 auto;min-width:54px;min-height:28px;align-items:center;justify-content:center;white-space:nowrap}
  body.solo-flight #soloTopbar .world-mode-button[data-active="1"]{background:#175f49!important;border-color:#62d6aa!important;color:#fff!important}
  body.solo-flight #soloTopbar .world-mode-button[data-loading="1"]{background:#7b5a18!important;border-color:#ffd06d!important}
  @media(max-height:340px){
    .phone-settings-dialog{max-height:calc(100dvh - 10px)!important;padding:12px!important}
    .phone-settings-titlebar{top:-12px;margin:-12px -12px 8px;padding:9px 10px 7px 12px}
    .phone-settings-close-top{width:36px;height:36px}
    body.solo-flight #soloTopbar .world-mode-button{min-width:48px;min-height:24px;font-size:10px;padding:4px 7px}
  }
  `;
  document.head.appendChild(style);
}

function mountSoloWorldSettings({parent,dialog,settingsButton}){
  if(parent?.id!=="soloTopbar"||!dialog)return null;
  const bridge=globalThis.__arondightRealWorld;if(!bridge)return null;
  const section=document.createElement("section");section.className="world-settings-section";section.dataset.worldSettings="openfreemap-osm-3d";section.innerHTML=`
    <h4>REAL WORLD</h4>
    <p class="phone-settings-note">Esri World Imagery aerial/satellite pixels + OpenFreeMap/OpenStreetMap roads and 3D building footprints. No account, API key, billing setup, backend or proxy is required.</p>
    <div class="world-settings-status" data-world-status>TRAINING RANGE · local metric world</div>
    <div class="world-settings-actions"><button type="button" data-world-use>USE MY GPS LOCATION</button><button type="button" data-world-training>TRAINING RANGE</button></div>
    <label class="phone-settings-toggle"><span>REAL AERIAL / SATELLITE MAP</span><input data-world-imagery type="checkbox"></label>
    <label class="phone-settings-toggle"><span>WORLD GRID</span><input data-world-grid type="checkbox"></label>
    <label class="phone-settings-toggle"><span>KEEP 360° LOOK ORIENTATION</span><input data-world-keep-look type="checkbox"></label>
    <label class="phone-settings-toggle"><span>LOCK MINIMAP AXIS TO VERTICAL</span><input data-world-minimap-axis-lock type="checkbox"></label>
    <p class="phone-settings-note">REAL AERIAL / SATELLITE MAP is ON by default in both the flight view and minimap. WORLD GRID is a render-only local metre reference. 360° LOOK is camera-only: OFF snaps smoothly back on release; ON keeps the released orientation. LOCK MINIMAP AXIS is ON by default and keeps the orthographic top-down map north-up during persistent look/orientation changes outside fullscreen. Fullscreen always uses its native landscape/north-up policy.</p>
    <p class="phone-settings-note">Nearby loaded OSM building footprints, holes and available min/max heights are installed as bounded static Box3D collision prisms. Imagery, roads and flat ground remain geospatial context; OSM geometry is approximate, not surveyed 1:1 world truth. Motor, sensor and FC authority stay on the same hardware-fit path.</p>`;
  const actions=dialog.querySelector(".phone-settings-actions");dialog.insertBefore(section,actions);
  const status=section.querySelector("[data-world-status]"),use=section.querySelector("[data-world-use]"),training=section.querySelector("[data-world-training]"),imagery=section.querySelector("[data-world-imagery]"),grid=section.querySelector("[data-world-grid]"),keepLook=section.querySelector("[data-world-keep-look]"),axisLock=section.querySelector("[data-world-minimap-axis-lock]");
  const worldButton=document.createElement("button");worldButton.id="soloWorld";worldButton.type="button";worldButton.className="world-mode-button";worldButton.setAttribute("aria-label","Toggle real-world GPS map");parent.insertBefore(worldButton,settingsButton||null);
  const mainStatus=document.getElementById("realWorldStatus");
  const syncStatus=()=>{const text=mainStatus?.textContent?.trim();if(text)status.textContent=text;if(mainStatus){status.classList.toggle("good",mainStatus.classList.contains("good"));status.classList.toggle("warn",mainStatus.classList.contains("warn"));status.classList.toggle("bad",mainStatus.classList.contains("bad"));}};
  if(mainStatus)new MutationObserver(syncStatus).observe(mainStatus,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:["class"]});
  const renderButton=()=>{worldButton.dataset.active=bridge.active?"1":"0";worldButton.dataset.loading=bridge.loading?"1":"0";worldButton.textContent=bridge.loading?"WORLD…":bridge.active?"WORLD ✓":"WORLD";imagery.checked=bridge.imageryEnabled!==false;grid.checked=bridge.gridEnabled!==false;keepLook.checked=Boolean(bridge.keepLookOrientation);axisLock.checked=bridge.minimapAxisLocked!==false;axisLock.disabled=Boolean(document.fullscreenElement);axisLock.closest("label")?.classList.toggle("fullscreen-inactive",axisLock.disabled);syncStatus();};
  const activate=async()=>{try{const pending=bridge.activate();renderButton();await pending;}catch(error){if(typeof bridge.fail==="function")bridge.fail(error);else status.textContent=`REAL WORLD unavailable · ${error?.message||error}`;}renderButton();};
  use.addEventListener("click",activate);training.addEventListener("click",()=>{bridge.deactivate();renderButton();});imagery.addEventListener("change",()=>{bridge.setImageryEnabled?.(imagery.checked);renderButton();});grid.addEventListener("change",()=>{bridge.setGridEnabled?.(grid.checked);renderButton();});keepLook.addEventListener("change",()=>{bridge.setKeepLookOrientation?.(keepLook.checked);renderButton();});axisLock.addEventListener("change",()=>{bridge.setMinimapAxisLocked?.(axisLock.checked);renderButton();});dialog.querySelector("[data-reset]")?.addEventListener("click",()=>{bridge.setImageryEnabled?.(true);bridge.setGridEnabled?.(true);bridge.setKeepLookOrientation?.(false);bridge.setMinimapAxisLocked?.(true);bridge.resetLook?.(true);renderButton();});document.addEventListener("fullscreenchange",renderButton);
  worldButton.addEventListener("click",async()=>{if(bridge.loading)return;if(bridge.active){bridge.deactivate();renderButton();return;}await activate();});
  settingsButton?.addEventListener("click",()=>requestAnimationFrame(renderButton));
  new MutationObserver(()=>{if(document.body.classList.contains("solo-flight"))renderButton();}).observe(document.body,{attributes:true,attributeFilter:["class"]});
  renderButton();return{section,button:worldButton,activate};
}

export function mountPhoneControlSettings({parent,buttonText="SETTINGS",onChange=()=>{},debugGrid=null,box3dColliderDebug=null,xboxControllerToggle=false}={}){
  if(!parent)throw Error("settings parent required");
  installStyle();
  let settings=loadPhoneControlSettings();
  const button=document.createElement("button");
  button.type="button";button.className="phone-settings-button";button.textContent=buttonText;button.setAttribute("aria-label","Phone control settings");
  const dialog=document.createElement("dialog");dialog.className="phone-settings-dialog";
  dialog.innerHTML=`
    <div class="phone-settings-titlebar"><h3>PHONE CONTROLS</h3><button type="button" class="phone-settings-close-top" data-close-top aria-label="Close settings">×</button></div>
    <p>Higher fineness softens only the centre of each virtual stick. In GAME, full translation stick reaches the selected horizontal-speed envelope while the flight controller still enforces physical tilt and acceleration limits.</p>
    <div class="phone-settings-row"><label>LEFT STICK FINENESS</label><output data-out="left"></output><input data-slider="left" type="range" min="1" max="10" step="1"><div class="phone-settings-scale"><span>DIRECT</span><span>MAX FINE</span></div></div>
    <div class="phone-settings-row"><label>RIGHT STICK FINENESS</label><output data-out="right"></output><input data-slider="right" type="range" min="1" max="10" step="1"><div class="phone-settings-scale"><span>DIRECT</span><span>MAX FINE</span></div></div>
    <div class="phone-settings-row"><label>MAX HORIZONTAL SPEED</label><output data-out="speed"></output><input data-slider="speed" type="range" min="${MIN_GAME_HORIZONTAL_SPEED_KMH}" max="${MAX_GAME_HORIZONTAL_SPEED_KMH}" step="1"><div class="phone-settings-scale"><span>${MIN_GAME_HORIZONTAL_SPEED_KMH} km/h</span><span>${MAX_GAME_HORIZONTAL_SPEED_KMH} km/h</span></div></div>
    <div class="phone-settings-row"><label>DEFAULT HOVER ABOVE GROUND</label><output data-out="hover"></output><input data-slider="hover" type="range" min="0.5" max="50" step="0.1"><div class="phone-settings-scale"><span>0.5 m</span><span>50.0 m</span></div></div>
    <label class="phone-settings-toggle"><span>INVERT LEFT STICK HORIZONTAL (L/R)</span><input data-invert-left-horizontal type="checkbox"></label>
    <label class="phone-settings-toggle"><span>INVERT RIGHT STICK HORIZONTAL (L/R)</span><input data-invert-right-horizontal type="checkbox"></label>
    <label class="phone-settings-toggle"><span>INVERT RIGHT STICK VERTICAL (UP/DOWN)</span><input data-invert-right-vertical type="checkbox"></label>
    <label class="phone-settings-toggle"><span>LOCK LEFT STICK HORIZONTAL AXIS</span><input data-lock-left-horizontal type="checkbox"></label>
    <label class="phone-settings-toggle"><span>LOCK RIGHT STICK VERTICAL AXIS</span><input data-lock-horizontal type="checkbox"></label>
    ${xboxControllerToggle?'<label class="phone-settings-toggle"><span>XBOX CONTROLLER</span><input data-xbox-controller type="checkbox"></label><p class="phone-settings-note">OFF is the default and keeps touch controls active. ON reserves Xbox/standard-gamepad control and removes every touch flight control from the image, including while the selected controller reconnects.</p>':''}
    ${debugGrid?'<label class="phone-settings-toggle"><span>DEBUG GRIDLINES</span><input data-debug-grid type="checkbox"></label><p class="phone-settings-note">DEBUG GRIDLINES affect only the local training renderer. They never alter WORLD GRID, sensors, collision, FC state or physics.</p>':''}
    ${box3dColliderDebug?'<label class="phone-settings-toggle"><span>DEBUG COLLISION DRAW</span><input data-box3d-collider-debug type="checkbox"></label><p class="phone-settings-note">DEBUG COLLISION DRAW is render-only. OFF immediately hides Box3D ground, airframe and building collider wireframes and persists OFF locally.</p>':''}
    <p class="phone-settings-note">Controller: MENU/START opens settings, D-pad or left stick moves focus, LEFT/RIGHT changes the focused slider/toggle, A activates, B/VIEW closes. Settings are stored locally on this device.</p>
    <div class="phone-settings-actions"><button type="button" data-reset>DEFAULT</button><button type="button" data-close>CLOSE</button></div>`;
  document.body.appendChild(dialog);parent.appendChild(button);
  const left=dialog.querySelector('[data-slider="left"]'),right=dialog.querySelector('[data-slider="right"]'),speed=dialog.querySelector('[data-slider="speed"]'),hover=dialog.querySelector('[data-slider="hover"]');
  const leftOut=dialog.querySelector('[data-out="left"]'),rightOut=dialog.querySelector('[data-out="right"]'),speedOut=dialog.querySelector('[data-out="speed"]'),hoverOut=dialog.querySelector('[data-out="hover"]');
  const invertLeft=dialog.querySelector("[data-invert-left-horizontal]"),invertRight=dialog.querySelector("[data-invert-right-horizontal]"),invertRightVertical=dialog.querySelector("[data-invert-right-vertical]"),lockLeft=dialog.querySelector("[data-lock-left-horizontal]"),lock=dialog.querySelector("[data-lock-horizontal]"),xboxControllerInput=dialog.querySelector("[data-xbox-controller]"),debugGridInput=dialog.querySelector("[data-debug-grid]"),box3dColliderDebugInput=dialog.querySelector("[data-box3d-collider-debug]");
  const render=()=>{
    left.value=String(settings.leftFineness);right.value=String(settings.rightFineness);speed.value=String(settings.maxHorizontalSpeedKmh);hover.value=String(settings.defaultHoverAgl);
    leftOut.value=`${left.value}/10`;rightOut.value=`${right.value}/10`;speedOut.value=`${Math.round(Number(speed.value))} km/h`;hoverOut.value=`${Number(hover.value).toFixed(1)} m`;invertLeft.checked=settings.invertLeftHorizontal;invertRight.checked=settings.invertRightHorizontal;invertRightVertical.checked=settings.invertRightVertical;lockLeft.checked=settings.lockLeftHorizontal;lock.checked=settings.lockRightHorizontal;if(xboxControllerInput)xboxControllerInput.checked=settings.xboxControllerEnabled!==false;if(debugGridInput)debugGridInput.checked=Boolean(debugGrid?.get?.());if(box3dColliderDebugInput)box3dColliderDebugInput.checked=Boolean(box3dColliderDebug?.get?.());
  };
  const apply=()=>{
    settings=savePhoneControlSettings({leftFineness:Number(left.value),rightFineness:Number(right.value),maxHorizontalSpeedKmh:Number(speed.value),defaultHoverAgl:Number(hover.value),invertLeftHorizontal:invertLeft.checked,invertRightHorizontal:invertRight.checked,invertRightVertical:invertRightVertical.checked,lockLeftHorizontal:lockLeft.checked,lockRightHorizontal:lock.checked,xboxControllerEnabled:xboxControllerInput?xboxControllerInput.checked:settings.xboxControllerEnabled});
    render();onChange({...settings});
  };
  left.addEventListener("input",apply);right.addEventListener("input",apply);speed.addEventListener("input",apply);hover.addEventListener("input",apply);invertLeft.addEventListener("change",apply);invertRight.addEventListener("change",apply);invertRightVertical.addEventListener("change",apply);lockLeft.addEventListener("change",apply);lock.addEventListener("change",apply);if(xboxControllerInput)xboxControllerInput.addEventListener("change",apply);if(debugGridInput)debugGridInput.addEventListener("change",()=>{debugGrid?.set?.(debugGridInput.checked);render();});if(box3dColliderDebugInput)box3dColliderDebugInput.addEventListener("change",()=>{box3dColliderDebug?.set?.(box3dColliderDebugInput.checked);render();});
  dialog.querySelector("[data-reset]").onclick=()=>{settings=savePhoneControlSettings(DEFAULT_PHONE_SETTINGS);debugGrid?.set?.(Boolean(debugGrid?.defaultValue));box3dColliderDebug?.set?.(Boolean(box3dColliderDebug?.defaultValue));render();onChange({...settings});};
  const setOpenFlag=open=>{globalThis.__arondightSettingsModalOpen=Boolean(open);document.body.classList.toggle("settings-modal-open",Boolean(open));};
  const closeDialog=()=>{if(dialog.open)dialog.close();};
  const openDialog=source=>{settings=loadPhoneControlSettings();render();if(!dialog.open)dialog.showModal();setOpenFlag(true);requestAnimationFrame(()=>{const target=source==="gamepad"?left:dialog.querySelector("[data-close-top]");target?.focus?.({preventScroll:true});if(source==="gamepad")target?.scrollIntoView?.({block:"nearest"});});};
  dialog.querySelector("[data-close]").onclick=closeDialog;dialog.querySelector("[data-close-top]").onclick=closeDialog;
  dialog.addEventListener("close",()=>setOpenFlag(false));dialog.addEventListener("cancel",()=>setOpenFlag(false));
  dialog.addEventListener("pointerdown",event=>{const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom){event.preventDefault();closeDialog();}});
  button.onclick=()=>openDialog("touch");
  const world=mountSoloWorldSettings({parent,dialog,settingsButton:button});
  const gamepadNavigator=createSettingsGamepadNavigator({dialog,openDialog,closeDialog,getGamepad:()=>findXboxGamepad(navigator.getGamepads?.())});
  render();
  return{button,dialog,world,gamepadNavigator,get settings(){return{...settings};},reload(){settings=loadPhoneControlSettings();render();return{...settings};}};
}
