import puppeteer from "puppeteer-core";

const executablePath=process.env.CHROME_BIN;
if(!executablePath)throw Error("CHROME_BIN required");
const url=new URL(process.argv[2]||"https://kurzlernen.de/drone_simulator.html");
url.searchParams.set("fp-hold-fire-diag",String(Date.now()));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader"]});
const page=await browser.newPage(),errors=[];
page.on("pageerror",e=>errors.push(String(e?.stack||e)));
try{
  await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148");
  await page.setViewport({width:844,height:390,deviceScaleFactor:1});
  await page.goto(url.href,{waitUntil:"load",timeout:30000});
  await page.waitForFunction(()=>document.querySelector("#status")?.textContent?.includes("SIM ready")&&document.body.classList.contains("solo-flight")&&globalThis.__arondightWalkMode,{timeout:30000});
  await page.evaluate(()=>globalThis.__arondightWalkMode?.setMode?.("foot",{persist:false,reason:"diag"}));
  await page.waitForFunction(()=>document.body.classList.contains("on-foot-mode")&&document.querySelector("#footFire"),{timeout:10000});
  const before=await page.$eval("#viewport",v=>Number(v.dataset.walkShots||0));
  const rect=await page.$eval("#footFire",el=>{const r=el.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};});
  await page.evaluate(({x,y})=>{const el=document.querySelector("#footFire");el.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,cancelable:true,pointerId:301,pointerType:"touch",clientX:x,clientY:y,button:0,buttons:1,isPrimary:true}));},rect);
  await sleep(1400);
  const held=await page.$eval("#viewport",v=>({shots:Number(v.dataset.walkShots||0),playerDead:v.dataset.playerDead||"0",mode:v.dataset.playerMode||"",errors:[] }));
  await page.evaluate(({x,y})=>{const el=document.querySelector("#footFire");el.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,cancelable:true,pointerId:301,pointerType:"touch",clientX:x,clientY:y,button:0,buttons:0,isPrimary:true}));},rect);
  const delta=held.shots-before;
  console.log(`FIRST_PERSON_HOLD_FIRE before=${before} after=${held.shots} delta=${delta} state=${JSON.stringify(held)} pageErrors=${JSON.stringify(errors)}`);
  if(delta!==1)throw Error(`unexpected live hold-fire behavior: expected exactly one shot from current pointerdown-only implementation, got ${delta}`);
  throw Error(`ROOT_CAUSE_CONFIRMED_FIRST_PERSON_NO_AUTOFIRE: held FIRE for 1400ms produced only ${delta} shot; pageErrors=${JSON.stringify(errors)}`);
}finally{await browser.close();}
