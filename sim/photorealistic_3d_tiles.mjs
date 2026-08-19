import * as THREE from "three";
import {TilesRenderer} from "3d-tiles-renderer/three";
import {GoogleCloudAuthPlugin} from "3d-tiles-renderer/core/plugins";
import {GLTFExtensionsPlugin,ReorientationPlugin,TileCompressionPlugin} from "3d-tiles-renderer/three/plugins";
import {DRACOLoader,DRACO_GLTF_CONFIG} from "three/addons/loaders/DRACOLoader.js";

const DEG2RAD=Math.PI/180;
const MB=1024*1024;
const AXIS_MATRIX=new THREE.Matrix4().set(
  -1,0,0,0,
   0,0,1,0,
   0,1,0,0,
   0,0,0,1,
);
const ALIGN_SAMPLES=Object.freeze([[0,0],[24,0],[-24,0],[0,24],[0,-24],[42,42],[-42,42],[42,-42],[-42,-42]]);
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,Number(v)||0));
const mobileDevice=()=>/Android|iPhone|iPad|iPod|Mobile/i.test(globalThis.navigator?.userAgent||"")||Math.min(globalThis.screen?.width||9999,globalThis.screen?.height||9999)<900;

export function photorealBudget(perfMode="nominal",mobile=mobileDevice()){
  const profiles=mobile?{
    nominal:{errorTarget:32,maxBytes:80*MB,minBytes:48*MB,downloads:4,parses:2},
    constrained:{errorTarget:44,maxBytes:56*MB,minBytes:32*MB,downloads:3,parses:1},
    critical:{errorTarget:68,maxBytes:32*MB,minBytes:18*MB,downloads:2,parses:1},
  }:{
    nominal:{errorTarget:24,maxBytes:144*MB,minBytes:88*MB,downloads:7,parses:3},
    constrained:{errorTarget:36,maxBytes:96*MB,minBytes:56*MB,downloads:5,parses:2},
    critical:{errorTarget:56,maxBytes:56*MB,minBytes:32*MB,downloads:3,parses:1},
  };
  return profiles[perfMode]||profiles.nominal;
}

function attributionText(value){
  if(typeof value==="string")return value.replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim();
  if(value&&typeof value.textContent==="string")return value.textContent.replace(/\s+/g," ").trim();
  return"";
}

