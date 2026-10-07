// Clean neon-green skin for every on-screen control, matching the world style
// (neon_line_style.mjs). Only paint properties are touched — colors, borders,
// glow, fonts — never display/position/size, so all existing layout and
// visibility logic keeps working. Prefixed with html.neon-line-style for
// specificity so it wins over the per-module !important rules.

export const NEON_UI_THEME_VERSION="crt-phosphor-green-ui-v3";

// The :not(#…) chain lifts specificity above the per-module id rules (some
// use two ids + !important, which kept e.g. RESET red).
const R="html.neon-line-style:not(#ng-a):not(#ng-b):not(#ng-c)";
const CSS=`
${R}{--ng:rgba(102,255,153,.98);--ng-core:rgba(224,255,234,.98);--ng-dim:rgba(0,255,102,.66);--ng-glow:rgba(0,255,102,.42);--ng-glow-soft:rgba(0,255,102,.20);--ng-fill:rgba(0,7,3,.64);--ng-text:rgba(224,255,233,.94);--ng-font:ui-monospace,"SF Mono",Menlo,Consolas,monospace}
/* CRT phosphor style: bright green core plus a soft green halo.
   Layout stays untouched; only paint/shadow/filter properties change. */
${R} #viewport :is(button,[role="button"],a.linkbutton),${R} :is(#mobileGameplayDock,#soloTopbar,#cameraModes,#desktopDroneWeaponSwitch) button,${R} .phone-settings-button,
${R} :is(#playerModeButton,#driveModeButton,#gtaVehicleButton,#lanVsButton,#wantedEmpButton,#droneWeaponToggle,#footWeaponToggle,#footFire,#soloArm,#soloReset,#soloExit,#soloWorld,#soloLogbook,#soloCamera,#mobileGameplayReset,#mobileGameplayMultiplayer,#gameExitButton,#gameplayContractButton,#soundToggle){
  background:var(--ng-fill)!important;background-image:none!important;color:var(--ng)!important;border:1px solid var(--ng-dim)!important;border-radius:9px!important;
  box-shadow:0 0 0 1px rgba(0,255,102,.10) inset,0 0 7px var(--ng-glow),0 0 16px var(--ng-glow-soft)!important;text-shadow:0 0 2px var(--ng-core),0 0 5px var(--ng-glow),0 0 11px var(--ng-glow-soft)!important;filter:none!important;
  font-family:var(--ng-font)!important;font-weight:600!important;letter-spacing:.07em!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:clip!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
${R} #viewport :is(button,[role="button"]):active{background:rgba(0,255,156,.16)!important}
${R} #viewport button[disabled]{opacity:.4!important;box-shadow:0 0 4px var(--ng-glow-soft)!important}
/* Panels and HUD read-outs */
${R} :is(#soloHud,#soloClearance,#soloRaceHud,#soloHeightPad,.solo-height-pad,#playerVitalsHud,#wantedHud,#footHud,#vehicleHud,#gtaVehicleHud,#vsCombatHud,#vsRespawnHud,#worldLookHud,#worldMapLegend,#gameplayContractHud,#gameplayContractBar,#gameplayScorePill,#gameplayToast,#mobileGameplayDock,#mobileGameplayMultiplayerStatus,#soloArmToolbar,#cameraModes){
  background:var(--ng-fill)!important;background-image:none!important;border:1px solid var(--ng-dim)!important;box-shadow:0 0 9px var(--ng-glow-soft),inset 0 0 13px rgba(0,255,102,.05)!important;color:var(--ng-text)!important;
  font-family:var(--ng-font)!important;text-shadow:0 0 2px rgba(224,255,234,.75),0 0 7px var(--ng-glow-soft)!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
${R} :is(#soloHud,#playerVitalsHud,#footHud,#vehicleHud,#wantedHud,#soloClearance,.solo-height-pad,#soloHeightPad) *{color:inherit;text-shadow:0 0 2px rgba(224,255,234,.60),0 0 7px var(--ng-glow-soft)!important;background-image:none!important}
${R} :is(#playerVitalsHud,#soloClearance,.solo-height-pad,#soloHeightPad) :is(b,strong,output,[data-value]){color:var(--ng)!important}
/* Joysticks: plain rings, no fill textures */
${R} :is(.foot-stick .ring,.solo-ring){border:1px solid var(--ng)!important;background:rgba(0,8,3,.20)!important;background-image:none!important;box-shadow:0 0 6px var(--ng-glow),0 0 16px var(--ng-glow-soft),inset 0 0 12px rgba(0,255,102,.08)!important}
${R} :is(.foot-stick .knob,.solo-knob,.solo-height-knob){background:rgba(0,10,4,.34)!important;background-image:none!important;border:1px solid var(--ng-core)!important;box-shadow:0 0 5px var(--ng),0 0 13px var(--ng-glow)!important}
${R} :is(.foot-stick,.solo-stick),${R} :is(.foot-stick,.solo-stick) *{color:var(--ng)!important;font-family:var(--ng-font)!important;text-shadow:0 0 2px var(--ng-core),0 0 8px var(--ng-glow)!important}
/* Settings dialog */
${R} :is(.phone-settings-dialog,#flightLogbookDialog,dialog){background:#000603f4!important;background-image:none!important;border:1px solid var(--ng-dim)!important;box-shadow:0 0 14px var(--ng-glow-soft),inset 0 0 22px rgba(0,255,102,.04)!important;color:var(--ng-text)!important;font-family:var(--ng-font)!important}
${R} :is(.phone-settings-dialog,dialog) :is(h2,h3,h4){color:var(--ng)!important;text-shadow:0 0 2px var(--ng-core),0 0 9px var(--ng-glow)!important;letter-spacing:.14em!important}
${R} :is(.phone-settings-dialog,dialog) :is(button,select,input[type=number],input[type=text]){background:var(--ng-fill)!important;background-image:none!important;color:var(--ng)!important;border:1px solid var(--ng-dim)!important}
${R} :is(.phone-settings-dialog,dialog) input[type=range],${R} :is(.phone-settings-dialog,dialog) input[type=checkbox]{accent-color:var(--ng)!important}
${R} #viewport{background:#000201!important;isolation:isolate}
${R} #viewport canvas{filter:brightness(1.18) saturate(1.32) contrast(1.10)}
${R} #crtPhosphorOverlay{position:absolute;inset:0;z-index:9990;pointer-events:none;mix-blend-mode:screen;opacity:.30;background:repeating-linear-gradient(to bottom,rgba(0,255,102,.025) 0,rgba(0,255,102,.025) 1px,rgba(0,0,0,0) 1px,rgba(0,0,0,0) 3px);box-shadow:inset 0 0 55px rgba(0,255,102,.05)}
`;

