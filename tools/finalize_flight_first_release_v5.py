from pathlib import Path


def replace_one(path, old, new):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    assert count == 1, f"{path}: expected exactly one match, got {count}: {old[:140]!r}"
    p.write_text(text.replace(old, new, 1))


# --- Training debug grid: separate from WORLD grid, persisted locally, default OFF.
replace_one(
    "sim/simulator.mjs",
    "const TERRAIN_HALF = TERRAIN_SIZE / 2;\nconst NAV_AGL_RAY_MAX_M = 60;",
    'const TERRAIN_HALF = TERRAIN_SIZE / 2;\nconst DEBUG_GRID_STORAGE = "arondight45DebugGridlinesV1";\nconst NAV_AGL_RAY_MAX_M = 60;',
)
replace_one(
    "sim/simulator.mjs",
    'const grid=new THREE.GridHelper(TERRAIN_SIZE,120,0x6b7d89,0xa7b6bd);grid.rotation.x=Math.PI/2;grid.position.z=.002;scene.add(grid);const groundMesh=',
    '''const grid=new THREE.GridHelper(TERRAIN_SIZE,120,0x6b7d89,0xa7b6bd);grid.rotation.x=Math.PI/2;grid.position.z=.002;scene.add(grid);
let debugGridEnabled=false;try{debugGridEnabled=localStorage.getItem(DEBUG_GRID_STORAGE)==="1";}catch{}
function setDebugGridEnabled(enabled){debugGridEnabled=Boolean(enabled);grid.visible=debugGridEnabled;const viewport=$("viewport");if(viewport)viewport.dataset.debugGridEnabled=debugGridEnabled?"1":"0";try{localStorage.setItem(DEBUG_GRID_STORAGE,debugGridEnabled?"1":"0");}catch{}return debugGridEnabled;}
setDebugGridEnabled(debugGridEnabled);
const groundMesh=''',
)
replace_one(
    "sim/simulator.mjs",
    '''const soloSettingsMount=mountPhoneControlSettings({
  parent:$("soloTopbar"),
  buttonText:"SETTINGS",
  onChange:next=>{phoneSettings=next;const keepArm=soloControls.arm;if(!keepArm)soloGroundClearance=next.defaultHoverAgl;setSoloHeightAxis(0);soloControls=neutralSoloControls();soloControls.arm=keepArm;updateSoloSticks();arm=keepArm;throttle=0;},
});''',
    '''const soloSettingsMount=mountPhoneControlSettings({
  parent:$("soloTopbar"),
  buttonText:"SETTINGS",
  debugGrid:{get:()=>debugGridEnabled,set:setDebugGridEnabled,defaultValue:false},
  onChange:next=>{phoneSettings=next;const keepArm=soloControls.arm;if(!keepArm)soloGroundClearance=next.defaultHoverAgl;setSoloHeightAxis(0);soloControls=neutralSoloControls();soloControls.arm=keepArm;updateSoloSticks();arm=keepArm;throttle=0;},
});''',
)

# Fullscreen is presentation only. Losing it must never synthesize EXIT/KILL/disarm.
replace_one(
    "sim/simulator.mjs",
    'document.addEventListener("fullscreenchange",()=>{if(soloMode&&!document.fullscreenElement&&document.fullscreenEnabled)exitSolo();});',
    'document.addEventListener("fullscreenchange",()=>{if(!soloMode)return;const viewport=$("viewport");if(viewport)viewport.dataset.soloFullscreen=document.fullscreenElement?"1":"0";resize();});',
)

