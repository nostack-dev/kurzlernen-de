import {normalizedPointer,endPointerDrag} from "./control_semantics.mjs";
import "./direct_fire_missiles.mjs";
import "./nuke_weapon.mjs";
import "./nuke_overkill_fx.mjs";
import "./nuke_volumetric_cloud_v2.mjs";
import "./nuke_audio.mjs";
import "./nuke_destruction.mjs";
import "./nuke_hazard_fx.mjs";
import "./player_shield.mjs";
import "./game_reset.mjs";
import "./game_exit_button.mjs";
import "./world_city_buildings.mjs";
import "./building_interiors.mjs";
import "./world_city_roads.mjs";
import "./world_water.mjs";
import "./world_ground.mjs";
import "./training_test_level_v2.mjs";
import "./world_organic_hit_audio.mjs";
import "./world_sync.mjs";
import "./music_player.mjs";
import "./spawn_visibility_guard.mjs";

let installed=false;
const active=new Map();
let inputLoop=0,lastInputFrame=performance.now();
const FIRE_INTERVAL_MS=72;

function viewport(){return document.getElementById("viewport");}
function walk(){return globalThis.__arondightWalkMode||null;}
function footWeapons(){return globalThis.__arondightFootWeapons||null;}
function isFoot(){return walk()?.mode==="foot"&&document.body.classList.contains("on-foot-mode");}
function touchDevice(){return (navigator.maxTouchPoints||0)>0;}
function interactive(target){return Boolean(target?.closest?.("#worldLookHud,button,input,select,textarea,a,label,dialog,#soloTopbar,.phone-settings-dialog,#footWeaponToggle"));}
function paintLook(entry,axes){const knob=entry.element.querySelector(".knob");if(knob){knob.style.left=`${50+axes.x*42}%`;knob.style.top=`${50+axes.y*42}%`;}}
function resetLook(entry){paintLook(entry,{x:0,y:0});walk()?.endTouchLook?.("right-stick");entry.axes={x:0,y:0};}
function fireScreenAt(clientX,clientY,source="screen-touch"){
  const api=footWeapons();window.dispatchEvent(new CustomEvent("arondight:foot-screen-fire-anchor",{detail:{clientX,clientY,source}}));const fired=Boolean(api?.fireAt?.({clientX,clientY,source}));const view=viewport();if(view){view.dataset.walkTouchContract="drone-normalized-pointer-origin-v2";view.dataset.walkScreenTouch="fire-only-v1";view.dataset.walkWeaponTouchVector="screen-ray+hand-anchor-v1";view.dataset.walkWeaponGripTouchVector="screen-ray+grip-anchor-v2";view.dataset.walkMultiTouchMoveIsolation="pointer-id-owned-v1";view.dataset.walkHoldFire="screen-pointer-owned-smg-v1";}return fired;
}
function beginFire(event){const entry={kind:"fire",x:event.clientX,y:event.clientY,lastShotAt:performance.now()};active.set(event.pointerId,entry);fireScreenAt(entry.x,entry.y,"screen-touch-hold-start");ensureInputLoop();const view=viewport();if(view){view.dataset.walkFirePointerId=String(event.pointerId);view.dataset.walkFirePointerActive="1";}}
function ensureInputLoop(){if(inputLoop)return;const frame=now=>{inputLoop=requestAnimationFrame(frame);const dt=Math.max(1/240,Math.min(.05,(now-lastInputFrame)/1000));lastInputFrame=now;for(const entry of active.values()){
    if(entry.kind==="look")walk()?.applyTouchLookStick?.({x:entry.axes.x,y:entry.axes.y,dt,now,source:"right-stick"});
    else if(entry.kind==="fire"&&String(footWeapons()?.mode||"")==="smg"&&now-entry.lastShotAt>=FIRE_INTERVAL_MS){entry.lastShotAt=now;fireScreenAt(entry.x,entry.y,"screen-touch-hold-repeat");}
  }};lastInputFrame=performance.now();inputLoop=requestAnimationFrame(frame);}
