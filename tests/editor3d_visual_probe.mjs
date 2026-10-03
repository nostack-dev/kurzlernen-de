import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const chrome=process.env.CHROME_BIN;
if(!chrome) throw new Error('CHROME_BIN is required');
const base=process.env.EDITOR3D_URL||'https://kurzlernen.de/editor3d.html';
const out=process.env.EDITOR3D_SCREENSHOT_DIR||'/tmp/editor3d-visual';
fs.mkdirSync(out,{recursive:true});

const browser=await puppeteer.launch({
  executablePath:chrome,
  headless:true,
  args:['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist']
});

async function settle(page,ms=500){
  await new Promise(r=>setTimeout(r,ms));
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}
async function snap(page,name){
  const file=path.join(out,name+'.png');
  await page.screenshot({path:file,fullPage:false});
  console.log('SCREENSHOT',file);
}
function collectErrors(page,pageErrors,consoleErrors){
  page.on('pageerror',e=>pageErrors.push(String(e?.stack||e)));
  page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text())});
}
async function visibleCanvasMetrics(page){
  return await page.evaluate(()=>{
    const canvases=[...document.querySelectorAll('canvas')];
    const canvas=canvases.find(c=>{const r=c.getBoundingClientRect(),s=getComputedStyle(c);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'})||canvases[0];
    const r=canvas?.getBoundingClientRect();
    return {w:innerWidth,h:innerHeight,docW:document.documentElement.scrollWidth,docH:document.documentElement.scrollHeight,canvas:r?{x:r.x,y:r.y,w:r.width,h:r.height}:null};
  });
}

try{
  const pageErrors=[];
  const consoleErrors=[];
  const page=await browser.newPage();
  await page.setViewport({width:1440,height:920,deviceScaleFactor:1});
  collectErrors(page,pageErrors,consoleErrors);

  await page.goto(base+(base.includes('?')?'&':'?')+'visualDesktop='+Date.now(),{waitUntil:'networkidle2',timeout:90000});
  await page.waitForFunction(()=>window.Editor3D?.b3&&window.Editor3D?.scene?.bodies?.length>0,{timeout:90000});
  await page.evaluate(()=>Editor3D.loadDemo('cradle'));
  await settle(page,800);

  const shell=await page.evaluate(()=>({
    bodyCount:Editor3D.scene.bodies.length,
    fixtureCount:Editor3D.scene.bodies.reduce((n,b)=>n+(b.fixtures?.length||0),0),
    jointCount:Editor3D.scene.joints.length,
    hasGround:Editor3D.scene.bodies.some(b=>b.name==='ground'),
    visualFitMarker:document.documentElement.innerHTML.includes('Editor3D visual fit v2: physical bounds + scale-aware helpers; cradle excludes 24m demo ground'),
    box3dMarker:document.documentElement.innerHTML.includes('main:51f056e0a9d299326b10f10a63270c81d901df21 api:594'),
    title:document.title
  }));
  Object.assign(shell,await visibleCanvasMetrics(page));
  assert.ok(shell.visualFitMarker,'visual-fit v2 build marker missing: '+JSON.stringify(shell));
  assert.ok(shell.box3dMarker,'Box3D 594/594 main marker missing: '+JSON.stringify(shell));
  assert.equal(shell.hasGround,false,'Newton cradle must not contain the 24 m demo ground');
  assert.equal(shell.bodyCount,26,'unexpected Newton cradle body count');
  assert.equal(shell.fixtureCount,16,'unexpected Newton cradle fixture count');
  assert.equal(shell.jointCount,10,'unexpected Newton cradle joint count');
  assert.ok(shell.canvas&&shell.canvas.w>300&&shell.canvas.h>250,JSON.stringify(shell));
  assert.ok(shell.docW<=shell.w+1,JSON.stringify(shell));
  await snap(page,'01-desktop-default');

  await page.evaluate(()=>Editor3D.loadDemo('joints'));
  await settle(page,700);
  assert.deepEqual(await page.evaluate(()=>Editor3D.validate()),[]);
  await snap(page,'02-desktop-joints');

  await page.evaluate(()=>Editor3D.loadDemo('hulls'));
  await settle(page,700);
  assert.deepEqual(await page.evaluate(()=>Editor3D.validate()),[]);
  await snap(page,'03-desktop-hulls');

  await page.evaluate(()=>{Editor3D.loadDemo('cradle');Editor3D.openPlayer()});
  await page.waitForFunction(()=>Editor3D.views.at(-1)?.type==='player'&&Editor3D.views.at(-1)?.sim?.steps>5,{timeout:10000});
  await settle(page,700);
  await snap(page,'04-desktop-player');

  // Mobile visuals are captured from a fresh mobile page. This matters: a desktop
  // camera resized down afterwards is not representative of an actual phone load.
  const mobilePage=await browser.newPage();
  await mobilePage.setViewport({width:390,height:844,deviceScaleFactor:3,isMobile:true,hasTouch:true});
  collectErrors(mobilePage,pageErrors,consoleErrors);
  await mobilePage.goto(base+(base.includes('?')?'&':'?')+'visualMobile='+Date.now(),{waitUntil:'networkidle2',timeout:90000});
  await mobilePage.waitForFunction(()=>window.Editor3D?.b3&&window.Editor3D?.scene?.bodies?.length>0&&window.Editor3DMobileOrbit,{timeout:90000});
  await mobilePage.evaluate(()=>{Editor3D.loadDemo('cradle');Editor3D.openPlayer()});
  await mobilePage.waitForFunction(()=>Editor3D.views.at(-1)?.type==='player'&&Editor3D.views.at(-1)?.sim?.steps>5,{timeout:10000});
  await settle(mobilePage,800);
  const mobile=await visibleCanvasMetrics(mobilePage);
  const mobileScene=await mobilePage.evaluate(()=>({
    hasGround:Editor3D.scene.bodies.some(b=>b.name==='ground'),
    bodyCount:Editor3D.scene.bodies.length,
    orbitButton:!!document.querySelector('.e3d-mobile-orbit-toggle:not([hidden])')
  }));
  Object.assign(mobile,mobileScene);
  assert.equal(mobile.hasGround,false,JSON.stringify(mobile));
  assert.equal(mobile.bodyCount,26,JSON.stringify(mobile));
  assert.equal(mobile.orbitButton,true,JSON.stringify(mobile));
  assert.ok(mobile.docW<=mobile.w+1,JSON.stringify(mobile));
  assert.ok(mobile.canvas&&mobile.canvas.w>250&&mobile.canvas.h>220,JSON.stringify(mobile));
  await snap(mobilePage,'05-mobile-player');

  await mobilePage.evaluate(()=>{const v=Editor3D.views.at(-1);if(v?.type==='player')v.playing=false;Editor3D.loadDemo('mechanism')});
  await settle(mobilePage,700);
  assert.deepEqual(await mobilePage.evaluate(()=>Editor3D.validate()),[]);
  await snap(mobilePage,'06-mobile-editor');

  if(pageErrors.length)throw new Error('page errors:\n'+pageErrors.join('\n'));
  const material=consoleErrors.filter(x=>!/(favicon|WebGL.*software|GPU stall)/i.test(x));
  if(material.length)throw new Error('console errors:\n'+material.join('\n'));
  console.log('PASS Editor3D visual probe',JSON.stringify({shell,mobile}));
} finally {
  await browser.close();
}
