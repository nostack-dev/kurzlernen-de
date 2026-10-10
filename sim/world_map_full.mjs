// Fullscreen map (GTA pause-map style) + destination search + subtle route guidance.
//
// Open: double-tap the minimap · M (keyboard) · hold VIEW (Xbox). Close: ✕ · M / Esc · B / VIEW.
// The map fills the screen at the screen's own aspect ratio and works in every mode (on foot,
// drone, car, jet). In the real world it is a second, interactive OSM vector map (street names,
// places); in a world without geo data it draws the loaded roads and buildings itself.
//   * drag = pan, pinch / wheel / + − = zoom, tap = set a waypoint, tap the pin again = remove it,
//   * search: type an address ("Dorfstraße 8, Kirchberg an der Jagst") — suggestions near you —
//     pick one: the destination is set and a road route is fetched (on foot: footpaths),
//   * pad: left stick pans, LT/RT zoom, A sets the waypoint at the crosshair, Y = search, X = clear.
// Guidance while playing is deliberately quiet: a small chevron on the horizon in the direction
// of the route (AR-style: it sits where the route goes, or at the screen edge when that is behind
// you) and one line "↗ 1,2 km · Dorfstraße 8". The route shows on the minimap. No destination —
// nothing is drawn. Arriving clears it.
import * as maplibregl from "maplibre-gl";
import * as THREE from "three";

export const WORLD_MAP_FULL_VERSION="fullscreen-map-search-route-v1";
const STYLE_URL="https://tiles.openfreemap.org/styles/liberty";
const EARTH=6378137,DEG=Math.PI/180;
const PHOTON="https://photon.komoot.io/api/",NOMINATIM="https://nominatim.openstreetmap.org/search";
const ROUTER="https://routing.openstreetmap.de";
const STORE="arondight45NavDestinationV1";
let installed=false,dlg=null,mapApi=null,mapReady=false,mapFailed=false,canvas=null,ctx2d=null,open=false;
let view={lon:0,lat:0,zoom:15.5},follow=true,dest=null,route=null,routeFor="",routeAt=-Infinity,routing=false,lastSearch=0,searchSeq=0,suggestions=[],guideEl=null,arEl=null,lastFrame=0;
const pointers=new Map();let pinch=null,drag=null;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const $=id=>document.getElementById(id);
const bridge=()=>globalThis.__arondightRealWorld||null;
const viewport=()=>$("viewport");
function geo(){const b=bridge();return b&&Number.isFinite(b.originLon)&&Number.isFinite(b.originLat)?{lon:b.originLon,lat:b.originLat,real:Boolean(b.active)}:{lon:0,lat:0,real:false};}
function toLocal(lon,lat){const o=geo();return[(lon-o.lon)*DEG*EARTH*Math.max(.01,Math.cos(o.lat*DEG)),(lat-o.lat)*DEG*EARTH];}
function toLonLat(x,y){const o=geo();return[o.lon+x/(EARTH*Math.max(.01,Math.cos(o.lat*DEG)))/DEG,o.lat+y/EARTH/DEG];}
function fmtDist(m){return m>=1000?`${(m/1000).toFixed(m>=10000?0:1).replace(".",",")} km`:`${Math.max(10,Math.round(m/10)*10)} m`;}
function cam(){const b=bridge();return b?.presentedCamera?.()||b?.threeCamera||null;}
const tmpV=new THREE.Vector3();
function viewBearing(){const c=cam();if(!c)return 0;c.getWorldDirection(tmpV);return Math.atan2(tmpV.x,tmpV.y)/DEG;}
// where the player is, in every mode (local metres)
function subject(){
  const jet=globalThis.__jetMode;if(jet?.active){const p=jet.pose;if(p)return{x:p.x,y:p.y,z:p.z,mode:"jet"};}
  const drive=globalThis.__arondightVehicleDrive;if(drive?.active&&drive.pose?.position){const p=drive.pose.position;return{x:p[0],y:p[1],z:p[2]||0,mode:"car"};}
  const walk=globalThis.__arondightWalkMode;if(walk?.mode==="foot"&&walk.position)return{x:walk.position.x,y:walk.position.y,z:walk.position.z,mode:"foot"};
  const b=bridge(),af=b?.threeScene?b.airframeFor?.(b.threeScene):null;if(af)return{x:af.position.x,y:af.position.y,z:af.position.z,mode:"drone"};
  return null;}
function inGame(){return document.body.classList.contains("solo-flight")&&!($("gameMenu")&&!$("gameMenu").hidden);}

