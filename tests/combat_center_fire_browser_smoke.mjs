import puppeteer from "puppeteer-core";

const executablePath=process.env.CHROME_BIN;if(!executablePath)throw Error("CHROME_BIN required");
const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader"]});
const page=await browser.newPage();const pageErrors=[];page.on("pageerror",e=>pageErrors.push(String(e?.stack||e)));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try{
  await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148");
  await page.setViewport({width:844,height:390,deviceScaleFactor:1});
  await page.goto(`https://kurzlernen.de/drone_simulator.html?real-drag-target-diag=${Date.now()}`,{waitUntil:"load",timeout:30000});
  await page.waitForFunction(()=>document.querySelector("#status")?.textContent?.includes("SIM ready")&&globalThis.__arondightRealWorld?.threeScene&&globalThis.__arondightRealWorld?.threeCamera,{timeout:30000});
  await page.evaluate(()=>{const b=globalThis.__arondightRealWorld,v=document.querySelector("#viewport");v.dataset.worldMode="real";b.active=true;b.originLon=9;b.originLat=47;});
  await page.waitForFunction(()=>document.querySelector("#viewport")?.dataset.worldProceduralPopulation==="1",{timeout:10000});

  const setup=await page.evaluate(()=>{
    const b=globalThis.__arondightRealWorld,scene=b.threeScene,camera=b.threeCamera,v=document.querySelector("#viewport"),seen=new Map();let sphere=null;
    scene.traverse(node=>{const id=String(node?.userData?.worldPopulationId||""),kind=String(node?.userData?.worldPopulationKind||""),type=String(node?.geometry?.type||"");if(node?.isMesh&&id&&["person","car","bus"].includes(kind)&&!seen.has(id))seen.set(id,{id,kind});if(!sphere&&node?.isMesh&&kind==="person"&&type.includes("Sphere"))sphere=node;});
    if(!sphere)throw Error("diagnostic requires one procedural person sphere mesh");
    const all=[...seen.values()],sequence=[...all.filter(x=>x.kind==="person").slice(0,10),...all.filter(x=>x.kind==="car").slice(0,6),...all.filter(x=>x.kind==="bus").slice(0,3)];
    if(sequence.filter(x=>x.kind==="person").length<10||sequence.filter(x=>x.kind==="car").length<6||sequence.filter(x=>x.kind==="bus").length<3)throw Error(`insufficient diagnostic targets ${JSON.stringify(sequence)}`);
    scene.traverse(node=>{if(node?.isMesh)node.userData.flightFireIgnore=true;});
    globalThis.__targetDragDiag={template:sphere,sequence,index:-1,proxy:null};
    const place=()=>{const d=globalThis.__targetDragDiag,p=d?.proxy;if(!p?.parent)return;const dir=camera.position.clone();camera.getWorldDirection(dir);p.position.copy(camera.position).addScaledVector(dir,2.2);p.quaternion.copy(camera.quaternion);p.updateMatrixWorld(true);requestAnimationFrame(place);};requestAnimationFrame(place);
    const rect=v.getBoundingClientRect(),rotated=v.dataset.soloOrientation==="css-landscape";function clientForAim(dx=0,dy=0){const x=v.clientWidth/2+dx,y=v.clientHeight/2+dy;return rotated?{clientX:rect.right-y,clientY:rect.top+x}:{clientX:rect.left+x,clientY:rect.top+y};}
    const p=clientForAim();v.dataset.diagClientX=String(p.clientX);v.dataset.diagClientY=String(p.clientY);v.dataset.diagRotated=rotated?"1":"0";
    return{sequence,rotated,client:p,clientWidth:v.clientWidth,clientHeight:v.clientHeight,rect:{left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,width:rect.width,height:rect.height}};
  });
  console.log("TARGET_DRAG_SETUP",JSON.stringify(setup));

  const initial=await page.evaluate(()=>{const v=document.querySelector("#viewport"),x=Number(v.dataset.diagClientX),y=Number(v.dataset.diagClientY);v.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,cancelable:true,pointerId:188,pointerType:"touch",clientX:x,clientY:y,button:0,buttons:1,isPrimary:true}));return{shots:Number(v.dataset.fireShots||0),rays:Number(v.dataset.fireRaycastShots||0),hits:Number(v.dataset.worldPopulationHits||0),source:v.dataset.fireInputSource||"",candidateCount:Number(v.dataset.fireCandidateCount||0)};});
  await sleep(150);

  const stages=[];let failed=null;
  for(let n=0;n<setup.sequence.length;n++){
    const rec=setup.sequence[n];
    const before=await page.evaluate(({rec,n})=>{const b=globalThis.__arondightRealWorld,scene=b.threeScene,v=document.querySelector("#viewport"),d=globalThis.__targetDragDiag;if(d.proxy?.parent)d.proxy.parent.remove(d.proxy);const proxy=d.template.clone(false);proxy.name=`TARGET_DRAG_DIAG_${n}_${rec.kind}`;proxy.userData={...proxy.userData,worldPopulationKind:rec.kind,worldPopulationId:rec.id,worldProceduralId:rec.id,flightFireIgnore:false};proxy.visible=true;proxy.frustumCulled=false;proxy.scale.setScalar(8);scene.add(proxy);d.proxy=proxy;const signal=rec.kind==="person"?"worldRagdollSpawns":"worldCarExplosionSpawns";return{signal,signalValue:Number(v.dataset[signal]||0),shots:Number(v.dataset.fireShots||0),rays:Number(v.dataset.fireRaycastShots||0),hits:Number(v.dataset.worldPopulationHits||0),source:v.dataset.fireInputSource||"",routeErrors:Number(v.dataset.fireTargetRouteErrors||0),assignments:Number(v.dataset.combatHitStackAssignments||0)};},{rec,n});
    const deadline=Date.now()+(rec.kind==="person"?1800:rec.kind==="car"?2600:3600);let tick=0,done=false,last=null;
    while(Date.now()<deadline){
      await page.evaluate(({tick})=>{const v=document.querySelector("#viewport"),r=v.getBoundingClientRect(),rotated=v.dataset.soloOrientation==="css-landscape",dx=((tick%5)-2)*2.2,dy=(((tick*3)%5)-2)*1.8,x=v.clientWidth/2+dx,y=v.clientHeight/2+dy,p=rotated?{clientX:r.right-y,clientY:r.top+x}:{clientX:r.left+x,clientY:r.top+y};v.dispatchEvent(new PointerEvent("pointermove",{bubbles:true,cancelable:true,pointerId:188,pointerType:"touch",clientX:p.clientX,clientY:p.clientY,button:-1,buttons:1,isPrimary:true}));},{tick});
      await sleep(45);tick++;
      last=await page.$eval("#viewport",(v,signal)=>({signalValue:Number(v.dataset[signal]||0),shots:Number(v.dataset.fireShots||0),rays:Number(v.dataset.fireRaycastShots||0),hits:Number(v.dataset.worldPopulationHits||0),source:v.dataset.fireInputSource||"",routeErrors:Number(v.dataset.fireTargetRouteErrors||0),assignments:Number(v.dataset.combatHitStackAssignments||0),candidates:Number(v.dataset.fireCandidateCount||0),ragdolls:Number(v.dataset.worldRagdolls||0),ragdollPool:Number(v.dataset.worldRagdollPool||0),explosions:Number(v.dataset.worldCarExplosions||0),explosionPool:Number(v.dataset.worldCarExplosionPool||0)},before.signal);
      if(last.signalValue>before.signalValue){done=true;break;}
    }
    const stage={n:n+1,total:setup.sequence.length,id:rec.id,kind:rec.kind,before,last,done,pageErrors:pageErrors.slice(-2)};stages.push(stage);console.log("TARGET_DRAG_STAGE",JSON.stringify(stage));
    if(!done){failed=stage;break;}
  }

  const final=await page.evaluate(()=>{const v=document.querySelector("#viewport"),x=Number(v.dataset.diagClientX),y=Number(v.dataset.diagClientY);v.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,cancelable:true,pointerId:188,pointerType:"touch",clientX:x,clientY:y,button:0,buttons:0,isPrimary:true}));return{shots:Number(v.dataset.fireShots||0),rays:Number(v.dataset.fireRaycastShots||0),hits:Number(v.dataset.worldPopulationHits||0),source:v.dataset.fireInputSource||"",routeErrors:Number(v.dataset.fireTargetRouteErrors||0),assignments:Number(v.dataset.combatHitStackAssignments||0),ragdollSpawns:Number(v.dataset.worldRagdollSpawns||0),ragdollPool:Number(v.dataset.worldRagdollPool||0),explosionSpawns:Number(v.dataset.worldCarExplosionSpawns||0),explosionPool:Number(v.dataset.worldCarExplosionPool||0),candidateCount:Number(v.dataset.fireCandidateCount||0)};});
  const result={initial,completed:stages.filter(s=>s.done).length,total:setup.sequence.length,failed,final,pageErrors:pageErrors.slice(-6)};
  console.log("TARGET_REAL_DRAG_RESULT",JSON.stringify(result));
  throw Error(`TARGET_REAL_DRAG_DIAG ${JSON.stringify(result)}`);
}finally{await browser.close();}
