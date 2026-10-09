// Settings dialog: a short line under every setting (what it does, where, what it is good for),
// a tidy order, the 3D view near the top, debug switches folded away at the bottom.
//
// The dialog is assembled by many modules that keep references to their own inputs, so this
// module never rebuilds anything: it only moves whole rows and sections and adds <small> help
// lines. Every pass is idempotent, so it simply runs again whenever a module adds a section.
export const SETTINGS_HELP_VERSION="settings-help+tidy-v1";

const HELP={
  // control modes
  "mode-grid":"What you control right now. Each mode keeps its own settings below.",
  // drone
  "s:leftFineness":"Curve of the left stick (throttle, yaw). Higher = finer near centre, full rate only at the edge.",
  "s:rightFineness":"Curve of the right stick (pitch, roll). Higher for calm hovering and aiming, lower for quick moves.",
  "s:maxHorizontalSpeedKmh":"Top speed the flight controller allows. Lower is easier between buildings and indoors.",
  "s:defaultHoverAgl":"Height above ground the drone settles at after takeoff and holds hands-off.",
  "s:invertLeftHorizontal":"Swaps left/right on the left stick (yaw).",
  "s:invertRightHorizontal":"Swaps left/right on the right stick (roll).",
  "s:invertRightVertical":"Swaps up/down on the right stick (pitch).",
  // first person
  "s:moveFineness":"Curve of the move stick. Higher makes slow walking easy; sprint needs full deflection.",
  "s:lookFineness":"Curve of the look stick. Higher makes small aim corrections easy; fast turns need full deflection.",
  "s:horizontalLookSensitivityPercent":"Turn speed left/right for stick, touch and mouse. Lower for precise aim, higher for fast turns.",
  "s:verticalLookSensitivityPercent":"Look speed up/down for stick, touch and mouse.",
  "s:lookDeadzonePercent":"Xbox right stick only: ignores small stick drift. Raise it if the view creeps by itself. The mouse has none.",
  "s:aimAssistStrengthPercent":"Gentle pull toward targets near the crosshair on Xbox and touch. 0 turns it off.",
  "s:invertMoveHorizontal":"Swaps strafing left/right.",
  "s:invertLookHorizontal":"Swaps turning left/right (stick, touch and mouse).",
  "s:invertLookVertical":"Flight style: push up or move the mouse up to look down.",
  // vehicle
  "s:steeringSensitivityPercent":"How strongly the wheels follow stick or keys. Lower is steadier at speed, higher turns sharper.",
  "s:throttleSensitivityPercent":"How fast gas and brake build up. Lower gives smoother starts.",
  "s:maxSpeedKmh":"Top speed of your car.",
  "s:reverseSpeedKmh":"Top speed in reverse.",
  "s:cameraDistanceM":"How far the chase camera sits behind the car.",
  "s:cameraHeightM":"How high the chase camera sits above the car.",
  // hardware
  "xboxController":"ON: play with an Xbox pad, the touch sticks disappear. In this menu: D-pad moves, A selects, B closes.",
  "xboxScheme":"Drone on the Xbox pad. CLASSIC: right stick flies directly. AIM: hold LB to look and aim with a crosshair.",
  // 3D view and camera
  "stereoSbs":"Splits the screen for cross-eye 3D: cross your eyes until both halves merge into one sharp image.",
  "cam:tilt":"Up-tilt of the drone's FPV camera. Tilt up (20–40°) to see ahead at speed, down to watch the ground.",
  "cam:fov":"Drone camera field of view. Wide = overview and speed feel, narrow = zoom. Pinching the minimap changes it too.",
  "cam:third":"Distance of the drone's third-person chase camera.",
  // audio
  "audioEnabled":"Master switch for all sound effects.",
  "musicEnabled":"Background music on or off.",
  "aud:music":"Music volume.",
  "aud:drone":"Drone motor sound.",
  "aud:shots":"Gunfire and bullet impacts.",
  "aud:fx":"Explosions, breaking glass and other effects.",
  "aud:footsteps":"Footsteps, yours and other people's.",
  "aud:vehicle":"Car engines and tyres.",
  "aud:ambient":"City background and everything else.",
  // world
  "world-actions":"GPS builds the real streets and buildings around you. TRAINING RANGE is the offline test area.",
  "worldGrid":"Draws a 1 m reference grid. Visual only; helps judge distance and height.",
  "worldKeepLook":"OFF: the view swings back forward when you let go of look. ON: it stays where you left it.",
  "worldMinimapAxisLock":"Keeps the minimap north-up instead of turning with you (fullscreen is always north-up).",
  "worldLocationSelect":"Which real place the world is built from. Applies right away and is remembered.",
  // debug
  "debugGrid":"Helper lines on the training range. Visual only.",
  "box3dColliderDebug":"Shows the Box3D collision shapes as wireframes. Visual only, costs frame rate.",
};

