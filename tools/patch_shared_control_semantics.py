from pathlib import Path

# controller.mjs: consume shared control semantics.
p=Path('sim/controller.mjs');s=p.read_text()
s=s.replace('import {QrScanner,renderQr} from "./qr_pairing.mjs";\n', 'import {QrScanner,renderQr} from "./qr_pairing.mjs";\nimport {neutralControls,armReady as sharedArmReady,normalizedPointer,applyStick,releaseStick,knobAxes,knobPercent} from "./control_semantics.mjs";\n',1)
s=s.replace('const clamp = (value,lo,hi) => Math.max(lo,Math.min(hi,value));\n','',1)
s=s.replace('let controls={roll:0,pitch:0,yaw:0,throttle:0,arm:false};','let controls=neutralControls();',1)
old='''function armReady(){
  return peer.linked && lastTelemetry.fc_state==="DISARMED" && controls.throttle<=0.035 && Math.abs(controls.roll)<0.12 && Math.abs(controls.pitch)<0.12 && Math.abs(controls.yaw)<0.15;
}
'''
new='''function armReady(){return sharedArmReady(lastTelemetry.fc_state,controls,peer.linked);}
'''
assert old in s;s=s.replace(old,new,1)
old='''function setKnob(knob,x,y){knob.style.left=`${50+clamp(x,-1,1)*42}%`;knob.style.top=`${50+clamp(y,-1,1)*42}%`;knob.style.transform="translate(-50%,-50%)";}
function updateSticks(){
  setKnob(ui.leftKnob,controls.yaw,1-2*controls.throttle);
  setKnob(ui.rightKnob,controls.roll,-controls.pitch);
'''
new='''function setKnob(knob,x,y){knob.style.left=`${knobPercent(x)}%`;knob.style.top=`${knobPercent(y)}%`;knob.style.transform="translate(-50%,-50%)";}
function updateSticks(){
  const left=knobAxes(controls,"left"),right=knobAxes(controls,"right");
  setKnob(ui.leftKnob,left.x,left.y);
  setKnob(ui.rightKnob,right.x,right.y);
'''
assert old in s;s=s.replace(old,new,1)
s=s.replace('function safetyNeutral(send=true){controls={roll:0,pitch:0,yaw:0,throttle:0,arm:false};updateSticks();if(send)publish(true);}','function safetyNeutral(send=true){controls=neutralControls();updateSticks();if(send)publish(true);}',1)
old='''function normalizedPointer(element,event){
  const rect=element.getBoundingClientRect(),cx=rect.left+rect.width/2,cy=rect.top+rect.height/2,r=Math.max(1,Math.min(rect.width,rect.height)*.42);
  let x=(event.clientX-cx)/r,y=(event.clientY-cy)/r;const length=Math.hypot(x,y);if(length>1){x/=length;y/=length;}return{x:clamp(x,-1,1),y:clamp(y,-1,1)};
}
'''
assert old in s;s=s.replace(old,'',1)
old='''  const release=event=>{if(event.pointerId!==pointer)return;pointer=null;if(kind==="left")controls.yaw=0;else{controls.roll=0;controls.pitch=0;}updateSticks();publish(true);};
  element.addEventListener("pointerup",release);element.addEventListener("pointercancel",release);
  function apply(event){const p=normalizedPointer(element,event);if(kind==="left"){controls.yaw=p.x;controls.throttle=clamp((1-p.y)/2,0,1);}else{controls.roll=p.x;controls.pitch=-p.y;}updateSticks();publish();}
'''
new='''  const release=event=>{if(event.pointerId!==pointer)return;pointer=null;releaseStick(controls,kind);updateSticks();publish(true);};
  element.addEventListener("pointerup",release);element.addEventListener("pointercancel",release);
  function apply(event){applyStick(controls,kind,normalizedPointer(element,event));updateSticks();publish();}
'''
assert old in s;s=s.replace(old,new,1)
p.write_text(s)

