from pathlib import Path
p=Path('tests/architecture_invariants.mjs');s=p.read_text()
s=s.replace(',"elevation:fpv?target.z:0"',',"worldMapEyeElevation"')
s=s.replace(',"WORLD_MINIMAP_FOLLOW_STORAGE"','')
s=s.replace('forbidText("sim/real_world_bootstrap.mjs",\'if(mode==="fpv"){const qYaw\',"WORLD must never virtually pan rigid FPV optics");','for(const marker of [\'if(mode==="fpv"){const dir=\',\'camera.lookAt(camera.position.clone().addScaledVector(dir,4));return;\'])requireText("sim/real_world_bootstrap.mjs",marker);')
p.write_text(s)
