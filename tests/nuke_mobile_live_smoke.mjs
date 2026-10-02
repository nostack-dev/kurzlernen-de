import puppeteer from "puppeteer-core";

const input=process.argv[2]||"https://kurzlernen.de/drone_simulator.html",url=new URL(input),executablePath=process.env.CHROME_BIN;
if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");
const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader"]}),page=await browser.newPage();
await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1");
const pause=ms=>page.evaluate(delay=>new Promise(resolve=>setTimeout(resolve,delay)),ms);
try{
  await page.setViewport({width:844,height:390,deviceScaleFactor:1,isMobile:true,hasTouch:true});
  await page.goto(url.href,{waitUntil:"load",timeout:45000});
  await page.waitForFunction(()=>document.querySelector("#status")?.textContent?.includes("SIM ready")&&globalThis.__arondightDroneWeapons&&document.querySelector("#mobileGameplayDock"),{timeout:45000});
  await page.evaluate(()=>globalThis.__arondightWalkMode?.setMode?.("drone",{persist:false}));
  await page.waitForFunction(()=>document.querySelector("#mobileGameplayMode")?.textContent==="DRONE"&&!document.querySelector("#soloArm")?.disabled,{timeout:12000});
  const modes=await page.evaluate(()=>{const api=globalThis.__arondightDroneWeapons;api.setMode("gun");const a=api.displayMode||api.mode;api.toggle();const b=api.displayMode||api.mode;api.toggle();const c=api.displayMode||api.mode;api.toggle();const d=api.displayMode||api.mode;api.setMode("nuke");return[a,b,c,d,api.displayMode||api.mode];});
  if(JSON.stringify(modes)!==JSON.stringify(["gun","missile","nuke","gun","nuke"]))throw new Error(`drone weapon cycle is wrong: ${JSON.stringify(modes)}`);
  await page.waitForFunction(()=>document.querySelector("#mobileGameplayWeapon")?.textContent?.trim()==="WEAPON · NUKE",{timeout:3000});
  await page.click("#soloArm");
  await page.waitForFunction(()=>document.querySelector("#soloState")?.textContent?.trim()==="ARMED"&&document.querySelector("#viewport")?.dataset.fireArmed==="1",{timeout:10000});
  const shot=await page.evaluate(()=>{const v=document.querySelector("#viewport"),r=v.getBoundingClientRect(),api=globalThis.__arondightDroneWeapons,fired=api.fireMissile({clientX:r.left+r.width*.58,clientY:r.top+r.height*.63,source:"nuke-live-regression"});return{fired:Boolean(fired),mode:api.displayMode||api.mode,selected:v.dataset.nukeSelected,contract:v.dataset.nukeContract,launches:Number(v.dataset.nukeLaunches)||0,target:v.dataset.nukeTarget};});
  if(!(shot.fired&&shot.mode==="nuke"&&shot.selected==="1"&&shot.contract==="drone-targeted-fixed-impact-v1"&&shot.launches>=1&&shot.target))throw new Error(`nuke did not launch through shared drone fire path: ${JSON.stringify(shot)}`);
  await page.waitForFunction(()=>{const v=document.querySelector("#viewport");return Number(v?.dataset.nukeImpacts)>=1&&v.dataset.nukeEffect==="flash-fireball-shockwave-mushroom-v1"&&Number(v.dataset.nukeBlastRadius)===65;},{timeout:5000});
  await pause(300);
  const impact=await page.evaluate(()=>{const v=document.querySelector("#viewport"),overlay=document.querySelector("#nukeFlashOverlay");let visibleParts=0;globalThis.__arondightRealWorld?.threeScene?.traverse?.(n=>{if(n.userData?.nukeWeaponPart&&n.visible!==false)visibleParts++;});return{impacts:Number(v.dataset.nukeImpacts)||0,effect:v.dataset.nukeEffect,radius:Number(v.dataset.nukeBlastRadius)||0,flash:Boolean(overlay),visibleParts,mode:globalThis.__arondightDroneWeapons?.displayMode||globalThis.__arondightDroneWeapons?.mode};});
  if(!(impact.impacts>=1&&impact.effect==="flash-fireball-shockwave-mushroom-v1"&&impact.radius===65&&impact.flash&&impact.visibleParts>=4&&impact.mode==="nuke"))throw new Error(`nuke impact stack is incomplete: ${JSON.stringify(impact)}`);
  console.log(`Nuke mobile live regression passed. ${JSON.stringify({modes,shot,impact})}`);
}finally{await browser.close();}
