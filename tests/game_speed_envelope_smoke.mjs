import puppeteer from "puppeteer-core";

const url=process.argv[2]||"http://127.0.0.1:4174/drone_simulator.html";
const executablePath=process.env.CHROME_BIN;
if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");

const browser=await puppeteer.launch({
  headless:true,executablePath,
  args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader","--disable-background-timer-throttling","--disable-backgrounding-occluded-windows","--disable-renderer-backgrounding"],
});
const page=await browser.newPage(),errors=[];
page.on("pageerror",e=>errors.push(`pageerror: ${e.message}`));
page.on("console",m=>{if(m.type()==="error")errors.push(`console: ${m.text()}`);});

const wrapDeg=value=>{let x=Number(value)||0;while(x>180)x-=360;while(x<-180)x+=360;return x;};
async function simTime(){return page.evaluate(()=>Number(globalThis.__arondightDiagnostics?.simTime)||0);}
async function waitSim(target,timeout=90000){await page.waitForFunction(t=>Number(globalThis.__arondightDiagnostics?.simTime)>=t,{timeout},target);}
async function flightSamples(){return page.evaluate(async()=>{const original=URL.createObjectURL;let captured=null;URL.createObjectURL=blob=>{captured=blob;return original.call(URL,blob);};try{document.querySelector("#exportLog")?.click();await new Promise(resolve=>setTimeout(resolve,0));if(!captured)throw new Error("flight log blob was not captured");const log=JSON.parse(await captured.text());return log?.samples||[];}finally{URL.createObjectURL=original;}});}
function bodyMotion(sample){const physicalYaw=Number(sample.yaw_deg)||0,fcYaw=Number(sample.fc_yaw_deg)||0,yaw=physicalYaw*Math.PI/180,c=Math.cos(yaw),s=Math.sin(yaw),vx=Number(sample.vx)||0,vy=Number(sample.vy)||0,vz=Number(sample.vz)||0;return{time:Number(sample.time_s)||0,forward:-c*vx-s*vy,right:-s*vx+c*vy,horizontal:Math.hypot(vx,vy),vertical:vz,yawFrameErrorDeg:wrapDeg(physicalYaw-fcYaw)};}
async function stick(){return page.$eval("#soloLeft",e=>{const b=e.getBoundingClientRect();return{x:b.left+b.width/2,y:b.top+b.height/2,r:Math.min(b.width,b.height)*.42};});}
async function settle(){await page.waitForFunction(()=>parseFloat(document.querySelector("#velocity")?.textContent||"99")<.85,{timeout:90000});}
async function setSpeed(kmh){
  await page.click("#soloTopbar .phone-settings-button");
  await page.waitForFunction(()=>document.querySelector(".phone-settings-dialog")?.open,{timeout:5000});
  const actual=await page.$eval('[data-slider="speed"]',(slider,value)=>{slider.value=String(value);slider.dispatchEvent(new Event("input",{bubbles:true}));return Number(slider.value);},kmh);
  if(actual!==kmh)throw new Error(`speed slider could not select ${kmh} km/h; got ${actual}`);
  await page.waitForFunction(value=>JSON.parse(localStorage.getItem("arondight45PhoneControlSettingsV5")||"{}").maxHorizontalSpeedKmh===value,{timeout:5000},kmh);
  await page.click('.phone-settings-dialog [data-close]');
}

const directions=[
  {name:"forward",dx:0,dy:-1,forwardUnit:1,rightUnit:0},
  {name:"backward",dx:0,dy:1,forwardUnit:-1,rightUnit:0},
  {name:"right",dx:1,dy:0,forwardUnit:0,rightUnit:1},
  {name:"left",dx:-1,dy:0,forwardUnit:0,rightUnit:-1},
  {name:"forward-right",dx:Math.SQRT1_2,dy:-Math.SQRT1_2,forwardUnit:Math.SQRT1_2,rightUnit:Math.SQRT1_2},
  {name:"forward-left",dx:-Math.SQRT1_2,dy:-Math.SQRT1_2,forwardUnit:Math.SQRT1_2,rightUnit:-Math.SQRT1_2},
  {name:"backward-right",dx:Math.SQRT1_2,dy:Math.SQRT1_2,forwardUnit:-Math.SQRT1_2,rightUnit:Math.SQRT1_2},
  {name:"backward-left",dx:-Math.SQRT1_2,dy:Math.SQRT1_2,forwardUnit:-Math.SQRT1_2,rightUnit:-Math.SQRT1_2},
];

