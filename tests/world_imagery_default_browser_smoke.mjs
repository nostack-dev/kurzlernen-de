import puppeteer from "puppeteer-core";

const input=process.argv[2]||"https://kurzlernen.de/drone_simulator.html",url=new URL(input),executablePath=process.env.CHROME_BIN;
if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");
const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader"]});
const page=await browser.newPage();
try{
  await page.setViewport({width:844,height:390,deviceScaleFactor:1,hasTouch:true,isMobile:true});
  await page.goto(url.href,{waitUntil:"load",timeout:40000});
  await page.waitForFunction(()=>globalThis.__arondightRealWorld,{timeout:40000});
  await page.evaluate(()=>localStorage.setItem("arondight45WorldImageryV1","1"));
  await page.reload({waitUntil:"load",timeout:40000});
  await page.waitForFunction(()=>globalThis.__arondightRealWorld,{timeout:40000});
  const state=await page.evaluate(()=>({imageryEnabled:globalThis.__arondightRealWorld?.imageryEnabled,stored:localStorage.getItem("arondight45WorldImageryV1"),viewport:document.querySelector("#viewport")?.dataset.worldImageryEnabled||"unset"}));
  if(state.imageryEnabled!==false||state.stored!==null)throw new Error(`satellite imagery survived a fresh startup: ${JSON.stringify(state)}`);
  console.log(`Satellite startup smoke passed: imageryEnabled=${state.imageryEnabled}, legacyStorage=${state.stored}.`);
}finally{await browser.close();}
