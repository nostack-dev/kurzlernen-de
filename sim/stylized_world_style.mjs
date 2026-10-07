import * as THREE from "three";
import "./neon_ui_theme.mjs";
import "./emp_button_layout.mjs";

// Realistic, high-quality look on a performance budget:
//   * physically based materials (MeshStandard) lit by ONE sun with real
//     soft shadows (a single shadow map that follows the player, sized for
//     the device) plus a sky/ground hemisphere fill,
//   * image-based lighting: the procedural sky is rendered once into a PMREM
//     environment map, so every car body, window and gun reflects the sky,
//   * ACES filmic tone mapping, exponential aerial haze,
//   * a procedural sky: Rayleigh-like gradient, sun disc + Mie glow and an
//     animated fBm cloud layer that drifts with the wind and is pushed away
//     by the bomb's shock front.
// No textures anywhere — detail comes from geometry, lighting and shaders.

export const STYLIZED_STYLE_VERSION="realistic-pbr-sun-ibl-v4";
export const STYLE_PALETTE=Object.freeze({skyZenith:0x2c6fc4,skyHorizon:0xc9dcef,haze:0xb7c9dc,ground:0x5e7a3e});
const SUN_DIR=new THREE.Vector3(-.45,-.52,.72).normalize();
const MOBILE=typeof navigator!=="undefined"&&/android|iphone|ipad|mobile/i.test(navigator.userAgent||"");
const SHADOW_SIZE=MOBILE?1024:2048,SHADOW_RANGE_M=MOBILE?70:110,FOG_DENSITY=.00085;
const SCAN_INTERVAL_MS=300,FRAME_BUDGET_MS=2.5;

let installed=false,queue=[],lastScan=-Infinity,styledScene=null,sky=null,sun=null,hemi=null,converted=0,lastCull=-Infinity,envReady=false;
const processed=new WeakSet();
const bridge=()=>globalThis.__arondightRealWorld||null;
const viewport=()=>document.getElementById("viewport");
const TEXTURE_SLOTS=["map","emissiveMap","aoMap","lightMap","bumpMap","normalMap","displacementMap","roughnessMap","metalnessMap","specularMap","gradientMap","matcap","clearcoatMap","sheenColorMap","alphaMap"];
export function stripTextures(material){let changed=false;for(const slot of TEXTURE_SLOTS)if(material[slot]){material[slot]=null;changed=true;}if(changed)material.needsUpdate=true;return changed;}

