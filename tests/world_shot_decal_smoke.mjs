import puppeteer from "puppeteer-core";
import {readFileSync} from "node:fs";

const base=process.argv[2]||"http://127.0.0.1:4174";
const executablePath=process.env.CHROME_BIN;
if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");

const bootstrap=readFileSync("sim/real_world_bootstrap.mjs","utf8");
const fireFx=readFileSync("sim/flight_fire_fx.mjs","utf8");
for(const marker of ["worldShotPoint","worldShotNormal","queryRenderedFeatures([qx,qy]","pointInRing","groundT=-o.z/d.z"])
  if(!bootstrap.includes(marker))throw new Error(`WORLD shot geometry contract missing: ${marker}`);
if(bootstrap.includes("arondight45-shot-impacts")||bootstrap.includes("refreshShotImpacts"))
  throw new Error("legacy MapLibre shot-impact layer returned; WORLD must use the shared THREE decal pool");
for(const marker of ["worldBridge?.addVisualShotImpact","addThreeDecal(worldHit,\"world\",null)","hit.object?.attach","impactTargetRoot","arondight45:impact","worldDecalMaterial","RAYCAST_REFRESH_MS=500","belongsToAirframe","DECAL_POOL_SIZE=32"])
  if(!fireFx.includes(marker))throw new Error(`shared physical-impact contract missing: ${marker}`);
if(fireFx.includes("offsetWidth"))throw new Error("fire impact still forces synchronous layout");
const shotSound=fireFx.slice(fireFx.indexOf("function shotSound"),fireFx.indexOf("function screenImpact"));
if(shotSound.includes("createBufferSource"))throw new Error("fire sound still allocates a BufferSource per shot");

const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader"]});
const page=await browser.newPage();
const OPENFREEMAP_STYLE="https://tiles.openfreemap.org/styles/liberty";
const fixtureStyle={version:8,name:"WORLD shot geometry fixture",sources:{},layers:[{id:"background",type:"background",paint:{"background-color":"#243440"}}]};
await browser.defaultBrowserContext().overridePermissions(base,["geolocation"]);
await page.setGeolocation({latitude:39.569600,longitude:2.650200,accuracy:4});
await page.setRequestInterception(true);
page.on("request",request=>{
  const url=request.url(),parsed=new URL(url);
  if(["data:","blob:","about:"].includes(parsed.protocol)||["127.0.0.1","localhost"].includes(parsed.hostname)){request.continue();return;}
  if(url.startsWith(OPENFREEMAP_STYLE)){request.respond({status:200,contentType:"application/json",headers:{"access-control-allow-origin":"*","cache-control":"no-store"},body:JSON.stringify(fixtureStyle)});return;}
  request.abort();
});

