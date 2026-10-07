import * as THREE from "three";
import {buildingFootprintsFromFeatures,buildingFootprintHash} from "./world_building_collisions.mjs";
import {buildingDamage,destructionRevision,onDestruction} from "./world_destruction_state.mjs";
import {NEON_DEBUG_PALETTE,fatLineMaterial,fatLineGeometry,fatLineSegments} from "./box3d_collider_debug.mjs";

// The real city from the world map, drawn in the neon look.
// Every building footprint of the loaded map tiles within VISUAL_RADIUS_M is
// rendered as an opaque solid (baked sun shading) with neon outlines — the
// same real geometry (footprint, holes, height, min height) MapLibre would
// extrude, but owned by three.js so it never clips and never blinks in.
// Collision is separate (the nearest buildings, world_building_collisions);
// destruction applies to both through the shared damage state.
//
// Rebuilds are incremental: geometry for a new footprint set is assembled
// over several frames (time-sliced) and swapped in once complete, so moving
// through the city never stalls a frame and nothing pops in piecemeal.

export const CITY_BUILDINGS_VERSION="world-map-neon-city-v1";
const VISUAL_RADIUS_M=900,LINE_RADIUS_M=600,FAT_RADIUS_M=180,MAX_FOOTPRINTS=2600,MAX_VERTICES=96;
const RESYNC_MOVE_M=140,RESYNC_MS=2500,SLICE_MS=4;
const WALLS=["#03160d","#04180e","#03140c"],ROOFS=["#05200f","#062212"],SUN=(()=>{const x=-.55,y=-.83,l=Math.hypot(x,y);return[x/l,y/l];})();

let installed=false,group=null,solid=null,edges=null,thinEdges=null,sceneRef=null,lastCenter=[Infinity,Infinity],lastSyncAt=-Infinity,currentHash="",building=null,lastFeatureCount=-1;
const viewport=()=>document.getElementById("viewport");
const bridge=()=>globalThis.__arondightRealWorld||null;
function setData(key,value){const v=viewport();if(v){const s=String(value);if(v.dataset[key]!==s)v.dataset[key]=s;}}
function hash(value){let h=2166136261;for(const ch of String(value||""))h=Math.imul(h^ch.charCodeAt(0),16777619);return h>>>0;}

function ensureMeshes(scene){
  if(group?.parent===scene)return;
  if(group?.parent)group.parent.remove(group);
  group=new THREE.Group();group.name="WORLD_CITY_BUILDINGS";
  solid=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshBasicMaterial({vertexColors:true,toneMapped:false,fog:false,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:2}));solid.name="WORLD_CITY_SOLIDS";
  const empty=fatLineGeometry([0,0,0,0,0,0]);
  edges=fatLineSegments(empty,fatLineMaterial(NEON_DEBUG_PALETTE.building,{width:2}));edges.name="WORLD_CITY_EDGES";
  // Far outlines: native 1 px lines (nearly free on every GPU); only the
  // close buildings get the wide fat-line quads, which cost fill rate.
  thinEdges=new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:NEON_DEBUG_PALETTE.building,toneMapped:false,fog:false,transparent:true,opacity:.85}));thinEdges.name="WORLD_CITY_EDGES_FAR";thinEdges.frustumCulled=false;
  for(const node of[group,solid,edges,thinEdges]){node.userData.neonSkip=true;node.userData.flightFireIgnore=true;node.userData.worldCityBuildings=true;}
  delete edges.userData.neonEdge;
  group.add(solid,edges,thinEdges);scene.add(group);sceneRef=scene;currentHash="";
}

