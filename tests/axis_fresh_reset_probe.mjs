import puppeteer from "puppeteer-core";

const base=process.argv[2]||"http://127.0.0.1:4180";
const executablePath=process.env.CHROME_BIN;
if(!executablePath)throw new Error("CHROME_BIN required");
const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader"]});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function simTime(page){return page.evaluate(()=>Number(globalThis.__arondightDiagnostics?.simTime)||0);}
async function waitSim(page,target,timeout=60000){await page.waitForFunction(t=>Number(globalThis.__arondightDiagnostics?.simTime)>=t,{timeout},target);}
async function sample(page){return page.evaluate(async()=>{const original=URL.createObjectURL;let captured=null;URL.createObjectURL=blob=>{captured=blob;return original.call(URL,blob);};try{document.querySelector("#exportLog")?.click();await new Promise(r=>setTimeout(r,0));const log=JSON.parse(await captured.text()),s=log.samples.at(-1);return s;}finally{URL.createObjectURL=original;}});}
function body(s){const yaw=(Number(s.yaw_deg)||0)*Math.PI/180,c=Math.cos(yaw),si=Math.sin(yaw),vx=+s.vx||0,vy=+s.vy||0;return{t:+s.time_s,forward:-c*vx-si*vy,right:-si*vx+c*vy,speed:Math.hypot(vx,vy),roll:+s.roll_deg,pitch:+s.pitch_deg,fcRoll:+s.fc_roll_deg,fcPitch:+s.fc_pitch_deg,motors:[+s.motor1_us,+s.motor2_us,+s.motor3_us,+s.motor4_us]};}
async function stick(page,axis,fraction=.70){const b=await page.$eval("#soloLeft",e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};}),r=Math.min(b.w,b.h)*.42,cx=b.x+b.w/2,cy=b.y+b.h/2;await page.mouse.move(cx,cy);await page.mouse.down();if(axis==="forward")await page.mouse.move(cx,cy-r*fraction,{steps:1});else await page.mouse.move(cx+r*fraction,cy,{steps:1});return async()=>{await page.mouse.up();};}
async function run(axis){
  const page=await browser.newPage();await page.setViewport({width:844,height:390,deviceScaleFactor:1});
  await page.goto(`${base}/drone_simulator.html`,{waitUntil:"load",timeout:30000});
  await page.waitForFunction(()=>document.querySelector("#status")?.textContent.includes("SIM ready"),{timeout:30000});
  await page.evaluate(()=>{localStorage.clear();localStorage.setItem("arondight45PhoneControlSettingsV5",JSON.stringify({leftFineness:10,rightFineness:10,lockLeftHorizontal:false,lockRightHorizontal:false,invertLeftHorizontal:false,invertRightHorizontal:false,invertRightVertical:true,defaultHoverAgl:1.2}));});
  await page.click("#camSolo");await page.waitForFunction(()=>document.body.classList.contains("solo-flight"),{timeout:5000});
  await waitSim(page,2.2,60000);await page.waitForFunction(()=>{const b=document.querySelector("#soloArm");return document.querySelector("#fcState")?.textContent==="DISARMED"&&b&&!b.disabled;},{timeout:15000});
  const armStart=await simTime(page);await page.click("#soloArm");await page.waitForFunction(()=>document.querySelector("#fcState")?.textContent==="ARMED",{timeout:15000});
  const armAt=await simTime(page);
  await page.waitForFunction(()=>{const z=parseFloat(document.querySelector("#altitude")?.textContent||"0"),v=parseFloat(document.querySelector("#velocity")?.textContent||"99");return z>1.0&&z<1.45&&v<.24;},{timeout:90000});
  const settled=body(await sample(page)),release=await stick(page,axis,.70),start=await simTime(page),trace=[];
  for(const dt of [.20,.40,.60,.80,1.00,1.25]){await waitSim(page,start+dt,30000);trace.push({dt,...body(await sample(page))});}
  await release();const out={axis,armDuration:armAt-armStart,settled,trace};await page.close();return out;
}
try{
  const forward=await run("forward"),right=await run("right");
  console.log("AXIS_FRESH_RESET "+JSON.stringify({forward,right}));
  const f=forward.trace.find(x=>x.dt===1)?.forward??0,r=right.trace.find(x=>x.dt===1)?.right??0;
  const fp=Math.abs(forward.trace.find(x=>x.dt===.6)?.pitch??0),rr=Math.abs(right.trace.find(x=>x.dt===.6)?.roll??0);
  console.log(`AXIS_COMPARE 1s forward=${f.toFixed(4)} right=${r.toFixed(4)} ratio=${(f/r).toFixed(3)} · 0.6s |pitch|=${fp.toFixed(3)} |roll|=${rr.toFixed(3)} ratio=${(fp/rr).toFixed(3)}`);
}finally{await browser.close();}