// ------------------------------------------------------------ destination + route
function saveDest(){try{if(dest)localStorage.setItem(STORE,JSON.stringify(dest));else localStorage.removeItem(STORE);}catch{}}
function setDestination(d){dest=d?{lon:+d.lon,lat:+d.lat,name:String(d.name||"Wegpunkt").slice(0,80),sub:String(d.sub||"").slice(0,80)}:null;route=null;routeFor="";routeAt=-Infinity;saveDest();renderPanel();if(dest)requestRoute(true);window.dispatchEvent(new CustomEvent("arondight:nav-destination",{detail:{destination:dest}}));const v=viewport();if(v)v.dataset.navDestination=dest?`${dest.lat.toFixed(5)},${dest.lon.toFixed(5)}`:"";}
function profile(){const s=subject();return s?.mode==="foot"?"foot":"car";}
async function requestRoute(force=false){
  const s=subject(),o=geo();if(!dest||!s||!o.real||routing)return;const now=performance.now();if(!force&&now-routeAt<10000)return;routeAt=now;routing=true;
  const [lon,lat]=toLonLat(s.x,s.y),p=profile(),key=`${p}:${dest.lon},${dest.lat}`;
  try{const url=`${ROUTER}/routed-${p}/route/v1/driving/${lon.toFixed(6)},${lat.toFixed(6)};${dest.lon.toFixed(6)},${dest.lat.toFixed(6)}?overview=full&geometries=geojson`;
    const r=await fetch(url,{signal:AbortSignal.timeout?.(9000)});if(!r.ok)throw Error(`route ${r.status}`);const j=await r.json(),rt=j?.routes?.[0];
    if(rt?.geometry?.coordinates?.length>=2&&dest&&`${p}:${dest.lon},${dest.lat}`===key){route={coords:rt.geometry.coordinates,meters:Number(rt.distance)||0,seconds:Number(rt.duration)||0,profile:p};routeFor=key;}
  }catch{route=null;}finally{routing=false;renderPanel();updateMapRoute();}
}
// the polyline the guidance follows (local metres): route if there is one, else straight to the pin
function pathLocal(){if(!dest)return null;const pts=route?.coords?.map(c=>toLocal(c[0],c[1]))||[];const d=toLocal(dest.lon,dest.lat);if(!pts.length)return[d];const last=pts[pts.length-1];if(Math.hypot(last[0]-d[0],last[1]-d[1])>2)pts.push(d);return pts;}
// nearest point on the path, then `ahead` metres further along it
function lookahead(s,ahead){const pts=pathLocal();if(!pts)return null;if(pts.length===1)return{p:pts[0],off:0,left:Math.hypot(pts[0][0]-s.x,pts[0][1]-s.y)};
  let best=Infinity,bi=0,bt=0;for(let i=0;i<pts.length-1;i++){const a=pts[i],b=pts[i+1],dx=b[0]-a[0],dy=b[1]-a[1],L2=dx*dx+dy*dy||1,t=clamp(((s.x-a[0])*dx+(s.y-a[1])*dy)/L2,0,1),qx=a[0]+dx*t,qy=a[1]+dy*t,d=Math.hypot(s.x-qx,s.y-qy);if(d<best){best=d;bi=i;bt=t;}}
  let left=0;{const a=pts[bi],b=pts[bi+1];left+=Math.hypot(b[0]-a[0],b[1]-a[1])*(1-bt);for(let i=bi+1;i<pts.length-1;i++)left+=Math.hypot(pts[i+1][0]-pts[i][0],pts[i+1][1]-pts[i][1]);}
  let rem=ahead,i=bi,t=bt;while(i<pts.length-1){const a=pts[i],b=pts[i+1],L=Math.hypot(b[0]-a[0],b[1]-a[1]),avail=L*(1-t);if(avail>=rem){const u=t+rem/(L||1);return{p:[a[0]+(b[0]-a[0])*u,a[1]+(b[1]-a[1])*u],off:best,left};}rem-=avail;i++;t=0;}
  return{p:pts[pts.length-1],off:best,left};}

// ------------------------------------------------------------ search
async function search(q){
  const seq=++searchSeq,s=subject(),[lon,lat]=s?toLonLat(s.x,s.y):[geo().lon,geo().lat];const text=q.trim();if(text.length<3){suggestions=[];renderSuggestions();return;}
  let list=[];
  try{const u=`${PHOTON}?q=${encodeURIComponent(text)}&limit=6&lang=de${geo().real?`&lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`:""}`;const r=await fetch(u,{signal:AbortSignal.timeout?.(7000)});if(r.ok){const j=await r.json();list=(j.features||[]).map(f=>{const p=f.properties||{},c=f.geometry?.coordinates||[];const street=[p.street||p.name,p.housenumber].filter(Boolean).join(" ");const place=[p.postcode,p.city||p.town||p.village||p.locality||p.county].filter(Boolean).join(" ");return{lon:+c[0],lat:+c[1],name:street||p.name||place||"Ort",sub:[street&&p.name&&p.name!==p.street?p.name:"",place,p.country].filter(Boolean).join(", ")};}).filter(e=>Number.isFinite(e.lon)&&Number.isFinite(e.lat));}}catch{}
  if(!list.length){try{const r=await fetch(`${NOMINATIM}?format=jsonv2&limit=6&accept-language=de&q=${encodeURIComponent(text)}`,{signal:AbortSignal.timeout?.(7000)});if(r.ok){const j=await r.json();list=j.map(e=>{const parts=String(e.display_name||"").split(", ");return{lon:+e.lon,lat:+e.lat,name:parts.slice(0,2).join(" "),sub:parts.slice(2,5).join(", ")};});}}catch{}}
  if(seq!==searchSeq)return;suggestions=list;renderSuggestions(list.length?"":"Nichts gefunden");}

