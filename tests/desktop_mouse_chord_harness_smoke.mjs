// Uses real Chromium mouse down/up events (including RMB -> LMB and LMB -> RMB).
// Imports actual desktop_controls.mjs; additionally runs the actual first-person
// mousedown handler extracted from the shipping module, without a full WASM build.
import puppeteer from 'puppeteer-core';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const root=process.argv[2]||'http://127.0.0.1:4176',chrome=process.env.CHROME_BIN;
if(!chrome)throw Error('CHROME_BIN missing');
const walk=readFileSync('sim/player_walk_mode_v4.mjs','utf8');
const start=walk.indexOf('  addEventListener("mousedown",e=>{',walk.indexOf('function installInput()'));
const end=walk.indexOf('  addEventListener("mouseup",e=>',start);
assert.ok(start>0&&end>start,'Cannot locate shipping foot mouse handler');
const handler=walk.slice(start,end);
const browser=await puppeteer.launch({headless:true,executablePath:chrome,args:['--no-sandbox','--disable-dev-shm-usage']});
const page=await browser.newPage();
const state=()=>page.evaluate(()=>({locked:document.pointerLockElement===document.getElementById('viewport'),rmb:globalThis.__arondightDesktopInput?.rmb,lmb:globalThis.__arondightDesktopInput?.lmb,mode:globalThis.__arondightDesktopInput?.mode,droneFire:globalThis.__arondightDesktopDroneInput?.fire,shots:globalThis.__chordShots||[],held:globalThis.__chordFireHeld}));
try{
  await page.setViewport({width:960,height:540,hasTouch:false,deviceScaleFactor:1});
  await page.goto(new URL('/tests/desktop_mouse_chord_fixture.html',root).href,{waitUntil:'load',timeout:20000});
  await page.evaluate(()=>{
    window.__chordShots=[];
    window.__arondightWalkMode={mode:'foot',applyMouseLook:()=>{}};
    window.__arondightFootWeapons={mode:'smg',displayMode:'smg'};
    window.__arondightDroneWeapons={mode:'gun',displayMode:'gun'};
  });
  await page.evaluate(async()=>import('/sim/desktop_controls.mjs'));
  await page.waitForFunction(()=>Boolean(window.__arondightDesktopInput),{timeout:4000});
  await page.evaluate(code=>{
    const view=document.getElementById('viewport');
    new Function('view',`let mode='foot',state={fireHeld:false};const isPlayerDead=()=>false,fistsOut=()=>window.__arondightFootWeapons.mode==='fists';const selectedWeaponFire=(time,source,hand)=>{window.__chordShots.push({source,hand});return true};window.__switchChordMode=m=>{mode=m};window.__chordFireHeld=()=>state.fireHeld;${code}`)(view);
  },handler);
  // Browser user gesture: first click claims pointer lock; is not a shot.
  await page.mouse.click(470,250);
  await page.waitForFunction(()=>document.pointerLockElement===document.querySelector('#viewport'),{timeout:3000});
  await page.mouse.down({button:'left'});
  let a=await state();assert.equal(a.shots.length,1,'ordinary LMB must fire exactly one shot');assert.equal(a.shots[0].source,'mouse-mousedown');
  await page.mouse.up({button:'left'});
  await page.mouse.down({button:'right'});
  a=await state();assert.equal(a.rmb,true,'RMB engages aim');assert.equal(a.shots.length,1,'RMB alone must not shoot gun');
  await page.mouse.down({button:'left'});
  a=await state();assert.equal(a.rmb,true);assert.equal(a.shots.length,2,'RMB held then LMB must fire');
  await page.mouse.up({button:'left'});a=await state();assert.equal(a.rmb,true,'RMB survives LMB release');
  await page.mouse.up({button:'right'});a=await state();assert.equal(a.rmb,false);
  await page.mouse.down({button:'left'});await page.mouse.down({button:'right'});
  a=await state();assert.equal(a.shots.length,3,'LMB first fires');assert.equal(a.rmb,true,'RMB engages mid-fire');
  await page.mouse.up({button:'right'});await page.mouse.up({button:'left'});
  // Fists retain independent mouse button hands, including while held together.
  await page.evaluate(()=>window.__arondightFootWeapons.mode='fists');
  await page.mouse.down({button:'right'});await page.mouse.down({button:'left'});
  a=await state();assert.deepEqual(a.shots.slice(-2).map(s=>s.hand),[0,1],'fists must retain separate right/left hands');
  await page.mouse.up({button:'left'});await page.mouse.up({button:'right'});
  // Drone fire state remains active with RMB free-look held.
  await page.evaluate(()=>{window.__switchChordMode('drone');window.__arondightWalkMode.mode='drone';});
  await page.mouse.down({button:'right'});await page.mouse.down({button:'left'});
  a=await state();assert.equal(a.droneFire,true,'RMB+LMB must fire drone gun');assert.equal(a.rmb,true);
  await page.mouse.up({button:'left'});a=await state();assert.equal(a.droneFire,false,'LMB release must stop fire');assert.equal(a.rmb,true,'RMB must stay held');
  await page.mouse.up({button:'right'});
  console.log('Real Chromium independent mouse chord gate passed:',JSON.stringify(a));
}finally{await browser.close()}
