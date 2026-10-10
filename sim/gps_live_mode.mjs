// LIVE GPS: the game world follows you in real life. Jogging, cycling, driving — the phone's
// real-time GPS puts you (not a game vehicle) where you actually are in the real-map world, the
// way a navigation app follows you, and everyone in a multiplayer session sees you there.
//
//  * position: watchPosition (high accuracy) → local metres in the world's frame; a small
//    constant-velocity filter (accuracy-weighted) rejects jumps and fills the ~1 s between fixes,
//    so the view glides instead of stepping; after a long gap (screen off) it re-acquires cleanly.
//  * heading: GPS course while moving, the phone compass when standing (iOS asks once).
//  * view: EYE (first person, looks where you go unless you look around yourself), FOLLOW
//    (behind and above, navigation style) or MAP (top-down, heading up); a blue position puck with
//    the accuracy circle and your track line on the ground.
//  * HUD: activity (standing / walking / running / cycling / driving from speed), speed, pace for
//    runs, distance, time, accuracy. The screen stays awake while it runs.
//  * the game can't hurt you in this mode (no damage, no wanted level) — it mirrors real life.
//  * the world: started at your GPS position if it isn't live yet, re-anchored when you are far
//    (>40 km) from its origin; streaming follows you like any other mode.
import * as THREE from "three";
import {groundHeightAt} from "./terrain_craters.mjs";

export const GPS_LIVE_VERSION="gps-live-follow-v1";
const MAX_ACCURACY_M=65,MAX_SPEED_MPS=75,GAP_RESET_MS=12000,REANCHOR_KM=40,TRAIL_MAX=4000;
const CAMS=["eye","follow","map"],CAM_LABEL={eye:"AUGE",follow:"FOLGEN",map:"KARTE"};
const live={active:false,watchId:null,fix:null,lastFixAt:0,x:0,y:0,vx:0,vy:0,shown:null,heading:0,compass:null,accuracy:0,speed:0,speedAvg:0,distance:0,startedAt:0,cam:"eye",lastManualLook:-1e9,lastLookYaw:null,activity:"stand",trail:[],wake:null,error:""};
let installed=false,ui=null,puck=null,trail=null,trailGeo=null,trailN=0,baseCamera=null,camInstalled=false;
const $=id=>document.getElementById(id);
const bridge=()=>globalThis.__arondightRealWorld||null;
const walk=()=>globalThis.__arondightWalkMode||null;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const ground=(x,y)=>{try{return groundHeightAt(x,y);}catch{return 0;}};
function setData(k,v){const el=$("viewport");if(el)el.dataset[k]=String(v);}

// ------------------------------------------------------------------ geodesy (same as the world bridge)
const R=6378137;
// world frame when the real-map world is live; otherwise (training world, map can't load) a local
// frame anchored at the first fix, so the mode still mirrors your movement
let ownOrigin=null,worldTried=false;
function toLocal(lon,lat){const b=bridge();if(b?.active&&typeof b.projectLngLat==="function"&&Number.isFinite(b.originLon)&&kmFromOrigin(lon,lat)<REANCHOR_KM){if(ownOrigin){ownOrigin=null;live.fix=null;}return b.projectLngLat(lon,lat);}
  if(!ownOrigin)ownOrigin={lon,lat};return[(lon-ownOrigin.lon)*Math.PI/180*R*Math.cos(ownOrigin.lat*Math.PI/180),(lat-ownOrigin.lat)*Math.PI/180*R];}
async function ensureWorldAt(coords){const b=bridge();if(!b)return false;const lon=coords.longitude,lat=coords.latitude;
  if(b.active&&kmFromOrigin(lon,lat)<REANCHOR_KM)return true;if(b.loading)return false;
  try{if(b.active)b.deactivate();await b.activate({coords:{latitude:lat,longitude:lon,altitude:coords.altitude||0,accuracy:coords.accuracy||0}});return Boolean(b.active);}catch(e){live.error=String(e?.message||e);return false;}}

