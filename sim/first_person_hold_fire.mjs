const HOLD_TICK_MS=36;

let installed=false,activePointer=null,timer=0;

function viewport(){return document.getElementById("viewport");}
function walk(){return globalThis.__arondightWalkMode||null;}
function fireButton(){return document.getElementById("footFire");}

function stop(reason="release"){
  if(timer){clearTimeout(timer);timer=0;}
  const button=fireButton(),pointer=activePointer;activePointer=null;
  if(button&&pointer!==null){try{if(button.hasPointerCapture?.(pointer))button.releasePointerCapture?.(pointer);}catch{}}
  const view=viewport();if(view){view.dataset.walkAutofireActive="0";view.dataset.walkAutofireStop=reason;}
}

function canContinue(){const w=walk();return activePointer!==null&&w?.mode==="foot"&&!w?.dead&&typeof w?.fire==="function"&&fireButton()?.isConnected;}

function tick(){
  timer=0;
  if(!canContinue()){stop("inactive");return;}
  const fired=Boolean(walk().fire());
  const view=viewport();if(view&&fired)view.dataset.walkAutofireShots=String((Number(view.dataset.walkAutofireShots)||0)+1);
  timer=setTimeout(tick,HOLD_TICK_MS);
}

function start(event){
  if(event.button!==0&&event.pointerType==="mouse")return;
  const w=walk();if(activePointer!==null||w?.mode!=="foot"||w?.dead||typeof w?.fire!=="function")return;
  activePointer=event.pointerId;
  try{event.currentTarget?.setPointerCapture?.(activePointer);}catch{}
  const fired=Boolean(w.fire());
  const view=viewport();if(view){view.dataset.walkAutofire="hold-pointer-v1";view.dataset.walkAutofireActive="1";view.dataset.walkAutofireOwner=String(activePointer);if(fired)view.dataset.walkAutofireShots=String((Number(view.dataset.walkAutofireShots)||0)+1);}
  timer=setTimeout(tick,HOLD_TICK_MS);
}

function bind(){
  const button=fireButton();if(!button||button.dataset.holdFireBound==="1")return false;
  button.dataset.holdFireBound="1";
  button.addEventListener("pointerdown",start,{capture:true,passive:true});
  const release=event=>{if(activePointer===null||event.pointerId!==activePointer)return;stop(event.type);};
  window.addEventListener("pointerup",release,{capture:true,passive:true});
  window.addEventListener("pointercancel",release,{capture:true,passive:true});
  window.addEventListener("blur",()=>stop("blur"),{capture:true});
  window.addEventListener("pagehide",()=>stop("pagehide"),{capture:true});
  document.addEventListener("visibilitychange",()=>{if(document.hidden)stop("hidden");},{capture:true});
  window.addEventListener("arondight:player-mode",()=>{if(walk()?.mode!=="foot")stop("mode-change");},{capture:true});
  const view=viewport();if(view){view.dataset.walkAutofire="hold-pointer-v1";view.dataset.walkAutofireActive="0";}
  return true;
}

function frame(){bind();if(activePointer!==null&&!canContinue())stop("state-change");requestAnimationFrame(frame);}

export function installFirstPersonHoldFire(){if(installed)return;installed=true;requestAnimationFrame(frame);}
