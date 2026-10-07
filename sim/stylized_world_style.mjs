import * as THREE from "three";
import "./neon_ui_theme.mjs";
import "./emp_button_layout.mjs";
import {groundHeightAt} from "./terrain_craters.mjs";
import {patchShockMaterial} from "./nuke_shock_field.mjs";

// Readable RUSH neon city: dark solid silhouettes + selective phosphor edges.
// No textures, no satellite imagery, no shadow maps. The look stays green-neon,
// but solid faces carry depth so streets, buildings, vehicles and people remain
// legible instead of collapsing into one overexposed wireframe field.

export const STYLIZED_STYLE_VERSION="rush-neon-readable-v3";
export const STYLE_PALETTE=Object.freeze({skyZenith:0x020c07,skyHorizon:0x052515,haze:0x07331d,ground:0x02140c,phosphor:0x3dff8a,edge:0x39ff14,fill:0x032417});
export const NEON_BUILDING_EXTRUSION_COLOR="#032417";
const PHOSPHOR=0x3dff8a,FILL=0x03140d,SURFACE=0x0a2b1e,HOT=0x8dffb4;
const MOBILE=typeof navigator!=="undefined"&&/android|iphone|ipad|mobile/i.test(navigator.userAgent||"");
const SCAN_INTERVAL_MS=MOBILE?900:650,FRAME_BUDGET_MS=2.8,EDGE_THRESHOLD=26;
const CLEAR_COLOR=0x010806,GRID_STEP_M=16,GRID_LIFT_M=.2;
const WIRE_COLOR=0x3dff8a,FORCE_VISIBLE=new Set(["WORLD_CITY_SOLIDS","WORLD_CITY_ROADS","WORLD_GROUND"]);
const clearColor=new THREE.Color(CLEAR_COLOR),wireStats={materials:0,swapped:0,sprites:0};
// Lit materials render black once the lights are off, and the ground's own
// shader paints its colour procedurally; both are swapped for this one.
const WIRE_MESH=patchShockMaterial(new THREE.MeshBasicMaterial({color:WIRE_COLOR,wireframe:true,fog:false,toneMapped:false,transparent:false,opacity:1,side:THREE.FrontSide}));
WIRE_MESH.userData.rushWire=true;

let installed=false,queue=[],lastScan=-Infinity,styledScene=null,sky=null,grid=null,converted=0,lastCull=-Infinity,actorRoots=[],scanStack=[],scanActors=[],scanSceneRef=null;
const processed=new WeakSet(),edgeCache=new Map();
const bridge=()=>globalThis.__arondightRealWorld||null;
const viewport=()=>document.getElementById("viewport");
const TEXTURE_SLOTS=["map","emissiveMap","aoMap","lightMap","bumpMap","normalMap","displacementMap","roughnessMap","metalnessMap","specularMap","gradientMap","matcap","clearcoatMap","sheenColorMap","alphaMap","envMap"];
export function stripTextures(material){let changed=false;for(const slot of TEXTURE_SLOTS)if(material&&material[slot]){material[slot]=null;changed=true;}if(changed)material.needsUpdate=true;return changed;}
export const skyUniforms={uTime:{value:0},uBlastAge:{value:-1},uBlastDir:{value:new THREE.Vector3(0,0,-1)},uSun:{value:new THREE.Vector3(0,0,1)},uWind:{value:new THREE.Vector2()},uClouds:{value:0}};