// ------------------------------------------------------------ fullscreen map UI
const CSS=`
#worldMapFull{position:absolute;inset:0;z-index:100020;margin:0;padding:0;border:0;width:100%;height:100%;max-width:none;max-height:none;background:#0e1217;color:#fff;font:600 13px/1.3 Inter,system-ui,-apple-system,sans-serif;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none}
#worldMapFull:not([open]){display:none}
#worldMapFull .wm-stage{position:absolute;inset:0;overflow:hidden}
#worldMapFull .wm-stage>div,#worldMapFull .wm-stage>canvas{position:absolute;inset:0;width:100%;height:100%}
#worldMapFull .wm-gl canvas{position:absolute;left:0;top:0;filter:saturate(.9) brightness(.92) contrast(1.04)}
#worldMapFull .wm-top{position:absolute;left:max(10px,var(--solo-safe-left,env(safe-area-inset-left)));right:max(10px,var(--solo-safe-right,env(safe-area-inset-right)));top:max(10px,var(--solo-safe-top,env(safe-area-inset-top)));display:flex;gap:8px;align-items:flex-start;z-index:3;pointer-events:none}
#worldMapFull .wm-search{flex:1;max-width:520px;margin:0 auto;position:relative;pointer-events:auto}
#worldMapFull input{width:100%;box-sizing:border-box;height:42px;border-radius:21px;border:1.5px solid #ffffff44;background:#0b0f14ee;color:#fff;font:600 15px/1 Inter,system-ui,sans-serif;padding:0 16px 0 38px;outline:none;box-shadow:0 6px 18px #0008;user-select:text;-webkit-user-select:text}
#worldMapFull input:focus{border-color:#7fd3ff}
#worldMapFull .wm-search::before{content:"⌕";position:absolute;left:14px;top:9px;font:900 19px/1 system-ui;opacity:.7;pointer-events:none}
#worldMapFull .wm-sugg{position:absolute;left:0;right:0;top:48px;background:#0b0f14f2;border:1px solid #ffffff2a;border-radius:14px;overflow:hidden;box-shadow:0 10px 24px #000a}
#worldMapFull .wm-sugg:empty{display:none}
#worldMapFull .wm-sugg button{display:block;width:100%;text-align:left;border:0;background:transparent;color:#fff;padding:9px 14px;font:700 14px/1.25 Inter,system-ui,sans-serif;cursor:pointer}
#worldMapFull .wm-sugg button small{display:block;font-weight:500;font-size:11.5px;opacity:.65}
#worldMapFull .wm-sugg button:hover,#worldMapFull .wm-sugg button:focus{background:#1c2a38;outline:none}
#worldMapFull .wm-sugg .wm-none{padding:10px 14px;opacity:.7}
#worldMapFull .wm-close{pointer-events:auto;flex:none;width:42px;height:42px;border-radius:21px;border:1.5px solid #ffffff55;background:#0b0f14ee;color:#fff;font:900 18px/1 system-ui;cursor:pointer;box-shadow:0 6px 18px #0008}
#worldMapFull .wm-side{position:absolute;right:max(10px,var(--solo-safe-right,env(safe-area-inset-right)));bottom:max(30px,calc(var(--solo-safe-bottom,env(safe-area-inset-bottom)) + 24px));display:flex;flex-direction:column;gap:8px;z-index:3}
#worldMapFull .wm-side button{width:44px;height:44px;border-radius:12px;border:1.5px solid #ffffff44;background:#0b0f14e6;color:#fff;font:900 20px/1 system-ui;cursor:pointer}
#worldMapFull .wm-dest{position:absolute;left:max(10px,var(--solo-safe-left,env(safe-area-inset-left)));bottom:max(12px,var(--solo-safe-bottom,env(safe-area-inset-bottom)));max-width:min(440px,calc(100% - 90px));display:flex;gap:10px;align-items:center;background:#0b0f14ee;border:1px solid #ffffff2e;border-radius:14px;padding:8px 10px 8px 14px;z-index:3;box-shadow:0 6px 18px #0008}
#worldMapFull .wm-dest[hidden]{display:none}
#worldMapFull .wm-dest b{display:block;font:800 14px/1.2 Inter,system-ui,sans-serif}
#worldMapFull .wm-dest small{display:block;opacity:.7;font-size:11.5px}
#worldMapFull .wm-dest button{flex:none;height:34px;border-radius:10px;border:1px solid #ff8a6a88;background:#2a1410;color:#ffd9cf;font:800 11px/1 Inter,system-ui;letter-spacing:.06em;padding:0 10px;cursor:pointer}
#worldMapFull .wm-hint{position:absolute;left:50%;transform:translateX(-50%);bottom:max(12px,var(--solo-safe-bottom,env(safe-area-inset-bottom)));font:700 11px/1 Inter,system-ui;opacity:.55;white-space:nowrap;z-index:2;pointer-events:none;text-shadow:0 1px 3px #000}
#worldMapFull .wm-hint[hidden]{display:none}
@media (max-width:960px){#worldMapFull .wm-dest:not([hidden])~.wm-hint{display:none}}
#worldMapFull .wm-cross{position:absolute;left:50%;top:50%;width:26px;height:26px;margin:-13px 0 0 -13px;z-index:2;pointer-events:none;display:none}
body.pad-input #worldMapFull .wm-cross{display:block}
#worldMapFull .wm-cross::before,#worldMapFull .wm-cross::after{content:"";position:absolute;background:#fff;box-shadow:0 0 3px #000}
#worldMapFull .wm-cross::before{left:12px;top:0;width:2px;height:26px}#worldMapFull .wm-cross::after{top:12px;left:0;height:2px;width:26px}
#worldMapFull .wm-me,#worldMapFull .wm-pin{position:absolute;left:0;top:0;z-index:2;pointer-events:none;will-change:transform}
#worldMapFull .wm-me{width:0;height:0}
#worldMapFull .wm-me i{position:absolute;left:-11px;top:-13px;width:22px;height:26px;background:#f5b301;clip-path:polygon(50% 0,100% 100%,50% 76%,0 100%);filter:drop-shadow(0 0 2px #000) drop-shadow(0 0 1px #000)}
#worldMapFull .wm-pin{width:0;height:0}
#worldMapFull .wm-pin i{position:absolute;left:-12px;top:-34px;width:24px;height:34px;background:#ff4b5c;clip-path:path("M12 34 C12 34 0 19 0 12 A12 12 0 1 1 24 12 C24 19 12 34 12 34 Z");filter:drop-shadow(0 2px 3px #000a)}
#worldMapFull .wm-pin i::after{content:"";position:absolute;left:8px;top:8px;width:8px;height:8px;border-radius:50%;background:#fff}
#worldMapFull .wm-pin[hidden],#worldMapFull .wm-me[hidden]{display:none}
#worldMapFull .wm-attr{position:absolute;right:max(62px,calc(var(--solo-safe-right,env(safe-area-inset-right)) + 62px));bottom:2px;font:500 9px/1.2 Inter,system-ui;opacity:.55;z-index:2}
#worldMapFull .wm-attr a{color:#fff}
/* the map owns the screen: body-level corner buttons (GPS, music, sound) step aside while it is open */
body.world-map-open>:not(#viewport):not(dialog):not(script):not(style):not(link){visibility:hidden!important}
#navGuide{position:absolute;left:50%;top:calc(max(8px,var(--solo-safe-top,env(safe-area-inset-top))) + 50px);transform:translateX(-50%);z-index:30;display:flex;align-items:center;gap:7px;padding:4px 11px 4px 7px;border-radius:14px;background:#0b0f14a8;border:1px solid #ffffff22;color:#fff;font:700 11.5px/1 Inter,system-ui,sans-serif;letter-spacing:.02em;pointer-events:none;white-space:nowrap;max-width:min(70vw,420px);overflow:hidden;text-overflow:ellipsis;opacity:.86}
#navGuide[hidden],#navAr[hidden]{display:none}
#navGuide i{display:inline-block;width:16px;height:16px;background:#7fd3ff;clip-path:polygon(50% 0,92% 100%,50% 74%,8% 100%);flex:none}
#navGuide span{overflow:hidden;text-overflow:ellipsis}
#navAr{position:absolute;left:0;top:0;z-index:29;width:0;height:0;pointer-events:none;will-change:transform;opacity:.72}
#navAr i{position:absolute;left:-9px;top:-9px;width:18px;height:18px;background:#7fd3ff;clip-path:polygon(50% 0,100% 100%,50% 70%,0 100%);filter:drop-shadow(0 0 2px #0009)}
#navAr small{position:absolute;left:50%;top:12px;transform:translateX(-50%);font:800 10px/1 Inter,system-ui,sans-serif;color:#dff4ff;text-shadow:0 1px 2px #000;white-space:nowrap}
body.jet-mode #navAr i{background:#7dff9a}body.jet-mode #navGuide i{background:#7dff9a}`;

