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
const ARM_AUTHORITY_LIMIT_S=2.0;
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
    visualSupport:parseFloat(document.querySelector("#viewport")?.dataset.airframeVisualSupportZ||"NaN"),
    targetAgl:parseFloat(document.querySelector("#soloClearance")?.dataset.targetAglM||"NaN"),
  };
});
const assertFlightHealthy=(sample,phase)=>{
  if(sample.state!=="ARMED"||!sample.navValid||sample.navDegraded||!Number.isFinite(sample.agl)||sample.agl<.20||sample.rangeText.includes("DEGRADED")||sample.rangeText.includes("LOST"))
    throw new Error(`${phase} lost flight/AGL authority: ${JSON.stringify(sample)}`);
  if(!Number.isFinite(sample.roll)||!Number.isFinite(sample.pitch)||Math.abs(sample.roll)>35||Math.abs(sample.pitch)>35)
    throw new Error(`${phase} attitude became unstable: ${JSON.stringify(sample)}`);
};

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
    const state=document.querySelector("#fcState")?.textContent||"";
    const button=document.querySelector("#soloArm");
    const match=aglText.match(/AGL\s+([0-9.]+)\s*m/);
    return state==="DISARMED"&&Boolean(button)&&!button.disabled&&button.textContent.trim()==="ARM"&&Boolean(fc&(1<<5))&&!Boolean(fc&(1<<7))&&Boolean(match)&&!rangeText.includes("DEGRADED")&&!rangeText.includes("LOST");
  },{timeout:20000});

  const before=await read();
  if(before.state!=="DISARMED"||!before.navValid||before.navDegraded||!Number.isFinite(before.agl)||before.agl<0||before.rangeText.includes("DEGRADED")||before.rangeText.includes("LOST"))
    throw new Error(`AGL/arm readiness invalid before ARM: ${JSON.stringify(before)}`);
  const groundVisualSamples=[];for(let i=0;i<20;i++){groundVisualSamples.push((await read()).visualSupport);await wait(50);}
  const minVisualSupport=Math.min(...groundVisualSamples.filter(Number.isFinite));
  if(!Number.isFinite(minVisualSupport)||minVisualSupport<.001)throw new Error(`visible airframe clipped the ground during pre-arm settle: minSupport=${minVisualSupport} samples=${JSON.stringify(groundVisualSamples)}`);

  const armStart=await page.evaluate(()=>Number(globalThis.__arondightDiagnostics?.simTime));
  await page.click("#soloArm");
  await page.waitForFunction(({start,limit})=>{
    const d=globalThis.__arondightDiagnostics,sim=Number(d?.simTime),fc=Number(d?.fcState)||0;
    return Boolean(fc&1)||(Number.isFinite(sim)&&sim>=start+limit);
  },{timeout:15000},{start:armStart,limit:ARM_AUTHORITY_LIMIT_S});
  const armReached=await page.evaluate(()=>({sim:Number(globalThis.__arondightDiagnostics?.simTime),fc:Number(globalThis.__arondightDiagnostics?.fcState)||0}));
  if(!(armReached.fc&1)||armReached.sim-armStart>ARM_AUTHORITY_LIMIT_S)throw new Error(`takeoff ARM authority failed: start=${armStart} reached=${JSON.stringify(armReached)}`);
  await page.waitForFunction(()=>document.querySelector("#fcState")?.textContent==="ARMED",{timeout:1500});
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

  const heightPoint=async direction=>page.$eval("#soloHeightPad",(pad,dir)=>{const r=pad.getBoundingClientRect(),rotated=document.querySelector("#viewport")?.dataset.soloOrientation==="css-landscape";return rotated?{x:dir>0?r.right-4:r.left+4,y:r.top+r.height/2}:{x:r.left+r.width/2,y:dir>0?r.top+4:r.bottom-4};},direction);
  const holdHeight=async(direction,durationMs,phase,sink)=>{
    const point=await heightPoint(direction);await page.mouse.move(point.x,point.y);await page.mouse.down();
    const started=Date.now();
    try{while(Date.now()-started<durationMs){const sample=await read();sink.push(sample);assertFlightHealthy(sample,phase);await wait(100);}}
    finally{await page.mouse.up();}
    await wait(120);
  };

  const vertical=[];
  const targetStart=(await read()).targetAgl;
  await holdHeight(+1,1100,"CLIMB",vertical);
  const targetHigh=(await read()).targetAgl;
  if(!(targetHigh-targetStart>4.0&&targetHigh-targetStart<6.5))throw new Error(`CLIMB target slew unexpected: start=${targetStart} high=${targetHigh}`);
  for(let i=0;i<30;i++){const sample=await read();vertical.push(sample);assertFlightHealthy(sample,"HIGH HOLD");await wait(100);}
  await holdHeight(-1,1800,"DESCEND",vertical);
  const targetLow=(await read()).targetAgl;
  if(!(targetLow>=.49&&targetLow<=.75))throw new Error(`DESCEND did not clamp target at safe floor: ${targetLow}`);
  for(let i=0;i<80;i++){const sample=await read();vertical.push(sample);assertFlightHealthy(sample,"LOW HOLD");await wait(100);}
  const minAgl=Math.min(...vertical.map(s=>s.agl).filter(Number.isFinite)),verticalMaxTilt=Math.max(...vertical.flatMap(s=>[Math.abs(s.roll),Math.abs(s.pitch)]).filter(Number.isFinite)),verticalFinal=vertical.at(-1);
  if(minAgl<.20)throw new Error(`UP/DOWN stress approached/struck ground: minAGL=${minAgl.toFixed(2)} final=${JSON.stringify(verticalFinal)}`);
  if(!(verticalFinal.agl>.35&&verticalFinal.agl<1.00))throw new Error(`post-DESCEND 0.5 m hold did not settle safely: ${JSON.stringify(verticalFinal)}`);

  console.log(`Takeoff + UP/DOWN AGL E2E passed: initial max altitude ${maxAltitude.toFixed(2)} m, stress target ${targetStart.toFixed(2)}→${targetHigh.toFixed(2)}→${targetLow.toFixed(2)} m, min AGL ${minAgl.toFixed(2)} m, final ${verticalFinal.agl.toFixed(2)} m, max tilt ${Math.max(maxTilt,verticalMaxTilt).toFixed(1)} deg.`);
}finally{await browser.close();}
