import assert from 'node:assert/strict';
import {voiceHudPosition} from '../sim/voice_hud_layout.mjs';
const overlap=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
const rect=(x,y,w,h)=>({left:x,top:y,right:x+w,bottom:y+h});
for(const [name,width,height,size] of [['landscape',844,390,38],['short',844,300,34],['compact',670,300,34],['portrait rotated logical',780,360,34]]){
  const move=rect(0,height-168,168,168),look=rect(width-168,height-168,168,168);
  const blocked=[move,look,rect(8,8,72,36),rect(width-80,8,72,36),rect(width/2-110,8,220,40),rect(168,height-42,106,40),rect(width-235,height-75,60,60),rect(75,125,65,55)];
  const p=voiceHudPosition({width,height,move,look,blocked,size});
  assert.ok(p,name+': must find reachable edge slot');
  const b=rect(p.x,p.y,p.width,p.height);
  assert.ok(p.x<width*.35||p.x>width*.65,name+': middle must remain free');
  assert.ok(p.y>=8&&b.bottom<=height-8,name+': within screen');
  for(const o of blocked)assert.ok(!overlap(b,o),name+': visible button overlap');
}
assert.equal(voiceHudPosition({width:300,height:210,blocked:[]}),null);
const blocked=[rect(0,0,640,360)];
assert.equal(voiceHudPosition({width:640,height:360,blocked}),null,'fail closed when no collision-free location');
console.log('Mobile voice edge geometry / thumb clearance: pass');
