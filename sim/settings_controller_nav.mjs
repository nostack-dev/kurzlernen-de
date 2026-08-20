const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

export const SETTINGS_GAMEPAD_BUTTON=Object.freeze({A:0,B:1,Y:3,VIEW:8,MENU:9,DPAD_UP:12,DPAD_DOWN:13,DPAD_LEFT:14,DPAD_RIGHT:15});

function buttonPressed(gamepad,index){const button=gamepad?.buttons?.[index];return Boolean(typeof button==="number"?button>.5:button?.pressed||Number(button?.value)>.5);}
function focusable(dialog){return Array.from(dialog?.querySelectorAll?.('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"]):not([disabled])')||[]).filter(element=>element.offsetParent!==null&&!element.closest('[hidden]'));}
function dispatchInput(element){element.dispatchEvent(new Event("input",{bubbles:true}));element.dispatchEvent(new Event("change",{bubbles:true}));}
function adjustRange(input,direction){const min=Number(input.min),max=Number(input.max),step=Number(input.step)||1,current=Number(input.value)||0,next=clamp(current+direction*step,Number.isFinite(min)?min:-Infinity,Number.isFinite(max)?max:Infinity);if(next===current)return false;input.value=String(next);dispatchInput(input);return true;}
function latchFlightRelease(){globalThis.__arondightSettingsGamepadBlockUntilRelease=true;}
function clickSoloAction(selector,datasetKey){const button=document.querySelector(selector),viewport=document.getElementById("viewport");if(!document.body.classList.contains("solo-flight")||!(button instanceof HTMLElement))return false;latchFlightRelease();button.click();if(viewport)viewport.dataset[datasetKey]=String((Number(viewport.dataset[datasetKey])||0)+1);return true;}

export function createSettingsGamepadNavigator({dialog,openDialog,closeDialog,getGamepad}){
  if(!dialog)throw Error("settings dialog required");
  let previous=Array(16).fill(false),stickLatchY=0,stickLatchX=0,running=true;
  const setFocus=(delta=0)=>{const items=focusable(dialog);if(!items.length)return null;let index=items.indexOf(document.activeElement);if(index<0)index=0;else index=(index+delta+items.length)%items.length;const target=items[index];target.focus({preventScroll:true});target.scrollIntoView({block:"nearest",inline:"nearest"});return target;};
  const activate=()=>{const target=document.activeElement;if(!(target instanceof HTMLElement)||!dialog.contains(target))return false;if(target instanceof HTMLInputElement&&target.type==="range")return false;latchFlightRelease();target.click();return true;};
  const horizontal=direction=>{const target=document.activeElement;if(target instanceof HTMLInputElement&&dialog.contains(target)){if(target.type==="range")return adjustRange(target,direction);if(target.type==="checkbox"){latchFlightRelease();target.click();return true;}}return false;};
  const frame=()=>{
    if(!running)return;let pad=null;try{pad=getGamepad?.()||null;}catch{}
    if(!pad){previous.fill(false);stickLatchX=stickLatchY=0;requestAnimationFrame(frame);return;}
    const pressed=previous.map((_,index)=>buttonPressed(pad,index)),edge=index=>pressed[index]&&!previous[index];
    const menuEdge=edge(SETTINGS_GAMEPAD_BUTTON.MENU),viewEdge=edge(SETTINGS_GAMEPAD_BUTTON.VIEW),resetEdge=!globalThis.__arondightOnFootMode&&edge(SETTINGS_GAMEPAD_BUTTON.Y),backEdge=edge(SETTINGS_GAMEPAD_BUTTON.B)||viewEdge;
    if(!dialog.open){if(menuEdge){latchFlightRelease();openDialog?.("gamepad");}else if(viewEdge)clickSoloAction("#soloExit","gamepadExitCount");else if(resetEdge)clickSoloAction("#soloReset","gamepadResetCount");}
    else{
      if(backEdge){latchFlightRelease();closeDialog?.("gamepad");}
      else{
        const axisY=Number(pad.axes?.[1])||0,axisX=Number(pad.axes?.[0])||0;
        const navY=edge(SETTINGS_GAMEPAD_BUTTON.DPAD_DOWN)?1:edge(SETTINGS_GAMEPAD_BUTTON.DPAD_UP)?-1:Math.abs(axisY)>.72&&stickLatchY===0?Math.sign(axisY):0;
        const navX=edge(SETTINGS_GAMEPAD_BUTTON.DPAD_RIGHT)?1:edge(SETTINGS_GAMEPAD_BUTTON.DPAD_LEFT)?-1:Math.abs(axisX)>.72&&stickLatchX===0?Math.sign(axisX):0;
        if(Math.abs(axisY)<.35)stickLatchY=0;else if(navY)stickLatchY=Math.sign(axisY)||navY;
        if(Math.abs(axisX)<.35)stickLatchX=0;else if(navX)stickLatchX=Math.sign(axisX)||navX;
        if(navY)setFocus(navY);else if(navX)horizontal(navX);else if(edge(SETTINGS_GAMEPAD_BUTTON.A))activate();
      }
    }
    previous=pressed;requestAnimationFrame(frame);
  };
  dialog.addEventListener("close",()=>{stickLatchX=stickLatchY=0;});
  requestAnimationFrame(frame);
  return{focusFirst:()=>setFocus(0),destroy(){running=false;}};
}
