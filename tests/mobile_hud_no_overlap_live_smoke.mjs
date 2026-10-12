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
 for(const [name,width,height] of [['iphone-portrait',390,844],['compact-portrait',360,740],['native-landscape',844,390],['safari-bars',844,300],['narrow-landscape',740,320]]){
  await page.setViewport({width,height,deviceScaleFactor:1,isMobile:true,hasTouch:true});
  await page.evaluate(()=>globalThis.__arondightWalkMode.setMode('foot',{persist:false}));
  await page.waitForFunction(()=>document.querySelector('#viewport')?.dataset.playerMode==='foot',{timeout:7000});
  await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,600)));
  const data=await page.evaluate(()=>{
   const ids=['mobileGameplayDock','mobileGameplayReset','mobileGameplayMultiplayer','mobileGameplayMultiplayerStatus','mobileGameplayMode','footMove','footLook','footFire','footJump','thumbWeapon','airStrikeButton','handGrenadeBtn','soloArm','soloKill','proximityVoiceBar','proximityVoicePtt','proximityVoiceMute','buildTag','enterCarButton','enterJetButton'],rects={};
   for(const id of ids){const e=document.getElementById(id),style=e&&getComputedStyle(e);if(!e||e.hidden||style.display==='none'||style.visibility==='hidden'||!e.getBoundingClientRect().width)continue;
    const r=e.getBoundingClientRect();rects[id]={left:r.left,right:r.right,top:r.top,bottom:r.bottom};}
   // Scores are not buttons; the old test ignored their collision with STRIKE
   // and hand grenades at 844x300 and the VS scoreboard in multiplayer.
   for(const [id,selector] of [['sandboxScore','#sandboxHud .sb-score'],['sandboxFlow','#sandboxHud .sb-flow']]){
     const e=document.querySelector(selector),s=e&&getComputedStyle(e);
     if(!e||s.display==='none'||s.visibility==='hidden')continue;
     const r=e.getBoundingClientRect();if(r.width&&r.height)rects[id]={left:r.left,right:r.right,top:r.top,bottom:r.bottom};
   }
   return{width:innerWidth,height:innerHeight,rects};
  });
  const pairs=[['mobileGameplayDock','mobileGameplayReset'],['mobileGameplayDock','mobileGameplayMultiplayer'],['mobileGameplayMode','footMove'],['mobileGameplayMode','footLook'],['footMove','footLook'],['footMove','footFire'],['footLook','footFire'],['footJump','footLook'],['footJump','footFire'],['proximityVoiceBar','footMove'],['proximityVoiceBar','footLook'],['enterCarButton','footMove'],['enterJetButton','footLook'],['enterCarButton','enterJetButton'],['proximityVoiceBar','handGrenadeBtn'],['proximityVoiceBar','airStrikeButton'],['proximityVoiceBar','enterCarButton'],['proximityVoiceBar','enterJetButton'],['proximityVoiceBar','sandboxScore'],['proximityVoiceBar','sandboxFlow'],['proximityVoiceBar','mobileGameplayMultiplayer'],['proximityVoiceBar','mobileGameplayReset'],['airStrikeButton','sandboxScore'],['airStrikeButton','sandboxFlow'],['handGrenadeBtn','sandboxScore'],['handGrenadeBtn','sandboxFlow'],['airStrikeButton','handGrenadeBtn'],['thumbWeapon','footLook'],['thumbWeapon','footJump'],['mobileGameplayMultiplayerStatus','sandboxScore'],['mobileGameplayMultiplayerStatus','sandboxFlow']];
  const clashes=[];
  if(data.rects.buildTag)clashes.push('buildTag must not obscure gameplay or voice controls on mobile');
  for(const id of ['proximityVoiceBar','proximityVoicePtt','proximityVoiceMute'])if(!data.rects[id])clashes.push(id+' hidden during solo gameplay');
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
  // The aiming area must remain free of permanent action buttons.
  // We intentionally do not count transient hit markers or scene reticles.
  const aim={left:width*.38,right:width*.62,top:height*.27,bottom:height*.72};
  for(const id of ['mobileGameplayDock','mobileGameplayReset','mobileGameplayMultiplayer','mobileGameplayMode','proximityVoiceBar','airStrikeButton','handGrenadeBtn','footJump','thumbWeapon','soloArm','soloKill','enterCarButton','enterJetButton']){
    const r=data.rects[id];if(!r)continue;
    if(Math.min(r.right,aim.right)-Math.max(r.left,aim.left)>6&&Math.min(r.bottom,aim.bottom)-Math.max(r.top,aim.top)>6)
      clashes.push(id+' / game aiming region');
  }
  await page.screenshot({path:`artifacts/mobile-hud-${name}.png`});
  console.log(name,JSON.stringify({geometry:data,overlaps:clashes}));
  if(clashes.length)throw Error('Mobile HUD obstruction: '+clashes.join('; '));
 }
 // A multiplayer scoreboard replaces the solo score. They must not stack.
 await page.evaluate(()=>document.body.classList.add('vs-multiplayer'));
 const vsSoloScoreVisible=await page.evaluate(()=>{
   const score=document.querySelector('#sandboxHud .sb-score'),flow=document.querySelector('#sandboxHud .sb-flow');
   return[score,flow].some(e=>e&&getComputedStyle(e).display!=='none');
 });
 await page.evaluate(()=>document.body.classList.remove('vs-multiplayer'));
 if(vsSoloScoreVisible)throw Error('Multiplayer HUD has double score/FLOW overlays');

 // Inspect the drone HUD independently: ARM/STOP and altitude are absent on foot,
 // so checking only the foot screenshots missed an entire UI mode.
 for(const [name,width,height] of [['drone-landscape',844,390],['drone-safari-bars',844,300]]){
   await page.setViewport({width,height,deviceScaleFactor:1,isMobile:true,hasTouch:true});
   await page.evaluate(()=>globalThis.__arondightWalkMode.setMode('drone',{persist:false}));
   await page.waitForFunction(()=>document.querySelector('#viewport')?.dataset.playerMode==='drone',{timeout:7000});
   await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,700)));
   await page.screenshot({path:`artifacts/mobile-hud-${name}.png`});
   const rects=await page.evaluate(()=>{
     const out={};
     for(const id of ['soloArm','soloKill','soloClearance','mobileGameplayMode','airStrikeButton','mobileGameplayReset','proximityVoiceBar','proximityVoicePtt','proximityVoiceMute']){
       const el=document.getElementById(id),s=el&&getComputedStyle(el);if(!el||s.display==='none'||s.visibility==='hidden')continue;
       const r=el.getBoundingClientRect();if(r.width&&r.height)out[id]={left:r.left,right:r.right,top:r.top,bottom:r.bottom};
     }
     return out;
   });
   if(!rects.proximityVoiceBar||!rects.proximityVoicePtt||!rects.proximityVoiceMute)throw Error(`Drone ${name}: voice controls hidden in solo mode`);
   const aim={left:width*.38,right:width*.62,top:height*.27,bottom:height*.72};
   for(const [id,r] of Object.entries(rects)){
     if(Math.min(r.right,aim.right)-Math.max(r.left,aim.left)>6&&Math.min(r.bottom,aim.bottom)-Math.max(r.top,aim.top)>6)
       throw Error(`Drone ${name}: ${id} covers the middle of the game`);
   }
 }
 console.log('Mobile HUD visibility passed: portrait, narrow landscape, Safari bars, drone and foot, multiplayer HUD and clear aiming area.');
} finally {await browser.close();}
