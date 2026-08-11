from pathlib import Path
import re


def read(path):
    return Path(path).read_text()


def write(path, text):
    Path(path).write_text(text)


def replace_once(path, old, new):
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one marker, found {count}: {old[:120]!r}")
    write(path, text.replace(old, new, 1))


def require(path, token):
    if token not in read(path):
        raise SystemExit(f"{path}: required token missing: {token!r}")


# ---------------------------------------------------------------------------
# WORLD map impacts: real 3D custom MapLibre layer sharing map depth.
# ---------------------------------------------------------------------------
replace_once(
    "sim/real_world_bootstrap.mjs",
    'import {Map as MapLibreMap,LngLat} from "maplibre-gl";',
    'import {Map as MapLibreMap,LngLat,MercatorCoordinate} from "maplibre-gl";',
)

impact_layer = r'''
const WORLD_IMPACT_POOL_SIZE=32;
const WORLD_IMPACT_RADIUS_M=.028;
const WORLD_IMPACT_OFFSET_M=.004;
class WorldImpactLayer{
  constructor(originLon,originLat){this.id="arondight45-impact-decals";this.type="custom";this.renderingMode="3d";this.originLon=originLon;this.originLat=originLat;this.map=null;this.gl=null;this.program=null;this.buffer=null;this.aPos=-1;this.aUv=-1;this.uMatrix=null;this.vertices=new Float32Array(WORLD_IMPACT_POOL_SIZE*6*5);this.count=0;this.cursor=0;this.writes=0;this.dirty=true;this.lastImpact=null;}
  setOrigin(lon,lat){this.originLon=lon;this.originLat=lat;}
  compile(gl,type,source){const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){const log=gl.getShaderInfoLog(shader)||"unknown shader error";gl.deleteShader(shader);throw Error(`WORLD impact shader compile failed: ${log}`);}return shader;}
  onAdd(map,gl){this.map=map;this.gl=gl;const vertex=this.compile(gl,gl.VERTEX_SHADER,'attribute vec3 a_pos;attribute vec2 a_uv;uniform mat4 u_matrix;varying vec2 v_uv;void main(){v_uv=a_uv;gl_Position=u_matrix*vec4(a_pos,1.0);}'),fragment=this.compile(gl,gl.FRAGMENT_SHADER,'precision mediump float;varying vec2 v_uv;void main(){float r=length(v_uv-vec2(.5));if(r>.5)discard;float edge=smoothstep(.30,.50,r);float alpha=1.0-smoothstep(.47,.50,r);vec3 color=mix(vec3(.018,.016,.014),vec3(.19,.15,.11),edge);gl_FragColor=vec4(color*alpha,alpha);}');this.program=gl.createProgram();gl.attachShader(this.program,vertex);gl.attachShader(this.program,fragment);gl.linkProgram(this.program);gl.deleteShader(vertex);gl.deleteShader(fragment);if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw Error(`WORLD impact program link failed: ${gl.getProgramInfoLog(this.program)||"unknown link error"}`);this.aPos=gl.getAttribLocation(this.program,"a_pos");this.aUv=gl.getAttribLocation(this.program,"a_uv");this.uMatrix=gl.getUniformLocation(this.program,"u_matrix");this.buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,this.vertices.byteLength,gl.DYNAMIC_DRAW);}
  addImpact(point,normal){if(!point||!normal||!Number.isFinite(this.originLon)||!Number.isFinite(this.originLat))return false;let nx=Number(normal.x)||0,ny=Number(normal.y)||0,nz=Number(normal.z)||0,nLen=Math.hypot(nx,ny,nz);if(!(nLen>1e-8))return false;nx/=nLen;ny/=nLen;nz/=nLen;let hx=0,hy=0,hz=1;if(Math.abs(nz)>.9){hy=1;hz=0;}let ux=hy*nz-hz*ny,uy=hz*nx-hx*nz,uz=hx*ny-hy*nx,uLen=Math.hypot(ux,uy,uz)||1;ux/=uLen;uy/=uLen;uz/=uLen;let vx=ny*uz-nz*uy,vy=nz*ux-nx*uz,vz=nx*uy-ny*ux;const angle=(this.writes*2.399963229728653)%6.283185307179586,ca=Math.cos(angle),sa=Math.sin(angle),ru=[ux*ca+vx*sa,uy*ca+vy*sa,uz*ca+vz*sa],rv=[vx*ca-ux*sa,vy*ca-uy*sa,vz*ca-uz*sa];const ll=metersToLngLat(this.originLon,this.originLat,point.x,point.y),center=MercatorCoordinate.fromLngLat({lng:ll[0],lat:ll[1]},point.z),meters=center.meterInMercatorCoordinateUnits(),cx=center.x+nx*WORLD_IMPACT_OFFSET_M*meters,cy=center.y-ny*WORLD_IMPACT_OFFSET_M*meters,cz=center.z+nz*WORLD_IMPACT_OFFSET_M*meters,index=this.cursor++%WORLD_IMPACT_POOL_SIZE,base=index*30,corners=[[-1,-1,0,0],[1,-1,1,0],[1,1,1,1],[-1,-1,0,0],[1,1,1,1],[-1,1,0,1]];let offset=base;for(const[a,b,u,v]of corners){const du=a*WORLD_IMPACT_RADIUS_M,dv=b*WORLD_IMPACT_RADIUS_M,east=ru[0]*du+rv[0]*dv,north=ru[1]*du+rv[1]*dv,up=ru[2]*du+rv[2]*dv;this.vertices[offset++]=cx+east*meters;this.vertices[offset++]=cy-north*meters;this.vertices[offset++]=cz+up*meters;this.vertices[offset++]=u;this.vertices[offset++]=v;}this.count=Math.min(WORLD_IMPACT_POOL_SIZE,this.count+1);this.writes++;this.dirty=true;this.lastImpact={slot:index,point:{x:point.x,y:point.y,z:point.z},normal:{x:nx,y:ny,z:nz}};this.map?.triggerRepaint();return true;}
  render(arg,matrixLegacy){const gl=arg?.gl||arg,matrix=arg?.modelViewProjectionMatrix||matrixLegacy;if(!gl||!matrix||!this.program||!this.buffer||!this.count)return;gl.useProgram(this.program);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);if(this.dirty){gl.bufferSubData(gl.ARRAY_BUFFER,0,this.vertices);this.dirty=false;}const stride=5*4;gl.enableVertexAttribArray(this.aPos);gl.vertexAttribPointer(this.aPos,3,gl.FLOAT,false,stride,0);gl.enableVertexAttribArray(this.aUv);gl.vertexAttribPointer(this.aUv,2,gl.FLOAT,false,stride,3*4);gl.uniformMatrix4fv(this.uMatrix,false,matrix);const oldDepthMask=gl.getParameter(gl.DEPTH_WRITEMASK),oldDepthFunc=gl.getParameter(gl.DEPTH_FUNC);gl.enable(gl.DEPTH_TEST);gl.depthMask(false);gl.depthFunc(gl.LEQUAL);gl.drawArrays(gl.TRIANGLES,0,this.count*6);gl.depthMask(oldDepthMask);gl.depthFunc(oldDepthFunc);}
  onRemove(_map,gl){if(this.buffer)gl.deleteBuffer(this.buffer);if(this.program)gl.deleteProgram(this.program);this.buffer=null;this.program=null;this.gl=null;this.map=null;}
}
'''
replace_once(
    "sim/real_world_bootstrap.mjs",
    "\nfunction geolocate(){",
    impact_layer + "\nfunction geolocate(){",
)

