import assert from 'node:assert/strict';
import {GUIDED_BALANCE,updatePedestrianDodge} from '../sim/guided_balance.mjs';
import {readFileSync} from 'node:fs';
const b=GUIDED_BALANCE;
assert.ok(b.speedMps<=35&&b.turnG<=2.5&&b.blastRadiusM<=4&&b.damage<=35&&b.cooldownMs>=4000);
let state={seconds:0,lost:false},x=0;
for(let i=0;i<9;i++){const old={x,y:0,z:0},next={x:x+=.34,y:0,z:0};state=updatePedestrianDodge(state,{previous:old,current:next,dt:.05,pedestrian:true});}
assert.equal(state.lost,true,'sustained sprint dodge breaks tracking');
state={seconds:0,lost:false};for(let i=0;i<20;i++)state=updatePedestrianDodge(state,{previous:{x:0,y:0},current:{x:.04,y:0},dt:.05,pedestrian:true});
assert.equal(state.lost,false,'walking does not defeat homing');
state=updatePedestrianDodge({seconds:0,lost:false},{previous:{x:0,y:0},current:{x:1,y:0},dt:.05,pedestrian:false});assert.equal(state.lost,false,'cars and drones cannot use pedestrian dodge');
const src=readFileSync(new URL('../sim/guided_missile.mjs',import.meta.url),'utf8');
assert.match(src,/warnLock\(picked\)/);assert.match(src,/updatePedestrianDodge\(m\.dodge/);assert.match(src,/GUIDED_BALANCE\.cooldownMs/);
console.log('GUIDED combat nerf and pedestrian sprint dodge: pass');
