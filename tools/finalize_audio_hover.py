from pathlib import Path

def replace_once(path, old, new):
    p=Path(path); s=p.read_text(); n=s.count(old)
    assert n==1, f'{path}: expected 1 match, got {n}: {old[:120]!r}'
    p.write_text(s.replace(old,new,1))

# Shared phone settings: persistent DEFAULT hover target, separate from live Q/E/slider target.
replace_once('sim/control_semantics.mjs',
'''  invertRightHorizontal:false,\n  invertRightVertical:false,\n});''',
'''  invertRightHorizontal:false,\n  invertRightVertical:false,\n  defaultHoverAgl:2,\n});''')
replace_once('sim/control_semantics.mjs',
'''    invertRightHorizontal:Boolean(settings.invertRightHorizontal),\n    invertRightVertical:Boolean(settings.invertRightVertical),\n  };''',
'''    invertRightHorizontal:Boolean(settings.invertRightHorizontal),\n    invertRightVertical:Boolean(settings.invertRightVertical),\n    defaultHoverAgl:Math.round(clampControl(Number(settings.defaultHoverAgl??DEFAULT_PHONE_SETTINGS.defaultHoverAgl),.5,5)*10)/10,\n  };''')

# SETTINGS UI.
replace_once('sim/control_settings.mjs',
'''    <div class="phone-settings-row">\n      <label>RIGHT STICK FINENESS</label><output data-out="right"></output>\n      <input data-slider="right" type="range" min="1" max="10" step="1">\n      <div class="phone-settings-scale"><span>DIRECT</span><span>MAX FINE</span></div>\n    </div>\n    <label class="phone-settings-toggle">''',
'''    <div class="phone-settings-row">\n      <label>RIGHT STICK FINENESS</label><output data-out="right"></output>\n      <input data-slider="right" type="range" min="1" max="10" step="1">\n      <div class="phone-settings-scale"><span>DIRECT</span><span>MAX FINE</span></div>\n    </div>\n    <div class="phone-settings-row">\n      <label>DEFAULT HOVER ABOVE GROUND</label><output data-out="hover"></output>\n      <input data-slider="hover" type="range" min="0.5" max="5" step="0.1">\n      <div class="phone-settings-scale"><span>0.5 m</span><span>5.0 m</span></div>\n    </div>\n    <label class="phone-settings-toggle">''')
replace_once('sim/control_settings.mjs',
'''  const left=dialog.querySelector('[data-slider="left"]'),right=dialog.querySelector('[data-slider="right"]');\n  const leftOut=dialog.querySelector('[data-out="left"]'),rightOut=dialog.querySelector('[data-out="right"]');''',
'''  const left=dialog.querySelector('[data-slider="left"]'),right=dialog.querySelector('[data-slider="right"]'),hover=dialog.querySelector('[data-slider="hover"]');\n  const leftOut=dialog.querySelector('[data-out="left"]'),rightOut=dialog.querySelector('[data-out="right"]'),hoverOut=dialog.querySelector('[data-out="hover"]');''')
replace_once('sim/control_settings.mjs',
'''    left.value=String(settings.leftFineness);right.value=String(settings.rightFineness);\n    leftOut.value=`${left.value}/10`;rightOut.value=`${right.value}/10`;invertLeft.checked=settings.invertLeftHorizontal;invertRight.checked=settings.invertRightHorizontal;invertRightVertical.checked=settings.invertRightVertical;lockLeft.checked=settings.lockLeftHorizontal;lock.checked=settings.lockRightHorizontal;''',
'''    left.value=String(settings.leftFineness);right.value=String(settings.rightFineness);hover.value=String(settings.defaultHoverAgl);\n    leftOut.value=`${left.value}/10`;rightOut.value=`${right.value}/10`;hoverOut.value=`${Number(hover.value).toFixed(1)} m`;invertLeft.checked=settings.invertLeftHorizontal;invertRight.checked=settings.invertRightHorizontal;invertRightVertical.checked=settings.invertRightVertical;lockLeft.checked=settings.lockLeftHorizontal;lock.checked=settings.lockRightHorizontal;''')
replace_once('sim/control_settings.mjs',
'''      rightFineness:Number(right.value),\n      invertLeftHorizontal:invertLeft.checked,''',
'''      rightFineness:Number(right.value),\n      defaultHoverAgl:Number(hover.value),\n      invertLeftHorizontal:invertLeft.checked,''')
replace_once('sim/control_settings.mjs',
'''  left.addEventListener("input",apply);right.addEventListener("input",apply);invertLeft.addEventListener("change",apply);''',
'''  left.addEventListener("input",apply);right.addEventListener("input",apply);hover.addEventListener("input",apply);invertLeft.addEventListener("change",apply);''')