# --- Settings UI: show DEBUG GRIDLINES only where a simulator grid authority is supplied.
replace_one(
    "sim/control_settings.mjs",
    'export function mountPhoneControlSettings({parent,buttonText="SETTINGS",onChange=()=>{}}={}){',
    'export function mountPhoneControlSettings({parent,buttonText="SETTINGS",onChange=()=>{},debugGrid=null}={}){',
)
replace_one(
    "sim/control_settings.mjs",
    '    <label class="phone-settings-toggle"><span>LOCK RIGHT STICK VERTICAL AXIS</span><input data-lock-horizontal type="checkbox"></label>\n    <p class="phone-settings-note">Left X invert reverses MANUAL yaw / GAME strafe.',
    '''    <label class="phone-settings-toggle"><span>LOCK RIGHT STICK VERTICAL AXIS</span><input data-lock-horizontal type="checkbox"></label>
    ${debugGrid?'<label class="phone-settings-toggle"><span>DEBUG GRIDLINES</span><input data-debug-grid type="checkbox"></label><p class="phone-settings-note">DEBUG GRIDLINES affect only the local training renderer. They never alter WORLD GRID, sensors, collision, FC state or physics.</p>':''}
    <p class="phone-settings-note">Left X invert reverses MANUAL yaw / GAME strafe.''',
)
replace_one(
    "sim/control_settings.mjs",
    '  const invertLeft=dialog.querySelector("[data-invert-left-horizontal]"),invertRight=dialog.querySelector("[data-invert-right-horizontal]"),invertRightVertical=dialog.querySelector("[data-invert-right-vertical]"),lockLeft=dialog.querySelector("[data-lock-left-horizontal]"),lock=dialog.querySelector("[data-lock-horizontal]");',
    '  const invertLeft=dialog.querySelector("[data-invert-left-horizontal]"),invertRight=dialog.querySelector("[data-invert-right-horizontal]"),invertRightVertical=dialog.querySelector("[data-invert-right-vertical]"),lockLeft=dialog.querySelector("[data-lock-left-horizontal]"),lock=dialog.querySelector("[data-lock-horizontal]"),debugGridInput=dialog.querySelector("[data-debug-grid]");',
)
replace_one(
    "sim/control_settings.mjs",
    '    leftOut.value=`${left.value}/10`;rightOut.value=`${right.value}/10`;hoverOut.value=`${Number(hover.value).toFixed(1)} m`;invertLeft.checked=settings.invertLeftHorizontal;invertRight.checked=settings.invertRightHorizontal;invertRightVertical.checked=settings.invertRightVertical;lockLeft.checked=settings.lockLeftHorizontal;lock.checked=settings.lockRightHorizontal;',
    '    leftOut.value=`${left.value}/10`;rightOut.value=`${right.value}/10`;hoverOut.value=`${Number(hover.value).toFixed(1)} m`;invertLeft.checked=settings.invertLeftHorizontal;invertRight.checked=settings.invertRightHorizontal;invertRightVertical.checked=settings.invertRightVertical;lockLeft.checked=settings.lockLeftHorizontal;lock.checked=settings.lockRightHorizontal;if(debugGridInput)debugGridInput.checked=Boolean(debugGrid?.get?.());',
)
replace_one(
    "sim/control_settings.mjs",
    '  left.addEventListener("input",apply);right.addEventListener("input",apply);hover.addEventListener("input",apply);invertLeft.addEventListener("change",apply);invertRight.addEventListener("change",apply);invertRightVertical.addEventListener("change",apply);lockLeft.addEventListener("change",apply);lock.addEventListener("change",apply);\n  dialog.querySelector("[data-reset]").onclick=()=>{settings=savePhoneControlSettings(DEFAULT_PHONE_SETTINGS);render();onChange({...settings});};',
    '  left.addEventListener("input",apply);right.addEventListener("input",apply);hover.addEventListener("input",apply);invertLeft.addEventListener("change",apply);invertRight.addEventListener("change",apply);invertRightVertical.addEventListener("change",apply);lockLeft.addEventListener("change",apply);lock.addEventListener("change",apply);if(debugGridInput)debugGridInput.addEventListener("change",()=>{debugGrid?.set?.(debugGridInput.checked);render();});\n  dialog.querySelector("[data-reset]").onclick=()=>{settings=savePhoneControlSettings(DEFAULT_PHONE_SETTINGS);debugGrid?.set?.(Boolean(debugGrid?.defaultValue));render();onChange({...settings});};',
)

# WORLD GRID must not inherit the training debug-grid visibility. It gets explicit
# per-frame visibility while the training scene is temporarily adapted for WORLD.
replace_one(
    "sim/real_world_bootstrap.mjs",
    '  hideTrainingWorld(scene){this.identifyTrainingObjects(scene);this.frameVisibility.clear();for(const child of this.trainingObjects){if(child.isGridHelper&&this.gridEnabled)continue;this.frameVisibility.set(child,child.visible);child.visible=false;}}',
    '  hideTrainingWorld(scene){this.identifyTrainingObjects(scene);this.frameVisibility.clear();for(const child of this.trainingObjects){this.frameVisibility.set(child,child.visible);if(child.isGridHelper){child.visible=this.gridEnabled;continue;}child.visible=false;}}',
)

