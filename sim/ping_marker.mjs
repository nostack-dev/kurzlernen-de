// PING: a small, neutral marker you put into the world to show your mates a direction or a place
// ("da lang", "hier treffen") — not a strike, nothing happens there. One per player: a new ping
// replaces your old one, pinging your own marker again (within 5 m) removes it, after 90 s it fades.
//   PC: middle mouse button or Z (at the crosshair / cursor)
//   Xbox: D-pad right (at the crosshair)
//   Touch: press and hold the screen for 0.6 s without moving (at your finger)
// It is a slim post with a diamond on top in the player's colour, drawn through walls, with the
// distance next to it; everybody in the session sees it (sent as a small fx packet).
import * as THREE from "three";
import {groundHeightAt} from "./terrain_craters.mjs";
import {VS_FX_EVENT} from "./lan_vs.mjs";

export const PING_MARKER_VERSION="ping-marker-v1";
const LIFE_MS=90000,REMOVE_R=5,HOLD_MS=600,HOLD_SLOP_PX=12;
const bridge=()=>globalThis.__arondightRealWorld||null,walk=()=>globalThis.__arondightWalkMode||null,viewport=()=>document.getElementById("viewport");
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const pings=new Map();let root=null,sceneRef=null,labels=null;
const rc=new THREE.Raycaster(),cam=new THREE.PerspectiveCamera(70,1,.05,3000),ndc=new THREE.Vector2(),fwd=new THREE.Vector3(),tmp=new THREE.Vector3();

function selfId(){try{return String(bridge()?.vsSession?.getSelfId?.()||"me");}catch{return"me";}}
function myColor(){try{const me=globalThis.__arondightVsMultiplayer?.scores?.()?.find?.(x=>x.self);if(me?.color)return new THREE.Color(me.color).getHex();}catch{}return 0xe8f4ff;}
function playing(){const b=document.body,menu=document.getElementById("gameMenu");return b.classList.contains("solo-flight")&&(!menu||menu.hidden)&&!document.querySelector("dialog[open]");}
// local ↔ shared coordinates (same convention as the air strike packets)
function localOffset(){const b=bridge(),o=b?.__vsRespawnLocalOffset;return !b?.active&&Array.isArray(o)&&o.length===2?[Number(o[0])||0,Number(o[1])||0]:[0,0];}
const canon=(x,y)=>{const o=localOffset();return[+(x+o[0]).toFixed(2),+(y+o[1]).toFixed(2)];};
const local=(x,y)=>{const o=localOffset();return[x-o[0],y-o[1]];};

function logicalPoint(clientX,clientY){const view=viewport(),r=view?.getBoundingClientRect();if(!view||!r)return null;const w=Math.max(1,view.clientWidth),h=Math.max(1,view.clientHeight),cx=Number.isFinite(clientX)?clientX:r.left+r.width/2,cy=Number.isFinite(clientY)?clientY:r.top+r.height/2,rot=view.dataset.soloOrientation==="css-landscape";return{x:clamp(rot?cy-r.top:cx-r.left,0,w),y:clamp(rot?r.right-cx:cy-r.top,0,h),w,h};}
function rayAt(clientX,clientY){const p=logicalPoint(clientX,clientY);if(!p)return null;ndc.set(p.x/p.w*2-1,-(p.y/p.h)*2+1);
  const w=walk();if(w?.mode==="foot"&&w.position&&!globalThis.__arondightVehicleDrive?.active&&!globalThis.__jetMode?.active){
    cam.fov=clamp(Number(viewport()?.dataset.walkCameraFovDeg)||Number(bridge()?.threeCamera?.fov)||78,40,120);cam.aspect=p.w/p.h;cam.updateProjectionMatrix();cam.position.set(w.position.x,w.position.y,Number(w.position.z)||1.68);cam.up.set(0,0,1);
    const cp=Math.cos(Number(w.pitch)||0);fwd.set(Math.sin(Number(w.yaw)||0)*cp,Math.cos(Number(w.yaw)||0)*cp,Math.sin(Number(w.pitch)||0));cam.lookAt(tmp.copy(cam.position).add(fwd));cam.updateMatrixWorld(true);rc.setFromCamera(ndc,cam);}
  else{const c=bridge()?.threeCamera;if(!c)return null;c.updateMatrixWorld(true);rc.setFromCamera(ndc,c);}
  return{o:rc.ray.origin.clone(),d:rc.ray.direction.clone()};}
