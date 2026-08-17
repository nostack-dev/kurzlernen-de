import puppeteer from "puppeteer-core";

const base=process.argv[2]||"http://127.0.0.1:4174";
const executablePath=process.env.CHROME_BIN;
if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");
const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader"]});
const page=await browser.newPage();

try{
  for(const viewport of [{width:844,height:390,name:"landscape"},{width:844,height:300,name:"safari-bars"},{width:390,height:844,name:"iphone-portrait"}]){
    await page.setViewport({width:viewport.width,height:viewport.height,deviceScaleFactor:1});
    await page.goto(`${base}/drone_simulator.html`,{waitUntil:"load",timeout:30000});
    await page.waitForFunction(()=>document.querySelector("#status")?.textContent?.includes("SIM ready"),{timeout:30000});
    await page.waitForFunction(()=>document.body.classList.contains("solo-flight"),{timeout:5000});
    // SOLO sets the body class before the queued presentation-resize commit.
    // Wait for that commit instead of sampling the previous/empty viewport
    // policy during rapid same-page reloads (notably the Safari-bars fixture).
    await page.waitForFunction(()=>{const viewport=document.querySelector("#viewport");return viewport?.dataset.orientationPolicy==="landscape"&&Boolean(viewport.dataset.soloOrientation);},{timeout:5000});
    const g=await page.evaluate(()=>{
      const viewport=document.querySelector("#viewport"),viewportRect=viewport.getBoundingClientRect(),orientation=viewport.dataset.soloOrientation||"";
      const physicalRect=selector=>{const e=document.querySelector(selector),r=e?.getBoundingClientRect();return r?{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}:null;};
      const rect=selector=>{const r=physicalRect(selector);if(!r)return null;if(orientation==="css-landscape"){const left=r.top-viewportRect.top,top=viewportRect.right-r.right,right=r.bottom-viewportRect.top,bottom=viewportRect.right-r.left;return{left,top,right,bottom,width:right-left,height:bottom-top};}const left=r.left-viewportRect.left,top=r.top-viewportRect.top,right=r.right-viewportRect.left,bottom=r.bottom-viewportRect.top;return{left,top,right,bottom,width:right-left,height:bottom-top};};
      return{
        width:viewport.clientWidth,height:viewport.clientHeight,screenWidth:innerWidth,screenHeight:innerHeight,orientation,viewportPhysical:physicalRect("#viewport"),
        cameraDisplay:getComputedStyle(document.querySelector("#cameraModes")).display,
        panelDisplay:getComputedStyle(document.querySelector(".panel")).display,
        telemetryDisplay:getComputedStyle(document.querySelector(".telemetry")).display,
        raceDisplay:getComputedStyle(document.querySelector("#soloRaceHud")).display,
        cameraMode:document.querySelector("#viewport")?.dataset.cameraMode||"",
        autoStart:document.querySelector("#viewport")?.dataset.autoFlightStart||"",
        soloCamera:document.querySelector("#soloCamera")?.textContent?.trim()||"",
        topbar:rect("#soloTopbar"),vs:rect("#lanVsButton"),vsParent:document.querySelector("#lanVsButton")?.parentElement?.id||"",vsCombatParent:document.querySelector("#vsCombatHud")?.parentElement?.id||"",vsCombatHidden:Boolean(document.querySelector("#vsCombatHud")?.hidden),left:rect("#soloLeft"),right:rect("#soloRight"),clearance:rect("#soloClearance"),arm:rect("#soloArm"),kill:rect("#soloKill"),
        leftPhysical:physicalRect("#soloLeft"),heightPadPhysical:physicalRect("#soloHeightPad"),rotateBlocker:Boolean(document.querySelector("#soloRotate")),leftOpacity:Number(getComputedStyle(document.querySelector("#soloLeft")).opacity),armOpacity:Number(getComputedStyle(document.querySelector("#soloArm")).opacity),orientationPolicy:viewport.dataset.orientationPolicy||"",
        armCueClass:document.querySelector("#soloArm")?.className||"",armLabel:document.querySelector("#soloArm")?.textContent?.trim()||""
      };
    });
    const portrait=viewport.height>viewport.width;
    if(g.orientationPolicy!=="landscape"||g.rotateBlocker)throw new Error(`${viewport.name}: landscape policy/blocker contract failed: ${JSON.stringify({policy:g.orientationPolicy,blocker:g.rotateBlocker})}`);
    if(portrait){
      if(g.orientation!=="css-landscape"||g.width!==viewport.height||g.height!==viewport.width)throw new Error(`${viewport.name}: portrait did not become a logical landscape viewport: ${JSON.stringify({orientation:g.orientation,width:g.width,height:g.height})}`);
      const r=g.viewportPhysical;if(Math.abs(r.left)>1||Math.abs(r.top)>1||Math.abs(r.right-g.screenWidth)>1||Math.abs(r.bottom-g.screenHeight)>1)throw new Error(`${viewport.name}: rotated simulator does not cover screen: ${JSON.stringify({screen:[g.screenWidth,g.screenHeight],viewport:r})}`);
      if(g.leftOpacity<.99||g.armOpacity<.99)throw new Error(`${viewport.name}: flight controls were dimmed by portrait mode: ${JSON.stringify({left:g.leftOpacity,arm:g.armOpacity})}`);
    }else if(g.orientation!=="native-landscape")throw new Error(`${viewport.name}: native landscape policy was not detected: ${g.orientation}`);
    if(g.cameraMode!=="fpv"||g.autoStart!=="fpv"||g.soloCamera!=="FPV")throw new Error(`${viewport.name}: direct FPV startup failed: ${JSON.stringify({cameraMode:g.cameraMode,autoStart:g.autoStart,soloCamera:g.soloCamera})}`);
    if(g.panelDisplay!=="none"||g.telemetryDisplay!=="none"||g.cameraDisplay!=="none")throw new Error(`${viewport.name}: main menu leaked into direct flight startup: ${JSON.stringify({panel:g.panelDisplay,telemetry:g.telemetryDisplay,camera:g.cameraDisplay})}`);
    if(g.raceDisplay!=="none")throw new Error(`${viewport.name}: lap/time HUD still blocks the flight image: ${g.raceDisplay}`);
    for(const key of ["topbar","vs","left","right","clearance","arm","kill"])if(!g[key])throw new Error(`${viewport.name}: missing ${key}`);
    if(g.vsParent!=="soloTopbar")throw new Error(`${viewport.name}: FIND MATE is not in the topbar: ${JSON.stringify({parent:g.vsParent,vs:g.vs,topbar:g.topbar})}`);
    if(g.vsCombatParent!=="soloTopbar"||!g.vsCombatHidden)throw new Error(`${viewport.name}: VS combat HUD lifecycle/layout invalid: ${JSON.stringify({parent:g.vsCombatParent,hidden:g.vsCombatHidden})}`);
    if(g.topbar.left<-1||g.topbar.right>g.width+1||g.vs.left<g.topbar.left-1||g.vs.right>g.topbar.right+1)throw new Error(`${viewport.name}: FIND MATE/topbar escapes viewport: ${JSON.stringify({width:g.width,topbar:g.topbar,vs:g.vs})}`);
    if(!g.armCueClass.includes("arm-start-cta"))throw new Error(`${viewport.name}: ARM start cue class missing: ${JSON.stringify({className:g.armCueClass,label:g.armLabel})}`);
    const expectedStickMax=viewport.height<=340?129:151;
    if(g.left.width>expectedStickMax||g.right.width>expectedStickMax)throw new Error(`${viewport.name}: sticks still dominate viewport: ${JSON.stringify({left:g.left,right:g.right})}`);
    if(g.clearance.right>=g.width*.40)throw new Error(`${viewport.name}: height control still blocks center view: ${JSON.stringify(g.clearance)}`);
    if(g.clearance.left-g.left.right<5)throw new Error(`${viewport.name}: height control overlaps left stick: ${JSON.stringify({left:g.left,clearance:g.clearance})}`);
    if(g.arm.left-g.clearance.right<20)throw new Error(`${viewport.name}: height control crowds ARM/KILL center: ${JSON.stringify({clearance:g.clearance,arm:g.arm})}`);
    if(g.right.left-g.kill.right<20)throw new Error(`${viewport.name}: center actions crowd right stick: ${JSON.stringify({kill:g.kill,right:g.right})}`);
    for(const key of ["left","right","clearance","arm","kill"]){const r=g[key];if(r.left<-1||r.right>g.width+1||r.top<-1||r.bottom>g.height+1)throw new Error(`${viewport.name}: ${key} escapes viewport: ${JSON.stringify(r)}`);}

    const disabledActionOpacity=await page.$eval("#soloArm",e=>{e.disabled=true;return Number(getComputedStyle(e).opacity);});
    if(disabledActionOpacity<.99)throw new Error(`${viewport.name}: CALIBRATING/disabled ARM action is visually dimmed: ${disabledActionOpacity}`);

    // Validate the ARM attention affordance independent of calibration timing.
    const armCue=await page.evaluate(()=>{
      const e=document.querySelector("#soloArm");
      if(!e)throw new Error("ARM button missing");
      e.disabled=false;e.classList.remove("arming","armed");e.classList.add("attention");e.textContent="ARM";
      const style=getComputedStyle(e);return{text:e.textContent.trim(),className:e.className,animation:style.animationName};
    });
    if(armCue.text!=="ARM"||!armCue.className.includes("attention")||armCue.animation==="none")throw new Error(`${viewport.name}: ARM attention cue missing: ${JSON.stringify(armCue)}`);
    const armHoverContract=await page.evaluate(()=>{
      for(const sheet of document.styleSheets){
        let rules=[];try{rules=[...sheet.cssRules];}catch{continue;}
        for(const rule of rules){const css=rule.cssText||"";if(css.includes("#soloArm:not(:disabled):hover")&&css.includes("brightness(1.16)"))return css;}
      }
      return "";
    });
    if(!armHoverContract)throw new Error(`${viewport.name}: ARM hover/focus CSS contract missing`);

    if(portrait){
      const stick=g.leftPhysical,cx=(stick.left+stick.right)/2,cy=(stick.top+stick.bottom)/2;
      await page.mouse.move(cx,cy);await page.mouse.down();await page.mouse.move(cx,cy+stick.height*.25,{steps:3});
      const stickAxes=await page.$eval("#soloLeft .solo-knob",e=>({left:parseFloat(e.style.left),top:parseFloat(e.style.top)}));
      await page.mouse.up();
      if(!(stickAxes.left>60&&Math.abs(stickAxes.top-50)<2))throw new Error(`${viewport.name}: rotated pointer axes are wrong: ${JSON.stringify(stickAxes)}`);
      const pad=g.heightPadPhysical,px=(pad.left+pad.right)/2,py=(pad.top+pad.bottom)/2;
      await page.mouse.move(px,py);await page.mouse.down();await page.mouse.move(px+pad.width*.30,py,{steps:3});
      const climbRate=await page.$eval("#soloHeightPad",e=>Number(e.dataset.rateMps));await page.mouse.up();
      if(!(climbRate>0))throw new Error(`${viewport.name}: rotated altitude control does not command CLIMB: ${climbRate}`);
    }

    await page.click("#soloExit");
    await page.waitForFunction(()=>!document.body.classList.contains("solo-flight"),{timeout:5000});
    const exited=await page.evaluate(()=>({
      panel:getComputedStyle(document.querySelector(".panel")).display,
      telemetry:getComputedStyle(document.querySelector(".telemetry")).display,
      camera:getComputedStyle(document.querySelector("#cameraModes")).display,
      soloHidden:document.querySelector("#soloHud")?.hidden,
    }));
    if(exited.panel==="none"||exited.telemetry==="none"||exited.camera==="none"||exited.soloHidden!==true)throw new Error(`${viewport.name}: EXIT did not restore the main menu: ${JSON.stringify(exited)}`);
    console.log(`Solo layout ${viewport.name} passed: always-landscape FPV startup, clear race-free HUD, mapped controls, and EXIT-only menu reveal.`);
  }
}finally{await browser.close();}
