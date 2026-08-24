import puppeteer from "puppeteer-core";

const input=process.argv[2]||"http://127.0.0.1:4174/drone_simulator.html",inputUrl=new URL(input,"http://127.0.0.1:4174"),url=inputUrl.pathname.endsWith("/drone_simulator.html")?new URL(inputUrl.href):new URL("/drone_simulator.html",inputUrl.origin),executablePath=process.env.CHROME_BIN;
if(process.env.GITHUB_SHA)url.searchParams.set("ci",process.env.GITHUB_SHA);if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");
const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader"]}),page=await browser.newPage();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

try{
  await page.setViewport({width:844,height:390,deviceScaleFactor:1});await page.goto(url.href,{waitUntil:"load",timeout:30000});await page.waitForFunction(()=>document.querySelector("#status")?.textContent?.includes("SIM ready")&&globalThis.__arondightWantedSystem,{timeout:30000});
  const crime=await page.evaluate(async()=>{
    const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),view=document.querySelector("#viewport"),b=globalThis.__arondightRealWorld;view.dataset.worldMode="real";b.active=true;b.originLon=9;b.originLat=47;
    const deadline=performance.now()+8000;while(performance.now()<deadline&&!(view.dataset.worldProceduralPopulation==="1"&&typeof b.registerWorldPopulationHit==="function"))await wait(40);
    let person=null;b.threeScene.traverse(node=>{if(!person&&node.isMesh&&node.visible!==false&&node.userData?.worldProceduralId&&node.userData?.worldPopulationKind==="person")person=node;});
    if(!person)throw new Error("no procedural person target");b.registerWorldPopulationHit({object:person,point:person.getWorldPosition(person.position.clone())});
    const wantedDeadline=performance.now()+3500;while(performance.now()<wantedDeadline&&Number(view.dataset.wantedPoliceActive||0)<1)await wait(30);
    return{heat:Number(view.dataset.wantedHeat||0),stars:Number(view.dataset.wantedStars||0),phase:view.dataset.wantedPhase,police:Number(view.dataset.wantedPoliceActive||0),hud:!document.querySelector("#wantedHud")?.hidden,system:view.dataset.wantedSystem};
  });
  if(crime.heat!==2||crime.stars!==1||crime.phase!=="pursuit"||crime.police!==1||!crime.hud||crime.system!=="heat+search+police-drones-v1")throw new Error(`civilian crime did not start police pursuit: ${JSON.stringify(crime)}`);

  const retaliation=await page.evaluate(async()=>{
    const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),view=document.querySelector("#viewport"),b=globalThis.__arondightRealWorld;let hitbox=null;b.threeScene.traverse(node=>{if(!hitbox&&node.isMesh&&node.visible!==false&&node.userData?.worldPopulationKind==="police-drone")hitbox=node;});if(!hitbox)throw new Error("police hitbox not found");
    const results=[];for(let i=0;i<3;i++)results.push(Boolean(b.registerPoliceHit?.({object:hitbox,point:hitbox.getWorldPosition(hitbox.position.clone())})));
    const deadline=performance.now()+4500;while(performance.now()<deadline&&(Number(view.dataset.wantedStars||0)<2||Number(view.dataset.wantedPoliceActive||0)<1||Number(view.dataset.wantedPoliceShotsHit||0)<1))await wait(30);
    return{results,stars:Number(view.dataset.wantedStars||0),kills:Number(view.dataset.wantedPoliceKills||0),hits:Number(view.dataset.wantedPoliceHits||0),active:Number(view.dataset.wantedPoliceActive||0),shots:Number(view.dataset.wantedPoliceShots||0),damage:Number(view.dataset.wantedPoliceDamage||0)};
  });
  if(retaliation.results.some(value=>!value)||retaliation.stars<2||retaliation.kills!==1||retaliation.hits!==3||retaliation.active<1||retaliation.shots<1||retaliation.damage<1)throw new Error(`police drones were not shootable, attacking and escalating: ${JSON.stringify(retaliation)}`);

  await page.evaluate(async()=>{
    const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),api=globalThis.__arondightWantedSystem,walk=globalThis.__arondightWalkMode,view=document.querySelector("#viewport");api.clear("reset");api.reportCrime({id:"escape-smoke-person",kind:"person"});walk.setMode("foot",{persist:false});const deadline=performance.now()+2500;while(performance.now()<deadline&&view.dataset.playerVehicleMode!=="human")await wait(30);walk.setPose({x:500,y:500,yaw:0,pitch:0});
  });
  await page.waitForFunction(()=>document.querySelector("#viewport")?.dataset.wantedPhase==="searching",{timeout:5000});
  await page.waitForFunction(()=>document.querySelector("#viewport")?.dataset.wantedStars==="0"&&document.querySelector("#viewport")?.dataset.wantedLastClear==="escaped",{timeout:12000});
  const escaped=await page.evaluate(()=>{const view=document.querySelector("#viewport"),state=globalThis.__arondightWantedSystem.state;return{stars:Number(view.dataset.wantedStars||0),phase:view.dataset.wantedPhase,active:Number(view.dataset.wantedPoliceActive||0),clear:view.dataset.wantedLastClear,state};});
  if(escaped.stars!==0||escaped.phase!=="clear"||escaped.active!==0||escaped.clear!=="escaped"||escaped.state.stars!==0)throw new Error(`wanted pursuit was not escapable: ${JSON.stringify(escaped)}`);
  console.log("Wanted police smoke passed: civilian kill raised a star, shootable police drones escalated, pursued/attacked, searched, and could be escaped.");
}finally{await sleep(50);await browser.close();}
