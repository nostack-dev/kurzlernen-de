import puppeteer from "puppeteer-core";

const base=process.argv[2]||"http://127.0.0.1:4174";
const executablePath=process.env.CHROME_BIN;
if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");
const args=["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader","--use-fake-ui-for-media-stream","--use-fake-device-for-media-stream"];
const viewBrowser=await puppeteer.launch({headless:true,executablePath,args,protocolTimeout:120000});
const controllerBrowser=await puppeteer.launch({headless:true,executablePath,args,protocolTimeout:120000});
const errors=[];
function watch(page,name){page.on("pageerror",error=>errors.push(`${name} pageerror: ${error.message}`));page.on("console",message=>{if(message.type()==="error")errors.push(`${name} console: ${message.text()}`);});}
async function waitText(page,selector,needle,timeout=30000){await page.waitForFunction((sel,text)=>document.querySelector(sel)?.textContent?.includes(text),{timeout},selector,needle);}
async function setValue(page,selector,value){await page.$eval(selector,(element,text)=>{element.value=text;element.dispatchEvent(new Event("input",{bubbles:true}));},value);}
async function simTime(page){return page.$eval("#simTime",element=>parseFloat(element.textContent||"0"));}
async function waitSim(page,target,timeout=60000){await page.waitForFunction(value=>parseFloat(document.querySelector("#simTime")?.textContent||"0")>=value,{timeout},target);}
async function snapshot(page){return page.evaluate(()=>({simTime:document.querySelector("#simTime")?.textContent||"",state:document.querySelector("#fcState")?.textContent||"",remote:document.querySelector("#remoteStatus")?.textContent||"",motors:document.querySelector("#motors")?.textContent||""}));}

