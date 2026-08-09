from pathlib import Path
import subprocess


def one(path, old, new):
    p = Path(path)
    s = p.read_text()
    n = s.count(old)
    if n != 1:
        raise RuntimeError(f"{path}: expected exactly one match, got {n}: {old[:180]!r}")
    p.write_text(s.replace(old, new, 1))


# --- REAL WORLD render adapter: cached mini-map, direct free-look, rigid FPV ---
p = Path("sim/real_world_bootstrap.mjs")
s = p.read_text()

s = s.replace(
    'const WORLD_KEEP_LOOK_STORAGE="arondight45WorldKeepLookV1";\nconst WORLD_LOOK_SNAP_RATE=8;\n',
    '''const WORLD_KEEP_LOOK_STORAGE="arondight45WorldKeepLookV1";\nconst WORLD_MINIMAP_FOLLOW_STORAGE="arondight45WorldMinimapFollowV1";\nconst WORLD_MINIMAP_QUERY_MS=1000;\nconst WORLD_MINIMAP_DRAW_MS=125;\nconst WORLD_MINIMAP_MAX_FEATURES=80;\nconst WORLD_LOOK_SNAP_RATE=8;\n''',
    1,
)

s = s.replace(
    'const loadBool=(key,fallback)=>{try{const raw=localStorage.getItem(key);return raw===null?fallback:raw==="1";}catch{return fallback;}};\n',
    '''const loadBool=(key,fallback)=>{try{const raw=localStorage.getItem(key);return raw===null?fallback:raw==="1";}catch{return fallback;}};\nfunction lngLatToMeters(originLon,originLat,longitude,latitude){\n  const north=(latitude-originLat)*Math.PI/180*EARTH_RADIUS_M;\n  const east=(longitude-originLon)*Math.PI/180*EARTH_RADIUS_M*Math.max(.01,Math.cos(originLat*Math.PI/180));\n  return[east,north];\n}\nfunction geometryPaths(geometry){\n  if(!geometry)return[];const c=geometry.coordinates||[];\n  if(geometry.type==="LineString")return[c];\n  if(geometry.type==="MultiLineString")return c;\n  if(geometry.type==="Polygon")return c.length?[c[0]]:[];\n  if(geometry.type==="MultiPolygon")return c.map(poly=>poly?.[0]).filter(Boolean);\n  return[];\n}\n''',
    1,
)

old = 'this.lookHud=null;this.lookPlane=null;this.lookReadout=null;this.mapLegend=null;this.airframe=null;this.mapFrameMs=WORLD_MAP_FRAME_MS;'
new = 'this.lookHud=null;this.lookPlane=null;this.lookReadout=null;this.mapLegend=null;this.minimapCanvas=null;this.minimapCtx=null;this.minimapFeatures=[];this.minimapLayerIds=[];this.minimapLastQueryMs=-Infinity;this.minimapLastDrawMs=-Infinity;this.minimapQueries=0;this.minimapFollowLook=loadBool(WORLD_MINIMAP_FOLLOW_STORAGE,true);this.lookSurfaceInstalled=false;this.airframe=null;this.mapFrameMs=WORLD_MAP_FRAME_MS;'
if s.count(old) != 1:
    raise RuntimeError("real_world constructor marker missing")
s = s.replace(old, new, 1)

s = s.replace('this.installUi();this.installLookHud();', 'this.installUi();this.installLookHud();this.installFreeLookSurface();', 1)

s = s.replace(
    '#worldLookHud .world-look-stage{position:absolute;left:9px;right:9px;top:22px;bottom:8px;perspective:110px;border-radius:50%;overflow:hidden;border:1px solid #8cdcff55;background:radial-gradient(circle at 50% 44%,#274c6288 0 7%,#0a2134dd 48%,#06121ddd 72%);pointer-events:none}\n',
    '#worldLookHud .world-look-stage{position:absolute;left:9px;right:9px;top:22px;bottom:8px;perspective:110px;border-radius:50%;overflow:hidden;border:1px solid #8cdcff55;background:#071522;pointer-events:none}\n      #worldLookHud .world-mini-canvas{position:absolute;inset:0;width:100%;height:100%;display:block}\n',
    1,
)
s = s.replace(
    '#worldLookHud .world-look-plane{position:absolute;inset:17px 8px 5px;background:repeating-linear-gradient(0deg,#7bdcff42 0 1px,transparent 1px 11px),repeating-linear-gradient(90deg,#7bdcff42 0 1px,transparent 1px 11px);border:1px solid #7bdcff66;transform-origin:50% 58%;transform:rotateX(60deg) rotateZ(0deg);box-shadow:0 0 14px #55cfff22}\n',
    '#worldLookHud .world-look-plane{position:absolute;inset:17px 8px 5px;border:1px solid #7bdcff30;transform-origin:50% 58%;transform:rotateX(60deg) rotateZ(0deg);opacity:.22;box-shadow:0 0 14px #55cfff18}\n',
    1,
)

