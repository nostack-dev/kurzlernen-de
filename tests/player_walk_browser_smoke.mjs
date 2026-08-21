import puppeteer from "puppeteer-core";

const input = process.argv[2] || "http://127.0.0.1:4174/drone_simulator.html";
const inputUrl = new URL(input, "http://127.0.0.1:4174");
const url = inputUrl.pathname.endsWith("/drone_simulator.html")
  ? new URL(inputUrl.href)
  : new URL("/drone_simulator.html", inputUrl.origin);
const executablePath = process.env.CHROME_BIN;
if (process.env.GITHUB_SHA) url.searchParams.set("ci", process.env.GITHUB_SHA);
if (!executablePath) throw new Error("CHROME_BIN must point to Chrome/Chromium");

const browser = await puppeteer.launch({
  headless: true,
  executablePath,
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    "--use-gl=angle",
    "--use-angle=swiftshader",
  ],
});
const page = await browser.newPage();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

try {
  await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1");
  await page.setViewport({width:844,height:390,deviceScaleFactor:1});
  await page.goto(url.href,{waitUntil:"load",timeout:30000});
  await page.waitForFunction(()=>document.querySelector("#status")?.textContent?.includes("SIM ready"),{timeout:30000});
  await page.waitForFunction(()=>
    globalThis.__arondightWalkMode &&
    document.querySelector("#playerModeButton") &&
    document.querySelectorAll(".foot-stick").length===2 &&
    document.querySelector("[data-world-location-select]") &&
    document.querySelector("#viewport")?.dataset.worldSatelliteDefault==="off" &&
    Number(document.querySelector("#viewport")?.dataset.worldLifeBirds||0)>0,
    {timeout:8000}
  );

  await page.click("#playerModeButton");
  await page.waitForFunction(()=>document.body.classList.contains("on-foot-mode")&&document.querySelector("#viewport")?.dataset.playerMode==="foot",{timeout:4000});
  await page.waitForFunction(()=>Boolean(document.querySelector("#viewport")?.dataset.walkPosition)&&document.querySelector("#viewport")?.dataset.walkWeapon3d==="1",{timeout:4000});

  const ui = await page.evaluate(()=>{
    const locationSelect=document.querySelector("[data-world-location-select]");
    const v=document.querySelector("#viewport");
    const b=globalThis.__arondightRealWorld;
    return {
      sticks:[...document.querySelectorAll(".foot-stick")].map(el=>getComputedStyle(el).display),
      leftPointer:getComputedStyle(document.querySelector("#soloLeft")).pointerEvents,
      rightPointer:getComputedStyle(document.querySelector("#soloRight")).pointerEvents,
      armDisplay:getComputedStyle(document.querySelector("#soloArm")).display,
      stateDisplay:getComputedStyle(document.querySelector("#soloState")).display,
      requiresArm:v?.dataset.walkRequiresArm,
      architecture:v?.dataset.walkArchitecture,
      weapon3d:Boolean(b?.threeScene?.getObjectByName?.("WALK_PISTOL_3D")?.visible),
      locationOptions:[...locationSelect.options].map(o=>o.value),
      locationLabel:locationSelect.closest("[data-world-location-selector]")?.textContent||"",
      satelliteDefault:v?.dataset.worldSatelliteDefault,
      imageryStorage:localStorage.getItem("arondight45WorldImageryV1"),
      imageryEnabled:b?.imageryEnabled,
      life:{
        cars:Number(v?.dataset.worldLifeExtraCars||0),
        people:Number(v?.dataset.worldLifeExtraPeople||0),
        buses:Number(v?.dataset.worldLifeBuses||0),
        birds:Number(v?.dataset.worldLifeBirds||0),
        shootable:v?.dataset.worldLifeShootable,
        architecture:v?.dataset.worldLifeArchitecture,
      },
      lifeLayer:Boolean(b?.threeScene?.getObjectByName?.("WORLD_EXPERIENCE_LIFE")),
      clones:(()=>{let n=0;b?.threeScene?.traverse?.(x=>{if(x.userData?.worldPopulationClone)n++;});return n;})(),
    };
  });

  if(
    ui.sticks.length!==2 || ui.sticks.some(x=>x==="none") ||
    ui.leftPointer!=="none" || ui.rightPointer!=="none" ||
    ui.armDisplay!=="none" || ui.stateDisplay!=="none" ||
    ui.requiresArm!=="0" || ui.architecture!=="camera-input-overlay-v4" || !ui.weapon3d ||
    !ui.locationOptions.includes("new-york") || !ui.locationOptions.includes("berlin") || !ui.locationOptions.includes("custom") ||
    !ui.locationLabel.includes("Permanent") || ui.satelliteDefault!=="off" || ui.imageryStorage!=="0" || ui.imageryEnabled!==false ||
    ui.life.cars<6 || ui.life.people<10 || ui.life.buses<3 || ui.life.birds<10 ||
    ui.life.shootable!=="1" || ui.life.architecture!=="route-anchored-v1" || ui.lifeLayer || ui.clones
  ) throw new Error(`WALK/location/liveliness UI contract failed: ${JSON.stringify(ui)}`);

  const beforeMove=await page.$eval("#viewport",v=>v.dataset.walkPosition||"");
  const moveBox=await page.$eval("#footMove",el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};});
  await page.mouse.move(moveBox.x+moveBox.w/2,moveBox.y+moveBox.h/2);
  await page.mouse.down();
  await page.mouse.move(moveBox.x+moveBox.w/2,moveBox.y+moveBox.h*.12,{steps:4});
  await sleep(320);
  await page.mouse.up();
  const afterMove=await page.$eval("#viewport",v=>v.dataset.walkPosition||"");
  if(!beforeMove||beforeMove===afterMove)throw new Error(`left WALK stick did not move player without arming: ${beforeMove} -> ${afterMove}`);

  const yawBefore=Number(await page.$eval("#viewport",v=>v.dataset.walkYaw||0));
  const lookBox=await page.$eval("#footLook",el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};});
  await page.mouse.move(lookBox.x+lookBox.w/2,lookBox.y+lookBox.h/2);
  await page.mouse.down();
  await page.mouse.move(lookBox.x+lookBox.w*.88,lookBox.y+lookBox.h/2,{steps:4});
  await sleep(280);
  await page.mouse.up();
  const yawAfter=Number(await page.$eval("#viewport",v=>v.dataset.walkYaw||0));
  if(yawAfter-yawBefore<.08)throw new Error(`right WALK stick must look right, not inverted: ${yawBefore} -> ${yawAfter}`);

  const before=await page.evaluate(()=>{const v=document.querySelector("#viewport");return{walk:Number(v.dataset.walkShots||0),drone:Number(v.dataset.fireShots||0)};});
  await page.click("#footFire");
  await page.waitForFunction(n=>Number(document.querySelector("#viewport")?.dataset.walkShots||0)>n,{timeout:3000},before.walk);
  const after=await page.evaluate(()=>{const v=document.querySelector("#viewport");return{walk:Number(v.dataset.walkShots||0),drone:Number(v.dataset.fireShots||0)};});
  if(after.drone!==before.drone)throw new Error(`WALK touch leaked into drone fire: ${before.drone} -> ${after.drone}`);

  const combat=await page.evaluate(async()=>{
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    const hierarchyVisible=node=>{for(let n=node;n;n=n.parent)if(n.visible===false)return false;return true;};
    const b=globalThis.__arondightRealWorld;
    const v=document.querySelector("#viewport");
    const road=[{kind:"road",geometryType:"LineString",roadClass:"primary",paths:[[[9,47],[9.0015,47],[9.003,47.0002]]]}];
    const paint=new Map([["fill-extrusion-opacity",1],["fill-extrusion-color","#ccd2d5"]]);
    const keepFixture=()=>{
      b.active=true;
      b.originLon=9;
      b.originLat=47;
      b.minimapFeatures=road;
      if(!b.map||!b.map.__walkSmokeFixture){
        b.map={
          __walkSmokeFixture:true,
          getStyle:()=>({layers:[
            {id:"transportation",type:"line","source-layer":"transportation"},
            {id:"arondight45-buildings-3d",type:"fill-extrusion","source-layer":"building"},
          ]}),
          getLayer:()=>({}),
          queryRenderedFeatures:()=>[],
          getPaintProperty:(_id,key)=>paint.get(key),
          setPaintProperty:(_id,key,value)=>paint.set(key,value),
        };
      }
    };
    const snapshot=()=>({
      active:Boolean(b.active),
      origin:[b.originLon,b.originLat],
      traffic:Number(v.dataset.worldTrafficRoutes||0),
      lifeRoutes:Number(v.dataset.worldLifeRoutes||0),
      lifeVisible:Number(v.dataset.worldLifeVisible||0),
      hitHook:typeof b.registerWorldPopulationHit,
      features:Array.isArray(b.minimapFeatures)?b.minimapFeatures.length:-1,
      blood:Number(v.dataset.worldBloodFx||0),
      ragdolls:Number(v.dataset.worldRagdollSpawns||0),
      lastPopulationHit:v.dataset.worldPopulationLastHit||"",
      walkFireApi:v.dataset.walkFireApi||"",
      walkAimStateSync:v.dataset.walkAimStateSync||"",
      walkPhysicsShots:Number(v.dataset.walkPhysicsShots||0),
      bulletSpawns:Number(v.dataset.box3dBulletSpawns||0),
      bulletImpacts:Number(v.dataset.box3dBulletImpacts||0),
      lastImpact:v.dataset.box3dLastImpactKind||"",
      combatPeople:Number(v.dataset.box3dCombatPeople||0),
      combatTargets:Number(v.dataset.box3dCombatTargets||0),
      latePending:Number(v.dataset.box3dLatePopulationPending||0),
      lateRegistered:Number(v.dataset.box3dLatePopulationRegistered||0),
      walkYaw:v.dataset.walkYaw||"",
      walkPitch:v.dataset.walkPitch||"",
    });
    const waitFor=async(fn,timeout=10000,label="state")=>{
      const end=performance.now()+timeout;
      while(performance.now()<end){
        keepFixture();
        const value=fn();
        if(value)return value;
        await wait(30);
      }
      throw Error(`walk combat wait timeout ${label}: ${JSON.stringify(snapshot())}`);
    };

    keepFixture();
    await waitFor(()=>
      Number(v.dataset.worldTrafficRoutes||0)>=1 &&
      Number(v.dataset.worldLifeRoutes||0)>=1 &&
      Number(v.dataset.worldLifeVisible||0)>0 &&
      Number(v.dataset.box3dCombatPeople||0)>=1 &&
      Number(v.dataset.box3dLatePopulationRegistered||0)>=1 &&
      v.dataset.walkFireApi==="box3d-direct-v1" &&
      typeof b.registerWorldPopulationHit==="function",
      12000,
      "world-ready"
    );

    const nativePeople=[];
    b.threeScene.traverse(node=>{
      if(
        node?.isMesh && hierarchyVisible(node) &&
        node.userData?.worldPopulationKind==="person" &&
        node.userData?.worldPopulationId &&
        !node.userData?.worldLifeId
      ) nativePeople.push(node);
    });
    if(!nativePeople.length)throw Error(`native WORLD pedestrian missing: ${JSON.stringify(snapshot())}`);

    const targetId=String(nativePeople[0].userData.worldPopulationId);
    const bloodBefore=Number(v.dataset.worldBloodFx||0);
    const ragBefore=Number(v.dataset.worldRagdollSpawns||0);
    const physicsBefore=Number(v.dataset.walkPhysicsShots||0);
    let nativeAttempts=0;
    for(let attempt=0;attempt<4 && Number(v.dataset.worldRagdollSpawns||0)<=ragBefore;attempt++){
      let mesh=null;
      b.threeScene.traverse(node=>{
        if(
          !mesh && node?.isMesh && hierarchyVisible(node) &&
          String(node.userData?.worldPopulationId||"")===targetId &&
          node.userData?.worldPopulationKind==="person" &&
          !node.userData?.worldLifeId
        ) mesh=node;
      });
      if(!mesh)break;
      const p=mesh.getWorldPosition(mesh.position.clone());
      const x=p.x;
      const y=p.y-1.35;
      const z=1.68;
      const dx=p.x-x,dy=p.y-y,dz=p.z-z;
      const yaw=Math.atan2(dx,dy);
      const pitch=Math.atan2(dz,Math.hypot(dx,dy));
      globalThis.__arondightWalkMode.setPose({x,y,yaw,pitch});
      await waitFor(()=>Math.abs(Number(v.dataset.walkYaw)-yaw)<.01&&Math.abs(Number(v.dataset.walkPitch)-pitch)<.01,1000,"aim-sync");
      // Let both the visual population and its kinematic Box3D target consume
      // the newly synchronized pose before creating the high-speed CCD bullet.
      await wait(70);
      nativeAttempts++;
      globalThis.__arondightWalkMode.fire(performance.now()+700+attempt*250);
      await wait(320);
    }
    await waitFor(()=>
      Number(v.dataset.walkPhysicsShots||0)>=physicsBefore+2 &&
      Number(v.dataset.worldBloodFx||0)>bloodBefore &&
      Number(v.dataset.worldRagdollSpawns||0)>ragBefore,
      5000,
      "pedestrian-hit"
    );

    const lifeHitsBefore=Number(v.dataset.worldLifeHits||0);
    let bus=null,bird=null;
    b.threeScene.traverse(node=>{
      if(node?.isMesh&&hierarchyVisible(node)&&node.userData?.worldLifeId){
        if(!bus&&node.userData.worldPopulationKind==="bus")bus=node;
        if(!bird&&node.userData.worldPopulationKind==="bird")bird=node;
      }
    });
    if(!bus||!bird)throw Error(`shootable WORLD life missing: bus=${Boolean(bus)} bird=${Boolean(bird)} state=${JSON.stringify(snapshot())}`);
    const busPoint=bus.getWorldPosition(bus.position.clone());
    const birdPoint=bird.getWorldPosition(bird.position.clone());
    const busHit=Boolean(b.registerWorldPopulationHit({object:bus,point:busPoint}));
    const birdHit=Boolean(b.registerWorldPopulationHit({object:bird,point:birdPoint}));
    await waitFor(()=>Number(v.dataset.worldLifeHits||0)>=lifeHitsBefore+2,5000,"life-hits");

    let clones=0;
    b.threeScene.traverse(node=>{if(node.userData?.worldPopulationClone)clones++;});
    const life={
      busHit,
      birdHit,
      hitsBefore:lifeHitsBefore,
      hits:Number(v.dataset.worldLifeHits||0),
      last:v.dataset.worldLifeLastHit,
      visible:Number(v.dataset.worldLifeVisible||0),
      routes:Number(v.dataset.worldLifeRoutes||0),
      palette:v.dataset.worldVisualPalette||"",
    };
    const physics={
      shots:Number(v.dataset.walkPhysicsShots||0)-physicsBefore,
      impacts:Number(v.dataset.box3dBulletImpacts||0),
      lastImpact:v.dataset.box3dLastImpactKind||"",
      people:Number(v.dataset.box3dCombatPeople||0),
      lateRegistered:Number(v.dataset.box3dLatePopulationRegistered||0),
    };
    b.active=false;
    return {
      bloodBefore,
      blood:Number(v.dataset.worldBloodFx||0),
      ragBefore,
      rag:Number(v.dataset.worldRagdollSpawns||0),
      nativeAttempts,
      targetId,
      clones,
      physics,
      life,
    };
  });

  if(
    combat.blood<=combat.bloodBefore || combat.rag<=combat.ragBefore || combat.nativeAttempts<2 || combat.physics.shots<2 ||
    combat.clones!==0 || !combat.life.busHit || !combat.life.birdHit ||
    combat.life.hits<combat.life.hitsBefore+2 || combat.life.last!=="bird" || combat.life.routes<1
  ) throw new Error(`WALK/native + vivid WORLD life combat failed: ${JSON.stringify(combat)}`);

  console.log(`Player WALK browser smoke passed: no arming, left-stick move, direct right-look, true 3D pistol, satellite default OFF, persistent New York/Berlin/custom WORLD selector, route-anchored extra cars/people/buses/birds, shootable bus+bird, isolated drone touch, physical Box3D pedestrian blood/ragdoll, zero clone population: ${JSON.stringify({beforeMove,afterMove,yawBefore,yawAfter,ui:ui.life,combat})}`);
} finally {
  await browser.close();
}
