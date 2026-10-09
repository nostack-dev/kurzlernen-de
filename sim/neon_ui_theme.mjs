// Game UI skin for every on-screen control, matching the stylized world
// (stylized_world_style.mjs): chunky rounded buttons, translucent navy
// panels, white bold text and one warm accent. Only paint properties are
// touched — colors, borders, shadows, fonts — never display/position/size,
// so all layout and visibility logic keeps working. The html class
// "neon-line-style" is kept as the specificity hook other modules use.

export const NEON_UI_THEME_VERSION="realistic-hud-ui-v5-inter";

// The :not(#…) chain lifts specificity above the per-module id rules.
const R="html.neon-line-style:not(#ng-a):not(#ng-b):not(#ng-c)";
const CSS=`
${R}{--ui-fill:rgba(10,13,18,.56);--ui-fill-strong:rgba(10,13,18,.82);--ui-line:rgba(255,255,255,.16);--ui-text:#f2f4f7;--ui-soft:rgba(242,244,247,.72);--ui-accent:#f5b301;--ui-accent-ink:#1a1200;--ui-cyan:#7cc4ff;--ui-shadow:0 1px 2px rgba(0,0,0,.45);--ui-font:"Inter",-apple-system,"SF Pro Text",system-ui,"Segoe UI",Roboto,sans-serif;
  /* legacy variable names other modules still read */
  --ng:var(--ui-text);--ng-core:#fff;--ng-dim:var(--ui-line);--ng-glow:transparent;--ng-glow-soft:transparent;--ng-fill:var(--ui-fill);--ng-text:var(--ui-text);--ng-font:var(--ui-font)}
${R} #viewport :is(button,[role="button"],a.linkbutton),${R} :is(#mobileGameplayDock,#soloTopbar,#cameraModes,#desktopDroneWeaponSwitch) button,${R} .phone-settings-button,
${R} :is(#playerModeButton,#driveModeButton,#gtaVehicleButton,#lanVsButton,#wantedEmpButton,#droneWeaponToggle,#footWeaponToggle,#footFire,#soloArm,#soloReset,#soloExit,#soloWorld,#soloLogbook,#soloCamera,#mobileGameplayReset,#mobileGameplayMultiplayer,#gameExitButton,#gameplayContractButton,#soundToggle){
  background:var(--ui-fill)!important;background-image:none!important;color:var(--ui-text)!important;border:1px solid var(--ui-line)!important;border-radius:6px!important;
  box-shadow:var(--ui-shadow)!important;text-shadow:0 1px 1px rgba(0,0,0,.5)!important;filter:none!important;text-transform:uppercase!important;
  font-family:var(--ui-font)!important;font-weight:600!important;font-style:normal!important;letter-spacing:.05em!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:clip!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
${R} :is(#soloArm,#gameMenu .menu-start,#gameMenuStart){background:var(--ui-accent)!important;color:var(--ui-accent-ink)!important;border-color:rgba(255,255,255,.35)!important;text-shadow:none!important;box-shadow:0 1px 2px rgba(0,0,0,.45)!important}
${R} #soloArm.armed{background:#2f9e5a!important;color:#ffffff!important;box-shadow:0 1px 2px rgba(0,0,0,.45)!important}
${R} #wantedEmpButton{background:rgba(40,110,170,.85)!important;color:#fff!important;border-color:rgba(255,255,255,.35)!important}
${R} #viewport :is(button,[role="button"]):active{background:var(--ui-fill-strong)!important}
${R} #viewport button[disabled]{opacity:.45!important}
/* Panels and HUD read-outs */
/* (#soloHud, #footHud, #vehicleHud, #gtaVehicleHud are full-screen
   containers — giving them a panel fill put a dark veil over the scene.) */
${R} :is(#soloClearance,#soloRaceHud,#soloHeightPad,.solo-height-pad,#playerVitalsHud,#wantedHud,#vsCombatHud,#vsRespawnHud,#worldLookHud,#worldMapLegend,#gameplayContractHud,#gameplayContractBar,#gameplayScorePill,#gameplayToast,#mobileGameplayDock,#mobileGameplayMultiplayerStatus,#soloArmToolbar,#cameraModes){
  background:var(--ui-fill)!important;background-image:none!important;border:1px solid var(--ui-line)!important;box-shadow:var(--ui-shadow)!important;color:var(--ui-text)!important;border-radius:6px!important;
  font-family:var(--ui-font)!important;text-shadow:0 1px 1px rgba(0,0,0,.5)!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
${R} :is(#soloHud,#playerVitalsHud,#footHud,#vehicleHud,#wantedHud,#soloClearance,.solo-height-pad,#soloHeightPad) *{color:inherit;text-shadow:0 1px 0 rgba(0,0,0,.3)!important;background-image:none!important}
${R} :is(#playerVitalsHud,#soloClearance,.solo-height-pad,#soloHeightPad) :is(b,strong,output,[data-value]){color:var(--ui-accent)!important}
/* Joysticks: soft white rings */
${R} :is(.foot-stick .ring,.solo-ring){border:1.5px solid rgba(255,255,255,.2)!important;background:transparent!important;background-image:none!important;box-shadow:none!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
${R} :is(.foot-stick .knob,.solo-knob){background:rgba(255,255,255,.16)!important;background-image:none!important;border:1.5px solid rgba(255,255,255,.42)!important;box-shadow:none!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
${R} :is(.foot-stick,.solo-stick).stick-live :is(.ring,.solo-ring){border-color:rgba(255,255,255,.5)!important}
${R} :is(.foot-stick,.solo-stick).stick-live :is(.knob,.solo-knob){background:rgba(255,255,255,.34)!important;border-color:rgba(255,255,255,.75)!important}
${R} .solo-height-knob{background:rgba(242,244,247,.7)!important;background-image:none!important;border:1px solid rgba(255,255,255,.9)!important;box-shadow:0 1px 3px rgba(0,0,0,.4)!important}
${R} :is(.foot-stick,.solo-stick),${R} :is(.foot-stick,.solo-stick) *{color:#f2f4f7!important;font-family:var(--ui-font)!important;font-weight:600!important;letter-spacing:.06em!important;text-shadow:0 1px 1px rgba(0,0,0,.5)!important}
${R} #footMove.sprinting .ring{border-color:var(--ui-accent)!important;box-shadow:none!important}
/* Settings dialog */
${R} :is(.phone-settings-dialog,#flightLogbookDialog,dialog){background:#12161cf5!important;background-image:none!important;border:1px solid var(--ui-line)!important;box-shadow:0 10px 30px rgba(0,0,0,.45)!important;color:var(--ui-text)!important;font-family:var(--ui-font)!important;border-radius:8px!important}
${R} :is(.phone-settings-dialog,dialog) :is(h2,h3,h4){color:var(--ui-accent)!important;text-shadow:none!important;letter-spacing:.06em!important}
${R} :is(.phone-settings-dialog,dialog) :is(button,select,input[type=number],input[type=text]){background:rgba(255,255,255,.1)!important;background-image:none!important;color:#fff!important;border:1.5px solid var(--ui-line)!important}
${R} :is(.phone-settings-dialog,dialog) input[type=range],${R} :is(.phone-settings-dialog,dialog) input[type=checkbox]{accent-color:var(--ui-accent)!important}
${R} #viewport{background:#b7c9dc!important}
/* One typeface everywhere (the per-module system-ui/monospace mixes looked
   cheap): Inter, tabular figures so numbers don't jitter. */
${R} body,${R} body *:not(svg):not(svg *):not(code):not(pre){font-family:var(--ui-font)!important;font-feature-settings:"tnum" 1,"cv11" 1}
/* No aiming reticle anywhere (the tracers show where shots go) */
${R} :is(#footReticle,.xbox-crosshair){display:none!important}
/* The minimap always sits above every overlay layer */
${R} #worldLookHud{z-index:12!important}
/* Wanted banner sits below the top dock, never on it */
${R} #wantedHud{top:calc(max(8px,var(--solo-safe-top,env(safe-area-inset-top))) + 56px)!important;background:var(--ui-fill)!important;border:1px solid var(--ui-line)!important;border-radius:6px!important;box-shadow:var(--ui-shadow)!important}
${R} :is(#soloHud,#footHud,#vehicleHud,#gtaVehicleHud,#sandboxHud){background:transparent!important;border:0!important;box-shadow:none!important}
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
  // Only button label changes matter. HUD readouts change text every frame; refitting (which
  // reads clientWidth/scrollWidth = a forced layout) on each of them cost a layout per frame.
  const inButton=n=>{const el=n?.nodeType===1?n:n?.parentElement;return Boolean(el?.closest?.("button,.phone-settings-button"));};
  const labelObserver=new MutationObserver(list=>{let tree=false,text=false;for(const m of list){if(m.type==="childList"){for(const n of m.addedNodes)if(n.nodeType===1&&(n.matches?.("button,.phone-settings-button")||n.querySelector?.("button"))){tree=true;break;}if(!tree&&inButton(m.target))text=true;}else if(inButton(m.target))text=true;if(tree)break;}if(tree||text)scheduleLabelFit(tree);});labelObserver.observe(document.body,{subtree:true,childList:true,characterData:true});
  addEventListener("resize",()=>scheduleLabelFit(true),{passive:true});addEventListener("orientationchange",()=>scheduleLabelFit(true),{passive:true});
  scheduleLabelFit(true);setTimeout(guardMinimap,1500);
}
installNeonUiTheme();
