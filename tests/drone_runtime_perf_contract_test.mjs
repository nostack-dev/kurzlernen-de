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
  "sim/world_city_buildings.mjs",
  "sim/camera_collision_guard.mjs",
  "sim/auto_flight_start.mjs",
  "sim/simulator.mjs",
  "sim/terrain_craters.mjs",
  "sim/world_ground.mjs",
  "sim/nuke_destruction.mjs",
  "sim/world_action_feedback.mjs",
  "sim/neon_ui_theme.mjs",
  "sim/world_rigid_body_runtime.mjs",
  "sim/world_rigid_body_physics.mjs",
  "sim/world_vehicle_dynamics.mjs"
].map(async path=>[path,await readFile(path,"utf8")])));

const style=files["sim/stylized_world_style.mjs"];
assert.ok(style.includes("function beginScan(scene)")&&style.includes("function stepScan(deadline)")&&style.includes("scanStack"),"style scan must be incremental and cache actor roots");
assert.ok(!style.includes("function scanScene(scene)"),"full synchronous scene scan must not return");
const cull=style.slice(style.indexOf("function cullActors"),style.indexOf("let blastAt"));
assert.ok(!cull.includes("scene.traverse"),"actor culling must not traverse the full scene");
assert.ok(style.includes("SCAN_INTERVAL_MS=MOBILE?900:650"),"style discovery scans must be throttled");
const styleFrame=style.slice(style.indexOf("function frame(now)"),style.indexOf("globalThis.__arondightNeonStyle"));
assert.ok(!styleFrame.includes("scene.traverse")&&!styleFrame.includes("killLights(scene"),"neon render hot path must never synchronously traverse the scene or rediscover lights");
assert.ok(style.includes("renderer.shadowMap.enabled=false"),"neon renderer must not pay for invisible shadow maps");
assert.ok(style.includes("grid.visible=!bridge()?.active"),"real WORLD must not draw a second flat neon grid over deformed terrain");
assert.ok(style.includes("FogExp2(STYLE_PALETTE.haze,.00038)"),"green neon world must not reintroduce the heavy dark fog veil");

const neonUi=files["sim/neon_ui_theme.mjs"];
assert.ok(neonUi.includes("MutationObserver")&&neonUi.includes("scheduleLabelFit"),"UI label sizing must be event-driven");
assert.ok(!neonUi.includes("setTimeout(fitLabels,500)"),"UI label sizing must not force layout polling every 500 ms");
assert.ok(neonUi.includes(":is(#soloHud,#footHud,#vehicleHud,#gtaVehicleHud,#sandboxHud)")&&neonUi.includes("background:transparent!important"),"full-screen HUD containers must stay transparent; styling them as panels creates a dark veil");

const mobile=files["sim/mobile_gameplay_ui.mjs"];
assert.ok(mobile.includes("const UI_SYNC_MS=100")&&mobile.includes("setTimeout(sync,UI_SYNC_MS)"),"mobile HUD must use low-frequency state sync");
assert.ok(!mobile.includes("requestAnimationFrame(sync)"),"mobile HUD must not own a frame-rate DOM loop");

const cleanup=files["sim/flight_first_cleanup.mjs"],publishStart=cleanup.indexOf("function publish()"),publishEnd=cleanup.indexOf("export ",publishStart);
const cleanupDiagnostics=cleanup.slice(publishStart,publishEnd>publishStart?publishEnd:cleanup.length);
assert.ok(publishStart>=0&&!cleanupDiagnostics.includes("requestAnimationFrame(")&&!cleanupDiagnostics.includes("function frame(){publish()"),"static cleanup diagnostics must not own an RAF loop; the pointer-owned look/fire input loop may remain frame-driven");

