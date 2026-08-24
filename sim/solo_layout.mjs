import "./world_spawn_guard.mjs";
import "./player_walk_mode_v4.mjs";
import "./walk_profile_contract.mjs";
import "./xbox_control_mode.mjs";
import "./world_location_selector.mjs";
import {installVsCombatPresentation} from "./vs_combat_presentation.mjs";
import {installVsMultiplayerGuard} from "./vs_multiplayer_guard.mjs";
import {installVsFxGeoAdapter} from "./vs_fx_geo_adapter.mjs";
import {installVsMultiplayer} from "./vs_multiplayer.mjs";
import {installPlayerVehicleRuntime} from "./player_vehicle_runtime_v2.mjs";
import {installPlayerRuntimeHotfix} from "./player_runtime_hotfix.mjs";
import "./world_procedural_population.mjs";
import "./gameplay_fun_runtime.mjs";
import {installInitialAirframeGroundPose} from "./start_pose_guard.mjs";
import {installFpvViewHeight} from "./fpv_view_height.mjs";

// Compatibility marker for the historical deploy invariant: player_vehicle_runtime.mjs
let installed=false;

export function installSoloFlightLayout(){
  if(installed)return;installed=true;
  const style=document.createElement("style");
  style.dataset.soloFlightLayout="compact-v6-two-tier-toolbar";
  style.textContent=`
    /* 1-phone mode must remain usable even when iOS Safari cannot enter true fullscreen. */
    body.solo-flight #cameraModes{display:none!important}
    body.solo-flight #soloTopbar{top:max(5px,var(--solo-safe-top));left:50%;right:auto;width:min(calc(100% - max(16px,calc(var(--solo-safe-left) + var(--solo-safe-right)))),980px);transform:translateX(-50%);display:grid;grid-template-rows:auto auto;gap:4px;min-width:0;overflow:visible;pointer-events:none}
    body.solo-flight #viewport[data-world-mode="real"] #soloTopbar{left:max(8px,var(--solo-safe-left));width:min(calc(100% - max(154px,calc(var(--solo-safe-right) + 146px))),920px);transform:none}
    body.solo-flight #soloTopbarActions{display:flex;align-items:center;justify-content:center;gap:4px;min-width:0;padding:4px;border:1px solid #7cccfb3b;border-radius:12px;background:linear-gradient(180deg,#0d2133e8,#071522dc);box-shadow:0 7px 22px #0006,inset 0 1px #ffffff12;pointer-events:auto}
    body.solo-flight #soloTopbarStatus{display:flex;align-items:center;justify-content:center;gap:4px;min-height:20px;min-width:0;pointer-events:none}
    body.solo-flight #soloTopbar span,body.solo-flight #soloTopbar button{box-sizing:border-box;padding:5px 8px;font-size:10px;line-height:1;border-radius:8px;white-space:nowrap}
    body.solo-flight #soloTopbar button{display:inline-flex!important;flex:0 1 auto;min-width:0;min-height:30px;align-items:center;justify-content:center;overflow:hidden;text-overflow:ellipsis;letter-spacing:.025em}
    body.solo-flight #soloTopbarStatus>span{display:inline-flex;align-items:center;justify-content:center;flex:0 1 auto;min-width:0;min-height:20px;padding:3px 7px;border-color:#8ecdf02d;background:#071522c2;color:#d9efff;font-size:9px;font-variant-numeric:tabular-nums;box-shadow:0 3px 10px #0004}
    body.solo-flight #soloTopbar #soloState{color:#bde7ff}body.solo-flight #soloTopbar #soloAlt{color:#70e7b5}
    body.solo-flight #soloTopbar #soloExit{background:#672532df!important;border-color:#d76f7d77!important}body.solo-flight #soloTopbar #soloReset{background:#704819dc!important;border-color:#e1ad6170!important}
    body.solo-flight #soloTopbar #soloCamera{margin-left:0!important;background:#164c6cdd!important}
    body.solo-flight #soloTopbar #soloCamera,body.solo-flight #soloTopbar .phone-settings-button,body.solo-flight #soloTopbar #lanVsButton{min-width:54px}
    body.solo-flight #soloTopbar #vsCombatHud{display:inline-flex;align-items:center;justify-content:center;min-width:112px;font-size:9px;font-weight:900;font-variant-numeric:tabular-nums;white-space:nowrap}
    body.solo-flight #soloTopbar #vsCombatHud[hidden]{display:none!important}
    /* Lap/time telemetry is intentionally not drawn over the flight image. */
    body.solo-flight #soloRaceHud{display:none!important}
    body.solo-flight .solo-stick{width:min(25vw,150px);bottom:max(20px,var(--solo-safe-bottom))}
    body.solo-flight #soloLeft{left:max(12px,var(--solo-safe-left))}
    body.solo-flight #soloRight{right:max(12px,var(--solo-safe-right))}
    body.solo-flight .solo-stick span{bottom:-15px;font-size:9px}
    body.solo-flight #soloClearance{left:calc(max(12px,var(--solo-safe-left)) + min(25vw,150px) + 10px);right:auto;bottom:max(22px,calc(var(--solo-safe-bottom) + 8px));transform:none;width:48px;height:132px;padding:6px 3px;border-radius:10px;overflow:visible}
    body.solo-flight #soloClearance small{font-size:6.5px;line-height:1.05;letter-spacing:.04em}
    body.solo-flight #soloClearance strong{font-size:11px}
    body.solo-flight #soloClearance span{font-size:7px}
    /* Keep the visible rail slim but make the actual iOS touch target finger-sized. */
    body.solo-flight .solo-height-pad{height:72px;width:58px;margin-left:-5px;margin-right:-5px;touch-action:none;overflow:hidden}
    /* State labels such as CALIBRATING… / ARMING… / ARMED ✓ must stay inside the action pill. */
    body.solo-flight .solo-action{bottom:max(22px,calc(var(--solo-safe-bottom) + 8px));width:104px;height:44px;padding:0 10px;font-size:12px;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:clip}

    @media(max-height:340px){
      body.solo-flight #soloTopbar{top:max(3px,var(--solo-safe-top));gap:2px}
      body.solo-flight #soloTopbarActions{gap:3px;padding:3px;border-radius:9px}
      body.solo-flight #soloTopbar span,body.solo-flight #soloTopbar button{padding:4px 6px;font-size:9px;border-radius:6px}
      body.solo-flight #soloTopbar button{min-height:25px}
      body.solo-flight #soloTopbar #soloCamera,body.solo-flight #soloTopbar .phone-settings-button,body.solo-flight #soloTopbar #lanVsButton{min-width:46px}
      body.solo-flight #soloTopbar #vsCombatHud{min-width:94px;font-size:8px;padding-left:5px;padding-right:5px}
      body.solo-flight .solo-stick{width:min(22vw,128px);bottom:max(16px,var(--solo-safe-bottom))}
      body.solo-flight .solo-stick span{bottom:-13px;font-size:8px}
      body.solo-flight #soloClearance{left:calc(max(10px,var(--solo-safe-left)) + min(22vw,128px) + 8px);bottom:max(16px,var(--solo-safe-bottom));width:42px;height:112px;padding:5px 2px}
      body.solo-flight #soloClearance small{font-size:5.8px}
      body.solo-flight #soloClearance strong{font-size:10px}
      body.solo-flight #soloClearance span{font-size:6.5px}
      body.solo-flight .solo-height-pad{height:58px;width:54px;margin-left:-6px;margin-right:-6px}
      body.solo-flight .solo-action{bottom:max(16px,var(--solo-safe-bottom));width:92px;height:40px;padding:0 8px;font-size:10px}
    }

    /* In portrait the whole viewport is rotated by simulator.mjs. Percentages
       therefore size against the resulting logical landscape canvas, not vw. */
    @media(orientation:portrait){
      body.solo-flight .solo-stick{width:min(25%,150px)}
      body.solo-flight #soloClearance{left:calc(max(12px,var(--solo-safe-left)) + min(25%,150px) + 10px)}
    }
    @media(orientation:portrait) and (max-width:340px){
      body.solo-flight #soloTopbar{top:max(3px,var(--solo-safe-top));gap:2px}
      body.solo-flight #soloTopbarActions{gap:3px;padding:3px;border-radius:9px}
      body.solo-flight #soloTopbar span,body.solo-flight #soloTopbar button{padding:4px 6px;font-size:9px;border-radius:6px}
      body.solo-flight #soloTopbar button{min-height:25px}
      body.solo-flight #soloTopbar #soloCamera,body.solo-flight #soloTopbar .phone-settings-button,body.solo-flight #soloTopbar #lanVsButton{min-width:46px}
      body.solo-flight #soloTopbar #vsCombatHud{min-width:94px;font-size:8px;padding-left:5px;padding-right:5px}
      body.solo-flight .solo-stick{width:min(22%,128px);bottom:max(16px,var(--solo-safe-bottom))}
      body.solo-flight #soloClearance{left:calc(max(10px,var(--solo-safe-left)) + min(22%,128px) + 8px);bottom:max(16px,var(--solo-safe-bottom));width:42px;height:112px;padding:5px 2px}
      body.solo-flight #soloClearance small{font-size:5.8px}
      body.solo-flight #soloClearance strong{font-size:10px}
      body.solo-flight #soloClearance span{font-size:6.5px}
      body.solo-flight .solo-height-pad{height:58px;width:54px;margin-left:-6px;margin-right:-6px}
      body.solo-flight .solo-action{bottom:max(16px,var(--solo-safe-bottom));width:92px;height:40px;padding:0 8px;font-size:10px}
    }
  `;
  document.head.appendChild(style);
  installInitialAirframeGroundPose();
  installFpvViewHeight();
  installVsCombatPresentation();
  installVsMultiplayerGuard();
  installVsFxGeoAdapter();
  installVsMultiplayer();
  installPlayerVehicleRuntime();
  installPlayerRuntimeHotfix();
}
