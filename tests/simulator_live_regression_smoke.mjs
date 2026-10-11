import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const url=new URL(process.argv[2]||'https://kurzlernen.de/drone_simulator.html');
url.searchParams.set('autostart','1');
const browser=await puppeteer.launch({executablePath:process.env.CHROME_BIN,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--enable-webgl','--ignore-gpu-blocklist','--use-gl=angle','--use-angle=swiftshader']});
const page=await browser.newPage(),errors=[];
page.on('pageerror',e=>errors.push(String(e)));
page.on('console',m=>{if(m.type()==='error'&&!m.text().startsWith('Failed to load resource:'))errors.push(m.text());});
try{
  await page.goto(url.href,{waitUntil:'load',timeout:60000});
  await page.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('SIM ready')&&globalThis.__arondightWalkMode&&globalThis.__terrain,{timeout:90000});
  if(process.env.GH_SHA){const build=await page.evaluate(async()=>await(await fetch('build.json',{cache:'no-store'})).json());assert.equal(build.sha,process.env.GH_SHA);}
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
  console.log('Live build SHA / foot-drone terrain / console: pass');
}finally{await browser.close();}
