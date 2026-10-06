import * as THREE from "three";
import "./neon_ui_theme.mjs";
import {neonLineMaterial,NEON_DEBUG_PALETTE} from "./box3d_collider_debug.mjs";

// Arcade neon line look for the whole world, built on the Box3D debug-draw
// line pipeline (box3d_collider_debug.mjs):
//   * every solid mesh keeps its own (darkened) color, tinted by its category,
//     and gets crisp depth-tested neon feature edges on top,
//   * transparent FX (fire, smoke, flashes) keep their own look,
//   * instanced crowds/traffic get the same darkened fill,
//   * textures are dropped, the ground gets a neon grid, the sky goes dark.
// Category colors make every object identifiable at a glance, Battlefield
// tactical-overlay style: you = green, drones = cyan, cars = amber,
// people = magenta, hostiles = red, projectiles = white-yellow.

export const NEON_STYLE_VERSION="box3d-debug-neon-lines-v1";
export const NEON_PALETTE=Object.freeze({
  airframe:NEON_DEBUG_PALETTE.airframe,
  self:0xb6ff3d,
  vehicle:0xffb020,
  person:0xff3df2,
  hostile:0xff2a4d,
  projectile:0xfff36b,
  wildlife:0xd8f7ff,
  track:0x19ff8c,
  world:0x19ff8c,
  ground:NEON_DEBUG_PALETTE.ground,
  background:0x020805,
});
const EDGE_THRESHOLD_DEG=28;
const MAX_EDGE_SOURCE_TRIANGLES=40000;
const SCAN_INTERVAL_MS=450;
const FRAME_BUDGET_MS=2.5;
const GRID_SIZE_M=640;
const GRID_STEP_M=8;

let installed=false,queue=[],lastScan=-Infinity,gridGroup=null,styledScene=null,converted=0;
const edgeCache=new WeakMap(),lineMaterials=new Map(),processedMaterials=new WeakSet();

function bridge(){return globalThis.__arondightRealWorld||null;}
function viewport(){return document.getElementById("viewport");}

function categoryOf(node){
  for(let n=node;n;n=n.parent){
    const u=n.userData||{};
    if(u.localHumanAvatar||u.walkWeaponPart||u.walkSmgPart||u.localDamageTarget==="player"||u.playerDriven)return "self";
    if(u.arondightAirframe||u.arondightVisualAirframe||u.arondightFpvCamera||u.localDamageTarget==="drone")return "airframe";
    if(u.wantedPoliceDrone||u.worldPopulationKind==="police-drone"||u.vsPeer||u.vsMultiplayerPeer||u.vsHumanAvatar||u.worldPopulationKind==="vs-player")return "hostile";
    if(u.directFireMissile||u.flightFireTracer||u.vsRemoteShot)return "projectile";
    if(u.worldPopulationKind==="car"||u.worldLifeKind==="car"||u.worldLifeKind==="bus"||u.gtaDrivableVehicle||u.worldCarDebris)return "vehicle";
    if(u.worldPopulationKind==="person"||u.worldLifeKind==="person"||u.worldRagdollPart||u.worldRagdollRoot)return "person";
    if(u.worldLifeKind==="bird")return "wildlife";
    if(u.trainingShowcase||(u.normal&&u.rightAxis))return "track";
  }
  return "world";
}
function skip(node){
  for(let n=node;n;n=n.parent){const u=n.userData||{};if(u.nukeWeaponPart||u.neonEdge||u.neonSkip||u.worldBuildingDepthOccluder||u.flightFireDecal||u.vsPeerHitProxy||u.vsCombatHitbox)return true;}
  return false;
}
function materialsOf(mesh){return(Array.isArray(mesh.material)?mesh.material:[mesh.material]).filter(Boolean);}
function isTransparentFx(material){return Boolean(material.transparent||material.opacity<1||(material.blending!==undefined&&material.blending!==THREE.NormalBlending));}
function lineMaterial(color){let material=lineMaterials.get(color);if(!material){material=neonLineMaterial(color);lineMaterials.set(color,material);}return material;}

