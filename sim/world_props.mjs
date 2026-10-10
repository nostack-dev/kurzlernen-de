// Loose things lying around the city — crates, oil drums, traffic cones, cinder blocks, wheelie
// bins — as real Box3D rigid bodies (true sizes, masses and inertias). They are what the gravity
// gun (gravity_gun.mjs) picks up and throws, bullets and blasts push them with their real impulse,
// cars shove them aside.
//
// Placement is anchored to the real world, not to the session: the map is cut into 120 m geo cells
// and each cell's props come from a hash of the cell, so two players in the same street see the
// same props in the same places. Cells around the player are kept (3×3); a new cell only ever comes
// in at the edge, 60 m+ away, and a cell leaves only once it is far behind.
//
// Multiplayer: whoever last touched a prop (grabbed, threw, shot it) owns it for a few seconds and
// streams its pose (geo position, rotation, velocity) at 12 Hz while it moves; the others put the
// body there with that velocity, so it flies on smoothly between packets and lands the same way.
import * as THREE from "three";
import {groundHeightAt} from "./terrain_craters.mjs";
import {VS_FX_EVENT} from "./lan_vs.mjs";

export const WORLD_PROPS_VERSION="geo-cell-props-v1";
const CELL_M=120,PROPS_PER_CELL=8,KEEP_RING=1,DROP_RING=2,SEND_HZ=12,OWN_MS=4000,SYNC_KIND="world-sync-prop";
const tmpM=new THREE.Matrix4(),tmpQ=new THREE.Quaternion(),tmpP=new THREE.Vector3(),one=new THREE.Vector3(1,1,1);

function prismHull(r,halfH,n=8){const v=[];for(const z of[-halfH,halfH])for(let i=0;i<n;i++){const a=(i+.5)/n*Math.PI*2;v.push(Math.cos(a)*r,Math.sin(a)*r,z);}return v;}
function coneHull(rb,rt,h,n=8){const zc=h/4,v=[];for(let i=0;i<n;i++){const a=(i+.5)/n*Math.PI*2;v.push(Math.cos(a)*rb,Math.sin(a)*rb,-zc,Math.cos(a)*rt,Math.sin(a)*rt,h-zc);}return v;}
// sizes in metres, masses in kg (empty where it applies), principal inertias about the centre of mass
export const PROP_TYPES=Object.freeze({
  crate:{half:[.25,.25,.25],mass:18,friction:.6,restitution:.15,weight:3},
  drum:{half:[.29,.29,.44],mass:20,hull:prismHull(.29,.44),inertia:[20*(3*.29*.29+.88*.88)/12,20*(3*.29*.29+.88*.88)/12,20*.29*.29/2],friction:.45,restitution:.25,weight:3},
  cone:{half:[.18,.18,.35],mass:3,hull:coneHull(.18,.03,.7),inertia:[3*(3*.18*.18/20+3*.7*.7/80),3*(3*.18*.18/20+3*.7*.7/80),.3*3*.18*.18],friction:.8,restitution:.2,weight:3,lift:.175},
  block:{half:[.195,.095,.095],mass:15,friction:.7,restitution:.05,weight:2},
  bin:{half:[.29,.37,.535],mass:14,friction:.55,restitution:.2,weight:1},
});
const TYPE_KEYS=Object.keys(PROP_TYPES),TYPE_BAG=TYPE_KEYS.flatMap(k=>Array(PROP_TYPES[k].weight).fill(k));

let installed=false,meshes=null,scene=null,lastCellsAt=-Infinity,lastSendAt=-Infinity;
const props=new Map(),cells=new Map();
const bridge=()=>globalThis.__arondightRealWorld||null;
const rigid=()=>globalThis.__arondightWorldRigidBodies||null;
const viewport=()=>document.getElementById("viewport");
function hash(str){let h=2166136261>>>0;for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}return h>>>0;}
function rand(seed,i){let x=(seed^Math.imul(i+1,0x9e3779b1))>>>0;x^=x>>>16;x=Math.imul(x,0x7feb352d)>>>0;x^=x>>>15;x=Math.imul(x,0x846ca68b)>>>0;x^=x>>>16;return(x>>>0)/4294967296;}

function buildMeshes(sc){
  const wood=new THREE.MeshStandardMaterial({color:0x9a6b3c,roughness:.85}),plank=new THREE.MeshStandardMaterial({color:0x6e4a26,roughness:.9});
  const drumMat=new THREE.MeshStandardMaterial({color:0xb5301f,roughness:.5,metalness:.55}),cone=new THREE.MeshStandardMaterial({color:0xff6a10,roughness:.6}),block=new THREE.MeshStandardMaterial({color:0x8d8f91,roughness:.95}),bin=new THREE.MeshStandardMaterial({color:0x2f6b3a,roughness:.7});
  const geo={crate:new THREE.BoxGeometry(.5,.5,.5),drum:new THREE.CylinderGeometry(.29,.29,.88,16).rotateX(Math.PI/2),cone:new THREE.CylinderGeometry(.03,.18,.7,12).rotateX(Math.PI/2).translate(0,0,.35-.175),block:new THREE.BoxGeometry(.39,.19,.19),bin:new THREE.BoxGeometry(.58,.74,1.07)};
  const mats={crate:wood,drum:drumMat,cone,block,bin},out={};
  for(const k of TYPE_KEYS){const m=new THREE.InstancedMesh(geo[k],mats[k],256);m.name=`LOOSE_PROPS_${k.toUpperCase()}`;m.count=0;m.castShadow=true;m.receiveShadow=true;m.frustumCulled=false;m.userData.flightFireIgnore=true;/* hits come from the Box3D bodies */sc.add(m);out[k]=m;}
  // crate edges / drum ribs as a second, darker layer would double draws; the wood tone carries it
  void plank;return out;}

