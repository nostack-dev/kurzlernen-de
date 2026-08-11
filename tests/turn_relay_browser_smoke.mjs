import puppeteer from "puppeteer-core";

const base=process.argv[2]||"http://127.0.0.1:4174";
const executablePath=process.env.CHROME_BIN;
if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");

const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage"]});
const page=await browser.newPage();
try{
  await page.goto(`${base}/drone_simulator.html`,{waitUntil:"load",timeout:30000});
  const result=await page.evaluate(async()=>{
    const {createDefaultTurnConfig}=await import("/sim/lan_vs.mjs");
    const iceServers=await createDefaultTurnConfig();
    const a=new RTCPeerConnection({iceServers,iceTransportPolicy:"relay"});
    const b=new RTCPeerConnection({iceServers,iceTransportPolicy:"relay"});
    const relayCandidates=[];
    let remoteChannel=null;
    const addCandidate=(target,label)=>event=>{
      if(event.candidate){
        if(event.candidate.type==="relay"||String(event.candidate.candidate||"").includes(" typ relay "))relayCandidates.push({label,candidate:event.candidate.candidate,protocol:event.candidate.protocol||""});
        target.addIceCandidate(event.candidate).catch(()=>{});
      }
    };
    a.onicecandidate=addCandidate(b,"a");
    b.onicecandidate=addCandidate(a,"b");
    const localChannel=a.createDataChannel("turn-probe");
    b.ondatachannel=event=>{remoteChannel=event.channel;};
    const offer=await a.createOffer();await a.setLocalDescription(offer);await b.setRemoteDescription(offer);
    const answer=await b.createAnswer();await b.setLocalDescription(answer);await a.setRemoteDescription(answer);
    const opened=await new Promise((resolve,reject)=>{
      const deadline=setTimeout(()=>reject(new Error(`TURN relay datachannel timeout; a=${a.iceConnectionState}/${a.connectionState}, b=${b.iceConnectionState}/${b.connectionState}, relays=${relayCandidates.length}`)),20000);
      const poll=()=>{
        if(localChannel.readyState==="open"&&remoteChannel?.readyState==="open"&&relayCandidates.length>=2){clearTimeout(deadline);resolve(true);return;}
        setTimeout(poll,50);
      };
      poll();
    });
    const stats=async pc=>{
      const report=await pc.getStats(),records=[];report.forEach(v=>records.push(v));const byId=new Map(records.map(v=>[v.id,v]));
      const transport=records.find(v=>v.type==="transport"&&v.selectedCandidatePairId);let pair=transport?byId.get(transport.selectedCandidatePairId):null;
      if(!pair)pair=records.find(v=>v.type==="candidate-pair"&&v.state==="succeeded"&&v.nominated)||records.find(v=>v.type==="candidate-pair"&&v.state==="succeeded");
      const local=pair?byId.get(pair.localCandidateId):null,remote=pair?byId.get(pair.remoteCandidateId):null;
      return{connectionState:pc.connectionState,iceConnectionState:pc.iceConnectionState,localType:local?.candidateType||"",remoteType:remote?.candidateType||"",relayProtocol:local?.relayProtocol||remote?.relayProtocol||""};
    };
    const out={opened,relayCandidates,a:await stats(a),b:await stats(b),turnUrls:iceServers.flatMap(s=>Array.isArray(s.urls)?s.urls:[s.urls])};
    localChannel.close();remoteChannel?.close();a.close();b.close();return out;
  });
  if(!result.opened)throw new Error(`TURN probe did not open: ${JSON.stringify(result)}`);
  if(result.relayCandidates.length<2)throw new Error(`TURN probe produced insufficient relay candidates: ${JSON.stringify(result)}`);
  if(result.a.localType!=="relay"&&result.a.remoteType!=="relay")throw new Error(`A did not select relay pair: ${JSON.stringify(result)}`);
  if(result.b.localType!=="relay"&&result.b.remoteType!=="relay")throw new Error(`B did not select relay pair: ${JSON.stringify(result)}`);
  console.log(`TURN relay browser smoke passed: relay-only WebRTC datachannel opened; candidates=${result.relayCandidates.length}; A=${result.a.iceConnectionState}; B=${result.b.iceConnectionState}`);
}finally{
  await browser.close();
}
