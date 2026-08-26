const IOS_MOBILE=/(?:iphone|ipad|ipod|macintosh.*mobile)/i.test(globalThis.navigator?.userAgent||"");
let installed=false,lastInputTop=-1;

function viewport(){return document.getElementById("viewport");}
function standaloneLike(){return navigator.standalone===true||matchMedia?.("(display-mode: standalone)")?.matches===true||matchMedia?.("(display-mode: fullscreen)")?.matches===true;}
function iosStandalone(){return IOS_MOBILE&&standaloneLike();}

function installStyle(){
  if(document.querySelector("style[data-pwa-standalone-viewport]"))return;
  const style=document.createElement("style");
  style.dataset.pwaStandaloneViewport="ios-fill+touch-layer-v1";
  style.textContent=`
    /* Fixed + inset is the viewport authority. Do not combine it with 100dvh on iOS standalone:
       WebKit can report a smaller dynamic viewport and leave the body background visible at the bottom. */
    html.ios-standalone-viewport,html.ios-standalone-viewport body{width:100%!important;height:100%!important;min-width:100%!important;min-height:100%!important;overflow:hidden!important;overscroll-behavior:none!important;background:#070a0f!important}
    html.ios-standalone-viewport body.solo-flight #viewport{position:fixed!important;inset:0!important;width:auto!important;height:auto!important;min-width:0!important;min-height:0!important;max-width:none!important;max-height:none!important;margin:0!important;transform:none!important}

    /* The solo controls own the top interaction layer. WALK look/fire starts below the measured topbar. */
    body.solo-flight #soloHud{z-index:18!important}
    body.solo-flight #soloTopbar{z-index:30!important;pointer-events:auto!important;touch-action:manipulation!important;-webkit-user-select:none!important;user-select:none!important}
    body.solo-flight #soloTopbarActions,body.solo-flight #soloTopbarActions>*{pointer-events:auto!important;touch-action:manipulation!important}
    body.solo-flight #soloTopbar button{position:relative;z-index:1;pointer-events:auto!important;touch-action:manipulation!important;-webkit-tap-highlight-color:transparent!important}
    body.solo-flight.on-foot-mode #footLookZone{top:max(44px,var(--solo-input-top,44px))!important}
    @media(pointer:coarse){body.solo-flight #soloTopbar button{min-height:32px!important}}
  `;
  document.head.appendChild(style);
}

function measure(){
  const view=viewport();if(!view)return;
  const standalone=standaloneLike(),iosPwa=iosStandalone();
  document.documentElement.classList.toggle("ios-standalone-viewport",iosPwa);
  const vr=view.getBoundingClientRect(),topbar=document.getElementById("soloTopbar"),tr=topbar?.getBoundingClientRect?.();
  const inputTop=tr?Math.max(44,Math.ceil(tr.bottom-vr.top+4)):44;
  if(inputTop!==lastInputTop){lastInputTop=inputTop;view.style.setProperty("--solo-input-top",`${inputTop}px`);}
  const vv=globalThis.visualViewport;
  view.dataset.pwaStandalone=standalone?"1":"0";
  view.dataset.pwaIosStandalone=iosPwa?"1":"0";
  view.dataset.pwaViewportSizing=iosPwa?"fixed-inset-authority-v1":"browser-default";
  view.dataset.pwaLayoutViewport=`${Math.round(vr.width)}x${Math.round(vr.height)}`;
  view.dataset.pwaVisualViewport=vv?`${Math.round(vv.width)}x${Math.round(vv.height)}@${Math.round(vv.offsetLeft)},${Math.round(vv.offsetTop)}`:"unavailable";
  view.dataset.pwaTopbarInputBoundary=String(inputTop);
  if(topbar){const hit=document.elementFromPoint?.(Math.min(innerWidth-1,Math.max(1,tr.left+tr.width/2)),Math.min(innerHeight-1,Math.max(1,tr.top+Math.min(tr.height/2,16))));view.dataset.pwaTopbarHitOwner=hit?.closest?.("#soloTopbar")?"solo-topbar":"other";}
}

function install(){
  if(installed)return;installed=true;installStyle();measure();
  const schedule=()=>requestAnimationFrame(measure);
  addEventListener("resize",schedule,{passive:true});addEventListener("orientationchange",schedule,{passive:true});addEventListener("pageshow",schedule,{passive:true});
  globalThis.visualViewport?.addEventListener?.("resize",schedule,{passive:true});globalThis.visualViewport?.addEventListener?.("scroll",schedule,{passive:true});
  new MutationObserver(schedule).observe(document.documentElement,{attributes:true,childList:true,subtree:true,attributeFilter:["class","style"]});
  requestAnimationFrame(function frame(){measure();requestAnimationFrame(frame);});
}

if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",install,{once:true});else install();
