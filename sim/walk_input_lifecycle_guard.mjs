let installed=false,activePointer=null,activeElement=null;
function viewport(){return document.getElementById("viewport");}
function remember(event){const target=event.target instanceof Element?event.target:null;if(event.type==="pointerdown"&&target?.closest("#footMove")){activePointer=event.pointerId;activeElement=target.closest("#footMove");return;}if((event.type==="pointerup"||event.type==="pointercancel")&&event.pointerId===activePointer){activePointer=null;activeElement=null;}}
function release(reason="lifecycle"){
  if(activePointer===null||!activeElement)return false;const id=activePointer,element=activeElement;activePointer=null;activeElement=null;
  try{element.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,cancelable:true,pointerId:id,pointerType:"touch",button:0,buttons:0}));}catch{try{element.dispatchEvent(new PointerEvent("pointercancel",{bubbles:true,cancelable:true,pointerId:id,pointerType:"touch"}));}catch{}}
  const knob=element.querySelector?.(".knob");if(knob){knob.style.left="50%";knob.style.top="50%";}
  const view=viewport();if(view){view.dataset.walkMoveStickRecovery=reason;view.dataset.walkMoveStickRecoveries=String((Number(view.dataset.walkMoveStickRecoveries)||0)+1);view.dataset.walkInputLifecycleGuard="pointerup-before-lifecycle-v1";}return true;
}
export function installWalkInputLifecycleGuard(){
  if(installed)return;installed=true;for(const type of["pointerdown","pointerup","pointercancel"])document.addEventListener(type,remember,{capture:true,passive:true});
  addEventListener("blur",()=>release("window-blur"),{capture:true});addEventListener("pagehide",()=>release("pagehide"),{capture:true});addEventListener("orientationchange",()=>release("orientationchange"),{capture:true});document.addEventListener("visibilitychange",()=>{if(document.hidden)release("visibility-hidden");},{capture:true});document.addEventListener("lostpointercapture",()=>release("lostpointercapture"),true);addEventListener("arondight:player-mode",()=>release("mode-change"),{capture:true});
  const view=viewport();if(view)view.dataset.walkInputLifecycleGuard="pointerup-before-lifecycle-v1";
}
installWalkInputLifecycleGuard();
