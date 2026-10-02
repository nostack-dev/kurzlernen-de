import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const population=await readFile(new URL("../sim/world_procedural_population.mjs",import.meta.url),"utf8");
const walking=await readFile(new URL("../sim/player_vehicle_runtime_v2.mjs",import.meta.url),"utf8");
const physics=await readFile(new URL("../sim/world_rigid_body_runtime.mjs",import.meta.url),"utf8");

for(const marker of["routeKey","STREAM_REBIND_DISTANCE_M","worldPopulationStreaming","road-sidewalk-stream-v1","VEHICLE_STALL_NUDGE_MS","record.physicsRegistered=Boolean"])
  assert.ok(population.includes(marker),`population runtime is missing ${marker}`);
assert.ok(walking.includes("walkPathClear")&&walking.includes("spatial-grid-swept-v3"),"walking must use swept building collision");
assert.ok(physics.includes("SOLVER_SUBSTEPS=MOBILE?2:4")&&physics.includes("worldPhysicsBudget"),"mobile physics needs a bounded solver budget");

console.log("Population continuity, vehicle recovery, collision, and mobile budget contracts passed.");
