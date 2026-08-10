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

async function simTime(){return page.evaluate(()=>Number(globalThis.__arondightDiagnostics?.simTime)||0);}
async function waitSim(target,timeout=90000){await page.waitForFunction(t=>Number(globalThis.__arondightDiagnostics?.simTime)>=t,{timeout},target);}
async function flightSamples(){return page.evaluate(async()=>{const original=URL.createObjectURL;let captured=null;URL.createObjectURL=blob=>{captured=blob;return original.call(URL,blob);};try{document.querySelector("#exportLog")?.click();await new Promise(resolve=>setTimeout(resolve,0));if(!captured)throw new Error("flight log blob was not captured");const log=JSON.parse(await captured.text());return log?.samples||[];}finally{URL.createObjectURL=original;}});}
function bodyMotion(sample){const yaw=(Number(sample.yaw_deg)||0)*Math.PI/180,c=Math.cos(yaw),s=Math.sin(yaw),vx=Number(sample.vx)||0,vy=Number(sample.vy)||0,vz=Number(sample.vz)||0;return{time:Number(sample.time_s)||0,forward:-c*vx-s*vy,right:-s*vx+c*vy,horizontal:Math.hypot(vx,vy),vertical:vz};}
async function stick(){const r=await page.$eval("#soloLeft",e=>{const b=e.getBoundingClientRect();return{x:b.left+b.width/2,y:b.top+b.height/2,r:Math.min(b.width,b.height)*.42};});return r;}
async function settle(){await page.waitForFunction(()=>parseFloat(document.querySelector("#velocity")?.textContent||"99")<.85,{timeout:90000});}

const TARGET_MPS=10.0;
const MIN_STEADY_MPS=8.7;
const MAX_STEADY_MPS=10.9;
const HOLD_S=7.0;
const directions=[
  {name:"forward",dx:0,dy:-1,axis:"forward",sign:1},
  {name:"backward",dx:0,dy:1,axis:"forward",sign:-1},
  {name:"right",dx:1,dy:0,axis:"right",sign:1},
  {name:"left",dx:-1,dy:0,axis:"right",sign:-1},
];

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

  const results=[];
  for(const direction of directions){
    await settle();
    const g=await stick();
    await page.mouse.move(g.x,g.y);await page.mouse.down();await page.mouse.move(g.x+g.r*direction.dx,g.y+g.r*direction.dy,{steps:8});
    const start=await simTime();await waitSim(start+HOLD_S,120000);await page.mouse.up();
    const samples=(await flightSamples()).map(bodyMotion).filter(x=>x.time>=start+HOLD_S-1.0&&x.time<=start+HOLD_S+.15);
    if(samples.length<20)throw new Error(`${direction.name}: insufficient steady-state samples (${samples.length})`);
    const signed=samples.map(x=>direction.sign*x[direction.axis]);
    const average=signed.reduce((a,b)=>a+b,0)/signed.length;
    const orthogonal=samples.reduce((a,x)=>a+Math.abs(direction.axis==="forward"?x.right:x.forward),0)/samples.length;
    const vertical=samples.reduce((a,x)=>a+Math.abs(x.vertical),0)/samples.length;
    const all=(await flightSamples()).map(bodyMotion).filter(x=>x.time>=start&&x.time<=start+HOLD_S+.15);
    const t90=all.find(x=>direction.sign*x[direction.axis]>=TARGET_MPS*.90)?.time-start;
    results.push({name:direction.name,average,orthogonal,vertical,t90:Number.isFinite(t90)?t90:null});
    if(!(average>=MIN_STEADY_MPS&&average<=MAX_STEADY_MPS))throw new Error(`${direction.name}: 36 km/h target did not converge; steady=${(average*3.6).toFixed(1)} km/h (${average.toFixed(2)} m/s)`);
    if(orthogonal>1.2)throw new Error(`${direction.name}: excessive cross-axis drift ${orthogonal.toFixed(2)} m/s`);
    if(vertical>1.2)throw new Error(`${direction.name}: AGL destabilized, |vz| avg ${vertical.toFixed(2)} m/s`);
    if(!(Number.isFinite(t90)&&t90<=5.0))throw new Error(`${direction.name}: did not reach 90% of 36 km/h within 5.0 s; t90=${t90}`);
    await settle();
  }

  const speeds=results.map(x=>x.average),spread=Math.max(...speeds)-Math.min(...speeds);
  if(spread>1.0)throw new Error(`directional steady-state asymmetry exceeds 1.0 m/s: ${JSON.stringify(results)}`);
  if(errors.length)throw new Error(errors.join("\n"));
  console.log(`GAME speed envelope passed: ${JSON.stringify(results)} · target 36 km/h / 10.0 m/s · spread ${(spread*3.6).toFixed(1)} km/h.`);
}finally{await browser.close();}
