import puppeteer from "puppeteer-core";

const base=process.argv[2]||"http://127.0.0.1:4174";
const executablePath=process.env.CHROME_BIN;
if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");
const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage"]});
const roomId=`net-ci-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,9)}`;
const a=await browser.newPage(),b=await browser.newPage();
async function setup(page,label){
  await page.goto(`${base}/drone_simulator.html`,{waitUntil:"load",timeout:30000});
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
try{
  await Promise.all([setup(a,"a"),setup(b,"b")]);
  await Promise.all([
    a.waitForFunction(()=>Boolean(globalThis.__relayProbe?.peer),{timeout:15000}),
    b.waitForFunction(()=>Boolean(globalThis.__relayProbe?.peer),{timeout:15000})
  ]);
  const peers=await Promise.all([a.evaluate(()=>globalThis.__relayProbe.peer),b.evaluate(()=>globalThis.__relayProbe.peer)]);
  if(!peers[0]||!peers[1])throw new Error(`broker peers missing ${JSON.stringify(peers)}`);
  await a.evaluate(async()=>{const s=globalThis.__relayProbe;await s.action.send({from:"a",n:1},{target:s.peer});s.rtt=await s.room.ping(s.peer);});
  await b.waitForFunction(()=>globalThis.__relayProbe?.messages?.some(item=>item.data?.from==="a"),{timeout:5000});
  await b.evaluate(async()=>{const s=globalThis.__relayProbe;await s.action.send({from:"b",n:2},{target:s.peer});});
  await a.waitForFunction(()=>globalThis.__relayProbe?.messages?.some(item=>item.data?.from==="b"),{timeout:5000});
  const result=await Promise.all([a.evaluate(()=>({peer:__relayProbe.peer,messages:__relayProbe.messages,rtt:__relayProbe.rtt,sockets:__relayProbe.mod.getRelaySockets(),joinError:__relayProbe.joinError})),b.evaluate(()=>({peer:__relayProbe.peer,messages:__relayProbe.messages,sockets:__relayProbe.mod.getRelaySockets(),joinError:__relayProbe.joinError}))]);
  if(!Number.isFinite(result[0].rtt)||result[0].rtt<0)throw new Error(`broker ping failed: ${JSON.stringify(result)}`);
  for(const side of result){if(side.joinError)throw new Error(`broker join error: ${side.joinError}`);if(!Object.values(side.sockets).some(socket=>socket.readyState===1))throw new Error(`no broker websocket open: ${JSON.stringify(side.sockets)}`);}
  console.log(`MQTT data relay browser smoke passed: two browsers paired, bidirectional action data + ping; rtt=${result[0].rtt.toFixed(1)}ms`);
}finally{
  await Promise.allSettled([a.evaluate(()=>globalThis.__relayProbe?.room?.leave?.()),b.evaluate(()=>globalThis.__relayProbe?.room?.leave?.())]);
  await browser.close();
}
