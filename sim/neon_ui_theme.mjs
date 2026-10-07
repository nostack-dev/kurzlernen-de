// Game UI skin for every on-screen control, matching the stylized world
// (stylized_world_style.mjs): chunky rounded buttons, translucent navy
// panels, white bold text and one warm accent. Only paint properties are
// touched — colors, borders, shadows, fonts — never display/position/size,
// so all layout and visibility logic keeps working. The html class
// "neon-line-style" is kept as the specificity hook other modules use.

export const NEON_UI_THEME_VERSION="stylized-game-ui-v1";

// The :not(#…) chain lifts specificity above the per-module id rules.
const R="html.neon-line-style:not(#ng-a):not(#ng-b):not(#ng-c)";
const CSS=`
${R}{--ui-fill:rgba(18,28,52,.62);--ui-fill-strong:rgba(18,28,52,.86);--ui-line:rgba(255,255,255,.30);--ui-text:#ffffff;--ui-soft:rgba(255,255,255,.78);--ui-accent:#ffc93c;--ui-accent-ink:#3a2600;--ui-shadow:0 3px 0 rgba(8,14,30,.35);--ui-font:"Nunito","Trebuchet MS",system-ui,-apple-system,"Segoe UI",sans-serif;
  /* legacy variable names other modules still read */
  --ng:var(--ui-text);--ng-core:#fff;--ng-dim:var(--ui-line);--ng-glow:transparent;--ng-glow-soft:transparent;--ng-fill:var(--ui-fill);--ng-text:var(--ui-text);--ng-font:var(--ui-font)}
${R} #viewport :is(button,[role="button"],a.linkbutton),${R} :is(#mobileGameplayDock,#soloTopbar,#cameraModes,#desktopDroneWeaponSwitch) button,${R} .phone-settings-button,
${R} :is(#playerModeButton,#driveModeButton,#gtaVehicleButton,#lanVsButton,#wantedEmpButton,#droneWeaponToggle,#footWeaponToggle,#footFire,#soloArm,#soloReset,#soloExit,#soloWorld,#soloLogbook,#soloCamera,#mobileGameplayReset,#mobileGameplayMultiplayer,#gameExitButton,#gameplayContractButton,#soundToggle){
  background:var(--ui-fill)!important;background-image:none!important;color:var(--ui-text)!important;border:1.5px solid var(--ui-line)!important;border-radius:12px!important;
  box-shadow:var(--ui-shadow)!important;text-shadow:0 1px 0 rgba(0,0,0,.35)!important;filter:none!important;
  font-family:var(--ui-font)!important;font-weight:800!important;letter-spacing:.04em!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:clip!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
${R} :is(#soloArm,#gameMenu .menu-start,#gameMenuStart){background:var(--ui-accent)!important;color:var(--ui-accent-ink)!important;border-color:rgba(255,255,255,.65)!important;text-shadow:none!important}
${R} #soloArm.armed{background:#38d27a!important;color:#062814!important}
${R} #wantedEmpButton{background:#3aa0ff!important;border-color:rgba(255,255,255,.7)!important}
${R} #viewport :is(button,[role="button"]):active{background:var(--ui-fill-strong)!important;box-shadow:0 1px 0 rgba(8,14,30,.35)!important}
${R} #viewport button[disabled]{opacity:.45!important}
/* Panels and HUD read-outs */
${R} :is(#soloHud,#soloClearance,#soloRaceHud,#soloHeightPad,.solo-height-pad,#playerVitalsHud,#wantedHud,#footHud,#vehicleHud,#gtaVehicleHud,#vsCombatHud,#vsRespawnHud,#worldLookHud,#worldMapLegend,#gameplayContractHud,#gameplayContractBar,#gameplayScorePill,#gameplayToast,#mobileGameplayDock,#mobileGameplayMultiplayerStatus,#soloArmToolbar,#cameraModes){
  background:var(--ui-fill)!important;background-image:none!important;border:1.5px solid var(--ui-line)!important;box-shadow:var(--ui-shadow)!important;color:var(--ui-text)!important;border-radius:14px!important;
  font-family:var(--ui-font)!important;text-shadow:0 1px 0 rgba(0,0,0,.3)!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
${R} :is(#soloHud,#playerVitalsHud,#footHud,#vehicleHud,#wantedHud,#soloClearance,.solo-height-pad,#soloHeightPad) *{color:inherit;text-shadow:0 1px 0 rgba(0,0,0,.3)!important;background-image:none!important}
${R} :is(#playerVitalsHud,#soloClearance,.solo-height-pad,#soloHeightPad) :is(b,strong,output,[data-value]){color:var(--ui-accent)!important}
/* Joysticks: soft white rings */
${R} :is(.foot-stick .ring,.solo-ring){border:2px solid rgba(255,255,255,.55)!important;background:rgba(18,28,52,.22)!important;background-image:none!important;box-shadow:none!important}
${R} :is(.foot-stick .knob,.solo-knob,.solo-height-knob){background:rgba(255,255,255,.78)!important;background-image:none!important;border:2px solid #fff!important;box-shadow:0 2px 0 rgba(8,14,30,.3)!important}
${R} :is(.foot-stick,.solo-stick),${R} :is(.foot-stick,.solo-stick) *{color:#fff!important;font-family:var(--ui-font)!important;text-shadow:0 1px 0 rgba(0,0,0,.4)!important}
${R} #footMove.sprinting .ring{border-color:var(--ui-accent)!important;box-shadow:none!important}
/* Settings dialog */
${R} :is(.phone-settings-dialog,#flightLogbookDialog,dialog){background:#18223af5!important;background-image:none!important;border:1.5px solid var(--ui-line)!important;box-shadow:0 10px 30px rgba(0,0,0,.35)!important;color:var(--ui-text)!important;font-family:var(--ui-font)!important;border-radius:16px!important}
${R} :is(.phone-settings-dialog,dialog) :is(h2,h3,h4){color:var(--ui-accent)!important;text-shadow:none!important;letter-spacing:.06em!important}
${R} :is(.phone-settings-dialog,dialog) :is(button,select,input[type=number],input[type=text]){background:rgba(255,255,255,.1)!important;background-image:none!important;color:#fff!important;border:1.5px solid var(--ui-line)!important}
${R} :is(.phone-settings-dialog,dialog) input[type=range],${R} :is(.phone-settings-dialog,dialog) input[type=checkbox]{accent-color:var(--ui-accent)!important}
${R} #viewport{background:#d7efff!important}
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
  document.getElementById("crtPhosphorOverlay")?.remove();
  setTimeout(fitLabels,300);
}
installNeonUiTheme();
