const DOUBLE_TAP_MS=340;
const UI_SELECTOR="button,input,select,textarea,a,label,dialog,[role=button],#soloTopbar,#soloLeft,#soloRight,#soloClearance,.solo-action,.phone-settings-dialog,#worldLookHud";

let installed=false,lastTapAt=-Infinity;

function viewport(){return document.getElementById("viewport");}
function flightSurface(target){return target instanceof Element&&Boolean(target.closest("#viewport"))&&!target.closest(UI_SELECTOR);}
function bump(){const v=viewport();if(!v)return;v.dataset.mobileDoubleTapBlocks=String((Number(v.dataset.mobileDoubleTapBlocks)||0)+1);v.dataset.mobileDoubleTapGuard="window-capture-v3";}

export function installMobileZoomGuardCapture(){
  if(installed)return;installed=true;
  window.addEventListener("touchend",event=>{
    if(!flightSurface(event.target)||event.changedTouches?.length!==1){lastTapAt=-Infinity;return;}
    const now=Number.isFinite(Number(event.timeStamp))&&Number(event.timeStamp)>0?Number(event.timeStamp):performance.now();
    if(now-lastTapAt<=DOUBLE_TAP_MS){event.preventDefault();bump();lastTapAt=-Infinity;return;}
    lastTapAt=now;
  },{capture:true,passive:false});
  window.addEventListener("dblclick",event=>{if(!flightSurface(event.target))return;event.preventDefault();bump();},{capture:true,passive:false});
  const v=viewport();if(v){v.dataset.mobileDoubleTapZoom="disabled-v2";v.dataset.mobileDoubleTapGuard="window-capture-v3";}
}

installMobileZoomGuardCapture();
