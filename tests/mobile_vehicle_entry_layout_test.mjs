import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {voiceHudPosition} from '../sim/voice_hud_layout.mjs';
const jet=readFileSync('sim/jet_mode.mjs','utf8'),car=readFileSync('sim/player_car_mode.mjs','utf8'),voice=readFileSync('sim/proximity_voice.mjs','utf8');
const query='body.mobile-gameplay-compact.solo-flight:not(.desktop-input) #viewport';
assert.ok(jet.includes(query+' #enterJetButton'));
assert.ok(car.includes(query+' #enterCarButton'));
assert.match(jet,/border-radius:50%!important/,'jet is a circle on mobile');
assert.match(car,/border-radius:50%!important/,'car is a circle on mobile');
const thumb=readFileSync('sim/thumb_layout.mjs','utf8');
assert.match(thumb,/slot=id==="enterJetButton"\?1:0/,'simultaneous car/jet slots must differ');
assert.match(voice,/'enterCarButton','enterJetButton'/);
const overlap=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
for(const [width,height] of [[844,390],[844,300],[670,300],[568,320],[780,360]]){
 const stick=Math.min(width*.25,150),bot=18,move={left:12,right:12+stick,top:height-bot-stick,bottom:height-bot},look={left:width-12-stick,right:width-12,top:height-bot-stick,bottom:height-bot};
 // Both car and jet can appear simultaneously. Each gets a 54px round
 // slot immediately above the right stick; neither uses the aiming center.
 const size=54,top=look.top-size-10;
 const carBox={left:look.right-12-size,right:look.right-12,top,bottom:top+size};
 const jetBox={left:carBox.left-size-8,right:carBox.left-8,top,bottom:top+size};
 assert.ok(carBox.left>width*.70&&jetBox.left>width*.70,`edge positions ${width}x${height}`);
 assert.ok(!overlap(carBox,move),'car vs left stick');
 assert.ok(!overlap(carBox,look),'car vs right stick');
 assert.ok(!overlap(jetBox,look),'jet vs right stick');
 assert.ok(!overlap(carBox,jetBox),'car vs jet');
 const reset={left:width-84,right:width-8,top:8,bottom:44};assert.ok(!overlap(carBox,reset)&&!overlap(jetBox,reset),'boarding vs reset');
 const pos=voiceHudPosition({width,height,move,look,blocked:[carBox,jetBox,move,look],size:height<=360?34:38});
 if(pos){const b={left:pos.x,top:pos.y,right:pos.x+pos.width,bottom:pos.y+pos.height};for(const o of[carBox,jetBox,move,look])assert.ok(!overlap(b,o),'voice overlap');}
}
const walk=readFileSync('sim/player_walk_mode_v4.mjs','utf8');
assert.match(walk,/right:calc\(max\(12px,var\(--solo-safe-right,env\(safe-area-inset-right\)\)\) \+ var\(--jump-stick\) \* \.5 \+ var\(--jump-arc\) \+ 4px\)/,'jump shifted clear of right look stick');
for(const [width,height] of [[844,390],[844,300],[670,300],[568,320],[780,360]]){
 const stick=Math.min(width*.25,150),arc=(stick/2+40)*.7071,right=12+stick/2+arc+4,bottom=20+stick/2+arc-32;
 const jump={left:width-right-64,right:width-right,top:height-bottom-64,bottom:height-bottom};
 const look={left:width-12-stick,right:width-12,top:height-18-stick,bottom:height-18};
 assert.ok(!overlap(jump,look),`jump clears look stick ${width}x${height}`);
}
console.log('Mobile edge boarding controls, jump clearance and voice avoidance: pass');
