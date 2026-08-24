const WORLD_MARKERS=["__gameplayPolishLiteWrapper","__gameplayPolishWrapper","__realityDamageTop","__worldLivelinessWrapper","__playerVehicleHitRouterV2","__proceduralPopulationProvider"];
const VS_MARKERS=["__worldActionFeedbackWrapper","__vsCombatHitRouter","__playerVehicleHitRouterV2"];
let installed=false,lastBridge=null,worldInstalled=false,vsInstalled=false,stableFrames=0;

function bridge(){return globalThis.__arondightRealWorld||null;}
function viewport(){return document.getElementById("viewport");}
function bump(name){const v=viewport();if(v)v.dataset[name]=String((Number(v.dataset[name])||0)+1);}
function inheritMarkers(next,previous,markers){if(typeof next!=="function")return next;for(const marker of markers)if(previous?.[marker])next[marker]=true;return next;}
function recordTargetError(kind,error){const v=viewport();if(!v)return;const countKey=kind==="world"?"combatTargetErrors":"combatVsTargetErrors",lastKey=kind==="world"?"combatTargetLastError":"combatVsTargetLastError";v.dataset[countKey]=String((Number(v.dataset[countKey])||0)+1);v.dataset[lastKey]=String(error?.message||error||"target handler error").slice(0,180);}
function protectTargetHandler(fn,kind,markers){
  if(typeof fn!=="function"||fn.__combatTargetSafeWrapper)return fn;
  const safe=function(...args){try{return Boolean(fn.apply(this,args));}catch(error){recordTargetError(kind,error);return false;}};
  inheritMarkers(safe,fn,markers);safe.__combatTargetSafeWrapper=true;return safe;
}
function rehydrateWorldMarkers(b,fn){
  if(typeof fn!=="function")return fn;const v=viewport();
  if(v?.dataset.gameplayWorldHitAudio==="1")fn.__gameplayPolishLiteWrapper=true;
  if(v?.dataset.worldDamageModel==="pistol-hp-v2")fn.__realityDamageTop=true;
  if(typeof b?.__proceduralPopulationHit==="function"){fn.__proceduralPopulationProvider=true;fn.__worldLivelinessWrapper=true;fn.__gameplayPolishLiteWrapper=true;}
  if(v?.dataset.walkVsHitRouting==="1"){fn.__playerVehicleHitRouterV2=true;fn.__worldLivelinessWrapper=true;fn.__gameplayPolishLiteWrapper=true;}
  return fn;
}
function rehydrateVsMarkers(fn){if(typeof fn!=="function")return fn;const v=viewport();if(v?.dataset.worldHitRouting)fn.__worldActionFeedbackWrapper=true;return fn;}
function installAccessor(b,name,markers,kind){
  const descriptor=Object.getOwnPropertyDescriptor(b,name);if(descriptor&&!descriptor.configurable)return false;
  let current=protectTargetHandler(b[name],kind,markers);if(typeof current!=="function")return false;
  if(kind==="world")rehydrateWorldMarkers(b,current);else rehydrateVsMarkers(current);
  Object.defineProperty(b,name,{configurable:true,enumerable:descriptor?.enumerable??true,get(){return current;},set(next){const previous=current;current=protectTargetHandler(next,kind,markers);current=inheritMarkers(current,previous,markers);if(kind==="world")rehydrateWorldMarkers(b,current);else rehydrateVsMarkers(current);stableFrames=0;bump(kind==="world"?"combatHitStackAssignments":"combatVsHitAssignments");}});
  return true;
}
function installRegistry(){
  const b=bridge();if(!b)return false;
  if(b!==lastBridge){lastBridge=b;worldInstalled=false;vsInstalled=false;stableFrames=0;}
  if(!worldInstalled&&typeof b.registerWorldPopulationHit==="function")worldInstalled=installAccessor(b,"registerWorldPopulationHit",WORLD_MARKERS,"world");
  if(!vsInstalled&&typeof b.registerVsHit==="function")vsInstalled=installAccessor(b,"registerVsHit",VS_MARKERS,"vs");
  if(!worldInstalled)return false;
  rehydrateWorldMarkers(b,b.registerWorldPopulationHit);rehydrateVsMarkers(b.registerVsHit);stableFrames++;const v=viewport();if(v){v.dataset.combatHitStackRegistry="marker-union-v3";v.dataset.combatHitStackStableFrames=String(stableFrames);v.dataset.combatHitStackWorldMarkers=WORLD_MARKERS.filter(marker=>b.registerWorldPopulationHit?.[marker]).join(",");v.dataset.combatTargetGuard="exception-isolated-v1";}return true;
}
function loop(){installRegistry();requestAnimationFrame(loop);}

export function installCombatHitStackGuard(){if(installed)return;installed=true;installRegistry();requestAnimationFrame(loop);}
installCombatHitStackGuard();