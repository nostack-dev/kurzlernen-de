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
const SUN_DIR=new THREE.Vector3(-.45,-.52,.72).normalize(); // current key-light direction (sun by day, moon by night), updated by the day/night cycle
const MOBILE=typeof navigator!=="undefined"&&/android|iphone|ipad|mobile/i.test(navigator.userAgent||"");
const SHADOW_SIZE=MOBILE?1024:2048,SHADOW_RANGE_M=MOBILE?70:110,FOG_DENSITY=.00085;
const SCAN_INTERVAL_MS=MOBILE?900:650,FRAME_BUDGET_MS=2.5;

let installed=false,queue=[],lastScan=-Infinity,styledScene=null,sky=null,sun=null,hemi=null,converted=0,lastCull=-Infinity,envReady=false,actorRoots=[],scanStack=[],scanActors=[],scanSceneRef=null;
const processed=new WeakSet();
const bridge=()=>globalThis.__arondightRealWorld||null;
const viewport=()=>document.getElementById("viewport");
const TEXTURE_SLOTS=["map","emissiveMap","aoMap","lightMap","bumpMap","normalMap","displacementMap","roughnessMap","metalnessMap","specularMap","gradientMap","matcap","clearcoatMap","sheenColorMap","alphaMap"];
export function stripTextures(material){let changed=false;for(const slot of TEXTURE_SLOTS)if(material[slot]){material[slot]=null;changed=true;}if(changed)material.needsUpdate=true;return changed;}

