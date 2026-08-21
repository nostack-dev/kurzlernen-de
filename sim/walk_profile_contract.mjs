const PROFILE="cod-full-viewport-v6";
const LOOK="cod-full-viewport-delta-v6";
let observer=null;

function enforce(){
  const v=document.getElementById("viewport");
  if(!v)return false;
  if(v.dataset.walkControlProfile!==PROFILE)v.dataset.walkControlProfile=PROFILE;
  if(v.dataset.walkLookModel!==LOOK)v.dataset.walkLookModel=LOOK;
  v.dataset.walkControlProfileOwner="walk-profile-contract-v1";
  return true;
}

function attach(){
  const v=document.getElementById("viewport");
  if(!v)return false;
  enforce();
  if(!observer){
    observer=new MutationObserver(()=>enforce());
    observer.observe(v,{attributes:true,attributeFilter:["data-walk-control-profile","data-walk-look-model"]});
    window.addEventListener("arondight45:player-mode",enforce);
    window.addEventListener("arondight:player-mode",enforce);
  }
  return true;
}

if(!attach()){
  const bootObserver=new MutationObserver(()=>{if(attach())bootObserver.disconnect();});
  bootObserver.observe(document.documentElement,{childList:true,subtree:true});
}
