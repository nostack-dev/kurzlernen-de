from pathlib import Path


def replace_once(path, old, new):
    p=Path(path); text=p.read_text(); count=text.count(old)
    if count!=1: raise SystemExit(f"{path}: expected one marker, found {count}: {old[:160]!r}")
    p.write_text(text.replace(old,new,1))

# MapLibre fill-extrusion geometry contains top triangles and vertical side-wall
# quads; it does not author a bottom cap. Do not invent a hittable underside that
# the player cannot see. Also only accept the top face from its rendered side.
p=Path("sim/real_world_bootstrap.mjs"); text=p.read_text()
old='''if(Math.abs(d.z)>1e-7){const roofT=(top-o.z)/d.z,roofX=o.x+d.x*roofT,roofY=o.y+d.y*roofT;if(roofT>0&&roofT<bestT&&pointInPolygon(roofX,roofY,rings))consider(roofT,0,0,1);if(base>.02){const baseT=(base-o.z)/d.z,baseX=o.x+d.x*baseT,baseY=o.y+d.y*baseT;if(baseT>0&&baseT<bestT&&pointInPolygon(baseX,baseY,rings))consider(baseT,0,0,-1);}}'''
new='''if(d.z< -1e-7){const roofT=(top-o.z)/d.z,roofX=o.x+d.x*roofT,roofY=o.y+d.y*roofT;if(roofT>0&&roofT<bestT&&pointInPolygon(roofX,roofY,rings))consider(roofT,0,0,1);}'''
if text.count(old)!=1: raise SystemExit('WORLD roof/base surface block mismatch')
p.write_text(text.replace(old,new,1))

# Architecture contract: holes/inner walls stay, but a synthetic bottom cap must
# never return.
replace_once(
    "tests/architecture_invariants.mjs",
    'for(const marker of ["WebGL2RenderingContext","#version 300 es","gl_FragColor","this.installImpactLayer();return this.map","defaultProjectionData?.mainMatrix","worldImpactRenderCalls","geometryPolygons","pointInPolygon","consider(baseT,0,0,-1)","webglcontextrestored","restoreImpactLayerAfterContext","isStyleLoaded?.()","worldImpactContextRestores"])requireText("sim/real_world_bootstrap.mjs",marker);',
    'for(const marker of ["WebGL2RenderingContext","#version 300 es","gl_FragColor","this.installImpactLayer();return this.map","defaultProjectionData?.mainMatrix","worldImpactRenderCalls","geometryPolygons","pointInPolygon","if(d.z< -1e-7)","webglcontextrestored","restoreImpactLayerAfterContext","isStyleLoaded?.()","worldImpactContextRestores"])requireText("sim/real_world_bootstrap.mjs",marker);\nforbidText("sim/real_world_bootstrap.mjs","consider(baseT,0,0,-1)","MapLibre fill-extrusion has no rendered bottom cap; impact solver must not invent one");',
)

# Deterministic geometry fixture: an upward ray below a non-zero extrusion base
# must NOT register a floating underside. Side walls above base remain hittable.
p=Path("tests/world_shot_decal_smoke.mjs"); text=p.read_text()
replace_once(
    "tests/world_shot_decal_smoke.mjs",
    'const underside=snap(b.addVisualShotImpact(100,100,rect,{origin:{x:3,y:0,z:1},direction:{x:0,y:0,z:1}}));',
    'const noBottom=snap(b.addVisualShotImpact(100,100,rect,{origin:{x:3,y:0,z:1},direction:{x:0,y:0,z:1}}));const raisedWall=snap(b.addVisualShotImpact(100,100,rect,{origin:{x:0,y:-12,z:5},direction:{x:0,y:1,z:0}}));',
)
replace_once(
    "tests/world_shot_decal_smoke.mjs",
    'return{wall,roof,courtyard,innerWall,underside,ground,reusedHitObject:firstRef===second,queries:Number(v.dataset.worldShotQueries||0)};',
    'return{wall,roof,courtyard,innerWall,noBottom,raisedWall,ground,reusedHitObject:firstRef===second,queries:Number(v.dataset.worldShotQueries||0)};',
)
replace_once(
    "tests/world_shot_decal_smoke.mjs",
    'if(!geometry.underside||!near(geometry.underside.point.x,3,.03)||!near(geometry.underside.point.y,0,.03)||!near(geometry.underside.point.z,3,.03)||geometry.underside.normal.z>-.98)throw new Error(`WORLD elevated extrusion underside was not hittable: ${JSON.stringify(geometry)}`);',
    'if(geometry.noBottom)throw new Error(`WORLD impact solver invented a non-rendered extrusion bottom cap: ${JSON.stringify(geometry)}`);\n  if(!geometry.raisedWall||!near(geometry.raisedWall.point.x,0,.03)||!near(geometry.raisedWall.point.y,-5,.03)||!near(geometry.raisedWall.point.z,5,.03)||geometry.raisedWall.normal.y>-.98)throw new Error(`WORLD raised extrusion side wall was not hittable above base: ${JSON.stringify(geometry)}`);',
)

# Documentation says exactly what is physically acknowledged.
p=Path("REAL_WORLD_DIGITAL_TWIN.md"); text=p.read_text()
text=text.replace('polygon holes / courtyards, vertical inner walls and non-zero extrusion bases','polygon holes / courtyards, rendered top faces and vertical outer/inner walls beginning at non-zero extrusion bases')
p.write_text(text)

print('WORLD impact geometry now matches rendered fill-extrusion surfaces')
