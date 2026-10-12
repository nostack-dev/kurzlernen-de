import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";
import {mkdir} from "node:fs/promises";

const url=process.argv[2]||"https://kurzlernen.de/drone_simulator.html";
if(!process.env.CHROME_BIN)throw Error("CHROME_BIN required");
const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_BIN,
  args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist",
    "--use-gl=angle","--use-angle=swiftshader",
    "--use-fake-ui-for-media-stream","--use-fake-device-for-media-stream"]});
try{
 const page=await browser.newPage();
 await page.setViewport({width:1280,height:720,deviceScaleFactor:1});
 await page.goto(url,{waitUntil:"load",timeout:45000});
 await page.waitForFunction(()=>{
   const b=document.body,bar=document.querySelector("#proximityVoiceBar"),ptt=document.querySelector("#proximityVoicePtt");
   return document.querySelector("#status")?.textContent?.includes("SIM ready")
     &&b.classList.contains("solo-flight")&&b.classList.contains("desktop-input")
     &&bar&&!bar.hidden&&getComputedStyle(bar).display!=="none"
     &&ptt?.getBoundingClientRect().width>=100&&globalThis.__arondightVoiceControls;
 },{timeout:90000});
 const info=await page.evaluate(()=>{
   const p=document.querySelector("#proximityVoicePtt"),m=document.querySelector("#proximityVoiceMute"),
     rect=p.getBoundingClientRect();
   return {pttWidth:rect.width,pttHint:getComputedStyle(p,"::after").content,
     muteHint:getComputedStyle(m,"::after").content,oldVIsFoot:document.body.classList.contains("desktop-input"),
     publicSession:!!globalThis.__arondightRealWorld?.vsSession};
 });
 assert.equal(info.publicSession,false,"Desktop SOLO must never start public lobby");
 assert.match(info.pttHint,/H/);assert.match(info.muteHint,/K/);
 assert.ok(info.pttWidth>=100,"Desktop mouse voice target should be large");
 // Keyboard: H toggles mic, K toggles receiving; no hold required.
 await page.keyboard.press("h");
 await page.waitForFunction(()=>document.querySelector("#proximityVoicePtt")?.getAttribute("aria-pressed")==="true",{timeout:10000});
 await page.keyboard.press("h");
 await page.waitForFunction(()=>document.querySelector("#proximityVoicePtt")?.getAttribute("aria-pressed")==="false",{timeout:10000});
 await page.keyboard.press("k");
 assert.equal(await page.$eval("#proximityVoiceMute",e=>e.getAttribute("aria-pressed")),"true");
 await page.keyboard.press("k");
 assert.equal(await page.$eval("#proximityVoiceMute",e=>e.getAttribute("aria-pressed")),"false");
 // Mouse: one click opens mic, remains on after release, second click closes it.
 const r=await (await page.$("#proximityVoicePtt")).boundingBox();
 assert.ok(r&&r.width>=100);
 await page.mouse.click(r.x+r.width/2,r.y+r.height/2);
 await page.waitForFunction(()=>document.querySelector("#proximityVoicePtt")?.getAttribute("aria-pressed")==="true",{timeout:10000});
 assert.equal(await page.evaluate(()=>globalThis.__arondightVoiceControls?.micOn),true);
 await page.mouse.click(r.x+r.width/2,r.y+r.height/2);
 await page.waitForFunction(()=>document.querySelector("#proximityVoicePtt")?.getAttribute("aria-pressed")==="false",{timeout:10000});
 // Xbox: the application's one pad-actions loop must own R3 & R3+Y.
 await page.evaluate(()=>{
   const pad={connected:true,mapping:"standard",id:"Xbox Controller test",
     index:0,buttons:Array.from({length:17},()=>({pressed:false,value:0})),axes:[0,0,0,0]};
   Object.defineProperty(navigator,"getGamepads",{configurable:true,value:()=>[pad]});
   globalThis.__voiceTestPad=pad;
 });
 const set=async(i,pressed)=>page.evaluate(([index,value])=>{
   const button=globalThis.__voiceTestPad.buttons[index];button.pressed=value;button.value=value?1:0;
 },[i,pressed]);
 const weaponBefore=await page.evaluate(()=>String(globalThis.__arondightDroneWeapons?.mode??globalThis.__arondightFootWeapons?.mode??""));
 await set(11,true); // R3 down
 await page.waitForFunction(()=>document.querySelector("#viewport")?.dataset.voicePadR3==="1",{timeout:8000});
 await set(11,false); // tap RELEASE toggles mic
 await page.waitForFunction(()=>document.querySelector("#proximityVoicePtt")?.getAttribute("aria-pressed")==="true",{timeout:12000});
 await set(11,true);
 await page.waitForFunction(()=>document.querySelector("#viewport")?.dataset.voicePadR3==="1",{timeout:8000});
 await set(3,true);  // Y while R3: mute, not weapon swap
 await page.waitForFunction(()=>document.querySelector("#proximityVoiceMute")?.getAttribute("aria-pressed")==="true",{timeout:12000});
 assert.equal(await page.$eval("#proximityVoicePtt",e=>e.getAttribute("aria-pressed")),"false","Mute chord must end PTT");
 assert.equal(await page.evaluate(()=>String(globalThis.__arondightDroneWeapons?.mode??globalThis.__arondightFootWeapons?.mode??"")),weaponBefore,"R3+Y must NOT switch weapon");
 await set(3,false);await set(11,false);
 await page.waitForFunction(()=>{
   const d=document.querySelector("#viewport")?.dataset;
   return d?.voicePadR3==="0"&&d?.voicePadY==="0"&&d?.voicePadChord==="0";
 },{timeout:5000});
 assert.equal(await page.$eval("#proximityVoicePtt",e=>e.getAttribute("aria-pressed")),"false");
 // A genuinely observed release frame resets the latch; a new chord unmutes.
 await set(11,true);
 await page.waitForFunction(()=>document.querySelector("#viewport")?.dataset.voicePadR3==="1",{timeout:5000});
 await set(3,true);
 await page.waitForFunction(()=>document.querySelector("#proximityVoiceMute")?.getAttribute("aria-pressed")==="false",{timeout:12000});
 await set(3,false);await set(11,false);
 await page.waitForFunction(()=>{
   const d=document.querySelector("#viewport")?.dataset;
   return d?.voicePadR3==="0"&&d?.voicePadY==="0"&&d?.voicePadChord==="0";
 },{timeout:5000});
 await mkdir("artifacts",{recursive:true});
 await page.screenshot({path:"artifacts/desktop-voice-keyboard-xbox.png"});
 console.log("Desktop voice PASSED: clickable labeled controls, H mic-toggle, K speaker mute, R3 mic-toggle, R3+Y speaker mute, no SOLO advertising",JSON.stringify(info));
}finally{await browser.close();}
