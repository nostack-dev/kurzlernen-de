import * as THREE from "three";
import {Map as MapLibreMap,LngLat} from "maplibre-gl";
import {CAMERA_SETTINGS_EVENT,loadCameraSettings,setCameraFovDeg} from "./camera_settings.mjs";
import {fpvTargetDistanceMeters,forwardTarget} from "./world_camera_math.mjs";
import {LanVsFinder,discoveryRoomKeys} from "./lan_vs.mjs";
import {VsPoseTimeline,normalizeVsOrigin,chooseCanonicalVsOrigin,poseMatchesVsFrame,vsFrameId,vsOriginKey} from "./vs_pose_sync.mjs";
import {buildingFootprintsFromFeatures,buildingFootprintHash,buildingCollisionPrismsFromFootprints} from "./world_building_collisions.mjs";

const OPENFREEMAP_STYLE="https://tiles.openfreemap.org/styles/liberty";
const WORLD_IMAGERY_SOURCE_ID="arondight45-world-imagery";
const WORLD_IMAGERY_LAYER_ID="arondight45-world-imagery-raster";
const WORLD_IMAGERY_TILE_URL="https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const WORLD_IMAGERY_ATTRIBUTION="Imagery © Esri, Vantor, Earthstar Geographics, and the GIS User Community";
const WORLD_IMAGERY_MAX_ZOOM=19;
const MODE_STORAGE="arondight45WorldModeV2";
const EARTH_RADIUS_M=6378137;
const WORLD_MAP_DIRECT_DEDUP_MS=8;
const WORLD_MAP_FRAME_MS_NOMINAL=1000/30;
const WORLD_MAP_FRAME_MS_CONSTRAINED=1000/20;
const WORLD_MAP_FRAME_MS_CRITICAL=1000/15;
const WORLD_BUILDING_COLLISION_SYNC_MS=750;
const WORLD_PERF_WINDOW_MS=1000;
const WORLD_FPS_CONSTRAINED=50;
const WORLD_FPS_CRITICAL=36;
const WORLD_FPS_RECOVER=57;
const WORLD_MAP_MAX_ZOOM=20;
const WORLD_MAP_MAX_PITCH=120;
const WORLD_MAP_PIXEL_RATIO=1.0;
const WORLD_MAP_SOFTWARE_PIXEL_RATIO=.50;
const WORLD_FLIGHT_PIXEL_RATIO=1.25;
const WORLD_GRID_STORAGE="arondight45WorldGridV1";
const WORLD_KEEP_LOOK_STORAGE="arondight45WorldKeepLookV1";
const WORLD_MINIMAP_AXIS_LOCK_STORAGE="arondight45WorldMinimapAxisLockV1";
const WORLD_IMAGERY_STORAGE="arondight45WorldImageryV1";
const WORLD_MINIMAP_QUERY_MS=1000;
const WORLD_MINIMAP_DRAW_MS=125;
const WORLD_MINIMAP_MAX_FEATURES=80;
const WORLD_MINIMAP_IMAGERY_CACHE_SIZE=48;
const WORLD_LOOK_SNAP_RATE=8;
const $=id=>document.getElementById(id);
const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
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
function mercatorWorldPixel(longitude,latitude,zoom){
  const size=256*2**zoom,lon=clamp(longitude,-180,180),lat=clamp(latitude,-85.05112878,85.05112878),sin=Math.sin(lat*Math.PI/180);
  return[(lon+180)/360*size,(.5-Math.log((1+sin)/(1-sin))/(4*Math.PI))*size];
}
function imageryTileUrl(zoom,x,y){return WORLD_IMAGERY_TILE_URL.replace("{z}",String(zoom)).replace("{x}",String(x)).replace("{y}",String(y));}