function worldPointAt(clientX,clientY){const r=rayAt(clientX,clientY);if(!r)return null;const R=globalThis.__arondightWorldRigidBodies;let hit=null;
  try{hit=R?.raycast?.([r.o.x,r.o.y,r.o.z],[r.d.x,r.d.y,r.d.z],1500,{categoryBits:8n,maskBits:1n});}catch{}
  if(hit?.point)return new THREE.Vector3(hit.point[0],hit.point[1],hit.point[2]);
  // no collider hit (sky, far): march to the terrain
  for(let t=2;t<1500;t+=t<60?1:4){tmp.copy(r.o).addScaledVector(r.d,t);if(tmp.z<=groundHeightAt(tmp.x,tmp.y))return tmp.clone();}return null;}

function ensureScene(){const s=bridge()?.threeScene;if(!s)return false;if(s===sceneRef&&root?.parent===s)return true;sceneRef=s;root=new THREE.Group();root.name="PING_MARKERS";s.add(root);for(const p of pings.values())root.add(p.g);return true;}
function build(color){const g=new THREE.Group(),mat=(c,o)=>new THREE.MeshBasicMaterial({color:c,transparent:true,opacity:o,depthTest:false,depthWrite:false,toneMapped:false});
  const post=new THREE.Mesh(new THREE.CylinderGeometry(.05,.05,1,6).rotateX(Math.PI/2).translate(0,0,.5),mat(0xffffff,.55));
  const gem=new THREE.Mesh(new THREE.OctahedronGeometry(.45,0),mat(color,.95));gem.scale.set(1,1,1.5);
  const ring=new THREE.Mesh(new THREE.RingGeometry(.55,.75,24),mat(color,.7));
  for(const m of[post,gem,ring]){m.renderOrder=990;m.userData.flightFireIgnore=true;m.raycast=()=>{};g.add(m);}
  g.userData={post,gem,ring};return g;}
function ensureLabels(){if(labels?.isConnected)return labels;const v=viewport();if(!v)return null;labels=document.createElement("div");labels.id="pingLabels";v.appendChild(labels);
  const st=document.createElement("style");st.textContent="#pingLabels{position:absolute;inset:0;pointer-events:none;z-index:24}#pingLabels span{position:absolute;transform:translate(-50%,-140%);padding:1px 6px;border-radius:8px;background:#0b1118c0;color:#f2f8ff;font:800 10px/1.4 system-ui,sans-serif;letter-spacing:.04em;white-space:nowrap;border:1px solid var(--pc,#fff)}";document.head.appendChild(st);return labels;}

function setPing(owner,x,y,z,color,{send=true}={}){if(!ensureScene())return;let p=pings.get(owner);if(!p){p={g:build(color),label:null};pings.set(owner,p);root.add(p.g);}
  p.x=x;p.y=y;p.z=Number.isFinite(z)?z:groundHeightAt(x,y);p.at=performance.now();p.color=color;p.g.userData.gem.material.color.setHex(color);p.g.userData.ring.material.color.setHex(color);p.g.visible=true;
  if(send)sendFx({k:"set",p:[...canon(x,y),+p.z.toFixed(2)],c:color});ping("set");}
function clearPing(owner,{send=true}={}){const p=pings.get(owner);if(!p)return;p.g.parent?.remove(p.g);p.label?.remove();pings.delete(owner);if(send)sendFx({k:"clear"});ping("clear");}
function ping(kind){const v=viewport();if(v){v.dataset.pingLast=kind;v.dataset.pingCount=String(pings.size);}try{const a=globalThis.__oppUiBlip;if(kind==="set"&&typeof a==="function")a(false);}catch{}}
export function pingAt(clientX,clientY){if(!playing())return false;const pt=worldPointAt(clientX,clientY);if(!pt)return false;const me=selfId(),mine=pings.get(me);
  if(mine&&Math.hypot(mine.x-pt.x,mine.y-pt.y)<REMOVE_R){clearPing(me);return true;}setPing(me,pt.x,pt.y,pt.z,myColor());return true;}

function session(){return bridge()?.vsSession||null;}
function sendFx(extra){const s=session();if(!s?.sendFx)return;try{s.sendFx({type:"impact",objectId:"ping-marker",id:`ping-${Date.now().toString(36)}`,...extra});}catch{}}
function onFx(e){const pk=e?.detail?.packet,from=String(e?.detail?.peerId||"");if(pk?.objectId!=="ping-marker"||!from)return;if(pk.k==="clear"){clearPing(from,{send:false});return;}
  if(!Array.isArray(pk.p))return;const[x,y]=local(+pk.p[0]||0,+pk.p[1]||0);setPing(from,x,y,Number(pk.p[2]),Number.isFinite(+pk.c)?+pk.c:0xe8f4ff,{send:false});}