old = '''const hud=document.createElement("div");hud.id="worldLookHud";hud.setAttribute("aria-label","WORLD free 360 degree camera look");hud.innerHTML='<div class="world-look-title"><span>360° LOOK</span><span data-world-look-readout>SNAP</span></div><div class="world-look-stage"><div class="world-look-plane"></div><div class="world-look-drone"><i class="world-look-nose"></i></div></div><b class="world-look-cardinal world-look-n">N</b><b class="world-look-cardinal world-look-e">E</b><b class="world-look-cardinal world-look-s">S</b><b class="world-look-cardinal world-look-w">W</b>';'''
new = '''const hud=document.createElement("div");hud.id="worldLookHud";hud.setAttribute("aria-label","WORLD mini 3D map and free 360 degree camera look");hud.innerHTML='<div class="world-look-title"><span>MINI 3D · 360°</span><span data-world-look-readout>SNAP</span></div><div class="world-look-stage"><canvas class="world-mini-canvas" width="196" height="172" aria-label="Cached WORLD mini 3D map"></canvas><div class="world-look-plane"></div><div class="world-look-drone"><i class="world-look-nose"></i></div></div><b class="world-look-cardinal world-look-n">N</b><b class="world-look-cardinal world-look-e">E</b><b class="world-look-cardinal world-look-s">S</b><b class="world-look-cardinal world-look-w">W</b>';'''
if s.count(old) != 1:
    raise RuntimeError("world look HUD markup marker missing")
s = s.replace(old, new, 1)

old = 'viewport.appendChild(hud);this.lookHud=hud;this.lookPlane=hud.querySelector(".world-look-plane");this.lookReadout=hud.querySelector("[data-world-look-readout]");const legend=document.createElement("div");'
new = 'viewport.appendChild(hud);this.lookHud=hud;this.lookPlane=hud.querySelector(".world-look-plane");this.lookReadout=hud.querySelector("[data-world-look-readout]");this.minimapCanvas=hud.querySelector(".world-mini-canvas");this.minimapCtx=this.minimapCanvas?.getContext("2d");const legend=document.createElement("div");'
if s.count(old) != 1:
    raise RuntimeError("HUD canvas assignment marker missing")
s = s.replace(old, new, 1)

old = 'hud.addEventListener("pointerdown",event=>{event.preventDefault();hud.setPointerCapture?.(event.pointerId);this.lookDragging=true;this.lookSnapping=false;this.lookPointer={id:event.pointerId,x:event.clientX,y:event.clientY,yaw:this.lookYawDeg,pitch:this.lookPitchDeg};this.renderLookHud();});'
new = 'hud.addEventListener("pointerdown",event=>{if($("viewport")?.dataset.cameraMode==="fpv")return;event.preventDefault();hud.setPointerCapture?.(event.pointerId);this.lookDragging=true;this.lookSnapping=false;this.lookPointer={id:event.pointerId,x:event.clientX,y:event.clientY,yaw:this.lookYawDeg,pitch:this.lookPitchDeg};this.renderLookHud();});'
if s.count(old) != 1:
    raise RuntimeError("HUD pointerdown marker missing")
s = s.replace(old, new, 1)

# Add free look directly on empty WORLD space. Existing sticks/buttons/height pad/settings
# are explicitly excluded, so this cannot steal aircraft-control gestures.
marker = '  renderLookHud(){\n'
if s.count(marker) != 1:
    raise RuntimeError("renderLookHud marker missing")
free_look = r'''  installFreeLookSurface(){
    const viewport=$("viewport");if(!viewport||this.lookSurfaceInstalled)return;this.lookSurfaceInstalled=true;
    const blocked=target=>target instanceof Element&&Boolean(target.closest("#soloTopbar,#soloRaceHud,#soloLeft,#soloRight,#soloClearance,.solo-action,.phone-settings-dialog,#worldLookHud"));
    const move=event=>{if(!this.lookDragging||event.pointerId!==this.lookPointer?.id||this.lookPointer?.source!=="world")return;const dx=event.clientX-this.lookPointer.x,dy=event.clientY-this.lookPointer.y;this.lookYawDeg=((this.lookPointer.yaw+dx*.38+540)%360)-180;this.lookPitchDeg=clamp(this.lookPointer.pitch-dy*.32,-75,60);this.lookSnapping=false;this.renderLookHud();event.preventDefault();};
    viewport.addEventListener("pointerdown",event=>{if(!this.active||!document.body.classList.contains("solo-flight")||viewport.dataset.cameraMode==="fpv"||event.button!==0||blocked(event.target)||this.lookDragging)return;this.lookDragging=true;this.lookSnapping=false;this.lookPointer={id:event.pointerId,source:"world",x:event.clientX,y:event.clientY,yaw:this.lookYawDeg,pitch:this.lookPitchDeg};try{viewport.setPointerCapture?.(event.pointerId);}catch{}this.renderLookHud();event.preventDefault();},{passive:false});
    viewport.addEventListener("pointermove",move,{passive:false});
    const release=event=>{if(!this.lookDragging||event.pointerId!==this.lookPointer?.id||this.lookPointer?.source!=="world")return;const released=event.pointerId;this.lookDragging=false;this.lookPointer=null;try{viewport.releasePointerCapture?.(released);}catch{}if(!this.keepLookOrientation)this.lookSnapping=true;this.renderLookHud();event.preventDefault();};
    viewport.addEventListener("pointerup",release,{passive:false});viewport.addEventListener("pointercancel",release,{passive:false});
  }
'''
s = s.replace(marker, free_look + marker, 1)

