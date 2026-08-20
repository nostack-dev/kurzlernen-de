import puppeteer from "puppeteer-core";

const base=process.argv[2]||"http://127.0.0.1:4174";
const baseOrigin=new URL(base).origin;
const cacheTag=process.env.GITHUB_SHA?`?ci=${encodeURIComponent(process.env.GITHUB_SHA)}`:"";
const executablePath=process.env.CHROME_BIN;
if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");

const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader"]});
const page=await browser.newPage();

await page.evaluateOnNewDocument(()=>{
  const state={connected:true,exposed:false,axes:[0,0,0,0],values:Array(17).fill(0)};
  const pad={id:"Xbox Wireless Controller (Vendor: 045e Product: 0b13)",index:0,mapping:"standard",timestamp:0,
    get connected(){return state.connected;},
    get axes(){return state.axes;},
    get buttons(){return state.values.map(value=>({pressed:value>.5,touched:value>0,value}));}
  };
  Object.defineProperty(navigator,"getGamepads",{configurable:true,value:()=>state.connected&&state.exposed?[pad]:[]});
  globalThis.__xboxTest={
    setButton(index,value){state.values[index]=Math.max(0,Math.min(1,Number(value)||0));},
    setAxis(index,value){state.axes[index]=Math.max(-1,Math.min(1,Number(value)||0));},
    reset(){state.axes.fill(0);state.values.fill(0);},
    expose(){state.exposed=true;const event=new Event("gamepadconnected");Object.defineProperty(event,"gamepad",{value:pad});dispatchEvent(event);},
    disconnect(){state.connected=false;const event=new Event("gamepaddisconnected");Object.defineProperty(event,"gamepad",{value:pad});dispatchEvent(event);},
  };
});

const pause=ms=>page.evaluate(delay=>new Promise(resolve=>setTimeout(resolve,delay)),ms);
const setButton=(index,value)=>page.evaluate((i,v)=>globalThis.__xboxTest.setButton(i,v),index,value);
const setAxis=(index,value)=>page.evaluate((i,v)=>globalThis.__xboxTest.setAxis(i,v),index,value);

