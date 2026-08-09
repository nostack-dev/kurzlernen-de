from pathlib import Path

p=Path('tests/browser_sim_smoke.mjs')
s=p.read_text()
old='''  await page.click("#soloCamera");await page.click("#soloCamera");
  await page.waitForFunction(()=>document.querySelector("#viewport")?.dataset.cameraMode==="fpv",{timeout:5000});
  const fpvOptics=await page.$eval("#viewport",e=>({fov:Number(e.dataset.cameraFov),tilt:Number(e.dataset.cameraTiltDeg)}));
  if(fpvOptics.fov!==101||fpvOptics.tilt!==18)throw new Error(`FPV optics settings not applied: ${JSON.stringify(fpvOptics)}`);
  await page.click("#soloCamera");await page.click("#soloCamera");
  await page.waitForFunction(()=>document.querySelector("#viewport")?.dataset.cameraMode==="third",{timeout:5000});
  const thirdDistance=await page.$eval("#viewport",e=>Number(e.dataset.cameraDistanceM));
  if(!(thirdDistance>3.45&&thirdDistance<3.75))throw new Error(`third-person camera distance not applied: ${thirdDistance}`);

  await page.click("#soloCamera");await page.click("#soloCamera");
  await page.waitForFunction(()=>document.querySelector("#viewport")?.dataset.cameraMode==="follow",{timeout:5000});
'''
new='''  await page.$eval("#camFpv",e=>e.click());
  await page.waitForFunction(()=>{const v=document.querySelector("#viewport");return v?.dataset.cameraMode==="fpv"&&Number(v.dataset.cameraFov)===101&&Number(v.dataset.cameraTiltDeg)===18;},{timeout:5000});
  const fpvOptics=await page.$eval("#viewport",e=>({fov:Number(e.dataset.cameraFov),tilt:Number(e.dataset.cameraTiltDeg)}));
  if(fpvOptics.fov!==101||fpvOptics.tilt!==18)throw new Error(`FPV optics settings not applied: ${JSON.stringify(fpvOptics)}`);
  await page.$eval("#camThird",e=>e.click());
  await page.waitForFunction(()=>{const v=document.querySelector("#viewport"),d=Number(v?.dataset.cameraDistanceM);return v?.dataset.cameraMode==="third"&&d>3.45&&d<3.75;},{timeout:5000});
  const thirdDistance=await page.$eval("#viewport",e=>Number(e.dataset.cameraDistanceM));
  if(!(thirdDistance>3.45&&thirdDistance<3.75))throw new Error(`third-person camera distance not applied: ${thirdDistance}`);

  await page.$eval("#camFollow",e=>e.click());
  await page.waitForFunction(()=>document.querySelector("#viewport")?.dataset.cameraMode==="follow",{timeout:5000});
'''
assert s.count(old)==1, s.count(old)
p.write_text(s.replace(old,new,1))
