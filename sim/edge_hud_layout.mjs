// EDGE HUD (touch): every button sits at the screen edges, in reach of the thumb that uses it — the
// middle of the picture stays free. One authority places them for all modes (on foot, drone, car)
// and both orientations (positions are computed in the viewport's own, possibly quarter-turned, frame):
//   * left thumb  — a row right above the move stick: mode switch, air strike, grenade; in the drone
//                   the altitude pad stands right next to the stick, at the bottom
//   * right thumb — the low row left of the look stick: weapon, JUMP / ARM, STOP / exit car; above the
//                   look stick, against the right edge: get in (car, jet), EMP, and in the car the
//                   handbrake (nearest the thumb), camera and radio
//   * top bar     — the voice buttons (mic, mute) join the other toggles up there
// Desktop (mouse + keyboard) keeps its own layout with key hints.
export const EDGE_HUD_VERSION="edge-hud-v1";
const $=id=>document.getElementById(id),SAFE=10,GAP=8;
const view=()=>$("viewport");
function shown(el){if(!el||el.hidden||!el.offsetParent)return false;const cs=getComputedStyle(el);return cs.display!=="none"&&cs.visibility!=="hidden"&&el.offsetWidth>0&&el.offsetHeight>0;}
// position of an element's offset-parent origin in viewport coordinates (offset chain, rotation-proof)
function originOf(el){const v=view();let x=0,y=0,n=el.offsetParent;while(n&&n!==v){x+=n.offsetLeft;y+=n.offsetTop;n=n.offsetParent;}return n===v?{x,y}:null;}
function rectOf(el){if(!shown(el))return null;const o=originOf(el);if(!o)return null;const x=o.x+el.offsetLeft,y=o.y+el.offsetTop;return{left:x,top:y,width:el.offsetWidth,height:el.offsetHeight,right:x+el.offsetWidth,bottom:y+el.offsetHeight};}
function px(el,prop,v){const s=`${Math.round(v)}px`;if(el.style.getPropertyValue(prop)!==s||el.style.getPropertyPriority(prop)!=="important")el.style.setProperty(prop,s,"important");}
function put(el,x,y){const o=originOf(el);if(!o)return;if(getComputedStyle(el).position==="static")el.style.setProperty("position","absolute","important");px(el,"left",x-o.x);px(el,"top",y-o.y);for(const p of["right","bottom"])if(el.style.getPropertyValue(p)!=="auto")el.style.setProperty(p,"auto","important");if(el.style.getPropertyValue("transform")!=="none")el.style.setProperty("transform","none","important");if(el.style.getPropertyValue("margin")!=="0px")el.style.setProperty("margin","0","important");}
// pack items in rows: from a corner along x (dir +1 rightwards / -1 leftwards), rows grow upward from `bottom`
function packRows(items,{x0,bottom,dir,maxWidth}){let x=x0,rowH=0,yBottom=bottom,used=0;for(const el of items){const w=el.offsetWidth,h=el.offsetHeight;if(used>0&&used+w>maxWidth){yBottom-=rowH+GAP;x=x0;used=0;rowH=0;}const left=dir>0?x:x-w;put(el,left,yBottom-h);x+=dir*(w+GAP);used+=w+GAP;rowH=Math.max(rowH,h);}}
function touchPlay(){const b=document.body;return b.classList.contains("solo-flight")&&!b.classList.contains("desktop-input")&&!$("gameMenu")?.offsetParent;}
function toLogical(r){const v=view(),vr=v.getBoundingClientRect(),rot=v.dataset.soloOrientation==="css-landscape";if(!rot)return{left:r.left-vr.left,top:r.top-vr.top,right:r.right-vr.left,bottom:r.bottom-vr.top};return{left:r.top-vr.top,right:r.bottom-vr.top,top:vr.right-r.right,bottom:vr.right-r.left};}
// The global toggles (GPS, music, sound) are fixed to the page; while you play on touch they move into
// the game view, so in portrait (a quarter-turned landscape) they turn with it and line up with RESET
// in the top bar instead of landing on the right stick.
const TOGGLES=["soundSwitch","musicSwitch","gpsLiveButton"];
function adoptToggles(on){const v=view();for(const id of TOGGLES){const el=$(id);if(!el)continue;if(on&&el.parentElement!==v){v.appendChild(el);el.dataset.edgeAdopted="1";}
  else if(!on&&el.dataset.edgeAdopted){document.body.appendChild(el);delete el.dataset.edgeAdopted;for(const p of["position","left","top","right","bottom","transform","margin","width","height"])el.style.removeProperty(p);}}}
function placeToggles(W){const reset=rectOf($("mobileGameplayReset"));let x=(reset?reset.left:W-SAFE)-GAP,y=reset?reset.top:SAFE;for(const id of TOGGLES){const el=$(id);if(!el||el.parentElement!==view()||el.hidden||getComputedStyle(el).display==="none")continue;
  if(id!=="gpsLiveButton"){el.style.setProperty("width","40px","important");el.style.setProperty("height","36px","important");}else el.style.setProperty("height","36px","important");el.style.setProperty("position","absolute","important");const w=el.offsetWidth||40;put(el,x-w,y);x-=w+GAP;}return x;}
