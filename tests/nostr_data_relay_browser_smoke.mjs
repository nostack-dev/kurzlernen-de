import puppeteer from "puppeteer-core";

const base=process.argv[2]||"http://127.0.0.1:4174";
const executablePath=process.env.CHROME_BIN;
if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");
const roomId=`tap-ci-${Date.now().toString(36)}`;
const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage"]});
const a=await browser.newPage(),b=await browser.newPage();

async function setup(page,label){
  await page.goto(`${base}/drone_simulator.html`,{waitUntil:"domcontentloaded",timeout:30000});
  return page.evaluate(async({roomId,label})=>{
    const mod=await import("/generated/nostr_data_relay_probe.mjs");
    const room=mod.joinRoom({appId:"a45-nostr-relay-ci"},roomId,{onJoinError:({error}={})=>{globalThis.__nostrProbe.error=String(error?.message||error||"join error");}});
    const action=room.makeAction("probe");
    globalThis.__nostrProbe={room,mod,label,peer:"",messages:[],error:"",rtt:null};
    room.onPeerJoin=peerId=>{globalThis.__nostrProbe.peer=peerId;};
    action.onMessage=(data,{peerId}={})=>globalThis.__nostrProbe.messages.push({data,peerId});
    globalThis.__nostrProbe.action=action;
    return true;
  },{roomId,label});
}

async function snapshot(page){return page.evaluate(()=>({peer:globalThis.__nostrProbe?.peer||"",messages:globalThis.__nostrProbe?.messages||[],error:globalThis.__nostrProbe?.error||"",rtt:globalThis.__nostrProbe?.rtt,sockets:globalThis.__nostrProbe?.mod?.getRelaySockets?.()||{}}));}

try{
  await Promise.all([setup(a,"a"),setup(b,"b")]);
  const deadline=Date.now()+30000;let sa,sb;
  while(Date.now()<deadline){[sa,sb]=await Promise.all([snapshot(a),snapshot(b)]);if(sa.peer&&sb.peer)break;if(sa.error&&sb.error)break;await new Promise(r=>setTimeout(r,250));}
  if(!sa?.peer||!sb?.peer)throw new Error(`Nostr relay peers did not pair: A=${JSON.stringify(sa)} B=${JSON.stringify(sb)}`);
  await a.evaluate(()=>globalThis.__nostrProbe.action.send({from:"a",value:42},{target:globalThis.__nostrProbe.peer}));
  await b.evaluate(()=>globalThis.__nostrProbe.action.send({from:"b",value:84},{target:globalThis.__nostrProbe.peer}));
  const messageDeadline=Date.now()+10000;
  while(Date.now()<messageDeadline){[sa,sb]=await Promise.all([snapshot(a),snapshot(b)]);if(sa.messages.some(x=>x.data?.from==="b")&&sb.messages.some(x=>x.data?.from==="a"))break;await new Promise(r=>setTimeout(r,200));}
  if(!sa.messages.some(x=>x.data?.from==="b")||!sb.messages.some(x=>x.data?.from==="a"))throw new Error(`Nostr relay bidirectional action failed: A=${JSON.stringify(sa)} B=${JSON.stringify(sb)}`);
  await a.evaluate(async()=>{globalThis.__nostrProbe.rtt=await globalThis.__nostrProbe.room.ping(globalThis.__nostrProbe.peer);});
  sa=await snapshot(a);sb=await snapshot(b);
  if(!Number.isFinite(sa.rtt)||sa.rtt<0)throw new Error(`Nostr relay ping failed: ${JSON.stringify(sa)}`);
  for(const side of [sa,sb]){if(side.error)throw new Error(`Nostr relay join error: ${side.error}`);if(!Object.values(side.sockets).some(socket=>socket.readyState===1))throw new Error(`No Nostr relay websocket open: ${JSON.stringify(side.sockets)}`);}
  console.log(`Nostr data relay browser smoke passed: two browsers paired, E2EE bidirectional action + ping; rtt=${sa.rtt.toFixed(1)}ms`);
}finally{
  await Promise.allSettled([a.evaluate(()=>globalThis.__nostrProbe?.room?.leave?.()),b.evaluate(()=>globalThis.__nostrProbe?.room?.leave?.())]);
  await browser.close();
}
