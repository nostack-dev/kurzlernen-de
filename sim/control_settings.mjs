import {DEFAULT_PHONE_SETTINGS,MIN_GAME_HORIZONTAL_SPEED_KMH,MAX_GAME_HORIZONTAL_SPEED_KMH} from "./control_semantics.mjs";
import {loadPhoneControlSettings,savePhoneControlSettings} from "./drone_control_settings.mjs";
import {DEFAULT_FIRST_PERSON_CONTROL_SETTINGS,loadFirstPersonControlSettings,saveFirstPersonControlSettings} from "./first_person_control_settings.mjs";
import {installSoloFlightLayout} from "./solo_layout.mjs";
import {findXboxGamepad} from "./xbox_gamepad.mjs";
import {createSettingsGamepadNavigator} from "./settings_controller_nav.mjs";

export {PHONE_SETTINGS_KEY,loadPhoneControlSettings,savePhoneControlSettings} from "./drone_control_settings.mjs";
export const CONTROL_PROFILE_DRONE="drone";
export const CONTROL_PROFILE_FIRST_PERSON="first-person";

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
  .phone-settings-profile{display:grid;grid-template-columns:1fr auto;gap:7px 12px;align-items:center;margin:2px 0 16px;padding:11px 12px;border:1px solid #6be4b044;border-radius:10px;background:#0e1c2a}
  .phone-settings-profile label{font:850 12px system-ui,-apple-system,sans-serif;letter-spacing:.06em;color:#9ff0cb}
  .phone-settings-profile select{min-width:148px;border:1px solid #ffffff44;border-radius:8px;background:#162437;color:#fff;padding:8px 9px;font:850 12px system-ui,-apple-system,sans-serif}
  .phone-settings-profile p{grid-column:1/3;margin:0!important;color:#91a5bc!important}
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

function mountControlSettings({parent,buttonText="SETTINGS",onChange=()=>{},onFirstPersonChange=()=>{},debugGrid=null,box3dColliderDebug=null,xboxControllerToggle=false,getActiveControlProfile=()=>CONTROL_PROFILE_DRONE}={},firstPersonProfile=false){
  if(!parent)throw Error("settings parent required");
  installStyle();
  let activeProfile=CONTROL_PROFILE_DRONE,droneSettings=loadPhoneControlSettings(),firstPersonSettings=loadFirstPersonControlSettings();
  const resolveProfile=value=>firstPersonProfile&&value===CONTROL_PROFILE_FIRST_PERSON?CONTROL_PROFILE_FIRST_PERSON:CONTROL_PROFILE_DRONE;
  const button=document.createElement("button");
  button.type="button";button.className="phone-settings-button";button.textContent=buttonText;button.setAttribute("aria-label","Phone control settings");button.dataset.controlProfiles=firstPersonProfile?"drone+first-person":"drone";
  const dialog=document.createElement("dialog");dialog.className="phone-settings-dialog";dialog.dataset.controlProfiles=button.dataset.controlProfiles;
  dialog.innerHTML=`
    <div class="phone-settings-titlebar"><h3>PHONE CONTROLS</h3><button type="button" class="phone-settings-close-top" data-close-top aria-label="Close settings">×</button></div>
    ${firstPersonProfile?`<div class="phone-settings-profile"><label for="controlProfileSelect">CONTROL PROFILE</label><select id="controlProfileSelect" data-control-profile><option value="${CONTROL_PROFILE_DRONE}">DRONE</option><option value="${CONTROL_PROFILE_FIRST_PERSON}">FIRST PERSON</option></select><p data-control-profile-note></p></div>`:""}
    <p data-control-description>Higher fineness softens only the centre of each virtual stick. In GAME, full translation stick reaches the selected horizontal-speed envelope while the flight controller still enforces physical tilt and acceleration limits.</p>
    <div class="phone-settings-row"><label data-control-label="left">LEFT STICK FINENESS</label><output data-out="left"></output><input data-slider="left" type="range" min="1" max="10" step="1"><div class="phone-settings-scale"><span>DIRECT</span><span>MAX FINE</span></div></div>
    <div class="phone-settings-row"><label data-control-label="right">RIGHT STICK FINENESS</label><output data-out="right"></output><input data-slider="right" type="range" min="1" max="10" step="1"><div class="phone-settings-scale"><span>DIRECT</span><span>MAX FINE</span></div></div>
    <div class="phone-settings-row" data-drone-control><label>MAX HORIZONTAL SPEED</label><output data-out="speed"></output><input data-slider="speed" type="range" min="${MIN_GAME_HORIZONTAL_SPEED_KMH}" max="${MAX_GAME_HORIZONTAL_SPEED_KMH}" step="1"><div class="phone-settings-scale"><span>${MIN_GAME_HORIZONTAL_SPEED_KMH} km/h</span><span>${MAX_GAME_HORIZONTAL_SPEED_KMH} km/h</span></div></div>
    <div class="phone-settings-row" data-drone-control><label>DEFAULT HOVER ABOVE GROUND</label><output data-out="hover"></output><input data-slider="hover" type="range" min="0.5" max="50" step="0.1"><div class="phone-settings-scale"><span>0.5 m</span><span>50.0 m</span></div></div>
    <div class="phone-settings-row" data-first-person-control hidden><label>HORIZONTAL LOOK SENSITIVITY</label><output data-out="look-horizontal"></output><input data-slider="look-horizontal" type="range" min="50" max="150" step="1"><div class="phone-settings-scale"><span>50%</span><span>150%</span></div></div>
    <div class="phone-settings-row" data-first-person-control hidden><label>VERTICAL LOOK SENSITIVITY</label><output data-out="look-vertical"></output><input data-slider="look-vertical" type="range" min="50" max="150" step="1"><div class="phone-settings-scale"><span>50%</span><span>150%</span></div></div>
    <div class="phone-settings-row" data-first-person-control hidden><label>XBOX RIGHT STICK DEADZONE</label><output data-out="look-deadzone"></output><input data-slider="look-deadzone" type="range" min="2" max="20" step="1"><div class="phone-settings-scale"><span>2%</span><span>20%</span></div></div>
    <div class="phone-settings-row" data-first-person-control hidden><label>LIGHT AIM ASSIST · XBOX + TOUCH</label><output data-out="aim-assist"></output><input data-slider="aim-assist" type="range" min="0" max="100" step="1"><div class="phone-settings-scale"><span>OFF</span><span>FULL</span></div></div>
    <label class="phone-settings-toggle"><span data-control-label="invert-left">INVERT LEFT STICK HORIZONTAL (L/R)</span><input data-invert-left-horizontal type="checkbox"></label>
    <label class="phone-settings-toggle"><span data-control-label="invert-right">INVERT RIGHT STICK HORIZONTAL (L/R)</span><input data-invert-right-horizontal type="checkbox"></label>
    <label class="phone-settings-toggle"><span data-control-label="invert-right-vertical">INVERT RIGHT STICK VERTICAL (UP/DOWN)</span><input data-invert-right-vertical type="checkbox"></label>
    <label class="phone-settings-toggle"><span data-control-label="lock-left">LOCK LEFT STICK HORIZONTAL AXIS</span><input data-lock-left-horizontal type="checkbox"></label>
    <label class="phone-settings-toggle"><span data-control-label="lock-right">LOCK RIGHT STICK VERTICAL AXIS</span><input data-lock-horizontal type="checkbox"></label>
    ${xboxControllerToggle?'<label class="phone-settings-toggle"><span>XBOX CONTROLLER</span><input data-xbox-controller type="checkbox"></label><p class="phone-settings-note">OFF is the default and keeps touch controls active. ON reserves Xbox controller input and removes every touch flight control from the image, including while the controller reconnects.</p>':''}
    ${debugGrid?'<label class="phone-settings-toggle"><span>DEBUG GRIDLINES</span><input data-debug-grid type="checkbox"></label><p class="phone-settings-note">DEBUG GRIDLINES affect only the local training renderer. They never alter WORLD GRID, sensors, collision, FC state or physics.</p>':''}
    ${box3dColliderDebug?'<label class="phone-settings-toggle"><span>DEBUG COLLISION DRAW</span><input data-box3d-collider-debug type="checkbox"></label><p class="phone-settings-note">DEBUG COLLISION DRAW is render-only. OFF immediately hides Box3D ground, airframe and building collider wireframes and persists OFF locally.</p>':''}
    <p class="phone-settings-note">Controller: MENU/START opens settings, D-pad or left stick moves focus, LEFT/RIGHT changes the focused slider/toggle, A activates, B/VIEW closes. Settings are stored locally on this device.</p>
    <div class="phone-settings-actions"><button type="button" data-reset>DEFAULT</button><button type="button" data-close>CLOSE</button></div>`;
  document.body.appendChild(dialog);parent.appendChild(button);
  const left=dialog.querySelector('[data-slider="left"]'),right=dialog.querySelector('[data-slider="right"]'),speed=dialog.querySelector('[data-slider="speed"]'),hover=dialog.querySelector('[data-slider="hover"]');
  const horizontalLook=dialog.querySelector('[data-slider="look-horizontal"]'),verticalLook=dialog.querySelector('[data-slider="look-vertical"]'),lookDeadzone=dialog.querySelector('[data-slider="look-deadzone"]'),aimAssist=dialog.querySelector('[data-slider="aim-assist"]');
  const leftOut=dialog.querySelector('[data-out="left"]'),rightOut=dialog.querySelector('[data-out="right"]'),speedOut=dialog.querySelector('[data-out="speed"]'),hoverOut=dialog.querySelector('[data-out="hover"]'),horizontalLookOut=dialog.querySelector('[data-out="look-horizontal"]'),verticalLookOut=dialog.querySelector('[data-out="look-vertical"]'),lookDeadzoneOut=dialog.querySelector('[data-out="look-deadzone"]'),aimAssistOut=dialog.querySelector('[data-out="aim-assist"]');
  const invertLeft=dialog.querySelector("[data-invert-left-horizontal]"),invertRight=dialog.querySelector("[data-invert-right-horizontal]"),invertRightVertical=dialog.querySelector("[data-invert-right-vertical]"),lockLeft=dialog.querySelector("[data-lock-left-horizontal]"),lock=dialog.querySelector("[data-lock-horizontal]"),xboxControllerInput=dialog.querySelector("[data-xbox-controller]"),debugGridInput=dialog.querySelector("[data-debug-grid]"),box3dColliderDebugInput=dialog.querySelector("[data-box3d-collider-debug]");
  const profileSelect=dialog.querySelector("[data-control-profile]"),profileNote=dialog.querySelector("[data-control-profile-note]"),description=dialog.querySelector("[data-control-description]");
  const label=key=>dialog.querySelector(`[data-control-label="${key}"]`);
  const render=()=>{
    const fps=activeProfile===CONTROL_PROFILE_FIRST_PERSON,settings=fps?firstPersonSettings:droneSettings;
    dialog.dataset.controlProfile=activeProfile;if(profileSelect)profileSelect.value=activeProfile;
    if(profileNote)profileNote.textContent=fps?"FIRST PERSON has its own move/look curve, sensitivity, inversion and axis locks. DRONE values are not changed.":"DRONE keeps its own flight-stick curve, speed, hover, inversion and axis locks. FIRST PERSON values are not changed.";
    description.textContent=fps?"Move fineness, horizontal/vertical sensitivity, inversion and light aim assist apply to Xbox and touch. Look fineness also tunes the visible touch LOOK stick; radial deadzone is Xbox-only.":"Higher fineness softens only the centre of each virtual stick. In GAME, full translation stick reaches the selected horizontal-speed envelope while the flight controller still enforces physical tilt and acceleration limits.";
    label("left").textContent=fps?"MOVE STICK FINENESS":"LEFT STICK FINENESS";label("right").textContent=fps?"LOOK STICK FINENESS":"RIGHT STICK FINENESS";label("invert-left").textContent=fps?"INVERT MOVE HORIZONTAL (L/R)":"INVERT LEFT STICK HORIZONTAL (L/R)";label("invert-right").textContent=fps?"INVERT LOOK HORIZONTAL (L/R)":"INVERT RIGHT STICK HORIZONTAL (L/R)";label("invert-right-vertical").textContent=fps?"INVERT LOOK VERTICAL (UP/DOWN)":"INVERT RIGHT STICK VERTICAL (UP/DOWN)";label("lock-left").textContent=fps?"LOCK MOVE HORIZONTAL AXIS":"LOCK LEFT STICK HORIZONTAL AXIS";label("lock-right").textContent=fps?"LOCK LOOK VERTICAL AXIS":"LOCK RIGHT STICK VERTICAL AXIS";
    for(const row of dialog.querySelectorAll("[data-drone-control]"))row.hidden=fps;for(const row of dialog.querySelectorAll("[data-first-person-control]"))row.hidden=!fps;
    left.value=String(fps?settings.moveFineness:settings.leftFineness);right.value=String(fps?settings.lookFineness:settings.rightFineness);speed.value=String(droneSettings.maxHorizontalSpeedKmh);hover.value=String(droneSettings.defaultHoverAgl);if(horizontalLook)horizontalLook.value=String(firstPersonSettings.horizontalLookSensitivityPercent);if(verticalLook)verticalLook.value=String(firstPersonSettings.verticalLookSensitivityPercent);if(lookDeadzone)lookDeadzone.value=String(firstPersonSettings.lookDeadzonePercent);if(aimAssist)aimAssist.value=String(firstPersonSettings.aimAssistStrengthPercent);
    leftOut.value=`${left.value}/10`;rightOut.value=`${right.value}/10`;speedOut.value=`${Math.round(Number(speed.value))} km/h`;hoverOut.value=`${Number(hover.value).toFixed(1)} m`;if(horizontalLookOut)horizontalLookOut.value=`${horizontalLook.value}%`;if(verticalLookOut)verticalLookOut.value=`${verticalLook.value}%`;if(lookDeadzoneOut)lookDeadzoneOut.value=`${lookDeadzone.value}%`;if(aimAssistOut)aimAssistOut.value=Number(aimAssist.value)===0?"OFF":`${aimAssist.value}%`;
    invertLeft.checked=fps?settings.invertMoveHorizontal:settings.invertLeftHorizontal;invertRight.checked=fps?settings.invertLookHorizontal:settings.invertRightHorizontal;invertRightVertical.checked=fps?settings.invertLookVertical:settings.invertRightVertical;lockLeft.checked=fps?settings.lockMoveHorizontal:settings.lockLeftHorizontal;lock.checked=fps?settings.lockLookVertical:settings.lockRightHorizontal;if(xboxControllerInput)xboxControllerInput.checked=droneSettings.xboxControllerEnabled!==false;if(debugGridInput)debugGridInput.checked=Boolean(debugGrid?.get?.());if(box3dColliderDebugInput)box3dColliderDebugInput.checked=Boolean(box3dColliderDebug?.get?.());
  };
  const apply=()=>{
    if(activeProfile===CONTROL_PROFILE_FIRST_PERSON){
      firstPersonSettings=saveFirstPersonControlSettings({moveFineness:Number(left.value),lookFineness:Number(right.value),horizontalLookSensitivityPercent:Number(horizontalLook.value),verticalLookSensitivityPercent:Number(verticalLook.value),lookDeadzonePercent:Number(lookDeadzone.value),aimAssistStrengthPercent:Number(aimAssist.value),invertMoveHorizontal:invertLeft.checked,invertLookHorizontal:invertRight.checked,invertLookVertical:invertRightVertical.checked,lockMoveHorizontal:lockLeft.checked,lockLookVertical:lock.checked});
      render();onFirstPersonChange({...firstPersonSettings});return;
    }
    droneSettings=savePhoneControlSettings({leftFineness:Number(left.value),rightFineness:Number(right.value),maxHorizontalSpeedKmh:Number(speed.value),defaultHoverAgl:Number(hover.value),invertLeftHorizontal:invertLeft.checked,invertRightHorizontal:invertRight.checked,invertRightVertical:invertRightVertical.checked,lockLeftHorizontal:lockLeft.checked,lockRightHorizontal:lock.checked,xboxControllerEnabled:xboxControllerInput?xboxControllerInput.checked:droneSettings.xboxControllerEnabled});
    render();onChange({...droneSettings});
  };
  left.addEventListener("input",apply);right.addEventListener("input",apply);speed.addEventListener("input",apply);hover.addEventListener("input",apply);horizontalLook?.addEventListener("input",apply);verticalLook?.addEventListener("input",apply);lookDeadzone?.addEventListener("input",apply);aimAssist?.addEventListener("input",apply);invertLeft.addEventListener("change",apply);invertRight.addEventListener("change",apply);invertRightVertical.addEventListener("change",apply);lockLeft.addEventListener("change",apply);lock.addEventListener("change",apply);if(xboxControllerInput)xboxControllerInput.addEventListener("change",()=>{droneSettings=savePhoneControlSettings({...droneSettings,xboxControllerEnabled:xboxControllerInput.checked});render();onChange({...droneSettings});});if(debugGridInput)debugGridInput.addEventListener("change",()=>{debugGrid?.set?.(debugGridInput.checked);render();});if(box3dColliderDebugInput)box3dColliderDebugInput.addEventListener("change",()=>{box3dColliderDebug?.set?.(box3dColliderDebugInput.checked);render();});
  profileSelect?.addEventListener("change",()=>{activeProfile=resolveProfile(profileSelect.value);render();});
  dialog.querySelector("[data-reset]").onclick=()=>{if(activeProfile===CONTROL_PROFILE_FIRST_PERSON){firstPersonSettings=saveFirstPersonControlSettings(DEFAULT_FIRST_PERSON_CONTROL_SETTINGS);onFirstPersonChange({...firstPersonSettings});}else{droneSettings=savePhoneControlSettings(DEFAULT_PHONE_SETTINGS);onChange({...droneSettings});}debugGrid?.set?.(Boolean(debugGrid?.defaultValue));box3dColliderDebug?.set?.(Boolean(box3dColliderDebug?.defaultValue));render();};
  const setOpenFlag=open=>{globalThis.__arondightSettingsModalOpen=Boolean(open);document.body.classList.toggle("settings-modal-open",Boolean(open));};
  const closeDialog=()=>{if(dialog.open)dialog.close();};
  const openDialog=source=>{droneSettings=loadPhoneControlSettings();firstPersonSettings=loadFirstPersonControlSettings();let requested=CONTROL_PROFILE_DRONE;try{requested=getActiveControlProfile?.();}catch{}activeProfile=resolveProfile(requested);render();if(!dialog.open)dialog.showModal();setOpenFlag(true);requestAnimationFrame(()=>{const target=source==="gamepad"?(profileSelect||left):dialog.querySelector("[data-close-top]");target?.focus?.({preventScroll:true});if(source==="gamepad")target?.scrollIntoView?.({block:"nearest"});});};
  dialog.querySelector("[data-close]").onclick=closeDialog;dialog.querySelector("[data-close-top]").onclick=closeDialog;
  dialog.addEventListener("close",()=>setOpenFlag(false));dialog.addEventListener("cancel",()=>setOpenFlag(false));
  dialog.addEventListener("pointerdown",event=>{const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom){event.preventDefault();closeDialog();}});
  button.onclick=()=>openDialog("touch");
  const world=mountSoloWorldSettings({parent,dialog,settingsButton:button});
  const gamepadNavigator=createSettingsGamepadNavigator({dialog,openDialog,closeDialog,getGamepad:()=>findXboxGamepad(navigator.getGamepads?.())});
  const gamepadHelp=document.getElementById("soloGamepadHelp");if(gamepadHelp)gamepadHelp.textContent="LS MOVE · RS TURN/PITCH · LT/RT ALT −/+ · LB+RS AIM · LB+RB FIRE · A ARM · B KILL · X CAM · Y RESET · VIEW EXIT · MENU SETTINGS";
  render();
  return{button,dialog,world,gamepadNavigator,get settings(){return{...droneSettings};},get firstPersonSettings(){return{...firstPersonSettings};},get activeProfile(){return activeProfile;},reload(){droneSettings=loadPhoneControlSettings();firstPersonSettings=loadFirstPersonControlSettings();render();return{...droneSettings};}};
}

export function mountPhoneControlSettings(options={}){return mountControlSettings(options,false);}
export function mountPlayerControlSettings(options={}){return mountControlSettings(options,true);}
