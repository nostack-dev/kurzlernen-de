from pathlib import Path

path=Path('sim/real_world_bootstrap.mjs')
text=path.read_text()
old='''  renderFrame(renderer,scene,camera){\n    this.attachThree(renderer,scene,camera);this.updateVsPose();\n    if(!this.active)return false;\n    this.syncTerrainPhysics();\n    this.syncBuildingCollisions();\n    this.renderReal(scene,camera);\n    return true;\n  }'''
new='''  renderFrame(renderer,scene,camera){\n    this.attachThree(renderer,scene,camera);this.updateVsPose();\n    if(!this.active)return false;\n    this.syncTerrainPhysics();\n    // Keep MapLibre on the fixed GPS-origin camera until its initial vector tiles\n    // are ready. Moving the map while activation is still loading causes\n    // cancelPendingTileRequestsWhileZooming to abort the very building tile\n    // required for collision-safe initial spawn.\n    if(this.loading)return false;\n    this.syncBuildingCollisions();\n    this.renderReal(scene,camera);\n    return true;\n  }'''
count=text.count(old)
if count!=1: raise SystemExit(f'renderFrame activation anchor count={count}, expected 1')
text=text.replace(old,new,1)
if text.count('if(this.loading)return false;')!=1: raise SystemExit('loading guard count mismatch')
path.write_text(text)
print('patched WORLD activation to keep MapLibre camera static until physical startup is ready')
