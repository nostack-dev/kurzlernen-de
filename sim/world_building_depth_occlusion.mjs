import * as THREE from "three";
import {NEON_DEBUG_PALETTE,fatLineMaterial,fatLineGeometry,fatLineSegments} from "./box3d_collider_debug.mjs";

const MAX_PRISMS=900;
let mesh=null,edges=null,halo=null,lastHash="",sceneRef=null;

function viewport(){return globalThis.document?.getElementById?.("viewport")||null;}
function finitePoint(point){return Array.isArray(point)&&point.length>=2&&Number.isFinite(Number(point[0]))&&Number.isFinite(Number(point[1]));}
function pushTri(out,a,b,c){out.push(a.x,a.y,a.z,b.x,b.y,b.z,c.x,c.y,c.z);}

export function buildBuildingDepthGeometry(prisms,{maxPrisms=MAX_PRISMS}={}){
  const positions=[];let used=0;
  for(const prism of Array.isArray(prisms)?prisms:[]){
    if(used>=maxPrisms)break;
    const raw=(prism?.points||[]).filter(finitePoint).map(point=>new THREE.Vector2(Number(point[0]),Number(point[1])));
    if(raw.length<3)continue;
    if(raw[0].distanceToSquared(raw.at(-1))<1e-10)raw.pop();
    if(raw.length<3)continue;
    const base=Number(prism.base)||0,top=Math.max(base+.05,Number(prism.top)||8),faces=THREE.ShapeUtils.triangulateShape(raw,[]);
    for(const face of faces){
      const a=raw[face[0]],b=raw[face[1]],c=raw[face[2]];
      pushTri(positions,new THREE.Vector3(a.x,a.y,top),new THREE.Vector3(b.x,b.y,top),new THREE.Vector3(c.x,c.y,top));
      pushTri(positions,new THREE.Vector3(c.x,c.y,base),new THREE.Vector3(b.x,b.y,base),new THREE.Vector3(a.x,a.y,base));
    }
    for(let i=0;i<raw.length;i++){
      const a=raw[i],b=raw[(i+1)%raw.length],ab=new THREE.Vector3(a.x,a.y,base),bb=new THREE.Vector3(b.x,b.y,base),at=new THREE.Vector3(a.x,a.y,top),bt=new THREE.Vector3(b.x,b.y,top);
      pushTri(positions,ab,bb,bt);pushTri(positions,ab,bt,at);
    }
    used++;
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));if(positions.length)geometry.computeBoundingSphere();geometry.userData.worldBuildingOccluderPrisms=used;return geometry;
}

// Outer outline edges of the prisms. Non-convex buildings are split into
// several prisms; edges shared by two prisms of the same building are
// interior seams and are skipped so roofs don't get diagonal lines.
function edgeKey(a,b){const ka=`${a.x.toFixed(2)},${a.y.toFixed(2)}`,kb=`${b.x.toFixed(2)},${b.y.toFixed(2)}`;return ka<kb?`${ka}|${kb}`:`${kb}|${ka}`;}
export function buildBuildingOutlineGeometry(prisms,{maxPrisms=MAX_PRISMS}={}){
  const rings=[],counts=new Map();let used=0;
  for(const prism of Array.isArray(prisms)?prisms:[]){
    if(used>=maxPrisms)break;const raw=(prism?.points||[]).filter(finitePoint).map(point=>new THREE.Vector2(Number(point[0]),Number(point[1])));
    if(raw.length<3)continue;if(raw[0].distanceToSquared(raw.at(-1))<1e-10)raw.pop();if(raw.length<3)continue;
    const base=Number(prism.base)||0,top=Math.max(base+.05,Number(prism.top)||8),building=String(prism.buildingKey||used);
    rings.push({raw,base,top,building});for(let i=0;i<raw.length;i++){const key=`${building}#${edgeKey(raw[i],raw[(i+1)%raw.length])}`;counts.set(key,(counts.get(key)||0)+1);}used++;
  }
  const positions=[],corners=new Set();
  for(const {raw,base,top,building} of rings){
    for(let i=0;i<raw.length;i++){
      const a=raw[i],b=raw[(i+1)%raw.length];if(counts.get(`${building}#${edgeKey(a,b)}`)>1)continue;
      positions.push(a.x,a.y,top,b.x,b.y,top,a.x,a.y,base,b.x,b.y,base);
      for(const p of[a,b]){const key=`${building}#${p.x.toFixed(2)},${p.y.toFixed(2)}`;if(corners.has(key))continue;corners.add(key);positions.push(p.x,p.y,base,p.x,p.y,top);}
    }
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));if(positions.length)geometry.computeBoundingSphere();return geometry;
}