old = 'if(this.lookReadout)this.lookReadout.textContent=this.lookDragging?`${Math.round(this.lookYawDeg)}°`:this.keepLookOrientation?`KEEP · ${Math.round(this.lookYawDeg)}°`:this.lookSnapping?"SNAP ↺":"SNAP";'
new = 'const cameraMode=$("viewport")?.dataset.cameraMode||"follow";if(this.lookReadout)this.lookReadout.textContent=cameraMode==="fpv"?"FPV LOCK":this.lookDragging?`${Math.round(this.lookYawDeg)}°`:this.keepLookOrientation?`KEEP · ${Math.round(this.lookYawDeg)}°`:this.lookSnapping?"SNAP ↺":"SNAP";'
if s.count(old) != 1:
    raise RuntimeError("look readout marker missing")
s = s.replace(old, new, 1)

old = 'viewport.dataset.worldLookKeepEnabled=this.keepLookOrientation?"1":"0";viewport.dataset.worldGridEnabled=this.gridEnabled?"1":"0";'
new = 'viewport.dataset.worldLookKeepEnabled=this.keepLookOrientation?"1":"0";viewport.dataset.worldGridEnabled=this.gridEnabled?"1":"0";viewport.dataset.worldMinimapFollow=this.minimapFollowLook?"1":"0";'
if s.count(old) != 1:
    raise RuntimeError("look dataset marker missing")
s = s.replace(old, new, 1)

old = '  setKeepLookOrientation(value){this.keepLookOrientation=Boolean(value);try{localStorage.setItem(WORLD_KEEP_LOOK_STORAGE,this.keepLookOrientation?"1":"0");}catch{}if(!this.keepLookOrientation&&!this.lookDragging&&(Math.abs(this.lookYawDeg)>.05||Math.abs(this.lookPitchDeg)>.05))this.lookSnapping=true;this.renderLookHud();return this.keepLookOrientation;}\n'
new = old + '  setMinimapFollowLook(value){this.minimapFollowLook=Boolean(value);try{localStorage.setItem(WORLD_MINIMAP_FOLLOW_STORAGE,this.minimapFollowLook?"1":"0");}catch{}this.minimapLastDrawMs=-Infinity;this.renderLookHud();return this.minimapFollowLook;}\n'
if s.count(old) != 1:
    raise RuntimeError("setKeepLookOrientation marker missing")
s = s.replace(old, new, 1)

# Hardware contract: FPV optics stay rigidly attached to the airframe. WORLD look only
# changes FOLLOW/THIRD presentation camera after simulator camera computation.
old = '''    this.stepLook(performance.now());if(Math.abs(this.lookYawDeg)<.001&&Math.abs(this.lookPitchDeg)<.001)return;const airframe=this.airframeFor(scene);if(!airframe)return;const mode=$("viewport")?.dataset.cameraMode||"follow",yaw=THREE.MathUtils.degToRad(this.lookYawDeg),pitch=THREE.MathUtils.degToRad(this.lookPitchDeg),worldUp=new THREE.Vector3(0,0,1);\n    if(mode==="fpv"){const qYaw=new THREE.Quaternion().setFromAxisAngle(worldUp,-yaw);camera.quaternion.premultiply(qYaw);const right=new THREE.Vector3(1,0,0).applyQuaternion(camera.quaternion).normalize(),qPitch=new THREE.Quaternion().setFromAxisAngle(right,pitch);camera.quaternion.premultiply(qPitch);return;}'''
new = '''    this.stepLook(performance.now());const mode=$("viewport")?.dataset.cameraMode||"follow";if(mode==="fpv")return;if(Math.abs(this.lookYawDeg)<.001&&Math.abs(this.lookPitchDeg)<.001)return;const airframe=this.airframeFor(scene);if(!airframe)return;const yaw=THREE.MathUtils.degToRad(this.lookYawDeg),pitch=THREE.MathUtils.degToRad(this.lookPitchDeg),worldUp=new THREE.Vector3(0,0,1);'''
if s.count(old) != 1:
    raise RuntimeError("FPV look branch marker missing")
s = s.replace(old, new, 1)

# Mini-map uses only already-loaded MapLibre vector features. No second MapLibre, WebGL,
# tile source, fetch, or request is created. Query and draw are heavily throttled and
# become slower again in critical performance mode.
marker = '  status(text,kind=""){const el=$("realWorldStatus");'
if s.count(marker) != 1:
    raise RuntimeError("status marker missing")