export class PhotorealisticWorldLayer{
  constructor({scene,renderer,camera,viewport,latitude,longitude,altitudeM=null,apiKey}){
    this.scene=scene;this.renderer=renderer;this.camera=camera;this.viewport=viewport;
    this.latitude=Number(latitude);this.longitude=Number(longitude);this.altitudeM=Number.isFinite(Number(altitudeM))?Number(altitudeM):0;
    this.apiKey=String(apiKey||"").trim();this.tiles=null;this.wrapper=null;this.dracoLoader=null;this.attribution=null;
    this.loadedModels=0;this.disposedModels=0;this.visible=false;this.aligned=false;this.alignmentAttempts=0;this.lastAlignMs=-Infinity;
    this.lastAttributionMs=-Infinity;this.lastResolution="";this.lastPerfMode="";this.failed=false;this.started=false;
    this.raycaster=new THREE.Raycaster();this.rayOrigin=new THREE.Vector3();this.rayDirection=new THREE.Vector3(0,0,-1);
  }
  setStatus(status){if(this.viewport)this.viewport.dataset.worldPhotorealStatus=status;}
  start(){
    if(this.started)return Boolean(this.tiles);this.started=true;
    if(!this.apiKey||!Number.isFinite(this.latitude)||!Number.isFinite(this.longitude)){this.setStatus(this.apiKey?"invalid-origin":"key-missing");return false;}
    try{
      const tiles=new TilesRenderer();this.tiles=tiles;
      tiles.displayActiveTiles=false;
      tiles.registerPlugin(new GoogleCloudAuthPlugin({apiToken:this.apiKey,autoRefreshToken:true,useRecommendedSettings:true}));
      this.dracoLoader=new DRACOLoader();this.dracoLoader.setDecoderPath(DRACO_GLTF_CONFIG);
      tiles.registerPlugin(new GLTFExtensionsPlugin({dracoLoader:this.dracoLoader}));
      tiles.registerPlugin(new TileCompressionPlugin());
      tiles.registerPlugin(new ReorientationPlugin({lat:this.latitude*DEG2RAD,lon:this.longitude*DEG2RAD,height:this.altitudeM,recenter:true}));
      this.wrapper=new THREE.Group();this.wrapper.name="ARONDIGHT_REAL_PHOTOGRAMMETRY";AXIS_MATRIX.decompose(this.wrapper.position,this.wrapper.quaternion,this.wrapper.scale);this.wrapper.add(tiles.group);this.wrapper.visible=false;this.scene.add(this.wrapper);
      tiles.setCamera(this.camera);tiles.setResolutionFromRenderer(this.camera,this.renderer);
      tiles.addEventListener("load-model",()=>{this.loadedModels++;if(this.viewport)this.viewport.dataset.worldPhotorealLoadedModels=String(this.loadedModels);});
      tiles.addEventListener("dispose-model",()=>{this.disposedModels++;if(this.viewport)this.viewport.dataset.worldPhotorealDisposedModels=String(this.disposedModels);});
      tiles.addEventListener("load-error",event=>{console.warn("Photorealistic 3D tile warning:",event?.error||event);});
      this.installAttribution();this.setStatus("loading-real-3d");this.applyBudget("nominal",true);return true;
    }catch(error){this.failed=true;this.setStatus("init-error");console.warn("Photorealistic 3D initialization warning:",error);this.dispose();return false;}
  }
  installAttribution(){
    if(!this.viewport||this.attribution)return;
    const node=document.createElement("div");node.className="photoreal-attribution";node.setAttribute("aria-label","Google Maps and imagery data attribution");
    Object.assign(node.style,{position:"absolute",left:"8px",bottom:"4px",zIndex:"5",maxWidth:"calc(100% - 16px)",padding:"2px 5px",borderRadius:"4px",background:"rgba(255,255,255,.90)",color:"#202124",font:"500 9px/1.25 system-ui,-apple-system,sans-serif",pointerEvents:"none",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"});
    node.textContent="Google Maps";this.viewport.appendChild(node);this.attribution=node;
  }
  applyBudget(perfMode,force=false){
    if(!this.tiles)return;const mode=["nominal","constrained","critical"].includes(perfMode)?perfMode:"nominal";if(!force&&mode===this.lastPerfMode)return;
    this.lastPerfMode=mode;const budget=photorealBudget(mode);
    this.tiles.errorTarget=budget.errorTarget;
    if(this.tiles.lruCache){this.tiles.lruCache.maxBytesSize=budget.maxBytes;this.tiles.lruCache.minBytesSize=budget.minBytes;}
    if(this.tiles.downloadQueue)this.tiles.downloadQueue.maxJobs=budget.downloads;
    if(this.tiles.parseQueue)this.tiles.parseQueue.maxJobs=budget.parses;
    if(this.viewport){this.viewport.dataset.worldPhotorealPerfMode=mode;this.viewport.dataset.worldPhotorealErrorTarget=String(budget.errorTarget);this.viewport.dataset.worldPhotorealMaxBytes=String(budget.maxBytes);}
  }
  syncResolution(){
    if(!this.tiles||!this.renderer)return;const canvas=this.renderer.domElement,key=`${canvas.width}x${canvas.height}`;if(key===this.lastResolution)return;this.lastResolution=key;this.tiles.setResolutionFromRenderer(this.camera,this.renderer);
  }
  tryAlignGround(now){
    if(!this.wrapper||!this.loadedModels||this.aligned||this.alignmentAttempts>=40||now-this.lastAlignMs<120)return this.aligned;
    this.lastAlignMs=now;this.alignmentAttempts++;this.wrapper.updateMatrixWorld(true);
    const hits=[];
    for(const [x,y] of ALIGN_SAMPLES){
      this.rayOrigin.set(x,y,10000);this.raycaster.set(this.rayOrigin,this.rayDirection);this.raycaster.near=0;this.raycaster.far=20000;
      const intersections=this.raycaster.intersectObject(this.wrapper,true);if(intersections.length&&Number.isFinite(intersections[0].point.z))hits.push(intersections[0].point.z);
    }
    if(hits.length<2)return false;
    hits.sort((a,b)=>a-b);const ground=hits[Math.min(hits.length-1,Math.floor((hits.length-1)*.25))];
    if(!Number.isFinite(ground)||Math.abs(ground)>9000)return false;
    this.wrapper.position.z-=ground;this.wrapper.updateMatrixWorld(true);this.aligned=true;this.visible=true;this.wrapper.visible=true;this.setStatus("active-real-3d");
    if(this.viewport){this.viewport.dataset.worldPhotorealGroundOffsetM=(-ground).toFixed(2);this.viewport.dataset.worldPhotorealAligned="1";}return true;
  }
  updateAttribution(now){
    if(!this.tiles||!this.attribution||now-this.lastAttributionMs<500)return;this.lastAttributionMs=now;
    const attributions=[];try{this.tiles.getAttributions(attributions);}catch{}
    const seen=new Set(),parts=[];for(const item of attributions){const text=attributionText(item?.value);if(text&&!seen.has(text)&&!/^(google|google maps)$/i.test(text)){seen.add(text);parts.push(text);}}
    this.attribution.textContent=["Google Maps",...parts].join(" · ");
  }
  update(perfMode="nominal",now=performance.now()){
    if(!this.tiles||this.failed)return false;this.applyBudget(perfMode);this.syncResolution();this.camera.updateMatrixWorld();
    try{this.tiles.update();}catch(error){this.failed=true;this.setStatus("runtime-error");console.warn("Photorealistic 3D runtime warning:",error);return false;}
    this.tryAlignGround(now);if(!this.aligned&&this.loadedModels&&this.alignmentAttempts>=40){this.wrapper.visible=true;this.visible=true;this.setStatus("active-real-3d-gps-datum");}
    this.updateAttribution(now);return this.visible;
  }
  isVisible(){return Boolean(this.visible&&this.wrapper?.visible&&!this.failed);}
  dispose(){
    this.visible=false;if(this.wrapper){this.scene?.remove(this.wrapper);this.wrapper.visible=false;}try{this.tiles?.dispose();}catch{}try{this.dracoLoader?.dispose?.();}catch{}this.attribution?.remove();this.attribution=null;this.tiles=null;this.wrapper=null;this.setStatus("inactive");
  }
}
