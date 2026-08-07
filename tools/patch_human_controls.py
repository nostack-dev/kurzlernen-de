from pathlib import Path


def replace_once(text, old, new, label):
    n=text.count(old)
    if n!=1: raise SystemExit(f"{label}: expected one match, found {n}")
    return text.replace(old,new,1)

p=Path('esp32/Arondight45_DroneFC_Core.hpp')
s=p.read_text()
s=replace_once(s,
'''inline Command command(const RC& r) {
    return {shape(centered(r.ch[FC_SBUS_ROLL]), 0.035f, 0.3f),
            -shape(centered(r.ch[FC_SBUS_PITCH]), 0.035f, 0.3f),
            throttle(r.ch[FC_SBUS_THROTTLE]),
            shape(centered(r.ch[FC_SBUS_YAW]), 0.045f, 0.2f),
            r.ch[FC_SBUS_ARM] > 1300};
}
''',
'''inline Command command(const RC& r) {
    // High-resolution SBUS/touch input: no artificial centre deadband. Keep a
    // single canonical expo in the real FC so SIM, HIL and hardware respond
    // continuously from zero and share exactly the same command curve.
    return {shape(centered(r.ch[FC_SBUS_ROLL]), 0.0f, 0.3f),
            -shape(centered(r.ch[FC_SBUS_PITCH]), 0.0f, 0.3f),
            throttle(r.ch[FC_SBUS_THROTTLE]),
            shape(centered(r.ch[FC_SBUS_YAW]), 0.0f, 0.2f),
            r.ch[FC_SBUS_ARM] > 1300};
}
''','FC command deadband')
p.write_text(s)

p=Path('tests/browser_sim_smoke.mjs')
s=p.read_text()
s=replace_once(s,
'''  // Simulate the user's existing V1 setting: both sliders were 10/10.
  // V2 must preserve the displayed 10/10 while making it maximum fine control.
  await page.evaluate(() => {
    localStorage.removeItem("arondight45PhoneControlSettingsV2");
    localStorage.setItem("arondight45PhoneControlSettingsV1", JSON.stringify({leftSensitivity:1,rightSensitivity:1}));
  });
''',
'''  // Simulate the user's existing old setting: both sliders were 10/10.
  // V3 must preserve the displayed 10/10 and map it to 25% linear RC throw.
  await page.evaluate(() => {
    localStorage.removeItem("arondight45PhoneControlSettingsV3");
    localStorage.removeItem("arondight45PhoneControlSettingsV2");
    localStorage.setItem("arondight45PhoneControlSettingsV1", JSON.stringify({leftSensitivity:1,rightSensitivity:1}));
  });
''','browser legacy setup')
s=replace_once(s,
'''  const migrated = await page.evaluate(() => JSON.parse(localStorage.getItem("arondight45PhoneControlSettingsV2")||"{}"));
  if (Math.abs(migrated.leftSensitivity - .02) > 1e-9 || Math.abs(migrated.rightSensitivity - .02) > 1e-9) throw new Error(`10/10 is not maximum fine after migration: ${JSON.stringify(migrated)}`);
  await page.click('.phone-settings-dialog [data-reset]');
  const resetLevels = await page.evaluate(() => ({left:document.querySelector('.phone-settings-dialog [data-slider="left"]')?.value,right:document.querySelector('.phone-settings-dialog [data-slider="right"]')?.value}));
  if (resetLevels.left !== "7" || resetLevels.right !== "9") throw new Error(`new fine-control defaults are wrong: ${JSON.stringify(resetLevels)}`);
''',
'''  const migrated = await page.evaluate(() => JSON.parse(localStorage.getItem("arondight45PhoneControlSettingsV3")||"{}"));
  if (Math.abs(migrated.leftSensitivity - .25) > 1e-9 || Math.abs(migrated.rightSensitivity - .25) > 1e-9) throw new Error(`10/10 is not 25% RC throw after migration: ${JSON.stringify(migrated)}`);
  await page.click('.phone-settings-dialog [data-reset]');
  const resetLevels = await page.evaluate(() => ({left:document.querySelector('.phone-settings-dialog [data-slider="left"]')?.value,right:document.querySelector('.phone-settings-dialog [data-slider="right"]')?.value}));
  if (resetLevels.left !== "9" || resetLevels.right !== "10") throw new Error(`human-control defaults are wrong: ${JSON.stringify(resetLevels)}`);
''','browser V3 assertion')
p.write_text(s)

p=Path('.github/workflows/s31-hil.yml')
s=p.read_text()
s=s.replace("grep -q 'arondight45PhoneControlSettingsV2' sim/control_settings.mjs tests/browser_sim_smoke.mjs","grep -q 'arondight45PhoneControlSettingsV3' sim/control_settings.mjs tests/browser_sim_smoke.mjs")
anchor="          grep -q 'FPV_CAMERA_UPTILT_DEG=30' sim/simulator.mjs\n"
if anchor not in s: raise SystemExit('CI FPV anchor missing')
s=s.replace(anchor,anchor+"          grep -q 'shape(centered(r.ch[FC_SBUS_ROLL]), 0.0f, 0.3f)' esp32/Arondight45_DroneFC_Core.hpp\n          grep -q 'shape(centered(r.ch[FC_SBUS_YAW]), 0.0f, 0.2f)' esp32/Arondight45_DroneFC_Core.hpp\n",1)
p.write_text(s)