// ---------------------------------------------------------------- sky
export const skyUniforms={uNight:{value:0},uMoon:{value:new THREE.Vector3(.4,.5,.76).normalize()},uSunUp:{value:1},uSun:{value:SUN_DIR.clone()},uTime:{value:0},uWind:{value:new THREE.Vector2(.012,.004)},uBlastDir:{value:new THREE.Vector3(0,0,-1)},uBlastAge:{value:-1},uClouds:{value:1}};
const SKY_FRAG=`
uniform float uNight;uniform vec3 uMoon;uniform float uSunUp;uniform vec3 uSun;uniform float uTime;uniform vec2 uWind;uniform vec3 uBlastDir;uniform float uBlastAge;uniform float uClouds;varying vec3 vDir;
float h21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float a=.5,s=0.0;for(int i=0;i<5;i++){s+=a*vnoise(p);p=p*2.03+vec2(17.1,9.3);a*=.5;}return s;}
void main(){
  vec3 d=normalize(vDir);float h=max(d.z,0.0);vec3 s=normalize(uSun);float mu=max(dot(d,s),0.0);
  // day -> golden hour -> moonlit night (never pitch black)
  float dusk=clamp(1.0-abs(s.z)*4.0,0.0,1.0)*(1.0-uNight*0.6);
  vec3 zen=mix(vec3(0.05,0.2,0.62),vec3(0.012,0.022,0.06),uNight),hor=mix(vec3(0.52,0.66,0.86),vec3(0.05,0.075,0.13),uNight);
  hor=mix(hor,vec3(0.95,0.48,0.22),dusk*0.55);zen=mix(zen,vec3(0.16,0.14,0.32),dusk*0.35);
  vec3 col=mix(hor,zen,pow(h,0.45));
  col+=vec3(1.0,0.62,0.32)*pow(1.0-h,5.0)*(0.18+0.5*dusk)*(0.5+0.5*dot(normalize(d.xy+1e-4),normalize(s.xy+1e-4)))*uSunUp;
  col+=(vec3(1.0,0.93,0.8)*(pow(mu,8.0)*0.22+pow(mu,64.0)*0.5)+vec3(1.0,0.97,0.9)*smoothstep(0.9993,0.99975,mu)*12.0)*uSunUp;
  if(uNight>0.01){vec3 m=normalize(uMoon);float mm=max(dot(d,m),0.0);
    col+=uNight*(vec3(0.55,0.65,0.9)*pow(mm,24.0)*0.12+vec3(0.9,0.94,1.0)*smoothstep(0.99955,0.9998,mm)*3.2);
    vec2 sp=vec2(atan(d.y,d.x)*90.0,asin(clamp(d.z,0.0,1.0))*120.0);vec2 cell=floor(sp);float r=h21(cell);
    float star=step(0.985,r)*smoothstep(0.5,0.0,length(fract(sp)-0.5))*(0.6+0.4*sin(uTime*2.0+r*40.0));
    col+=uNight*vec3(0.9,0.95,1.0)*star*smoothstep(0.05,0.3,d.z)*0.9;}
  if(uClouds>0.5&&d.z>0.02){
    vec2 uv=d.xy/(d.z+0.12)*1.6+uWind*uTime;
    if(uBlastAge>0.0){vec3 b=normalize(uBlastDir);float ang=acos(clamp(dot(normalize(vec3(d.xy,0.0)),normalize(vec3(b.xy,0.0))),-1.0,1.0));float push=uBlastAge*0.35*exp(-ang*1.4);uv+=normalize(d.xy-b.xy+1e-4)*push;}
    float c=fbm(uv*1.3);float cov=smoothstep(0.52,0.78,c)*smoothstep(0.02,0.25,d.z);
    float lit=0.75+0.35*fbm(uv*1.3+s.xy*0.08)-0.25*smoothstep(0.6,0.95,c);
    vec3 cc=mix(vec3(0.62,0.66,0.72),vec3(1.0,0.98,0.95),lit)+vec3(1.0,0.85,0.6)*pow(mu,6.0)*0.4*uSunUp;
    cc=mix(cc,mix(vec3(0.03,0.04,0.07),vec3(0.16,0.18,0.24),lit),uNight);cc=mix(cc,cc*vec3(1.1,0.75,0.6),dusk*0.6);
    col=mix(col,cc,cov*0.92);
  }
  col=mix(col,hor*0.92,smoothstep(0.0,-0.2,d.z));
  gl_FragColor=vec4(col,1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
function skyMaterial(clouds=true){return new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,depthTest:false,fog:false,uniforms:{...skyUniforms,uClouds:{value:clouds?1:0}},vertexShader:"varying vec3 vDir;void main(){vDir=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",fragmentShader:SKY_FRAG});}
// Sky cache: the procedural sky (gradient, sun, 5-octave clouds) is baked
// ~10x per second into an upper-hemisphere HDR panorama; the sky dome only
// samples it — one texture fetch per pixel instead of ~12 noise evaluations
// over most of the screen. During a nuke blast it is re-baked every frame.
const SKY_BAKE_W=1536,SKY_BAKE_H=384,SKY_BAKE_MS=100;
let skyRT=null,skyBake=null,lastSkyBake=-Infinity;
function skyBakeSetup(){
  if(skyRT)return;skyRT=new THREE.WebGLRenderTarget(SKY_BAKE_W,SKY_BAKE_H,{type:THREE.HalfFloatType,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,generateMipmaps:false,depthBuffer:false});skyRT.texture.wrapS=THREE.RepeatWrapping;
  const frag=SKY_FRAG.replace("varying vec3 vDir;","varying vec2 vUv;").replace("void main(){","void main(){float az=vUv.x*6.2831853,el=vUv.y*1.5707963;vec3 vDir=vec3(cos(el)*cos(az),cos(el)*sin(az),sin(el));");
  const m=new THREE.ShaderMaterial({uniforms:{...skyUniforms,uClouds:{value:1}},vertexShader:"varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}",fragmentShader:frag,depthTest:false,depthWrite:false});
  const scene=new THREE.Scene(),quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),m);quad.frustumCulled=false;scene.add(quad);skyBake={scene,camera:new THREE.Camera()};
}
function bakeSky(renderer,now,force){
  if(!renderer)return false;skyBakeSetup();if(!force&&now-lastSkyBake<SKY_BAKE_MS)return true;lastSkyBake=now;
  const prev=renderer.getRenderTarget();renderer.setRenderTarget(skyRT);renderer.render(skyBake.scene,skyBake.camera);renderer.setRenderTarget(prev);return true;
}
// Drawn AFTER the opaque world at the far plane (xyww) with depth test: only
// pixels not covered by buildings/ground are shaded.
function cachedSkyMaterial(){skyBakeSetup();return new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,depthTest:true,fog:false,uniforms:{tSky:{value:skyRT.texture},uNight:skyUniforms.uNight},
  vertexShader:"varying vec3 vDir;void main(){vDir=position;vec4 p=projectionMatrix*modelViewMatrix*vec4(position,1.0);gl_Position=p.xyww;}",
  fragmentShader:`uniform sampler2D tSky;uniform float uNight;varying vec3 vDir;
