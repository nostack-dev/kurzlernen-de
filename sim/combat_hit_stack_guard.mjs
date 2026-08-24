let installed=false,lastBridge=null,worldGuard=null,stableFrames=0;

function bridge(){return globalThis.__arondightRealWorld||null;}
function viewport(){return document.getElementById("viewport");}
function telemetry(name,amount=1){const v=viewport();if(!v)return;v.dataset[name]=String((Number(v.dataset[name])||0)+amount);}
function markStable(fn,base){
  fn.__combatHitStackGuard=true;
  fn.__gameplayPolishLiteWrapper=true;
  fn.__gameplayPolishWrapper=true;
  fn.__realityDamageTop=true;
  fn.__worldLivelinessWrapper=true;
  if(base?.__playerVehicleHitRouterV2)fn.__playerVehicleHitRouterV2=true;
  if(base?.__proceduralPopulationProvider)fn.__proceduralPopulationProvider=true;
  return fn;
}
function installWorldGuard(){
  const b=bridge();if(!b||typeof b.registerWorldPopulationHit!=="function")return false;
  if(b!==lastBridge){lastBridge=b;worldGuard=null;stableFrames=0;}
  const current=b.registerWorldPopulationHit;
  if(current===worldGuard){stableFrames++;const v=viewport();if(v){v.dataset.combatHitStackGuard="stable-v1";v.dataset.combatHitStackStableFrames=String(stableFrames);}return true;}
  const base=current.bind(b),guard=markStable(function(hit){
    try{return Boolean(base(hit));}
    catch(error){telemetry("combatHitStackErrors");const v=viewport();if(v)v.dataset.combatHitStackLastError=String(error?.message||error||"target-hit-error").slice(0,160);return false;}
  },current);
  worldGuard=guard;b.registerWorldPopulationHit=guard;stableFrames=0;telemetry("combatHitStackWraps");const v=viewport();if(v)v.dataset.combatHitStackGuard="installed-v1";return true;
}
function loop(){installWorldGuard();requestAnimationFrame(loop);}

export function installCombatHitStackGuard(){if(installed)return;installed=true;requestAnimationFrame(loop);}
installCombatHitStackGuard();
