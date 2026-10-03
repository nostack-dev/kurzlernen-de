import puppeteer from "puppeteer-core";
import {mkdir} from "node:fs/promises";

const input=process.argv[2]||"https://kurzlernen.de/drone_simulator.html",base=new URL(input),executablePath=process.env.CHROME_BIN;
if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");
const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader","--autoplay-policy=no-user-gesture-required"]});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function makePhone(label){const context=await browser.createBrowserContext(),page=await context.newPage(),url=new URL(base.href);url.searchParams.set("multiplayer-phone",label);await page.setUserAgent(`Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1 ${label}`);await page.setViewport({width:844,height:390,deviceScaleFactor:1,isMobile:true,hasTouch:true});await page.goto(url.href,{waitUntil:"load",timeout:45000});await page.waitForFunction(()=>document.querySelector("#status")?.textContent?.includes("SIM ready")&&globalThis.__arondightRealWorld&&document.querySelector("#mobileGameplayMultiplayer")&&document.querySelector("#lanVsButton"),{timeout:45000});const ui=await page.evaluate(()=>{const mobile=document.querySelector("#mobileGameplayMultiplayer"),source=document.querySelector("#lanVsButton"),topbar=document.querySelector("#soloTopbar"),v=document.querySelector("#viewport");return{mobileDisplay:getComputedStyle(mobile).display,sourceExists:Boolean(source),topbarDisplay:getComputedStyle(topbar).display,mobileUi:v?.dataset.mobileMultiplayerUi,state:v?.dataset.mobileMultiplayerState};});if(ui.mobileDisplay==="none"||!ui.sourceExists||ui.topbarDisplay!=="none"||ui.mobileUi!=="visible-v1")throw new Error(`${label} mobile multiplayer entry is not restored: ${JSON.stringify(ui)}`);return{context,page};}
async function snapshot(page){return page.evaluate(()=>{const b=globalThis.__arondightRealWorld,v=document.querySelector("#viewport"),button=document.querySelector("#mobileGameplayMultiplayer"),status=document.querySelector("#mobileGameplayMultiplayerStatus");let peerMeshes=0;b?.threeScene?.traverse?.(node=>{if(node.userData?.vsMultiplayerPeer&&node.visible!==false)peerMeshes++;});return{connected:Boolean(b?.vsConnected),starting:Boolean(b?.vsStarting),hasSession:Boolean(b?.vsSession),vsPlayers:Number(v?.dataset.vsPlayerCount)||0,vsPeers:Number(v?.dataset.vsPeerCount)||0,mobileState:v?.dataset.mobileMultiplayerState||"",mobilePlayers:Number(v?.dataset.mobileMultiplayerPlayers)||0,buttonText:button?.textContent?.trim()||"",buttonState:button?.dataset.state||"",statusText:status?.textContent?.trim()||"",statusDisplay:status?getComputedStyle(status).display:"none",peerMeshes};});}
async function waitConnected(page,label,timeout=40000){const end=Date.now()+timeout;let last=null;while(Date.now()<end){last=await snapshot(page);if(last.connected&&last.mobileState==="connected"&&last.mobilePlayers>=2&&last.vsPlayers>=2&&last.peerMeshes>=1&&last.buttonState==="connected"&&last.statusDisplay!=="none")return last;await pause(250);}throw new Error(`${label} did not reach connected two-player mobile state: ${JSON.stringify(last)}`);}

let a,b;
try{
  [a,b]=await Promise.all([makePhone("phone-a"),makePhone("phone-b")]);
  await Promise.all([a.page.click("#mobileGameplayMultiplayer"),b.page.click("#mobileGameplayMultiplayer")]);
  await pause(120);
  const finding=await Promise.all([snapshot(a.page),snapshot(b.page)]);
  if(finding.some(x=>!x.hasSession&&x.mobileState!=="finding"))throw new Error(`MULTI button did not enter the real VS discovery path: ${JSON.stringify(finding)}`);
  const [sa,sb]=await Promise.all([waitConnected(a.page,"phone-a"),waitConnected(b.page,"phone-b")]);
  if(!(sa.buttonText.includes("2P")&&sb.buttonText.includes("2P")&&sa.statusText.includes("P 2")&&sb.statusText.includes("P 2")))throw new Error(`connected mobile multiplayer status is incomplete: ${JSON.stringify({sa,sb})}`);
  await mkdir("artifacts",{recursive:true});
  await Promise.all([a.page.screenshot({path:"artifacts/mobile-multiplayer-a.png",captureBeyondViewport:false}),b.page.screenshot({path:"artifacts/mobile-multiplayer-b.png",captureBeyondViewport:false})]);
  await Promise.all([a.page.click("#mobileGameplayMultiplayer"),b.page.click("#mobileGameplayMultiplayer")]);
  await pause(300);
  const stopped=await Promise.all([snapshot(a.page),snapshot(b.page)]);
  if(stopped.some(x=>x.hasSession||x.connected||x.mobileState!=="offline"))throw new Error(`mobile multiplayer did not stop cleanly: ${JSON.stringify(stopped)}`);
  console.log(`Dual-mobile live multiplayer passed. ${JSON.stringify({phoneA:sa,phoneB:sb,stopped})}`);
}finally{
  await Promise.allSettled([a?.context?.close?.(),b?.context?.close?.()]);
  await browser.close();
}
