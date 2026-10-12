import puppeteer from 'puppeteer-core';
import {mkdir} from 'node:fs/promises';
const input=process.argv[2]||'https://kurzlernen.de/drone_simulator.html',chrome=process.env.CHROME_BIN;
if(!chrome)throw Error('CHROME_BIN missing');
await mkdir('artifacts',{recursive:true});
const browser=await puppeteer.launch({headless:true,executablePath:chrome,args:['--no-sandbox','--disable-dev-shm-usage','--enable-webgl','--ignore-gpu-blocklist','--use-gl=angle','--use-angle=swiftshader']});
const cases=[{width:844,height:390,name:'landscape'},{width:390,height:844,name:'portrait'},{width:740,height:320,name:'compact'}];
let failed=false;
try{
  for(const c of cases){
    const page=await browser.newPage();
    try{
      await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148');
      await page.setViewport({width:c.width,height:c.height,isMobile:true,hasTouch:true,deviceScaleFactor:1});
      await page.goto(input,{waitUntil:'load',timeout:45000});
      await page.waitForFunction(()=>document.querySelector('#status')?.textContent?.includes('SIM ready')&&globalThis.__arondightWalkMode&&document.querySelector('#footMove'),{timeout:45000});
      await page.evaluate(()=>globalThis.__arondightWalkMode.setMode('foot',{persist:false}));
      await page.waitForFunction(()=>document.body.classList.contains('on-foot-mode')&&document.body.classList.contains('solo-flight'),{timeout:12000});
      await new Promise(r=>setTimeout(r,900));
      await page.screenshot({path:'artifacts/mobile-hud-'+c.name+'.png'});
      const g=await page.evaluate(()=>{
        const ids=['footMove','footLook','footJump','thumbWeapon','mobileGameplayMode','mobileGameplayDock','mobileGameplayReset','mobileGameplayMultiplayer','gameExitButton','proximityVoiceBar','proximityVoicePtt','proximityVoiceMute'];
        const visible=id=>{const el=document.getElementById(id);if(!el||el.hidden)return null;const style=getComputedStyle(el),r=el.getBoundingClientRect();if(style.display==='none'||style.visibility==='hidden'||style.opacity==='0'||r.width<8||r.height<8)return null;return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,w:r.width,h:r.height};};
        const items=Object.fromEntries(ids.map(id=>[id,visible(id)]));const b=document.querySelector('#viewport').getBoundingClientRect();
        const overlaps=[];const interactive=['footMove','footLook','footJump','thumbWeapon','mobileGameplayMode','mobileGameplayReset','mobileGameplayMultiplayer','proximityVoicePtt','proximityVoiceMute'];for(let i=0;i<interactive.length;i++)for(let j=i+1;j<interactive.length;j++){const a=items[interactive[i]],c=items[interactive[j]];if(a&&c&&a.x<c.right-3&&a.right>c.x+3&&a.y<c.bottom-3&&a.bottom>c.y+3)overlaps.push([interactive[i],interactive[j]]);}
        return {items,viewport:{x:b.x,y:b.y,w:b.width,h:b.height},overlaps,solo:document.body.classList.contains('solo-flight'),voiceHidden:!items.proximityVoiceBar};
      });
      if(g.voiceHidden||!g.items.proximityVoicePtt||!g.items.proximityVoiceMute||g.overlaps.length)failed=true;
      console.log('Mobile visual '+c.name+': '+JSON.stringify(g));
    }finally{await page.close();}
  }
  if(failed)throw Error('Mobile HUD voice controls must remain visible and nonoverlapping in solo play; see screenshots and geometry');
}finally{await browser.close();}
