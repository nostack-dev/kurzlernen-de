import {DEFAULT_PHONE_SETTINGS,normalizePhoneSettings,MIN_GAME_HORIZONTAL_SPEED_KMH,MAX_GAME_HORIZONTAL_SPEED_KMH} from "./control_semantics.mjs";
import {installSoloFlightLayout} from "./solo_layout.mjs";

export const PHONE_SETTINGS_KEY="arondight45PhoneControlSettingsV5";
const OBSOLETE_KEYS=[
  "arondight45PhoneControlSettingsV1",
  "arondight45PhoneControlSettingsV2",
  "arondight45PhoneControlSettingsV3",
  "arondight45PhoneControlSettingsV4",
];
const GAMEPAD_MENU_BUTTON=Object.freeze({A:0,B:1,START:9,DPAD_UP:12,DPAD_DOWN:13,DPAD_LEFT:14,DPAD_RIGHT:15});
const GAMEPAD_FLIGHT_BUTTONS=Object.freeze([0,1,2,3,4,5,6,7,9]);

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

function gamepadButtonPressed(gamepad,index){
  const value=gamepad?.buttons?.[index];return typeof value==="number"?value>.5:Boolean(value?.pressed||Number(value?.value)>.5);
}
function settingsGamepad(){
  try{return Array.from(navigator.getGamepads?.()||[]).find(pad=>pad?.connected&&(pad.mapping==="standard"||/xbox|xinput|045e/i.test(String(pad.id||""))))||null;}catch{return null;}
}
function flightGamepadNeutral(gamepad){
  if(!gamepad)return true;const axes=[0,1,2,3].every(index=>Math.abs(Number(gamepad.axes?.[index])||0)<.24),buttons=GAMEPAD_FLIGHT_BUTTONS.every(index=>!gamepadButtonPressed(gamepad,index));return axes&&buttons;
}
function visibleDialogControls(dialog){
  return Array.from(dialog.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')).filter(element=>{
    if(!(element instanceof HTMLElement))return false;const style=getComputedStyle(element);return style.display!=="none"&&style.visibility!=="hidden"&&element.getClientRects().length>0;
  });
}
function focusDialogControl(dialog,delta=0){
  const controls=visibleDialogControls(dialog);if(!controls.length)return false;let index=controls.indexOf(document.activeElement);if(index<0)index=delta<0?0:-1;index=(index+delta+controls.length)%controls.length;const target=controls[index];target.focus({preventScroll:true});target.scrollIntoView({block:"nearest",inline:"nearest"});return true;
}
function activateDialogControl(dialog){
  const element=document.activeElement;if(!(element instanceof HTMLElement)||!dialog.contains(element)){focusDialogControl(dialog,1);return true;}
  if(element instanceof HTMLInputElement&&(element.type==="checkbox"||element.type==="radio")){element.click();return true;}
  if(element instanceof HTMLButtonElement){element.click();return true;}
  if(element instanceof HTMLSelectElement){try{element.showPicker?.();}catch{}return true;}
  return false;
}
function adjustDialogControl(dialog,direction){
  const element=document.activeElement;if(!(element instanceof HTMLElement)||!dialog.contains(element))return focusDialogControl(dialog,direction);
  if(element instanceof HTMLInputElement&&element.type==="range"){
    const min=Number.isFinite(Number(element.min))?Number(element.min):-Infinity,max=Number.isFinite(Number(element.max))?Number(element.max):Infinity,step=Number(element.step)||1,next=Math.max(min,Math.min(max,Number(element.value)+step*Math.sign(direction)));if(next===Number(element.value))return true;element.value=String(next);element.dispatchEvent(new Event("input",{bubbles:true}));return true;
  }
  if(element instanceof HTMLInputElement&&(element.type==="checkbox"||element.type==="radio")){
    const next=direction>0;if(element.checked!==next){element.checked=next;element.dispatchEvent(new Event("change",{bubbles:true}));}return true;
  }
  if(element instanceof HTMLSelectElement){const next=Math.max(0,Math.min(element.options.length-1,element.selectedIndex+Math.sign(direction)));if(next!==element.selectedIndex){element.selectedIndex=next;element.dispatchEvent(new Event("change",{bubbles:true}));}return true;}
  return focusDialogControl(dialog,direction);
}
function installGamepadDialogNavigation({dialog,openDialog,closeDialog}){
  let previous=Array(16).fill(false),axisX=0,axisY=0,nextAxisX=0,nextAxisY=0,raf=0;
  const pulseAxis=(now,axis,previousAxis,nextAt,negative,positive,action)=>{
    const direction=axis<-.62?-1:axis>.62?1:0;if(!direction)return{held:0,next:0};const changed=direction!==previousAxis;if(changed||now>=nextAt){action(direction<0?negative:positive);return{held:direction,next:now+(changed?300:145)};}return{held:previousAxis,next:nextAt};
  };
  const frame=now=>{
    const pad=settingsGamepad();if(!pad){previous.fill(false);axisX=axisY=0;nextAxisX=nextAxisY=0;raf=requestAnimationFrame(frame);return;}
    const current=previous.map((_,index)=>gamepadButtonPressed(pad,index)),edge=index=>current[index]&&!previous[index];
    if(edge(GAMEPAD_MENU_BUTTON.START)){if(dialog.open)closeDialog();else openDialog({gamepad:true});}
    if(dialog.open){
      if(edge(GAMEPAD_MENU_BUTTON.B))closeDialog();else{
        if(edge(GAMEPAD_MENU_BUTTON.A))activateDialogControl(dialog);
        if(edge(GAMEPAD_MENU_BUTTON.DPAD_UP))focusDialogControl(dialog,-1);
        if(edge(GAMEPAD_MENU_BUTTON.DPAD_DOWN))focusDialogControl(dialog,1);
        if(edge(GAMEPAD_MENU_BUTTON.DPAD_LEFT))adjustDialogControl(dialog,-1);
        if(edge(GAMEPAD_MENU_BUTTON.DPAD_RIGHT))adjustDialogControl(dialog,1);
        const x=Number(pad.axes?.[0])||0,y=Number(pad.axes?.[1])||0;
        const yState=pulseAxis(now,y,axisY,nextAxisY,-1,1,direction=>focusDialogControl(dialog,direction));axisY=yState.held;nextAxisY=yState.next;
        const xState=pulseAxis(now,x,axisX,nextAxisX,-1,1,direction=>adjustDialogControl(dialog,direction));axisX=xState.held;nextAxisX=xState.next;
      }
    }else{axisX=axisY=0;nextAxisX=nextAxisY=0;}
    previous=current;raf=requestAnimationFrame(frame);
  };
  raf=requestAnimationFrame(frame);return()=>cancelAnimationFrame(raf);
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
  .phone-settings-dialog :is(button,input,select,textarea):focus{outline:3px solid #6be4b0!important;outline-offset:3px!important;box-shadow:0 0 0 2px #071522,0 0 18px #6be4b077!important}
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
  .phone-settings-toggle.fullscreen-inactive{opacity:.52}
  .phone-settings-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}
  .phone-settings-actions button,.world-settings-actions button{border:1px solid #ffffff44;border-radius:9px;background:#162437;color:#fff;padding:8px 12px;font-weight:800}
  .phone-settings-note{font-size:11px!important;color:#8fa1b8!important}
  .world-settings-section label{font:750 13px system-ui,-apple-system,sans-serif;display:block;margin:12px 0 6px}
  .world-settings-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0}
  .world-settings-actions [data-world-use]{background:#175f49;border-color:#2e9b77}
  .world-settings-status{padding:9px 10px;margin:8px 0 10px;border:1px solid #ffffff2e;border-radius:9px;background:#07101a;color:#9db0c9;font:750 11px/1.35 system-ui,-apple-system,sans-serif}
  body.gamepad-settings-open #soloLeft,body.gamepad-settings-open #soloRight,body.gamepad-settings-open #soloClearance,body.gamepad-settings-open #soloArm,body.gamepad-settings-open #soloKill{display:none!important}
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
    <p class="phone-settings-note">Esri World Imagery aerial/satellite pixels + OpenFreeMap/OpenStreetMap roads and 3D building footprints. No account, API key, billing setup, backend or proxy is required.</p>
    <div class="world-settings-status" data-world-status>TRAINING RANGE · local metric world</div>
    <div class="world-settings-actions"><button type="button" data-world-use>USE MY GPS LOCATION</button><button type="button" data-world-training>TRAINING RANGE</button></div>
    <label class="phone-settings-toggle"><span>REAL AERIAL / SATELLITE MAP</span><input data-world-imagery type="checkbox"></label>
    <label class="phone-settings-toggle"><span>WORLD GRID</span><input data-world-grid type="checkbox"></label>
    <label class="phone-settings-toggle"><span>KEEP 360° LOOK ORIENTATION</span><input data-world-keep-look type="checkbox"></label>
    <label class="phone-settings-toggle"><span>LOCK MINIMAP AXIS TO VERTICAL</span><input data-world-minimap-axis-lock type="checkbox"></label>
    <p class="phone-settings-note">REAL AERIAL / SATELLITE MAP is ON by default in both the flight view and minimap. WORLD GRID is a render-only local metre reference. 360° LOOK is camera-only: OFF snaps smoothly back on release; ON keeps the released orientation. LOCK MINIMAP AXIS is ON by default and keeps the orthographic top-down map north-up during persistent look/orientation changes outside fullscreen. Fullscreen always uses its native landscape/north-up policy.</p>
    <p class="phone-settings-note">Nearby loaded OSM building footprints, holes and available min/max heights are installed as bounded static Box3D collision prisms, so the airframe collides with walls and roofs. Imagery, roads and flat ground remain geospatial context; OSM geometry is approximate, not surveyed 1:1 world truth. Motor, sensor and FC authority stay on the same hardware-fit path.</p>`;
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
  let settings=loadPhoneControlSettings(),resumeToken=0;
  const button=document.createElement("button");
  button.type="button";button.className="phone-settings-button";button.textContent=buttonText;button.setAttribute("aria-label","Phone control settings");
  const dialog=document.createElement("dialog");dialog.className="phone-settings-dialog";
  dialog.innerHTML=`
    <h3>PHONE CONTROLS</h3>
    <p>Higher fineness softens only the centre of each virtual stick. In GAME, full translation stick reaches the selected horizontal-speed envelope while the flight controller still enforces physical tilt and acceleration limits.</p>
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
      <label>MAX HORIZONTAL SPEED</label><output data-out="speed"></output>
      <input data-slider="speed" type="range" min="${MIN_GAME_HORIZONTAL_SPEED_KMH}" max="${MAX_GAME_HORIZONTAL_SPEED_KMH}" step="1">
      <div class="phone-settings-scale"><span>${MIN_GAME_HORIZONTAL_SPEED_KMH} km/h</span><span>${MAX_GAME_HORIZONTAL_SPEED_KMH} km/h</span></div>
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
    ${xboxControllerToggle?'<label class="phone-settings-toggle"><span>XBOX CONTROLLER</span><input data-xbox-controller type="checkbox"></label><p class="phone-settings-note">OFF is the default and keeps touch controls active. ON reserves Xbox/standard-gamepad control and removes every touch flight control from the image, including while the selected controller reconnects. Controller menu: START open/close · D-PAD/LEFT STICK navigate · A select · B back/close.</p>':''}
    ${debugGrid?'<label class="phone-settings-toggle"><span>DEBUG GRIDLINES</span><input data-debug-grid type="checkbox"></label><p class="phone-settings-note">DEBUG GRIDLINES affect only the local training renderer. They never alter WORLD GRID, sensors, collision, FC state or physics.</p>':''}
    ${box3dColliderDebug?'<label class="phone-settings-toggle"><span>DEBUG COLLISION DRAW</span><input data-box3d-collider-debug type="checkbox"></label><p class="phone-settings-note">DEBUG COLLISION DRAW is render-only. OFF immediately hides Box3D ground, airframe and building collider wireframes and persists OFF locally.</p>':''}
    <p class="phone-settings-note">Left X invert reverses MANUAL yaw / GAME strafe. Right X/Y invert independently reverse TURN and body pitch. MAX HORIZONTAL SPEED scales the real GAME velocity request sent through SBUS to the shared StateController; acceleration, tilt, mixer and motor authority remain flight-controller bounded. Settings are stored locally on this device.</p>
    <div class="phone-settings-actions"><button type="button" data-reset>DEFAULT</button><button type="button" data-close>CLOSE</button></div>`;
  document.body.appendChild(dialog);parent.appendChild(button);
  const left=dialog.querySelector('[data-slider="left"]'),right=dialog.querySelector('[data-slider="right"]'),speed=dialog.querySelector('[data-slider="speed"]'),hover=dialog.querySelector('[data-slider="hover"]');
  const leftOut=dialog.querySelector('[data-out="left"]'),rightOut=dialog.querySelector('[data-out="right"]'),speedOut=dialog.querySelector('[data-out="speed"]'),hoverOut=dialog.querySelector('[data-out="hover"]');
  const invertLeft=dialog.querySelector("[data-invert-left-horizontal]"),invertRight=dialog.querySelector("[data-invert-right-horizontal]"),invertRightVertical=dialog.querySelector("[data-invert-right-vertical]"),lockLeft=dialog.querySelector("[data-lock-left-horizontal]"),lock=dialog.querySelector("[data-lock-horizontal]"),xboxControllerInput=dialog.querySelector("[data-xbox-controller]"),debugGridInput=dialog.querySelector("[data-debug-grid]"),box3dColliderDebugInput=dialog.querySelector("[data-box3d-collider-debug]");
  const render=()=>{
    left.value=String(settings.leftFineness);right.value=String(settings.rightFineness);speed.value=String(settings.maxHorizontalSpeedKmh);hover.value=String(settings.defaultHoverAgl);
    leftOut.value=`${left.value}/10`;rightOut.value=`${right.value}/10`;speedOut.value=`${Math.round(Number(speed.value))} km/h`;hoverOut.value=`${Number(hover.value).toFixed(1)} m`;invertLeft.checked=settings.invertLeftHorizontal;invertRight.checked=settings.invertRightHorizontal;invertRightVertical.checked=settings.invertRightVertical;lockLeft.checked=settings.lockLeftHorizontal;lock.checked=settings.lockRightHorizontal;if(xboxControllerInput)xboxControllerInput.checked=settings.xboxControllerEnabled!==false;if(debugGridInput)debugGridInput.checked=Boolean(debugGrid?.get?.());if(box3dColliderDebugInput)box3dColliderDebugInput.checked=Boolean(box3dColliderDebug?.get?.());
  };
  const syncGamepadMenuClass=()=>document.body.classList.toggle("gamepad-settings-open",Boolean(dialog.open&&settings.xboxControllerEnabled));
  const emitChange=()=>{syncGamepadMenuClass();onChange({...settings,xboxControllerEnabled:dialog.open&&settings.xboxControllerEnabled?false:settings.xboxControllerEnabled});};
  const apply=()=>{
    settings=savePhoneControlSettings({
      leftFineness:Number(left.value),
      rightFineness:Number(right.value),
      maxHorizontalSpeedKmh:Number(speed.value),
      defaultHoverAgl:Number(hover.value),
      invertLeftHorizontal:invertLeft.checked,
      invertRightHorizontal:invertRight.checked,
      invertRightVertical:invertRightVertical.checked,
      lockLeftHorizontal:lockLeft.checked,
      lockRightHorizontal:lock.checked,
      xboxControllerEnabled:xboxControllerInput?xboxControllerInput.checked:settings.xboxControllerEnabled,
    });
    render();emitChange();
  };
  left.addEventListener("input",apply);right.addEventListener("input",apply);speed.addEventListener("input",apply);hover.addEventListener("input",apply);invertLeft.addEventListener("change",apply);invertRight.addEventListener("change",apply);invertRightVertical.addEventListener("change",apply);lockLeft.addEventListener("change",apply);lock.addEventListener("change",apply);if(xboxControllerInput)xboxControllerInput.addEventListener("change",apply);if(debugGridInput)debugGridInput.addEventListener("change",()=>{debugGrid?.set?.(debugGridInput.checked);render();});if(box3dColliderDebugInput)box3dColliderDebugInput.addEventListener("change",()=>{box3dColliderDebug?.set?.(box3dColliderDebugInput.checked);render();});
  dialog.querySelector("[data-reset]").onclick=()=>{settings=savePhoneControlSettings(DEFAULT_PHONE_SETTINGS);debugGrid?.set?.(Boolean(debugGrid?.defaultValue));box3dColliderDebug?.set?.(Boolean(box3dColliderDebug?.defaultValue));render();emitChange();};
  const openDialog=()=>{if(dialog.open)return;resumeToken++;settings=loadPhoneControlSettings();render();dialog.showModal();syncGamepadMenuClass();emitChange();requestAnimationFrame(()=>{if(!dialog.contains(document.activeElement))focusDialogControl(dialog,1);});};
  const closeDialog=()=>{if(dialog.open)dialog.close();};
  const restoreFlightAfterMenu=()=>{
    const token=++resumeToken;if(!settings.xboxControllerEnabled){document.body.classList.remove("gamepad-settings-open");onChange({...settings});button.focus({preventScroll:true});return;}
    document.body.classList.add("gamepad-settings-open");const wait=()=>{if(token!==resumeToken||dialog.open)return;if(!flightGamepadNeutral(settingsGamepad())){requestAnimationFrame(wait);return;}document.body.classList.remove("gamepad-settings-open");onChange({...settings});button.focus({preventScroll:true});};requestAnimationFrame(wait);
  };
  dialog.querySelector("[data-close]").onclick=closeDialog;
  dialog.addEventListener("close",restoreFlightAfterMenu);
  button.onclick=openDialog;
  const world=mountSoloWorldSettings({parent,dialog,settingsButton:button});
  if(xboxControllerToggle)installGamepadDialogNavigation({dialog,openDialog,closeDialog});
  render();
  return{button,dialog,world,get settings(){return{...settings};},reload(){settings=loadPhoneControlSettings();render();return{...settings};}};
}