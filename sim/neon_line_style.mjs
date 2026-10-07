import * as THREE from "three";
import "./neon_ui_theme.mjs";
import "./emp_button_layout.mjs";
import {groundHeightAt,onTerrainChange} from "./terrain_craters.mjs";
import {patchShockMaterial} from "./nuke_shock_field.mjs";
import {neonLineMaterial,NEON_DEBUG_PALETTE,fatLineMaterial,fatLineGeometry,fatLineSegments,syncFatLineResolution} from "./box3d_collider_debug.mjs";

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

export const NEON_STYLE_VERSION="box3d-debug-neon-lines-v2";
// One green (sampled from the reference screenshot: #00ff9c). Only hostiles
// get red so threats stay identifiable; everything else is uniform.
export const NEON_PALETTE=Object.freeze({
  airframe:0x00ff9c,
  self:0x00ff9c,
  vehicle:0x00ff9c,
  person:0x00ff9c,
  hostile:0xff2a4d,
  projectile:0xeafff4,
  wildlife:0x00ff9c,
  track:0x00ff9c,
  world:0x00ff9c,
  ground:NEON_DEBUG_PALETTE.ground,
  background:0x020805,
});
const EDGE_THRESHOLD_DEG=28;
const MAX_EDGE_SOURCE_TRIANGLES=40000;
const SCAN_INTERVAL_MS=250;
const FRAME_BUDGET_MS=2.5;
const GRID_SIZE_M=640;
const GRID_STEP_M=8;

let lastCull=-Infinity,cullStats={roots:0,culled:0,edgesHidden:0},installed=false,queue=[],lastScan=-Infinity,gridGroup=null,styledScene=null,converted=0;
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
  for(let n=node;n;n=n.parent){const u=n.userData||{};if(u.nukeWeaponPart||u.neonEdge||u.neonSkip||u.worldBuildingDepthOccluder||u.vsPeerHitProxy||u.vsCombatHitbox)return true;}
  return false;
}
function materialsOf(mesh){return(Array.isArray(mesh.material)?mesh.material:[mesh.material]).filter(Boolean);}
function isTransparentFx(material){return Boolean(material.transparent||material.opacity<1||(material.blending!==undefined&&material.blending!==THREE.NormalBlending));}

