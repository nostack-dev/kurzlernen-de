from pathlib import Path
import re


def one(path, old, new):
    p=Path(path); s=p.read_text(); n=s.count(old)
    assert n==1, f"{path}: expected one occurrence, got {n}: {old[:140]!r}"
    p.write_text(s.replace(old,new,1))

# ---- Logbook correctness: a reset cannot recursively call finish(record()). ----
one('sim/flight_logbook.mjs',
    'if(t+1e-6<flight.lastSim){this.finish("SIM_RESET",sample);return;}',
    'if(t+1e-6<flight.lastSim){this.finish("SIM_RESET",null);return;}')
one('sim/flight_logbook.mjs',
    'const t=Number(sample.simTime)||0,x=Number(sample.x),y=Number(sample.y),z=Number(sample.z),speed=Math.max(0,Number(sample.speed)||0),agl=Math.max(0,Number(sample.agl)||z),battery=Number(sample.batteryV)||flight.batteryEndV;',
    'const t=Number(sample.simTime)||0,x=Number(sample.x),y=Number(sample.y),z=Number(sample.z),speed=Math.max(0,Number(sample.speed)||0),aglValue=Number(sample.agl),aglValid=sample.aglValid!==false&&Number.isFinite(aglValue),agl=aglValid?Math.max(0,aglValue):null,battery=Number(sample.batteryV)||flight.batteryEndV;')
one('sim/flight_logbook.mjs',
    'const body=bodyVelocity(sample);flight.maxSpeedMps=Math.max(flight.maxSpeedMps,speed);flight.maxAglM=Math.max(flight.maxAglM,agl);flight.maxAltitudeM=Math.max(flight.maxAltitudeM,z);',
    'const body=bodyVelocity(sample);flight.maxSpeedMps=Math.max(flight.maxSpeedMps,speed);if(aglValid)flight.maxAglM=Math.max(flight.maxAglM,agl);flight.maxAltitudeM=Math.max(flight.maxAltitudeM,z);')
one('sim/flight_logbook.mjs',
    'if(forcePath||t-flight.lastPathSim>=PATH_INTERVAL_S){flight.lastPathSim=t;if(flight.path.length<MAX_PATH_POINTS)flight.path.push({t:+(t-flight.simStart).toFixed(2),x:+(x||0).toFixed(2),y:+(y||0).toFixed(2),agl:+agl.toFixed(2),z:+z.toFixed(2)});}',
    'if(forcePath||t-flight.lastPathSim>=PATH_INTERVAL_S){flight.lastPathSim=t;if(flight.path.length<MAX_PATH_POINTS)flight.path.push({t:+(t-flight.simStart).toFixed(2),x:+(x||0).toFixed(2),y:+(y||0).toFixed(2),agl:aglValid?+agl.toFixed(2):null,z:+z.toFixed(2)});}')

# ---- WORLD settings: minimap is always north-up, so remove the obsolete rotate setting. ----
p=Path('sim/control_settings.mjs'); s=p.read_text()
s=s.replace('    <label class="phone-settings-toggle"><span>MINIMAP FOLLOWS 360° CAMERA</span><input data-world-minimap-follow type="checkbox"></label>\n','',1)
s=s.replace('WORLD GRID is a render-only local metre reference. 360° LOOK is camera-only: OFF snaps smoothly back on release; ON keeps the released orientation. MINIMAP follow ON rotates the cached mini 3D map with the camera; OFF keeps north-up. FPV stays rigidly mounted and cannot be virtually panned.', 'WORLD GRID is a render-only local metre reference. 360° LOOK is camera-only: OFF snaps smoothly back on release; ON keeps the released orientation. The GTA-style minimap is always north-up and uses the same drag/pinch/double-tap interaction in FOLLOW, THIRD and FPV.',1)
s=s.replace(',minimapFollow=section.querySelector("[data-world-minimap-follow]")','',1)
s=s.replace(';minimapFollow.checked=bridge.minimapFollowLook!==false','',1)
s=s.replace(';minimapFollow.addEventListener("change",()=>{bridge.setMinimapFollowLook?.(minimapFollow.checked);renderButton();})','',1)
s=s.replace(';bridge.setMinimapFollowLook?.(true)','',1)
p.write_text(s)

