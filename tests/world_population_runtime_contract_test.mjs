import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const population=await readFile(new URL("../sim/world_procedural_population.mjs",import.meta.url),"utf8");
const walking=await readFile(new URL("../sim/player_vehicle_runtime_v2.mjs",import.meta.url),"utf8");
const physics=await readFile(new URL("../sim/world_rigid_body_runtime.mjs",import.meta.url),"utf8");

for(const marker of["routeKey","placeVehicle","syncAnalyticToPose","persistent-agents+out-of-view-arrivals-v7","fixed-local-road-network-v1","world-space-fixed-centres-v1","sidewalk-network-destinations-v1","persistent-goal-agents-v1","seedRouteAgents","spawnGateOpen","VEHICLE_STALL_NUDGE_MS","record.physicsRegistered=Boolean","worldDrivenVehicleAi=\"suspended-while-player-controls-v1\"","stylized-cel-instanced-v1","worldAmbientAnimals","InstancedMesh","AMBIENT_ANIMAL_TICK_MS","trainingRoutes()"])
  assert.ok(population.includes(marker),`population runtime is missing ${marker}`);
assert.ok(!population.includes("focus=populationFocus(),cx=focus?.x??anchorX,cy=focus?.y??anchorY"),"animals/birds must not inherit the player movement vector");
// people and traffic are persistent: nothing is re-bound to another route or streamed after the player
for(const gone of["STREAM_REBIND_DISTANCE_M","streamFallbackAroundFocus","streamRebinds","respawnAllowed"])assert.ok(!population.includes(gone),`population must not ${gone} (teleporting people/cars)`);
assert.ok(population.includes("const cx=anchorX,cy=anchorY")&&population.includes("cx=anchorX+m.cx,cy=anchorY+m.cy"),"animals and birds must use fixed world-space centres");
assert.ok(walking.includes("walkPathClear")&&walking.includes("spatial-grid-swept-v3"),"walking must use swept building collision");
assert.ok(physics.includes("SOLVER_SUBSTEPS=MOBILE?2:4")&&physics.includes("worldPhysicsBudget"),"mobile physics needs a bounded solver budget");

console.log("Population grounding, route continuity, vehicle recovery, collision, and mobile budget contracts passed.");
