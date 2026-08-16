import puppeteer from "puppeteer-core";

const base=process.argv[2]||"http://127.0.0.1:4174";
const executablePath=process.env.CHROME_BIN;
if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");

const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader"]});
const page=await browser.newPage();

await page.evaluateOnNewDocument(()=>{
  const state={connected:true,axes:[0,0,0,0],values:Array(17).fill(0)};
  const pad={id:"Xbox Wireless Controller (Vendor: 045e Product: 0b13)",index:0,mapping:"standard",timestamp:0,
    get connected(){return state.connected;},
    get axes(){return state.axes;},
    get buttons(){return state.values.map(value=>({pressed:value>.5,touched:value>0,value}));}
  };
  Object.defineProperty(navigator,"getGamepads",{configurable:true,value:()=>state.connected?[pad]:[]});
  globalThis.__xboxTest={
    setButton(index,value){state.values[index]=Math.max(0,Math.min(1,Number(value)||0));},
    setAxis(index,value){state.axes[index]=Math.max(-1,Math.min(1,Number(value)||0));},
    reset(){state.axes.fill(0);state.values.fill(0);},
    disconnect(){state.connected=false;},
  };
});

const pause=ms=>page.evaluate(delay=>new Promise(resolve=>setTimeout(resolve,delay)),ms);
const setButton=(index,value)=>page.evaluate((i,v)=>globalThis.__xboxTest.setButton(i,v),index,value);

