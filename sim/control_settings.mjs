import {DEFAULT_PHONE_SETTINGS,normalizePhoneSettings} from "./control_semantics.mjs";

export const PHONE_SETTINGS_KEY="arondight45PhoneControlSettingsV1";

export function loadPhoneControlSettings(){
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
  .phone-settings-dialog{width:min(92vw,360px)!important;border:1px solid #ffffff44!important;border-radius:14px!important;background:#0b1420f2!important;color:#fff!important;padding:16px!important;box-shadow:0 20px 70px #000a!important}
  .phone-settings-dialog::backdrop{background:#0009;backdrop-filter:blur(5px)}
  .phone-settings-dialog h3{margin:0 0 4px;font:800 17px system-ui,-apple-system,sans-serif}
  .phone-settings-dialog p{margin:0 0 14px;color:#aebdd0;font:12px/1.4 system-ui,-apple-system,sans-serif}
  .phone-settings-row{display:grid;grid-template-columns:1fr auto;gap:5px 10px;align-items:center;margin:13px 0}
  .phone-settings-row label{font:750 13px system-ui,-apple-system,sans-serif}
  .phone-settings-row output{font:800 13px ui-monospace,SFMono-Regular,Menlo,monospace}
  .phone-settings-row input{grid-column:1/3;width:100%;accent-color:#6be4b0}
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
    <h3>CONTROL SENSITIVITY</h3>
    <p>Lower = finer around centre. Full stick always remains 100% command.</p>
    <div class="phone-settings-row"><label>LEFT · YAW</label><output data-out="left"></output><input data-slider="left" type="range" min="10" max="100" step="5"></div>
    <div class="phone-settings-row"><label>RIGHT · ROLL / PITCH</label><output data-out="right"></output><input data-slider="right" type="range" min="10" max="100" step="5"></div>
    <p class="phone-settings-note">Throttle stays linear. Flight controller, motor model and physics are unchanged.</p>
    <div class="phone-settings-actions"><button type="button" data-reset>DEFAULT</button><button type="button" data-close>CLOSE</button></div>`;
  document.body.appendChild(dialog);parent.appendChild(button);
  const left=dialog.querySelector('[data-slider="left"]'),right=dialog.querySelector('[data-slider="right"]'),leftOut=dialog.querySelector('[data-out="left"]'),rightOut=dialog.querySelector('[data-out="right"]');
  const render=()=>{left.value=String(Math.round(settings.leftSensitivity*100));right.value=String(Math.round(settings.rightSensitivity*100));leftOut.value=`${left.value}%`;rightOut.value=`${right.value}%`;};
  const apply=()=>{
    settings=savePhoneControlSettings({leftSensitivity:+left.value/100,rightSensitivity:+right.value/100});render();onChange({...settings});
  };
  left.addEventListener("input",apply);right.addEventListener("input",apply);
  dialog.querySelector("[data-reset]").onclick=()=>{settings=savePhoneControlSettings(DEFAULT_PHONE_SETTINGS);render();onChange({...settings});};
  dialog.querySelector("[data-close]").onclick=()=>dialog.close();
  button.onclick=()=>{settings=loadPhoneControlSettings();render();dialog.showModal();};
  render();
  return{button,dialog,get settings(){return{...settings};},reload(){settings=loadPhoneControlSettings();render();return{...settings};}};
}