# Camera setting remains visible and is the single source synchronized by minimap pinch.
p=Path('sim/camera_settings.mjs'); s=p.read_text()
s=s.replace('<div class="phone-settings-row"><label>FPV FOV</label>', '<div class="phone-settings-row"><label>VIEW FOV</label>',1)
s=s.replace('FOV is the same persisted value changed by pinch on the WORLD mini-map.', 'VIEW FOV is the same persisted value changed by pinch on the WORLD mini-map.',1)
p.write_text(s)

# ---- WORLD renderer: exact FPV eye pose, one north-up minimap interaction for all modes. ----
p=Path('sim/real_world_bootstrap.mjs'); s=p.read_text()
s=s.replace('import {Map as MapLibreMap} from "maplibre-gl";','import {Map as MapLibreMap,LngLat} from "maplibre-gl";\nimport {CAMERA_SETTINGS_EVENT,loadCameraSettings,setCameraFovDeg} from "./camera_settings.mjs";',1)
s=s.replace('const WORLD_MINIMAP_FOLLOW_STORAGE="arondight45WorldMinimapFollowV1";\n','',1)
# Constructor fields.
s=s.replace('this.minimapQueries=0;this.minimapFollowLook=loadBool(WORLD_MINIMAP_FOLLOW_STORAGE,true);this.lookSurfaceInstalled=false;', 'this.minimapQueries=0;this.minimapExpanded=false;this.minimapPointers=new Map();this.minimapPinch=null;this.lastMinimapTapMs=0;this.viewFovDeg=loadCameraSettings().fpvFovDeg;this.lookSurfaceInstalled=false;this.shotImpacts=[];',1)
s=s.replace('this.installUi();this.installLookHud();this.installFreeLookSurface();', 'this.installUi();this.installLookHud();this.installFreeLookSurface();window.addEventListener(CAMERA_SETTINGS_EVENT,event=>{const value=Number(event.detail?.fpvFovDeg);if(Number.isFinite(value)){this.viewFovDeg=clamp(value,50,120);this.minimapLastDrawMs=-Infinity;}});',1)
# CSS: expandable, clearly north-up minimap.
s=s.replace('#worldLookHud .world-look-stage{position:absolute;left:9px;right:9px;top:22px;bottom:8px;perspective:110px;border-radius:50%;overflow:hidden;border:1px solid #8cdcff55;background:#071522;pointer-events:none}', '#worldLookHud .world-look-stage{position:absolute;left:9px;right:9px;top:22px;bottom:8px;perspective:110px;border-radius:50%;overflow:hidden;border:1px solid #8cdcff55;background:#071522;pointer-events:none}\n      #worldLookHud.expanded{width:min(72vw,560px);height:min(68dvh,430px);border-radius:18px;background:#071522f8}#worldLookHud.expanded .world-look-stage{border-radius:16px}#worldLookHud.expanded .world-look-cardinal{font-size:10px}',1)
# Remove obsolete dataset cleanup if present.
s=s.replace('delete viewport.dataset.worldMinimapFollow;','')
# Replace minimap HUD interaction method wholesale.
start=s.index('  installLookHud(){')
end=s.index('  installFreeLookSurface(){',start)
new_method='''  installLookHud(){
    const viewport=$("viewport");if(!viewport||this.lookHud)return;
    const hud=document.createElement("div");hud.id="worldLookHud";hud.setAttribute("aria-label","North-up WORLD minimap and 360 degree camera control");hud.innerHTML='<div class="world-look-title"><span>MINIMAP · N↑</span><span data-world-look-readout>SNAP</span></div><div class="world-look-stage"><canvas class="world-mini-canvas" width="196" height="172" aria-label="North-up WORLD mini map"></canvas><div class="world-look-plane"></div><div class="world-look-drone"><i class="world-look-nose"></i></div></div><b class="world-look-cardinal world-look-n">N</b><b class="world-look-cardinal world-look-e">E</b><b class="world-look-cardinal world-look-s">S</b><b class="world-look-cardinal world-look-w">W</b>';
    viewport.appendChild(hud);this.lookHud=hud;this.lookPlane=hud.querySelector(".world-look-plane");this.lookReadout=hud.querySelector("[data-world-look-readout]");this.minimapCanvas=hud.querySelector(".world-mini-canvas");this.minimapCtx=this.minimapCanvas?.getContext("2d");const legend=document.createElement("div");legend.id="worldMapLegend";legend.innerHTML='<span class="legend-water"><i></i>WATER</span><span class="legend-green"><i></i>GREEN</span><span class="legend-road"><i></i>ROADS</span><span class="legend-building"><i></i>BUILDINGS</span>';viewport.appendChild(legend);this.mapLegend=legend;
    const pointerDistance=()=>{const points=[...this.minimapPointers.values()];return points.length>=2?Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y):0;};
    const update=event=>{
      if(!this.minimapPointers.has(event.pointerId))return;this.minimapPointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
      if(this.minimapPointers.size>=2){const distance=pointerDistance();if(!this.minimapPinch)this.minimapPinch={distance:Math.max(1,distance),fov:this.viewFovDeg};const ratio=distance/Math.max(1,this.minimapPinch.distance),next=clamp(this.minimapPinch.fov/Math.max(.35,ratio),50,120);this.viewFovDeg=next;setCameraFovDeg(next);this.minimapLastDrawMs=-Infinity;event.preventDefault();return;}
      if(!this.lookDragging||event.pointerId!==this.lookPointer?.id)return;const dx=event.clientX-this.lookPointer.x,dy=event.clientY-this.lookPointer.y;this.lookYawDeg=((this.lookPointer.yaw+dx*.85+540)%360)-180;this.lookPitchDeg=clamp(this.lookPointer.pitch-dy*.62,-75,60);this.lookSnapping=false;this.lookPointer.moved=Math.max(this.lookPointer.moved||0,Math.hypot(dx,dy));this.renderLookHud();event.preventDefault();
    };
    hud.addEventListener("pointerdown",event=>{event.preventDefault();try{hud.setPointerCapture?.(event.pointerId);}catch{}this.minimapPointers.set(event.pointerId,{x:event.clientX,y:event.clientY});if(this.minimapPointers.size===1){this.lookDragging=true;this.lookSnapping=false;this.lookPointer={id:event.pointerId,x:event.clientX,y:event.clientY,yaw:this.lookYawDeg,pitch:this.lookPitchDeg,moved:0};}else{this.minimapPinch={distance:Math.max(1,pointerDistance()),fov:this.viewFovDeg};this.lookDragging=false;this.lookPointer=null;}this.renderLookHud();},{passive:false});
    hud.addEventListener("pointermove",update,{passive:false});
    const release=event=>{if(!this.minimapPointers.has(event.pointerId))return;const wasPrimary=event.pointerId===this.lookPointer?.id,moved=this.lookPointer?.moved||0;this.minimapPointers.delete(event.pointerId);try{hud.releasePointerCapture?.(event.pointerId);}catch{}if(this.minimapPointers.size<2)this.minimapPinch=null;if(wasPrimary){this.lookDragging=false;this.lookPointer=null;if(!this.keepLookOrientation)this.lookSnapping=true;if(moved<8){const now=performance.now();if(now-this.lastMinimapTapMs<360)this.toggleMinimapExpanded();this.lastMinimapTapMs=now;}}this.renderLookHud();event.preventDefault();};
    hud.addEventListener("pointerup",release,{passive:false});hud.addEventListener("pointercancel",release,{passive:false});hud.addEventListener("dblclick",event=>{event.preventDefault();this.toggleMinimapExpanded();});this.renderLookHud();
  }
'''
s=s[:start]+new_method+s[end:]
# Free visible viewport is reserved for the fire control, so free-look is controlled only by minimap.
start=s.index('  installFreeLookSurface(){')
end=s.index('  renderLookHud(){',start)
s=s[:start]+'''  installFreeLookSurface(){this.lookSurfaceInstalled=true;}\n'''+s[end:]
# Render HUD unified across FPV/follow/third; add expand helper, remove follow setting.
s=s.replace('const cameraMode=$("viewport")?.dataset.cameraMode||"follow";if(this.lookReadout)this.lookReadout.textContent=cameraMode==="fpv"?"FPV LOCK":this.lookDragging?`${Math.round(this.lookYawDeg)}°`:this.keepLookOrientation?`KEEP · ${Math.round(this.lookYawDeg)}°`:this.lookSnapping?"SNAP ↺":"SNAP";', 'if(this.lookReadout)this.lookReadout.textContent=this.lookDragging?`${Math.round(this.lookYawDeg)}°`:this.keepLookOrientation?`KEEP · ${Math.round(this.lookYawDeg)}°`:this.lookSnapping?"SNAP ↺":"SNAP";',1)
s=s.replace('viewport.dataset.worldMinimapFollow=this.minimapFollowLook?"1":"0";','viewport.dataset.worldMinimapMode="north";viewport.dataset.worldMinimapBearing="0.00";',1)
# Replace obsolete setter with expansion helper.
s=re.sub(r'  setMinimapFollowLook\(value\)\{.*?\}\n  resetLook', '''  toggleMinimapExpanded(){this.minimapExpanded=!this.minimapExpanded;this.lookHud?.classList.toggle("expanded",this.minimapExpanded);if(this.minimapCanvas){this.minimapCanvas.width=this.minimapExpanded?392:196;this.minimapCanvas.height=this.minimapExpanded?344:172;}this.minimapLastDrawMs=-Infinity;this.drawMinimap(performance.now());return this.minimapExpanded;}\n  resetLook''', s, count=1)
# FPV free-look keeps the exact physical eye position and changes orientation only.
old='''    this.stepLook(performance.now());const mode=$("viewport")?.dataset.cameraMode||"follow";if(mode==="fpv")return;if(Math.abs(this.lookYawDeg)<.001&&Math.abs(this.lookPitchDeg)<.001)return;const airframe=this.airframeFor(scene);if(!airframe)return;const yaw=THREE.MathUtils.degToRad(this.lookYawDeg),pitch=THREE.MathUtils.degToRad(this.lookPitchDeg),worldUp=new THREE.Vector3(0,0,1);\n    const target=airframe.position.clone();target.z+=.10;const relative=camera.position.clone().sub(target);relative.applyAxisAngle(worldUp,-yaw);const radial=relative.clone().normalize(),right=new THREE.Vector3().crossVectors(radial,worldUp);if(right.lengthSq()>.0001)relative.applyAxisAngle(right.normalize(),pitch);camera.position.copy(target).add(relative);camera.up.copy(worldUp);camera.lookAt(target);\n'''
new='''    this.stepLook(performance.now());const mode=$("viewport")?.dataset.cameraMode||"follow";if(Math.abs(this.lookYawDeg)<.001&&Math.abs(this.lookPitchDeg)<.001)return;const airframe=this.airframeFor(scene);if(!airframe)return;const yaw=THREE.MathUtils.degToRad(this.lookYawDeg),pitch=THREE.MathUtils.degToRad(this.lookPitchDeg),worldUp=new THREE.Vector3(0,0,1);\n    if(mode==="fpv"){const dir=new THREE.Vector3();camera.getWorldDirection(dir).normalize();const up=camera.up.clone().normalize(),yawQ=new THREE.Quaternion().setFromAxisAngle(worldUp,-yaw);dir.applyQuaternion(yawQ);up.applyQuaternion(yawQ);const right=new THREE.Vector3().crossVectors(dir,up).normalize(),pitchQ=new THREE.Quaternion().setFromAxisAngle(right,pitch);dir.applyQuaternion(pitchQ);up.applyQuaternion(pitchQ);camera.up.copy(up.normalize());camera.lookAt(camera.position.clone().addScaledVector(dir,4));return;}\n    const target=airframe.position.clone();target.z+=.10;const relative=camera.position.clone().sub(target);relative.applyAxisAngle(worldUp,-yaw);const radial=relative.clone().normalize(),right=new THREE.Vector3().crossVectors(radial,worldUp);if(right.lengthSq()>.0001)relative.applyAxisAngle(right.normalize(),pitch);camera.position.copy(target).add(relative);camera.up.copy(worldUp);camera.lookAt(target);\n'''
assert old in s; s=s.replace(old,new,1)
# Minimap is always north-up and its scale follows the shared FOV value.
s=s.replace('mainBearing=Number(viewport?.dataset.worldMapBearing||0),miniBearing=this.minimapFollowLook&&Number.isFinite(mainBearing)?mainBearing:0,rad=-miniBearing*Math.PI/180,c=Math.cos(rad),si=Math.sin(rad),radius=clamp(55+Math.max(0,position.z)*2,60,170),scale=w/(radius*2),baseY=h*.62;', 'miniBearing=0,rad=0,c=1,si=0,fovScale=clamp(this.viewFovDeg/105,.48,1.25),radius=clamp((55+Math.max(0,position.z)*2)*fovScale,42,190),scale=w/(radius*2),baseY=h*.62;',1)
s=s.replace('ctx.fillText(this.minimapFollowLook?"CAM":"N",7,15);', 'ctx.fillText("N↑",7,15);',1)
s=s.replace('viewport.dataset.worldMinimapMode=this.minimapFollowLook?"camera":"north";viewport.dataset.worldMinimapBearing=miniBearing.toFixed(2);', 'viewport.dataset.worldMinimapMode="north";viewport.dataset.worldMinimapBearing="0.00";viewport.dataset.worldMinimapFov=this.viewFovDeg.toFixed(1);',1)
# Create render-only MapLibre shot-impact source/layer.
s=s.replace('this.addBuildings();this.configureMinimapLayers();return this.map;', 'this.addBuildings();this.addShotImpactLayer();this.configureMinimapLayers();return this.map;',1)
insert='''  addShotImpactLayer(){\n    if(!this.map||this.map.getSource("arondight45-shot-impacts"))return;try{this.map.addSource("arondight45-shot-impacts",{type:"geojson",data:{type:"FeatureCollection",features:[]}});this.map.addLayer({id:"arondight45-shot-impacts",type:"circle",source:"arondight45-shot-impacts",paint:{"circle-radius":["interpolate",["linear"],["zoom"],14,2,20,6],"circle-color":"#ffc65a","circle-stroke-color":"#fff5bf","circle-stroke-width":1.2,"circle-opacity":["get","opacity"]}});}catch(error){console.warn("WORLD visual impact layer unavailable:",error);}\n  }\n  refreshShotImpacts(){const now=performance.now();this.shotImpacts=this.shotImpacts.filter(item=>now-item.born<1800);const source=this.map?.getSource("arondight45-shot-impacts");if(source?.setData)source.setData({type:"FeatureCollection",features:this.shotImpacts.map(item=>({type:"Feature",properties:{opacity:clamp(1-(now-item.born)/1800,0,1)},geometry:{type:"Point",coordinates:item.coordinates}}))});}\n  addVisualShotImpact(x,y,rect){if(!this.active||!this.map||!rect)return false;try{const point=this.map.unproject([x,y]);if(!Number.isFinite(point?.lng)||!Number.isFinite(point?.lat))return false;this.shotImpacts.push({coordinates:[point.lng,point.lat],born:performance.now()});if(this.shotImpacts.length>24)this.shotImpacts.shift();this.refreshShotImpacts();setTimeout(()=>this.refreshShotImpacts(),1850);return true;}catch{return false;}}\n'''
pos=s.index('  async createMap('); s=s[:pos]+insert+s[pos:]
# Exact MapLibre FPV eye from physical THREE camera, not target+zoom reconstruction.
start=s.index('  syncMapCamera(camera){')
end=s.index('  renderReal(scene,camera){',start)
new_sync='''  syncMapCamera(camera){
    if(!this.active||!this.map||!Number.isFinite(this.originLon)||!Number.isFinite(this.originLat))return;
    const now=performance.now(),viewport=$("viewport"),cameraMode=viewport.dataset.cameraMode||"follow",forceMode=cameraMode!==(viewport.dataset.worldCameraMode||""),fpv=cameraMode==="fpv";
    if(forceMode&&viewport.dataset.worldCameraMode)this.resetLook(true);
    if(!forceMode&&!fpv&&now-this.lastMapSyncMs<this.mapFrameMs)return;
    const p=camera.position,dir=new THREE.Vector3(),actualUp=new THREE.Vector3(0,1,0).applyQuaternion(camera.quaternion).normalize();camera.getWorldDirection(dir).normalize();
    const rect=viewport.getBoundingClientRect(),height=Math.max(1,rect.height),verticalFov=clamp(camera.fov,10,120);if(Math.abs(this.map.getVerticalFieldOfView()-verticalFov)>.001)this.map.setVerticalFieldOfView(verticalFov);
    let focusDistance=10;if(fpv)focusDistance=fpvTargetDistanceMeters(this.originLat,height,verticalFov,WORLD_MAP_MAX_ZOOM);else if(dir.z<-.02&&p.z>0){const ground=-p.z/dir.z;if(Number.isFinite(ground)&&ground>0)focusDistance=clamp(ground,2,250);}
    const target=fpv?forwardTarget(p,dir,focusDistance):p.clone().addScaledVector(dir,focusDistance),center=metersToLngLat(this.originLon,this.originLat,target.x,target.y),horizontal=Math.hypot(dir.x,dir.y);
    const bearing=THREE.MathUtils.radToDeg(Math.atan2(dir.x,dir.y)),pitch=clamp(90+THREE.MathUtils.radToDeg(Math.atan2(dir.z,Math.max(1e-6,horizontal))),0,fpv?WORLD_MAP_MAX_PITCH:85);let roll=0;if(horizontal>.02){const worldUp=new THREE.Vector3(0,0,1),right0=new THREE.Vector3().crossVectors(dir,worldUp).normalize(),up0=new THREE.Vector3().crossVectors(right0,dir).normalize();roll=THREE.MathUtils.radToDeg(Math.atan2(dir.dot(new THREE.Vector3().crossVectors(up0,actualUp)),up0.dot(actualUp)));}
    const size=`${Math.round(rect.width)}x${Math.round(rect.height)}`;if(size!==this.lastViewportSize){this.lastViewportSize=size;this.map.resize();}
    let view,zoom;
    if(fpv){
      if(typeof this.map.calculateCameraOptionsFromTo!=="function")throw Error("MapLibre eye/target camera API unavailable");const eye=metersToLngLat(this.originLon,this.originLat,p.x,p.y),options=this.map.calculateCameraOptionsFromTo(new LngLat(eye[0],eye[1]),p.z,new LngLat(center[0],center[1]),target.z);zoom=Number(options.zoom);view={...options,center,elevation:target.z,roll:clamp(roll,-85,85)};viewport.dataset.worldMapEye=`${eye[0].toFixed(7)},${eye[1].toFixed(7)}`;viewport.dataset.worldMapEyeElevation=p.z.toFixed(3);
    }else{const metersPerPixel=Math.max(.01,2*focusDistance*Math.tan(THREE.MathUtils.degToRad(verticalFov)/2)/height),cosLat=Math.max(.05,Math.cos(center[1]*Math.PI/180));zoom=clamp(Math.log2(156543.03392804097*cosLat/metersPerPixel),14,WORLD_MAP_MAX_ZOOM);view={center,elevation:0,zoom,bearing,pitch,roll:clamp(roll,-85,85)};delete viewport.dataset.worldMapEye;delete viewport.dataset.worldMapEyeElevation;}
    const last=this.lastMapView;if(last&&!forceMode&&!fpv){const latM=(center[1]-last.center[1])*Math.PI/180*EARTH_RADIUS_M,lonM=(center[0]-last.center[0])*Math.PI/180*EARTH_RADIUS_M*Math.max(.05,Math.cos(center[1]*Math.PI/180)),centerDelta=Math.hypot(latM,lonM);if(centerDelta<WORLD_MAP_CENTER_EPS_M&&Math.abs(zoom-last.zoom)<WORLD_MAP_ZOOM_EPS&&angularDistanceDeg(bearing,last.bearing)<WORLD_MAP_ANGLE_EPS_DEG&&Math.abs(pitch-last.pitch)<WORLD_MAP_ANGLE_EPS_DEG&&angularDistanceDeg(view.roll,last.roll)<WORLD_MAP_ANGLE_EPS_DEG){this.lastMapSyncMs=now;return;}}
    this.lastMapSyncMs=now;this.lastMapView={...view,center:[...center]};this.map.jumpTo(view);this.mapUpdates++;viewport.dataset.worldCameraMode=cameraMode;viewport.dataset.worldMapSyncMode=fpv?"rigid-eye-target":"budgeted-ground-target";viewport.dataset.worldMapCenter=`${center[0].toFixed(7)},${center[1].toFixed(7)}`;viewport.dataset.worldMapTargetElevation=Number(view.elevation||0).toFixed(3);viewport.dataset.worldMapZoom=Number(view.zoom||zoom||0).toFixed(4);viewport.dataset.worldMapPitch=Number(view.pitch??pitch).toFixed(3);viewport.dataset.worldMapBearing=Number(view.bearing??bearing).toFixed(3);viewport.dataset.worldMapUpdates=String(this.mapUpdates);
  }
'''
s=s[:start]+new_sync+s[end:]
# Activation datasets no longer expose minimap-follow setting.
s=s.replace('viewport.dataset.worldMinimapFollow=this.minimapFollowLook?"1":"0";','')
p.write_text(s)

