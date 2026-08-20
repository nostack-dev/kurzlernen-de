import assert from "node:assert/strict";
import {renderPlatformProfile,quantizedViewportSize,viewportSizeChanged} from "../sim/render_stability.mjs";

const honor=renderPlatformProfile({userAgent:"Mozilla/5.0 (Linux; Android 15; HONOR Magic7 Pro) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36",devicePixelRatio:3});
assert.equal(honor.android,true);assert.equal(honor.honor,true);assert.equal(honor.stableBackbuffer,true);assert.equal(honor.pixelRatioCeiling,.9);assert.equal(honor.canvasDesynchronized,false);
const android=renderPlatformProfile({userAgent:"Mozilla/5.0 (Linux; Android 14; Pixel 8)",devicePixelRatio:2.75});assert.equal(android.stableBackbuffer,true);assert.equal(android.pixelRatioCeiling,.9);
const ios=renderPlatformProfile({userAgent:"Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",devicePixelRatio:3});assert.equal(ios.android,false);assert.equal(ios.appleMobile,true);assert.equal(ios.stableBackbuffer,false);assert.equal(ios.pixelRatioCeiling,1);
const ipad=renderPlatformProfile({userAgent:"Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",devicePixelRatio:2});assert.equal(ipad.appleMobile,true);assert.equal(ipad.pixelRatioCeiling,1);
const desktop=renderPlatformProfile({userAgent:"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15",devicePixelRatio:2});assert.equal(desktop.appleMobile,false);assert.equal(desktop.pixelRatioCeiling,1.25);
const software=renderPlatformProfile({userAgent:"Mozilla/5.0 (X11; Linux x86_64)",devicePixelRatio:2,rendererName:"ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))"});assert.equal(software.software,true);assert.equal(software.pixelRatioCeiling,.3);
const first=quantizedViewportSize(843.4,389.1),same=quantizedViewportSize(843.49,389.4),changed=quantizedViewportSize(846,390);assert.deepEqual(first,{width:844,height:390});assert.deepEqual(same,first);assert.equal(viewportSizeChanged(null,first),true);assert.equal(viewportSizeChanged(first,same),false);assert.equal(viewportSizeChanged(first,changed),true);
console.log("Render stability contract passed: Android/Honor caps the fixed backbuffer at 0.9 DPR, iPhone/iPad at 1.0 DPR, desktop retains 1.25, and viewport sizing stays even-pixel/idempotent.");
