import {DEFAULT_PHONE_SETTINGS,normalizePhoneSettings} from "./control_semantics.mjs";

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
    if(!raw)return normalizePhoneSettings(DEFAULT_PHONE_SETTINGS);const parsed=JSON.parse(raw);
    // one-time: the old 36 km/h default becomes the new 90 km/h default (a speed the player picked stays)
    if(!localStorage.getItem("rushDroneSpeed90")){try{localStorage.setItem("rushDroneSpeed90","1");}catch{}if(Number(parsed?.maxHorizontalSpeedKmh)===36){parsed.maxHorizontalSpeedKmh=DEFAULT_PHONE_SETTINGS.maxHorizontalSpeedKmh;try{localStorage.setItem(PHONE_SETTINGS_KEY,JSON.stringify(normalizePhoneSettings(parsed)));}catch{}}}
    return normalizePhoneSettings(parsed);
  }catch{return normalizePhoneSettings(DEFAULT_PHONE_SETTINGS);}
}

export function savePhoneControlSettings(settings){
  const normalized=normalizePhoneSettings(settings);
  try{localStorage.setItem(PHONE_SETTINGS_KEY,JSON.stringify(normalized));}catch{}
  return normalized;
}
