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
 const page=await browser.newPage();await page.setViewport({width:390,height:844,deviceScaleFactor:3,isMobile:true,hasTouch:true});
 if(localDeps){await page.setRequestInterception(true);const depMap=new Map([
  ['https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.js',path.join(root,'node_modules/three/build/three.module.js')],
  ['https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/controls/OrbitControls.js',path.join(root,'node_modules/three/examples/jsm/controls/OrbitControls.js')],
  ['https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/geometries/ConvexGeometry.js',path.join(root,'node_modules/three/examples/jsm/geometries/ConvexGeometry.js')],
  ['https://cdn.jsdelivr.net/npm/box3d.js@0.1.1/dist/box3d.inline.mjs',path.join(root,'node_modules/box3d.js/dist/box3d.inline.mjs')],
 ]);page.on('request',req=>{const f=depMap.get(req.url());if(f)req.respond({status:200,contentType:'text/javascript; charset=utf-8',headers:{'Access-Control-Allow-Origin':'*','Cache-Control':'no-store'},body:fs.readFileSync(f)}).catch(()=>{});else req.continue().catch(()=>{})});}
 await page.goto(base+(base.includes('?')?'&':'?')+'orbit='+Date.now(),{waitUntil:'domcontentloaded',timeout:60000});
 await page.waitForFunction(()=>window.Editor3D?.views?.[0]?.renderer&&window.Editor3DMobileOrbit,{timeout:60000});
 await page.waitForFunction(()=>document.querySelector('.e3d-mobile-orbit-toggle'),{timeout:5000});
 const initial=await page.evaluate(()=>{const v=Editor3D.views[0],b=v.__mobileOrbitBtn;return{gravity:Editor3D.scene.world.gravity.slice(),orbit:v.mobileOrbitMode,controls:v.controls.enabled,mode:b.dataset.mode,text:b.querySelector('.txt').textContent,hidden:b.hidden}});
 assert.deepEqual(initial.gravity,[0,0,-9.80665]);assert.equal(initial.orbit,true);assert.equal(initial.controls,false);assert.equal(initial.mode,'orbit');assert.equal(initial.text,'Orbit');assert.equal(initial.hidden,false);
 const owned=await page.evaluate(()=>{const v=Editor3D.views[0],c=v.renderer.domElement;window.__orbitBubble=0;c.addEventListener('pointerdown',()=>window.__orbitBubble++);c.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId:71,pointerType:'touch',clientX:120,clientY:140}));c.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,pointerId:71,pointerType:'touch',clientX:120,clientY:140}));return window.__orbitBubble});
 assert.equal(owned,0,'orbit mode must own canvas input and block selection handlers');
 await page.click('.e3d-mobile-orbit-toggle');
 const interact=await page.evaluate(()=>{const v=Editor3D.views[0];return{orbit:v.mobileOrbitMode,controls:v.controls.enabled,mode:v.__mobileOrbitBtn.dataset.mode,text:v.__mobileOrbitBtn.querySelector('.txt').textContent}});
 assert.equal(interact.orbit,false);assert.equal(interact.controls,false);assert.equal(interact.mode,'interact');assert.ok(['Select','Grab'].includes(interact.text));
 const released=await page.evaluate(()=>{const v=Editor3D.views[0],c=v.renderer.domElement;window.__orbitBubble=0;c.addEventListener('pointerdown',()=>window.__orbitBubble++);c.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId:72,pointerType:'touch',clientX:120,clientY:140}));c.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,pointerId:72,pointerType:'touch',clientX:120,clientY:140}));return window.__orbitBubble});
 assert.ok(released>0,'interact mode must release canvas input to selection/grab handlers');
 await page.click('.e3d-mobile-orbit-toggle');
 const moved=await page.evaluate(()=>{const v=Editor3D.views[0],c=v.renderer.domElement,before=v.camera.position.clone();c.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId:73,pointerType:'touch',clientX:100,clientY:120}));c.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,pointerId:73,pointerType:'touch',clientX:150,clientY:145}));c.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,pointerId:73,pointerType:'touch',clientX:150,clientY:145}));return before.distanceTo(v.camera.position)});
 assert.ok(moved>.001,'orbit drag must move camera');
 console.log('PASS editor3d mobile orbit browser smoke');
}finally{await browser.close()}
