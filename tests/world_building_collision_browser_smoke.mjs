import puppeteer from "puppeteer-core";
import {readFileSync} from "node:fs";
import {installDeterministicWorldFixture} from "./world_browser_fixture.mjs";

const base=process.argv[2]||"http://127.0.0.1:4174";
const executablePath=process.env.CHROME_BIN;
if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");
const bootstrap=readFileSync("sim/real_world_bootstrap.mjs","utf8"),simulator=readFileSync("sim/simulator.mjs","utf8");
for(const marker of ["buildingFootprintsFromFeatures","buildingCollisionPrismsFromFootprints","attachBuildingCollisionSink","querySourceFeatures","worldBuildingCollisionStatus","terrainHeightAt(this.terrainSnapshot"])
  if(!bootstrap.includes(marker))throw new Error(`WORLD building bridge contract missing: ${marker}`);
for(const marker of ["createWorldBuildingCollisionBodies","setWorldBuildingCollisions","worldBuildingCollisionPrisms"])
  if(!simulator.includes(marker))throw new Error(`WORLD Box3D binding contract missing: ${marker}`);

const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader"]});
const page=await browser.newPage();
await installDeterministicWorldFixture(page,{base,styleName:"WORLD collision fixture"});

try{
  await page.setViewport({width:844,height:390,deviceScaleFactor:1});await page.goto(`${base}/drone_simulator.html`,{waitUntil:"load",timeout:30000});
  await page.waitForFunction(()=>document.querySelector("#status")?.textContent.includes("SIM ready"),{timeout:30000});
  await page.waitForFunction(()=>{const v=document.querySelector("#viewport"),b=globalThis.__arondightRealWorld;return v?.dataset.worldMode==="real"&&v?.dataset.worldTerrainStatus==="box3d-active"&&b?.map&&b?.terrainSnapshot;},{timeout:30000});
  const installed=await page.evaluate(()=>{
    const bridge=globalThis.__arondightRealWorld,map=bridge.map,viewport=document.querySelector("#viewport"),diagnostics=globalThis.__arondightDiagnostics;
    const radius=6378137,cosLat=Math.max(.01,Math.cos(bridge.originLat*Math.PI/180)),ll=(east,north)=>[bridge.originLon+east/radius/cosLat*180/Math.PI,bridge.originLat+north/radius*180/Math.PI];
    const ring=[ll(8,-2),ll(12,-2),ll(12,2),ll(8,2),ll(8,-2)],feature={id:987654,properties:{render_height:9,render_min_height:1},geometry:{type:"Polygon",coordinates:[ring]}},courtyard={id:987655,properties:{render_height:12},geometry:{type:"Polygon",coordinates:[[ll(20,-5),ll(30,-5),ll(30,5),ll(20,5),ll(20,-5)],[ll(22,-3),ll(22,3),ll(28,3),ll(28,-3),ll(22,-3)]]}};
    const originalSourceId=bridge.buildingSourceId,original=map.querySourceFeatures?.bind(map);bridge.buildingSourceId="fixture-buildings";map.querySourceFeatures=()=>[feature,courtyard];bridge.buildingCollisionDirty=true;const changed=bridge.syncBuildingCollisions(true);map.querySourceFeatures=original;bridge.buildingSourceId=originalSourceId;
    return{changed,status:viewport.dataset.worldBuildingCollisionStatus,terrain:viewport.dataset.worldTerrainStatus,footprints:Number(viewport.dataset.worldBuildingCollisionFootprints),prisms:Number(viewport.dataset.worldBuildingCollisionPrisms),physicsPrisms:Number(diagnostics.worldBuildingCollisionPrisms),revision:Number(diagnostics.worldBuildingCollisionRevision)};
  });
  if(!installed.changed||installed.terrain!=="box3d-active"||installed.status!=="box3d-active"||installed.footprints!==2||installed.prisms!==9||installed.physicsPrisms!==9)throw new Error(`OSM + DEM → bridge → Box3D installation failed: ${JSON.stringify(installed)}`);
  const debugDefault=await page.evaluate(()=>({enabled:globalThis.__arondightDiagnostics.box3dColliderDebugEnabled,prisms:globalThis.__arondightDiagnostics.box3dColliderDebugPrisms,dataset:document.querySelector("#viewport")?.dataset.box3dColliderDebugDraw,toggle:document.querySelector("[data-box3d-collider-debug]")?.checked,stored:localStorage.getItem("arondight45Box3dColliderDebugV1")}));
  if(debugDefault.enabled!==false||debugDefault.prisms!==0||debugDefault.dataset!=="0"||debugDefault.toggle!==false||debugDefault.stored!=="0")throw new Error(`Box3D collider debug draw is not default OFF: ${JSON.stringify(debugDefault)}`);
  await page.evaluate(()=>{const toggle=document.querySelector("[data-box3d-collider-debug]");if(!toggle)throw new Error("Box3D collider debug toggle missing");toggle.checked=true;toggle.dispatchEvent(new Event("change",{bubbles:true}));});
  await page.waitForFunction(()=>globalThis.__arondightDiagnostics.box3dColliderDebugEnabled===true&&globalThis.__arondightDiagnostics.box3dColliderDebugPrisms===9&&document.querySelector("#viewport")?.dataset.box3dColliderDebugDraw==="1",{timeout:5000});
  const debugOn=await page.evaluate(()=>({enabled:globalThis.__arondightDiagnostics.box3dColliderDebugEnabled,prisms:globalThis.__arondightDiagnostics.box3dColliderDebugPrisms,stored:localStorage.getItem("arondight45Box3dColliderDebugV1")}));
  if(!debugOn.enabled||debugOn.prisms!==9||debugOn.stored!=="1")throw new Error(`Box3D collider debug draw did not expose active collision prisms: ${JSON.stringify(debugOn)}`);
  await page.evaluate(()=>{const toggle=document.querySelector("[data-box3d-collider-debug]");toggle.checked=false;toggle.dispatchEvent(new Event("change",{bubbles:true}));});
  await page.waitForFunction(()=>globalThis.__arondightDiagnostics.box3dColliderDebugEnabled===false&&document.querySelector("#viewport")?.dataset.box3dColliderDebugDraw==="0",{timeout:5000});

  await page.click("#soloReset");await page.waitForFunction(previous=>globalThis.__arondightDiagnostics.worldBuildingCollisionRevision>previous&&globalThis.__arondightDiagnostics.worldBuildingCollisionPrisms===9,{timeout:5000},installed.revision);
  const afterReset=await page.evaluate(()=>({prisms:Number(globalThis.__arondightDiagnostics.worldBuildingCollisionPrisms),revision:Number(globalThis.__arondightDiagnostics.worldBuildingCollisionRevision)}));
  if(afterReset.prisms!==9||afterReset.revision<=installed.revision)throw new Error(`building colliders did not survive RESET: ${JSON.stringify({installed,afterReset})}`);

  const cleared=await page.evaluate(()=>{globalThis.__arondightRealWorld.deactivate();return{mode:document.querySelector("#viewport")?.dataset.worldMode,prisms:Number(globalThis.__arondightDiagnostics.worldBuildingCollisionPrisms),footprints:Number(globalThis.__arondightDiagnostics.worldBuildingCollisionFootprints)};});
  if(cleared.mode!=="training"||cleared.prisms!==0||cleared.footprints!==0)throw new Error(`WORLD building collider teardown failed: ${JSON.stringify(cleared)}`);
  console.log(`WORLD browser collision pipeline passed on mandatory DEM terrain: convex house + open courtyard installed as ${installed.physicsPrisms} Box3D prisms, survived RESET and cleared on TRAINING: ${JSON.stringify({installed,afterReset,cleared})}`);
}finally{await browser.close();}
