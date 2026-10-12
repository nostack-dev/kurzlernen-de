import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {voiceHudPosition} from '../sim/voice_hud_layout.mjs';
const jet=readFileSync('sim/jet_mode.mjs','utf8'),car=readFileSync('sim/player_car_mode.mjs','utf8'),voice=readFileSync('sim/proximity_voice.mjs','utf8');
const query='body.mobile-gameplay-compact.solo-flight:not(.desktop-input) #viewport';
assert.ok(jet.includes(query+' #enterJetButton'));
assert.ok(car.includes(query+' #enterCarButton'));
assert.match(voice,/'enterCarButton','enterJetButton'/);
const overlap=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
for(const [width,height] of [[844,390],[670,300],[568,320],[780,360]]){
 const stick=Math.min(width*.25,150),bot=18,move={left:12,right:12+stick,top:height-bot-stick,bottom:height-bot},look={left:width-12-stick,right:width-12,top:height-bot-stick,bottom:height-bot};
 const carBox={left:12,right:12+Math.max(120,Math.min(width*.21,150)),top:height-(bot+stick+16)-40,bottom:height-(bot+stick+16)};
 const jetBox={right:width-12,left:width-12-Math.max(126,Math.min(width*.22,154)),top:height-(bot+stick+64)-40,bottom:height-(bot+stick+64)};
 assert.ok(!overlap(carBox,move),'car vs left stick');
 assert.ok(!overlap(jetBox,look),'jet vs right stick');
 assert.ok(!overlap(carBox,jetBox),'car vs jet');
 const pos=voiceHudPosition({width,height,move,look,blocked:[carBox,jetBox,move,look],size:height<=360?34:38});
 if(pos){const b={left:pos.x,top:pos.y,right:pos.x+pos.width,bottom:pos.y+pos.height};for(const o of[carBox,jetBox,move,look])assert.ok(!overlap(b,o),'voice overlap');}
}
const walk=readFileSync('sim/player_walk_mode_v4.mjs','utf8');
assert.match(walk,/right:calc\(max\(12px,var\(--solo-safe-right,env\(safe-area-inset-right\)\)\) \+ var\(--jump-stick\) \* \.5 \+ var\(--jump-arc\) \+ 4px\)/,'jump shifted clear of right look stick');
for(const [width,height] of [[844,390],[670,300],[568,320],[780,360]]){
 const stick=Math.min(width*.25,150),arc=(stick/2+40)*.7071,right=12+stick/2+arc+4,bottom=20+stick/2+arc-32;
 const jump={left:width-right-64,right:width-right,top:height-bottom-64,bottom:height-bottom};
 const look={left:width-12-stick,right:width-12,top:height-18-stick,bottom:height-18};
 assert.ok(!overlap(jump,look),`jump clears look stick ${width}x${height}`);
}
console.log('Mobile edge boarding controls, jump clearance and voice avoidance: pass');
