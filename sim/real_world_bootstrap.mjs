import * as THREE from "three";
import {Map as MapLibreMap} from "maplibre-gl";

const OPENFREEMAP_STYLE="https://tiles.openfreemap.org/styles/liberty";
const MODE_STORAGE="arondight45WorldModeV2";
const EARTH_RADIUS_M=6378137;
const WORLD_MAP_FRAME_MS=1000/30;
const WORLD_MAP_MAX_ZOOM=20;
const WORLD_MAP_PIXEL_RATIO=1.0;
const WORLD_FLIGHT_PIXEL_RATIO=1.25;
const WORLD_MAP_CENTER_EPS_M=.06;
const WORLD_MAP_ZOOM_EPS=.008;
const WORLD_MAP_ANGLE_EPS_DEG=.18;
const WORLD_GRID_STORAGE="arondight45WorldGridV1";
const WORLD_KEEP_LOOK_STORAGE="arondight45WorldKeepLookV1";
const WORLD_LOOK_SNAP_RATE=8;
const $=id=>document.getElementById(id);
const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
const angularDistanceDeg=(a,b)=>Math.abs((((a-b)+540)%360)-180);
const loadBool=(key,fallback)=>{try{const raw=localStorage.getItem(key);return raw===null?fallback:raw==="1";}catch{return fallback;}};

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
    this.active=false;this.loading=false;this.map=null;this.originLon=null;this.originLat=null;this.threeRenderer=null;this.threeScene=null;this.threeCamera=null;this.flightPixelRatio=null;this.flightShadowEnabled=null;this.geoContainer=null;this.worldCard=null;this.savedBackground=null;this.savedFog=null;this.trainingObjects=new Set();this.frameVisibility=new Map();this.lastLocation=null;this.lastViewportSize="";this.lastMapSyncMs=-Infinity;this.lastMapView=null;this.realFrames=0;this.mapUpdates=0;this.gridEnabled=loadBool(WORLD_GRID_STORAGE,true);this.keepLookOrientation=loadBool(WORLD_KEEP_LOOK_STORAGE,false);this.lookYawDeg=0;this.lookPitchDeg=0;this.lookDragging=false;this.lookSnapping=false;this.lookPointer=null;this.lookFrameMs=performance.now();this.lookHud=null;this.lookPlane=null;this.lookReadout=null;this.airframe=null;
    this.installUi();this.installLookHud();
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
      #worldLookHud{display:none;position:absolute;z-index:4;right:max(10px,env(safe-area-inset-right));top:max(48px,calc(env(safe-area-inset-top) + 42px));width:116px;height:116px;border:1px solid #8cdcff88;border-radius:16px;background:#071522d9;box-shadow:0 8px 26px #0008,inset 0 0 22px #2f9bd322;backdrop-filter:blur(7px);touch-action:none;user-select:none;overflow:hidden;color:#dff7ff}
      body.solo-flight #viewport[data-world-mode="real"] #worldLookHud{display:block}
      #worldLookHud .world-look-title{position:absolute;left:7px;right:7px;top:5px;z-index:3;display:flex;justify-content:space-between;font:800 7px/1.1 system-ui,-apple-system,sans-serif;letter-spacing:.09em;color:#aeeaff;pointer-events:none}
      #worldLookHud .world-look-stage{position:absolute;left:9px;right:9px;top:22px;bottom:8px;perspective:110px;border-radius:50%;overflow:hidden;border:1px solid #8cdcff55;background:radial-gradient(circle at 50% 44%,#274c6288 0 7%,#0a2134dd 48%,#06121ddd 72%);pointer-events:none}
      #worldLookHud .world-look-plane{position:absolute;inset:17px 8px 5px;background:repeating-linear-gradient(0deg,#7bdcff42 0 1px,transparent 1px 11px),repeating-linear-gradient(90deg,#7bdcff42 0 1px,transparent 1px 11px);border:1px solid #7bdcff66;transform-origin:50% 58%;transform:rotateX(60deg) rotateZ(0deg);box-shadow:0 0 14px #55cfff22}
      #worldLookHud .world-look-drone{position:absolute;left:50%;top:51%;width:23px;height:23px;transform:translate(-50%,-50%);filter:drop-shadow(0 0 5px #a9eeff);pointer-events:none}
      #worldLookHud .world-look-drone:before,#worldLookHud .world-look-drone:after{content:"";position:absolute;left:2px;right:2px;top:10px;height:3px;border-radius:3px;background:#d8f7ff}
      #worldLookHud .world-look-drone:after{transform:rotate(90deg)}
      #worldLookHud .world-look-nose{position:absolute;left:9px;top:-4px;width:0;height:0;border-left:3px solid transparent;border-right:3px solid transparent;border-bottom:8px solid #ff5c76}
      #worldLookHud .world-look-cardinal{position:absolute;font:900 7px system-ui,-apple-system,sans-serif;color:#72d9ff;opacity:.85;pointer-events:none}.world-look-n{top:22px;left:53px}.world-look-e{top:62px;right:12px}.world-look-s{bottom:9px;left:54px}.world-look-w{top:62px;left:12px}
      #realWorldStatus{line-height:1.4}
    `;document.head.appendChild(style);
    const mode=$("worldMode"),config=$("realWorldConfig"),use=$("useMyLocation");
    mode.value="training";
    const viewport=$("viewport");if(viewport){viewport.dataset.worldMode="training";delete viewport.dataset.worldProvider;delete viewport.dataset.worldRenderPath;delete viewport.dataset.worldLatitude;delete viewport.dataset.worldLongitude;delete viewport.dataset.worldCameraMode;delete viewport.dataset.worldMapCenter;delete viewport.dataset.worldMapZoom;delete viewport.dataset.worldMapPitch;delete viewport.dataset.worldMapBearing;delete viewport.dataset.worldThreeFrames;delete viewport.dataset.worldMapUpdates;delete viewport.dataset.worldMapFpsCap;delete viewport.dataset.worldMapPixelRatio;delete viewport.dataset.worldFlightPixelRatio;delete viewport.dataset.worldSymbolsRemoved;delete viewport.dataset.worldLookYaw;delete viewport.dataset.worldLookPitch;delete viewport.dataset.worldLookKeep;delete viewport.dataset.worldGrid;}
    mode.onchange=()=>{config.hidden=mode.value!=="real";if(mode.value==="training")this.deactivate();else this.activate().catch(error=>this.fail(error));};
    use.onclick=()=>this.activate().catch(error=>this.fail(error));
    try{localStorage.setItem(MODE_STORAGE,"training");}catch{}
  }
  installLookHud(){
    const viewport=$("viewport");if(!viewport||this.lookHud)return;
    const hud=document.createElement("div");hud.id="worldLookHud";hud.setAttribute("aria-label","WORLD free 360 degree camera look");hud.innerHTML='<div class="world-look-title"><span>360° LOOK</span><span data-world-look-readout>SNAP</span></div><div class="world-look-stage"><div class="world-look-plane"></div><div class="world-look-drone"><i class="world-look-nose"></i></div></div><b class="world-look-cardinal world-look-n">N</b><b class="world-look-cardinal world-look-e">E</b><b class="world-look-cardinal world-look-s">S</b><b class="world-look-cardinal world-look-w">W</b>';
    viewport.appendChild(hud);this.lookHud=hud;this.lookPlane=hud.querySelector(".world-look-plane");this.lookReadout=hud.querySelector("[data-world-look-readout]");
    const update=(event)=>{if(!this.lookDragging||event.pointerId!==this.lookPointer?.id)return;const dx=event.clientX-this.lookPointer.x,dy=event.clientY-this.lookPointer.y;this.lookYawDeg=((this.lookPointer.yaw+dx*.85+540)%360)-180;this.lookPitchDeg=clamp(this.lookPointer.pitch-dy*.62,-75,60);this.lookSnapping=false;this.renderLookHud();};
    hud.addEventListener("pointerdown",event=>{event.preventDefault();hud.setPointerCapture?.(event.pointerId);this.lookDragging=true;this.lookSnapping=false;this.lookPointer={id:event.pointerId,x:event.clientX,y:event.clientY,yaw:this.lookYawDeg,pitch:this.lookPitchDeg};this.renderLookHud();});
    hud.addEventListener("pointermove",update);
    const release=event=>{if(event.pointerId!==this.lookPointer?.id)return;this.lookDragging=false;this.lookPointer=null;if(!this.keepLookOrientation)this.lookSnapping=true;this.renderLookHud();};
    hud.addEventListener("pointerup",release);hud.addEventListener("pointercancel",release);hud.addEventListener("dblclick",()=>this.resetLook(true));this.renderLookHud();
  }
  renderLookHud(){
    if(this.lookPlane)this.lookPlane.style.transform=`rotateX(${clamp(60-this.lookPitchDeg*.28,38,78)}deg) rotateZ(${-this.lookYawDeg}deg)`;
    if(this.lookReadout)this.lookReadout.textContent=this.lookDragging?`${Math.round(this.lookYawDeg)}°`:this.keepLookOrientation?`KEEP · ${Math.round(this.lookYawDeg)}°`:this.lookSnapping?"SNAP ↺":"SNAP";
    const viewport=$("viewport");if(viewport){viewport.dataset.worldLookYaw=this.lookYawDeg.toFixed(2);viewport.dataset.worldLookPitch=this.lookPitchDeg.toFixed(2);viewport.dataset.worldLookKeep=this.keepLookOrientation?"1":"0";viewport.dataset.worldGrid=this.gridEnabled?"1":"0";}
  }
  setGridEnabled(value){this.gridEnabled=Boolean(value);try{localStorage.setItem(WORLD_GRID_STORAGE,this.gridEnabled?"1":"0");}catch{}this.renderLookHud();return this.gridEnabled;}
  setKeepLookOrientation(value){this.keepLookOrientation=Boolean(value);try{localStorage.setItem(WORLD_KEEP_LOOK_STORAGE,this.keepLookOrientation?"1":"0");}catch{}if(!this.keepLookOrientation&&!this.lookDragging&&(Math.abs(this.lookYawDeg)>.05||Math.abs(this.lookPitchDeg)>.05))this.lookSnapping=true;this.renderLookHud();return this.keepLookOrientation;}
  resetLook(immediate=false){this.lookDragging=false;this.lookPointer=null;if(immediate){this.lookYawDeg=0;this.lookPitchDeg=0;this.lookSnapping=false;}else this.lookSnapping=true;this.renderLookHud();}
  stepLook(now){const dt=clamp((now-this.lookFrameMs)/1000,0,.05);this.lookFrameMs=now;if(this.lookSnapping&&!this.lookDragging){const decay=Math.exp(-WORLD_LOOK_SNAP_RATE*dt);this.lookYawDeg*=decay;this.lookPitchDeg*=decay;if(Math.abs(this.lookYawDeg)<.08&&Math.abs(this.lookPitchDeg)<.08){this.lookYawDeg=0;this.lookPitchDeg=0;this.lookSnapping=false;}this.renderLookHud();}}
  airframeFor(scene){if(this.airframe?.parent)return this.airframe;scene.traverse(node=>{if(!this.airframe&&node.userData?.arondightAirframe)this.airframe=node;});return this.airframe;}
  applyLookCamera(scene,camera){
    this.stepLook(performance.now());if(Math.abs(this.lookYawDeg)<.001&&Math.abs(this.lookPitchDeg)<.001)return;const airframe=this.airframeFor(scene);if(!airframe)return;const mode=$("viewport")?.dataset.cameraMode||"follow",yaw=THREE.MathUtils.degToRad(this.lookYawDeg),pitch=THREE.MathUtils.degToRad(this.lookPitchDeg),worldUp=new THREE.Vector3(0,0,1);
    if(mode==="fpv"){const qYaw=new THREE.Quaternion().setFromAxisAngle(worldUp,-yaw);camera.quaternion.premultiply(qYaw);const right=new THREE.Vector3(1,0,0).applyQuaternion(camera.quaternion).normalize(),qPitch=new THREE.Quaternion().setFromAxisAngle(right,pitch);camera.quaternion.premultiply(qPitch);return;}
    const target=airframe.position.clone();target.z+=.10;const relative=camera.position.clone().sub(target);relative.applyAxisAngle(worldUp,-yaw);const radial=relative.clone().normalize(),right=new THREE.Vector3().crossVectors(radial,worldUp);if(right.lengthSq()>.0001)relative.applyAxisAngle(right.normalize(),pitch);camera.position.copy(target).add(relative);camera.up.copy(worldUp);camera.lookAt(target);
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
  hideTrainingWorld(scene){this.identifyTrainingObjects(scene);this.frameVisibility.clear();for(const child of this.trainingObjects){if(child.isGridHelper&&this.gridEnabled)continue;this.frameVisibility.set(child,child.visible);child.visible=false;}}
  restoreTrainingWorld(){for(const[child,visible]of this.frameVisibility)child.visible=visible;this.frameVisibility.clear();}
  stripFlightClutter(){
    if(!this.map)return 0;
    const symbolIds=(this.map.getStyle()?.layers||[]).filter(layer=>layer.type==="symbol").map(layer=>layer.id);
    let removed=0;
    for(const id of symbolIds){try{this.map.removeLayer(id);removed++;}catch(error){console.warn("OpenFreeMap symbol-layer removal warning:",id,error);}}
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
    this.stripFlightClutter();
    try{this.map.setSky({"sky-color":"#0a2845","sky-horizon-blend":.42,"horizon-color":"#477493","horizon-fog-blend":.22,"fog-color":"#274d68","fog-ground-blend":.08});}catch(error){console.warn("OpenFreeMap sky contrast unavailable:",error);}
    this.addBuildings();return this.map;
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
      this.lastMapSyncMs=-Infinity;this.lastMapView=null;this.mapUpdates=0;
      this.threeRenderer.setPixelRatio(Math.min(this.flightPixelRatio||devicePixelRatio||1,WORLD_FLIGHT_PIXEL_RATIO));this.threeRenderer.shadowMap.enabled=false;
      this.threeRenderer.domElement.style.visibility="visible";this.threeRenderer.domElement.style.display="block";this.geoContainer.hidden=false;
      const viewport=$("viewport");viewport.dataset.worldMode="real";viewport.dataset.worldProvider="openfreemap";viewport.dataset.worldRenderPath="shared-three-renderer";viewport.dataset.worldLatitude=String(latitude);viewport.dataset.worldLongitude=String(longitude);viewport.dataset.worldMapFpsCap="30";viewport.dataset.worldMapPixelRatio=String(WORLD_MAP_PIXEL_RATIO);viewport.dataset.worldFlightPixelRatio=String(Math.min(this.flightPixelRatio||devicePixelRatio||1,WORLD_FLIGHT_PIXEL_RATIO));viewport.dataset.worldMapUpdates="0";viewport.dataset.worldGrid=this.gridEnabled?"1":"0";viewport.dataset.worldLookKeep=this.keepLookOrientation?"1":"0";this.renderLookHud();
      const mode=$("worldMode"),config=$("realWorldConfig");if(mode)mode.value="real";if(config)config.hidden=false;
      this.status(`REAL WORLD LIVE · OpenFreeMap · GPS ${latitude.toFixed(6)}, ${longitude.toFixed(6)} · ±${Math.round(accuracy||0)} m`,"good");try{localStorage.setItem(MODE_STORAGE,"real");}catch{}
    }catch(error){this.loading=false;throw error;}
  }
  deactivate(){
    this.active=false;this.loading=false;this.resetLook(true);if(this.geoContainer)this.geoContainer.hidden=true;if(this.threeRenderer){this.threeRenderer.domElement.style.visibility="visible";this.threeRenderer.domElement.style.display="block";this.threeRenderer.setClearAlpha(1);if(this.flightPixelRatio!==null)this.threeRenderer.setPixelRatio(this.flightPixelRatio);if(this.flightShadowEnabled!==null)this.threeRenderer.shadowMap.enabled=this.flightShadowEnabled;}if(this.threeScene){this.restoreTrainingWorld();if(this.savedBackground!==null)this.threeScene.background=this.savedBackground;if(this.savedFog!==null)this.threeScene.fog=this.savedFog;}
    const viewport=$("viewport");if(viewport){viewport.dataset.worldMode="training";delete viewport.dataset.worldProvider;delete viewport.dataset.worldRenderPath;delete viewport.dataset.worldLatitude;delete viewport.dataset.worldLongitude;delete viewport.dataset.worldCameraMode;delete viewport.dataset.worldMapCenter;delete viewport.dataset.worldMapZoom;delete viewport.dataset.worldMapPitch;delete viewport.dataset.worldMapBearing;delete viewport.dataset.worldThreeFrames;delete viewport.dataset.worldMapUpdates;delete viewport.dataset.worldMapFpsCap;delete viewport.dataset.worldMapPixelRatio;delete viewport.dataset.worldFlightPixelRatio;delete viewport.dataset.worldSymbolsRemoved;}
    const mode=$("worldMode"),config=$("realWorldConfig");if(mode)mode.value="training";if(config)config.hidden=true;this.status("TRAINING RANGE · local metric world");try{localStorage.setItem(MODE_STORAGE,"training");}catch{}
  }
  syncMapCamera(camera){
    if(!this.active||!this.map||!Number.isFinite(this.originLon)||!Number.isFinite(this.originLat))return;
    const now=performance.now(),viewport=$("viewport"),cameraMode=viewport.dataset.cameraMode||"follow",forceMode=cameraMode!==(viewport.dataset.worldCameraMode||"");
    if(forceMode&&viewport.dataset.worldCameraMode)this.resetLook(true);
    if(!forceMode&&now-this.lastMapSyncMs<WORLD_MAP_FRAME_MS)return;
    const p=camera.position,dir=new THREE.Vector3(),actualUp=new THREE.Vector3(0,1,0).applyQuaternion(camera.quaternion).normalize();camera.getWorldDirection(dir).normalize();
    let focusDistance=10;if(dir.z<-.02&&p.z>0){const ground=-p.z/dir.z;if(Number.isFinite(ground)&&ground>0)focusDistance=clamp(ground,2,250);}
    const focus=p.clone().addScaledVector(dir,focusDistance),center=metersToLngLat(this.originLon,this.originLat,focus.x,focus.y),horizontal=Math.hypot(dir.x,dir.y);
    const bearing=THREE.MathUtils.radToDeg(Math.atan2(dir.x,dir.y));const pitch=clamp(90+THREE.MathUtils.radToDeg(Math.atan2(dir.z,Math.max(1e-6,horizontal))),0,85);
    let roll=0;if(horizontal>.02){const worldUp=new THREE.Vector3(0,0,1),right0=new THREE.Vector3().crossVectors(dir,worldUp).normalize(),up0=new THREE.Vector3().crossVectors(right0,dir).normalize();roll=THREE.MathUtils.radToDeg(Math.atan2(dir.dot(new THREE.Vector3().crossVectors(up0,actualUp)),up0.dot(actualUp)));}
    const rect=viewport.getBoundingClientRect(),height=Math.max(1,rect.height),metersPerPixel=Math.max(.01,2*focusDistance*Math.tan(THREE.MathUtils.degToRad(clamp(camera.fov,10,120))/2)/height),cosLat=Math.max(.05,Math.cos(center[1]*Math.PI/180)),zoom=clamp(Math.log2(156543.03392804097*cosLat/metersPerPixel),14,WORLD_MAP_MAX_ZOOM),size=`${Math.round(rect.width)}x${Math.round(rect.height)}`;
    if(size!==this.lastViewportSize){this.lastViewportSize=size;this.map.resize();}
    const view={center,zoom,bearing,pitch,roll:clamp(roll,-85,85)},last=this.lastMapView;
    if(last&&!forceMode){const latM=(center[1]-last.center[1])*Math.PI/180*EARTH_RADIUS_M,lonM=(center[0]-last.center[0])*Math.PI/180*EARTH_RADIUS_M*Math.max(.05,Math.cos(center[1]*Math.PI/180)),centerDelta=Math.hypot(latM,lonM);if(centerDelta<WORLD_MAP_CENTER_EPS_M&&Math.abs(zoom-last.zoom)<WORLD_MAP_ZOOM_EPS&&angularDistanceDeg(bearing,last.bearing)<WORLD_MAP_ANGLE_EPS_DEG&&Math.abs(pitch-last.pitch)<WORLD_MAP_ANGLE_EPS_DEG&&angularDistanceDeg(view.roll,last.roll)<WORLD_MAP_ANGLE_EPS_DEG){this.lastMapSyncMs=now;return;}}
    this.lastMapSyncMs=now;this.lastMapView={...view,center:[...center]};this.map.jumpTo(view);this.mapUpdates++;
    viewport.dataset.worldCameraMode=cameraMode;viewport.dataset.worldMapCenter=`${center[0].toFixed(7)},${center[1].toFixed(7)}`;viewport.dataset.worldMapZoom=zoom.toFixed(4);viewport.dataset.worldMapPitch=pitch.toFixed(3);viewport.dataset.worldMapBearing=bearing.toFixed(3);viewport.dataset.worldMapUpdates=String(this.mapUpdates);
  }
  renderReal(scene,camera){
    this.applyLookCamera(scene,camera);this.syncMapCamera(camera);const renderer=this.threeRenderer;if(!renderer)return;
    this.savedBackground=scene.background;this.savedFog=scene.fog;this.hideTrainingWorld(scene);scene.background=null;scene.fog=null;
    const clearAlpha=renderer.getClearAlpha();renderer.setClearAlpha(0);
    try{renderer.render(scene,camera);this.realFrames++;$("viewport").dataset.worldThreeFrames=String(this.realFrames);}finally{renderer.setClearAlpha(clearAlpha);scene.background=this.savedBackground;scene.fog=this.savedFog;this.restoreTrainingWorld();}
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