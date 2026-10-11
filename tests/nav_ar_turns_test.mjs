import assert from 'node:assert/strict';
import {findUpcomingNavTurn} from '../sim/nav_ar_route_math.mjs';
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1,`${actual} != ${expected}`);
let t=findUpcomingNavTurn([[0,0],[0,100],[90,100]],[0,60],{scanM:100,windowM:12});
assert.equal(t.direction,'right');near(t.distanceM,40);assert.ok(t.angleDeg>70);
t=findUpcomingNavTurn([[0,0],[0,100],[-90,100]],[0,60],{scanM:100,windowM:12});
assert.equal(t.direction,'left');near(t.distanceM,40);
assert.equal(findUpcomingNavTurn([[0,0],[0,100],[90,100]],[0,0],{scanM:70}),null,'far turns are not announced');
assert.equal(findUpcomingNavTurn([[0,0],[0,50],[1,100],[1,150]],[0,20],{scanM:140}),null,'minor road wiggles are not turns');
// A bend drawn as many small polyline segments is still a single useful turn.
t=findUpcomingNavTurn([[0,0],[0,40],[1,45],[4,49],[9,51],[17,52],[40,52]],[0,15],{scanM:80,windowM:12});
assert.equal(t.direction,'right');assert.ok(t.distanceM>15&&t.distanceM<60);
assert.equal(findUpcomingNavTurn([[0,0],[0,0]], [0,0]),null);
assert.equal(findUpcomingNavTurn([[0,0],[0,100]], [0,0]),null);
console.log('AR upcoming road turns: pass');
