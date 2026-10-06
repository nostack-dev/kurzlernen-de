// Clean neon-green skin for every on-screen control, matching the world style
// (neon_line_style.mjs). Only paint properties are touched — colors, borders,
// glow, fonts — never display/position/size, so all existing layout and
// visibility logic keeps working. Prefixed with html.neon-line-style for
// specificity so it wins over the per-module !important rules.

export const NEON_UI_THEME_VERSION="clean-neon-green-ui-v2";

// The :not(#…) chain lifts specificity above the per-module id rules (some
// use two ids + !important, which kept e.g. RESET red).
const R="html.neon-line-style:not(#ng-a):not(#ng-b):not(#ng-c)";
const CSS=`
${R}{--ng:rgba(0,255,156,.88);--ng-dim:rgba(0,255,156,.42);--ng-glow:rgba(0,255,156,.12);--ng-fill:rgba(2,10,6,.42);--ng-text:rgba(214,255,232,.86);--ng-font:ui-monospace,"SF Mono",Menlo,Consolas,monospace}
/* One clean style for every control: near-black fill, single neon-green
   hairline, green text, faint glow. No gradients, textures or blur. */
${R} #viewport :is(button,[role="button"],a.linkbutton),${R} :is(#mobileGameplayDock,#soloTopbar,#cameraModes,#desktopDroneWeaponSwitch) button,${R} .phone-settings-button,
${R} :is(#playerModeButton,#driveModeButton,#gtaVehicleButton,#lanVsButton,#wantedEmpButton,#droneWeaponToggle,#footWeaponToggle,#footFire,#soloArm,#soloReset,#soloExit,#soloWorld,#soloLogbook,#soloCamera,#mobileGameplayReset,#mobileGameplayMultiplayer,#gameplayContractButton,#soundToggle){
  background:var(--ng-fill)!important;background-image:none!important;color:var(--ng)!important;border:1px solid var(--ng-dim)!important;border-radius:9px!important;
  box-shadow:none!important;text-shadow:none!important;filter:none!important;
  font-family:var(--ng-font)!important;font-weight:600!important;letter-spacing:.12em!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
${R} #viewport :is(button,[role="button"]):active{background:rgba(0,255,156,.16)!important}
${R} #viewport button[disabled]{opacity:.4!important;box-shadow:none!important}
/* Panels and HUD read-outs */
${R} :is(#soloHud,#soloClearance,#soloRaceHud,#soloHeightPad,.solo-height-pad,#playerVitalsHud,#wantedHud,#footHud,#vehicleHud,#gtaVehicleHud,#vsCombatHud,#vsRespawnHud,#worldLookHud,#worldMapLegend,#gameplayContractHud,#gameplayContractBar,#gameplayScorePill,#gameplayToast,#mobileGameplayDock,#mobileGameplayMultiplayerStatus,#soloArmToolbar,#cameraModes){
  background:var(--ng-fill)!important;background-image:none!important;border:1px solid var(--ng-dim)!important;box-shadow:none!important;color:var(--ng-text)!important;
  font-family:var(--ng-font)!important;text-shadow:none!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
${R} :is(#soloHud,#playerVitalsHud,#footHud,#vehicleHud,#wantedHud,#soloClearance,.solo-height-pad,#soloHeightPad) *{color:inherit;text-shadow:none!important;background-image:none!important}
${R} :is(#playerVitalsHud,#soloClearance,.solo-height-pad,#soloHeightPad) :is(b,strong,output,[data-value]){color:var(--ng)!important}
/* Joysticks: plain rings, no fill textures */
${R} :is(.foot-stick .ring,.solo-ring){border:1px solid var(--ng-dim)!important;background:rgba(2,10,6,.12)!important;background-image:none!important;box-shadow:none!important}
${R} :is(.foot-stick .knob,.solo-knob,.solo-height-knob){background:rgba(2,10,6,.3)!important;background-image:none!important;border:1px solid var(--ng)!important;box-shadow:0 0 6px var(--ng-glow)!important}
${R} :is(.foot-stick,.solo-stick),${R} :is(.foot-stick,.solo-stick) *{color:var(--ng)!important;font-family:var(--ng-font)!important;text-shadow:none!important}
/* Settings dialog */
${R} :is(.phone-settings-dialog,#flightLogbookDialog,dialog){background:#020a06f2!important;background-image:none!important;border:1px solid var(--ng-dim)!important;box-shadow:none!important;color:var(--ng-text)!important;font-family:var(--ng-font)!important}
${R} :is(.phone-settings-dialog,dialog) :is(h2,h3,h4){color:var(--ng)!important;text-shadow:none!important;letter-spacing:.14em!important}
${R} :is(.phone-settings-dialog,dialog) :is(button,select,input[type=number],input[type=text]){background:var(--ng-fill)!important;background-image:none!important;color:var(--ng)!important;border:1px solid var(--ng-dim)!important}
${R} :is(.phone-settings-dialog,dialog) input[type=range],${R} :is(.phone-settings-dialog,dialog) input[type=checkbox]{accent-color:var(--ng)!important}
`;

let installed=false;
export function installNeonUiTheme(){
  if(installed||typeof document==="undefined")return;installed=true;
  document.documentElement.classList.add("neon-line-style");
  const style=document.createElement("style");style.dataset.neonUiTheme=NEON_UI_THEME_VERSION;style.textContent=CSS;
  (document.head||document.documentElement).appendChild(style);
}
installNeonUiTheme();
