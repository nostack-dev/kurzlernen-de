import puppeteer from "puppeteer-core";

const base=process.argv[2]||"http://127.0.0.1:4174";
const simulatorUrl=base.includes("drone_simulator.html")?base:`${base.replace(/\/$/,"")}/drone_simulator.html`;
const executablePath=process.env.CHROME_BIN;
if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");
const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader"]});
const page=await browser.newPage();

try{
  for(const viewport of [{width:844,height:390,name:"landscape"},{width:844,height:300,name:"safari-bars"},{width:390,height:844,name:"iphone-portrait"}]){
    await page.setViewport({width:viewport.width,height:viewport.height,deviceScaleFactor:1});
    await page.goto(simulatorUrl,{waitUntil:"load",timeout:30000});
    await page.waitForFunction(()=>document.querySelector("#status")?.textContent?.includes("SIM ready"),{timeout:30000});
    await page.waitForFunction(()=>document.body.classList.contains("solo-flight"),{timeout:5000});
    // SOLO sets the body class before the queued presentation-resize commit.
    // Wait for that commit instead of sampling the previous/empty viewport
    // policy during rapid same-page reloads (notably the Safari-bars fixture).
    await page.waitForFunction(()=>{const viewport=document.querySelector("#viewport");return viewport?.dataset.orientationPolicy==="native-never-rotate-v1"&&viewport.dataset.soloOrientation==="native";},{timeout:5000});
    const g=await page.evaluate(()=>{
      const viewport=document.querySelector("#viewport"),viewportRect=viewport.getBoundingClientRect(),orientation=viewport.dataset.soloOrientation||"";
      const physicalElementRect=e=>{const r=e?.getBoundingClientRect();return r?{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}:null;};
      const physicalRect=selector=>physicalElementRect(document.querySelector(selector));
      const logicalElementRect=e=>{const r=physicalElementRect(e);if(!r)return null;if(orientation==="css-landscape"){const left=r.top-viewportRect.top,top=viewportRect.right-r.right,right=r.bottom-viewportRect.top,bottom=viewportRect.right-r.left;return{left,top,right,bottom,width:right-left,height:bottom-top};}const left=r.left-viewportRect.left,top=r.top-viewportRect.top,right=r.right-viewportRect.left,bottom=r.bottom-viewportRect.top;return{left,top,right,bottom,width:right-left,height:bottom-top};};
      const rect=selector=>logicalElementRect(document.querySelector(selector));
      return{
        width:viewport.clientWidth,height:viewport.clientHeight,screenWidth:innerWidth,screenHeight:innerHeight,orientation,viewportPhysical:physicalRect("#viewport"),
        cameraDisplay:getComputedStyle(document.querySelector("#cameraModes")).display,
        panelDisplay:getComputedStyle(document.querySelector(".panel")).display,
        telemetryDisplay:getComputedStyle(document.querySelector(".telemetry")).display,
        raceDisplay:getComputedStyle(document.querySelector("#soloRaceHud")).display,
        cameraMode:document.querySelector("#viewport")?.dataset.cameraMode||"",
        autoStart:document.querySelector("#viewport")?.dataset.autoFlightStart||"",
        soloCamera:document.querySelector("#soloCamera")?.textContent?.trim()||"",
        topbar:rect("#soloTopbar"),topbarActions:rect("#soloTopbarActions"),topbarStatus:rect("#soloTopbarStatus"),toolbarLayout:document.querySelector("#soloTopbar")?.dataset.toolbarLayout||"",toolbarButtons:[...document.querySelectorAll("#soloTopbarActions>button")].filter(e=>getComputedStyle(e).display!=="none").map(e=>({id:e.id||e.className,rect:logicalElementRect(e)})),vs:rect("#lanVsButton"),vsParent:document.querySelector("#lanVsButton")?.parentElement?.id||"",vsCombatParent:document.querySelector("#vsCombatHud")?.parentElement?.id||"",vsCombatHidden:Boolean(document.querySelector("#vsCombatHud")?.hidden),gameplay:rect("#gameplayContractHud"),gameplayScoreParent:document.querySelector("#gameplayScorePill")?.parentElement?.id||"",gameplayLoop:viewport.dataset.gameplayLoop||"",left:rect("#soloLeft"),right:rect("#soloRight"),clearance:rect("#soloClearance"),arm:rect("#soloArm"),kill:rect("#soloKill"),
        leftPhysical:physicalRect("#soloLeft"),heightPadPhysical:physicalRect("#soloHeightPad"),rotateBlocker:Boolean(document.querySelector("#soloRotate")),leftOpacity:Number(getComputedStyle(document.querySelector("#soloLeft")).opacity),armOpacity:Number(getComputedStyle(document.querySelector("#soloArm")).opacity),orientationPolicy:viewport.dataset.orientationPolicy||"",
        armCueClass:document.querySelector("#soloArm")?.className||"",armLabel:document.querySelector("#soloArm")?.textContent?.trim()||""
      };
    });
    const portrait=viewport.height>viewport.width;
    if(g.orientationPolicy!=="native-never-rotate-v1"||g.orientation!=="native"||g.rotateBlocker)throw new Error(`${viewport.name}: native orientation contract failed: ${JSON.stringify({policy:g.orientationPolicy,orientation:g.orientation,blocker:g.rotateBlocker})}`);
    if(g.width!==viewport.width||g.height!==viewport.height)throw new Error(`${viewport.name}: viewport geometry was altered instead of staying native: ${JSON.stringify({actual:[g.width,g.height],expected:[viewport.width,viewport.height]})}`);
    const r=g.viewportPhysical;if(Math.abs(r.left)>1||Math.abs(r.top)>1||Math.abs(r.right-g.screenWidth)>1||Math.abs(r.bottom-g.screenHeight)>1)throw new Error(`${viewport.name}: native simulator does not cover screen: ${JSON.stringify({screen:[g.screenWidth,g.screenHeight],viewport:r})}`);
    if(portrait&&(g.leftOpacity<.99||g.armOpacity<.99))throw new Error(`${viewport.name}: flight controls were dimmed by portrait mode: ${JSON.stringify({left:g.leftOpacity,arm:g.armOpacity})}`);
    if(g.cameraMode!=="fpv"||g.autoStart!=="fpv"||g.soloCamera!=="FPV")throw new Error(`${viewport.name}: direct FPV startup failed: ${JSON.stringify({cameraMode:g.cameraMode,autoStart:g.autoStart,soloCamera:g.soloCamera})}`);
    if(g.panelDisplay!=="none"||g.telemetryDisplay!=="none"||g.cameraDisplay!=="none")throw new Error(`${viewport.name}: main menu leaked into direct flight startup: ${JSON.stringify({panel:g.panelDisplay,telemetry:g.telemetryDisplay,camera:g.cameraDisplay})}`);
    if(g.raceDisplay!=="none")throw new Error(`${viewport.name}: lap/time HUD still blocks the flight image: ${g.raceDisplay}`);
    for(const key of ["topbar","topbarActions","topbarStatus","vs","gameplay","left","right","clearance","arm","kill"])if(!g[key])throw new Error(`${viewport.name}: missing ${key}`);
    if(g.toolbarLayout!=="actions-status-v1")throw new Error(`${viewport.name}: semantic toolbar layout missing: ${g.toolbarLayout}`);
    if(g.vsParent!=="soloTopbarActions")throw new Error(`${viewport.name}: FIND MATE is not in the action rail: ${JSON.stringify({parent:g.vsParent,vs:g.vs,topbar:g.topbar})}`);
    if(g.vsCombatParent!=="soloTopbarStatus"||!g.vsCombatHidden)throw new Error(`${viewport.name}: VS combat status lifecycle/layout invalid: ${JSON.stringify({parent:g.vsCombatParent,hidden:g.vsCombatHidden})}`);
    if(g.gameplayScoreParent!=="soloTopbarStatus"||g.gameplayLoop!=="skill-risk-bank-contracts-v1")throw new Error(`${viewport.name}: gameplay score/loop is not attached to the status rail: ${JSON.stringify({parent:g.gameplayScoreParent,loop:g.gameplayLoop})}`);
    if(g.topbar.left<-1||g.topbar.right>g.width+1||g.vs.left<g.topbar.left-1||g.vs.right>g.topbar.right+1)throw new Error(`${viewport.name}: FIND MATE/topbar escapes viewport: ${JSON.stringify({width:g.width,topbar:g.topbar,vs:g.vs})}`);
    if(g.topbarActions.bottom>g.topbarStatus.top+1)throw new Error(`${viewport.name}: action rail overlaps status rail: ${JSON.stringify({actions:g.topbarActions,status:g.topbarStatus})}`);
    if(g.gameplay.left<0||g.gameplay.right>g.width||g.gameplay.top<g.topbar.bottom-1||g.gameplay.bottom>g.left.top+1)throw new Error(`${viewport.name}: gameplay contract obscures toolbar or flight controls: ${JSON.stringify({gameplay:g.gameplay,topbar:g.topbar,left:g.left})}`);
    for(let i=0;i<g.toolbarButtons.length;i++)for(let j=i+1;j<g.toolbarButtons.length;j++){const a=g.toolbarButtons[i],b=g.toolbarButtons[j],overlap=Math.min(a.rect.right,b.rect.right)-Math.max(a.rect.left,b.rect.left)>1&&Math.min(a.rect.bottom,b.rect.bottom)-Math.max(a.rect.top,b.rect.top)>1;if(overlap)throw new Error(`${viewport.name}: toolbar buttons overlap: ${JSON.stringify({a,b})}`);}
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
      const stick=g.leftPhysical,cx=(stick.left+stick.right)/2,cy=(stick.top+stick.bottom)/2,targetX=cx+stick.width*.34;
      await page.evaluate(({x,y})=>document.querySelector("#soloLeft").dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,cancelable:true,pointerId:901,pointerType:"touch",clientX:x,clientY:y,button:0})),{x:targetX,y:cy});
      const stickAxes=await page.$eval("#soloLeft .solo-knob",e=>({left:parseFloat(e.style.left),top:parseFloat(e.style.top)}));
      await page.evaluate(({x,y})=>document.querySelector("#soloLeft").dispatchEvent(new PointerEvent("pointerup",{bubbles:true,cancelable:true,pointerId:901,pointerType:"touch",clientX:x,clientY:y,button:0})),{x:targetX,y:cy});
      if(!(stickAxes.left>75&&Math.abs(stickAxes.top-50)<3))throw new Error(`${viewport.name}: absolute native pointer mapping is wrong: ${JSON.stringify(stickAxes)}`);
      const pad=g.heightPadPhysical,px=(pad.left+pad.right)/2,py=(pad.top+pad.bottom)/2,targetY=py-pad.height*.30;
      await page.evaluate(({x,y})=>document.querySelector("#soloHeightPad").dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,cancelable:true,pointerId:902,pointerType:"touch",clientX:x,clientY:y,button:0})),{x:px,y:targetY});
      const climbRate=await page.$eval("#soloHeightPad",e=>Number(e.dataset.rateMps));
      await page.evaluate(({x,y})=>document.querySelector("#soloHeightPad").dispatchEvent(new PointerEvent("pointerup",{bubbles:true,cancelable:true,pointerId:902,pointerType:"touch",clientX:x,clientY:y,button:0})),{x:px,y:targetY});
      if(!(climbRate>0))throw new Error(`${viewport.name}: native altitude control does not command CLIMB: ${climbRate}`);
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
    console.log(`Solo layout ${viewport.name} passed: native-orientation FPV startup, clear race-free HUD, mapped controls, and EXIT-only menu reveal.`);
  }
}finally{await browser.close();}