// In-place shader patch so the original material object (which other modules
// still animate, swap or compare by identity) keeps working.
function chainProgram(material,key,inject){
  const previous=material.onBeforeCompile,previousKey=material.customProgramCacheKey;
  material.onBeforeCompile=function(shader,renderer){previous?.call(this,shader,renderer);if(!shader.fragmentShader.includes("#include <dithering_fragment>"))return;inject(shader);};
  material.customProgramCacheKey=function(){return `${previousKey?previousKey.call(this):""}|${key}`;};
  material.needsUpdate=true;
}
function darkFill(material,color){
  if(processedMaterials.has(material)||material.isShaderMaterial||material.colorWrite===false)return;processedMaterials.add(material);
  const tint=new THREE.Color(color).multiplyScalar(.06);material.userData.neonTint=tint;
  chainProgram(material,"neonFill",shader=>{shader.uniforms.neonTint={value:tint};shader.fragmentShader="uniform vec3 neonTint;\n"+shader.fragmentShader.replace("#include <dithering_fragment>","#include <dithering_fragment>\n\tgl_FragColor.rgb = gl_FragColor.rgb * 0.6 + neonTint;");});
  // Push fills back in depth so the edge lines drawn on their faces always win.
  material.polygonOffset=true;material.polygonOffsetFactor=1;material.polygonOffsetUnits=2;
  if(material.map)material.map=null;
}
function edgesFor(geometry){
  let edges=edgeCache.get(geometry);if(edges!==undefined)return edges;
  const triangles=(geometry.index?geometry.index.count:geometry.attributes?.position?.count||0)/3;
  edges=triangles>0&&triangles<=MAX_EDGE_SOURCE_TRIANGLES?new THREE.EdgesGeometry(geometry,EDGE_THRESHOLD_DEG):null;
  if(edges)edges.userData.neonSharedEdges=true;edgeCache.set(geometry,edges);return edges;
}
function attachEdges(mesh,color){
  let lines=mesh.children.find(child=>child.userData?.neonEdge);
  const edges=edgesFor(mesh.geometry);
  if(!edges){if(lines){mesh.remove(lines);}return;}
  if(!lines){lines=new THREE.LineSegments(edges,lineMaterial(color));lines.name="NEON_EDGES";lines.userData.neonEdge=true;lines.userData.flightFireIgnore=true;lines.raycast=()=>{};lines.renderOrder=mesh.renderOrder;lines.castShadow=false;lines.receiveShadow=false;mesh.add(lines);}
  else{lines.geometry=edges;lines.material=lineMaterial(color);}
  mesh.userData.neonEdgesFor=mesh.geometry;
}
function convert(mesh){
  if(!mesh.isMesh)return false;
  if(skip(mesh)){mesh.userData.neonStyled=NEON_STYLE_VERSION;mesh.userData.neonMaterial=mesh.material;return false;}
  const materials=materialsOf(mesh);if(!materials.length)return false;
  // Hit proxies and depth-only helpers are hidden through their material; an
  // edge child would make them visible, so leave them untouched.
  if(materials.some(material=>material.visible===false||material.colorWrite===false)){mesh.userData.neonStyled=NEON_STYLE_VERSION;mesh.userData.neonMaterial=mesh.material;return false;}
  const category=categoryOf(mesh),color=NEON_PALETTE[category]??NEON_PALETTE.world;
  const allFx=materials.every(isTransparentFx);
  // Instanced crowds/traffic can't carry per-instance edge children: they get
  // the same stylized fill. Transparent FX (fire, smoke) keep their own look.
  if(mesh.isInstancedMesh||mesh.isSkinnedMesh){for(const material of materials)if(!isTransparentFx(material))darkFill(material,color);}
  else if(allFx){}
  else{for(const material of materials)if(!isTransparentFx(material))darkFill(material,color);attachEdges(mesh,color);}
  mesh.userData.neonStyled=NEON_STYLE_VERSION;mesh.userData.neonMaterial=mesh.material;mesh.userData.neonCategory=category;converted++;return true;
}
function needsWork(mesh){return mesh.isMesh&&(mesh.userData.neonStyled!==NEON_STYLE_VERSION||mesh.userData.neonMaterial!==mesh.material||(mesh.userData.neonEdgesFor&&mesh.userData.neonEdgesFor!==mesh.geometry));}

function ensureGrid(scene){
  if(gridGroup?.parent===scene)return gridGroup;
  const positions=[],half=GRID_SIZE_M/2;
  for(let v=-half;v<=half;v+=GRID_STEP_M){positions.push(-half,v,0,half,v,0,v,-half,0,v,half,0);}
  const geometry=new THREE.BufferGeometry();geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
  const grid=new THREE.LineSegments(geometry,neonLineMaterial(NEON_PALETTE.ground,{opacity:.34}));grid.raycast=()=>{};grid.frustumCulled=false;
  gridGroup=new THREE.Group();gridGroup.name="NEON_GROUND_GRID";gridGroup.userData.neonSkip=true;gridGroup.userData.flightFireIgnore=true;gridGroup.add(grid);gridGroup.renderOrder=-5;scene.add(gridGroup);return gridGroup;
}
function followGrid(){
  const camera=bridge()?.threeCamera;if(!gridGroup||!camera)return;
  gridGroup.position.set(Math.round(camera.position.x/GRID_STEP_M)*GRID_STEP_M,Math.round(camera.position.y/GRID_STEP_M)*GRID_STEP_M,.03);
}
function styleScene(scene){
  if(styledScene===scene)return;styledScene=scene;
  scene.background=new THREE.Color(NEON_PALETTE.background);
  if(scene.fog)scene.fog.color=new THREE.Color(NEON_PALETTE.background);
}