function ensureStyle(){if(!document.querySelector("style[data-world-map-full]")){const st=document.createElement("style");st.dataset.worldMapFull=WORLD_MAP_FULL_VERSION;st.textContent=CSS;document.head.appendChild(st);}}
function ensureUi(){
  const v=viewport();if(!v)return null;if(dlg?.isConnected)return dlg;
  ensureStyle();
  dlg=document.createElement("dialog");dlg.id="worldMapFull";dlg.setAttribute("aria-label","Karte");
  dlg.innerHTML=`<div class="wm-stage"><canvas class="wm-canvas"></canvas><div class="wm-gl"></div></div><div class="wm-me"><i></i></div><div class="wm-pin" hidden><i></i></div><div class="wm-cross"></div>
<div class="wm-top"><div class="wm-search"><input type="search" enterkeyhint="search" autocomplete="off" spellcheck="false" placeholder="Ziel suchen – Straße Nr., Ort"><div class="wm-sugg" role="listbox"></div></div><button type="button" class="wm-close" aria-label="Karte schließen">✕</button></div>
<div class="wm-dest" hidden><div><b></b><small></small></div><button type="button" data-clear>ZIEL LÖSCHEN</button></div>
<div class="wm-side"><button type="button" data-zoom="1" aria-label="Hineinzoomen">+</button><button type="button" data-zoom="-1" aria-label="Herauszoomen">−</button><button type="button" data-me aria-label="Auf mich zentrieren">⌖</button></div>
<div class="wm-hint"></div><div class="wm-attr"></div>`;
  v.appendChild(dlg);canvas=dlg.querySelector(".wm-canvas");ctx2d=canvas.getContext("2d");
  const input=dlg.querySelector("input");let t=0;
  input.addEventListener("input",()=>{clearTimeout(t);t=setTimeout(()=>search(input.value),320);});
  input.addEventListener("keydown",e=>{e.stopPropagation();if(e.key==="Enter"){e.preventDefault();if(suggestions[0])pick(suggestions[0]);else search(input.value);}else if(e.key==="Escape"){e.preventDefault();if(input.value){input.value="";suggestions=[];renderSuggestions();}else close();}else if(e.key==="ArrowDown"){e.preventDefault();dlg.querySelector(".wm-sugg button")?.focus();}});
  input.addEventListener("keyup",e=>e.stopPropagation());
  dlg.querySelector(".wm-close").addEventListener("click",e=>{e.preventDefault();close();});
  dlg.querySelector("[data-clear]").addEventListener("click",e=>{e.preventDefault();setDestination(null);});
  for(const b of dlg.querySelectorAll("[data-zoom]"))b.addEventListener("click",e=>{e.preventDefault();zoomBy(Number(b.dataset.zoom));});
  dlg.querySelector("[data-me]").addEventListener("click",e=>{e.preventDefault();follow=true;centerOnMe();});
  const stage=dlg.querySelector(".wm-stage");
  stage.addEventListener("pointerdown",onDown,{passive:false});stage.addEventListener("pointermove",onMove,{passive:false});stage.addEventListener("pointerup",onUp,{passive:false});stage.addEventListener("pointercancel",onUp,{passive:false});
  stage.addEventListener("wheel",e=>{e.preventDefault();e.stopPropagation();const p=local(e.clientX,e.clientY);zoomBy(-Math.sign(e.deltaY)*.5,p);},{passive:false});
  for(const ev of["pointerdown","click","touchstart","mousedown","contextmenu"])dlg.addEventListener(ev,e=>e.stopPropagation(),{passive:ev==="touchstart"});
  dlg.addEventListener("cancel",e=>{e.preventDefault();close();});
  return dlg;}
