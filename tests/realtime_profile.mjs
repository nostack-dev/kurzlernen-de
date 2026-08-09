import puppeteer from "puppeteer-core";

const base=process.argv[2]||"http://127.0.0.1:4177";
const variants=process.argv.slice(3);
const executablePath=process.env.CHROME_BIN;
if(!executablePath)throw new Error("CHROME_BIN required");
if(!variants.length)throw new Error("profile variants required");

const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader"]});
const results=[];
try{
  for(const variant of variants){
    const page=await browser.newPage();
    await page.setViewport({width:844,height:390,deviceScaleFactor:1});
    await page.goto(`${base}/${variant}.html`,{waitUntil:"load",timeout:30000});
    await page.waitForFunction(()=>document.querySelector("#status")?.textContent?.includes("SIM ready"),{timeout:30000});
    await page.click("#camSolo");
    await page.waitForFunction(()=>document.body.classList.contains("solo-flight"),{timeout:5000});
    await new Promise(r=>setTimeout(r,600));
    const start=await page.evaluate(()=>({wall:performance.now(),sim:Number.parseFloat(document.querySelector("#simTime")?.textContent)||0}));
    await new Promise(r=>setTimeout(r,2500));
    const end=await page.evaluate(()=>({wall:performance.now(),sim:Number.parseFloat(document.querySelector("#simTime")?.textContent)||0}));
    const wall=(end.wall-start.wall)/1000,sim=end.sim-start.sim,ratio=sim/Math.max(.001,wall);
    const result={variant,wall_s:+wall.toFixed(3),sim_s:+sim.toFixed(3),ratio:+ratio.toFixed(3)};
    results.push(result);
    console.log(`PROFILE ${variant}: ${ratio.toFixed(3)}x (${sim.toFixed(3)} sim / ${wall.toFixed(3)} wall)`);
    await page.close();
  }
  console.log(`PROFILE_JSON ${JSON.stringify(results)}`);
}finally{await browser.close();}
