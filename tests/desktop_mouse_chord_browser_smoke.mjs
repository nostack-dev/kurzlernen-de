import puppeteer from 'puppeteer-core';
const base=process.argv[2]||'http://127.0.0.1:4176/drone_simulator.html',url=new URL(base),executablePath=process.env.CHROME_BIN;
if(!executablePath)throw Error('CHROME_BIN missing');
url.searchParams.set('start','drone');
const browser=await puppeteer.launch({headless:true,executablePath,args:['--no-sandbox','--disable-dev-shm-usage','--enable-webgl','--ignore-gpu-blocklist','--use-gl=angle','--use-angle=swiftshader']});
const page=await browser.newPage();
const state=()=>page.evaluate(()=>({locked:document.pointerLockElement===document.getElementById('viewport'),rmb:globalThis.__arondightDesktopInput?.rmb,lmb:globalThis.__arondightDesktopInput?.lmb,mode:globalThis.__arondightDesktopInput?.mode,fire:globalThis.__arondightDesktopDroneInput?.fire,shots:globalThis.__mouseChordShots||0}));
try{
  await page.setViewport({width:1100,height:680,deviceScaleFactor:1,hasTouch:false});
  await page.goto(url.href,{waitUntil:'load',timeout:45000});
  await page.waitForFunction(()=>document.querySelector('#status')?.textContent?.includes('SIM ready')&&globalThis.__arondightWalkMode&&globalThis.__arondightDesktopInput,{timeout:45000});
  await page.waitForFunction(()=>document.body.classList.contains('solo-flight'),{timeout:12000});
  await page.evaluate(()=>globalThis.__arondightWalkMode.setMode('foot',{persist:false}));
  await page.waitForFunction(()=>globalThis.__arondightFootWeapons?.fireAt,{timeout:12000});
  await page.evaluate(()=>globalThis.__arondightFootWeapons.setMode('smg'));
  await page.waitForFunction(()=>document.querySelector('#viewport')?.dataset.playerMode==='foot',{timeout:5000});
  await page.evaluate(()=>{
    const api=globalThis.__arondightFootWeapons;
    const original=api.fireAt.bind(api);
    api.fireAt=(args)=>{globalThis.__mouseChordShots=(globalThis.__mouseChordShots||0)+1;return original(args);};
    globalThis.__mouseChordShots=0;
  });
  // First-ever gameplay mouse event: hold RMB to capture, then press LMB.
  await page.mouse.move(800,370);
  await page.mouse.down({button:'right'});
  await page.waitForFunction(()=>document.pointerLockElement===document.getElementById('viewport')&&globalThis.__arondightDesktopInput?.rmb,{timeout:5000});
  const firstRmb=await state();if(firstRmb.shots!==0)throw Error('RMB first-click must not fire');
  await page.mouse.down({button:'left'});
  await page.waitForFunction(()=>globalThis.__mouseChordShots>=1,{timeout:2000});
  const firstChord=await state();if(!firstChord.rmb||!firstChord.lmb||firstChord.shots<1)throw Error('RMB-first capture blocked shooting '+JSON.stringify(firstChord));
  await page.mouse.up({button:'left'});if(!(await state()).rmb)throw Error('RMB hold dropped when LMB released');
  await page.mouse.up({button:'right'});
  // Existing LMB-only behavior remains intact after capture.
  await page.mouse.down({button:'left'});await page.waitForFunction(()=>globalThis.__mouseChordShots>=2,{timeout:1500});await page.mouse.up({button:'left'});
  const alone=await state();
  await page.mouse.down({button:'right'});
  await page.waitForFunction(()=>globalThis.__arondightDesktopInput?.rmb===true,{timeout:1500});
  const before=await state();if(before.fire)throw Error('RMB must not fire without LMB');
  await page.mouse.down({button:'left'});
  await page.waitForFunction(before=>globalThis.__mouseChordShots>before,{timeout:2000},before.shots);
  const both=await state();
  if(!both.rmb||both.shots<=before.shots)throw Error('RMB+LMB blocked foot fire '+JSON.stringify({before,both}));
  await page.mouse.up({button:'left'});
  const released=await state();if(!released.rmb)throw Error('LMB release lost held RMB aim');
  await page.mouse.up({button:'right'});
  await page.waitForFunction(()=>!globalThis.__arondightDesktopInput?.rmb,{timeout:1000});
  // Reverse order: holding fire while pressing RMB must not lose LMB state.
  await page.mouse.down({button:'left'});await page.mouse.down({button:'right'});
  const reverse=await state();if(!reverse.rmb)throw Error('reverse mouse chord lost RMB');
  await page.mouse.up({button:'right'});await page.mouse.up({button:'left'});
  // Drone: both buttons independently drive the firing state as well.
  await page.evaluate(()=>globalThis.__arondightWalkMode.setMode('drone',{persist:false}));
  await page.waitForFunction(()=>document.querySelector('#viewport')?.dataset.playerMode==='drone',{timeout:3000});
  await page.mouse.down({button:'right'});await page.mouse.down({button:'left'});
  const drone=await state();if(!drone.rmb||!drone.lmb||!drone.fire)throw Error('drone RMB+LMB did not arm fire '+JSON.stringify(drone));
  await page.mouse.up({button:'left'});
  const droneReleased=await state();if(droneReleased.fire||!droneReleased.rmb)throw Error('drone LMB released incorrectly '+JSON.stringify(droneReleased));
  await page.mouse.up({button:'right'});
  console.log('Desktop real Chromium RMB+LMB passed',JSON.stringify({firstRmb,firstChord,alone,before,both,released,reverse,drone,droneReleased}));
}finally{await browser.close();}