mini_methods = r'''  configureMinimapLayers(){
    if(!this.map)return;const layers=this.map.getStyle()?.layers||[],allowed=new Set(["water","waterway","landcover","landuse","transportation"]);this.minimapLayerIds=layers.filter(layer=>layer.id==="arondight45-buildings-3d"||(layer.type!=="symbol"&&allowed.has(String(layer["source-layer"]||"").toLowerCase()))).map(layer=>layer.id);
  }
  cacheMinimapFeatures(now){
    const interval=this.perfMode==="critical"?WORLD_MINIMAP_QUERY_MS*2:WORLD_MINIMAP_QUERY_MS;if(!this.map||!this.minimapLayerIds.length||now-this.minimapLastQueryMs<interval)return;this.minimapLastQueryMs=now;this.minimapQueries++;const cached=[];
    try{for(const feature of this.map.queryRenderedFeatures(undefined,{layers:this.minimapLayerIds})){if(cached.length>=WORLD_MINIMAP_MAX_FEATURES)break;const source=String(feature.sourceLayer||feature.layer?.["source-layer"]||"").toLowerCase(),id=String(feature.layer?.id||"").toLowerCase(),geometryType=String(feature.geometry?.type||"");let kind="";if(source==="water"||source==="waterway")kind="water";else if(source==="building"||id==="arondight45-buildings-3d")kind="building";else if(source==="transportation")kind="road";else if((source==="landcover"||source==="landuse")&&/park|wood|forest|grass|garden|pitch|meadow|farmland|scrub/.test(id))kind="green";if(!kind)continue;const paths=geometryPaths(feature.geometry).map(path=>{const step=Math.max(1,Math.ceil(path.length/28));return path.filter((_,i)=>i%step===0).map(point=>[Number(point[0]),Number(point[1])]).filter(point=>point.every(Number.isFinite));}).filter(path=>path.length>=2);if(!paths.length)continue;cached.push({kind,geometryType,height:kind==="building"?clamp(Number(feature.properties?.render_height??feature.properties?.height??8)||8,2,80):0,paths});}}catch(error){console.warn("WORLD mini-map cache warning:",error);}this.minimapFeatures=cached;const viewport=$("viewport");if(viewport){viewport.dataset.worldMinimapFeatures=String(cached.length);viewport.dataset.worldMinimapQueries=String(this.minimapQueries);}
  }
  drawMinimap(now){
    if(!this.active||!this.minimapCtx||!this.minimapCanvas||!Number.isFinite(this.originLon)||!Number.isFinite(this.originLat))return;const drawInterval=this.perfMode==="critical"?WORLD_MINIMAP_DRAW_MS*2:WORLD_MINIMAP_DRAW_MS;if(now-this.minimapLastDrawMs<drawInterval)return;this.minimapLastDrawMs=now;this.cacheMinimapFeatures(now);const airframe=this.airframeFor(this.threeScene);if(!airframe)return;
    const canvas=this.minimapCanvas,ctx=this.minimapCtx,w=canvas.width,h=canvas.height,position=airframe.position,viewport=$("viewport"),mainBearing=Number(viewport?.dataset.worldMapBearing||0),miniBearing=this.minimapFollowLook&&Number.isFinite(mainBearing)?mainBearing:0,rad=-miniBearing*Math.PI/180,c=Math.cos(rad),si=Math.sin(rad),radius=clamp(55+Math.max(0,position.z)*2,60,170),scale=w/(radius*2),baseY=h*.62;
    const projectLocal=(east,north,height=0)=>{const dx=east-position.x,dy=north-position.y,rx=dx*c-dy*si,ry=dx*si+dy*c;return[w/2+rx*scale,baseY-ry*scale*.60-height*scale*.13];};
    const project=(lon,lat,height=0)=>{const [east,north]=lngLatToMeters(this.originLon,this.originLat,lon,lat);return projectLocal(east,north,height);};
    const gradient=ctx.createLinearGradient(0,0,0,h);gradient.addColorStop(0,"#18384d");gradient.addColorStop(1,"#071522");ctx.fillStyle=gradient;ctx.fillRect(0,0,w,h);
    if(this.gridEnabled){ctx.lineWidth=1;for(let v=-Math.ceil(radius/20)*20;v<=radius;v+=20){for(const axis of [0,1]){const a=axis?projectLocal(position.x-radius,position.y+v):projectLocal(position.x+v,position.y-radius),b=axis?projectLocal(position.x+radius,position.y+v):projectLocal(position.x+v,position.y+radius);ctx.strokeStyle=v===0?"rgba(157,233,255,.35)":"rgba(103,188,215,.14)";ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke();}}}
    for(const feature of this.minimapFeatures){for(const path of feature.paths){const bottom=path.map(point=>project(point[0],point[1],0)),polygon=feature.geometryType.includes("Polygon");if(feature.kind==="road"){ctx.strokeStyle="#e3c56b";ctx.lineWidth=2;ctx.beginPath();bottom.forEach((point,i)=>i?ctx.lineTo(...point):ctx.moveTo(...point));ctx.stroke();continue;}if(feature.kind==="water"){ctx.fillStyle="rgba(35,125,176,.74)";ctx.strokeStyle="#55b7df";ctx.lineWidth=1.5;ctx.beginPath();bottom.forEach((point,i)=>i?ctx.lineTo(...point):ctx.moveTo(...point));if(polygon){ctx.closePath();ctx.fill();}ctx.stroke();continue;}if(feature.kind==="green"){ctx.fillStyle="rgba(79,123,85,.66)";ctx.beginPath();bottom.forEach((point,i)=>i?ctx.lineTo(...point):ctx.moveTo(...point));ctx.closePath();ctx.fill();continue;}const top=path.map(point=>project(point[0],point[1],feature.height));ctx.fillStyle="rgba(189,203,211,.66)";ctx.strokeStyle="rgba(226,240,247,.82)";ctx.lineWidth=1;ctx.beginPath();top.forEach((point,i)=>i?ctx.lineTo(...point):ctx.moveTo(...point));ctx.closePath();ctx.fill();ctx.stroke();for(let i=0;i<Math.min(bottom.length,10);i+=Math.max(1,Math.floor(bottom.length/4))){ctx.strokeStyle="rgba(154,177,190,.38)";ctx.beginPath();ctx.moveTo(...bottom[i]);ctx.lineTo(...top[i]);ctx.stroke();}}}
    const forward=new THREE.Vector3(-1,0,0).applyQuaternion(airframe.quaternion),airBearing=THREE.MathUtils.radToDeg(Math.atan2(forward.x,forward.y)),rel=(airBearing-miniBearing)*Math.PI/180,cx=w/2,cy=baseY;ctx.save();ctx.translate(cx,cy);ctx.rotate(rel);ctx.fillStyle="#ff5c76";ctx.strokeStyle="#ffffff";ctx.lineWidth=1.4;ctx.beginPath();ctx.moveTo(0,-9);ctx.lineTo(6,7);ctx.lineTo(0,4);ctx.lineTo(-6,7);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();ctx.fillStyle="#d8f7ff";ctx.font="800 12px system-ui";ctx.fillText(this.minimapFollowLook?"CAM":"N",7,15);ctx.fillStyle="#9bc5d8";ctx.font="700 9px ui-monospace,monospace";ctx.fillText(`${Math.round(position.z)}m`,7,h-7);if(viewport){viewport.dataset.worldMinimapMode=this.minimapFollowLook?"camera":"north";viewport.dataset.worldMinimapBearing=miniBearing.toFixed(2);}
  }
'''
s = s.replace(marker, mini_methods + marker, 1)

