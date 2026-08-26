import puppeteer from "puppeteer-core";

const input=process.argv[2]||"http://127.0.0.1:4174/drone_simulator.html",url=new URL(input,"http://127.0.0.1:4174"),executablePath=process.env.CHROME_BIN;
if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");
const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader"]});
const page=await browser.newPage();
try{
  await page.setViewport({width:844,height:390,deviceScaleFactor:1,hasTouch:true,isMobile:true});
  await page.goto(url.href,{waitUntil:"load",timeout:40000});
  await page.waitForFunction(()=>document.querySelector("#status")?.textContent?.includes("SIM ready")&&globalThis.__arondightRealWorld?.threeScene&&globalThis.__arondightWalkMode,{timeout:40000});
  const result=await page.evaluate(async()=>{
    const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const waitFor=async(fn,label="condition",timeout=7000)=>{const end=performance.now()+timeout;while(performance.now()<end){const value=fn();if(value)return value;await sleep(25);}throw Error(`player multiplayer mode wait timeout: ${label}`);};
    const bridge=globalThis.__arondightRealWorld,view=document.querySelector("#viewport"),sent=[],games=[],peerIds=["peer-b","peer-c","peer-d"];
    const fake={getSelfId:()=>"peer-a",getAuthorityId:()=>"peer-a",getPeerIds:()=>[...peerIds],setOrigin:()=>true,setPose(pose){sent.push(structuredClone(pose));return true;},sendGame(packet,options={}){games.push({packet:structuredClone(packet),options:structuredClone(options)});return true;},sendFx:()=>true,sendCombat:()=>true};
    bridge.vsSession=fake;bridge.vsConnected=true;
    for(const peerId of peerIds)dispatchEvent(new CustomEvent("arondight45:vs-peer",{detail:{type:"join",peerId,selfId:"peer-a",authorityId:"peer-a",peerIds:[...peerIds],transport:"Test"}}));
    await waitFor(()=>fake.__worldVehiclePhysicsSync&&fake.__vsPlayerStateReplication,"replication patches",5000);
    globalThis.__arondightWalkMode.setMode?.("foot");globalThis.__arondightWalkMode.setPose?.({x:2,y:3,yaw:.45,pitch:.18});
    await sleep(80);fake.setPose({p:[0,0,2],q:[0,0,0,1],v:[0,0,0],t:performance.now(),f:"local-metric"});
    const local=sent.at(-1);if(local?.pm!=="foot"||!local.ph||local.ph.weapon!=="pistol"&&!local.ph.weapon)throw Error(`local foot pose was not enriched: ${JSON.stringify(local)}`);
    const now=performance.now();for(const [index,peerId] of peerIds.entries())dispatchEvent(new CustomEvent("arondight45:vs-pose",{detail:{peerId,pose:{p:[5+index*1.5,4+index,0],q:[0,0,0,1],v:[1.2,.2,0],t:now+index,f:"local-metric",pm:"foot",av:[5+index*1.5,4+index,0],ay:.7+index*.1,avv:[1.2,.2,0],ph:{yaw:.7+index*.1,pitch:.22,weapon:index===1?"pistol":"smg",dead:false,speed:1.3,moving:1,aiming:1}}}}));
    const human=await waitFor(()=>{let found=null;bridge.threeScene.traverse(node=>{if(node.userData?.vsHumanAvatar&&node.userData?.vsPlayerId==="peer-b"&&node.visible)found=node;});return found;},"primary walk rig");
    const visibleWalkPeers=await waitFor(()=>{const ids=new Set();bridge.threeScene.traverse(node=>{if(node.userData?.vsHumanAvatar&&peerIds.includes(String(node.userData?.vsPlayerId||""))&&node.visible)ids.add(String(node.userData.vsPlayerId));});return ids.size===peerIds.length?[...ids]:null;},"three simultaneous walk rigs");
    const names=new Set();human.traverse(node=>names.add(node.name));for(const name of["VS_HUMAN_TORSO","VS_HUMAN_HEAD","VS_HUMAN_ARM_L","VS_HUMAN_ARM_R","VS_HUMAN_LEG_L","VS_HUMAN_LEG_R","VS_HUMAN_HITBOX","VS_HUMAN_SMG"])if(!names.has(name))throw Error(`remote human rig missing ${name}`);
    let hitbox=null,legacyVisible=false;human.traverse(node=>{if(node.userData?.vsHumanHitbox)hitbox=node;});bridge.threeScene.traverse(node=>{if(node!==human&&node.userData?.vsPlayerId==="peer-b"&&!node.userData?.vsHumanAvatar&&(node.userData?.vsMultiplayerPeer||node.userData?.vsLegacyPrimary||node===bridge.vsPeerMesh)&&node.visible)legacyVisible=true;});if(!hitbox||legacyVisible)throw Error(`human hitbox/legacy visibility invalid: ${JSON.stringify({hitbox:Boolean(hitbox),legacyVisible})}`);
    const hitAccepted=bridge.registerVsHit?.({object:hitbox});if(!hitAccepted)throw Error("remote human hitbox was not accepted by multiplayer combat");
    const vehicleRoot=human.clone(false);vehicleRoot.name="TEST_REMOTE_VEHICLE";vehicleRoot.userData={worldPopulationId:"world-car-1"};vehicleRoot.visible=true;const vehicleProbe=human.getObjectByName("VS_HUMAN_HEAD")?.clone();if(vehicleProbe){vehicleProbe.visible=false;vehicleRoot.add(vehicleProbe);}bridge.threeScene.add(vehicleRoot);
    dispatchEvent(new CustomEvent("arondight45:vs-pose",{detail:{peerId:"peer-b",pose:{p:[6,4,0],q:[0,0,0,1],v:[0,0,0],t:now+30,f:"local-metric",pm:"vehicle",pv:{id:"world-car-1"}}}}));await waitFor(()=>human.visible&&human.userData.playerVehicleOccupant===true&&human.parent===vehicleRoot,"seated vehicle rig");
    dispatchEvent(new CustomEvent("arondight45:vs-pose",{detail:{peerId:"peer-b",pose:{p:[7,4,1],q:[0,0,0,1],v:[0,0,0],t:now+60,f:"local-metric",pm:"drone",av:[6,4,0],ay:.7,avv:[0,0,0],vr:1}}}));await waitFor(()=>human.visible&&human.parent===bridge.threeScene&&human.userData.vsRemotePresence==="stationary-human-while-drone","stationary human during drone control");
    dispatchEvent(new CustomEvent("arondight45:vs-pose",{detail:{peerId:"peer-b",pose:{p:[8,4,0],q:[0,0,0,1],v:[0,0,0],t:now+90,f:"local-metric",pm:"foot",ph:{yaw:.2,pitch:0,weapon:"pistol",dead:true,speed:0,moving:0}}}}));await waitFor(()=>human.visible&&human.userData.vsRemoteDead===true,"dead walk rig");const pistol=human.getObjectByName("VS_HUMAN_PISTOL"),smg=human.getObjectByName("VS_HUMAN_SMG");if(pistol?.visible||smg?.visible)throw Error("dead remote player still shows weapon");
    return{localMode:local.pm,weapon:local.ph.weapon,humanParts:names.size,visibleWalkPeers,hitAccepted:Boolean(hitAccepted),humanMode:view.dataset.vsLastRemoteMode,replication:view.dataset.vsPlayerReplication,rx:Number(view.dataset.vsPlayerStateRx||0),tx:Number(view.dataset.vsPlayerStateTx||0),games:games.length};
  });
  if(result.localMode!=="foot"||result.replication!=="drone+stationary-human+foot+vehicle-seated+weapon+death-v4"||result.visibleWalkPeers?.length!==3||result.rx<6||result.tx<1||!result.hitAccepted)throw new Error(`player multiplayer mode regression: ${JSON.stringify(result)}`);
  console.log(`Player multiplayer modes passed: all-peer third-person walk rigs, foot/vehicle/drone transitions, weapon/death state and human combat hitbox. ${JSON.stringify(result)}`);
}finally{await browser.close();}