# ---- Simulator integration: logbook, fire FX, selection/callout suppression, shared visual FOV. ----
p=Path('sim/simulator.mjs'); s=p.read_text()
s=s.replace('import {HybridMotorSound} from "./motor_sound.mjs";','import {HybridMotorSound} from "./motor_sound.mjs";\nimport {FlightLogbook} from "./flight_logbook.mjs";\nimport {installFlightFireFx} from "./flight_fire_fx.mjs";',1)
# FOV setting scales all view modes while preserving existing defaults at 105° setting.
s=s.replace('''    if(camera.fov!==62){camera.fov=62;camera.updateProjectionMatrix();}''','''    const thirdFov=clamp(62*(cameraSettings.fpvFovDeg/105),35,100);if(Math.abs(camera.fov-thirdFov)>.01){camera.fov=thirdFov;camera.updateProjectionMatrix();}''',1)
s=s.replace('''  if(camera.fov!==52){camera.fov=52;camera.updateProjectionMatrix();}\n}''','''  const followFov=clamp(52*(cameraSettings.fpvFovDeg/105),30,90);if(Math.abs(camera.fov-followFov)>.01){camera.fov=followFov;camera.updateProjectionMatrix();}\n  $("viewport").dataset.cameraFov=String(camera.fov);\n}''',1)
# Mobile selection/callout suppression scoped to the flight surface; form fields remain selectable.
s=s.replace('''  body.solo-flight{overflow:hidden!important;background:#000!important}\n''','''  body.solo-flight{overflow:hidden!important;background:#000!important;-webkit-user-select:none!important;user-select:none!important;-webkit-touch-callout:none!important;-webkit-tap-highlight-color:transparent!important}\n  body.solo-flight #viewport,body.solo-flight #viewport *{-webkit-user-select:none!important;user-select:none!important;-webkit-touch-callout:none!important;-webkit-tap-highlight-color:transparent!important}\n  body.solo-flight dialog input,body.solo-flight dialog textarea{-webkit-user-select:text!important;user-select:text!important;-webkit-touch-callout:default!important}\n''',1)
# Mount logbook/fire after settings and camera settings exist.
s=s.replace('''mountCameraSettings({dialog:soloSettingsMount.dialog,onChange:applyCameraSettings});\nasync function enterSolo(){''','''mountCameraSettings({dialog:soloSettingsMount.dialog,onChange:applyCameraSettings});\nconst flightLogbook=new FlightLogbook({parent:$("soloTopbar")});globalThis.__arondightFlightLogbook=flightLogbook;\ninstallFlightFireFx({viewport:$("viewport"),scene,camera,worldBridge:globalThis.__arondightRealWorld,isEnabled:()=>soloMode});\nconst flightSelectionBlocked=target=>target instanceof Element&&Boolean(target.closest("dialog,input,textarea,select,option"));for(const type of ["selectstart","contextmenu","dragstart"])document.addEventListener(type,event=>{if(soloMode&&event.target instanceof Element&&event.target.closest("#viewport")&&!flightSelectionBlocked(event.target))event.preventDefault();},{passive:false});\nlet pendingDisarmReason=null;\nasync function enterSolo(){''',1)
# Kill/exit/reset reasons.
s=s.replace('''async function exitSolo(){\n  setSoloHeightAxis(0);''','''async function exitSolo(){\n  pendingDisarmReason="SOLO_EXIT";setSoloHeightAxis(0);''',1)
s=s.replace('''function resetSoloSimulation(){const restart=mode==="sim"&&Boolean(backend);stopRun();''','''function resetSoloSimulation(){flightLogbook.finish("SIM_RESET");const restart=mode==="sim"&&Boolean(backend);stopRun();''',1)
s=s.replace('''$("soloKill").onclick=()=>{setSoloHeightAxis(0);''','''$("soloKill").onclick=()=>{pendingDisarmReason="KILL_SWITCH";setSoloHeightAxis(0);''',1)
# Log actual FC transitions at existing 100 Hz session cadence.
old='''function recordSession(){\n  const state=physics.state();\n  sessionLog.push({time_s:simTime,motor1_us:latest.motors[0],motor2_us:latest.motors[1],motor3_us:latest.motors[2],motor4_us:latest.motors[3],x:state.x,y:state.y,z:state.z,vx:state.vx,vy:state.vy,vz:state.vz,roll_deg:state.attitude[0],pitch_deg:state.attitude[1],yaw_deg:state.attitude[2],fc_roll_deg:latest.attitude[0],fc_pitch_deg:latest.attitude[1],fc_yaw_deg:latest.attitude[2],battery_v:state.battery_v,current_a:state.current_a,fc_state:latest.state});\n}\n'''
new='''function recordSession(){\n  const state=physics.state(),fault=latest.state>>8&255,armed=Boolean(latest.state&STATE_ARMED),remoteFresh=inputSource!=="remote"||Boolean(remoteLink.current());\n  sessionLog.push({time_s:simTime,motor1_us:latest.motors[0],motor2_us:latest.motors[1],motor3_us:latest.motors[2],motor4_us:latest.motors[3],x:state.x,y:state.y,z:state.z,vx:state.vx,vy:state.vy,vz:state.vz,roll_deg:state.attitude[0],pitch_deg:state.attitude[1],yaw_deg:state.attitude[2],fc_roll_deg:latest.attitude[0],fc_pitch_deg:latest.attitude[1],fc_yaw_deg:latest.attitude[2],battery_v:state.battery_v,current_a:state.current_a,fc_state:latest.state,navigation_valid:latestNavigation.valid,nav_velocity_valid:latestNavigation.velocityValid,nav_agl_valid:latestNavigation.aglValid});\n  const disarmReason=pendingDisarmReason||(fault?`FC_FAULT_${fault}`:!remoteFresh?"CONTROL_LINK_LOSS":!arm?"ARM_COMMAND_LOW":"FC_DISARM");\n  flightLogbook.observe({simTime,armed,disarmReason,x:state.x,y:state.y,z:state.z,vx:state.vx,vy:state.vy,vz:state.vz,yawDeg:latest.attitude[2],speed:state.speed,agl:latestNavigation.agl,aglValid:latestNavigation.aglValid,batteryV:state.battery_v,worldMode:globalThis.__arondightRealWorld?.active?"real":"training",worldOrigin:globalThis.__arondightRealWorld?.active?{latitude:globalThis.__arondightRealWorld.originLat,longitude:globalThis.__arondightRealWorld.originLon}:null});\n  if(!armed)pendingDisarmReason=null;\n}\n'''
assert old in s; s=s.replace(old,new,1)
# Reset path finishes a live log before sim time is rewound.
s=s.replace('''function resetSimulation(initial=null){\n  phoneSettings''','''function resetSimulation(initial=null){\n  if(typeof flightLogbook!=="undefined")flightLogbook.finish("SIM_RESET");\n  phoneSettings''',1)
p.write_text(s)

# Controller mobile interaction should never enter Safari text-selection/callout mode.
p=Path('sim/controller.mjs'); s=p.read_text()
anchor='''const $=id=>document.getElementById(id);\n'''
insert='''const $=id=>document.getElementById(id);\nconst mobileControlStyle=document.createElement("style");mobileControlStyle.textContent=`html,body,button,.stick,.game-height-pad{-webkit-user-select:none!important;user-select:none!important;-webkit-touch-callout:none!important;-webkit-tap-highlight-color:transparent!important}input,textarea{-webkit-user-select:text!important;user-select:text!important}`;document.head.appendChild(mobileControlStyle);for(const type of ["selectstart","contextmenu","dragstart"])document.addEventListener(type,event=>{if(event.target instanceof Element&&!event.target.closest("input,textarea"))event.preventDefault();},{passive:false});\n'''
assert anchor in s; s=s.replace(anchor,insert,1); p.write_text(s)