# Configure the cache layer list only after the final 3D-building layer exists.
old = '    this.addBuildings();return this.map;\n'
new = '    this.addBuildings();this.configureMinimapLayers();return this.map;\n'
if s.count(old) != 1:
    raise RuntimeError("createMap addBuildings marker missing")
s = s.replace(old, new, 1)

old = 'viewport.dataset.worldPerfMode=this.perfMode;viewport.dataset.worldFlightFps="0";this.renderLookHud();'
new = 'viewport.dataset.worldPerfMode=this.perfMode;viewport.dataset.worldFlightFps="0";viewport.dataset.worldMinimapFollow=this.minimapFollowLook?"1":"0";viewport.dataset.worldMinimapQueries="0";this.minimapLastQueryMs=-Infinity;this.minimapLastDrawMs=-Infinity;this.minimapQueries=0;this.renderLookHud();'
if s.count(old) != 1:
    raise RuntimeError("activation instrumentation marker missing")
s = s.replace(old, new, 1)

old = 'delete viewport.dataset.worldPerfMode;delete viewport.dataset.worldPaletteLayers;}'
new = 'delete viewport.dataset.worldPerfMode;delete viewport.dataset.worldPaletteLayers;delete viewport.dataset.worldMinimapMode;delete viewport.dataset.worldMinimapBearing;delete viewport.dataset.worldMinimapFeatures;delete viewport.dataset.worldMinimapQueries;delete viewport.dataset.worldMinimapFollow;}'
if s.count(old) != 1:
    raise RuntimeError("deactivation instrumentation marker missing")
s = s.replace(old, new, 1)

old = 'this.applyLookCamera(scene,camera);this.syncMapCamera(camera);const renderer=this.threeRenderer;'
new = 'this.applyLookCamera(scene,camera);this.syncMapCamera(camera);this.drawMinimap(performance.now());const renderer=this.threeRenderer;'
if s.count(old) != 1:
    raise RuntimeError("renderReal marker missing")
s = s.replace(old, new, 1)

p.write_text(s)