function frame(now=performance.now()){requestAnimationFrame(frame);if(!pings.size)return;const b=bridge(),c=b?.presentedCamera?.()||b?.threeCamera,v=viewport();if(!c||!v||!ensureScene())return;const L=ensureLabels();
  const rect=v.getBoundingClientRect(),w=v.clientWidth,h=v.clientHeight;
  for(const[owner,p]of[...pings]){const age=now-p.at;if(age>LIFE_MS){clearPing(owner,{send:false});continue;}
    const d=Math.hypot(c.position.x-p.x,c.position.y-p.y,c.position.z-p.z),s=clamp(d/22,1,40),fade=Math.min(1,(LIFE_MS-age)/4000),bob=Math.sin(now/300)*.15*s;
    const {post,gem,ring}=p.g.userData;post.scale.set(s,s,2.2*s);post.position.set(p.x,p.y,p.z);gem.scale.set(s,s,1.5*s);gem.position.set(p.x,p.y,p.z+2.6*s+bob);gem.rotation.z=now/700;ring.scale.setScalar(s*(1+.25*Math.sin(now/220)));ring.position.set(p.x,p.y,p.z+.05);
    for(const m of[post,gem,ring])m.material.opacity=(m===gem?.95:m===ring?.7:.55)*fade;
    if(L){if(!p.label){p.label=document.createElement("span");L.appendChild(p.label);}tmp.set(p.x,p.y,p.z+3.4*s).project(c);const on=tmp.z<1&&Math.abs(tmp.x)<1.1&&Math.abs(tmp.y)<1.1;p.label.hidden=!on;
      if(on){p.label.style.left=`${(tmp.x+1)/2*w}px`;p.label.style.top=`${(1-tmp.y)/2*h}px`;p.label.style.setProperty("--pc",`#${p.color.toString(16).padStart(6,"0")}`);const t=`${owner===selfId()?"📍 ":"📍 "}${Math.round(d)} m`;if(p.label.textContent!==t)p.label.textContent=t;p.label.style.opacity=String(fade);}}}
  void rect;}

// ---- input: PC (middle button / Z), pad (D-pad right is read by pad_actions via __arondightPing), touch (long press)
function onKey(e){if(e.code!=="KeyZ"||e.repeat||e.metaKey||e.ctrlKey||e.altKey||e.__synthetic)return;if(e.target instanceof Element&&e.target.closest("input,textarea,select,[contenteditable]"))return;if(!playing())return;e.preventDefault();pingAt();}
function onMouse(e){if(e.button!==1||!playing())return;e.preventDefault();e.stopPropagation();pingAt(document.pointerLockElement?undefined:e.clientX,document.pointerLockElement?undefined:e.clientY);}
let hold=null;
function onDown(e){if(e.pointerType==="mouse"||!playing())return;const t=e.target;if(t instanceof Element&&t.closest("button,input,select,textarea,a,label,dialog,[role=button],#footMove,#footLook,#soloLeft,#soloRight,#soloClearance,#mobileGameplayDock,#jetHud"))return;
  clearTimeout(hold?.timer);hold={id:e.pointerId,x:e.clientX,y:e.clientY,timer:setTimeout(()=>{if(hold&&hold.id===e.pointerId){const ok=pingAt(hold.x,hold.y);if(ok)try{navigator.vibrate?.(25);}catch{}hold=null;}},HOLD_MS)};}
function onMove(e){if(hold&&e.pointerId===hold.id&&Math.hypot(e.clientX-hold.x,e.clientY-hold.y)>HOLD_SLOP_PX){clearTimeout(hold.timer);hold=null;}}
function onUp(e){if(hold&&e.pointerId===hold.id){clearTimeout(hold.timer);hold=null;}}

export function installPingMarker(){if(globalThis.__arondightPing||typeof window==="undefined")return;globalThis.__arondightPing={version:PING_MARKER_VERSION,at:pingAt,clear:()=>clearPing(selfId()),get count(){return pings.size;}};
  addEventListener("keydown",onKey);addEventListener("mousedown",onMouse,{capture:true});addEventListener("auxclick",e=>{if(e.button===1)e.preventDefault();});
  addEventListener("pointerdown",onDown,{capture:true,passive:true});addEventListener("pointermove",onMove,{capture:true,passive:true});addEventListener("pointerup",onUp,{capture:true,passive:true});addEventListener("pointercancel",onUp,{capture:true,passive:true});
  addEventListener(VS_FX_EVENT,onFx);addEventListener("arondight:world-reset",()=>{for(const k of[...pings.keys()])clearPing(k,{send:false});});requestAnimationFrame(frame);}
installPingMarker();
