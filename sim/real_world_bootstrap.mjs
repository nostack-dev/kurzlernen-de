import * as THREE from "three";
import {Map as MapLibreMap,LngLat} from "maplibre-gl";
import {CAMERA_SETTINGS_EVENT,loadCameraSettings,setCameraFovDeg} from "./camera_settings.mjs";
import {fpvTargetDistanceMeters,forwardTarget} from "./world_camera_math.mjs";

const OPENFREEMAP_STYLE="https://tiles.openfreemap.org/styles/liberty";
const MODE_STORAGE="arondight45WorldModeV2";
const EARTH_RADIUS_M=6378137;
const WORLD_MAP_FRAME_MS=1000/30;
const WORLD_MAP_FRAME_MS_CONSTRAINED=1000/20;
const WORLD_MAP_FRAME_MS_CRITICAL=1000/15;
const WORLD_FPV_DIRECT_DEDUP_MS=8;
const WORLD_PERF_WINDOW_MS=1000;
const WORLD_FPS_CONSTRAINED=50;
const WORLD_FPS_CRITICAL=36;
const WORLD_FPS_RECOVER=57;
const WORLD_MAP_MAX_ZOOM=20;
const WORLD_MAP_MAX_PITCH=120;
const WORLD_MAP_PIXEL_RATIO=1.0;
const WORLD_FLIGHT_PIXEL_RATIO=1.25;
const WORLD_MAP_CENTER_EPS_M=.06;
const WORLD_MAP_ZOOM_EPS=.008;
const WORLD_MAP_ANGLE_EPS_DEG=.18;
const WORLD_GRID_STORAGE="arondight45WorldGridV1";
const WORLD_KEEP_LOOK_STORAGE="arondight45WorldKeepLookV1";
const WORLD_MINIMAP_QUERY_MS=1000;
const WORLD_MINIMAP_DRAW_MS=125;
const WORLD_MINIMAP_MAX_FEATURES=80;
const WORLD_LOOK_SNAP_RATE=8;
const $=id=>document.getElementById(id);
const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
const angularDistanceDeg=(a,b)=>Math.abs((((a-b)+540)%360)-180);
const loadBool=(key,fallback)=>{try{const raw=localStorage.getItem(key);return raw===null?fallback:raw==="1";}catch{return fallback;}};
function lngLatToMeters(originLon,originLat,longitude,latitude){
  const north=(latitude-originLat)*Math.PI/180*EARTH_RADIUS_M;
  const east=(longitude-originLon)*Math.PI/180*EARTH_RADIUS_M*Math.max(.01,Math.cos(originLat*Math.PI/180));
  return[east,north];
}
function geometryPaths(geometry){
  if(!geometry)return[];const c=geometry.coordinates||[];
  if(geometry.type==="LineString")return[c];
  if(geometry.type==="MultiLineString")return c;
  if(geometry.type==="Polygon")return c.length?[c[0]]:[];
  if(geometry.type==="MultiPolygon")return c.map(poly=>poly?.[0]).filter(Boolean);
  return[];
}
function pointInRing(x,y,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const xi=ring[i][0],yi=ring[i][1],xj=ring[j][0],yj=ring[j][1],cross=(yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/((yj-yi)||1e-12)+xi;if(cross)inside=!inside;}return inside;}

function geolocate(){
  if(!navigator.geolocation)return Promise.reject(Error("Geolocation is not available in this browser"));
  return new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,error=>reject(Error(error.message||"Location permission failed")),{enableHighAccuracy:true,timeout:20000,maximumAge:0}));
}

function metersToLngLat(originLon,originLat,eastM,northM){
  const latRad=originLat*Math.PI/180;
  const latitude=originLat+(northM/EARTH_RADIUS_M)*180/Math.PI;
  const longitude=originLon+(eastM/(EARTH_RADIUS_M*Math.max(.01,Math.cos(latRad))))*180/Math.PI;
  return[longitude,latitude];
}