replace_once(
    "sim/real_world_bootstrap.mjs",
    'this.worldShotHit={point:this.worldShotPoint,worldNormal:this.worldShotNormal};this.worldShotQueries=0;this.airframe=null;',
    'this.worldShotHit={point:this.worldShotPoint,worldNormal:this.worldShotNormal,mapDecal:false};this.worldShotQueries=0;this.worldImpactLayer=null;this.worldImpactWrites=0;this.airframe=null;',
)

impact_method = r'''  installImpactLayer(){
    if(!this.map||!Number.isFinite(this.originLon)||!Number.isFinite(this.originLat))return false;if(this.worldImpactLayer){this.worldImpactLayer.setOrigin(this.originLon,this.originLat);return Boolean(this.map.getLayer(this.worldImpactLayer.id));}this.worldImpactLayer=new WorldImpactLayer(this.originLon,this.originLat);const style=this.map.getStyle(),before=(style.layers||[]).find(layer=>layer.type==="symbol")?.id;try{if(before)this.map.addLayer(this.worldImpactLayer,before);else this.map.addLayer(this.worldImpactLayer);const viewport=$("viewport");if(viewport){viewport.dataset.worldImpactPoolSize=String(WORLD_IMPACT_POOL_SIZE);viewport.dataset.worldImpactDepth="maplibre-3d";}return true;}catch(error){console.warn("WORLD impact depth layer unavailable:",error);this.worldImpactLayer=null;return false;}
  }
'''
replace_once(
    "sim/real_world_bootstrap.mjs",
    "  addVisualShotImpact(x,y,rect,ray){",
    impact_method + "  addVisualShotImpact(x,y,rect,ray){",
)

