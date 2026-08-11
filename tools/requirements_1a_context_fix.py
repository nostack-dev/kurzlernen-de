from pathlib import Path


def replace_once(path, old, new):
    p=Path(path); text=p.read_text(); count=text.count(old)
    if count!=1: raise SystemExit(f"{path}: expected one marker, found {count}: {old[:160]!r}")
    p.write_text(text.replace(old,new,1))

# MapLibre serializes normal style layers across WebGL context recovery but custom
# layers are application-owned. Re-add the SAME pooled impact layer object after
# the restored style is ready so CPU-authored absolute-Mercator impact history is
# uploaded into the new GL buffer instead of disappearing after a GPU reset.
replace_once(
    "sim/real_world_bootstrap.mjs",
    'this.worldShotHit={point:this.worldShotPoint,worldNormal:this.worldShotNormal,mapDecal:false};this.worldShotQueries=0;this.worldImpactLayer=null;this.worldImpactWrites=0;this.airframe=null;',
    'this.worldShotHit={point:this.worldShotPoint,worldNormal:this.worldShotNormal,mapDecal:false};this.worldShotQueries=0;this.worldImpactLayer=null;this.worldImpactWrites=0;this.worldContextRestoreHandler=null;this.worldContextRestorePending=false;this.airframe=null;',
)

impact_method='''  restoreImpactLayerAfterContext(){
    if(!this.map||this.worldContextRestorePending)return;this.worldContextRestorePending=true;const restore=()=>{if(!this.map){this.worldContextRestorePending=false;return;}if(!this.map.isStyleLoaded?.()){this.map.once("styledata",restore);return;}this.worldContextRestorePending=false;this.applyFlightPalette();this.stripFlightClutter();this.addBuildings();const installed=this.installImpactLayer();this.configureMinimapLayers();const viewport=$("viewport");if(viewport)viewport.dataset.worldImpactContextRestores=String((Number(viewport.dataset.worldImpactContextRestores)||0)+1);if(installed)this.map.triggerRepaint();};queueMicrotask(restore);
  }
'''
replace_once(
    "sim/real_world_bootstrap.mjs",
    '  installImpactLayer(){',
    impact_method+'  installImpactLayer(){',
)

# Register once on the long-lived map. MapLibre fires this event after creating a
# fresh painter/style during context restoration; the helper waits until the style
# is loaded before re-inserting the custom 3D layer.
replace_once(
    "sim/real_world_bootstrap.mjs",
    'this.map.on("error",event=>console.warn("OpenFreeMap render warning:",event?.error||event));\n    await Promise.race([new Promise(resolve=>this.map.once("load",resolve)),new Promise((_,reject)=>setTimeout(()=>reject(Error("OpenFreeMap style load timeout")),20000))]);',
    'this.map.on("error",event=>console.warn("OpenFreeMap render warning:",event?.error||event));this.worldContextRestoreHandler=()=>this.restoreImpactLayerAfterContext();this.map.on("webglcontextrestored",this.worldContextRestoreHandler);\n    await Promise.race([new Promise(resolve=>this.map.once("load",resolve)),new Promise((_,reject)=>setTimeout(()=>reject(Error("OpenFreeMap style load timeout")),20000))]);',
)

# Static release invariants: context restoration must be explicit and must reuse
# the custom layer rather than replacing or clearing the CPU impact pool.
replace_once(
    "tests/architecture_invariants.mjs",
    'for(const marker of ["WebGL2RenderingContext","#version 300 es","gl_FragColor","this.installImpactLayer();return this.map","defaultProjectionData?.mainMatrix","worldImpactRenderCalls","geometryPolygons","pointInPolygon","consider(baseT,0,0,-1)"])requireText("sim/real_world_bootstrap.mjs",marker);',
    'for(const marker of ["WebGL2RenderingContext","#version 300 es","gl_FragColor","this.installImpactLayer();return this.map","defaultProjectionData?.mainMatrix","worldImpactRenderCalls","geometryPolygons","pointInPolygon","consider(baseT,0,0,-1)","webglcontextrestored","restoreImpactLayerAfterContext","isStyleLoaded?.()","worldImpactContextRestores"])requireText("sim/real_world_bootstrap.mjs",marker);',
)