// ---- Stylized solid buildings ----------------------------------------------
// The nearby Box3D collision prisms are rendered as real, opaque 3D buildings
// instead of an invisible depth-only occluder. MapLibre clips extrusions that
// come close to its camera (its near plane is far larger than ours), which
// made nearby buildings vanish or look see-through when flying or walking
// next to them. Three.js now owns everything within the collision radius and
// what you see is exactly what you collide with. Shading is baked into vertex
// colors (sun-facing walls brighter, darker plinth, light roofs), so the
// material is unlit MeshBasic: one draw call, no lights, cheap on phones.
// Neon-night palette: deep green solids that read as real volumes,
// outlined by neon-green edges (same Box3D debug-draw line material as everything).
export const STYLIZED_BUILDING_PALETTE=Object.freeze({
  walls:["#03160d","#04180e","#03140c"],
  roofs:["#05200f","#062212"],
});
const SUN_DIR_2D=(()=>{const x=-.55,y=-.83,l=Math.hypot(x,y);return[x/l,y/l];})();
const tmpColor=new THREE.Color(),wallColor=new THREE.Color(),roofColor=new THREE.Color();
function hashString(value){let h=2166136261;for(const ch of String(value||""))h=Math.imul(h^ch.charCodeAt(0),16777619);return h>>>0;}
export function buildStylizedBuildingGeometry(prisms,{maxPrisms=MAX_PRISMS}={}){
  const positions=[],colors=[];let used=0;
  const push=(x,y,z,c)=>{positions.push(x,y,z);colors.push(c.r,c.g,c.b);};
  for(const prism of Array.isArray(prisms)?prisms:[]){
    if(used>=maxPrisms)break;
    const raw=(prism?.points||[]).filter(finitePoint).map(point=>new THREE.Vector2(Number(point[0]),Number(point[1])));
    if(raw.length<3)continue;if(raw[0].distanceToSquared(raw.at(-1))<1e-10)raw.pop();if(raw.length<3)continue;
    if(THREE.ShapeUtils.isClockWise(raw))raw.reverse();
    const base=Number(prism.base)||0,top=Math.max(base+.05,Number(prism.top)||8),hash=hashString(prism.buildingKey||`${raw[0].x.toFixed(1)},${raw[0].y.toFixed(1)}`);
    wallColor.set(STYLIZED_BUILDING_PALETTE.walls[hash%STYLIZED_BUILDING_PALETTE.walls.length]);
    roofColor.set(STYLIZED_BUILDING_PALETTE.roofs[(hash>>>8)%STYLIZED_BUILDING_PALETTE.roofs.length]);
    // Nuked: leveled stumps are charred rubble, broken tops are scorched.
    if(prism.leveled){wallColor.set("#1c1a12");roofColor.set("#2a2414");}else if(prism.damaged)roofColor.set("#3a2a12");
    for(const face of THREE.ShapeUtils.triangulateShape(raw,[])){const a=raw[face[0]];let b=raw[face[1]],c=raw[face[2]];if((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x)<0)[b,c]=[c,b];push(a.x,a.y,top,roofColor);push(b.x,b.y,top,roofColor);push(c.x,c.y,top,roofColor);}
    const plinth=tmpColor.clone();
    for(let i=0;i<raw.length;i++){
      const a=raw[i],b=raw[(i+1)%raw.length],dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1,nx=dy/len,ny=-dx/len;
      const light=.9+.25*Math.max(0,-(nx*SUN_DIR_2D[0]+ny*SUN_DIR_2D[1]))+.06*Math.abs(nx);
      const upper=tmpColor.copy(wallColor).multiplyScalar(light),lower=plinth.copy(wallColor).multiplyScalar(light*.78);
      push(a.x,a.y,base,lower);push(b.x,b.y,base,lower);push(b.x,b.y,top,upper);
      push(a.x,a.y,base,lower);push(b.x,b.y,top,upper);push(a.x,a.y,top,upper);
    }
    used++;
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute("color",new THREE.Float32BufferAttribute(colors,3));
  if(positions.length)geometry.computeBoundingSphere();geometry.userData.worldBuildingOccluderPrisms=used;return geometry;
}

function ensureMesh(scene){
  if(mesh&&sceneRef===scene)return mesh;
  if(mesh?.parent)mesh.parent.remove(mesh);mesh?.geometry?.dispose?.();
  const material=new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.FrontSide,depthTest:true,depthWrite:true,transparent:false,toneMapped:false,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:2});
  mesh=new THREE.Mesh(new THREE.BufferGeometry(),material);mesh.name="WORLD_BUILDING_DEPTH_OCCLUDER";mesh.renderOrder=-10000;mesh.frustumCulled=true;mesh.userData.worldBuildingDepthOccluder=true;mesh.userData.worldStylizedBuildings=true;mesh.userData.flightFireIgnore=true;scene.add(mesh);
  // Buildings get the brightest strokes: a 2.4 px core plus a soft additive
  // 8 px halo (two draw calls for the whole city) for a real neon glow.
  for(const old of[edges,halo]){if(old?.parent)old.parent.remove(old);old?.geometry?.dispose?.();}
  const empty=fatLineGeometry([0,0,0,0,0,0]);
  halo=fatLineSegments(empty,fatLineMaterial(NEON_DEBUG_PALETTE.building,{width:8,opacity:.16,additive:true}));halo.name="WORLD_BUILDING_NEON_HALO";
  edges=fatLineSegments(empty,fatLineMaterial(NEON_DEBUG_PALETTE.building,{width:2.4}));edges.name="WORLD_BUILDING_NEON_EDGES";
  for(const lines of[halo,edges]){delete lines.userData.neonEdge;lines.userData.neonSkip=true;scene.add(lines);}
  sceneRef=scene;lastHash="";return mesh;
}

