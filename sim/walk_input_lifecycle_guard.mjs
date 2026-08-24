let installed=false,activePointer=null,activeElement=null,lastSeenAt=-Infinity;
function viewport(){return document.getElementById("viewport");}
function isMoveTarget(target){return target instanceof Element?target.closest("#footMove"):null;}
function publish(reason="active"){
  const view=viewport();if(!view)return;view.dataset.walkInputLifecycleGuard="exclusive-pointer-capture-v2";view.dataset.walkMoveStickOwner=activePointer===null?"none":String(activePointer);if(reason)view.dataset.walkMoveStickLifecycle=reason;
}
function remember(event){
  const move=isMoveTarget(event.target);
  if(event.type==="pointerdown"&&move){
    if(activePointer!==null&&event.pointerId!==activePointer){event.preventDefault();event.stopImmediatePropagation();publish("secondary-pointer-rejected");return;}
    activePointer=event.pointerId;activeElement=move;lastSeenAt=performance.now();try{move.setPointerCapture?.(activePointer);}catch{}publish("captured");return;
  }
  if(event.pointerId!==activePointer)return;
  if(event.type==="pointermove"){
    lastSeenAt=performance.now();if(activeElement&&!activeElement.hasPointerCapture?.(activePointer)){try{activeElement.setPointerCapture?.(activePointer);}catch{}}return;
  }
  if(event.type==="pointerup"||event.type==="pointercancel"){activePointer=null;activeElement=null;publish(event.type);}
}
function release(reason="lifecycle"){
  if(activePointer===null||!activeElement)return false;const id=activePointer,element=activeElement;activePointer=null;activeElement=null;
  try{if(element.hasPointerCapture?.(id))element.releasePointerCapture?.(id);}catch{}
  try{element.dispatchEvent(new PointerEvent("pointercancel",{bubbles:true,cancelable:true,pointerId:id,pointerType:"touch",button:0,buttons:0}));}catch{}
  const knob=element.querySelector?.(".knob");if(knob){knob.style.left="50%";knob.style.top="50%";}
  const view=viewport();if(view){view.dataset.walkMoveStickRecovery=reason;view.dataset.walkMoveStickRecoveries=String((Number(view.dataset.walkMoveStickRecoveries)||0)+1);view.dataset.walkInputLifecycleGuard="exclusive-pointer-capture-v2";view.dataset.walkMoveStickOwner="none";}return true;
}
function watchdog(now){if(activePointer!==null&&activeElement&&now-lastSeenAt>15000)release("stale-pointer-watchdog");requestAnimationFrame(watchdog);}
export function installWalkInputLifecycleGuard(){
  if(installed)return;installed=true;
  for(const type of["pointerdown","pointermove","pointerup","pointercancel"])window.addEventListener(type,remember,{capture:true,passive:false});
  window.addEventListener("lostpointercapture",event=>{if(event.pointerId===activePointer)release("lostpointercapture");},true);
  addEventListener("blur",()=>release("window-blur"),{capture:true});addEventListener("pagehide",()=>release("pagehide"),{capture:true});addEventListener("orientationchange",()=>release("orientationchange"),{capture:true});document.addEventListener("visibilitychange",()=>{if(document.hidden)release("visibility-hidden");},{capture:true});addEventListener("arondight:player-mode",()=>release("mode-change"),{capture:true});
  publish("installed");requestAnimationFrame(watchdog);
}
installWalkInputLifecycleGuard();