# --- SETTINGS: mini-map orientation toggle, persisted through bridge ---
one(
    "sim/control_settings.mjs",
    '<label class="phone-settings-toggle"><span>KEEP 360° LOOK ORIENTATION</span><input data-world-keep-look type="checkbox"></label>\n    <p class="phone-settings-note">WORLD GRID is a render-only local metre reference. 360° LOOK is camera-only: OFF snaps smoothly back on release; ON keeps the released orientation. Neither changes flight state or map tile traffic.</p>',
    '<label class="phone-settings-toggle"><span>KEEP 360° LOOK ORIENTATION</span><input data-world-keep-look type="checkbox"></label>\n    <label class="phone-settings-toggle"><span>MINIMAP FOLLOWS 360° CAMERA</span><input data-world-minimap-follow type="checkbox"></label>\n    <p class="phone-settings-note">WORLD GRID is a render-only local metre reference. 360° LOOK is camera-only: OFF snaps smoothly back on release; ON keeps the released orientation. MINIMAP follow ON rotates the cached mini 3D map with the camera; OFF keeps north-up. FPV stays rigidly mounted and cannot be virtually panned.</p>',
)
one(
    "sim/control_settings.mjs",
    'grid=section.querySelector("[data-world-grid]"),keepLook=section.querySelector("[data-world-keep-look]");',
    'grid=section.querySelector("[data-world-grid]"),keepLook=section.querySelector("[data-world-keep-look]"),minimapFollow=section.querySelector("[data-world-minimap-follow]");',
)
one(
    "sim/control_settings.mjs",
    'grid.checked=bridge.gridEnabled!==false;keepLook.checked=Boolean(bridge.keepLookOrientation);syncStatus();',
    'grid.checked=bridge.gridEnabled!==false;keepLook.checked=Boolean(bridge.keepLookOrientation);minimapFollow.checked=bridge.minimapFollowLook!==false;syncStatus();',
)
one(
    "sim/control_settings.mjs",
    'grid.addEventListener("change",()=>{bridge.setGridEnabled?.(grid.checked);renderButton();});keepLook.addEventListener("change",()=>{bridge.setKeepLookOrientation?.(keepLook.checked);renderButton();});dialog.querySelector("[data-reset]")?.addEventListener("click",()=>{bridge.setGridEnabled?.(true);bridge.setKeepLookOrientation?.(false);bridge.resetLook?.(true);renderButton();});',
    'grid.addEventListener("change",()=>{bridge.setGridEnabled?.(grid.checked);renderButton();});keepLook.addEventListener("change",()=>{bridge.setKeepLookOrientation?.(keepLook.checked);renderButton();});minimapFollow.addEventListener("change",()=>{bridge.setMinimapFollowLook?.(minimapFollow.checked);renderButton();});dialog.querySelector("[data-reset]")?.addEventListener("click",()=>{bridge.setGridEnabled?.(true);bridge.setKeepLookOrientation?.(false);bridge.setMinimapFollowLook?.(true);bridge.resetLook?.(true);renderButton();});',
)


# --- ARCHITECTURE INVARIANTS: make the no-shortcuts boundary executable ---
p = Path("tests/architecture_invariants.mjs")
s = p.read_text()
s = s.replace(
    'requireText("sim/control_settings.mjs","KEEP 360° LOOK ORIENTATION");',
    'requireText("sim/control_settings.mjs","KEEP 360° LOOK ORIENTATION");\nrequireText("sim/control_settings.mjs","MINIMAP FOLLOWS 360° CAMERA");',
    1,
)
old = 'for(const dirty of ["Box3DFactory","PhysicsModel","applyForces(","motorOmega","motorTorque","propTorque","fc::Runtime","StateController","b3Body_ApplyForce","b3World_Step"])'
new = 'for(const dirty of ["Box3DFactory","PhysicsModel","applyForces(","motorOmega","motorTorque","propTorque","fc::Runtime","StateController","b3Body_ApplyForce","b3World_Step","new MapLibreMap({container:this.minimap"])'
if s.count(old) != 1:
    raise RuntimeError("architecture dirty-list marker missing")
s = s.replace(old, new, 1)
old = '"WORLD_GRID_STORAGE","WORLD_KEEP_LOOK_STORAGE","installLookHud()","applyLookCamera(scene,camera)","camera.position.copy(basePosition)","this.airframe=null;scene.traverse","child.isGridHelper&&this.gridEnabled"'
new = '"WORLD_GRID_STORAGE","WORLD_KEEP_LOOK_STORAGE","WORLD_MINIMAP_FOLLOW_STORAGE","WORLD_MINIMAP_QUERY_MS=1000","queryRenderedFeatures(undefined,{layers:this.minimapLayerIds})","world-mini-canvas","worldMinimapMode","installLookHud()","installFreeLookSurface()","applyLookCamera(scene,camera)","camera.position.copy(basePosition)","this.airframe=null;scene.traverse","child.isGridHelper&&this.gridEnabled"'
if s.count(old) != 1:
    raise RuntimeError("architecture WORLD marker list missing")
s = s.replace(old, new, 1)
# Explicitly forbid the old virtual FPV branch in the geospatial adapter.
s = s.replace(
    'for(const marker of ["TorusGeometry(.15","worldHalo.visible=worldActive&&cameraMode!==\\"fpv\\""])requireText("sim/simulator.mjs",marker);',
    'for(const marker of ["TorusGeometry(.15","worldHalo.visible=worldActive&&cameraMode!==\\"fpv\\""])requireText("sim/simulator.mjs",marker);\nforbidText("sim/real_world_bootstrap.mjs",\'if(mode==="fpv"){const qYaw\',"WORLD must never virtually pan rigid FPV optics");',
    1,
)
p.write_text(s)


