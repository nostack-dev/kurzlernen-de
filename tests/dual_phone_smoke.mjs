import puppeteer from "puppeteer-core";

const base = process.argv[2] || "http://127.0.0.1:4174";
const executablePath = process.env.CHROME_BIN;
if (!executablePath) throw new Error("CHROME_BIN must point to Chrome/Chromium");

const browser = await puppeteer.launch({
  headless: true,
  executablePath,
  args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader"],
});
const errors=[];
function watch(page,name){
  page.on("pageerror",error=>errors.push(`${name} pageerror: ${error.message}`));
  page.on("console",message=>{if(message.type()==="error")errors.push(`${name} console: ${message.text()}`);});
}
async function waitText(page,selector,needle,timeout=20000){await page.waitForFunction((sel,text)=>document.querySelector(sel)?.textContent?.includes(text),{timeout},selector,needle);}
async function simTime(page){return page.$eval("#simTime",el=>parseFloat(el.textContent||"0"));}
async function waitSim(page,target,timeout=60000){await page.waitForFunction(t=>parseFloat(document.querySelector("#simTime")?.textContent||"0")>=t,{timeout},target);}

const view=await browser.newPage(),controller=await browser.newPage();watch(view,"view");watch(controller,"controller");
try{
  await view.setViewport({width:844,height:390,deviceScaleFactor:1});
  await controller.setViewport({width:844,height:390,deviceScaleFactor:1});
  const room="E2ETEST";
  await Promise.all([
    view.goto(`${base}/drone_simulator.html?room=${room}`,{waitUntil:"load",timeout:30000}),
    controller.goto(`${base}/drone_controller.html?room=${room}`,{waitUntil:"load",timeout:30000}),
  ]);
  await waitText(view,"#status","SIM ready",30000);
  await waitText(view,"#remoteStatus","REMOTE LINKED",20000);
  await waitText(controller,"#connection","SIM LINKED",20000);

  const viewSource=await view.$eval("#inputSource",el=>el.value);
  if(viewSource!=="remote")throw new Error(`remote phone is not primary input: ${viewSource}`);

  await view.click("#run");
  await waitSim(view,2.2,60000);
  let state=await view.$eval("#fcState",el=>el.textContent||"");
  if(state!=="DISARMED")throw new Error(`dual-phone calibration failed: ${state}`);

  const armStart=await simTime(view);
  await controller.click("#arm");
  await waitSim(view,armStart+1.1,45000);
  state=await view.$eval("#fcState",el=>el.textContent||"");
  if(state!=="ARMED")throw new Error(`remote arming failed: ${state}`);
  await waitText(controller,"#fcState","ARMED",10000);

  const box=await controller.$eval("#leftStick",el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};});
  const cx=box.x+box.w/2,cy=box.y+box.h/2,r=Math.min(box.w,box.h)*.42;
  await controller.mouse.move(cx,cy+r*.5);
  await controller.mouse.down();
  await controller.mouse.up();
  const throttleStart=await simTime(view);
  await waitSim(view,throttleStart+.12,20000);
  const pulses=await view.$eval("#motors",el=>(el.textContent||"").trim().split(/\s+/).map(Number));
  if(!pulses.every(value=>Number.isFinite(value)&&value>1050))throw new Error(`remote throttle did not reach FC: ${pulses.join(" ")}`);
  await controller.waitForFunction(()=>{const text=document.querySelector("#motors")?.textContent||"";return text!=="—"&&text.split(/\s+/).some(v=>Number(v)>1050);},{timeout:10000});

  await controller.close();
  await new Promise(resolve=>setTimeout(resolve,700));
  await view.waitForFunction(()=>document.querySelector("#fcState")?.textContent==="DISARMED",{timeout:10000});
  const safePulses=await view.$eval("#motors",el=>(el.textContent||"").trim().split(/\s+/).map(Number));
  if(!safePulses.every(value=>value===1000))throw new Error(`controller-loss fail-safe did not stop motors: ${safePulses.join(" ")}`);
  const remoteStatus=await view.$eval("#remoteStatus",el=>el.textContent||"");
  if(!/waiting|fail-safe|stale/i.test(remoteStatus))throw new Error(`view did not report controller loss: ${remoteStatus}`);

  if(errors.length)throw new Error(errors.join("\n"));
  console.log("Dual-phone E2E passed: pair, arm, throttle, telemetry, controller-loss disarm.");
} finally {
  await browser.close();
}
