import puppeteer from "puppeteer-core";

const input=process.argv[2]||"https://kurzlernen.de/drone_simulator.html",url=new URL(input),executablePath=process.env.CHROME_BIN;
// This smoke covers the drone start; the game itself starts on foot by default.
if(!url.searchParams.has("start"))url.searchParams.set("start","drone");
if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");
const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader"]}),page=await browser.newPage(),errors=[];
page.on("pageerror",error=>errors.push(error.message));
try{
  await page.setViewport({width:1440,height:900,deviceScaleFactor:1});
  await page.goto(url.href,{waitUntil:"load",timeout:45000});
  await page.waitForFunction(()=>document.querySelector("#status")?.textContent?.includes("SIM ready")&&document.body.classList.contains("solo-flight")&&globalThis.__arondightDroneWeapons?.setMode&&document.querySelectorAll("#desktopDroneWeaponSwitch button").length===2,{timeout:45000});
  const initial=await page.evaluate(()=>{const group=document.querySelector("#desktopDroneWeaponSwitch"),buttons=[...group.querySelectorAll("button")],stop=document.querySelector("#soloKill"),ss=getComputedStyle(stop),gr=group.getBoundingClientRect();return{groupDisplay:getComputedStyle(group).display,groupWidth:gr.width,buttons:buttons.map(b=>({text:b.textContent.trim(),pressed:b.getAttribute("aria-pressed"),display:getComputedStyle(b).display})),stop:{text:stop?.textContent?.trim(),display:ss.display,align:ss.alignItems,justify:ss.justifyContent,textAlign:ss.textAlign}};});
  if(initial.groupDisplay==="none"||initial.groupWidth<150||initial.buttons.map(b=>b.text).join(",")!=="GUN,ROCKETS")throw new Error(`desktop weapon selector is not visibly exposed: ${JSON.stringify(initial)}`);
  if(!(initial.stop.text==="STOP"&&initial.stop.align==="center"&&initial.stop.justify==="center"&&initial.stop.textAlign==="center"))throw new Error(`STOP control is not compact/centered: ${JSON.stringify(initial.stop)}`);
  for(const mode of["gun","missile"]){await page.click(`#desktopDroneWeaponSwitch [data-drone-weapon="${mode}"]`);await page.waitForFunction(expected=>String(globalThis.__arondightDroneWeapons?.displayMode||globalThis.__arondightDroneWeapons?.mode)===expected&&document.querySelector(`#desktopDroneWeaponSwitch [data-drone-weapon="${expected}"]`)?.getAttribute("aria-pressed")==="true",{timeout:4000},mode);}
  await page.evaluate(()=>{const api=globalThis.__arondightWantedSystem;api?.clear?.("desktop-ui-test");api?.reportCrime?.({id:"desktop-emp-ui",kind:"car",severity:5});});
  await page.waitForFunction(()=>{const b=document.querySelector("#wantedEmpButton");return b&&!b.hidden&&getComputedStyle(b).display!=="none";},{timeout:8000});
  const emp=await page.$eval("#wantedEmpButton",b=>{const r=b.getBoundingClientRect(),s=getComputedStyle(b);return{width:r.width,height:r.height,display:s.display,align:s.alignItems,justify:s.justifyContent,strong:b.querySelector("strong")?.textContent?.trim(),small:b.querySelector("small")?.textContent?.trim()};});
  if(!(emp.width<=80&&emp.height<=50&&emp.width>=60&&emp.height>=36&&emp.display==="flex"&&emp.align==="center"&&emp.justify==="center"&&emp.strong==="EMP"))throw new Error(`EMP control is still oversized or misaligned: ${JSON.stringify(emp)}`);
  const readonlyErrors=errors.filter(text=>/read only property ['\"]setTarget|Cannot assign to read only property ['\"]setTarget/i.test(text));if(readonlyErrors.length)throw new Error(`readonly setTarget runtime crash reached desktop: ${JSON.stringify(readonlyErrors)}`);
  console.log(`Desktop controls regression passed. ${JSON.stringify({initial,emp})}`);
}finally{await browser.close();}