function layout(){const v=view(),b=document.body;if(!v)return;const on=touchPlay();b.classList.toggle("edge-hud",on);adoptToggles(on);if(!on)return;
  const W=v.clientWidth,H=v.clientHeight,driving=b.classList.contains("player-driving"),jet=b.classList.contains("jet-mode"),drone=!driving&&!jet&&globalThis.__arondightWalkMode?.mode!=="foot";
  const L=rectOf($("footMove"))||rectOf($("soloLeft")),R=rectOf($("footLook"))||rectOf($("soloRight"));
  // left thumb row, above the move stick
  if(L){const mode=$("mobileGameplayMode"),modeLow=!drone&&shown(mode);if(modeLow)put(mode,L.right+GAP,H-SAFE-mode.offsetHeight); /* on foot / in the car: low, right of the move stick */
    const items=[drone?"mobileGameplayMode":"",driving?"":"airStrikeButton",driving||drone?"":"handGrenadeBtn"].filter(Boolean).map($).filter(shown);packRows(items,{x0:Math.max(SAFE,L.left+SAFE),bottom:L.top-GAP,dir:1,maxWidth:Math.max(L.width,190)});
    const clr=$("soloClearance");if(drone&&shown(clr))put(clr,L.right+GAP,H-SAFE-clr.offsetHeight);}
  if(R){// low row left of the look stick (bottom-aligned), nearest the thumb first
    const low=(driving?["enterCarButton"]:drone?["thumbWeapon","soloArm","soloKill"]:["thumbWeapon","footJump"]).map($).filter(shown);
    let x=R.left-GAP;for(const el of low){put(el,x-el.offsetWidth,H-SAFE-el.offsetHeight);x-=el.offsetWidth+GAP;}
    // above the look stick, against the right edge
    if(driving){const box=$("vehicleButtons");if(shown(box)){box.style.setProperty("flex-direction","column","important");box.style.setProperty("align-items","flex-end","important");box.style.setProperty("gap","8px","important");box.style.setProperty("width","auto","important");put(box,W-SAFE-box.offsetWidth,R.top-GAP-box.offsetHeight);}}
    else{const items=["enterCarButton","enterJetButton","wantedEmpButton"].map($).filter(shown);packRows(items,{x0:W-SAFE,bottom:R.top-GAP,dir:-1,maxWidth:Math.max(R.width,190)});}}
  const togglesLeft=placeToggles(W);
  // voice: in the top bar, between the centre dock and the toggles at the top right
  const bar=$("proximityVoiceBar");if(bar&&!bar.hidden){bar.style.setProperty("flex-direction","row","important");bar.style.setProperty("bottom","auto","important");
    const dock=rectOf($("mobileGameplayDock")),bw=bar.offsetWidth||82;let right=togglesLeft;for(const id of["gpsLiveButton","musicPlayerButton","soundToggleButton","mobileGameplayReset"]){const el=$(id);if(!el||!el.offsetParent)continue;const r=toLogical(el.getBoundingClientRect());if(r.top<56&&r.left>W/2)right=Math.min(right,r.left-GAP);}
    for(const el of document.querySelectorAll("button,[role=button]")){if(el.closest("#viewport")||!el.getClientRects().length||getComputedStyle(el).visibility==="hidden")continue; /* fixed toggles (GPS, music, sound) have no offsetParent */const r=toLogical(el.getBoundingClientRect());if(r.top>=0&&r.top<56&&r.left>W/2&&r.right<=W+2)right=Math.min(right,r.left-GAP);}
    const x=Math.max((dock?.right||W/2)+GAP,right-bw),multi=rectOf($("mobileGameplayMultiplayer"))||rectOf($("gameExitButton"));
    if(x+bw<=right+1)put(bar,x,SAFE-2);else if(multi&&(!dock||multi.right+GAP+bw<=dock.left-GAP))put(bar,multi.right+GAP,multi.top);else put(bar,W-SAFE-bw,62);}
  v.dataset.edgeHud=EDGE_HUD_VERSION;}
export function installEdgeHud(){if(globalThis.__arondightEdgeHud||typeof window==="undefined")return;globalThis.__arondightEdgeHud={version:EDGE_HUD_VERSION,layout};
  const st=document.createElement("style");st.dataset.edgeHud=EDGE_HUD_VERSION;st.textContent=`body.edge-hud #viewport #proximityVoiceBar{display:flex}body.edge-hud #viewport #proximityVoiceBar button{width:36px!important;height:36px!important;min-height:36px!important}`;document.head.appendChild(st);
  // run after the older per-module placements in the same tick (they stand down while edge-hud is on)
  const loop=()=>{try{layout();}catch(e){console.warn("edge hud",e);}setTimeout(loop,180);};loop();addEventListener("resize",()=>setTimeout(layout,60));}
installEdgeHud();
