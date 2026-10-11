import assert from 'node:assert/strict';
import { NavMarkerTimeline } from '../sim/nav_marker_timeline.mjs';

const near = (actual, expected, epsilon=1e-6) => assert.ok(Math.abs(actual-expected)<epsilon,`${actual} != ${expected}`);
const deg = n => n*Math.PI/180;
const nav = (x, mode='car', headingRad=0) => ({ mode, p:[x, 5, 0], headingRad });

// Ordinary 120ms network gap: visible marker smoothly interpolates at 90ms delay.
const line = new NavMarkerTimeline();
assert.equal(line.push(nav(0),1000),true);
assert.equal(line.push(nav(12),1120),true);
near(line.sample(1150).p[0],6); // 1150 - 90 = 1060, midway
near(line.sample(1200).p[0],11);
near(line.sample(1300).p[0],12); // bounded hold, not unconstrained prediction
assert.equal(line.push(nav(999),1110),false); // reject older arrival

// Heading crosses +180/-180 by the short turn, not a full spin.
const angles = new NavMarkerTimeline();
angles.push(nav(0,'jet',deg(170)),1000);
angles.push(nav(6,'jet',deg(-170)),1120);
near(Math.abs(angles.sample(1150).headingRad),Math.PI,1e-5);

// Do not visually fly along a 100m teleport or connect different vehicles.
const tele = new NavMarkerTimeline();
tele.push(nav(0),1000); tele.push(nav(100),1100);
assert.equal(tele.snapshots.length,1);
near(tele.sample(1150).p[0],100);
tele.push(nav(101,'jet'),1200);
assert.equal(tele.snapshots.length,1);
assert.equal(tele.sample(1300).mode,'jet');

// Invalid packets are rejected, bounded history and caller-safe sample copies.
const bad = new NavMarkerTimeline({maxSnapshots:3});
assert.equal(bad.push({mode:'jet',p:[NaN,0,0],headingRad:0},1000),false);
assert.equal(bad.push(nav(0,'foot'),1000),false);
assert.equal(bad.sample(1000),null);
for (let i=0;i<10;i++) bad.push(nav(i),1000+i*20);
assert.equal(bad.snapshots.length,3);
const sampled=bad.sample(1190);sampled.p[0]=-500;
assert.notEqual(bad.snapshots.at(-1).p[0],-500);
console.log('Multiplayer car/jet minimap interpolation: pass');
