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
const $=id=>document.getElementById(id);
const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
const angularDistanceDeg=(a,b)=>Math.abs((((a-b)+540)%360)-180);

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
    this.active=false;this.loading=false;this.map=null;this.originLon=null;this.originLat=null;this.threeRenderer=null;this.threeScene=null;this.threeCamera=null;this.flightPixelRatio=null;this.flightShadowEnabled=null;this.geoContainer=null;this.worldCard=null;this.savedBackground=null;this.savedFog=null;this.trainingObjects=new Set();this.frameVisibility=new Map();this.lastLocation=null;this.lastViewportSize="";this.lastMapSyncMs=-Infinity;this.lastMapView=null;this.realFrames=0;this.mapUpdates=0;
    this.installUi();
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
      #realWorldStatus{line-height:1.4}
    `;document.head.appendChild(style);
    const mode=$("worldMode"),config=$("realWorldConfig"),use=$("useMyLocation");
    mode.value="training";
    const viewport=$("viewport");if(viewport){viewport.dataset.worldMode="training";delete viewport.dataset.worldProvider;delete viewport.dataset.worldRenderPath;delete viewport.dataset.worldLatitude;delete viewport.dataset.worldLongitude;delete viewport.dataset.worldCameraMode;delete viewport.dataset.worldMapCenter;delete viewport.dataset.worldMapZoom;delete viewport.dataset.worldMapPitch;delete viewport.dataset.worldMapBearing;delete viewport.dataset.worldThreeFrames;delete viewport.dataset.worldMapUpdates;delete viewport.dataset.worldMapFpsCap;delete viewport.dataset.worldMapPixelRatio;delete viewport.dataset.worldFlightPixelRatio;}
    mode.onchange=()=>{config.hidden=mode.value!=="real";if(mode.value==="training")this.deactivate();else this.activate().catch(error=>this.fail(error));};
    use.onclick=()=>this.activate().catch(error=>this.fail(error));
    try{localStorage.setItem(MODE_STORAGE,"training");}catch{}
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
  hideTrainingWorld(scene){this.identifyTrainingObjects(scene);this.frameVisibility.clear();for(const child of this.trainingObjects){this.frameVisibility.set(child,child.visible);child.visible=false;}}
  restoreTrainingWorld(){for(const[child,visible]of this.frameVisibility)child.visible=visible;this.frameVisibility.clear();}
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
    this.map=new MapLibreMap({container,style:OPENFREEMAP_STYLE,center:[longitude,latitude],zoom:19,pitch:55,bearing:0,roll:0,maxPitch:85,maxZoom:WORLD_MAP_MAX_ZOOM,interactive:false,attributionControl:false,maplibreLogo:false,fadeDuration:0,renderWorldCopies:false,centerClampedToGround:false,pixelRatio:Math.min(devicePixelRatio||1,WORLD_MAP_PIXEL_RATIO),maxTileCacheZoomLevels:2,maxCanvasSize:[2048,2048],cancelPendingTileRequestsWhileZooming:true,refreshExpiredTiles:false,validateStyle:false,canvasContextAttributes:{antialias:false,powerPreference:"high-performance",desynchronized:true}});
    const attribution=document.createElement("div");attribution.className="geo-attribution";attribution.textContent="© OpenFreeMap · © OpenMapTiles · © OpenStreetMap contributors";container.appendChild(attribution);
    this.map.on("error",event=>console.warn("OpenFreeMap render warning:",event?.error||event));
    await Promise.race([new Promise(resolve=>this.map.once("load",resolve)),new Promise((_,reject)=>setTimeout(()=>reject(Error("OpenFreeMap style load timeout")),20000))]);
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
      const viewport=$("viewport");viewport.dataset.worldMode="real";viewport.dataset.worldProvider="openfreemap";viewport.dataset.worldRenderPath="shared-three-renderer";viewport.dataset.worldLatitude=String(latitude);viewport.dataset.worldLongitude=String(longitude);viewport.dataset.worldMapFpsCap="30";viewport.dataset.worldMapPixelRatio=String(WORLD_MAP_PIXEL_RATIO);viewport.dataset.worldFlightPixelRatio=String(Math.min(this.flightPixelRatio||devicePixelRatio||1,WORLD_FLIGHT_PIXEL_RATIO));viewport.dataset.worldMapUpdates="0";
      const mode=$("worldMode"),config=$("realWorldConfig");if(mode)mode.value="real";if(config)config.hidden=false;
      this.status(`REAL WORLD LIVE · OpenFreeMap · GPS ${latitude.toFixed(6)}, ${longitude.toFixed(6)} · ±${Math.round(accuracy||0)} m`,"good");try{localStorage.setItem(MODE_STORAGE,"real");}catch{}
    }catch(error){this.loading=false;throw error;}
  }
  deactivate(){
    this.active=false;this.loading=false;if(this.geoContainer)this.geoContainer.hidden=true;if(this.threeRenderer){this.threeRenderer.domElement.style.visibility="visible";this.threeRenderer.domElement.style.display="block";this.threeRenderer.setClearAlpha(1);if(this.flightPixelRatio!==null)this.threeRenderer.setPixelRatio(this.flightPixelRatio);if(this.flightShadowEnabled!==null)this.threeRenderer.shadowMap.enabled=this.flightShadowEnabled;}if(this.threeScene){this.restoreTrainingWorld();if(this.savedBackground!==null)this.threeScene.background=this.savedBackground;if(this.savedFog!==null)this.threeScene.fog=this.savedFog;}
    const viewport=$("viewport");if(viewport){viewport.dataset.worldMode="training";delete viewport.dataset.worldProvider;delete viewport.dataset.worldRenderPath;delete viewport.dataset.worldLatitude;delete viewport.dataset.worldLongitude;delete viewport.dataset.worldCameraMode;delete viewport.dataset.worldMapCenter;delete viewport.dataset.worldMapZoom;delete viewport.dataset.worldMapPitch;delete viewport.dataset.worldMapBearing;delete viewport.dataset.worldThreeFrames;delete viewport.dataset.worldMapUpdates;delete viewport.dataset.worldMapFpsCap;delete viewport.dataset.worldMapPixelRatio;delete viewport.dataset.worldFlightPixelRatio;}
    const mode=$("worldMode"),config=$("realWorldConfig");if(mode)mode.value="training";if(config)config.hidden=true;this.status("TRAINING RANGE · local metric world");try{localStorage.setItem(MODE_STORAGE,"training");}catch{}
  }
  syncMapCamera(camera){
    if(!this.active||!this.map||!Number.isFinite(this.originLon)||!Number.isFinite(this.originLat))return;
    const now=performance.now(),viewport=$("viewport"),cameraMode=viewport.dataset.cameraMode||"follow",forceMode=cameraMode!==(viewport.dataset.worldCameraMode||"");
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
    this.syncMapCamera(camera);const renderer=this.threeRenderer;if(!renderer)return;
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
