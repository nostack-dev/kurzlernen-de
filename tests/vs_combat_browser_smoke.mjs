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
  const result=await page.evaluate(()=>{
    const bridge=globalThis.__arondightRealWorld,viewport=document.querySelector("#viewport"),sent=[];
    bridge.vsConnected=true;bridge.vsSession={sendCombat(packet){sent.push(JSON.parse(JSON.stringify(packet)));return true;},stop(){}};bridge.resetVsCombat(true);bridge.ensureVsPeerMesh();
    if(!bridge.vsPeerMesh?.children?.length)throw new Error("peer mesh missing");bridge.vsPeerMesh.visible=true;bridge.vsPeerLastPoseMs=performance.now();
    const hitOk=bridge.registerVsHit({object:bridge.vsPeerMesh.children[0]}),shot=sent.find(p=>p.type==="hit");if(!hitOk||!shot)throw new Error("local peer hit was not emitted");
    bridge.applyVsCombat({type:"state",id:shot.id,hp:0,killed:true});
    const killed={kills:bridge.vsKills,peerHp:bridge.vsPeerHealth,peerDead:bridge.vsPeerDead,explosion:Boolean(bridge.vsExplosion?.visible),peerVisible:bridge.vsPeerMesh.visible,hud:document.querySelector("#vsCombatHud")?.textContent||""};
    bridge.applyVsCombat({type:"hit",id:"incoming-1",damage:25});const hpAfterFirst=bridge.vsLocalHealth;bridge.applyVsCombat({type:"hit",id:"incoming-1",damage:25});const hpAfterDuplicate=bridge.vsLocalHealth;
    const state=sent.find(p=>p.type==="state"&&p.id==="incoming-1");bridge.applyVsCombat({type:"respawn",hp:100});
    const respawn={peerHp:bridge.vsPeerHealth,peerDead:bridge.vsPeerDead,hud:document.querySelector("#vsCombatHud")?.textContent||"",dataset:{hp:viewport.dataset.vsLocalHealth,mate:viewport.dataset.vsPeerHealth,kills:viewport.dataset.vsKills}};
    bridge.stopVs();return{hitOk,shot,killed,hpAfterFirst,hpAfterDuplicate,state,respawn};
  });
  if(result.shot.damage!==25)throw new Error(`unexpected hit damage: ${JSON.stringify(result)}`);
  if(result.killed.kills!==1||result.killed.peerHp!==0||!result.killed.peerDead||!result.killed.explosion||result.killed.peerVisible)throw new Error(`kill/explosion state failed: ${JSON.stringify(result.killed)}`);
  if(result.hpAfterFirst!==75)throw new Error(`player health did not take damage: ${JSON.stringify(result)}`);
  if(result.hpAfterDuplicate!==75)throw new Error(`duplicate hit changed health twice: ${JSON.stringify(result)}`);
  if(result.state?.hp!==75||result.state?.killed!==false)throw new Error(`victim-authoritative health acknowledgement missing: ${JSON.stringify(result.state)}`);
  if(result.respawn.peerHp!==100||result.respawn.peerDead||result.respawn.dataset.kills!=="1"||!result.respawn.hud.includes("K 1"))throw new Error(`respawn/killcount HUD failed: ${JSON.stringify(result.respawn)}`);
  console.log("VS combat browser smoke passed: 100 HP, 25 damage, dedupe, explosion, respawn and kill count.");
}finally{await browser.close();}
