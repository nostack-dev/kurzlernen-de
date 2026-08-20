import puppeteer from "puppeteer-core";

const input=process.argv[2]||"http://127.0.0.1:4174/drone_simulator.html",inputUrl=new URL(input,"http://127.0.0.1:4174"),url=inputUrl.pathname.endsWith("/drone_simulator.html")?new URL(inputUrl.href):new URL("/drone_simulator.html",inputUrl.origin),executablePath=process.env.CHROME_BIN;
if(process.env.GITHUB_SHA)url.searchParams.set("ci",process.env.GITHUB_SHA);if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");
const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader"]}),page=await browser.newPage();
try{
  await page.setUserAgent("Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1");
  await page.setViewport({width:1024,height:768,deviceScaleFactor:1});await page.goto(url.href,{waitUntil:"load",timeout:30000});await page.waitForFunction(()=>document.querySelector("#status")?.textContent?.includes("SIM ready"),{timeout:30000});await page.waitForFunction(()=>globalThis.__arondightRealWorld?.threeScene,{timeout:10000});
  const result=await page.evaluate(async()=>{
    const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),waitFor=async(fn,timeout=8000)=>{const end=performance.now()+timeout;while(performance.now()<end){const value=fn();if(value)return value;await sleep(30);}throw Error("ragdoll wait timeout");};
    const bridge=globalThis.__arondightRealWorld,view=document.querySelector("#viewport");bridge.active=true;bridge.originLon=9;bridge.originLat=47;bridge.minimapFeatures=[{kind:"road",geometryType:"LineString",paths:[[[9,47],[9.0015,47],[9.003,47.0002]]]}];
    await waitFor(()=>Number(view.dataset.worldTrafficRoutes||0)>=1&&typeof bridge.registerWorldPopulationHit==="function"&&bridge.threeScene.children.some(node=>node.userData?.worldPopulationKind==="person"&&node.visible));
    let personMesh=null,personGroup=null;bridge.threeScene.traverse(node=>{if(!personMesh&&node?.isMesh&&node.userData?.worldPopulationKind==="person"&&node.userData?.worldPopulationId){personMesh=node;personGroup=node.parent;}});if(!personMesh||!personGroup)throw Error("visible pedestrian missing");
    const personId=personMesh.userData.worldPopulationId,bloodBefore=Number(view.dataset.worldBloodFx||0);if(!bridge.registerWorldPopulationHit({object:personMesh}))throw Error("pedestrian shot was not accepted");
    await waitFor(()=>Number(view.dataset.worldRagdolls||0)>=1&&Number(view.dataset.worldRagdollParts||0)>=14&&Number(view.dataset.worldBloodFx||0)>bloodBefore&&bridge.threeScene.children.some(node=>node.userData?.worldRagdollRoot&&node.visible));
    const root=bridge.threeScene.children.find(node=>node.userData?.worldRagdollRoot&&node.visible),parts=[];root.traverse(node=>{if(node?.userData?.worldRagdollPart){const p={x:node.position.x,y:node.position.y,z:node.position.z};parts.push({node,p});}});if(parts.length<14)throw Error(`ragdoll has too few articulated parts: ${parts.length}`);
    const before=parts.map(item=>[item.node.position.x,item.node.position.y,item.node.position.z]);let maxMove=0;const movementDeadline=performance.now()+2500;while(performance.now()<movementDeadline&&maxMove<=.05){await sleep(120);for(let i=0;i<parts.length;i++){const node=parts[i].node;maxMove=Math.max(maxMove,Math.hypot(node.position.x-before[i][0],node.position.y-before[i][1],node.position.z-before[i][2]));}}
    const visibleOriginal=Boolean(personGroup.visible),pool=Number(view.dataset.worldRagdollPool||0),maxPool=Number(view.dataset.worldRagdollMax||0),spawns=Number(view.dataset.worldRagdollSpawns||0),active=Number(view.dataset.worldRagdolls||0),partCount=Number(view.dataset.worldRagdollParts||0),lastId=view.dataset.worldRagdollLastId||"",blood=Number(view.dataset.worldBloodFx||0);bridge.active=false;return{personId,visibleOriginal,pool,maxPool,spawns,active,partCount,lastId,maxMove,blood,bloodBefore};
  });
  if(result.visibleOriginal)throw new Error(`shot pedestrian did not hand off to ragdoll: ${JSON.stringify(result)}`);
  if(result.maxPool!==6||result.pool!==6)throw new Error(`iPad ragdoll pool is not mobile-bounded to six: ${JSON.stringify(result)}`);
  if(result.spawns<1||result.active<1||result.partCount<14||result.lastId!==result.personId)throw new Error(`articulated ragdoll did not spawn correctly: ${JSON.stringify(result)}`);
  if(result.blood<=result.bloodBefore)throw new Error(`pedestrian shot produced no blood FX: ${JSON.stringify(result)}`);
  if(!(result.maxMove>.05))throw new Error(`ragdoll did not react physically to shot/gravity: ${JSON.stringify(result)}`);
  console.log("WORLD pedestrian ragdoll browser smoke passed: iPad pool=6, 14 articulated parts, blood FX, shot impulse/gravity motion, and immediate corpse handoff.");
}finally{await browser.close();}
