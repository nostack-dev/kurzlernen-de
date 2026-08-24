let installed=false;

function viewport(){return document.getElementById("viewport");}

function installStyle(){
  if(document.querySelector("style[data-walk-ui-layout-hotfix]"))return;
  const style=document.createElement("style");
  style.dataset.walkUiLayoutHotfix="rest-v1";
  style.textContent=`
    /* WALK mobile HUD: keep every label/control inside the usable viewport. */
    body.solo-flight.on-foot-mode #footLookZone::after{display:none!important}
    body.solo-flight.on-foot-mode .foot-stick span{bottom:7px!important;font-size:8px!important;padding:2px 5px;border-radius:5px;background:#071522aa;line-height:1!important}
    body.solo-flight.on-foot-mode #footReadout{max-width:min(48vw,430px);box-sizing:border-box;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    body.solo-flight.on-foot-mode #worldLookHud{z-index:6!important}
    body.solo-flight.on-foot-mode #geoViewport .geo-attribution{left:max(8px,var(--solo-safe-left,env(safe-area-inset-left)))!important;right:auto!important;top:max(94px,calc(var(--solo-safe-top,env(safe-area-inset-top)) + 88px))!important;bottom:auto!important;max-width:min(48vw,420px)!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;font-size:6.5px!important;opacity:.72}

    @media(max-width:1100px){
      body.solo-flight.on-foot-mode #soloTopbar{gap:3px!important}
      body.solo-flight.on-foot-mode #soloTopbar span,body.solo-flight.on-foot-mode #soloTopbar button{padding:4px 6px!important;font-size:9.5px!important;border-radius:7px!important;min-height:25px!important}
      body.solo-flight.on-foot-mode #soloTopbar #soloCamera,body.solo-flight.on-foot-mode #soloTopbar .phone-settings-button,body.solo-flight.on-foot-mode #soloTopbar #lanVsButton{min-width:48px!important}
      body.solo-flight.on-foot-mode #soloTopbar #vsCombatHud{min-width:88px!important;font-size:8.5px!important;padding-left:5px!important;padding-right:5px!important}
      body.solo-flight.on-foot-mode #worldLookHud{width:108px!important;height:108px!important;right:max(8px,var(--solo-safe-right,env(safe-area-inset-right)))!important;top:max(52px,calc(var(--solo-safe-top,env(safe-area-inset-top)) + 46px))!important}
      body.solo-flight.on-foot-mode #footReadout{top:max(48px,calc(var(--solo-safe-top,env(safe-area-inset-top)) + 42px))!important;font-size:8px!important;max-width:46vw!important}
    }

    @media(max-width:900px){
      body.solo-flight.on-foot-mode #soloTopbar{gap:3px!important}
      body.solo-flight.on-foot-mode #soloTopbar span,body.solo-flight.on-foot-mode #soloTopbar button{padding:3px 5px!important;font-size:8.5px!important;min-height:23px!important}
      body.solo-flight.on-foot-mode #soloTopbar #soloCamera,body.solo-flight.on-foot-mode #soloTopbar .phone-settings-button,body.solo-flight.on-foot-mode #soloTopbar #lanVsButton{min-width:43px!important}
      body.solo-flight.on-foot-mode #soloTopbar #vsCombatHud{min-width:78px!important;font-size:7.8px!important}
      body.solo-flight.on-foot-mode #worldLookHud{width:100px!important;height:100px!important}
      body.solo-flight.on-foot-mode #footReadout{max-width:42vw!important}
      body.solo-flight.on-foot-mode #geoViewport .geo-attribution{max-width:42vw!important;top:max(88px,calc(var(--solo-safe-top,env(safe-area-inset-top)) + 82px))!important}
    }
  `;
  document.head.appendChild(style);
}

function measure(){
  const view=viewport();if(!view)return;
  const vr=view.getBoundingClientRect(),top=document.getElementById("soloTopbar"),look=document.getElementById("footLook"),move=document.getElementById("footMove"),mini=document.getElementById("worldLookHud"),readout=document.getElementById("footReadout"),attr=document.querySelector("#geoViewport .geo-attribution");
  const inside=el=>{if(!el)return true;const r=el.getBoundingClientRect();return r.left>=vr.left-1&&r.right<=vr.right+1&&r.top>=vr.top-1&&r.bottom<=vr.bottom+1;};
  const overlaps=(a,b)=>{if(!a||!b)return false;const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();return x.left<y.right&&x.right>y.left&&x.top<y.bottom&&x.bottom>y.top;};
  const topOk=!top||top.getBoundingClientRect().right<=vr.right+1;
  view.dataset.walkUiViewport=inside(move)&&inside(look)&&inside(mini)&&inside(readout)?"contained-v1":"overflow";
  view.dataset.walkUiTopbar=topOk?"contained-v1":"overflow";
  view.dataset.walkUiLookMinimap=overlaps(document.getElementById("footLookZone"),mini)?"layered-safe-v1":"separate-v1";
  view.dataset.walkUiAttribution=attr&&(!overlaps(attr,look)&&!overlaps(attr,move))?"clear-controls-v1":"overlap";
}

export function installWalkUiLayoutHotfix(){
  if(installed)return;installed=true;installStyle();
  addEventListener("resize",()=>requestAnimationFrame(measure),{passive:true});
  new MutationObserver(()=>requestAnimationFrame(measure)).observe(document.documentElement,{childList:true,subtree:true});
  requestAnimationFrame(measure);
}

installWalkUiLayoutHotfix();