export function syncWorldBuildingDepthOcclusion(bridge=globalThis.__arondightRealWorld){
  const scene=bridge?.threeScene;if(!scene)return 0;const target=ensureMesh(scene);
  // The full map city (world_city_buildings.mjs) draws every building now;
  // this collision-prism copy would double-draw the nearest ones.
  if(scene.getObjectByName?.("WORLD_CITY_BUILDINGS")?.visible){target.visible=false;if(edges)edges.visible=false;if(halo)halo.visible=false;return Number(target.userData.worldBuildingDepthPrisms)||0;}
  const snapshot=bridge?.buildingCollisionSnapshot,prisms=Array.isArray(snapshot?.prisms)?snapshot.prisms:[],hash=String(snapshot?.hash||"");
  if(!bridge?.active||!prisms.length){target.visible=false;if(edges)edges.visible=false;if(halo)halo.visible=false;const view=viewport();if(view){view.dataset.worldBuildingDepthOccluders="0";view.dataset.worldBuildingOcclusion="inactive";}return 0;}
  if(hash!==lastHash){const geometry=buildStylizedBuildingGeometry(prisms),outline=fatLineGeometry(buildBuildingOutlineGeometry(prisms));edges.geometry.dispose?.();edges.geometry=outline;halo.geometry=outline;target.geometry.dispose?.();target.geometry=geometry;lastHash=hash;target.userData.worldBuildingDepthHash=hash;target.userData.worldBuildingDepthPrisms=geometry.userData.worldBuildingOccluderPrisms||0;}
  const count=Number(target.userData.worldBuildingDepthPrisms)||0;target.visible=count>0;if(edges)edges.visible=count>0;if(halo)halo.visible=count>0;const view=viewport();if(view){view.dataset.worldBuildingDepthOccluders=String(count);view.dataset.worldBuildingOcclusion=count?"depth-active":"inactive";view.dataset.worldBuildingStyle=count?"neon-solid-outlined-v1":"inactive";}return count;
}

export function buildingDepthOcclusionState(){return{mesh,hash:lastHash,scene:sceneRef};}
