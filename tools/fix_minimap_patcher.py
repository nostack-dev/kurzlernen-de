from pathlib import Path

p=Path("tools/apply_world_minimap_rigid_fpv.py")
s=p.read_text()
old='''old = 'delete viewport.dataset.worldPerfMode;delete viewport.dataset.worldPaletteLayers;}'
new = 'delete viewport.dataset.worldPerfMode;delete viewport.dataset.worldPaletteLayers;delete viewport.dataset.worldMinimapMode;delete viewport.dataset.worldMinimapBearing;delete viewport.dataset.worldMinimapFeatures;delete viewport.dataset.worldMinimapQueries;delete viewport.dataset.worldMinimapFollow;}'
if s.count(old) != 1:
    raise RuntimeError("deactivation instrumentation marker missing")
s = s.replace(old, new, 1)'''
new='''old = 'delete viewport.dataset.worldPaletteLayers;'
new = 'delete viewport.dataset.worldPaletteLayers;delete viewport.dataset.worldMinimapMode;delete viewport.dataset.worldMinimapBearing;delete viewport.dataset.worldMinimapFeatures;delete viewport.dataset.worldMinimapQueries;delete viewport.dataset.worldMinimapFollow;'
deactivation_count = s.count(old)
if deactivation_count < 1:
    raise RuntimeError("deactivation palette marker missing")
s = s.replace(old, new)'''
if old in s:
    s=s.replace(old,new,1)
else:
    # Normalize either previous repair form without depending on the surrounding
    # install-time cleanup count. Product cleanup may legitimately occur twice.
    start=s.find("old = 'delete viewport.dataset.worldPaletteLayers;}'")
    if start<0: start=s.find("old = 'delete viewport.dataset.worldPaletteLayers;'")
    if start<0: raise RuntimeError("cannot locate minimap deactivation patch block")
    end=s.find("s = s.replace(old, new",start)
    if end<0: raise RuntimeError("cannot locate minimap deactivation replacement")
    end=s.find("\n",end)+1
    s=s[:start]+new+"\n"+s[end:]
p.write_text(s)
Path("tools/fix_minimap_patcher.py").unlink()
