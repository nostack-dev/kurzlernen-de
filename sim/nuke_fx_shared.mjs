import * as THREE from "three";

// Shared resources for every nuke FX layer.
//
// Why this exists: the three nuke layers used to build ~270 fresh sphere/ring
// geometries, ~270 lit materials and four new PointLights on the impact frame.
// Adding lights to a three.js scene changes the light hash of every lit
// program, so the whole scene recompiled its shaders exactly when the bomb
// hit — the visible hitch. Everything here is allocation-free after the first
// detonation and adds no lights at all.

export const NUKE_FX_SHARED_VERSION="shared-geometry-no-lights-v2";

// Fire and smoke palette shared by every layer of the effect.
export const FX={
  white:0xffffff,
  core:0xfff3c4,
  yellow:0xffd25a,
  orange:0xff7a1a,
  red:0xe0380c,
  ember:0xff5a12,
  smokeLight:0x8a7a70,
  smoke:0x6a5d56,
  smokeDark:0x4e4744,
  shock:0xfff2d6,
  dust:0xb8875a,
  scorch:0x150c08,
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

// Unlit material: it never depends on scene lights, so a detonation can never
// trigger a light-hash shader recompile. FrontSide halves the fill cost of
// the large overlapping spheres compared with DoubleSide.
export function fxMaterial(color,{opacity=1,additive=true,depthTest=false,side=THREE.FrontSide}={}){
  return new THREE.MeshBasicMaterial({color,transparent:true,opacity,depthWrite:false,depthTest,blending:additive?THREE.AdditiveBlending:THREE.NormalBlending,side,toneMapped:false,fog:false});
}
// Smoke is lit by the scene's existing hemisphere + sun lights (Lambert is
// the cheapest lit model). No light is ever added, so programs stay cached.
export function smokeMaterial(color,{opacity=0,emissive=0x1a0d08,depthTest=false}={}){
  return new THREE.MeshLambertMaterial({color,emissive,transparent:true,opacity,depthWrite:false,depthTest,side:THREE.FrontSide,fog:false});
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
  for(const additive of[true,false])for(const depthTest of[true,false]){for(const material of[fxMaterial(0xffffff,{additive,depthTest}),fxMaterial(0xffffff,{additive,depthTest,side:THREE.DoubleSide}),smokeMaterial(0x808080,{opacity:.5,depthTest})]){const mesh=new THREE.Mesh(sphereGeometry(.01,6,4),material);mesh.frustumCulled=false;probe.add(mesh);}}
  scene.add(probe);
  // compile for the screen and for the bloom target the scene renders into while bloom is on
  const prev=renderer.getRenderTarget?.()??null,bloom=globalThis.__arondightNeonBloom?.target||null;
  try{if(bloom){renderer.setRenderTarget(bloom);renderer.compile(scene,camera);}renderer.setRenderTarget?.(null);renderer.compile(scene,camera);warmed=true;}catch{warmed=false;}finally{renderer.setRenderTarget?.(prev);scene.remove(probe);/* materials kept: disposing would release the compiled programs */}
  return warmed;
}