// ------------------------------------------------------------------ fixes → filtered track
function onFix(pos){const c=pos?.coords;if(!c||!Number.isFinite(c.latitude)||!Number.isFinite(c.longitude))return;live.accuracy=Number(c.accuracy)||0;live.error="";
  const b=bridge();if(b&&!b.loading&&!worldTried&&(!b.active||kmFromOrigin(c.longitude,c.latitude)>=REANCHOR_KM)){worldTried=true;ensureWorldAt(c);}if(b?.loading){live.error="";setData("gpsLive","loading-world");render();return;}
  if(live.accuracy>MAX_ACCURACY_M){setData("gpsLive","weak-fix");render();return;}
  const p=toLocal(c.longitude,c.latitude);if(!p)return;const now=performance.now(),dt=(now-live.lastFixAt)/1000;
  if(!live.fix||dt*1000>GAP_RESET_MS){live.x=p[0];live.y=p[1];live.vx=live.vy=0;live.shown=null;live.fix=c;live.lastFixAt=now;addTrail(p[0],p[1],true);render();return;}
  // predict, then correct with a gain that trusts precise fixes more
  const px=live.x+live.vx*dt,py=live.y+live.vy*dt,ex=p[0]-px,ey=p[1]-py,jump=Math.hypot(p[0]-live.x,p[1]-live.y)/Math.max(.2,dt);
  if(jump>MAX_SPEED_MPS&&live.accuracy>8){render();return;}
  const g=clamp(1-live.accuracy/(live.accuracy+12),.25,.85),gv=clamp(g*.6,.15,.6)/Math.max(.2,dt);
  const ox=live.x,oy=live.y;live.x=px+ex*g;live.y=py+ey*g;live.vx+=ex*gv;live.vy+=ey*gv;
  // the phone's own speed / course are better than differencing when it has them
  if(Number.isFinite(c.speed)&&c.speed>=0){const sp=Math.hypot(live.vx,live.vy);if(sp>.05){const k=c.speed/sp;live.vx=live.vx*.5+live.vx*k*.5;live.vy=live.vy*.5+live.vy*k*.5;}else if(c.speed<.3){live.vx*=.5;live.vy*=.5;}}
  live.speed=Math.hypot(live.vx,live.vy);if(live.speed>1.2){const course=Number.isFinite(c.heading)&&c.heading>=0&&(c.speed??0)>1?c.heading*Math.PI/180:Math.atan2(live.vx,live.vy);live.heading=course;}
  live.distance+=Math.min(Math.hypot(live.x-ox,live.y-oy),MAX_SPEED_MPS*dt);live.fix=c;live.lastFixAt=now;addTrail(live.x,live.y,false);render();}
function onFixError(e){live.error=e?.code===1?"GPS-Zugriff verweigert":e?.message||"GPS nicht verfügbar";render();}
function onOrientation(e){const h=Number.isFinite(e.webkitCompassHeading)?e.webkitCompassHeading:(e.absolute&&Number.isFinite(e.alpha)?(360-e.alpha)%360:null);if(h!==null)live.compass=h*Math.PI/180;}

// ------------------------------------------------------------------ on/off
export async function startGpsLive(){if(live.active)return true;if(!navigator.geolocation){live.error="Kein GPS in diesem Browser";render();return false;}
  live.active=true;live.fix=null;worldTried=false;ownOrigin=null;live.trail=[];trailN=0;live.distance=0;live.startedAt=performance.now();live.speedAvg=0;live.error="";globalThis.__arondightGpsLive=api;document.body.classList.add("gps-live");
  try{if(typeof DeviceOrientationEvent!=="undefined"&&typeof DeviceOrientationEvent.requestPermission==="function")await DeviceOrientationEvent.requestPermission().catch(()=>{});}catch{}
  addEventListener("deviceorientationabsolute",onOrientation,true);addEventListener("deviceorientation",onOrientation,true);
  try{live.wake=await navigator.wakeLock?.request?.("screen");}catch{}
  const w=walk();if(w?.mode!=="foot")w?.setMode?.("foot",{persist:false,reason:"gps-live"});if(globalThis.__arondightVehicleDrive?.active)globalThis.__arondightVehicleDrive.exit?.();
  live.watchId=navigator.geolocation.watchPosition(onFix,onFixError,{enableHighAccuracy:true,maximumAge:0,timeout:20000});
  setData("gpsLive","starting");render();return true;}