# Release invariants: fullscreen may never own arm state; WORLD/debug grids remain separate.
replace_one(
    "tests/architecture_invariants.mjs",
    'requireText("sim/real_world_bootstrap.mjs",\'mode==="critical"?Math.min(ceiling,.75)\');',
    '''requireText("sim/real_world_bootstrap.mjs",'mode==="critical"?Math.min(ceiling,.75)');
requireText("sim/simulator.mjs",'DEBUG_GRID_STORAGE = "arondight45DebugGridlinesV1"');
requireText("sim/simulator.mjs","debugGrid:{get:()=>debugGridEnabled,set:setDebugGridEnabled,defaultValue:false}");
requireText("sim/control_settings.mjs","DEBUG GRIDLINES");
requireText("sim/real_world_bootstrap.mjs","if(child.isGridHelper){child.visible=this.gridEnabled;continue;}");
forbidText("sim/simulator.mjs",'fullscreenchange",()=>{if(soloMode&&!document.fullscreenElement&&document.fullscreenEnabled)exitSolo()');''',
)

# Browser regression: the debug grid exists and is independent; losing fullscreen
# while armed cannot exit solo or disarm the actual FC.
replace_one(
    "tests/browser_sim_smoke.mjs",
    '''  const defaults=await page.evaluate(()=>({
    left:document.querySelector('.phone-settings-dialog [data-slider="left"]')?.value,
    right:document.querySelector('.phone-settings-dialog [data-slider="right"]')?.value,''',
    '''  const defaults=await page.evaluate(()=>({
    left:document.querySelector('.phone-settings-dialog [data-slider="left"]')?.value,
    right:document.querySelector('.phone-settings-dialog [data-slider="right"]')?.value,
    debugGrid:document.querySelector('.phone-settings-dialog [data-debug-grid]')?.checked,
    debugGridRuntime:document.querySelector("#viewport")?.dataset.debugGridEnabled,''',
)
replace_one(
    "tests/browser_sim_smoke.mjs",
    '  if(defaults.left!=="10"||defaults.right!=="10"',
    '  if(defaults.left!=="10"||defaults.right!=="10"||defaults.debugGrid!==false||defaults.debugGridRuntime!=="0"',
)
replace_one(
    "tests/browser_sim_smoke.mjs",
    '''  await page.waitForFunction(()=>document.querySelector("#fcState")?.textContent==="ARMED",{timeout:1500});state="ARMED";
  await page.waitForFunction(()=>{const z=parseFloat(document.querySelector("#altitude")?.textContent||"0"),v=parseFloat(document.querySelector("#velocity")?.textContent||"99");return z>1.5&&z<2.5&&v<.70;},{timeout:90000});''',
    '''  await page.waitForFunction(()=>document.querySelector("#fcState")?.textContent==="ARMED",{timeout:1500});state="ARMED";
  const fullscreenDropStart=await page.evaluate(()=>Number(globalThis.__arondightDiagnostics?.simTime));
  await page.evaluate(async()=>{if(document.fullscreenElement&&document.exitFullscreen){try{await document.exitFullscreen();}catch{}}else document.dispatchEvent(new Event("fullscreenchange"));});
  await page.waitForFunction(start=>Number(globalThis.__arondightDiagnostics?.simTime)>=start+.30,{timeout:5000},fullscreenDropStart);
  const afterFullscreenDrop=await page.evaluate(()=>({fc:Number(globalThis.__arondightDiagnostics?.fcState)||0,solo:document.body.classList.contains("solo-flight"),armText:document.querySelector("#soloArm")?.textContent||""}));
  if(!(afterFullscreenDrop.fc&1)||!afterFullscreenDrop.solo)throw new Error(`fullscreen presentation loss disarmed/exited flight: ${JSON.stringify(afterFullscreenDrop)}`);
  await page.waitForFunction(()=>{const z=parseFloat(document.querySelector("#altitude")?.textContent||"0"),v=parseFloat(document.querySelector("#velocity")?.textContent||"99");return z>1.5&&z<2.5&&v<.70;},{timeout:90000});''',
)

# Documentation states the safety boundary explicitly.
doc=Path("REAL_WORLD_DIGITAL_TWIN.md")
text=doc.read_text().rstrip()+"\n"
marker="### Fullscreen and grid ownership"
assert marker not in text
text += """

### Fullscreen and grid ownership

Fullscreen/orientation is presentation state only. A browser dropping fullscreen must not exit SOLO, clear the arm request, stop the scheduler, or alter FC state. Flight termination remains explicit (`EXIT` / `KILL`) or comes from the real shared FC safety path.

`DEBUG GRIDLINES` and `WORLD GRID` are intentionally separate renderer controls. Debug gridlines default OFF and affect only the training renderer. WORLD GRID remains an independent local-metre orientation overlay in REAL WORLD. Neither grid participates in navigation measurement, collision, controller state, motor output, or Box3D physics.
"""
doc.write_text(text)
