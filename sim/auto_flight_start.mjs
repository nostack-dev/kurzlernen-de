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
const AUTOSTART=!/[?&]menu=1/.test(location.search)&&(Boolean(navigator.webdriver)||/[?&]autostart=1/.test(location.search));
const menu=$("gameMenu"),startButton=$("gameMenuStart"),menuStatus=$("gameMenuStatus");
function setMenuStatus(text){if(menuStatus)menuStatus.textContent=text;}

// Unlock on START (before any awaits), then play at the actual game reveal.
// Web Audio preserves the gesture unlock across GPS / world loading on iOS.
let introContext=null,introSource=null,introGeneration=0;
// No spoken intro any more (the game is a bright sandbox, not a doom piece).
const introBytes=Promise.resolve(null);
function introSoundEnabled(){try{return JSON.parse(localStorage.getItem("arondight45AudioSettingsV1")||"{}").soundEnabled!==false;}catch{return true;}}
// No second AudioContext (it made iOS re-route the audio session mid-start,
// audible as a stutter / the music starting again): reuse the shared one.
function unlockIntroAudio(){
  if(AUTOSTART||!introSoundEnabled())return;
  try{introContext=globalThis.__sharedAudioContext||null;introContext?.resume?.().catch(()=>{});}catch{}
}
function stopIntroAudio(){introGeneration++;if(introSource){try{introSource.stop();}catch{}introSource.disconnect();introSource=null;}}
async function playIntroAudio(){
  stopIntroAudio();const generation=introGeneration;
  if(!introContext||!introSoundEnabled()||document.hidden)return;
  try{
    const bytes=await introBytes;if(!bytes)return;
    const buffer=await introContext.decodeAudioData(bytes.slice(0));
    if(generation!==introGeneration||!introSoundEnabled()||document.hidden||!menu?.hidden||introContext.state!=="running")return;
    const source=introContext.createBufferSource();source.buffer=buffer;source.connect(introContext.destination);
    source.onended=()=>{source.disconnect();if(introSource===source)introSource=null;};
    introSource=source;source.start();
  }catch{/* A missing/blocked audio asset must never block the game. */}
}
window.addEventListener("arondight45-audio-settings-change",()=>{if(!introSoundEnabled())stopIntroAudio();});
document.addEventListener("visibilitychange",()=>{if(document.hidden)stopIntroAudio();});

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

// The game starts on foot, first person, with the pistol. `?start=drone`
// (or `?start=foot`) picks the start mode explicitly, e.g. for flight tests.
const STARTUP_MODE=(()=>{try{const m=new URLSearchParams(location.search).get("start");return m==="drone"?"drone":"foot";}catch{return"foot";}})();
const STARTUP_FOOT_WEAPON="glock";
const STARTUP_CONTRACT="foot-pistol-fresh-v1";
function normalizeStartupPlayerState(){
  try{localStorage.setItem(PLAYER_MODE_KEY,STARTUP_MODE);}catch{}
  const viewport=$("viewport"),playerDead=Boolean(globalThis.__arondightPlayerDamageModel?.dead),droneDead=Boolean(globalThis.__arondightDroneDamageModel?.destroyed),combatDead=Boolean(bridge?.vsLocalDead);
  if(playerDead||droneDead||combatDead){
    $("soloReset")?.click();
    if(bridge){bridge.vsLocalDead=false;bridge.vsLocalHealth=100;bridge.vsLocalPoseSample=null;bridge.updateVsCombatHud?.(true);}
  }
  if(viewport){
    viewport.dataset.autoStartupDeathReset=(playerDead||droneDead||combatDead)?"1":"0";
    viewport.dataset.autoStartupContract=STARTUP_CONTRACT;
  }
}
function applyStartupPlayerMode(){
  const walk=globalThis.__arondightWalkMode,weapons=globalThis.__arondightFootWeapons;
  if(STARTUP_MODE==="foot")weapons?.setMode?.(STARTUP_FOOT_WEAPON);
  const mode=walk?.setMode?.(STARTUP_MODE,{persist:false,reason:"startup-default"});
  const viewport=$("viewport");
  if(viewport){viewport.dataset.autoStartupPlayerMode=String(mode||walk?.mode||STARTUP_MODE);viewport.dataset.autoStartupFootWeapon=String(weapons?.mode||"");}
}

