from pathlib import Path

p=Path('sim/simulator.mjs')
s=p.read_text()

def once(old,new,label):
    global s
    if old not in s:
        raise SystemExit(f'missing patch anchor: {label}')
    s=s.replace(old,new,1)

once('import {neutralControls,copyControls,armReady as sharedArmReady,normalizedPointer,applyStick,releaseStick,knobAxes,knobPercent} from "./control_semantics.mjs";\n',
     'import {neutralControls,copyControls,armReady as sharedArmReady,normalizedPointer,applyStick,releaseStick,knobAxes,knobPercent} from "./control_semantics.mjs";\nimport {RaceTrack} from "./race_track.mjs";\n', 'race import')

once('const grid=new THREE.GridHelper(20,40,0x6b7d89,0xa7b6bd);grid.rotation.x=Math.PI/2;grid.position.z=.002;scene.add(grid);const groundMesh=new THREE.Mesh(new THREE.BoxGeometry(20,20,.1),new THREE.MeshStandardMaterial({color:0xa9b99a,roughness:.96,metalness:0}));groundMesh.position.z=-.05;groundMesh.receiveShadow=true;scene.add(groundMesh);\n',
     'const grid=new THREE.GridHelper(20,40,0x6b7d89,0xa7b6bd);grid.rotation.x=Math.PI/2;grid.position.z=.002;scene.add(grid);const groundMesh=new THREE.Mesh(new THREE.BoxGeometry(20,20,.1),new THREE.MeshStandardMaterial({color:0xa9b99a,roughness:.96,metalness:0}));groundMesh.position.z=-.05;groundMesh.receiveShadow=true;scene.add(groundMesh);\nconst raceTrack=new RaceTrack(scene,{laps:3});\n', 'race instance')

once('  <div id="soloTopbar"><button id="soloExit" type="button">EXIT</button><span id="soloState">DISARMED</span><span id="soloAlt">0.0 m</span><button id="soloCamera" type="button">FOLLOW</button></div>\n  <div id="soloRotate">ROTATE PHONE TO LANDSCAPE</div>',
     '  <div id="soloTopbar"><button id="soloExit" type="button">EXIT</button><button id="soloReset" type="button">RESET SIM</button><span id="soloState">DISARMED</span><span id="soloAlt">0.0 m</span><button id="soloCamera" type="button">FOLLOW</button></div>\n  <div id="soloRaceHud"><span id="soloLap">READY · 3 LAPS</span><strong id="soloRaceTime">00:00.000</strong><span id="soloGate">NEXT · START / FINISH</span><span id="soloBest">BEST —</span></div>\n  <div id="soloRotate">ROTATE PHONE TO LANDSCAPE</div>', 'solo race hud')

once('  #soloTopbar #soloExit{background:#6b2330dd} #soloTopbar #soloCamera{margin-left:auto;background:#174f70dd}\n',
     '  #soloTopbar #soloExit{background:#6b2330dd} #soloTopbar #soloReset{background:#9a5b18dd} #soloTopbar #soloCamera{margin-left:auto;background:#174f70dd}\n  #soloRaceHud{position:absolute;top:max(52px,calc(env(safe-area-inset-top) + 44px));left:50%;transform:translateX(-50%);display:grid;grid-template-columns:auto auto;gap:3px 12px;align-items:center;min-width:290px;padding:7px 12px;border:1px solid #ffffff55;border-radius:10px;background:#112033c7;backdrop-filter:blur(8px);box-shadow:0 5px 18px #0004;text-align:center;pointer-events:none}\n  #soloRaceHud span{font-size:10px;font-weight:850;letter-spacing:.06em;white-space:nowrap} #soloRaceTime{font-size:19px;line-height:1;font-variant-numeric:tabular-nums;color:#fff}\n', 'race hud css')

once('  soloMode=true;soloPreviousInputSource=inputSource;soloControls=neutralControls();updateSoloSticks();document.body.classList.add("solo-flight");soloHud.hidden=false;inputSource="local";',
     '  soloMode=true;soloPreviousInputSource=inputSource;soloControls=neutralControls();updateSoloSticks();raceTrack.reset();raceTrack.setVisible(true);document.body.classList.add("solo-flight");soloHud.hidden=false;inputSource="local";', 'enter race')

