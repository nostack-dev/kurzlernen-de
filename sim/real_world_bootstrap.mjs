import * as THREE from "three";

const CESIUM_VERSION="1.143";
const CESIUM_BASE=`https://cesium.com/downloads/cesiumjs/releases/${CESIUM_VERSION}/Build/Cesium`;
const GOOGLE_TILES_ROOT="https://tile.googleapis.com/v1/3dtiles/root.json";
const KEY_STORAGE="arondight45GoogleTilesApiKeyV1";
const MODE_STORAGE="arondight45WorldModeV1";
const $=id=>document.getElementById(id);
const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));

function loadScript(src){
  return new Promise((resolve,reject)=>{
    if(globalThis.Cesium)return resolve();
    const existing=[...document.scripts].find(script=>script.src===src);
    if(existing){existing.addEventListener("load",resolve,{once:true});existing.addEventListener("error",()=>reject(Error("CesiumJS failed to load")),{once:true});return;}
    const script=document.createElement("script");script.src=src;script.crossOrigin="anonymous";script.onload=resolve;script.onerror=()=>reject(Error("CesiumJS failed to load"));document.head.appendChild(script);
  });
}
function loadCss(href){
  if([...document.styleSheets].some(sheet=>sheet.href===href))return;
  const link=document.createElement("link");link.rel="stylesheet";link.href=href;link.crossOrigin="anonymous";document.head.appendChild(link);
}
async function ensureCesium(){
  if(globalThis.Cesium)return globalThis.Cesium;
  loadCss(`${CESIUM_BASE}/Widgets/widgets.css`);
  await loadScript(`${CESIUM_BASE}/Cesium.js`);
  if(!globalThis.Cesium)throw Error("CesiumJS did not initialize");
  // Google recommends higher parallel request capacity for faster 3D Tiles loading.
  globalThis.Cesium.RequestScheduler.requestsByServer["tile.googleapis.com:443"]=18;
  return globalThis.Cesium;
}

function geolocate(){
  if(!navigator.geolocation)return Promise.reject(Error("Geolocation is not available in this browser"));
  return new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,error=>reject(Error(error.message||"Location permission failed")),{enableHighAccuracy:true,timeout:20000,maximumAge:0}));
}

