import puppeteer from "puppeteer-core";

const input=process.argv[2]||"http://127.0.0.1:4174/drone_simulator.html";
const url=new URL(input,"http://127.0.0.1:4174");
const executablePath=process.env.CHROME_BIN;
if(process.env.GITHUB_SHA)url.searchParams.set("ci",process.env.GITHUB_SHA);
if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");

const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader"]});
const page=await browser.newPage();
const pageErrors=[];page.on("pageerror",e=>pageErrors.push(String(e?.stack||e)));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try{
  await page.setViewport({width:960,height:540,deviceScaleFactor:1,hasTouch:true});
  await page.goto(url.href,{waitUntil:"load",timeout:30000});
  await page.waitForFunction(()=>document.querySelector("#status")?.textContent?.includes("SIM ready")&&globalThis.__arondightWalkMode&&globalThis.__arondightFootWeapons,{timeout:30000});
  await page.evaluate(()=>{const b=globalThis.__arondightRealWorld,v=document.querySelector("#viewport");b.active=true;b.originLon=9;b.originLat=47;v.dataset.worldMode="real";globalThis.__arondightWalkMode.setMode("foot",{persist:false});globalThis.__arondightFootWeapons.setMode("pistol");});
  await page.waitForFunction(()=>document.querySelector("#viewport")?.dataset.worldProceduralPopulation==="1"&&globalThis.__arondightWalkMode?.mode==="foot",{timeout:8000});
  const baseline=await page.$eval("#viewport",v=>({hits:Number(v.dataset.worldPopulationHits||0),shots:Number(v.dataset.walkEnhancedShots||0),assignments:Number(v.dataset.combatHitStackAssignments||0)}));
  const result=await page.evaluate(async()=>{
    const wait=ms=>new Promise(r=>setTimeout(r,ms)),v=document.querySelector("#viewport"),b=globalThis.__arondightRealWorld,w=globalThis.__arondightWalkMode,weapons=globalThis.__arondightFootWeapons;
    const killedIds=new Set(),samples=[];
    function rootOf(node){for(let n=node;n;n=n.parent)if(String(n?.userData?.worldPopulationKind||"")==="person"&&n.children?.length)return n;return null;}
    function visible(node){for(let n=node;n;n=n.parent)if(n.visible===false)return false;return true;}
    function people(){const out=[],seen=new Set();b.threeScene?.traverse?.(node=>{const root=rootOf(node);if(!root||seen.has(root)||!visible(root))return;seen.add(root);const id=String(root.userData?.worldPopulationId||"");if(id&&!killedIds.has(id))out.push(root);});return out;}
    for(let i=0;i<24;i++){
      const person=people()[0];if(!person)break;const pos=person.getWorldPosition(person.position.clone()),id=String(person.userData.worldPopulationId||"");
      const px=pos.x,py=pos.y-5.2,pz=1.68,dx=pos.x-px,dy=pos.y-py,dz=(pos.z+1.05)-pz,h=Math.hypot(dx,dy),yaw=Math.atan2(dx,dy),pitch=Math.atan2(dz,h);w.setPose?.({x:px,y:py,yaw,pitch});await wait(40);
      const r=v.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2,before={i,id,hits:Number(v.dataset.worldPopulationHits||0),shots:Number(v.dataset.walkEnhancedShots||0),assignments:Number(v.dataset.combatHitStackAssignments||0),stars:Number(v.dataset.wantedStars||0)};
      let fired=false,error="";try{fired=Boolean(weapons.fireAt({clientX:cx,clientY:cy,source:"target-kill-count-smoke"}));}catch(e){error=String(e?.stack||e);}await wait(230);
      const after={hits:Number(v.dataset.worldPopulationHits||0),shots:Number(v.dataset.walkEnhancedShots||0),assignments:Number(v.dataset.combatHitStackAssignments||0),stars:Number(v.dataset.wantedStars||0),hp:v.dataset.worldObjectHp||"",kind:v.dataset.worldObjectKind||""};samples.push({before,fired,error,after});
      if(error)return{ok:false,reason:"throw",samples};if(after.hits>before.hits)killedIds.add(id);else return{ok:false,reason:"no-hit",samples};
    }
    return{ok:killedIds.size>=12,reason:killedIds.size>=12?"complete":"too-few-targets",killed:killedIds.size,samples};
  });
  const final=await page.$eval("#viewport",v=>({hits:Number(v.dataset.worldPopulationHits||0),shots:Number(v.dataset.walkEnhancedShots||0),assignments:Number(v.dataset.combatHitStackAssignments||0),stars:Number(v.dataset.wantedStars||0),ragdolls:Number(v.dataset.worldRagdolls||0),ragdollPool:Number(v.dataset.worldRagdollPool||0)}));
  console.log(JSON.stringify({baseline,result,final,pageErrors},null,2));
  if(!result.ok||pageErrors.length)throw new Error(`real target kill-count regression: ${JSON.stringify({reason:result.reason,last:result.samples.at(-1),final,pageErrors})}`);
  if(final.hits-baseline.hits<12||final.shots-baseline.shots<12)throw new Error(`insufficient real target stress: ${JSON.stringify({baseline,final})}`);
  console.log("Real target kill-count smoke passed.");
}finally{await browser.close();}
