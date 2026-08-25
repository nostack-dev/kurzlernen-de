let installed=false;
function installStyle(){if(document.querySelector("style[data-mobile-landscape-hud-compact]"))return;const style=document.createElement("style");style.dataset.mobileLandscapeHudCompact="v2";style.textContent=`
@media (pointer:coarse) and (max-height:760px){
  body.solo-flight #soloTopbar{top:max(2px,var(--solo-safe-top))!important;gap:2px!important;width:min(calc(100% - max(12px,calc(var(--solo-safe-left) + var(--solo-safe-right)))),1060px)!important}
  body.solo-flight #viewport[data-world-mode="real"] #soloTopbar{left:max(6px,var(--solo-safe-left))!important;width:min(calc(100% - max(116px,calc(var(--solo-safe-right) + 110px))),1010px)!important}
  body.solo-flight #soloTopbarActions{gap:2px!important;padding:2px 3px!important;border-radius:9px!important;box-shadow:0 4px 14px #0005,inset 0 1px #ffffff10!important}
  body.solo-flight #soloTopbarStatus{gap:2px!important;min-height:16px!important}
  body.solo-flight #soloTopbar span,body.solo-flight #soloTopbar button{padding:3px 5px!important;font-size:8px!important;border-radius:6px!important}
  body.solo-flight #soloTopbar button{min-height:25px!important}
  body.solo-flight #soloTopbarStatus>span{min-height:17px!important;padding:2px 5px!important;font-size:7.5px!important}
  body.solo-flight #soloTopbar #vsCombatHud{min-width:86px!important;font-size:7.5px!important}
  body.solo-flight #soloTopbar #soloCamera,body.solo-flight #soloTopbar .phone-settings-button,body.solo-flight #soloTopbar #lanVsButton{min-width:44px!important}
  body.solo-flight #soloTopbarActions #droneWeaponToggle{height:25px!important;min-width:76px!important;padding:0 5px!important;font-size:7px!important}

  body.solo-flight #gameplayContractHud{left:max(8px,var(--solo-safe-left))!important;top:max(58px,calc(var(--solo-safe-top) + 54px))!important;width:132px!important}
  body.solo-flight #viewport[data-world-mode="real"] #gameplayContractHud{left:max(8px,var(--solo-safe-left))!important;top:max(58px,calc(var(--solo-safe-top) + 54px))!important}
  #gameplayContractButton{padding:5px 6px 5px!important;border-radius:8px!important;box-shadow:0 4px 13px #0006!important}
  #gameplayContractButton>small,#gameplayContractHint,#gameplayRiskHint,#gameplayMomentum{display:none!important}
  #gameplayContractButton>strong{margin:0!important;padding-right:30px!important;font-size:8px!important;line-height:1.1!important}
  #gameplayContractProgress{right:6px!important;top:5px!important;font-size:8px!important}
  #gameplayContractBar{height:2px!important;margin-top:4px!important}

  body.solo-flight #viewport[data-world-mode="real"] #worldMapLegend{display:none!important}
  body.solo-flight #viewport[data-world-mode="real"] #worldLookHud{width:86px!important;height:86px!important;right:max(6px,var(--solo-safe-right))!important;top:max(57px,calc(var(--solo-safe-top) + 53px))!important;border-radius:12px!important;box-shadow:0 4px 14px #0006!important}
  #worldLookHud .world-look-title{left:5px!important;right:5px!important;top:4px!important;font-size:5.5px!important}
  #worldLookHud .world-look-stage{left:7px!important;right:7px!important;top:17px!important;bottom:6px!important}
  #worldLookHud .world-look-cardinal{font-size:5.5px!important}.world-look-n{top:17px!important;left:39px!important}.world-look-e{top:46px!important;right:8px!important}.world-look-s{bottom:6px!important;left:40px!important}.world-look-w{top:46px!important;left:8px!important}

  body.solo-flight .solo-stick{width:min(21vw,132px)!important;bottom:max(15px,var(--solo-safe-bottom))!important}
  body.solo-flight #soloLeft{left:max(10px,var(--solo-safe-left))!important}body.solo-flight #soloRight{right:max(10px,var(--solo-safe-right))!important}
  body.solo-flight .solo-stick span{bottom:-13px!important;font-size:8px!important}
  body.solo-flight #soloClearance{left:calc(max(10px,var(--solo-safe-left)) + min(21vw,132px) + 7px)!important;bottom:max(15px,var(--solo-safe-bottom))!important;width:40px!important;height:102px!important;padding:4px 2px!important;border-radius:8px!important}
  body.solo-flight #soloClearance small{font-size:5.5px!important}body.solo-flight #soloClearance strong{font-size:9px!important}body.solo-flight #soloClearance span{font-size:6px!important}
  body.solo-flight .solo-height-pad{height:54px!important;width:50px!important}
  body.solo-flight .solo-action{bottom:max(14px,var(--solo-safe-bottom))!important;width:84px!important;height:36px!important;padding:0 7px!important;font-size:9px!important}

  body.on-foot-mode .foot-stick{width:min(21vw,132px)!important;bottom:max(15px,var(--solo-safe-bottom))!important}
  body.on-foot-mode #footLook{width:min(21vw,132px)!important}
  body.on-foot-mode #footMove{left:max(10px,var(--solo-safe-left))!important}body.on-foot-mode #footLook{right:max(10px,var(--solo-safe-right))!important}
  body.on-foot-mode #footFire{display:none!important}
  body.on-foot-mode #footReticle{display:none!important}
  body.on-foot-mode #footReticle.screen-aim-active{display:block!important;width:22px!important;height:22px!important;border:1px solid #ffe5a6e8!important;border-radius:50%!important;background:#06121b24!important;box-shadow:0 0 0 1px #0009,0 0 8px #ffd67866!important;opacity:1!important;transform:translate(-50%,-50%)!important;pointer-events:none!important}
  body.on-foot-mode #footReticle.screen-aim-active::before,body.on-foot-mode #footReticle.screen-aim-active::after{content:"";position:absolute;left:50%;top:50%;background:#fff0c7e8;box-shadow:0 0 3px #000;transform:translate(-50%,-50%)}
  body.on-foot-mode #footReticle.screen-aim-active::before{width:10px;height:1px}body.on-foot-mode #footReticle.screen-aim-active::after{width:1px;height:10px}
  body.on-foot-mode #footReadout{top:max(51px,calc(var(--solo-safe-top) + 47px))!important;padding:3px 6px!important;font-size:7px!important;opacity:.72!important}
  body.on-foot-mode #footWeaponToggle{bottom:max(10px,var(--solo-safe-bottom))!important;height:27px!important;min-width:88px!important;font-size:7px!important}
}
`;document.head.appendChild(style);}
function frame(){const view=document.getElementById("viewport");if(view){view.dataset.mobileLandscapeHud="compact-real-estate-v1";view.dataset.mobileDragAim="live-reticle-while-held-v1";}requestAnimationFrame(frame);}
export function installMobileLandscapeHudCompact(){if(installed)return;installed=true;installStyle();requestAnimationFrame(frame);}
installMobileLandscapeHudCompact();