old_tail = 'if(d.z<-.0001){const groundT=-o.z/d.z;if(groundT>0&&groundT<bestT&&groundT<1200)consider(groundT,0,0,1);}if(!Number.isFinite(bestT))return null;this.worldShotPoint.set(o.x+d.x*bestT,o.y+d.y*bestT,o.z+d.z*bestT);this.worldShotNormal.set(bestNx,bestNy,bestNz);const viewport=$("viewport");if(viewport)viewport.dataset.worldShotQueries=String(this.worldShotQueries);return this.worldShotHit;'
new_tail = 'if(d.z<-.0001){const groundT=-o.z/d.z;if(groundT>0&&groundT<bestT&&groundT<1200)consider(groundT,0,0,1);}if(!Number.isFinite(bestT))return null;this.worldShotPoint.set(o.x+d.x*bestT,o.y+d.y*bestT,o.z+d.z*bestT);this.worldShotNormal.set(bestNx,bestNy,bestNz);this.worldShotHit.mapDecal=false;if(this.worldImpactLayer){this.worldShotHit.mapDecal=this.worldImpactLayer.addImpact(this.worldShotPoint,this.worldShotNormal);if(this.worldShotHit.mapDecal)this.worldImpactWrites=this.worldImpactLayer.writes;}const viewport=$("viewport");if(viewport){viewport.dataset.worldShotQueries=String(this.worldShotQueries);viewport.dataset.worldImpactWrites=String(this.worldImpactWrites);viewport.dataset.worldImpactPoolSize=String(WORLD_IMPACT_POOL_SIZE);}return this.worldShotHit;'
replace_once("sim/real_world_bootstrap.mjs", old_tail, new_tail)
replace_once(
    "sim/real_world_bootstrap.mjs",
    "this.addBuildings();this.configureMinimapLayers();return this.map;",
    "this.addBuildings();this.installImpactLayer();this.configureMinimapLayers();return this.map;",
)

# WORLD map hit is now drawn by the MapLibre 3D layer. THREE remains a fallback
# only if that layer cannot be installed.
replace_once(
    "sim/flight_fire_fx.mjs",
    'else{const worldHit=worldBridge?.addVisualShotImpact?.(aim.x,aim.y,aim.rect,raycaster.ray);if(worldHit){impacted=addThreeDecal(worldHit,"world",null);if(impacted)viewport.dataset.fireWorldHits=String((Number(viewport.dataset.fireWorldHits)||0)+1);}}',
    'else{const worldHit=worldBridge?.addVisualShotImpact?.(aim.x,aim.y,aim.rect,raycaster.ray);if(worldHit){if(worldHit.mapDecal){impacted=true;emitImpact("world",worldHit,null);}else impacted=addThreeDecal(worldHit,"world",null);if(impacted)viewport.dataset.fireWorldHits=String((Number(viewport.dataset.fireWorldHits)||0)+1);}}',
)

# ---------------------------------------------------------------------------
# Cross-layer AGL/tilt contract: 50 m at 40 deg needs 65.27 m slant.
# ---------------------------------------------------------------------------
replace_once("sim/simulator.mjs", "const NAV_AGL_RAY_MAX_M = 60;", "const NAV_AGL_RAY_MAX_M = 70;")
replace_once("tests/architecture_invariants.mjs", '"NAV_AGL_RAY_MAX_M = 60"', '"NAV_AGL_RAY_MAX_M = 70"')