// Time-sliced geometry builder.
function* buildSteps(footprints,center){
  const pos=[],col=[],lines=[],thin=[],c=new THREE.Color(),wall=new THREE.Color(),roof=new THREE.Color(),plinth=new THREE.Color();
  const push=(x,y,z,k)=>{pos.push(x,y,z);col.push(k.r,k.g,k.b);};
  let i=0;
  for(const fp of footprints){
    const d=buildingDamage(fp.key),base=Number(fp.base)||0,fullTop=Math.max(base+.5,Number(fp.top)||8),top=d?Math.max(base+.3,Math.min(fullTop,d.top)):fullTop,h=hash(fp.key);
    wall.set(d?.leveled?"#1c1a12":WALLS[h%WALLS.length]);roof.set(d?.leveled?"#2a2414":d?"#3a2a12":ROOFS[(h>>>8)%ROOFS.length]);
    const outer=(fp.outer||[]).map(p=>new THREE.Vector2(+p[0],+p[1])),holes=(fp.holes||[]).map(r=>r.map(p=>new THREE.Vector2(+p[0],+p[1])));
    if(outer.length<3)continue;const dist=Math.hypot(outer[0].x-center[0],outer[0].y-center[1]),near=dist<FAT_RADIUS_M,mid=!near&&dist<LINE_RADIUS_M;if(outer[0].distanceToSquared(outer.at(-1))<1e-10)outer.pop();for(const r of holes)if(r.length&&r[0].distanceToSquared(r.at(-1))<1e-10)r.pop();
    if(THREE.ShapeUtils.isClockWise(outer))outer.reverse();for(const r of holes)if(!THREE.ShapeUtils.isClockWise(r))r.reverse();
    const all=[...outer,...holes.flat()];
    for(const f of THREE.ShapeUtils.triangulateShape(outer,holes)){const a=all[f[0]];let b=all[f[1]],cc=all[f[2]];if((b.x-a.x)*(cc.y-a.y)-(b.y-a.y)*(cc.x-a.x)<0)[b,cc]=[cc,b];push(a.x,a.y,top,roof);push(b.x,b.y,top,roof);push(cc.x,cc.y,top,roof);}
    for(const ring of[outer,...holes]){
      for(let k=0;k<ring.length;k++){const a=ring[k],b=ring[(k+1)%ring.length],dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1,nx=dy/len,ny=-dx/len,light=.9+.25*Math.max(0,-(nx*SUN[0]+ny*SUN[1]));
        c.copy(wall).multiplyScalar(light);plinth.copy(wall).multiplyScalar(light*.8);
        push(a.x,a.y,base,plinth);push(b.x,b.y,base,plinth);push(b.x,b.y,top,c);push(a.x,a.y,base,plinth);push(b.x,b.y,top,c);push(a.x,a.y,top,c);
        // Roof outline + corner verticals (ground edges are hidden by the
        // ground anyway); far buildings are silhouettes only.
        if(near){lines.push(a.x,a.y,top,b.x,b.y,top);const p=ring[(k+ring.length-1)%ring.length],ex=a.x-p.x,ey=a.y-p.y,el=Math.hypot(ex,ey)||1;if(Math.abs((ex*dx+ey*dy)/(el*len))<.94)lines.push(a.x,a.y,base,a.x,a.y,top);}
        else if(mid)thin.push(a.x,a.y,top,b.x,b.y,top);}
    }
    if(++i%40===0)yield;
  }
  return{pos,col,lines,thin};
}
let lastFootprints=[];
function startBuild(footprints,key){
  const steps=buildSteps(footprints,lastCenter);building={steps,key,count:footprints.length};lastFootprints=footprints;
}
globalThis.__arondightCityBuildings={footprints:()=>lastFootprints,version:CITY_BUILDINGS_VERSION};
function pumpBuild(){
  if(!building)return;const until=performance.now()+SLICE_MS;let r;
  while(performance.now()<until){r=building.steps.next();if(r.done)break;}
  if(!r?.done)return;
  const{pos,col,lines,thin}=r.value,geometry=new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));geometry.setAttribute("color",new THREE.Float32BufferAttribute(col,3));if(pos.length)geometry.computeBoundingSphere();
  solid.geometry.dispose();solid.geometry=geometry;
  const outline=fatLineGeometry(lines.length?lines:[0,0,0,0,0,0]);edges.geometry.dispose?.();edges.geometry=outline;
  const far=new THREE.BufferGeometry();far.setAttribute("position",new THREE.Float32BufferAttribute(thin,3));thinEdges.geometry.dispose();thinEdges.geometry=far;
  currentHash=building.key;setData("worldCityBuildings",building.count);setData("worldCityBuildingsVersion",CITY_BUILDINGS_VERSION);building=null;
}

function features(b){
  if(!b?.map||!b.buildingSourceId)return[];
  try{const list=b.map.querySourceFeatures?.(b.buildingSourceId,{sourceLayer:"building"});if(Array.isArray(list))return list;}catch{}return[];
}
function sync(now){
  const b=bridge();if(!b?.active||!b.threeScene||!Number.isFinite(b.originLon)){if(group)group.visible=false;return;}
  ensureMeshes(b.threeScene);group.visible=true;
  const air=b.airframeFor?.(b.threeScene),walk=globalThis.__arondightWalkMode,p=walk?.mode==="foot"&&walk.position?walk.position:air?.position;if(!p)return;
  const moved=Math.hypot(p.x-lastCenter[0],p.y-lastCenter[1]);
  if(building||(moved<RESYNC_MOVE_M&&now-lastSyncAt<RESYNC_MS))return;
  const list=features(b);if(!list.length)return;
  if(moved<RESYNC_MOVE_M&&list.length===lastFeatureCount&&currentHash.endsWith(`#d${destructionRevision()}`))return;
  lastSyncAt=now;lastFeatureCount=list.length;lastCenter=[p.x,p.y];
  const project=(lon,lat)=>b.projectLngLat(lon,lat);
  const footprints=buildingFootprintsFromFeatures(list,{project,center:[p.x,p.y],radiusM:VISUAL_RADIUS_M,maxFootprints:MAX_FOOTPRINTS,maxVertices:MAX_VERTICES});
  const key=`${buildingFootprintHash(footprints)}#d${destructionRevision()}`;if(key===currentHash)return;
  startBuild(footprints,key);
}
function frame(now){try{sync(now);pumpBuild();}catch(error){console.warn("city buildings",error);building=null;}requestAnimationFrame(frame);}
export function installCityBuildings(){
  if(installed)return;installed=true;
  onDestruction(()=>{lastSyncAt=-Infinity;lastFeatureCount=-1;currentHash="";});
  requestAnimationFrame(frame);
}
installCityBuildings();
