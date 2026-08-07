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
    'import {RaceTrack} from "./race_track.mjs";\n',
    'import {RaceTrack} from "./race_track.mjs";\nimport {loadPhoneControlSettings,mountPhoneControlSettings} from "./control_settings.mjs";\n',
    "settings import",
)
s = replace_once(
    s,
    'let soloMode=false,soloPreviousInputSource="remote",soloControls=neutralControls();',
    'let soloMode=false,soloPreviousInputSource="remote",soloControls=neutralControls(),phoneSettings=loadPhoneControlSettings();',
    "solo settings state",
)
s = replace_once(
    s,
    'const axes=knobAxes(soloControls,kind)',
    'const axes=knobAxes(soloControls,kind,phoneSettings)',
    "solo knob settings",
)
s = replace_once(
    s,
    'applyStick(soloControls,kind,normalizedPointer(el,e));updateSoloSticks();',
    'applyStick(soloControls,kind,normalizedPointer(el,e),phoneSettings);updateSoloSticks();',
    "solo stick settings",
)
s = replace_once(
    s,
    'soloStick($("soloLeft"),"left");soloStick($("soloRight"),"right");updateSoloSticks();\nasync function enterSolo(){',
    '''soloStick($("soloLeft"),"left");soloStick($("soloRight"),"right");updateSoloSticks();
mountPhoneControlSettings({
  parent:$("soloTopbar"),
  buttonText:"SETTINGS",
  onChange:next=>{phoneSettings=next;soloControls=neutralControls();updateSoloSticks();arm=false;throttle=0;},
});
async function enterSolo(){''',
    "solo settings menu",
)
s = replace_once(
    s,
    'soloMode=true;soloPreviousInputSource=inputSource;soloControls=neutralControls();updateSoloSticks();raceTrack.reset();',
    'soloMode=true;soloPreviousInputSource=inputSource;phoneSettings=loadPhoneControlSettings();soloControls=neutralControls();updateSoloSticks();raceTrack.reset();',
    "reload settings entering solo",
)
s = replace_once(
    s,
    'if(sharedArmReady(currentFcStateText(),soloControls,true))soloControls.arm=true;',
    'if(sharedArmReady(currentFcStateText(),soloControls,true,phoneSettings))soloControls.arm=true;',
    "solo arm button settings",
)
s = replace_once(
    s,
    'soloArm.disabled=!soloControls.arm&&!sharedArmReady(stateText,soloControls,true);',
    'soloArm.disabled=!soloControls.arm&&!sharedArmReady(stateText,soloControls,true,phoneSettings);',
    "solo arm render settings",
)
p.write_text(s)

p = Path("tests/browser_sim_smoke.mjs")
s = p.read_text()
needle = '  if (!Object.values(soloUi).every(Boolean)) throw new Error(`single-phone race HUD incomplete: ${JSON.stringify(soloUi)}`);\n'
insert = needle + '''  const settingsButtonExists = await page.$eval("#soloTopbar .phone-settings-button", element => element.textContent === "SETTINGS");
  if (!settingsButtonExists) throw new Error("single-phone SETTINGS button missing");
'''
s = replace_once(s, needle, insert, "browser settings button assertion")
needle = '  if (soloStart.input !== "local" || soloStart.hidden || soloStart.leftTop < 90) throw new Error(`single-phone neutral state is wrong: ${JSON.stringify(soloStart)}`);\n'
insert = needle + '''
  // Human-readable 1..10 control feel settings persist in localStorage.
  await page.click("#soloTopbar .phone-settings-button");
  await page.waitForFunction(() => document.querySelector(".phone-settings-dialog")?.open, {timeout:5000});
  const settingsDefaults = await page.evaluate(() => ({
    left: document.querySelector('.phone-settings-dialog [data-slider="left"]')?.value,
    right: document.querySelector('.phone-settings-dialog [data-slider="right"]')?.value,
    leftOut: document.querySelector('.phone-settings-dialog [data-out="left"]')?.value,
    rightOut: document.querySelector('.phone-settings-dialog [data-out="right"]')?.value,
  }));
  if (settingsDefaults.left !== "5" || settingsDefaults.right !== "3" || settingsDefaults.leftOut !== "5/10" || settingsDefaults.rightOut !== "3/10") throw new Error(`unexpected control feel defaults: ${JSON.stringify(settingsDefaults)}`);
  await page.$eval('.phone-settings-dialog [data-slider="right"]', element => {element.value="2";element.dispatchEvent(new Event("input",{bubbles:true}));});
  const persistedRight = await page.evaluate(() => JSON.parse(localStorage.getItem("arondight45PhoneControlSettingsV1")||"{}").rightSensitivity);
  if (Math.abs(persistedRight - .2) > 1e-9) throw new Error(`RIGHT control feel did not persist: ${persistedRight}`);
  await page.click('.phone-settings-dialog [data-reset]');
  await page.click('.phone-settings-dialog [data-close]');
'''
s = replace_once(s, needle, insert, "browser settings persistence test")
p.write_text(s)
