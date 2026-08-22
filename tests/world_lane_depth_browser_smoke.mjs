import puppeteer from "puppeteer-core";

const input=process.argv[2]||"http://127.0.0.1:4174/drone_simulator.html",inputUrl=new URL(input,"http://127.0.0.1:4174"),url=inputUrl.pathname.endsWith("/drone_simulator.html")?new URL(inputUrl.href):new URL("/drone_simulator.html",inputUrl.origin),executablePath=process.env.CHROME_BIN;
if(process.env.GITHUB_SHA)url.searchParams.set("ci",process.env.GITHUB_SHA);if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");
const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader"]}),page=await browser.newPage();
try{
  await page.setViewport({width:844,height:390,deviceScaleFactor:1});await page.goto(url.href,{waitUntil:"load",timeout:30000});await page.waitForFunction(()=>document.querySelector("#status")?.textContent?.includes("SIM ready"),{timeout:30000});await page.waitForFunction(()=>globalThis.__arondightRealWorld?.threeScene,{timeout:10000});
  const result=await page.evaluate(async()=>{
    const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),waitFor=async(fn,timeout=9000)=>{const end=performance.now()+timeout;while(performance.now()<end){const value=fn();if(value)return value;await sleep(30);}throw Error("WORLD lane/depth wait timeout");};
    const b=globalThis.__arondightRealWorld,view=document.querySelector("#viewport"),paint=new Map([["fill-extrusion-opacity",.42],["fill-extrusion-color",["case",true,"rgba(100,120,130,0.15)","#11223344"]]]);
    b.active=true;b.originLon=9;b.originLat=47;b.map={getStyle:()=>({layers:[{id:"transportation",type:"line","source-layer":"transportation"},{id:"arondight45-buildings-3d",type:"fill-extrusion","source-layer":"building"}]}),getLayer:()=>({}),queryRenderedFeatures:()=>[],getPaintProperty:(_id,key)=>paint.get(key),setPaintProperty:(_id,key,value)=>paint.set(key,value)};
    b.minimapFeatures=[{kind:"road",geometryType:"LineString",paths:[[[9,47],[9.00027,47]]],roadClass:"residential"}];
    b.buildingCollisionSnapshot=Object.freeze({hash:"lane-depth-browser",footprintCount:1,prismCount:1,prisms:[{buildingKey:"test-house",base:0,top:8,points:[[4,-2],[8,-2],[8,2],[4,2]]}]});
    const car=await waitFor(()=>{if(view.dataset.worldBuildingOcclusion!=="depth-active")return null;return b.threeScene.children.find(node=>node.userData?.worldPopulationKind==="car"&&node.visible)||null;});
    const ys=[],xs=[],yaws=[];for(let i=0;i<125;i++){ys.push(car.position.y);xs.push(car.position.x);yaws.push(car.rotation.z);await sleep(40);}const lateralRange=Math.max(...ys)-Math.min(...ys),travelRange=Math.max(...xs)-Math.min(...xs);
    const depth=b.threeScene.children.find(node=>node.userData?.worldBuildingDepthOccluder),color=paint.get("fill-extrusion-color"),opacity=paint.get("fill-extrusion-opacity"),depthPrisms=Number(depth?.userData?.worldBuildingDepthPrisms)||0,depthVisible=Boolean(depth?.visible),colorWrite=depth?.material?.colorWrite;
    b.active=false;return{carId:car.userData.worldPopulationId||"",lateralRange,travelRange,opacity,color,depthPrisms,depthVisible,colorWrite,depthState:view.dataset.worldBuildingOcclusion||"",cachedRoutes:Number(view.dataset.worldTrafficCachedRoutes||0)};
  });
  if(!result.carId||result.cachedRoutes<1||!(result.travelRange>8))throw new Error(`traffic did not stay active on the test road: ${JSON.stringify(result)}`);
  if(result.lateralRange>.24)throw new Error(`car changed physical lane at road U-turn: ${JSON.stringify(result)}`);
  if(result.opacity!==1||JSON.stringify(result.color).includes("rgba")||JSON.stringify(result.color).includes("#11223344"))throw new Error(`building color/opacity remained translucent: ${JSON.stringify(result)}`);
  if(result.depthState!=="depth-active"||!result.depthVisible||result.depthPrisms!==1||result.colorWrite!==false)throw new Error(`Three.js building depth occlusion missing: ${JSON.stringify(result)}`);
  console.log(`WORLD lane/depth browser smoke passed: stable U-turn lane (${result.lateralRange.toFixed(3)} m lateral range), solid MapLibre buildings and depth-only Three.js occlusion.`);
}finally{await browser.close();}
