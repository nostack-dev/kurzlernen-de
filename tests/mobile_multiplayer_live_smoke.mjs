import puppeteer from "puppeteer-core";
import {mkdir} from "node:fs/promises";

const input=process.argv[2]||"https://kurzlernen.de/drone_simulator.html",base=new URL(input),executablePath=process.env.CHROME_BIN;
// This smoke covers the drone start; the game itself starts on foot by default.
if(!base.searchParams.has("start"))base.searchParams.set("start","drone");
if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");
const launchArgs=["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader","--autoplay-policy=no-user-gesture-required"];
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function bounded(promise,ms,label){let timer=0;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`${label} timed out after ${ms} ms`)),ms);})]);}finally{clearTimeout(timer);}}
async function makePhone(label){
  const browser=await puppeteer.launch({headless:true,executablePath,args:launchArgs}),page=await browser.newPage(),url=new URL(base.href);url.searchParams.set("multiplayer-phone",label);
  await page.evaluateOnNewDocument(()=>{globalThis.__vsLiveEvents=[];addEventListener("arondight45:vs-network",event=>{const d=event?.detail||{};globalThis.__vsLiveEvents.push({stage:String(d.stage||""),transport:String(d.transport||""),roomId:String(d.roomId||""),peerCount:Number(d.peerCount)||0,reason:String(d.reason||""),error:String(d.error||"")});if(globalThis.__vsLiveEvents.length>40)globalThis.__vsLiveEvents.splice(0,globalThis.__vsLiveEvents.length-40);});});
  await page.setUserAgent(`Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1 ${label}`);
  await page.setViewport({width:844,height:390,deviceScaleFactor:1,isMobile:true,hasTouch:true});
  await bounded(page.goto(url.href,{waitUntil:"load",timeout:45000}),50000,`${label} goto`);
  await page.waitForFunction(()=>document.querySelector("#status")?.textContent?.includes("SIM ready")&&globalThis.__arondightRealWorld&&document.querySelector("#mobileGameplayMultiplayer")&&document.querySelector("#lanVsButton"),{timeout:45000});
  const ui=await bounded(page.evaluate(()=>{const mobile=document.querySelector("#mobileGameplayMultiplayer"),source=document.querySelector("#lanVsButton"),topbar=document.querySelector("#soloTopbar"),v=document.querySelector("#viewport");return{mobileDisplay:getComputedStyle(mobile).display,sourceExists:Boolean(source),topbarDisplay:getComputedStyle(topbar).display,mobileUi:v?.dataset.mobileMultiplayerUi,state:v?.dataset.mobileMultiplayerState,policy:v?.dataset.mobileMultiplayerDiscoveryPolicy,stageRooms:Number(v?.dataset.mobileMultiplayerStageRooms)||0,stageMs:Number(v?.dataset.mobileMultiplayerStageMs)||0};}),8000,`${label} ui snapshot`);
  if(ui.mobileDisplay==="none"||!ui.sourceExists||ui.topbarDisplay!=="none"||ui.mobileUi!=="visible-v1")throw new Error(`${label} mobile multiplayer entry is not restored: ${JSON.stringify(ui)}`);
  return{browser,page,label};
}
async function cheapSnapshot(page,label="phone"){
  return bounded(page.evaluate(()=>{const b=globalThis.__arondightRealWorld,v=document.querySelector("#viewport"),button=document.querySelector("#mobileGameplayMultiplayer"),status=document.querySelector("#mobileGameplayMultiplayerStatus"),finder=b?.vsSession,active=finder?.active||finder,poseAge=Number(v?.dataset.vsPoseAgeMs);return{connected:Boolean(b?.vsConnected),starting:Boolean(b?.vsStarting),hasSession:Boolean(finder),vsPlayers:Number(v?.dataset.vsPlayerCount)||0,vsPeers:Number(v?.dataset.vsPeerCount)||0,mobileState:v?.dataset.mobileMultiplayerState||"",mobilePlayers:Number(v?.dataset.mobileMultiplayerPlayers)||0,intent:v?.dataset.mobileMultiplayerIntent||"",retryCount:Number(finder?.retryCount??v?.dataset.mobileMultiplayerRetryCount)||0,buttonText:button?.textContent?.trim()||"",buttonState:button?.dataset.state||"",statusText:status?.textContent?.trim()||"",poseAge:Number.isFinite(poseAge)?poseAge:null,poseMode:v?.dataset.vsPoseMode||"",poseFrame:v?.dataset.vsPoseFrame||"",frameMismatch:Number(v?.dataset.vsPoseFrameMismatch)||0,policy:v?.dataset.mobileMultiplayerDiscoveryPolicy||"",policyRooms:Number(v?.dataset.mobileMultiplayerStageRooms)||0,policyStageMs:Number(v?.dataset.mobileMultiplayerStageMs)||0,roomIds:Array.isArray(finder?.roomIds)?finder.roomIds.slice():[],stageRoomIds:Array.isArray(finder?.stageRoomIds)?finder.stageRoomIds.slice():[],activeRoom:String(active?.roomId||""),transport:String(active?.transportName||""),networkEvents:(globalThis.__vsLiveEvents||[]).slice(-16)};}),10000,`${label} cheap multiplayer snapshot`);
}
async function renderSnapshot(page,label="phone"){
  return bounded(page.evaluate(()=>{const b=globalThis.__arondightRealWorld,v=document.querySelector("#viewport"),legacy=b?.vsPeerMesh;let remoteHumans=0,visibleRemoteHumans=0,currentTaggedPeers=0;b?.threeScene?.traverse?.(node=>{if(node.userData?.vsMultiplayerPeer)currentTaggedPeers++;if(node.userData?.vsHumanAvatar&&!node.userData?.localHumanAvatar){remoteHumans++;if(node.visible!==false)visibleRemoteHumans++;}});const legacyPeerVisible=Boolean(legacy?.parent&&legacy.visible),markers=[...document.querySelectorAll(".vs-player-marker")],visibleMarkers=markers.filter(el=>getComputedStyle(el).display!=="none"&&getComputedStyle(el).visibility!=="hidden").length;return{legacyPeerVisible,legacyPeerTag:legacy?.userData?.vsPeer===true,remoteHumans,visibleRemoteHumans,currentTaggedPeers,visibleMarkers,remoteVisuals:(legacyPeerVisible?1:0)+visibleRemoteHumans+currentTaggedPeers+visibleMarkers,poseAge:Number(v?.dataset.vsPoseAgeMs),poseMode:v?.dataset.vsPoseMode||"",poseFrame:v?.dataset.vsPoseFrame||""};}),15000,`${label} one-shot remote render check`);
}
function paired(s){return Boolean(s?.connected&&s.mobileState==="connected"&&s.mobilePlayers>=2&&s.vsPlayers>=2&&s.vsPeers>=1&&s.buttonState==="connected"&&String(s.buttonText).includes("2P")&&String(s.statusText).includes("P 2"));}
async function waitPair(a,b,timeout=65000){const end=Date.now()+timeout;let sa=null,sb=null;while(Date.now()<end){sa=await cheapSnapshot(a.page,a.label);sb=await cheapSnapshot(b.page,b.label);if(paired(sa)&&paired(sb))return{sa,sb};await pause(500);}throw new Error(`phones did not pair: ${JSON.stringify({phoneA:sa,phoneB:sb})}`);}
async function closeSafely(item){if(!item?.browser)return;try{await bounded(item.browser.close(),5000,`${item.label} browser close`);}catch{try{item.browser.process()?.kill("SIGKILL");}catch{}}}