function releaseActivePointer(pointerId,reason="lifecycle"){const entry=active.get(pointerId);if(!entry)return false;active.delete(pointerId);if(entry.kind==="look"){endPointerDrag(entry.element,pointerId);resetLook(entry);}else if(entry.kind==="fire"){const view=viewport();if(view){view.dataset.walkFirePointerActive="0";view.dataset.walkFirePointerRelease=reason;}}const view=viewport();if(view){view.dataset.walkTouchLifecycleRelease=reason;view.dataset.walkTouchLifecycleReleases=String((Number(view.dataset.walkTouchLifecycleReleases)||0)+1);}return true;}function releaseAllActive(reason="lifecycle"){for(const id of [...active.keys()])releaseActivePointer(id,reason);}function releaseCapturedPointer(event){releaseActivePointer(event.pointerId,"lostpointercapture");}

function capture(event){
  if(!touchDevice()||event.pointerType==="mouse"||!isFoot())return;
  const target=event.target instanceof Element?event.target:null;
  if(event.type==="pointerdown"){
    const move=target?.closest("#footMove"),lookStick=target?.closest("#footLook");
    if(move)return;
    if(lookStick){
      const element=lookStick,axes=normalizedPointer(element,event),entry={kind:"look",element,axes};
      active.set(event.pointerId,entry);event.preventDefault();event.stopImmediatePropagation();element.setPointerCapture?.(event.pointerId);walk()?.beginTouchLook?.("right-stick");paintLook(entry,axes);ensureInputLoop();
      const view=viewport();if(view){view.dataset.walkStickSemantics="walk-left-single-owner+look-normalized-v1";view.dataset.walkMultiTouchMoveIsolation="left-stick-owned-by-player-walk-v1";}
      return;
    }
    if(interactive(target))return;
    beginFire(event);event.preventDefault();event.stopImmediatePropagation();return;
  }
  const entry=active.get(event.pointerId);if(!entry)return;
  if(event.type==="pointermove"){
    if(entry.kind==="look"){entry.axes=normalizedPointer(entry.element,event);paintLook(entry,entry.axes);event.preventDefault();event.stopImmediatePropagation();return;}
    if(entry.kind==="fire"){entry.x=event.clientX;entry.y=event.clientY;window.dispatchEvent(new CustomEvent("arondight:foot-aim",{detail:{clientX:entry.x,clientY:entry.y,phase:"move"}}));event.preventDefault();event.stopImmediatePropagation();return;}
  }
  if(event.type==="pointerup"||event.type==="pointercancel"){
    active.delete(event.pointerId);
    if(entry.kind==="look"){endPointerDrag(entry.element,event.pointerId);resetLook(entry);event.preventDefault();event.stopImmediatePropagation();}
    else if(entry.kind==="fire"){window.dispatchEvent(new CustomEvent("arondight:foot-aim",{detail:{clientX:event.clientX,clientY:event.clientY,phase:"end"}}));const view=viewport();if(view){view.dataset.walkFirePointerActive="0";view.dataset.walkFirePointerRelease=event.type;}event.preventDefault();event.stopImmediatePropagation();}
  }
}

