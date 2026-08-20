import assert from "node:assert/strict";
import {VsPoseTimeline,chooseCanonicalVsOrigin,normalizeVsOrigin,poseMatchesVsFrame,vsFrameId,vsOriginKey,VS_POSE_INTERPOLATION_DELAY_MS,VS_POSE_MAX_EXTRAPOLATION_MS,VS_POSE_STALE_HOLD_MS} from "../sim/vs_pose_sync.mjs";

const west={lon:9.1700001,lat:47.6600001,alt:0},east={lon:9.1700049,lat:47.6599980,alt:0};
assert.equal(vsOriginKey(chooseCanonicalVsOrigin(west,east)),vsOriginKey(chooseCanonicalVsOrigin(east,west)),"canonical WORLD origin must not depend on message order");
assert.equal(vsOriginKey(chooseCanonicalVsOrigin(west,east)),vsOriginKey(west));assert.deepEqual(normalizeVsOrigin({lon:181,lat:0}),null);
const roundedA={lon:9.170000141,lat:47.660000141,alt:.01},roundedB={lon:9.170000149,lat:47.660000149,alt:.04};assert.deepEqual(chooseCanonicalVsOrigin(roundedA,roundedB),chooseCanonicalVsOrigin(roundedB,roundedA),"sub-centimetre GPS differences must collapse to the same exact frame on both phones");
assert.equal(vsFrameId(west),vsOriginKey(west));assert.equal(vsFrameId(null),"local-metric");assert.equal(poseMatchesVsFrame({f:vsOriginKey(west)},west),true);assert.equal(poseMatchesVsFrame({f:vsOriginKey(east)},west),false,"a pose from an obsolete WORLD frame must be rejected");assert.equal(poseMatchesVsFrame({},west),true,"legacy frame-less packets remain compatible");
assert.equal(VS_POSE_INTERPOLATION_DELAY_MS,90);assert.equal(VS_POSE_MAX_EXTRAPOLATION_MS,100);assert.equal(VS_POSE_STALE_HOLD_MS,3000);

const timeline=new VsPoseTimeline();
assert.equal(timeline.push({p:[0,0,1],q:[0,0,0,1],v:[10,0,0],t:1000},0),true);
assert.equal(timeline.push({p:[1,0,1],q:[0,0,Math.sin(Math.PI/8),Math.cos(Math.PI/8)],v:[10,0,0],t:1100},100),true);
assert.equal(timeline.push({p:[1.8,0,1],q:[0,0,Math.sin(Math.PI/5),Math.cos(Math.PI/5)],v:[10,0,0],t:1180},180),true);
assert.equal(timeline.push({p:[99,0,1],q:[0,0,0,1],t:1180},181),false,"remote source time must remain monotonic");
const interpolated=timeline.sample(250);assert.equal(interpolated.mode,"interpolate-source-clock");assert.ok(Math.abs(interpolated.p[0]-1.6)<1e-9,`source-clock jitter-buffer position drifted: ${JSON.stringify(interpolated)}`);assert.ok(Math.abs(Math.hypot(...interpolated.q)-1)<1e-9);
const extrapolated=timeline.sample(330);assert.equal(extrapolated.mode,"extrapolate");assert.ok(Math.abs(extrapolated.p[0]-2.4)<1e-9,`bounded extrapolation drifted: ${JSON.stringify(extrapolated)}`);
const capped=timeline.sample(500);assert.equal(capped.mode,"extrapolate");assert.ok(Math.abs(capped.p[0]-2.8)<1e-9,"extrapolation must be capped at 100 ms");
assert.equal(timeline.sample(4000).stale,true);timeline.reset();assert.equal(timeline.sample(4000),null);

const jittered=new VsPoseTimeline();
for(const [source,received] of [[2000,1000],[2033,1068],[2066,1080],[2099,1130]]){const x=(source-2000)*.01;assert.equal(jittered.push({p:[x,0,1],q:[0,0,0,1],v:[10,0,0],t:source},received),true);}
const smooth=jittered.sample(1160);assert.equal(smooth.mode,"interpolate-source-clock");assert.ok(Math.abs(smooth.p[0]-.70)<.015,`arrival jitter leaked into rendered peer pose: ${JSON.stringify(smooth)}`);assert.ok(Math.abs(smooth.clockOffsetMs+1000)<1e-9,"clock offset must use the low-latency envelope instead of packet arrival time");
console.log("VS pose sync contract passed: order-independent canonical WORLD frame, 90 ms jitter-buffer interpolation with velocity compensation, 100 ms bounded extrapolation, normalized attitude, explicit stale hold, and source-clock arrival-jitter rejection.");