// client → map-local px (the viewport is CSS-rotated in portrait)
function local(cx,cy){const v=viewport(),r=v?.getBoundingClientRect();if(!r)return{x:cx,y:cy};const rot=v.dataset.soloOrientation==="css-landscape";return rot?{x:cy-r.top,y:r.right-cx}:{x:cx-r.left,y:cy-r.top};}
function size(){const d=dlg;return{w:Math.max(1,d?.clientWidth||1),h:Math.max(1,d?.clientHeight||1)};}
// projection shared by the GL map and the canvas fallback (web-mercator, 512 px tiles like maplibre)
function worldPx(lon,lat,z){const s=512*2**z,si=Math.sin(clamp(lat,-85,85)*DEG);return[(lon+180)/360*s,(.5-Math.log((1+si)/(1-si))/(4*Math.PI))*s];}
function unworld(x,y,z){const s=512*2**z,lon=x/s*360-180,n=Math.PI-2*Math.PI*y/s;return[lon,Math.atan(Math.sinh(n))/DEG];}
function project(lon,lat){if(mapReady&&mapApi){const p=mapApi.project([lon,lat]);return[p.x,p.y];}const {w,h}=size(),[cx,cy]=worldPx(view.lon,view.lat,view.zoom),[x,y]=worldPx(lon,lat,view.zoom);return[x-cx+w/2,y-cy+h/2];}
function unproject(px,py){if(mapReady&&mapApi){const l=mapApi.unproject([px,py]);return[l.lng,l.lat];}const {w,h}=size(),[cx,cy]=worldPx(view.lon,view.lat,view.zoom);return unworld(cx+px-w/2,cy+py-h/2,view.zoom);}
function applyView(){if(mapReady&&mapApi){try{mapApi.jumpTo({center:[view.lon,view.lat],zoom:view.zoom});}catch{}}}
function zoomBy(dz,at){const {w,h}=size(),p=at||{x:w/2,y:h/2},before=unproject(p.x,p.y);view.zoom=clamp(view.zoom+dz,3,19.5);applyView();/* keep the point under the finger / cursor */const after=unproject(p.x,p.y);view.lon+=before[0]-after[0];view.lat+=before[1]-after[1];applyView();}
function centerOnMe(){const s=subject();if(!s)return;const [lon,lat]=toLonLat(s.x,s.y);view.lon=lon;view.lat=lat;applyView();}
function panPx(dx,dy){const {w,h}=size(),a=unproject(w/2,h/2),b=unproject(w/2-dx,h/2-dy);view.lon+=b[0]-a[0];view.lat+=b[1]-a[1];view.lat=clamp(view.lat,-84,84);applyView();}
function onDown(e){if(e.target.closest?.("button,input,.wm-sugg"))return;e.preventDefault();try{e.currentTarget.setPointerCapture(e.pointerId);}catch{}const p=local(e.clientX,e.clientY);pointers.set(e.pointerId,p);
  if(pointers.size===2){const [a,b]=[...pointers.values()];pinch={d:Math.hypot(a.x-b.x,a.y-b.y)||1,zoom:view.zoom,mid:{x:(a.x+b.x)/2,y:(a.y+b.y)/2}};drag=null;}else{drag={id:e.pointerId,x:p.x,y:p.y,sx:p.x,sy:p.y,moved:0,at:performance.now()};}
  blurSearch();}
function onMove(e){if(!pointers.has(e.pointerId))return;e.preventDefault();const p=local(e.clientX,e.clientY);pointers.set(e.pointerId,p);
  if(pinch&&pointers.size>=2){const [a,b]=[...pointers.values()],d=Math.hypot(a.x-b.x,a.y-b.y)||1,target=clamp(pinch.zoom+Math.log2(d/pinch.d),3,19.5);zoomBy(target-view.zoom,pinch.mid);follow=false;return;}
  if(drag&&drag.id===e.pointerId){const dx=p.x-drag.x,dy=p.y-drag.y;drag.x=p.x;drag.y=p.y;drag.moved=Math.max(drag.moved,Math.hypot(p.x-drag.sx,p.y-drag.sy));if(drag.moved>6){panPx(dx,dy);follow=false;}}}
function onUp(e){if(!pointers.has(e.pointerId))return;pointers.delete(e.pointerId);if(pointers.size<2)pinch=null;
  if(drag&&drag.id===e.pointerId){if(drag.moved<=6&&performance.now()-drag.at<600)tapAt(drag.sx,drag.sy);drag=null;}}
function tapAt(x,y){
  if(dest){const [px,py]=project(dest.lon,dest.lat);if(Math.hypot(px-x,py-y-14)<26){setDestination(null);return;}}
  const [lon,lat]=unproject(x,y);setDestination({lon,lat,name:"Wegpunkt",sub:""});reverseName(lon,lat);}