export function stopGpsLive(){if(!live.active)return;live.active=false;if(live.watchId!==null)navigator.geolocation.clearWatch(live.watchId);live.watchId=null;removeEventListener("deviceorientationabsolute",onOrientation,true);removeEventListener("deviceorientation",onOrientation,true);try{live.wake?.release?.();}catch{}live.wake=null;document.body.classList.remove("gps-live");if(puck)puck.visible=false;if(trail)trail.visible=false;setData("gpsLive","off");render();}
document.addEventListener("visibilitychange",async()=>{if(live.active&&!document.hidden){try{live.wake=await navigator.wakeLock?.request?.("screen");}catch{}}});

// ------------------------------------------------------------------ puck + track line
function ensureScene(){const s=bridge()?.threeScene;if(!s)return false;if(puck?.parent===s)return true;
  puck=new THREE.Group();puck.name="GPS_LIVE_PUCK";puck.userData.flightFireIgnore=true;
  const acc=new THREE.Mesh(new THREE.CircleGeometry(1,40),new THREE.MeshBasicMaterial({color:0x4285f4,transparent:true,opacity:.16,depthWrite:false}));acc.name="acc";
  const ring=new THREE.Mesh(new THREE.CircleGeometry(.62,28),new THREE.MeshBasicMaterial({color:0xffffff,depthWrite:false}));ring.position.z=.01;
  const dot=new THREE.Mesh(new THREE.CircleGeometry(.48,28),new THREE.MeshBasicMaterial({color:0x4285f4,depthWrite:false,toneMapped:false}));dot.position.z=.02;
  const wedge=new THREE.Mesh(new THREE.ConeGeometry(2.2,4.2,24,1,true,-.5,1),new THREE.MeshBasicMaterial({color:0x4285f4,transparent:true,opacity:.28,depthWrite:false,side:THREE.DoubleSide}));wedge.name="wedge";wedge.rotation.x=-Math.PI/2;wedge.position.set(0,2.1,.03);
  for(const m of[acc,ring,dot,wedge]){m.renderOrder=20;m.userData.flightFireIgnore=true;m.raycast=()=>{};puck.add(m);}s.add(puck);
  trailGeo=new THREE.BufferGeometry();trailGeo.setAttribute("position",new THREE.BufferAttribute(new Float32Array(TRAIL_MAX*3),3));trailGeo.setDrawRange(0,0);
  trail=new THREE.Line(trailGeo,new THREE.LineBasicMaterial({color:0x4285f4,transparent:true,opacity:.85,depthWrite:false}));trail.frustumCulled=false;trail.renderOrder=19;trail.userData.flightFireIgnore=true;trail.raycast=()=>{};s.add(trail);trailN=0;for(const p of live.trail)pushTrailPoint(p[0],p[1]);return true;}
function pushTrailPoint(x,y){if(!trailGeo)return;if(trailN>=TRAIL_MAX){const a=trailGeo.attributes.position.array;a.copyWithin(0,3);trailN=TRAIL_MAX-1;}const a=trailGeo.attributes.position.array;a[trailN*3]=x;a[trailN*3+1]=y;a[trailN*3+2]=ground(x,y)+.12;trailN++;trailGeo.setDrawRange(0,trailN);trailGeo.attributes.position.needsUpdate=true;trailGeo.computeBoundingSphere();}
function addTrail(x,y,force){const last=live.trail[live.trail.length-1];if(!force&&last&&Math.hypot(x-last[0],y-last[1])<2)return;live.trail.push([x,y]);if(live.trail.length>TRAIL_MAX)live.trail.shift();pushTrailPoint(x,y);}

