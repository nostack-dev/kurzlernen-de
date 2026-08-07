import {DEFAULT_PHONE_SETTINGS,normalizePhoneSettings} from "./control_semantics.mjs";

export const PHONE_SETTINGS_KEY="arondight45PhoneControlSettingsV4";
const OBSOLETE_KEYS=[
  "arondight45PhoneControlSettingsV1",
  "arondight45PhoneControlSettingsV2",
  "arondight45PhoneControlSettingsV3",
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
  const style=document.createElement("style");
  style.textContent=`
  .phone-settings-button{white-space:nowrap}
  .phone-settings-dialog{width:min(92vw,390px)!important;border:1px solid #ffffff44!important;border-radius:14px!important;background:#0b1420f4!important;color:#fff!important;padding:16px!important;box-shadow:0 20px 70px #000a!important}
  .phone-settings-dialog::backdrop{background:#0009;backdrop-filter:blur(5px)}
  .phone-settings-dialog h3{margin:0 0 5px;font:800 17px system-ui,-apple-system,sans-serif}
  .phone-settings-dialog p{margin:0 0 14px;color:#aebdd0;font:12px/1.4 system-ui,-apple-system,sans-serif}
  .phone-settings-row{display:grid;grid-template-columns:1fr auto;gap:5px 10px;align-items:center;margin:15px 0}
  .phone-settings-row label{font:750 13px system-ui,-apple-system,sans-serif}
  .phone-settings-row output{font:900 13px ui-monospace,SFMono-Regular,Menlo,monospace;min-width:40px;text-align:right}
  .phone-settings-row input[type=range]{grid-column:1/3;width:100%;accent-color:#6be4b0}
  .phone-settings-scale{grid-column:1/3;display:flex;justify-content:space-between;color:#8295ad;font:800 9px system-ui,-apple-system,sans-serif;letter-spacing:.08em;margin-top:-3px}
  .phone-settings-toggle{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:18px 0 8px;padding:10px 0;border-top:1px solid #ffffff22;border-bottom:1px solid #ffffff22;font:750 13px system-ui,-apple-system,sans-serif}
  .phone-settings-toggle input{width:22px;height:22px;accent-color:#6be4b0}
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
    <h3>PHONE CONTROLS</h3>
    <p>Higher fineness softens only the centre of the virtual gimbal. Full stick always stays full command.</p>
    <div class="phone-settings-row">
      <label>LEFT · YAW FINENESS</label><output data-out="left"></output>
      <input data-slider="left" type="range" min="1" max="10" step="1">
      <div class="phone-settings-scale"><span>DIRECT</span><span>MAX FINE</span></div>
    </div>
    <div class="phone-settings-row">
      <label>RIGHT · ROLL / PITCH FINENESS</label><output data-out="right"></output>
      <input data-slider="right" type="range" min="1" max="10" step="1">
      <div class="phone-settings-scale"><span>DIRECT</span><span>MAX FINE</span></div>
    </div>
    <label class="phone-settings-toggle"><span>LOCK LEFT STICK HORIZONTAL AXIS</span><input data-lock-left-horizontal type="checkbox"></label>
    <label class="phone-settings-toggle"><span>LOCK RIGHT STICK HORIZONTAL AXIS</span><input data-lock-horizontal type="checkbox"></label>
    <p class="phone-settings-note">Left lock ON = throttle only; yaw stays centred. Right lock ON = roll only; pitch stays centred. Flight-controller code, motor/prop model and aircraft physics are never changed by these settings.</p>
    <div class="phone-settings-actions"><button type="button" data-reset>DEFAULT</button><button type="button" data-close>CLOSE</button></div>`;
  document.body.appendChild(dialog);parent.appendChild(button);
  const left=dialog.querySelector('[data-slider="left"]'),right=dialog.querySelector('[data-slider="right"]');
  const leftOut=dialog.querySelector('[data-out="left"]'),rightOut=dialog.querySelector('[data-out="right"]');
  const lockLeft=dialog.querySelector("[data-lock-left-horizontal]"),lock=dialog.querySelector("[data-lock-horizontal]");
  const render=()=>{
    left.value=String(settings.leftFineness);right.value=String(settings.rightFineness);
    leftOut.value=`${left.value}/10`;rightOut.value=`${right.value}/10`;lockLeft.checked=settings.lockLeftHorizontal;lock.checked=settings.lockRightHorizontal;
  };
  const apply=()=>{
    settings=savePhoneControlSettings({
      leftFineness:Number(left.value),
      rightFineness:Number(right.value),
      lockLeftHorizontal:lockLeft.checked,
      lockRightHorizontal:lock.checked,
    });
    render();onChange({...settings});
  };
  left.addEventListener("input",apply);right.addEventListener("input",apply);lockLeft.addEventListener("change",apply);lock.addEventListener("change",apply);
  dialog.querySelector("[data-reset]").onclick=()=>{settings=savePhoneControlSettings(DEFAULT_PHONE_SETTINGS);render();onChange({...settings});};
  dialog.querySelector("[data-close]").onclick=()=>dialog.close();
  button.onclick=()=>{settings=loadPhoneControlSettings();render();dialog.showModal();};
  render();
  return{button,dialog,get settings(){return{...settings};},reload(){settings=loadPhoneControlSettings();render();return{...settings};}};
}
