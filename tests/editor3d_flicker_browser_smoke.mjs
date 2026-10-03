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
  await page.setViewport({width:390,height:844,deviceScaleFactor:3,isMobile:true,hasTouch:true});
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
      if(f) req.respond({status:200,contentType:'text/javascript; charset=utf-8',headers:{'Access-Control-Allow-Origin':'*','Cache-Control':'no-store'},body:fs.readFileSync(f)}).catch(()=>{});
      else req.continue().catch(()=>{});
    });
  }
  await page.goto(base+(base.includes('?')?'&':'?')+'flicker='+Date.now(),{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>window.Editor3D?.views?.[0]?.renderer,{timeout:60000});
  await new Promise(r=>setTimeout(r,250));
  const first=await page.evaluate(()=>{
    const v=Editor3D.views[0],a=v.renderer.getContext().getContextAttributes(),c=v.renderer.domElement;
    return{preserve:a.preserveDrawingBuffer,alpha:a.alpha,gridZ:v.grid.position.z,floorZ:v.floor.position.z,pixelRatio:v.renderer.getPixelRatio(),coarse:matchMedia('(pointer:coarse)').matches,w:c.width,h:c.height,rw:v.resizeW,rh:v.resizeH};
  });
  assert.equal(first.preserve,false);
  assert.equal(first.alpha,false);
  assert.equal(first.gridZ,.006);
  assert.equal(first.floorZ,-.07);
  assert.ok(first.gridZ-first.floorZ>.05);
  assert.ok(first.pixelRatio<= (first.coarse?1.5:2));
  await new Promise(r=>setTimeout(r,700));
  const second=await page.evaluate(()=>{const v=Editor3D.views[0],c=v.renderer.domElement;return{w:c.width,h:c.height,rw:v.resizeW,rh:v.resizeH}});
  assert.deepEqual(second,first&&{w:first.w,h:first.h,rw:first.rw,rh:first.rh});
  console.log('PASS editor3d mobile anti-flicker browser smoke');
} finally {await browser.close();}
