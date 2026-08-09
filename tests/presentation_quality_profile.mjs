import puppeteer from "puppeteer-core";

const base=process.argv[2]||"http://127.0.0.1:4178";
const variants=process.argv.slice(3);
const executablePath=process.env.CHROME_BIN;
if(!executablePath)throw new Error("CHROME_BIN required");
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const results=[];

for(const variant of variants){
  const browser=await puppeteer.launch({
    headless:true,executablePath,
    args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader"],
  });
  try{
    const page=await browser.newPage();
    await page.setViewport({width:844,height:390,deviceScaleFactor:1});
    await page.goto(`${base}/${variant}.html`,{waitUntil:"load",timeout:30000});
    await page.waitForFunction(()=>document.querySelector("#status")?.textContent.includes("SIM ready"),{timeout:30000});
    await page.click("#camSolo");
    await page.waitForFunction(()=>document.body.classList.contains("solo-flight"),{timeout:5000});
    await wait(1200);
    const start=await page.evaluate(()=>{const d=globalThis.__arondightDiagnostics;return{wall:performance.now(),sim:Number(d?.simTime),draws:Number(d?.presentationDraws||0)};});
    await wait(4000);
    const end=await page.evaluate(()=>{const d=globalThis.__arondightDiagnostics;return{wall:performance.now(),sim:Number(d?.simTime),draws:Number(d?.presentationDraws||0),backlog:Number(d?.simulationBacklogMs||0)};});
    const wall=(end.wall-start.wall)/1000,ratio=(end.sim-start.sim)/wall,draws=end.draws-start.draws,fps=draws/wall;
    const result={variant,ratio:+ratio.toFixed(3),draws,fps:+fps.toFixed(1),backlog:+end.backlog.toFixed(2)};
    results.push(result);
    console.log(`QUALITY ${variant}: ${result.ratio.toFixed(3)}x · ${result.fps.toFixed(1)} draw/s · backlog ${result.backlog.toFixed(2)} ms`);
  }finally{await browser.close();}
}
console.log(`QUALITY_JSON ${JSON.stringify(results)}`);
