// RUSH HUD skin matching the neon wireframe world: rounded pills, green
// glow borders, no photos. Layout and visibility stay untouched.

export const NEON_UI_THEME_VERSION="rush-neon-ui-v1";
const R="html.neon-line-style:not(#ng-a):not(#ng-b):not(#ng-c)";
const CSS=`
${R}{--ui-fill:rgba(4,12,10,.72);--ui-line:#3dff8a;--ui-text:#d8ffe8;--ui-accent:#3dff8a;--ui-font:"Inter",system-ui,-apple-system,"Segoe UI",sans-serif;
  --ng:#d8ffe8;--ng-core:#effff6;--ng-dim:rgba(61,255,138,.4);--ng-glow:0 0 12px rgba(61,255,138,.45);--ng-fill:var(--ui-fill);--ng-text:var(--ui-text);--ng-font:var(--ui-font)}
${R} #viewport :is(button,[role="button"],a.linkbutton),${R} :is(#mobileGameplayDock,#soloTopbar,#cameraModes,#desktopDroneWeaponSwitch) button,${R} .phone-settings-button,
${R} :is(#playerModeButton,#driveModeButton,#gtaVehicleButton,#lanVsButton,#wantedEmpButton,#droneWeaponToggle,#footWeaponToggle,#footFire,#soloArm,#soloReset,#soloExit,#soloWorld,#soloLogbook,#soloCamera,#mobileGameplayReset,#mobileGameplayMultiplayer,#gameExitButton,#gameplayContractButton,#soundToggle,#installApp,#soundSwitch,#musicSwitch,#gameMenuStart){
  background:rgba(4,14,10,.62)!important;background-image:none!important;color:#d8ffe8!important;border:1.5px solid #3dff8a!important;border-radius:16px!important;
  box-shadow:0 0 12px rgba(61,255,138,.28)!important;text-shadow:0 0 8px rgba(61,255,138,.55)!important;text-transform:uppercase!important;
  font-family:var(--ui-font)!important;font-weight:700!important;letter-spacing:.08em!important;backdrop-filter:none!important}
${R} :is(#soloReset,#mobileGameplayReset,#gameExitButton){border-color:#c4495a!important;color:#ffb4be!important;box-shadow:0 0 10px rgba(196,73,90,.35)!important}
${R} :is(#droneWeaponToggle,#footWeaponToggle,#footFire){border-color:#c4a15a!important;color:#ffe3a8!important}
${R} :is(#worldLookHud,#soloHud,#footHud,#vehicleHud,dialog,.panel,.telemetry){
  background:rgba(2,10,8,.78)!important;background-image:none!important;border:1px solid rgba(61,255,138,.7)!important;border-radius:14px!important;color:#d8ffe8!important;
  box-shadow:0 0 14px rgba(61,255,138,.22)!important}
${R} :is(input,select,textarea){background:#010806!important;color:#d8ffe8!important;border:1px solid #3dff8a!important;border-radius:10px!important;font-family:var(--ui-font)!important}
`;
const MIN_FONT_PX=9;
let labelNodes=[],labelTreeDirty=true,labelFitQueued=0;
function collectLabelNodes(){labelNodes=[...document.querySelectorAll("#viewport button,#soloTopbar button,#mobileGameplayDock button,.phone-settings-button")];labelTreeDirty=false;}
function fitLabels(){
  labelFitQueued=0;if(labelTreeDirty)collectLabelNodes();
  for(const el of labelNodes){if(!el.isConnected||!el.clientWidth)continue;const text=el.textContent;if(el.dataset.ngFitText===text&&el.dataset.ngFitWidth===String(el.clientWidth))continue;
    el.style.removeProperty("font-size");el.dataset.ngFitText=text;el.dataset.ngFitWidth=String(el.clientWidth);
    let size=parseFloat(getComputedStyle(el).fontSize)||12,guard=0;while(el.scrollWidth>el.clientWidth+1&&size>MIN_FONT_PX&&guard++<12){size-=.75;el.style.setProperty("font-size",`${size}px`,"important");}}
}
function scheduleLabelFit(tree=false){if(tree)labelTreeDirty=true;if(labelFitQueued)return;labelFitQueued=requestAnimationFrame(fitLabels);}
function guardMinimap(){
  setTimeout(guardMinimap,1000);const b=globalThis.__arondightRealWorld,hud=document.getElementById("worldLookHud");if(!b?.active||!hud)return;
  const cs=getComputedStyle(hud),r=hud.getBoundingClientRect(),why=hud.hidden?"hidden-attr":cs.display==="none"?"display-none":cs.visibility==="hidden"?"visibility":parseFloat(cs.opacity)<.2?"opacity":r.width<20||r.height<20?"zero-size":r.right<10||r.bottom<10||r.left>innerWidth-10||r.top>innerHeight-10?"offscreen":"";
  if(!why){const top=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2),v=document.getElementById("viewport");if(v)v.dataset.minimapGuard=top&&!hud.contains(top)&&!top.closest?.("dialog,#gameMenu")?`covered:${top.id||top.className||top.tagName}`:"ok";return;}
  const v=document.getElementById("viewport");if(v)v.dataset.minimapGuard=why;
  hud.hidden=false;hud.style.setProperty("display","block","important");hud.style.setProperty("visibility","visible","important");hud.style.setProperty("opacity","1","important");
  if(why==="zero-size"||why==="offscreen"){hud.style.setProperty("width","132px","important");hud.style.setProperty("height","132px","important");hud.style.setProperty("right","max(8px,env(safe-area-inset-right))","important");hud.style.setProperty("left","auto","important");hud.style.setProperty("top","calc(max(8px,env(safe-area-inset-top)) + 46px)","important");}
}
let installed=false;
export function installNeonUiTheme(){
  if(installed||typeof document==="undefined")return;installed=true;
  document.documentElement.classList.add("neon-line-style");
  const style=document.createElement("style");style.dataset.neonUiTheme=NEON_UI_THEME_VERSION;style.textContent=CSS;
  (document.head||document.documentElement).appendChild(style);
  const labelObserver=new MutationObserver(()=>scheduleLabelFit(true));labelObserver.observe(document.body,{subtree:true,childList:true,characterData:true});
  addEventListener("resize",()=>scheduleLabelFit(true),{passive:true});addEventListener("orientationchange",()=>scheduleLabelFit(true),{passive:true});
  scheduleLabelFit(true);setTimeout(guardMinimap,1500);
}
installNeonUiTheme();