# simulator.mjs: use exactly same semantics in the local fullscreen path.
p=Path('sim/simulator.mjs');s=p.read_text()
s=s.replace('import {QrScanner,renderQr} from "./qr_pairing.mjs";\n', 'import {QrScanner,renderQr} from "./qr_pairing.mjs";\nimport {neutralControls,copyControls,armReady as sharedArmReady,normalizedPointer,applyStick,releaseStick,knobAxes,knobPercent} from "./control_semantics.mjs";\n',1)
s=s.replace('  #soloLeft .solo-knob{top:88%}\n','',1)
old='''let soloMode=false,soloPreviousInputSource="remote";
function soloStick(el,kind){
  const knob=el.querySelector(".solo-knob");let pointer=null;
  const apply=e=>{const r=el.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2,rad=r.width*.38;let x=(e.clientX-cx)/rad,y=(e.clientY-cy)/rad;const m=Math.hypot(x,y);if(m>1){x/=m;y/=m;}knob.style.left=`${50+x*38}%`;knob.style.top=`${50+y*38}%`;
    if(kind==="left"){ui.touchYaw.value=String(clamp(x,-1,1));ui.touchThrottle.value=String(clamp((1-y)/2,0,1));localThrottle=+ui.touchThrottle.value;}
    else{ui.touchRoll.value=String(clamp(x,-1,1));ui.touchPitch.value=String(clamp(-y,-1,1));}
  };
  el.addEventListener("pointerdown",e=>{pointer=e.pointerId;el.setPointerCapture(pointer);apply(e);e.preventDefault();});
  el.addEventListener("pointermove",e=>{if(e.pointerId===pointer)apply(e);});
  const release=e=>{if(e.pointerId!==pointer)return;pointer=null;if(kind==="left"){ui.touchYaw.value="0";knob.style.left="50%";}else{ui.touchRoll.value="0";ui.touchPitch.value="0";knob.style.left="50%";knob.style.top="50%";}e.preventDefault();};
  el.addEventListener("pointerup",release);el.addEventListener("pointercancel",release);
}
soloStick($("soloLeft"),"left");soloStick($("soloRight"),"right");
'''
new='''let soloMode=false,soloPreviousInputSource="remote",soloControls=neutralControls();
function updateSoloSticks(){
  for(const [id,kind] of [["soloLeft","left"],["soloRight","right"]]){const axes=knobAxes(soloControls,kind),knob=$(id).querySelector(".solo-knob");knob.style.left=`${knobPercent(axes.x)}%`;knob.style.top=`${knobPercent(axes.y)}%`;}
}
function soloStick(el,kind){
  let pointer=null;
  const apply=e=>{applyStick(soloControls,kind,normalizedPointer(el,e));updateSoloSticks();e.preventDefault();};
  el.addEventListener("pointerdown",e=>{pointer=e.pointerId;el.setPointerCapture(pointer);apply(e);});
  el.addEventListener("pointermove",e=>{if(e.pointerId===pointer)apply(e);});
  const release=e=>{if(e.pointerId!==pointer)return;pointer=null;releaseStick(soloControls,kind);updateSoloSticks();e.preventDefault();};
  el.addEventListener("pointerup",release);el.addEventListener("pointercancel",release);
}
soloStick($("soloLeft"),"left");soloStick($("soloRight"),"right");updateSoloSticks();
'''
assert old in s;s=s.replace(old,new,1)
old='''  soloMode=true;soloPreviousInputSource=inputSource;document.body.classList.add("solo-flight");soloHud.hidden=false;inputSource="local";ui.inputSource.value="local";localArm=false;arm=false;localThrottle=0;ui.touchThrottle.value="0";ui.touchRoll.value=ui.touchPitch.value=ui.touchYaw.value="0";$("soloLeft").querySelector(".solo-knob").style.cssText="left:50%;top:88%";$("soloRight").querySelector(".solo-knob").style.cssText="left:50%;top:50%";updateRemoteUI();resize();
'''
new='''  soloMode=true;soloPreviousInputSource=inputSource;soloControls=neutralControls();updateSoloSticks();document.body.classList.add("solo-flight");soloHud.hidden=false;inputSource="local";ui.inputSource.value="local";localArm=false;arm=false;localThrottle=0;updateRemoteUI();resize();
'''
assert old in s;s=s.replace(old,new,1)
old='''  localArm=false;arm=false;localThrottle=0;ui.touchThrottle.value="0";ui.touchRoll.value=ui.touchPitch.value=ui.touchYaw.value="0";inputSource=soloPreviousInputSource;ui.inputSource.value=inputSource;soloMode=false;soloHud.hidden=true;document.body.classList.remove("solo-flight");try{screen.orientation?.unlock?.();}catch{}try{if(document.fullscreenElement)await document.exitFullscreen();}catch{}updateRemoteUI();resize();
'''
new='''  soloControls=neutralControls();updateSoloSticks();localArm=false;arm=false;localThrottle=0;inputSource=soloPreviousInputSource;ui.inputSource.value=inputSource;soloMode=false;soloHud.hidden=true;document.body.classList.remove("solo-flight");try{screen.orientation?.unlock?.();}catch{}try{if(document.fullscreenElement)await document.exitFullscreen();}catch{}updateRemoteUI();resize();
'''
assert old in s;s=s.replace(old,new,1)
old='''$("camSolo").onclick=enterSolo;$("soloExit").onclick=exitSolo;
$("soloArm").onclick=()=>{localArm=!localArm;$("soloArm").textContent=localArm?"ARM ON":"ARM";ui.touchArm.textContent=`ARM request: ${localArm?"ON":"OFF"}`;};
$("soloKill").onclick=()=>{localArm=false;arm=false;localThrottle=0;ui.touchThrottle.value="0";ui.touchYaw.value="0";$("soloLeft").querySelector(".solo-knob").style.cssText="left:50%;top:88%";$("soloArm").textContent="ARM";};
'''
new='''$("camSolo").onclick=enterSolo;$("soloExit").onclick=exitSolo;
$("soloArm").onclick=()=>{if(soloControls.arm){soloControls.arm=false;return;}if(sharedArmReady(currentFcStateText(),soloControls,true))soloControls.arm=true;};
$("soloKill").onclick=()=>{soloControls=neutralControls();updateSoloSticks();arm=false;throttle=0;};
'''
assert old in s;s=s.replace(old,new,1)
# active control chooses same semantic object directly in solo mode.
old='''function activeControlState(){
  const neutral={roll:0,pitch:0,yaw:0,throttle:0,arm:false};
  effectiveInput=inputSource==="remote"?(remoteLink.current()||neutral):localControlState();
  arm=effectiveInput.arm;throttle=effectiveInput.throttle;return effectiveInput;
}
'''
new='''function activeControlState(){
  const neutral=neutralControls();
  effectiveInput=soloMode?copyControls(soloControls):(inputSource==="remote"?(remoteLink.current()||neutral):localControlState());
  arm=effectiveInput.arm;throttle=effectiveInput.throttle;return effectiveInput;
}
'''
assert old in s;s=s.replace(old,new,1)
# Reset solo controls too.
old='''  physics.reset(defaultParams(),initial);sequence=1;simTime=0;resetFlag=true;latest={motors:[1000,1000,1000,1000],attitude:[0,0,0],state:0,processingUs:0};localThrottle=throttle=0;localArm=arm=false;effectiveInput={roll:0,pitch:0,yaw:0,throttle:0,arm:false};replayIndex=0;sessionLog=[];
'''
new='''  physics.reset(defaultParams(),initial);sequence=1;simTime=0;resetFlag=true;latest={motors:[1000,1000,1000,1000],attitude:[0,0,0],state:0,processingUs:0};soloControls=neutralControls();updateSoloSticks();localThrottle=throttle=0;localArm=arm=false;effectiveInput=neutralControls();replayIndex=0;sessionLog=[];
'''
assert old in s;s=s.replace(old,new,1)
# Factor state text and make fullscreen ARM UI identical to paired gating.
old='''function render(){
  requestAnimationFrame(render);physics.render();updateCamera();const state=physics.state();
  const fcState=latest.state,fault=fcState>>8&255,stateText=fcState&STATE_FAULT?`FAULT ${fault}`:fcState&STATE_CALIBRATING?"CALIBRATING":fcState&STATE_ARMED?"ARMED":"DISARMED";ui.fcState.textContent=stateText;ui.fcState.className=fcState&STATE_FAULT?"bad":fcState&STATE_ARMED?"good":"warn";
'''
new='''function currentFcStateText(){const fcState=latest.state,fault=fcState>>8&255;return fcState&STATE_FAULT?`FAULT ${fault}`:fcState&STATE_CALIBRATING?"CALIBRATING":fcState&STATE_ARMED?"ARMED":"DISARMED";}
function render(){
  requestAnimationFrame(render);physics.render();updateCamera();const state=physics.state();
  const fcState=latest.state,fault=fcState>>8&255,stateText=currentFcStateText();ui.fcState.textContent=stateText;ui.fcState.className=fcState&STATE_FAULT?"bad":fcState&STATE_ARMED?"good":"warn";
'''
assert old in s;s=s.replace(old,new,1)
old='''const wall=(now-wallStart)/1000;ui.speed.textContent=(wall>0?(simTime-simStart)/wall:0).toFixed(2)+"×";if(soloMode){$("soloState").textContent=stateText;$("soloAlt").textContent=Math.max(0,state.z).toFixed(1)+" m";$("soloCamera").textContent=cameraMode.toUpperCase();$("soloArm").textContent=localArm?(stateText==="ARMED"?"ARMED ✓":"ARMING…"):"ARM";}renderer.render(scene,camera);
'''
new='''const wall=(now-wallStart)/1000;ui.speed.textContent=(wall>0?(simTime-simStart)/wall:0).toFixed(2)+"×";if(soloMode){const soloArm=$("soloArm");$("soloState").textContent=stateText;$("soloAlt").textContent=Math.max(0,state.z).toFixed(1)+" m";$("soloCamera").textContent=cameraMode.toUpperCase();soloArm.classList.toggle("arming",soloControls.arm&&stateText!=="ARMED");soloArm.disabled=!soloControls.arm&&!sharedArmReady(stateText,soloControls,true);soloArm.textContent=soloControls.arm?(stateText==="ARMED"?"ARMED ✓":"ARMING…"):(stateText==="CALIBRATING"?"CALIBRATING…":"ARM");}renderer.render(scene,camera);
'''
assert old in s;s=s.replace(old,new,1)
p.write_text(s)

