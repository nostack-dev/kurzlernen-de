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
  "sim/training_test_level_v2.mjs",
  "sim/real_world_bootstrap.mjs",
  "sim/world_procedural_population.mjs",
  "sim/spawn_visibility_guard.mjs",
  "sim/direct_fire_missiles.mjs",
  "sim/player_box3d_capsule_runtime.mjs",
  "sim/first_person_weapon_runtime_v3.mjs",
  "sim/vs_fx_geo_adapter.mjs",
  "sim/vs_multiplayer_guard.mjs",
  "sim/first_person_fire_contract_v1.mjs",
  "sim/speed_lines.mjs",
  "sim/wanted_police_pre_guard.mjs",
  "sim/wanted_police_drones.mjs",
  "sim/world_city_buildings.mjs"
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

const cleanup=files["sim/flight_first_cleanup.mjs"],publishStart=cleanup.indexOf("function publish()"),publishEnd=cleanup.indexOf("export ",publishStart);
const cleanupDiagnostics=cleanup.slice(publishStart,publishEnd>publishStart?publishEnd:cleanup.length);
assert.ok(publishStart>=0&&!cleanupDiagnostics.includes("requestAnimationFrame(")&&!cleanupDiagnostics.includes("function frame(){publish()"),"static cleanup diagnostics must not own an RAF loop; the pointer-owned look/fire input loop may remain frame-driven");

const gameplay=files["sim/gameplay_final_runtime_v2.mjs"];
assert.ok(gameplay.includes("lastHousekeeping=-Infinity")&&gameplay.includes("now-lastHousekeeping>=250"),"weapon hierarchy housekeeping must be throttled");
assert.ok(gameplay.includes("cachedWeaponGun")&&gameplay.includes("cachedMuzzleFlash"),"weapon scene lookups must be cached");

const wanted=files["sim/wanted_police_drones.mjs"];
assert.ok(wanted.includes("now-lastHudRender<100")&&wanted.includes("hudStars=[...hud.querySelectorAll"),"wanted HUD DOM updates must be throttled and cached");
assert.equal((wanted.match(/let empButton=/g)||[]).length,0,"EMP binding must live in the consolidated HUD declaration only");

assert.ok(files["sim/player_walk_mode_v4.mjs"].includes("now-lastWalkHousekeeping>=200"),"walk DOM mounting must be off the render hot path");
const car=files["sim/player_car_mode.mjs"];
assert.ok(car.includes("now-lastCarUi>=100"),"car UI updates must be decoupled from physics frames");
assert.ok(car.includes('id="vehicleMove" class="vehicle-stick"')&&car.includes('id="vehicleLook" class="vehicle-stick"'),"vehicle mode must expose the same MOVE/LOOK dual-stick layout");
assert.ok(car.includes("touchSteer=p.x;touchPedal=-p.y")&&car.includes("touchLookX=p.x;touchLookY=-p.y"),"both axes of both vehicle sticks must remain live");
assert.ok(!car.includes("vehicle-pad")&&!car.includes('class="foot-stick vehicle-stick"'),"vehicle sticks must not reintroduce one-axis pads or pollute the on-foot stick set");
assert.ok(files["sim/player_vehicle_runtime_v2.mjs"].includes("now-lastIntegrationPatch>=250"),"multiplayer integration patch checks must be throttled");

assert.ok(files["sim/training_test_level_v2.mjs"].includes("setTimeout(sync,250)")&&!files["sim/training_test_level_v2.mjs"].includes("requestAnimationFrame(frame)"),"static training-level visibility must not run at frame rate");
const world=files["sim/real_world_bootstrap.mjs"];
assert.ok(world.includes("trainingObjectClassified=new WeakSet()")&&world.includes("frameHiddenObjects=[]"),"training-world visibility must classify scene roots once and reuse scratch storage");
assert.ok(!world.includes("this.frameVisibility=new Map()"),"real-world render path must not allocate/clear a visibility Map every frame");

const population=files["sim/world_procedural_population.mjs"],spawnGuard=files["sim/spawn_visibility_guard.mjs"];
assert.ok(population.includes("spawnVisibilityRoots=[]")&&population.includes("__arondightProceduralPopulation"),"population must expose its existing roots instead of forcing scene rescans");
assert.ok(spawnGuard.includes("__arondightProceduralPopulation?.spawnVisibilityRoots"),"spawn guard must consume the population root registry");
assert.ok(spawnGuard.includes("lastPublish")&&spawnGuard.includes("lastPublish<250"),"spawn guard diagnostics must be throttled");

const missiles=files["sim/direct_fire_missiles.mjs"];
assert.ok(missiles.includes("nearestPhysicalHit")&&missiles.includes("__arondightWorldRigidBodies?.raycast"),"in-flight missiles must use Box3D instead of full Three.js mesh scans");
assert.ok(missiles.includes("missileBodyGeometry=new THREE.CylinderGeometry")&&missiles.includes("missileBodyMaterial=new THREE.MeshStandardMaterial"),"missile geometry/material must be shared instead of recreated per shot");

const capsule=files["sim/player_box3d_capsule_runtime.mjs"];
assert.ok(capsule.includes("setTimeout(maintenance,250)")&&!capsule.includes("requestAnimationFrame(frame)"),"capsule integration polling must stay off RAF");
assert.ok(capsule.includes("now-lastTelemetryAt>=250"),"capsule collision telemetry must not mutate DOM on each movement sample");

const weapon=files["sim/first_person_weapon_runtime_v3.mjs"];
assert.ok(weapon.includes("if(mode!==lastMode)")&&!weapon.includes("now-lastVisualSync>1000"),"unchanged weapon materials must not be re-patched every second");
assert.ok(weapon.includes("mode!==lastButtonMode"),"weapon button DOM must update only when the mode changes");

for(const p of ["sim/vs_fx_geo_adapter.mjs","sim/vs_multiplayer_guard.mjs","sim/first_person_fire_contract_v1.mjs"]){
  assert.ok(files[p].includes("setTimeout(maintenance,250)")&&!files[p].includes("requestAnimationFrame(frame)"),`${p} static integration polling must not consume render frames`);
}
const speed=files["sim/speed_lines.mjs"];
assert.ok(speed.includes("lastX=NaN")&&!speed.includes("lastPos={x:p.x"),"speed lines must not allocate a position object every frame");

const preGuard=files["sim/wanted_police_pre_guard.mjs"],police=files["sim/wanted_police_drones.mjs"];
assert.ok(!preGuard.includes("wantedLineBlockedByPrisms"),"police pre-guard must not scan all building prisms every render frame");
assert.ok(!preGuard.includes("requestAnimationFrame(frame)")&&preGuard.includes("setTimeout(()=>frame(performance.now()),50)"),"police safety pre-guard must run outside RAF");
assert.ok(police.includes("if(!lineOfSight(drone.root.position,target.position))"),"police must keep fresh line-of-sight validation at the actual shot boundary");
assert.ok(police.includes("BUILDING_GRID_CELL_M=32")&&police.includes("linePrisms(from,to)"),"police roof/LOS queries must use an exact building spatial index");

const city=files["sim/world_city_buildings.mjs"];
assert.ok(city.includes("now-lastSyncCheck<200"),"city rebuild discovery must not poll map/player state every render frame");

console.log("Drone runtime performance contract passed: graphics stay frame-driven while scans, DOM and integration housekeeping are throttled.");