class RealWorldBridge{
  constructor(){
    this.active=false;this.loading=false;this.viewer=null;this.tileset=null;this.origin=null;this.enuToFixed=null;this.threeRenderer=null;this.threeScene=null;this.threeCamera=null;this.overlayRenderer=null;this.geoContainer=null;this.worldCard=null;this.savedBackground=null;this.savedFog=null;this.trainingObjects=new Set();this.frameVisibility=new Map();this.lastLocation=null;this.surfaceHeight=null;
    this.installUi();
  }
  installUi(){
    const panel=document.querySelector(".panel");if(!panel)return;
    const card=document.createElement("div");card.className="card real-world-card";card.innerHTML=`
      <h2>World / geospatial twin</h2>
      <label>World<select id="worldMode"><option value="training">TRAINING RANGE</option><option value="real">REAL WORLD · MY LOCATION</option></select></label>
      <div id="realWorldConfig" hidden>
        <label style="margin-top:8px">Google Maps Tiles API key<input id="googleTilesKey" type="password" autocomplete="off" spellcheck="false" placeholder="Map Tiles API key · stored only on this device"></label>
        <div class="row"><button id="useMyLocation" class="primary">USE MY GPS LOCATION</button><button id="forgetTilesKey">FORGET KEY</button></div>
        <div class="help">Photorealistic 3D Tiles are visual/geospatial world truth. Flight dynamics, motors, sensors and FC remain the same local SI digital twin. The local launch plane is anchored to the sampled 3D surface at your GPS fix; streamed building meshes are not silently converted into fake collision physics.</div>
      </div>
      <div id="realWorldStatus" class="statusline">TRAINING RANGE · local metric world</div>`;
    const remote=document.querySelector(".remote-card");panel.insertBefore(card,remote||panel.children[3]||null);this.worldCard=card;
    const style=document.createElement("style");style.textContent=`
      .real-world-card input[type=password]{width:100%;background:#0d1420;color:#fff;border:1px solid #303a4e;border-radius:6px;padding:6px}
      #geoViewport{position:absolute;inset:0;z-index:0;overflow:hidden;background:#000}
      #geoViewport .cesium-viewer,#geoViewport .cesium-viewer-cesiumWidgetContainer,#geoViewport .cesium-widget,#geoViewport canvas{width:100%!important;height:100%!important}
      #geoViewport .cesium-viewer-bottom{z-index:3!important;pointer-events:auto}
      #realWorldStatus{line-height:1.4}
    `;document.head.appendChild(style);
    const mode=$("worldMode"),config=$("realWorldConfig"),key=$("googleTilesKey"),use=$("useMyLocation"),forget=$("forgetTilesKey");
    try{key.value=localStorage.getItem(KEY_STORAGE)||"";}catch{}
    mode.value="training";
    mode.onchange=()=>{config.hidden=mode.value!=="real";if(mode.value==="training")this.deactivate();else this.activate().catch(error=>this.fail(error));};
    key.onchange=()=>{try{const value=key.value.trim();if(value)localStorage.setItem(KEY_STORAGE,value);else localStorage.removeItem(KEY_STORAGE);}catch{}};
    use.onclick=()=>this.activate().catch(error=>this.fail(error));
    forget.onclick=()=>{key.value="";try{localStorage.removeItem(KEY_STORAGE);}catch{};this.status("API key removed from this device.","warn");};
    try{localStorage.setItem(MODE_STORAGE,"training");}catch{}
  }
  status(text,kind=""){const el=$("realWorldStatus");if(!el)return;el.textContent=text;el.className=`statusline ${kind}`;}
  fail(error){this.loading=false;this.status(`REAL WORLD unavailable · ${error.message}`,"bad");}
  attachThree(renderer,scene,camera){
    if(this.threeRenderer===renderer&&this.threeScene===scene&&this.threeCamera===camera)return;
    this.threeRenderer=renderer;this.threeScene=scene;this.threeCamera=camera;
    renderer.domElement.style.position="absolute";renderer.domElement.style.inset="0";renderer.domElement.style.zIndex="1";
  }
  ensureOverlayRenderer(){
    if(this.overlayRenderer)return;
    const viewport=$("viewport"),r=new THREE.WebGLRenderer({antialias:true,alpha:true});r.setClearColor(0x000000,0);r.setPixelRatio(Math.min(devicePixelRatio,2));r.outputColorSpace=THREE.SRGBColorSpace;r.toneMapping=THREE.ACESFilmicToneMapping;r.toneMappingExposure=1.05;r.shadowMap.enabled=true;r.shadowMap.type=THREE.PCFSoftShadowMap;r.domElement.style.position="absolute";r.domElement.style.inset="0";r.domElement.style.zIndex="2";r.domElement.style.pointerEvents="none";viewport.appendChild(r.domElement);this.overlayRenderer=r;
  }
  resizeOverlay(){if(!this.overlayRenderer)return;const b=$("viewport").getBoundingClientRect(),w=Math.max(1,b.width),h=Math.max(1,b.height);if(this.overlayRenderer.domElement.width!==Math.round(w*this.overlayRenderer.getPixelRatio())||this.overlayRenderer.domElement.height!==Math.round(h*this.overlayRenderer.getPixelRatio()))this.overlayRenderer.setSize(w,h,false);}
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
  async createViewer(){
    if(this.viewer)return this.viewer;
    const Cesium=await ensureCesium(),viewport=$("viewport");
    const container=document.createElement("div");container.id="geoViewport";container.hidden=true;viewport.insertBefore(container,viewport.firstChild);this.geoContainer=container;
    this.viewer=new Cesium.Viewer(container,{animation:false,baseLayerPicker:false,fullscreenButton:false,geocoder:false,homeButton:false,infoBox:false,navigationHelpButton:false,sceneModePicker:false,selectionIndicator:false,timeline:false,globe:false,skyBox:false,skyAtmosphere:false,shouldAnimate:false});
    this.viewer.scene.backgroundColor=Cesium.Color.BLACK;this.viewer.scene.fog.enabled=true;this.viewer.scene.fog.density=.00018;
    return this.viewer;
  }
  key(){const input=$("googleTilesKey");let stored="";try{stored=localStorage.getItem(KEY_STORAGE)||"";}catch{}const value=(input?.value||stored).trim();if(input&&value)input.value=value;if(value)try{localStorage.setItem(KEY_STORAGE,value);}catch{}return value;}
  async activate(){
    if(this.loading)return;const key=this.key();if(!key){$("realWorldConfig").hidden=false;this.status("REAL WORLD needs a browser-restricted Google Maps Tiles API key.","warn");return;}
    this.loading=true;this.status("REAL WORLD · requesting high-accuracy GPS permission…","warn");
    const fix=await geolocate();this.lastLocation=fix;const {latitude,longitude,accuracy,altitude}=fix.coords;
    if(!Number.isFinite(latitude)||!Number.isFinite(longitude))throw Error("GPS returned no valid latitude/longitude");
    this.status(`GPS ${latitude.toFixed(6)}, ${longitude.toFixed(6)} · ±${Math.round(accuracy||0)} m · loading photorealistic 3D…`,"warn");
    const Cesium=await ensureCesium(),viewer=await this.createViewer();this.geoContainer.hidden=false;
    if(this.tileset){viewer.scene.primitives.remove(this.tileset);try{this.tileset.destroy();}catch{}this.tileset=null;}
    const resource=`${GOOGLE_TILES_ROOT}?key=${encodeURIComponent(key)}`;
    this.tileset=await Cesium.Cesium3DTileset.fromUrl(resource,{showCreditsOnScreen:true,maximumScreenSpaceError:12,skipLevelOfDetail:true});viewer.scene.primitives.add(this.tileset);
    viewer.camera.setView({destination:Cesium.Cartesian3.fromDegrees(longitude,latitude,1500),orientation:{heading:0,pitch:-Cesium.Math.PI_OVER_TWO,roll:0}});
    let surface=Number.isFinite(altitude)?altitude:0;
    try{
      if(!viewer.scene.sampleHeightSupported)throw Error("browser does not support scene height sampling");
      const samples=[Cesium.Cartographic.fromDegrees(longitude,latitude,0)];
      const result=await Promise.race([viewer.scene.sampleHeightMostDetailed(samples),new Promise((_,reject)=>setTimeout(()=>reject(Error("surface sampling timeout")),15000))]);
      if(Number.isFinite(result?.[0]?.height))surface=result[0].height;
    }catch(error){console.warn("Real-world surface sample fallback:",error);}
    this.surfaceHeight=surface;this.origin=Cesium.Cartesian3.fromDegrees(longitude,latitude,surface);this.enuToFixed=Cesium.Transforms.eastNorthUpToFixedFrame(this.origin);this.ensureOverlayRenderer();this.active=true;this.loading=false;
    if(this.threeRenderer)this.threeRenderer.domElement.style.visibility="hidden";this.overlayRenderer.domElement.style.display="block";this.geoContainer.hidden=false;$("viewport").dataset.worldMode="real";$("viewport").dataset.worldLatitude=String(latitude);$("viewport").dataset.worldLongitude=String(longitude);$("viewport").dataset.worldSurfaceHeightM=String(surface);this.status(`REAL WORLD LIVE · GPS ${latitude.toFixed(6)}, ${longitude.toFixed(6)} · ±${Math.round(accuracy||0)} m · launch surface ${surface.toFixed(1)} m WGS84`,"good");try{localStorage.setItem(MODE_STORAGE,"real");}catch{}
  }
  deactivate(){
    this.active=false;this.loading=false;if(this.geoContainer)this.geoContainer.hidden=true;if(this.overlayRenderer)this.overlayRenderer.domElement.style.display="none";if(this.threeRenderer)this.threeRenderer.domElement.style.visibility="visible";if(this.threeScene){this.restoreTrainingWorld();if(this.savedBackground!==null)this.threeScene.background=this.savedBackground;if(this.savedFog!==null)this.threeScene.fog=this.savedFog;}$("viewport")?.removeAttribute("data-world-latitude");$("viewport")?.removeAttribute("data-world-longitude");if($("viewport"))$("viewport").dataset.worldMode="training";this.status("TRAINING RANGE · local metric world");try{localStorage.setItem(MODE_STORAGE,"training");}catch{}
  }
  syncCesiumCamera(camera){
    if(!this.active||!this.viewer||!this.enuToFixed)return;const Cesium=globalThis.Cesium;
    const p=camera.position,dir3=new THREE.Vector3(),up3=new THREE.Vector3(0,1,0).applyQuaternion(camera.quaternion).normalize();camera.getWorldDirection(dir3);
    const localPoint=new Cesium.Cartesian3(p.x,p.y,p.z),localDir=new Cesium.Cartesian3(dir3.x,dir3.y,dir3.z),localUp=new Cesium.Cartesian3(up3.x,up3.y,up3.z);
    const destination=Cesium.Matrix4.multiplyByPoint(this.enuToFixed,localPoint,new Cesium.Cartesian3());const direction=Cesium.Cartesian3.normalize(Cesium.Matrix4.multiplyByPointAsVector(this.enuToFixed,localDir,new Cesium.Cartesian3()),new Cesium.Cartesian3());const up=Cesium.Cartesian3.normalize(Cesium.Matrix4.multiplyByPointAsVector(this.enuToFixed,localUp,new Cesium.Cartesian3()),new Cesium.Cartesian3());
    this.viewer.camera.setView({destination,orientation:{direction,up}});if(this.viewer.camera.frustum?.fov!=null)this.viewer.camera.frustum.fov=THREE.MathUtils.degToRad(clamp(camera.fov,10,120));
  }
  renderReal(scene,camera,originalRender){
    this.syncCesiumCamera(camera);this.ensureOverlayRenderer();this.resizeOverlay();this.savedBackground=scene.background;this.savedFog=scene.fog;this.hideTrainingWorld(scene);scene.background=null;scene.fog=null;originalRender.call(this.overlayRenderer,scene,camera);scene.background=this.savedBackground;scene.fog=this.savedFog;this.restoreTrainingWorld();
  }
}

const bridge=new RealWorldBridge();
globalThis.__arondightRealWorld=bridge;
const originalRender=THREE.WebGLRenderer.prototype.render;
THREE.WebGLRenderer.prototype.render=function(scene,camera){
  if(this===bridge.overlayRenderer)return originalRender.call(this,scene,camera);
  if(this.domElement?.closest?.("#viewport"))bridge.attachThree(this,scene,camera);
  if(bridge.active&&this===bridge.threeRenderer){bridge.renderReal(scene,camera,originalRender);return;}
  return originalRender.call(this,scene,camera);
};

await import("./simulator.mjs");
