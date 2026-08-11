import puppeteer from "puppeteer-core";

const base=process.argv[2]||"http://127.0.0.1:4174";
const executablePath=process.env.CHROME_BIN;
if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");

const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader"]});
const page=await browser.newPage();
try{
  await page.setViewport({width:844,height:390,deviceScaleFactor:1});
  await page.goto(`${base}/drone_simulator.html`,{waitUntil:"load",timeout:30000});
  await page.waitForFunction(()=>document.querySelector("#status")?.textContent.includes("SIM ready"),{timeout:30000});
  await page.waitForFunction(()=>document.body.classList.contains("solo-flight")&&document.querySelector("#soloLogbook"),{timeout:10000});
  await page.evaluate(()=>{
    localStorage.removeItem("arondight45NetworkLogV1");
    globalThis.dispatchEvent(new CustomEvent("arondight45:vs-network",{detail:{
      at:new Date().toISOString(),stage:"join-error",transport:"Nostr",roomId:"net-test-room",peerId:"peer-test",error:"ICE failed",
      connectionState:"failed",iceConnectionState:"failed",iceGatheringState:"complete",signalingState:"stable",rttMs:17.5,
      relays:[{url:"wss://relay.example",state:"open"}],selectedPair:{local:{candidateType:"host",protocol:"udp",address:"192.168.1.12",port:50000},remote:{candidateType:"host",protocol:"udp",address:"192.168.1.13",port:50001}}
    }}));
  });
  await page.waitForFunction(()=>{
    const events=JSON.parse(localStorage.getItem("arondight45NetworkLogV1")||"[]");return events.some(event=>event.stage==="join-error"&&event.error==="ICE failed"&&event.transport==="Nostr");
  },{timeout:3000});
  await page.click("#soloLogbook");
  await page.waitForFunction(()=>document.querySelector("#flightLogbookDialog")?.open,{timeout:3000});
  const state=await page.evaluate(()=>{
    const dialog=document.querySelector("#flightLogbookDialog"),text=dialog?.textContent||"",stored=JSON.parse(localStorage.getItem("arondight45NetworkLogV1")||"[]");
    return{text,stored,networkRows:dialog?.querySelectorAll(".network-log-entry").length||0};
  });
  for(const marker of ["NETWORK / VS","JOIN-ERROR","ICE failed","relay.example","192.168.1.12","192.168.1.13"]){if(!state.text.includes(marker))throw new Error(`network logbook missing ${marker}: ${state.text}`);}
  if(state.networkRows<1||state.stored.length<1)throw new Error(`network diagnostics were not persisted/rendered: ${JSON.stringify(state)}`);
  console.log("Network logbook browser smoke passed: join error + ICE/relay/candidate diagnostics persist and render");
}finally{
  await browser.close();
}
