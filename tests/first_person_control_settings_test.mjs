import assert from "node:assert/strict";

const storage=new Map();
globalThis.localStorage={getItem:key=>storage.has(key)?storage.get(key):null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)};
const announcements=[];
globalThis.CustomEvent=class{constructor(type,init={}){this.type=type;this.detail=init.detail;}};
globalThis.dispatchEvent=event=>{announcements.push(event);return true;};

const {DEFAULT_PHONE_SETTINGS,normalizePhoneSettings}=await import("../sim/control_semantics.mjs");
const {PHONE_SETTINGS_KEY,loadPhoneControlSettings,savePhoneControlSettings}=await import("../sim/drone_control_settings.mjs");
const {DEFAULT_FIRST_PERSON_CONTROL_SETTINGS,FIRST_PERSON_CONTROL_SETTINGS_EVENT,FIRST_PERSON_CONTROL_SETTINGS_KEY,buildFirstPersonLookProfile,firstPersonAimAssistScale,firstPersonLookAxes,firstPersonLookCurveStrength,firstPersonLookDeadzone,firstPersonLookDelta,firstPersonLookSensitivity,loadFirstPersonControlSettings,normalizeFirstPersonControlSettings,saveFirstPersonControlSettings,shapeFirstPersonMove}=await import("../sim/first_person_control_settings.mjs");

assert.deepEqual(loadPhoneControlSettings(),normalizePhoneSettings(DEFAULT_PHONE_SETTINGS));
assert.deepEqual(loadFirstPersonControlSettings(),normalizeFirstPersonControlSettings(DEFAULT_FIRST_PERSON_CONTROL_SETTINGS));
assert.equal(DEFAULT_PHONE_SETTINGS.invertRightVertical,true,"drone vertical convention must remain unchanged");
assert.equal(DEFAULT_FIRST_PERSON_CONTROL_SETTINGS.invertLookVertical,false,"first-person look needs its own non-inverted default");

const drone=savePhoneControlSettings({...DEFAULT_PHONE_SETTINGS,leftFineness:9,invertLeftHorizontal:true});
const fps=saveFirstPersonControlSettings({...DEFAULT_FIRST_PERSON_CONTROL_SETTINGS,moveFineness:4,lookFineness:8,horizontalLookSensitivityPercent:73,verticalLookSensitivityPercent:121,lookDeadzonePercent:6,aimAssistStrengthPercent:42,invertLookHorizontal:true});
assert.equal(JSON.parse(storage.get(PHONE_SETTINGS_KEY)).leftFineness,9);
assert.equal(JSON.parse(storage.get(FIRST_PERSON_CONTROL_SETTINGS_KEY)).moveFineness,4);
assert.equal(loadPhoneControlSettings().invertLeftHorizontal,true);
assert.equal(loadFirstPersonControlSettings().invertLookHorizontal,true);
assert.equal(announcements.at(-1)?.type,FIRST_PERSON_CONTROL_SETTINGS_EVENT);
assert.deepEqual(announcements.at(-1)?.detail?.settings,fps);

saveFirstPersonControlSettings({...fps,moveFineness:2});
assert.deepEqual(loadPhoneControlSettings(),drone,"saving FIRST PERSON must not mutate DRONE");
savePhoneControlSettings({...drone,rightFineness:3});
assert.equal(loadFirstPersonControlSettings().moveFineness,2,"saving DRONE must not mutate FIRST PERSON");

const clamped=normalizeFirstPersonControlSettings({moveFineness:99,lookFineness:-4,horizontalLookSensitivityPercent:999,verticalLookSensitivityPercent:1,lookDeadzonePercent:90,aimAssistStrengthPercent:-5});
assert.deepEqual({move:clamped.moveFineness,look:clamped.lookFineness,horizontal:clamped.horizontalLookSensitivityPercent,vertical:clamped.verticalLookSensitivityPercent,deadzone:clamped.lookDeadzonePercent,assist:clamped.aimAssistStrengthPercent},{move:10,look:1,horizontal:150,vertical:50,deadzone:20,assist:0});

const direct=shapeFirstPersonMove(.5,-.25,DEFAULT_FIRST_PERSON_CONTROL_SETTINGS),fine=shapeFirstPersonMove(.5,-.25,{...DEFAULT_FIRST_PERSON_CONTROL_SETTINGS,moveFineness:10}),inverted=shapeFirstPersonMove(.5,-.25,{...DEFAULT_FIRST_PERSON_CONTROL_SETTINGS,invertMoveHorizontal:true}),locked=shapeFirstPersonMove(.5,-.25,{...DEFAULT_FIRST_PERSON_CONTROL_SETTINGS,lockMoveHorizontal:true});
assert.ok(Math.abs(direct.x-.5)<1e-12&&Math.abs(direct.y+.25)<1e-12);
assert.ok(Math.hypot(fine.x,fine.y)<Math.hypot(direct.x,direct.y),"movement fineness must soften centre travel");
assert.ok(inverted.x<0&&inverted.y<0);
assert.equal(locked.x,0);

const lookAxes=firstPersonLookAxes(.4,-.6,{...DEFAULT_FIRST_PERSON_CONTROL_SETTINGS,invertLookHorizontal:true,invertLookVertical:true}),lookLocked=firstPersonLookAxes(.4,-.6,{...DEFAULT_FIRST_PERSON_CONTROL_SETTINGS,lockLookVertical:true}),lookDelta=firstPersonLookDelta(18,-27,{...DEFAULT_FIRST_PERSON_CONTROL_SETTINGS,invertLookHorizontal:true,invertLookVertical:true});
assert.deepEqual(lookAxes,{x:-.4,y:.6});assert.deepEqual(lookLocked,{x:.4,y:0});assert.deepEqual(lookDelta,{x:-18,y:27});
assert.deepEqual(firstPersonLookSensitivity(fps),{yaw:.73,pitch:1.21});
assert.equal(firstPersonLookDeadzone(fps),.06);assert.equal(firstPersonAimAssistScale(fps),.42);assert.ok(firstPersonLookCurveStrength(fps)>firstPersonLookCurveStrength(DEFAULT_FIRST_PERSON_CONTROL_SETTINGS));
const lookProfile=buildFirstPersonLookProfile({innerDeadzone:.08,dynamicCurveStrength:.04,assistSlowdownStrength:.34,assistCorrectionGain:4,assistMaxCorrectionRadS:.38},fps);assert.equal(lookProfile.innerDeadzone,.06);assert.ok(Math.abs(lookProfile.assistSlowdownStrength-.1428)<1e-12);assert.ok(Math.abs(lookProfile.assistCorrectionGain-1.68)<1e-12);assert.ok(Math.abs(lookProfile.assistMaxCorrectionRadS-.1596)<1e-12);assert.equal(Object.isFrozen(lookProfile),true);

console.log("Independent DRONE/FIRST PERSON control profile tests passed.");