once('  soloControls=neutralControls();updateSoloSticks();localArm=false;arm=false;localThrottle=0;inputSource=soloPreviousInputSource;ui.inputSource.value=inputSource;soloMode=false;soloHud.hidden=true;document.body.classList.remove("solo-flight");',
     '  soloControls=neutralControls();updateSoloSticks();localArm=false;arm=false;localThrottle=0;inputSource=soloPreviousInputSource;ui.inputSource.value=inputSource;soloMode=false;soloHud.hidden=true;raceTrack.setVisible(false);document.body.classList.remove("solo-flight");', 'exit race')

once('$("camSolo").onclick=enterSolo;$("soloExit").onclick=exitSolo;\n',
     '$("camSolo").onclick=enterSolo;$("soloExit").onclick=exitSolo;\nfunction resetSoloSimulation(){const restart=mode==="sim"&&Boolean(backend);stopRun();remoteAutoStarted=false;resetSimulation(mode==="replay"&&realLog.length?realLog[0]:null);if(restart)startRun();}\n$("soloReset").onclick=resetSoloSimulation;\n', 'solo reset')

once('  physics.reset(defaultParams(),initial);sequence=1;simTime=0;resetFlag=true;',
     '  physics.reset(defaultParams(),initial);raceTrack.reset();sequence=1;simTime=0;resetFlag=true;', 'race reset')

once('    else {latest=await controllerStep();physics.step(latest.motors,DT);simTime+=DT;recordSession();}\n',
     '    else {latest=await controllerStep();physics.step(latest.motors,DT);simTime+=DT;raceTrack.update(physics.position(),simTime,Boolean(latest.state&STATE_ARMED));recordSession();}\n', 'race update')

once('$("soloState").textContent=stateText;$("soloAlt").textContent=Math.max(0,state.z).toFixed(1)+" m";$("soloCamera").textContent=cameraMode.toUpperCase();soloArm.classList.toggle',
     '$("soloState").textContent=stateText;$("soloAlt").textContent=Math.max(0,state.z).toFixed(1)+" m";$("soloCamera").textContent=cameraMode.toUpperCase();const race=raceTrack.snapshot(simTime);$("soloLap").textContent=race.finished?`FINISH · ${race.totalTimeText}`:(race.started?`LAP ${race.lap}/${race.totalLaps}`:`READY · ${race.totalLaps} LAPS`);$("soloRaceTime").textContent=race.finished?race.totalTimeText:race.currentLapText;$("soloGate").textContent=race.finished?"COURSE COMPLETE":`GATE ${race.nextGate+1}/${race.gateCount} · ${race.nextGateText}`;$("soloBest").textContent=`BEST ${race.bestLapText}`;soloArm.classList.toggle', 'race render')

p.write_text(s)