async function reverseName(lon,lat){if(!geo().real)return;try{const r=await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&accept-language=de&lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}`,{signal:AbortSignal.timeout?.(6000)});if(!r.ok)return;const j=await r.json(),a=j.address||{};if(!dest||Math.abs(dest.lon-lon)>1e-7||Math.abs(dest.lat-lat)>1e-7)return;const street=[a.road||a.pedestrian||a.footway,a.house_number].filter(Boolean).join(" ");dest.name=street||j.name||"Wegpunkt";dest.sub=a.village||a.town||a.city||a.municipality||"";saveDest();renderPanel();}catch{}}
function blurSearch(){const i=dlg?.querySelector("input");if(i&&document.activeElement===i)i.blur();}
function pick(e){suggestions=[];renderSuggestions();const i=dlg.querySelector("input");i.value="";i.blur();setDestination(e);follow=false;fitBoth();}
function fitBoth(){const s=subject();if(!dest||!s)return;const [lon,lat]=toLonLat(s.x,s.y),{w,h}=size();let z=18;for(;z>3;z-=.25){const a=worldPx(lon,lat,z),b=worldPx(dest.lon,dest.lat,z);if(Math.abs(a[0]-b[0])<w*.7&&Math.abs(a[1]-b[1])<h*.62)break;}view.zoom=z;view.lon=(lon+dest.lon)/2;view.lat=(lat+dest.lat)/2;applyView();}
function renderSuggestions(msg=""){const box=dlg?.querySelector(".wm-sugg");if(!box)return;box.textContent="";if(msg&&!suggestions.length){const d=document.createElement("div");d.className="wm-none";d.textContent=msg;box.appendChild(d);return;}
  suggestions.forEach((e,i)=>{const b=document.createElement("button");b.type="button";b.innerHTML="<span></span><small></small>";b.firstChild.textContent=e.name;b.lastChild.textContent=e.sub;b.addEventListener("click",ev=>{ev.preventDefault();pick(e);});b.addEventListener("keydown",ev=>{ev.stopPropagation();if(ev.key==="ArrowDown"){ev.preventDefault();(b.nextElementSibling||b).focus();}else if(ev.key==="ArrowUp"){ev.preventDefault();(b.previousElementSibling||dlg.querySelector("input")).focus();}else if(ev.key==="Escape"){ev.preventDefault();dlg.querySelector("input").focus();}});box.appendChild(b);});}
function renderPanel(){if(!dlg)return;const box=dlg.querySelector(".wm-dest");if(!dest){box.hidden=true;return;}box.hidden=false;const s=subject(),la=s?lookahead(s,0):null,dist=route?.meters&&la?la.left:la?.left;
  box.querySelector("b").textContent=dest.name;box.querySelector("small").textContent=[dest.sub,dist!=null?fmtDist(dist):"",route?.seconds?`${Math.max(1,Math.round(route.seconds/60))} min ${route.profile==="foot"?"zu Fuß":"mit dem Auto"}`:routing?"Route wird berechnet…":geo().real?"Luftlinie":""].filter(Boolean).join(" · ");}
function renderHint(){const h=dlg?.querySelector(".wm-hint");if(!h)return;const c=document.body.classList;const t=c.contains("pad-input")?"Ⓐ Ziel setzen · Ⓨ Suche · Ⓧ Ziel löschen · LT/RT Zoom · Ⓑ zurück":c.contains("desktop-input")?"Klick = Ziel setzen · Mausrad = Zoom · M / Esc = schließen":"Tippen = Ziel setzen · Ziehen = verschieben · zwei Finger = Zoom";if(h.textContent!==t)h.textContent=t;}

// ---------------------------------------------------------------- GL map (real world)
function ensureGlMap(){
  if(mapApi||mapFailed||!geo().real)return;const host=dlg.querySelector(".wm-gl");
  try{mapApi=new maplibregl.Map({container:host,style:STYLE_URL,center:[view.lon,view.lat],zoom:view.zoom,bearing:0,pitch:0,interactive:false,attributionControl:false,fadeDuration:120,renderWorldCopies:false,maxPitch:0});
    mapApi.on("load",()=>{mapReady=true;try{mapApi.addSource("nav-route",{type:"geojson",data:emptyLine()});mapApi.addLayer({id:"nav-route-casing",type:"line",source:"nav-route",layout:{"line-join":"round","line-cap":"round"},paint:{"line-color":"#0b2235","line-width":["interpolate",["linear"],["zoom"],10,5,16,11],"line-opacity":.85}});mapApi.addLayer({id:"nav-route",type:"line",source:"nav-route",layout:{"line-join":"round","line-cap":"round"},paint:{"line-color":"#4ab3ff","line-width":["interpolate",["linear"],["zoom"],10,3,16,7]}});}catch{}updateMapRoute();applyView();const a=dlg.querySelector(".wm-attr");if(a)a.innerHTML='© <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';});
    mapApi.on("error",()=>{});setTimeout(()=>{if(!mapReady){mapFailed=true;try{mapApi?.remove();}catch{}mapApi=null;}},12000);
  }catch{mapFailed=true;mapApi=null;}}
function emptyLine(){return{type:"FeatureCollection",features:[]};}
function updateMapRoute(){if(!mapReady||!mapApi)return;const src=mapApi.getSource?.("nav-route");if(!src)return;const s=subject();let coords=route?.coords?.slice()||[];if(dest){if(!coords.length&&s)coords=[toLonLat(s.x,s.y),[dest.lon,dest.lat]];}src.setData(dest&&coords.length>=2?{type:"FeatureCollection",features:[{type:"Feature",geometry:{type:"LineString",coordinates:coords},properties:{}}]}:emptyLine());}

// ---------------------------------------------------------------- canvas map (any world)
function drawCanvas(){
  const {w,h}=size(),dpr=Math.min(2,devicePixelRatio||1);if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
  const c=ctx2d;c.setTransform(dpr,0,0,dpr,0,0);c.fillStyle="#1d2420";c.fillRect(0,0,w,h);
  const P=(x,y)=>{const [lon,lat]=toLonLat(x,y);return project(lon,lat);};
  const mpp=156543.03/2**view.zoom*Math.cos(view.lat*DEG)/2; // metres per css px (512 tiles)
  // grid every 100 m
  const s=subject();if(s){const step=mpp*60>300?500:100;c.strokeStyle="#ffffff10";c.lineWidth=1;const [lx,ly]=toLocal(view.lon,view.lat),R=Math.max(w,h)*mpp;for(let g=Math.floor((lx-R)/step)*step;g<=lx+R;g+=step){const a=P(g,ly-R),b=P(g,ly+R);c.beginPath();c.moveTo(...a);c.lineTo(...b);c.stroke();}for(let g=Math.floor((ly-R)/step)*step;g<=ly+R;g+=step){const a=P(lx-R,g),b=P(lx+R,g);c.beginPath();c.moveTo(...a);c.lineTo(...b);c.stroke();}}
  const prisms=bridge()?.buildingCollisionSnapshot?.prisms||[];c.fillStyle="#4b5056";c.strokeStyle="#6a6f75";c.lineWidth=1;for(const pr of prisms){const pts=pr.points;if(!pts||pts.length<3)continue;c.beginPath();pts.forEach((q,i)=>{const [x,y]=P(q[0],q[1]);i?c.lineTo(x,y):c.moveTo(x,y);});c.closePath();c.fill();c.stroke();}
  const roads=globalThis.__streetLamps?.roads?.()||[];c.lineCap="round";c.lineJoin="round";for(const r of roads){const pts=r.pts;if(!pts||pts.length<2)continue;const minor=/path|track|foot|cycle|service/.test(String(r.cls||""));c.strokeStyle=minor?"#8d8f86":"#d6d6cf";c.lineWidth=Math.max(1.5,(minor?2.5:6)/mpp*.6);c.beginPath();pts.forEach((q,i)=>{const [x,y]=P(q[0],q[1]);i?c.lineTo(x,y):c.moveTo(x,y);});c.stroke();}
  const path=pathLocal();if(path&&s){const pts=[[s.x,s.y],...path];c.strokeStyle="#0b2235";c.lineWidth=9;c.beginPath();pts.forEach((q,i)=>{const [x,y]=P(q[0],q[1]);i?c.lineTo(x,y):c.moveTo(x,y);});c.stroke();c.strokeStyle="#4ab3ff";c.lineWidth=5;c.stroke();}
  if(!geo().real){c.fillStyle="#ffffff88";c.font="600 11px Inter,system-ui,sans-serif";c.textAlign="center";c.fillText("Trainingswelt – Adresssuche nur in der echten Welt (GPS)",w/2,72);c.textAlign="left";}
}
// markers (both renderers)
function drawMarkers(){const s=subject(),me=dlg.querySelector(".wm-me"),pin=dlg.querySelector(".wm-pin");
  if(s){const [lon,lat]=toLonLat(s.x,s.y),[x,y]=project(lon,lat);me.hidden=false;me.style.transform=`translate(${x.toFixed(1)}px,${y.toFixed(1)}px) rotate(${viewBearing().toFixed(1)}deg)`;}else me.hidden=true;
  if(dest){const [x,y]=project(dest.lon,dest.lat);pin.hidden=false;pin.style.transform=`translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;}else pin.hidden=true;}