function installStyle(){
  if(document.querySelector("style[data-flight-first-cleanup]"))return;
  const style=document.createElement("style");style.dataset.flightFirstCleanup="v4";style.textContent=`
#gameplayContractHud{visibility:hidden!important;opacity:0!important;pointer-events:none!important}
#gameplayScorePill,#gameplayToast,#gameplayMomentum{display:none!important;visibility:hidden!important;pointer-events:none!important}
body.on-foot-mode #footLookZone,body.on-foot-mode #footFire,body.on-foot-mode #footReadout{display:none!important;pointer-events:none!important}
body.on-foot-mode .foot-stick{position:absolute!important;width:min(25vw,150px)!important;aspect-ratio:1!important;bottom:max(20px,var(--solo-safe-bottom,env(safe-area-inset-bottom)))!important;border:0!important;border-radius:50%!important;background:transparent!important;box-shadow:none!important;opacity:1!important;pointer-events:auto!important;touch-action:none!important;z-index:20!important}
body.on-foot-mode #footMove{left:max(12px,var(--solo-safe-left,env(safe-area-inset-left)))!important}
body.on-foot-mode #footLook{right:max(12px,var(--solo-safe-right,env(safe-area-inset-right)))!important;width:min(25vw,150px)!important;opacity:1!important;background:transparent!important}
body.on-foot-mode .foot-stick .ring{position:absolute!important;inset:0!important;border-radius:50%!important;border:2px solid #ffffff66!important;background:#0b18265c!important;box-shadow:inset 0 0 45px #0005,0 6px 22px #0005!important}
body.on-foot-mode .foot-stick .knob{position:absolute!important;left:50%;top:50%;width:31%!important;aspect-ratio:1!important;transform:translate(-50%,-50%)!important;border-radius:50%!important;background:#f3f7ffcc!important;border:2px solid #fff!important;box-shadow:0 3px 14px #0008!important}
body.on-foot-mode .foot-stick span{bottom:-15px!important;font-size:9px!important}
dialog.phone-settings-dialog[open]{box-sizing:border-box!important;position:fixed!important;left:50%!important;top:50%!important;transform:translate(-50%,-50%)!important;margin:0!important;width:min(94vw,560px)!important;height:min(94dvh,calc(100dvh - 10px))!important;max-height:none!important;overflow-x:hidden!important;overflow-y:auto!important;overscroll-behavior-y:contain!important;-webkit-overflow-scrolling:touch!important;touch-action:pan-y!important;padding-bottom:max(20px,env(safe-area-inset-bottom))!important}
dialog.phone-settings-dialog[open] .phone-settings-titlebar{position:sticky!important;top:-16px!important;z-index:20!important}
@media(max-height:430px){dialog.phone-settings-dialog[open]{width:min(96vw,680px)!important;height:calc(100dvh - 8px)!important;padding:10px 14px 20px!important}dialog.phone-settings-dialog[open] .phone-settings-titlebar{top:-10px!important;margin:-10px -14px 8px!important;padding:8px 12px!important}.phone-settings-row{margin:9px 0!important}.phone-settings-toggle{margin:8px 0 6px!important;padding:7px 0!important}.phone-settings-profile{margin-bottom:10px!important;padding:8px 10px!important}}
`;
  document.head.appendChild(style);
}
function publish(){const view=viewport();if(!view)return;view.dataset.flightFirstUi="real-estate-first-v2";view.dataset.walkTouchContract="drone-normalized-pointer-origin-v2";view.dataset.walkFullscreenLook="disabled";view.dataset.walkScreenTouch="fire-only-v1";view.dataset.walkFireOverlay="removed";view.dataset.gameplayArcadeHud="hidden";view.dataset.walkMultiTouchMoveIsolation="pointer-id-owned-v1";view.dataset.walkHoldFire="screen-pointer-owned-smg-v1";}
export function installFlightFirstCleanup(){if(installed)return;installed=true;installStyle();window.addEventListener("pointerdown",capture,{capture:true,passive:false});window.addEventListener("pointermove",capture,{capture:true,passive:false});window.addEventListener("pointerup",capture,{capture:true,passive:false});window.addEventListener("pointercancel",capture,{capture:true,passive:false});window.addEventListener("lostpointercapture",releaseCapturedPointer,{capture:true,passive:false});addEventListener("blur",()=>releaseAllActive("window-blur"),{capture:true});addEventListener("pagehide",()=>releaseAllActive("pagehide"),{capture:true});addEventListener("orientationchange",()=>releaseAllActive("orientationchange"),{capture:true});document.addEventListener("visibilitychange",()=>{if(document.hidden)releaseAllActive("visibility-hidden");},{capture:true});addEventListener("arondight:player-mode",()=>releaseAllActive("mode-change"),{capture:true});publish();}