function launchDefaultFlight(){
  normalizeStartupPlayerState();
  $("camFpv")?.click();
  const cameraButton=$("soloCamera");if(cameraButton)cameraButton.textContent="FPV";
  $("camSolo")?.click();
  applyStartupPlayerMode();
  const viewport=$("viewport");if(viewport)viewport.dataset.autoFlightStart=STARTUP_MODE==="foot"?"foot":"fpv";
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
// Seamless start: everything heavy happens while the menu (and its flyover)
// still covers the screen — GPS fix, city map + tiles, neon conversion of
// every object and shader compilation (compileAsync, off the main thread
// where supported). Only then does the menu cross-fade into the running
// game, so the reveal has no hitches and nothing un-styled ever shows.
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const nextFrame=()=>new Promise(resolve=>requestAnimationFrame(()=>resolve()));
function withTimeout(promise,ms){return Promise.race([Promise.resolve(promise).catch(()=>{}),wait(ms)]);}
async function mapSettled(){const map=bridge?.map;if(!bridge?.active||!map)return;if(!map.loaded?.())await withTimeout(new Promise(resolve=>map.once?.("idle",resolve)),6000);}
async function neonSettled(){const neon=globalThis.__arondightNeonStyle;if(!neon)return;const until=performance.now()+5000;let calm=0;while(performance.now()<until){await withTimeout(nextFrame(),250);let pending=0;try{pending=Number(neon.pending?.())||0;}catch{return;}calm=pending===0?calm+1:0;if(calm>=30)return;}}
async function compileScene(){const renderer=bridge?.threeRenderer,scene=bridge?.threeScene,camera=bridge?.threeCamera;if(!renderer||!scene||!camera)return;try{const prev=renderer.getRenderTarget(),bloom=globalThis.__arondightNeonBloom?.target||null,jobs=[];if(renderer.compileAsync){try{if(bloom){renderer.setRenderTarget(bloom);jobs.push(renderer.compileAsync(scene,camera));}renderer.setRenderTarget(null);jobs.push(renderer.compileAsync(scene,camera));}finally{renderer.setRenderTarget(prev);}await withTimeout(Promise.all(jobs),4000);}else renderer.compile(scene,camera);}catch{}}
let starting=false;
async function startGame(){
  if(starting)return;starting=true;
  unlockIntroAudio();
  if(startButton){startButton.disabled=true;startButton.textContent="LOADING";}
  let startupWarning="";
  try{
    if(!worldRequested){worldRequested=true;setMenuStatus("LOCATING");await withTimeout(autoWorld(requestStartupLocation()),15000);}
    // Keep the 1 kHz flight/Box3D loop stopped while the opaque menu is doing
    // network + scene preparation. Starting physics before the user can see the
    // game only steals main-thread slices from the soundtrack and loader.
    setMenuStatus("BUILDING CITY");
    await withTimeout(mapSettled(),6500);
    setMenuStatus("PREPARING");
    await withTimeout(neonSettled(),5500);
    await withTimeout(compileScene(),4500);
    launchDefaultFlight();
    await withTimeout(nextFrame(),300);
    await withTimeout(nextFrame(),300);
  }catch(error){
    startupWarning=String(error?.message||error||"startup preparation failed");
    console.warn("game startup preparation continued after non-fatal failure",error);
    setMenuStatus("STARTING");
  }
  try{window.dispatchEvent(new CustomEvent("arondight:game-start",{detail:{startupWarning}}));}catch{}
  if(menu&&!AUTOSTART){menu.classList.add("gm-leaving");await wait(350);}
  if(menu){menu.hidden=true;menu.classList.remove("gm-leaving");}
  if(startButton){startButton.disabled=false;startButton.textContent="START";}
  starting=false;
}
function showMenu(){stopIntroAudio();if(!menu)return;menu.hidden=false;starting=false;if(startButton){startButton.disabled=false;startButton.textContent="START";}setMenuStatus("READY");}
// Leaving the flight returns to the menu instead of the engineering panel.
$("soloExit")?.addEventListener("click",()=>setTimeout(showMenu,0));
if(AUTOSTART||!menu||!startButton){if(menu)menu.hidden=true;launchDefaultFlight();worldRequested=true;void autoWorld(requestStartupLocation());}
else{startButton.disabled=false;startButton.textContent="START";setMenuStatus("READY");startButton.addEventListener("click",startGame);}
