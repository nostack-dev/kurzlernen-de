// Small EXIT next to MULTI (split button: MULTI | EXIT). Leaves the flight
// and returns to the start menu. Positioned from MULTI's live box so it
// follows safe areas, compact layouts and MULTI's own show/hide logic.

export const GAME_EXIT_VERSION="split-multi-exit-v1";
let installed=false,button=null;
const viewport=()=>document.getElementById("viewport");

function ensure(){
  if(button?.isConnected)return button;const view=viewport();if(!view)return null;
  button=document.createElement("button");button.id="gameExitButton";button.type="button";button.textContent="EXIT";button.setAttribute("aria-label","Exit to menu");button.hidden=true;
  button.addEventListener("pointerdown",event=>event.stopPropagation());
  button.addEventListener("click",event=>{event.preventDefault();event.stopPropagation();document.getElementById("soloExit")?.click();const menu=document.getElementById("gameMenu");if(menu){menu.hidden=false;const start=document.getElementById("gameMenuStart");if(start){start.disabled=false;start.textContent="START";}}});
  view.appendChild(button);return button;
}
function sync(){
  const b=ensure(),multi=document.getElementById("mobileGameplayMultiplayer");
  if(b){const visible=Boolean(multi&&multi.offsetParent&&getComputedStyle(multi).display!=="none"&&document.body.classList.contains("solo-flight"));
    if(b.hidden===visible)b.hidden=!visible;
    if(visible){multi.classList.add("split-left");const left=`${multi.offsetLeft+multi.offsetWidth}px`,top=`${multi.offsetTop}px`,height=`${multi.offsetHeight}px`;if(b.style.left!==left)b.style.left=left;if(b.style.top!==top)b.style.top=top;if(b.style.height!==height)b.style.height=height;}}
  setTimeout(sync,400);
}
export function installGameExitButton(){
  if(installed)return;installed=true;
  const style=document.createElement("style");style.dataset.gameExit=GAME_EXIT_VERSION;
  style.textContent=`#gameExitButton{position:absolute;z-index:47;width:44px;min-height:0;margin:0;padding:0!important;display:flex;align-items:center;justify-content:center;font-size:8px!important;letter-spacing:.14em!important;border-top-left-radius:0!important;border-bottom-left-radius:0!important;pointer-events:auto;touch-action:manipulation}
#gameExitButton[hidden]{display:none!important}
html.neon-line-style:not(#ng-a):not(#ng-b):not(#ng-c) #gameExitButton{border-top-left-radius:0!important;border-bottom-left-radius:0!important;padding:0!important;font-size:8px!important}
html.neon-line-style:not(#ng-a):not(#ng-b):not(#ng-c) #mobileGameplayMultiplayer.split-left{width:52px!important;border-top-right-radius:0!important;border-bottom-right-radius:0!important;border-right-width:0!important}`;
  document.head.appendChild(style);sync();
}
installGameExitButton();
