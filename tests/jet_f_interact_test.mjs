import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync('sim/pad_actions.mjs','utf8');
const start=source.indexOf('function onKey(e){'),end=source.indexOf('// Where am I?',start);
assert.ok(start>0&&end>start);
const snippet=source.slice(start,end);
function check({show='0',disabled=false,hidden=false,enter=true,jetActive=false,carActive=false,mode='foot',blocked=false}={}){
 const calls=[],events=[],jet={active:jetActive,enter(){calls.push('jet');return enter;}};
 const repair={dataset:{show},disabled,closest(){return hidden?{}:null;}};
 const fn=new Function('document','Element','menuOpen','startScreen','dead','walk','sendKey','globalThis',snippet+';return onKey')({getElementById(){return repair;}},class Element{},()=>blocked,()=>false,()=>false,()=>({mode}),key=>calls.push(key),{__jetMode:jet,__arondightVehicleDrive:{active:carActive}});
 fn({code:'KeyF',repeat:false,metaKey:false,ctrlKey:false,altKey:false,target:null,preventDefault(){events.push('prevent');}});
 return{calls,events};
}
assert.deepEqual(check().calls,['jet'],'F boards jet');
assert.deepEqual(check({enter:false}).calls,['jet','KeyE'],'fallback to normal interact');
assert.deepEqual(check({carActive:true}).calls,['KeyE'],'active car exits');
assert.deepEqual(check({show:'1'}).calls,[],'actionable zombie repair has precedence');
assert.deepEqual(check({show:'1',disabled:true,enter:false}).calls,['jet','KeyE'],'disabled repair not blocking');
assert.deepEqual(check({show:'1',hidden:true,enter:false}).calls,['jet','KeyE'],'hidden repair not blocking');
assert.deepEqual(check({blocked:true}).calls,[],'menu blocks interact');
console.log('F jet boarding priority and repair fallback: pass');
