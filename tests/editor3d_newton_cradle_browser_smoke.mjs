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
 await page.goto(base+(base.includes('?')?'&':'?')+'cradle='+Date.now(),{waitUntil:'domcontentloaded',timeout:60000});
 await page.waitForFunction(()=>window.Editor3D?.b3&&window.Editor3D?.loadDemo&&window.Editor3D?.buildWorld,{timeout:60000});
 const r=await page.evaluate(()=>{
   Editor3D.loadDemo('cradle');
   const s=Editor3D.scene,b3=Editor3D.b3;
   const balls=s.bodies.filter(b=>b.name.startsWith('cradle ball '));
   const supports=s.bodies.filter(b=>/^frame |base rail|top beam/.test(b.name));
   const joints=s.joints.filter(j=>j.type==='distance');
   const sim=Editor3D.buildWorld(s);
   const first=sim.bodies.get(balls[0].id),p0=b3.b3Body_GetPosition([0,0,0],first).slice();
   for(let i=0;i<20;i++)b3.b3World_Step(sim.world,1/120,4);
   const p1=b3.b3Body_GetPosition([0,0,0],first).slice();
   b3.b3DestroyWorld(sim.world);
   return {name:s.name,gravity:s.world.gravity.slice(),balls:balls.length,supports:supports.length,joints:joints.length,firstX:balls[0].position[0],restX:balls.slice(1).map(b=>b.position[0]),restitution:balls.map(b=>b.fixtures[0].restitution),sleep:balls.map(b=>b.allowSleep),bullet:balls.map(b=>b.bullet),moved:Math.hypot(p1[0]-p0[0],p1[1]-p0[1],p1[2]-p0[2])};
 });
 assert.equal(r.name,'Newton cradle');assert.deepEqual(r.gravity,[0,0,-9.80665]);assert.equal(r.balls,5);assert.ok(r.supports>=8);assert.equal(r.joints,10);assert.ok(r.firstX<-1);assert.ok(r.restX.every(x=>Math.abs(x)<1e-9));assert.ok(r.restitution.every(x=>x===1));assert.ok(r.sleep.every(x=>x===false));assert.ok(r.bullet.every(Boolean));assert.ok(r.moved>.0001,'pulled cradle ball must advance under Box3D gravity');
 console.log('PASS editor3d Newton cradle browser smoke');
}finally{await browser.close()}
