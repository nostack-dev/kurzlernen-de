import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const direct=readFileSync('sim/direct_fire_missiles.mjs','utf8');
const modes=readFileSync('sim/drone_weapon_modes.mjs','utf8');
const start=direct.indexOf('function patchApi(){'),end=direct.indexOf('\nfunction frame(',start);
assert.ok(start>=0&&end>start,'physical missile API hook is missing');
const hook=direct.slice(start,end);
for(const registration of ['api.fireMissileDirect=fireMissile','if(!api.__arondightExtendedMissileRouter)api.fireMissile=fireMissile'])assert.ok(hook.includes(registration),'missing safe direct rocket ownership: '+registration);
function scenario(order){
  const events=[];
  const api={mode:'gun',setMode(mode){this.mode=mode},fireMissile(){events.push('legacy');return true}};
  const store=new Map();
  const context={__arondightDroneWeapons:api,__arondightWeaponLockUntil:0,
    __arondightGuidedMissile:{press(){events.push('guided');return true}},
    performance:{now:()=>500},document:{getElementById:()=>({dataset:{}})},
    localStorage:{setItem:(k,v)=>store.set(k,v),getItem:k=>store.get(k)||null},
    requestAnimationFrame:()=>{}};
  context.globalThis=context;
  const sandbox=vm.createContext(context);
  vm.runInContext('let patchedApi=null;const viewport=()=>document.getElementById("viewport");function fireMissile(){globalThis.events.push("direct");return true;}\n'+hook,sandbox);
  context.events=events;
  const loadModes=()=>vm.runInContext(modes+'\npatch();',sandbox);
  const loadDirect=()=>vm.runInContext('patchApi();',sandbox);
  if(order==='direct-first'){loadDirect();loadModes();}
  else{loadModes();loadDirect();}
  assert.equal(typeof api.fireMissileDirect,'function',order+': fixed-ray capability is installed');
  assert.equal(api.displayMode,'gun');
  assert.equal(api.fireMissile({source:'test'}),false,'GUN must not fire a missile');
  api.setMode('missile');assert.equal(api.displayMode,'missile');
  assert.equal(api.fireMissile({source:'test'}),true,'ROCKETS fires when selected');
  assert.deepEqual(events,['direct'],order+': no legacy/homing route');
  api.setMode('guided');assert.equal(api.fireMissile({source:'test'}),true);
  assert.deepEqual(events,['direct','guided'],order+': guided route retained');
  api.setMode('missile');context.__arondightWeaponLockUntil=600;
  assert.equal(api.fireMissile({source:'test'}),false,'locked weapon cannot shoot');
  assert.deepEqual(events,['direct','guided'],order+': locked fire has no side effects');
  loadDirect();assert.equal(api.displayMode,'missile');
  context.__arondightWeaponLockUntil=0;assert.equal(api.fireMissile({source:'test'}),true);
  assert.deepEqual(events,['direct','guided','direct'],order+': timer refresh must not override the selector');
}
scenario('direct-first');scenario('modes-first');
console.log('Drone rocket routing, weapon selection, lockout and init-order regression: pass');
