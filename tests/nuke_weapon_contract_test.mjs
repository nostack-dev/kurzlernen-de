import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const nuke=readFileSync("sim/nuke_weapon.mjs","utf8");
const overkill=readFileSync("sim/nuke_overkill_fx.mjs","utf8");
const cleanup=readFileSync("sim/flight_first_cleanup.mjs","utf8");
const mobile=readFileSync("sim/mobile_gameplay_ui.mjs","utf8");
const mobileLive=readFileSync("tests/nuke_mobile_live_smoke.mjs","utf8");

for(const marker of [
  'const BLAST_RADIUS_M=120','const SHOCKWAVE_SPEED_MPS=343','const SHOCKWAVE_MAX_M=520','const MUSHROOM_HEIGHT_M=108','const CINEMATIC_GRACE_MS=4200','const COOLDOWN_MS=4500','"gun","missile","nuke"','displayMode==="gun"?"missile":displayMode==="missile"?"nuke":"gun"','api.fireNuke=fireNuke','api.fireMissile=args=>displayMode==="nuke"?fireNuke(args)','kind:"nuke"','whiteout-fireball-shockwave-mushroom-v3','whiteout+massive-fireball+physical-shockwave+giant-mushroom+delayed-damage-v3','drone-targeted-fixed-impact-v2','released-after-cinematic-v1','mushroom-crown','mushroom-stem-base'
]) assert.ok(nuke.includes(marker),`missing nuke contract marker: ${marker}`);

for(const marker of [
  'screen-dominating-nuclear-v3','grounded-wide-screen-cloud-v3','mushroom-fireball-overlay-v1','nukeCinematicScreenCloud','nukeOverkillFireballM="110"','nukeOverkillShockScreen','depthTest:false','renderOrder=800','shock-ring-1','shock-ring-2','shock-ring-3','hot-column','hot-crown','presentationAnchor(position)','nukeOverkillPhase','nukeScreenCloudOpacity','nukeVisibleRenderer="overkill-only-v1"','nukeCloudShape="irregular-filled-cap-v3"','window.addEventListener("pointerdown",routeNukePointer,{capture:true,passive:false})','nukeLegacyMissileBypass="blocked-v1"'
]) assert.ok(overkill.includes(marker),`missing nuclear overkill marker: ${marker}`);

const mushroomMatch=overkill.match(/nukeOverkillMushroomM="(\d+(?:\.\d+)?)"/);
assert.ok(mushroomMatch,"missing nuclear mushroom height marker");
assert.ok(Number(mushroomMatch[1])>=78,`nuclear mushroom presentation regressed below 78 m: ${mushroomMatch[1]}`);
assert.ok(overkill.includes('node?.userData?.nukeRole!=="impact-root"'),"legacy nuke impact renderer is not explicitly suppressed");

for(const marker of ['page.touchscreen.tap(','legacyMissilesAfter===shot.legacyMissilesBefore','inputRoute==="window-capture-fireNuke-v1"','legacyBypass==="blocked-v1"','cloudShape==="irregular-filled-cap-v3"','const silhouette=']) assert.ok(mobileLive.includes(marker),`real-touch live nuke gate missing: ${marker}`);

assert.ok(cleanup.includes('import "./nuke_weapon.mjs";'),"nuke runtime is not wired into flight-first cleanup");
assert.ok(cleanup.includes('import "./nuke_overkill_fx.mjs";'),"nuclear overkill visual runtime is not wired into flight-first cleanup");
assert.ok(mobile.includes('api?.displayMode||api?.mode'),"mobile HUD does not expose extended drone weapon mode");

console.log("Nuke weapon v9 contract passed: real touch routes only to NUKE, legacy impact is hidden, and the clean mushroom silhouette is required live.");