// In-place shader patch so the original material object (which other modules
// still animate, swap or compare by identity) keeps working.
function chainProgram(material,key,inject){
  const previous=material.onBeforeCompile,previousKey=material.customProgramCacheKey;
  material.onBeforeCompile=function(shader,renderer){previous?.call(this,shader,renderer);if(!shader.fragmentShader.includes("#include <dithering_fragment>"))return;inject(shader);};
  material.customProgramCacheKey=function(){return `${previousKey?previousKey.call(this):""}|${key}`;};
  material.needsUpdate=true;
}
const TEXTURE_SLOTS=["map","emissiveMap","aoMap","lightMap","bumpMap","normalMap","displacementMap","roughnessMap","metalnessMap","specularMap","envMap","gradientMap","matcap","clearcoatMap","sheenColorMap"];
// No textures anywhere: the look is flat color + neon edges only.
function stripTextures(material){let changed=false;for(const slot of TEXTURE_SLOTS)if(material[slot]){material[slot]=null;changed=true;}if(material.vertexColors&&material.userData?.neonKeepVertexColors!==true){}if(changed)material.needsUpdate=true;return changed;}
// The drone is drawn flat (no lighting at all): a clean dark silhouette with
// neon edges, exactly like the reference look. Other objects keep a darkened
// version of their own shading so the city stays readable.
// Raw output value (the flat path returns before colorspace conversion, so
// store #03160d as-is rather than converting it to linear).
const FLAT_FILL=new THREE.Color().setRGB(0x03/255,0x16/255,0x0d/255);
function darkFill(material,color,{flat=false}={}){
  if(processedMaterials.has(material)||material.isShaderMaterial||material.colorWrite===false)return;processedMaterials.add(material);
  const tint=flat?FLAT_FILL.clone():new THREE.Color(color).multiplyScalar(.06);material.userData.neonTint=tint;
  chainProgram(material,flat?"neonFlat2":"neonFill",shader=>{shader.uniforms.neonTint={value:tint};
    // Flat fills return before any lighting/PBR work: the shader compiler
    // drops the rest, so a flat-filled MeshStandard costs as little as Basic.
    if(flat)shader.fragmentShader="uniform vec3 neonTint;\n"+shader.fragmentShader.replace(/void\s+main\s*\(\s*\)\s*\{/,"void main() {\n\tgl_FragColor = vec4( neonTint, 1.0 );\n\treturn;");
    else shader.fragmentShader="uniform vec3 neonTint;\n"+shader.fragmentShader.replace("#include <dithering_fragment>","#include <dithering_fragment>\n\tgl_FragColor.rgb = gl_FragColor.rgb * 0.6 + neonTint;");});
  // Push fills back in depth so the edge lines drawn on their faces always win.
  material.polygonOffset=true;material.polygonOffsetFactor=3;material.polygonOffsetUnits=6;
  stripTextures(material);
}
// Translucent drone parts (prop discs, markers) become faint neon green.
function neonTranslucent(material,color){
  if(processedMaterials.has(material)||material.isShaderMaterial)return;processedMaterials.add(material);
  stripTextures(material);if(material.color)material.color.set(color);if(material.emissive)material.emissive.set(0);material.opacity=Math.min(material.opacity??1,.35);material.transparent=true;material.toneMapped=false;material.needsUpdate=true;
}
// Edges are screen-space fat lines (EDGE_WIDTH_PX) so they read as bright
// neon strokes instead of dim 1 px hairlines. Geometry is shared per source.
const EDGE_WIDTH_PX=2.25;
function edgesFor(geometry){
  let edges=edgeCache.get(geometry);if(edges!==undefined)return edges;
  const triangles=(geometry.index?geometry.index.count:geometry.attributes?.position?.count||0)/3;
  if(triangles>0&&triangles<=MAX_EDGE_SOURCE_TRIANGLES){const plain=new THREE.EdgesGeometry(geometry,EDGE_THRESHOLD_DEG);edges=fatLineGeometry(plain);plain.dispose();edges.userData.neonSharedEdges=true;}else edges=null;
  edgeCache.set(geometry,edges);return edges;
}
function fatMaterial(color){let material=lineMaterials.get(color);if(!material){material=fatLineMaterial(color,{width:EDGE_WIDTH_PX,opacity:.98,additive:true,depthTest:true});lineMaterials.set(color,material);}return material;}
function attachEdges(mesh,color){
  let lines=mesh.children.find(child=>child.userData?.neonEdge);
  const edges=edgesFor(mesh.geometry);
  if(!edges){if(lines){mesh.remove(lines);}return;}
  if(lines&&!lines.isLineSegments2){mesh.remove(lines);lines=null;}
  if(!lines){lines=fatLineSegments(edges,fatMaterial(color));lines.name="NEON_EDGES";lines.renderOrder=mesh.renderOrder;mesh.add(lines);}
  else{lines.geometry=edges;lines.material=fatMaterial(color);}
  mesh.userData.neonEdgesFor=mesh.geometry;
}
function convert(mesh){
  // Sprites (blood puffs, markers): flat colored, no texture.
  if(mesh.isSprite){if(!skip(mesh))for(const material of materialsOf(mesh))stripTextures(material);mesh.userData.neonStyled=NEON_STYLE_VERSION;mesh.userData.neonMaterial=mesh.material;return true;}
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
  if(mesh.isInstancedMesh||mesh.isSkinnedMesh){for(const material of materials)if(!isTransparentFx(material))darkFill(material,color,{flat:true});else stripTextures(material);}
  else if(allFx&&category!=="airframe"){for(const material of materials)stripTextures(material);}
  else if(category==="airframe"){for(const material of materials)if(isTransparentFx(material))neonTranslucent(material,color);else darkFill(material,color,{flat:true});attachEdges(mesh,color);}
  else{for(const material of materials)if(!isTransparentFx(material))darkFill(material,color,{flat:true});attachEdges(mesh,color);}
  mesh.userData.neonStyled=NEON_STYLE_VERSION;mesh.userData.neonMaterial=mesh.material;mesh.userData.neonCategory=category;converted++;return true;
}
function needsWork(mesh){return (mesh.isMesh||mesh.isSprite)&&(mesh.userData.neonStyled!==NEON_STYLE_VERSION||mesh.userData.neonMaterial!==mesh.material||(mesh.userData.neonEdgesFor&&mesh.userData.neonEdgesFor!==mesh.geometry));}

// Neon ground grid, world-anchored and draped over the real terrain
// (terrain_craters.mjs): inside a crater the grid bends down into the bowl
// and over the rim. Rebuilt only when the player moves ~48 m or the terrain
// changes.
let gridAnchor=[Infinity,Infinity],gridTerrainVersion=-1,terrainVersion=0;
onTerrainChange(()=>{terrainVersion++;});
function rebuildGrid(cx,cy){
  const half=GRID_SIZE_M/2,positions=[],colors=[],step=GRID_STEP_M,x0=Math.round((cx-half)/step)*step,y0=Math.round((cy-half)/step)*step,n=Math.round(GRID_SIZE_M/step);
  for(let i=0;i<=n;i++){const fixed=i*step;
    for(let k=0;k<n;k++){const a=k*step,b=a+step;
      positions.push(x0+a,y0+fixed,groundHeightAt(x0+a,y0+fixed)+.03,x0+b,y0+fixed,groundHeightAt(x0+b,y0+fixed)+.03);
      positions.push(x0+fixed,y0+a,groundHeightAt(x0+fixed,y0+a)+.03,x0+fixed,y0+b,groundHeightAt(x0+fixed,y0+b)+.03);}}
  // Fade with distance so far lines don't merge into a solid band at the horizon.
  for(let i=0;i<positions.length;i+=3){const d=Math.hypot(positions[i]-cx,positions[i+1]-cy),f=Math.max(0,1-d/half)**1.6;colors.push(f,f,f);}
  const grid=gridGroup.children[0];grid.geometry.dispose();const geometry=new THREE.BufferGeometry();geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute("color",new THREE.Float32BufferAttribute(colors,3));geometry.computeBoundingSphere();grid.geometry=geometry;
  gridAnchor=[cx,cy];gridTerrainVersion=terrainVersion;
}
function ensureGrid(scene){
  if(gridGroup?.parent===scene)return gridGroup;
  const material=patchShockMaterial(neonLineMaterial(0x00ff9c,{opacity:.74}));material.vertexColors=true;material.transparent=true;material.blending=THREE.AdditiveBlending;material.depthWrite=false;
  const grid=new THREE.LineSegments(new THREE.BufferGeometry(),material);grid.raycast=()=>{};grid.frustumCulled=false;
  gridGroup=new THREE.Group();gridGroup.name="NEON_GROUND_GRID";gridGroup.userData.neonSkip=true;gridGroup.userData.flightFireIgnore=true;gridGroup.add(grid);gridGroup.renderOrder=-5;scene.add(gridGroup);gridAnchor=[Infinity,Infinity];return gridGroup;
}
function followGrid(){
  const camera=bridge()?.threeCamera;if(!gridGroup||!camera)return;
  if(Math.hypot(camera.position.x-gridAnchor[0],camera.position.y-gridAnchor[1])>24||gridTerrainVersion!==terrainVersion)rebuildGrid(camera.position.x,camera.position.y);
}
function styleScene(scene){
  if(styledScene===scene)return;styledScene=scene;
  scene.background=new THREE.Color(NEON_PALETTE.background);
  if(scene.fog)scene.fog.color=new THREE.Color(NEON_PALETTE.background);
}

// Performance: city actors far from the camera are dropped from the render
// layer (they are a few pixels tall), and neon edges are only drawn within
// EDGE_DISTANCE_M — far edges are sub-pixel noise but still cost draw calls.
// Layers are used instead of .visible so population code that toggles
// visibility (death, respawn) is never fought.
const ACTOR_CULL_M=260,EDGE_DISTANCE_M=150,CULL_INTERVAL_MS=400;
const cullPos=new THREE.Vector3();
function setLayer(root,on){root.traverse(n=>{if(on)n.layers.enable(0);else n.layers.disable(0);});}
function cullActors(scene,now){
  if(now-lastCull<CULL_INTERVAL_MS)return;lastCull=now;const camera=bridge()?.threeCamera;if(!camera)return;let roots=0,culled=0,edgesHidden=0;
  const actorId=n=>String(n?.userData?.worldPopulationId||n?.userData?.worldLifeId||"");
  scene.traverse(n=>{
    const id=actorId(n);if(id&&actorId(n.parent)!==id){const u=n.userData;roots++;n.getWorldPosition(cullPos);const far=cullPos.distanceTo(camera.position)>ACTOR_CULL_M;if(Boolean(u.neonCulled)!==far){u.neonCulled=far;setLayer(n,!far);}if(far)culled++;}
    if(!n.userData?.neonEdge)return;const parent=n.parent;if(!parent)return;parent.getWorldPosition(cullPos);const show=cullPos.distanceTo(camera.position)<EDGE_DISTANCE_M+(parent.geometry?.boundingSphere?.radius||0)*4;if(n.visible!==show)n.visible=show;if(!show)edgesHidden++;});
  cullStats={roots,culled,edgesHidden};const view=viewport();if(view){const s=`${roots}/${culled}/${edgesHidden}`;if(view.dataset.neonPerfCull!==s)view.dataset.neonPerfCull=s;}
}
function frame(now){
  const scene=bridge()?.threeScene;
  if(scene){
    styleScene(scene);ensureGrid(scene);followGrid();enforceMap(now);cullActors(scene,now);syncFatLineResolution(bridge()?.threeRenderer);
    if(!queue.length&&now-lastScan>SCAN_INTERVAL_MS){lastScan=now;scene.traverse(node=>{if(needsWork(node))queue.push(node);});}
    const menuEl=document.getElementById("gameMenu"),covered=Boolean(menuEl&&!menuEl.hidden),deadline=performance.now()+(covered?14:FRAME_BUDGET_MS);
    while(queue.length&&performance.now()<deadline){const mesh=queue.pop();if(mesh.parent||mesh===scene)convert(mesh);}
    const view=viewport();if(view){const value=String(converted);if(view.dataset.neonStyledMeshes!==value)view.dataset.neonStyledMeshes=value;}
  }
  requestAnimationFrame(frame);
}

globalThis.__arondightNeonStyle={pending:()=>queue.length,lastScan:()=>lastScan};
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
const MAP_NEON={background:"#020805",land:"#020805",green:"#030b07",industry:"#020805",water:"#02090c",waterLine:"#0a4a3c",roadMajor:"#0d6b44",roadMid:"#0a5235",roadMinor:"#073d27",boundary:"#06301f",buildingFlat:"#03160d"};
export const NEON_BUILDING_EXTRUSION_COLOR="#062818";
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
  if(!map.__neonSkyApplied&&typeof map.setSky==="function"){try{map.setSky({"sky-color":"#020805","horizon-color":"#05140c","fog-color":"#020805","sky-horizon-blend":.6,"horizon-fog-blend":.6,"fog-ground-blend":.8,"atmosphere-blend":0});map.__neonSkyApplied=true;}catch{}}
  const view=viewport();if(view&&changed)view.dataset.worldVisualPalette="neon-tactical-v1";
  return changed;
}
let lastMapStyle=-Infinity;
function enforceMap(now){
  if(now-lastMapStyle<1200)return;lastMapStyle=now;const b=bridge();if(!b?.active||!b.map)return;
  try{if(b.map.isStyleLoaded?.()===false)return;}catch{return;}
  applyNeonMapStyle(b.map);
}
