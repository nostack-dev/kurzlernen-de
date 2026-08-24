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

try{
  await page.setViewport({width:844,height:390,deviceScaleFactor:1});
  await page.goto(`${baseOrigin}/drone_simulator.html${cacheTag}`,{waitUntil:"load",timeout:30000});
  await page.waitForFunction(()=>document.querySelector("#status")?.textContent?.includes("SIM ready"),{timeout:30000});
  await page.waitForFunction(()=>{const v=document.querySelector("#viewport");return document.body.classList.contains("solo-flight")&&v?.dataset.controlSource==="touch"&&v.dataset.gamepadEnabled==="0";},{timeout:7000});

  const defaultOff=await page.evaluate(()=>{const v=document.querySelector("#viewport"),display=s=>getComputedStyle(document.querySelector(s)).display;return{source:v.dataset.controlSource,enabled:v.dataset.gamepadEnabled,connected:v.dataset.gamepadConnected,left:display("#soloLeft"),right:display("#soloRight"),height:display("#soloClearance"),arm:display("#soloArm"),kill:display("#soloKill"),enumerated:navigator.getGamepads?.().length||0};});
  if(defaultOff.source!=="touch"||defaultOff.enabled!=="0"||defaultOff.connected!=="0"||defaultOff.left==="none"||defaultOff.right==="none"||defaultOff.height==="none"||defaultOff.arm==="none"||defaultOff.kill==="none"||defaultOff.enumerated!==0)throw new Error(`Xbox was not safely OFF before Chrome exposure: ${JSON.stringify(defaultOff)}`);
  await page.evaluate(()=>globalThis.__xboxTest.expose());
  await page.waitForFunction(()=>document.querySelector("#soloGamepadStatus")?.textContent?.includes("XBOX DETECTED"),{timeout:3000});
  const detectedOff=await page.evaluate(()=>({source:document.querySelector("#viewport")?.dataset.controlSource,enabled:document.querySelector("#viewport")?.dataset.gamepadEnabled,connected:document.querySelector("#viewport")?.dataset.gamepadConnected,status:document.querySelector("#soloGamepadStatus")?.textContent,enumerated:navigator.getGamepads?.().length||0}));
  if(detectedOff.source!=="touch"||detectedOff.enabled!=="0"||detectedOff.connected!=="0"||detectedOff.enumerated!==1||!detectedOff.status.includes("ENABLE IN SETTINGS"))throw new Error(`Chrome-exposed Xbox did not remain safely OFF with a clear enable hint: ${JSON.stringify(detectedOff)}`);

  await page.click("#soloTopbar .phone-settings-button");await page.waitForFunction(()=>document.querySelector(".phone-settings-dialog")?.open,{timeout:3000});
  const toggleDefault=await page.$eval('.phone-settings-dialog [data-xbox-controller]',input=>input.checked);if(toggleDefault!==false)throw new Error(`Xbox settings toggle is not OFF by default: ${toggleDefault}`);
  await page.click('.phone-settings-dialog [data-xbox-controller]');await page.click('.phone-settings-dialog [data-close]');
  await page.waitForFunction(()=>{const v=document.querySelector("#viewport");return v?.dataset.controlSource==="xbox"&&v.dataset.gamepadEnabled==="1"&&v.dataset.gamepadConnected==="1";},{timeout:3000});
  const active=await page.evaluate(()=>{const v=document.querySelector("#viewport"),display=s=>getComputedStyle(document.querySelector(s)).display;return{source:v.dataset.controlSource,connected:v.dataset.gamepadConnected,poll:v.dataset.gamepadPollLoop,left:display("#soloLeft"),right:display("#soloRight"),height:display("#soloClearance"),arm:display("#soloArm"),kill:display("#soloKill"),status:document.querySelector("#soloGamepadStatus").hidden,help:document.querySelector("#soloGamepadHelp").hidden,helpText:document.querySelector("#soloGamepadHelp").textContent};});
  if(active.source!=="xbox"||active.connected!=="1"||active.poll!=="dedicated-60hz-v1"||active.left!=="none"||active.right!=="none"||active.height!=="none"||active.arm!=="none"||active.kill!=="none"||active.status||active.help||!active.helpText.includes("RB FIRE"))throw new Error(`Xbox ON did not remove every touch flight control: ${JSON.stringify(active)}`);

  await page.click("#soloTopbar .phone-settings-button");await page.waitForFunction(()=>document.querySelector(".phone-settings-dialog")?.open,{timeout:3000});await page.click('.phone-settings-dialog [data-xbox-controller]');await page.click('.phone-settings-dialog [data-close]');
  await page.waitForFunction(()=>document.querySelector("#viewport")?.dataset.controlSource==="touch",{timeout:3000});
  const disabled=await page.evaluate(()=>{const v=document.querySelector("#viewport"),display=s=>getComputedStyle(document.querySelector(s)).display,stored=JSON.parse(localStorage.getItem("arondight45PhoneControlSettingsV5")||"{}");return{source:v.dataset.controlSource,enabled:v.dataset.gamepadEnabled,connected:v.dataset.gamepadConnected,left:display("#soloLeft"),right:display("#soloRight"),height:display("#soloClearance"),stored:stored.xboxControllerEnabled,padStillConnected:Boolean(navigator.getGamepads?.()[0]?.connected)};});
  if(disabled.source!=="touch"||disabled.enabled!=="0"||disabled.connected!=="0"||disabled.left==="none"||disabled.right==="none"||disabled.height==="none"||disabled.stored!==false||!disabled.padStillConnected)throw new Error(`Xbox OFF did not restore touch with controller connected: ${JSON.stringify(disabled)}`);
  await page.click("#soloTopbar .phone-settings-button");await page.waitForFunction(()=>document.querySelector(".phone-settings-dialog")?.open,{timeout:3000});await page.click('.phone-settings-dialog [data-xbox-controller]');await page.click('.phone-settings-dialog [data-close]');
  await page.waitForFunction(()=>{const v=document.querySelector("#viewport");return v?.dataset.controlSource==="xbox"&&v.dataset.gamepadEnabled==="1";},{timeout:3000});

  const unarmedBaseline=await page.$eval("#viewport",v=>Number(v.dataset.fireShots||0));await setButton(5,1);await pause(220);const unarmed=await page.$eval("#viewport",v=>({shots:Number(v.dataset.fireShots||0),armed:v.dataset.fireArmed,reason:v.dataset.fireLockReason}));await setButton(5,0);if(unarmed.shots!==unarmedBaseline||unarmed.armed!=="0"||unarmed.reason!=="unarmed")throw new Error(`Xbox RB fired while FC was DISARMED: ${JSON.stringify({unarmedBaseline,unarmed})}`);
  await page.waitForFunction(()=>{const button=document.querySelector("#soloArm");return button&&!button.disabled&&button.textContent.trim()==="ARM";},{timeout:20000});await setButton(0,1);await pause(120);await setButton(0,0);await page.waitForFunction(()=>document.querySelector("#fcState")?.textContent==="ARMED"&&document.querySelector("#viewport")?.dataset.fireArmed==="1",{timeout:65000});

  await setButton(6,.85);
  await page.waitForFunction(()=>Number(document.querySelector("#viewport")?.dataset.gamepadHeightAxis)<-.80,{timeout:3000});
  const lt=await page.$eval("#viewport",v=>Number(v.dataset.gamepadHeightAxis));
  await setButton(6,0);await setButton(7,.85);
  await page.waitForFunction(()=>Number(document.querySelector("#viewport")?.dataset.gamepadHeightAxis)>.80,{timeout:3000});
  const triggerBaseline=await page.$eval("#viewport",v=>Number(v.dataset.fireShots||0));
  await pause(260);
  const rt=await page.$eval("#viewport",v=>({height:Number(v.dataset.gamepadHeightAxis),shots:Number(v.dataset.fireShots||0),fire:v.dataset.gamepadFire}));
  if(!(lt<0)||!(rt.height>0)||rt.shots!==triggerBaseline||rt.fire!=="0")throw new Error(`LT/RT altitude-only contract failed: ${JSON.stringify({lt,rt,triggerBaseline})}`);
  await setButton(7,0);

  await setButton(4,1);await page.evaluate(()=>{globalThis.__xboxTest.setAxis(2,.82);globalThis.__xboxTest.setAxis(3,-.68);});
  await page.waitForFunction(()=>{const v=document.querySelector("#viewport"),parts=String(v?.dataset.gamepadRight||"").split(",").map(Number);return v?.dataset.xboxControlScheme==="classic"&&v.dataset.gamepadAim==="0"&&parts.length===2&&parts[0]>.70&&parts[1]<-.50;},{timeout:4000});
  const classic=await page.evaluate(()=>{const v=document.querySelector("#viewport"),cross=document.querySelector(".xbox-crosshair");return{scheme:v.dataset.xboxControlScheme,aim:v.dataset.gamepadAim,right:v.dataset.gamepadRight,cross:getComputedStyle(cross).display,help:document.querySelector("#soloGamepadHelp")?.textContent||""};});
  if(classic.scheme!=="classic"||classic.aim!=="0"||classic.cross!=="none"||!classic.help.includes("CLASSIC"))throw new Error(`CLASSIC did not keep direct RS with hidden crosshair: ${JSON.stringify(classic)}`);

  await setButton(5,1);await page.waitForFunction(before=>{const v=document.querySelector("#viewport");return v?.dataset.gamepadFire==="1"&&Number(v.dataset.fireShots||0)>before&&v.dataset.fireAimMode==="center-fixed";},{timeout:4000},triggerBaseline);await pause(180);
  const rbOnly=await page.$eval("#viewport",v=>({shots:Number(v.dataset.fireShots||0),aim:v.dataset.gamepadAim,fire:v.dataset.gamepadFire,x:Number(v.dataset.fireAimX),y:Number(v.dataset.fireAimY),w:v.clientWidth,h:v.clientHeight}));
  if(rbOnly.shots<=triggerBaseline||rbOnly.aim!=="0"||rbOnly.fire!=="1"||Math.abs(rbOnly.x-rbOnly.w/2)>.6||Math.abs(rbOnly.y-rbOnly.h/2)>.6)throw new Error(`CLASSIC RB did not fire through center independently: ${JSON.stringify(rbOnly)}`);
  await setButton(5,0);await setButton(4,0);await page.evaluate(()=>{globalThis.__xboxTest.setAxis(2,0);globalThis.__xboxTest.setAxis(3,0);});
  await page.waitForFunction(()=>{const v=document.querySelector("#viewport");return v?.dataset.gamepadFire==="0"&&v.dataset.gamepadAim==="0"&&getComputedStyle(document.querySelector(".xbox-crosshair")).display==="none";},{timeout:3000});
  await pause(140);
  const pointerBaseline=await page.$eval("#viewport",v=>Number(v.dataset.fireShots||0));
  await page.evaluate(()=>{const v=document.querySelector("#viewport"),r=v.getBoundingClientRect();v.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,cancelable:true,pointerId:99,pointerType:"touch",clientX:r.left+r.width/2,clientY:r.top+r.height/2,button:0}));});
  await pause(180);
  const pointerBlocked=await page.$eval("#viewport",v=>Number(v.dataset.fireShots||0));
  if(pointerBlocked!==pointerBaseline)throw new Error(`touch fire remained active in Xbox mode: ${pointerBaseline} -> ${pointerBlocked}`);

  await page.click("#soloTopbar .phone-settings-button");await page.waitForFunction(()=>document.querySelector(".phone-settings-dialog")?.open,{timeout:3000});
  await page.$eval('[data-xbox-scheme]',el=>{el.value="aim";el.dispatchEvent(new Event("change",{bubbles:true}));});await page.click('.phone-settings-dialog [data-close]');
  await page.waitForFunction(()=>document.querySelector("#viewport")?.dataset.xboxControlScheme==="aim",{timeout:3000});
  await setButton(4,1);await page.evaluate(()=>{globalThis.__xboxTest.setAxis(2,.82);globalThis.__xboxTest.setAxis(3,-.68);});
  await page.waitForFunction(()=>{const v=document.querySelector("#viewport");return v?.dataset.gamepadAim==="1"&&Math.abs(Number(v.dataset.worldLookYaw||0))>1&&Math.abs(Number(v.dataset.worldLookPitch||0))>1&&getComputedStyle(document.querySelector(".xbox-crosshair")).display!=="none";},{timeout:4000});
  const aim=await page.evaluate(()=>{const v=document.querySelector("#viewport"),cross=document.querySelector(".xbox-crosshair"),r=cross.getBoundingClientRect(),vr=v.getBoundingClientRect();return{scheme:v.dataset.xboxControlScheme,aim:v.dataset.gamepadAim,fire:v.dataset.gamepadFire,yaw:Number(v.dataset.worldLookYaw),pitch:Number(v.dataset.worldLookPitch),cross:getComputedStyle(cross).display,cx:r.left+r.width/2-vr.left,cy:r.top+r.height/2-vr.top,vw:v.clientWidth,vh:v.clientHeight};});
  if(aim.scheme!=="aim"||aim.aim!=="1"||aim.fire!=="0"||aim.cross==="none"||Math.abs(aim.yaw)<=1||Math.abs(aim.pitch)<=1||Math.abs(aim.cx-aim.vw/2)>2||Math.abs(aim.cy-aim.vh/2)>2)throw new Error(`AIM LB + right-stick free-look/crosshair failed: ${JSON.stringify(aim)}`);

  const shotsBeforeRb=await page.$eval("#viewport",v=>Number(v.dataset.fireShots||0));
  await setButton(5,1);
  await page.waitForFunction(before=>{const v=document.querySelector("#viewport");return v?.dataset.gamepadFire==="1"&&v?.dataset.fireInputSource==="gamepad"&&Number(v.dataset.fireShots||0)>before;},{timeout:4000},shotsBeforeRb);
  await pause(220);
  const fired=await page.$eval("#viewport",v=>({shots:Number(v.dataset.fireShots||0),source:v.dataset.fireInputSource,fire:v.dataset.gamepadFire,height:Number(v.dataset.gamepadHeightAxis)}));
  if(fired.shots<=shotsBeforeRb||fired.source!=="gamepad"||fired.fire!=="1"||fired.height!==0)throw new Error(`AIM LB + RB did not fire independently of altitude: ${JSON.stringify({shotsBeforeRb,fired})}`);

  await setButton(5,0);await setButton(4,0);await page.evaluate(()=>{globalThis.__xboxTest.setAxis(2,0);globalThis.__xboxTest.setAxis(3,0);});
  await page.waitForFunction(()=>{const v=document.querySelector("#viewport");return v?.dataset.gamepadFire==="0"&&v.dataset.gamepadAim==="0"&&v.dataset.xboxAimCrosshair==="0"&&getComputedStyle(document.querySelector(".xbox-crosshair")).display==="none";},{timeout:3000});
  await setButton(9,1);await page.waitForFunction(()=>document.querySelector(".phone-settings-dialog")?.open,{timeout:3000});await setButton(9,0);await setButton(1,1);await page.waitForFunction(()=>!document.querySelector(".phone-settings-dialog")?.open,{timeout:3000});await setButton(1,0);
  await setButton(3,1);await page.waitForFunction(()=>Number(document.querySelector("#viewport")?.dataset.gamepadResetCount||0)>=1,{timeout:3000});await setButton(3,0);
  const recovery=await page.$eval("#viewport",v=>({reset:Number(v.dataset.gamepadResetCount||0),help:document.querySelector("#soloGamepadHelp")?.textContent||""}));if(recovery.reset<1||!recovery.help.includes("Y RESET")||!recovery.help.includes("VIEW EXIT")||!recovery.help.includes("MENU SETTINGS"))throw new Error(`controller recovery bindings missing: ${JSON.stringify(recovery)}`);
  await setButton(8,1);await page.waitForFunction(()=>!document.body.classList.contains("solo-flight")&&Number(document.querySelector("#viewport")?.dataset.gamepadExitCount||0)>=1,{timeout:4000});await setButton(8,0);await page.click("#camSolo");await page.waitForFunction(()=>document.body.classList.contains("solo-flight")&&document.querySelector("#viewport")?.dataset.controlSource==="xbox",{timeout:5000});
  await page.evaluate(()=>globalThis.__xboxTest.disconnect());
  await page.waitForFunction(()=>{const v=document.querySelector("#viewport");return v?.dataset.controlSource==="xbox"&&v.dataset.gamepadConnected==="0";},{timeout:3000});
  const disconnected=await page.evaluate(()=>{const v=document.querySelector("#viewport"),display=s=>getComputedStyle(document.querySelector(s)).display;return{source:v.dataset.controlSource,connected:v.dataset.gamepadConnected,height:Number(v.dataset.gamepadHeightAxis||0),left:display("#soloLeft"),right:display("#soloRight"),clearance:display("#soloClearance"),arm:display("#soloArm"),kill:display("#soloKill")};});
  if(disconnected.source!=="xbox"||disconnected.connected!=="0"||disconnected.height!==0||disconnected.left!=="none"||disconnected.right!=="none"||disconnected.clearance!=="none"||disconnected.arm!=="none"||disconnected.kill!=="none")throw new Error(`Xbox ON exposed touch controls while the selected pad reconnected: ${JSON.stringify(disconnected)}`);
  await page.click("#soloTopbar .phone-settings-button");await page.waitForFunction(()=>document.querySelector(".phone-settings-dialog")?.open,{timeout:3000});await page.click('.phone-settings-dialog [data-xbox-controller]');await page.click('.phone-settings-dialog [data-close]');
  await page.waitForFunction(()=>{const v=document.querySelector("#viewport");return v?.dataset.controlSource==="touch"&&v.dataset.gamepadEnabled==="0"&&getComputedStyle(document.querySelector("#soloLeft")).display!=="none";},{timeout:3000});

  console.log("Xbox browser E2E passed: RB is blocked while DISARMED, then fires only after authoritative FC arming; CLASSIC/AIM, altitude, and recovery controls remain intact.");
}finally{await browser.close();}
