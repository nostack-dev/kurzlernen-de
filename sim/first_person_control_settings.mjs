export const FIRST_PERSON_CONTROL_SETTINGS_KEY="arondight45FirstPersonControlSettingsV1";
export const FIRST_PERSON_CONTROL_SETTINGS_EVENT="arondight:first-person-control-settings";

const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));
const clampFineness=value=>Math.max(1,Math.min(10,Math.round(Number(value)||1)));
const clampSensitivity=value=>Math.max(50,Math.min(150,Math.round(Number(value)||100)));
const clampDeadzone=value=>Math.max(2,Math.min(20,Math.round(Number(value)||8)));
const clampAimAssist=value=>Math.max(0,Math.min(100,Math.round(Number(value)||0)));

export const DEFAULT_FIRST_PERSON_CONTROL_SETTINGS=Object.freeze({
  moveFineness:1,
  lookFineness:6,
  horizontalLookSensitivityPercent:100,
  verticalLookSensitivityPercent:100,
  lookDeadzonePercent:6,
  aimAssistStrengthPercent:55,
  invertMoveHorizontal:false,
  invertLookHorizontal:false,
  invertLookVertical:false,
  lockMoveHorizontal:false,
  lockLookVertical:false,
});

export function normalizeFirstPersonControlSettings(settings={}){
  return{
    moveFineness:clampFineness(settings.moveFineness??DEFAULT_FIRST_PERSON_CONTROL_SETTINGS.moveFineness),
    lookFineness:clampFineness(settings.lookFineness??DEFAULT_FIRST_PERSON_CONTROL_SETTINGS.lookFineness),
    horizontalLookSensitivityPercent:clampSensitivity(settings.horizontalLookSensitivityPercent??DEFAULT_FIRST_PERSON_CONTROL_SETTINGS.horizontalLookSensitivityPercent),
    verticalLookSensitivityPercent:clampSensitivity(settings.verticalLookSensitivityPercent??DEFAULT_FIRST_PERSON_CONTROL_SETTINGS.verticalLookSensitivityPercent),
    lookDeadzonePercent:clampDeadzone(settings.lookDeadzonePercent??DEFAULT_FIRST_PERSON_CONTROL_SETTINGS.lookDeadzonePercent),
    aimAssistStrengthPercent:clampAimAssist(settings.aimAssistStrengthPercent??DEFAULT_FIRST_PERSON_CONTROL_SETTINGS.aimAssistStrengthPercent),
    invertMoveHorizontal:Boolean(settings.invertMoveHorizontal),
    invertLookHorizontal:Boolean(settings.invertLookHorizontal),
    invertLookVertical:Boolean(settings.invertLookVertical),
    lockMoveHorizontal:Boolean(settings.lockMoveHorizontal),
    lockLookVertical:Boolean(settings.lockLookVertical),
  };
}

export function loadFirstPersonControlSettings(){
  try{
    const raw=localStorage.getItem(FIRST_PERSON_CONTROL_SETTINGS_KEY);
    return raw?normalizeFirstPersonControlSettings(JSON.parse(raw)):normalizeFirstPersonControlSettings(DEFAULT_FIRST_PERSON_CONTROL_SETTINGS);
  }catch{return normalizeFirstPersonControlSettings(DEFAULT_FIRST_PERSON_CONTROL_SETTINGS);}
}

function announceFirstPersonControlSettings(settings){
  if(typeof globalThis.dispatchEvent!=="function"||typeof globalThis.CustomEvent!=="function")return;
  globalThis.dispatchEvent(new CustomEvent(FIRST_PERSON_CONTROL_SETTINGS_EVENT,{detail:{settings:{...settings}}}));
}

export function saveFirstPersonControlSettings(settings,{announce=true}={}){
  const normalized=normalizeFirstPersonControlSettings(settings);
  try{localStorage.setItem(FIRST_PERSON_CONTROL_SETTINGS_KEY,JSON.stringify(normalized));}catch{}
  if(announce)announceFirstPersonControlSettings(normalized);
  return normalized;
}

function shapeMagnitude(magnitude,fineness){
  const expo=.60*((clampFineness(fineness)-1)/9),m=clamp(magnitude,0,1);
  return m*(1-expo)+m*m*m*expo;
}

export function shapeFirstPersonMove(x,y,settings=DEFAULT_FIRST_PERSON_CONTROL_SETTINGS){
  const cfg=normalizeFirstPersonControlSettings(settings),rawX=clamp(x,-1,1),rawY=clamp(y,-1,1),effectiveX=cfg.lockMoveHorizontal?0:(cfg.invertMoveHorizontal?-rawX:rawX),magnitude=Math.min(1,Math.hypot(effectiveX,rawY));
  if(magnitude<=1e-9)return{x:0,y:0,magnitude:0};
  const shaped=shapeMagnitude(magnitude,cfg.moveFineness),scale=shaped/magnitude;
  return{x:effectiveX*scale,y:rawY*scale,magnitude:shaped};
}

export function firstPersonLookAxes(x,y,settings=DEFAULT_FIRST_PERSON_CONTROL_SETTINGS){
  const cfg=normalizeFirstPersonControlSettings(settings),rawX=clamp(x,-1,1),rawY=clamp(y,-1,1);
  return{
    x:cfg.invertLookHorizontal?-rawX:rawX,
    y:cfg.lockLookVertical?0:(cfg.invertLookVertical?-rawY:rawY),
  };
}

export function firstPersonLookDelta(x,y,settings=DEFAULT_FIRST_PERSON_CONTROL_SETTINGS){
  const cfg=normalizeFirstPersonControlSettings(settings),rawX=Number(x)||0,rawY=Number(y)||0;
  return{
    x:cfg.invertLookHorizontal?-rawX:rawX,
    y:cfg.lockLookVertical?0:(cfg.invertLookVertical?-rawY:rawY),
  };
}

export function firstPersonLookSensitivity(settings=DEFAULT_FIRST_PERSON_CONTROL_SETTINGS){
  const cfg=normalizeFirstPersonControlSettings(settings);
  return{yaw:cfg.horizontalLookSensitivityPercent/100,pitch:cfg.verticalLookSensitivityPercent/100};
}

export function firstPersonLookCurveStrength(settings=DEFAULT_FIRST_PERSON_CONTROL_SETTINGS){
  return .48*((normalizeFirstPersonControlSettings(settings).lookFineness-1)/9);
}

export function firstPersonLookDeadzone(settings=DEFAULT_FIRST_PERSON_CONTROL_SETTINGS){
  return normalizeFirstPersonControlSettings(settings).lookDeadzonePercent/100;
}

export function firstPersonAimAssistScale(settings=DEFAULT_FIRST_PERSON_CONTROL_SETTINGS){
  return normalizeFirstPersonControlSettings(settings).aimAssistStrengthPercent/100;
}

export function buildFirstPersonLookProfile(baseProfile,settings=DEFAULT_FIRST_PERSON_CONTROL_SETTINGS){
  const base={...baseProfile},assistScale=firstPersonAimAssistScale(settings);
  return Object.freeze({...base,innerDeadzone:firstPersonLookDeadzone(settings),dynamicCurveStrength:firstPersonLookCurveStrength(settings),assistSlowdownStrength:(Number(base.assistSlowdownStrength)||0)*assistScale,assistCorrectionGain:(Number(base.assistCorrectionGain)||0)*assistScale,assistMaxCorrectionRadS:(Number(base.assistMaxCorrectionRadS)||0)*assistScale});
}
