import puppeteer from "puppeteer-core";

const base=process.argv[2]||"http://127.0.0.1:4174";
const executablePath=process.env.CHROME_BIN;
if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");
const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader"]});
const page=await browser.newPage();
try{
  await page.setViewport({width:844,height:390,deviceScaleFactor:1});
  await page.goto(`${base}/drone_simulator.html`,{waitUntil:"load",timeout:30000});
  await page.waitForFunction(()=>document.querySelector("#status")?.textContent?.includes("SIM ready"),{timeout:30000});
  await page.waitForFunction(()=>document.body.classList.contains("solo-flight")&&globalThis.__arondightRealWorld?.threeScene,{timeout:10000});
  await page.waitForFunction(()=>document.querySelector("#viewport")?.dataset.vsCombatPresentation==="1",{timeout:10000});
  const result=await page.evaluate(()=>{
    const bridge=globalThis.__arondightRealWorld,viewport=document.querySelector("#viewport"),sent=[];
    bridge.vsConnected=true;bridge.vsSession={sendCombat(packet){sent.push(JSON.parse(JSON.stringify(packet)));return true;},stop(){}};bridge.resetVsCombat(true);bridge.ensureVsPeerMesh();
    if(!bridge.vsPeerMesh?.children?.length)throw new Error("peer mesh missing");
    bridge.applyVsPose({p:[2,2,1.4],q:[0,0,0,1]});bridge.updateVsPeerRender();
    const enemyHud=document.querySelector("#vsEnemyHud"),enemyVisual={hidden:enemyHud?.hidden,text:enemyHud?.textContent||"",mode:viewport.dataset.vsEnemyHud||"",distance:viewport.dataset.vsEnemyDistance||"",halo:Boolean(bridge.vsPeerMesh.children.find(node=>node.userData?.vsPeerHalo)),color:bridge.vsPeerMesh.children.find(node=>node.isMesh&&!node.userData?.flightFireIgnore)?.material?.color?.getHexString?.()||""};
    const hitOk=bridge.registerVsHit({object:bridge.vsPeerMesh.children.find(node=>node.isMesh&&!node.userData?.flightFireIgnore)}),shot=sent.find(p=>p.type==="hit");if(!hitOk||!shot)throw new Error("local peer hit was not emitted");
    bridge.applyVsCombat({type:"state",id:shot.id,hp:0,killed:true});
    const killed={kills:bridge.vsKills,peerHp:bridge.vsPeerHealth,peerDead:bridge.vsPeerDead,explosion:Boolean(bridge.vsExplosion?.visible),peerVisible:bridge.vsPeerMesh.visible,hud:document.querySelector("#vsCombatHud")?.textContent||"",enemyHud:document.querySelector("#vsEnemyHud")?.textContent||"",enemyMode:viewport.dataset.vsEnemyHud||"",soundCount:Number(viewport.dataset.vsExplosionSoundCount)||0,banner:document.querySelector("#vsCombatBanner")?.textContent||""};
    bridge.applyVsCombat({type:"hit",id:"incoming-1",damage:25});const hpAfterFirst=bridge.vsLocalHealth;bridge.applyVsCombat({type:"hit",id:"incoming-1",damage:25});const hpAfterDuplicate=bridge.vsLocalHealth;
    const state=sent.find(p=>p.type==="state"&&p.id==="incoming-1");
    for(const id of ["incoming-2","incoming-3","incoming-4"])bridge.applyVsCombat({type:"hit",id,damage:25});
    bridge.updateVsPeerRender();
    const localDeath={dead:bridge.vsLocalDead,hp:bridge.vsLocalHealth,respawnHidden:document.querySelector("#vsRespawnHud")?.hidden,respawnText:document.querySelector("#vsRespawnHud")?.textContent||"",respawnMs:Number(viewport.dataset.vsRespawnMs)||0,soundCount:Number(viewport.dataset.vsExplosionSoundCount)||0};
    bridge.applyVsCombat({type:"respawn",hp:100});bridge.updateVsPeerRender();
    const respawn={peerHp:bridge.vsPeerHealth,peerDead:bridge.vsPeerDead,hud:document.querySelector("#vsCombatHud")?.textContent||"",enemyHud:document.querySelector("#vsEnemyHud")?.textContent||"",banner:document.querySelector("#vsCombatBanner")?.textContent||"",dataset:{hp:viewport.dataset.vsLocalHealth,mate:viewport.dataset.vsPeerHealth,kills:viewport.dataset.vsKills}};
    bridge.stopVs();return{hitOk,shot,enemyVisual,killed,hpAfterFirst,hpAfterDuplicate,state,localDeath,respawn};
  });
  if(result.enemyVisual.hidden||!result.enemyVisual.text.includes("ENEMY")||!result.enemyVisual.mode||!result.enemyVisual.distance||!result.enemyVisual.halo||result.enemyVisual.color!=="ff3158")throw new Error(`enemy HUD/visual identification failed: ${JSON.stringify(result.enemyVisual)}`);
  if(result.shot.damage!==25)throw new Error(`unexpected hit damage: ${JSON.stringify(result)}`);
  if(result.killed.kills!==1||result.killed.peerHp!==0||!result.killed.peerDead||!result.killed.explosion||result.killed.peerVisible)throw new Error(`kill/explosion state failed: ${JSON.stringify(result.killed)}`);
  if(!result.killed.enemyHud.includes("ENEMY DOWN")||!result.killed.enemyHud.includes("RESPAWN")||result.killed.enemyMode!=="dead"||result.killed.soundCount<1||result.killed.banner!=="ENEMY DESTROYED")throw new Error(`enemy kill HUD/sound failed: ${JSON.stringify(result.killed)}`);
  if(result.hpAfterFirst!==75)throw new Error(`player health did not take damage: ${JSON.stringify(result)}`);
  if(result.hpAfterDuplicate!==75)throw new Error(`duplicate hit changed health twice: ${JSON.stringify(result)}`);
  if(result.state?.hp!==75||result.state?.killed!==false)throw new Error(`victim-authoritative health acknowledgement missing: ${JSON.stringify(result.state)}`);
  if(!result.localDeath.dead||result.localDeath.hp!==0||result.localDeath.respawnHidden||!result.localDeath.respawnText.includes("DESTROYED")||!result.localDeath.respawnText.includes("RESPAWN")||result.localDeath.respawnMs<=0||result.localDeath.soundCount<2)throw new Error(`local respawn indication/sound failed: ${JSON.stringify(result.localDeath)}`);
  if(result.respawn.peerHp!==100||result.respawn.peerDead||result.respawn.dataset.kills!=="1"||!result.respawn.hud.includes("K 1")||!result.respawn.hud.includes("ENEMY 100")||result.respawn.banner!=="ENEMY RESPAWNED")throw new Error(`respawn/killcount HUD failed: ${JSON.stringify(result.respawn)}`);
  console.log("VS combat browser smoke passed: enemy HUD/halo, explosion sound trigger, destroyed countdown, respawn banner, health and kill count.");
}finally{await browser.close();}
