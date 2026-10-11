import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../sim/world_ground.mjs',import.meta.url),'utf8');
assert.match(source,/presented=Number\.isFinite\(b\.viewCameraAt\)/,'follow the actual presented first-person camera');
assert.match(source,/const current=\(\)=>colorEpoch===epoch/,'late imagery must be guarded by generation');
assert.match(source,/if\(!isCurrent\(\)\)return null;/,'cancel superseded albedo scans');
assert.doesNotMatch(source,/busy\|\|now-lastTry/,'imagery must not block terrain streaming');
const start=source.indexOf('function rebuild(b,cx,cy){'),end=source.indexOf('\nfunction frame(',start);
assert.ok(start>=0&&end>start,'immediate terrain rebuild exists');
const extract=source.slice(start,end);
const requests=[];const screen={dataset:{}};const scene={};const world={active:true,threeScene:scene};
const env={mesh:null,colorEpoch:0,baseColors:null,fullColors:null,areas:[],WORLD_GROUND_VERSION:'test',
  document:{getElementById:()=>screen},
  ensureMesh(s){if(!env.mesh)env.mesh={parent:s,position:{x:0,y:0,set(x,y){this.x=x;this.y=y;}},visible:false};return env.mesh;},
  fallbackColors(x){return new Float32Array([x,0,0]);},
  paintAreas(){},distributeColors(){},applyHeights(){},
  sampleColors(b,x,y,isCurrent){return new Promise(resolve=>requests.push({x,y,isCurrent,resolve}));},
  console,
};
const rebuild=new Function('env',`with(env){${extract};return rebuild;}`)(env);
rebuild(world,0,0);
assert.equal(env.mesh.visible,true,'ground must be visible synchronously, before tiles load');
assert.equal(screen.dataset.worldGroundSource,'fallback');
assert.equal(requests.length,1);
rebuild(world,400,0);
assert.equal(env.mesh.position.x,400,'moving player immediately relocates native heightfield');
assert.equal(env.baseColors[0],400);
assert.equal(requests[0].isCurrent(),false,'old requests invalidated');
requests[0].resolve(new Float32Array([999,0,0]));
await Promise.resolve();await Promise.resolve();
assert.equal(env.baseColors[0],400,'late imagery must not overwrite a newer center');
requests[1].resolve(new Float32Array([4,0,0]));
await Promise.resolve();await Promise.resolve();
assert.equal(env.baseColors[0],4);
assert.equal(screen.dataset.worldGroundSource,'satellite-albedo');
rebuild(world,500,0);world.active=false;
requests[2].resolve(new Float32Array([55,0,0]));
await Promise.resolve();await Promise.resolve();
assert.equal(env.baseColors[0],500,'deactivated world must reject imagery writes');
console.log('Terrain first-frame/freshness/mode-camera contract: pass');