const gameplay=files["sim/gameplay_final_runtime_v2.mjs"];
assert.ok(gameplay.includes("lastHousekeeping=-Infinity")&&gameplay.includes("now-lastHousekeeping>=250"),"weapon hierarchy housekeeping must be throttled");
assert.ok(gameplay.includes("cachedWeaponGun")&&gameplay.includes("cachedMuzzleFlash"),"weapon scene lookups must be cached");
assert.ok(gameplay.includes("lastPedTelemetry=-Infinity"),"pedestrian telemetry throttle must declare its state instead of crashing the render loop");
assert.ok(gameplay.includes("pedScanStack=[]")&&gameplay.includes("stepPedestrianScan(performance.now()+.75)"),"pedestrian discovery must be time-sliced instead of traversing the scene in one frame");
const pedScanSource=gameplay.slice(gameplay.indexOf("function scanPedestrians"),gameplay.indexOf("function animatePedestrians"));
assert.ok(!pedScanSource.includes("scene.traverse"),"pedestrian discovery must not synchronously traverse the scene");

const wanted=files["sim/wanted_police_drones.mjs"];
assert.ok(wanted.includes("now-lastHudRender<100")&&wanted.includes("hudStars=[...hud.querySelectorAll"),"wanted HUD DOM updates must be throttled and cached");
assert.equal((wanted.match(/let empButton=/g)||[]).length,0,"EMP binding must live in the consolidated HUD declaration only");

const walkRuntime=files["sim/player_walk_mode_v4.mjs"];
assert.ok(walkRuntime.includes("now-lastWalkHousekeeping>=200"),"walk DOM mounting must be off the render hot path");
assert.ok(walkRuntime.includes("aimDiscoverStack=[]")&&walkRuntime.includes("stepAimDiscovery(performance.now()+.65)"),"aim-assist candidate discovery must be incremental");
const aimScan=walkRuntime.slice(walkRuntime.indexOf("function scanAimTarget"),walkRuntime.indexOf("function neutralAimAssist"));
assert.ok(!aimScan.includes("scene.traverse"),"aim-assist scoring must not traverse the full scene every 115 ms");
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
const rigidRuntime=files["sim/world_rigid_body_runtime.mjs"],rigidPhysics=files["sim/world_rigid_body_physics.mjs"],vehicleDynamics=files["sim/world_vehicle_dynamics.mjs"];
assert.ok(rigidRuntime.includes("function pose(id,out=null)")&&rigidPhysics.includes("pose(id,out=null)"),"traffic pose reads must support reusable buffers");
assert.ok(vehicleDynamics.includes("wheelPoses(physics,record,out=null)")&&population.includes("pose?.(record.id,record.physicsPose)"),"wheel/chassis pose snapshots must not allocate every population tick");
assert.ok(rigidRuntime.includes("let stored=pendingTargets.get(key)")&&rigidPhysics.includes("const target=record.target||(record.target="),"vehicle AI target state must be reused instead of cloned every tick");
assert.ok(rigidPhysics.includes("stepPosition:[0,0,0]")&&rigidPhysics.includes("b3Body_GetLinearVelocity(record.postVelocity"),"Box3D traffic steps must reuse readback vectors");
assert.ok(vehicleDynamics.includes("driveWheeled(physics,record,dt,state=null)")&&rigidPhysics.includes("driveWheeled(this,record,dt,{position,velocity,rotation})"),"wheel drivetrain must reuse the physics step state instead of reading/allocating it twice");
assert.ok(population.includes("spawnVisibilityRoots=[]")&&population.includes("__arondightProceduralPopulation"),"population must expose its existing roots instead of forcing scene rescans");
assert.ok(population.includes("cachedRoutePoolTick")&&population.includes("cachedFocusTick"),"population must cache route ranking and player focus once per population tick");
assert.ok(population.includes("animalMotion=[]")&&population.includes("Math.max(groundHeightAt(a.x,a.y)+.18,airborne)"),"animals must reuse motion parameters and cats must never pass below the shared terrain surface");
assert.ok(spawnGuard.includes("__arondightProceduralPopulation?.spawnVisibilityRoots"),"spawn guard must consume the population root registry");
assert.ok(spawnGuard.includes("lastPublish")&&spawnGuard.includes("lastPublish<250"),"spawn guard diagnostics must be throttled");

