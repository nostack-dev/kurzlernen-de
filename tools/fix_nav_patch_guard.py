from pathlib import Path

p = Path("tools/oneoff_nav_heading_patch.py")
s = p.read_text()
old = '''replace_one(sim,
''' + "'''latestNavigation={vx:0,vy:0,vz:0,agl:0,valid:false,velocityValid:false,aglValid:false};'''" + ''',
''' + "'''latestNavigation={vx:0,vy:0,vz:0,agl:0,valid:false,velocityValid:false,aglValid:false,headingDeg:0,headingValid:false};'''" + ''')'''
new = '''old_latest = "latestNavigation={vx:0,vy:0,vz:0,agl:0,valid:false,velocityValid:false,aglValid:false};"
new_latest = "latestNavigation={vx:0,vy:0,vz:0,agl:0,valid:false,velocityValid:false,aglValid:false,headingDeg:0,headingValid:false};"
p = Path(sim); text = p.read_text()
if text.count(old_latest) != 2:
    raise SystemExit(f"simulator latestNavigation count mismatch: {text.count(old_latest)}")
p.write_text(text.replace(old_latest, new_latest))'''
if s.count(old) != 1:
    raise SystemExit(f"patch guard block not found exactly once: {s.count(old)}")
p.write_text(s.replace(old, new))