# 2-PHONE: live height no longer overwrites the persistent default.
replace_once('sim/controller.mjs',
'''let groundClearance=clamp(Number(localStorage.getItem("arondight45GroundClearance"))||2,.5,5);''',
'''let groundClearance=phoneSettings.defaultHoverAgl;''')
replace_once('sim/controller.mjs',
'''  localStorage.setItem("arondight45GroundClearance",String(groundClearance));\n  controls.groundClearance=groundClearance;''',
'''  controls.groundClearance=groundClearance;''')
replace_once('sim/controller.mjs',
'''    phoneSettings=next;\n    const keepArm=gameMode&&controls.arm;\n    controls=neutralForMode();controls.arm=keepArm;''',
'''    phoneSettings=next;\n    const keepArm=gameMode&&controls.arm;\n    if(!keepArm)groundClearance=next.defaultHoverAgl;\n    controls=neutralForMode();controls.arm=keepArm;''')
replace_once('sim/controller.mjs',
'''addEventListener("pageshow",()=>{phoneSettings=loadPhoneControlSettings();safetyNeutral(false);publish();updateConnection();});\ndocument.addEventListener("visibilitychange",()=>{if(document.hidden)safetyNeutral(true);else{phoneSettings=loadPhoneControlSettings();publish();updateConnection();}});''',
'''addEventListener("pageshow",()=>{phoneSettings=loadPhoneControlSettings();if(!controls.arm)groundClearance=phoneSettings.defaultHoverAgl;safetyNeutral(false);publish();updateConnection();});\ndocument.addEventListener("visibilitychange",()=>{if(document.hidden)safetyNeutral(true);else{phoneSettings=loadPhoneControlSettings();if(!controls.arm)groundClearance=phoneSettings.defaultHoverAgl;publish();updateConnection();}});''')

# 1-PHONE: same default semantics; Reset and entering solo use the persistent default.
replace_once('sim/simulator.mjs',
'''let soloMode=false,soloPreviousInputSource="remote",phoneSettings=loadPhoneControlSettings();\nlet soloGroundClearance=clamp(Number(localStorage.getItem("arondight45GroundClearance"))||2,.5,5);''',
'''let soloMode=false,soloPreviousInputSource="remote",phoneSettings=loadPhoneControlSettings();\nlet soloGroundClearance=phoneSettings.defaultHoverAgl;''')
replace_once('sim/simulator.mjs',
'''soloClearanceSlider.oninput=()=>{soloGroundClearance=clamp(Number(soloClearanceSlider.value),.5,5);localStorage.setItem("arondight45GroundClearance",String(soloGroundClearance));soloControls.groundClearance=soloGroundClearance;updateSoloSticks();};''',
'''soloClearanceSlider.oninput=()=>{soloGroundClearance=clamp(Number(soloClearanceSlider.value),.5,5);soloControls.groundClearance=soloGroundClearance;updateSoloSticks();};''')
replace_once('sim/simulator.mjs',
'''  onChange:next=>{phoneSettings=next;const keepArm=soloControls.arm;soloControls=neutralSoloControls();soloControls.arm=keepArm;updateSoloSticks();arm=keepArm;throttle=0;},''',
'''  onChange:next=>{phoneSettings=next;const keepArm=soloControls.arm;if(!keepArm){soloGroundClearance=next.defaultHoverAgl;soloClearanceSlider.value=String(soloGroundClearance);}soloControls=neutralSoloControls();soloControls.arm=keepArm;updateSoloSticks();arm=keepArm;throttle=0;},''')
replace_once('sim/simulator.mjs',
'''  soloMode=true;soloPreviousInputSource=inputSource;phoneSettings=loadPhoneControlSettings();soloGroundClearance=clamp(Number(localStorage.getItem("arondight45GroundClearance"))||soloGroundClearance,.5,5);soloClearanceSlider.value=String(soloGroundClearance);''',
'''  soloMode=true;soloPreviousInputSource=inputSource;phoneSettings=loadPhoneControlSettings();soloGroundClearance=phoneSettings.defaultHoverAgl;soloClearanceSlider.value=String(soloGroundClearance);''')
replace_once('sim/simulator.mjs',
'''function resetSimulation(initial=null){\n  physics.reset(defaultParams(),initial);''',
'''function resetSimulation(initial=null){\n  phoneSettings=loadPhoneControlSettings();soloGroundClearance=phoneSettings.defaultHoverAgl;soloClearanceSlider.value=String(soloGroundClearance);\n  physics.reset(defaultParams(),initial);''')

