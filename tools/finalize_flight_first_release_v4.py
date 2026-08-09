from pathlib import Path


def replace_one(path, old, new):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    assert count == 1, f"{path}: expected exactly one match, got {count}: {old[:120]!r}"
    p.write_text(text.replace(old, new, 1))


# RESET must be observed through the authoritative scheduler generation and clock,
# not a deliberately rate-limited HUD text node. This also regression-tests the
# new monotonic run-epoch ownership rule.
replace_one(
    "tests/browser_sim_smoke.mjs",
    '''  await page.click("#soloReset");
  await page.waitForFunction(()=>document.querySelector("#soloClearanceValue")?.textContent?.includes("2.2 m"),{timeout:5000});

  await waitForSimTime(2.2,60000);
  let state=await page.$eval("#fcState",e=>e.textContent||"");
  if(state!=="DISARMED")throw new Error(`solo calibration failed: ${JSON.stringify(await snapshot())}`);''',
    '''  const resetEpochBefore=await page.evaluate(()=>Number(globalThis.__arondightDiagnostics?.runEpoch)||0);
  await page.click("#soloReset");
  await page.waitForFunction(prev=>Number(globalThis.__arondightDiagnostics?.runEpoch)>prev,{timeout:5000},resetEpochBefore);
  await page.waitForFunction(()=>document.querySelector("#soloClearanceValue")?.textContent?.includes("2.2 m"),{timeout:5000});
  await page.waitForFunction(()=>Number(globalThis.__arondightDiagnostics?.simTime)>=2.2,{timeout:60000});
  const calibrated=await page.evaluate(()=>({sim:Number(globalThis.__arondightDiagnostics?.simTime),fc:Number(globalThis.__arondightDiagnostics?.fcState)||0,epoch:Number(globalThis.__arondightDiagnostics?.runEpoch)||0}));
  if((calibrated.fc&2)||(calibrated.fc&4)||(calibrated.fc&1))throw new Error(`solo authoritative calibration failed: ${JSON.stringify(calibrated)} snapshot=${JSON.stringify(await snapshot())}`);
  await page.waitForFunction(()=>document.querySelector("#fcState")?.textContent==="DISARMED",{timeout:1500});
  let state="DISARMED";''',
)
