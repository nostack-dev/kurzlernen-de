import puppeteer from "puppeteer-core";

const base=process.argv[2]||"http://127.0.0.1:4174";
const executablePath=process.env.CHROME_BIN;
if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");
const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage"]});
const roomId=`net-ci-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,9)}`;
const a=await browser.newPage(),b=await browser.newPage();
for(const [page,label] of [[a,"A"],[b,"B"]]){
  page.on("console",msg=>console.log(`[${label}]`,msg.type(),msg.text()));
  page.on("pageerror",error=>console.error(`[${label}] pageerror`,error.message));
}
async function setup(page,label){
  // Deliberately load a script-free same-origin 404 page. The relay probe must be
  // isolated from simulator imports so this gate tests only the broker data path.
  await page.goto(`${base}/__mqtt_relay_probe__.html`,{waitUntil:"load",timeout:30000});
  await page.evaluate(async({roomId,label})=>{
    const mod=await import("/generated/mqtt_data_relay_probe.mjs");
    const state=globalThis.__relayProbe={label,peer:"",messages:[],joinError:"",rtt:null};
    const room=mod.joinRoom({appId:"arondight45-ci"},roomId,{onJoinError:details=>{state.joinError=String(details?.error?.message||details?.error||"");}});
    const action=room.makeAction("probe");
    action.onMessage=(data,{peerId}={})=>state.messages.push({data,peerId});
    room.onPeerJoin=peerId=>{state.peer=peerId;};
    room.onPeerLeave=peerId=>{if(state.peer===peerId)state.peer="";};
    state.room=room;state.action=action;state.mod=mod;
  },{roomId,label});
}
async function snapshot(page){return page.evaluate(()=>({peer:globalThis.__relayProbe?.peer||"",joinError:globalThis.__relayProbe?.joinError||"",sockets:globalThis.__relayProbe?.mod?.getRelaySockets?.()||{}}));}
try{
  await Promise.all([setup(a,"a"),setup(b,"b")]);
  const deadline=Date.now()+20000;let stateA,stateB;
  while(Date.now()<deadline){
    [stateA,stateB]=await Promise.all([snapshot(a),snapshot(b)]);
    if(stateA.peer&&stateB.peer)break;
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  if(!stateA?.peer||!stateB?.peer)throw new Error(`broker peers missing after 20s; A=${JSON.stringify(stateA)} B=${JSON.stringify(stateB)}`);
  const peers=[stateA.peer,stateB.peer];
  await a.evaluate(async()=>{const s=globalThis.__relayProbe;await s.action.send({from:"a",n:1},{target:s.peer});s.rtt=await s.room.ping(s.peer);});
  await b.waitForFunction(()=>globalThis.__relayProbe?.messages?.some(item=>item.data?.from==="a"),{timeout:5000});
  await b.evaluate(async()=>{const s=globalThis.__relayProbe;await s.action.send({from:"b",n:2},{target:s.peer});});
  await a.waitForFunction(()=>globalThis.__relayProbe?.messages?.some(item=>item.data?.from==="b"),{timeout:5000});
  const result=await Promise.all([a.evaluate(()=>({peer:__relayProbe.peer,messages:__relayProbe.messages,rtt:__relayProbe.rtt,sockets:__relayProbe.mod.getRelaySockets(),joinError:__relayProbe.joinError})),b.evaluate(()=>({peer:__relayProbe.peer,messages:__relayProbe.messages,sockets:__relayProbe.mod.getRelaySockets(),joinError:__relayProbe.joinError}))]);
  if(!Number.isFinite(result[0].rtt)||result[0].rtt<0)throw new Error(`broker ping failed: ${JSON.stringify(result)}`);
  for(const side of result){if(side.joinError)throw new Error(`broker join error: ${side.joinError}`);if(!Object.values(side.sockets).some(socket=>socket.readyState===1))throw new Error(`no broker websocket open: ${JSON.stringify(side.sockets)}`);}
  console.log(`MQTT data relay browser smoke passed: two browsers paired (${peers.join(" ↔ ")}), bidirectional action data + ping; rtt=${result[0].rtt.toFixed(1)}ms`);
}finally{
  await Promise.allSettled([a.evaluate(()=>globalThis.__relayProbe?.room?.leave?.()),b.evaluate(()=>globalThis.__relayProbe?.room?.leave?.())]);
  await browser.close();
}