# --- REAL WORLD browser gate: actual mini canvas path, orientation policy, direct
# background free-look, and rigid FPV. Fixture stays network-free/deterministic. ---
p = Path("tests/real_world_ui_smoke.mjs")
s = p.read_text()
s = s.replace(
    'keepLook:document.querySelector(\'.phone-settings-dialog [data-world-keep-look]\')?.checked,',
    'keepLook:document.querySelector(\'.phone-settings-dialog [data-world-keep-look]\')?.checked,\n    minimapFollow:document.querySelector(\'.phone-settings-dialog [data-world-minimap-follow]\')?.checked,',
    1,
)
s = s.replace(
    'config.grid!==true||config.keepLook!==false||!config.note.includes',
    'config.grid!==true||config.keepLook!==false||config.minimapFollow!==true||!config.note.includes',
    1,
)
s = s.replace(
    'grid:viewport?.dataset.worldGridEnabled||"",keepLook:viewport?.dataset.worldLookKeepEnabled||"",lookHud:getComputedStyle(document.querySelector("#worldLookHud")).display,legend:',
    'grid:viewport?.dataset.worldGridEnabled||"",keepLook:viewport?.dataset.worldLookKeepEnabled||"",lookHud:getComputedStyle(document.querySelector("#worldLookHud")).display,minimapCanvas:!!document.querySelector("#worldLookHud .world-mini-canvas"),minimapMode:viewport?.dataset.worldMinimapMode||"",minimapFollow:viewport?.dataset.worldMinimapFollow||"",legend:',
    1,
)
s = s.replace(
    'live.grid!=="1"||live.keepLook!=="0"||live.lookHud==="none"||live.legend==="none"',
    'live.grid!=="1"||live.keepLook!=="0"||live.lookHud==="none"||!live.minimapCanvas||live.minimapMode!=="camera"||live.minimapFollow!=="1"||live.legend==="none"',
    1,
)
s = s.replace(
    'if(live.canvasCount!==2)throw new Error(`REAL WORLD must use exactly MapLibre + the existing flight canvas, got ${live.canvasCount}`);',
    'if(live.canvasCount!==3)throw new Error(`REAL WORLD must use MapLibre + existing flight canvas + one lightweight cached mini-map canvas, got ${live.canvasCount}`);',
    1,
)

# Exercise direct free look on empty world area; height/sticks/buttons must remain excluded.
anchor = '  const lookBox=await page.$eval("#worldLookHud",element=>{const r=element.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};});\n'
if s.count(anchor) != 1:
    raise RuntimeError("lookBox test anchor missing")
direct_test = '''  await page.mouse.move(250,145);await page.mouse.down();await page.mouse.move(330,125,{steps:5});await page.mouse.up();\n  await page.waitForFunction(()=>Math.abs(Number(document.querySelector("#viewport")?.dataset.worldLookYaw||0))>8,{timeout:3000});\n  await page.waitForFunction(()=>Math.abs(Number(document.querySelector("#viewport")?.dataset.worldLookYaw||0))<1,{timeout:3000});\n'''
s = s.replace(anchor, direct_test + anchor, 1)

# Stub only the already-loaded feature-query result to exercise mini-map geometry; no
# network or second map is introduced in the test or product path.
anchor = '  if(providerRequests.length!==1)throw new Error(`expected one deterministic OpenFreeMap style request, got ${JSON.stringify(providerRequests)}`);\n\n'
if s.count(anchor) != 1:
    raise RuntimeError("provider request test anchor missing")
mini_test = '''  const miniFixture=await page.evaluate(()=>{\n    const bridge=globalThis.__arondightRealWorld,lat=bridge.originLat,lon=bridge.originLon,d=.00012;bridge.minimapLayerIds=["fixture"];bridge.map.queryRenderedFeatures=()=>[\n      {sourceLayer:"water",layer:{id:"water",type:"fill"},geometry:{type:"Polygon",coordinates:[[[lon-d,lat-d],[lon+d,lat-d],[lon+d,lat],[lon-d,lat-d]]]},properties:{}},\n      {sourceLayer:"transportation",layer:{id:"road-primary",type:"line"},geometry:{type:"LineString",coordinates:[[lon-d,lat],[lon+d,lat]]},properties:{}},\n      {sourceLayer:"landcover",layer:{id:"park",type:"fill"},geometry:{type:"Polygon",coordinates:[[[lon-d,lat],[lon,lat],[lon,lat+d],[lon-d,lat]]]},properties:{}},\n      {sourceLayer:"building",layer:{id:"arondight45-buildings-3d",type:"fill-extrusion"},geometry:{type:"Polygon",coordinates:[[[lon,lat],[lon+d,lat],[lon+d,lat+d],[lon,lat]]]},properties:{render_height:14}}\n    ];bridge.minimapLastQueryMs=-Infinity;bridge.minimapLastDrawMs=-Infinity;bridge.drawMinimap(performance.now());return{count:bridge.minimapFeatures.length,kinds:bridge.minimapFeatures.map(f=>f.kind).sort(),queries:bridge.minimapQueries,mode:document.querySelector("#viewport")?.dataset.worldMinimapMode||""};\n  });\n  if(miniFixture.count!==4||miniFixture.kinds.join(",")!=="building,green,road,water"||miniFixture.queries<1||miniFixture.mode!=="camera")throw new Error(`cached mini-map semantic projection failed: ${JSON.stringify(miniFixture)}`);\n\n'''
s = s.replace(anchor, anchor + mini_test, 1)

# Toggle follow policy to north-up and restore it.
anchor = '  const follow=await cameraSnapshot();\n'
if s.count(anchor) != 1:
    raise RuntimeError("follow camera test anchor missing")
