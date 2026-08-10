// Camera settings remain optics-only; WORLD look is applied later by the geospatial render adapter.
// Flight/control timing is intentionally independent of camera and map render FPS.
export const CAMERA_SETTINGS_KEY="arondight45CameraSettingsV1";
export const CAMERA_SETTINGS_EVENT="arondight-camera-settings";
export const DEFAULT_CAMERA_SETTINGS=Object.freeze({fpvTiltDeg:-15,fpvFovDeg:105,thirdDistanceM:1.5});
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
export function normalizeCameraSettings(value={}){
  return{
    fpvTiltDeg:clamp(Number.isFinite(+value.fpvTiltDeg)?+value.fpvTiltDeg:DEFAULT_CAMERA_SETTINGS.fpvTiltDeg,-15,50),
    fpvFovDeg:clamp(Number.isFinite(+value.fpvFovDeg)?+value.fpvFovDeg:DEFAULT_CAMERA_SETTINGS.fpvFovDeg,50,120),
    thirdDistanceM:clamp(Number.isFinite(+value.thirdDistanceM)?+value.thirdDistanceM:DEFAULT_CAMERA_SETTINGS.thirdDistanceM,1.5,6),
  };
}
export function loadCameraSettings(){
  try{const raw=localStorage.getItem(CAMERA_SETTINGS_KEY);return normalizeCameraSettings(raw?JSON.parse(raw):DEFAULT_CAMERA_SETTINGS);}catch{return normalizeCameraSettings(DEFAULT_CAMERA_SETTINGS);}
}
export function saveCameraSettings(settings){
  const next=normalizeCameraSettings(settings);
  try{localStorage.setItem(CAMERA_SETTINGS_KEY,JSON.stringify(next));}catch{}
  try{if(typeof globalThis.dispatchEvent==="function"&&typeof CustomEvent!=="undefined")globalThis.dispatchEvent(new CustomEvent(CAMERA_SETTINGS_EVENT,{detail:{...next}}));}catch{}
  return next;
}
export function mountCameraSettings({dialog,onChange=()=>{}}={}){
  if(!dialog)throw Error("camera settings dialog required");
  let settings=loadCameraSettings();
  const section=document.createElement("section");section.className="camera-settings-section";
  section.innerHTML=`
    <h4>CAMERA</h4>
    <div class="phone-settings-row"><label>FPV VERTICAL TILT</label><output data-camera-out="tilt"></output><input data-camera-slider="tilt" type="range" min="-15" max="50" step="1"><div class="phone-settings-scale"><span>DOWN</span><span>UP</span></div></div>
    <div class="phone-settings-row"><label>FPV FOV</label><output data-camera-out="fov"></output><input data-camera-slider="fov" type="range" min="50" max="120" step="1"><div class="phone-settings-scale"><span>NARROW</span><span>WIDE</span></div></div>
    <div class="phone-settings-row"><label>THIRD PERSON DISTANCE</label><output data-camera-out="third"></output><input data-camera-slider="third" type="range" min="1.5" max="6" step="0.1"><div class="phone-settings-scale"><span>NEAR</span><span>FAR</span></div></div>
    <p class="phone-settings-note">Camera-only optics. FPV FOV is the same value controlled by pinch on the minimap; it never alters aircraft attitude, motor commands, flight-controller code or physics.</p>`;
  const actions=dialog.querySelector(".phone-settings-actions");dialog.insertBefore(section,actions);
  const tilt=section.querySelector('[data-camera-slider="tilt"]'),fov=section.querySelector('[data-camera-slider="fov"]'),third=section.querySelector('[data-camera-slider="third"]');
  const tiltOut=section.querySelector('[data-camera-out="tilt"]'),fovOut=section.querySelector('[data-camera-out="fov"]'),thirdOut=section.querySelector('[data-camera-out="third"]');
  const render=()=>{tilt.value=String(settings.fpvTiltDeg);fov.value=String(settings.fpvFovDeg);third.value=String(settings.thirdDistanceM);tiltOut.value=`${Math.round(settings.fpvTiltDeg)}°`;fovOut.value=`${Math.round(settings.fpvFovDeg)}°`;thirdOut.value=`${settings.thirdDistanceM.toFixed(1)} m`;};
  const apply=()=>{settings=saveCameraSettings({fpvTiltDeg:+tilt.value,fpvFovDeg:+fov.value,thirdDistanceM:+third.value});render();onChange({...settings});};
  for(const input of [tilt,fov,third])input.addEventListener("input",apply);
  const sync=event=>{settings=normalizeCameraSettings(event?.detail||loadCameraSettings());render();onChange({...settings});};
  globalThis.addEventListener?.(CAMERA_SETTINGS_EVENT,sync);
  dialog.querySelector("[data-reset]")?.addEventListener("click",()=>{settings=saveCameraSettings(DEFAULT_CAMERA_SETTINGS);render();onChange({...settings});});
  render();onChange({...settings});
  return{section,get settings(){return{...settings};},reload(){settings=loadCameraSettings();render();onChange({...settings});return{...settings};}};
}
