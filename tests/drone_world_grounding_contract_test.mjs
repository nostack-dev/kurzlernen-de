import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const [population,roads,water,ground,buildings,depth,training,organic,cleanup,bank,nukeCloud,nukeFx]=await Promise.all([
  "sim/world_procedural_population.mjs","sim/world_city_roads.mjs","sim/world_water.mjs","sim/world_ground.mjs",
  "sim/world_city_buildings.mjs","sim/world_building_depth_occlusion.mjs","sim/training_test_level_v2.mjs",
  "sim/world_organic_hit_audio.mjs","sim/flight_first_cleanup.mjs","sim/combat_audio_bank.mjs",
  "sim/nuke_volumetric_cloud_v2.mjs","sim/nuke_overkill_fx.mjs"
].map(path=>readFile(path,"utf8")));

for(const marker of ["world-space-fixed-centres-v1","fixed-local-road-network-v1","const cx=anchorX,cy=anchorY","cx=anchorX+m.cx,cy=anchorY+m.cy","record.wheelPoses=pose.wheels||null"])
  assert.ok(population.includes(marker),`population grounding contract missing ${marker}`);
assert.ok(!population.includes("focus=populationFocus(),cx=focus?.x??anchorX,cy=focus?.y??anchorY"),"population still moves animals/birds with the player focus");

for(const marker of ["Z_AREA=.05","Z_SIDEWALK=.09","Z_ROAD=.112","Z_MARKING=.135","map-roads-sidewalks-parks-v3-terrain-draped","drapeTerrainTriangle","AREA_EDGE_M=8,ROAD_SEG_M=6"])
  assert.ok(roads.includes(marker),`road depth contract missing ${marker}`);
assert.ok(ground.includes('mesh-is-collision')&&ground.includes("polygonOffsetFactor:4,polygonOffsetUnits:8"),"ground must be the shared terrain depth base on the collision mesh");
assert.ok(water.includes('map-water-basins-buoyancy-v2-depth-stable')&&water.includes("WATER_RENDER_Z=WATER_LEVEL_M+.052")&&water.includes("color:0x176b98"),"water must be separated and saturated blue");
assert.ok(buildings.includes("polygonOffsetFactor:3,polygonOffsetUnits:6"),"building wall/roof depth bias missing");
assert.ok(depth.includes('scene.getObjectByName?.("WORLD_CITY_BUILDINGS")?.visible')&&!depth.includes('&&Number(viewport()?.dataset.worldCityBuildings)>0'),"collision prism duplicate draw guard must switch off immediately");

for(const marker of ["fixed-grounded-harbour-v2","fixed-world-origin-v1","saturated-pond+bridge-v1","ground<park<water<road<marking<buildings-v1","const realGeo=Number.isFinite(b?.originLon)"])
  assert.ok(training.includes(marker),`training level contract missing ${marker}`);
assert.ok(cleanup.includes('import "./training_test_level_v2.mjs";'),"training level is not wired");
assert.ok(cleanup.includes('import "./world_organic_hit_audio.mjs";'),"organic impact audio is not wired");
assert.ok(organic.includes('"arondight:world-kill"')&&organic.includes('playCombatAudio(ctx,"crack"'),"organic person/animal/bird crack feedback missing");
assert.ok(bank.includes("crack:4")&&bank.includes("renderCrack"),"shared PCM bank has no crack samples");

assert.ok(nukeCloud.includes("lit-smoke+brief-ember-core-v3")&&nukeCloud.includes("MeshLambertMaterial"),"nuke mushroom must read as lit smoke");
assert.ok(nukeFx.includes("depthTest:true")&&nukeFx.includes("world-space-3d-v6-smoke-pressure"),"nuke pressure wave must be depth-tested world geometry");

console.log("Drone world grounding/render contract passed: fixed actors, stable depth layers, harbour test level, organic hit crack, and realistic nuke smoke.");