// ------------------------------------------------------------------ cameras (FOLLOW / MAP; EYE is the walker's own)
// the bridge restores the shared camera after every frame: the smoothed view lives in its own vectors
const camPos=new THREE.Vector3(),camLook=new THREE.Vector3(),camUp=new THREE.Vector3(),camSmooth=new THREE.Vector3(),lookSmooth=new THREE.Vector3();let camInit=false;
const provider={isActive:()=>(live.active&&live.cam!=="eye"&&Boolean(live.shown))||Boolean(baseCamera?.isActive?.()),apply(args){if(!(live.active&&live.cam!=="eye"&&live.shown))return baseCamera?.apply?.(args);const cam=args.camera,p=live.shown,h=live.heading,fx=Math.sin(h),fy=Math.cos(h),gz=ground(p.x,p.y),fast=clamp(live.speedAvg/12,0,1);
  if(live.cam==="follow"){const back=9+10*fast,up=6+6*fast;camPos.set(p.x-fx*back,p.y-fy*back,gz+up);camLook.set(p.x+fx*(6+10*fast),p.y+fy*(6+10*fast),gz+1);camUp.set(0,0,1);cam.fov=62;}
  else{const hgt=90+160*fast;camPos.set(p.x-fx*.01,p.y-fy*.01,gz+hgt);camLook.set(p.x,p.y,gz);camUp.set(fx,fy,0);cam.fov=55;}
  {const gun=bridge()?.threeScene?.getObjectByName?.("WALK_PISTOL_3D");if(gun)gun.visible=false;} // no first-person gun floating in a third-person view
  if(!camInit){camSmooth.copy(camPos);lookSmooth.copy(camLook);camInit=true;}else{camSmooth.lerp(camPos,.18);lookSmooth.lerp(camLook,.25);}cam.position.copy(camSmooth);cam.up.copy(camUp);cam.lookAt(lookSmooth);if(cam.near>.3||cam.near<.2)cam.near=.25;cam.updateProjectionMatrix?.();cam.updateMatrixWorld?.(true);return{active:true,mode:"gps-live",origin:`gps-${live.cam}`,now:args.now};}};
function ensureCamera(){if(camInstalled)return;const b=bridge(),current=b?.presentationCameraProvider;if(!b||typeof b.attachPresentationCameraProvider!=="function"||!current)return;if($("viewport")?.dataset.playerCameraStack!=="walk+vehicle-v1"&&performance.now()<15000)return;baseCamera=current;b.attachPresentationCameraProvider(provider);camInstalled=true;}

// ------------------------------------------------------------------ per frame: glide to the filtered track
let last=performance.now();
function frame(){requestAnimationFrame(frame);const now=performance.now(),dt=Math.min(.1,(now-last)/1000);last=now;ensureCamera();if(!live.active||!live.fix){if(live.active)render(true);return;}
  const w=walk();if(!w||w.dead)return;if(w.mode!=="foot"){w.setMode?.("foot",{persist:false,reason:"gps-live"});return;}
  const ahead=Math.min(2,(now-live.lastFixAt)/1000),tx=live.x+live.vx*ahead,ty=live.y+live.vy*ahead;
  if(!live.shown||Math.hypot(tx-live.shown.x,ty-live.shown.y)>60)live.shown={x:tx,y:ty};else{const k=1-Math.exp(-dt*4);live.shown.x+=(tx-live.shown.x)*k;live.shown.y+=(ty-live.shown.y)*k;}
  live.speedAvg+=(live.speed-live.speedAvg)*Math.min(1,dt/4);live.activity=live.speedAvg<.5?"stand":live.speedAvg<2.3?"walk":live.speedAvg<5.2?"run":live.speedAvg<11?"bike":"car";
  if(live.speedAvg<1&&live.compass!==null)live.heading=live.compass;
  // EYE: look where you go — unless you looked around yourself in the last 3 s
  const yawNow=Number(w.yaw)||0;if(live.lastLookYaw!==null&&Math.abs(Math.atan2(Math.sin(yawNow-live.lastLookYaw),Math.cos(yawNow-live.lastLookYaw)))>.002)live.lastManualLook=now;
  let yaw=yawNow;if(now-live.lastManualLook>3000){const d=Math.atan2(Math.sin(live.heading-yawNow),Math.cos(live.heading-yawNow));yaw=yawNow+d*Math.min(1,dt*2.5);}
  w.setPose?.({x:live.shown.x,y:live.shown.y,yaw,pitch:Number(w.pitch)||0});live.lastLookYaw=yaw;
  if(globalThis.__arondightWantedSystem?.clear&&Math.floor(now/2000)!==Math.floor((now-dt*1000)/2000))globalThis.__arondightWantedSystem.clear("gps-live");
  if(ensureScene()){const gz=ground(live.shown.x,live.shown.y);puck.visible=live.cam!=="eye";puck.position.set(live.shown.x,live.shown.y,gz+.06);puck.rotation.z=-live.heading;const zoom=live.cam==="map"?3+4*clamp(live.speedAvg/12,0,1):1;for(const c of puck.children)if(c.name!=="acc")c.scale.setScalar(zoom);const acc=puck.getObjectByName("acc");acc.scale.setScalar(Math.max(1.5,live.accuracy)); /* in MAP the dot and arrow scale up to stay readable from height */trail.visible=true;}
  render();}