function frame(now){
  const scene=bridge()?.threeScene;
  if(scene){
    styleScene(scene);ensureGrid(scene);followGrid();enforceMap(now);
    if(!queue.length&&now-lastScan>SCAN_INTERVAL_MS){lastScan=now;scene.traverse(node=>{if(needsWork(node))queue.push(node);});}
    const deadline=performance.now()+FRAME_BUDGET_MS;
    while(queue.length&&performance.now()<deadline){const mesh=queue.pop();if(mesh.parent||mesh===scene)convert(mesh);}
    const view=viewport();if(view){const value=String(converted);if(view.dataset.neonStyledMeshes!==value)view.dataset.neonStyledMeshes=value;}
  }
  requestAnimationFrame(frame);
}

export function installNeonLineStyle(){
  if(installed)return;installed=true;
  document.documentElement.classList.add("neon-line-style");
  const view=viewport();if(view)view.dataset.visualStyle=NEON_STYLE_VERSION;
  requestAnimationFrame(frame);
}
installNeonLineStyle();

// ---- MapLibre layer: dark tactical map with neon roads ---------------------
// Other modules (liveliness palette, traffic "opaque buildings") repaint the
// map once or periodically; the enforcer below re-applies the neon paint only
// where a value actually differs, so the result is stable and cheap.
const MAP_NEON={background:"#030a06",land:"#06100b",green:"#08180f",industry:"#0a120d",water:"#04131a",waterLine:"#0f7a6a",roadMajor:"#19ff8c",roadMid:"#11c46c",roadMinor:"#0b7a44",boundary:"#0f5e3a",buildingFlat:"#081a10"};
export const NEON_BUILDING_EXTRUSION_COLOR=["interpolate",["linear"],["coalesce",["to-number",["get","render_height"]],8],0,"#07140d",30,"#0a1c12",90,"#0e2418"];
export function neonMapPaint(layer){
  const source=String(layer?.["source-layer"]||"").toLowerCase(),id=String(layer?.id||"").toLowerCase(),out=[];
  if(layer.type==="background")out.push(["background-color",MAP_NEON.background]);
  else if(layer.type==="fill"&&source==="water")out.push(["fill-color",MAP_NEON.water],["fill-opacity",1]);
  else if(layer.type==="line"&&(source==="waterway"||source==="water"))out.push(["line-color",MAP_NEON.waterLine],["line-opacity",.9]);
  else if(layer.type==="fill"&&(source==="landcover"||source==="landuse")){const green=/park|wood|forest|grass|garden|pitch|meadow|farmland|scrub/.test(id),industry=/industrial|commercial|retail|parking/.test(id);out.push(["fill-color",green?MAP_NEON.green:industry?MAP_NEON.industry:MAP_NEON.land],["fill-opacity",1]);}
  else if(layer.type==="fill"&&source==="building")out.push(["fill-color",MAP_NEON.buildingFlat],["fill-opacity",1]);
  else if(layer.type==="line"&&source==="transportation"){const major=/motorway|trunk|primary/.test(id),mid=/secondary|tertiary/.test(id);out.push(["line-color",major?MAP_NEON.roadMajor:mid?MAP_NEON.roadMid:MAP_NEON.roadMinor],["line-opacity",major?1:.9]);}
  else if(layer.type==="line"&&source==="boundary")out.push(["line-color",MAP_NEON.boundary],["line-opacity",.7]);
  else if(layer.type==="fill-extrusion"&&(source==="building"||id.includes("building")))out.push(["fill-extrusion-color",NEON_BUILDING_EXTRUSION_COLOR],["fill-extrusion-opacity",1],["fill-extrusion-vertical-gradient",false]);
  return out;
}
export function applyNeonMapStyle(map){
  if(!map?.getStyle||!map?.setPaintProperty)return 0;let changed=0;
  let layers=[];try{layers=map.getStyle()?.layers||[];}catch{return 0;}
  for(const layer of layers){if(!layer?.id||!map.getLayer?.(layer.id))continue;for(const [property,value] of neonMapPaint(layer)){try{const current=map.getPaintProperty?.(layer.id,property);if(JSON.stringify(current)===JSON.stringify(value))continue;map.setPaintProperty(layer.id,property,value);changed++;}catch{}}}
  if(!map.__neonSkyApplied&&typeof map.setSky==="function"){try{map.setSky({"sky-color":"#020805","horizon-color":"#0a2a18","fog-color":"#030a06","sky-horizon-blend":.6,"horizon-fog-blend":.6,"fog-ground-blend":.8,"atmosphere-blend":0});map.__neonSkyApplied=true;}catch{}}
  const view=viewport();if(view&&changed)view.dataset.worldVisualPalette="neon-tactical-v1";
  return changed;
}
let lastMapStyle=-Infinity;
function enforceMap(now){
  if(now-lastMapStyle<1200)return;lastMapStyle=now;const b=bridge();if(!b?.active||!b.map)return;
  try{if(b.map.isStyleLoaded?.()===false)return;}catch{return;}
  applyNeonMapStyle(b.map);
}
