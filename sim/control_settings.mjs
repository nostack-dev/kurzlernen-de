import {DEFAULT_PHONE_SETTINGS,normalizePhoneSettings,fineLevelToSensitivity,sensitivityToFineLevel} from "./control_semantics.mjs";

export const PHONE_SETTINGS_KEY="arondight45PhoneControlSettingsV3";
export const V2_PHONE_SETTINGS_KEY="arondight45PhoneControlSettingsV2";
export const LEGACY_PHONE_SETTINGS_KEY="arondight45PhoneControlSettingsV1";

const clampLevel=value=>Math.max(1,Math.min(10,Math.round(Number(value)||1)));
export const sensitivityToLevel=value=>sensitivityToFineLevel(value);
export const levelToSensitivity=value=>fineLevelToSensitivity(clampLevel(value));

// V2 used a fifth-power phone expo with a geometrically mapped centre gain.
// Recover the level the user actually saw, then convert that level to the new
// linear RC-stick-throw semantics. This preserves e.g. an existing 10/10.
function v2SensitivityToLevel(value){
  const s=Math.max(.02,Math.min(1,Number(value)||1));
  const t=Math.log(s)/Math.log(.02);
  return clampLevel(1+9*t);
}

function migrateSettings(){
  try{
    const v2=localStorage.getItem(V2_PHONE_SETTINGS_KEY);
    if(v2){
      const old=JSON.parse(v2);
      const leftLevel=v2SensitivityToLevel(old.leftSensitivity),rightLevel=v2SensitivityToLevel(old.rightSensitivity);
      const migrated=normalizePhoneSettings({leftSensitivity:levelToSensitivity(leftLevel),rightSensitivity:levelToSensitivity(rightLevel)});
      localStorage.setItem(PHONE_SETTINGS_KEY,JSON.stringify(migrated));return migrated;
    }
    const v1=localStorage.getItem(LEGACY_PHONE_SETTINGS_KEY);
    if(v1){
      const old=JSON.parse(v1),oldLeft=Number(old.leftSensitivity),oldRight=Number(old.rightSensitivity);
      const leftLevel=clampLevel(Number.isFinite(oldLeft)?oldLeft*10:8),rightLevel=clampLevel(Number.isFinite(oldRight)?oldRight*10:9);
      const migrated=normalizePhoneSettings({leftSensitivity:levelToSensitivity(leftLevel),rightSensitivity:levelToSensitivity(rightLevel)});
      localStorage.setItem(PHONE_SETTINGS_KEY,JSON.stringify(migrated));return migrated;
    }
  }catch{}
  return null;
}

export function loadPhoneControlSettings(){
  try{
    const raw=localStorage.getItem(PHONE_SETTINGS_KEY);
    if(raw)return normalizePhoneSettings(JSON.parse(raw));
    return migrateSettings()||normalizePhoneSettings(DEFAULT_PHONE_SETTINGS);
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
  const style=document.createElement("style");
  style.textContent=`
  .phone-settings-button{white-space:nowrap}
  .phone-settings-dialog{width:min(92vw,380px)!important;border:1px solid #ffffff44!important;border-radius:14px!important;background:#0b1420f4!important;color:#fff!important;padding:16px!important;box-shadow:0 20px 70px #000a!important}
  .phone-settings-dialog::backdrop{background:#0009;backdrop-filter:blur(5px)}
  .phone-settings-dialog h3{margin:0 0 5px;font:800 17px system-ui,-apple-system,sans-serif}
  .phone-settings-dialog p{margin:0 0 14px;color:#aebdd0;font:12px/1.4 system-ui,-apple-system,sans-serif}
  .phone-settings-row{display:grid;grid-template-columns:1fr auto;gap:5px 10px;align-items:center;margin:15px 0}
  .phone-settings-row label{font:750 13px system-ui,-apple-system,sans-serif}
  .phone-settings-row output{font:900 13px ui-monospace,SFMono-Regular,Menlo,monospace;min-width:40px;text-align:right}
  .phone-settings-row input{grid-column:1/3;width:100%;accent-color:#6be4b0}
  .phone-settings-scale{grid-column:1/3;display:flex;justify-content:space-between;color:#8295ad;font:800 9px system-ui,-apple-system,sans-serif;letter-spacing:.08em;margin-top:-3px}
  .phone-settings-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}
  .phone-settings-actions button{border:1px solid #ffffff44;border-radius:9px;background:#162437;color:#fff;padding:8px 12px;font-weight:800}
  .phone-settings-note{font-size:11px!important;color:#8fa1b8!important}
  `;
  document.head.appendChild(style);
}

export function mountPhoneControlSettings({parent,buttonText="SETTINGS",onChange=()=>{}}={}){
  if(!parent)throw Error("settings parent required");
  installStyle();
  let settings=loadPhoneControlSettings();
  const button=document.createElement("button");
  button.type="button";button.className="phone-settings-button";button.textContent=buttonText;button.setAttribute("aria-label","Phone control settings");
  const dialog=document.createElement("dialog");dialog.className="phone-settings-dialog";
  dialog.innerHTML=`
    <h3>CONTROL FINENESS</h3>
    <p>Higher = less sensitive phone-stick control.</p>
    <div class="phone-settings-row">
      <label>LEFT · YAW</label><output data-out="left"></output>
      <input data-slider="left" type="range" min="1" max="10" step="1">
      <div class="phone-settings-scale"><span>DIRECT</span><span>MAX FINE</span></div>
    </div>
    <div class="phone-settings-row">
      <label>RIGHT · ROLL / PITCH</label><output data-out="right"></output>
      <input data-slider="right" type="range" min="1" max="10" step="1">
      <div class="phone-settings-scale"><span>DIRECT</span><span>MAX FINE</span></div>
    </div>
    <p class="phone-settings-note">1 = 100% RC stick throw · 10 = 35% RC stick throw. The flight controller keeps its own real deadband/expo. Throttle and aircraft physics are unchanged.</p>
    <div class="phone-settings-actions"><button type="button" data-reset>DEFAULT</button><button type="button" data-close>CLOSE</button></div>`;
  document.body.appendChild(dialog);parent.appendChild(button);
  const left=dialog.querySelector('[data-slider="left"]'),right=dialog.querySelector('[data-slider="right"]'),leftOut=dialog.querySelector('[data-out="left"]'),rightOut=dialog.querySelector('[data-out="right"]');
  const render=()=>{
    left.value=String(sensitivityToLevel(settings.leftSensitivity));right.value=String(sensitivityToLevel(settings.rightSensitivity));
    leftOut.value=`${left.value}/10`;rightOut.value=`${right.value}/10`;
  };
  const apply=()=>{
    settings=savePhoneControlSettings({leftSensitivity:levelToSensitivity(left.value),rightSensitivity:levelToSensitivity(right.value)});
    render();onChange({...settings});
  };
  left.addEventListener("input",apply);right.addEventListener("input",apply);
  dialog.querySelector("[data-reset]").onclick=()=>{settings=savePhoneControlSettings(DEFAULT_PHONE_SETTINGS);render();onChange({...settings});};
  dialog.querySelector("[data-close]").onclick=()=>dialog.close();
  button.onclick=()=>{settings=loadPhoneControlSettings();render();dialog.showModal();};
  render();
  return{button,dialog,get settings(){return{...settings};},reload(){settings=loadPhoneControlSettings();render();return{...settings};}};
}