// ------------------------------------------------------------------ HUD + button
const ACT={stand:["🧍","STEHT"],walk:["🚶","GEHEN"],run:["🏃","LAUFEN"],bike:["🚴","RAD"],car:["🚗","FAHRT"]};
function fmtTime(ms){const s=Math.floor(ms/1000),h=Math.floor(s/3600),m=Math.floor(s/60)%60,ss=s%60;return`${h?h+":":""}${String(m).padStart(h?2:1,"0")}:${String(ss).padStart(2,"0")}`;}
function ensureUi(){if(ui?.root?.isConnected)return ui;const v=$("viewport");if(!v)return null;
  const st=document.createElement("style");st.dataset.gpsLive=GPS_LIVE_VERSION;st.textContent=`
#gpsLiveButton{position:fixed;z-index:100001;height:32px;padding:0 10px;border-radius:8px;border:1px solid #ffffff3a;background:#0b1220cc;color:#fff;font:800 11px/1 Inter,system-ui,sans-serif;letter-spacing:.06em;display:flex;align-items:center;gap:5px;cursor:pointer;touch-action:manipulation}
#gpsLiveButton.on{background:#1a56c9;border-color:#8fb4ff}
#gpsLiveHud{position:absolute;z-index:24;left:50%;top:max(56px,calc(env(safe-area-inset-top) + 50px));transform:translateX(-50%);display:none;align-items:center;gap:12px;padding:7px 12px;border-radius:12px;background:#0b1220e0;color:#fff;font:700 12px/1.15 Inter,system-ui,sans-serif;box-shadow:0 6px 18px #0007;white-space:nowrap}
body.gps-live #gpsLiveHud{display:flex}#gpsLiveHud b{font-size:17px;font-weight:900;font-variant-numeric:tabular-nums}#gpsLiveHud small{display:block;font-size:9px;opacity:.7;letter-spacing:.08em}#gpsLiveHud .act{font-size:22px}
#gpsLiveHud button{border:1px solid #ffffff44;background:#ffffff14;color:#fff;border-radius:8px;padding:6px 8px;font:800 10px/1 Inter,system-ui,sans-serif;letter-spacing:.06em}#gpsLiveHud .err{color:#ffb4a8;max-width:40vw;white-space:normal}
#gpsLiveHud .dot{width:8px;height:8px;border-radius:50%;background:#34c759;box-shadow:0 0 6px #34c759}#gpsLiveHud .dot.weak{background:#ffcc00;box-shadow:0 0 6px #ffcc00}#gpsLiveHud .dot.none{background:#ff3b30;box-shadow:none}
body.gps-live #footMove{visibility:hidden!important}`;document.head.appendChild(st);
  const btn=document.createElement("button");btn.id="gpsLiveButton";btn.type="button";btn.title="LIVE GPS: die Welt folgt deiner echten Position";btn.innerHTML="📍 <span>GPS</span>";document.body.appendChild(btn);
  btn.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();live.active?stopGpsLive():startGpsLive();});
  const root=document.createElement("div");root.id="gpsLiveHud";root.innerHTML='<span class="dot"></span><span class="act"></span><div><b data-k="speed">0</b><small data-k="unit">KM/H</small></div><div><b data-k="dist">0.00</b><small>KM</small></div><div><b data-k="time">0:00</b><small>ZEIT</small></div><div><b data-k="acc">–</b><small>GENAU</small></div><span class="err"></span><button type="button" data-k="cam">AUGE</button><button type="button" data-k="stop">STOP</button>';v.appendChild(root);
  root.querySelector('[data-k="cam"]').addEventListener("click",e=>{e.preventDefault();e.stopPropagation();live.cam=CAMS[(CAMS.indexOf(live.cam)+1)%CAMS.length];camInit=false;render(true);});
  root.querySelector('[data-k="stop"]').addEventListener("click",e=>{e.preventDefault();e.stopPropagation();stopGpsLive();});
  for(const el of[btn,root])el.addEventListener("pointerdown",e=>e.stopPropagation(),true);
  ui={root,btn};return ui;}