const KEY_ATTRS=["stereoSbs","xboxController","xboxScheme","audioEnabled","musicEnabled","worldGrid","worldKeepLook","worldMinimapAxisLock","worldLocationSelect","debugGrid","box3dColliderDebug"];
function keyOf(input){const d=input.dataset;if(d.setting)return"s:"+d.setting;if(d.cameraSlider)return"cam:"+d.cameraSlider;if(d.audioSlider)return"aud:"+d.audioSlider;for(const k of KEY_ATTRS)if(k in d)return k;return null;}
function rowOf(input){return input.closest(".player-control-row,.phone-settings-row,label.phone-settings-toggle,label.player-control-toggle,label");}
function addHelp(after,key){const next=after.nextElementSibling;if(next?.classList.contains("setting-help")){if(next.dataset.helpKey===key)return;next.remove();}const text=HELP[key];if(!text)return;const s=document.createElement("small");s.className="setting-help";s.dataset.helpKey=key;s.textContent=text;after.after(s);}
function moveHelpWith(row){const h=row.nextElementSibling?.classList.contains("setting-help")?row.nextElementSibling:null;return h;}

function section(dialog,cls,title){let s=dialog.querySelector(`:scope > section.${cls.split(" ").pop()}`);if(!s){s=document.createElement("section");s.className=cls;s.innerHTML=`<h4>${title}</h4>`;}return s;}
function placeAfter(anchor,node){if(anchor&&node&&anchor.nextElementSibling!==node)anchor.after(node);return node||anchor;}

// The menu is also the pause menu: every game action that used to sit in the top bar is here,
// reachable with mouse, touch and the pad (the settings navigator walks these buttons too).
const GAME_ACTIONS=[
  ["resume","RESUME",d=>d.close()],
  ["reset","RESET",d=>{d.close();if(globalThis.__arondightRequestReset)globalThis.__arondightRequestReset();else document.getElementById("soloReset")?.click();}],
  ["multi","MULTIPLAYER",d=>{d.close();(document.getElementById("mobileGameplayMultiplayer")||document.getElementById("lanVsButton"))?.click();}],
  ["world","REAL WORLD",d=>{d.close();document.getElementById("soloWorld")?.click();}],
  ["logbook","LOGBOOK",d=>{d.close();document.getElementById("soloLogbook")?.click();}],
  ["exit","EXIT TO TITLE",d=>{d.close();document.getElementById("soloExit")?.click();}],
];
function gameSection(dialog){let s=dialog.querySelector(":scope > section.game-actions-section");if(s)return s;s=document.createElement("section");s.className="game-actions-section";s.innerHTML=`<div class="game-actions-grid">${GAME_ACTIONS.map(([k,l])=>`<button type="button" data-game-action="${k}">${l}</button>`).join("")}</div>`;
  s.addEventListener("click",e=>{const b=e.target.closest?.("[data-game-action]");if(!b)return;e.preventDefault();GAME_ACTIONS.find(a=>a[0]===b.dataset.gameAction)?.[2](dialog);});return s;}
function tidy(dialog){
  if(!dialog.classList.contains("settings-tidy"))dialog.classList.add("settings-tidy");
  const title=dialog.querySelector(".phone-settings-titlebar h3");if(title&&title.textContent!=="MENU")title.textContent="MENU";
  const bar=dialog.querySelector(":scope > .phone-settings-titlebar"),game=gameSection(dialog);if(bar&&bar.nextElementSibling!==game)bar.after(game);
  dialog.dataset.settingsHelp=SETTINGS_HELP_VERSION;
  const modes=dialog.querySelector(":scope > section.player-control-modes");
  // 3D VIEW right under the mode switch, so stereo is two taps away.
  const sbs=dialog.querySelector("[data-stereo-sbs]");let view=null;
  if(sbs){view=section(dialog,"player-control-section display-settings-section","3D VIEW");const row=rowOf(sbs);if(row.parentElement!==view){const h=moveHelpWith(row);view.appendChild(row);if(h)view.appendChild(h);}}
  if(modes&&game.nextElementSibling!==modes)game.after(modes);
  let cursor=placeAfter(modes,view)||modes;
  const profiles=dialog.querySelector(":scope > [data-stacked-control-profiles]");cursor=placeAfter(cursor,profiles);
  const hardware=dialog.querySelector(":scope > section.player-control-hardware");cursor=placeAfter(cursor,hardware);
  const xbox=dialog.querySelector(":scope > section.xbox-control-mode-settings");cursor=placeAfter(cursor,xbox);
  const camera=[...dialog.querySelectorAll(":scope > section.camera-settings-section")].find(s=>!s.classList.contains("audio-settings-section"));
  if(camera){cursor=placeAfter(cursor,camera);const h=camera.querySelector("h4");if(h&&h.textContent!=="DRONE CAMERA")h.textContent="DRONE CAMERA";}
  const audio=dialog.querySelector(":scope > section.audio-settings-section");cursor=placeAfter(cursor,audio);
  const world=dialog.querySelector(":scope > section.world-settings-section");cursor=placeAfter(cursor,world);
  const location=dialog.querySelector(":scope > section[data-world-location-settings]");cursor=placeAfter(cursor,location);
  // Debug switches: folded away at the bottom, just above DEFAULT / CLOSE.
  const debugInputs=[...dialog.querySelectorAll("[data-debug-grid],[data-box3d-collider-debug]")];
  if(debugInputs.length){let det=dialog.querySelector(":scope > details.debug-settings-section");if(!det){det=document.createElement("details");det.className="debug-settings-section";det.innerHTML=`<summary tabindex="0">DEBUG</summary>`;}
    for(const input of debugInputs){const row=rowOf(input);if(row.parentElement!==det){const h=moveHelpWith(row);det.appendChild(row);if(h)det.appendChild(h);}}
    const actions=dialog.querySelector(":scope > .phone-settings-actions");if(actions&&actions.previousElementSibling!==det)actions.before(det);else if(!actions&&det.parentElement!==dialog)dialog.appendChild(det);}
  // Help lines.
  const grid=dialog.querySelector(".player-mode-grid");if(grid)addHelp(grid,"mode-grid");
  const worldActions=dialog.querySelector(".world-settings-actions");if(worldActions)addHelp(worldActions,"world-actions");
  for(const input of dialog.querySelectorAll("input,select")){const key=keyOf(input);if(!key||!HELP[key])continue;const row=rowOf(input);if(row)addHelp(row,key);}
}

