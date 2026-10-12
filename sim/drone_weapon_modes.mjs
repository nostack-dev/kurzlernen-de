// Non-nuclear drone weapon cycle: GUN, ROCKETS, GUIDED only.
// Keeps the old gameplay API; blocks any persisted legacy nuclear selection.
const KEY="arondight45DroneWeaponExtendedV1";
const MODES=["gun","missile","guided"];
let patched=null,selected="gun";
const view=()=>document.getElementById("viewport");
function persist(mode){try{localStorage.setItem(KEY,mode);}catch{}}
function stored(){try{const v=localStorage.getItem(KEY);return MODES.includes(v)?v:"gun";}catch{return"gun";}}
function patch(){const api=globalThis.__arondightDroneWeapons;if(!api||api===patched)return;patched=api;
  const baseSet=api.setMode?.bind(api),legacyFire=api.fireMissile?.bind(api);
  function select(mode){if(!MODES.includes(mode))return selected;selected=mode;persist(mode);
    baseSet?.(mode==="gun"?"gun":"missile");const v=view();if(v)v.dataset.droneExtendedWeapon=selected;return selected;}
  api.setMode=select;api.toggle=()=>select(MODES[(MODES.indexOf(selected)+1)%MODES.length]);
  api.fireMissile=args=>{
    if(performance.now()<(Number(globalThis.__arondightWeaponLockUntil)||0))return false;
    if(selected==="guided")return Boolean(globalThis.__arondightGuidedMissile?.press?.(args));
    if(selected!=="missile")return false;
    // Always prefer the fixed-screen-ray missile registered by direct_fire_missiles.
    // That module may initialize either before or after this mode selector.
    return Boolean((api.fireMissileDirect||legacyFire)?.(args));
  };
  api.__arondightExtendedMissileRouter=true;
  Object.defineProperty(api,"displayMode",{configurable:true,enumerable:true,get:()=>selected});
  // Purge a stale capability from a previously patched object if available.
  if(Object.prototype.hasOwnProperty.call(api,"fireNuke"))delete api.fireNuke;
  select(stored());
}
function frame(){patch();requestAnimationFrame(frame);}
if(typeof window!=="undefined")requestAnimationFrame(frame);