function openMap(){if(open)return true;if(!inGame())return false;const d=ensureUi();if(!d)return false;open=true;follow=true;
  const s=subject();if(s){const [lon,lat]=toLonLat(s.x,s.y);view.lon=lon;view.lat=lat;}view.zoom=s?.mode==="jet"?12.5:s?.mode==="drone"&&s.z>120?14.5:16;
  try{d.show();}catch{d.setAttribute("open","");}d.dataset.renderer=geo().real&&!mapFailed?"gl":"canvas";if(geo().real)ensureGlMap();applyView();renderPanel();renderHint();updateMapRoute();
  if(document.pointerLockElement){globalThis.__arondightQuietUnlockUntil=performance.now()+1500;try{document.exitPointerLock();}catch{}}
  document.body.classList.add("world-map-open");const v=viewport();if(v)v.dataset.worldMapOpen="1";window.dispatchEvent(new CustomEvent("arondight:world-map",{detail:{open:true}}));return true;}
function close(){if(!open)return;open=false;pointers.clear();pinch=drag=null;suggestions=[];renderSuggestions();blurSearch();try{dlg.close();}catch{dlg.removeAttribute("open");}document.body.classList.remove("world-map-open");const v=viewport();if(v)v.dataset.worldMapOpen="0";
  if(document.body.classList.contains("desktop-input")&&!document.querySelector("dialog[open]"))try{globalThis.__arondightQuietUnlockUntil=performance.now()+600;viewport()?.requestPointerLock?.();}catch{}
  window.dispatchEvent(new CustomEvent("arondight:world-map",{detail:{open:false}}));}
function toggle(){return open?(close(),false):openMap();}