# Unit test the exact shared semantics.
Path('tests/control_semantics_test.mjs').write_text('''import assert from "node:assert/strict";\nimport {neutralControls,armReady,applyStick,releaseStick,knobAxes} from "../sim/control_semantics.mjs";\nlet c=neutralControls();\nassert.equal(armReady("DISARMED",c,true),true);\nassert.equal(armReady("CALIBRATING",c,true),false);\napplyStick(c,"left",{x:.4,y:.5});assert.equal(c.yaw,.4);assert.equal(c.throttle,.25);assert.equal(armReady("DISARMED",c,true),false);\nreleaseStick(c,"left");assert.equal(c.yaw,0);assert.equal(c.throttle,.25,"left-stick release must retain throttle exactly like paired controller");\nc.throttle=0;applyStick(c,"right",{x:-.3,y:.2});assert.equal(c.roll,-.3);assert.equal(c.pitch,-.2);releaseStick(c,"right");assert.equal(c.roll,0);assert.equal(c.pitch,0);\nconst l=knobAxes(c,"left");assert.equal(l.x,0);assert.equal(l.y,1,"zero throttle knob must be at bottom");\nassert.equal(armReady("DISARMED",c,true),true);assert.equal(armReady("DISARMED",c,false),false);\nconsole.log("Shared controller semantics passed for paired and single-phone modes.");\n''')