// is the spot open ground (not inside / on top of a building, not on a car)?
function openGround(x,y){const R=rigid();const g=groundHeightAt(x,y);if(!R?.raycast)return g;const hit=R.raycast([x,y,g+40],[0,0,-1],60);if(hit&&hit.point[2]>g+.3)return null;return g;}

// geo frame on the real map (cells and sync in lon/lat); on the training level (no map) the local metres are the shared frame
function geoMode(){const b=bridge();return Boolean(b?.active&&Number.isFinite(b.originLon)&&Number.isFinite(b.originLat)&&typeof b.unprojectMeters==="function"&&typeof b.projectLngLat==="function");}
function toFrame(x,y){return geoMode()?bridge().unprojectMeters(x,y):[x,y];}
function fromFrame(a,b){return geoMode()?bridge().projectLngLat(a,b):[a,b];}
function cellKey(cx,cy){return`${geoMode()?"g":"l"}${cx}:${cy}`;}
function geoCell(lon,lat){if(!geoMode())return{cx:Math.floor(lon/CELL_M),cy:Math.floor(lat/CELL_M)};const m=111320,cy=Math.floor(lat*m/CELL_M),cx=Math.floor(lon*m*Math.cos(lat*Math.PI/180)/CELL_M);return{cx,cy};}
function cellToLocal(cx,cy,u,v,lat){if(!geoMode())return{x:(cx+u)*CELL_M,y:(cy+v)*CELL_M};const b=bridge(),m=111320,lonM=m*Math.cos(lat*Math.PI/180),lon=(cx+u)*CELL_M/lonM,la=(cy+v)*CELL_M/m;const p=b.projectLngLat(lon,la);return{x:p[0],y:p[1],lon,lat:la};}
function spawnCell(cx,cy,lat){const key=cellKey(cx,cy);if(cells.has(key))return;const seed=hash(`props:${key}`),ids=[];
  for(let i=0;i<PROPS_PER_CELL;i++){let placed=null;for(let t=0;t<6&&!placed;t++){const u=rand(seed,i*13+t*2),v=rand(seed,i*13+t*2+1),p=cellToLocal(cx,cy,u,v,lat),g=openGround(p.x,p.y);if(g!==null)placed={...p,g};}
    if(!placed)continue;const type=TYPE_BAG[Math.floor(rand(seed,i*13+100)*TYPE_BAG.length)],spec=PROP_TYPES[type],id=`prop-${key}-${i}`,yaw=rand(seed,i*13+101)*Math.PI*2;
    // clusters read better than a scatter: every second prop leans on the previous one
    const z=placed.g+(spec.lift??spec.half[2])+.02;
    if(!rigid()?.upsertBody?.({id,kind:"prop",position:[placed.x,placed.y,z],yaw,halfExtents:spec.half,massKg:spec.mass,hulls:spec.hull?[spec.hull]:null,inertia:spec.inertia||null,wheeled:false,friction:spec.friction,restitution:spec.restitution,linearDamping:.05,angularDamping:.15,sleep:true}))continue;
    props.set(id,{id,type,spec,cell:key,owner:"",ownedUntil:0,lastSent:null,pose:null,remoteAt:0});ids.push(id);}
  cells.set(key,ids);}
function dropCell(key){for(const id of cells.get(key)||[]){if(globalThis.__arondightGravityGun?.heldId===id)continue;rigid()?.removeBody?.(id);props.delete(id);}cells.delete(key);}
function maintainCells(now){const b=bridge(),w=globalThis.__arondightWalkMode;if(!b||!rigid()?.ready)return;if(now-lastCellsAt<700)return;lastCellsAt=now;
  const cam=b.presentedCamera?.()||b.threeCamera,px=w?.mode==="foot"?w.position.x:cam?.position.x,py=w?.mode==="foot"?w.position.y:cam?.position.y;if(!Number.isFinite(px)||!Number.isFinite(py))return;
  const[lon,lat]=toFrame(px,py),{cx,cy}=geoCell(lon,lat);
  for(let dx=-KEEP_RING;dx<=KEEP_RING;dx++)for(let dy=-KEEP_RING;dy<=KEEP_RING;dy++)spawnCell(cx+dx,cy+dy,lat);
  const mode=geoMode()?"g":"l";for(const key of[...cells.keys()]){const[x,y]=key.slice(1).split(":").map(Number);if(key[0]!==mode||Math.abs(x-cx)>DROP_RING||Math.abs(y-cy)>DROP_RING)dropCell(key);}}

