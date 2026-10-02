import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const root=process.env.REPO_ROOT||process.cwd();
const chrome=process.env.CHROME_BIN;
if(!chrome) throw new Error('CHROME_BIN is required');
const base=process.env.EDITOR3D_URL||'http://127.0.0.1:4180/editor3d.html';
const localDeps=process.env.EDITOR3D_LOCAL_DEPS==='1';
const browser=await puppeteer.launch({executablePath:chrome,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
try{
  const page=await browser.newPage();
  await page.setViewport({width:1440,height:920,deviceScaleFactor:1});
  const pageErrors=[];
  const consoleErrors=[];
  page.on('pageerror',e=>pageErrors.push(String(e?.stack||e)));
  page.on('console',m=>{if(m.type()==='error') consoleErrors.push(m.text())});

  if(localDeps){
    await page.setRequestInterception(true);
    const depMap=new Map([
      ['https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.js',path.join(root,'node_modules/three/build/three.module.js')],
      ['https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/controls/OrbitControls.js',path.join(root,'node_modules/three/examples/jsm/controls/OrbitControls.js')],
      ['https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/geometries/ConvexGeometry.js',path.join(root,'node_modules/three/examples/jsm/geometries/ConvexGeometry.js')],
      ['https://cdn.jsdelivr.net/npm/box3d.js@0.1.1/dist/box3d.inline.mjs',path.join(root,'node_modules/box3d.js/dist/box3d.inline.mjs')],
    ]);
    page.on('request',req=>{
      const f=depMap.get(req.url());
      if(f){
        req.respond({status:200,contentType:'text/javascript; charset=utf-8',headers:{'Access-Control-Allow-Origin':'*','Cache-Control':'no-store'},body:fs.readFileSync(f)}).catch(()=>{});
      }else req.continue().catch(()=>{});
    });
  }

  await page.goto(base+(base.includes('?')?'&':'?')+'smoke='+Date.now(),{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>window.Editor3D?.b3&&window.Editor3D?.scene?.bodies?.length>0,{timeout:60000});
  await new Promise(r=>setTimeout(r,300));

  async function check(name,fn){await fn();console.log('PASS',name)}

  await check('boots with Box3D and a valid document',async()=>{
    const r=await page.evaluate(()=>({errors:Editor3D.validate(),bodies:Editor3D.scene.bodies.length,version:Editor3D.scene.version,format:Editor3D.scene.format}));
    assert.deepEqual(r.errors,[]); assert.ok(r.bodies>0); assert.equal(r.version,2); assert.equal(r.format,'editor3d');
  });

  await check('Box3D stack world runs 240 finite steps without mutating the document',async()=>{
    const r=await page.evaluate(()=>{
      Editor3D.loadDemo('hulls'); const before=JSON.stringify(Editor3D.scene),sim=Editor3D.buildWorld(Editor3D.scene),b3=Editor3D.b3;
      for(let i=0;i<240;i++) b3.b3World_Step(sim.world,1/60,4);
      const pos=[0,0,0],finite=[...sim.bodies.values()].every(id=>{b3.b3Body_GetPosition(pos,id);return pos.every(Number.isFinite)});
      const same=before===JSON.stringify(Editor3D.scene); b3.b3DestroyWorld(sim.world); return{finite,same,count:sim.bodies.size};
    });
    assert.ok(r.finite&&r.same&&r.count>5);
  });

  await check('every editor joint kind builds in Box3D and simulates',async()=>{
    const r=await page.evaluate(()=>{
      Editor3D.loadDemo('joints'); const sim=Editor3D.buildWorld(Editor3D.scene),b3=Editor3D.b3;
      for(let i=0;i<90;i++) b3.b3World_Step(sim.world,1/60,4);
      const out={scene:Editor3D.scene.joints.length,physics:sim.joints.size,errors:Editor3D.validate()}; b3.b3DestroyWorld(sim.world); return out;
    });
    assert.deepEqual(r.errors,[]); assert.equal(r.physics,r.scene); assert.ok(r.scene>=11);
  });

  await check('B/F/V/J/I modes and exact XYZ typed transform + undo/redo',async()=>{
    const r=await page.evaluate(()=>{
      Editor3D.loadDemo('mechanism'); const body=Editor3D.scene.bodies.find(b=>b.type===2),x0=body.position[0];
      const modes=[]; for(const m of ['body','fixture','vertex','joint','image']){Editor3D.setMode(m);modes.push(Editor3D.mode)}
      Editor3D.setMode('body'); Editor3D.select([body.id],'body'); Editor3D.beginOperation('translate'); Editor3D.operation.axis='x'; Editor3D.operation.typed='2'; Editor3D.applyTypedOperation(); Editor3D.finishOperation(true);
      const x1=Editor3D.scene.bodies.find(b=>b.id===body.id).position[0]; Editor3D.undo(); const xu=Editor3D.scene.bodies.find(b=>b.id===body.id).position[0]; Editor3D.redo(); const xr=Editor3D.scene.bodies.find(b=>b.id===body.id).position[0];
      return{modes,x0,x1,xu,xr,errors:Editor3D.validate()};
    });
    assert.deepEqual(r.modes,['body','fixture','vertex','joint','image']); assert.equal(r.x1,r.x0+2); assert.equal(r.xu,r.x0); assert.equal(r.xr,r.x0+2); assert.deepEqual(r.errors,[]);
  });

  await check('negative X mirror keeps scene valid and reverses revolute limits/motor',async()=>{
    const r=await page.evaluate(()=>{
      Editor3D.loadDemo('mechanism'); const j=Editor3D.scene.joints.find(j=>j.type==='wheel'),ids=Editor3D.scene.bodies.map(b=>b.id),oldSpeed=j?.motorSpeed||0;
      Editor3D.setMode('body'); Editor3D.select(ids,'body'); Editor3D.beginOperation('scale'); Editor3D.operation.axis='x'; Editor3D.operation.typed='-1'; Editor3D.applyTypedOperation(); Editor3D.finishOperation(true);
      const now=Editor3D.scene.joints.find(x=>x.id===j.id); return{oldSpeed,speed:now.motorSpeed,errors:Editor3D.validate()};
    });
    assert.deepEqual(r.errors,[]); assert.equal(r.speed,-r.oldSpeed);
  });

  await check('connected body duplicate remaps internal joints and undo restores',async()=>{
    const r=await page.evaluate(()=>{
      Editor3D.loadDemo('mechanism'); const s=Editor3D.scene,dyn=s.bodies.filter(b=>b.type===2).slice(0,3),ids=dyn.map(b=>b.id),before={b:s.bodies.length,j:s.joints.length};
      Editor3D.setMode('body');Editor3D.select(ids,'body');Editor3D.duplicate();Editor3D.finishOperation(false);
      const selected=Editor3D.documents.at(-1).selection.body,addedJ=Editor3D.scene.joints.slice(before.j); const after={b:Editor3D.scene.bodies.length,j:Editor3D.scene.joints.length,internal:addedJ.every(j=>selected.includes(j.bodyA)&&selected.includes(j.bodyB))}; Editor3D.undo(); return{before,after,undoB:Editor3D.scene.bodies.length};
    });
    assert.ok(r.after.b>r.before.b); assert.ok(r.after.internal); assert.equal(r.undoB,r.before.b);
  });

  await check('independent Player advances while document remains unchanged',async()=>{
    const r=await page.evaluate(async()=>{
      Editor3D.loadDemo('mechanism'); const before=JSON.stringify(Editor3D.scene); Editor3D.openPlayer(); await new Promise(r=>setTimeout(r,250)); const p=Editor3D.views.at(-1); const out={type:p.type,separate:p.source!==p.doc.scene,steps:p.sim?.steps||0,same:before===JSON.stringify(p.doc.scene)}; p.playing=false; return out;
    });
    assert.equal(r.type,'player'); assert.ok(r.separate&&r.steps>0&&r.same);
  });

  await check('real play-mode mouse grab creates and releases Box3D MotorJoint',async()=>{
    const point=await page.evaluate(()=>{
      const v=Editor3D.views.at(-1),b=v.source.bodies.find(x=>x.type===2); if(!b)return null; const root=[...v.content.children].find(o=>o.userData?.bodyId===b.id&&o.userData?.mode==='body')||[...v.content.children].find(o=>o.userData?.id===b.id); if(!root)return null; const p=root.position.clone().project(v.camera),r=v.renderer.domElement.getBoundingClientRect(); return{x:r.left+(p.x+1)*r.width/2,y:r.top+(-p.y+1)*r.height/2};
    });
    assert.ok(point);
    await page.mouse.move(point.x,point.y); await page.mouse.down({button:'left'}); await new Promise(r=>setTimeout(r,80));
    assert.equal(await page.evaluate(()=>!!Editor3D.views.at(-1).grab),true);
    await page.mouse.move(point.x+60,point.y-25,{steps:4}); await new Promise(r=>setTimeout(r,100)); await page.mouse.up({button:'left'}); await new Promise(r=>setTimeout(r,50));
    assert.equal(await page.evaluate(()=>!!Editor3D.views.at(-1).grab),false);
  });

  await check('canvas suppresses browser selection/callout and owns touch gestures',async()=>{
    const r=await page.evaluate(()=>{const c=document.querySelector('.scene');const s=getComputedStyle(c);return{user:s.userSelect,webkit:s.webkitUserSelect,touch:s.touchAction,sel:getComputedStyle(c.parentElement).userSelect}});
    assert.equal(r.user,'none'); assert.equal(r.sel,'none'); assert.equal(r.touch,'none');
  });

  await check('desktop and mobile layouts do not horizontally overflow',async()=>{
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.setViewport({width:390,height:844,deviceScaleFactor:1}); await new Promise(r=>setTimeout(r,100));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  });

  if(pageErrors.length) throw new Error('page errors:\n'+pageErrors.join('\n'));
  const materialConsoleErrors=consoleErrors.filter(x=>!/(favicon|WebGL.*software|GPU stall)/i.test(x));
  if(materialConsoleErrors.length) throw new Error('console errors:\n'+materialConsoleErrors.join('\n'));
  console.log('PASS editor3d browser smoke');
} finally { await browser.close(); }
