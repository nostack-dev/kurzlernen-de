let installed=false,lastApi=null;

function viewport(){return document.getElementById("viewport");}
function patchApi(){
  const api=globalThis.__arondightFootWeapons;
  if(!api||typeof api.fireAt!=="function")return false;
  if(api===lastApi&&api.fireAt?.__arondightSingleShotV1)return true;
  if(api.fireAt?.__arondightSingleShotV1){lastApi=api;return true;}
  const original=api.fireAt.bind(api),nativeSetTimeout=globalThis.setTimeout.bind(globalThis);
  const fireSingle=function(args={}){
    if(String(api.mode||"")!=="smg")return original(args);
    const previousSetTimeout=globalThis.setTimeout;let acceptedImmediate=false,suppressed=0;
    globalThis.setTimeout=function(callback,delay=0,...rest){
      const ms=Math.max(0,Number(delay)||0);
      if(ms<=2&&!acceptedImmediate){acceptedImmediate=true;return nativeSetTimeout(callback,0,...rest);}
      if(ms<=220){suppressed++;return 0;}
      return previousSetTimeout(callback,delay,...rest);
    };
    try{
      const result=original(args),view=viewport();
      if(view){view.dataset.walkFireApi="single-shot-per-call-v1";view.dataset.walkBurstTailSuppressed=String((Number(view.dataset.walkBurstTailSuppressed)||0)+suppressed);}
      return result;
    }finally{globalThis.setTimeout=previousSetTimeout;}
  };
  Object.defineProperty(fireSingle,"__arondightSingleShotV1",{value:true});
  api.fireAt=fireSingle;lastApi=api;
  const view=viewport();if(view)view.dataset.walkFireApi="single-shot-per-call-v1";
  return true;
}
function frame(){patchApi();requestAnimationFrame(frame);}
export function installFirstPersonFireContractV1(){if(installed)return;installed=true;patchApi();requestAnimationFrame(frame);}
installFirstPersonFireContractV1();
