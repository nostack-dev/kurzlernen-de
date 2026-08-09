import puppeteer from "puppeteer-core";

const base=process.argv[2]||"http://127.0.0.1:4174";
const executablePath=process.env.CHROME_BIN;
if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");
const args=["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader","--use-fake-ui-for-media-stream","--use-fake-device-for-media-stream","--disable-background-timer-throttling","--disable-backgrounding-occluded-windows","--disable-renderer-backgrounding","--disable-features=CalculateNativeWinOcclusion"];
const viewBrowser=await puppeteer.launch({headless:true,executablePath,args,protocolTimeout:120000});
const controllerBrowser=await puppeteer.launch({headless:true,executablePath,args,protocolTimeout:120000});
const errors=[];
function watch(page,name){page.on("pageerror",error=>errors.push(`${name} pageerror: ${error.message}`));page.on("console",message=>{if(message.type()==="error")errors.push(`${name} console: ${message.text()}`);});}
async function waitText(page,selector,needle,timeout=30000){await page.waitForFunction((sel,text)=>document.querySelector(sel)?.textContent?.includes(text),{timeout},selector,needle);}
async function setValue(page,selector,value){await page.$eval(selector,(element,text)=>{element.value=text;element.dispatchEvent(new Event("input",{bubbles:true}));},value);}
async function invoke(page,selector){await page.$eval(selector,element=>element.click());}
async function clickWhenEnabled(page,selector,expectedText="ARM",timeout=15000){await page.waitForFunction((sel,text)=>{const b=document.querySelector(sel);return b&&!b.disabled&&b.textContent.trim()===text;},{timeout},selector,expectedText);const result=await page.$eval(selector,(b,text)=>{if(b.disabled||b.textContent.trim()!==text)return{clicked:false,disabled:b.disabled,text:b.textContent.trim()};b.click();return{clicked:true,disabled:b.disabled,text:b.textContent.trim()};},expectedText);if(!result.clicked)throw new Error(`atomic click failed on ${selector}: ${JSON.stringify(result)}`);return result;}
async function simTime(page){return page.$eval("#simTime",element=>parseFloat(element.textContent||"0"));}
async function waitSim(page,target,timeout=60000){await page.waitForFunction(value=>parseFloat(document.querySelector("#simTime")?.textContent||"0")>=value,{timeout},target);}
async function snapshot(page){return page.evaluate(()=>({simTime:document.querySelector("#simTime")?.textContent||"",state:document.querySelector("#fcState")?.textContent||"",remote:document.querySelector("#remoteStatus")?.textContent||"",motors:document.querySelector("#motors")?.textContent||"",altitude:document.querySelector("#altitude")?.textContent||"",velocity:document.querySelector("#velocity")?.textContent||"",attitude:document.querySelector("#attitude")?.textContent||"",armSwitch:document.querySelector("#armSwitch")?.textContent||""}));}
async function stickBox(page,selector){return page.$eval(selector,element=>{const r=element.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};});}
async function yaw(page){return page.$eval("#attitude",element=>{const parts=(element.textContent||"").match(/-?\d+(?:\.\d+)?/g)||[];return Number(parts[2]||0);});}
async function setClearanceByButtons(page,target){for(let i=0;i<300;i++){const current=await page.$eval("#gameClearance",e=>Number(e.dataset.targetAglM));if(!Number.isFinite(current))throw new Error("target AGL dataset unavailable");if(Math.abs(current-target)<=.051)return current;await page.click(current<target?"#gameUp":"#gameDown");}throw new Error(`could not set target AGL ${target}`);}
async function holdHeightPad(page,axis,ms){const b=await stickBox(page,"#gameHeightPad"),cx=b.x+b.w/2,cy=b.y+b.h/2,span=b.h*.40;await page.mouse.move(cx,cy);await page.mouse.down();await page.mouse.move(cx,cy-span*axis,{steps:4});await new Promise(r=>setTimeout(r,ms));await page.mouse.up();}

