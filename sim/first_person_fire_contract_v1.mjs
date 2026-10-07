let installed=false,lastApi=null;

function viewport(){return document.getElementById("viewport");}
function patchApi(){
  const api=globalThis.__arondightFootWeapons;
  if(!api||typeof api.fireAt!=="function")return false;
  if(api===lastApi&&api.fireAt?.__arondightSingleShotV1)return true;
  if(api.fireAt?.__arondightSingleShotV1){lastApi=api;return true;}
  const original=api.fireAt.bind(api);
  const fireSingle=function(args={}){
    const result=original(args),view=viewport();
    if(view){view.dataset.walkFireApi="single-shot-per-call-v2";view.dataset.walkBurstTailSuppressed="0";view.dataset.walkFireTimerIsolation="no-global-timer-monkeypatch-v1";}
    return result;
  };
  Object.defineProperty(fireSingle,"__arondightSingleShotV1",{value:true});
  api.fireAt=fireSingle;lastApi=api;
  const view=viewport();if(view)view.dataset.walkFireApi="single-shot-per-call-v2";
  return true;
}
function maintenance(){patchApi();setTimeout(maintenance,250);}
export function installFirstPersonFireContractV1(){if(installed)return;installed=true;patchApi();setTimeout(maintenance,250);}
installFirstPersonFireContractV1();
