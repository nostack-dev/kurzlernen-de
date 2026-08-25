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
    const waitFor=async(fn,timeout=7000)=>{const end=performance.now()+timeout;while(performance.now()<end){const value=fn();if(value)return value;await sleep(25);}throw Error("player multiplayer mode wait timeout");};
    const bridge=globalThis.__arondightRealWorld,view=document.querySelector("#viewport"),sent=[],games=[];
    const fake={getSelfId:()=>"peer-a",getAuthorityId:()=>"peer-a",getPeerIds:()=>["peer-b"],setOrigin:()=>true,setPose(pose){sent.push(structuredClone(pose));return true;},sendGame(packet,options={}){games.push({packet:structuredClone(packet),options:structuredClone(options)});return true;},sendFx:()=>true,sendCombat:()=>true};
    bridge.vsSession=fake;bridge.vsConnected=true;
    dispatchEvent(new CustomEvent("arondight45:vs-peer",{detail:{type:"join",peerId:"peer-b",selfId:"peer-a",authorityId:"peer-a",peerIds:["peer-b"],transport:"Test"}}));
    await waitFor(()=>fake.__worldVehiclePhysicsSync&&fake.__vsPlayerStateReplication,5000);
    globalThis.__arondightWalkMode.setMode?.("foot");globalThis.__arondightWalkMode.setPose?.({x:2,y:3,yaw:.45,pitch:.18});
    await sleep(80);fake.setPose({p:[0,0,2],q:[0,0,0,1],v:[0,0,0],t:performance.now(),f:"local-metric"});
    const local=sent.at(-1);if(local?.pm!=="foot"||!local.ph||local.ph.weapon!=="pistol"&&!local.ph.weapon)throw Error(`local foot pose was not enriched: ${JSON.stringify(local)}`);
    const now=performance.now();dispatchEvent(new CustomEvent("arondight45:vs-pose",{detail:{peerId:"peer-b",pose:{p:[5,4,0],q:[0,0,0,1],v:[1.2,.2,0],t:now,f:"local-metric",pm:"foot",ph:{yaw:.7,pitch:.22,weapon:"smg",dead:false,speed:1.3,moving:1,aiming:1}}}}));
    const human=await waitFor(()=>{let found=null;bridge.threeScene.traverse(node=>{if(node.userData?.vsHumanAvatar&&node.userData?.vsPlayerId==="peer-b"&&node.visible)found=node;});return found;});
    const names=new Set();human.traverse(node=>names.add(node.name));for(const name of["VS_HUMAN_TORSO","VS_HUMAN_HEAD","VS_HUMAN_ARM_L","VS_HUMAN_ARM_R","VS_HUMAN_LEG_L","VS_HUMAN_LEG_R","VS_HUMAN_HITBOX","VS_HUMAN_SMG"])if(!names.has(name))throw Error(`remote human rig missing ${name}`);
    let hitbox=null,legacyVisible=false;human.traverse(node=>{if(node.userData?.vsHumanHitbox)hitbox=node;});bridge.threeScene.traverse(node=>{if(node!==human&&node.userData?.vsPlayerId==="peer-b"&&!node.userData?.vsHumanAvatar&&(node.userData?.vsMultiplayerPeer||node.userData?.vsLegacyPrimary||node===bridge.vsPeerMesh)&&node.visible)legacyVisible=true;});if(!hitbox||legacyVisible)throw Error(`human hitbox/legacy visibility invalid: ${JSON.stringify({hitbox:Boolean(hitbox),legacyVisible})}`);
    const hitAccepted=bridge.registerVsHit?.({object:hitbox});if(!hitAccepted)throw Error("remote human hitbox was not accepted by multiplayer combat");
    dispatchEvent(new CustomEvent("arondight45:vs-pose",{detail:{peerId:"peer-b",pose:{p:[6,4,0],q:[0,0,0,1],v:[0,0,0],t:now+30,f:"local-metric",pm:"vehicle",pv:{id:"world-car-1"}}}}));await sleep(80);if(human.visible)throw Error("remote human remained visible while peer entered vehicle");
    dispatchEvent(new CustomEvent("arondight45:vs-pose",{detail:{peerId:"peer-b",pose:{p:[7,4,1],q:[0,0,0,1],v:[0,0,0],t:now+60,f:"local-metric",pm:"drone"}}}));await sleep(100);if(human.visible)throw Error("remote human remained visible in drone mode");
    dispatchEvent(new CustomEvent("arondight45:vs-pose",{detail:{peerId:"peer-b",pose:{p:[8,4,0],q:[0,0,0,1],v:[0,0,0],t:now+90,f:"local-metric",pm:"foot",ph:{yaw:.2,pitch:0,weapon:"pistol",dead:true,speed:0,moving:0}}}}));await waitFor(()=>human.visible&&human.userData.vsRemoteDead===true);const pistol=human.getObjectByName("VS_HUMAN_PISTOL"),smg=human.getObjectByName("VS_HUMAN_SMG");if(pistol?.visible||smg?.visible)throw Error("dead remote player still shows weapon");
    return{localMode:local.pm,weapon:local.ph.weapon,humanParts:names.size,hitAccepted:Boolean(hitAccepted),humanMode:view.dataset.vsLastRemoteMode,replication:view.dataset.vsPlayerReplication,rx:Number(view.dataset.vsPlayerStateRx||0),tx:Number(view.dataset.vsPlayerStateTx||0),games:games.length};
  });
  if(result.localMode!=="foot"||result.replication!=="drone+foot+vehicle+weapon+death-v2"||result.rx<4||result.tx<1||!result.hitAccepted)throw new Error(`player multiplayer mode regression: ${JSON.stringify(result)}`);
  console.log(`Player multiplayer modes passed: full human rig, foot/vehicle/drone transitions, weapon/death state and human combat hitbox. ${JSON.stringify(result)}`);
}finally{await browser.close();}
