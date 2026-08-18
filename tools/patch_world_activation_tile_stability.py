from pathlib import Path

path=Path('sim/real_world_bootstrap.mjs')
text=path.read_text()

render_old='''  renderFrame(renderer,scene,camera){\n    this.attachThree(renderer,scene,camera);this.updateVsPose();\n    if(!this.active)return false;\n    this.syncTerrainPhysics();\n    this.syncBuildingCollisions();\n    this.renderReal(scene,camera);\n    return true;\n  }'''
render_new='''  renderFrame(renderer,scene,camera){\n    this.attachThree(renderer,scene,camera);this.updateVsPose();\n    if(!this.active)return false;\n    this.syncTerrainPhysics();\n    // Keep MapLibre on the fixed GPS-origin camera until its initial vector tiles\n    // are ready. Moving the map while activation is still loading causes\n    // cancelPendingTileRequestsWhileZooming to abort the very building tile\n    // required for collision-safe initial spawn.\n    if(this.loading)return false;\n    this.syncBuildingCollisions();\n    this.renderReal(scene,camera);\n    return true;\n  }'''
visible_old='''      this.threeRenderer.domElement.style.visibility="visible";this.threeRenderer.domElement.style.display="block";this.geoContainer.hidden=false;\n      const viewport=$("viewport");'''
visible_new='''      this.threeRenderer.domElement.style.visibility="visible";this.threeRenderer.domElement.style.display="block";this.geoContainer.hidden=false;\n      // MapLibre was created while geoViewport was hidden. Give it the real\n      // viewport dimensions once, at the fixed GPS-origin camera, before\n      // requiring building-source readiness.\n      this.map.resize();\n      const viewport=$("viewport");'''
for label,old,new in [('renderFrame activation',render_old,render_new),('initial visible-map resize',visible_old,visible_new)]:
    count=text.count(old)
    if count!=1: raise SystemExit(f'{label} anchor count={count}, expected 1')
    text=text.replace(old,new,1)
if text.count('if(this.loading)return false;')!=1: raise SystemExit('loading guard count mismatch')
if text.count('this.map.resize();')<2: raise SystemExit('expected explicit activation resize plus existing map resize path')
path.write_text(text)
print('patched WORLD activation: visible-map resize at fixed GPS origin, then no camera tracking until physical startup is ready')