class RealWorldBridge{
  constructor(){
    this.active=false;this.loading=false;this.map=null;this.originLon=null;this.originLat=null;this.threeRenderer=null;this.threeScene=null;this.threeCamera=null;this.flightPixelRatio=null;this.flightShadowEnabled=null;this.geoContainer=null;this.worldCard=null;this.savedBackground=null;this.savedFog=null;this.trainingObjects=new Set();this.frameVisibility=new Map();this.lastLocation=null;this.lastViewportSize="";this.lastMapSyncMs=-Infinity;this.lastMapView=null;this.realFrames=0;this.presentationFrameSerial=0;this.lastFpvSyncFrameSerial=-1;this.mapUpdates=0;this.gridEnabled=loadBool(WORLD_GRID_STORAGE,true);this.keepLookOrientation=loadBool(WORLD_KEEP_LOOK_STORAGE,false);this.lookYawDeg=0;this.lookPitchDeg=0;this.lookDragging=false;this.lookSnapping=false;this.lookPointer=null;this.lookFrameMs=performance.now();this.lookHud=null;this.lookPlane=null;this.lookReadout=null;this.mapLegend=null;this.minimapCanvas=null;this.minimapCtx=null;this.minimapFeatures=[];this.minimapLayerIds=[];this.minimapLastQueryMs=-Infinity;this.minimapLastDrawMs=-Infinity;this.minimapQueries=0;this.minimapExpanded=false;this.minimapPointers=new Map();this.minimapPinch=null;this.lastMinimapTapMs=0;this.viewFovDeg=loadCameraSettings().fpvFovDeg;this.lookSurfaceInstalled=false;this.worldShotPoint=new THREE.Vector3();this.worldShotNormal=new THREE.Vector3(0,0,1);this.worldShotHit={point:this.worldShotPoint,worldNormal:this.worldShotNormal};this.worldShotQueries=0;this.airframe=null;this.mapFrameMs=WORLD_MAP_FRAME_MS;this.perfMode="nominal";this.perfWindowStart=performance.now();this.perfFrames=0;this.perfGoodWindows=0;this.flightFps=60;
    this.installUi();this.installLookHud();this.installFreeLookSurface();window.addEventListener(CAMERA_SETTINGS_EVENT,event=>{const value=Number(event.detail?.fpvFovDeg);if(Number.isFinite(value)){this.viewFovDeg=clamp(value,50,120);this.minimapLastDrawMs=-Infinity;}});
  }
  installUi(){
    const panel=document.querySelector(".panel");if(!panel)return;
    const card=document.createElement("div");card.className="card real-world-card";card.innerHTML=`
      <h2>World / geospatial twin</h2>
      <label>World<select id="worldMode"><option value="training">TRAINING RANGE</option><option value="real">REAL WORLD · MY LOCATION</option></select></label>
      <div id="realWorldConfig" hidden>
        <div class="row"><button id="useMyLocation" class="primary">USE MY GPS LOCATION</button></div>
        <div class="help">OpenFreeMap + OpenStreetMap render the real map directly in this browser. No account, API key or billing setup is required. OSM building heights are visual/geospatial data only; the flight controller, motors, sensors and rigid-body physics stay on the same local SI digital-twin path, and map geometry is never silently treated as collision truth.</div>
      </div>
      <div id="realWorldStatus" class="statusline">TRAINING RANGE · local metric world</div>`;
    const remote=document.querySelector(".remote-card");panel.insertBefore(card,remote||panel.children[3]||null);this.worldCard=card;
    const style=document.createElement("style");style.textContent=`
      #geoViewport{position:absolute;inset:0;z-index:0;overflow:hidden;background:linear-gradient(180deg,#081a2d 0%,#103453 48%,#173d5c 68%,#142638 100%)}
      #geoViewport .maplibregl-map,#geoViewport .maplibregl-canvas-container{position:absolute;inset:0;width:100%!important;height:100%!important;overflow:hidden}
      #geoViewport .maplibregl-canvas{position:absolute;left:0;top:0;width:100%!important;height:100%!important}
      #geoViewport .geo-attribution{position:absolute;right:4px;bottom:3px;z-index:4;padding:2px 5px;border-radius:4px;background:#07101acc;color:#d8e0ea;font:8px/1.25 system-ui,-apple-system,sans-serif;pointer-events:none}
      #worldLookHud{display:none;position:absolute;z-index:4;right:max(10px,env(safe-area-inset-right));top:max(48px,calc(env(safe-area-inset-top) + 42px));width:116px;height:116px;border:1px solid #8cdcff88;border-radius:16px;background:#071522ee;box-shadow:0 8px 26px #0008,inset 0 0 22px #2f9bd322;touch-action:none;user-select:none;overflow:hidden;color:#dff7ff}
      body.solo-flight #viewport[data-world-mode="real"] #worldLookHud{display:block}
      #worldLookHud .world-look-title{position:absolute;left:7px;right:7px;top:5px;z-index:3;display:flex;justify-content:space-between;font:800 7px/1.1 system-ui,-apple-system,sans-serif;letter-spacing:.09em;color:#aeeaff;pointer-events:none}
      #worldLookHud .world-look-stage{position:absolute;left:9px;right:9px;top:22px;bottom:8px;perspective:110px;border-radius:50%;overflow:hidden;border:1px solid #8cdcff55;background:#071522;pointer-events:none}
      #worldLookHud.expanded{width:min(72vw,560px);height:min(68dvh,430px);border-radius:18px;background:#071522f8}#worldLookHud.expanded .world-look-stage{border-radius:16px}#worldLookHud.expanded .world-look-cardinal{font-size:10px}
      #worldLookHud .world-mini-canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
      #worldLookHud .world-look-plane{position:absolute;inset:17px 8px 5px;border:1px solid #7bdcff30;transform-origin:50% 58%;transform:rotateX(60deg) rotateZ(0deg);opacity:.22;box-shadow:0 0 14px #55cfff18}
      #worldLookHud .world-look-drone{position:absolute;left:50%;top:51%;width:23px;height:23px;transform:translate(-50%,-50%);filter:drop-shadow(0 0 5px #a9eeff);pointer-events:none}
      #worldLookHud .world-look-drone:before,#worldLookHud .world-look-drone:after{content:"";position:absolute;left:2px;right:2px;top:10px;height:3px;border-radius:3px;background:#d8f7ff}
      #worldLookHud .world-look-drone:after{transform:rotate(90deg)}
      #worldLookHud .world-look-nose{position:absolute;left:9px;top:-4px;width:0;height:0;border-left:3px solid transparent;border-right:3px solid transparent;border-bottom:8px solid #ff5c76}
      #worldLookHud .world-look-cardinal{position:absolute;font:900 7px system-ui,-apple-system,sans-serif;color:#72d9ff;opacity:.85;pointer-events:none}.world-look-n{top:22px;left:53px}.world-look-e{top:62px;right:12px}.world-look-s{bottom:9px;left:54px}.world-look-w{top:62px;left:12px}
      #worldMapLegend{display:none;position:absolute;z-index:4;left:max(10px,env(safe-area-inset-left));top:max(52px,calc(env(safe-area-inset-top) + 46px));padding:5px 7px;border-radius:8px;background:#071522e8;border:1px solid #ffffff25;color:#dce9f2;font:800 7px/1.4 system-ui,-apple-system,sans-serif;letter-spacing:.03em;pointer-events:none}
      body.solo-flight #viewport[data-world-mode="real"] #worldMapLegend{display:grid;grid-template-columns:auto auto;gap:2px 7px}
      #worldMapLegend i{width:10px;height:7px;border-radius:2px;display:inline-block;margin-right:4px;box-shadow:0 0 0 1px #ffffff24}.legend-water i{background:#086a9d}.legend-green i{background:#2f7044}.legend-road i{background:#ffd34f}.legend-building i{background:#dbe4e9}
      body.solo-flight #viewport[data-world-mode="real"] #soloTopbar span,body.solo-flight #viewport[data-world-mode="real"] #soloTopbar button,body.solo-flight #viewport[data-world-mode="real"] #soloRaceHud,body.solo-flight #viewport[data-world-mode="real"] #soloClearance,body.solo-flight #viewport[data-world-mode="real"] .solo-action{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
      #realWorldStatus{line-height:1.4}
    `;document.head.appendChild(style);
    const mode=$("worldMode"),config=$("realWorldConfig"),use=$("useMyLocation");
    mode.value="training";
    const viewport=$("viewport");if(viewport){viewport.dataset.worldMode="training";delete viewport.dataset.worldProvider;delete viewport.dataset.worldRenderPath;delete viewport.dataset.worldLatitude;delete viewport.dataset.worldLongitude;delete viewport.dataset.worldCameraMode;delete viewport.dataset.worldMapCenter;delete viewport.dataset.worldMapZoom;delete viewport.dataset.worldMapPitch;delete viewport.dataset.worldMapBearing;delete viewport.dataset.worldMapSyncMode;delete viewport.dataset.worldMapTargetElevation;delete viewport.dataset.worldThreeFrames;delete viewport.dataset.worldMapUpdates;delete viewport.dataset.worldMapFpsCap;delete viewport.dataset.worldMapPixelRatio;delete viewport.dataset.worldFlightPixelRatio;delete viewport.dataset.worldSymbolsRemoved;delete viewport.dataset.worldLookYaw;delete viewport.dataset.worldLookPitch;delete viewport.dataset.worldLookKeepEnabled;delete viewport.dataset.worldGridEnabled;delete viewport.dataset.worldFlightFps;delete viewport.dataset.worldPerfMode;delete viewport.dataset.worldPaletteLayers;delete viewport.dataset.worldMinimapMode;delete viewport.dataset.worldMinimapBearing;delete viewport.dataset.worldMinimapFeatures;delete viewport.dataset.worldMinimapQueries;delete viewport.dataset.worldShotQueries;}
    mode.onchange=()=>{config.hidden=mode.value!=="real";if(mode.value==="training")this.deactivate();else this.activate().catch(error=>this.fail(error));};
    use.onclick=()=>this.activate().catch(error=>this.fail(error));
    try{localStorage.setItem(MODE_STORAGE,"training");}catch{}
  }
  installLookHud(){
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
    hud.addEventListener("pointerup",release,{passive:false});hud.addEventListener("pointercancel",release,{passive:false});this.renderLookHud();
  }
  installFreeLookSurface(){this.lookSurfaceInstalled=true;}
  renderLookHud(){
    if(this.lookPlane)this.lookPlane.style.transform=`rotateX(${clamp(60-this.lookPitchDeg*.28,38,78)}deg) rotateZ(${-this.lookYawDeg}deg)`;
    if(this.lookReadout)this.lookReadout.textContent=this.lookDragging?`${Math.round(this.lookYawDeg)}°`:this.keepLookOrientation?`KEEP · ${Math.round(this.lookYawDeg)}°`:this.lookSnapping?"SNAP ↺":"SNAP";
    const viewport=$("viewport");if(viewport){viewport.dataset.worldLookYaw=this.lookYawDeg.toFixed(2);viewport.dataset.worldLookPitch=this.lookPitchDeg.toFixed(2);viewport.dataset.worldLookKeepEnabled=this.keepLookOrientation?"1":"0";viewport.dataset.worldGridEnabled=this.gridEnabled?"1":"0";viewport.dataset.worldMinimapMode="north";viewport.dataset.worldMinimapBearing="0.00";}
  }
  setGridEnabled(value){this.gridEnabled=Boolean(value);try{localStorage.setItem(WORLD_GRID_STORAGE,this.gridEnabled?"1":"0");}catch{}this.renderLookHud();return this.gridEnabled;}
  setKeepLookOrientation(value){this.keepLookOrientation=Boolean(value);try{localStorage.setItem(WORLD_KEEP_LOOK_STORAGE,this.keepLookOrientation?"1":"0");}catch{}if(!this.keepLookOrientation&&!this.lookDragging&&(Math.abs(this.lookYawDeg)>.05||Math.abs(this.lookPitchDeg)>.05))this.lookSnapping=true;this.renderLookHud();return this.keepLookOrientation;}
  toggleMinimapExpanded(){this.minimapExpanded=!this.minimapExpanded;this.lookHud?.classList.toggle("expanded",this.minimapExpanded);if(this.minimapCanvas){this.minimapCanvas.width=this.minimapExpanded?392:196;this.minimapCanvas.height=this.minimapExpanded?344:172;}this.minimapLastDrawMs=-Infinity;this.drawMinimap(performance.now());return this.minimapExpanded;}
  resetLook(immediate=false){this.lookDragging=false;this.lookPointer=null;if(immediate){this.lookYawDeg=0;this.lookPitchDeg=0;this.lookSnapping=false;}else this.lookSnapping=true;this.renderLookHud();}
  stepLook(now){const dt=clamp((now-this.lookFrameMs)/1000,0,.05);this.lookFrameMs=now;if(this.lookSnapping&&!this.lookDragging){const decay=Math.exp(-WORLD_LOOK_SNAP_RATE*dt);this.lookYawDeg*=decay;this.lookPitchDeg*=decay;if(Math.abs(this.lookYawDeg)<.08&&Math.abs(this.lookPitchDeg)<.08){this.lookYawDeg=0;this.lookPitchDeg=0;this.lookSnapping=false;}this.renderLookHud();}}
  airframeFor(scene){if(this.airframe?.parent)return this.airframe;this.airframe=null;scene.traverse(node=>{if(!this.airframe&&node.userData?.arondightAirframe)this.airframe=node;});return this.airframe;}
  applyLookCamera(scene,camera){
    this.stepLook(performance.now());const mode=$("viewport")?.dataset.cameraMode||"follow";if(Math.abs(this.lookYawDeg)<.001&&Math.abs(this.lookPitchDeg)<.001)return;const airframe=this.airframeFor(scene);if(!airframe)return;const yaw=THREE.MathUtils.degToRad(this.lookYawDeg),pitch=THREE.MathUtils.degToRad(this.lookPitchDeg),worldUp=new THREE.Vector3(0,0,1);
    if(mode==="fpv"){const dir=new THREE.Vector3();camera.getWorldDirection(dir).normalize();const up=camera.up.clone().normalize(),yawQ=new THREE.Quaternion().setFromAxisAngle(worldUp,-yaw);dir.applyQuaternion(yawQ);up.applyQuaternion(yawQ);const right=new THREE.Vector3().crossVectors(dir,up).normalize(),pitchQ=new THREE.Quaternion().setFromAxisAngle(right,pitch);dir.applyQuaternion(pitchQ);up.applyQuaternion(pitchQ);camera.up.copy(up.normalize());camera.lookAt(camera.position.clone().addScaledVector(dir,4));return;}
    const target=airframe.position.clone();target.z+=.10;const relative=camera.position.clone().sub(target);relative.applyAxisAngle(worldUp,-yaw);const radial=relative.clone().normalize(),right=new THREE.Vector3().crossVectors(radial,worldUp);if(right.lengthSq()>.0001)relative.applyAxisAngle(right.normalize(),pitch);camera.position.copy(target).add(relative);camera.up.copy(worldUp);camera.lookAt(target);
  }
  configureMinimapLayers(){
    if(!this.map)return;const layers=this.map.getStyle()?.layers||[],allowed=new Set(["water","waterway","landcover","landuse","transportation"]);this.minimapLayerIds=layers.filter(layer=>layer.id==="arondight45-buildings-3d"||(layer.type!=="symbol"&&allowed.has(String(layer["source-layer"]||"").toLowerCase()))).map(layer=>layer.id);
  }
  cacheMinimapFeatures(now){
    const interval=this.perfMode==="critical"?WORLD_MINIMAP_QUERY_MS*2:WORLD_MINIMAP_QUERY_MS;if(!this.map||!this.minimapLayerIds.length||now-this.minimapLastQueryMs<interval)return;this.minimapLastQueryMs=now;this.minimapQueries++;const cached=[];
    try{for(const feature of this.map.queryRenderedFeatures(undefined,{layers:this.minimapLayerIds})){if(cached.length>=WORLD_MINIMAP_MAX_FEATURES)break;const source=String(feature.sourceLayer||feature.layer?.["source-layer"]||"").toLowerCase(),id=String(feature.layer?.id||"").toLowerCase(),geometryType=String(feature.geometry?.type||"");let kind="";if(source==="water"||source==="waterway")kind="water";else if(source==="building"||id==="arondight45-buildings-3d")kind="building";else if(source==="transportation")kind="road";else if((source==="landcover"||source==="landuse")&&/park|wood|forest|grass|garden|pitch|meadow|farmland|scrub/.test(id))kind="green";if(!kind)continue;const paths=geometryPaths(feature.geometry).map(path=>{const step=Math.max(1,Math.ceil(path.length/28));return path.filter((_,i)=>i%step===0).map(point=>[Number(point[0]),Number(point[1])]).filter(point=>point.every(Number.isFinite));}).filter(path=>path.length>=2);if(!paths.length)continue;cached.push({kind,geometryType,height:kind==="building"?clamp(Number(feature.properties?.render_height??feature.properties?.height??8)||8,2,80):0,paths});}}catch(error){console.warn("WORLD mini-map cache warning:",error);}this.minimapFeatures=cached;const viewport=$("viewport");if(viewport){viewport.dataset.worldMinimapFeatures=String(cached.length);viewport.dataset.worldMinimapQueries=String(this.minimapQueries);}
  }
  drawMinimap(now){
    if(!this.active||!this.minimapCtx||!this.minimapCanvas||!Number.isFinite(this.originLon)||!Number.isFinite(this.originLat))return;const drawInterval=this.perfMode==="critical"?WORLD_MINIMAP_DRAW_MS*2:WORLD_MINIMAP_DRAW_MS;if(now-this.minimapLastDrawMs<drawInterval)return;this.minimapLastDrawMs=now;this.cacheMinimapFeatures(now);const airframe=this.airframeFor(this.threeScene);if(!airframe)return;
    const canvas=this.minimapCanvas,ctx=this.minimapCtx,w=canvas.width,h=canvas.height,position=airframe.position,viewport=$("viewport"),miniBearing=0,rad=0,c=1,si=0,fovScale=clamp(this.viewFovDeg/105,.48,1.25),radius=clamp((55+Math.max(0,position.z)*2)*fovScale,42,190),scale=w/(radius*2),baseY=h*.62;
    const projectLocal=(east,north,height=0)=>{const dx=east-position.x,dy=north-position.y,rx=dx*c-dy*si,ry=dx*si+dy*c;return[w/2+rx*scale,baseY-ry*scale*.60-height*scale*.13];};
    const project=(lon,lat,height=0)=>{const [east,north]=lngLatToMeters(this.originLon,this.originLat,lon,lat);return projectLocal(east,north,height);};
    const gradient=ctx.createLinearGradient(0,0,0,h);gradient.addColorStop(0,"#18384d");gradient.addColorStop(1,"#071522");ctx.fillStyle=gradient;ctx.fillRect(0,0,w,h);
    if(this.gridEnabled){ctx.lineWidth=1;for(let v=-Math.ceil(radius/20)*20;v<=radius;v+=20){for(const axis of [0,1]){const a=axis?projectLocal(position.x-radius,position.y+v):projectLocal(position.x+v,position.y-radius),b=axis?projectLocal(position.x+radius,position.y+v):projectLocal(position.x+v,position.y+radius);ctx.strokeStyle=v===0?"rgba(157,233,255,.35)":"rgba(103,188,215,.14)";ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke();}}}
    for(const feature of this.minimapFeatures){for(const path of feature.paths){const bottom=path.map(point=>project(point[0],point[1],0)),polygon=feature.geometryType.includes("Polygon");if(feature.kind==="road"){ctx.strokeStyle="#e3c56b";ctx.lineWidth=2;ctx.beginPath();bottom.forEach((point,i)=>i?ctx.lineTo(...point):ctx.moveTo(...point));ctx.stroke();continue;}if(feature.kind==="water"){ctx.fillStyle="rgba(35,125,176,.74)";ctx.strokeStyle="#55b7df";ctx.lineWidth=1.5;ctx.beginPath();bottom.forEach((point,i)=>i?ctx.lineTo(...point):ctx.moveTo(...point));if(polygon){ctx.closePath();ctx.fill();}ctx.stroke();continue;}if(feature.kind==="green"){ctx.fillStyle="rgba(79,123,85,.66)";ctx.beginPath();bottom.forEach((point,i)=>i?ctx.lineTo(...point):ctx.moveTo(...point));ctx.closePath();ctx.fill();continue;}const top=path.map(point=>project(point[0],point[1],feature.height));ctx.fillStyle="rgba(189,203,211,.66)";ctx.strokeStyle="rgba(226,240,247,.82)";ctx.lineWidth=1;ctx.beginPath();top.forEach((point,i)=>i?ctx.lineTo(...point):ctx.moveTo(...point));ctx.closePath();ctx.fill();ctx.stroke();for(let i=0;i<Math.min(bottom.length,10);i+=Math.max(1,Math.floor(bottom.length/4))){ctx.strokeStyle="rgba(154,177,190,.38)";ctx.beginPath();ctx.moveTo(...bottom[i]);ctx.lineTo(...top[i]);ctx.stroke();}}}
    const forward=new THREE.Vector3(-1,0,0).applyQuaternion(airframe.quaternion),airBearing=THREE.MathUtils.radToDeg(Math.atan2(forward.x,forward.y)),rel=(airBearing-miniBearing)*Math.PI/180,cx=w/2,cy=baseY;ctx.save();ctx.translate(cx,cy);ctx.rotate(rel);ctx.fillStyle="#ff5c76";ctx.strokeStyle="#ffffff";ctx.lineWidth=1.4;ctx.beginPath();ctx.moveTo(0,-9);ctx.lineTo(6,7);ctx.lineTo(0,4);ctx.lineTo(-6,7);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();ctx.fillStyle="#d8f7ff";ctx.font="800 12px system-ui";ctx.fillText("N↑",7,15);ctx.fillStyle="#9bc5d8";ctx.font="700 9px ui-monospace,monospace";ctx.fillText(`${Math.round(position.z)}m`,7,h-7);if(viewport){viewport.dataset.worldMinimapMode="north";viewport.dataset.worldMinimapBearing="0.00";viewport.dataset.worldMinimapFov=this.viewFovDeg.toFixed(1);}
  }
  status(text,kind=""){const el=$("realWorldStatus");if(!el)return;el.textContent=text;el.className=`statusline ${kind}`;}
  fail(error){this.loading=false;this.active=false;this.status(`REAL WORLD unavailable · ${error?.message||error}`,"bad");}
  attachThree(renderer,scene,camera){
    if(this.threeRenderer===renderer&&this.threeScene===scene&&this.threeCamera===camera)return;
    this.threeRenderer=renderer;this.threeScene=scene;this.threeCamera=camera;if(this.flightPixelRatio===null)this.flightPixelRatio=renderer.getPixelRatio();if(this.flightShadowEnabled===null)this.flightShadowEnabled=renderer.shadowMap.enabled;
    renderer.domElement.style.position="absolute";renderer.domElement.style.inset="0";renderer.domElement.style.zIndex="2";renderer.domElement.style.pointerEvents="none";
  }
  identifyTrainingObjects(scene){
    for(const child of scene.children){
      if(this.trainingObjects.has(child))continue;
      let training=Boolean(child.isGridHelper);
      if(child.isMesh&&child.geometry?.type==="BoxGeometry"){const p=child.geometry.parameters||{};if((p.width||0)>100&&(p.height||0)>100)training=true;}
      if(child.isGroup){let race=false;child.traverse(node=>{if(node.userData?.normal&&node.userData?.rightAxis)race=true;});if(race)training=true;}
      if(training)this.trainingObjects.add(child);
    }
  }
  hideTrainingWorld(scene){this.identifyTrainingObjects(scene);this.frameVisibility.clear();for(const child of this.trainingObjects){this.frameVisibility.set(child,child.visible);if(child.isGridHelper){child.visible=this.gridEnabled;continue;}child.visible=false;}for(const child of scene.children){if(child.userData?.flightFireDecal&&!child.userData.flightFireWorld){this.frameVisibility.set(child,child.visible);child.visible=false;}}}
  restoreTrainingWorld(){for(const[child,visible]of this.frameVisibility)child.visible=visible;this.frameVisibility.clear();}
  applyFlightPalette(){
    if(!this.map)return 0;let changed=0;const layers=this.map.getStyle()?.layers||[];
    const set=(id,property,value)=>{try{this.map.setPaintProperty(id,property,value);changed++;}catch{}};
    for(const layer of layers){const source=String(layer["source-layer"]||"").toLowerCase(),id=String(layer.id||"").toLowerCase();
      if(layer.type==="background"){set(layer.id,"background-color","#243440");continue;}
      if(layer.type==="fill"&&source==="water"){set(layer.id,"fill-color","#086a9d");set(layer.id,"fill-opacity",1);continue;}
      if(layer.type==="line"&&(source==="waterway"||source==="water")){set(layer.id,"line-color","#5bc4ed");set(layer.id,"line-opacity",1);continue;}
      if(layer.type==="fill"&&(source==="landcover"||source==="landuse")){const green=/park|wood|forest|grass|garden|pitch|meadow|farmland|scrub/.test(id),industry=/industrial|commercial|retail|parking/.test(id);set(layer.id,"fill-color",green?"#2f7044":industry?"#645751":"#46565f");set(layer.id,"fill-opacity",.96);continue;}
      if(layer.type==="fill"&&source==="building"){set(layer.id,"fill-color","#c7d5dc");set(layer.id,"fill-opacity",.88);continue;}
      if(layer.type==="line"&&source==="transportation"){const major=/motorway|trunk|primary/.test(id),mid=/secondary|tertiary/.test(id);set(layer.id,"line-color",major?"#ffd34f":mid?"#eee4a8":"#c9d2d7");set(layer.id,"line-opacity",1);set(layer.id,"line-width",major?3.6:mid?2.6:1.5);continue;}
      if(layer.type==="line"&&source==="boundary"){set(layer.id,"line-color","#92a8b7");set(layer.id,"line-opacity",.8);}
    }
    const viewport=$("viewport");if(viewport)viewport.dataset.worldPaletteLayers=String(changed);return changed;
  }
  stripFlightClutter(){
    if(!this.map)return 0;
    const clutterIds=(this.map.getStyle()?.layers||[]).filter(layer=>layer.type==="symbol"||(layer.type==="fill"&&String(layer["source-layer"]||"").toLowerCase()==="building")).map(layer=>layer.id);
    let removed=0;
    for(const id of clutterIds){try{this.map.removeLayer(id);removed++;}catch(error){console.warn("OpenFreeMap flight-clutter layer removal warning:",id,error);}}
    const viewport=$("viewport");if(viewport)viewport.dataset.worldSymbolsRemoved=String(removed);
    return removed;
  }
  addBuildings(){
    if(!this.map||this.map.getLayer("arondight45-buildings-3d"))return;
    const style=this.map.getStyle(),sourceId=Object.entries(style.sources||{}).find(([,source])=>source?.type==="vector")?.[0];
    if(!sourceId){console.warn("OpenFreeMap style has no vector source for 3D buildings");return;}
    const before=(style.layers||[]).find(layer=>layer.type==="symbol")?.id;
    const height=["coalesce",["to-number",["get","render_height"]],8],layer={id:"arondight45-buildings-3d",type:"fill-extrusion",source:sourceId,"source-layer":"building",minzoom:14,paint:{"fill-extrusion-color":["interpolate",["linear"],height,0,"#80929e",12,"#aebec7",35,"#dbe4e9",80,"#f2f5f6"],"fill-extrusion-height":height,"fill-extrusion-base":["coalesce",["to-number",["get","render_min_height"]],0],"fill-extrusion-opacity":.96,"fill-extrusion-vertical-gradient":true}};
    try{if(before)this.map.addLayer(layer,before);else this.map.addLayer(layer);}catch(error){console.warn("OpenFreeMap 3D building layer unavailable:",error);}
  }
  addVisualShotImpact(x,y,rect,ray){
    if(!this.active||!this.map||!rect||!ray?.origin||!ray?.direction||!Number.isFinite(this.originLon)||!Number.isFinite(this.originLat))return null;const o=ray.origin,d=ray.direction;let bestT=Infinity,bestNx=0,bestNy=0,bestNz=1;const consider=(t,nx,ny,nz)=>{if(!(t>0)||t>=bestT||!Number.isFinite(t))return;const nLen=Math.hypot(nx,ny,nz)||1;nx/=nLen;ny/=nLen;nz/=nLen;if(nx*d.x+ny*d.y+nz*d.z>0){nx=-nx;ny=-ny;nz=-nz;}bestT=t;bestNx=nx;bestNy=ny;bestNz=nz;};
    try{
      if(this.map.getLayer("arondight45-buildings-3d")){this.worldShotQueries++;const qx=clamp(Number(x)||0,0,Math.max(1,rect.width)),qy=clamp(Number(y)||0,0,Math.max(1,rect.height)),features=this.map.queryRenderedFeatures([qx,qy],{layers:["arondight45-buildings-3d"]});for(const feature of features){const top=clamp(Number(feature.properties?.render_height??feature.properties?.height??8)||8,.5,300),base=clamp(Number(feature.properties?.render_min_height??feature.properties?.min_height??0)||0,0,top);for(const path of geometryPaths(feature.geometry)){if(path.length<3)continue;const ring=path.map(point=>lngLatToMeters(this.originLon,this.originLat,Number(point[0]),Number(point[1]))).filter(point=>point.every(Number.isFinite));if(ring.length<3)continue;if(Math.abs(d.z)>1e-7){const t=(top-o.z)/d.z,px=o.x+d.x*t,py=o.y+d.y*t;if(t>0&&t<bestT&&pointInRing(px,py,ring))consider(t,0,0,1);}for(let i=0,j=ring.length-1;i<ring.length;j=i++){const ax=ring[j][0],ay=ring[j][1],bx=ring[i][0],by=ring[i][1],sx=bx-ax,sy=by-ay,den=d.x*sy-d.y*sx;if(Math.abs(den)<1e-9)continue;const qpx=ax-o.x,qpy=ay-o.y,t=(qpx*sy-qpy*sx)/den,u=(qpx*d.y-qpy*d.x)/den;if(t<=0||t>=bestT||u<0||u>1)continue;const z=o.z+d.z*t;if(z<base-.02||z>top+.02)continue;consider(t,sy,-sx,0);}}}}
    }catch(error){console.warn("WORLD visual shot query warning:",error);}
    if(d.z<-.0001){const groundT=-o.z/d.z;if(groundT>0&&groundT<bestT&&groundT<1200)consider(groundT,0,0,1);}if(!Number.isFinite(bestT))return null;this.worldShotPoint.set(o.x+d.x*bestT,o.y+d.y*bestT,o.z+d.z*bestT);this.worldShotNormal.set(bestNx,bestNy,bestNz);const viewport=$("viewport");if(viewport)viewport.dataset.worldShotQueries=String(this.worldShotQueries);return this.worldShotHit;
  }
  async createMap(longitude,latitude){
    if(this.map){this.geoContainer.hidden=false;this.map.resize();this.map.jumpTo({center:[longitude,latitude],zoom:19,pitch:55,bearing:0});return this.map;}
    const viewport=$("viewport"),container=document.createElement("div");container.id="geoViewport";container.hidden=true;viewport.insertBefore(container,viewport.firstChild);this.geoContainer=container;
    this.map=new MapLibreMap({container,style:OPENFREEMAP_STYLE,center:[longitude,latitude],zoom:19,pitch:55,bearing:0,roll:0,maxPitch:WORLD_MAP_MAX_PITCH,maxZoom:WORLD_MAP_MAX_ZOOM,interactive:false,attributionControl:false,maplibreLogo:false,fadeDuration:0,renderWorldCopies:false,centerClampedToGround:false,pixelRatio:Math.min(devicePixelRatio||1,WORLD_MAP_PIXEL_RATIO),maxTileCacheZoomLevels:2,maxCanvasSize:[2048,2048],cancelPendingTileRequestsWhileZooming:true,refreshExpiredTiles:false,validateStyle:false,crossSourceCollisions:false,trackResize:false,reduceMotion:true,canvasContextAttributes:{antialias:false,powerPreference:"high-performance",desynchronized:true}});
    const attribution=document.createElement("div");attribution.className="geo-attribution";attribution.textContent="© OpenFreeMap · © OpenMapTiles · © OpenStreetMap contributors";container.appendChild(attribution);
    this.map.on("error",event=>console.warn("OpenFreeMap render warning:",event?.error||event));
    await Promise.race([new Promise(resolve=>this.map.once("load",resolve)),new Promise((_,reject)=>setTimeout(()=>reject(Error("OpenFreeMap style load timeout")),20000))]);
    this.applyFlightPalette();this.stripFlightClutter();
    try{this.map.setSky({"sky-color":"#071b2e","sky-horizon-blend":.52,"horizon-color":"#6e93aa","horizon-fog-blend":.34,"fog-color":"#365f79","fog-ground-blend":.12});}catch(error){console.warn("OpenFreeMap sky contrast unavailable:",error);}
    try{this.map.setLight?.({anchor:"viewport",position:[1.35,210,32],color:"#fff3dd",intensity:.78});}catch(error){console.warn("OpenFreeMap extrusion lighting unavailable:",error);}
    this.addBuildings();this.configureMinimapLayers();return this.map;
  }
  async activate(){
    if(this.loading)return;if(this.active)return;
    this.loading=true;this.status("REAL WORLD · requesting high-accuracy GPS permission…","warn");
    try{
      const fix=await geolocate();this.lastLocation=fix;const {latitude,longitude,accuracy}=fix.coords;
      if(!Number.isFinite(latitude)||!Number.isFinite(longitude))throw Error("GPS returned no valid latitude/longitude");
      this.originLat=latitude;this.originLon=longitude;this.status(`GPS ${latitude.toFixed(6)}, ${longitude.toFixed(6)} · ±${Math.round(accuracy||0)} m · loading OpenFreeMap…`,"warn");
      await this.createMap(longitude,latitude);this.active=true;this.loading=false;
      if(!this.threeRenderer)throw Error("Flight renderer is not ready");
      this.lastMapSyncMs=-Infinity;this.lastMapView=null;this.mapUpdates=0;this.presentationFrameSerial=0;this.lastFpvSyncFrameSerial=-1;this.perfWindowStart=performance.now();this.perfFrames=0;this.perfGoodWindows=0;this.perfMode="nominal";this.mapFrameMs=WORLD_MAP_FRAME_MS;this.worldShotQueries=0;
      this.threeRenderer.setPixelRatio(Math.min(this.flightPixelRatio||devicePixelRatio||1,WORLD_FLIGHT_PIXEL_RATIO));this.threeRenderer.shadowMap.enabled=false;
      this.threeRenderer.domElement.style.visibility="visible";this.threeRenderer.domElement.style.display="block";this.geoContainer.hidden=false;
      const viewport=$("viewport");viewport.dataset.worldMode="real";viewport.dataset.worldProvider="openfreemap";viewport.dataset.worldRenderPath="shared-three-renderer";viewport.dataset.worldLatitude=String(latitude);viewport.dataset.worldLongitude=String(longitude);viewport.dataset.worldMapFpsCap="30";viewport.dataset.worldMapPixelRatio=String(WORLD_MAP_PIXEL_RATIO);viewport.dataset.worldFlightPixelRatio=String(Math.min(this.flightPixelRatio||devicePixelRatio||1,WORLD_FLIGHT_PIXEL_RATIO));viewport.dataset.worldMapUpdates="0";viewport.dataset.worldGridEnabled=this.gridEnabled?"1":"0";viewport.dataset.worldLookKeepEnabled=this.keepLookOrientation?"1":"0";viewport.dataset.worldPerfMode=this.perfMode;viewport.dataset.worldFlightFps="0";viewport.dataset.worldMinimapQueries="0";viewport.dataset.worldShotQueries="0";this.minimapLastQueryMs=-Infinity;this.minimapLastDrawMs=-Infinity;this.minimapQueries=0;this.renderLookHud();
      const mode=$("worldMode"),config=$("realWorldConfig");if(mode)mode.value="real";if(config)config.hidden=false;
      this.status(`REAL WORLD LIVE · OpenFreeMap · GPS ${latitude.toFixed(6)}, ${longitude.toFixed(6)} · ±${Math.round(accuracy||0)} m`,"good");try{localStorage.setItem(MODE_STORAGE,"real");}catch{}
    }catch(error){this.loading=false;throw error;}
  }
  deactivate(){
    this.active=false;this.loading=false;this.resetLook(true);if(this.geoContainer)this.geoContainer.hidden=true;if(this.threeRenderer){this.threeRenderer.domElement.style.visibility="visible";this.threeRenderer.domElement.style.display="block";this.threeRenderer.setClearAlpha(1);if(this.flightPixelRatio!==null)this.threeRenderer.setPixelRatio(this.flightPixelRatio);if(this.flightShadowEnabled!==null)this.threeRenderer.shadowMap.enabled=this.flightShadowEnabled;}if(this.threeScene){this.restoreTrainingWorld();this.threeScene.traverse(node=>{if(node.userData?.flightFireDecal&&node.userData.flightFireWorld)node.visible=false;});if(this.savedBackground!==null)this.threeScene.background=this.savedBackground;if(this.savedFog!==null)this.threeScene.fog=this.savedFog;}
    const viewport=$("viewport");if(viewport){viewport.dataset.worldMode="training";delete viewport.dataset.worldProvider;delete viewport.dataset.worldRenderPath;delete viewport.dataset.worldLatitude;delete viewport.dataset.worldLongitude;delete viewport.dataset.worldCameraMode;delete viewport.dataset.worldMapCenter;delete viewport.dataset.worldMapZoom;delete viewport.dataset.worldMapPitch;delete viewport.dataset.worldMapBearing;delete viewport.dataset.worldMapSyncMode;delete viewport.dataset.worldMapTargetElevation;delete viewport.dataset.worldThreeFrames;delete viewport.dataset.worldMapUpdates;delete viewport.dataset.worldMapFpsCap;delete viewport.dataset.worldMapPixelRatio;delete viewport.dataset.worldFlightPixelRatio;delete viewport.dataset.worldSymbolsRemoved;delete viewport.dataset.worldLookYaw;delete viewport.dataset.worldLookPitch;delete viewport.dataset.worldLookKeepEnabled;delete viewport.dataset.worldGridEnabled;delete viewport.dataset.worldFlightFps;delete viewport.dataset.worldPerfMode;delete viewport.dataset.worldPaletteLayers;delete viewport.dataset.worldShotQueries;}
    const mode=$("worldMode"),config=$("realWorldConfig");if(mode)mode.value="training";if(config)config.hidden=true;this.status("TRAINING RANGE · local metric world");try{localStorage.setItem(MODE_STORAGE,"training");}catch{}
  }
  setPerfMode(mode){
    if(this.perfMode===mode)return;this.perfMode=mode;this.mapFrameMs=mode==="critical"?WORLD_MAP_FRAME_MS_CRITICAL:mode==="constrained"?WORLD_MAP_FRAME_MS_CONSTRAINED:WORLD_MAP_FRAME_MS;
    if(this.threeRenderer){const ceiling=Math.min(this.flightPixelRatio||devicePixelRatio||1,WORLD_FLIGHT_PIXEL_RATIO),ratio=mode==="critical"?Math.min(ceiling,.75):mode==="constrained"?Math.min(ceiling,1):ceiling;this.threeRenderer.setPixelRatio(ratio);$("viewport").dataset.worldFlightPixelRatio=String(ratio);}
    const viewport=$("viewport");if(viewport){viewport.dataset.worldPerfMode=mode;viewport.dataset.worldMapFpsCap=String(Math.round(1000/this.mapFrameMs));}
  }
  trackFlightPerformance(now){
    this.perfFrames++;const elapsed=now-this.perfWindowStart;if(elapsed<WORLD_PERF_WINDOW_MS)return;this.flightFps=this.perfFrames*1000/Math.max(1,elapsed);this.perfFrames=0;this.perfWindowStart=now;const viewport=$("viewport");if(viewport)viewport.dataset.worldFlightFps=this.flightFps.toFixed(1);
    if(this.flightFps<WORLD_FPS_CRITICAL){this.perfGoodWindows=0;this.setPerfMode("critical");return;}if(this.flightFps<WORLD_FPS_CONSTRAINED){this.perfGoodWindows=0;this.setPerfMode("constrained");return;}if(this.flightFps>WORLD_FPS_RECOVER){this.perfGoodWindows++;if(this.perfGoodWindows>=3)this.setPerfMode("nominal");}else this.perfGoodWindows=0;
  }
  syncMapCamera(camera,frameSerial=null){
    if(!this.active||!this.map||!Number.isFinite(this.originLon)||!Number.isFinite(this.originLat))return;
    const now=performance.now(),viewport=$("viewport"),cameraMode=viewport.dataset.cameraMode||"follow",forceMode=cameraMode!==(viewport.dataset.worldCameraMode||""),fpv=cameraMode==="fpv";
    if(forceMode&&viewport.dataset.worldCameraMode)this.resetLook(true);
    if(fpv){
      if(frameSerial!==null){if(!forceMode&&frameSerial===this.lastFpvSyncFrameSerial)return;this.lastFpvSyncFrameSerial=frameSerial;}
      else if(!forceMode&&now-this.lastMapSyncMs<WORLD_FPV_DIRECT_DEDUP_MS)return;
    }else if(!forceMode&&now-this.lastMapSyncMs<this.mapFrameMs)return;
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
  renderReal(scene,camera){
    this.presentationFrameSerial++;this.trackFlightPerformance(performance.now());const basePosition=camera.position.clone(),baseQuaternion=camera.quaternion.clone(),baseUp=camera.up.clone();
    this.applyLookCamera(scene,camera);this.syncMapCamera(camera,this.presentationFrameSerial);this.drawMinimap(performance.now());const renderer=this.threeRenderer;if(!renderer){camera.position.copy(basePosition);camera.quaternion.copy(baseQuaternion);camera.up.copy(baseUp);return;}
    this.savedBackground=scene.background;this.savedFog=scene.fog;this.hideTrainingWorld(scene);scene.background=null;scene.fog=null;
    const clearAlpha=renderer.getClearAlpha();renderer.setClearAlpha(0);
    try{renderer.render(scene,camera);this.realFrames++;$("viewport").dataset.worldThreeFrames=String(this.realFrames);}finally{renderer.setClearAlpha(clearAlpha);scene.background=this.savedBackground;scene.fog=this.savedFog;this.restoreTrainingWorld();camera.position.copy(basePosition);camera.quaternion.copy(baseQuaternion);camera.up.copy(baseUp);camera.updateMatrixWorld();}
  }
  renderFrame(renderer,scene,camera){
    this.attachThree(renderer,scene,camera);
    if(!this.active)return false;
    this.renderReal(scene,camera);
    return true;
  }
}

const bridge=new RealWorldBridge();
globalThis.__arondightRealWorld=bridge;

await import("./simulator.mjs");