// ---------------------------------------------------------------- guidance while playing
function ensureGuide(){const v=viewport();if(!v)return;ensureStyle();if(!guideEl?.isConnected){guideEl=document.createElement("div");guideEl.id="navGuide";guideEl.hidden=true;guideEl.innerHTML="<i></i><span></span>";v.appendChild(guideEl);}if(!arEl?.isConnected){arEl=document.createElement("div");arEl.id="navAr";arEl.hidden=true;arEl.innerHTML="<i></i><small></small>";v.appendChild(arEl);}}
const proj=new THREE.Vector3();
function guide(now){
  ensureGuide();if(!guideEl||!arEl)return;const s=subject();
  if(!dest||!s||open||!inGame()){if(!guideEl.hidden)guideEl.hidden=true;if(!arEl.hidden)arEl.hidden=true;return;}
  const ahead=s.mode==="foot"?30:s.mode==="car"?70:s.mode==="jet"?900:Math.max(60,s.z*1.5),la=lookahead(s,ahead);if(!la){guideEl.hidden=arEl.hidden=true;return;}
  const [dx,dy]=[toLocal(dest.lon,dest.lat)[0]-s.x,toLocal(dest.lon,dest.lat)[1]-s.y],direct=Math.hypot(dx,dy),left=route?la.left:direct;
  // arrived
  if(direct<(s.mode==="foot"?18:s.mode==="car"?30:60)){toast(`ZIEL ERREICHT · ${dest.name}`);setDestination(null);return;}
  // off the route: ask for a new one (throttled)
  if(route&&la.off>(s.mode==="foot"?45:80))requestRoute();else if(!route&&geo().real&&now-routeAt>15000)requestRoute();
  const tx=la.p[0],ty=la.p[1],bearing=Math.atan2(tx-s.x,ty-s.y)/DEG,rel=((bearing-viewBearing()+540)%360)-180;
  guideEl.hidden=false;guideEl.querySelector("i").style.transform=`rotate(${rel.toFixed(0)}deg)`;const txt=`${fmtDist(left)} · ${dest.name}`;const sp=guideEl.querySelector("span");if(sp.textContent!==txt)sp.textContent=txt;
  // AR chevron: on the horizon where the route goes (eye height above the ground there), at the edge when out of view
  const c=cam(),v=viewport();if(!c||!v){arEl.hidden=true;return;}const W=v.clientWidth,H=v.clientHeight;
  const ground=(s.mode==="foot"?s.z-1.6:s.mode==="car"?s.z:0),z=s.mode==="foot"||s.mode==="car"?ground+1.6:s.z-Math.min(40,Math.max(3,(s.z-ground)*.4));
  proj.set(tx,ty,z).project(c);let x=(proj.x*.5+.5)*W,y=(-proj.y*.5+.5)*H;const behind=proj.z>1||Math.abs(rel)>Math.min(80,(c.fov||60)*(W/H)*.5+4);
  let rot=0;if(behind||x<14||x>W-14||y<70||y>H-60){const a=rel*DEG;x=W/2+Math.sin(a)*W*.42;y=clamp(H*.42-Math.cos(a)*H*.3,80,H-90);rot=rel;}
  arEl.hidden=false;arEl.style.transform=`translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;arEl.querySelector("i").style.transform=`rotate(${rot.toFixed(0)}deg)`;const sm=arEl.querySelector("small"),st=behind?"":fmtDist(left);if(sm.textContent!==st)sm.textContent=st;}
let toastEl=null,toastT=0;function toast(text){const v=viewport();if(!v)return;if(!toastEl?.isConnected){toastEl=document.createElement("div");toastEl.style.cssText="position:absolute;left:50%;top:32%;transform:translateX(-50%);z-index:60;padding:10px 18px;border-radius:14px;background:#0b0f14d8;border:1px solid #7fd3ff66;color:#e8f7ff;font:800 14px/1.2 Inter,system-ui,sans-serif;letter-spacing:.06em;pointer-events:none;transition:opacity .5s";v.appendChild(toastEl);}toastEl.textContent=text;toastEl.style.opacity="1";clearTimeout(toastT);toastT=setTimeout(()=>{if(toastEl)toastEl.style.opacity="0";},2600);}

// the minimap draws the route and the pin (called from drawMinimap with its projection)
function drawOnMinimap(c,projectLocal){const s=subject();if(!dest||!s)return;const path=pathLocal();if(!path)return;c.save();c.lineCap="round";c.lineJoin="round";c.strokeStyle="#4ab3ffcc";c.lineWidth=3;c.beginPath();const pts=[[s.x,s.y],...path];pts.forEach((q,i)=>{const [x,y]=projectLocal(q[0],q[1]);i?c.lineTo(x,y):c.moveTo(x,y);});c.stroke();
  const d=path[path.length-1],[px,py]=projectLocal(d[0],d[1]),W=c.canvas.width,H=c.canvas.height,cx=clamp(px,6,W-6),cy=clamp(py,6,H-6);c.fillStyle="#ff4b5c";c.strokeStyle="#000";c.lineWidth=1.2;c.beginPath();c.arc(cx,cy,4.5,0,Math.PI*2);c.fill();c.stroke();c.restore();}

// ---------------------------------------------------------------- pad (while the map is open)
let padPrev=[],viewHeld=0;
function padNow(){for(const p of navigator.getGamepads?.()||[])if(p?.connected)return p;return null;}
function padFrame(dt){const p=padNow();if(!p){padPrev=[];return;}const btn=i=>{const b=p.buttons?.[i];return Boolean(b?.pressed||Number(b?.value)>.5);},now=[];for(let i=0;i<17;i++)now[i]=btn(i);const edge=i=>now[i]&&!padPrev[i];padPrev=now;
  if(!open){// hold VIEW to open (tap VIEW stays the camera, pad_actions.mjs)
    if(now[8]&&inGame()&&!(globalThis.__arondightPadBlocked?.())){viewHeld+=dt;if(viewHeld>.42&&viewHeld<1e8){viewHeld=1e9;globalThis.__arondightSuppressViewTap=performance.now();openMap();}}else viewHeld=0;return;}
  viewHeld=now[8]?1e9:0;const input=dlg.querySelector("input");if(document.activeElement===input||dlg.contains(document.activeElement)&&document.activeElement?.closest?.(".wm-sugg")){if(edge(1)){input.blur();suggestions=[];renderSuggestions();}else if(edge(0))document.activeElement?.click?.();else if(edge(13))(document.activeElement.nextElementSibling||dlg.querySelector(".wm-sugg button"))?.focus?.();else if(edge(12))(document.activeElement.previousElementSibling||input)?.focus?.();return;}
  if(edge(1)||edge(8)){close();return;}
  const ax=Number(p.axes?.[0])||0,ay=Number(p.axes?.[1])||0,dz=v=>Math.abs(v)<.15?0:(v-Math.sign(v)*.15)/.85;const sx=dz(ax),sy=dz(ay);if(sx||sy){panPx(-sx*Math.abs(sx)*900*dt,-sy*Math.abs(sy)*900*dt);follow=false;}
  const lt=Number(p.buttons?.[6]?.value)||0,rt=Number(p.buttons?.[7]?.value)||0;if(rt>.1||lt>.1)zoomBy((rt-lt)*2.2*dt);
  if(edge(0)){const {w,h}=size();tapAt(w/2,h/2);}if(edge(2))setDestination(null);if(edge(3)){input.focus();}if(edge(15)||edge(14))zoomBy(edge(15)?1:-1);if(edge(11)){follow=true;centerOnMe();}}

function wrapPadBlock(){const f=globalThis.__arondightPadBlocked;if(typeof f==="function"&&!f.__worldMap){const g=()=>open||f();g.__worldMap=true;globalThis.__arondightPadBlocked=g;}}
function frame(now=performance.now()){requestAnimationFrame(frame);wrapPadBlock();const dt=Math.min(.1,(now-lastFrame)/1000||0);lastFrame=now;
  try{padFrame(dt);}catch{}
  if(open){if(!inGame()){close();return;}if(follow){const s=subject();if(s){const [lon,lat]=toLonLat(s.x,s.y);view.lon=lon;view.lat=lat;applyView();}}
    const glOk=mapReady&&mapApi&&!mapFailed;dlg.dataset.renderer=glOk?"gl":"canvas";canvas.style.display=glOk?"none":"block";if(!glOk)drawCanvas();drawMarkers();if(Math.floor(now/500)!==Math.floor((now-dt*1000)/500)){renderPanel();renderHint();updateMapRoute();}}
  else try{guide(now);}catch{}}

function onKey(e){if(e.__synthetic||e.metaKey||e.ctrlKey||e.altKey)return;const t=e.target;if(t instanceof Element&&t.closest("input,textarea,select,[contenteditable]"))return;
  if(e.code==="KeyM"&&!e.repeat){if(open){e.preventDefault();e.stopImmediatePropagation();close();return;}if(!inGame()||document.querySelector("dialog.phone-settings-dialog[open],#quitConfirmDialog,#resetVoteDialog"))return;e.preventDefault();e.stopImmediatePropagation();openMap();return;}
  if(open&&e.code==="Escape"){e.preventDefault();e.stopImmediatePropagation();close();return;}
  if(open&&e.code==="Slash"){e.preventDefault();dlg.querySelector("input")?.focus();return;}
  if(open)e.stopPropagation();}
export function installWorldMapFull(){if(installed||typeof window==="undefined")return;installed=true;
  try{const d=JSON.parse(localStorage.getItem(STORE)||"null");if(d&&Number.isFinite(+d.lon)&&Number.isFinite(+d.lat))dest={lon:+d.lon,lat:+d.lat,name:String(d.name||"Ziel"),sub:String(d.sub||"")};}catch{}
  addEventListener("keydown",onKey,true);addEventListener("arondight:world-reset",()=>{route=null;routeAt=-Infinity;});requestAnimationFrame(frame);
  globalThis.__arondightWorldMap={open:openMap,close,toggle,get isOpen(){return open;},setDestination,get destination(){return dest;},get route(){return route;},search,drawOnMinimap,version:WORLD_MAP_FULL_VERSION};}
installWorldMapFull();