async function flightSamples(page){return page.evaluate(async()=>{const original=URL.createObjectURL;let captured=null;URL.createObjectURL=blob=>{captured=blob;return original.call(URL,blob);};try{document.querySelector("#exportLog")?.click();await new Promise(resolve=>setTimeout(resolve,0));if(!captured)throw new Error("flight log blob was not captured");const log=JSON.parse(await captured.text()),samples=log?.samples||[];if(!samples.length)throw new Error("flight log has no samples");return samples;}finally{URL.createObjectURL=original;}});}
function bodyMotion(sample){const yawRad=(Number(sample.yaw_deg)||0)*Math.PI/180,c=Math.cos(yawRad),s=Math.sin(yawRad),vx=Number(sample.vx)||0,vy=Number(sample.vy)||0,vz=Number(sample.vz)||0;return{time:Number(sample.time_s)||0,forward:-c*vx-s*vy,right:-s*vx+c*vy,horizontal:Math.hypot(vx,vy),vertical:vz,speed:Math.hypot(vx,vy,vz),altitude:Number(sample.z)||0,yaw:Number(sample.yaw_deg)||0,pitch:Number(sample.pitch_deg)||0,roll:Number(sample.roll_deg)||0};}
function traceAtOffsets(samples,start,offsets){return offsets.map(offset=>{const target=start+offset;let best=samples[0],bestDistance=Infinity;for(const sample of samples){const d=Math.abs((Number(sample.time_s)||0)-target);if(d<bestDistance){best=sample;bestDistance=d;}else if((Number(sample.time_s)||0)>target&&d>bestDistance)break;}return{offset,...bodyMotion(best)};});}
async function liveMotion(view,controller){
  const measured=await controller.$eval("#gameClearance",element=>({forward:Number(element.dataset.navForwardMps),right:Number(element.dataset.navRightMps),vertical:Number(element.dataset.navVerticalMps),agl:Number(element.dataset.aglM),yaw:Number(element.dataset.yawDeg)}));
  if(!Object.values(measured).every(Number.isFinite))throw new Error(`measured navigation dataset unavailable: ${JSON.stringify(measured)}`);
  const viewState=await view.evaluate(()=>{const parts=(document.querySelector("#attitude")?.textContent||"").match(/-?\d+(?:\.\d+)?/g)||[];return{time:parseFloat(document.querySelector("#simTime")?.textContent||"NaN"),altitude:parseFloat(document.querySelector("#altitude")?.textContent||"NaN"),speed:parseFloat(document.querySelector("#velocity")?.textContent||"NaN"),state:document.querySelector("#fcState")?.textContent||"",roll:Number(parts[0]||0),pitch:Number(parts[1]||0),motors:(document.querySelector("#motors")?.textContent||"").trim().split(/\s+/).map(Number)};});
  return{...viewState,...measured,horizontal:Math.hypot(measured.forward,measured.right)};
}
async function liveTrace(view,controller,start,offsets,timeout=90000){const trace=[];for(const offset of offsets){await waitSim(view,start+offset,timeout);trace.push({offset,...await liveMotion(view,controller)});}return trace;}