function ensureSky(scene){
  if(sky?.parent===scene)return;
  const g=new THREE.SphereGeometry(1400,24,16);g.rotateX(Math.PI/2);
  sky=new THREE.Mesh(g,new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,fog:false,vertexShader:"varying vec3 vDir;void main(){vDir=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",fragmentShader:"varying vec3 vDir;void main(){float h=clamp(normalize(vDir).z*.5+.5,0.0,1.0);gl_FragColor=vec4(mix(vec3(0.01,0.06,0.03),vec3(0.004,0.012,0.008),h),1.0);}"}));
  sky.frustumCulled=false;sky.userData.styleSkip=true;sky.name="RUSH_NEON_SKY";scene.add(sky);
}
function ensureGrid(scene){
  if(grid?.parent===scene)return;
  const size=640,step=16,positions=[];
  for(let i=-size;i<=size;i+=step)positions.push(-size,i,0,size,i,0,-i,-size,0,-i,size,0);
  const geo=new THREE.BufferGeometry();geo.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
  grid=new THREE.LineSegments(geo,new THREE.LineBasicMaterial({color:PHOSPHOR,transparent:true,opacity:.46,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false}));
  grid.position.z=.04;grid.frustumCulled=false;grid.userData.styleSkip=true;grid.name="RUSH_NEON_GRID";scene.add(grid);
}
function killLights(scene,renderer){
  scene.traverse(o=>{if((o.isDirectionalLight||o.isHemisphereLight||o.isAmbientLight||o.isPointLight||o.isSpotLight)&&!o.userData.phosphorKeep){o.intensity=0;o.castShadow=false;}});
  scene.environment=null;if(renderer){renderer.shadowMap.enabled=false;renderer.toneMapping=THREE.NoToneMapping;renderer.outputColorSpace=THREE.SRGBColorSpace;}
}
const edgeMat=new THREE.LineBasicMaterial({color:PHOSPHOR,transparent:true,opacity:.72,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false});
function edgesFor(geometry){const key=geometry.uuid;let g=edgeCache.get(key);if(!g){g=new THREE.EdgesGeometry(geometry,EDGE_THRESHOLD);edgeCache.set(key,g);}return g;}
function materialsOf(mesh){return(Array.isArray(mesh.material)?mesh.material:[mesh.material]).filter(Boolean);}
function needsSwap(node,m){
  if(m.userData?.rushWire)return false;
  if(node.name==="WORLD_GROUND")return true;
  return Boolean(m.isMeshStandardMaterial||m.isMeshPhongMaterial||m.isMeshLambertMaterial||m.isMeshToonMaterial||m.isMeshMatcapMaterial||m.isMeshNormalMaterial);
}
function wireMaterial(m){
  if(!m||m.isLineMaterial)return;let rebuild=false;
  for(const slot of["map","emissiveMap","alphaMap"])if(m[slot]){m[slot]=null;rebuild=true;}
  if(m.wireframe!==true)m.wireframe=true;
  if(m.color&&m.color.getHex()!==WIRE_COLOR)m.color.setHex(WIRE_COLOR);
  if("emissiveIntensity"in m&&m.emissiveIntensity!==0)m.emissiveIntensity=0;
  if(m.vertexColors){m.vertexColors=false;rebuild=true;}
  if(m.fog!==false){m.fog=false;rebuild=true;}
  if(m.toneMapped!==false){m.toneMapped=false;rebuild=true;}
  if(m.transparent!==false){m.transparent=false;rebuild=true;}
  if(m.opacity!==1)m.opacity=1;
  if(m.side!==THREE.FrontSide){m.side=THREE.FrontSide;rebuild=true;}
  if(rebuild)m.needsUpdate=true;wireStats.materials++;
}
// Pre-render pass: runs after every module's frame work (city rebuilds,
// ground rebuilds, restyling), so nothing can turn a filled face back on.
function wireScene(scene){
  wireStats.materials=0;wireStats.swapped=0;wireStats.sprites=0;
  scene.traverse(node=>{
    if(node===sky){node.visible=false;return;}
    if(FORCE_VISIBLE.has(node.name)&&!node.visible)node.visible=true;
    if(node.isSprite){if(node.visible)node.visible=false;wireStats.sprites++;return;}
    if(!(node.isMesh||node.isLine||node.isLineSegments))return;
    if(node.isMesh&&!node.isLineSegments2&&!node.isLine2){
      if(Array.isArray(node.material)){if(node.material.some(m=>needsSwap(node,m))){node.userData.wireOriginalMaterial??=node.material;node.material=WIRE_MESH;wireStats.swapped++;}}
      else if(node.material&&needsSwap(node,node.material)){node.userData.wireOriginalMaterial??=node.material;node.material=WIRE_MESH;wireStats.swapped++;}
    }
    for(const m of materialsOf(node))wireMaterial(m);
  });
}
function wireBackdrop(scene,renderer){
  if(!scene.background?.isColor||scene.background.getHex()!==CLEAR_COLOR)scene.background=new THREE.Color(CLEAR_COLOR);
  if(renderer?.setClearColor)renderer.setClearColor(clearColor,1);
  if(sky&&sky.visible)sky.visible=false;
}
function followGrid(camera){
  if(!grid)return;
  // WORLD_GROUND already draws the same 16 m neon lattice directly on the
  // deformed terrain. Never draw this legacy flat helper over the real world.
  if(bridge()?.active){grid.visible=false;return;}
  grid.visible=true;if(!camera)return;
  const x=camera.position.x,y=camera.position.y,h=groundHeightAt(x,y);
  grid.position.x=Math.round(x/GRID_STEP_M)*GRID_STEP_M;grid.position.y=Math.round(y/GRID_STEP_M)*GRID_STEP_M;grid.position.z=(Number.isFinite(h)?h:0)+GRID_LIFT_M;
}
function skip(node){for(let n=node;n;n=n.parent){const u=n.userData||{};if(u.styleSkip||u.neonSkip||u.worldBuildingDepthOccluder||u.vsPeerHitProxy||u.vsCombatHitbox)return true;}return false;}
function phosphorize(material,hot){
  if(!material||processed.has(material))return;processed.add(material);stripTextures(material);
  const glow=material.transparent||material.blending===THREE.AdditiveBlending||hot;
  if(material.color)material.color.set(glow?HOT:(material.emissive?FILL:SURFACE));
  if(material.emissive){material.emissive.set(PHOSPHOR);material.emissiveIntensity=glow?1.15:.26;}
  if("roughness"in material)material.roughness=1;if("metalness"in material)material.metalness=0;if("envMapIntensity"in material)material.envMapIntensity=0;
  if("wireframe"in material&&material.wireframe){material.wireframe=false;material.needsUpdate=true;}
  material.toneMapped=false;material.needsUpdate=true;
}
function addEdges(node){
  if(node.userData.phosphorEdges||node.isInstancedMesh)return;
  const geo=node.geometry;if(!geo||(geo.attributes?.position?.count||0)>24000)return;
  let lines;try{lines=new THREE.LineSegments(edgesFor(geo),edgeMat);}catch{return;}
  lines.userData.styleSkip=true;lines.frustumCulled=node.frustumCulled;lines.renderOrder=(node.renderOrder||0)+1;node.add(lines);node.userData.phosphorEdges=true;
}
function convert(node){
  // Undo the previous global wireframe override if a live session hot-reloads
  // this module; reloads then converge to the same readable material state.
  if(node.userData.wireOriginalMaterial){node.material=node.userData.wireOriginalMaterial;delete node.userData.wireOriginalMaterial;}
  node.castShadow=false;node.receiveShadow=false;
  if(!skip(node)){
    if(node.isMesh){for(const m of materialsOf(node))phosphorize(m,false);if(!node.isInstancedMesh)addEdges(node);}
    else if(node.isLine||node.isLineSegments){for(const m of materialsOf(node))phosphorize(m,true);}
  }
  node.userData.stylized=STYLIZED_STYLE_VERSION;node.userData.stylizedMaterial=node.material;converted++;
}
function needsWork(node){return(node.isMesh||node.isSprite)&&(node.userData.stylized!==STYLIZED_STYLE_VERSION||node.userData.stylizedMaterial!==node.material);}
function styleScene(scene){
  ensureSky(scene);ensureGrid(scene);if(styledScene===scene)return;styledScene=scene;
  // Full-scene light discovery is a scene-change operation, never a frame task.
  // New lights are disabled by the incremental scanner below.
  killLights(scene,bridge()?.threeRenderer);
  scene.background=new THREE.Color(STYLE_PALETTE.skyZenith);scene.fog=new THREE.FogExp2(STYLE_PALETTE.haze,.00016);
  
}
const ACTOR_CULL_M=260,CULL_INTERVAL_MS=600,cullPos=new THREE.Vector3();
const actorId=n=>String(n?.userData?.worldPopulationId||n?.userData?.worldLifeId||"");
function setLayer(root,on){root.traverse(n=>{if(on)n.layers.enable(0);else n.layers.disable(0);});}
function beginScan(scene){scanSceneRef=scene;scanStack.length=0;scanActors.length=0;scanStack.push(scene);}
function stepScan(deadline){
  while(scanStack.length&&performance.now()<deadline){
    const node=scanStack.pop();if(!node)continue;
    if((node.isDirectionalLight||node.isHemisphereLight||node.isAmbientLight||node.isPointLight||node.isSpotLight)&&!node.userData.phosphorKeep&&node.intensity>0){node.intensity=0;node.castShadow=false;}
    const id=actorId(node);if(id&&actorId(node.parent)!==id)scanActors.push(node);
    if(needsWork(node))queue.push(node);
    const children=node.children;for(let i=children.length-1;i>=0;i--)scanStack.push(children[i]);
  }
  if(!scanStack.length&&scanSceneRef){actorRoots=scanActors.slice();scanActors.length=0;scanSceneRef=null;return true;}return false;
}
function cullActors(now){if(now-lastCull<CULL_INTERVAL_MS)return;lastCull=now;const camera=bridge()?.threeCamera;if(!camera)return;for(const n of actorRoots){if(!n?.parent)continue;n.getWorldPosition(cullPos);const far=cullPos.distanceTo(camera.position)>ACTOR_CULL_M;if(Boolean(n.userData.styleCulled)!==far){n.userData.styleCulled=far;setLayer(n,!far);}}}
function frame(now){
  const scene=bridge()?.threeScene;if(!scene)return requestAnimationFrame(frame);
  styleScene(scene);skyUniforms.uTime.value=now/1000;
  if(sky)sky.visible=true;followGrid(bridge()?.threeCamera);
  if(!scanStack.length&&!scanSceneRef&&now-lastScan>SCAN_INTERVAL_MS){lastScan=now;beginScan(scene);}
  const deadline=performance.now()+FRAME_BUDGET_MS;stepScan(deadline);cullActors(now);
  while(queue.length&&performance.now()<deadline){const node=queue.pop();if(node.parent)convert(node);}
  const view=viewport();if(view){if(view.dataset.visualStyle!==STYLIZED_STYLE_VERSION)view.dataset.visualStyle=STYLIZED_STYLE_VERSION;view.dataset.styleSceneScan="incremental-budgeted-neon-v2";view.dataset.wireMaterials=String(wireStats.materials);view.dataset.wireSwapped=String(wireStats.swapped);}
  requestAnimationFrame(frame);
}
globalThis.__arondightNeonStyle={pending:()=>queue.length,lastScan:()=>lastScan};
globalThis.__arondightStylizedStyle={version:STYLIZED_STYLE_VERSION,palette:STYLE_PALETTE,pending:()=>queue.length};
function injectMapCanvasHide(){
  if(typeof document==="undefined"||document.querySelector("style[data-neon-map-canvas]"))return;
  const tag=document.createElement("style");tag.dataset.neonMapCanvas=STYLIZED_STYLE_VERSION;tag.textContent="html.neon-line-style .maplibregl-canvas{opacity:0!important}html.neon-line-style .maplibregl-map{visibility:hidden!important;opacity:0!important}";
  (document.head||document.documentElement).appendChild(tag);
}
export function installStylizedWorldStyle(){if(installed||typeof window==="undefined")return;installed=true;document.documentElement.classList.add("stylized-world","neon-line-style");injectMapCanvasHide();const view=viewport();if(view)view.dataset.visualStyle=STYLIZED_STYLE_VERSION;requestAnimationFrame(frame);}
installStylizedWorldStyle();
export function applyNeonMapStyle(map){
  injectMapCanvasHide();
  if(!map?.getStyle)return 0;const style=map.getStyle();if(!style?.layers)return 0;let changed=0;
  for(const layer of style.layers){const id=layer.id,type=layer.type;try{
    if(type==="raster"||type==="symbol"||type==="hillshade"||type==="fill-extrusion"||type==="fill"){map.setLayoutProperty(id,"visibility","none");changed++;continue;}
    if(type==="background"){map.setPaintProperty(id,"background-color","#010806");changed++;}
    else if(type==="line"){map.setPaintProperty(id,"line-color","#3dff8a");map.setPaintProperty(id,"line-opacity",.85);changed++;}
  }catch{}}
  return changed;
}