# ---------------------------------------------------------------------------
# Release invariants: performance, impact acknowledgement, depth, stale NAV.
# ---------------------------------------------------------------------------
fire_marker = 'for(const marker of ["installFlightFireFx","THREE.Raycaster","addVisualShotImpact","SHOT_INTERVAL_MS","DECAL_POOL_SIZE=32","touch-action:none"])requireText("sim/flight_fire_fx.mjs",marker);\n'
fire_guard = fire_marker + '''const fireFxSource=read("sim/flight_fire_fx.mjs"),fireHotStart=fireFxSource.indexOf("  function fire(now){"),fireHotEnd=fireFxSource.indexOf("  function scheduleFire()",fireHotStart),shotSoundStart=fireFxSource.indexOf("  function shotSound(){"),shotSoundEnd=fireFxSource.indexOf("  function screenImpact",shotSoundStart);\nif(fireHotStart<0||fireHotEnd<=fireHotStart)fail("cannot isolate fire hotpath");\nif(fireFxSource.slice(fireHotStart,fireHotEnd).includes("scene.traverse"))fail("fire hotpath traverses the whole THREE scene per shot");\nif(shotSoundStart<0||shotSoundEnd<=shotSoundStart)fail("cannot isolate shot audio hotpath");\nif(fireFxSource.slice(shotSoundStart,shotSoundEnd).includes("createBufferSource"))fail("shot audio allocates AudioNodes per shot");\nforbidText("sim/flight_fire_fx.mjs","offsetWidth","fire impact animation must not force synchronous layout");\nfor(const marker of ["RAYCAST_REFRESH_MS=500","function rebuildCandidates","fireRaycastBuilds","noiseSource.loop=true","hit.object?.attach","arondight45:impact","belongsToAirframe","worldHit.mapDecal"])requireText("sim/flight_fire_fx.mjs",marker);\n'''
replace_once("tests/architecture_invariants.mjs", fire_marker, fire_guard)

replace_once(
    "tests/architecture_invariants.mjs",
    'requireText("esp32/Arondight45_FirmwareRuntime.hpp","kNavigationTimeoutUs");\n',
    'requireText("esp32/Arondight45_FirmwareRuntime.hpp","kNavigationTimeoutUs");\nrequireText("esp32/Arondight45_FirmwareRuntime.hpp","navigation.heading_valid = false;");\n',
)

sim_marker = 'requireText("sim/simulator.mjs","cdA=[.035,.035,.07].map(x=>x*p.dragScale)");\n'
sim_guard = sim_marker + '''const sensorContractSource=read("sim/simulator.mjs"),stateContractSource=read("esp32/Arondight45_StateControl.hpp");\nconst rayMatch=sensorContractSource.match(/NAV_AGL_RAY_MAX_M = ([0-9.]+)/),tiltMatch=stateContractSource.match(/kMaxTiltDeg = ([0-9.]+)f/),clearanceMatch=stateContractSource.match(/kStateMaxClearanceM = ([0-9.]+)f/);\nif(!rayMatch||!tiltMatch||!clearanceMatch)fail("cannot parse WORLD AGL/tilt sensor contract");\nconst rayM=Number(rayMatch[1]),tiltDeg=Number(tiltMatch[1]),clearanceM=Number(clearanceMatch[1]),requiredSlantM=clearanceM/Math.cos(tiltDeg*Math.PI/180);\nif(!(rayM>=requiredSlantM+.25))fail(`WORLD NAV ray ${rayM} m cannot cover ${clearanceM} m AGL at ${tiltDeg} deg GAME tilt; needs ${requiredSlantM.toFixed(2)} m plus margin`);\n'''
replace_once("tests/architecture_invariants.mjs", sim_marker, sim_guard)

world_marker = 'for(const marker of ["WORLD_MAP_FRAME_MS=1000/30"'
world_text = read("tests/architecture_invariants.mjs")
idx = world_text.find(world_marker)
if idx < 0:
    raise SystemExit("tests/architecture_invariants.mjs: WORLD marker block missing")
insert_at = world_text.rfind("\n", 0, idx) + 1
world_depth_guard = '''for(const marker of ["MercatorCoordinate","class WorldImpactLayer","arondight45-impact-decals","renderingMode=\\\"3d\\\"","WORLD_IMPACT_POOL_SIZE=32","worldImpactLayer.addImpact","worldImpactDepth=\\\"maplibre-3d\\\""])requireText("sim/real_world_bootstrap.mjs",marker);\n'''
world_text = world_text[:insert_at] + world_depth_guard + world_text[insert_at:]
write("tests/architecture_invariants.mjs", world_text)

