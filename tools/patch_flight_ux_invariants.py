from pathlib import Path
p=Path('tests/architecture_invariants.mjs');s=p.read_text()
s=s.replace('requireText("sim/control_settings.mjs","MINIMAP FOLLOWS 360° CAMERA");','forbidText("sim/control_settings.mjs","MINIMAP FOLLOWS 360° CAMERA","minimap must stay north-up in every camera mode");\nfor(const marker of ["MINIMAP · N↑","worldMinimapMode=\\\"north\\\"","calculateCameraOptionsFromTo","worldMapEyeElevation","setCameraFovDeg","toggleMinimapExpanded"])requireText("sim/real_world_bootstrap.mjs",marker);')
s=s.replace('["FPV VERTICAL TILT","FPV FOV","THIRD PERSON DISTANCE","arondight45CameraSettingsV1"]','["FPV VERTICAL TILT","VIEW FOV","THIRD PERSON DISTANCE","arondight45CameraSettingsV1"]')
anchor='requireText("sim/simulator.mjs",\'import {HybridMotorSound} from "./motor_sound.mjs";\');\n'
extra='''requireText("sim/simulator.mjs",'import {FlightLogbook} from "./flight_logbook.mjs";');
requireText("sim/simulator.mjs",'import {installFlightFireFx} from "./flight_fire_fx.mjs";');
for(const marker of ["FLIGHT_LOGBOOK_KEY","EXPORT JSON","maxForwardMps","maxRightMps"])requireText("sim/flight_logbook.mjs",marker);
for(const marker of ["installFlightFireFx","THREE.Raycaster","addVisualShotImpact","SHOT_INTERVAL_MS"])requireText("sim/flight_fire_fx.mjs",marker);
for(const dirty of ["applyForces(","b3Body_ApplyForce","motorOmega","fc::Runtime","StateController"])forbidText("sim/flight_fire_fx.mjs",dirty,`presentation-only fire FX gained flight authority: ${dirty}`);
for(const marker of ["kStateNavigationDegraded","navigation_velocity_valid","navigation_agl_valid","degraded_attitude_command"])requireText("esp32/Arondight45_StateControl.hpp",marker);
for(const marker of ["kNavigationVelocityValid","kNavigationAglValid","kNavigationSplitValidity"])requireText("esp32/Arondight45_HardwareSensors.hpp",marker);
'''
assert anchor in s;s=s.replace(anchor,anchor+extra,1)
p.write_text(s)