# Strengthen browser E2E: enter solo, ensure it is real local input path, arm after calibration, kill safely.
t=Path('tests/browser_sim_smoke.mjs');ts=t.read_text()
old='''  const soloUi = await page.evaluate(() => ({soloButton:!!document.querySelector("#camSolo"),soloHud:!!document.querySelector("#soloHud"),left:!!document.querySelector("#soloLeft"),right:!!document.querySelector("#soloRight"),arm:!!document.querySelector("#soloArm"),kill:!!document.querySelector("#soloKill")}));
  if (!Object.values(soloUi).every(Boolean)) throw new Error(`single-phone HUD incomplete: ${JSON.stringify(soloUi)}`);

  // This smoke test validates the standalone local fallback path. The separate
'''
new='''  const soloUi = await page.evaluate(() => ({soloButton:!!document.querySelector("#camSolo"),soloHud:!!document.querySelector("#soloHud"),left:!!document.querySelector("#soloLeft"),right:!!document.querySelector("#soloRight"),arm:!!document.querySelector("#soloArm"),kill:!!document.querySelector("#soloKill")}));
  if (!Object.values(soloUi).every(Boolean)) throw new Error(`single-phone HUD incomplete: ${JSON.stringify(soloUi)}`);
  await page.setViewport({width:844,height:390,deviceScaleFactor:1});
  await page.click("#camSolo");
  await page.waitForFunction(()=>document.body.classList.contains("solo-flight"),{timeout:5000});
  const soloStart=await page.evaluate(()=>({input:document.querySelector("#inputSource")?.value,hidden:document.querySelector("#soloHud")?.hidden,leftTop:parseFloat(document.querySelector("#soloLeft .solo-knob")?.style.top||"0")}));
  if(soloStart.input!=="local"||soloStart.hidden||soloStart.leftTop<90)throw new Error(`single-phone control did not enter paired-equivalent neutral state: ${JSON.stringify(soloStart)}`);
  await waitForSimTime(2.2,60000);
  let soloState=await page.$eval("#fcState",e=>e.textContent||"");
  if(soloState!=="DISARMED")throw new Error(`single-phone calibration failed: ${JSON.stringify(await snapshot())}`);
  const soloArmDisabled=await page.$eval("#soloArm",e=>e.disabled);if(soloArmDisabled)throw new Error("single-phone ARM stayed blocked after calibration at neutral controls");
  const soloArmStart=await simTime();await page.click("#soloArm");await waitForSimTime(soloArmStart+1.1,45000);soloState=await page.$eval("#fcState",e=>e.textContent||"");if(soloState!=="ARMED")throw new Error(`single-phone ARM did not use production arming path: ${JSON.stringify(await snapshot())}`);
  await page.click("#soloKill");const killStart=await simTime();await waitForSimTime(killStart+.05,10000);soloState=await page.$eval("#fcState",e=>e.textContent||"");if(soloState!=="DISARMED")throw new Error(`single-phone KILL did not disarm: ${JSON.stringify(await snapshot())}`);
  await page.evaluate(()=>document.querySelector("#soloExit")?.click());

  // This smoke test validates the standalone local fallback path. The separate
'''
assert old in ts;ts=ts.replace(old,new,1)
t.write_text(ts)

# Deploy validates and executes the common semantics test.
p=Path('.github/workflows/deploy.yml');w=p.read_text()
w=w.replace('''          node --check sim/qr_pairing.mjs
          node --check tests/sil_wasm_smoke.mjs
''','''          node --check sim/qr_pairing.mjs
          node --check sim/control_semantics.mjs
          node --check tests/control_semantics_test.mjs
          node tests/control_semantics_test.mjs
          node --check tests/sil_wasm_smoke.mjs
''',1)
w=w.replace("          grep -q 'new ViewPeerLink()' sim/simulator.mjs\n", "          grep -q 'new ViewPeerLink()' sim/simulator.mjs\n          grep -q 'control_semantics.mjs' sim/simulator.mjs sim/controller.mjs\n",1)
p.write_text(w)
