import puppeteer from "puppeteer-core";

const url=process.argv[2]||"http://127.0.0.1:4174/drone_simulator.html";
const executablePath=process.env.CHROME_BIN;
if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");

const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader"]});
const page=await browser.newPage();
await page.evaluateOnNewDocument(()=>{
  Object.defineProperty(navigator,"geolocation",{configurable:true,value:{getCurrentPosition(_success,error){queueMicrotask(()=>error?.({code:1,message:"CI geolocation denied"}));}}});
});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const read=()=>page.evaluate(()=>{
  const fc=Number(globalThis.__arondightDiagnostics?.fcState)||0;
  const aglText=document.querySelector("#soloAlt")?.textContent||"";
  const rangeText=document.querySelector("#soloRangeStatus")?.textContent||"";
  const match=aglText.match(/AGL\s+([0-9.]+)\s*m/);
  const attitude=(document.querySelector("#attitude")?.textContent||"").match(/(-?[0-9.]+)\s*\/\s*(-?[0-9.]+)/);
  return{
    fc,navValid:Boolean(fc&(1<<5)),navDegraded:Boolean(fc&(1<<7)),
    aglText,rangeText,agl:match?Number(match[1]):NaN,
    altitude:parseFloat(document.querySelector("#altitude")?.textContent||"NaN"),
    roll:attitude?Number(attitude[1]):NaN,pitch:attitude?Number(attitude[2]):NaN,
    state:document.querySelector("#fcState")?.textContent||"",
  };
});

try{
  await page.setViewport({width:844,height:390,deviceScaleFactor:1});
  await page.goto(url,{waitUntil:"load",timeout:30000});
  await page.waitForFunction(()=>document.querySelector("#status")?.textContent?.includes("SIM ready"),{timeout:30000});
  await page.waitForFunction(()=>document.body.classList.contains("solo-flight"),{timeout:5000});
  await page.waitForFunction(()=>{const b=document.querySelector("#soloArm");return b&&!b.disabled&&b.textContent.trim()==="ARM";},{timeout:20000});
  await page.waitForFunction(()=>{
    const fc=Number(globalThis.__arondightDiagnostics?.fcState)||0;
    const aglText=document.querySelector("#soloAlt")?.textContent||"";
    const rangeText=document.querySelector("#soloRangeStatus")?.textContent||"";
    const match=aglText.match(/AGL\s+([0-9.]+)\s*m/);
    return Boolean(fc&(1<<5))&&!Boolean(fc&(1<<7))&&Boolean(match)&&!rangeText.includes("DEGRADED")&&!rangeText.includes("LOST");
  },{timeout:10000});

  const before=await read();
  if(!before.navValid||before.navDegraded||!Number.isFinite(before.agl)||before.agl<0||before.rangeText.includes("DEGRADED")||before.rangeText.includes("LOST"))
    throw new Error(`AGL invalid before ARM: ${JSON.stringify(before)}`);

  await page.click("#soloArm");
  await page.waitForFunction(()=>document.querySelector("#fcState")?.textContent==="ARMED",{timeout:5000});
  await wait(250);

  const samples=[];
  for(let i=0;i<45;i++){samples.push(await read());await wait(100);}
  const bad=samples.find(s=>!s.navValid||s.navDegraded||!Number.isFinite(s.agl)||s.rangeText.includes("DEGRADED")||s.rangeText.includes("LOST"));
  if(bad)throw new Error(`AGL/NAV dropped during takeoff: ${JSON.stringify(bad)}`);

  const maxAltitude=Math.max(...samples.map(s=>s.altitude).filter(Number.isFinite));
  const final=samples.at(-1),maxTilt=Math.max(...samples.flatMap(s=>[Math.abs(s.roll),Math.abs(s.pitch)]).filter(Number.isFinite));
  if(!(maxAltitude>.55))throw new Error(`airframe never achieved a real takeoff while AGL stayed valid: maxAltitude=${maxAltitude}`);
  if(!(final.agl>.65&&final.agl<1.75))throw new Error(`default 1.2 m AGL hold did not converge: ${JSON.stringify(final)}`);
  if(maxTilt>30)throw new Error(`takeoff attitude oscillation exceeded 30 degrees: maxTilt=${maxTilt.toFixed(1)} final=${JSON.stringify(final)}`);
  if(Math.abs(final.roll)>10||Math.abs(final.pitch)>10)throw new Error(`airframe did not settle level after takeoff: ${JSON.stringify(final)}`);

  console.log(`Takeoff AGL E2E passed: AGL valid continuously, max altitude ${maxAltitude.toFixed(2)} m, final AGL ${final.agl.toFixed(2)} m, max tilt ${maxTilt.toFixed(1)} deg.`);
}finally{await browser.close();}
