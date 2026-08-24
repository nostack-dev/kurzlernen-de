let installed=false,lastBridge=null,worldGuard=null,vsGuard=null,stableFrames=0;

function bridge(){return globalThis.__arondightRealWorld||null;}
function viewport(){return document.getElementById("viewport");}
function telemetry(name,amount=1){const v=viewport();if(!v)return;v.dataset[name]=String((Number(v.dataset[name])||0)+amount);}
function copyMarker(fn,base,name){if(base?.[name])fn[name]=true;}
function markWorldStable(fn,base){
  fn.__combatHitStackGuard=true;
  fn.__gameplayPolishLiteWrapper=true;
  fn.__gameplayPolishWrapper=true;
  fn.__realityDamageTop=true;
  fn.__worldLivelinessWrapper=true;
  for(const name of["__playerVehicleHitRouterV2","__proceduralPopulationProvider"])copyMarker(fn,base,name);
  return fn;
}
function markVsStable(fn,base){
  fn.__combatHitStackGuard=true;
  for(const name of["__worldActionFeedbackWrapper","__vsCombatHitRouter","__playerVehicleHitRouterV2"])copyMarker(fn,base,name);
  return fn;
}
function guarded(base,kind,mark,current){return mark(function(hit){
  try{return Boolean(base(hit));}
  catch(error){telemetry("combatHitStackErrors");const v=viewport();if(v){v.dataset.combatHitStackLastError=String(error?.message||error||`${kind}-target-hit-error`).slice(0,160);v.dataset.combatHitStackLastKind=kind;}return false;}
},current);}
function installGuards(){
  const b=bridge();if(!b)return false;
  if(b!==lastBridge){lastBridge=b;worldGuard=null;vsGuard=null;stableFrames=0;}
  let changed=false;
  if(typeof b.registerWorldPopulationHit==="function"){
    const current=b.registerWorldPopulationHit;
    if(current!==worldGuard){worldGuard=guarded(current.bind(b),"world",markWorldStable,current);b.registerWorldPopulationHit=worldGuard;telemetry("combatHitStackWraps");changed=true;}
  }
  if(typeof b.registerVsHit==="function"){
    const current=b.registerVsHit;
    if(current!==vsGuard){vsGuard=guarded(current.bind(b),"vs",markVsStable,current);b.registerVsHit=vsGuard;telemetry("combatVsHitGuardWraps");changed=true;}
  }
  stableFrames=changed?0:stableFrames+1;const v=viewport();if(v){v.dataset.combatHitStackGuard=changed?"installed-v1":"stable-v1";v.dataset.combatHitStackStableFrames=String(stableFrames);}return true;
}
function loop(){installGuards();requestAnimationFrame(loop);}

export function installCombatHitStackGuard(){if(installed)return;installed=true;requestAnimationFrame(loop);}
installCombatHitStackGuard();