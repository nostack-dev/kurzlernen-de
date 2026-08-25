const LANDSCAPE_ONLY_POLICY="landscape-only-v1";
const GATE_ID="landscapeOnlyGate";
let installed=false,blocked=false,viewportObserver=null,observedViewport=null;

function portrait(){return innerHeight>innerWidth;}
function gate(){return document.getElementById(GATE_ID);}
function ensureStyle(){
  if(document.querySelector("style[data-landscape-only-gate]"))return;
  const style=document.createElement("style");
  style.dataset.landscapeOnlyGate=LANDSCAPE_ONLY_POLICY;
  style.textContent=`
    #${GATE_ID}[hidden]{display:none!important}
    #${GATE_ID}{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:max(24px,env(safe-area-inset-top)) max(24px,env(safe-area-inset-right)) max(24px,env(safe-area-inset-bottom)) max(24px,env(safe-area-inset-left));box-sizing:border-box;background:radial-gradient(circle at 50% 42%,#17334a 0,#08131f 54%,#03070c 100%);color:#fff;font-family:system-ui,-apple-system,sans-serif;text-align:center;pointer-events:auto;touch-action:none;overscroll-behavior:none}
    #${GATE_ID} .landscape-only-card{max-width:430px;padding:22px 24px;border:1px solid #8bdcff66;border-radius:18px;background:#081725e8;box-shadow:0 24px 80px #000b,inset 0 1px #ffffff18}
    #${GATE_ID} strong{display:block;margin-bottom:8px;font:950 clamp(22px,7vw,34px)/1 system-ui,-apple-system,sans-serif;letter-spacing:.05em}
    #${GATE_ID} span{display:block;color:#c8eaff;font:750 clamp(13px,4vw,17px)/1.35 system-ui,-apple-system,sans-serif}
    html.landscape-only-blocked,body.landscape-only-blocked{overflow:hidden!important;overscroll-behavior:none!important}
  `;
  document.head.appendChild(style);
}
function ensureGate(){
  let el=gate();if(el)return el;
  el=document.createElement("div");el.id=GATE_ID;el.hidden=true;el.setAttribute("role","alert");el.setAttribute("aria-live","assertive");el.innerHTML='<div class="landscape-only-card"><strong>QUERFORMAT</strong><span>Bitte Gerät ins Landscape-Format drehen.<br>Portrait ist in dieser App deaktiviert.</span></div>';
  document.body.appendChild(el);return el;
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
function sync(){
  if(!document.body)return false;
  ensureStyle();const overlay=ensureGate(),next=portrait();blocked=next;
  overlay.hidden=!next;overlay.setAttribute("aria-hidden",next?"false":"true");
  document.documentElement.classList.toggle("landscape-only-blocked",next);document.body.classList.toggle("landscape-only-blocked",next);
  document.documentElement.dataset.orientationPolicy=LANDSCAPE_ONLY_POLICY;document.documentElement.dataset.orientationBlocked=next?"portrait":"none";
  const view=bindViewportObserver();if(view){view.dataset.orientationPolicy=LANDSCAPE_ONLY_POLICY;view.dataset.orientationBlocked=next?"portrait":"none";view.dataset.soloOrientation="native";}
  return next;
}
async function tryLandscapeLock(){
  if(portrait()||typeof screen?.orientation?.lock!=="function")return false;
  try{await screen.orientation.lock("landscape");return true;}catch{return false;}
}
function blockPortraitInput(event){
  if(!blocked)return;
  event.preventDefault?.();event.stopImmediatePropagation?.();event.stopPropagation?.();
}
function install(){
  if(installed)return;installed=true;sync();
  for(const type of["pointerdown","pointermove","pointerup","pointercancel","touchstart","touchmove","touchend","mousedown","mouseup","click","wheel","keydown","keyup"])
    addEventListener(type,blockPortraitInput,{capture:true,passive:false});
  addEventListener("resize",sync,{passive:true});addEventListener("orientationchange",sync,{passive:true});globalThis.visualViewport?.addEventListener?.("resize",sync,{passive:true});
  addEventListener("fullscreenchange",()=>{sync();if(document.fullscreenElement)void tryLandscapeLock();},{passive:true});
  addEventListener("pointerdown",()=>{if(!blocked)void tryLandscapeLock();},{capture:true,passive:true});
  new MutationObserver(()=>{bindViewportObserver();sync();}).observe(document.body,{childList:true,subtree:false});
}

if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",install,{once:true});else install();

export {LANDSCAPE_ONLY_POLICY,sync as syncLandscapeOnlyGate};
