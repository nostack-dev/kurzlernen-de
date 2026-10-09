// Draw-call fast paths, installed once on the renderer.
//
// An InstancedMesh whose count is 0 draws nothing, but three.js still does the whole per-draw
// setup for it: program bind, uniform refresh, attribute bind — in every pass. The crowd,
// police, soldiers, zombies and their remote copies keep ~40 such pooled meshes alive with
// most of them empty most of the time; that was more than half of the draw setups per frame.
export const RENDER_FAST_PATHS_VERSION="skip-empty-instanced-v1";
export function installRenderFastPaths(renderer){
  if(!renderer||renderer.__renderFastPaths)return;renderer.__renderFastPaths=RENDER_FAST_PATHS_VERSION;
  const direct=renderer.renderBufferDirect;
  renderer.renderBufferDirect=function(camera,scene,geometry,material,object,group){
    if(object?.isInstancedMesh&&object.count===0)return;
    return direct.call(this,camera,scene,geometry,material,object,group);
  };
}
