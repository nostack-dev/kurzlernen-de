import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const nuke=readFileSync("sim/nuke_weapon.mjs","utf8");
const overkill=readFileSync("sim/nuke_overkill_fx.mjs","utf8");
const volumetric=readFileSync("sim/nuke_volumetric_cloud_v2.mjs","utf8");
const cleanup=readFileSync("sim/flight_first_cleanup.mjs","utf8");
const mobile=readFileSync("sim/mobile_gameplay_ui.mjs","utf8");
const mobileLive=readFileSync("tests/nuke_mobile_live_smoke.mjs","utf8");
const shared=readFileSync("sim/nuke_fx_shared.mjs","utf8");
const audio=readFileSync("sim/nuke_audio.mjs","utf8");
const vehicleAudio=readFileSync("sim/player_vehicle_runtime_v2.mjs","utf8");

for(const marker of [
  'const GROUND_BURST_Z=0','groundBurstPoint(hit.point)','nukeTargetResolver="ground-burst-xy-v1"','const BLAST_RADIUS_M=360','export const NUKE_SCALE=3','const SHOCKWAVE_SPEED_MPS=343','const SHOCKWAVE_MAX_M=1560','const MUSHROOM_HEIGHT_M=324','const CINEMATIC_GRACE_MS=4200','const COOLDOWN_MS=4500','"gun","missile","nuke"','displayMode==="gun"?"missile":displayMode==="missile"?"nuke":"gun"','api.fireNuke=fireNuke','api.fireMissile=args=>displayMode==="nuke"?fireNuke(args)','kind:"nuke"','whiteout-fireball-shockwave-mushroom-v4','drone-targeted-fixed-impact-v2','shockwave-arrival-v4-map-locked','arondight:nuke-launch','arondight:nuke-shockwave-arrival','cameraDistanceM:cameraDistanceTo(position)'
]) assert.ok(nuke.includes(marker),`missing nuke contract marker: ${marker}`);

for(const marker of [
  'world-anchored-nuclear-v5','world-space-impact-locked-v4','world-space-3d-v5','nukeOverkillFireballM="450"','group.position.copy(position)','depthTest:false','CINEMATIC_RENDER_ORDER=820','nukeVisibilityPolicy="cinematic-depth-priority-v1"','shock-ring-1','shock-ring-2','shock-ring-3','white-core','window.addEventListener("pointerdown",routeNukePointer,{capture:true,passive:false})','nukeLegacyMissileBypass="blocked-v1"','nukeScreenCloud="removed-v2"'
]) assert.ok(overkill.includes(marker),`missing world-space fireball marker: ${marker}`);
assert.ok(!/mushroom-plume|crown-core|makeSmokePuff/.test(overkill),"overkill layer draws a second mushroom on top of the volumetric one (double overdraw)");

for(const marker of ['CINEMATIC_RENDER_ORDER=840','nukeVolumetricVisibility="depth-tested-v4"','sculpted-mushroom-v3','LatheGeometry(STEM_PROFILE','TorusGeometry(CAP.R,CAP.r','crown-collar','base-surge','hot-crown-visible-core','hot-plume-visible-','crown-visible-core','crown-volumetric-core','nukeVolumetricScreenSpace="none"','stemRings','capFlows']) assert.ok(volumetric.includes(marker),`missing classic mushroom marker: ${marker}`);
assert.ok(!/SphereGeometry\(r,|puff\(group/.test(volumetric),"mushroom must be sculpted (stem/vortex ring/dome), not a pile of puff spheres");
assert.ok(!volumetric.includes("wireframe"),"mushroom cloud must be solid, not line art");
// Neon look: flat fills + lines only. No soft gradients that read as textures.
for(const [name,source] of [["nuke_weapon",nuke],["nuke_overkill_fx",overkill],["nuke_volumetric_cloud_v2",volumetric]]){
  assert.ok(!source.includes("radial-gradient"),`${name} still paints a gradient overlay`);
  assert.ok(!source.includes("heatColors("),`${name} still bakes gradient heat colours`);
}

for(const forbidden of ['function ensureScreenCloud','nukeCinematicScreenCloud\");if(root)return root','presentationAnchor(position)']) assert.ok(!overkill.includes(forbidden),`forbidden nuclear renderer remains: ${forbidden}`);

for(const marker of ['page.touchscreen.tap(','legacyMissilesAfter===shot.legacyMissilesBefore','inputRoute==="window-capture-fireNuke-v1"','legacyBypass==="blocked-v1"','targetResolver==="ground-burst-xy-v1"','Math.abs(shot.targetXYZ[2])<.05','worldAnchorError','screenCloudRemoved','depthPriorityOverkill','depth-tested-v4','visibleHotCrown','volumetricHeat']) assert.ok(mobileLive.includes(marker),`real-touch live nuke gate missing: ${marker}`);

assert.ok(cleanup.includes('import "./nuke_weapon.mjs";'),"nuke runtime is not wired into flight-first cleanup");
assert.ok(cleanup.includes('import "./nuke_overkill_fx.mjs";'),"nuclear overkill visual runtime is not wired into flight-first cleanup");
assert.ok(mobile.includes('api?.displayMode||api?.mode'),"mobile HUD does not expose extended drone weapon mode");

// Performance contract: the detonation frame must not add scene lights (forces a
// scene-wide shader recompile), must not allocate fresh sphere geometry per
// part, and must not animate CSS filters on fullscreen layers.
for(const [name,source] of [["nuke_weapon",nuke],["nuke_overkill_fx",overkill],["nuke_volumetric_cloud_v2",volumetric]]){
  assert.ok(!/new THREE\.PointLight|new THREE\.SpotLight/.test(source),`${name} adds a runtime light on detonation`);
  assert.ok(!source.includes("new THREE.SphereGeometry")||source.includes("userData.nukeSharedGeometry=true"),`${name} allocates geometry per impact instead of a shared cache`);
  assert.ok(!/filter:\s*[`"]?(?:blur|brightness)\(/.test(source)&&!source.includes('filter:`brightness'),`${name} animates a CSS filter on a fullscreen layer`);
  assert.ok(source.includes("disposeEffect("),`${name} leaks per-impact materials`);
  assert.ok(source.includes("from \"./nuke_fx_shared.mjs\""),`${name} bypasses shared nuke resources`);
}
assert.ok(!nuke.includes("mix-blend-mode"),"nuke flash still forces a blend-mode composite over the WebGL canvas");
assert.ok(nuke.includes('getElementById("geoViewport")'),"camera shake no longer moves the map together with the 3D layer");
for(const marker of ["userData.nukeSharedGeometry","warmNukePrograms","toneMapped:false","MeshLambertMaterial"]) assert.ok(shared.includes(marker),`shared nuke resources missing: ${marker}`);
for(const marker of ["arondight:nuke-launch","arondight:nuke-impact","arondight:nuke-shockwave-arrival","fxVolume","requestIdleCallback","SPEED_OF_SOUND_MPS=343"]) assert.ok(audio.includes(marker),`nuke audio missing: ${marker}`);
assert.ok(cleanup.includes('import "./nuke_audio.mjs";'),"nuke audio is not wired into flight-first cleanup");
assert.ok(vehicleAudio.includes('event?.detail?.kind==="nuke")return'),"generic car-explosion sample still plays late over the nuke blast");

console.log("Nuke weapon v15 contract passed: ground burst, depth priority, solid lit mushroom, shock-synced audio, no detonation-frame lights or allocations.");