try{
  await page.setViewport({width:844,height:390,deviceScaleFactor:1});
  await page.goto(`${baseOrigin}/drone_simulator.html${cacheTag}`,{waitUntil:"load",timeout:30000});
  await page.waitForFunction(()=>document.querySelector("#status")?.textContent?.includes("SIM ready"),{timeout:30000});
  await page.waitForFunction(()=>{const v=document.querySelector("#viewport");return document.body.classList.contains("solo-flight")&&v?.dataset.controlSource==="touch"&&v.dataset.gamepadEnabled==="0"&&v.dataset.playerMode==="drone";},{timeout:7000});

  const initial=await page.evaluate(()=>({mode:document.querySelector("#viewport")?.dataset.playerMode,scheme:document.querySelector("#viewport")?.dataset.xboxControlScheme,cross:getComputedStyle(document.querySelector(".xbox-crosshair")).display,worldExperience:document.querySelector("#viewport")?.dataset.worldExperience,life:document.querySelector("#viewport")?.dataset.worldExperienceLifeLayer}));
  if(initial.mode!=="drone"||initial.scheme!=="classic"||initial.cross!=="none"||initial.worldExperience!=="1"||initial.life!=="instanced")throw new Error(`new Xbox/world defaults failed: ${JSON.stringify(initial)}`);

  await page.evaluate(()=>globalThis.__xboxTest.expose());
  await page.waitForFunction(()=>document.querySelector("#soloGamepadStatus")?.textContent?.includes("XBOX DETECTED"),{timeout:3000});
  await page.click("#soloTopbar .phone-settings-button");await page.waitForFunction(()=>document.querySelector(".phone-settings-dialog")?.open&&document.querySelector('[data-xbox-scheme]')&&document.querySelector('[data-location-preset]'),{timeout:4000});
  const settingsDefaults=await page.evaluate(()=>({enabled:document.querySelector('[data-xbox-controller]')?.checked,scheme:document.querySelector('[data-xbox-scheme]')?.value,start:document.querySelector('[data-start-mode]')?.value,imagery:document.querySelector('[data-world-imagery]')?.checked,locations:[...document.querySelectorAll('[data-location-preset] option')].map(x=>x.value)}));
  if(settingsDefaults.enabled!==false||settingsDefaults.scheme!=="classic"||settingsDefaults.start!=="foot"||settingsDefaults.imagery!==false||!settingsDefaults.locations.includes("new-york")||!settingsDefaults.locations.includes("custom")||!settingsDefaults.locations.includes("gps"))throw new Error(`settings defaults/global location picker failed: ${JSON.stringify(settingsDefaults)}`);
  await page.click('.phone-settings-dialog [data-xbox-controller]');await page.click('.phone-settings-dialog [data-close]');
  await page.waitForFunction(()=>{const v=document.querySelector("#viewport");return v?.dataset.controlSource==="xbox"&&v.dataset.gamepadEnabled==="1"&&v.dataset.gamepadConnected==="1";},{timeout:3000});

  // Classic flight: right stick always remains flight steering. LB must not steal it
  // and the center crosshair must stay completely absent.
  await setAxis(2,.82);await setAxis(3,-.68);await setButton(4,1);await pause(180);
  const classic=await page.evaluate(()=>{const v=document.querySelector("#viewport"),cross=document.querySelector(".xbox-crosshair");return{scheme:v.dataset.xboxControlScheme,aim:v.dataset.gamepadAim,right:v.dataset.gamepadRight,cross:getComputedStyle(cross).display,help:document.querySelector("#soloGamepadHelp")?.textContent||""};});
  if(classic.scheme!=="classic"||classic.aim!=="0"||!classic.right?.includes("0.791")||classic.cross!=="none"||!classic.help.includes("CLASSIC")||!classic.help.includes("Y RESET")||!classic.help.includes("VIEW EXIT"))throw new Error(`classic direct-RS flight regressed: ${JSON.stringify(classic)}`);
  await setButton(4,0);await setAxis(2,0);await setAxis(3,0);

  // RB remains independent center fire without showing a permanent crosshair.
  const fireBaseline=await page.$eval("#viewport",v=>Number(v.dataset.fireShots||0));await setButton(5,1);
  await page.waitForFunction(before=>{const v=document.querySelector("#viewport");return v?.dataset.gamepadFire==="1"&&Number(v.dataset.fireShots||0)>before;},{timeout:4000},fireBaseline);await pause(120);
  const classicFire=await page.evaluate(()=>({shots:Number(document.querySelector("#viewport")?.dataset.fireShots||0),cross:getComputedStyle(document.querySelector(".xbox-crosshair")).display}));
  if(classicFire.shots<=fireBaseline||classicFire.cross!=="none")throw new Error(`classic RB fire/crosshair contract failed: ${JSON.stringify(classicFire)}`);await setButton(5,0);

  // Opt into AIM and prove that the crosshair appears only while LB is held.
  await page.click("#soloTopbar .phone-settings-button");await page.waitForFunction(()=>document.querySelector(".phone-settings-dialog")?.open,{timeout:3000});await page.select('[data-xbox-scheme]',"aim");await page.click('.phone-settings-dialog [data-close]');
  await page.waitForFunction(()=>document.querySelector("#viewport")?.dataset.xboxControlScheme==="aim",{timeout:3000});
  await setButton(4,1);await setAxis(2,.82);await setAxis(3,-.68);
  await page.waitForFunction(()=>{const v=document.querySelector("#viewport");return v?.dataset.gamepadAim==="1"&&v.dataset.xboxAimCrosshair==="1"&&getComputedStyle(document.querySelector(".xbox-crosshair")).display!=="none";},{timeout:4000});
  const aim=await page.evaluate(()=>({aim:document.querySelector("#viewport")?.dataset.gamepadAim,cross:getComputedStyle(document.querySelector(".xbox-crosshair")).display,yaw:Number(document.querySelector("#viewport")?.dataset.worldLookYaw||0),pitch:Number(document.querySelector("#viewport")?.dataset.worldLookPitch||0)}));
  if(aim.aim!=="1"||aim.cross==="none"||Math.abs(aim.yaw)<=1||Math.abs(aim.pitch)<=1)throw new Error(`optional Xbox aim failed: ${JSON.stringify(aim)}`);
  await setButton(4,0);await setAxis(2,0);await setAxis(3,0);await page.waitForFunction(()=>document.querySelector("#viewport")?.dataset.xboxAimCrosshair==="0"&&getComputedStyle(document.querySelector(".xbox-crosshair")).display==="none",{timeout:3000});

  // Triggers are altitude only.
  await setButton(6,.85);await page.waitForFunction(()=>Number(document.querySelector("#viewport")?.dataset.gamepadHeightAxis)<-.80,{timeout:3000});await setButton(6,0);await setButton(7,.85);await page.waitForFunction(()=>Number(document.querySelector("#viewport")?.dataset.gamepadHeightAxis)>.80,{timeout:3000});await setButton(7,0);

  // On-foot mode owns the raw pad. Y switches back to drone without accidentally
  // firing the legacy global Y-reset edge on the same press.
  const resetBefore=await page.$eval("#viewport",v=>Number(v.dataset.gamepadResetCount||0));await page.click("#playerModeButton");await page.waitForFunction(()=>document.body.classList.contains("on-foot-mode")&&document.querySelector("#viewport")?.dataset.playerMode==="foot",{timeout:3000});
  const foot=await page.evaluate(()=>({hud:getComputedStyle(document.querySelector("#footHud")).display,mode:document.querySelector("#playerModeButton")?.textContent,people:Number(document.querySelector("#viewport")?.dataset.worldExperiencePeople||0),buses:Number(document.querySelector("#viewport")?.dataset.worldExperienceBuses||0),birds:Number(document.querySelector("#viewport")?.dataset.worldExperienceBirds||0)}));
  if(foot.hud==="none"||!foot.mode.includes("WALK")||foot.people<8||foot.buses<2||foot.birds<8)throw new Error(`on-foot/living-world layer failed: ${JSON.stringify(foot)}`);
  await setButton(3,1);await page.waitForFunction(()=>document.querySelector("#viewport")?.dataset.playerMode==="drone",{timeout:3000});await setButton(3,0);await pause(100);const resetAfterFoot=await page.$eval("#viewport",v=>Number(v.dataset.gamepadResetCount||0));if(resetAfterFoot!==resetBefore)throw new Error(`foot-mode Y leaked into drone RESET: ${resetBefore} -> ${resetAfterFoot}`);

  // Back in drone mode Y and VIEW retain the proven recovery mappings.
  await setButton(3,1);await page.waitForFunction(before=>Number(document.querySelector("#viewport")?.dataset.gamepadResetCount||0)>before,{timeout:3000},resetAfterFoot);await setButton(3,0);
  await setButton(9,1);await page.waitForFunction(()=>document.querySelector(".phone-settings-dialog")?.open,{timeout:3000});await setButton(9,0);await setButton(1,1);await page.waitForFunction(()=>!document.querySelector(".phone-settings-dialog")?.open,{timeout:3000});await setButton(1,0);
  await setButton(8,1);await page.waitForFunction(()=>!document.body.classList.contains("solo-flight")&&Number(document.querySelector("#viewport")?.dataset.gamepadExitCount||0)>=1,{timeout:4000});await setButton(8,0);

  console.log("Xbox/world browser E2E passed: classic direct RS default, opt-in LB aim with aim-only crosshair, altitude triggers, on-foot mode, living-world instances and Y/VIEW recovery.");
}finally{await browser.close();}