# Browser proof using the standard WEBGL_lose_context extension. A true context
# loss destroys GPU resources and MapLibre recreates the style without custom
# layers. The application must re-add the SAME impact layer object, preserve the
# CPU pool byte-for-byte, create new program/buffer resources and draw again.
p=Path("tests/world_shot_decal_smoke.mjs"); text=p.read_text()
anchor='''  if(!gpuReadd.installed||!gpuReadd.same||!gpuReadd.exists||gpuReadd.count!==worldVisual.mapAfter||gpuReadd.writes!==worldVisual.mapAfter||gpuReadd.renderCalls<=worldVisual.renderAfter)throw new Error(`WORLD impact pool did not survive custom-layer GPU re-add: ${JSON.stringify(gpuReadd)}`);\n\n  const persistBefore=await page.evaluate(()=>{const b=globalThis.__arondightRealWorld,l=b.worldImpactLayer;return{count:l.count,writes:l.writes,vertices:Array.from(l.vertices.slice(0,30))};});\n'''
if anchor not in text: raise SystemExit('GPU re-add assertion anchor missing')
context_test='''  if(!gpuReadd.installed||!gpuReadd.same||!gpuReadd.exists||gpuReadd.count!==worldVisual.mapAfter||gpuReadd.writes!==worldVisual.mapAfter||gpuReadd.renderCalls<=worldVisual.renderAfter)throw new Error(`WORLD impact pool did not survive custom-layer GPU re-add: ${JSON.stringify(gpuReadd)}`);\n\n  const contextRecovery=await page.evaluate(async()=>{\n    const b=globalThis.__arondightRealWorld,map=b.map,layer=b.worldImpactLayer,canvas=map.getCanvas(),gl=canvas.getContext("webgl2")||canvas.getContext("webgl"),ext=gl?.getExtension("WEBGL_lose_context"),v=document.querySelector("#viewport");\n    if(!ext)return{supported:false};const before={count:layer.count,writes:layer.writes,vertices:Array.from(layer.vertices),renderCalls:layer.renderCalls,program:layer.program,buffer:layer.buffer,restores:Number(v.dataset.worldImpactContextRestores||0)};\n    const lost=new Promise(resolve=>map.once("webglcontextlost",resolve)),restored=new Promise(resolve=>map.once("webglcontextrestored",resolve));ext.loseContext();await lost;await new Promise(resolve=>setTimeout(resolve,40));ext.restoreContext();await restored;\n    for(let i=0;i<300;i++){if(map.getLayer("arondight45-impact-decals")&&b.worldImpactLayer===layer&&layer.program&&layer.buffer&&Number(v.dataset.worldImpactContextRestores||0)>before.restores){map.triggerRepaint();if(layer.renderCalls>before.renderCalls)break;}await new Promise(resolve=>setTimeout(resolve,16));}\n    return{supported:true,same:b.worldImpactLayer===layer,exists:Boolean(map.getLayer("arondight45-impact-decals")),count:layer.count,writes:layer.writes,verticesSame:JSON.stringify(Array.from(layer.vertices))===JSON.stringify(before.vertices),newProgram:Boolean(layer.program&&layer.program!==before.program),newBuffer:Boolean(layer.buffer&&layer.buffer!==before.buffer),rendered:layer.renderCalls>before.renderCalls,restores:Number(v.dataset.worldImpactContextRestores||0)-before.restores};\n  });\n  if(!contextRecovery.supported||!contextRecovery.same||!contextRecovery.exists||contextRecovery.count!==worldVisual.mapAfter||contextRecovery.writes!==worldVisual.mapAfter||!contextRecovery.verticesSame||!contextRecovery.newProgram||!contextRecovery.newBuffer||!contextRecovery.rendered||contextRecovery.restores<1)throw new Error(`WORLD physical impacts did not survive real WebGL context loss/restoration: ${JSON.stringify(contextRecovery)}`);\n\n  const persistBefore=await page.evaluate(()=>{const b=globalThis.__arondightRealWorld,l=b.worldImpactLayer;return{count:l.count,writes:l.writes,vertices:Array.from(l.vertices.slice(0,30))};});\n'''
p.write_text(text.replace(anchor,context_test,1))

# Documentation explicitly includes GPU reset persistence in the player-action
# acknowledgement contract.
p=Path("REAL_WORLD_DIGITAL_TWIN.md"); text=p.read_text()
line='- WORLD impact geometry respects polygon holes / courtyards, vertical inner walls and non-zero extrusion bases; changing GPS origin does not erase already-authored absolute-Mercator impact marks.\n'
if line not in text: raise SystemExit('impact persistence documentation anchor missing')
p.write_text(text.replace(line,line[:-1]+'; MapLibre WebGL context restoration re-adds the same pooled custom layer so GPU resets do not erase those marks.\n',1))

print('WebGL context-loss impact persistence hardening applied')
