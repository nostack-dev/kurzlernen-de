// First-person viewmodel pass (how shooters keep the weapon out of walls).
//
// The weapon in your hands is drawn in its own pass after the world, on a
// cleared depth buffer: it can never poke into a wall, a car or the ground
// when you stand right in front of it, and the world can never cut it. Its
// own parts still depth-sort against each other, and it is lit by the same
// lights (they are enabled on the viewmodel layer too). The shadow maps from
// the world pass are reused, the sky is not drawn again. In side-by-side stereo the weapon is drawn
// with the centre (mono) camera: zero parallax, it sits in the screen plane instead of 10 % crossed.
//
// Installed directly on the renderer (before the bloom wrapper), so both the
// bloom path and the plain path get the two passes.
export const VIEWMODEL_LAYER=7;
const NAMES=["WALK_PISTOL_3D"];
let root=null,rootScene=null,lastLightScan=-Infinity,lastMark=-Infinity,markedCount=-1;

function findRoot(scene){if(root&&rootScene===scene&&root.parent)return root;root=null;rootScene=scene;for(const n of NAMES){const o=scene.getObjectByName?.(n);if(o){root=o;break;}}return root;}
function shown(o){for(let n=o;n;n=n.parent)if(n.visible===false)return false;return true;}
function markLayers(o,now){let count=0;o.traverse(()=>{count++;});if(count===markedCount&&now-lastMark<1000)return;markedCount=count;lastMark=now;o.traverse(n=>{n.layers.set(VIEWMODEL_LAYER);});}
function lightLayers(scene,now){if(now-lastLightScan<1000)return;lastLightScan=now;scene.traverse(n=>{if(n.isLight)n.layers.enable(VIEWMODEL_LAYER);});}

export function installViewmodelPass(renderer){
  if(!renderer||renderer.__viewmodelPass)return;renderer.__viewmodelPass=true;const original=renderer.render.bind(renderer);
  renderer.render=function(scene,camera){
    const vm=scene?.isScene&&camera?.isPerspectiveCamera?findRoot(scene):null;
    if(!vm||!shown(vm))return original(scene,camera);
    const now=performance.now();markLayers(vm,now);lightLayers(scene,now);
    const mask=camera.layers.mask;let vmCam=null,vmMask=0;camera.layers.disable(VIEWMODEL_LAYER);original(scene,camera);
    const autoClear=renderer.autoClear,shadowAuto=renderer.shadowMap.autoUpdate,background=scene.background;
    try{renderer.autoClear=false;renderer.shadowMap.autoUpdate=false;scene.background=null;renderer.clearDepth();vmCam=camera.userData?.monoCamera||camera;vmMask=vmCam.layers.mask;vmCam.layers.set(VIEWMODEL_LAYER);original(scene,vmCam);}
    finally{if(vmCam)vmCam.layers.mask=vmMask;camera.layers.mask=mask;renderer.autoClear=autoClear;renderer.shadowMap.autoUpdate=shadowAuto;scene.background=background;}
    const v=typeof document!=="undefined"?document.getElementById("viewport"):null;if(v&&v.dataset.viewmodelPass!=="depth-cleared-layer-v1")v.dataset.viewmodelPass="depth-cleared-layer-v1";
  };
}