let a,b;
try{
  [a,b]=await bounded(Promise.all([makePhone("phone-a"),makePhone("phone-b")]),65000,"create two independent mobile browsers");
  await bounded(a.page.click("#mobileGameplayMultiplayer"),5000,"start phone-a multiplayer");
  await pause(180);
  await bounded(b.page.click("#mobileGameplayMultiplayer"),5000,"start phone-b multiplayer");
  await pause(180);
  const finding=[await cheapSnapshot(a.page,a.label),await cheapSnapshot(b.page,b.label)];
  if(finding.some(x=>!x.hasSession&&x.mobileState!=="finding"))throw new Error(`MULTI button did not enter real VS discovery: ${JSON.stringify(finding)}`);
  const{sa,sb}=await bounded(waitPair(a,b),70000,"dual-phone connection");
  if(sa.policy!=="trusted1+gesture2-v1"||sb.policy!=="trusted1+gesture2-v1"||sa.stageRoomIds.length>3||sb.stageRoomIds.length>3)throw new Error(`bounded mobile discovery policy is not active: ${JSON.stringify({sa,sb})}`);
  // Poses arrive asynchronously after the data channel opens; give both
  // phones a bounded window to receive and draw the first remote pose.
  let ra,rb;for(const until=Date.now()+12000;;){ra=await renderSnapshot(a.page,a.label);rb=await renderSnapshot(b.page,b.label);if((ra.remoteVisuals>=1&&rb.remoteVisuals>=1)||Date.now()>until)break;await pause(400);}
  if(!(ra.remoteVisuals>=1&&rb.remoteVisuals>=1))throw new Error(`paired phones did not both render remote participant: ${JSON.stringify({phoneA:{state:sa,render:ra},phoneB:{state:sb,render:rb}})}`);
  if(!((Number.isFinite(ra.poseAge)&&ra.poseAge>=0)||(Number.isFinite(rb.poseAge)&&rb.poseAge>=0)))throw new Error(`no replicated remote pose was observed: ${JSON.stringify({ra,rb})}`);
  await mkdir("artifacts",{recursive:true});
  await bounded(a.page.screenshot({path:"artifacts/mobile-multiplayer-a.png",captureBeyondViewport:false}),12000,"phone-a multiplayer screenshot");
  await bounded(b.page.screenshot({path:"artifacts/mobile-multiplayer-b.png",captureBeyondViewport:false}),12000,"phone-b multiplayer screenshot");
  await bounded(a.page.click("#mobileGameplayMultiplayer"),5000,"stop phone-a multiplayer");
  await pause(120);
  await bounded(b.page.click("#mobileGameplayMultiplayer"),5000,"stop phone-b multiplayer");
  await pause(700);
  const stopped=[await cheapSnapshot(a.page,a.label),await cheapSnapshot(b.page,b.label)];
  if(stopped.some(x=>x.hasSession||x.connected||x.mobileState!=="offline"||x.intent!=="off"))throw new Error(`mobile multiplayer did not stop cleanly: ${JSON.stringify(stopped)}`);
  console.log(`Dual-mobile live multiplayer passed. ${JSON.stringify({phoneA:{state:sa,render:ra},phoneB:{state:sb,render:rb},stopped})}`);
}catch(error){let diagnostic={};try{diagnostic.phoneA=a?await cheapSnapshot(a.page,a.label):null;}catch(e){diagnostic.phoneAError=String(e?.message||e);}try{diagnostic.phoneB=b?await cheapSnapshot(b.page,b.label):null;}catch(e){diagnostic.phoneBError=String(e?.message||e);}console.error(`Dual-mobile multiplayer diagnostic: ${JSON.stringify(diagnostic)}`);throw error;
}finally{await Promise.allSettled([closeSafely(a),closeSafely(b)]);}
