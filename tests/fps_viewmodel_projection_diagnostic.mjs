import puppeteer from "puppeteer-core";

const input=process.argv[2]||"http://127.0.0.1:4174/drone_simulator.html";
const url=new URL(input,"http://127.0.0.1:4174");
const executablePath=process.env.CHROME_BIN;
if(!executablePath)throw new Error("CHROME_BIN must point to Chrome/Chromium");
const browser=await puppeteer.launch({headless:true,executablePath,args:["--no-sandbox","--disable-dev-shm-usage","--enable-webgl","--ignore-gpu-blocklist","--use-gl=angle","--use-angle=swiftshader"]});
const page=await browser.newPage();
try{
  await page.setViewport({width:960,height:540,deviceScaleFactor:1,hasTouch:true});
  await page.goto(url.href,{waitUntil:"load",timeout:30000});
  await page.waitForFunction(()=>document.querySelector("#status")?.textContent?.includes("SIM ready")&&globalThis.__arondightWalkMode&&globalThis.__arondightRealWorld?.threeRenderer,{timeout:30000});
  await page.evaluate(()=>{globalThis.__arondightPlayerDamageModel?.reset?.();globalThis.__arondightWalkMode.setMode("foot",{persist:false});});
  await page.waitForFunction(()=>document.querySelector("#viewport")?.dataset.playerMode==="foot",{timeout:5000});
  await page.evaluate(()=>{
    const b=globalThis.__arondightRealWorld,v=document.querySelector("#viewport"),renderer=b.threeRenderer;
    globalThis.__arondightFootWeaponPresentationV1={__finalViewmodelOwner:true,apply:({gun,camera})=>{if(!gun||!camera)return false;camera.updateMatrixWorld?.(true);gun.updateMatrixWorld?.(true);const Vec=gun.position.constructor,world=new Vec();gun.getWorldPosition(world);const local=world.clone();camera.worldToLocal(local);v.dataset.fpsVmPreParent=JSON.stringify({parent:gun.parent?.name||gun.parent?.type||"",gunPosition:[gun.position.x,gun.position.y,gun.position.z],gunWorld:[world.x,world.y,world.z],cameraPosition:[camera.position.x,camera.position.y,camera.position.z],expectedCameraLocal:[local.x,local.y,local.z]});return false;}};
    if(renderer.__fpsProjectionDiagnostic)return;
    const base=renderer.render.bind(renderer),isHand=name=>/WALK_VM_(?:GLOVE|SLEEVE|CUFF)/.test(name),isWeapon=name=>/WALK_VM_(?:FRAME|RAIL|SLIDE|BARREL|MUZZLE|GRIP|SIGHT|TRIGGER|MAG|EJECTION|FRONT|REAR)/.test(name)||/WALK_SMG_/.test(name);
    renderer.render=(scene,camera)=>{
      const gun=scene?.getObjectByName?.("WALK_PISTOL_3D"),Vec=gun?.position?.constructor;
      const summary={frames:(Number(v.dataset.fpsVmDiagFrames)||0)+1,preParent:JSON.parse(v.dataset.fpsVmPreParent||"null"),gun:Boolean(gun),gunVisible:Boolean(gun?.visible),parent:gun?.parent?.name||gun?.parent?.type||"",parentIsCamera:Boolean(gun?.parent===camera),near:Number(camera?.near),fov:Number(camera?.fov),aspect:Number(camera?.aspect),gunLocal:gun?[gun.position.x,gun.position.y,gun.position.z]:null,hands:{visible:0,front:0,onScreen:0,samples:[]},weapon:{visible:0,front:0,onScreen:0,samples:[]}};
      const sample=(node,bucket)=>{
        if(!Vec)return;for(let n=node;n;n=n.parent)if(n.visible===false)return;bucket.visible++;
        node.geometry?.computeBoundingBox?.();const box=node.geometry?.boundingBox,points=[];
        if(box){for(const x of[box.min.x,box.max.x])for(const y of[box.min.y,box.max.y])for(const z of[box.min.z,box.max.z])points.push(new Vec(x,y,z));}
        points.push(new Vec(0,0,0));let front=false,onScreen=false,best=null;
        for(const p of points){node.localToWorld(p);const cam=p.clone();camera.worldToLocal(cam);const ndc=p.clone().project(camera);if(cam.z<-Math.max(.0001,Number(camera.near)||.01))front=true;if(cam.z<0&&ndc.x>=-1&&ndc.x<=1&&ndc.y>=-1&&ndc.y<=1&&ndc.z>=-1&&ndc.z<=1)onScreen=true;if(!best||Math.abs(ndc.x)+Math.abs(ndc.y)<Math.abs(best.ndc[0])+Math.abs(best.ndc[1]))best={name:node.name,cam:[cam.x,cam.y,cam.z],ndc:[ndc.x,ndc.y,ndc.z]};}
        if(front)bucket.front++;if(onScreen)bucket.onScreen++;if(best&&bucket.samples.length<4)bucket.samples.push(best);
      };
      gun?.traverse?.(node=>{if(!node?.isMesh)return;if(isHand(node.name))sample(node,summary.hands);if(isWeapon(node.name))sample(node,summary.weapon);});
      v.dataset.fpsVmDiagFrames=String(summary.frames);v.dataset.fpsVmDiag=JSON.stringify(summary);
      return base(scene,camera);
    };
    renderer.__fpsProjectionDiagnostic=true;
  });
  await page.waitForFunction(()=>Number(document.querySelector("#viewport")?.dataset.fpsVmDiagFrames||0)>=8,{timeout:5000});
  const diag=JSON.parse(await page.$eval("#viewport",v=>v.dataset.fpsVmDiag||"{}"));
  console.log("FPS_VIEWMODEL_DIAG "+JSON.stringify(diag));
  if(!diag.gun||!diag.gunVisible||diag.hands.visible<1||diag.weapon.visible<1)throw new Error("viewmodel not present/visible at renderer: "+JSON.stringify(diag));
  if(diag.hands.onScreen<1||diag.weapon.onScreen<1)throw new Error("viewmodel exists but is outside render frustum: "+JSON.stringify(diag));
}finally{await browser.close();}
