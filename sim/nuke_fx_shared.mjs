import * as THREE from "three";

// Shared resources for every nuke FX layer.
//
// Why this exists: the three nuke layers used to build ~270 fresh sphere/ring
// geometries, ~270 lit materials and four new PointLights on the impact frame.
// Adding lights to a three.js scene changes the light hash of every lit
// program, so the whole scene recompiled its shaders exactly when the bomb
// hit — the visible hitch. Everything here is allocation-free after the first
// detonation and adds no lights at all.

export const NUKE_FX_SHARED_VERSION="neon-shared-geometry-no-lights-v1";

// Neon arcade palette for the explosion. Kept in one place so every layer of
// the effect reads as one consistent piece of line art.
export const NEON={
  white:0xffffff,
  core:0xfff6c8,
  yellow:0xffe14a,
  orange:0xff8a1f,
  red:0xff3b2f,
  magenta:0xff3df2,
  violet:0xa45bff,
  purple:0x6b3cff,
  cyan:0x2ef6ff,
  ice:0xc8fbff,
  scorch:0x2a0a3a,
};

const geometryCache=new Map();
function cacheKey(kind,args){return `${kind}:${args.map(value=>Number(value).toFixed(3)).join(",")}`;}
function shared(geometry){geometry.userData.nukeSharedGeometry=true;return geometry;}

export function sphereGeometry(radius,widthSegments=12,heightSegments=8){
  const key=cacheKey("sphere",[radius,widthSegments,heightSegments]);let geometry=geometryCache.get(key);
  if(!geometry){geometry=shared(new THREE.SphereGeometry(radius,widthSegments,heightSegments));geometryCache.set(key,geometry);}
  return geometry;
}
export function ringGeometry(inner,outer,segments=96){
  const key=cacheKey("ring",[inner,outer,segments]);let geometry=geometryCache.get(key);
  if(!geometry){geometry=shared(new THREE.RingGeometry(inner,outer,segments));geometryCache.set(key,geometry);}
  return geometry;
}
export function cylinderGeometry(top,bottom,height,radial=24,heightSegments=1,open=true){
  const key=cacheKey("cylinder",[top,bottom,height,radial,heightSegments,open?1:0]);let geometry=geometryCache.get(key);
  if(!geometry){geometry=shared(new THREE.CylinderGeometry(top,bottom,height,radial,heightSegments,open));geometryCache.set(key,geometry);}
  return geometry;
}
export function circleGeometry(radius,segments=48){
  const key=cacheKey("circle",[radius,segments]);let geometry=geometryCache.get(key);
  if(!geometry){geometry=shared(new THREE.CircleGeometry(radius,segments));geometryCache.set(key,geometry);}
  return geometry;
}
export function geometryCacheSize(){return geometryCache.size;}

// Line-art material: unlit, wireframe, no tone mapping. Unlit means the effect
// never depends on scene lights, so it can never trigger a light recompile.
export function neonMaterial(color,{opacity=1,additive=true,depthTest=false,wireframe=true}={}){
  return new THREE.MeshBasicMaterial({color,transparent:true,opacity,depthWrite:false,depthTest,blending:additive?THREE.AdditiveBlending:THREE.NormalBlending,side:THREE.DoubleSide,wireframe,toneMapped:false,fog:false});
}

// Disposes per-effect materials and any non-shared geometry. Shared geometry
// stays cached for the next detonation.
export function disposeEffect(root){
  root?.traverse?.(node=>{
    if(node.geometry&&!node.geometry.userData?.nukeSharedGeometry)node.geometry.dispose?.();
    const materials=Array.isArray(node.material)?node.material:[node.material];
    for(const material of materials)material?.dispose?.();
  });
}

// Writing a data-* attribute invalidates style on #viewport, whose subtree is
// styled through attribute selectors. Only touch the DOM when a value changes.
export function setData(element,key,value){
  if(!element)return;const next=String(value);if(element.dataset[key]!==next)element.dataset[key]=next;
}

// Frame-rate independent seconds since an effect was born.
export function ageSeconds(now,born){return Math.max(0,(now-born)/1000);}

// Warm the GPU program for the line material once, while nothing is
// happening, so the first detonation does not compile a shader either.
let warmed=false;
export function warmNukePrograms(){
  if(warmed)return true;const bridge=globalThis.__arondightRealWorld,renderer=bridge?.threeRenderer||bridge?.renderer,scene=bridge?.threeScene,camera=bridge?.threeCamera;
  if(!renderer?.compile||!scene||!camera)return false;
  const probe=new THREE.Group();probe.name="NUKE_PROGRAM_WARMUP";
  for(const additive of[true,false])for(const depthTest of[true,false]){const mesh=new THREE.Mesh(sphereGeometry(.01,6,4),neonMaterial(0xffffff,{additive,depthTest}));mesh.frustumCulled=false;probe.add(mesh);}
  scene.add(probe);
  try{renderer.compile(scene,camera);warmed=true;}catch{warmed=false;}
  finally{scene.remove(probe);probe.traverse(node=>node.material?.dispose?.());}
  return warmed;
}