class RealWorldBridge{
  constructor(){
    this.active=false;this.loading=false;this.map=null;this.originLon=null;this.originLat=null;this.threeRenderer=null;this.threeScene=null;this.threeCamera=null;this.flightPixelRatio=null;this.flightShadowEnabled=null;this.mapPixelRatio=WORLD_MAP_PIXEL_RATIO;this.geoContainer=null;this.worldCard=null;this.savedBackground=null;this.savedFog=null;this.trainingObjects=new Set();this.frameVisibility=new Map();this.lastLocation=null;this.lastViewportSize="";this.lastMapSyncMs=-Infinity;this.lastMapView=null;this.realFrames=0;this.presentationFrameSerial=0;this.lastMapSyncFrameSerial=-1;this.mapUpdates=0;this.gridEnabled=loadBool(WORLD_GRID_STORAGE,true);this.keepLookOrientation=loadBool(WORLD_KEEP_LOOK_STORAGE,false);this.minimapAxisLocked=loadBool(WORLD_MINIMAP_AXIS_LOCK_STORAGE,true);this.imageryEnabled=loadBool(WORLD_IMAGERY_STORAGE,true);this.lookYawDeg=0;this.lookPitchDeg=0;this.lookDragging=false;this.gamepadLookActive=false;this.lookSnapping=false;this.lookPointer=null;this.lookFrameMs=performance.now();this.lookHud=null;this.lookReadout=null;this.minimapTitle=null;this.mapLegend=null;this.minimapCanvas=null;this.minimapCtx=null;this.minimapFeatures=[];this.minimapLayerIds=[];this.minimapImageryTiles=new Map();this.minimapLastQueryMs=-Infinity;this.minimapLastDrawMs=-Infinity;this.minimapQueries=0;this.minimapExpanded=false;this.minimapZoom=1;this.minimapPointers=new Map();this.minimapPinch=null;this.lastMinimapTapMs=0;this.viewFovDeg=loadCameraSettings().fpvFovDeg;this.lookSurfaceInstalled=false;this.worldShotPoint=new THREE.Vector3();this.worldShotNormal=new THREE.Vector3(0,0,1);this.worldShotHit={point:this.worldShotPoint,worldNormal:this.worldShotNormal};this.worldShotQueries=0;this.airframe=null;this.perfMode="nominal";this.perfWindowStart=performance.now();this.perfFrames=0;this.perfGoodWindows=0;this.flightFps=60;
    this.vsSession=null;this.vsPeerMesh=null;this.vsConnected=false;this.vsStarting=false;this.vsSharedOrigin=null;this.vsLocalOriginCandidate=null;this.vsSharedWorldAttempted=false;this.vsWorldFromMate=false;this.vsPeerTimeline=new VsPoseTimeline();this.vsPeerLastPoseMs=-Infinity;this.vsLocalPoseSample=null;this.vsCombatHud=null;this.vsLocalHealth=100;this.vsPeerHealth=100;this.vsKills=0;this.vsDeaths=0;this.vsCombatSeq=0;this.vsSeenHits=new Set();this.vsPendingHits=new Set();this.vsRespawnTimer=0;this.vsLocalDead=false;this.vsPeerDead=false;this.vsExplosion=null;this.vsExplosionStartedMs=-Infinity;this.installUi();this.installLookHud();this.installFreeLookSurface();this.installVsUi();window.addEventListener(CAMERA_SETTINGS_EVENT,event=>{const value=Number(event.detail?.fpvFovDeg);if(Number.isFinite(value)){this.viewFovDeg=clamp(value,50,120);this.minimapLastDrawMs=-Infinity;}});document.addEventListener("fullscreenchange",()=>{this.minimapLastDrawMs=-Infinity;this.renderLookHud();this.drawMinimap(performance.now());});
    this.buildingSourceId=null;this.buildingCollisionSink=null;this.buildingCollisionSnapshot=Object.freeze({hash:"",footprintCount:0,prismCount:0,prisms:[]});this.buildingCollisionDirty=true;this.buildingCollisionLastSyncMs=-Infinity;this.buildingCollisionLastCenter=[Infinity,Infinity];this.buildingCollisionRevisions=0;this.cameraCollisionResolver=null;
  }
  installUi(){
    const panel=document.querySelector(".panel");if(!panel)return;
    const card=document.createElement("div");card.className="card real-world-card";card.innerHTML=`
      <h2>World / geospatial twin</h2>
      <label>World<select id="worldMode"><option value="training">TRAINING RANGE</option><option value="real">REAL WORLD · MY LOCATION</option></select></label>
      <div id="realWorldConfig" hidden>
        <div class="row"><button id="useMyLocation" class="primary">USE MY GPS LOCATION</button></div>
        <div class="help">Esri World Imagery renders real aerial/satellite pixels; OpenFreeMap + OpenStreetMap add roads and 3D building footprints. No account, API key or billing setup is required. Loaded OSM building footprints and heights become bounded static Box3D collision prisms; motors, sensors and flight-control authority remain unchanged.</div>
      </div>
      <div id="realWorldStatus" class="statusline">TRAINING RANGE · local metric world</div>`;
    const remote=document.querySelector(".remote-card");panel.insertBefore(card,remote||panel.children[3]||null);this.worldCard=card;
    const style=document.createElement("style");style.textContent=`
      #geoViewport{position:absolute;inset:0;z-index:0;overflow:hidden;background:linear-gradient(180deg,#081a2d 0%,#103453 48%,#173d5c 68%,#142638 100%)}
      #geoViewport .maplibregl-map,#geoViewport .maplibregl-canvas-container{position:absolute;inset:0;width:100%!important;height:100%!important;overflow:hidden}
      #geoViewport .maplibregl-canvas{position:absolute;left:0;top:0;width:100%!important;height:100%!important}
      #geoViewport .geo-attribution{position:absolute;right:4px;bottom:3px;z-index:4;padding:2px 5px;border-radius:4px;background:#07101acc;color:#d8e0ea;font:8px/1.25 system-ui,-apple-system,sans-serif;pointer-events:none}
      #worldLookHud{display:none;position:absolute;z-index:4;right:max(10px,var(--solo-safe-right,env(safe-area-inset-right)));top:max(48px,calc(var(--solo-safe-top,env(safe-area-inset-top)) + 42px));width:116px;height:116px;border:1px solid #8cdcff88;border-radius:16px;background:#071522ee;box-shadow:0 8px 26px #0008,inset 0 0 22px #2f9bd322;touch-action:none;user-select:none;overflow:hidden;color:#dff7ff}
      body.solo-flight #viewport[data-world-mode="real"] #worldLookHud{display:block}
      #worldLookHud .world-look-title{position:absolute;left:7px;right:7px;top:5px;z-index:3;display:flex;justify-content:space-between;font:800 7px/1.1 system-ui,-apple-system,sans-serif;letter-spacing:.09em;color:#aeeaff;pointer-events:none}
      #worldLookHud .world-look-stage{position:absolute;left:9px;right:9px;top:22px;bottom:8px;border-radius:50%;overflow:hidden;border:1px solid #8cdcff55;background:#071522;pointer-events:none}
      #worldLookHud.expanded{width:min(72vw,560px);height:min(68dvh,430px);border-radius:18px;background:#071522f8}#worldLookHud.expanded .world-look-stage{border-radius:16px}#worldLookHud.expanded .world-look-cardinal{font-size:10px}
      #worldLookHud .world-mini-canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
      #worldLookHud .world-look-cardinal{position:absolute;font:900 7px system-ui,-apple-system,sans-serif;color:#72d9ff;opacity:.85;pointer-events:none}.world-look-n{top:22px;left:53px}.world-look-e{top:62px;right:12px}.world-look-s{bottom:9px;left:54px}.world-look-w{top:62px;left:12px}
      #worldMapLegend{display:none;position:absolute;z-index:4;left:max(10px,var(--solo-safe-left,env(safe-area-inset-left)));top:max(52px,calc(var(--solo-safe-top,env(safe-area-inset-top)) + 46px));padding:5px 7px;border-radius:8px;background:#071522e8;border:1px solid #ffffff25;color:#dce9f2;font:800 7px/1.4 system-ui,-apple-system,sans-serif;letter-spacing:.03em;pointer-events:none}
      body.solo-flight #viewport[data-world-mode="real"] #worldMapLegend{display:grid;grid-template-columns:auto auto;gap:2px 7px}
      #worldMapLegend i{width:10px;height:7px;border-radius:2px;display:inline-block;margin-right:4px;box-shadow:0 0 0 1px #ffffff24}.legend-imagery i{background:linear-gradient(135deg,#50683e,#af9c6a 48%,#4d7282)}.legend-road i{background:#ffd34f}.legend-building i{background:#dbe4e9}.legend-water i{background:#086a9d}
      body.solo-flight #viewport[data-world-mode="real"] #soloTopbar span,body.solo-flight #viewport[data-world-mode="real"] #soloTopbar button,body.solo-flight #viewport[data-world-mode="real"] #soloRaceHud,body.solo-flight #viewport[data-world-mode="real"] #soloClearance,body.solo-flight #viewport[data-world-mode="real"] .solo-action{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
      #realWorldStatus{line-height:1.4}
    `;document.head.appendChild(style);
    const mode=$("worldMode"),config=$("realWorldConfig"),use=$("useMyLocation");
    mode.value="training";
    const viewport=$("viewport");if(viewport){viewport.dataset.worldMode="training";delete viewport.dataset.worldProvider;delete viewport.dataset.worldRenderPath;delete viewport.dataset.worldLatitude;delete viewport.dataset.worldLongitude;delete viewport.dataset.worldCameraMode;delete viewport.dataset.worldMapCenter;delete viewport.dataset.worldMapZoom;delete viewport.dataset.worldMapPitch;delete viewport.dataset.worldMapBearing;delete viewport.dataset.worldMapSyncMode;delete viewport.dataset.worldMapTargetElevation;delete viewport.dataset.worldThreeFrames;delete viewport.dataset.worldMapUpdates;delete viewport.dataset.worldMapFpsCap;delete viewport.dataset.worldMapPixelRatio;delete viewport.dataset.worldFlightPixelRatio;delete viewport.dataset.worldSymbolsRemoved;delete viewport.dataset.worldLookYaw;delete viewport.dataset.worldLookPitch;delete viewport.dataset.worldLookKeepEnabled;delete viewport.dataset.worldGridEnabled;delete viewport.dataset.worldImageryEnabled;delete viewport.dataset.worldImageryLayer;delete viewport.dataset.worldFlightFps;delete viewport.dataset.worldPerfMode;delete viewport.dataset.worldPaletteLayers;delete viewport.dataset.worldMinimapMode;delete viewport.dataset.worldMinimapBearing;delete viewport.dataset.worldMinimapProjection;delete viewport.dataset.worldMinimapPitch;delete viewport.dataset.worldMinimapRoll;delete viewport.dataset.worldMinimapHeightMode;delete viewport.dataset.worldMinimapAxisLock;delete viewport.dataset.worldMinimapAxisLockApplied;delete viewport.dataset.worldMinimapFov;delete viewport.dataset.worldMinimapZoom;delete viewport.dataset.worldMinimapFeatures;delete viewport.dataset.worldMinimapQueries;delete viewport.dataset.worldMinimapImageryTiles;delete viewport.dataset.worldMinimapImageryZoom;delete viewport.dataset.worldShotQueries;delete viewport.dataset.worldBuildingCollisionStatus;delete viewport.dataset.worldBuildingCollisionFootprints;delete viewport.dataset.worldBuildingCollisionPrisms;delete viewport.dataset.worldBuildingCollisionRevision;}
    mode.onchange=()=>{config.hidden=mode.value!=="real";if(mode.value==="training")this.deactivate();else this.activate().catch(error=>this.fail(error));};
    use.onclick=()=>this.activate().catch(error=>this.fail(error));
    try{localStorage.setItem(MODE_STORAGE,"training");}catch{}
  }
  installVsUi(){
    const viewport=$("viewport");if(!viewport||$("lanVsButton"))return;const button=document.createElement("button");button.id="lanVsButton";button.type="button";button.textContent="FIND MATE";button.setAttribute("aria-label","Find nearby mate on the same network");button.style.cssText="border:1px solid #70ddff88;background:#071522e8;color:#dff7ff;font-weight:800;letter-spacing:.04em;touch-action:manipulation;white-space:nowrap";button.onclick=()=>this.toggleVs();const combat=document.createElement("span");combat.id="vsCombatHud";combat.hidden=true;combat.textContent="HP 100 · MATE 100 · K 0";combat.setAttribute("aria-label","VS health and kill count");this.vsCombatHud=combat;const attach=()=>{const topbar=$("soloTopbar");if(!topbar)return false;if(button.parentNode!==topbar)topbar.appendChild(button);if(combat.parentNode!==topbar)topbar.appendChild(combat);return true;};if(!attach()){const observer=new MutationObserver(()=>{if(attach())observer.disconnect();});observer.observe(document.documentElement,{childList:true,subtree:true});}
  }
  toggleVs(){if(this.vsSession||this.vsStarting)this.stopVs();else this.startVs();}
  async startVs(){
    if(this.vsSession||this.vsStarting)return;this.vsStarting=true;const button=$("lanVsButton");if(button)button.textContent="FINDING…";
    try{
      const ownLocation=!this.vsWorldFromMate&&this.lastLocation?.coords&&Number.isFinite(this.lastLocation.coords.longitude)&&Number.isFinite(this.lastLocation.coords.latitude)?{lon:this.lastLocation.coords.longitude,lat:this.lastLocation.coords.latitude,alt:Number(this.lastLocation.coords.altitude)||0}:Number.isFinite(this.originLon)&&Number.isFinite(this.originLat)&&!this.vsWorldFromMate?{lon:this.originLon,lat:this.originLat,alt:0}:null;
      this.vsLocalOriginCandidate=normalizeVsOrigin(ownLocation);this.vsSharedOrigin=chooseCanonicalVsOrigin(this.vsLocalOriginCandidate);this.vsSharedWorldAttempted=false;this.vsLocalPoseSample=null;this.vsPeerTimeline.reset();
      const deviceCoords=this.vsLocalOriginCandidate?{longitude:this.vsLocalOriginCandidate.lon,latitude:this.vsLocalOriginCandidate.lat}:{};const roomIds=await discoveryRoomKeys(deviceCoords);const viewport=$("viewport");if(viewport){viewport.dataset.vsDiscoveryRooms=String(roomIds.length);viewport.dataset.vsSharedFrame=vsOriginKey(this.vsSharedOrigin)||"local-metric";}if(!this.vsStarting)return;
      const session=new LanVsFinder({onTransport:()=>{if(button&&!this.vsConnected)button.textContent="FINDING…";},onPeer:()=>{this.vsConnected=true;if(button)button.textContent="MATE ✓";this.ensureVsPeerMesh();this.resetVsCombat(true);},onPose:pose=>this.applyVsPose(pose),onOrigin:origin=>this.acceptVsOrigin(origin,null),onCombat:packet=>this.applyVsCombat(packet),onLeave:()=>{this.vsConnected=false;this.restoreVsLocalWorld();this.clearVsPeerPresentation();this.resetVsCombat(false);if(button)button.textContent="WAITING…";},onError:()=>{if(button)button.textContent="RETRY MATE";}});this.vsSession=session;await session.start(roomIds);if(!this.vsConnected&&button)button.textContent="WAITING…";
    }catch(error){this.vsSession?.stop();this.vsSession=null;this.restoreVsLocalWorld();this.resetVsCombat(false);if(button)button.textContent="RETRY MATE";console.warn("VS discovery unavailable:",error);}finally{this.vsStarting=false;}
  }
  acceptVsOrigin(origin,status){
    const remote=normalizeVsOrigin(origin),next=chooseCanonicalVsOrigin(this.vsLocalOriginCandidate,this.vsSharedOrigin,remote);if(!remote||!next)return;
    const changed=vsOriginKey(this.vsSharedOrigin)!==vsOriginKey(next);this.vsSharedOrigin=next;if(changed){this.vsSharedWorldAttempted=false;this.clearVsPeerPresentation();}const fromMate=!this.vsLocalOriginCandidate||vsOriginKey(next)!==vsOriginKey(this.vsLocalOriginCandidate);const viewport=$("viewport");if(viewport)viewport.dataset.vsSharedFrame=vsOriginKey(next);if(status)status.textContent="Canonical mate WORLD origin shared · aligning both drones…";if(this.active)this.applyVsWorldOrigin(next,fromMate);else this.ensureVsSharedWorld(status);
  }
  applyVsWorldOrigin(origin,fromMate){
    const next=normalizeVsOrigin(origin);if(!next)return false;const changed=!Number.isFinite(this.originLon)||!Number.isFinite(this.originLat)||Math.abs(this.originLon-next.lon)>1e-10||Math.abs(this.originLat-next.lat)>1e-10;this.originLon=next.lon;this.originLat=next.lat;this.vsWorldFromMate=Boolean(fromMate);if(changed){this.lastMapSyncMs=-Infinity;this.lastMapView=null;this.lastMapSyncFrameSerial=-1;this.lastViewportSize="";this.clearBuildingCollisions();this.map?.jumpTo?.({center:[next.lon,next.lat],zoom:19,pitch:55,bearing:0});this.minimapLastQueryMs=-Infinity;this.minimapLastDrawMs=-Infinity;}const viewport=$("viewport");if(viewport){viewport.dataset.worldLatitude=String(next.lat);viewport.dataset.worldLongitude=String(next.lon);viewport.dataset.vsSharedFrame=vsOriginKey(next);viewport.dataset.vsOriginAuthority=fromMate?"mate":"local";}if(this.active)this.status(`REAL WORLD LIVE · CANONICAL VS ORIGIN ${next.lat.toFixed(6)}, ${next.lon.toFixed(6)}`,"good");return changed;
  }
  restoreVsLocalWorld(){
    const local=this.vsLocalOriginCandidate,borrowed=this.vsWorldFromMate;this.vsSharedOrigin=local;this.vsSharedWorldAttempted=false;this.vsWorldFromMate=false;this.vsLocalPoseSample=null;const viewport=$("viewport");if(viewport){viewport.dataset.vsSharedFrame=vsOriginKey(local)||"local-metric";viewport.dataset.vsOriginAuthority="local";}if(local&&this.active)this.applyVsWorldOrigin(local,false);else if(borrowed&&!local){if(this.active)this.deactivate();this.originLon=null;this.originLat=null;}
  }
  ensureVsSharedWorld(status=null){
    if(this.active){this.applyVsWorldOrigin(this.vsSharedOrigin,!this.vsLocalOriginCandidate||vsOriginKey(this.vsSharedOrigin)!==vsOriginKey(this.vsLocalOriginCandidate));return;}if(this.loading||this.vsSharedWorldAttempted||!this.vsSharedOrigin||!this.threeRenderer)return;
    this.vsSharedWorldAttempted=true;const origin={...this.vsSharedOrigin};
    this.activate({vsSharedOrigin:true,coords:{latitude:origin.lat,longitude:origin.lon,altitude:origin.alt,accuracy:0}})
      .then(()=>{if(status)status.textContent="Mate GPS origin · same WORLD active";})
      .catch(error=>{this.vsSharedWorldAttempted=false;if(status)status.textContent=`Mate origin map unavailable · VS local coordinates active`;console.warn("VS shared WORLD activation unavailable:",error);});
  }
  updateVsCombatHud(forceVisible=null){
    const hud=this.vsCombatHud||$("vsCombatHud"),viewport=$("viewport");if(hud){const visible=forceVisible===null?Boolean(this.vsSession||this.vsConnected):Boolean(forceVisible);hud.hidden=!visible;hud.textContent=`HP ${this.vsLocalHealth} · MATE ${this.vsPeerHealth} · K ${this.vsKills}`;}
    if(viewport){viewport.dataset.vsLocalHealth=String(this.vsLocalHealth);viewport.dataset.vsPeerHealth=String(this.vsPeerHealth);viewport.dataset.vsKills=String(this.vsKills);viewport.dataset.vsDeaths=String(this.vsDeaths);}
  }
  resetVsCombat(active=false){
    clearTimeout(this.vsRespawnTimer);this.vsRespawnTimer=0;this.vsLocalHealth=100;this.vsPeerHealth=100;this.vsKills=0;this.vsDeaths=0;this.vsCombatSeq=0;this.vsSeenHits.clear();this.vsPendingHits.clear();this.vsLocalDead=false;this.vsPeerDead=false;if(this.vsExplosion)this.vsExplosion.visible=false;this.updateVsCombatHud(active);
  }
  rememberVsHit(id){this.vsSeenHits.add(id);while(this.vsSeenHits.size>128)this.vsSeenHits.delete(this.vsSeenHits.values().next().value);}
  registerVsHit(hit){
    if(!this.vsConnected||this.vsPeerDead||!this.vsSession||!this.vsPeerMesh?.visible||!hit?.object)return false;let peer=false;for(let node=hit.object;node;node=node.parent){if(node===this.vsPeerMesh||node.userData?.vsPeer){peer=true;break;}}if(!peer)return false;
    const id=`h-${Date.now().toString(36)}-${(++this.vsCombatSeq).toString(36)}`;if(!this.vsSession.sendCombat({type:"hit",id,damage:25}))return false;this.vsPendingHits.add(id);while(this.vsPendingHits.size>64)this.vsPendingHits.delete(this.vsPendingHits.values().next().value);return true;
  }
  applyVsCombat(packet){
    if(!packet||!this.vsSession)return;
    if(packet.type==="hit"){
      if(this.vsLocalDead||this.vsSeenHits.has(packet.id))return;this.rememberVsHit(packet.id);const damage=clamp(Math.round(Number(packet.damage)||0),1,100);this.vsLocalHealth=Math.max(0,this.vsLocalHealth-damage);const killed=this.vsLocalHealth===0;if(killed){this.vsLocalDead=true;this.vsDeaths++;}this.updateVsCombatHud(true);this.vsSession.sendCombat({type:"state",id:packet.id,hp:this.vsLocalHealth,killed});
      if(killed){clearTimeout(this.vsRespawnTimer);this.vsRespawnTimer=setTimeout(()=>{if(!this.vsSession)return;this.vsLocalDead=false;this.vsLocalHealth=100;this.updateVsCombatHud(true);this.vsSession.sendCombat({type:"respawn",hp:100});},2200);}return;
    }
    if(packet.type==="state"){
      if(!this.vsPendingHits.delete(packet.id))return;if(this.vsPeerDead&&!packet.killed)return;this.vsPeerHealth=clamp(Math.round(Number(packet.hp)||0),0,100);if(packet.killed&&!this.vsPeerDead){this.vsPeerDead=true;this.vsKills++;this.vsPendingHits.clear();this.explodeVsPeer();}this.updateVsCombatHud(true);return;
    }
    if(packet.type==="respawn"){this.vsPeerHealth=clamp(Math.round(Number(packet.hp)||100),0,100);this.vsPeerDead=false;this.updateVsCombatHud(true);}
  }
  ensureVsExplosion(){
    if(this.vsExplosion||!this.threeScene)return this.vsExplosion;const group=new THREE.Group(),geometry=new THREE.SphereGeometry(.055,7,5);for(let i=0;i<12;i++){const material=new THREE.MeshBasicMaterial({color:i%3===0?0xffe47a:i%3===1?0xff8a32:0xff3c22,transparent:true,opacity:1,depthWrite:false,blending:THREE.AdditiveBlending});const mesh=new THREE.Mesh(geometry,material),a=i*Math.PI*2/12,z=((i%5)-2)*.035,r=.10+(i%4)*.028;mesh.position.set(Math.cos(a)*r,Math.sin(a)*r,z);mesh.userData.flightFireIgnore=true;group.add(mesh);}group.visible=false;group.renderOrder=12;this.threeScene.add(group);this.vsExplosion=group;return group;
  }
  explodeVsPeer(){const group=this.ensureVsExplosion();if(!group||!this.vsPeerMesh)return;group.position.copy(this.vsPeerMesh.position);group.scale.setScalar(1);for(const child of group.children)if(child.material)child.material.opacity=1;group.visible=true;this.vsExplosionStartedMs=performance.now();this.vsPeerMesh.visible=false;}
  updateVsExplosion(){const group=this.vsExplosion;if(!group?.visible)return;const t=(performance.now()-this.vsExplosionStartedMs)/720;if(t>=1){group.visible=false;return;}group.scale.setScalar(.7+4.2*t);group.rotation.z=t*1.3;for(const child of group.children)if(child.material)child.material.opacity=Math.max(0,1-t);}
  clearVsPeerPresentation(){
    this.vsPeerTimeline.reset();this.vsPeerLastPoseMs=-Infinity;if(this.vsPeerMesh)this.vsPeerMesh.visible=false;const viewport=$("viewport");if(viewport){delete viewport.dataset.vsPoseMode;delete viewport.dataset.vsPoseAgeMs;delete viewport.dataset.vsPoseHeld;}
  }
  updateVsPeerRender(){
    this.updateVsExplosion();if(!this.vsPeerMesh)return;if(this.vsPeerDead){this.vsPeerMesh.visible=false;return;}const sample=this.vsPeerTimeline.sample(performance.now());if(!sample){this.vsPeerMesh.visible=false;return;}if(sample.stale&&!this.vsConnected){this.vsPeerMesh.visible=false;return;}this.vsPeerMesh.position.set(...sample.p);this.vsPeerMesh.quaternion.set(...sample.q);this.vsPeerMesh.visible=true;const viewport=$("viewport");if(viewport){viewport.dataset.vsPoseMode=sample.stale?"stale-hold":sample.mode;viewport.dataset.vsPoseAgeMs=sample.ageMs.toFixed(1);viewport.dataset.vsPoseHeld=sample.stale?"1":"0";}
  }
  stopVs(){this.vsStarting=false;this.vsSession?.stop();this.vsSession=null;this.vsConnected=false;this.restoreVsLocalWorld();this.clearVsPeerPresentation();this.resetVsCombat(false);this.vsLocalOriginCandidate=null;const b=$("lanVsButton");if(b)b.textContent="FIND MATE";}
  ensureVsPeerMesh(){if(this.vsPeerMesh||!this.threeScene)return;const group=new THREE.Group(),mat=new THREE.MeshStandardMaterial({color:0x36e6ff,roughness:.35,metalness:.35});group.add(new THREE.Mesh(new THREE.BoxGeometry(.22,.34,.07),mat));for(const [x,y] of [[-.19,-.19],[.19,-.19],[-.19,.19],[.19,.19]]){const arm=new THREE.Mesh(new THREE.BoxGeometry(.025,.26,.025),mat);arm.position.set(x*.5,y*.5,0);arm.rotation.z=(x*y>0?1:-1)*Math.PI/4;group.add(arm);}group.userData.vsPeer=true;group.visible=false;group.renderOrder=5;this.threeScene.add(group);this.vsPeerMesh=group;}
  applyVsPose(pose){if(!pose||!Array.isArray(pose.p)||pose.p.length<3)return;const viewport=$("viewport");if(!poseMatchesVsFrame(pose,this.vsSharedOrigin)){if(viewport){viewport.dataset.vsPoseFrameMismatch=String(Number(viewport.dataset.vsPoseFrameMismatch||0)+1);viewport.dataset.vsRejectedFrame=String(pose.f||"").slice(0,96);}return;}this.ensureVsPeerMesh();if(!this.vsPeerMesh)return;let [x,y,z]=pose.p.map(Number);if(Array.isArray(pose.g)&&pose.g.length===2){const geoLon=Number.isFinite(this.originLon)?this.originLon:this.vsSharedOrigin?.lon,geoLat=Number.isFinite(this.originLat)?this.originLat:this.vsSharedOrigin?.lat;if(Number.isFinite(geoLon)&&Number.isFinite(geoLat)){const local=lngLatToMeters(geoLon,geoLat,Number(pose.g[0]),Number(pose.g[1]));x=local[0];y=local[1];}}if(![x,y,z].every(Number.isFinite))return;const q=pose.q;if(!Array.isArray(q)||q.length!==4||!q.every(Number.isFinite))return;const received=performance.now(),packet={...pose,p:[x,y,z],q:[...q]};if(!this.vsPeerTimeline.push(packet,received))return;this.vsPeerLastPoseMs=received;if(viewport){viewport.dataset.vsPoseFrame=vsFrameId(this.vsSharedOrigin);delete viewport.dataset.vsRejectedFrame;}this.updateVsPeerRender();}
  updateVsPose(){this.updateVsPeerRender();this.ensureVsSharedWorld();if(!this.vsSession||!this.threeScene)return;const airframe=this.airframeFor(this.threeScene);if(!airframe)return;const p=airframe.position,q=airframe.quaternion;if(!p||!q)return;const now=performance.now(),position=[p.x,p.y,p.z],previous=this.vsLocalPoseSample,dt=previous?(now-previous.at)/1000:0,velocity=previous&&dt>.001&&dt<.5?position.map((value,index)=>(value-previous.p[index])/dt):[0,0,0];this.vsLocalPoseSample={p:position,at:now};const pose={p:position,q:[q.x,q.y,q.z,q.w],v:velocity,t:now,f:vsOriginKey(this.vsSharedOrigin)||"local-metric"};if(this.active&&Number.isFinite(this.originLon)&&Number.isFinite(this.originLat)){const origin=this.vsSharedOrigin||{lon:this.originLon,lat:this.originLat,alt:0};this.vsSession.setOrigin(origin);pose.g=metersToLngLat(this.originLon,this.originLat,p.x,p.y);}this.vsSession.setPose(pose);}
  installLookHud(){
    const viewport=$("viewport");if(!viewport||this.lookHud)return;
    const hud=document.createElement("div");hud.id="worldLookHud";hud.setAttribute("aria-label","Orthographic top-down north-up WORLD minimap and 360 degree camera control");hud.innerHTML='<div class="world-look-title"><span data-world-minimap-title>MINIMAP · N↑ · TOP</span><span data-world-look-readout>SNAP</span></div><div class="world-look-stage"><canvas class="world-mini-canvas" width="196" height="172" aria-label="Orthographic top-down north-up WORLD mini map"></canvas></div><b class="world-look-cardinal world-look-n">N</b><b class="world-look-cardinal world-look-e">E</b><b class="world-look-cardinal world-look-s">S</b><b class="world-look-cardinal world-look-w">W</b>';
    viewport.appendChild(hud);this.lookHud=hud;this.lookReadout=hud.querySelector("[data-world-look-readout]");this.minimapTitle=hud.querySelector("[data-world-minimap-title]");this.minimapCanvas=hud.querySelector(".world-mini-canvas");this.minimapCtx=this.minimapCanvas?.getContext("2d");const legend=document.createElement("div");legend.id="worldMapLegend";legend.innerHTML='<span class="legend-imagery"><i></i>AERIAL</span><span class="legend-road"><i></i>ROADS</span><span class="legend-building"><i></i>3D BUILDINGS</span><span class="legend-water"><i></i>OSM</span>';viewport.appendChild(legend);this.mapLegend=legend;
    const pointerDistance=()=>{const points=[...this.minimapPointers.values()];return points.length>=2?Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y):0;};
    const update=event=>{
      if(!this.minimapPointers.has(event.pointerId))return;this.minimapPointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
      if(this.minimapPointers.size>=2){const distance=pointerDistance();if(!this.minimapPinch)this.minimapPinch={distance:Math.max(1,distance),fov:this.viewFovDeg,zoom:this.minimapZoom};const ratio=distance/Math.max(1,this.minimapPinch.distance);if(this.minimapExpanded){this.minimapZoom=clamp(this.minimapPinch.zoom*ratio,.45,4);this.minimapLastDrawMs=-Infinity;this.drawMinimap(performance.now());}else{const next=clamp(this.minimapPinch.fov/Math.max(.35,ratio),50,120);this.viewFovDeg=next;setCameraFovDeg(next);this.minimapLastDrawMs=-Infinity;}event.preventDefault();return;}
      if(!this.lookDragging||event.pointerId!==this.lookPointer?.id)return;const dx=event.clientX-this.lookPointer.x,dy=event.clientY-this.lookPointer.y;this.lookYawDeg=((this.lookPointer.yaw+dx*.85+540)%360)-180;this.lookPitchDeg=clamp(this.lookPointer.pitch-dy*.62,-75,60);this.lookSnapping=false;this.lookPointer.moved=Math.max(this.lookPointer.moved||0,Math.hypot(dx,dy));this.renderLookHud();event.preventDefault();
    };
    hud.addEventListener("pointerdown",event=>{event.preventDefault();try{hud.setPointerCapture?.(event.pointerId);}catch{}this.minimapPointers.set(event.pointerId,{x:event.clientX,y:event.clientY});if(this.minimapPointers.size===1){this.lookDragging=true;this.lookSnapping=false;this.lookPointer={id:event.pointerId,x:event.clientX,y:event.clientY,yaw:this.lookYawDeg,pitch:this.lookPitchDeg,moved:0};}else{this.minimapPinch={distance:Math.max(1,pointerDistance()),fov:this.viewFovDeg,zoom:this.minimapZoom};this.lookDragging=false;this.lookPointer=null;}this.renderLookHud();},{passive:false});
    hud.addEventListener("pointermove",update,{passive:false});
    const release=event=>{if(!this.minimapPointers.has(event.pointerId))return;const wasPrimary=event.pointerId===this.lookPointer?.id,moved=this.lookPointer?.moved||0;this.minimapPointers.delete(event.pointerId);try{hud.releasePointerCapture?.(event.pointerId);}catch{}if(this.minimapPointers.size<2)this.minimapPinch=null;if(wasPrimary){this.lookDragging=false;this.lookPointer=null;if(!this.keepLookOrientation)this.lookSnapping=true;if(moved<8){const now=performance.now();if(now-this.lastMinimapTapMs<360)this.toggleMinimapExpanded();this.lastMinimapTapMs=now;}}this.renderLookHud();event.preventDefault();};
    hud.addEventListener("pointerup",release,{passive:false});hud.addEventListener("pointercancel",release,{passive:false});this.renderLookHud();
  }
  installFreeLookSurface(){this.lookSurfaceInstalled=true;}
  minimapBearingDeg(){return!document.fullscreenElement&&!this.minimapAxisLocked?this.lookYawDeg:0;}
  renderLookHud(){
    const miniBearing=this.minimapBearingDeg(),axisLockApplies=!document.fullscreenElement&&this.minimapAxisLocked;
    if(this.minimapTitle)this.minimapTitle.textContent=Math.abs(miniBearing)<.01?"MINIMAP · N↑ · TOP":"MINIMAP · VIEW↑ · TOP";
    if(this.lookReadout)this.lookReadout.textContent=this.gamepadLookActive?`AIM · ${Math.round(this.lookYawDeg)}°`:this.lookDragging?`${Math.round(this.lookYawDeg)}°`:this.keepLookOrientation?`KEEP · ${Math.round(this.lookYawDeg)}°`:this.lookSnapping?"SNAP ↺":"SNAP";
    const viewport=$("viewport");if(viewport){viewport.dataset.worldLookYaw=this.lookYawDeg.toFixed(2);viewport.dataset.worldLookPitch=this.lookPitchDeg.toFixed(2);viewport.dataset.worldLookKeepEnabled=this.keepLookOrientation?"1":"0";viewport.dataset.worldGridEnabled=this.gridEnabled?"1":"0";viewport.dataset.worldImageryEnabled=this.imageryEnabled?"1":"0";viewport.dataset.worldImageryLayer=this.map?.getLayer(WORLD_IMAGERY_LAYER_ID)?"ready":"pending";viewport.dataset.worldMinimapMode=Math.abs(miniBearing)<.01?"north":"look";viewport.dataset.worldMinimapBearing=miniBearing.toFixed(2);viewport.dataset.worldMinimapProjection="topdown";viewport.dataset.worldMinimapPitch="0.00";viewport.dataset.worldMinimapRoll="0.00";viewport.dataset.worldMinimapHeightMode="flat-footprints";viewport.dataset.worldMinimapAxisLock=this.minimapAxisLocked?"1":"0";viewport.dataset.worldMinimapAxisLockApplied=axisLockApplies?"1":"0";}
  }
  setGridEnabled(value){this.gridEnabled=Boolean(value);try{localStorage.setItem(WORLD_GRID_STORAGE,this.gridEnabled?"1":"0");}catch{}this.renderLookHud();return this.gridEnabled;}
  setKeepLookOrientation(value){this.keepLookOrientation=Boolean(value);try{localStorage.setItem(WORLD_KEEP_LOOK_STORAGE,this.keepLookOrientation?"1":"0");}catch{}if(!this.keepLookOrientation&&!this.lookDragging&&!this.gamepadLookActive&&(Math.abs(this.lookYawDeg)>.05||Math.abs(this.lookPitchDeg)>.05))this.lookSnapping=true;this.renderLookHud();return this.keepLookOrientation;}
  setMinimapAxisLocked(value){this.minimapAxisLocked=Boolean(value);try{localStorage.setItem(WORLD_MINIMAP_AXIS_LOCK_STORAGE,this.minimapAxisLocked?"1":"0");}catch{}this.minimapLastDrawMs=-Infinity;this.renderLookHud();this.drawMinimap(performance.now());return this.minimapAxisLocked;}
  setImageryEnabled(value){
    this.imageryEnabled=Boolean(value);try{localStorage.setItem(WORLD_IMAGERY_STORAGE,this.imageryEnabled?"1":"0");}catch{}
    if(this.map?.getLayer(WORLD_IMAGERY_LAYER_ID)){try{this.map.setLayoutProperty(WORLD_IMAGERY_LAYER_ID,"visibility",this.imageryEnabled?"visible":"none");}catch(error){console.warn("WORLD imagery visibility warning:",error);}}
    if(this.active&&Number.isFinite(this.originLat)&&Number.isFinite(this.originLon))this.status(`REAL WORLD LIVE · ${this.imageryEnabled?"AERIAL + OSM":"OSM MAP"} · ${this.vsWorldFromMate?"MATE GPS ORIGIN":"GPS"} ${this.originLat.toFixed(6)}, ${this.originLon.toFixed(6)}`,"good");
    this.minimapLastDrawMs=-Infinity;this.renderLookHud();this.drawMinimap(performance.now());return this.imageryEnabled;
  }
  setGamepadLook(active,x=0,y=0,dt=1/60){
    const wasActive=this.gamepadLookActive;this.gamepadLookActive=Boolean(active);
    if(!this.gamepadLookActive){if(wasActive&&!this.keepLookOrientation)this.lookSnapping=true;if(wasActive)this.renderLookHud();return;}
    this.lookDragging=false;this.lookPointer=null;this.lookSnapping=false;const step=clamp(Number(dt)||0,0,.05);this.lookYawDeg=((this.lookYawDeg+clamp(Number(x)||0,-1,1)*105*step+540)%360)-180;this.lookPitchDeg=clamp(this.lookPitchDeg-clamp(Number(y)||0,-1,1)*82*step,-75,60);this.minimapLastDrawMs=-Infinity;this.renderLookHud();
  }
  toggleMinimapExpanded(){this.minimapExpanded=!this.minimapExpanded;if(!this.minimapExpanded)this.minimapZoom=1;this.lookHud?.classList.toggle("expanded",this.minimapExpanded);if(this.minimapCanvas){this.minimapCanvas.width=this.minimapExpanded?392:196;this.minimapCanvas.height=this.minimapExpanded?344:172;}this.minimapLastDrawMs=-Infinity;this.drawMinimap(performance.now());return this.minimapExpanded;}
  resetLook(immediate=false){this.lookDragging=false;this.gamepadLookActive=false;this.lookPointer=null;if(immediate){this.lookYawDeg=0;this.lookPitchDeg=0;this.lookSnapping=false;}else this.lookSnapping=true;this.renderLookHud();}
  stepLook(now){const dt=clamp((now-this.lookFrameMs)/1000,0,.05);this.lookFrameMs=now;if(this.lookSnapping&&!this.lookDragging&&!this.gamepadLookActive){const decay=Math.exp(-WORLD_LOOK_SNAP_RATE*dt);this.lookYawDeg*=decay;this.lookPitchDeg*=decay;if(Math.abs(this.lookYawDeg)<.08&&Math.abs(this.lookPitchDeg)<.08){this.lookYawDeg=0;this.lookPitchDeg=0;this.lookSnapping=false;}this.renderLookHud();}}
  airframeFor(scene){if(this.airframe?.parent)return this.airframe;this.airframe=null;scene.traverse(node=>{if(!this.airframe&&node.userData?.arondightAirframe)this.airframe=node;});return this.airframe;}
  attachCameraCollisionResolver(resolver){this.cameraCollisionResolver=typeof resolver==="function"?resolver:null;}
  constrainCameraToPhysics(anchor,camera){
    if(typeof this.cameraCollisionResolver!=="function"||!anchor||!camera?.position)return false;let result=null;try{result=this.cameraCollisionResolver([anchor.x,anchor.y,anchor.z],[camera.position.x,camera.position.y,camera.position.z]);}catch{return false;}const position=result?.position;if(Array.isArray(position)&&position.length===3&&position.every(Number.isFinite))camera.position.set(...position);const viewport=$("viewport");if(viewport){viewport.dataset.cameraCollision=result?.collided?"blocked":"clear";viewport.dataset.cameraCollisionHitDistanceM=Number(result?.hitDistanceM||0).toFixed(3);}return Boolean(result?.collided);
  }
  applyLookCamera(scene,camera){
    this.stepLook(performance.now());const mode=$("viewport")?.dataset.cameraMode||"follow",airframe=this.airframeFor(scene);if(!airframe)return;const target=airframe.position.clone();if(mode!=="fpv")target.z+=.10;const hasLook=Math.abs(this.lookYawDeg)>=.001||Math.abs(this.lookPitchDeg)>=.001;if(!hasLook){this.constrainCameraToPhysics(target,camera);return;}const yaw=THREE.MathUtils.degToRad(this.lookYawDeg),pitch=THREE.MathUtils.degToRad(this.lookPitchDeg),worldUp=new THREE.Vector3(0,0,1);
    if(mode==="fpv"){const dir=new THREE.Vector3();camera.getWorldDirection(dir).normalize();const up=camera.up.clone().normalize(),yawQ=new THREE.Quaternion().setFromAxisAngle(worldUp,-yaw);dir.applyQuaternion(yawQ);up.applyQuaternion(yawQ);const right=new THREE.Vector3().crossVectors(dir,up).normalize(),pitchQ=new THREE.Quaternion().setFromAxisAngle(right,pitch);dir.applyQuaternion(pitchQ);up.applyQuaternion(pitchQ);camera.up.copy(up.normalize());this.constrainCameraToPhysics(target,camera);camera.lookAt(camera.position.clone().addScaledVector(dir,4));return;}
    const relative=camera.position.clone().sub(target);relative.applyAxisAngle(worldUp,-yaw);const radial=relative.clone().normalize(),right=new THREE.Vector3().crossVectors(radial,worldUp);if(right.lengthSq()>.0001)relative.applyAxisAngle(right.normalize(),pitch);camera.position.copy(target).add(relative);this.constrainCameraToPhysics(target,camera);camera.up.copy(worldUp);camera.lookAt(target);
  }
  configureMinimapLayers(){
    if(!this.map)return;const layers=this.map.getStyle()?.layers||[],allowed=new Set(["water","waterway","landcover","landuse","transportation"]);this.minimapLayerIds=layers.filter(layer=>layer.id==="arondight45-buildings-3d"||(layer.type!=="symbol"&&allowed.has(String(layer["source-layer"]||"").toLowerCase()))).map(layer=>layer.id);
  }
  cacheMinimapFeatures(now){
    const interval=this.perfMode==="critical"?WORLD_MINIMAP_QUERY_MS*2:WORLD_MINIMAP_QUERY_MS;if(!this.map||!this.minimapLayerIds.length||now-this.minimapLastQueryMs<interval)return;this.minimapLastQueryMs=now;this.minimapQueries++;const cached=[];
    try{for(const feature of this.map.queryRenderedFeatures(undefined,{layers:this.minimapLayerIds})){if(cached.length>=WORLD_MINIMAP_MAX_FEATURES)break;const source=String(feature.sourceLayer||feature.layer?.["source-layer"]||"").toLowerCase(),id=String(feature.layer?.id||"").toLowerCase(),geometryType=String(feature.geometry?.type||"");let kind="";if(source==="water"||source==="waterway")kind="water";else if(source==="building"||id==="arondight45-buildings-3d")kind="building";else if(source==="transportation")kind="road";else if((source==="landcover"||source==="landuse")&&/park|wood|forest|grass|garden|pitch|meadow|farmland|scrub/.test(id))kind="green";if(!kind)continue;const paths=geometryPaths(feature.geometry).map(path=>{const step=Math.max(1,Math.ceil(path.length/28));return path.filter((_,i)=>i%step===0).map(point=>[Number(point[0]),Number(point[1])]).filter(point=>point.every(Number.isFinite));}).filter(path=>path.length>=2);if(!paths.length)continue;cached.push({kind,geometryType,paths});}}catch(error){console.warn("WORLD mini-map cache warning:",error);}this.minimapFeatures=cached;const viewport=$("viewport");if(viewport){viewport.dataset.worldMinimapFeatures=String(cached.length);viewport.dataset.worldMinimapQueries=String(this.minimapQueries);}
  }
  minimapImageryTile(zoom,tileX,tileY,now){
    const count=2**zoom;if(tileY<0||tileY>=count)return null;const wrappedX=((tileX%count)+count)%count,key=`${zoom}/${wrappedX}/${tileY}`;let entry=this.minimapImageryTiles.get(key);
    if(entry){entry.lastUsed=now;return entry;}
    const image=new Image();image.decoding="async";entry={image,state:"loading",lastUsed:now};this.minimapImageryTiles.set(key,entry);
    image.onload=()=>{entry.state="ready";entry.lastUsed=performance.now();this.minimapLastDrawMs=-Infinity;requestAnimationFrame(()=>this.drawMinimap(performance.now()));};
    image.onerror=()=>{entry.state="error";entry.lastUsed=performance.now();};image.src=imageryTileUrl(zoom,wrappedX,tileY);
    if(this.minimapImageryTiles.size>WORLD_MINIMAP_IMAGERY_CACHE_SIZE){const removable=[...this.minimapImageryTiles].filter(([,value])=>value.state!=="loading").sort((a,b)=>a[1].lastUsed-b[1].lastUsed);while(this.minimapImageryTiles.size>WORLD_MINIMAP_IMAGERY_CACHE_SIZE&&removable.length)this.minimapImageryTiles.delete(removable.shift()[0]);}
    return entry;
  }
  drawMinimapImagery(ctx,w,h,longitude,latitude,displayScale,bearingDeg,now){
    if(!this.imageryEnabled)return{drawn:0,zoom:0};const cosLat=Math.max(.05,Math.cos(latitude*Math.PI/180)),targetMpp=1/Math.max(.01,displayScale),zoom=clamp(Math.round(Math.log2(156543.03392804097*cosLat/targetMpp)),14,WORLD_IMAGERY_MAX_ZOOM),nativeMpp=156543.03392804097*cosLat/2**zoom,tileScale=displayScale*nativeMpp,[centerX,centerY]=mercatorWorldPixel(longitude,latitude,zoom),halfSource=Math.hypot(w,h)/(2*Math.max(.01,tileScale))+3,minX=Math.floor((centerX-halfSource)/256),maxX=Math.floor((centerX+halfSource)/256),minY=Math.floor((centerY-halfSource)/256),maxY=Math.floor((centerY+halfSource)/256);let drawn=0;
    ctx.save();ctx.translate(w/2,h/2);ctx.rotate(-THREE.MathUtils.degToRad(bearingDeg));ctx.scale(tileScale,tileScale);ctx.globalAlpha=.98;
    for(let tileY=minY;tileY<=maxY;tileY++)for(let tileX=minX;tileX<=maxX;tileX++){const entry=this.minimapImageryTile(zoom,tileX,tileY,now);if(entry?.state!=="ready")continue;ctx.drawImage(entry.image,tileX*256-centerX,tileY*256-centerY,256,256);drawn++;}
    ctx.restore();return{drawn,zoom};
  }
  drawMinimap(now){
    if(!this.active||!this.minimapCtx||!this.minimapCanvas||!Number.isFinite(this.originLon)||!Number.isFinite(this.originLat))return;const drawInterval=this.perfMode==="critical"?WORLD_MINIMAP_DRAW_MS*2:WORLD_MINIMAP_DRAW_MS;if(now-this.minimapLastDrawMs<drawInterval)return;this.minimapLastDrawMs=now;this.cacheMinimapFeatures(now);const airframe=this.airframeFor(this.threeScene);if(!airframe)return;
    const canvas=this.minimapCanvas,ctx=this.minimapCtx,w=canvas.width,h=canvas.height,position=airframe.position,viewport=$("viewport"),miniBearing=this.minimapBearingDeg(),rad=THREE.MathUtils.degToRad(miniBearing),c=Math.cos(rad),si=Math.sin(rad),expanded=this.minimapExpanded,fovScale=clamp(this.viewFovDeg/105,.48,1.25),radius=clamp(((55+Math.max(0,position.z)*2)*fovScale)/(expanded?this.minimapZoom:1),expanded?15:42,expanded?380:190),scale=w/(radius*2),baseY=h*.5;
    const projectLocal=(east,north)=>{const dx=east-position.x,dy=north-position.y,rx=dx*c-dy*si,ry=dx*si+dy*c;return[w/2+rx*scale,baseY-ry*scale];};
    const project=(lon,lat)=>{const [east,north]=lngLatToMeters(this.originLon,this.originLat,lon,lat);return projectLocal(east,north);};
    const gradient=ctx.createLinearGradient(0,0,0,h);gradient.addColorStop(0,"#18384d");gradient.addColorStop(1,"#071522");ctx.fillStyle=gradient;ctx.fillRect(0,0,w,h);const [miniLon,miniLat]=metersToLngLat(this.originLon,this.originLat,position.x,position.y),imagery=this.drawMinimapImagery(ctx,w,h,miniLon,miniLat,scale,miniBearing,now);
    if(this.gridEnabled){ctx.lineWidth=1;for(let v=-Math.ceil(radius/20)*20;v<=radius;v+=20){for(const axis of [0,1]){const a=axis?projectLocal(position.x-radius,position.y+v):projectLocal(position.x+v,position.y-radius),b=axis?projectLocal(position.x+radius,position.y+v):projectLocal(position.x+v,position.y+radius);ctx.strokeStyle=v===0?"rgba(157,233,255,.35)":"rgba(103,188,215,.14)";ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke();}}}
    const imageryVisible=this.imageryEnabled&&imagery.drawn>0;
    for(const feature of this.minimapFeatures)for(const path of feature.paths){
      const footprint=path.map(point=>project(point[0],point[1])),polygon=feature.geometryType.includes("Polygon");
      if(feature.kind==="road"){ctx.strokeStyle=imageryVisible?"rgba(255,231,155,.86)":"#e3c56b";ctx.lineWidth=2;ctx.beginPath();footprint.forEach((point,i)=>i?ctx.lineTo(...point):ctx.moveTo(...point));ctx.stroke();continue;}
      if(feature.kind==="water"){ctx.fillStyle=imageryVisible?"rgba(35,125,176,.16)":"rgba(35,125,176,.74)";ctx.strokeStyle=imageryVisible?"rgba(85,183,223,.72)":"#55b7df";ctx.lineWidth=1.5;ctx.beginPath();footprint.forEach((point,i)=>i?ctx.lineTo(...point):ctx.moveTo(...point));if(polygon){ctx.closePath();ctx.fill();}ctx.stroke();continue;}
      if(feature.kind==="green"){ctx.fillStyle=imageryVisible?"rgba(79,123,85,.10)":"rgba(79,123,85,.66)";ctx.beginPath();footprint.forEach((point,i)=>i?ctx.lineTo(...point):ctx.moveTo(...point));ctx.closePath();ctx.fill();continue;}
      ctx.fillStyle=imageryVisible?"rgba(189,203,211,.16)":"rgba(189,203,211,.66)";ctx.strokeStyle=imageryVisible?"rgba(239,247,250,.70)":"rgba(226,240,247,.82)";ctx.lineWidth=1;ctx.beginPath();footprint.forEach((point,i)=>i?ctx.lineTo(...point):ctx.moveTo(...point));ctx.closePath();ctx.fill();ctx.stroke();
    }
    const forward=new THREE.Vector3(-1,0,0).applyQuaternion(airframe.quaternion),airBearing=THREE.MathUtils.radToDeg(Math.atan2(forward.x,forward.y)),rel=(airBearing-miniBearing)*Math.PI/180,cx=w/2,cy=baseY;ctx.save();ctx.translate(cx,cy);ctx.rotate(rel);ctx.fillStyle="#ff5c76";ctx.strokeStyle="#ffffff";ctx.lineWidth=1.4;ctx.beginPath();ctx.moveTo(0,-9);ctx.lineTo(6,7);ctx.lineTo(0,4);ctx.lineTo(-6,7);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();ctx.fillStyle="#d8f7ff";ctx.font="800 12px system-ui";ctx.fillText(Math.abs(miniBearing)<.01?"N↑":"VIEW↑",7,15);ctx.fillStyle="#9bc5d8";ctx.font="700 9px ui-monospace,monospace";ctx.fillText(`${Math.round(position.z)}m`,7,h-7);if(viewport){viewport.dataset.worldMinimapMode=Math.abs(miniBearing)<.01?"north":"look";viewport.dataset.worldMinimapBearing=miniBearing.toFixed(2);viewport.dataset.worldMinimapFov=this.viewFovDeg.toFixed(1);viewport.dataset.worldMinimapProjection="topdown";viewport.dataset.worldMinimapPitch="0.00";viewport.dataset.worldMinimapRoll="0.00";viewport.dataset.worldMinimapHeightMode="flat-footprints";viewport.dataset.worldMinimapAxisLock=this.minimapAxisLocked?"1":"0";viewport.dataset.worldMinimapAxisLockApplied=!document.fullscreenElement&&this.minimapAxisLocked?"1":"0";viewport.dataset.worldMinimapZoom=(expanded?this.minimapZoom:1).toFixed(2);viewport.dataset.worldMinimapImageryTiles=String(imagery.drawn);viewport.dataset.worldMinimapImageryZoom=String(imagery.zoom);}
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
  addWorldImagery(){
    if(!this.map)return;
    try{if(!this.map.getSource(WORLD_IMAGERY_SOURCE_ID))this.map.addSource(WORLD_IMAGERY_SOURCE_ID,{type:"raster",tiles:[WORLD_IMAGERY_TILE_URL],tileSize:256,maxzoom:WORLD_IMAGERY_MAX_ZOOM,attribution:WORLD_IMAGERY_ATTRIBUTION});
      if(!this.map.getLayer(WORLD_IMAGERY_LAYER_ID)){const before=(this.map.getStyle()?.layers||[]).find(layer=>layer.type==="line"&&["transportation","boundary"].includes(String(layer["source-layer"]||"").toLowerCase()))?.id,layer={id:WORLD_IMAGERY_LAYER_ID,type:"raster",source:WORLD_IMAGERY_SOURCE_ID,paint:{"raster-opacity":1,"raster-fade-duration":0,"raster-resampling":"linear","raster-contrast":.08,"raster-saturation":.06,"raster-brightness-min":.04,"raster-brightness-max":.98}};if(before)this.map.addLayer(layer,before);else this.map.addLayer(layer);}
      this.map.setLayoutProperty(WORLD_IMAGERY_LAYER_ID,"visibility",this.imageryEnabled?"visible":"none");
    }catch(error){console.warn("WORLD aerial imagery layer unavailable; vector map remains active:",error);}
    this.renderLookHud();
  }
  attachBuildingCollisionSink(sink){this.buildingCollisionSink=typeof sink==="function"?sink:null;if(this.buildingCollisionSink)this.buildingCollisionSink(this.buildingCollisionSnapshot);if(this.active){this.buildingCollisionDirty=true;this.syncBuildingCollisions(true);}return Boolean(this.buildingCollisionSink);}
  clearBuildingCollisions(){
    const snapshot=Object.freeze({hash:"",footprintCount:0,prismCount:0,prisms:[]});this.buildingCollisionSnapshot=snapshot;this.buildingCollisionDirty=true;this.buildingCollisionLastCenter=[Infinity,Infinity];this.buildingCollisionSink?.(snapshot);const viewport=$("viewport");if(viewport){viewport.dataset.worldBuildingCollisionStatus="inactive";viewport.dataset.worldBuildingCollisionFootprints="0";viewport.dataset.worldBuildingCollisionPrisms="0";}return snapshot;
  }
  buildingCollisionFeatures(){
    if(!this.map||!this.buildingSourceId)return[];try{const features=this.map.querySourceFeatures?.(this.buildingSourceId,{sourceLayer:"building"});if(Array.isArray(features)&&features.length)return features;}catch(error){console.warn("WORLD building collision source query warning:",error);}try{const features=this.map.getLayer("arondight45-buildings-3d")?this.map.queryRenderedFeatures?.(undefined,{layers:["arondight45-buildings-3d"]}):[];return Array.isArray(features)?features:[];}catch(error){console.warn("WORLD building collision render query warning:",error);return[];}
  }
  syncBuildingCollisions(force=false){
    if(!this.active||!this.map||!this.buildingCollisionSink||!Number.isFinite(this.originLon)||!Number.isFinite(this.originLat))return false;const now=performance.now();if(!force&&now-this.buildingCollisionLastSyncMs<WORLD_BUILDING_COLLISION_SYNC_MS)return false;const airframe=this.airframeFor(this.threeScene),center=[Number(airframe?.position?.x)||0,Number(airframe?.position?.y)||0],moved=Math.hypot(center[0]-this.buildingCollisionLastCenter[0],center[1]-this.buildingCollisionLastCenter[1]);if(!force&&!this.buildingCollisionDirty&&moved<20)return false;this.buildingCollisionLastSyncMs=now;
    const features=this.buildingCollisionFeatures();if(!features.length){const viewport=$("viewport");if(viewport)viewport.dataset.worldBuildingCollisionStatus="waiting-for-vector-tiles";return false;}const footprints=buildingFootprintsFromFeatures(features,{project:(longitude,latitude)=>lngLatToMeters(this.originLon,this.originLat,longitude,latitude),center}),hash=buildingFootprintHash(footprints);if(hash===this.buildingCollisionSnapshot.hash){this.buildingCollisionDirty=false;this.buildingCollisionLastCenter=center;return false;}
    const prisms=buildingCollisionPrismsFromFootprints(footprints,(outer,holes)=>THREE.ShapeUtils.triangulateShape(outer.map(point=>new THREE.Vector2(...point)),holes.map(ring=>ring.map(point=>new THREE.Vector2(...point))))),snapshot=Object.freeze({hash,footprintCount:footprints.length,prismCount:prisms.length,prisms});this.buildingCollisionSink(snapshot);this.buildingCollisionSnapshot=snapshot;this.buildingCollisionDirty=false;this.buildingCollisionLastCenter=center;this.buildingCollisionRevisions++;const viewport=$("viewport");if(viewport){viewport.dataset.worldBuildingCollisionStatus=prisms.length?"box3d-active":"no-nearby-buildings";viewport.dataset.worldBuildingCollisionFootprints=String(footprints.length);viewport.dataset.worldBuildingCollisionPrisms=String(prisms.length);viewport.dataset.worldBuildingCollisionRevision=String(this.buildingCollisionRevisions);}return true;
  }
  addBuildings(){
    if(!this.map)return;const existing=this.map.getLayer("arondight45-buildings-3d");if(existing){this.buildingSourceId=existing.source||this.buildingSourceId;this.buildingCollisionDirty=true;return;}
    const style=this.map.getStyle(),sourceId=Object.entries(style.sources||{}).find(([,source])=>source?.type==="vector")?.[0];
    if(!sourceId){console.warn("OpenFreeMap style has no vector source for 3D buildings");return;}
    this.buildingSourceId=sourceId;this.buildingCollisionDirty=true;
    const before=(style.layers||[]).find(layer=>layer.type==="symbol")?.id;
    const height=["coalesce",["to-number",["get","render_height"]],8],layer={id:"arondight45-buildings-3d",type:"fill-extrusion",source:sourceId,"source-layer":"building",minzoom:14,paint:{"fill-extrusion-color":["interpolate",["linear"],height,0,"#6f7d7b",12,"#9aa7a4",35,"#c5cfcc",80,"#edf0ec"],"fill-extrusion-height":height,"fill-extrusion-base":["coalesce",["to-number",["get","render_min_height"]],0],"fill-extrusion-opacity":.78,"fill-extrusion-vertical-gradient":true}};
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
    if(this.map){this.geoContainer.hidden=false;this.map.resize();this.map.jumpTo({center:[longitude,latitude],zoom:19,pitch:55,bearing:0});this.setImageryEnabled(this.imageryEnabled);this.addBuildings();this.buildingCollisionDirty=true;return this.map;}
    const viewport=$("viewport"),container=document.createElement("div");container.id="geoViewport";container.hidden=true;viewport.insertBefore(container,viewport.firstChild);this.geoContainer=container;
    const stableBackbuffer=globalThis.__arondightDiagnostics?.presentationStableBackbuffer===true,softwareRaster=globalThis.__arondightDiagnostics?.presentationSoftwareRaster===true;
    this.mapPixelRatio=Math.min(devicePixelRatio||1,softwareRaster?WORLD_MAP_SOFTWARE_PIXEL_RATIO:stableBackbuffer?1:WORLD_MAP_PIXEL_RATIO);
    this.map=new MapLibreMap({container,style:OPENFREEMAP_STYLE,center:[longitude,latitude],zoom:19,pitch:55,bearing:0,roll:0,maxPitch:WORLD_MAP_MAX_PITCH,maxZoom:WORLD_MAP_MAX_ZOOM,interactive:false,attributionControl:false,maplibreLogo:false,fadeDuration:0,renderWorldCopies:false,centerClampedToGround:false,pixelRatio:this.mapPixelRatio,maxTileCacheZoomLevels:2,maxCanvasSize:[2048,2048],cancelPendingTileRequestsWhileZooming:true,refreshExpiredTiles:false,validateStyle:false,crossSourceCollisions:false,trackResize:false,reduceMotion:true,canvasContextAttributes:{antialias:false,powerPreference:stableBackbuffer?"default":"high-performance",desynchronized:false,preserveDrawingBuffer:false}});
    viewport.dataset.worldStableBackbuffer=stableBackbuffer?"1":"0";viewport.dataset.worldMapCanvasDesynchronized="0";
    const attribution=document.createElement("div");attribution.className="geo-attribution";attribution.textContent="Imagery © Esri, Vantor, Earthstar Geographics, GIS User Community · Map © OpenFreeMap, OpenMapTiles, OpenStreetMap contributors";container.appendChild(attribution);
    this.map.on("error",event=>console.warn("OpenFreeMap render warning:",event?.error||event));
    this.map.on("sourcedata",event=>{if(!this.buildingSourceId||event?.sourceId===this.buildingSourceId)this.buildingCollisionDirty=true;});
    await Promise.race([new Promise(resolve=>this.map.once("load",resolve)),new Promise((_,reject)=>setTimeout(()=>reject(Error("OpenFreeMap style load timeout")),20000))]);
    this.applyFlightPalette();this.stripFlightClutter();this.addWorldImagery();
    try{this.map.setSky({"sky-color":"#071b2e","sky-horizon-blend":.52,"horizon-color":"#6e93aa","horizon-fog-blend":.34,"fog-color":"#365f79","fog-ground-blend":.12});}catch(error){console.warn("OpenFreeMap sky contrast unavailable:",error);}
    try{this.map.setLight?.({anchor:"viewport",position:[1.35,210,32],color:"#fff3dd",intensity:.78});}catch(error){console.warn("OpenFreeMap extrusion lighting unavailable:",error);}
    this.addBuildings();this.configureMinimapLayers();return this.map;
  }
  async activate(locationFix=null){
    if(this.loading)return;if(this.active)return;
    const fromMate=Boolean(locationFix?.vsSharedOrigin);
    this.loading=true;this.status(fromMate?"REAL WORLD · using mate GPS origin…":"REAL WORLD · requesting high-accuracy GPS permission…","warn");
    try{
      const fix=locationFix?.coords?locationFix:await geolocate();this.lastLocation=fix;const {latitude,longitude,accuracy}=fix.coords;
      if(!Number.isFinite(latitude)||!Number.isFinite(longitude))throw Error("GPS returned no valid latitude/longitude");
      this.vsWorldFromMate=fromMate;this.originLat=latitude;this.originLon=longitude;const source=fromMate?"MATE GPS ORIGIN":"GPS";this.status(`${source} ${latitude.toFixed(6)}, ${longitude.toFixed(6)} · ±${Math.round(accuracy||0)} m · loading aerial imagery + OSM…`,"warn");
      await this.createMap(longitude,latitude);this.active=true;this.loading=false;
      if(!this.threeRenderer)throw Error("Flight renderer is not ready");
      this.lastMapSyncMs=-Infinity;this.lastMapView=null;this.mapUpdates=0;this.presentationFrameSerial=0;this.lastMapSyncFrameSerial=-1;this.perfWindowStart=performance.now();this.perfFrames=0;this.perfGoodWindows=0;this.perfMode="nominal";this.worldShotQueries=0;
      const worldFlightRatio=Math.min(this.flightPixelRatio||devicePixelRatio||1,WORLD_FLIGHT_PIXEL_RATIO);if(Math.abs(this.threeRenderer.getPixelRatio()-worldFlightRatio)>.001)this.threeRenderer.setPixelRatio(worldFlightRatio);this.threeRenderer.shadowMap.enabled=false;
      this.threeRenderer.domElement.style.visibility="visible";this.threeRenderer.domElement.style.display="block";this.geoContainer.hidden=false;
      const viewport=$("viewport");viewport.dataset.worldMode="real";viewport.dataset.worldProvider="openfreemap-esri-imagery";viewport.dataset.worldRenderPath="shared-three-renderer";viewport.dataset.worldLatitude=String(latitude);viewport.dataset.worldLongitude=String(longitude);viewport.dataset.worldMapFpsCap=String(this.mapFpsCap());viewport.dataset.worldMapPixelRatio=String(this.mapPixelRatio);viewport.dataset.worldFlightPixelRatio=String(Math.min(this.flightPixelRatio||devicePixelRatio||1,WORLD_FLIGHT_PIXEL_RATIO));viewport.dataset.worldMapUpdates="0";viewport.dataset.worldGridEnabled=this.gridEnabled?"1":"0";viewport.dataset.worldImageryEnabled=this.imageryEnabled?"1":"0";viewport.dataset.worldImageryLayer=this.map.getLayer(WORLD_IMAGERY_LAYER_ID)?"ready":"pending";viewport.dataset.worldLookKeepEnabled=this.keepLookOrientation?"1":"0";viewport.dataset.worldPerfMode=this.perfMode;viewport.dataset.worldFlightFps="0";viewport.dataset.worldMinimapQueries="0";viewport.dataset.worldMinimapImageryTiles="0";viewport.dataset.worldShotQueries="0";viewport.dataset.worldBuildingCollisionStatus="waiting-for-vector-tiles";viewport.dataset.worldBuildingCollisionFootprints="0";viewport.dataset.worldBuildingCollisionPrisms="0";this.minimapLastQueryMs=-Infinity;this.minimapLastDrawMs=-Infinity;this.minimapQueries=0;this.buildingCollisionDirty=true;this.renderLookHud();this.syncBuildingCollisions(true);
      const mode=$("worldMode"),config=$("realWorldConfig");if(mode)mode.value="real";if(config)config.hidden=false;
      this.status(`REAL WORLD LIVE · ${this.imageryEnabled?"AERIAL + OSM":"OSM MAP"} · ${fromMate?"MATE GPS ORIGIN":"GPS"} ${latitude.toFixed(6)}, ${longitude.toFixed(6)} · ±${Math.round(accuracy||0)} m`,"good");try{localStorage.setItem(MODE_STORAGE,"real");}catch{}
    }catch(error){this.loading=false;if(fromMate){this.originLon=null;this.originLat=null;this.vsWorldFromMate=false;}throw error;}
  }
  deactivate(){
    this.active=false;this.loading=false;this.lastMapSyncFrameSerial=-1;this.clearBuildingCollisions();this.resetLook(true);if(this.geoContainer)this.geoContainer.hidden=true;if(this.threeRenderer){this.threeRenderer.domElement.style.visibility="visible";this.threeRenderer.domElement.style.display="block";this.threeRenderer.setClearAlpha(1);if(this.flightPixelRatio!==null&&Math.abs(this.threeRenderer.getPixelRatio()-this.flightPixelRatio)>.001)this.threeRenderer.setPixelRatio(this.flightPixelRatio);if(this.flightShadowEnabled!==null)this.threeRenderer.shadowMap.enabled=this.flightShadowEnabled;}if(this.threeScene){this.restoreTrainingWorld();this.threeScene.traverse(node=>{if(node.userData?.flightFireDecal&&node.userData.flightFireWorld)node.visible=false;});if(this.savedBackground!==null)this.threeScene.background=this.savedBackground;if(this.savedFog!==null)this.threeScene.fog=this.savedFog;}
    const viewport=$("viewport");if(viewport){viewport.dataset.worldMode="training";delete viewport.dataset.worldProvider;delete viewport.dataset.worldRenderPath;delete viewport.dataset.worldLatitude;delete viewport.dataset.worldLongitude;delete viewport.dataset.worldCameraMode;delete viewport.dataset.worldMapEye;delete viewport.dataset.worldMapEyeElevation;delete viewport.dataset.worldMapCenter;delete viewport.dataset.worldMapZoom;delete viewport.dataset.worldMapPitch;delete viewport.dataset.worldMapBearing;delete viewport.dataset.worldMapSyncMode;delete viewport.dataset.worldMapTargetElevation;delete viewport.dataset.worldThreeFrames;delete viewport.dataset.worldMapUpdates;delete viewport.dataset.worldMapFpsCap;delete viewport.dataset.worldMapPixelRatio;delete viewport.dataset.worldFlightPixelRatio;delete viewport.dataset.worldSymbolsRemoved;delete viewport.dataset.worldLookYaw;delete viewport.dataset.worldLookPitch;delete viewport.dataset.worldLookKeepEnabled;delete viewport.dataset.worldGridEnabled;delete viewport.dataset.worldImageryEnabled;delete viewport.dataset.worldImageryLayer;delete viewport.dataset.worldFlightFps;delete viewport.dataset.worldPerfMode;delete viewport.dataset.worldPaletteLayers;delete viewport.dataset.worldMinimapMode;delete viewport.dataset.worldMinimapBearing;delete viewport.dataset.worldMinimapProjection;delete viewport.dataset.worldMinimapPitch;delete viewport.dataset.worldMinimapRoll;delete viewport.dataset.worldMinimapHeightMode;delete viewport.dataset.worldMinimapAxisLock;delete viewport.dataset.worldMinimapAxisLockApplied;delete viewport.dataset.worldMinimapFov;delete viewport.dataset.worldMinimapZoom;delete viewport.dataset.worldMinimapFeatures;delete viewport.dataset.worldMinimapQueries;delete viewport.dataset.worldMinimapImageryTiles;delete viewport.dataset.worldMinimapImageryZoom;delete viewport.dataset.worldShotQueries;delete viewport.dataset.worldBuildingCollisionStatus;delete viewport.dataset.worldBuildingCollisionFootprints;delete viewport.dataset.worldBuildingCollisionPrisms;delete viewport.dataset.worldBuildingCollisionRevision;}
    const mode=$("worldMode"),config=$("realWorldConfig");if(mode)mode.value="training";if(config)config.hidden=true;this.status("TRAINING RANGE · local metric world");try{localStorage.setItem(MODE_STORAGE,"training");}catch{}
  }
  mapFrameIntervalMs(){return this.perfMode==="critical"?WORLD_MAP_FRAME_MS_CRITICAL:this.perfMode==="constrained"?WORLD_MAP_FRAME_MS_CONSTRAINED:WORLD_MAP_FRAME_MS_NOMINAL;}
  mapFpsCap(){return this.perfMode==="critical"?15:this.perfMode==="constrained"?20:30;}
  setPerfMode(mode){
    if(this.perfMode===mode)return;this.perfMode=mode;
    const fixedBackbuffer=globalThis.__arondightDiagnostics?.presentationStableBackbuffer===true;if(this.threeRenderer&&!fixedBackbuffer){const ceiling=Math.min(this.flightPixelRatio||devicePixelRatio||1,WORLD_FLIGHT_PIXEL_RATIO),ratio=mode==="critical"?Math.min(ceiling,.75):mode==="constrained"?Math.min(ceiling,1):ceiling;if(Math.abs(this.threeRenderer.getPixelRatio()-ratio)>.001)this.threeRenderer.setPixelRatio(ratio);$("viewport").dataset.worldFlightPixelRatio=String(ratio);}
    const viewport=$("viewport");if(viewport){viewport.dataset.worldPerfMode=mode;viewport.dataset.worldMapFpsCap=String(this.mapFpsCap());}
  }
  trackFlightPerformance(now){
    this.perfFrames++;const elapsed=now-this.perfWindowStart;if(elapsed<WORLD_PERF_WINDOW_MS)return;this.flightFps=this.perfFrames*1000/Math.max(1,elapsed);this.perfFrames=0;this.perfWindowStart=now;const viewport=$("viewport");if(viewport)viewport.dataset.worldFlightFps=this.flightFps.toFixed(1);
    if(this.flightFps<WORLD_FPS_CRITICAL){this.perfGoodWindows=0;this.setPerfMode("critical");return;}if(this.flightFps<WORLD_FPS_CONSTRAINED){this.perfGoodWindows=0;this.setPerfMode("constrained");return;}if(this.flightFps>WORLD_FPS_RECOVER){this.perfGoodWindows++;if(this.perfGoodWindows>=3)this.setPerfMode("nominal");}else this.perfGoodWindows=0;
  }
  syncMapCamera(camera,frameSerial=null){
    if(!this.active||!this.map||!Number.isFinite(this.originLon)||!Number.isFinite(this.originLat))return;
    const now=performance.now(),viewport=$("viewport"),cameraMode=viewport.dataset.cameraMode||"follow",forceMode=cameraMode!==(viewport.dataset.worldCameraMode||""),fpv=cameraMode==="fpv",rect=viewport.getBoundingClientRect(),size=`${Math.round(rect.width)}x${Math.round(rect.height)}`,forceResize=size!==this.lastViewportSize,forceUpdate=forceMode||forceResize;
    if(forceMode&&viewport.dataset.worldCameraMode)this.resetLook(true);
    const frameInterval=Math.max(WORLD_MAP_DIRECT_DEDUP_MS,this.mapFrameIntervalMs());if(!forceUpdate&&now-this.lastMapSyncMs<frameInterval)return;
    if(frameSerial!==null){if(!forceUpdate&&frameSerial===this.lastMapSyncFrameSerial)return;this.lastMapSyncFrameSerial=frameSerial;}
    const p=camera.position,dir=new THREE.Vector3(),actualUp=new THREE.Vector3(0,1,0).applyQuaternion(camera.quaternion).normalize();camera.getWorldDirection(dir).normalize();
    const height=Math.max(1,rect.height),verticalFov=clamp(camera.fov,10,120);if(Math.abs(this.map.getVerticalFieldOfView()-verticalFov)>.001)this.map.setVerticalFieldOfView(verticalFov);
    const minimumDistance=fpvTargetDistanceMeters(this.originLat,height,verticalFov,WORLD_MAP_MAX_ZOOM);let focusDistance=minimumDistance;if(!fpv&&dir.z<-.02&&p.z>0){const ground=-p.z/dir.z;if(Number.isFinite(ground)&&ground>0)focusDistance=Math.max(minimumDistance,clamp(ground,2,250));}
    const target=forwardTarget(p,dir,focusDistance),center=metersToLngLat(this.originLon,this.originLat,target.x,target.y),horizontal=Math.hypot(dir.x,dir.y);
    const bearing=THREE.MathUtils.radToDeg(Math.atan2(dir.x,dir.y)),pitch=clamp(90+THREE.MathUtils.radToDeg(Math.atan2(dir.z,Math.max(1e-6,horizontal))),0,WORLD_MAP_MAX_PITCH);let roll=0;if(horizontal>.02){const worldUp=new THREE.Vector3(0,0,1),right0=new THREE.Vector3().crossVectors(dir,worldUp).normalize(),up0=new THREE.Vector3().crossVectors(right0,dir).normalize();roll=THREE.MathUtils.radToDeg(Math.atan2(dir.dot(new THREE.Vector3().crossVectors(up0,actualUp)),up0.dot(actualUp)));}
    if(forceResize){this.lastViewportSize=size;this.map.resize();}
    if(typeof this.map.calculateCameraOptionsFromTo!=="function")throw Error("MapLibre eye/target camera API unavailable");const eye=metersToLngLat(this.originLon,this.originLat,p.x,p.y),options=this.map.calculateCameraOptionsFromTo(new LngLat(eye[0],eye[1]),p.z,new LngLat(center[0],center[1]),target.z),zoom=Number(options.zoom),view={...options,center,elevation:target.z,roll:clamp(roll,-85,85)};viewport.dataset.worldMapEye=`${eye[0].toFixed(7)},${eye[1].toFixed(7)}`;viewport.dataset.worldMapEyeElevation=p.z.toFixed(3);
    this.lastMapSyncMs=now;this.lastMapView={...view,center:[...center]};this.map.jumpTo(view);this.mapUpdates++;viewport.dataset.worldCameraMode=cameraMode;viewport.dataset.worldMapSyncMode=fpv?"rigid-eye-target":"stabilized-eye-target";viewport.dataset.worldMapCenter=`${center[0].toFixed(7)},${center[1].toFixed(7)}`;viewport.dataset.worldMapTargetElevation=Number(view.elevation||0).toFixed(3);viewport.dataset.worldMapZoom=Number(view.zoom||zoom||0).toFixed(4);viewport.dataset.worldMapPitch=Number(view.pitch??pitch).toFixed(3);viewport.dataset.worldMapBearing=Number(view.bearing??bearing).toFixed(3);viewport.dataset.worldMapUpdates=String(this.mapUpdates);
  }
  renderReal(scene,camera){
    this.presentationFrameSerial++;this.trackFlightPerformance(performance.now());const basePosition=camera.position.clone(),baseQuaternion=camera.quaternion.clone(),baseUp=camera.up.clone();
    this.applyLookCamera(scene,camera);this.syncMapCamera(camera,this.presentationFrameSerial);this.drawMinimap(performance.now());const renderer=this.threeRenderer;if(!renderer){camera.position.copy(basePosition);camera.quaternion.copy(baseQuaternion);camera.up.copy(baseUp);return;}
    this.savedBackground=scene.background;this.savedFog=scene.fog;this.hideTrainingWorld(scene);scene.background=null;scene.fog=null;
    const clearAlpha=renderer.getClearAlpha();renderer.setClearAlpha(0);
    try{renderer.render(scene,camera);this.realFrames++;$("viewport").dataset.worldThreeFrames=String(this.realFrames);}finally{renderer.setClearAlpha(clearAlpha);scene.background=this.savedBackground;scene.fog=this.savedFog;this.restoreTrainingWorld();camera.position.copy(basePosition);camera.quaternion.copy(baseQuaternion);camera.up.copy(baseUp);camera.updateMatrixWorld();}
  }
  renderFrame(renderer,scene,camera){
    this.attachThree(renderer,scene,camera);this.updateVsPose();
    if(!this.active)return false;
    this.syncBuildingCollisions();
    this.renderReal(scene,camera);
    return true;
  }
}

const bridge=new RealWorldBridge();
globalThis.__arondightRealWorld=bridge;

await import("./simulator.mjs");
