import puppeteer from "puppeteer-core";

const executablePath=process.env.CHROME_BIN;if(!executablePath)throw Error("CHROME_BIN required");
const origin="https://kurzlernen.de";
const url=new URL(process.argv[2]||`${origin}/drone_simulator.html`);url.searchParams.set("box3d-building-fire-diag",String(Date.now()));
const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader"]});
const page=await browser.newPage(),errors=[];page.on("pageerror",e=>errors.push(String(e?.stack||e)));
await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148");await page.setViewport({width:844,height:390,deviceScaleFactor:1});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try{
  await page.goto(url.href,{waitUntil:"load",timeout:30000});
  await page.waitForFunction(()=>document.querySelector("#status")?.textContent?.includes("SIM ready")&&document.body.classList.contains("solo-flight")&&globalThis.__arondightRealWorld,{timeout:30000});
  await page.evaluate(async()=>{const b=globalThis.__arondightRealWorld;await b.activate({coords:{latitude:52.5208,longitude:13.4095,accuracy:5}});});
  await page.waitForFunction(()=>globalThis.__arondightRealWorld?.active===true&&document.querySelector("#viewport")?.dataset.worldMode==="real",{timeout:30000});
  await page.waitForFunction(()=>Number(document.querySelector("#viewport")?.dataset.worldBuildingCollisionRevision||0)>=1&&document.querySelector("#viewport")?.dataset.worldBuildingCollisionStatus==="box3d-active",{timeout:30000});
  await page.waitForFunction(()=>document.querySelector("#viewport")?.dataset.worldProceduralPopulation==="1",{timeout:15000});
  const samples=[];
  for(let round=0;round<8;round++){
    const sample=await page.evaluate(async round=>{
      const THREE=await import("three");const {Box3dHitscanWorld}=await import(`/sim/box3d_hitscan.mjs?diag=${Date.now()}-${round}`),b=globalThis.__arondightRealWorld,v=document.querySelector("#viewport"),scene=b?.threeScene,camera=b?.threeCamera,snapshot=b?.buildingCollisionSnapshot;
      if(!scene||!camera||!snapshot?.prisms?.length)return{round,error:"missing-world",revision:Number(v?.dataset.worldBuildingCollisionRevision||0),status:v?.dataset.worldBuildingCollisionStatus||""};
      scene.updateMatrixWorld(true);camera.updateMatrixWorld(true);const cam=new THREE.Vector3();camera.getWorldPosition(cam);
      const pointInTri=(x,y,p)=>{const [a,b,c]=p,sign=(p1,p2,p3)=>(p1[0]-p3[0])*(p2[1]-p3[1])-(p2[0]-p3[0])*(p1[1]-p3[1]),pt=[x,y],d1=sign(pt,a,b),d2=sign(pt,b,c),d3=sign(pt,c,a),neg=d1<0||d2<0||d3<0,pos=d1>0||d2>0||d3>0;return!(neg&&pos);};
      const containing=(p)=>snapshot.prisms.filter(pr=>p.z>=pr.base-.03&&p.z<=pr.top+.03&&pr.points?.length===3&&pointInTri(p.x,p.y,pr.points)).slice(0,4).map(pr=>pr.buildingKey||"?");
      const seen=new Map();scene.traverse(node=>{const id=String(node?.userData?.worldPopulationId||""),kind=String(node?.userData?.worldPopulationKind||"");if(!id||!["person","car","bus"].includes(kind)||seen.has(id))return;let root=node;while(root.parent&&String(root.parent?.userData?.worldPopulationId||"")===id)root=root.parent;if(root.visible===false)return;seen.set(id,{id,kind,root});});
      const world=new Box3dHitscanWorld(),rows=[];
      try{for(const rec of [...seen.values()].slice(0,40)){const target=new THREE.Vector3();rec.root.getWorldPosition(target);target.z+=rec.kind==="person"?.9:rec.kind==="bus"?1.2:.55;const delta=target.clone().sub(cam),distance=delta.length();if(distance<.5||distance>180)continue;const dir=delta.clone().normalize(),box=world.cast([cam.x,cam.y,cam.z],[dir.x,dir.y,dir.z],distance,snapshot);const ndc=target.clone().project(camera),sx=(ndc.x*.5+.5)*Math.max(1,v.clientWidth),sy=(-ndc.y*.5+.5)*Math.max(1,v.clientHeight);let map=null;if(ndc.z>=-1&&ndc.z<=1&&sx>=0&&sx<=v.clientWidth&&sy>=0&&sy<=v.clientHeight){const hit=b.addVisualShotImpact(sx,sy,{left:0,top:0,width:Math.max(1,v.clientWidth),height:Math.max(1,v.clientHeight)},{origin:cam,direction:dir});if(hit?.point){const p=hit.point;map=Math.hypot(p.x-cam.x,p.y-cam.y,p.z-cam.z);}}
        const boxDistance=box?.distanceM??null,mapDistance=Number.isFinite(map)?map:null,boxBlocks=Number.isFinite(boxDistance)&&boxDistance<distance-.05,mapBlocks=Number.isFinite(mapDistance)&&mapDistance<distance-.05,falseBlock=boxBlocks&&!mapBlocks;rows.push({id:rec.id,kind:rec.kind,distance:+distance.toFixed(3),boxDistance:Number.isFinite(boxDistance)?+boxDistance.toFixed(3):null,mapDistance:Number.isFinite(mapDistance)?+mapDistance.toFixed(3):null,boxBlocks,mapBlocks,falseBlock,targetInside:containing(target)});}
      }finally{world.dispose();}
      return{round,revision:Number(v.dataset.worldBuildingCollisionRevision||0),status:v.dataset.worldBuildingCollisionStatus||"",prisms:Number(v.dataset.worldBuildingCollisionPrisms||0),footprints:Number(v.dataset.worldBuildingCollisionFootprints||0),camera:[+cam.x.toFixed(3),+cam.y.toFixed(3),+cam.z.toFixed(3)],cameraInside:containing(cam),falseBlocks:rows.filter(r=>r.falseBlock),blocked:rows.filter(r=>r.boxBlocks).slice(0,12),rows:rows.length};
    },round);
    samples.push(sample);console.log(`ROUND ${round} ${JSON.stringify(sample)}`);await sleep(1200);
  }
  const evidence=samples.filter(s=>Array.isArray(s.falseBlocks)&&s.falseBlocks.length);
  if(evidence.length)throw Error(`ROOT_CAUSE_CONFIRMED_BOX3D_FALSE_BUILDING_BLOCK: ${JSON.stringify(evidence.slice(0,3))} pageErrors=${JSON.stringify(errors.slice(-3))}`);
  const inside=samples.filter(s=>Array.isArray(s.cameraInside)&&s.cameraInside.length);
  if(inside.length)throw Error(`ROOT_CAUSE_CONFIRMED_CAMERA_INSIDE_BUILDING_COLLIDER: ${JSON.stringify(inside.slice(0,3))} pageErrors=${JSON.stringify(errors.slice(-3))}`);
  throw Error(`NO_FALSE_BUILDING_BLOCK_FOUND_IN_SAMPLE: ${JSON.stringify(samples)} pageErrors=${JSON.stringify(errors.slice(-3))}`);
}finally{await browser.close();}
