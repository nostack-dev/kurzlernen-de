let installed=false,activePointer=null,activeElement=null,lastPointer=null,lastElement=null,lastSeenAt=-Infinity;
function viewport(){return document.getElementById("viewport");}
function isMoveTarget(target){return target instanceof Element?target.closest("#footMove"):null;}
function publish(reason="active"){
  const view=viewport();if(!view)return;view.dataset.walkInputLifecycleGuard="exclusive-move-pointer-v4";view.dataset.walkMoveStickOwner=activePointer===null?"none":String(activePointer);if(reason)view.dataset.walkMoveStickLifecycle=reason;
}
function cancelMoveElement(element,id,reason){
  if(!element||id===null||id===undefined)return false;
  try{element.dispatchEvent(new PointerEvent("pointercancel",{bubbles:true,cancelable:true,pointerId:id,pointerType:"touch",button:0,buttons:0}));}catch{}
  const knob=element.querySelector?.(".knob");if(knob){knob.style.left="50%";knob.style.top="50%";}
  const view=viewport();if(view){view.dataset.walkMoveStickRecovery=reason;view.dataset.walkMoveStickRecoveries=String((Number(view.dataset.walkMoveStickRecoveries)||0)+1);}return true;
}
function release(reason="lifecycle"){
  const id=activePointer??lastPointer,element=activeElement||lastElement;if(id===null||!element)return false;
  cancelMoveElement(element,id,reason);
  try{if(element.hasPointerCapture?.(id))element.releasePointerCapture?.(id);}catch{}
  activePointer=null;activeElement=null;lastPointer=id;lastElement=element;publish(reason);return true;
}
function remember(event){
  const move=isMoveTarget(event.target);
  if(event.type==="pointerdown"&&move){
    if(activePointer!==null&&event.pointerId!==activePointer){event.preventDefault();event.stopImmediatePropagation();publish("secondary-pointer-rejected");return;}
    activePointer=lastPointer=event.pointerId;activeElement=lastElement=move;lastSeenAt=performance.now();try{move.setPointerCapture?.(activePointer);}catch{}publish("captured");return;
  }
  if(event.pointerId!==activePointer)return;
  if(event.type==="pointermove"){
    lastSeenAt=performance.now();if(event.pointerType==="touch"&&event.buttons===0){release("pointermove-buttons-zero");return;}if(activeElement&&!activeElement.hasPointerCapture?.(activePointer)){try{activeElement.setPointerCapture?.(activePointer);}catch{}}return;
  }
  if(event.type==="pointerup"||event.type==="pointercancel")release(event.type);
}
function lostCapture(event){if(event.pointerId===activePointer)release("lostpointercapture");}
function touchTerminal(event){if(activePointer!==null&&Number(event.touches?.length||0)===0)release(event.type==="touchcancel"?"touchcancel-zero-touches":"touchend-zero-touches");}
function watchdog(now){
  if(activePointer!==null&&activeElement&&now-lastSeenAt>30000)release("stale-pointer-watchdog");
  const view=viewport();if(activePointer===null&&lastElement&&lastPointer!==null&&view&&String(view.dataset.walkMove||"").match(/^-?0\.000,-?0\.000$/)===null&&view.dataset.walkMoveStickOwner==="none")cancelMoveElement(lastElement,lastPointer,"orphaned-move-state");
  requestAnimationFrame(watchdog);
}
export function installWalkInputLifecycleGuard(){
  if(installed)return;installed=true;
  for(const type of["pointerdown","pointermove","pointerup","pointercancel"])window.addEventListener(type,remember,{capture:true,passive:false});
  window.addEventListener("lostpointercapture",lostCapture,true);window.addEventListener("touchend",touchTerminal,{capture:true,passive:true});window.addEventListener("touchcancel",touchTerminal,{capture:true,passive:true});
  addEventListener("blur",()=>release("window-blur"),{capture:true});addEventListener("pagehide",()=>release("pagehide"),{capture:true});addEventListener("orientationchange",()=>release("orientationchange"),{capture:true});document.addEventListener("visibilitychange",()=>{if(document.hidden)release("visibility-hidden");},{capture:true});addEventListener("arondight:player-mode",()=>release("mode-change"),{capture:true});
  publish("installed");requestAnimationFrame(watchdog);
}
installWalkInputLifecycleGuard();
