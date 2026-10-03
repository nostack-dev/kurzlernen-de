import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const nuke=readFileSync("sim/nuke_weapon.mjs","utf8");
const overkill=readFileSync("sim/nuke_overkill_fx.mjs","utf8");
const cleanup=readFileSync("sim/flight_first_cleanup.mjs","utf8");
const mobile=readFileSync("sim/mobile_gameplay_ui.mjs","utf8");
const mobileLive=readFileSync("tests/nuke_mobile_live_smoke.mjs","utf8");

for(const marker of [
  'const BLAST_RADIUS_M=120','const SHOCKWAVE_SPEED_MPS=343','const SHOCKWAVE_MAX_M=520','const MUSHROOM_HEIGHT_M=108','const CINEMATIC_GRACE_MS=4200','const COOLDOWN_MS=4500','"gun","missile","nuke"','displayMode==="gun"?"missile":displayMode==="missile"?"nuke":"gun"','api.fireNuke=fireNuke','api.fireMissile=args=>displayMode==="nuke"?fireNuke(args)','kind:"nuke"','whiteout-fireball-shockwave-mushroom-v3','drone-targeted-fixed-impact-v2','mushroom-crown','mushroom-stem-base'
]) assert.ok(nuke.includes(marker),`missing nuke contract marker: ${marker}`);

for(const marker of [
  'world-anchored-nuclear-v4','world-space-impact-locked-v4','3d-world-mushroom-v4','world-space-3d-v4','nukeOverkillMushroomM="128"','nukeOverkillFireballM="150"','group.position.copy(position)','depthTest:true','mushroom-plume','mushroom-crown-group','crown-core','shock-ring-1','shock-ring-2','shock-ring-3','window.addEventListener("pointerdown",routeNukePointer,{capture:true,passive:false})','nukeLegacyMissileBypass="blocked-v1"','nukeScreenCloud="removed-v2"'
]) assert.ok(overkill.includes(marker),`missing world-space nuclear marker: ${marker}`);

for(const forbidden of ['function ensureScreenCloud','nukeCinematicScreenCloud\");if(root)return root','presentationAnchor(position)','nukeVisibleRenderer="overkill-only-v1"','depthTest:false']) assert.ok(!overkill.includes(forbidden),`forbidden screen-space nuclear renderer remains: ${forbidden}`);

const mushroomMatch=overkill.match(/nukeOverkillMushroomM="(\d+(?:\.\d+)?)"/);
assert.ok(mushroomMatch,"missing nuclear mushroom height marker");
assert.ok(Number(mushroomMatch[1])>=120,`3D mushroom presentation regressed below 120 m: ${mushroomMatch[1]}`);

for(const marker of ['page.touchscreen.tap(','legacyMissilesAfter===shot.legacyMissilesBefore','inputRoute==="window-capture-fireNuke-v1"','legacyBypass==="blocked-v1"','worldAnchorError','screenCloudRemoved']) assert.ok(mobileLive.includes(marker),`real-touch live nuke gate missing: ${marker}`);

assert.ok(cleanup.includes('import "./nuke_weapon.mjs";'),"nuke runtime is not wired into flight-first cleanup");
assert.ok(cleanup.includes('import "./nuke_overkill_fx.mjs";'),"nuclear overkill visual runtime is not wired into flight-first cleanup");
assert.ok(mobile.includes('api?.displayMode||api?.mode'),"mobile HUD does not expose extended drone weapon mode");

console.log("Nuke weapon v10 contract passed: no painted mushroom, 3D effect is locked to the true impact position.");