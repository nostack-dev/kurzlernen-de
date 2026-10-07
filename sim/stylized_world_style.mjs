import * as THREE from "three";
import "./neon_ui_theme.mjs";
import "./emp_button_layout.mjs";

// Neon wireframe city, matching the RUSH start screen: black plate, bright
// green edges, ground grid. No maps, no imagery, no shadow maps.

export const STYLIZED_STYLE_VERSION="rush-neon-wire-v2-bright-clear";
export const STYLE_PALETTE=Object.freeze({skyZenith:0x020c07,skyHorizon:0x052515,haze:0x07331d,ground:0x02140c,phosphor:0x3dff8a,edge:0x39ff14,fill:0x032417});
export const NEON_BUILDING_EXTRUSION_COLOR="#032417";
const PHOSPHOR=0x3dff8a,FILL=0x032417,SURFACE=0x087043,HOT=0xb6ffcf;
const MOBILE=typeof navigator!=="undefined"&&/android|iphone|ipad|mobile/i.test(navigator.userAgent||"");
const SCAN_INTERVAL_MS=MOBILE?900:650,FRAME_BUDGET_MS=2.8,EDGE_THRESHOLD=26;

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
const edgeMat=new THREE.LineBasicMaterial({color:PHOSPHOR,transparent:true,opacity:.95,blending:THREE.AdditiveBlending,depthWrite:false});
function edgesFor(geometry){const key=geometry.uuid;let g=edgeCache.get(key);if(!g){g=new THREE.EdgesGeometry(geometry,EDGE_THRESHOLD);edgeCache.set(key,g);}return g;}
function materialsOf(mesh){return(Array.isArray(mesh.material)?mesh.material:[mesh.material]).filter(Boolean);}
function skip(node){for(let n=node;n;n=n.parent){const u=n.userData||{};if(u.styleSkip||u.neonSkip||u.worldBuildingDepthOccluder||u.vsPeerHitProxy||u.vsCombatHitbox)return true;}return false;}
function phosphorize(material,hot){
  if(!material||processed.has(material))return;processed.add(material);stripTextures(material);
  const glow=material.transparent||material.blending===THREE.AdditiveBlending||hot;
  if(material.color)material.color.set(glow?HOT:(material.emissive?FILL:SURFACE));
  if(material.emissive){material.emissive.set(PHOSPHOR);material.emissiveIntensity=glow?1.55:.42;}
  if("roughness"in material)material.roughness=1;if("metalness"in material)material.metalness=0;if("envMapIntensity"in material)material.envMapIntensity=0;
  material.needsUpdate=true;
}
function addEdges(node){
  if(node.userData.phosphorEdges||node.isInstancedMesh)return;
  const geo=node.geometry;if(!geo||(geo.attributes?.position?.count||0)>24000)return;
  let lines;try{lines=new THREE.LineSegments(edgesFor(geo),edgeMat);}catch{return;}
  lines.userData.styleSkip=true;lines.frustumCulled=node.frustumCulled;lines.renderOrder=(node.renderOrder||0)+1;node.add(lines);node.userData.phosphorEdges=true;
}
function convert(node){
  node.userData.stylized=STYLIZED_STYLE_VERSION;node.userData.stylizedMaterial=node.material;node.castShadow=false;node.receiveShadow=false;
  if(node.isSprite){for(const m of materialsOf(node))phosphorize(m,true);converted++;return;}
  if(!node.isMesh||skip(node))return;
  for(const m of materialsOf(node))phosphorize(m,false);
  addEdges(node);converted++;
}
function needsWork(node){return(node.isMesh||node.isSprite)&&(node.userData.stylized!==STYLIZED_STYLE_VERSION||node.userData.stylizedMaterial!==node.material);}
function styleScene(scene){
  ensureSky(scene);ensureGrid(scene);if(styledScene===scene)return;styledScene=scene;
  // Full-scene light discovery is a scene-change operation, never a frame task.
  // New lights are disabled by the incremental scanner below.
  killLights(scene,bridge()?.threeRenderer);
  scene.background=new THREE.Color(STYLE_PALETTE.skyZenith);scene.fog=new THREE.FogExp2(STYLE_PALETTE.haze,.00038);
  scene.traverse(n=>{if(n.isMesh&&n.parent===scene&&n.geometry?.type==="BoxGeometry"&&(n.geometry.parameters?.width||0)>1000&&n.material?.color){stripTextures(n.material);n.material.color.set(STYLE_PALETTE.ground);n.userData.stylized=STYLIZED_STYLE_VERSION;}});
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
  if(grid){const camera=bridge()?.threeCamera;grid.visible=!bridge()?.active;if(camera){grid.position.x=Math.round(camera.position.x/16)*16;grid.position.y=Math.round(camera.position.y/16)*16;}}
  if(!scanStack.length&&!scanSceneRef&&now-lastScan>SCAN_INTERVAL_MS){lastScan=now;beginScan(scene);}
  const deadline=performance.now()+FRAME_BUDGET_MS;stepScan(deadline);cullActors(now);
  while(queue.length&&performance.now()<deadline){const node=queue.pop();if(node.parent)convert(node);}
  const view=viewport();if(view){if(view.dataset.visualStyle!==STYLIZED_STYLE_VERSION)view.dataset.visualStyle=STYLIZED_STYLE_VERSION;view.dataset.styleSceneScan="incremental-budgeted-neon-v2";}
  requestAnimationFrame(frame);
}
globalThis.__arondightNeonStyle={pending:()=>queue.length,lastScan:()=>lastScan};
globalThis.__arondightStylizedStyle={version:STYLIZED_STYLE_VERSION,palette:STYLE_PALETTE,pending:()=>queue.length};
export function installStylizedWorldStyle(){if(installed||typeof window==="undefined")return;installed=true;document.documentElement.classList.add("stylized-world","neon-line-style");const view=viewport();if(view)view.dataset.visualStyle=STYLIZED_STYLE_VERSION;requestAnimationFrame(frame);}
installStylizedWorldStyle();
export function applyNeonMapStyle(map){
  if(!map?.getStyle)return 0;const style=map.getStyle();if(!style?.layers)return 0;let changed=0;
  for(const layer of style.layers){const id=layer.id,type=layer.type;try{
    if(type==="raster"||type==="symbol"||type==="hillshade"||type==="fill-extrusion"){map.setLayoutProperty(id,"visibility","none");changed++;continue;}
    if(type==="background"){map.setPaintProperty(id,"background-color","#010806");changed++;}
    else if(type==="fill"){map.setPaintProperty(id,"fill-color","#02140c");map.setPaintProperty(id,"fill-opacity",1);try{map.setPaintProperty(id,"fill-pattern",null);}catch{}changed++;}
    else if(type==="line"){map.setPaintProperty(id,"line-color","#3dff8a");map.setPaintProperty(id,"line-opacity",.85);changed++;}
  }catch{}}
  return changed;
}
