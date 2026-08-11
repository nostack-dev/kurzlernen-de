from pathlib import Path
p=Path('tools/apply_vs_combat_patch.py')
s=p.read_text()
old="replace1(path, 'this.clearVsPeerPresentation();if(mateWorld){', 'this.clearVsPeerPresentation();this.resetVsCombat(false);if(mateWorld){')"
new="replace1(path, 'this.clearVsPeerPresentation();if(mateWorld){if(this.active)this.deactivate();this.originLon=null;this.originLat=null;}if(button)button.textContent=\"WAITING…\";', 'this.clearVsPeerPresentation();this.resetVsCombat(false);if(mateWorld){if(this.active)this.deactivate();this.originLon=null;this.originLat=null;}if(button)button.textContent=\"WAITING…\";')"
assert s.count(old)==1,s.count(old)
p.write_text(s.replace(old,new,1))
