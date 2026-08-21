import puppeteer from "puppeteer-core";

const input=process.argv[2]||"http://127.0.0.1:4174/drone_simulator.html",url=new URL(input,"http://127.0.0.1:4174"),executablePath=process.env.CHROME_BIN;
if(process.env.GITHUB_SHA)url.searchParams.set("ci",process.env.GITHUB_SHA);
if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");
const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader"]}),page=await browser.newPage();
try{
  await page.setViewport({width:844,height:390,deviceScaleFactor:1});
  await page.goto(url.href,{waitUntil:"load",timeout:30000});
  await page.waitForFunction(()=>document.querySelector("#status")?.textContent?.includes("SIM ready"),{timeout:30000});
  await page.waitForFunction(()=>{const v=document.querySelector("#viewport");return document.body.classList.contains("solo-flight")&&v?.dataset.mobileDoubleTapZoom==="disabled-v2"&&/population\+static-v2|vs\+population\+static-v2/.test(v?.dataset.worldHitRouting||"")&&String(v?.dataset.worldActionFeedback||"").includes("decals+particles+audio");},{timeout:8000});
  const result=await page.evaluate(async()=>{
    const v=document.querySelector("#viewport"),meta=document.querySelector('meta[name="viewport"]');
    const touch=()=>{const event=new Event("touchend",{bubbles:true,cancelable:true});Object.defineProperty(event,"changedTouches",{value:[{identifier:1}]});v.dispatchEvent(event);return event.defaultPrevented;};
    const firstPrevented=touch();await new Promise(resolve=>setTimeout(resolve,18));const secondPrevented=touch();
    return{meta:meta?.content||"",firstPrevented,secondPrevented,blocks:Number(v?.dataset.mobileDoubleTapBlocks||0),zoom:v?.dataset.mobileDoubleTapZoom,routing:v?.dataset.worldHitRouting,feedback:v?.dataset.worldActionFeedback,audio:v?.dataset.worldActionAudio,decalPool:Number(v?.dataset.fireDecalPoolSize||0)};
  });
  if(!/maximum-scale\s*=\s*1/i.test(result.meta)||!/user-scalable\s*=\s*no/i.test(result.meta))throw new Error(`mobile viewport zoom lock missing: ${JSON.stringify(result)}`);
  if(result.firstPrevented||!result.secondPrevented||result.blocks<1||result.zoom!=="disabled-v2")throw new Error(`double-tap zoom guard failed: ${JSON.stringify(result)}`);
  if(!String(result.routing).includes("population+static-v2")||!String(result.feedback).includes("decals+particles+audio")||result.audio!=="layered-procedural-v2"||result.decalPool<32)throw new Error(`world action feedback contract failed: ${JSON.stringify(result)}`);
  console.log(`World action feedback browser smoke passed: zoom=${result.zoom}, routing=${result.routing}, feedback=${result.feedback}.`);
}finally{await browser.close();}
