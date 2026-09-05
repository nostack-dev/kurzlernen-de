const LANDSCAPE_ONLY_POLICY="landscape-only-v1";
const GATE_ID="landscapeOnlyGate";
let installed=false,blocked=false,viewportObserver=null,observedViewport=null;
let lockState="idle",lockError="",gestureAttempted=false;

function portrait(){return innerHeight>innerWidth;}
function gate(){return document.getElementById(GATE_ID);}
function mobileLike(){return navigator.maxTouchPoints>0||matchMedia?.("(pointer:coarse)")?.matches===true;}
function standaloneLike(){return navigator.standalone===true||matchMedia?.("(display-mode: standalone)")?.matches===true||matchMedia?.("(display-mode: fullscreen)")?.matches===true;}
function hasOrientationLock(){return typeof screen?.orientation?.lock==="function";}
function fullscreenElement(){return document.fullscreenElement||document.webkitFullscreenElement||null;}

function ensureStyle(){
  if(document.querySelector("style[data-landscape-only-gate]"))return;
  const style=document.createElement("style");
  style.dataset.landscapeOnlyGate=LANDSCAPE_ONLY_POLICY;
  style.textContent=`
    #${GATE_ID}[hidden]{display:none!important}
    #${GATE_ID}{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:max(24px,env(safe-area-inset-top)) max(24px,env(safe-area-inset-right)) max(24px,env(safe-area-inset-bottom)) max(24px,env(safe-area-inset-left));box-sizing:border-box;background:radial-gradient(circle at 50% 42%,#17334a 0,#08131f 54%,#03070c 100%);color:#fff;font-family:system-ui,-apple-system,sans-serif;text-align:center;pointer-events:auto;touch-action:none;overscroll-behavior:none}
    #${GATE_ID} .landscape-only-card{max-width:430px;padding:22px 24px;border:1px solid #8bdcff66;border-radius:18px;background:#081725e8;box-shadow:0 24px 80px #000b,inset 0 1px #ffffff18}
    #${GATE_ID} strong{display:block;margin-bottom:8px;font:950 clamp(21px,7vw,33px)/1 system-ui,-apple-system,sans-serif;letter-spacing:.045em}
    #${GATE_ID} span{display:block;color:#c8eaff;font:750 clamp(13px,4vw,17px)/1.35 system-ui,-apple-system,sans-serif}
    #${GATE_ID} button{display:inline-flex;align-items:center;justify-content:center;min-width:190px;min-height:50px;margin-top:18px;padding:0 20px;border:1px solid #8bdcff88;border-radius:12px;background:#17678f;color:#fff;font:900 14px/1 system-ui,-apple-system,sans-serif;letter-spacing:.07em;box-shadow:0 8px 24px #0007;touch-action:manipulation}
    #${GATE_ID} button:active{transform:scale(.97)}#${GATE_ID} button:disabled{opacity:.65}
    html.landscape-only-blocked,body.landscape-only-blocked{overflow:hidden!important;overscroll-behavior:none!important}
  `;
  document.head.appendChild(style);
}

function renderGate(){
  const el=gate();if(!el)return;
  const title=el.querySelector("strong"),message=el.querySelector("span"),button=el.querySelector("button");
  const canAuto=hasOrientationLock();
  const fallback=lockState==="unsupported"||lockState==="failed";
  if(fallback){
    title.textContent="QUERFORMAT";
    message.innerHTML="Dieser Browser kann Landscape nicht automatisch fixieren.<br>Bitte Gerät einmal quer drehen.";
    button.hidden=true;
  }else{
    title.textContent="LANDSCAPE";
    message.innerHTML=standaloneLike()?"Landscape wird automatisch fixiert.":"Ein Tap startet Fullscreen und fixiert Landscape.";
    button.hidden=!canAuto;
    button.disabled=lockState==="locking";
    button.textContent=lockState==="locking"?"STARTE…":"LANDSCAPE STARTEN";
  }
}

function ensureGate(){
  let el=gate();if(el)return el;
  el=document.createElement("div");el.id=GATE_ID;el.hidden=true;el.setAttribute("role","alert");el.setAttribute("aria-live","assertive");
  el.innerHTML='<div class="landscape-only-card"><strong>LANDSCAPE</strong><span>Landscape wird vorbereitet.</span><button type="button">LANDSCAPE STARTEN</button></div>';
  document.body.appendChild(el);
  el.querySelector("button")?.addEventListener("click",event=>{event.preventDefault();event.stopPropagation();gestureAttempted=true;void forceLandscape({allowFullscreen:true,reason:"gate-button"});});
  return el;
}