try{
  await page.setViewport({width:844,height:390,deviceScaleFactor:1});
  await page.goto(`${base}/drone_simulator.html`,{waitUntil:"load",timeout:30000});
  await page.waitForFunction(()=>document.querySelector("#status")?.textContent?.includes("SIM ready"),{timeout:30000});
  await page.waitForFunction(()=>document.body.classList.contains("solo-flight")&&document.querySelector("#viewport")?.dataset.controlSource==="xbox",{timeout:7000});

  const active=await page.evaluate(()=>{const v=document.querySelector("#viewport"),display=s=>getComputedStyle(document.querySelector(s)).display;return{source:v.dataset.controlSource,connected:v.dataset.gamepadConnected,left:display("#soloLeft"),right:display("#soloRight"),height:display("#soloClearance"),arm:display("#soloArm"),kill:display("#soloKill"),status:document.querySelector("#soloGamepadStatus").hidden,help:document.querySelector("#soloGamepadHelp").hidden,helpText:document.querySelector("#soloGamepadHelp").textContent};});
  if(active.source!=="xbox"||active.connected!=="1"||active.left!=="none"||active.right!=="none"||active.height!=="none"||active.arm!=="none"||active.kill!=="none"||active.status||active.help||!active.helpText.includes("LB+RB FIRE"))throw new Error(`Xbox did not replace touch flight controls: ${JSON.stringify(active)}`);

  // Standard Gamepad indices: LT=6 and RT=7. Triggers alter only the altitude
  // target; specifically, RT must never inherit the fire action.
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

  // RB alone cannot fire: LB is the explicit aim/free-look modifier.
  await setButton(5,1);await pause(260);
  const rbOnly=await page.$eval("#viewport",v=>({shots:Number(v.dataset.fireShots||0),aim:v.dataset.gamepadAim,fire:v.dataset.gamepadFire}));
  if(rbOnly.shots!==triggerBaseline||rbOnly.aim!=="0"||rbOnly.fire!=="0")throw new Error(`RB fired outside LB aim mode: ${JSON.stringify(rbOnly)}`);
  await page.evaluate(()=>{const v=document.querySelector("#viewport"),r=v.getBoundingClientRect();v.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,cancelable:true,pointerId:99,pointerType:"touch",clientX:r.left+r.width/2,clientY:r.top+r.height/2,button:0}));});
  await pause(180);
  const pointerBlocked=await page.$eval("#viewport",v=>Number(v.dataset.fireShots||0));
  if(pointerBlocked!==triggerBaseline)throw new Error(`touch fire remained active in Xbox mode: ${triggerBaseline} -> ${pointerBlocked}`);

  await setButton(5,0);await setButton(4,1);
  await page.evaluate(()=>{globalThis.__xboxTest.setAxis(2,.82);globalThis.__xboxTest.setAxis(3,-.68);});
  await page.waitForFunction(()=>{const v=document.querySelector("#viewport");return v?.dataset.gamepadAim==="1"&&Math.abs(Number(v.dataset.worldLookYaw||0))>1&&Math.abs(Number(v.dataset.worldLookPitch||0))>1;},{timeout:4000});
  const aim=await page.evaluate(()=>{const v=document.querySelector("#viewport"),cross=document.querySelector(".xbox-crosshair"),r=cross.getBoundingClientRect();return{aim:v.dataset.gamepadAim,fire:v.dataset.gamepadFire,yaw:Number(v.dataset.worldLookYaw),pitch:Number(v.dataset.worldLookPitch),cross:getComputedStyle(cross).display,cx:r.left+r.width/2,cy:r.top+r.height/2,vw:v.clientWidth,vh:v.clientHeight};});
  if(aim.aim!=="1"||aim.fire!=="0"||aim.cross==="none"||Math.abs(aim.yaw)<=1||Math.abs(aim.pitch)<=1||Math.abs(aim.cx-aim.vw/2)>2||Math.abs(aim.cy-aim.vh/2)>2)throw new Error(`LB + right-stick free-look/crosshair failed: ${JSON.stringify(aim)}`);

  // This is the final fire mapping: hold LB, then press RIGHT SHOULDER (RB=5).
  const shotsBeforeRb=await page.$eval("#viewport",v=>Number(v.dataset.fireShots||0));
  await setButton(5,1);
  await page.waitForFunction(before=>{const v=document.querySelector("#viewport");return v?.dataset.gamepadFire==="1"&&v?.dataset.fireInputSource==="gamepad"&&Number(v.dataset.fireShots||0)>before;},{timeout:4000},shotsBeforeRb);
  await pause(220);
  const fired=await page.$eval("#viewport",v=>({shots:Number(v.dataset.fireShots||0),source:v.dataset.fireInputSource,fire:v.dataset.gamepadFire,height:Number(v.dataset.gamepadHeightAxis)}));
  if(fired.shots<=shotsBeforeRb||fired.source!=="gamepad"||fired.fire!=="1"||fired.height!==0)throw new Error(`LB + RB did not fire independently of the altitude triggers: ${JSON.stringify({shotsBeforeRb,fired})}`);

  await setButton(5,0);await setButton(4,0);await page.evaluate(()=>{globalThis.__xboxTest.setAxis(2,0);globalThis.__xboxTest.setAxis(3,0);});
  await page.waitForFunction(()=>document.querySelector("#viewport")?.dataset.gamepadFire==="0"&&getComputedStyle(document.querySelector(".xbox-crosshair")).display==="none",{timeout:3000});
  await page.evaluate(()=>globalThis.__xboxTest.disconnect());
  await page.waitForFunction(()=>document.querySelector("#viewport")?.dataset.controlSource==="touch",{timeout:3000});
  const disconnected=await page.evaluate(()=>{const v=document.querySelector("#viewport"),display=s=>getComputedStyle(document.querySelector(s)).display;return{source:v.dataset.controlSource,connected:v.dataset.gamepadConnected,height:Number(v.dataset.gamepadHeightAxis||0),left:display("#soloLeft"),right:display("#soloRight"),clearance:display("#soloClearance"),arm:display("#soloArm"),kill:display("#soloKill")};});
  if(disconnected.source!=="touch"||disconnected.connected!=="0"||disconnected.height!==0||disconnected.left==="none"||disconnected.right==="none"||disconnected.clearance==="none"||disconnected.arm==="none"||disconnected.kill==="none")throw new Error(`Xbox disconnect did not safely restore neutral touch controls: ${JSON.stringify(disconnected)}`);

  console.log("Xbox browser E2E passed: touch replacement, LT down, RT up-only, LB+RS free-look/crosshair, and LB+RB right-shoulder fire.");
}finally{await browser.close();}