# ---------------------------------------------------------------------------
# Browser release tests follow the new map-depth + moving-target contract.
# ---------------------------------------------------------------------------
replace_once(
    "tests/world_shot_decal_smoke.mjs",
    'for(const marker of ["worldBridge?.addVisualShotImpact","addThreeDecal(worldHit,\\"world\\",null)","hit.object?.attach","impactTargetRoot","arondight45:impact","worldDecalMaterial","RAYCAST_REFRESH_MS=500","belongsToAirframe","DECAL_POOL_SIZE=32"])',
    'for(const marker of ["worldBridge?.addVisualShotImpact","worldHit.mapDecal","hit.object?.attach","impactTargetRoot","arondight45:impact","worldDecalMaterial","RAYCAST_REFRESH_MS=500","belongsToAirframe","DECAL_POOL_SIZE=32"])',
)

old_world_visual = '''  const worldVisual=await page.evaluate(async()=>{\n    const b=globalThis.__arondightRealWorld,v=document.querySelector("#viewport"),scene=b.threeScene,r=v.getBoundingClientRect(),saved=[],original=b.addVisualShotImpact;\n    for(const child of scene.children){if(child.userData?.flightFireDecal)continue;saved.push([child,child.visible]);if(!child.userData?.arondightAirframe)child.visible=false;}\n    b.worldShotPoint.set(4,5,2);b.worldShotNormal.set(0,0,1);b.addVisualShotImpact=()=>b.worldShotHit;\n    let impact=null;const listener=e=>{impact={kind:e.detail.kind,point:e.detail.point,normal:e.detail.normal};};v.addEventListener("arondight45:impact",listener,{once:true});\n    const before=Number(v.dataset.fireWorldHits||0),x=r.left+r.width*.5,y=r.top+r.height*.5,send=type=>v.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:501,pointerType:"touch",clientX:x,clientY:y,button:0}));\n    send("pointerdown");await new Promise(resolve=>setTimeout(resolve,35));send("pointerup");await new Promise(resolve=>setTimeout(resolve,20));\n    let decal=null;scene.traverse(node=>{if(node.userData?.flightFireDecal&&node.userData?.flightFireWorld&&node.userData?.flightFireKind==="world"&&node.visible)decal=node;});\n    const result={before,after:Number(v.dataset.fireWorldHits||0),impact,decal:decal?{x:decal.position.x,y:decal.position.y,z:decal.position.z,visible:decal.visible,depthTest:decal.material?.depthTest}:null};\n    b.addVisualShotImpact=original;for(const [child,visible]of saved)child.visible=visible;return result;\n  });\n  if(worldVisual.after!==worldVisual.before+1||worldVisual.impact?.kind!=="world"||!worldVisual.decal||!worldVisual.decal.visible||worldVisual.decal.depthTest!==false||!near(worldVisual.decal.x,4,.01)||!near(worldVisual.decal.y,5,.01)||!near(worldVisual.decal.z,2.0035,.01)||!near(worldVisual.impact.point.x,4,.001)||!near(worldVisual.impact.point.y,5,.001)||!near(worldVisual.impact.point.z,2,.001))\n    throw new Error(`WORLD physical hit was not acknowledged at its real hitpoint: ${JSON.stringify(worldVisual)}`);\n'''
new_world_visual = '''  const worldVisual=await page.evaluate(async()=>{\n    const THREE=await import("/node_modules/three/build/three.module.js"),b=globalThis.__arondightRealWorld,v=document.querySelector("#viewport"),scene=b.threeScene,cam=b.threeCamera,r=v.getBoundingClientRect(),saved=[],original=b.addVisualShotImpact,dir=new THREE.Vector3();cam.getWorldDirection(dir);const point=cam.position.clone().addScaledVector(dir,8),normal=dir.clone().negate().normalize();\n    for(const child of scene.children){if(child.userData?.flightFireDecal)continue;saved.push([child,child.visible]);if(!child.userData?.arondightAirframe)child.visible=false;}\n    b.addVisualShotImpact=()=>{b.worldShotPoint.copy(point);b.worldShotNormal.copy(normal);b.worldShotHit.mapDecal=Boolean(b.worldImpactLayer?.addImpact(b.worldShotPoint,b.worldShotNormal));if(b.worldShotHit.mapDecal){b.worldImpactWrites=b.worldImpactLayer.writes;v.dataset.worldImpactWrites=String(b.worldImpactWrites);}return b.worldShotHit;};\n    let impact=null;v.addEventListener("arondight45:impact",e=>{impact={kind:e.detail.kind,point:e.detail.point,normal:e.detail.normal};},{once:true});\n    const before=Number(v.dataset.fireWorldHits||0),mapBefore=Number(v.dataset.worldImpactWrites||0),x=r.left+r.width*.5,y=r.top+r.height*.5,send=type=>v.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:501,pointerType:"touch",clientX:x,clientY:y,button:0}));\n    send("pointerdown");await new Promise(resolve=>setTimeout(resolve,35));send("pointerup");await new Promise(resolve=>setTimeout(resolve,20));const last=b.worldImpactLayer?.lastImpact,projected=point.clone().project(cam);\n    const result={before,after:Number(v.dataset.fireWorldHits||0),mapBefore,mapAfter:Number(v.dataset.worldImpactWrites||0),impact,last,layer:{exists:Boolean(b.map.getLayer("arondight45-impact-decals")),mode:b.worldImpactLayer?.renderingMode,pool:Number(v.dataset.worldImpactPoolSize||0),depth:v.dataset.worldImpactDepth},projected:{x:projected.x,y:projected.y}};\n    b.addVisualShotImpact=original;for(const [child,visible]of saved)child.visible=visible;return result;\n  });\n  if(worldVisual.after!==worldVisual.before+1||worldVisual.mapAfter!==worldVisual.mapBefore+1||worldVisual.impact?.kind!=="world"||!worldVisual.last||!worldVisual.layer.exists||worldVisual.layer.mode!=="3d"||worldVisual.layer.pool!==32||worldVisual.layer.depth!=="maplibre-3d"||Math.abs(worldVisual.projected.x)>.01||Math.abs(worldVisual.projected.y)>.01||!near(worldVisual.last.point.x,worldVisual.impact.point.x,.001)||!near(worldVisual.last.point.y,worldVisual.impact.point.y,.001)||!near(worldVisual.last.point.z,worldVisual.impact.point.z,.001))\n    throw new Error(`WORLD physical hit was not acknowledged by the map-depth decal layer at its real hitpoint: ${JSON.stringify(worldVisual)}`);\n'''
replace_once("tests/world_shot_decal_smoke.mjs", old_world_visual, new_world_visual)

