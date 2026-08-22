import puppeteer from "puppeteer-core";

const input=process.argv[2]||"http://127.0.0.1:4174/drone_simulator.html",url=new URL(input,"http://127.0.0.1:4174"),executablePath=process.env.CHROME_BIN;
if(process.env.GITHUB_SHA)url.searchParams.set("ci",process.env.GITHUB_SHA);
if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");
const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader"]}),page=await browser.newPage();
try{
  await page.setViewport({width:844,height:390,deviceScaleFactor:1});
  await page.goto(url.href,{waitUntil:"load",timeout:30000});
  await page.waitForFunction(()=>document.querySelector("#status")?.textContent?.includes("SIM ready"),{timeout:30000});
  await page.waitForFunction(()=>{const v=document.querySelector("#viewport");return document.body.classList.contains("solo-flight")&&Number(v?.dataset.fireDecalPoolSize||0)>=32&&Number(v?.dataset.fireProjectilePoolSize||0)>=36;},{timeout:8000});
  const before=await page.$eval("#viewport",v=>({writes:Number(v.dataset.fireDecalWrites||0),impacts:Number(v.dataset.fireProjectileImpacts||0),shots:Number(v.dataset.fireShots||0)}));
  await page.evaluate(()=>{const v=document.querySelector("#viewport"),r=v.getBoundingClientRect(),clientX=r.left+r.width*.5,clientY=r.top+r.height*.94;v.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,cancelable:true,pointerId:991,pointerType:"touch",clientX,clientY,button:0}));});
  await page.waitForFunction(before=>{const v=document.querySelector("#viewport");return Number(v?.dataset.fireShots||0)>before.shots&&Number(v?.dataset.fireProjectileImpacts||0)>before.impacts&&Number(v?.dataset.fireDecalWrites||0)>before.writes;},{timeout:5000},before);
  await page.evaluate(()=>document.querySelector("#viewport")?.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,cancelable:true,pointerId:991,pointerType:"touch",button:0})));
  const result=await page.evaluate(()=>{const v=document.querySelector("#viewport"),scene=globalThis.__arondightRealWorld?.threeScene;let visibleDecals=0,worldDecals=0;scene?.traverse?.(node=>{if(node?.userData?.flightFireDecal&&node.visible){visibleDecals++;if(node.userData.flightFireWorld)worldDecals++;}});return{writes:Number(v?.dataset.fireDecalWrites||0),impacts:Number(v?.dataset.fireProjectileImpacts||0),shots:Number(v?.dataset.fireShots||0),visibleDecals,worldDecals};});
  if(result.writes<=before.writes||result.impacts<=before.impacts||result.shots<=before.shots||result.visibleDecals<1)throw new Error(`projectile impact/decal regression: ${JSON.stringify({before,result})}`);
  console.log(`Projectile decal browser smoke passed: shots=${result.shots-before.shots}, impacts=${result.impacts-before.impacts}, decals=${result.writes-before.writes}, visible=${result.visibleDecals}.`);
}finally{await browser.close();}
