import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const url=new URL(process.argv[2]||'https://kurzlernen.de/drone_simulator.html');
url.searchParams.set('autostart','1');
const browser=await puppeteer.launch({executablePath:process.env.CHROME_BIN,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--enable-webgl','--ignore-gpu-blocklist','--use-gl=angle','--use-angle=swiftshader']});
const page=await browser.newPage(),errors=[];
page.on('pageerror',e=>errors.push(String(e)));
page.on('console',m=>{if(m.type()==='error'&&!m.text().startsWith('Failed to load resource:'))errors.push(m.text());});
try{
  const response=await page.goto(url.href,{waitUntil:'load',timeout:60000}),html=await response.text();
  await page.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('SIM ready')&&globalThis.__arondightWalkMode&&globalThis.__terrain,{timeout:90000});
  if(process.env.GH_SHA){const build=await page.evaluate(async()=>await(await fetch('build.json',{cache:'no-store'})).json());assert.equal(build.sha,process.env.GH_SHA);}
  // Autostart opens the training range. Explicitly load a real geographic world
  // before asserting its streamed DEM mesh (without requesting anyone's GPS).
  await page.evaluate(()=>globalThis.__arondightRealWorld.activate({coords:{longitude:13.405,latitude:52.52,accuracy:0}}));
  await page.waitForFunction(()=>globalThis.__arondightRealWorld.active&&globalThis.__arondightRealWorld.threeScene.getObjectByName('WORLD_GROUND')?.visible,{timeout:30000});
  for(const mode of ['foot','drone','foot']){
    await page.evaluate(m=>globalThis.__arondightWalkMode.setMode(m,{persist:false}),mode);
    await page.waitForFunction(m=>document.querySelector('#viewport')?.dataset.playerMode===m&&globalThis.__arondightRealWorld?.threeScene?.getObjectByName('WORLD_GROUND')?.visible,{timeout:15000},mode);
    const state=await page.evaluate(()=>{
      const g=globalThis.__arondightRealWorld.threeScene.getObjectByName('WORLD_GROUND');let maxError=0,count=0;
      for(const chunk of g.children){const p=chunk.geometry.attributes.position;for(let i=0;i<p.count;i+=101){const x=g.position.x+p.getX(i),y=g.position.y+p.getY(i),z=p.getZ(i);maxError=Math.max(maxError,Math.abs(z-globalThis.__terrain.staticGroundHeightAt(x,y)));count++;}}
      return{count,maxError,ground:document.querySelector('#viewport').dataset.worldGround};
    });
    assert.ok(state.count>100&&state.maxError<.005,JSON.stringify(state));
  }
  assert.deepEqual(errors,[],'live simulator must have no JavaScript / renderer errors');
  // Simulate a player who kept the previous build open. The poll must observe
  // the REAL newly deployed SHA and offer an update during play, without reload.
  const online=process.env.GH_SHA||(await page.evaluate(async()=>await(await fetch('build.json',{cache:'no-store'})).json())).sha;
  const old='0000000000000000000000000000000000000001',oldPage=await browser.newPage();let updated=false;
  // This tab is an old-build fixture; bypass the already-registered app service
  // worker so its cached build.json cannot mask the intercepted response.
  await oldPage.setBypassServiceWorker(true);
  await oldPage.setRequestInterception(true);
  oldPage.on('request',request=>{
    if(request.isNavigationRequest()&&request.resourceType()==='document')return request.respond({status:200,contentType:'text/html',body:html.replace(/ARONDIGHT45_BUILD_SHA:[0-9a-f]{40}/,`ARONDIGHT45_BUILD_SHA:${old}`)});
    if(new URL(request.url()).pathname.endsWith('/build.json'))return request.respond({status:200,contentType:'application/json',body:JSON.stringify({sha:updated?online:old})});
    return request.continue();
  });
  await oldPage.goto(url.href,{waitUntil:'load',timeout:60000});
  await oldPage.waitForFunction(()=>document.querySelector('#gameMenu')?.hidden&&document.querySelector('#status')?.textContent.includes('SIM ready'),{timeout:90000});
  // Verify the page truly believes that the old build is installed, before publishing
  // the new SHA. A missing document build marker would disable update polling entirely.
  await oldPage.waitForFunction(()=>document.querySelector('#buildTag')?.textContent==='v 0000000 · online 0000000',{timeout:10000});
  const beforeUpdate=await oldPage.$eval('#buildTag',el=>el.textContent);
  assert.match(beforeUpdate,/^v 0000000 · online 0000000$/,`old build was not correctly identified: ${beforeUpdate}`);
  updated=true;
  // The app checks on focus and every 30 s, with a 10 s focus debounce.
  // Exercise a real supported foreground check after the debounce instead of
  // depending on the phase of a pre-existing interval timer.
  await new Promise(resolve=>setTimeout(resolve,10050));
  await oldPage.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await oldPage.waitForFunction(()=>document.querySelector('#appUpdatePill')?.textContent.includes('UPDATE AVAILABLE')&&getComputedStyle(document.querySelector('#appUpdatePill')).display==='flex',{timeout:45000});
  assert.match(await oldPage.$eval('#buildTag',el=>el.textContent),new RegExp(`v 0000000 · online ${online.slice(0,7)}`));
  await oldPage.close();
  console.log('Live build SHA / foot-drone terrain / console / update notice: pass');
}finally{await browser.close();}