function draw(){const R=rigid();if(!meshes||!R)return;const counts={};for(const k of TYPE_KEYS)counts[k]=0;
  for(const p of props.values()){const pose=R.pose?.(p.id,p.pose||undefined);if(!pose)continue;p.pose=pose;const m=meshes[p.type],i=counts[p.type]++;if(i>=m.instanceMatrix.count)continue;tmpP.set(pose.position[0],pose.position[1],pose.position[2]);tmpQ.set(pose.rotation[0],pose.rotation[1],pose.rotation[2],pose.rotation[3]);tmpM.compose(tmpP,tmpQ,one);m.setMatrixAt(i,tmpM);
    if(pose.position[2]<groundHeightAt(pose.position[0],pose.position[1])-8){R.setPose?.(p.id,{position:[pose.position[0],pose.position[1],groundHeightAt(pose.position[0],pose.position[1])+1]});}}
  for(const k of TYPE_KEYS){const m=meshes[k];if(m.count!==counts[k])m.count=counts[k];m.visible=counts[k]>0;m.instanceMatrix.needsUpdate=true;}}

// ---- multiplayer
const session=()=>{const s=bridge()?.vsSession;return s?.sendFx?s:s?.active?.sendFx?s.active:null;};
function selfId(){try{return String(bridge()?.vsSession?.getSelfId?.()||"");}catch{return"";}}
export function claimProp(id,ms=OWN_MS){const p=props.get(String(id||""));if(!p)return false;p.owner=selfId()||"local";p.ownedUntil=performance.now()+ms;return true;}
function stream(now){const s=session();if(!s||now-lastSendAt<1000/SEND_HZ)return;lastSendAt=now;const me=selfId()||"local";
  for(const p of props.values()){if(p.owner!==me||now>p.ownedUntil||!p.pose)continue;const q=p.pose,speed=Math.hypot(...q.velocity)+Math.hypot(...q.angularVelocity);if(speed<.05&&p.lastSent&&now-p.lastSent>400)continue;
    const geo=toFrame(q.position[0],q.position[1]);try{s.sendFx({type:"impact",id:`pr-${p.id}-${Math.round(now)}`.slice(-80),p:[q.position[0],q.position[1],q.position[2]],objectId:SYNC_KIND,kind:SYNC_KIND,pid:p.id,geo,z:q.position[2]-groundHeightAt(q.position[0],q.position[1]),r:q.rotation.map(v=>+v.toFixed(4)),v:q.velocity.map(v=>+v.toFixed(3)),w:q.angularVelocity.map(v=>+v.toFixed(3)),o:me});p.lastSent=now;}catch{}}}
function onFx(event){const d=event?.detail?.packet;if(!d||d.kind!==SYNC_KIND||typeof d.pid!=="string")return;const p=props.get(d.pid);if(!p||!Array.isArray(d.geo))return;const now=performance.now();
  if(p.owner===(selfId()||"local")&&now<p.ownedUntil&&String(d.o||"")<(selfId()||"local"))return; // both touched it: the lower id keeps it
  const m=fromFrame(d.geo[0],d.geo[1]),z=groundHeightAt(m[0],m[1])+Number(d.z||0);p.owner=String(d.o||"remote");p.ownedUntil=now+OWN_MS;p.remoteAt=now;
  rigid()?.setPose?.(p.id,{position:[m[0],m[1],z],rotation:d.r,velocity:Array.isArray(d.v)?d.v:[0,0,0],angularVelocity:Array.isArray(d.w)?d.w:[0,0,0]});}

function frame(now){requestAnimationFrame(frame);try{const b=bridge(),sc=b?.threeScene;if(!sc)return;if(sc!==scene){scene=sc;meshes=buildMeshes(sc);}if(globalThis.__arondightWorldOptions?.get?.("props")===false){if(props.size)for(const k of[...cells.keys()])dropCell(k);for(const k of TYPE_KEYS)if(meshes[k])meshes[k].visible=false;return;}maintainCells(now);draw();stream(now);const v=viewport();if(v&&now%1000<17){v.dataset.worldProps=String(props.size);v.dataset.worldPropCells=String(cells.size);}}catch(error){console.warn("world props",error);}}
// RESET: every prop back where the cell hash puts it (the cells come back on the next maintain tick)
function resetProps(){globalThis.__arondightGravityGun?.drop?.();for(const key of[...cells.keys()]){for(const id of cells.get(key)||[]){rigid()?.removeBody?.(id);props.delete(id);}cells.delete(key);}lastCellsAt=-Infinity;}
export function installWorldProps(){if(installed||typeof window==="undefined")return;installed=true;addEventListener(VS_FX_EVENT,onFx);addEventListener("arondight:world-reset",resetProps);requestAnimationFrame(frame);
  globalThis.__arondightWorldProps={version:WORLD_PROPS_VERSION,types:PROP_TYPES,get count(){return props.size;},has:id=>props.has(String(id||"")),claim:claimProp,list:()=>[...props.values()].map(p=>({id:p.id,type:p.type,position:p.pose?.position?[...p.pose.position]:null}))};}
installWorldProps();
