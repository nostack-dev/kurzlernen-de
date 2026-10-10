import puppeteer from "puppeteer-core";

const input=process.argv[2]||"https://kurzlernen.de/drone_simulator.html",url=new URL(input),executablePath=process.env.CHROME_BIN;
if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");
const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader"]}),page=await browser.newPage(),errors=[];
page.on("pageerror",error=>errors.push(`pageerror: ${error.message}`));
page.on("console",message=>{if(message.type()==="error")errors.push(`console: ${message.text()}`);});
const pause=ms=>page.evaluate(delay=>new Promise(resolve=>setTimeout(resolve,delay)),ms);
try{
  await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1");
  await page.setViewport({width:844,height:390,deviceScaleFactor:1,isMobile:true,hasTouch:true});
  await page.goto(url.href,{waitUntil:"load",timeout:45000});
  await page.waitForFunction(()=>document.querySelector("#status")?.textContent?.includes("SIM ready")&&globalThis.__arondightWalkMode&&document.querySelector("#mobileGameplayReset"),{timeout:45000});
  await page.waitForFunction(()=>document.querySelector("#viewport")?.dataset.worldTrafficApiMutation==="none-readonly-safe-v1",{timeout:10000});
  await pause(1200);
  const readonlyErrors=errors.filter(text=>/read only property ['\"]setTarget|Cannot assign to read only property ['\"]setTarget/i.test(text));
  if(readonlyErrors.length)throw new Error(`readonly rigid-body API mutation still crashes live runtime: ${JSON.stringify(readonlyErrors)}`);
  const visible=await page.$eval("#mobileGameplayReset",button=>{const s=getComputedStyle(button),r=button.getBoundingClientRect();return{display:s.display,visibility:s.visibility,opacity:Number(s.opacity),width:r.width,height:r.height,text:button.textContent.trim()};});
  if(visible.display==="none"||visible.visibility==="hidden"||visible.opacity===0||visible.width<48||visible.height<28||visible.text!=="RESET")throw new Error(`mobile RESET is not visibly reachable: ${JSON.stringify(visible)}`);
  await page.evaluate(()=>globalThis.__arondightWalkMode.setMode("drone",{persist:false,reason:"reset-regression-prep"}));
  await page.waitForFunction(()=>document.querySelector("#viewport")?.dataset.playerMode==="drone",{timeout:5000});
  const before=await page.evaluate(()=>({epoch:Number(globalThis.__arondightDiagnostics?.runEpoch)||0,sim:Number(globalThis.__arondightDiagnostics?.simTime)||0,mode:document.querySelector("#viewport")?.dataset.playerMode,camera:document.querySelector("#viewport")?.dataset.cameraMode}));
  await page.click("#mobileGameplayReset");
  await page.waitForFunction(epoch=>Number(globalThis.__arondightDiagnostics?.runEpoch)>epoch,{timeout:15000},before.epoch);
  await page.waitForFunction(()=>{const v=document.querySelector("#viewport");return v?.dataset.mobileResetRoute==="solo-reset-v1"&&v.dataset.playerMode==="foot"&&v.dataset.cameraMode==="walk";},{timeout:15000});
  const after=await page.evaluate(()=>({epoch:Number(globalThis.__arondightDiagnostics?.runEpoch)||0,sim:Number(globalThis.__arondightDiagnostics?.simTime)||0,mode:document.querySelector("#viewport")?.dataset.playerMode,camera:document.querySelector("#viewport")?.dataset.cameraMode,route:document.querySelector("#viewport")?.dataset.mobileResetRoute,destroyed:Boolean(globalThis.__arondightDroneDamageModel?.destroyed)}));
  // RESET restarts into the start mode: on foot with the pistol, drone parked and intact
  if(!(after.epoch>before.epoch&&after.mode==="foot"&&after.camera==="walk"&&after.route==="solo-reset-v1"&&!after.destroyed))throw new Error(`mobile RESET did not restart into a clean start state (on foot): ${JSON.stringify({before,after})}`);
  const postReadonlyErrors=errors.filter(text=>/read only property ['\"]setTarget|Cannot assign to read only property ['\"]setTarget/i.test(text));
  if(postReadonlyErrors.length)throw new Error(`readonly traffic API error appeared after RESET: ${JSON.stringify(postReadonlyErrors)}`);
  console.log(`Mobile reset + readonly traffic API regression passed. ${JSON.stringify({visible,before,after})}`);
}finally{await browser.close();}
