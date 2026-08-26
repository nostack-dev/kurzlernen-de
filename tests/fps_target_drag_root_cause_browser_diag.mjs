import puppeteer from "puppeteer-core";

const input=process.argv[2]||"http://127.0.0.1:4174/drone_simulator.html";
const executablePath=process.env.CHROME_BIN;
if(!executablePath)throw Error("CHROME_BIN required");
const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader"]});
const page=await browser.newPage(),errors=[];
page.on("pageerror",error=>errors.push(String(error?.stack||error)));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const state=()=>page.evaluate(()=>{const v=document.querySelector("#viewport"),w=globalThis.__arondightWalkMode,p=globalThis.__arondightPlayerDamageModel,ws=globalThis.__arondightWantedSystem?.state||{};return{mode:w?.mode||"",walkDead:Boolean(w?.dead),playerHp:Number(p?.hp??v?.dataset.playerHp??-1),playerDead:Boolean(p?.dead)||v?.dataset.playerDead==="1",aimActive:v?.dataset.walkScreenAimActive||"",capture:v?.dataset.walkScreenAimCaptureState||"",release:v?.dataset.walkScreenAimRelease||"",fireResult:v?.dataset.walkTouchFireResult||"",bursts:Number(v?.dataset.walkAutoFireBursts||0),shots:Number(v?.dataset.walkEnhancedShots||0),populationHits:Number(v?.dataset.worldPopulationHits||0),ragdolls:Number(v?.dataset.worldRagdollSpawns||0),explosions:Number(v?.dataset.worldCarExplosionSpawns||0),stars:Number(v?.dataset.wantedStars||ws.stars||0),phase:v?.dataset.wantedPhase||ws.phase||"",police:Number(v?.dataset.wantedPoliceActive||ws.policeActive||0),policeShots:Number(v?.dataset.wantedPoliceShots||0),policeDamage:Number(v?.dataset.wantedPoliceDamage||0)};});
try{
  await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148");
  await page.setViewport({width:844,height:390,deviceScaleFactor:1,hasTouch:true,isMobile:true});
  await page.goto(input,{waitUntil:"load",timeout:40000});
  await page.waitForFunction(()=>document.querySelector("#status")?.textContent?.includes("SIM ready")&&globalThis.__arondightRealWorld?.threeScene&&globalThis.__arondightWalkMode&&globalThis.__arondightFootWeapons&&globalThis.__arondightPlayerDamageModel&&globalThis.__arondightWantedSystem,{timeout:40000});
  const setup=await page.evaluate(()=>{
    const b=globalThis.__arondightRealWorld,w=globalThis.__arondightWalkMode,v=document.querySelector("#viewport");
    w.setMode?.("foot",{persist:false,reason:"fps-target-root-cause-diag"});w.setPose?.({x:0,y:0,z:0,yaw:0,pitch:0});
    v.dataset.worldMode="real";b.active=true;b.originLon=9;b.originLat=47;
    const scene=b.threeScene,seen=new Map();scene.traverse(node=>{if(node?.isMesh)node.raycast=()=>{};const id=String(node?.userData?.worldPopulationId||""),kind=String(node?.userData?.worldPopulationKind||"");if(node?.isMesh&&id&&["person","car","bus"].includes(kind)&&!seen.has(id))seen.set(id,{id,kind,mesh:node});});
    const all=[...seen.values()],sequence=[...all.filter(x=>x.kind==="person").slice(0,18),...all.filter(x=>x.kind==="car").slice(0,7),...all.filter(x=>x.kind==="bus").slice(0,3)];
    if(sequence.length<20)throw Error(`insufficient procedural targets: ${sequence.length}`);
    globalThis.__fpsTargetDiag={sequence,current:null};
    const zone=document.getElementById("footLookZone"),r=zone.getBoundingClientRect();return{x:r.left+r.width*.56,y:r.top+r.height*.47,count:sequence.length};
  });
  await page.waitForFunction(()=>globalThis.__arondightWalkMode?.mode==="foot"&&document.querySelector("#viewport")?.dataset.worldProceduralPopulation==="1",{timeout:10000});
  const arm=async index=>page.evaluate(index=>{const d=globalThis.__fpsTargetDiag,v=document.querySelector("#viewport"),rec=d.sequence[index];if(!rec)return null;if(d.current)d.current.mesh.raycast=()=>{};rec.mesh.userData.flightFireIgnore=false;rec.mesh.visible=true;rec.mesh.raycast=function(raycaster,intersections){const distance=.025,point=raycaster.ray.origin.clone().addScaledVector(raycaster.ray.direction,distance);intersections.push({distance,point,object:this,face:null,faceIndex:0});};d.current=rec;const key=rec.kind==="person"?"worldRagdollSpawns":"worldCarExplosionSpawns";return{id:rec.id,kind:rec.kind,key,before:Number(v.dataset[key]||0)};},index);

  const cdp=await page.createCDPSession();let dragging=true,moveStep=0;
  await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:setup.x,y:setup.y,id:7,radiusX:4,radiusY:4,force:.7}]});
  const mover=(async()=>{while(dragging){moveStep++;await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:setup.x+(moveStep%7)-3,y:setup.y+((moveStep*2)%7)-3,id:7,radiusX:4,radiusY:4,force:.7}]}).catch(()=>{});await sleep(34);}})();
  let failure=null,last=(await state()).shots;
  for(let i=0;i<setup.count;i++){
    const target=await arm(i);if(!target)break;const deadline=performance.now()+(target.kind==="person"?2200:target.kind==="car"?3600:5200);let killed=false;
    while(performance.now()<deadline){await sleep(55);const s=await state();const deaths=Number(await page.$eval("#viewport",(v,key)=>v.dataset[key]||0,target.key));if(deaths>target.before){killed=true;console.log(`DIAG kill ${i+1}/${setup.count} ${target.kind} ${JSON.stringify(s)}`);last=s.shots;break;}if(errors.length||s.walkDead||s.playerDead||s.aimActive==="0"){failure={index:i+1,target,state:s,errors:[...errors]};break;}if(s.shots===last&&s.fireResult==="gated"){await sleep(260);const confirm=await state();if(confirm.shots===last){failure={index:i+1,target,state:confirm,errors:[...errors],gated:true};break;}}if(s.shots>last)last=s.shots;}
    if(failure)break;if(!killed){failure={index:i+1,target,state:await state(),errors:[...errors],timeout:true};break;}
  }
  const beforeProbe=await state();
  if(failure){const manual=await page.evaluate(()=>{const v=document.querySelector("#viewport"),r=v.getBoundingClientRect();try{return{result:Boolean(globalThis.__arondightFootWeapons?.fireAt?.({clientX:r.left+r.width*.12,clientY:r.top+r.height*.12,source:"diag-manual-off-target"})),error:""};}catch(error){return{result:false,error:String(error?.stack||error)};}});await sleep(120);failure.manualOffTarget=manual;failure.afterManual=await state();console.log(`ROOT_CAUSE_FAILURE ${JSON.stringify(failure)}`);}else console.log(`ROOT_CAUSE_NO_FAILURE ${JSON.stringify(beforeProbe)}`);
  dragging=false;await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]}).catch(()=>{});await mover;
  if(!failure)throw Error(`diagnostic did not reproduce FPS target drag failure across ${setup.count} targets: ${JSON.stringify(beforeProbe)}`);
  if(failure.errors?.length)console.log("ROOT_CLASS=TARGET_EXCEPTION");
  else if(failure.state?.playerDead||failure.state?.walkDead)console.log("ROOT_CLASS=PLAYER_DEATH_WANTED_DAMAGE");
  else if(failure.state?.aimActive==="0")console.log("ROOT_CLASS=INPUT_TERMINATED");
  else if(failure.state?.fireResult==="gated")console.log("ROOT_CLASS=FIREAT_GATED");
  else console.log("ROOT_CLASS=UNKNOWN");
}finally{await browser.close();}