orientation_test = '''  await page.click("#soloTopbar .phone-settings-button");await page.waitForFunction(()=>document.querySelector(".phone-settings-dialog")?.open,{timeout:5000});await page.click(".phone-settings-dialog [data-world-minimap-follow]");await page.click(".phone-settings-dialog [data-close]");await page.waitForFunction(()=>document.querySelector("#viewport")?.dataset.worldMinimapMode==="north",{timeout:3000});const northMini=await page.$eval("#viewport",e=>Number(e.dataset.worldMinimapBearing||99));if(Math.abs(northMini)>.01)throw new Error(`north-up mini-map failed: ${northMini}`);\n  await page.click("#soloTopbar .phone-settings-button");await page.waitForFunction(()=>document.querySelector(".phone-settings-dialog")?.open,{timeout:5000});await page.click(".phone-settings-dialog [data-world-minimap-follow]");await page.click(".phone-settings-dialog [data-close]");\n\n'''
s = s.replace(anchor, orientation_test + anchor, 1)

# FPV is a physical camera contract: neither HUD drag nor empty-world drag may pan it.
anchor = '  if(fpv.center===third.center&&fpv.zoom===third.zoom&&fpv.pitch===third.pitch&&fpv.bearing===third.bearing)throw new Error(`FPV geospatial camera stayed frozen: ${JSON.stringify({third,fpv})}`);\n'
if s.count(anchor) != 1:
    raise RuntimeError("FPV test anchor missing")
fpv_test = '''  const fpvLookBefore=await page.$eval("#viewport",e=>Number(e.dataset.worldLookYaw||0));await page.mouse.move(250,145);await page.mouse.down();await page.mouse.move(350,120,{steps:5});await page.mouse.up();await new Promise(resolve=>setTimeout(resolve,180));const fpvLookAfter=await page.$eval("#viewport",e=>Number(e.dataset.worldLookYaw||0));if(Math.abs(fpvLookAfter-fpvLookBefore)>.1)throw new Error(`rigid FPV was virtually panned: ${JSON.stringify({fpvLookBefore,fpvLookAfter})}`);\n'''
s = s.replace(anchor, anchor + fpv_test, 1)
s = s.replace(
    '50m range, 12m/s shared FC envelope, grid toggle, SNAP/KEEP 360 look HUD, semantic map palette/legend, stripped symbol clutter, adaptive 15/20/30Hz map budget, live camera sync, clean fallback.',
    '50m range, hardware-validated 5m/s FC envelope, direct SNAP/KEEP 360 look, cached semantic MINI 3D with camera/north-up policy, rigid FPV, adaptive 15/20/30Hz map budget, clean fallback.',
    1,
)
p.write_text(s)


# --- Documentation: remove any ambiguity between view assistance and hardware truth. ---
p = Path("REAL_WORLD_DIGITAL_TWIN.md")
doc = p.read_text()
doc = doc.replace(
    'A lightweight top-right **360° LOOK** orientation HUD provides free yaw/pitch camera inspection without another MapLibre instance, tile stream or WebGL renderer. With **KEEP 360° LOOK ORIENTATION** OFF (default), releasing the pointer smoothly snaps the camera offset back to the normal FOLLOW/THIRD/FPV view. With it ON, the released camera offset is retained. Changing camera mode resets the offset. The HUD is DOM/CSS only and the look transform exists solely in the REAL WORLD camera adapter.',
    'The top-right **MINI 3D · 360°** view is built from already-loaded MapLibre/OpenMapTiles vector features and one lightweight 2D canvas. It does not create a second MapLibre instance, WebGL renderer, tile stream or network request. Water, vegetation, roads and buildings use the same semantic colors as the main WORLD view; buildings are given a lightweight height projection for depth. **MINIMAP FOLLOWS 360° CAMERA** defaults ON; OFF keeps the mini-map north-up. Feature queries are capped at 1 Hz (2 s in critical performance mode), drawing at 8 Hz (4 Hz critical), and at most 80 cached features are retained.',
    1,
)
doc += '''\n\n### Free look versus physical camera truth\n\nIn FOLLOW/THIRD, dragging empty WORLD space or the MINI 3D control applies a temporary presentation-camera yaw/pitch offset. With **KEEP 360° LOOK ORIENTATION** OFF, release snaps smoothly back; ON retains the released orientation. Aircraft pose, navigation, SBUS, motor commands and Box3D state are untouched, and the simulator camera is restored after each WORLD composite render. **FPV is excluded from free look entirely**: its optics remain rigidly mounted to the airframe exactly as the physical-camera contract requires.\n'''
p.write_text(doc)


# Temporary implementation scaffolding must not survive production.
Path("tools/apply_world_minimap_rigid_fpv.py").unlink()
Path(".github/workflows/one-shot-apply-world-minimap.yml").unlink()

# Cheap local gates before we create the product commit. Full browser/WASM/S31 gates
# run in the normal production workflows after this commit reaches main.
for path in [
    "sim/real_world_bootstrap.mjs",
    "sim/control_settings.mjs",
    "tests/architecture_invariants.mjs",
    "tests/real_world_ui_smoke.mjs",
]:
    subprocess.run(["node", "--check", path], check=True)
subprocess.run(["node", "tests/architecture_invariants.mjs"], check=True)
subprocess.run(["node", "tests/control_semantics_test.mjs"], check=True)
subprocess.run(["git", "diff", "--check"], check=True)
