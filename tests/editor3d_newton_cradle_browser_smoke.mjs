import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
const root=process.env.REPO_ROOT||process.cwd();
const chrome=process.env.CHROME_BIN;if(!chrome)throw new Error('CHROME_BIN is required');
const base=process.env.EDITOR3D_URL||'http://127.0.0.1:4180/editor3d.html';
const localDeps=process.env.EDITOR3D_LOCAL_DEPS==='1';
const browser=await puppeteer.launch({executablePath:chrome,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
try{
 const page=await browser.newPage();await page.setViewport({width:844,height:520,deviceScaleFactor:1});
 if(localDeps){await page.setRequestInterception(true);const depMap=new Map([
  ['https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.js',path.join(root,'node_modules/three/build/three.module.js')],
  ['https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/controls/OrbitControls.js',path.join(root,'node_modules/three/examples/jsm/controls/OrbitControls.js')],
  ['https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/geometries/ConvexGeometry.js',path.join(root,'node_modules/three/examples/jsm/geometries/ConvexGeometry.js')],
  ['https://cdn.jsdelivr.net/npm/box3d.js@0.1.1/dist/box3d.inline.mjs',path.join(root,'node_modules/box3d.js/dist/box3d.inline.mjs')],
 ]);page.on('request',req=>{const f=depMap.get(req.url());if(f)req.respond({status:200,contentType:'text/javascript; charset=utf-8',headers:{'Access-Control-Allow-Origin':'*','Cache-Control':'no-store'},body:fs.readFileSync(f)}).catch(()=>{});else req.continue().catch(()=>{})});}
 await page.goto(base+(base.includes('?')?'&':'?')+'cradle4='+Date.now(),{waitUntil:'domcontentloaded',timeout:60000});
 await page.waitForFunction(()=>window.Editor3D?.b3&&window.Editor3D?.loadDemo&&window.Editor3D?.buildWorld,{timeout:60000});
 const r=await page.evaluate(()=>{
   const defaultName=Editor3D.scene.name;Editor3D.loadDemo('cradle');
   const s=Editor3D.scene,b3=Editor3D.b3,balls=s.bodies.filter(b=>b.name.startsWith('cradle ball '));
   const rest=balls.map(b=>b.position.slice());
   const sim=Editor3D.buildWorld(s),ids=balls.map(b=>sim.bodies.get(b.id));
   const masses=ids.map(id=>b3.b3Body_GetMass(id));
   const initial=ids.map(id=>b3.b3Body_GetPosition([0,0,0],id).slice());
   const pull=.09,topZ=.34,drop=.20,first=ids[0],firstRestX=balls[0].position[0],pulledZ=topZ-Math.sqrt(drop*drop-pull*pull);
   const q=b3.b3Body_GetRotation([0,0,0,1],first);b3.b3Body_SetTransform(first,[firstRestX-pull,0,pulledZ],q);b3.b3Body_SetLinearVelocity(first,[0,0,0]);b3.b3Body_SetAwake(first,true);
   let maxLastDx=0,maxLastSpeed=0,maxMiddleDx=0;
   for(let i=0;i<600;i++){
     b3.b3World_Step(sim.world,1/s.world.stepsPerSecond,s.world.subStepCount);
     const ps=ids.map(id=>b3.b3Body_GetPosition([0,0,0],id));
     const vs=ids.map(id=>{const out=[0,0,0];b3.b3Body_GetLinearVelocity(out,id);return out});
     maxLastDx=Math.max(maxLastDx,Math.abs(ps.at(-1)[0]-initial.at(-1)[0]));
     maxLastSpeed=Math.max(maxLastSpeed,Math.abs(vs.at(-1)[0]));
     for(let k=1;k<balls.length-1;k++)maxMiddleDx=Math.max(maxMiddleDx,Math.abs(ps[k][0]-initial[k][0]));
   }
   const threshold=typeof b3.b3World_GetRestitutionThreshold==='function'?b3.b3World_GetRestitutionThreshold(sim.world):null;
   const hasPropagation=typeof b3.b3World_EnableRestitutionPropagation==='function';
   b3.b3DestroyWorld(sim.world);
   return {defaultName,name:s.name,world:{...s.world},balls:balls.length,rest,masses,radii:balls.map(b=>b.fixtures[0].radius),densities:balls.map(b=>b.fixtures[0].density),restitutions:balls.map(b=>b.fixtures[0].restitution),frictions:balls.map(b=>b.fixtures[0].friction),bullets:balls.map(b=>b.bullet),threshold,hasPropagation,maxLastDx,maxLastSpeed,maxMiddleDx};
 });
 assert.equal(r.defaultName,'Newton cradle');assert.equal(r.name,'Newton cradle');assert.equal(r.balls,5);
 assert.equal(r.world.stepsPerSecond,120);assert.equal(r.world.subStepCount,12);assert.equal(r.world.restitutionThreshold,.01);
 assert.ok(r.radii.every(x=>Math.abs(x-.025)<1e-9));assert.ok(r.densities.every(x=>x===7850));assert.ok(r.restitutions.every(x=>Math.abs(x-.995)<1e-9));assert.ok(r.frictions.every(x=>Math.abs(x-.005)<1e-9));assert.ok(r.bullets.every(x=>x===false));
 assert.ok(r.masses.every(m=>m>.50&&m<.53),`expected ~0.514 kg steel balls, got ${r.masses}`);
 assert.ok(r.rest.every(p=>Math.abs(p[1])<1e-9),'all balls must share Y=0 at rest');
 assert.ok(r.rest.every(p=>Math.abs(p[2]-r.rest[0][2])<1e-9),'all balls must start at the same height');
 for(let i=1;i<r.rest.length;i++)assert.ok(Math.abs((r.rest[i][0]-r.rest[i-1][0])-.05)<1e-9,'balls must start touching side-by-side');
 if(r.threshold!==null)assert.ok(Math.abs(r.threshold-.01)<1e-6,`runtime restitution threshold must be 0.01, got ${r.threshold}`);
 assert.ok(r.maxLastDx>.004,`impact must reach the far ball, displacement=${r.maxLastDx}`);
 assert.ok(r.maxLastSpeed>.08,`far ball must receive a strong visible impulse, speed=${r.maxLastSpeed}`);
 console.log('Box3D binding restitution propagation API:',r.hasPropagation?'available':'not available in box3d.js@0.1.1');
 console.log('Newton transfer',{maxLastDx:r.maxLastDx,maxLastSpeed:r.maxLastSpeed,maxMiddleDx:r.maxMiddleDx,mass:r.masses[0]});
 console.log('PASS editor3d equilibrium steel Newton cradle browser smoke');
}finally{await browser.close()}
