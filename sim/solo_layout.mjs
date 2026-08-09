let installed=false;

export function installSoloFlightLayout(){
  if(installed)return;installed=true;
  const style=document.createElement("style");
  style.dataset.soloFlightLayout="compact-v3-touch";
  style.textContent=`
    /* 1-phone mode must remain usable even when iOS Safari cannot enter true fullscreen. */
    body.solo-flight #cameraModes{display:none!important}
    body.solo-flight #soloTopbar{top:max(5px,env(safe-area-inset-top));left:max(8px,env(safe-area-inset-left));right:max(8px,env(safe-area-inset-right));gap:6px;min-width:0;overflow:visible}
    body.solo-flight #soloTopbar span,body.solo-flight #soloTopbar button{padding:6px 8px;font-size:11px;border-radius:8px}
    body.solo-flight #soloTopbar span{flex:0 1 auto;min-width:0}
    body.solo-flight #soloTopbar #soloCamera,body.solo-flight #soloTopbar .phone-settings-button{display:inline-flex!important;flex:0 0 auto;min-width:58px;min-height:28px;align-items:center;justify-content:center}
    body.solo-flight #soloRaceHud{top:max(43px,calc(env(safe-area-inset-top) + 39px));min-width:260px;gap:2px 10px;padding:5px 9px;border-radius:8px}
    body.solo-flight #soloRaceHud span{font-size:9px}
    body.solo-flight #soloRaceTime{font-size:17px}
    body.solo-flight .solo-stick{width:min(25vw,150px);bottom:max(20px,env(safe-area-inset-bottom))}
    body.solo-flight #soloLeft{left:max(12px,env(safe-area-inset-left))}
    body.solo-flight #soloRight{right:max(12px,env(safe-area-inset-right))}
    body.solo-flight .solo-stick span{bottom:-15px;font-size:9px}
    body.solo-flight #soloClearance{left:calc(max(12px,env(safe-area-inset-left)) + min(25vw,150px) + 10px);right:auto;bottom:max(22px,calc(env(safe-area-inset-bottom) + 8px));transform:none;width:48px;height:132px;padding:6px 3px;border-radius:10px;overflow:visible}
    body.solo-flight #soloClearance small{font-size:6.5px;line-height:1.05;letter-spacing:.04em}
    body.solo-flight #soloClearance strong{font-size:11px}
    body.solo-flight #soloClearance span{font-size:7px}
    /* Keep the visible rail slim but make the actual iOS touch target finger-sized. */
    body.solo-flight .solo-range-shell{height:72px;width:70px;margin-left:-11px;margin-right:-11px;touch-action:none;overflow:visible}
    body.solo-flight .solo-range-shell input{width:72px;height:70px;margin:0;transform:rotate(-90deg);touch-action:none;cursor:ns-resize}
    /* State labels such as CALIBRATING… / ARMING… / ARMED ✓ must stay inside the action pill. */
    body.solo-flight .solo-action{bottom:max(22px,calc(env(safe-area-inset-bottom) + 8px));width:104px;height:44px;padding:0 10px;font-size:12px;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:clip}

    @media(max-height:340px){
      body.solo-flight #soloTopbar{top:max(3px,env(safe-area-inset-top));gap:4px}
      body.solo-flight #soloTopbar span,body.solo-flight #soloTopbar button{padding:4px 7px;font-size:10px;border-radius:7px}
      body.solo-flight #soloTopbar #soloCamera,body.solo-flight #soloTopbar .phone-settings-button{min-width:52px;min-height:24px}
      body.solo-flight #soloRaceHud{top:max(36px,calc(env(safe-area-inset-top) + 32px));min-width:238px;gap:1px 8px;padding:4px 7px}
      body.solo-flight #soloRaceHud span{font-size:8px}
      body.solo-flight #soloRaceTime{font-size:15px}
      body.solo-flight .solo-stick{width:min(22vw,128px);bottom:max(16px,env(safe-area-inset-bottom))}
      body.solo-flight .solo-stick span{bottom:-13px;font-size:8px}
      body.solo-flight #soloClearance{left:calc(max(10px,env(safe-area-inset-left)) + min(22vw,128px) + 8px);bottom:max(16px,env(safe-area-inset-bottom));width:42px;height:112px;padding:5px 2px}
      body.solo-flight #soloClearance small{font-size:5.8px}
      body.solo-flight #soloClearance strong{font-size:10px}
      body.solo-flight #soloClearance span{font-size:6.5px}
      body.solo-flight .solo-range-shell{height:58px;width:66px;margin-left:-12px;margin-right:-12px}
      body.solo-flight .solo-range-shell input{width:58px;height:66px}
      body.solo-flight .solo-action{bottom:max(16px,env(safe-area-inset-bottom));width:92px;height:40px;padding:0 8px;font-size:10px}
    }
  `;
  document.head.appendChild(style);
}
