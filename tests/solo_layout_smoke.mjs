import puppeteer from "puppeteer-core";

const base=process.argv[2]||"http://127.0.0.1:4174";
const executablePath=process.env.CHROME_BIN;
if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");
const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader"]});
const page=await browser.newPage();

function overlap(a,b){return Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));}

try{
  for(const viewport of [{width:844,height:390,name:"landscape"},{width:844,height:300,name:"safari-bars"}]){
    await page.setViewport({width:viewport.width,height:viewport.height,deviceScaleFactor:1});
    await page.goto(`${base}/drone_simulator.html`,{waitUntil:"load",timeout:30000});
    await page.waitForFunction(()=>document.querySelector("#status")?.textContent?.includes("SIM ready"),{timeout:30000});
    const startCue=await page.evaluate(()=>{const e=document.querySelector("#camSolo"),style=getComputedStyle(e);return{text:e?.textContent?.trim()||"",className:e?.className||"",animation:style.animationName,background:style.backgroundColor};});
    if(startCue.text!=="START SIM"||!startCue.className.includes("start-sim-cta")||startCue.animation==="none")throw new Error(`${viewport.name}: START SIM cue missing: ${JSON.stringify(startCue)}`);
    await page.hover("#camSolo");
    const startHover=await page.evaluate(()=>{const style=getComputedStyle(document.querySelector("#camSolo"));return{filter:style.filter,border:style.borderColor};});
    if(startHover.filter==="none")throw new Error(`${viewport.name}: START SIM hover feedback missing: ${JSON.stringify(startHover)}`);
    await page.click("#camSolo");
    await page.waitForFunction(()=>document.body.classList.contains("solo-flight"),{timeout:5000});
    const g=await page.evaluate(()=>{
      const rect=selector=>{const e=document.querySelector(selector),r=e?.getBoundingClientRect();return r?{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}:null;};
      return{
        width:innerWidth,height:innerHeight,
        cameraDisplay:getComputedStyle(document.querySelector("#cameraModes")).display,
        topbar:rect("#soloTopbar"),race:rect("#soloRaceHud"),left:rect("#soloLeft"),right:rect("#soloRight"),clearance:rect("#soloClearance"),arm:rect("#soloArm"),kill:rect("#soloKill"),
        armCueClass:document.querySelector("#soloArm")?.className||"",armLabel:document.querySelector("#soloArm")?.textContent?.trim()||""
      };
    });
    for(const key of ["topbar","race","left","right","clearance","arm","kill"])if(!g[key])throw new Error(`${viewport.name}: missing ${key}`);
    if(!g.armCueClass.includes("arm-start-cta"))throw new Error(`${viewport.name}: ARM start cue class missing: ${JSON.stringify({className:g.armCueClass,label:g.armLabel})}`);
    if(g.cameraDisplay!=="none")throw new Error(`${viewport.name}: legacy camera strip still visible: ${g.cameraDisplay}`);
    const expectedStickMax=viewport.height<=340?129:151;
    if(g.left.width>expectedStickMax||g.right.width>expectedStickMax)throw new Error(`${viewport.name}: sticks still dominate viewport: ${JSON.stringify({left:g.left,right:g.right})}`);
    if(g.clearance.right>=g.width*.40)throw new Error(`${viewport.name}: height control still blocks center view: ${JSON.stringify(g.clearance)}`);
    if(g.clearance.left-g.left.right<5)throw new Error(`${viewport.name}: height control overlaps left stick: ${JSON.stringify({left:g.left,clearance:g.clearance})}`);
    if(g.arm.left-g.clearance.right<20)throw new Error(`${viewport.name}: height control crowds ARM/KILL center: ${JSON.stringify({clearance:g.clearance,arm:g.arm})}`);
    if(g.right.left-g.kill.right<20)throw new Error(`${viewport.name}: center actions crowd right stick: ${JSON.stringify({kill:g.kill,right:g.right})}`);
    if(g.race.top<g.topbar.bottom-2)throw new Error(`${viewport.name}: race HUD overlaps top controls: ${JSON.stringify({topbar:g.topbar,race:g.race})}`);
    if(overlap(g.race,g.clearance)>0)throw new Error(`${viewport.name}: race HUD overlaps height control`);
    for(const key of ["left","right","clearance","arm","kill","race"]){const r=g[key];if(r.left<-1||r.right>g.width+1||r.top<-1||r.bottom>g.height+1)throw new Error(`${viewport.name}: ${key} escapes viewport: ${JSON.stringify(r)}`);}

    // Validate the ARM attention affordance independent of calibration timing.
    await page.evaluate(()=>{
      const e=document.querySelector("#soloArm");
      if(!e)throw new Error("ARM button missing");
      e.disabled=false;
      e.classList.remove("arming","armed");
      e.classList.add("attention");
      e.textContent="ARM";
    });
    const armCue=await page.evaluate(()=>{const e=document.querySelector("#soloArm"),style=getComputedStyle(e);return{text:e?.textContent?.trim()||"",className:e?.className||"",animation:style.animationName};});
    if(armCue.text!=="ARM"||!armCue.className.includes("attention")||armCue.animation==="none")throw new Error(`${viewport.name}: ARM attention cue missing: ${JSON.stringify(armCue)}`);
    const armHoverContract=await page.evaluate(()=>{
      for(const sheet of document.styleSheets){
        let rules=[];try{rules=[...sheet.cssRules];}catch{continue;}
        for(const rule of rules){
          const css=rule.cssText||"";
          if(css.includes("#soloArm:not(:disabled):hover")&&css.includes("brightness(1.16)"))return css;
        }
      }
      return "";
    });
    if(!armHoverContract)throw new Error(`${viewport.name}: ARM hover/focus CSS contract missing`);
    console.log(`Solo layout ${viewport.name} passed: START SIM + ARM cues visible, center clear, compact sticks, no duplicate camera strip.`);
  }
}finally{await browser.close();}