let lastRender=0;
function render(force=false){const now=performance.now();if(!force&&now-lastRender<250)return;lastRender=now;const u=ensureUi();if(!u)return;
  u.btn.classList.toggle("on",live.active);u.btn.querySelector("span").textContent=live.active?"LIVE":"GPS";
  const m=$("musicSwitch")?.getBoundingClientRect?.();if(m&&m.width){u.btn.style.top=`${Math.round(m.top)}px`;u.btn.style.right=`${Math.round(innerWidth-m.left+8)}px`;}else{u.btn.style.top="10px";u.btn.style.right="150px";}
  if(!live.active)return;const q=s=>u.root.querySelector(s),a=ACT[live.activity]||ACT.stand,running=live.activity==="run"||live.activity==="walk";
  q(".act").textContent=a[0];q(".act").title=a[1];
  if(running&&live.speedAvg>.8){const pace=1000/live.speedAvg/60;q('[data-k="speed"]').textContent=`${Math.floor(pace)}:${String(Math.round(pace%1*60)).padStart(2,"0")}`;q('[data-k="unit"]').textContent="MIN/KM";}
  else{q('[data-k="speed"]').textContent=String(Math.round(live.speedAvg*3.6));q('[data-k="unit"]').textContent="KM/H";}
  q('[data-k="dist"]').textContent=(live.distance/1000).toFixed(2);q('[data-k="time"]').textContent=fmtTime(now-live.startedAt);q('[data-k="acc"]').textContent=live.fix?`±${Math.round(live.accuracy)}m`:"–";q('[data-k="cam"]').textContent=CAM_LABEL[live.cam];
  const age=now-live.lastFixAt,dot=q(".dot");dot.className=`dot${!live.fix||age>8000?" none":live.accuracy>25||age>3000?" weak":""}`;
  q(".err").textContent=live.error||(!live.fix?"SUCHE GPS…":bridge()?.loading?"LADE WELT…":"");
  setData("gpsLive",live.fix?"tracking":"searching");setData("gpsLiveActivity",live.activity);}
const api={get active(){return live.active;},get speed(){return live.speedAvg;},get activity(){return live.activity;},get state(){return{...live,trail:undefined,wake:undefined};},start:startGpsLive,stop:stopGpsLive,setCamera(c){if(CAMS.includes(c)){live.cam=c;camInit=false;}},inject(lon,lat,{accuracy=5,speed=null,heading=null}={}){onFix({coords:{longitude:lon,latitude:lat,accuracy,speed,heading,altitude:0}});},version:GPS_LIVE_VERSION};
export function installGpsLive(){if(installed||typeof window==="undefined")return;installed=true;globalThis.__arondightGpsLiveApi=api;
  addEventListener("keydown",e=>{if(e.code==="KeyL"&&!e.repeat&&!e.metaKey&&!e.ctrlKey&&!e.altKey&&!(e.target instanceof HTMLInputElement)){live.active?stopGpsLive():startGpsLive();}});
  const boot=()=>{if(!ensureUi()){setTimeout(boot,400);return;}render(true);try{if(new URLSearchParams(location.search).get("gps")==="live")setTimeout(()=>startGpsLive(),1500);}catch{}};boot();setInterval(()=>render(true),1000);requestAnimationFrame(frame);}
installGpsLive();
