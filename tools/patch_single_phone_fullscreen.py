from pathlib import Path

p=Path('sim/simulator.mjs')
s=p.read_text()

# Extend camera HUD with single-phone fullscreen button.
old='cameraHud.innerHTML=\'<button id="camFollow" type="button">FOLLOW</button><button id="camFpv" type="button">FPV</button>\';'
new='cameraHud.innerHTML=\'<button id="camFollow" type="button">FOLLOW</button><button id="camFpv" type="button">FPV</button><button id="camSolo" type="button">1 PHONE</button>\';'
assert old in s
s=s.replace(old,new,1)

# Insert fullscreen controls immediately after camera mode initialization.
anchor='$("camFollow").onclick=()=>setCameraMode("follow");$("camFpv").onclick=()=>setCameraMode("fpv");setCameraMode(cameraMode);\n'
insert=r'''$("camFollow").onclick=()=>setCameraMode("follow");$("camFpv").onclick=()=>setCameraMode("fpv");setCameraMode(cameraMode);

const soloHud=document.createElement("div");soloHud.id="soloHud";soloHud.hidden=true;
soloHud.innerHTML=`
  <div id="soloTopbar"><button id="soloExit" type="button">EXIT</button><span id="soloState">DISARMED</span><span id="soloAlt">0.0 m</span><button id="soloCamera" type="button">FOLLOW</button></div>
  <div id="soloRotate">ROTATE PHONE TO LANDSCAPE</div>
  <div id="soloLeft" class="solo-stick"><div class="solo-ring"></div><div class="solo-knob"></div><span>THR / YAW</span></div>
  <div id="soloRight" class="solo-stick"><div class="solo-ring"></div><div class="solo-knob"></div><span>PITCH / ROLL</span></div>
  <button id="soloArm" class="solo-action" type="button">ARM</button>
  <button id="soloKill" class="solo-action" type="button">KILL</button>`;
$("viewport").appendChild(soloHud);
const soloStyle=document.createElement("style");soloStyle.textContent=`
  body.solo-flight{overflow:hidden!important;background:#000!important}
  body.solo-flight .panel,body.solo-flight .telemetry{display:none!important}
  body.solo-flight #viewport{position:fixed!important;inset:0!important;width:100vw!important;height:100dvh!important;min-height:0!important;max-height:none!important;margin:0!important;z-index:50!important}
  body.solo-flight #cameraModes{top:max(8px,env(safe-area-inset-top))!important;left:50%!important}
  #soloHud{position:absolute;inset:0;z-index:8;pointer-events:none;font-family:system-ui,-apple-system,sans-serif;color:#fff;touch-action:none;user-select:none;-webkit-user-select:none}
  #soloHud[hidden]{display:none!important}
  #soloTopbar{position:absolute;top:max(8px,env(safe-area-inset-top));left:max(8px,env(safe-area-inset-left));right:max(8px,env(safe-area-inset-right));display:flex;gap:8px;align-items:center;justify-content:flex-start;pointer-events:auto}
  #soloTopbar span,#soloTopbar button{border:1px solid #ffffff55;background:#112033cc;color:#fff;border-radius:9px;padding:7px 10px;font-weight:800;font-size:12px;backdrop-filter:blur(8px)}
  #soloTopbar #soloExit{background:#6b2330dd} #soloTopbar #soloCamera{margin-left:auto;background:#174f70dd}
  .solo-stick{position:absolute;width:min(34vw,230px);aspect-ratio:1;bottom:max(18px,env(safe-area-inset-bottom));pointer-events:auto;touch-action:none;border-radius:50%}
  #soloLeft{left:max(16px,env(safe-area-inset-left))} #soloRight{right:max(16px,env(safe-area-inset-right))}
  .solo-ring{position:absolute;inset:0;border-radius:50%;border:2px solid #ffffff66;background:#0b18265c;box-shadow:inset 0 0 45px #0005,0 6px 22px #0005}
  .solo-knob{position:absolute;left:50%;top:50%;width:31%;aspect-ratio:1;transform:translate(-50%,-50%);border-radius:50%;background:#f3f7ffcc;border:2px solid #fff;box-shadow:0 3px 14px #0008}
  .solo-stick span{position:absolute;left:50%;bottom:-18px;transform:translateX(-50%);font-size:10px;font-weight:800;letter-spacing:.08em;text-shadow:0 2px 5px #000;white-space:nowrap}
  .solo-action{position:absolute;bottom:max(34px,calc(env(safe-area-inset-bottom) + 18px));pointer-events:auto;border-radius:999px!important;width:86px;height:52px;font-weight:900!important;color:#fff!important;border:2px solid #ffffff55!important;backdrop-filter:blur(8px)}
  #soloArm{left:50%;transform:translateX(-105%);background:#17694fdd!important} #soloKill{left:50%;transform:translateX(5%);background:#8b2436e6!important}
  #soloRotate{display:none;position:absolute;inset:0;align-items:center;justify-content:center;background:#07101aee;font-size:18px;font-weight:900;letter-spacing:.08em;text-align:center;padding:30px;pointer-events:none}
  @media(orientation:portrait){body.solo-flight #soloRotate{display:flex}.solo-stick,.solo-action{opacity:.18}}
  @media(max-height:430px){.solo-stick{width:min(30vw,180px)}.solo-action{width:76px;height:46px}}
`;
document.head.appendChild(soloStyle);

let soloMode=false;
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
async function enterSolo(){
  soloMode=true;document.body.classList.add("solo-flight");soloHud.hidden=false;inputSource="local";ui.inputSource.value="local";localArm=false;arm=false;localThrottle=0;ui.touchThrottle.value="0";ui.touchRoll.value=ui.touchPitch.value=ui.touchYaw.value="0";updateRemoteUI();resize();
  try{if(!document.fullscreenElement&&document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen({navigationUI:"hide"});}catch{}
  try{await screen.orientation?.lock?.("landscape");}catch{}
  if(mode==="sim"&&backend&&!running)startRun();
}
async function exitSolo(){
  localArm=false;arm=false;localThrottle=0;ui.touchThrottle.value="0";ui.touchRoll.value=ui.touchPitch.value=ui.touchYaw.value="0";soloMode=false;soloHud.hidden=true;document.body.classList.remove("solo-flight");try{screen.orientation?.unlock?.();}catch{}try{if(document.fullscreenElement)await document.exitFullscreen();}catch{}resize();
}
$("camSolo").onclick=enterSolo;$("soloExit").onclick=exitSolo;
$("soloArm").onclick=()=>{localArm=!localArm;$("soloArm").textContent=localArm?"ARM ON":"ARM";ui.touchArm.textContent=`ARM request: ${localArm?"ON":"OFF"}`;};
$("soloKill").onclick=()=>{localArm=false;arm=false;localThrottle=0;ui.touchThrottle.value="0";$("soloArm").textContent="ARM";};
$("soloCamera").onclick=()=>{setCameraMode(cameraMode==="follow"?"fpv":"follow");$("soloCamera").textContent=cameraMode.toUpperCase();};
document.addEventListener("fullscreenchange",()=>{if(soloMode&&!document.fullscreenElement&&document.fullscreenEnabled)exitSolo();});
'''
assert anchor in s
s=s.replace(anchor,insert,1)

