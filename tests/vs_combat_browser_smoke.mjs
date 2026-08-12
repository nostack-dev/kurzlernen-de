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
  const result=await page.evaluate(async()=>{
    const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const bridge=globalThis.__arondightRealWorld,viewport=document.querySelector("#viewport"),sent=[];
    document.body.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,pointerType:"touch"}));
    bridge.vsConnected=true;bridge.vsSession={sendCombat(packet){sent.push(JSON.parse(JSON.stringify(packet)));return true;},stop(){}};bridge.resetVsCombat(true);bridge.ensureVsPeerMesh();
    if(!bridge.vsPeerMesh?.children?.length)throw new Error("peer mesh missing");bridge.vsPeerMesh.position.set(0,2,1);bridge.vsPeerMesh.visible=true;bridge.vsPeerLastPoseMs=performance.now();
    await sleep(90);
    const marker=document.querySelector("#vsEnemyMarker"),firstMesh=bridge.vsPeerMesh.children.find(child=>child.isMesh),markerBefore={exists:Boolean(marker),hidden:Boolean(marker?.hidden),text:marker?.textContent||"",mode:viewport.dataset.vsEnemyMarker||"",emissiveIntensity:Number(firstMesh?.material?.emissiveIntensity)||0,color:firstMesh?.material?.color?.getHex?.()||0};
    const hitOk=bridge.registerVsHit({object:bridge.vsPeerMesh.children.find(child=>child.isMesh)||bridge.vsPeerMesh.children[0]}),shot=sent.find(p=>p.type==="hit");if(!hitOk||!shot)throw new Error("local peer hit was not emitted");
    bridge.applyVsCombat({type:"state",id:shot.id,hp:0,killed:true});await sleep(90);
    const killed={kills:bridge.vsKills,peerHp:bridge.vsPeerHealth,peerDead:bridge.vsPeerDead,explosion:Boolean(bridge.vsExplosion?.visible),peerVisible:bridge.vsPeerMesh.visible,hud:document.querySelector("#vsCombatHud")?.textContent||"",enemyMarker:marker?.textContent||"",respawnHud:document.querySelector("#vsRespawnHud")?.textContent||"",respawnHidden:Boolean(document.querySelector("#vsRespawnHud")?.hidden),respawnState:viewport.dataset.vsRespawnState||"",soundCount:Number(viewport.dataset.vsExplosionSoundCount)||0,flash:Boolean(document.querySelector("#vsExplosionFlash")?.classList.contains("pulse"))};
    bridge.applyVsCombat({type:"respawn",hp:100});await sleep(70);const peerRespawn={peerHp:bridge.vsPeerHealth,peerDead:bridge.vsPeerDead,marker:marker?.textContent||"",respawnHidden:Boolean(document.querySelector("#vsRespawnHud")?.hidden)};
    bridge.applyVsCombat({type:"hit",id:"incoming-1",damage:25});const hpAfterFirst=bridge.vsLocalHealth;bridge.applyVsCombat({type:"hit",id:"incoming-1",damage:25});const hpAfterDuplicate=bridge.vsLocalHealth;
    const state=sent.find(p=>p.type==="state"&&p.id==="incoming-1");
    bridge.applyVsCombat({type:"hit",id:"incoming-2",damage:25});bridge.applyVsCombat({type:"hit",id:"incoming-3",damage:25});bridge.applyVsCombat({type:"hit",id:"incoming-4",damage:25});await sleep(90);
    const localDeath={hp:bridge.vsLocalHealth,dead:bridge.vsLocalDead,deaths:bridge.vsDeaths,respawnHud:document.querySelector("#vsRespawnHud")?.textContent||"",respawnHidden:Boolean(document.querySelector("#vsRespawnHud")?.hidden),respawnState:viewport.dataset.vsRespawnState||"",soundCount:Number(viewport.dataset.vsExplosionSoundCount)||0,flashLocal:Boolean(document.querySelector("#vsExplosionFlash")?.classList.contains("local"))};
    const dataset={hp:viewport.dataset.vsLocalHealth,mate:viewport.dataset.vsPeerHealth,kills:viewport.dataset.vsKills,deaths:viewport.dataset.vsDeaths};
    bridge.stopVs();return{hitOk,shot,markerBefore,killed,peerRespawn,hpAfterFirst,hpAfterDuplicate,state,localDeath,dataset};
  });
  if(result.shot.damage!==25)throw new Error(`unexpected hit damage: ${JSON.stringify(result)}`);
  if(!result.markerBefore.exists||result.markerBefore.hidden||!result.markerBefore.text.includes("ENEMY")||!result.markerBefore.mode)throw new Error(`enemy HUD marker missing: ${JSON.stringify(result.markerBefore)}`);
  if(result.markerBefore.emissiveIntensity<1||result.markerBefore.color===0)throw new Error(`enemy visual contrast enhancement missing: ${JSON.stringify(result.markerBefore)}`);
  if(result.killed.kills!==1||result.killed.peerHp!==0||!result.killed.peerDead||!result.killed.explosion||result.killed.peerVisible)throw new Error(`kill/explosion state failed: ${JSON.stringify(result.killed)}`);
  if(!result.killed.enemyMarker.includes("ENEMY DOWN")||result.killed.respawnHidden||!result.killed.respawnHud.includes("ENEMY DESTROYED")||!result.killed.respawnHud.includes("RESPAWN")||result.killed.respawnState!=="enemy")throw new Error(`enemy respawn indication missing: ${JSON.stringify(result.killed)}`);
  if(result.killed.soundCount<1||!result.killed.flash)throw new Error(`enemy explosion feedback missing: ${JSON.stringify(result.killed)}`);
  if(result.peerRespawn.peerHp!==100||result.peerRespawn.peerDead||!result.peerRespawn.marker.includes("ENEMY")||!result.peerRespawn.respawnHidden)throw new Error(`enemy respawn presentation did not clear: ${JSON.stringify(result.peerRespawn)}`);
  if(result.hpAfterFirst!==75)throw new Error(`player health did not take damage: ${JSON.stringify(result)}`);
  if(result.hpAfterDuplicate!==75)throw new Error(`duplicate hit changed health twice: ${JSON.stringify(result)}`);
  if(result.state?.hp!==75||result.state?.killed!==false)throw new Error(`victim-authoritative health acknowledgement missing: ${JSON.stringify(result.state)}`);
  if(result.localDeath.hp!==0||!result.localDeath.dead||result.localDeath.deaths!==1||result.localDeath.respawnHidden||result.localDeath.respawnState!=="local"||!result.localDeath.respawnHud.includes("DESTROYED")||!result.localDeath.respawnHud.includes("RESPAWN"))throw new Error(`local respawn countdown missing: ${JSON.stringify(result.localDeath)}`);
  if(result.localDeath.soundCount<2||!result.localDeath.flashLocal)throw new Error(`local destruction explosion feedback missing: ${JSON.stringify(result.localDeath)}`);
  if(result.dataset.kills!=="1"||result.dataset.deaths!=="1")throw new Error(`combat score dataset failed: ${JSON.stringify(result.dataset)}`);
  console.log("VS combat browser smoke passed: enemy HUD/contrast, explosion audio trigger/flash, 100 HP, 25 damage, dedupe, kill and both respawn indications.");
}finally{await browser.close();}