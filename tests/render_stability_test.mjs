import assert from "node:assert/strict";
import {renderPlatformProfile,quantizedViewportSize,viewportSizeChanged} from "../sim/render_stability.mjs";
import {distanceToFoci,retentionDecision} from "../sim/world_streaming_policy.mjs";

const honor=renderPlatformProfile({userAgent:"Mozilla/5.0 (Linux; Android 15; HONOR Magic7 Pro) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36",devicePixelRatio:3});
assert.equal(honor.android,true);assert.equal(honor.honor,true);assert.equal(honor.stableBackbuffer,true);assert.equal(honor.pixelRatioCeiling,.9);assert.equal(honor.canvasDesynchronized,false);
const android=renderPlatformProfile({userAgent:"Mozilla/5.0 (Linux; Android 14; Pixel 8)",devicePixelRatio:2.75});assert.equal(android.stableBackbuffer,true);assert.equal(android.pixelRatioCeiling,.9);
const ios=renderPlatformProfile({userAgent:"Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",devicePixelRatio:3});assert.equal(ios.android,false);assert.equal(ios.appleMobile,true);assert.equal(ios.stableBackbuffer,false);assert.equal(ios.pixelRatioCeiling,1);
const ipad=renderPlatformProfile({userAgent:"Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",devicePixelRatio:2});assert.equal(ipad.appleMobile,true);assert.equal(ipad.pixelRatioCeiling,1);
const desktop=renderPlatformProfile({userAgent:"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15",devicePixelRatio:2});assert.equal(desktop.appleMobile,false);assert.equal(desktop.pixelRatioCeiling,1.25);
const software=renderPlatformProfile({userAgent:"Mozilla/5.0 (X11; Linux x86_64)",devicePixelRatio:2,rendererName:"ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))"});assert.equal(software.software,true);assert.equal(software.pixelRatioCeiling,.3);
const first=quantizedViewportSize(843.4,389.1),same=quantizedViewportSize(843.49,389.4),changed=quantizedViewportSize(846,390);assert.deepEqual(first,{width:844,height:390});assert.deepEqual(same,first);assert.equal(viewportSizeChanged(null,first),true);assert.equal(viewportSizeChanged(first,same),false);assert.equal(viewportSizeChanged(first,changed),true);

assert.equal(distanceToFoci(10,10,[{x:13,y:14},{x:100,y:100}]),5);
let stream=retentionDecision({distanceM:40,nowMs:20000,outsideSinceMs:1000,retentionRadiusM:190,recycleRadiusM:275,recycleGraceMs:9000});
assert.equal(stream.recycle,false);assert.equal(stream.outsideSinceMs,0);assert.equal(stream.reason,"retention");
stream=retentionDecision({distanceM:300,nowMs:5000,outsideSinceMs:1000,retentionRadiusM:190,recycleRadiusM:275,recycleGraceMs:9000});
assert.equal(stream.recycle,false);assert.equal(stream.reason,"grace");
stream=retentionDecision({distanceM:300,nowMs:12000,outsideSinceMs:1000,lastProtectedAtMs:11500,retentionRadiusM:190,recycleRadiusM:275,recycleGraceMs:9000,viewGraceMs:4000});
assert.equal(stream.recycle,false);assert.equal(stream.reason,"view-grace");
stream=retentionDecision({distanceM:300,nowMs:17000,outsideSinceMs:1000,lastProtectedAtMs:11500,retentionRadiusM:190,recycleRadiusM:275,recycleGraceMs:9000,viewGraceMs:4000});
assert.equal(stream.recycle,true);assert.equal(stream.reason,"retire");

console.log("Render stability + world streaming contract passed: platform backbuffers remain bounded, nearby/briefly occluded world entities persist, and only distant stale entities become recyclable.");