# Realistic procedural rotor acoustics: no audible steady synth oscillator as the motor bed.
p=Path('sim/simulator.mjs'); s=p.read_text(); cls=s.index('class MotorSound {')
s=s.replace('this.viewport.dataset.motorAudioSource="motorOmega+motorTorque+propTorque:2bladeBPF"','this.viewport.dataset.motorAudioSource="motorOmega+motorTorque+propTorque+tipSpeed:bladeImpulseNoise"',1)
start=s.index('  ensure(){',cls); end=s.index('  async unlock(){',start)
new_ensure='''  ensure(){\n    if(this.ctx){this.syncState();return true;}const AudioCtx=window.AudioContext||window.webkitAudioContext;if(!AudioCtx)return false;\n    try{this.ctx=new AudioCtx({latencyHint:"interactive"});}catch{this.ctx=new AudioCtx();}\n    this.master=this.ctx.createGain();this.master.gain.value=0;this.compressor=this.ctx.createDynamicsCompressor();this.compressor.threshold.value=-16;this.compressor.knee.value=20;this.compressor.ratio.value=3;this.compressor.attack.value=.003;this.compressor.release.value=.14;this.master.connect(this.compressor);this.compressor.connect(this.ctx.destination);\n    const noiseBuffer=this.ctx.createBuffer(1,this.ctx.sampleRate*3,this.ctx.sampleRate),data=noiseBuffer.getChannelData(0);let seed=0x45a31f27;for(let i=0;i<data.length;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;data[i]=((seed>>>0)/2147483648)-1;}\n    for(let i=0;i<4;i++){const noise=this.ctx.createBufferSource(),band=this.ctx.createBiquadFilter(),pulseGain=this.ctx.createGain(),pulseLfo=this.ctx.createOscillator(),pulseDepth=this.ctx.createGain();noise.buffer=noiseBuffer;noise.loop=true;band.type="bandpass";band.Q.value=.72;pulseGain.gain.value=0;pulseLfo.type="sine";pulseDepth.gain.value=0;noise.connect(band);band.connect(pulseGain);pulseGain.connect(this.master);pulseLfo.connect(pulseDepth);pulseDepth.connect(pulseGain.gain);noise.start(0,i*.413);pulseLfo.start();this.voices.push({noise,band,pulseGain,pulseLfo,pulseDepth});}\n    this.washNoise=this.ctx.createBufferSource();this.washNoise.buffer=noiseBuffer;this.washNoise.loop=true;this.washBand=this.ctx.createBiquadFilter();this.washBand.type="bandpass";this.washBand.Q.value=.48;this.washGain=this.ctx.createGain();this.washGain.gain.value=0;this.washNoise.connect(this.washBand);this.washBand.connect(this.washGain);this.washGain.connect(this.master);this.washNoise.start(0,1.37);\n    this.ctx.addEventListener?.("statechange",()=>this.syncState());this.syncState();return true;\n  }\n'''
s=s[:start]+new_ensure+s[end:]
start=s.index('  update(model,cameraPosition){',cls); end=s.index('\n}\n\nTHREE.Object3D.DEFAULT_UP',start)
new_update='''  update(model,cameraPosition){\n    const running=this.syncState(),omega=model.motorOmega||[],motorTorque=model.motorTorque||[],propTorque=model.propTorque||[],diameter=Math.max(.02,Number(model.p?.propD)||.127);let weightedHz=0,totalPropPower=0,totalTipSpeed=0;\n    for(let i=0;i<4;i++){const w=Math.max(0,Number(omega[i])||0),rotorHz=w/(2*Math.PI),bladePassHz=rotorHz*2,shaftPower=Math.max(0,(Number(propTorque[i])||0)*w),electromagneticPower=Math.max(0,(Number(motorTorque[i])||0)*w),tipSpeed=w*diameter*.5;weightedHz+=bladePassHz*shaftPower;totalPropPower+=shaftPower;totalTipSpeed+=tipSpeed;const voice=this.voices[i];if(!voice||!this.ctx)continue;const now=this.ctx.currentTime,drive=rotorHz>2?Math.tanh((shaftPower+electromagneticPower*.12)/34):0,centre=Math.max(180,Math.min(6200,bladePassHz*1.32+tipSpeed*3.0));voice.band.frequency.setTargetAtTime(centre,now,.025);voice.pulseLfo.frequency.setTargetAtTime(Math.max(12,bladePassHz),now,.018);voice.pulseGain.gain.setTargetAtTime(.014*drive,now,.030);voice.pulseDepth.gain.setTargetAtTime(.0105*drive,now,.030);}\n    const meanHz=totalPropPower>1e-9?weightedHz/totalPropPower:omega.reduce((sum,w)=>sum+Math.max(0,Number(w)||0)/Math.PI,0)/4,meanTipSpeed=totalTipSpeed/4;\n    if(this.washBand&&this.washGain&&this.ctx){const now=this.ctx.currentTime,washDrive=Math.tanh(totalPropPower/95)*(.25+.75*Math.tanh(meanTipSpeed/105));this.washBand.frequency.setTargetAtTime(Math.max(220,Math.min(7000,meanHz*2.15+meanTipSpeed*4)),now,.055);this.washGain.gain.setTargetAtTime(.033*washDrive,now,.060);}\n    this.viewport.dataset.motorAudioHz=String(meanHz);this.viewport.dataset.motorAudioPowerW=String(totalPropPower);\n    if(this.master&&this.ctx){const p=model.position(),distance=cameraPosition?Math.hypot(cameraPosition.x-p[0],cameraPosition.y-p[1],cameraPosition.z-p[2]):1,distanceGain=1/(1+.12*distance*distance),target=(this.enabled&&running)?.60*distanceGain:0;this.viewport.dataset.motorAudioGain=String(target);this.master.gain.setTargetAtTime(target,this.ctx.currentTime,.050);}\n  }\n'''
s=s[:start]+new_update+s[end:]
p.write_text(s)