# REAL WORLD UI test now counts the actual MapLibre depth pool instead of a
# duplicate THREE overlay decal.
replace_once(
    "tests/real_world_ui_smoke.mjs",
    'let worldDecals=0;globalThis.__arondightRealWorld?.threeScene?.traverse?.(node=>{if(node.userData?.flightFireDecal&&node.userData?.flightFireWorld)worldDecals++;});return{before,during,writes0,writes,worldDecals,aimX,aimY,expectedX,expectedY,aimUi,pool:Number(v.dataset.fireDecalPoolSize||0)};',
    'const worldImpactWrites=Number(v.dataset.worldImpactWrites||0),worldImpactPool=Number(v.dataset.worldImpactPoolSize||0);return{before,during,writes0,writes,worldImpactWrites,worldImpactPool,aimX,aimY,expectedX,expectedY,aimUi,pool:Number(v.dataset.fireDecalPoolSize||0)};',
)
replace_once(
    "tests/real_world_ui_smoke.mjs",
    'dragFire.worldDecals<1||dragFire.aimUi',
    'dragFire.worldImpactWrites<1||dragFire.worldImpactPool!==32||dragFire.aimUi',
)
replace_once(
    "tests/real_world_ui_smoke.mjs",
    'one recycled 32-mesh THREE decal pool across WORLD/TRAINING.',
    'a 32-slot depth-correct WORLD impact pool plus the recycled 32-mesh object/target decal pool.',
)

