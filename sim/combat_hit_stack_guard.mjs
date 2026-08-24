const WORLD_MARKERS=["__gameplayPolishLiteWrapper","__gameplayPolishWrapper","__realityDamageTop","__worldLivelinessWrapper","__playerVehicleHitRouterV2","__proceduralPopulationProvider"];
const VS_MARKERS=["__worldActionFeedbackWrapper","__vsCombatHitRouter","__playerVehicleHitRouterV2"];
let installed=false,lastBridge=null,worldCurrent=null,vsCurrent=null,worldInstalled=false,vsInstalled=false,stableFrames=0;

function bridge(){return globalThis.__arondightRealWorld||null;}
function viewport(){return document.getElementById("viewport");}
function bump(name){const v=viewport();if(v)v.dataset[name]=String((Number(v.dataset[name])||0)+1);}
function inheritMarkers(next,previous,markers){if(typeof next!=="function")return next;for(const marker of markers)if(previous?.[marker])next[marker]=true;return next;}
function installAccessor(b,name,markers,kind){
  const descriptor=Object.getOwnPropertyDescriptor(b,name);if(descriptor&&!descriptor.configurable)return false;
  let current=b[name];if(typeof current!=="function")return false;
  Object.defineProperty(b,name,{configurable:true,enumerable:descriptor?.enumerable??true,get(){return current;},set(next){const previous=current;current=inheritMarkers(next,previous,markers);bump(kind==="world"?"combatHitStackAssignments":"combatVsHitAssignments");}});
  if(kind==="world")worldCurrent=()=>current;else vsCurrent=()=>current;return true;
}
function installRegistry(){
  const b=bridge();if(!b)return false;
  if(b!==lastBridge){lastBridge=b;worldCurrent=null;vsCurrent=null;worldInstalled=false;vsInstalled=false;stableFrames=0;}
  if(!worldInstalled&&typeof b.registerWorldPopulationHit==="function")worldInstalled=installAccessor(b,"registerWorldPopulationHit",WORLD_MARKERS,"world");
  if(!vsInstalled&&typeof b.registerVsHit==="function")vsInstalled=installAccessor(b,"registerVsHit",VS_MARKERS,"vs");
  if(!worldInstalled)return false;
  stableFrames++;const v=viewport();if(v){v.dataset.combatHitStackRegistry="marker-union-v1";v.dataset.combatHitStackStableFrames=String(stableFrames);v.dataset.combatHitStackWorldMarkers=WORLD_MARKERS.filter(marker=>b.registerWorldPopulationHit?.[marker]).join(",");}return true;
}
function loop(){installRegistry();requestAnimationFrame(loop);}

export function installCombatHitStackGuard(){if(installed)return;installed=true;installRegistry();requestAnimationFrame(loop);}
installCombatHitStackGuard();