void main(){vec3 d=normalize(vDir);float u=fract(atan(d.y,d.x)/6.2831853),v=asin(clamp(d.z,0.0,1.0))/1.5707963;
  vec3 col=texture2D(tSky,vec2(u,clamp(v,0.5/${SKY_BAKE_H}.0,1.0-0.5/${SKY_BAKE_H}.0))).rgb;
  col=mix(col,mix(vec3(0.52,0.66,0.86),vec3(0.05,0.075,0.13),uNight)*0.92,smoothstep(0.0,-0.2,d.z));
  gl_FragColor=vec4(col,1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`});}
function ensureSky(scene){
  if(sky?.parent===scene)return sky;const g=new THREE.SphereGeometry(1,32,16);g.rotateX(Math.PI/2);
  sky=new THREE.Mesh(g,cachedSkyMaterial());sky.name="REAL_SKY";sky.renderOrder=100000;sky.frustumCulled=false;sky.userData.styleSkip=true;sky.userData.flightFireIgnore=true;sky.raycast=()=>{};
  sky.onBeforeRender=(r,s,camera)=>{sky.position.copy(camera.position);sky.scale.setScalar(Math.min(camera.far*.9,1800));};scene.add(sky);return sky;
}
// Image-based lighting: render the (cloudless) sky once into a PMREM env map.
let envTexture=null;
function buildEnvironment(scene,renderer){
  // every scene (training world, real world, rebuilt worlds) gets the env map
  if(envTexture&&scene.environment!==envTexture){scene.environment=envTexture;scene.environmentIntensity=.9;}
  if(envReady||!renderer)return;try{const pm=new THREE.PMREMGenerator(renderer),envScene=new THREE.Scene(),g=new THREE.SphereGeometry(10,32,16);g.rotateX(Math.PI/2);const m=new THREE.Mesh(g,skyMaterial(false));envScene.add(m);
    const ground=new THREE.Mesh(new THREE.CircleGeometry(9.5,32),new THREE.MeshBasicMaterial({color:0x5b6450}));ground.position.z=-1.2;envScene.add(ground);
    const rt=pm.fromScene(envScene,0,.1,100);envTexture=rt.texture;scene.environment=rt.texture;scene.environmentIntensity=.9;pm.dispose();envReady=true;}catch(error){console.warn("environment",error);envReady=true;}
}
// ---------------------------------------------------------------- colour grade
// Filmic grade inside every material's tone mapping (no extra pass): ACES,
// then a touch more saturation and contrast, warm highlights and slightly
// cool shadows — the 'golden afternoon' look instead of a flat grey cast.
const GRADE_GLSL=`vec3 CustomToneMapping( vec3 color ) {
  vec3 c=ACESFilmicToneMapping(color);
  float l=dot(c,vec3(0.2126,0.7152,0.0722));
  c=mix(vec3(l),c,1.14);
  c=mix(c,c*c*(3.0-2.0*c),0.22);
  c+=vec3(0.016,0.006,-0.014)*smoothstep(0.35,1.0,l)+vec3(-0.006,0.0,0.012)*(1.0-smoothstep(0.0,0.3,l));
  return clamp(c,0.0,1.0);
}`;
if(!THREE.ShaderChunk.tonemapping_pars_fragment.includes("ACESFilmicToneMapping(color);\n  float l"))THREE.ShaderChunk.tonemapping_pars_fragment=THREE.ShaderChunk.tonemapping_pars_fragment.replace("vec3 CustomToneMapping( vec3 color ) { return color; }",GRADE_GLSL);
// ---------------------------------------------------------------- light
function ensureLights(scene,renderer){
  if(sun?.parent===scene)return;
  scene.traverse(o=>{if((o.isDirectionalLight||o.isHemisphereLight||o.isAmbientLight)&&!o.userData.realLight){o.userData.prevIntensity=o.intensity;o.intensity=0;o.castShadow=false;}});
  hemi=new THREE.HemisphereLight(0xc4dcff,0x6b5e48,.85);hemi.userData.realLight=true;scene.add(hemi);
  sun=new THREE.DirectionalLight(0xfff0dc,2.8);sun.userData.realLight=true;sun.castShadow=true;
  const sc=sun.shadow.camera;sc.up.set(0,0,1);sc.left=-SHADOW_RANGE_M;sc.right=SHADOW_RANGE_M;sc.top=SHADOW_RANGE_M;sc.bottom=-SHADOW_RANGE_M;sc.near=1;sc.far=900;sun.shadow.mapSize.set(SHADOW_SIZE,SHADOW_SIZE);sun.shadow.bias=-.0002;sun.shadow.normalBias=SHADOW_RANGE_M*2/SHADOW_SIZE*.9; // ≈ one shadow texel: no acne on flat ground/roofs at low sunsun.shadow.radius=2;
  scene.add(sun,sun.target);
  if(renderer){renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=true;renderer.toneMapping=THREE.CustomToneMapping;renderer.toneMappingExposure=1.0;renderer.outputColorSpace=THREE.SRGBColorSpace;}
}
const texel=new THREE.Vector3(),sunForward=new THREE.Vector3();
const lightRight=new THREE.Vector3(),lightUp=new THREE.Vector3(),UP_Z=new THREE.Vector3(0,0,1);
function followSun(){
  const c=bridge()?.threeCamera;if(!sun||!c)return;
  // centre the shadow frustum ahead of the camera and snap it to shadow
  // texels so shadows don't shimmer while moving
  const fwd=sunForward;c.getWorldDirection(fwd);fwd.z=0;if(fwd.lengthSq()>1e-6)fwd.normalize();
  const centre=texel.copy(c.position).addScaledVector(fwd,SHADOW_RANGE_M*.45);centre.z=0;const step=SHADOW_RANGE_M*2/SHADOW_SIZE;
  // snap in light space (the shadow map's own texel grid), not world x/y
  lightRight.crossVectors(UP_Z,SUN_DIR);if(lightRight.lengthSq()<1e-6)lightRight.set(1,0,0);lightRight.normalize();lightUp.crossVectors(SUN_DIR,lightRight).normalize();
  const r=Math.round(centre.dot(lightRight)/step)*step,u=Math.round(centre.dot(lightUp)/step)*step,d=centre.dot(SUN_DIR);centre.copy(lightRight).multiplyScalar(r).addScaledVector(lightUp,u).addScaledVector(SUN_DIR,d);
  sun.target.position.copy(centre);sun.position.copy(centre).addScaledVector(SUN_DIR,400);sun.target.updateMatrixWorld();
}
// ---------------------------------------------------------------- day / night
// Short, game-paced cycle: ~5 min of day (sunrise, noon, golden hour), then
// ~3 min of moonlit night when the zombies come, then dawn. The night is cool
// blue moonlight with stars, never pitch black. ?time=day|night|dusk pins it.
export const DAY_S=300,NIGHT_S=180,CYCLE_S=DAY_S+NIGHT_S;
const dayNight={phase:.18,night:0,sunUp:1,isNight:false,clock:"",dayNumber:1};
let cycleStart=(typeof performance!=="undefined"?performance.now():0)-.18*DAY_S*1000,pinned=null,lastShadowRefresh=-Infinity,wasNight=false;
try{const q=new URLSearchParams(location.search).get("time");if(q==="night")pinned=DAY_S/CYCLE_S+.25*NIGHT_S/CYCLE_S;else if(q==="dusk")pinned=DAY_S/CYCLE_S-.02;else if(q==="day")pinned=.28;}catch{}
const C_SUN_NOON=new THREE.Color(0xfff2e0),C_SUN_LOW=new THREE.Color(0xff9a52),C_MOON=new THREE.Color(0xa9c0ff),C_HEMI_DAY=new THREE.Color(0xc4dcff),C_HEMI_NIGHT=new THREE.Color(0x40557e),C_GND_DAY=new THREE.Color(0x6b5e48),C_GND_NIGHT=new THREE.Color(0x1a1d26);
const C_FOG_DAY=new THREE.Color(STYLE_PALETTE.haze),C_FOG_DUSK=new THREE.Color(0xc79a7a),C_FOG_NIGHT=new THREE.Color(0x101828),tmpC=new THREE.Color(),moonDir=new THREE.Vector3();
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
function cyclePhase(now){if(pinned!==null)return pinned;const t=((now-cycleStart)/1000)%CYCLE_S;return(t<0?t+CYCLE_S:t)/CYCLE_S;}
function updateDayNight(now,scene,renderer){
  const ph=cyclePhase(now),dayFrac=DAY_S/CYCLE_S;
  // sun angle: 0..π during the day part, π..2π during the (shorter) night part
  const theta=ph<dayFrac?ph/dayFrac*Math.PI:Math.PI+(ph-dayFrac)/(1-dayFrac)*Math.PI;
  const sx=Math.cos(theta),sz=Math.sin(theta);const sunV=skyUniforms.uSun.value.set(-sx*.8,-.42-.2*sx,sz*.9+.02).normalize();
  moonDir.set(sx*.7,.38,Math.max(.32,-sz*.85)).normalize();skyUniforms.uMoon.value.copy(moonDir);
  const h=sunV.z,sunUp=smooth(-.06,.10,h),night=1-smooth(-.16,.04,h);
  skyUniforms.uNight.value=night;skyUniforms.uSunUp.value=sunUp;
  // key light: sun while it is up, then the moon
  const key=sunUp>.02?sunV:moonDir;if(SUN_DIR.dot(key)<.99996)SUN_DIR.copy(key); // move the shadow-casting light in 0.5° steps: no texel crawl / flicker between steps
  if(sun){const low=1-smooth(.05,.45,h);if(sunUp>.02){tmpC.copy(C_SUN_NOON).lerp(C_SUN_LOW,low);sun.color.copy(tmpC);sun.intensity=2.8*sunUp*(1-.35*low);}else{sun.color.copy(C_MOON);sun.intensity=.62*night;}}
  if(hemi){hemi.color.copy(C_HEMI_DAY).lerp(C_HEMI_NIGHT,night);hemi.groundColor.copy(C_GND_DAY).lerp(C_GND_NIGHT,night);hemi.intensity=.85-.45*night;}
  if(scene){const dusk=Math.max(0,1-Math.abs(h)*4)*(1-night*.6);if(scene.fog){scene.fog.color.copy(C_FOG_DAY).lerp(C_FOG_DUSK,dusk*.7).lerp(C_FOG_NIGHT,night);scene.fog.density=FOG_DENSITY*(1+.6*night);}
    if(scene.background?.isColor)scene.background.copy(scene.fog?scene.fog.color:C_FOG_DAY);if(scene.environment)scene.environmentIntensity=.9-.72*night;}
  if(renderer){renderer.toneMappingExposure=1+.38*night;if(now-lastShadowRefresh>220){lastShadowRefresh=now;renderer.shadowMap.needsUpdate=true;}}
  const hours=(theta/(2*Math.PI)*24+6)%24;dayNight.phase=ph;dayNight.night=night;dayNight.sunUp=sunUp;dayNight.isNight=night>.5;dayNight.clock=`${String(Math.floor(hours)).padStart(2,"0")}:${String(Math.floor(hours%1*60)).padStart(2,"0")}`;
  dayNight.toNight=Math.max(0,(dayFrac-.012-ph)*CYCLE_S);dayNight.toDay=ph>dayFrac?Math.max(0,(1-ph)*CYCLE_S):0;
  if(dayNight.isNight!==wasNight){wasNight=dayNight.isNight;if(!wasNight)dayNight.dayNumber++;try{window.dispatchEvent(new CustomEvent("arondight:day-night",{detail:{night:wasNight,day:dayNight.dayNumber}}));}catch{}}
  const v=viewport();if(v){const st=`${dayNight.clock}${dayNight.isNight?" night":" day"}`;if(v.dataset.dayNight!==st)v.dataset.dayNight=st;}
}
globalThis.__dayNight={get state(){return dayNight;},set(phase){pinned=Number.isFinite(phase)?((phase%1)+1)%1:null;},night(){pinned=DAY_S/CYCLE_S+.3*NIGHT_S/CYCLE_S;},day(){pinned=null;cycleStart=performance.now()-.18*DAY_S*1000;},skipTo(phase){pinned=null;cycleStart=performance.now()-phase*CYCLE_S*1000;}};
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
const ACTOR_CULL_M=260,CULL_INTERVAL_MS=600,cullPos=new THREE.Vector3();
const actorId=n=>String(n?.userData?.worldPopulationId||n?.userData?.worldLifeId||"");
function setLayer(root,on){root.traverse(n=>{if(on)n.layers.enable(0);else n.layers.disable(0);});}
function beginScan(scene){scanSceneRef=scene;scanStack.length=0;scanActors.length=0;scanStack.push(scene);}
function stepScan(deadline){
  while(scanStack.length&&performance.now()<deadline){
    const node=scanStack.pop();if(!node)continue;
    if((node.isDirectionalLight||node.isHemisphereLight||node.isAmbientLight)&&!node.userData.realLight&&(node.intensity>0||node.castShadow)){node.intensity=0;node.castShadow=false;}
    const id=actorId(node);if(id&&actorId(node.parent)!==id)scanActors.push(node);
    if(needsWork(node))queue.push(node);
    const children=node.children;for(let i=children.length-1;i>=0;i--)scanStack.push(children[i]);
  }
  if(!scanStack.length&&scanSceneRef){actorRoots=scanActors.slice();scanActors.length=0;scanSceneRef=null;return true;}return false;
}
function cullActors(now){
  if(now-lastCull<CULL_INTERVAL_MS)return;lastCull=now;const camera=bridge()?.threeCamera;if(!camera)return;let roots=0,culled=0;
  for(const n of actorRoots){if(!n?.parent)continue;const u=n.userData;roots++;n.getWorldPosition(cullPos);const far=cullPos.distanceTo(camera.position)>ACTOR_CULL_M;if(Boolean(u.styleCulled)!==far){u.styleCulled=far;setLayer(n,!far);}if(far)culled++;}
  const view=viewport();if(view){const s=`${roots}/${culled}`;if(view.dataset.stylePerfCull!==s)view.dataset.stylePerfCull=s;}
}
let blastAt=-1;
if(typeof window!=="undefined")window.addEventListener("arondight:nuke-impact",e=>{const p=e?.detail?.position,c=bridge()?.threeCamera;if(!Array.isArray(p)||!c)return;skyUniforms.uBlastDir.value.set(p[0]-c.position.x,p[1]-c.position.y,.2).normalize();blastAt=performance.now();});
function frame(now){
  const scene=bridge()?.threeScene;
  if(scene){
    const menuEl=document.getElementById("gameMenu"),covered=Boolean(menuEl&&!menuEl.hidden);
    styleScene(scene);updateDayNight(now,scene,bridge()?.threeRenderer);skyUniforms.uTime.value=now/1000;skyUniforms.uBlastAge.value=blastAt<0?-1:Math.min(60,(now-blastAt)/1000);
    // Never render the expensive off-screen procedural sky while an opaque menu
    // covers the whole WebGL view. The first visible game frame gets the same sky.
    if(!covered)try{bakeSky(bridge()?.threeRenderer,now,blastAt>=0&&now-blastAt<14000);}catch(e){console.warn("sky bake",e);}
    if(!scanStack.length&&!scanSceneRef&&now-lastScan>SCAN_INTERVAL_MS){lastScan=now;beginScan(scene);}
    const deadline=performance.now()+FRAME_BUDGET_MS;stepScan(deadline);
    if(!covered)cullActors(now);
    while(queue.length&&performance.now()<deadline){const node=queue.pop();if(node.parent)convert(node);}
    const view=viewport();if(view){const value=String(converted);if(view.dataset.stylizedMeshes!==value)view.dataset.stylizedMeshes=value;view.dataset.styleSceneScan="incremental-budgeted-v2";}
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
