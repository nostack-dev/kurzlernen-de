import puppeteer from "puppeteer-core";
import {mkdir} from "node:fs/promises";

const input=process.argv[2]||"https://kurzlernen.de/drone_simulator.html",url=new URL(input),executablePath=process.env.CHROME_BIN;
if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");
const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader"]}),page=await browser.newPage();
await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1");
await page.setViewport({width:390,height:844,deviceScaleFactor:1,isMobile:true,hasTouch:true});
await page.evaluateOnNewDocument(()=>{try{localStorage.setItem("arondight45PlayerModeV2","drone");localStorage.setItem("arondight45FootWeaponV1","smg");}catch{}});
try{
  await page.goto(url.href,{waitUntil:"load",timeout:45000});
  await page.waitForFunction(()=>document.querySelector("#status")?.textContent?.includes("SIM ready")&&globalThis.__arondightWalkMode&&document.querySelector("#mobileGameplayDock"),{timeout:45000});
  await page.waitForFunction(()=>{const v=document.querySelector("#viewport");return v?.dataset.autoStartupContract==="foot-pistol-fresh-v1"&&v.dataset.playerMode==="foot"&&document.body.classList.contains("on-foot-mode")&&globalThis.__arondightFootWeapons?.mode==="glock"&&document.querySelector("#mobileGameplayMode")?.textContent.trim()==="ON FOOT";},{timeout:10000});
  const state=await page.evaluate(()=>{const v=document.querySelector("#viewport"),respawn=document.querySelector("#vsRespawnHud"),dock=[...document.querySelectorAll("#mobileGameplayDock button")].map(b=>b.textContent.trim());return{playerMode:v?.dataset.playerMode,cameraMode:v?.dataset.cameraMode,fpv:document.querySelector("#camFpv")?.dataset.active,auto:v?.dataset.autoFlightStart,startup:v?.dataset.autoStartupContract,startupMode:v?.dataset.autoStartupPlayerMode,deathReset:v?.dataset.autoStartupDeathReset,localDead:Boolean(globalThis.__arondightRealWorld?.vsLocalDead),respawnState:v?.dataset.vsRespawnState||"none",respawnVisible:respawn?getComputedStyle(respawn).display!=="none":false,onFoot:document.body.classList.contains("on-foot-mode"),weapon:globalThis.__arondightFootWeapons?.mode,dock,topbar:getComputedStyle(document.querySelector("#soloTopbar")).display};});
  if(state.playerMode!=="foot"||state.auto!=="foot"||state.startup!=="foot-pistol-fresh-v1"||state.startupMode!=="foot"||state.weapon!=="glock"||state.localDead||state.respawnState==="local"||state.respawnVisible||!state.onFoot)throw new Error(`mobile startup is not a fresh FOOT/PISTOL state: ${JSON.stringify(state)}`);
  if(state.dock.length!==3||state.dock[0]!=="ON FOOT"||!state.dock.includes("SETTINGS")||state.dock.some(x=>x==="MENU"||x==="START"))throw new Error(`startup HUD regressed: ${JSON.stringify(state)}`);
  await mkdir("artifacts",{recursive:true});await page.screenshot({path:"artifacts/mobile-startup.png",captureBeyondViewport:false});
  console.log(`Mobile startup regression passed. ${JSON.stringify(state)}`);
}finally{await browser.close();}