// Labels must always fit their button (monospace is wide, and some labels
// change at runtime — e.g. ARM → CALIBRATING…): shrink the font of any
// overflowing control step by step, and restore it when there is room again.
const MIN_FONT_PX=7;
function fitLabels(){
  for(const el of document.querySelectorAll("#viewport button,#mobileGameplayDock button,#soloTopbar button,#gameExitButton")){
    if(!el.offsetParent||!el.clientWidth)continue;const text=el.textContent;
    if(el.dataset.ngFitText!==text){el.style.removeProperty("font-size");el.dataset.ngFitText=text;}
    let size=parseFloat(getComputedStyle(el).fontSize)||12,guard=0;
    while(el.scrollWidth>el.clientWidth+1&&size>MIN_FONT_PX&&guard++<12){size-=.75;el.style.setProperty("font-size",`${size}px`,"important");}
  }
  setTimeout(fitLabels,500);
}
let installed=false;
export function installNeonUiTheme(){
  if(installed||typeof document==="undefined")return;installed=true;
  document.documentElement.classList.add("neon-line-style");
  const style=document.createElement("style");style.dataset.neonUiTheme=NEON_UI_THEME_VERSION;style.textContent=CSS;
  (document.head||document.documentElement).appendChild(style);
  const mountOverlay=()=>{const view=document.getElementById("viewport");if(!view)return requestAnimationFrame(mountOverlay);if(!document.getElementById("crtPhosphorOverlay")){const overlay=document.createElement("i");overlay.id="crtPhosphorOverlay";overlay.setAttribute("aria-hidden","true");view.appendChild(overlay);}view.dataset.crtPhosphor="green-halo+scanlines-v1";};mountOverlay();
  setTimeout(fitLabels,300);
}
installNeonUiTheme();