try{
  await page.setViewport({width:844,height:390,deviceScaleFactor:1});
  await page.goto(`${base}/drone_simulator.html`,{waitUntil:"load",timeout:30000});
  await page.waitForFunction(()=>document.querySelector("#status")?.textContent.includes("SIM ready"),{timeout:30000});
  await page.click("#camSolo");
  await page.waitForFunction(()=>document.body.classList.contains("solo-flight"),{timeout:5000});
  await page.click("#soloWorld");
  await page.waitForFunction(()=>{const v=document.querySelector("#viewport");return v?.dataset.worldMode==="real"&&globalThis.__arondightRealWorld?.map;},{timeout:20000});

  const geometry=await page.evaluate(()=>{
    const b=globalThis.__arondightRealWorld,v=document.querySelector("#viewport"),rect=v.getBoundingClientRect(),map=b.map;
    const originalGetLayer=map.getLayer.bind(map),originalQuery=map.queryRenderedFeatures.bind(map);
    const R=6378137,cosLat=Math.max(.01,Math.cos(b.originLat*Math.PI/180));
    const ll=(east,north)=>[
      b.originLon+(east/(R*cosLat))*180/Math.PI,
      b.originLat+(north/R)*180/Math.PI,
    ];
    const ring=[ll(-5,-5),ll(5,-5),ll(5,5),ll(-5,5),ll(-5,-5)];
    const building={properties:{render_height:10,render_min_height:0},geometry:{type:"Polygon",coordinates:[ring]}};
    const snap=hit=>hit?{point:{x:hit.point.x,y:hit.point.y,z:hit.point.z},normal:{x:hit.worldNormal.x,y:hit.worldNormal.y,z:hit.worldNormal.z}}:null;
    try{
      map.getLayer=id=>id==="arondight45-buildings-3d"?{id}:originalGetLayer(id);
      map.queryRenderedFeatures=()=>[building];
      const wall=snap(b.addVisualShotImpact(100,100,rect,{origin:{x:0,y:-12,z:5},direction:{x:0,y:1,z:0}}));
      const roof=snap(b.addVisualShotImpact(100,100,rect,{origin:{x:0,y:0,z:20},direction:{x:0,y:0,z:-1}}));
      map.getLayer=id=>id==="arondight45-buildings-3d"?null:originalGetLayer(id);
      map.queryRenderedFeatures=()=>[];
      const first=b.addVisualShotImpact(100,100,rect,{origin:{x:2,y:3,z:12},direction:{x:0,y:0,z:-1}}),firstRef=first;
      const ground=snap(first);
      const second=b.addVisualShotImpact(100,100,rect,{origin:{x:-1,y:4,z:7},direction:{x:0,y:0,z:-1}});
      return{wall,roof,ground,reusedHitObject:firstRef===second,queries:Number(v.dataset.worldShotQueries||0)};
    }finally{
      map.getLayer=originalGetLayer;
      map.queryRenderedFeatures=originalQuery;
    }
  });

  const near=(a,b,eps)=>Math.abs(a-b)<=eps;
  if(!geometry.wall||!near(geometry.wall.point.x,0,.03)||!near(geometry.wall.point.y,-5,.03)||!near(geometry.wall.point.z,5,.03)||geometry.wall.normal.y>-.98)
    throw new Error(`WORLD building-wall ray registration failed: ${JSON.stringify(geometry)}`);
  if(!geometry.roof||!near(geometry.roof.point.x,0,.03)||!near(geometry.roof.point.y,0,.03)||!near(geometry.roof.point.z,10,.03)||geometry.roof.normal.z<.98)
    throw new Error(`WORLD building-roof ray registration failed: ${JSON.stringify(geometry)}`);
  if(!geometry.ground||!near(geometry.ground.point.x,2,.01)||!near(geometry.ground.point.y,3,.01)||!near(geometry.ground.point.z,0,.01)||geometry.ground.normal.z<.98)
    throw new Error(`WORLD ground ray registration failed: ${JSON.stringify(geometry)}`);
  if(!geometry.reusedHitObject)throw new Error(`WORLD impact result allocates per hit instead of reusing the hit object: ${JSON.stringify(geometry)}`);
  if(geometry.queries<2)throw new Error(`WORLD building-hit queries were not exercised: ${JSON.stringify(geometry)}`);

  // A MapLibre/world hit must create a visible THREE decal at the exact physical
  // ENU hit point and emit a gameplay-observable impact event. The screen flash
  // is not accepted as proof of a world impact.
  const worldVisual=await page.evaluate(async()=>{
    const b=globalThis.__arondightRealWorld,v=document.querySelector("#viewport"),scene=b.threeScene,r=v.getBoundingClientRect(),saved=[],original=b.addVisualShotImpact;
    for(const child of scene.children){if(child.userData?.flightFireDecal)continue;saved.push([child,child.visible]);if(!child.userData?.arondightAirframe)child.visible=false;}
    b.worldShotPoint.set(4,5,2);b.worldShotNormal.set(0,0,1);b.addVisualShotImpact=()=>b.worldShotHit;
    let impact=null;const listener=e=>{impact={kind:e.detail.kind,point:e.detail.point,normal:e.detail.normal};};v.addEventListener("arondight45:impact",listener,{once:true});
    const before=Number(v.dataset.fireWorldHits||0),x=r.left+r.width*.5,y=r.top+r.height*.5,send=type=>v.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:501,pointerType:"touch",clientX:x,clientY:y,button:0}));
    send("pointerdown");await new Promise(resolve=>setTimeout(resolve,35));send("pointerup");await new Promise(resolve=>setTimeout(resolve,20));
    let decal=null;scene.traverse(node=>{if(node.userData?.flightFireDecal&&node.userData?.flightFireWorld&&node.userData?.flightFireKind==="world"&&node.visible)decal=node;});
    const result={before,after:Number(v.dataset.fireWorldHits||0),impact,decal:decal?{x:decal.position.x,y:decal.position.y,z:decal.position.z,visible:decal.visible,depthTest:decal.material?.depthTest}:null};
    b.addVisualShotImpact=original;for(const [child,visible]of saved)child.visible=visible;return result;
  });
  if(worldVisual.after!==worldVisual.before+1||worldVisual.impact?.kind!=="world"||!worldVisual.decal||!worldVisual.decal.visible||worldVisual.decal.depthTest!==false||!near(worldVisual.decal.x,4,.01)||!near(worldVisual.decal.y,5,.01)||!near(worldVisual.decal.z,2.0035,.01)||!near(worldVisual.impact.point.x,4,.001)||!near(worldVisual.impact.point.y,5,.001)||!near(worldVisual.impact.point.z,2,.001))
    throw new Error(`WORLD physical hit was not acknowledged at its real hitpoint: ${JSON.stringify(worldVisual)}`);

  // In TRAINING, a moving gameplay target gets the decal as a child of the exact
  // mesh that was hit. Moving the target must move the decal with it. A marked
  // airframe hierarchy in front of it is deliberately ignored by the raycaster.
  await page.click("#soloWorld");
  await page.waitForFunction(()=>document.querySelector("#viewport")?.dataset.worldMode==="training",{timeout:5000});
  const targetVisual=await page.evaluate(async()=>{
    const THREE=await import("/node_modules/three/build/three.module.js"),b=globalThis.__arondightRealWorld,v=document.querySelector("#viewport"),scene=b.threeScene,cam=b.threeCamera,r=v.getBoundingClientRect(),dir=new THREE.Vector3();cam.getWorldDirection(dir);
    const targetRoot=new THREE.Group();targetRoot.userData.flightTarget=true;const targetMesh=new THREE.Mesh(new THREE.BoxGeometry(.6,.6,.6),new THREE.MeshBasicMaterial({color:0xffffff}));targetRoot.add(targetMesh);targetRoot.position.copy(cam.position).addScaledVector(dir,3);scene.add(targetRoot);
    const blockerRoot=new THREE.Group();blockerRoot.userData.arondightAirframe=true;const blockerMesh=new THREE.Mesh(new THREE.BoxGeometry(.8,.8,.8),new THREE.MeshBasicMaterial({color:0xff0000}));blockerRoot.add(blockerMesh);blockerRoot.position.copy(cam.position).addScaledVector(dir,2);scene.add(blockerRoot);scene.updateMatrixWorld(true);
    let impact=null;v.addEventListener("arondight45:impact",e=>{impact={kind:e.detail.kind,target:e.detail.target===targetRoot,object:e.detail.object===targetMesh,point:e.detail.point};},{once:true});
    const before=Number(v.dataset.fireTargetHits||0),builds0=Number(v.dataset.fireRaycastBuilds||0),x=r.left+r.width*.5,y=r.top+r.height*.5,send=type=>v.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:502,pointerType:"touch",clientX:x,clientY:y,button:0}));
    send("pointerdown");await new Promise(resolve=>setTimeout(resolve,35));send("pointerup");await new Promise(resolve=>setTimeout(resolve,20));scene.updateMatrixWorld(true);
    const decal=targetMesh.children.find(node=>node.userData?.flightFireDecal&&node.userData?.flightFireTarget);const p0=new THREE.Vector3(),p1=new THREE.Vector3();if(decal)decal.getWorldPosition(p0);targetRoot.position.x+=1;scene.updateMatrixWorld(true);if(decal)decal.getWorldPosition(p1);
    const result={before,after:Number(v.dataset.fireTargetHits||0),builds:Number(v.dataset.fireRaycastBuilds||0)-builds0,impact,attached:Boolean(decal),delta:decal?{x:p1.x-p0.x,y:p1.y-p0.y,z:p1.z-p0.z}:null};
    scene.remove(blockerRoot);scene.remove(targetRoot);targetMesh.geometry.dispose();targetMesh.material.dispose();blockerMesh.geometry.dispose();blockerMesh.material.dispose();return result;
  });
  if(targetVisual.after!==targetVisual.before+1||targetVisual.builds!==1||targetVisual.impact?.kind!=="target"||!targetVisual.impact.target||!targetVisual.impact.object||!targetVisual.attached||!near(targetVisual.delta?.x,1,.015)||!near(targetVisual.delta?.y,0,.015)||!near(targetVisual.delta?.z,0,.015))
    throw new Error(`moving target/airframe impact acknowledgement failed: ${JSON.stringify(targetVisual)}`);

  // Sustained fire may refresh the target cache periodically for dynamic scene
  // membership, but it must never traverse the scene once per projectile.
  const hotpath=await page.evaluate(async()=>{
    const v=document.querySelector("#viewport"),r=v.getBoundingClientRect(),x=r.left+r.width*.5,y=r.top+r.height*.72,send=type=>v.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:503,pointerType:"touch",clientX:x,clientY:y,button:0})),shots0=Number(v.dataset.fireShots||0),builds0=Number(v.dataset.fireRaycastBuilds||0);send("pointerdown");await new Promise(resolve=>setTimeout(resolve,1250));send("pointerup");return{shots:Number(v.dataset.fireShots||0)-shots0,builds:Number(v.dataset.fireRaycastBuilds||0)-builds0,writes:Number(v.dataset.fireDecalWrites||0)};
  });
  if(hotpath.shots<10||hotpath.builds<1||hotpath.builds>=hotpath.shots/2)throw new Error(`sustained fire rebuilt raycast targets too often: ${JSON.stringify(hotpath)}`);

  console.log(`WORLD/target impact acknowledgement passed: exact map hitpoint decal, moving-target attached decal, airframe hierarchy exclusion and amortized raycast cache: ${JSON.stringify({geometry,worldVisual,targetVisual,hotpath})}`);
}finally{await browser.close();}