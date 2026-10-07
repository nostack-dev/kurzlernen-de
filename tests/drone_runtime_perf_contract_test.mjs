import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const files=Object.fromEntries(await Promise.all([
  "sim/stylized_world_style.mjs",
  "sim/mobile_gameplay_ui.mjs",
  "sim/flight_first_cleanup.mjs",
  "sim/gameplay_final_runtime_v2.mjs",
  "sim/wanted_police_drones.mjs",
  "sim/player_walk_mode_v4.mjs",
  "sim/player_car_mode.mjs",
  "sim/player_vehicle_runtime_v2.mjs",
  "sim/training_test_level_v2.mjs"
].map(async path=>[path,await readFile(path,"utf8")])));

const style=files["sim/stylized_world_style.mjs"];
assert.ok(style.includes("function scanScene(scene)")&&style.includes("actorRoots=nextActors"),"style scan must cache actor roots");
const cull=style.slice(style.indexOf("function cullActors"),style.indexOf("let blastAt"));
assert.ok(!cull.includes("scene.traverse"),"actor culling must not traverse the full scene");
assert.ok(style.includes("sunForward=new THREE.Vector3()")&&!style.includes("const fwd=new THREE.Vector3();"),"sun follow must not allocate a vector every frame");
assert.ok(style.includes("SCAN_INTERVAL_MS=MOBILE?900:650"),"full style scans must be throttled");

const mobile=files["sim/mobile_gameplay_ui.mjs"];
assert.ok(mobile.includes("const UI_SYNC_MS=100")&&mobile.includes("setTimeout(sync,UI_SYNC_MS)"),"mobile HUD must use low-frequency state sync");
assert.ok(!mobile.includes("requestAnimationFrame(sync)"),"mobile HUD must not own a frame-rate DOM loop");

const cleanup=files["sim/flight_first_cleanup.mjs"];
assert.ok(!cleanup.includes("requestAnimationFrame(frame)")&&!cleanup.includes("function frame(){publish()"),"static cleanup diagnostics must not own an RAF loop");

const gameplay=files["sim/gameplay_final_runtime_v2.mjs"];
assert.ok(gameplay.includes("lastHousekeeping=-Infinity")&&gameplay.includes("now-lastHousekeeping>=250"),"weapon hierarchy housekeeping must be throttled");
assert.ok(gameplay.includes("cachedWeaponGun")&&gameplay.includes("cachedMuzzleFlash"),"weapon scene lookups must be cached");

const wanted=files["sim/wanted_police_drones.mjs"];
assert.ok(wanted.includes("now-lastHudRender<100")&&wanted.includes("hudStars=[...hud.querySelectorAll"),"wanted HUD DOM updates must be throttled and cached");
assert.equal((wanted.match(/let empButton=/g)||[]).length,0,"EMP binding must live in the consolidated HUD declaration only");

assert.ok(files["sim/player_walk_mode_v4.mjs"].includes("now-lastWalkHousekeeping>=200"),"walk DOM mounting must be off the render hot path");
assert.ok(files["sim/player_car_mode.mjs"].includes("now-lastCarUi>=100"),"car UI updates must be decoupled from physics frames");
assert.ok(files["sim/player_vehicle_runtime_v2.mjs"].includes("now-lastIntegrationPatch>=250"),"multiplayer integration patch checks must be throttled");
assert.ok(files["sim/training_test_level_v2.mjs"].includes("setTimeout(sync,250)")&&!files["sim/training_test_level_v2.mjs"].includes("requestAnimationFrame(frame)"),"static training-level visibility must not run at frame rate");

console.log("Drone runtime performance contract passed: graphics stay frame-driven while scans, DOM and integration housekeeping are throttled.");
