import * as THREE from "three";

export const TRAINING_LEVEL_VERSION="fixed-grounded-harbour-v2";
let installed=false,sceneRef=null,root=null;

function bridge(){return globalThis.__arondightRealWorld||null;}
function viewport(){return document.getElementById("viewport");}
// matte surfaces: Lambert (PBR only where it shows — the pond's sheen)
function mat(color,{roughness=.9,metalness=0,transparent=false,opacity=1}={}){return roughness>=.6&&!metalness?new THREE.MeshLambertMaterial({color,transparent,opacity,depthWrite:true,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-2}):new THREE.MeshStandardMaterial({color,roughness,metalness,transparent,opacity,depthWrite:true,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-2});}
function tag(node,kind){node.userData.trainingLevel=true;node.userData.trainingLevelKind=kind;node.userData.styleSkip=true;node.userData.flightFireIgnore=kind==="water"||kind==="road"||kind==="marking";return node;}
function plane(w,h,material,x,y,z,kind){const mesh=tag(new THREE.Mesh(new THREE.PlaneGeometry(w,h),material),kind);mesh.position.set(x,y,z);mesh.receiveShadow=true;root.add(mesh);return mesh;}
function box(w,d,h,material,x,y,z,kind="building"){const mesh=tag(new THREE.Mesh(new THREE.BoxGeometry(w,d,h),material),kind);mesh.position.set(x,y,z+h/2);mesh.castShadow=true;mesh.receiveShadow=true;root.add(mesh);return mesh;}
function road(x,y,w,h){plane(w+3.4,h+3.4,mat(0x8b887f),x,y,.045,"sidewalk");plane(w,h,mat(0x34383d),x,y,.070,"road");}
function line(x,y,w,h){plane(w,h,mat(0xe8e3d7,{roughness:.7}),x,y,.088,"marking");}
function build(scene){
  sceneRef=scene;root=new THREE.Group();root.name="TRAINING_TEST_LEVEL_V2";root.userData.trainingLevelVersion=TRAINING_LEVEL_VERSION;scene.add(root);
  const grass=mat(0x526b39),water=mat(0x176b98,{roughness:.16,metalness:.02,transparent:true,opacity:.94}),concrete=mat(0xa59c8c),brick=mat(0x8d5d4b),cream=mat(0xc9bea8),roof=mat(0x3c4248,{roughness:.78}),wood=mat(0x6e5038);
  // Raised park islands avoid sharing the exact ground plane.
  plane(42,30,grass,-38,28,.026,"park");plane(32,22,grass,48,-25,.026,"park");
  // Main road rectangle + cross streets; these centerlines match trainingRoutes().
  road(0,-38,124,8);road(0,38,124,8);road(-62,0,8,76);road(62,0,8,76);
  road(0,0,168,11);road(0,0,10,152);road(0,54,140,8);
  for(let x=-76;x<=76;x+=14)line(x,0,5.5,.16);
  for(let y=-68;y<=68;y+=14)line(0,y,.16,5.5);
  // Saturated harbour/pond, visibly above ground and below bridge deck.
  const pond=tag(new THREE.Mesh(new THREE.CircleGeometry(20,48),water),"water");pond.scale.set(1.55,.92,1);pond.position.set(34,31,.052);pond.receiveShadow=false;root.add(pond);
  // Small pedestrian bridge and a dock.
  box(5,42,.18,concrete,34,31,.082,"bridge");box(18,3,.16,wood,48,47,.07,"dock");
  // Compact readable skyline, roofs physically separated from walls.
  const buildings=[
    [-47,-22,15,13,10,brick],[-27,-23,13,12,15,cream],[31,-23,15,13,12,concrete],[50,-22,12,12,18,brick],
    [-51,18,13,12,14,cream],[-18,24,14,11,20,concrete],[54,15,13,12,11,cream],[-55,61,16,11,9,brick],[55,64,18,12,13,concrete]
  ];
  for(const [x,y,w,d,h,m] of buildings){box(w,d,h,m,x,y,.10);box(w+.28,d+.28,.24,roof,x,y,.10+h+.035,"roof");}
  // Street furniture / trees are intentionally sparse; population supplies life.
  for(const [x,y] of [[-42,30],[-32,34],[-48,22],[44,-29],[51,-22],[24,61],[-21,59]]){
    box(.28,.28,2.7,wood,x,y,.04,"tree-trunk");const crown=tag(new THREE.Mesh(new THREE.DodecahedronGeometry(1.25,0),mat(0x3f6f35)),"tree-crown");crown.position.set(x,y,3.35);crown.castShadow=true;root.add(crown);
  }
  const v=viewport();if(v){v.dataset.trainingLevel=TRAINING_LEVEL_VERSION;v.dataset.trainingLevelGrounding="fixed-world-origin-v1";v.dataset.trainingLevelWater="saturated-pond+bridge-v1";v.dataset.trainingLevelCrowd="procedural-routes-v1";v.dataset.trainingLevelZLayers="ground<park<water<road<marking<buildings-v1";}
}
function sync(){const b=bridge(),scene=b?.threeScene;if(scene&&scene!==sceneRef){root?.parent?.remove(root);root=null;build(scene);}const realGeo=Number.isFinite(b?.originLon)&&Number.isFinite(b?.originLat);const training=Boolean(root&&document.body?.classList.contains("solo-flight")&&!realGeo);if(root)root.visible=training;setTimeout(sync,250);}
export function installTrainingTestLevelV2(){if(installed)return;installed=true;sync();}
installTrainingTestLevelV2();
