import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";

const url=process.argv[2]||"https://kurzlernen.de/drone_simulator.html";
const browser=await puppeteer.launch({
  headless:true,executablePath:process.env.CHROME_BIN,
  args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl",
    "--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader",
    "--use-fake-ui-for-media-stream","--use-fake-device-for-media-stream"]
});
try{
  const page=await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1");
  await page.setViewport({width:844,height:390,deviceScaleFactor:1,isMobile:true,hasTouch:true});
  await page.goto(url,{waitUntil:"load",timeout:45000});
  await page.waitForFunction(()=>{
    const bar=document.querySelector("#proximityVoiceBar"),b=document.body;
    return document.querySelector("#status")?.textContent?.includes("SIM ready")&&
      b.classList.contains("solo-flight")&&bar&&!bar.hidden&&
      getComputedStyle(bar).display!=="none"&&
      document.querySelector("#mobileGameplayMultiplayer")&&
      getComputedStyle(document.querySelector("#proximityVoicePtt")).display!=="none";
  },{timeout:90000});
  const initial=await page.evaluate(()=>{
    const bar=document.querySelector("#proximityVoiceBar"),m=document.querySelector("#proximityVoiceMute");
    return{visible:!bar.hidden,solo:document.body.classList.contains("solo-flight"),
      finder:!!globalThis.__arondightRealWorld?.vsSession,
      mute:m.getAttribute("aria-pressed"),
      status:document.querySelector("#proximityVoiceStatus")?.textContent};
  });
  assert.equal(initial.finder,false,"SOLO must not advertise in public lobby");
  assert.equal(initial.mute,"false","Voice must start unmuted");
  const button=await page.$("#proximityVoicePtt");
  const rect=await button.boundingBox();
  assert.ok(rect&&rect.width>20&&rect.height>20,"PTT should be touch-reachable");
  await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);
  await page.mouse.down();
  await page.waitForFunction(()=>/PTT · kein Mitspieler verbunden|SPRICHT · PTT/.test(
    document.querySelector("#proximityVoiceStatus")?.textContent||""),{timeout:15000});
  const talking=await page.evaluate(()=>({
    status:document.querySelector("#proximityVoiceStatus")?.textContent,
    pressed:document.querySelector("#proximityVoicePtt")?.getAttribute("aria-pressed"),
    noAdvertising:!globalThis.__arondightRealWorld?.vsSession
  }));
  assert.equal(talking.pressed,"true");
  assert.equal(talking.noAdvertising,true);
  await page.mouse.up();
  await page.waitForFunction(()=>document.querySelector("#proximityVoicePtt")?.getAttribute("aria-pressed")==="false");
  await page.click("#proximityVoiceMute");
  assert.equal(await page.$eval("#proximityVoiceMute",e=>e.getAttribute("aria-pressed")),"true");
  await page.evaluate(()=>dispatchEvent(new Event("arondight:world-reset")));
  assert.equal(await page.$eval("#proximityVoiceMute",e=>e.getAttribute("aria-pressed")),"true","World reset must preserve explicit mute choice");
  await page.click("#proximityVoiceMute");
  assert.equal(await page.$eval("#proximityVoiceMute",e=>e.getAttribute("aria-pressed")),"false");
  console.log("SOLO always-visible voice: PTT captured without public matchmaking; release, mute and reset behavior passed",JSON.stringify({initial,talking}));
}finally{await browser.close();}
