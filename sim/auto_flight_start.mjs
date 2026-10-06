const $=id=>document.getElementById(id);
const PLAYER_MODE_KEY="arondight45PlayerModeV2";

function requestStartupLocation(){
  if(!navigator.geolocation)return Promise.resolve({fix:null,error:Error("Geolocation is not available in this browser")});
  return new Promise(resolve=>navigator.geolocation.getCurrentPosition(
    fix=>resolve({fix,error:null}),
    error=>resolve({fix:null,error:Error(error.message||"Location permission failed")}),
    {enableHighAccuracy:true,timeout:20000,maximumAge:0},
  ));
}

// Game start menu (markup lives in drone_simulator.html so it shows before
// the bundle loads). The GPS permission is requested on START — a user
// gesture — and flight startup never waits for it, so denied GPS or an
// offline network cannot block the game. Automated browsers (webdriver) and
// ?autostart=1 skip the menu exactly like before.
const AUTOSTART=Boolean(navigator.webdriver)||/[?&]autostart=1/.test(location.search);
const menu=$("gameMenu"),startButton=$("gameMenuStart"),menuStatus=$("gameMenuStatus");
function setMenuStatus(text){if(menuStatus)menuStatus.textContent=text;}

async function waitForBridge(timeoutMs=30000){
  const started=performance.now();
  while(performance.now()-started<timeoutMs){
    const bridge=globalThis.__arondightRealWorld,status=$("status")?.textContent||"";
    if(bridge&&$("camFpv")&&$("camSolo")&&status.includes("SIM ready"))return bridge;
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  throw Error("Simulator/WORLD bridge did not become ready");
}

const bridge=await waitForBridge().catch(error=>{const b=document.getElementById("gameMenuStart"),st=document.getElementById("gameMenuStatus");if(b){b.disabled=false;b.textContent="RETRY";b.onclick=()=>location.reload();}if(st)st.textContent="LOAD FAILED";throw error;});

function markWorldStartup(source){const viewport=$("viewport");if(viewport)viewport.dataset.autoWorldLocationSource=source;}

function syncWorldButton(){
  const button=$("soloWorld");
  if(!button||!bridge)return;
  button.dataset.active=bridge.active?"1":"0";
  button.dataset.loading=bridge.loading?"1":"0";
  button.textContent=bridge.loading?"WORLD…":bridge.active?"WORLD ✓":"WORLD";
}

function normalizeStartupPlayerState(){
  try{localStorage.setItem(PLAYER_MODE_KEY,"drone");}catch{}
  const viewport=$("viewport"),playerDead=Boolean(globalThis.__arondightPlayerDamageModel?.dead),droneDead=Boolean(globalThis.__arondightDroneDamageModel?.destroyed),combatDead=Boolean(bridge?.vsLocalDead);
  if(playerDead||droneDead||combatDead){
    $("soloReset")?.click();
    if(bridge){bridge.vsLocalDead=false;bridge.vsLocalHealth=100;bridge.vsLocalPoseSample=null;bridge.updateVsCombatHud?.(true);}
  }
  const mode=globalThis.__arondightWalkMode?.setMode?.("drone",{persist:false,reason:"startup-default"});
  if(viewport){
    viewport.dataset.autoStartupPlayerMode=String(mode||globalThis.__arondightWalkMode?.mode||"drone");
    viewport.dataset.autoStartupDeathReset=(playerDead||droneDead||combatDead)?"1":"0";
    viewport.dataset.autoStartupContract="drone-fpv-fresh-v1";
  }
}

function launchDefaultFlight(){
  normalizeStartupPlayerState();
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
    const pending=bridge.activate(fix);syncWorldButton();await pending;markWorldStartup("startup-gps");syncWorldButton();
  }catch(error){trainingFallback(`TRAINING RANGE · WORLD unavailable · ${error?.message||error}`);}
}

let worldRequested=false;
function startGame(){
  if(menu)menu.hidden=true;launchDefaultFlight();window.dispatchEvent(new CustomEvent("arondight:game-start"));
  // Opening quote over the live game (fades in and out, never blocks input).
  const quote=$("gameIntroQuote");if(quote&&!AUTOSTART){quote.hidden=false;quote.classList.remove("play");void quote.offsetWidth;quote.classList.add("play");setTimeout(()=>{quote.hidden=true;quote.classList.remove("play");},7400);}
  if(!worldRequested){worldRequested=true;void autoWorld(requestStartupLocation());}
}
function showMenu(){if(!menu)return;menu.hidden=false;if(startButton){startButton.disabled=false;startButton.textContent="START";}setMenuStatus("READY");}
// Leaving the flight returns to the menu instead of the engineering panel.
$("soloExit")?.addEventListener("click",()=>setTimeout(showMenu,0));
if(AUTOSTART||!menu||!startButton){if(menu)menu.hidden=true;startGame();}
else{startButton.disabled=false;startButton.textContent="START";setMenuStatus("READY");startButton.addEventListener("click",startGame);}
