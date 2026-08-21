import puppeteer from "puppeteer-core";

const input=process.argv[2]||"http://127.0.0.1:4174/drone_simulator.html",inputUrl=new URL(input,"http://127.0.0.1:4174"),url=inputUrl.pathname.endsWith("/drone_simulator.html")?new URL(inputUrl.href):new URL("/drone_simulator.html",inputUrl.origin),executablePath=process.env.CHROME_BIN;
if(process.env.GITHUB_SHA)url.searchParams.set("ci",process.env.GITHUB_SHA);if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");
const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader","--autoplay-policy=no-user-gesture-required"]}),page=await browser.newPage();
try{
  await page.setViewport({width:844,height:390,deviceScaleFactor:1});await page.goto(url.href,{waitUntil:"load",timeout:30000});await page.waitForFunction(()=>document.querySelector("#status")?.textContent?.includes("SIM ready"),{timeout:30000});await page.waitForFunction(()=>document.body.classList.contains("solo-flight")&&globalThis.__arondightRealWorld?.threeScene,{timeout:10000});
  const result=await page.evaluate(async()=>{
    const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),waitFor=async(fn,timeout=7000)=>{const end=performance.now()+timeout;while(performance.now()<end){const value=fn();if(value)return value;await sleep(25);}throw Error("score browser wait timeout");};
    const bridge=globalThis.__arondightRealWorld,view=document.querySelector("#viewport"),sentGame=[],sentFx=[],peerIds=["peer-b","peer-c"];
    bridge.vsConnected=true;bridge.ensureVsPeerMesh?.();bridge.vsSession={primaryPeerId:"peer-b",getSelfId:()=>"peer-a",getAuthorityId:()=>"peer-a",getPeerIds:()=>[...peerIds],setOrigin:()=>true,setPose:()=>true,sendCombat:()=>true,sendGame(packet,options={}){sentGame.push({packet:structuredClone(packet),options:structuredClone(options)});return true;},sendFx(packet,options={}){sentFx.push({packet:structuredClone(packet),options:structuredClone(options)});return true;},stop(){}};
    for(const peerId of peerIds)dispatchEvent(new CustomEvent("arondight45:vs-peer",{detail:{type:"join",peerId,selfId:"peer-a",authorityId:"peer-a",peerIds:[...peerIds],transport:"Test"}}));
    const now=performance.now();dispatchEvent(new CustomEvent("arondight45:vs-pose",{detail:{peerId:"peer-b",pose:{p:[10,0,2],q:[0,0,0,1],v:[0,0,0],t:now,f:"local-metric"}}}));dispatchEvent(new CustomEvent("arondight45:vs-pose",{detail:{peerId:"peer-c",pose:{p:[-8,6,3],q:[0,0,0,1],v:[0,0,0],t:now+1,f:"local-metric"}}}));
    await waitFor(()=>view.dataset.vsSelfId==="peer-a"&&view.dataset.vsAuthorityId==="peer-a"&&bridge.__vsMultiplayerHooks);await sleep(520);
    const target=await waitFor(()=>bridge.threeScene.children.find(node=>node.userData?.vsMultiplayerPeer&&node.userData?.vsPlayerId==="peer-c")),targetMesh=await waitFor(()=>{let mesh=null;target.traverse(node=>{if(!mesh&&node?.isMesh)mesh=node;});return mesh;}),targetMarker=await waitFor(()=>document.querySelector('.vs-player-marker[data-peer-id="peer-c"]'));
    if(target.userData.vsCombatVisualScale!==7||Number(view.dataset.vsCombatVisualScale)!==7)throw Error(`v3 target visual scale mismatch: root=${target.userData.vsCombatVisualScale} dataset=${view.dataset.vsCombatVisualScale}`);

    const duplicate={type:"hit-request",id:"dedupe-probe",shooter:"peer-b",target:"peer-c",damage:100};
    dispatchEvent(new CustomEvent("arondight45:vs-game",{detail:{peerId:"peer-b",packet:duplicate}}));dispatchEvent(new CustomEvent("arondight45:vs-game",{detail:{peerId:"peer-b",packet:duplicate}}));
    await waitFor(()=>sentGame.some(item=>item.packet.type==="state"&&item.packet.id==="dedupe-probe"&&item.packet.playerId==="peer-c"&&item.packet.hp===0));await sleep(120);
    const duplicateStates=sentGame.filter(item=>item.packet.type==="state"&&item.packet.id==="dedupe-probe");if(duplicateStates.length!==1)throw Error(`duplicate hit changed health twice: states=${duplicateStates.length}`);
    dispatchEvent(new CustomEvent("arondight45:vs-game",{detail:{peerId:"peer-c",packet:{type:"respawn-request",playerId:"peer-c"}}}));
    await waitFor(()=>sentGame.some(item=>item.packet.type==="respawn"&&item.packet.playerId==="peer-c")&&target.visible&&!targetMarker.textContent.includes("DOWN"));await sleep(80);

    const selfKillStart=sentGame.length;
    for(let i=0;i<4;i++){if(!bridge.registerVsHit({object:targetMesh}))throw Error(`authoritative visible-mesh hit ${i+1} rejected`);await sleep(45);}
    await waitFor(()=>bridge.vsKills===1&&!target.visible&&targetMarker.textContent.includes("DOWN")&&sentGame.slice(selfKillStart).some(item=>item.packet.type==="state"&&item.packet.playerId==="peer-c"&&item.packet.hp===0&&item.packet.killed===true));
    const beforeRespawn={kills:bridge.vsKills,targetVisible:Boolean(target.visible),targetMarker:targetMarker.textContent||"",hud:document.querySelector("#vsCombatHud")?.textContent||""};
    const killState=[...sentGame.slice(selfKillStart)].reverse().find(item=>item.packet.type==="state"&&item.packet.playerId==="peer-c"&&item.packet.hp===0)?.packet;
    dispatchEvent(new CustomEvent("arondight45:vs-game",{detail:{peerId:"peer-c",packet:{type:"respawn-request",playerId:"peer-c"}}}));
    await waitFor(()=>sentGame.slice(selfKillStart).some(item=>item.packet.type==="respawn"&&item.packet.playerId==="peer-c")&&target.visible&&!targetMarker.textContent.includes("DOWN"));await sleep(80);
    const afterRespawn={kills:bridge.vsKills,targetVisible:Boolean(target.visible),targetMarker:targetMarker.textContent||"",hud:document.querySelector("#vsCombatHud")?.textContent||""};

    for(let i=0;i<4;i++){dispatchEvent(new CustomEvent("arondight45:vs-game",{detail:{peerId:"peer-b",packet:{type:"hit-request",id:`local-death-${i}`,shooter:"peer-b",target:"peer-a",damage:25}}}));await sleep(45);}
    await waitFor(()=>bridge.vsLocalDead&&bridge.vsLocalHealth===0&&bridge.vsDeaths===1&&sentGame.some(item=>item.packet.type==="state"&&item.packet.playerId==="peer-a"&&item.packet.hp===0&&item.packet.killed===true));
    const localDeath={deaths:bridge.vsDeaths,hp:bridge.vsLocalHealth,dead:bridge.vsLocalDead,hud:document.querySelector("#vsCombatHud")?.textContent||"",state:[...sentGame].reverse().find(item=>item.packet.type==="state"&&item.packet.playerId==="peer-a"&&item.packet.hp===0)?.packet};
    const manualBefore=Number(view.dataset.vsManualRespawns||0);view.dataset.vsManualRespawns=String(manualBefore+1);
    await waitFor(()=>bridge.vsLocalHealth===100&&!bridge.vsLocalDead&&sentGame.some(item=>item.packet.type==="respawn"&&item.packet.playerId==="peer-a"&&item.packet.hp===100));
    const localRespawn={hp:bridge.vsLocalHealth,dead:bridge.vsLocalDead,manual:Number(view.dataset.vsManualRespawns||0),packet:[...sentGame].reverse().find(item=>item.packet.type==="respawn"&&item.packet.playerId==="peer-a")?.packet};
    return{duplicateStates:duplicateStates.length,beforeRespawn,afterRespawn,localDeath,localRespawn,killState,respawn:[...sentGame].reverse().find(item=>item.packet.type==="respawn"&&item.packet.playerId==="peer-c")?.packet,explosion:sentFx.some(item=>item.packet.type==="explosion"&&item.packet.playerId==="peer-c")};
  });
  if(result.duplicateStates!==1)throw new Error(`dedupe regression: ${JSON.stringify(result)}`);
  if(result.beforeRespawn.kills!==1||result.beforeRespawn.targetVisible||!result.beforeRespawn.targetMarker.includes("DOWN")||!result.beforeRespawn.hud.includes("K 1")||result.killState?.hp!==0||result.killState?.killed!==true||result.killState?.by!=="peer-a")throw new Error(`authoritative kill score failed: ${JSON.stringify(result)}`);
  if(result.afterRespawn.kills!==1||!result.afterRespawn.targetVisible||result.afterRespawn.targetMarker.includes("DOWN")||!result.afterRespawn.hud.includes("K 1")||result.respawn?.hp!==100||!result.explosion)throw new Error(`score did not persist through authoritative respawn: ${JSON.stringify(result)}`);
  if(result.localDeath.deaths!==1||result.localDeath.hp!==0||!result.localDeath.dead||result.localDeath.state?.by!=="peer-b")throw new Error(`authoritative local death score failed: ${JSON.stringify(result.localDeath)}`);
  if(result.localRespawn.hp!==100||result.localRespawn.dead||result.localRespawn.packet?.hp!==100)throw new Error(`manual RESET/respawn integration failed: ${JSON.stringify(result.localRespawn)}`);
  console.log("VS multiplayer score browser smoke passed: v3 visible-mesh hits, duplicate-hit dedupe, authoritative kill/respawn, persistent K/D and manual local RESET integration.");
}finally{await browser.close();}
