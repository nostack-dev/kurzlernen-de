import * as THREE from "three";
import {Map as MapLibreMap} from "maplibre-gl";

const OPENFREEMAP_STYLE="https://tiles.openfreemap.org/styles/liberty";
const MODE_STORAGE="arondight45WorldModeV2";
const EARTH_RADIUS_M=6378137;
const WORLD_MAP_FRAME_MS=1000/30;
const WORLD_MAP_FRAME_MS_CONSTRAINED=1000/20;
const WORLD_MAP_FRAME_MS_CRITICAL=1000/15;
const WORLD_PERF_WINDOW_MS=1000;
const WORLD_FPS_CONSTRAINED=50;
const WORLD_FPS_CRITICAL=36;
const WORLD_FPS_RECOVER=57;
const WORLD_MAP_MAX_ZOOM=20;
const WORLD_MAP_PIXEL_RATIO=1.0;
const WORLD_FLIGHT_PIXEL_RATIO=1.25;
const WORLD_MAP_CENTER_EPS_M=.06;
const WORLD_MAP_ZOOM_EPS=.008;
const WORLD_MAP_ANGLE_EPS_DEG=.18;
const WORLD_GRID_STORAGE="arondight45WorldGridV1";
const WORLD_KEEP_LOOK_STORAGE="arondight45WorldKeepLookV1";
const WORLD_MINIMAP_FOLLOW_STORAGE="arondight45WorldMinimapFollowV1";
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
    this.active=false;this.loading=false;this.map=null;this.originLon=null;this.originLat=null;this.threeRenderer=null;this.threeScene=null;this.threeCamera=null;this.flightPixelRatio=null;this.flightShadowEnabled=null;this.geoContainer=null;this.worldCard=null;this.savedBackground=null;this.savedFog=null;this.trainingObjects=new Set();this.frameVisibility=new Map();this.lastLocation=null;this.lastViewportSize="";this.lastMapSyncMs=-Infinity;this.lastMapView=null;this.realFrames=0;this.mapUpdates=0;this.gridEnabled=loadBool(WORLD_GRID_STORAGE,true);this.keepLookOrientation=loadBool(WORLD_KEEP_LOOK_STORAGE,false);this.lookYawDeg=0;this.lookPitchDeg=0;this.lookDragging=false;this.lookSnapping=false;this.lookPointer=null;this.lookFrameMs=performance.now();this.lookHud=null;this.lookPlane=null;this.lookReadout=null;this.mapLegend=null;this.minimapCanvas=null;this.minimapCtx=null;this.minimapFeatures=[];this.minimapLayerIds=[];this.minimapLastQueryMs=-Infinity;this.minimapLastDrawMs=-Infinity;this.minimapQueries=0;this.minimapFollowLook=loadBool(WORLD_MINIMAP_FOLLOW_STORAGE,true);this.lookSurfaceInstalled=false;this.airframe=null;this.mapFrameMs=WORLD_MAP_FRAME_MS;this.perfMode="nominal";this.perfWindowStart=performance.now();this.perfFrames=0;this.perfGoodWindows=0;this.flightFps=60;
    this.installUi();this.installLookHud();this.installFreeLookSurface();
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
      #worldLookHud .world-mini-canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
      #worldLookHud .world-look-plane{position:absolute;inset:17px 8px 5px;border:1px solid #7bdcff30;transform-origin:50% 58%;transform:rotateX(60deg) rotateZ(0deg);opacity:.22;box-shadow:0 0 14px #55cfff18}
      #worldLookHud .world-look-drone{position:absolute;left:50%;top:51%;width:23px;height:23px;transform:translate(-50%,-50%);filter:drop-shadow(0 0 5px #a9eeff);pointer-events:none}
      #worldLookHud .world-look-drone:before,#worldLookHud .world-look-drone:after{content:"";position:absolute;left:2px;right:2px;top:10px;height:3px;border-radius:3px;background:#d8f7ff}
      #worldLookHud .world-look-drone:after{transform:rotate(90deg)}
      #worldLookHud .world-look-nose{position:absolute;left:9px;top:-4px;width:0;height:0;border-left:3px solid transparent;border-right:3px solid transparent;border-bottom:8px solid #ff5c76}
      #worldLookHud .world-look-cardinal{position:absolute;font:900 7px system-ui,-apple-system,sans-serif;color:#72d9ff;opacity:.85;pointer-events:none}.world-look-n{top:22px;left:53px}.world-look-e{top:62px;right:12px}.world-look-s{bottom:9px;left:54px}.world-look-w{top:62px;left:12px}
      #worldMapLegend{display:none;position:absolute;z-index:4;left:max(10px,env(safe-area-inset-left));top:max(52px,calc(env(safe-area-inset-top) + 46px));padding:5px 7px;border-radius:8px;background:#071522e8;border:1px solid #ffffff25;color:#dce9f2;font:800 7px/1.4 system-ui,-apple-system,sans-serif;letter-spacing:.03em;pointer-events:none}
      body.solo-flight #viewport[data-world-mode="real"] #worldMapLegend{display:grid;grid-template-columns:auto auto;gap:2px 7px}
      #worldMapLegend i{width:9px;height:6px;border-radius:2px;display:inline-block;margin-right:4px}.legend-water i{background:#237db0}.legend-green i{background:#4f7b55}.legend-road i{background:#e3c56b}.legend-building i{background:#bdcbd3}
      body.solo-flight #viewport[data-world-mode="real"] #soloTopbar span,body.solo-flight #viewport[data-world-mode="real"] #soloTopbar button,body.solo-flight #viewport[data-world-mode="real"] #soloRaceHud,body.solo-flight #viewport[data-world-mode="real"] #soloClearance,body.solo-flight #viewport[data-world-mode="real"] .solo-action{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
      #realWorldStatus{line-height:1.4}
    `;document.head.appendChild(style);
    const mode=$("worldMode"),config=$("realWorldConfig"),use=$("useMyLocation");
    mode.value="training";
    const viewport=$("viewport");if(viewport){viewport.dataset.worldMode="training";delete viewport.dataset.worldProvider;delete viewport.dataset.worldRenderPath;delete viewport.dataset.worldLatitude;delete viewport.dataset.worldLongitude;delete viewport.dataset.worldCameraMode;delete viewport.dataset.worldMapCenter;delete viewport.dataset.worldMapZoom;delete viewport.dataset.worldMapPitch;delete viewport.dataset.worldMapBearing;delete viewport.dataset.worldMapSyncMode;delete viewport.dataset.worldThreeFrames;delete viewport.dataset.worldMapUpdates;delete viewport.dataset.worldMapFpsCap;delete viewport.dataset.worldMapPixelRatio;delete viewport.dataset.worldFlightPixelRatio;delete viewport.dataset.worldSymbolsRemoved;delete viewport.dataset.worldLookYaw;delete viewport.dataset.worldLookPitch;delete viewport.dataset.worldLookKeepEnabled;delete viewport.dataset.worldGridEnabled;delete viewport.dataset.worldFlightFps;delete viewport.dataset.worldPerfMode;delete viewport.dataset.worldPaletteLayers;delete viewport.dataset.worldMinimapMode;delete viewport.dataset.worldMinimapBearing;delete viewport.dataset.worldMinimapFeatures;delete viewport.dataset.worldMinimapQueries;delete viewport.dataset.worldMinimapFollow;}
    mode.onchange=()=>{config.hidden=mode.value!=="real";if(mode.value==="training")this.deactivate();else this.activate().catch(error=>this.fail(error));};
    use.onclick=()=>this.activate().catch(error=>this.fail(error));
    try{localStorage.setItem(MODE_STORAGE,"training");}catch{}
  }
  installLookHud(){
    const viewport=$("viewport");if(!viewport||this.lookHud)return;
    const hud=document.createElement("div");hud.id="worldLookHud";hud.setAttribute("aria-label","WORLD mini 3D map and free 360 degree camera look");hud.innerHTML='<div class="world-look-title"><span>MINI 3D · 360°</span><span data-world-look-readout>SNAP</span></div><div class="world-look-stage"><canvas class="world-mini-canvas" width="196" height="172" aria-label="Cached WORLD mini 3D map"></canvas><div class="world-look-plane"></div><div class="world-look-drone"><i class="world-look-nose"></i></div></div><b class="world-look-cardinal world-look-n">N</b><b class="world-look-cardinal world-look-e">E</b><b class="world-look-cardinal world-look-s">S</b><b class="world-look-cardinal world-look-w">W</b>';
    viewport.appendChild(hud);this.lookHud=hud;this.lookPlane=hud.querySelector(".world-look-plane");this.lookReadout=hud.querySelector("[data-world-look-readout]");this.minimapCanvas=hud.querySelector(".world-mini-canvas");this.minimapCtx=this.minimapCanvas?.getContext("2d");const legend=document.createElement("div");legend.id="worldMapLegend";legend.innerHTML='<span class="legend-water"><i></i>WATER</span><span class="legend-green"><i></i>GREEN</span><span class="legend-road"><i></i>ROADS</span><span class="legend-building"><i></i>BUILDINGS</span>';viewport.appendChild(legend);this.mapLegend=legend;
    const update=(event)=>{if(!this.lookDragging||event.pointerId!==this.lookPointer?.id)return;const dx=event.clientX-this.lookPointer.x,dy=event.clientY-this.lookPointer.y;this.lookYawDeg=((this.lookPointer.yaw+dx*.85+540)%360)-180;this.lookPitchDeg=clamp(this.lookPointer.pitch-dy*.62,-75,60);this.lookSnapping=false;this.renderLookHud();};
    hud.addEventListener("pointerdown",event=>{if($("viewport")?.dataset.cameraMode==="fpv")return;event.preventDefault();hud.setPointerCapture?.(event.pointerId);this.lookDragging=true;this.lookSnapping=false;this.lookPointer={id:event.pointerId,x:event.clientX,y:event.clientY,yaw:this.lookYawDeg,pitch:this.lookPitchDeg};this.renderLookHud();});
    hud.addEventListener("pointermove",update);
    const release=event=>{if(event.pointerId!==this.lookPointer?.id)return;this.lookDragging=false;this.lookPointer=null;if(!this.keepLookOrientation)this.lookSnapping=true;this.renderLookHud();};
    hud.addEventListener("pointerup",release);hud.addEventListener("pointercancel",release);hud.addEventListener("dblclick",()=>this.resetLook(true));this.renderLookHud();
  }
  installFreeLookSurface(){
    const viewport=$("viewport");if(!viewport||this.lookSurfaceInstalled)return;this.lookSurfaceInstalled=true;
    const blocked=target=>target instanceof Element&&Boolean(target.closest("#soloTopbar,#soloRaceHud,#soloLeft,#soloRight,#soloClearance,.solo-action,.phone-settings-dialog,#worldLookHud"));
    const move=event=>{if(!this.lookDragging||event.pointerId!==this.lookPointer?.id||this.lookPointer?.source!=="world")return;const dx=event.clientX-this.lookPointer.x,dy=event.clientY-this.lookPointer.y;this.lookYawDeg=((this.lookPointer.yaw+dx*.38+540)%360)-180;this.lookPitchDeg=clamp(this.lookPointer.pitch-dy*.32,-75,60);this.lookSnapping=false;this.renderLookHud();event.preventDefault();};
    viewport.addEventListener("pointerdown",event=>{if(!this.active||!document.body.classList.contains("solo-flight")||viewport.dataset.cameraMode==="fpv"||event.button!==0||blocked(event.target)||this.lookDragging)return;this.lookDragging=true;this.lookSnapping=false;this.lookPointer={id:event.pointerId,source:"world",x:event.clientX,y:event.clientY,yaw:this.lookYawDeg,pitch:this.lookPitchDeg};try{viewport.setPointerCapture?.(event.pointerId);}catch{}this.renderLookHud();event.preventDefault();},{passive:false});
    viewport.addEventListener("pointermove",move,{passive:false});
    const release=event=>{if(!this.lookDragging||event.pointerId!==this.lookPointer?.id||this.lookPointer?.source!=="world")return;const released=event.pointerId;this.lookDragging=false;this.lookPointer=null;try{viewport.releasePointerCapture?.(released);}catch{}if(!this.keepLookOrientation)this.lookSnapping=true;this.renderLookHud();event.preventDefault();};
    viewport.addEventListener("pointerup",release,{passive:false});viewport.addEventListener("pointercancel",release,{passive:false});
  }
  renderLookHud(){
    if(this.lookPlane)this.lookPlane.style.transform=`rotateX(${clamp(60-this.lookPitchDeg*.28,38,78)}deg) rotateZ(${-this.lookYawDeg}deg)`;
    const cameraMode=$("viewport")?.dataset.cameraMode||"follow";if(this.lookReadout)this.lookReadout.textContent=cameraMode==="fpv"?"FPV LOCK":this.lookDragging?`${Math.round(this.lookYawDeg)}°`:this.keepLookOrientation?`KEEP · ${Math.round(this.lookYawDeg)}°`:this.lookSnapping?"SNAP ↺":"SNAP";
    const viewport=$("viewport");if(viewport){viewport.dataset.worldLookYaw=this.lookYawDeg.toFixed(2);viewport.dataset.worldLookPitch=this.lookPitchDeg.toFixed(2);viewport.dataset.worldLookKeepEnabled=this.keepLookOrientation?"1":"0";viewport.dataset.worldGridEnabled=this.gridEnabled?"1":"0";viewport.dataset.worldMinimapFollow=this.minimapFollowLook?"1":"0";}
  }
  setGridEnabled(value){this.gridEnabled=Boolean(value);try{localStorage.setItem(WORLD_GRID_STORAGE,this.gridEnabled?"1":"0");}catch{}this.renderLookHud();return this.gridEnabled;}
  setKeepLookOrientation(value){this.keepLookOrientation=Boolean(value);try{localStorage.setItem(WORLD_KEEP_LOOK_STORAGE,this.keepLookOrientation?"1":"0");}catch{}if(!this.keepLookOrientation&&!this.lookDragging&&(Math.abs(this.lookYawDeg)>.05||Math.abs(this.lookPitchDeg)>.05))this.lookSnapping=true;this.renderLookHud();return this.keepLookOrientation;}
  setMinimapFollowLook(value){this.minimapFollowLook=Boolean(value);try{localStorage.setItem(WORLD_MINIMAP_FOLLOW_STORAGE,this.minimapFollowLook?"1":"0");}catch{}this.minimapLastDrawMs=-Infinity;this.renderLookHud();return this.minimapFollowLook;}
  resetLook(immediate=false){this.lookDragging=false;this.lookPointer=null;if(immediate){this.lookYawDeg=0;this.lookPitchDeg=0;this.lookSnapping=false;}else this.lookSnapping=true;this.renderLookHud();}
  stepLook(now){const dt=clamp((now-this.lookFrameMs)/1000,0,.05);this.lookFrameMs=now;if(this.lookSnapping&&!this.lookDragging){const decay=Math.exp(-WORLD_LOOK_SNAP_RATE*dt);this.lookYawDeg*=decay;this.lookPitchDeg*=decay;if(Math.abs(this.lookYawDeg)<.08&&Math.abs(this.lookPitchDeg)<.08){this.lookYawDeg=0;this.lookPitchDeg=0;this.lookSnapping=false;}this.renderLookHud();}}
  airframeFor(scene){if(this.airframe?.parent)return this.airframe;this.airframe=null;scene.traverse(node=>{if(!this.airframe&&node.userData?.arondightAirframe)this.airframe=node;});return this.airframe;}
  applyLookCamera(scene,camera){
    this.stepLook(performance.now());const mode=$("viewport")?.dataset.cameraMode||"follow";if(mode==="fpv")return;if(Math.abs(this.lookYawDeg)<.001&&Math.abs(this.lookPitchDeg)<.001)return;const airframe=this.airframeFor(scene);if(!airframe)return;const yaw=THREE.MathUtils.degToRad(this.lookYawDeg),pitch=THREE.MathUtils.degToRad(this.lookPitchDeg),worldUp=new THREE.Vector3(0,0,1);
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
    const canvas=this.minimapCanvas,ctx=this.minimapCtx,w=canvas.width,h=canvas.height,position=airframe.position,viewport=$("viewport"),mainBearing=Number(viewport?.dataset.worldMapBearing||0),miniBearing=this.minimapFollowLook&&Number.isFinite(mainBearing)?mainBearing:0,rad=-miniBearing*Math.PI/180,c=Math.cos(rad),si=Math.sin(rad),radius=clamp(55+Math.max(0,position.z)*2,60,170),scale=w/(radius*2),baseY=h*.62;
    const projectLocal=(east,north,height=0)=>{const dx=east-position.x,dy=north-position.y,rx=dx*c-dy*si,ry=dx*si+dy*c;return[w/2+rx*scale,baseY-ry*scale*.60-height*scale*.13];};
    const project=(lon,lat,height=0)=>{const [east,north]=lngLatToMeters(this.originLon,this.originLat,lon,lat);return projectLocal(east,north,height);};
    const gradient=ctx.createLinearGradient(0,0,0,h);gradient.addColorStop(0,"#18384d");gradient.addColorStop(1,"#071522");ctx.fillStyle=gradient;ctx.fillRect(0,0,w,h);
    if(this.gridEnabled){ctx.lineWidth=1;for(let v=-Math.ceil(radius/20)*20;v<=radius;v+=20){for(const axis of [0,1]){const a=axis?projectLocal(position.x-radius,position.y+v):projectLocal(position.x+v,position.y-radius),b=axis?projectLocal(position.x+radius,position.y+v):projectLocal(position.x+v,position.y+radius);ctx.strokeStyle=v===0?"rgba(157,233,255,.35)":"rgba(103,188,215,.14)";ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke();}}}
    for(const feature of this.minimapFeatures){for(const path of feature.paths){const bottom=path.map(point=>project(point[0],point[1],0)),polygon=feature.geometryType.includes("Polygon");if(feature.kind==="road"){ctx.strokeStyle="#e3c56b";ctx.lineWidth=2;ctx.beginPath();bottom.forEach((point,i)=>i?ctx.lineTo(...point):ctx.moveTo(...point));ctx.stroke();continue;}if(feature.kind==="water"){ctx.fillStyle="rgba(35,125,176,.74)";ctx.strokeStyle="#55b7df";ctx.lineWidth=1.5;ctx.beginPath();bottom.forEach((point,i)=>i?ctx.lineTo(...point):ctx.moveTo(...point));if(polygon){ctx.closePath();ctx.fill();}ctx.stroke();continue;}if(feature.kind==="green"){ctx.fillStyle="rgba(79,123,85,.66)";ctx.beginPath();bottom.forEach((point,i)=>i?ctx.lineTo(...point):ctx.moveTo(...point));ctx.closePath();ctx.fill();continue;}const top=path.map(point=>project(point[0],point[1],feature.height));ctx.fillStyle="rgba(189,203,211,.66)";ctx.strokeStyle="rgba(226,240,247,.82)";ctx.lineWidth=1;ctx.beginPath();top.forEach((point,i)=>i?ctx.lineTo(...point):ctx.moveTo(...point));ctx.closePath();ctx.fill();ctx.stroke();for(let i=0;i<Math.min(bottom.length,10);i+=Math.max(1,Math.floor(bottom.length/4))){ctx.strokeStyle="rgba(154,177,190,.38)";ctx.beginPath();ctx.moveTo(...bottom[i]);ctx.lineTo(...top[i]);ctx.stroke();}}}
    const forward=new THREE.Vector3(-1,0,0).applyQuaternion(airframe.quaternion),airBearing=THREE.MathUtils.radToDeg(Math.atan2(forward.x,forward.y)),rel=(airBearing-miniBearing)*Math.PI/180,cx=w/2,cy=baseY;ctx.save();ctx.translate(cx,cy);ctx.rotate(rel);ctx.fillStyle="#ff5c76";ctx.strokeStyle="#ffffff";ctx.lineWidth=1.4;ctx.beginPath();ctx.moveTo(0,-9);ctx.lineTo(6,7);ctx.lineTo(0,4);ctx.lineTo(-6,7);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();ctx.fillStyle="#d8f7ff";ctx.font="800 12px system-ui";ctx.fillText(this.minimapFollowLook?"CAM":"N",7,15);ctx.fillStyle="#9bc5d8";ctx.font="700 9px ui-monospace,monospace";ctx.fillText(`${Math.round(position.z)}m`,7,h-7);if(viewport){viewport.dataset.worldMinimapMode=this.minimapFollowLook?"camera":"north";viewport.dataset.worldMinimapBearing=miniBearing.toFixed(2);}
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
  hideTrainingWorld(scene){this.identifyTrainingObjects(scene);this.frameVisibility.clear();for(const child of this.trainingObjects){this.frameVisibility.set(child,child.visible);if(child.isGridHelper){child.visible=this.gridEnabled;continue;}child.visible=false;}}
  restoreTrainingWorld(){for(const[child,visible]of this.frameVisibility)child.visible=visible;this.frameVisibility.clear();}
  applyFlightPalette(){
    if(!this.map)return 0;let changed=0;const layers=this.map.getStyle()?.layers||[];
    const set=(id,property,value)=>{try{this.map.setPaintProperty(id,property,value);changed++;}catch{}};
    for(const layer of layers){const source=String(layer["source-layer"]||"").toLowerCase(),id=String(layer.id||"").toLowerCase();
      if(layer.type==="background"){set(layer.id,"background-color","#304657");continue;}
      if(layer.type==="fill"&&source==="water"){set(layer.id,"fill-color","#237db0");set(layer.id,"fill-opacity",.96);continue;}
      if(layer.type==="line"&&(source==="waterway"||source==="water")){set(layer.id,"line-color","#55b7df");continue;}
      if(layer.type==="fill"&&(source==="landcover"||source==="landuse")){const green=/park|wood|forest|grass|garden|pitch|meadow|farmland|scrub/.test(id),industry=/industrial|commercial|retail|parking/.test(id);set(layer.id,"fill-color",green?"#4f7b55":industry?"#675b58":"#53636b");set(layer.id,"fill-opacity",.92);continue;}
      if(layer.type==="fill"&&source==="building"){set(layer.id,"fill-color","#bdcbd3");set(layer.id,"fill-opacity",.82);continue;}
      if(layer.type==="line"&&source==="transportation"){const major=/motorway|trunk|primary/.test(id),mid=/secondary|tertiary/.test(id);set(layer.id,"line-color",major?"#f0c85c":mid?"#d9d4ad":"#a9b8c1");set(layer.id,"line-opacity",.95);continue;}
      if(layer.type==="line"&&source==="boundary")set(layer.id,"line-color","#8094a4");
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
    const layer={id:"arondight45-buildings-3d",type:"fill-extrusion",source:sourceId,"source-layer":"building",minzoom:14,paint:{"fill-extrusion-color":"#a8bdcc","fill-extrusion-height":["coalesce",["to-number",["get","render_height"]],8],"fill-extrusion-base":["coalesce",["to-number",["get","render_min_height"]],0],"fill-extrusion-opacity":.91,"fill-extrusion-vertical-gradient":true}};
    try{if(before)this.map.addLayer(layer,before);else this.map.addLayer(layer);}catch(error){console.warn("OpenFreeMap 3D building layer unavailable:",error);}
  }
  async createMap(longitude,latitude){
    if(this.map){this.geoContainer.hidden=false;this.map.resize();this.map.jumpTo({center:[longitude,latitude],zoom:19,pitch:55,bearing:0});return this.map;}
    const viewport=$("viewport"),container=document.createElement("div");container.id="geoViewport";container.hidden=true;viewport.insertBefore(container,viewport.firstChild);this.geoContainer=container;
    this.map=new MapLibreMap({container,style:OPENFREEMAP_STYLE,center:[longitude,latitude],zoom:19,pitch:55,bearing:0,roll:0,maxPitch:85,maxZoom:WORLD_MAP_MAX_ZOOM,interactive:false,attributionControl:false,maplibreLogo:false,fadeDuration:0,renderWorldCopies:false,centerClampedToGround:false,pixelRatio:Math.min(devicePixelRatio||1,WORLD_MAP_PIXEL_RATIO),maxTileCacheZoomLevels:2,maxCanvasSize:[2048,2048],cancelPendingTileRequestsWhileZooming:true,refreshExpiredTiles:false,validateStyle:false,crossSourceCollisions:false,trackResize:false,reduceMotion:true,canvasContextAttributes:{antialias:false,powerPreference:"high-performance",desynchronized:true}});
    const attribution=document.createElement("div");attribution.className="geo-attribution";attribution.textContent="© OpenFreeMap · © OpenMapTiles · © OpenStreetMap contributors";container.appendChild(attribution);
    this.map.on("error",event=>console.warn("OpenFreeMap render warning:",event?.error||event));
    await Promise.race([new Promise(resolve=>this.map.once("load",resolve)),new Promise((_,reject)=>setTimeout(()=>reject(Error("OpenFreeMap style load timeout")),20000))]);
    this.applyFlightPalette();this.stripFlightClutter();
    try{this.map.setSky({"sky-color":"#0a2845","sky-horizon-blend":.42,"horizon-color":"#477493","horizon-fog-blend":.22,"fog-color":"#274d68","fog-ground-blend":.08});}catch(error){console.warn("OpenFreeMap sky contrast unavailable:",error);}
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
      this.lastMapSyncMs=-Infinity;this.lastMapView=null;this.mapUpdates=0;this.perfWindowStart=performance.now();this.perfFrames=0;this.perfGoodWindows=0;this.perfMode="nominal";this.mapFrameMs=WORLD_MAP_FRAME_MS;
      this.threeRenderer.setPixelRatio(Math.min(this.flightPixelRatio||devicePixelRatio||1,WORLD_FLIGHT_PIXEL_RATIO));this.threeRenderer.shadowMap.enabled=false;
      this.threeRenderer.domElement.style.visibility="visible";this.threeRenderer.domElement.style.display="block";this.geoContainer.hidden=false;
      const viewport=$("viewport");viewport.dataset.worldMode="real";viewport.dataset.worldProvider="openfreemap";viewport.dataset.worldRenderPath="shared-three-renderer";viewport.dataset.worldLatitude=String(latitude);viewport.dataset.worldLongitude=String(longitude);viewport.dataset.worldMapFpsCap="30";viewport.dataset.worldMapPixelRatio=String(WORLD_MAP_PIXEL_RATIO);viewport.dataset.worldFlightPixelRatio=String(Math.min(this.flightPixelRatio||devicePixelRatio||1,WORLD_FLIGHT_PIXEL_RATIO));viewport.dataset.worldMapUpdates="0";viewport.dataset.worldGridEnabled=this.gridEnabled?"1":"0";viewport.dataset.worldLookKeepEnabled=this.keepLookOrientation?"1":"0";viewport.dataset.worldPerfMode=this.perfMode;viewport.dataset.worldFlightFps="0";viewport.dataset.worldMinimapFollow=this.minimapFollowLook?"1":"0";viewport.dataset.worldMinimapQueries="0";this.minimapLastQueryMs=-Infinity;this.minimapLastDrawMs=-Infinity;this.minimapQueries=0;this.renderLookHud();
      const mode=$("worldMode"),config=$("realWorldConfig");if(mode)mode.value="real";if(config)config.hidden=false;
      this.status(`REAL WORLD LIVE · OpenFreeMap · GPS ${latitude.toFixed(6)}, ${longitude.toFixed(6)} · ±${Math.round(accuracy||0)} m`,"good");try{localStorage.setItem(MODE_STORAGE,"real");}catch{}
    }catch(error){this.loading=false;throw error;}
  }
  deactivate(){
    this.active=false;this.loading=false;this.resetLook(true);if(this.geoContainer)this.geoContainer.hidden=true;if(this.threeRenderer){this.threeRenderer.domElement.style.visibility="visible";this.threeRenderer.domElement.style.display="block";this.threeRenderer.setClearAlpha(1);if(this.flightPixelRatio!==null)this.threeRenderer.setPixelRatio(this.flightPixelRatio);if(this.flightShadowEnabled!==null)this.threeRenderer.shadowMap.enabled=this.flightShadowEnabled;}if(this.threeScene){this.restoreTrainingWorld();if(this.savedBackground!==null)this.threeScene.background=this.savedBackground;if(this.savedFog!==null)this.threeScene.fog=this.savedFog;}
    const viewport=$("viewport");if(viewport){viewport.dataset.worldMode="training";delete viewport.dataset.worldProvider;delete viewport.dataset.worldRenderPath;delete viewport.dataset.worldLatitude;delete viewport.dataset.worldLongitude;delete viewport.dataset.worldCameraMode;delete viewport.dataset.worldMapCenter;delete viewport.dataset.worldMapZoom;delete viewport.dataset.worldMapPitch;delete viewport.dataset.worldMapBearing;delete viewport.dataset.worldMapSyncMode;delete viewport.dataset.worldThreeFrames;delete viewport.dataset.worldMapUpdates;delete viewport.dataset.worldMapFpsCap;delete viewport.dataset.worldMapPixelRatio;delete viewport.dataset.worldFlightPixelRatio;delete viewport.dataset.worldSymbolsRemoved;delete viewport.dataset.worldLookYaw;delete viewport.dataset.worldLookPitch;delete viewport.dataset.worldLookKeepEnabled;delete viewport.dataset.worldGridEnabled;delete viewport.dataset.worldFlightFps;delete viewport.dataset.worldPerfMode;delete viewport.dataset.worldPaletteLayers;}
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
  syncMapCamera(camera){
    if(!this.active||!this.map||!Number.isFinite(this.originLon)||!Number.isFinite(this.originLat))return;
    const now=performance.now(),viewport=$("viewport"),cameraMode=viewport.dataset.cameraMode||"follow",forceMode=cameraMode!==(viewport.dataset.worldCameraMode||"");
    if(forceMode&&viewport.dataset.worldCameraMode)this.resetLook(true);
    const fpvFrameLocked=cameraMode==="fpv";if(!forceMode&&!fpvFrameLocked&&now-this.lastMapSyncMs<this.mapFrameMs)return;
    const p=camera.position,dir=new THREE.Vector3(),actualUp=new THREE.Vector3(0,1,0).applyQuaternion(camera.quaternion).normalize();camera.getWorldDirection(dir).normalize();
    let focusDistance=10;if(dir.z<-.02&&p.z>0){const ground=-p.z/dir.z;if(Number.isFinite(ground)&&ground>0)focusDistance=clamp(ground,2,250);}
    const focus=p.clone().addScaledVector(dir,focusDistance),center=metersToLngLat(this.originLon,this.originLat,focus.x,focus.y),horizontal=Math.hypot(dir.x,dir.y);
    const bearing=THREE.MathUtils.radToDeg(Math.atan2(dir.x,dir.y));const pitch=clamp(90+THREE.MathUtils.radToDeg(Math.atan2(dir.z,Math.max(1e-6,horizontal))),0,85);
    let roll=0;if(horizontal>.02){const worldUp=new THREE.Vector3(0,0,1),right0=new THREE.Vector3().crossVectors(dir,worldUp).normalize(),up0=new THREE.Vector3().crossVectors(right0,dir).normalize();roll=THREE.MathUtils.radToDeg(Math.atan2(dir.dot(new THREE.Vector3().crossVectors(up0,actualUp)),up0.dot(actualUp)));}
    const rect=viewport.getBoundingClientRect(),height=Math.max(1,rect.height),metersPerPixel=Math.max(.01,2*focusDistance*Math.tan(THREE.MathUtils.degToRad(clamp(camera.fov,10,120))/2)/height),cosLat=Math.max(.05,Math.cos(center[1]*Math.PI/180)),zoom=clamp(Math.log2(156543.03392804097*cosLat/metersPerPixel),14,WORLD_MAP_MAX_ZOOM),size=`${Math.round(rect.width)}x${Math.round(rect.height)}`;
    if(size!==this.lastViewportSize){this.lastViewportSize=size;this.map.resize();}
    const view={center,zoom,bearing,pitch,roll:clamp(roll,-85,85)},last=this.lastMapView;
    if(last&&!forceMode&&!fpvFrameLocked){const latM=(center[1]-last.center[1])*Math.PI/180*EARTH_RADIUS_M,lonM=(center[0]-last.center[0])*Math.PI/180*EARTH_RADIUS_M*Math.max(.05,Math.cos(center[1]*Math.PI/180)),centerDelta=Math.hypot(latM,lonM);if(centerDelta<WORLD_MAP_CENTER_EPS_M&&Math.abs(zoom-last.zoom)<WORLD_MAP_ZOOM_EPS&&angularDistanceDeg(bearing,last.bearing)<WORLD_MAP_ANGLE_EPS_DEG&&Math.abs(pitch-last.pitch)<WORLD_MAP_ANGLE_EPS_DEG&&angularDistanceDeg(view.roll,last.roll)<WORLD_MAP_ANGLE_EPS_DEG){this.lastMapSyncMs=now;return;}}
    this.lastMapSyncMs=now;this.lastMapView={...view,center:[...center]};this.map.jumpTo(view);this.mapUpdates++;
    viewport.dataset.worldCameraMode=cameraMode;viewport.dataset.worldMapSyncMode=fpvFrameLocked?"frame-locked":"budgeted";viewport.dataset.worldMapCenter=`${center[0].toFixed(7)},${center[1].toFixed(7)}`;viewport.dataset.worldMapZoom=zoom.toFixed(4);viewport.dataset.worldMapPitch=pitch.toFixed(3);viewport.dataset.worldMapBearing=bearing.toFixed(3);viewport.dataset.worldMapUpdates=String(this.mapUpdates);
  }
  renderReal(scene,camera){
    this.trackFlightPerformance(performance.now());const basePosition=camera.position.clone(),baseQuaternion=camera.quaternion.clone(),baseUp=camera.up.clone();
    this.applyLookCamera(scene,camera);this.syncMapCamera(camera);this.drawMinimap(performance.now());const renderer=this.threeRenderer;if(!renderer){camera.position.copy(basePosition);camera.quaternion.copy(baseQuaternion);camera.up.copy(baseUp);return;}
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