const missiles=files["sim/direct_fire_missiles.mjs"];
assert.ok(missiles.includes("nearestPhysicalHit")&&missiles.includes("rb?.raycast?.("),"in-flight missiles must use Box3D instead of full Three.js mesh scans");
assert.ok(missiles.includes("setTimeout(maintainApi,250)")&&!missiles.includes("lastFrame=now;patchApi();"),"missile API integration polling must stay off RAF");
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
assert.ok(city.includes("green-neon-flat-no-texture-v3")&&city.includes("new THREE.MeshBasicMaterial({color:0x032417"),"city must keep flat textureless green-neon fills");
assert.ok(city.includes("edgeGlow.visible=edges.visible=thinEdges.visible=true")&&city.includes("fatLineMaterial(0x39ff14"),"green neon city outlines must remain enabled");

const cameraGuard=files["sim/camera_collision_guard.mjs"];
assert.ok(cameraGuard.includes("lastTelemetry=-Infinity"),"camera collision telemetry throttle must declare its state");
assert.ok(cameraGuard.includes("setTimeout(maintenance,500)")&&!cameraGuard.includes("requestAnimationFrame(frame)"),"camera provider wrapping must stay off RAF while collision itself remains frame-exact");

const startup=files["sim/auto_flight_start.mjs"];
assert.ok(startup.includes("await withTimeout(neonSettled(),5500)")&&startup.includes("await withTimeout(compileScene(),4500)"),"optional visual preparation must be bounded so START can never hang forever");
assert.ok(startup.includes("startup preparation continued after non-fatal failure"),"startup must fail open after optional preparation errors");
assert.ok(startup.indexOf("launchDefaultFlight();")>startup.indexOf("await withTimeout(compileScene(),4500)"),"manual START must not run the 1 kHz flight simulation while the opaque menu is still preparing");

const simulator=files["sim/simulator.mjs"];
assert.ok(simulator.includes('if(gameMenu&&!gameMenu.hidden){lastPresentationDrawMs=performance.now();return;}'),"opaque start menu must suppress hidden WebGL world rendering");

const terrain=files["sim/terrain_craters.mjs"],ground=files["sim/world_ground.mjs"];
assert.ok(terrain.includes("terrainCellCache")&&terrain.includes("terrainNodeHeightAt"),"terrain hot queries must share cached physical grid nodes");
assert.ok(ground.includes("function applyHeights()")&&ground.includes("terrainNodeHeightAt("),"visible ground vertices must use the exact Box3D terrain nodes");
assert.ok(ground.includes('WORLD_GROUND_VERSION="shared-neon-terrain-v3-no-texture"')&&ground.includes('worldGroundTexture="none"'),"WORLD ground must be textureless neon");
assert.ok(!ground.includes("MapServer/tile")&&!ground.includes("sampleColors("),"WORLD ground must not fetch/process satellite imagery");
assert.ok(ground.includes("vGroundWorld")&&ground.includes("diffuseColor.rgb=mix(base,neon,line)"),"neon grid must be generated on the deformed terrain mesh itself");

const action=files["sim/world_action_feedback.mjs"];
const actionScan=action.slice(action.indexOf("function releaseShootableWorldDecor"),action.indexOf("function acknowledgeSceneHit"));
assert.ok(action.includes("decorScanStack")&&action.includes("stepDecorScan(performance.now()+1.0)"),"shootable world discovery must be time-sliced");
assert.ok(!actionScan.includes("scene.traverse"),"world action feedback must not perform periodic full-scene traversal");

const nuke=files["sim/nuke_destruction.mjs"];
assert.ok(nuke.includes("debrisActive=[]")&&nuke.includes("if(!debris||!debrisActive.length)return 0"),"dormant nuke debris must cost zero per frame");
assert.ok(!nuke.includes("if(prewarm!==null)return;ensureDebris(scene);"),"nuke shader prewarm must not allocate the 2000-piece gameplay pool during startup");

console.log("Drone runtime performance contract passed: graphics stay frame-driven while scans, DOM and integration housekeeping are throttled.");