function bindViewportObserver(){
  const view=document.getElementById("viewport");
  if(view===observedViewport)return view;
  viewportObserver?.disconnect();observedViewport=view||null;
  if(view){
    viewportObserver=new MutationObserver(()=>{
      if(view.dataset.orientationPolicy!==LANDSCAPE_ONLY_POLICY||view.dataset.soloOrientation!=="native")queueMicrotask(sync);
    });
    viewportObserver.observe(view,{attributes:true,attributeFilter:["data-orientation-policy","data-solo-orientation"]});
  }
  return view;
}

function publishState(){
  document.documentElement.dataset.orientationPolicy=LANDSCAPE_ONLY_POLICY;
  document.documentElement.dataset.orientationBlocked=blocked?"portrait":"none";
  document.documentElement.dataset.orientationLockState=lockState;
  const view=bindViewportObserver();if(view){
    view.dataset.orientationPolicy=LANDSCAPE_ONLY_POLICY;
    view.dataset.orientationBlocked=blocked?"portrait":"none";
    view.dataset.orientationLockState=lockState;
    view.dataset.orientationLockError=lockError;
    view.dataset.soloOrientation="native";
  }
}

function sync(){
  if(!document.body)return false;
  ensureStyle();const overlay=ensureGate();blocked=portrait();
  overlay.hidden=!blocked;overlay.setAttribute("aria-hidden",blocked?"false":"true");
  document.documentElement.classList.toggle("landscape-only-blocked",blocked);document.body.classList.toggle("landscape-only-blocked",blocked);
  if(blocked&&lockState==="idle"&&!hasOrientationLock())lockState="unsupported";
  publishState();renderGate();return blocked;
}

async function enterFullscreenFromGesture(){
  if(fullscreenElement())return true;
  const root=document.documentElement;
  if(typeof root.requestFullscreen==="function"){
    try{await root.requestFullscreen({navigationUI:"hide"});return true;}catch{
      try{await root.requestFullscreen();return true;}catch{}
    }
  }
  if(typeof root.webkitRequestFullscreen==="function"){
    try{root.webkitRequestFullscreen();return true;}catch{}
  }
  return false;
}

async function forceLandscape({allowFullscreen=false,reason="runtime"}={}){
  if(!hasOrientationLock()){
    lockState="unsupported";lockError="orientation-lock-unavailable";sync();return false;
  }
  if(lockState==="locking")return false;
  lockState="locking";lockError="";sync();
  try{
    if(!standaloneLike()&&!fullscreenElement()&&allowFullscreen&&mobileLike())await enterFullscreenFromGesture();
    await screen.orientation.lock("landscape");
    lockState="locked";lockError="";
    sync();
    setTimeout(sync,80);setTimeout(sync,320);
    return true;
  }catch(error){
    lockState="failed";lockError=String(error?.name||error?.message||reason||"lock-failed");sync();return false;
  }
}

function blockPortraitInput(event){
  if(!blocked)return;
  const el=gate();if(el&&event.composedPath?.().includes(el))return;
  event.preventDefault?.();event.stopImmediatePropagation?.();event.stopPropagation?.();
}

function tryLockWithoutGesture(){
  if(!hasOrientationLock())return;
  if(standaloneLike()||fullscreenElement())void forceLandscape({allowFullscreen:false,reason:"standalone-auto"});
}

function onFirstMobileGesture(){
  if(gestureAttempted||!mobileLike()||blocked)return;
  gestureAttempted=true;
  void forceLandscape({allowFullscreen:true,reason:"first-mobile-gesture"});
}

function install(){
  if(installed)return;installed=true;sync();tryLockWithoutGesture();
  for(const type of["pointerdown","pointermove","pointerup","pointercancel","touchstart","touchmove","touchend","mousedown","mouseup","click","wheel","keydown","keyup"])
    addEventListener(type,blockPortraitInput,{capture:true,passive:false});
  addEventListener("pointerup",onFirstMobileGesture,{capture:true,passive:true});
  addEventListener("touchend",onFirstMobileGesture,{capture:true,passive:true});
  addEventListener("resize",sync,{passive:true});addEventListener("orientationchange",()=>{sync();tryLockWithoutGesture();},{passive:true});globalThis.visualViewport?.addEventListener?.("resize",sync,{passive:true});
  screen?.orientation?.addEventListener?.("change",sync,{passive:true});
  addEventListener("fullscreenchange",()=>{sync();if(fullscreenElement())void forceLandscape({allowFullscreen:false,reason:"fullscreen-change"});},{passive:true});
  addEventListener("webkitfullscreenchange",()=>{sync();if(fullscreenElement())void forceLandscape({allowFullscreen:false,reason:"webkit-fullscreen-change"});},{passive:true});
  addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"){sync();tryLockWithoutGesture();}},{passive:true});
  new MutationObserver(()=>{bindViewportObserver();sync();}).observe(document.body,{childList:true,subtree:false});
}

if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",install,{once:true});else install();

export {LANDSCAPE_ONLY_POLICY,sync as syncLandscapeOnlyGate,forceLandscape};