async function runDirection(direction,{label,targetMps,minSteadyMps,maxSteadyMps,holdS,t90LimitS}){
  await settle();
  const g=await stick();
  await page.mouse.move(g.x,g.y);await page.mouse.down();await page.mouse.move(g.x+g.r*direction.dx,g.y+g.r*direction.dy,{steps:8});
  const start=await simTime();await waitSim(start+holdS,150000);await page.mouse.up();
  const raw=await flightSamples(),motion=raw.map(bodyMotion);
  const samples=motion.filter(x=>x.time>=start+holdS-1.0&&x.time<=start+holdS+.15);
  if(samples.length<20)throw new Error(`${label} ${direction.name}: insufficient steady-state samples (${samples.length})`);
  const signed=samples.map(x=>x.forward*direction.forwardUnit+x.right*direction.rightUnit);
  const average=signed.reduce((a,b)=>a+b,0)/signed.length;
  const orthogonal=samples.reduce((a,x)=>a+Math.abs(-x.forward*direction.rightUnit+x.right*direction.forwardUnit),0)/samples.length;
  const vertical=samples.reduce((a,x)=>a+Math.abs(x.vertical),0)/samples.length;
  const yawFrameErrorDeg=samples.reduce((a,x)=>a+x.yawFrameErrorDeg,0)/samples.length;
  const yawFrameErrorAbsDeg=samples.reduce((a,x)=>a+Math.abs(x.yawFrameErrorDeg),0)/samples.length;
  const all=motion.filter(x=>x.time>=start&&x.time<=start+holdS+.15);
  const t90=all.find(x=>x.forward*direction.forwardUnit+x.right*direction.rightUnit>=targetMps*.90)?.time-start;
  const result={name:direction.name,average,orthogonal,vertical,yawFrameErrorDeg,yawFrameErrorAbsDeg,t90:Number.isFinite(t90)?t90:null};
  console.log(`GAME speed sample ${label} ${direction.name}: ${(average*3.6).toFixed(2)} km/h · cross ${orthogonal.toFixed(3)} m/s · physical-FC yaw ${yawFrameErrorDeg.toFixed(3)}° (|.| ${yawFrameErrorAbsDeg.toFixed(3)}°) · |vz| ${vertical.toFixed(3)} m/s · t90 ${result.t90}`);
  if(!(average>=minSteadyMps&&average<=maxSteadyMps))throw new Error(`${direction.name}: ${label} target did not converge; steady=${(average*3.6).toFixed(1)} km/h (${average.toFixed(2)} m/s), target=${(targetMps*3.6).toFixed(0)} km/h`);
  if(orthogonal>1.2)throw new Error(`${direction.name}: excessive cross-axis drift ${orthogonal.toFixed(2)} m/s at ${label}; physical-FC yaw=${yawFrameErrorDeg.toFixed(2)}°`);
  if(vertical>1.2)throw new Error(`${direction.name}: AGL destabilized, |vz| avg ${vertical.toFixed(2)} m/s at ${label}`);
  if(!(Number.isFinite(t90)&&t90<=t90LimitS))throw new Error(`${direction.name}: did not reach 90% of ${label} within ${t90LimitS.toFixed(1)} s; t90=${t90}`);
  await settle();
  return result;
}

try{
  await page.setViewport({width:844,height:390,deviceScaleFactor:1});
  await page.goto(url,{waitUntil:"load",timeout:30000});
  await page.waitForFunction(()=>document.querySelector("#status")?.textContent.includes("SIM ready"),{timeout:30000});
  await page.evaluate(()=>localStorage.setItem("arondight45PhoneControlSettingsV5",JSON.stringify({maxHorizontalSpeedKmh:36,defaultHoverAgl:2.0,leftFineness:1,rightFineness:10,invertRightVertical:true})));
  await page.click("#camSolo");
  await page.waitForFunction(()=>document.body.classList.contains("solo-flight"),{timeout:5000});
  await waitSim(2.2,60000);
  await page.waitForFunction(()=>document.querySelector("#fcState")?.textContent==="DISARMED",{timeout:5000});
  await page.waitForFunction(()=>document.querySelector("#soloRangeStatus")?.textContent?.includes("AGL"),{timeout:15000});
  await page.waitForFunction(()=>{const b=document.querySelector("#soloArm");return b&&!b.disabled&&b.textContent.trim()==="ARM";},{timeout:15000});
  await page.click("#soloArm");
  await page.waitForFunction(()=>document.querySelector("#fcState")?.textContent==="ARMED",{timeout:65000});
  await page.waitForFunction(()=>{const z=parseFloat(document.querySelector("#altitude")?.textContent||"0"),v=parseFloat(document.querySelector("#velocity")?.textContent||"99");return z>1.55&&z<2.45&&v<.7;},{timeout:90000});

  await setSpeed(36);
  const defaultResults=[];
  for(const direction of directions){
    defaultResults.push(await runDirection(direction,{label:"36 km/h",targetMps:10.0,minSteadyMps:9.5,maxSteadyMps:10.5,holdS:8.0,t90LimitS:5.0}));
  }
  const defaultSpeeds=defaultResults.map(x=>x.average),defaultSpread=Math.max(...defaultSpeeds)-Math.min(...defaultSpeeds);
  if(defaultSpread>0.75)throw new Error(`36 km/h directional steady-state asymmetry exceeds 1.0 m/s: ${JSON.stringify(defaultResults)}`);

  // The top of the user-visible slider is a real velocity target, not a cosmetic
  // scaling label. Prove the full shared 25 m/s / 90 km/h envelope in both signs
  // through the same WASM FC, motor mixer and rigid-body plant used by the app.
  await setSpeed(90);
  const maxResults=[];
  for(const direction of directions){
    maxResults.push(await runDirection(direction,{label:"90 km/h",targetMps:25.0,minSteadyMps:23.75,maxSteadyMps:26.25,holdS:12.0,t90LimitS:10.0}));
  }
  const maxSpeeds=maxResults.map(x=>x.average),maxSpread=Math.max(...maxSpeeds)-Math.min(...maxSpeeds);
  if(maxSpread>0.75)throw new Error(`90 km/h directional steady-state spread exceeds 0.75 m/s: ${JSON.stringify(maxResults)}`);

  if(errors.length)throw new Error(errors.join("\n"));
  console.log(`GAME speed envelope passed: default=${JSON.stringify(defaultResults)} · 36 km/h / 10.0 m/s spread ${(defaultSpread*3.6).toFixed(1)} km/h; max=${JSON.stringify(maxResults)} · 90 km/h / 25.0 m/s spread ${(maxSpread*3.6).toFixed(1)} km/h.`);
}finally{await browser.close();}