const view=await viewBrowser.newPage(),controller=await controllerBrowser.newPage();watch(view,"view");watch(controller,"controller");
try{
  await view.setViewport({width:844,height:390,deviceScaleFactor:1});await controller.setViewport({width:844,height:390,deviceScaleFactor:1});
  await Promise.all([view.goto(`${base}/drone_simulator.html`,{waitUntil:"load",timeout:30000}),controller.goto(`${base}/drone_controller.html`,{waitUntil:"load",timeout:30000})]);
  await waitText(view,"#status","SIM ready",30000);
  if(await view.$eval("#inputSource",element=>element.value)!=="remote")throw new Error("remote phone is not primary input");

  await controller.click("#connect");
  await controller.waitForFunction(()=>document.querySelector("#offerCode")?.value?.length>100,{timeout:20000});
  await controller.waitForFunction(()=>document.querySelector("#offerQr")?.src?.startsWith("data:image"),{timeout:20000});
  const offer=await controller.$eval("#offerCode",element=>element.value);
  await view.click("#remoteConnect");await setValue(view,"#remoteOffer",offer);await invoke(view,"#acceptOffer");
  await view.waitForFunction(()=>document.querySelector("#remoteAnswer")?.value?.length>100,{timeout:20000});
  await view.waitForFunction(()=>document.querySelector("#answerQr")?.src?.startsWith("data:image"),{timeout:20000});
  const answer=await view.$eval("#remoteAnswer",element=>element.value);await setValue(controller,"#answerCode",answer);await invoke(controller,"#applyAnswer");
  await waitText(view,"#remoteStatus","P2P LINKED",30000);await waitText(controller,"#connection","P2P LINKED",30000);
  console.log("Serverless P2P E2E: QR payloads generated and two independent browser processes paired.");

  await waitSim(view,0.05,15000);await waitSim(view,2.2,60000);
  let state=await view.$eval("#fcState",element=>element.textContent||"");
  if(state!=="DISARMED")throw new Error(`calibration failed: ${JSON.stringify(await snapshot(view))}`);
  await waitText(controller,"#gameModeButton","MODE · GAME",10000);
  const labels=await controller.evaluate(()=>({leftTop:document.querySelector("#leftTopLabel")?.textContent||"",top:document.querySelector("#rightTopLabel")?.textContent||"",bottom:document.querySelector("#rightBottomLabel")?.textContent||""}));
  if(!labels.leftTop.includes("W")||labels.top!=="NOSE UP"||labels.bottom!=="NOSE DOWN")throw new Error(`GAME shooter labels wrong: ${JSON.stringify(labels)}`);
  const clearance=await controller.$eval("#gameClearance",element=>({value:Number(element.dataset.targetAglM),pad:Boolean(document.querySelector("#gameHeightPad"))}));if(Math.abs(clearance.value-1.2)>0.01||!clearance.pad)throw new Error(`unexpected ground-clearance config ${JSON.stringify(clearance)}`);
  await controller.click(".phone-settings-button");await controller.waitForFunction(()=>document.querySelector(".phone-settings-dialog")?.open,{timeout:5000});
  const leftInvertInitially=await controller.$eval('.phone-settings-dialog [data-invert-left-horizontal]',e=>e.checked);if(leftInvertInitially)throw new Error("left invert unexpectedly enabled by default");
  await controller.click('.phone-settings-dialog [data-invert-left-horizontal]');
  await controller.waitForFunction(()=>JSON.parse(localStorage.getItem("arondight45PhoneControlSettingsV5")||"{}").invertLeftHorizontal===true,{timeout:5000});
  await controller.click('.phone-settings-dialog [data-close]');
  const settingLeft=await stickBox(controller,"#leftStick"),settingX=settingLeft.x+settingLeft.w/2,settingY=settingLeft.y+settingLeft.h/2,settingR=Math.min(settingLeft.w,settingLeft.h)*.42;
  await controller.mouse.move(settingX,settingY);await controller.mouse.down();await controller.mouse.move(settingX+settingR*.55,settingY,{steps:4});
  await controller.waitForFunction(()=>/STR -[1-9]/.test(document.querySelector("#leftValue")?.textContent||""),{timeout:5000});await controller.mouse.up();
  await controller.click(".phone-settings-button");await controller.waitForFunction(()=>document.querySelector(".phone-settings-dialog")?.open,{timeout:5000});await controller.click('.phone-settings-dialog [data-invert-left-horizontal]');
  await controller.waitForFunction(()=>JSON.parse(localStorage.getItem("arondight45PhoneControlSettingsV5")||"{}").invertLeftHorizontal===false,{timeout:5000});await controller.click('.phone-settings-dialog [data-close]');
  await controller.waitForFunction(()=>document.querySelector("#gameSensorStatus")?.textContent?.includes("AGL"),{timeout:15000});
  await setClearanceByButtons(controller,2.0);await waitText(controller,"#gameClearanceValue","2.0 m",10000);

  const armStart=await simTime(view);await clickWhenEnabled(controller,"#arm","ARM",15000);await waitText(controller,"#arm","ARM REQUESTED",10000);
  try{await view.waitForFunction(()=>document.querySelector("#fcState")?.textContent==="ARMED",{timeout:65000});}catch{throw new Error(`GAME remote arming never reached ARMED: ${JSON.stringify(await snapshot(view))}`);}
  const armEnd=await simTime(view),armingDuration=armEnd-armStart;if(armingDuration>1.5)throw new Error(`GAME remote arming too slow in simulation: ${armingDuration.toFixed(3)}s · ${JSON.stringify(await snapshot(view))}`);
  await waitText(controller,"#arm","ARMED ✓",10000);console.log(`State-control E2E: GAME armed after ${armingDuration.toFixed(3)} simulated seconds.`);

  const stateTrace=[];const traceTimer=setInterval(async()=>{try{const v=await snapshot(view);const c=await controller.evaluate(()=>({arm:document.querySelector("#arm")?.textContent||"",sensor:document.querySelector("#gameSensorStatus")?.textContent||"",connection:document.querySelector("#connection")?.textContent||""}));const point={wall:Date.now(),...v,controllerArm:c.arm,sensor:c.sensor,controllerConnection:c.connection};const prev=stateTrace[stateTrace.length-1];if(!prev||prev.state!==point.state||prev.remote!==point.remote||prev.armSwitch!==point.armSwitch||prev.sensor!==point.sensor||prev.controllerArm!==point.controllerArm)stateTrace.push(point);}catch{}},75);
  try{await view.waitForFunction(()=>{const z=parseFloat(document.querySelector("#altitude")?.textContent||"0"),v=parseFloat(document.querySelector("#velocity")?.textContent||"99");return z>1.55&&z<2.45&&v<.55;},{timeout:90000});}
  catch{const aglSamples=await flightSamples(view),aglTrace=traceAtOffsets(aglSamples,armEnd,[0,.5,1,1.5,2,2.5,3,3.5,4,5,6,8,10]);clearInterval(traceTimer);throw new Error(`2m AGL convergence timeout: snapshot=${JSON.stringify(await snapshot(view))} transitions=${JSON.stringify(stateTrace)} trace=${JSON.stringify(aglTrace)}`);}
  clearInterval(traceTimer);
  const holdStart=await simTime(view);await waitSim(view,holdStart+.35,25000);const hold=await liveMotion(view,controller);
  if(!(hold.altitude>1.45&&hold.altitude<2.55&&Math.abs(hold.vertical)<.65))throw new Error(`2m AGL did not settle: ${JSON.stringify(hold)}`);
  if(hold.state!=="ARMED")throw new Error(`AGL settled without armed motor authority: ${JSON.stringify(hold)}`);
  if(!hold.motors.some(value=>Number.isFinite(value)&&value>1050))throw new Error(`AGL controller produced no physical motor thrust: ${hold.motors.join(" ")}`);
  console.log(`State-control E2E: 2m AGL settled at ${hold.altitude.toFixed(2)}m, vz=${hold.vertical.toFixed(2)}m/s.`);

  await controller.click("#gameUp");
  await controller.waitForFunction(()=>Math.abs(Number(document.querySelector("#gameClearance")?.dataset.targetAglM)-2.1)<.06,{timeout:5000});
  await controller.click("#gameDown");
  await controller.waitForFunction(()=>Math.abs(Number(document.querySelector("#gameClearance")?.dataset.targetAglM)-2.0)<.06,{timeout:5000});
  const targetBeforePad=await controller.$eval("#gameClearance",e=>Number(e.dataset.targetAglM));await holdHeightPad(controller,1,.22e3);const targetAfterPad=await controller.$eval("#gameClearance",e=>Number(e.dataset.targetAglM));if(!(targetAfterPad>targetBeforePad+.35))throw new Error(`spring-centred height pad did not slew target: ${targetBeforePad} -> ${targetAfterPad}`);
  await setClearanceByButtons(controller,2.8);await waitText(controller,"#gameClearanceValue","2.8 m",10000);
  console.log("Human height controls: spring-centred climb/HOLD/descend pad plus deterministic nudge buttons drive the real AGL target.");
  const clearanceStart=await simTime(view);await waitSim(view,clearanceStart+.55,30000);const clearanceRise=await liveMotion(view,controller);
  if(!(clearanceRise.altitude>hold.altitude+.08||clearanceRise.vertical>.18))throw new Error(`ground-clearance target did not command physical climb: before=${JSON.stringify(hold)}, after=${JSON.stringify(clearanceRise)}`);
  await setClearanceByButtons(controller,2.0);await view.waitForFunction(()=>{const z=parseFloat(document.querySelector("#altitude")?.textContent||"0"),v=parseFloat(document.querySelector("#velocity")?.textContent||"99");return z>1.55&&z<2.45&&v<.45;},{timeout:90000});

  const rightPitch=await stickBox(controller,"#rightStick"),pitchX=rightPitch.x+rightPitch.w/2,pitchY=rightPitch.y+rightPitch.h/2,pitchR=Math.min(rightPitch.w,rightPitch.h)*.42;
  const pitchBefore=await liveMotion(view,controller);
  await controller.mouse.move(pitchX,pitchY);await controller.mouse.down();await controller.mouse.move(pitchX,pitchY+pitchR*.85,{steps:6});
  const pitchStart=await simTime(view);await waitSim(view,pitchStart+.45,30000);const pitched=await liveMotion(view,controller);
  if(!(pitched.pitch>pitchBefore.pitch+4.0))throw new Error(`body-pitch command did not rotate aircraft nose-up: before=${JSON.stringify(pitchBefore)}, after=${JSON.stringify(pitched)}`);
  if(pitched.state!=="ARMED"||!pitched.motors.some(value=>value>1050))throw new Error(`body-pitch motor authority missing: ${JSON.stringify(pitched)}`);
  let pitchYawDelta=(pitched.yaw-pitchBefore.yaw)%360;if(pitchYawDelta>180)pitchYawDelta-=360;if(pitchYawDelta<-180)pitchYawDelta+=360;
  if(Math.abs(pitchYawDelta)>4.0)throw new Error(`body-pitch command leaked into heading: ${JSON.stringify({pitchBefore,pitched,pitchYawDelta})}`);
  await controller.mouse.up();
  console.log(`State-control E2E: right-stick up physically pitched airframe nose-up ${pitchBefore.pitch.toFixed(1)}° -> ${pitched.pitch.toFixed(1)}° through motors.`);

  await view.waitForFunction(()=>{const parts=(document.querySelector("#attitude")?.textContent||"").match(/-?\d+(?:\.\d+)?/g)||[],pitch=Number(parts[1]||0),speed=parseFloat(document.querySelector("#velocity")?.textContent||"99");return Math.abs(pitch)<2.0&&speed<.55;},{timeout:90000});
  const recovered=await liveMotion(view,controller);
  if(recovered.state!=="ARMED"||Math.abs(recovered.pitch)>=2.0||recovered.speed>=.55)throw new Error(`aircraft did not physically recover after body-pitch maneuver: ${JSON.stringify(recovered)}`);

  const left=await stickBox(controller,"#leftStick"),lcx=left.x+left.w/2,lcy=left.y+left.h/2,lr=Math.min(left.w,left.h)*.42;
  await controller.mouse.move(lcx,lcy);await controller.mouse.down();await controller.mouse.move(lcx,lcy-lr*.72,{steps:5});
  const forwardStart=await simTime(view);await waitSim(view,forwardStart+1.0,45000);const moving=await liveMotion(view,controller);
  if(moving.state!=="ARMED"||!moving.motors.some(value=>value>1050))throw new Error(`motor authority lost during forward vector: ${JSON.stringify(moving)}`);
  if(!(moving.forward>.30))throw new Error(`forward desired-vector did not produce forward motion: ${JSON.stringify(moving)}`);
  await controller.mouse.up();await waitText(controller,"#leftValue","FWD 0%",10000);

  const brakeStart=await simTime(view);const trace=await liveTrace(view,controller,brakeStart,[0,.4,.8,1.2,1.6,2.4,3.2,4.0]);const braked=trace[trace.length-1];console.log(`State-control braking trace: ${JSON.stringify(trace)}`);
  const peak=Math.max(...trace.map(point=>point.horizontal));
  if(trace.some(point=>point.state!=="ARMED"||!point.motors.some(value=>value>1050)))throw new Error(`motor authority dropped during zero-vector braking: ${JSON.stringify(trace)}`);
  if(peak>2.5)throw new Error(`zero-velocity braking transient is unbounded: peak=${peak.toFixed(3)} trace=${JSON.stringify(trace)}`);
  if(braked.horizontal>Math.max(.45,moving.horizontal*.75))throw new Error(`zero-horizontal-velocity target did not converge after physical counter-tilt: before=${JSON.stringify(moving)}, trace=${JSON.stringify(trace)}`);
  if(Math.abs(braked.vertical)>1.0)throw new Error(`AGL loop destabilized during horizontal braking: before=${JSON.stringify(moving)}, trace=${JSON.stringify(trace)}`);
  console.log(`State-control E2E: forward=${moving.forward.toFixed(2)}m/s, horizontal peak=${peak.toFixed(2)} -> ${braked.horizontal.toFixed(2)}m/s after counter-tilt, vz=${braked.vertical.toFixed(2)}m/s.`);

  await controller.mouse.move(lcx,lcy);await controller.mouse.down();await controller.mouse.move(lcx+lr*.65,lcy,{steps:5});
  const strafeStart=await simTime(view);const strafeCommandTrace=await liveTrace(view,controller,strafeStart,[0,.1,.2,.35,.5,.65,.8,1.0],45000);const strafing=strafeCommandTrace[strafeCommandTrace.length-1];console.log(`State-control strafe command trace: ${JSON.stringify(strafeCommandTrace)}`);
  if(strafeCommandTrace.some(point=>point.state!=="ARMED"||!point.motors.some(value=>value>1050)))throw new Error(`motor authority dropped during strafe vector: ${JSON.stringify(strafeCommandTrace)}`);
  if(strafing.right<.35)throw new Error(`strafe desired-vector sign/response wrong: final=${JSON.stringify(strafing)} trace=${JSON.stringify(strafeCommandTrace)}`);
  await controller.mouse.up();
  const strafeBrakeStart=await simTime(view);const strafeTrace=await liveTrace(view,controller,strafeBrakeStart,[0,.4,.8,1.2,1.6,2.4,3.2,4.0]),strafeBraked=strafeTrace[strafeTrace.length-1];const strafePeak=Math.max(...strafeTrace.map(point=>point.horizontal));
  if(strafeTrace.some(point=>point.state!=="ARMED"||!point.motors.some(value=>value>1050)))throw new Error(`motor authority dropped during strafe braking: ${JSON.stringify(strafeTrace)}`);
  if(strafePeak>2.5)throw new Error(`strafe braking transient is unbounded: peak=${strafePeak.toFixed(3)} trace=${JSON.stringify(strafeTrace)}`);
  if(strafeBraked.horizontal>Math.max(.50,strafing.horizontal*.78))throw new Error(`strafe zero-vector braking did not converge: before=${JSON.stringify(strafing)}, trace=${JSON.stringify(strafeTrace)}`);
  console.log(`State-control E2E: strafe right=${strafing.right.toFixed(2)}m/s, peak=${strafePeak.toFixed(2)} -> ${strafeBraked.horizontal.toFixed(2)}m/s.`);

  const yawBefore=await yaw(view);const right=await stickBox(controller,"#rightStick"),rcx=right.x+right.w/2,rcy=right.y+right.h/2,rr=Math.min(right.w,right.h)*.42;
  await controller.mouse.move(rcx,rcy);await controller.mouse.down();await controller.mouse.move(rcx+rr*.65,rcy,{steps:4});
  const turnStart=await simTime(view);await waitSim(view,turnStart+.30,25000);await controller.mouse.up();const yawAfter=await yaw(view);let yawDelta=(yawAfter-yawBefore)%360;if(yawDelta>180)yawDelta-=360;if(yawDelta<-180)yawDelta+=360;
  if(Math.abs(yawDelta)<4)throw new Error(`heading feedback did not rotate aircraft: before=${yawBefore}, after=${yawAfter}`);
  console.log(`State-control E2E: heading command rotated real attitude by ${yawDelta.toFixed(1)}°.`);

  const stall=controller.evaluate(()=>{const end=performance.now()+900;while(performance.now()<end){}return true;});await new Promise(resolve=>setTimeout(resolve,500));
  await view.waitForFunction(()=>document.querySelector("#fcState")?.textContent==="DISARMED",{timeout:10000});await stall;await waitText(view,"#remoteStatus","P2P LINKED",10000);
  await controller.click("#kill");
  await view.waitForFunction(()=>document.querySelector("#armSwitch")?.textContent==="OFF",{timeout:10000});
  await view.click("#reset");
  await view.waitForFunction(()=>parseFloat(document.querySelector("#simTime")?.textContent||"99")<.25,{timeout:5000});
  await waitSim(view,2.2,60000);
  await view.waitForFunction(()=>document.querySelector("#fcState")?.textContent==="DISARMED",{timeout:30000});await waitText(view,"#remoteStatus","P2P LINKED",10000);await waitText(controller,"#connection","P2P LINKED",10000);
  await waitText(controller,"#fcState","DISARMED",15000);await controller.waitForFunction(()=>document.querySelector("#gameSensorStatus")?.textContent?.includes("AGL"),{timeout:15000});
  await clickWhenEnabled(controller,"#arm","ARM",15000);const rearmStart=await simTime(view);await view.waitForFunction(()=>document.querySelector("#fcState")?.textContent==="ARMED",{timeout:65000});
  const rearmDuration=(await simTime(view))-rearmStart;if(rearmDuration>1.5)throw new Error(`same-session GAME re-arm too slow after safe reset: ${rearmDuration.toFixed(3)}s`);
  console.log("Serverless P2P E2E: stale-control fail-safe recovered after safe reset on the same session with zero re-pairing.");

  await controllerBrowser.close();await new Promise(resolve=>setTimeout(resolve,800));await view.waitForFunction(()=>document.querySelector("#fcState")?.textContent==="DISARMED",{timeout:10000});
  const safe=await view.$eval("#motors",element=>(element.textContent||"").trim().split(/\s+/).map(Number));if(!safe.every(value=>value===1000))throw new Error(`controller-loss fail-safe did not stop motors: ${safe.join(" ")}`);
  const status=await view.$eval("#remoteStatus",element=>element.textContent||"");if(!/fail-safe|stale|reconnect|disconnected/i.test(status))throw new Error(`controller loss not surfaced: ${status}`);

  if(errors.length)throw new Error(errors.join("\n"));
  console.log("Serverless dual-phone GAME/STATE E2E passed: QR UX, WASD translation, Q/E height target, measured-nav arm gate, real right-stick nose pitch, forward/strafe physical convergence, heading control, stale-latched session recovery, hard-loss disarm.");
}finally{try{await controllerBrowser.close();}catch{}try{await viewBrowser.close();}catch{}}