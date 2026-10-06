// Neon arcade skin for every on-screen control, matching the world style
// (neon_line_style.mjs). Only paint properties are touched — colors, borders,
// glow, fonts — never display/position/size, so all existing layout and
// visibility logic keeps working. Prefixed with html.neon-line-style for
// specificity so it wins over the per-module !important rules.

export const NEON_UI_THEME_VERSION="neon-arcade-ui-v1";

const R="html.neon-line-style";
const CSS=`
${R}{--neon-cyan:#2ef6ff;--neon-magenta:#ff3df2;--neon-green:#39ff7a;--neon-amber:#ffb020;--neon-red:#ff2a4d;--neon-panel:rgba(4,8,22,.74);--neon-font:ui-monospace,"SF Mono",Menlo,Consolas,monospace}
/* Buttons and chips */
${R} #viewport button,${R} #mobileGameplayDock button,${R} #soloTopbar button,${R} .phone-settings-button{
  background:var(--neon-panel)!important;color:var(--neon-cyan)!important;border:1.5px solid var(--neon-cyan)!important;
  box-shadow:0 0 10px rgba(46,246,255,.35),inset 0 0 10px rgba(46,246,255,.12)!important;text-shadow:0 0 6px rgba(46,246,255,.8)!important;
  font-family:var(--neon-font)!important;letter-spacing:.12em!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
${R} #viewport button:active,${R} #mobileGameplayDock button:active{background:rgba(46,246,255,.18)!important}
${R} #viewport button[disabled]{opacity:.45!important;box-shadow:none!important}
/* Danger: reset / stop / exit */
${R} #soloReset,${R} #mobileGameplayReset,${R} #soloExit,${R} #gtaVehicleExit,${R} #viewport button[id*="Stop"],${R} #viewport button[id*="stop"]{
  color:var(--neon-red)!important;border-color:var(--neon-red)!important;box-shadow:0 0 10px rgba(255,42,77,.4),inset 0 0 10px rgba(255,42,77,.14)!important;text-shadow:0 0 6px rgba(255,42,77,.85)!important}
/* Weapons */
${R} #droneWeaponToggle,${R} #desktopDroneWeaponSwitch button,${R} #viewport button[id*="Weapon"],${R} #viewport button[id*="weapon"]{
  color:var(--neon-amber)!important;border-color:var(--neon-amber)!important;box-shadow:0 0 10px rgba(255,176,32,.4),inset 0 0 10px rgba(255,176,32,.12)!important;text-shadow:0 0 6px rgba(255,176,32,.85)!important}
/* Arm / go */
${R} #soloArm,${R} #viewport .start-sim-cta{color:var(--neon-green)!important;border-color:var(--neon-green)!important;box-shadow:0 0 12px rgba(57,255,122,.45),inset 0 0 10px rgba(57,255,122,.14)!important;text-shadow:0 0 6px rgba(57,255,122,.85)!important}
/* HUD panels */
${R} #soloClearance,${R} #playerVitalsHud,${R} #wantedHud,${R} #footHud,${R} #vehicleHud,${R} #gtaVehicleHud,${R} #vsCombatHud,${R} #worldLookHud,${R} #soloRaceHud,${R} #worldMapLegend,${R} .solo-height-pad{
  background:var(--neon-panel)!important;border:1px solid rgba(46,246,255,.55)!important;box-shadow:0 0 12px rgba(46,246,255,.22)!important;color:#d8fbff!important;font-family:var(--neon-font)!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
/* Joysticks */
${R} .foot-stick .ring,${R} .solo-ring{border:2px solid var(--neon-cyan)!important;background:radial-gradient(circle,rgba(46,246,255,.06) 0,rgba(4,8,22,.35) 70%)!important;box-shadow:0 0 16px rgba(46,246,255,.4),inset 0 0 22px rgba(46,246,255,.18)!important}
${R} .foot-stick .knob,${R} .solo-knob,${R} .solo-height-knob{background:rgba(4,8,22,.55)!important;border:2px solid var(--neon-magenta)!important;box-shadow:0 0 14px rgba(255,61,242,.6),inset 0 0 10px rgba(255,61,242,.35)!important}
${R} .foot-stick,${R} .solo-stick{color:var(--neon-cyan)!important;font-family:var(--neon-font)!important;text-shadow:0 0 6px rgba(46,246,255,.8)!important}
/* Settings dialog */
${R} .phone-settings-dialog{background:#050a18f2!important;border:1.5px solid var(--neon-cyan)!important;box-shadow:0 0 30px rgba(46,246,255,.3)!important;color:#d8fbff!important;font-family:var(--neon-font)!important}
${R} .phone-settings-dialog h3,${R} .phone-settings-dialog h4{color:var(--neon-magenta)!important;text-shadow:0 0 8px rgba(255,61,242,.7)!important;letter-spacing:.14em!important}
${R} .phone-settings-dialog input[type=range]{accent-color:var(--neon-cyan)!important}
${R} .phone-settings-dialog input[type=checkbox]{accent-color:var(--neon-green)!important}
${R} .phone-settings-dialog button{background:var(--neon-panel)!important;color:var(--neon-cyan)!important;border:1px solid var(--neon-cyan)!important}
`;

let installed=false;
export function installNeonUiTheme(){
  if(installed||typeof document==="undefined")return;installed=true;
  document.documentElement.classList.add("neon-line-style");
  const style=document.createElement("style");style.dataset.neonUiTheme=NEON_UI_THEME_VERSION;style.textContent=CSS;
  (document.head||document.documentElement).appendChild(style);
}
installNeonUiTheme();
