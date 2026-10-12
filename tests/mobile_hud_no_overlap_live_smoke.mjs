import puppeteer from 'puppeteer-core';
import {mkdir} from 'node:fs/promises';
const url=new URL(process.argv[2]||'https://kurzlernen.de/drone_simulator.html'),chrome=process.env.CHROME_BIN;
if(!chrome)throw Error('CHROME_BIN required');
const browser=await puppeteer.launch({headless:true,executablePath:chrome,args:['--no-sandbox','--disable-dev-shm-usage','--enable-webgl','--ignore-gpu-blocklist','--use-gl=angle','--use-angle=swiftshader']});
const page=await browser.newPage();
await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1');
await mkdir('artifacts',{recursive:true});
try {
 await page.setViewport({width:390,height:844,deviceScaleFactor:1,isMobile:true,hasTouch:true});
 await page.goto(url.href,{waitUntil:'load',timeout:45000});
 await page.waitForFunction(()=>document.querySelector('#status')?.textContent?.includes('SIM ready')&&document.querySelector('#mobileGameplayMode')&&globalThis.__arondightWalkMode,{timeout:80000});
 for(const [name,width,height] of [['iphone-portrait',390,844],['compact-portrait',360,740],['native-landscape',844,390],['safari-bars',844,300]]){
  await page.setViewport({width,height,deviceScaleFactor:1,isMobile:true,hasTouch:true});
  await page.evaluate(()=>globalThis.__arondightWalkMode.setMode('foot',{persist:false}));
  await page.waitForFunction(()=>document.querySelector('#viewport')?.dataset.playerMode==='foot',{timeout:7000});
  await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,600)));
  const data=await page.evaluate(()=>{
   const ids=['mobileGameplayDock','mobileGameplayReset','mobileGameplayMultiplayer','mobileGameplayMode','footMove','footLook','footFire','footJump','proximityVoiceBar','enterCarButton','enterJetButton'],rects={};
   for(const id of ids){const e=document.getElementById(id),style=e&&getComputedStyle(e);if(!e||e.hidden||style.display==='none'||style.visibility==='hidden'||!e.getBoundingClientRect().width)continue;
    const r=e.getBoundingClientRect();rects[id]={left:r.left,right:r.right,top:r.top,bottom:r.bottom};}
   return{width:innerWidth,height:innerHeight,rects};
  });
  const pairs=[['mobileGameplayDock','mobileGameplayReset'],['mobileGameplayDock','mobileGameplayMultiplayer'],['mobileGameplayMode','footMove'],['mobileGameplayMode','footLook'],['footMove','footLook'],['footMove','footFire'],['footLook','footFire'],['footJump','footLook'],['footJump','footFire'],['proximityVoiceBar','footMove'],['proximityVoiceBar','footLook'],['enterCarButton','footMove'],['enterJetButton','footLook'],['enterCarButton','enterJetButton']];
  const clashes=[];
  for(const [a,b] of pairs){const r=data.rects[a],s=data.rects[b];if(r&&s&&Math.min(r.right,s.right)-Math.max(r.left,s.left)>3&&Math.min(r.bottom,s.bottom)-Math.max(r.top,s.top)>3)clashes.push(a+' / '+b);}
  // Actual screen geometry on landscape devices: primary touch actions must remain
  // at the outside edges. In particular, the boarding prompt must not float by JUMP.
  if(width>height){
    const side=data.rects.footLook,rightMost=Math.max(data.rects.enterCarButton?.right||0,data.rects.enterJetButton?.right||0);
    for(const id of ['enterCarButton','enterJetButton']){
      const r=data.rects[id];if(!r)continue;
      if(r.left<width*.72)clashes.push(id+' / aiming real estate (too central)');
      if(side&&r.bottom>side.top-6)clashes.push(id+' / right stick reach');
      if(r.right>width-4)clashes.push(id+' / right safe margin');
    }
    if(rightMost&&rightMost<width*.82)clashes.push('boarding button too far from right thumb');
  }
  await page.screenshot({path:`artifacts/mobile-hud-${name}.png`});
  console.log(name,JSON.stringify({geometry:data,overlaps:clashes}));
  if(clashes.length)throw Error('Mobile HUD obstruction: '+clashes.join('; '));
 }
 console.log('Mobile viewport visibility and thumb-control separation: pass');
} finally {await browser.close();}
