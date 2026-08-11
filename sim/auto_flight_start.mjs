const $=id=>document.getElementById(id);

function requestStartupLocation(){
  if(!navigator.geolocation)return Promise.resolve({fix:null,error:Error("Geolocation is not available in this browser")});
  return new Promise(resolve=>navigator.geolocation.getCurrentPosition(
    fix=>resolve({fix,error:null}),
    error=>resolve({fix:null,error:Error(error.message||"Location permission failed")}),
    {enableHighAccuracy:true,timeout:20000,maximumAge:0},
  ));
}

// Start the browser permission request immediately, before the simulator/WASM
// bootstrap finishes. It never blocks the local simulator from becoming usable.
const startupLocation=requestStartupLocation();

await import("./real_world_bootstrap.mjs");

const bridge=globalThis.__arondightRealWorld;

function syncWorldButton(){
  const button=$("soloWorld");
  if(!button||!bridge)return;
  button.dataset.active=bridge.active?"1":"0";
  button.dataset.loading=bridge.loading?"1":"0";
  button.textContent=bridge.loading?"WORLD…":bridge.active?"WORLD ✓":"WORLD";
}

function launchDefaultFlight(){
  // Reuse the exact existing UI paths so automatic startup cannot diverge from
  // a human selecting FPV and START SIM manually.
  $("camFpv")?.click();
  const cameraButton=$("soloCamera");if(cameraButton)cameraButton.textContent="FPV";
  $("camSolo")?.click();
  const viewport=$("viewport");if(viewport)viewport.dataset.autoFlightStart="fpv";
}

function discardFailedWorldMap(){
  try{bridge?.map?.remove?.();}catch{}
  if(bridge){bridge.map=null;bridge.geoContainer?.remove?.();bridge.geoContainer=null;}
}

function trainingFallback(message){
  if(!bridge)return;
  bridge.deactivate();
  discardFailedWorldMap();
  bridge.status(message,"warn");
  syncWorldButton();
}

async function autoWorld(locationResultPromise){
  if(!bridge)return;
  const {fix,error}=await locationResultPromise;
  if(fix)bridge.lastLocation=fix;
  if(error){trainingFallback(`TRAINING RANGE · GPS unavailable · ${error.message}`);return;}
  if(navigator.onLine===false){trainingFallback("TRAINING RANGE · offline · GPS permission ready");return;}
  try{
    // activate() deliberately performs its own fresh high-accuracy fix. The
    // startup request above exists to surface permission immediately; the
    // second read normally reuses the granted permission without another prompt.
    const pending=bridge.activate();syncWorldButton();await pending;syncWorldButton();
  }catch(error){trainingFallback(`TRAINING RANGE · WORLD unavailable · ${error?.message||error}`);}
}

launchDefaultFlight();
void autoWorld(startupLocation);