const view=await viewBrowser.newPage(),controller=await controllerBrowser.newPage();watch(view,"view");watch(controller,"controller");
try{
  await view.setViewport({width:844,height:390,deviceScaleFactor:1});await controller.setViewport({width:844,height:390,deviceScaleFactor:1});
  await Promise.all([view.goto(`${base}/drone_simulator.html`,{waitUntil:"load",timeout:30000}),controller.goto(`${base}/drone_controller.html`,{waitUntil:"load",timeout:30000})]);
  await waitText(view,"#status","SIM ready",30000);
  if(await view.$eval("#inputSource",element=>element.value)!=="remote")throw new Error("remote phone is not primary input");

  // Production UX is QR/camera. CI additionally transfers the exact payload via
  // the hidden manual fallback so the handshake is deterministic without a
  // physical camera pointed at another CI screen. Both generated QR surfaces
  // must exist and contain the same SDP payload path used by the real phones.
  await controller.click("#connect");
  await controller.waitForFunction(()=>document.querySelector("#offerCode")?.value?.length>100,{timeout:20000});
  await controller.waitForFunction(()=>document.querySelector("#offerQr")?.src?.startsWith("data:image"),{timeout:20000});
  const offer=await controller.$eval("#offerCode",element=>element.value);
  await view.click("#remoteConnect");
  await setValue(view,"#remoteOffer",offer);
  await view.click("#acceptOffer");
  await view.waitForFunction(()=>document.querySelector("#remoteAnswer")?.value?.length>100,{timeout:20000});
  await view.waitForFunction(()=>document.querySelector("#answerQr")?.src?.startsWith("data:image"),{timeout:20000});
  const answer=await view.$eval("#remoteAnswer",element=>element.value);
  await setValue(controller,"#answerCode",answer);
  await controller.click("#applyAnswer");
  await waitText(view,"#remoteStatus","P2P LINKED",30000);
  await waitText(controller,"#connection","P2P LINKED",30000);
  console.log("Serverless P2P E2E: QR payloads generated and two independent browser processes paired.");

  // Remote pairing must auto-start SIM; there is no extra Start click.
  await waitSim(view,0.05,15000);
  await waitSim(view,2.2,60000);
  let state=await view.$eval("#fcState",element=>element.textContent||"");
  if(state!=="DISARMED")throw new Error(`calibration failed: ${JSON.stringify(await snapshot(view))}`);
  await controller.waitForFunction(()=>{const b=document.querySelector("#arm");return b&&!b.disabled&&b.textContent.trim()==="ARM";},{timeout:15000});

  const armStart=await simTime(view);await controller.click("#arm");await waitSim(view,armStart+1.1,45000);
  state=await view.$eval("#fcState",element=>element.textContent||"");
  if(state!=="ARMED")throw new Error(`remote arming failed: ${JSON.stringify(await snapshot(view))}`);
  await waitText(controller,"#arm","ARMED ✓",10000);

  const box=await controller.$eval("#leftStick",element=>{const r=element.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};});
  const cx=box.x+box.w/2,cy=box.y+box.h/2,r=Math.min(box.w,box.h)*.42;
  await controller.mouse.move(cx,cy+r*.5);await controller.mouse.down();await controller.mouse.up();
  const throttleStart=await simTime(view);await waitSim(view,throttleStart+.12,20000);
  const pulses=await view.$eval("#motors",element=>(element.textContent||"").trim().split(/\s+/).map(Number));
  if(!pulses.every(value=>Number.isFinite(value)&&value>1050))throw new Error(`remote throttle did not reach FC: ${pulses.join(" ")}`);
  await controller.waitForFunction(()=>{const text=document.querySelector("#motors")?.textContent||"";return text!=="—"&&text.split(/\s+/).some(value=>Number(value)>1050);},{timeout:10000});
  console.log("Serverless P2P E2E: truthful ARM state, throttle and return telemetry crossed direct DataChannel.");

  // Stall the controller JS for longer than the 350 ms freshness window while
  // keeping both pages and the WebRTC peer alive. VIEW must fail-safe, then the
  // very same session must resume control without any offer/answer exchange.
  const stall=controller.evaluate(()=>{const end=performance.now()+900;while(performance.now()<end){}return true;});
  await new Promise(resolve=>setTimeout(resolve,500));
  await view.waitForFunction(()=>document.querySelector("#fcState")?.textContent==="DISARMED",{timeout:10000});
  await stall;
  await waitText(view,"#remoteStatus","P2P LINKED",10000);
  await controller.click("#kill");
  await controller.waitForFunction(()=>{const b=document.querySelector("#arm");return b&&!b.disabled&&b.textContent.trim()==="ARM";},{timeout:10000});
  const rearmStart=await simTime(view);await controller.click("#arm");await waitSim(view,rearmStart+1.1,45000);
  state=await view.$eval("#fcState",element=>element.textContent||"");
  if(state!=="ARMED")throw new Error(`same-session re-arm failed after transient loss: ${JSON.stringify(await snapshot(view))}`);
  console.log("Serverless P2P E2E: transient stale-control fail-safe recovered on the same session with zero re-pairing.");

  // Kill the controller browser process without a cooperative disconnect. VIEW
  // must fail safe from freshness alone even before ICE notices the dead peer.
  await controllerBrowser.close();await new Promise(resolve=>setTimeout(resolve,800));
  await view.waitForFunction(()=>document.querySelector("#fcState")?.textContent==="DISARMED",{timeout:10000});
  const safe=await view.$eval("#motors",element=>(element.textContent||"").trim().split(/\s+/).map(Number));
  if(!safe.every(value=>value===1000))throw new Error(`controller-loss fail-safe did not stop motors: ${safe.join(" ")}`);
  const status=await view.$eval("#remoteStatus",element=>element.textContent||"");
  if(!/fail-safe|stale|reconnect|disconnected/i.test(status))throw new Error(`controller loss not surfaced: ${status}`);

  if(errors.length)throw new Error(errors.join("\n"));
  console.log("Serverless dual-phone E2E passed: QR UX, autorun, arm gate, control, telemetry, session recovery, hard-loss disarm.");
}finally{try{await controllerBrowser.close();}catch{}try{await viewBrowser.close();}catch{}}
