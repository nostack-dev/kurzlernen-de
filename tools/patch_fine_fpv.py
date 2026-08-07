from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)

p = Path("sim/simulator.mjs")
s = p.read_text()
s = replace_once(
    s,
    'const followHeading=new THREE.Vector3(-1,0,0);\n',
    'const followHeading=new THREE.Vector3(-1,0,0);\nconst FPV_CAMERA_UPTILT_DEG=30,FPV_CAMERA_UPTILT_RAD=FPV_CAMERA_UPTILT_DEG*Math.PI/180;\n$("viewport").dataset.fpvTiltDeg=String(FPV_CAMERA_UPTILT_DEG);\n',
    "FPV tilt constants",
)
s = replace_once(
    s,
    '''  if(cameraMode==="fpv"){
    const bodyUp=new THREE.Vector3(0,0,1).applyQuaternion(q).normalize();
    camera.position.copy(position).addScaledVector(bodyForward,.095).addScaledVector(bodyUp,.045);
    camera.up.copy(bodyUp);camera.lookAt(camera.position.clone().addScaledVector(bodyForward,4));
    if(camera.fov!==84){camera.fov=84;camera.updateProjectionMatrix();}
    return;
  }
''',
    '''  if(cameraMode==="fpv"){
    const bodyUp=new THREE.Vector3(0,0,1).applyQuaternion(q).normalize();
    // A real FPV camera is normally mounted with positive uptilt. Keep the
    // camera rigidly attached to the frame (roll/pitch remain visible), but
    // point its optical axis 30 degrees above body-forward. The FC commands at
    // most about 32 degrees attitude, so full forward flight no longer points
    // the camera straight into the ground.
    const c=Math.cos(FPV_CAMERA_UPTILT_RAD),si=Math.sin(FPV_CAMERA_UPTILT_RAD);
    const fpvForward=bodyForward.clone().multiplyScalar(c).addScaledVector(bodyUp,si).normalize();
    const fpvUp=bodyUp.clone().multiplyScalar(c).addScaledVector(bodyForward,-si).normalize();
    camera.position.copy(position).addScaledVector(bodyForward,.095).addScaledVector(bodyUp,.045);
    camera.up.copy(fpvUp);camera.lookAt(camera.position.clone().addScaledVector(fpvForward,4));
    if(camera.fov!==84){camera.fov=84;camera.updateProjectionMatrix();}
    return;
  }
''',
    "FPV rigid uptilt camera",
)
p.write_text(s)

p = Path("tests/browser_sim_smoke.mjs")
s = p.read_text()
s = replace_once(
    s,
    '''  const fpvMode = await page.$eval("#viewport", element => element.dataset.cameraMode || "");
  if (fpvMode !== "fpv") throw new Error(`FPV camera switch failed: ${fpvMode}`);
''',
    '''  const fpvInfo = await page.$eval("#viewport", element => ({mode:element.dataset.cameraMode || "",tilt:element.dataset.fpvTiltDeg || ""}));
  if (fpvInfo.mode !== "fpv" || fpvInfo.tilt !== "30") throw new Error(`FPV camera switch/uptilt failed: ${JSON.stringify(fpvInfo)}`);
''',
    "browser FPV tilt assertion",
)
s = replace_once(
    s,
    '  await page.click("#camSolo");\n',
    '''  // Simulate the user's existing V1 setting: both sliders were 10/10.
  // V2 must preserve the displayed 10/10 while making it maximum fine control.
  await page.evaluate(() => {
    localStorage.removeItem("arondight45PhoneControlSettingsV2");
    localStorage.setItem("arondight45PhoneControlSettingsV1", JSON.stringify({leftSensitivity:1,rightSensitivity:1}));
  });
  await page.click("#camSolo");
''',
    "legacy settings setup",
)
s = replace_once(
    s,
    '''  if (settingsDefaults.left !== "5" || settingsDefaults.right !== "3" || settingsDefaults.leftOut !== "5/10" || settingsDefaults.rightOut !== "3/10") throw new Error(`unexpected control feel defaults: ${JSON.stringify(settingsDefaults)}`);
  await page.$eval('.phone-settings-dialog [data-slider="right"]', element => {element.value="2";element.dispatchEvent(new Event("input",{bubbles:true}));});
  const persistedRight = await page.evaluate(() => JSON.parse(localStorage.getItem("arondight45PhoneControlSettingsV1")||"{}").rightSensitivity);
  if (Math.abs(persistedRight - .2) > 1e-9) throw new Error(`RIGHT control feel did not persist: ${persistedRight}`);
  await page.click('.phone-settings-dialog [data-reset]');
''',
    '''  if (settingsDefaults.left !== "10" || settingsDefaults.right !== "10" || settingsDefaults.leftOut !== "10/10" || settingsDefaults.rightOut !== "10/10") throw new Error(`legacy 10/10 control feel did not migrate: ${JSON.stringify(settingsDefaults)}`);
  const migrated = await page.evaluate(() => JSON.parse(localStorage.getItem("arondight45PhoneControlSettingsV2")||"{}"));
  if (Math.abs(migrated.leftSensitivity - .02) > 1e-9 || Math.abs(migrated.rightSensitivity - .02) > 1e-9) throw new Error(`10/10 is not maximum fine after migration: ${JSON.stringify(migrated)}`);
  await page.click('.phone-settings-dialog [data-reset]');
  const resetLevels = await page.evaluate(() => ({left:document.querySelector('.phone-settings-dialog [data-slider="left"]')?.value,right:document.querySelector('.phone-settings-dialog [data-slider="right"]')?.value}));
  if (resetLevels.left !== "7" || resetLevels.right !== "9") throw new Error(`new fine-control defaults are wrong: ${JSON.stringify(resetLevels)}`);
''',
    "browser settings migration and defaults",
)
p.write_text(s)
