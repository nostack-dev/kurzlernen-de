from pathlib import Path

path=Path('tests/architecture_invariants.mjs')
text=path.read_text()
old='for(const marker of ["class SimNavigationSensors","class SimSbusReceiver","encodeNavigationWire","b3World_CastRayClosest","COLLISION_TERRAIN = 1n","COLLISION_AIRFRAME = 2n","QUERY_RANGEFINDER = 4n","NAV_AGL_RAY_MAX_M = MIN_GAME_AGL_SENSOR_SLANT_RANGE_M","groundRange(NAV_AGL_RAY_MAX_M)",".05,NAV_AGL_RAY_MAX_M","FLAG_NAVIGATION_PRESENT","FLAG_SBUS_PRESENT","backend.exchange(packet","physics.step(latest.motors"])\n  requireText("sim/simulator.mjs",marker);'
new='for(const marker of ["class SimNavigationSensors","class SimSbusReceiver","encodeNavigationWire","b3World_CastRayClosest","collision_filter_matrix.mjs","QUERY_SPAWN","TERRAIN_MASK","BUILDING_MASK","NAV_AGL_RAY_MAX_M = MIN_GAME_AGL_SENSOR_SLANT_RANGE_M","groundRange(NAV_AGL_RAY_MAX_M)",".05,NAV_AGL_RAY_MAX_M","FLAG_NAVIGATION_PRESENT","FLAG_SBUS_PRESENT","backend.exchange(packet","physics.step(latest.motors"])\n  requireText("sim/simulator.mjs",marker);\nfor(const marker of ["COLLISION_TERRAIN=1n","COLLISION_AIRFRAME=2n","QUERY_RANGEFINDER=4n","QUERY_CAMERA=8n","QUERY_SPAWN=16n","TERRAIN_MASK=COLLISION_AIRFRAME|QUERY_RANGEFINDER|QUERY_CAMERA|QUERY_SPAWN","BUILDING_MASK=COLLISION_AIRFRAME|QUERY_CAMERA|QUERY_SPAWN"])\n  requireText("sim/collision_filter_matrix.mjs",marker);'
if text.count(old)!=1:
    raise SystemExit(f'architecture invariant anchor count={text.count(old)}, expected 1')
text=text.replace(old,new,1)
path.write_text(text)
print('patched architecture invariant to central Box3D matrix contract')