# Add solo HUD telemetry refresh inside render before renderer.render.
old='const wall=(now-wallStart)/1000;ui.speed.textContent=(wall>0?(simTime-simStart)/wall:0).toFixed(2)+"×";renderer.render(scene,camera);'
new='const wall=(now-wallStart)/1000;ui.speed.textContent=(wall>0?(simTime-simStart)/wall:0).toFixed(2)+"×";if(soloMode){$("soloState").textContent=stateText;$("soloAlt").textContent=Math.max(0,state.z).toFixed(1)+" m";$("soloCamera").textContent=cameraMode.toUpperCase();$("soloArm").textContent=localArm?(stateText==="ARMED"?"ARMED ✓":"ARMING…"):"ARM";}renderer.render(scene,camera);'
assert old in s
s=s.replace(old,new,1)

p.write_text(s)

# Extend browser smoke: existence and landscape-fullscreen control semantics.
t=Path('tests/browser_sim_smoke.mjs')
ts=t.read_text()
anchor='''  await page.click("#camFollow");
  const followMode = await page.$eval("#viewport", element => element.dataset.cameraMode || "");
  if (followMode !== "follow") throw new Error(`FOLLOW camera switch failed: ${followMode}`);
'''
insert='''  await page.click("#camFollow");
  const followMode = await page.$eval("#viewport", element => element.dataset.cameraMode || "");
  if (followMode !== "follow") throw new Error(`FOLLOW camera switch failed: ${followMode}`);
  const soloUi = await page.evaluate(() => ({soloButton:!!document.querySelector("#camSolo"),soloHud:!!document.querySelector("#soloHud"),left:!!document.querySelector("#soloLeft"),right:!!document.querySelector("#soloRight"),arm:!!document.querySelector("#soloArm"),kill:!!document.querySelector("#soloKill")}));
  if (!Object.values(soloUi).every(Boolean)) throw new Error(`single-phone HUD incomplete: ${JSON.stringify(soloUi)}`);
'''
assert anchor in ts
ts=ts.replace(anchor,insert,1)
t.write_text(ts)
