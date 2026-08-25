import puppeteer from "puppeteer-core";

const base=process.argv[2]||"http://127.0.0.1:4174";
const simulatorUrl=base.includes("drone_simulator.html")?base:`${base.replace(/\/$/,"")}/drone_simulator.html`;
const executablePath=process.env.CHROME_BIN;
if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");
const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader"]});
const page=await browser.newPage();

const rect=r=>r?{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}:null;

try{
  for(const viewport of [{width:844,height:390,name:"landscape"},{width:844,height:300,name:"safari-bars"}]){
    await page.setViewport({width:viewport.width,height:viewport.height,deviceScaleFactor:1});
    await page.goto(simulatorUrl,{waitUntil:"load",timeout:30000});
    await page.waitForFunction(()=>document.querySelector("#status")?.textContent?.includes("SIM ready"),{timeout:30000});
    await page.waitForFunction(()=>document.body.classList.contains("solo-flight"),{timeout:5000});
    await page.waitForFunction(()=>{const v=document.querySelector("#viewport");return v?.dataset.orientationPolicy==="landscape-only-v1"&&v.dataset.orientationBlocked==="none"&&v.dataset.soloOrientation==="native";},{timeout:5000});

    const g=await page.evaluate(()=>{
      const r=e=>{const x=e?.getBoundingClientRect();return x?{left:x.left,top:x.top,right:x.right,bottom:x.bottom,width:x.width,height:x.height}:null;};
      const v=document.querySelector("#viewport"),overlay=document.querySelector("#landscapeOnlyGate");
      return{
        width:v.clientWidth,height:v.clientHeight,screenWidth:innerWidth,screenHeight:innerHeight,viewport:r(v),
        policy:v.dataset.orientationPolicy||"",blocked:v.dataset.orientationBlocked||"",orientation:v.dataset.soloOrientation||"",
        gateHidden:Boolean(overlay?.hidden),gateDisplay:overlay?getComputedStyle(overlay).display:"missing",
        cameraDisplay:getComputedStyle(document.querySelector("#cameraModes")).display,panelDisplay:getComputedStyle(document.querySelector(".panel")).display,telemetryDisplay:getComputedStyle(document.querySelector(".telemetry")).display,raceDisplay:getComputedStyle(document.querySelector("#soloRaceHud")).display,
        cameraMode:v.dataset.cameraMode||"",autoStart:v.dataset.autoFlightStart||"",soloCamera:document.querySelector("#soloCamera")?.textContent?.trim()||"",
        topbar:r(document.querySelector("#soloTopbar")),actions:r(document.querySelector("#soloTopbarActions")),status:r(document.querySelector("#soloTopbarStatus")),left:r(document.querySelector("#soloLeft")),right:r(document.querySelector("#soloRight")),clearance:r(document.querySelector("#soloClearance")),arm:r(document.querySelector("#soloArm")),kill:r(document.querySelector("#soloKill")),
        leftPhysical:r(document.querySelector("#soloLeft")),heightPadPhysical:r(document.querySelector("#soloHeightPad")),toolbarLayout:document.querySelector("#soloTopbar")?.dataset.toolbarLayout||"",armCueClass:document.querySelector("#soloArm")?.className||""
      };
    });

    if(g.policy!=="landscape-only-v1"||g.blocked!=="none"||g.orientation!=="native"||!g.gateHidden||g.gateDisplay!=="none")throw new Error(`${viewport.name}: landscape gate not open: ${JSON.stringify(g)}`);
    if(g.width!==viewport.width||g.height!==viewport.height)throw new Error(`${viewport.name}: viewport geometry altered: ${JSON.stringify({actual:[g.width,g.height],expected:[viewport.width,viewport.height]})}`);
    if(Math.abs(g.viewport.left)>1||Math.abs(g.viewport.top)>1||Math.abs(g.viewport.right-g.screenWidth)>1||Math.abs(g.viewport.bottom-g.screenHeight)>1)throw new Error(`${viewport.name}: simulator does not cover screen: ${JSON.stringify(g.viewport)}`);
    if(g.cameraMode!=="fpv"||g.autoStart!=="fpv"||g.soloCamera!=="FPV")throw new Error(`${viewport.name}: direct FPV startup failed`);
    if(g.panelDisplay!=="none"||g.telemetryDisplay!=="none"||g.cameraDisplay!=="none"||g.raceDisplay!=="none")throw new Error(`${viewport.name}: non-flight HUD leaked into flight`);
    if(g.toolbarLayout!=="actions-status-v1")throw new Error(`${viewport.name}: toolbar contract missing`);
    for(const key of ["topbar","actions","status","left","right","clearance","arm","kill"])if(!g[key])throw new Error(`${viewport.name}: missing ${key}`);
    for(const key of ["left","right","clearance","arm","kill"]){const r=g[key];if(r.left<-1||r.right>g.width+1||r.top<-1||r.bottom>g.height+1)throw new Error(`${viewport.name}: ${key} escapes landscape viewport: ${JSON.stringify(r)}`);}
    if(!g.armCueClass.includes("arm-start-cta"))throw new Error(`${viewport.name}: ARM cue missing`);

    const stick=g.leftPhysical,cx=(stick.left+stick.right)/2,cy=(stick.top+stick.bottom)/2,targetX=cx+stick.width*.34;
    await page.evaluate(({x,y})=>document.querySelector("#soloLeft").dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,cancelable:true,pointerId:901,pointerType:"touch",clientX:x,clientY:y,button:0})),{x:targetX,y:cy});
    const stickAxes=await page.$eval("#soloLeft .solo-knob",e=>({left:parseFloat(e.style.left),top:parseFloat(e.style.top)}));
    await page.evaluate(({x,y})=>document.querySelector("#soloLeft").dispatchEvent(new PointerEvent("pointerup",{bubbles:true,cancelable:true,pointerId:901,pointerType:"touch",clientX:x,clientY:y,button:0})),{x:targetX,y:cy});
    if(!(stickAxes.left>75&&Math.abs(stickAxes.top-50)<3))throw new Error(`${viewport.name}: landscape absolute pointer mapping wrong: ${JSON.stringify(stickAxes)}`);

    const pad=g.heightPadPhysical,px=(pad.left+pad.right)/2,py=(pad.top+pad.bottom)/2,targetY=py-pad.height*.30;
    await page.evaluate(({x,y})=>document.querySelector("#soloHeightPad").dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,cancelable:true,pointerId:902,pointerType:"touch",clientX:x,clientY:y,button:0})),{x:px,y:targetY});
    const climbRate=await page.$eval("#soloHeightPad",e=>Number(e.dataset.rateMps));
    await page.evaluate(({x,y})=>document.querySelector("#soloHeightPad").dispatchEvent(new PointerEvent("pointerup",{bubbles:true,cancelable:true,pointerId:902,pointerType:"touch",clientX:x,clientY:y,button:0})),{x:px,y:targetY});
    if(!(climbRate>0))throw new Error(`${viewport.name}: landscape altitude control does not command CLIMB: ${climbRate}`);

    await page.click("#soloExit");
    await page.waitForFunction(()=>!document.body.classList.contains("solo-flight"),{timeout:5000});
    const exited=await page.evaluate(()=>({panel:getComputedStyle(document.querySelector(".panel")).display,telemetry:getComputedStyle(document.querySelector(".telemetry")).display,camera:getComputedStyle(document.querySelector("#cameraModes")).display,soloHidden:document.querySelector("#soloHud")?.hidden}));
    if(exited.panel==="none"||exited.telemetry==="none"||exited.camera==="none"||exited.soloHidden!==true)throw new Error(`${viewport.name}: EXIT did not restore landscape main menu: ${JSON.stringify(exited)}`);
    console.log(`Solo layout ${viewport.name} passed: landscape-only FPV, absolute touch, and landscape main menu.`);
  }

  // Main menu is also landscape-only. Portrait is a hard full-screen gate, not a second layout.
  await page.setViewport({width:390,height:844,deviceScaleFactor:1});
  await page.waitForFunction(()=>{const v=document.querySelector("#viewport"),g=document.querySelector("#landscapeOnlyGate");return v?.dataset.orientationPolicy==="landscape-only-v1"&&v.dataset.orientationBlocked==="portrait"&&g&&!g.hidden&&getComputedStyle(g).display!=="none";},{timeout:5000});
  const portraitGate=await page.evaluate(()=>{
    const g=document.querySelector("#landscapeOnlyGate"),r=g.getBoundingClientRect(),center=document.elementFromPoint(innerWidth/2,innerHeight/2);
    return{solo:document.body.classList.contains("solo-flight"),policy:document.querySelector("#viewport")?.dataset.orientationPolicy,blocked:document.querySelector("#viewport")?.dataset.orientationBlocked,rect:{left:r.left,top:r.top,right:r.right,bottom:r.bottom},screen:[innerWidth,innerHeight],ownsCenter:Boolean(center?.closest?.("#landscapeOnlyGate")),text:g.textContent};
  });
  if(portraitGate.solo||portraitGate.policy!=="landscape-only-v1"||portraitGate.blocked!=="portrait"||!portraitGate.ownsCenter||!/(LANDSCAPE|QUERFORMAT)/i.test(portraitGate.text))throw new Error(`portrait main-menu gate failed: ${JSON.stringify(portraitGate)}`);
  if(Math.abs(portraitGate.rect.left)>1||Math.abs(portraitGate.rect.top)>1||Math.abs(portraitGate.rect.right-portraitGate.screen[0])>1||Math.abs(portraitGate.rect.bottom-portraitGate.screen[1])>1)throw new Error(`portrait gate does not cover screen: ${JSON.stringify(portraitGate)}`);
  console.log("Portrait blocked globally: simulator and main menu require landscape.");
}finally{await browser.close();}
