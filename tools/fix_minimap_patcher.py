from pathlib import Path

p=Path("tools/apply_world_minimap_rigid_fpv.py")
s=p.read_text()
old="old = 'delete viewport.dataset.worldPerfMode;delete viewport.dataset.worldPaletteLayers;}'\nnew = 'delete viewport.dataset.worldPerfMode;delete viewport.dataset.worldPaletteLayers;delete viewport.dataset.worldMinimapMode;delete viewport.dataset.worldMinimapBearing;delete viewport.dataset.worldMinimapFeatures;delete viewport.dataset.worldMinimapQueries;delete viewport.dataset.worldMinimapFollow;}'"
new="old = 'delete viewport.dataset.worldPaletteLayers;}'\nnew = 'delete viewport.dataset.worldPaletteLayers;delete viewport.dataset.worldMinimapMode;delete viewport.dataset.worldMinimapBearing;delete viewport.dataset.worldMinimapFeatures;delete viewport.dataset.worldMinimapQueries;delete viewport.dataset.worldMinimapFollow;}'"
if s.count(old)!=1: raise RuntimeError(f"strict deactivation patch marker count {s.count(old)}")
s=s.replace(old,new,1)
old2='''if s.count(old) != 1:\n    raise RuntimeError("deactivation instrumentation marker missing")\ns = s.replace(old, new, 1)'''
new2='''deactivation_count = s.count(old)\nif deactivation_count < 1:\n    raise RuntimeError("deactivation instrumentation marker missing")\ns = s.replace(old, new)'''
if s.count(old2)!=1: raise RuntimeError(f"deactivation logic marker count {s.count(old2)}")
p.write_text(s.replace(old2,new2,1))
Path("tools/fix_minimap_patcher.py").unlink()