# ---------------------------------------------------------------------------
# Canonical requirements documentation follows production, not historical values.
# ---------------------------------------------------------------------------
replace_once(
    "REAL_WORLD_DIGITAL_TWIN.md",
    "The browser navigation twin uses a 60 m downward ground ray; with the controller's 25° maximum GAME tilt, a 50 m vertical AGL corresponds to about 55.2 m slant range and therefore remains inside that simulated sensor envelope.",
    "The browser navigation twin uses a 70 m downward ground ray; with the controller's 40° maximum GAME tilt, a 50 m vertical AGL corresponds to about 65.3 m slant range and therefore remains inside that simulated sensor envelope.",
)
replace_once("REAL_WORLD_DIGITAL_TWIN.md", "50 m range contract, 60 m navigation-ray coverage", "50 m range contract, 70 m navigation-ray coverage")
replace_once(
    "REAL_WORLD_DIGITAL_TWIN.md",
    "The shared GAME horizontal speed command envelope remains **5 m/s** in Production, HIL and WASM until measured physical-airframe data justifies a retune. WORLD never multiplies physical speed for visual effect.",
    "The shared GAME horizontal speed command envelope is **25 m/s (90 km/h)** in Production, HIL and WASM. The phone default remains 36 km/h (10 m/s) and the persisted setting is configurable from 5–90 km/h. WORLD never multiplies physical speed for visual effect.",
)
replace_once(
    "REAL_WORLD_DIGITAL_TWIN.md",
    "The NAV range twin now permits the configured 60 m slant ray all the way through `groundRange`, so a 50 m AGL command remains measurable at the controller's 25° tilt envelope instead of being accidentally clipped by the former internal 50 m ray clamp.",
    "The NAV range twin permits the configured 70 m slant ray all the way through `groundRange`, so a 50 m AGL command remains measurable at the controller's 40° tilt envelope instead of being clipped by a shorter internal ray limit.",
)
replace_once(
    "REAL_WORLD_DIGITAL_TWIN.md",
    "WORLD settings include a **WORLD GRID** toggle, default ON.",
    "Full physical GAME velocity control is deliberately fail-closed on the S31: the production adapter must receive a fresh NAV1 UART stream containing world-frame velocity, AGL and an absolute heading measurement. The ICM-42688-P is a 6-DoF IMU and cannot make absolute yaw observable by itself, so the firmware never fabricates heading from gyro integration. If velocity, AGL or heading is absent/stale, `StateRuntime` reports navigation degraded and does not pretend that the configured km/h target is being closed-loop controlled. The exact NAV1 encoder/CRC/sequence contract is shared by Production, physical HIL and browser SIL.\n\nWORLD shot impacts are also part of the world contract rather than disposable screen FX. Map/building/ground hits are written into a bounded 32-slot MapLibre custom 3D layer at the exact ENU ray intersection; because the layer uses MapLibre's 3D custom-layer depth path, intervening building geometry can occlude the mark correctly. THREE object/opponent hits use the separate recycled 32-mesh decal pool and attach the decal to the exact mesh that was hit, so the mark follows a moving target. Every accepted physical hit emits an `arondight45:impact` event; a miss never fabricates a world impact.\n\nWORLD settings include a **WORLD GRID** toggle, default ON.",
)

doc = read("REAL_WORLD_DIGITAL_TWIN.md")
for stale in ["remains **5 m/s**", "25° maximum GAME tilt", "60 m navigation-ray coverage", "configured 60 m slant ray"]:
    if stale in doc:
        raise SystemExit(f"stale digital-twin requirement remains: {stale}")

# Documentation itself is release-gated.
arch = read("tests/architecture_invariants.mjs")
anchor = 'console.log("Architecture invariants passed:'
doc_guard = '''const twinDoc=read("REAL_WORLD_DIGITAL_TWIN.md");\nfor(const marker of ["25 m/s (90 km/h)","70 m downward ground ray","40° maximum GAME tilt","arondight45:impact","MapLibre custom 3D layer","32-mesh decal pool"])if(!twinDoc.includes(marker))fail(`digital-twin requirements document stale/missing: ${marker}`);\nfor(const stale of ["remains **5 m/s**","25° maximum GAME tilt","60 m navigation-ray coverage","configured 60 m slant ray"])if(twinDoc.includes(stale))fail(`stale digital-twin requirement survived: ${stale}`);\n'''
pos = arch.find(anchor)
if pos < 0:
    raise SystemExit("architecture invariant console marker missing")
arch = arch[:pos] + doc_guard + arch[pos:]
write("tests/architecture_invariants.mjs", arch)

# Final source sanity before CI compile/browser execution.
for path, tokens in {
    "sim/real_world_bootstrap.mjs": ["MercatorCoordinate", "class WorldImpactLayer", 'this.renderingMode="3d"', "worldImpactLayer.addImpact", "WORLD_IMPACT_POOL_SIZE=32"],
    "sim/flight_fire_fx.mjs": ["worldHit.mapDecal", "hit.object?.attach", "arondight45:impact", "RAYCAST_REFRESH_MS=500"],
    "sim/simulator.mjs": ["NAV_AGL_RAY_MAX_M = 70"],
    "esp32/Arondight45_FirmwareRuntime.hpp": ["navigation.heading_valid = false;"],
}.items():
    for token in tokens:
        require(path, token)

print("1a patch applied")
