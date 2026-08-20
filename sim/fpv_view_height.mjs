export const FPV_VIEW_EXTRA_UP_M=.020;

let installed=false,lastAppliedFrame=-1,retryTimer=0;

function rotatedBodyUp(quaternion){
  const x=Number(quaternion?.x)||0,y=Number(quaternion?.y)||0,z=Number(quaternion?.z)||0,w=Number.isFinite(Number(quaternion?.w))?Number(quaternion.w):1;
  return[2*(x*z+y*w),2*(y*z-x*w),1-2*(x*x+y*y)];
}

function installHook(){
  const bridge=globalThis.__arondightRealWorld;
  if(!bridge||bridge.__fpvViewHeightHook||typeof bridge.applyLookCamera!=="function")return false;
  const base=bridge.applyLookCamera.bind(bridge);
  bridge.__fpvViewHeightHook=true;
  bridge.applyLookCamera=(scene,camera)=>{
    const result=base(scene,camera),viewport=document.getElementById("viewport");
    if(viewport?.dataset.cameraMode!=="fpv"||!camera?.position)return result;
    const frame=Number(globalThis.__arondightDiagnostics?.presentationDraws);
    if(Number.isFinite(frame)&&frame===lastAppliedFrame)return result;
    if(Number.isFinite(frame))lastAppliedFrame=frame;
    const airframe=bridge.airframeFor?.(scene),up=rotatedBodyUp(airframe?.quaternion),length=Math.hypot(up[0],up[1],up[2])||1;
    camera.position.x+=up[0]/length*FPV_VIEW_EXTRA_UP_M;
    camera.position.y+=up[1]/length*FPV_VIEW_EXTRA_UP_M;
    camera.position.z+=up[2]/length*FPV_VIEW_EXTRA_UP_M;
    viewport.dataset.fpvViewExtraUpOffsetM=FPV_VIEW_EXTRA_UP_M.toFixed(3);
    const mountUp=Number(viewport.dataset.fpvCameraUpOffsetM);
    if(Number.isFinite(mountUp))viewport.dataset.fpvViewUpOffsetM=(mountUp+FPV_VIEW_EXTRA_UP_M).toFixed(3);
    return result;
  };
  return true;
}

export function installFpvViewHeight(){
  if(installed)return;installed=true;
  if(installHook())return;
  retryTimer=setInterval(()=>{if(installHook()){clearInterval(retryTimer);retryTimer=0;}},50);
  setTimeout(()=>{if(retryTimer){clearInterval(retryTimer);retryTimer=0;}},10000);
}
