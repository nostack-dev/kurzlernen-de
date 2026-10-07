import * as THREE from "three";

// Side-by-side stereo 3D for free viewing (cross-eye / "schielen"):
// the screen is split left | right and every frame of the main scene is drawn
// twice from two eye cameras ~6.4 cm apart (real metres, the world is in
// metres). Cross-eye viewing swaps the eyes: the RIGHT eye's image is on the
// LEFT half and vice versa, so crossing the eyes fuses both halves into one
// real 3D image — like a VR headset without the headset.
//
// Performance: each half renders at half width, so the pixel cost equals one
// normal frame; only draw calls double. The shadow map is updated once per
// frame and shared by both eyes. Bloom post-processing is bypassed while
// stereo is on (it would otherwise run per eye at full size).
// Toggle: Settings → CAMERA → SIDE-BY-SIDE 3D, or ?sbs=1.

export const STEREO_SBS_VERSION="cross-eye-side-by-side-v1";
export const STEREO_SETTINGS_KEY="rushStereoSbsV1";
export const STEREO_SETTINGS_EVENT="rush-stereo-sbs-change";
export const STEREO_EYE_SEPARATION_M=.064;

let active=false,installedOn=null,inside=false;
const stereo=new THREE.StereoCamera(),size=new THREE.Vector2(),vp=new THREE.Vector4(),sc=new THREE.Vector4();

export function loadStereoSetting(){
  try{if(typeof location!=="undefined"&&/[?&]sbs=1\b/.test(location.search))return true;return localStorage.getItem(STEREO_SETTINGS_KEY)==="1";}catch{return false;}
}
export function setStereoEnabled(on){
  active=Boolean(on);try{localStorage.setItem(STEREO_SETTINGS_KEY,active?"1":"0");}catch{}
  syncDom();if(typeof window!=="undefined")window.dispatchEvent(new CustomEvent(STEREO_SETTINGS_EVENT,{detail:{enabled:active}}));return active;
}
function syncDom(){
  if(typeof document==="undefined")return;
  let d=document.getElementById("stereoSbsDivider");
  if(active&&!d){d=document.createElement("div");d.id="stereoSbsDivider";d.setAttribute("aria-hidden","true");d.style.cssText="position:fixed;left:50%;top:0;bottom:0;width:2px;margin-left:-1px;background:#000;z-index:5;pointer-events:none";document.body.appendChild(d);}
  if(d)d.style.display=active?"block":"none";
  const v=document.getElementById("viewport");if(v)v.dataset.stereoSbs=active?"cross-eye":"off";
}

// Wraps renderer.render: only the main perspective view drawn to the screen
// is split; render-target passes (sky bake, bloom internals) are untouched.
export function installStereo(renderer){
  if(!renderer||installedOn===renderer)return;installedOn=renderer;
  const inner=renderer.render.bind(renderer);
  renderer.render=function(scene,camera){
    if(!active||inside||!camera?.isPerspectiveCamera||renderer.getRenderTarget()!==null||renderer.xr?.isPresenting)return inner(scene,camera);
    inside=true;
    const aspect=camera.aspect,autoClear=renderer.autoClear,autoShadow=renderer.shadowMap.autoUpdate,scissorTest=renderer.getScissorTest();
    renderer.getViewport(vp);renderer.getScissor(sc);renderer.getSize(size);
    const W=size.x,H=size.y,half=Math.floor(W/2);
    try{
      camera.aspect=half/Math.max(1,H);camera.updateProjectionMatrix();camera.updateMatrixWorld();
      stereo.aspect=1;stereo.eyeSep=STEREO_EYE_SEPARATION_M;stereo.update(camera);
      renderer.setScissorTest(true);
      if(autoClear){renderer.setScissor(0,0,W,H);renderer.setViewport(0,0,W,H);renderer.clear();}
      renderer.autoClear=false;
      // cross-eye: right eye on the left half
      renderer.setScissor(0,0,half,H);renderer.setViewport(0,0,half,H);inner(scene,stereo.cameraR);
      renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=false; // shadows shared by both eyes
      renderer.setScissor(W-half,0,half,H);renderer.setViewport(W-half,0,half,H);inner(scene,stereo.cameraL);
    }finally{
      renderer.shadowMap.autoUpdate=autoShadow;renderer.autoClear=autoClear;
      renderer.setScissorTest(scissorTest);renderer.setScissor(sc);renderer.setViewport(vp);
      camera.aspect=aspect;camera.updateProjectionMatrix();inside=false;
    }
  };
  syncDom();
}

active=loadStereoSetting();
function wait(){const r=globalThis.__arondightRealWorld?.threeRenderer;if(r){installStereo(r);syncDom();}else requestAnimationFrame(wait);}
if(typeof window!=="undefined")requestAnimationFrame(wait);
globalThis.__stereoSBS={get active(){return active;},set active(v){setStereoEnabled(v);},install:installStereo,version:STEREO_SBS_VERSION};
