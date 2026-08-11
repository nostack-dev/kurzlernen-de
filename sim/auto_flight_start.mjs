const $=id=>document.getElementById(id);

function requestStartupLocation(){
  if(!navigator.geolocation)return Promise.resolve({fix:null,error:Error("Geolocation is not available in this browser")});
  return new Promise(resolve=>navigator.geolocation.getCurrentPosition(
    fix=>resolve({fix,error:null}),
    error=>resolve({fix:null,error:Error(error.message||"Location permission failed")}),
    {enableHighAccuracy:true,timeout:20000,maximumAge:0},
  ));
}

// Surface the browser GPS permission immediately. Flight startup never waits for
// this promise, so denied GPS or an offline network cannot block local SIM.
// Release validation also proves long-range NAV continuity and realtime catch-up.
const startupLocation=requestStartupLocation();

async function waitForBridge(timeoutMs=30000){
  const started=performance.now();
  while(performance.now()-started<timeoutMs){
    const bridge=globalThis.__arondightRealWorld,status=$("status")?.textContent||"";
    if(bridge&&$("camFpv")&&$("camSolo")&&status.includes("SIM ready"))return bridge;
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  throw Error("Simulator/WORLD bridge did not become ready");
}

const bridge=await waitForBridge();

function markWorldStartup(source){const viewport=$("viewport");if(viewport)viewport.dataset.autoWorldLocationSource=source;}

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
  bridge.map=null;bridge.geoContainer?.remove?.();bridge.geoContainer=null;
}

function trainingFallback(message){
  bridge.deactivate();
  discardFailedWorldMap();
  bridge.status(message,"warn");
  markWorldStartup("sim-fallback");
  syncWorldButton();
}

async function autoWorld(locationResultPromise){
  const {fix,error}=await locationResultPromise;
  if(fix)bridge.lastLocation=fix;
  if(error){trainingFallback(`TRAINING RANGE · GPS unavailable · ${error.message}`);return;}
  if(navigator.onLine===false){trainingFallback("TRAINING RANGE · offline · GPS permission ready");return;}
  try{
    // The permission prompt's high-accuracy fix is the WORLD origin. Do not ask
    // the platform for a second fix during startup; manual WORLD activation still
    // acquires a fresh position when no startup fix is supplied.
    const pending=bridge.activate(fix);syncWorldButton();await pending;markWorldStartup("startup-gps");syncWorldButton();
  }catch(error){trainingFallback(`TRAINING RANGE · WORLD unavailable · ${error?.message||error}`);}
}

launchDefaultFlight();
void autoWorld(startupLocation);