// ---------------------------------------------------------------- sky
export const skyUniforms={uSun:{value:SUN_DIR.clone()},uTime:{value:0},uWind:{value:new THREE.Vector2(.012,.004)},uBlastDir:{value:new THREE.Vector3(0,0,-1)},uBlastAge:{value:-1},uClouds:{value:1}};
const SKY_FRAG=`
uniform vec3 uSun;uniform float uTime;uniform vec2 uWind;uniform vec3 uBlastDir;uniform float uBlastAge;uniform float uClouds;varying vec3 vDir;
float h21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float a=.5,s=0.0;for(int i=0;i<5;i++){s+=a*vnoise(p);p=p*2.03+vec2(17.1,9.3);a*=.5;}return s;}
void main(){
  vec3 d=normalize(vDir);float h=max(d.z,0.0);vec3 s=normalize(uSun);float mu=max(dot(d,s),0.0);
  vec3 zen=vec3(0.13,0.32,0.68),hor=vec3(0.70,0.80,0.90);
  vec3 col=mix(hor,zen,pow(h,0.45));
  col+=vec3(1.0,0.72,0.42)*pow(1.0-h,6.0)*0.18*(0.5+0.5*dot(normalize(d.xy+1e-4),normalize(s.xy+1e-4)));
  col+=vec3(1.0,0.93,0.8)*(pow(mu,8.0)*0.22+pow(mu,64.0)*0.5)+vec3(1.0,0.97,0.9)*smoothstep(0.9993,0.99975,mu)*12.0;
  if(uClouds>0.5&&d.z>0.02){
    vec2 uv=d.xy/(d.z+0.12)*1.6+uWind*uTime;
    if(uBlastAge>0.0){vec3 b=normalize(uBlastDir);float ang=acos(clamp(dot(normalize(vec3(d.xy,0.0)),normalize(vec3(b.xy,0.0))),-1.0,1.0));float push=uBlastAge*0.35*exp(-ang*1.4);uv+=normalize(d.xy-b.xy+1e-4)*push;}
    float c=fbm(uv*1.3);float cov=smoothstep(0.52,0.78,c)*smoothstep(0.02,0.25,d.z);
    float lit=0.75+0.35*fbm(uv*1.3+s.xy*0.08)-0.25*smoothstep(0.6,0.95,c);
    vec3 cc=mix(vec3(0.62,0.66,0.72),vec3(1.0,0.98,0.95),lit)+vec3(1.0,0.85,0.6)*pow(mu,6.0)*0.4;
    col=mix(col,cc,cov*0.92);
  }
  col=mix(col,hor*0.92,smoothstep(0.0,-0.2,d.z));
  gl_FragColor=vec4(col,1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
function skyMaterial(clouds=true){return new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,depthTest:false,fog:false,uniforms:{...skyUniforms,uClouds:{value:clouds?1:0}},vertexShader:"varying vec3 vDir;void main(){vDir=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",fragmentShader:SKY_FRAG});}
function ensureSky(scene){
  if(sky?.parent===scene)return sky;const g=new THREE.SphereGeometry(1,32,16);g.rotateX(Math.PI/2);
  sky=new THREE.Mesh(g,skyMaterial(true));sky.name="REAL_SKY";sky.renderOrder=-10000;sky.frustumCulled=false;sky.userData.styleSkip=true;sky.userData.flightFireIgnore=true;sky.raycast=()=>{};
  sky.onBeforeRender=(r,s,camera)=>{sky.position.copy(camera.position);sky.scale.setScalar(Math.min(camera.far*.9,1800));};scene.add(sky);return sky;
}
// Image-based lighting: render the (cloudless) sky once into a PMREM env map.
function buildEnvironment(scene,renderer){
  if(envReady||!renderer)return;try{const pm=new THREE.PMREMGenerator(renderer),envScene=new THREE.Scene(),g=new THREE.SphereGeometry(10,32,16);g.rotateX(Math.PI/2);const m=new THREE.Mesh(g,skyMaterial(false));envScene.add(m);
    const ground=new THREE.Mesh(new THREE.CircleGeometry(9.5,32),new THREE.MeshBasicMaterial({color:0x5b6450}));ground.position.z=-1.2;envScene.add(ground);
    const rt=pm.fromScene(envScene,0,.1,100);scene.environment=rt.texture;scene.environmentIntensity=.9;pm.dispose();envReady=true;}catch(error){console.warn("environment",error);envReady=true;}
}
// ---------------------------------------------------------------- light
function ensureLights(scene,renderer){
  if(sun?.parent===scene)return;
  scene.traverse(o=>{if((o.isDirectionalLight||o.isHemisphereLight||o.isAmbientLight)&&!o.userData.realLight){o.userData.prevIntensity=o.intensity;o.intensity=0;o.castShadow=false;}});
  hemi=new THREE.HemisphereLight(0xc4dcff,0x6b5e48,.85);hemi.userData.realLight=true;scene.add(hemi);
  sun=new THREE.DirectionalLight(0xfff0dc,3.1);sun.userData.realLight=true;sun.castShadow=true;
  const sc=sun.shadow.camera;sc.left=-SHADOW_RANGE_M;sc.right=SHADOW_RANGE_M;sc.top=SHADOW_RANGE_M;sc.bottom=-SHADOW_RANGE_M;sc.near=1;sc.far=900;sun.shadow.mapSize.set(SHADOW_SIZE,SHADOW_SIZE);sun.shadow.bias=-.0004;sun.shadow.normalBias=.04;sun.shadow.radius=2;
  scene.add(sun,sun.target);
  if(renderer){renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.shadowMap.autoUpdate=true;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.0;renderer.outputColorSpace=THREE.SRGBColorSpace;}
}
const texel=new THREE.Vector3();
function followSun(){
  const c=bridge()?.threeCamera;if(!sun||!c)return;
  // centre the shadow frustum ahead of the camera and snap it to shadow
  // texels so shadows don't shimmer while moving
  const fwd=new THREE.Vector3();c.getWorldDirection(fwd);fwd.z=0;if(fwd.lengthSq()>1e-6)fwd.normalize();
  const centre=texel.copy(c.position).addScaledVector(fwd,SHADOW_RANGE_M*.45);centre.z=0;const step=SHADOW_RANGE_M*2/SHADOW_SIZE;centre.x=Math.round(centre.x/step)*step;centre.y=Math.round(centre.y/step)*step;
  sun.target.position.copy(centre);sun.position.copy(centre).addScaledVector(SUN_DIR,400);sun.target.updateMatrixWorld();
}
// ---------------------------------------------------------------- materials
function realMaterial(mesh,material){
  if(processed.has(material))return;processed.add(material);stripTextures(material);
  if(material.isMeshStandardMaterial||material.isMeshPhysicalMaterial||material.isMeshLambertMaterial||material.isMeshPhongMaterial){material.envMapIntensity=material.isMeshStandardMaterial?(material.envMapIntensity??1):1;material.needsUpdate=true;}
}
function materialsOf(mesh){return(Array.isArray(mesh.material)?mesh.material:[mesh.material]).filter(Boolean);}
function skip(node){for(let n=node;n;n=n.parent){const u=n.userData||{};if(u.nukeWeaponPart||u.styleSkip||u.neonSkip||u.worldBuildingDepthOccluder||u.vsPeerHitProxy||u.vsCombatHitbox)return true;}return false;}
function isActor(node){for(let n=node;n;n=n.parent){const u=n.userData||{};if(u.worldPopulationId||u.worldLifeId||u.arondightAirframe||u.arondightVisualAirframe||u.localHumanAvatar||u.gtaDrivableVehicle)return true;}return false;}
function convert(node){
  node.userData.stylized=STYLIZED_STYLE_VERSION;node.userData.stylizedMaterial=node.material;
  if(node.isSprite){for(const m of materialsOf(node))stripTextures(m);return;}
  if(!node.isMesh||skip(node))return;
  const mats=materialsOf(node),opaque=mats.every(m=>!m.transparent&&m.visible!==false&&m.colorWrite!==false);
  for(const m of mats)realMaterial(node,m);
  if(opaque&&!node.userData.walkWeaponPart){node.receiveShadow=true;if(isActor(node)||node.userData.worldDecorKind||node.isInstancedMesh)node.castShadow=true;}
  converted++;
}
function needsWork(node){return(node.isMesh||node.isSprite)&&(node.userData.stylized!==STYLIZED_STYLE_VERSION||node.userData.stylizedMaterial!==node.material);}
// ground: grass/soil variation (large-scale value noise in world space)
function realGround(mesh){
  const m=mesh.material;if(m.userData.realGround)return;m.userData.realGround=true;m.color.set(STYLE_PALETTE.ground);if("roughness"in m)m.roughness=.96;if("metalness"in m)m.metalness=0;mesh.receiveShadow=true;
  const prev=m.onBeforeCompile;m.onBeforeCompile=function(shader,r){prev?.call(this,shader,r);
    shader.vertexShader=shader.vertexShader.replace("void main() {","varying vec3 vGW;\nvoid main() {").replace("#include <begin_vertex>","#include <begin_vertex>\nvGW=(modelMatrix*vec4(transformed,1.0)).xyz;");
    shader.fragmentShader=shader.fragmentShader.replace("void main() {","varying vec3 vGW;\nfloat gh(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.55);}\nfloat gn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(gh(i),gh(i+vec2(1,0)),f.x),mix(gh(i+vec2(0,1)),gh(i+vec2(1,1)),f.x),f.y);}\nvoid main() {")
      .replace("#include <color_fragment>","#include <color_fragment>\n{float n=gn(vGW.xy*.015)*.6+gn(vGW.xy*.08)*.3+gn(vGW.xy*.6)*.1;diffuseColor.rgb*=mix(vec3(.78,.84,.7),vec3(1.12,1.06,.86),n);diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.42,.36,.27),smoothstep(.62,.8,gn(vGW.xy*.03+7.0))*.45);}");};
  const key=m.customProgramCacheKey;m.customProgramCacheKey=function(){return `${key?key.call(this):""}|real-ground-v1`;};m.needsUpdate=true;
}
function styleScene(scene){
  ensureSky(scene);const renderer=bridge()?.threeRenderer;ensureLights(scene,renderer);buildEnvironment(scene,renderer);followSun();
  if(styledScene===scene)return;styledScene=scene;
  scene.background=new THREE.Color(STYLE_PALETTE.skyHorizon);scene.fog=new THREE.FogExp2(STYLE_PALETTE.haze,FOG_DENSITY);
  scene.traverse(n=>{if(n.isMesh&&n.parent===scene&&n.geometry?.type==="BoxGeometry"&&(n.geometry.parameters?.width||0)>1000&&n.material?.color)realGround(n);});
}
// ---------------------------------------------------------------- perf: far actors leave the render layer
const ACTOR_CULL_M=260,CULL_INTERVAL_MS=400,cullPos=new THREE.Vector3();
function setLayer(root,on){root.traverse(n=>{if(on)n.layers.enable(0);else n.layers.disable(0);});}
function cullActors(scene,now){
  if(now-lastCull<CULL_INTERVAL_MS)return;lastCull=now;const camera=bridge()?.threeCamera;if(!camera)return;let roots=0,culled=0;
  const actorId=n=>String(n?.userData?.worldPopulationId||n?.userData?.worldLifeId||"");
  scene.traverse(n=>{if((n.isDirectionalLight||n.isHemisphereLight||n.isAmbientLight)&&!n.userData.realLight&&(n.intensity>0||n.castShadow)){n.intensity=0;n.castShadow=false;}const id=actorId(n);if(!id||actorId(n.parent)===id)return;const u=n.userData;roots++;n.getWorldPosition(cullPos);const far=cullPos.distanceTo(camera.position)>ACTOR_CULL_M;if(Boolean(u.styleCulled)!==far){u.styleCulled=far;setLayer(n,!far);}if(far)culled++;});
  const view=viewport();if(view){const s=`${roots}/${culled}`;if(view.dataset.stylePerfCull!==s)view.dataset.stylePerfCull=s;}
}
let blastAt=-1;
if(typeof window!=="undefined")window.addEventListener("arondight:nuke-impact",e=>{const p=e?.detail?.position,c=bridge()?.threeCamera;if(!Array.isArray(p)||!c)return;skyUniforms.uBlastDir.value.set(p[0]-c.position.x,p[1]-c.position.y,.2).normalize();blastAt=performance.now();});
function frame(now){
  const scene=bridge()?.threeScene;
  if(scene){
    styleScene(scene);cullActors(scene,now);skyUniforms.uTime.value=now/1000;skyUniforms.uBlastAge.value=blastAt<0?-1:Math.min(60,(now-blastAt)/1000);
    if(!queue.length&&now-lastScan>SCAN_INTERVAL_MS){lastScan=now;scene.traverse(node=>{if(needsWork(node))queue.push(node);});}
    const menuEl=document.getElementById("gameMenu"),covered=Boolean(menuEl&&!menuEl.hidden),deadline=performance.now()+(covered?14:FRAME_BUDGET_MS);
    while(queue.length&&performance.now()<deadline){const node=queue.pop();if(node.parent)convert(node);}
    const view=viewport();if(view){const value=String(converted);if(view.dataset.stylizedMeshes!==value)view.dataset.stylizedMeshes=value;}
  }
  requestAnimationFrame(frame);
}
globalThis.__arondightNeonStyle={pending:()=>queue.length,lastScan:()=>lastScan};
globalThis.__arondightStylizedStyle={version:STYLIZED_STYLE_VERSION,palette:STYLE_PALETTE,pending:()=>queue.length,get sun(){return sun;}};
export function installStylizedWorldStyle(){
  if(installed||typeof window==="undefined")return;installed=true;
  document.documentElement.classList.add("stylized-world");
  const view=viewport();if(view)view.dataset.visualStyle=STYLIZED_STYLE_VERSION;
  requestAnimationFrame(frame);
}
installStylizedWorldStyle();
export const NEON_BUILDING_EXTRUSION_COLOR="#d9cdb8";
export function applyNeonMapStyle(){return 0;}