function installStyle(){if(document.querySelector("style[data-settings-help]"))return;const st=document.createElement("style");st.dataset.settingsHelp=SETTINGS_HELP_VERSION;st.textContent=`
html body dialog.phone-settings-dialog .setting-help{display:block;margin:-4px 0 10px;font:500 11.5px/1.35 system-ui,-apple-system,sans-serif;letter-spacing:0;text-transform:none;color:#b9d6cb;opacity:.86}
html body dialog.phone-settings-dialog label.phone-settings-toggle+.setting-help,html body dialog.phone-settings-dialog label.player-control-toggle+.setting-help{margin-top:-6px}
html body dialog.phone-settings-dialog [hidden]+.setting-help,html body dialog.phone-settings-dialog [style*="display: none"]+.setting-help,html body dialog.phone-settings-dialog [aria-hidden="true"]+.setting-help{display:none}
html body dialog.settings-tidy .phone-settings-note:not([data-world-location-note]),html body dialog.settings-tidy .player-control-note,html body dialog.settings-tidy [data-control-description]{display:none!important}
html body dialog.phone-settings-dialog .player-mode-grid+.setting-help{margin:8px 0 2px}
html body dialog.settings-tidy > details.debug-settings-section{margin:18px 0 6px;padding-top:6px;border-top:2px solid #ffffff2b}
html body dialog.settings-tidy > details.debug-settings-section > summary{cursor:pointer;font:850 13px system-ui,-apple-system,sans-serif;letter-spacing:.08em;color:#8fa9a0;padding:8px 0}
html body dialog.settings-tidy .world-settings-section label.phone-settings-toggle:not([hidden]){display:flex;align-items:center;justify-content:space-between;gap:16px}
html body dialog.settings-tidy > section.game-actions-section{margin:6px 0 4px}
html body dialog.settings-tidy .game-actions-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
html body dialog.settings-tidy .game-actions-grid button{min-height:40px;border-radius:8px;border:1px solid #ffffff33;background:#16202ccc;color:#eaf6ff;font:850 12px/1 system-ui,-apple-system,sans-serif;letter-spacing:.06em;cursor:pointer}
html body dialog.settings-tidy .game-actions-grid button[data-game-action="resume"]{background:#1d5a43;border-color:#7ff0c5aa}
html body dialog.settings-tidy .game-actions-grid button[data-game-action="exit"]{background:#4c1f25;border-color:#ff8b9588}
html body dialog.settings-tidy .game-actions-grid button:focus-visible{outline:3px solid #ffd76a;outline-offset:1px}
/* Top bar: only what the current mode can use. */
html body:is(.on-foot-mode,.player-driving,.jet-mode) #soloTopbar :is(#soloArmToolbar,#soloLogbook,#soloCamera,#droneWeaponToggle,#desktopDroneWeaponSwitch,#soloAlt,#soloRangeStatus,#soloState){display:none!important}
html body.desktop-input:not(:has(#viewport[data-gamepad-connected="1"])) #soloTopbar #soloGamepadStatus{display:none!important}
`;document.head.appendChild(st);}

let scheduled=false;
function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;for(const d of document.querySelectorAll("dialog.phone-settings-dialog"))try{tidy(d);}catch(e){console.warn("settings help",e);}});}
export function installSettingsHelp(){
  if(typeof document==="undefined"||globalThis.__arondightSettingsHelp)return;globalThis.__arondightSettingsHelp=SETTINGS_HELP_VERSION;
  const start=()=>{installStyle();schedule();new MutationObserver(list=>{for(const m of list){const t=m.target;if(m.type==="attributes"?t.matches?.("dialog.phone-settings-dialog"):(t.closest?.("dialog.phone-settings-dialog")||[...m.addedNodes].some(n=>n.matches?.("dialog.phone-settings-dialog")))){schedule();return;}}}).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:["open"]});};
  if(document.body)start();else document.addEventListener("DOMContentLoaded",start,{once:true});
}
installSettingsHelp();