# Strengthen the already-run browser E2E. It verifies that RESET SIM stays inside
# single-phone mode and resets both FC and race HUD without a page reload.
p=Path('tests/browser_sim_smoke.mjs')
t=p.read_text()
old='''  const soloUi = await page.evaluate(() => ({soloButton:!!document.querySelector("#camSolo"),soloHud:!!document.querySelector("#soloHud"),left:!!document.querySelector("#soloLeft"),right:!!document.querySelector("#soloRight"),arm:!!document.querySelector("#soloArm"),kill:!!document.querySelector("#soloKill")}));
  if (!Object.values(soloUi).every(Boolean)) throw new Error(`single-phone HUD incomplete: ${JSON.stringify(soloUi)}`);
'''
new='''  const soloUi = await page.evaluate(() => ({soloButton:!!document.querySelector("#camSolo"),soloHud:!!document.querySelector("#soloHud"),left:!!document.querySelector("#soloLeft"),right:!!document.querySelector("#soloRight"),arm:!!document.querySelector("#soloArm"),kill:!!document.querySelector("#soloKill"),reset:!!document.querySelector("#soloReset"),lap:!!document.querySelector("#soloLap"),raceTime:!!document.querySelector("#soloRaceTime"),gate:!!document.querySelector("#soloGate"),best:!!document.querySelector("#soloBest")}));
  if (!Object.values(soloUi).every(Boolean)) throw new Error(`single-phone race HUD incomplete: ${JSON.stringify(soloUi)}`);
'''
if old not in t: raise SystemExit('missing browser HUD anchor')
t=t.replace(old,new,1)
old='''  await page.click("#soloKill");
  const killStart = await simTime();
  await waitForSimTime(killStart + 0.05, 10000);
  soloState = await page.$eval("#fcState", element => element.textContent || "");
  const killedMotors = await page.$eval("#motors", element => (element.textContent || "").trim().split(/\\s+/).map(Number));
  if (soloState !== "DISARMED" || !killedMotors.every(value => value === 1000)) throw new Error(`single-phone KILL failed: ${JSON.stringify(await snapshot())}`);
  await page.evaluate(() => document.querySelector("#soloExit")?.click());
'''
new='''  await page.click("#soloKill");
  const killStart = await simTime();
  await waitForSimTime(killStart + 0.05, 10000);
  soloState = await page.$eval("#fcState", element => element.textContent || "");
  const killedMotors = await page.$eval("#motors", element => (element.textContent || "").trim().split(/\\s+/).map(Number));
  if (soloState !== "DISARMED" || !killedMotors.every(value => value === 1000)) throw new Error(`single-phone KILL failed: ${JSON.stringify(await snapshot())}`);

  const beforeReset = await simTime();
  if (beforeReset < 3) throw new Error(`single-phone sim did not advance before RESET: ${beforeReset}`);
  await page.click("#soloReset");
  await page.waitForFunction(() => parseFloat(document.querySelector("#simTime")?.textContent || "99") < 0.25, {timeout:5000});
  const resetState = await page.evaluate(() => ({
    solo:document.body.classList.contains("solo-flight"),
    hudHidden:document.querySelector("#soloHud")?.hidden,
    state:document.querySelector("#fcState")?.textContent || "",
    lap:document.querySelector("#soloLap")?.textContent || "",
    raceTime:document.querySelector("#soloRaceTime")?.textContent || "",
    gate:document.querySelector("#soloGate")?.textContent || "",
    motors:(document.querySelector("#motors")?.textContent || "").trim().split(/\\s+/).map(Number),
  }));
  if (!resetState.solo || resetState.hudHidden) throw new Error(`RESET SIM left single-phone fullscreen UI: ${JSON.stringify(resetState)}`);
  if (!resetState.lap.includes("READY") || resetState.raceTime !== "00:00.000" || !resetState.gate.includes("START / FINISH")) throw new Error(`race state did not reset: ${JSON.stringify(resetState)}`);
  if (!resetState.motors.every(value => value === 1000)) throw new Error(`RESET SIM did not force motor minimum: ${JSON.stringify(resetState)}`);
  await waitForSimTime(2.2,60000);
  soloState=await page.$eval("#fcState",element=>element.textContent||"");
  if(soloState!=="DISARMED")throw new Error(`flight core did not recalibrate after fullscreen RESET: ${JSON.stringify(await snapshot())}`);

  await page.evaluate(() => document.querySelector("#soloExit")?.click());
'''
if old not in t: raise SystemExit('missing browser reset anchor')
t=t.replace(old,new,1)
t=t.replace('Browser SIL E2E passed: daylight scene, FOLLOW/FPV cameras, paired-equivalent single-phone controls, calibration, ARM/KILL, idle RPM, local fallback, throttle and responsive layout.',
            'Browser SIL E2E passed: daylight scene, FOLLOW/FPV cameras, paired-equivalent single-phone controls, 3-lap race HUD, fullscreen RESET SIM, calibration, ARM/KILL, idle RPM, local fallback, throttle and responsive layout.')
p.write_text(t)
