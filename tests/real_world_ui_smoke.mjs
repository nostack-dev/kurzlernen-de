import puppeteer from "puppeteer-core";

const base=process.argv[2]||"http://127.0.0.1:4174";
const executablePath=process.env.CHROME_BIN;
if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");
const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader"]});
const page=await browser.newPage(),external=[];
page.on("request",request=>{const u=new URL(request.url());if(!["127.0.0.1","localhost"].includes(u.hostname))external.push(request.url());});
try{
  await page.setViewport({width:844,height:390,deviceScaleFactor:1});
  await page.goto(`${base}/drone_simulator.html`,{waitUntil:"load",timeout:30000});
  await page.waitForFunction(()=>document.querySelector("#status")?.textContent.includes("SIM ready"),{timeout:30000});
  await page.evaluate(()=>localStorage.removeItem("arondight45GoogleTilesApiKeyV1"));
  await page.click("#camSolo");
  await page.waitForFunction(()=>document.body.classList.contains("solo-flight"),{timeout:5000});

  const entry=await page.evaluate(()=>{
    const button=document.querySelector("#soloWorld"),settings=document.querySelector("#soloTopbar .phone-settings-button");
    return{world:!!button,worldText:button?.textContent||"",worldVisible:!!button&&getComputedStyle(button).display!=="none",settings:!!settings};
  });
  if(!entry.world||!entry.worldVisible||entry.worldText!=="WORLD"||!entry.settings)throw new Error(`REAL WORLD solo entry missing: ${JSON.stringify(entry)}`);

  // With no key, WORLD must open the normal app settings instead of attempting network/GPS.
  await page.click("#soloWorld");
  await page.waitForFunction(()=>document.querySelector(".phone-settings-dialog")?.open,{timeout:5000});
  const config=await page.evaluate(()=>({
    section:!!document.querySelector('[data-world-settings="google-photorealistic-3d"]'),
    keyType:document.querySelector("[data-world-key]")?.type||"",
    keyValue:document.querySelector("[data-world-key]")?.value||"",
    use:document.querySelector("[data-world-use]")?.textContent?.trim()||"",
    training:document.querySelector("[data-world-training]")?.textContent?.trim()||"",
    forget:document.querySelector("[data-world-forget]")?.textContent?.trim()||"",
    note:document.querySelector('[data-world-settings="google-photorealistic-3d"]')?.textContent||"",
  }));
  if(!config.section||config.keyType!=="password"||config.keyValue!==""||config.use!=="USE MY GPS LOCATION"||config.training!=="TRAINING RANGE"||config.forget!=="FORGET KEY"||!config.note.includes("No backend, proxy or repository secret"))throw new Error(`REAL WORLD settings incomplete: ${JSON.stringify(config)}`);
  if(external.length)throw new Error(`no-key WORLD triggered external network: ${JSON.stringify(external)}`);

  const dummy="test-user-owned-google-key";
  await page.$eval("[data-world-key]",(input,value)=>{input.value=value;input.dispatchEvent(new Event("change",{bubbles:true}));},dummy);
  const stored=await page.evaluate(()=>({stored:localStorage.getItem("arondight45GoogleTilesApiKeyV1"),panel:document.querySelector("#googleTilesKey")?.value||""}));
  if(stored.stored!==dummy||stored.panel!==dummy)throw new Error(`API key was not kept device-local/synced: ${JSON.stringify(stored)}`);
  await page.click('.phone-settings-dialog [data-close]');

  // Exercise the real UI-to-bridge wiring without calling Google in CI. Only the bridge method is stubbed;
  // production bootstrap/geolocation/tile code remains untouched and is separately guarded by architecture tests.
  await page.evaluate(()=>{
    const bridge=globalThis.__arondightRealWorld;
    if(!bridge)throw new Error("real-world bridge missing");
    bridge.activate=async function(){globalThis.__worldActivateCalls=(globalThis.__worldActivateCalls||0)+1;this.loading=true;await Promise.resolve();this.loading=false;this.active=true;};
    bridge.deactivate=function(){globalThis.__worldDeactivateCalls=(globalThis.__worldDeactivateCalls||0)+1;this.active=false;this.loading=false;};
  });
  await page.click("#soloWorld");
  await page.waitForFunction(()=>document.querySelector("#soloWorld")?.dataset.active==="1",{timeout:5000});
  const activated=await page.evaluate(()=>({calls:globalThis.__worldActivateCalls||0,text:document.querySelector("#soloWorld")?.textContent||"",active:document.querySelector("#soloWorld")?.dataset.active||""}));
  if(activated.calls!==1||activated.text!=="WORLD ✓"||activated.active!=="1")throw new Error(`WORLD did not invoke geospatial bridge: ${JSON.stringify(activated)}`);
  await page.click("#soloWorld");
  const deactivated=await page.evaluate(()=>({calls:globalThis.__worldDeactivateCalls||0,text:document.querySelector("#soloWorld")?.textContent||"",active:document.querySelector("#soloWorld")?.dataset.active||""}));
  if(deactivated.calls!==1||deactivated.text!=="WORLD"||deactivated.active!=="0")throw new Error(`WORLD training fallback failed: ${JSON.stringify(deactivated)}`);

  await page.click("#soloTopbar .phone-settings-button");
  await page.waitForFunction(()=>document.querySelector(".phone-settings-dialog")?.open,{timeout:5000});
  await page.click("[data-world-forget]");
  const forgotten=await page.evaluate(()=>({stored:localStorage.getItem("arondight45GoogleTilesApiKeyV1"),settings:document.querySelector("[data-world-key]")?.value||"",panel:document.querySelector("#googleTilesKey")?.value||""}));
  if(forgotten.stored!==null||forgotten.settings!==""||forgotten.panel!=="")throw new Error(`FORGET KEY failed: ${JSON.stringify(forgotten)}`);
  if(external.length)throw new Error(`static-only UI smoke made external requests: ${JSON.stringify(external)}`);

  console.log("REAL WORLD solo UI + device-local key + bridge wiring smoke passed.");
}finally{await browser.close();}