# Permanent tests / architecture contracts.
replace_once('tests/control_semantics_test.mjs',
'''assert.equal(DEFAULT_PHONE_SETTINGS.invertRightVertical,false);''',
'''assert.equal(DEFAULT_PHONE_SETTINGS.invertRightVertical,false);\nassert.equal(DEFAULT_PHONE_SETTINGS.defaultHoverAgl,2);''')
replace_once('tests/browser_sim_smoke.mjs',
'''  await page.$eval('.phone-settings-dialog [data-camera-slider="tilt"]',e=>{e.value="18";e.dispatchEvent(new Event("input",{bubbles:true}));});''',
'''  await page.$eval('.phone-settings-dialog [data-slider="hover"]',e=>{e.value="2.2";e.dispatchEvent(new Event("input",{bubbles:true}));});\n  stored=await page.evaluate(()=>JSON.parse(localStorage.getItem("arondight45PhoneControlSettingsV4")||"{}"));\n  if(Math.abs(stored.defaultHoverAgl-2.2)>.001)throw new Error(`default hover AGL did not persist: ${JSON.stringify(stored)}`);\n  await page.$eval('.phone-settings-dialog [data-camera-slider="tilt"]',e=>{e.value="18";e.dispatchEvent(new Event("input",{bubbles:true}));});''')
replace_once('tests/browser_sim_smoke.mjs',
'''  await page.click('.phone-settings-dialog [data-close]');\n\n  await waitForSimTime(2.2,60000);''',
'''  await page.click('.phone-settings-dialog [data-close]');\n  await page.click("#soloReset");\n  await page.waitForFunction(()=>document.querySelector("#soloClearanceValue")?.textContent?.includes("2.2 m"),{timeout:5000});\n\n  await waitForSimTime(2.2,60000);''')
replace_once('tests/browser_sim_smoke.mjs',
'''audioDrive.source!=="motorOmega+motorTorque+propTorque:2bladeBPF"''',
'''audioDrive.source!=="motorOmega+motorTorque+propTorque+tipSpeed:bladeImpulseNoise"''')
replace_once('tests/architecture_invariants.mjs',
'''requireText("sim/simulator.mjs",'this.viewport.dataset.motorAudioSource="motorOmega+motorTorque+propTorque:2bladeBPF"');''',
'''requireText("sim/simulator.mjs",'this.viewport.dataset.motorAudioSource="motorOmega+motorTorque+propTorque+tipSpeed:bladeImpulseNoise"');\nfor(const marker of ["pulseLfo.connect(pulseDepth)","pulseDepth.connect(pulseGain.gain)","washNoise","tipSpeed"])requireText("sim/simulator.mjs",marker);''')
replace_once('tests/architecture_invariants.mjs',
'''requireText("sim/control_settings.mjs","INVERT LEFT STICK HORIZONTAL (L/R)");''',
'''requireText("sim/control_settings.mjs","DEFAULT HOVER ABOVE GROUND");\nrequireText("sim/control_semantics.mjs","defaultHoverAgl:2");\nrequireText("sim/controller.mjs","let groundClearance=phoneSettings.defaultHoverAgl");\nrequireText("sim/simulator.mjs","let soloGroundClearance=phoneSettings.defaultHoverAgl");\nrequireText("sim/control_settings.mjs","INVERT LEFT STICK HORIZONTAL (L/R)");''')
