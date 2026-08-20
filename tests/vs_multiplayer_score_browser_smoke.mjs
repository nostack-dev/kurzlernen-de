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
    await waitFor(()=>view.dataset.vsSelfId==="peer-a"&&view.dataset.vsAuthorityId==="peer-a"&&bridge.__vsMultiplayerHooks);
    const target=await waitFor(()=>bridge.threeScene.children.find(node=>node.userData?.vsMultiplayerPeer&&node.userData?.vsPlayerId==="peer-c")),hitbox=await waitFor(()=>target.children.find(node=>node.userData?.vsCombatHitbox));
    for(let i=0;i<4;i++){if(!bridge.registerVsHit({object:hitbox}))throw Error(`authoritative hit ${i+1} rejected`);await sleep(30);}
    await waitFor(()=>bridge.vsKills===1&&sentGame.some(item=>item.packet.type==="state"&&item.packet.playerId==="peer-c"&&item.packet.hp===0&&item.packet.killed===true));
    const beforeRespawn={kills:bridge.vsKills,peerHp:bridge.vsPeerHealth,peerDead:bridge.vsPeerDead,hud:document.querySelector("#vsCombatHud")?.textContent||""};
    dispatchEvent(new CustomEvent("arondight45:vs-game",{detail:{peerId:"peer-c",packet:{type:"respawn-request",playerId:"peer-c"}}}));
    await waitFor(()=>sentGame.some(item=>item.packet.type==="respawn"&&item.packet.playerId==="peer-c")&&bridge.vsPeerHealth===100&&!bridge.vsPeerDead);await sleep(80);
    return{beforeRespawn,afterRespawn:{kills:bridge.vsKills,peerHp:bridge.vsPeerHealth,peerDead:bridge.vsPeerDead,hud:document.querySelector("#vsCombatHud")?.textContent||""},killState:sentGame.find(item=>item.packet.type==="state"&&item.packet.playerId==="peer-c"&&item.packet.hp===0)?.packet,respawn:sentGame.find(item=>item.packet.type==="respawn"&&item.packet.playerId==="peer-c")?.packet,explosion:sentFx.some(item=>item.packet.type==="explosion"&&item.packet.playerId==="peer-c")};
  });
  if(result.beforeRespawn.kills!==1||result.beforeRespawn.peerHp!==0||!result.beforeRespawn.peerDead||!result.beforeRespawn.hud.includes("K 1"))throw new Error(`authoritative kill score failed: ${JSON.stringify(result)}`);
  if(result.afterRespawn.kills!==1||result.afterRespawn.peerHp!==100||result.afterRespawn.peerDead||!result.afterRespawn.hud.includes("K 1")||result.killState?.by!=="peer-a"||result.respawn?.hp!==100||!result.explosion)throw new Error(`score did not persist through authoritative respawn: ${JSON.stringify(result)}`);
  console.log("VS multiplayer score browser smoke passed: host-authoritative kill increments once, explosion broadcasts, respawn restores HP, and K score persists.");
}finally{await browser.close();}
