from pathlib import Path

p=Path('sim/simulator.mjs')
s=p.read_text()
s=s.replace('  .solo-knob{position:absolute;left:50%;top:50%;width:31%;', '  .solo-knob{position:absolute;left:50%;top:50%;width:31%;',1)
needle='  .solo-stick span{position:absolute;left:50%;bottom:-18px;'
assert needle in s
s=s.replace(needle,'  #soloLeft .solo-knob{top:88%}\n'+needle,1)

s=s.replace('let soloMode=false;','let soloMode=false,soloPreviousInputSource="remote";',1)
old='soloMode=true;document.body.classList.add("solo-flight");soloHud.hidden=false;inputSource="local";ui.inputSource.value="local";localArm=false;arm=false;localThrottle=0;ui.touchThrottle.value="0";ui.touchRoll.value=ui.touchPitch.value=ui.touchYaw.value="0";updateRemoteUI();resize();'
new='soloMode=true;soloPreviousInputSource=inputSource;document.body.classList.add("solo-flight");soloHud.hidden=false;inputSource="local";ui.inputSource.value="local";localArm=false;arm=false;localThrottle=0;ui.touchThrottle.value="0";ui.touchRoll.value=ui.touchPitch.value=ui.touchYaw.value="0";$("soloLeft").querySelector(".solo-knob").style.cssText="left:50%;top:88%";$("soloRight").querySelector(".solo-knob").style.cssText="left:50%;top:50%";updateRemoteUI();resize();'
assert old in s
s=s.replace(old,new,1)

old='localArm=false;arm=false;localThrottle=0;ui.touchThrottle.value="0";ui.touchRoll.value=ui.touchPitch.value=ui.touchYaw.value="0";soloMode=false;soloHud.hidden=true;document.body.classList.remove("solo-flight");try{screen.orientation?.unlock?.();}catch{}try{if(document.fullscreenElement)await document.exitFullscreen();}catch{}resize();'
new='localArm=false;arm=false;localThrottle=0;ui.touchThrottle.value="0";ui.touchRoll.value=ui.touchPitch.value=ui.touchYaw.value="0";inputSource=soloPreviousInputSource;ui.inputSource.value=inputSource;soloMode=false;soloHud.hidden=true;document.body.classList.remove("solo-flight");try{screen.orientation?.unlock?.();}catch{}try{if(document.fullscreenElement)await document.exitFullscreen();}catch{}updateRemoteUI();resize();'
assert old in s
s=s.replace(old,new,1)

old='$("soloKill").onclick=()=>{localArm=false;arm=false;localThrottle=0;ui.touchThrottle.value="0";$("soloArm").textContent="ARM";};'
new='$("soloKill").onclick=()=>{localArm=false;arm=false;localThrottle=0;ui.touchThrottle.value="0";ui.touchYaw.value="0";$("soloLeft").querySelector(".solo-knob").style.cssText="left:50%;top:88%";$("soloArm").textContent="ARM";};'
assert old in s
s=s.replace(old,new,1)
p.write_text(s)

h=Path('drone_simulator.html')
html=h.read_text()
needle='<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
addition=needle+'<meta name="apple-mobile-web-app-capable" content="yes">\n<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">\n<meta name="mobile-web-app-capable" content="yes">\n'
assert needle in html and 'apple-mobile-web-app-capable' not in html
html=html.replace(needle,addition,1)
h.write_text(html)
