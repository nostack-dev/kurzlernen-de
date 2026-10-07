import * as THREE from "three";
import "./neon_ui_theme.mjs";
import "./emp_button_layout.mjs";

// Stylized "hero shooter" look (Fortnite-like): saturated but believable
// albedo, soft wrapped sun light, sky/ground bounce, fake ambient occlusion
// near the ground, a gentle sheen and rim, filmic tone curve and blue
// atmospheric haze; a painted sky with sun glow and puffy clouds.
// Cheap: every lit material gets a small custom fragment program that
// returns early (no PBR, no shadow maps, no light loops, no textures), so a
// MeshStandardMaterial costs about as much as MeshBasic.

export const STYLIZED_STYLE_VERSION="hero-stylized-v3";
export const STYLE_PALETTE=Object.freeze({
  skyZenith:0x2f7fe0,skyHorizon:0xcfe8ff,haze:0xb9d7f2,
  hemiSky:0xbfe0ff,hemiGround:0x8a7a5e,sun:0xfff1d6,
  ground:0x6fae4a,groundDark:0x5a9640,
});
const SUN_DIR=new THREE.Vector3(-.42,-.58,.7).normalize();
const FOG_NEAR=140,FOG_FAR=1300;
const SCAN_INTERVAL_MS=300,FRAME_BUDGET_MS=2.5;

export const toonUniforms={
  uToonSun:{value:SUN_DIR.clone()},
  uToonSky:{value:new THREE.Color(STYLE_PALETTE.hemiSky)},
  uToonGround:{value:new THREE.Color(STYLE_PALETTE.hemiGround)},
  uToonSunColor:{value:new THREE.Color(STYLE_PALETTE.sun)},
};

let installed=false,queue=[],lastScan=-Infinity,styledScene=null,sky=null,clouds=null,converted=0,lastCull=-Infinity;
const processed=new WeakSet();
const bridge=()=>globalThis.__arondightRealWorld||null;
const viewport=()=>document.getElementById("viewport");

const TEXTURE_SLOTS=["map","emissiveMap","aoMap","lightMap","bumpMap","normalMap","displacementMap","roughnessMap","metalnessMap","specularMap","envMap","gradientMap","matcap","clearcoatMap","sheenColorMap","alphaMap"];
export function stripTextures(material){let changed=false;for(const slot of TEXTURE_SLOTS)if(material[slot]){material[slot]=null;changed=true;}if(changed)material.needsUpdate=true;return changed;}

// Shared GLSL: filmic curve + light model. Used by the material patch below
// and by the city building shader (world_city_buildings.mjs).
export const STYLE_GLSL=`
vec3 heroFilmic(vec3 x){x*=1.06;vec3 c=(x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14);float l=dot(c,vec3(0.2126,0.7152,0.0722));return clamp(mix(vec3(l),c,1.12),0.0,1.0);}
vec3 heroLight(vec3 base,vec3 n,vec3 viewDir,vec3 sunV,vec3 upV,float ao,float sheen){
  float ndl=dot(n,sunV);
  float wrap=smoothstep(-0.18,0.62,ndl);
  float hemi=dot(n,upV)*0.5+0.5;
  vec3 amb=mix(uToonGround,uToonSky,hemi);
  vec3 h=normalize(sunV+viewDir);float spec=pow(max(dot(n,h),0.0),28.0)*sheen*step(0.0,ndl);
  float rim=pow(1.0-max(dot(n,viewDir),0.0),3.0)*(0.35+0.65*hemi);
  return base*(amb*0.52*ao+uToonSunColor*wrap*0.78*mix(0.8,1.0,ao))+uToonSunColor*spec*0.35+uToonSky*rim*0.14;
}`;
const TOON_MAIN=`
	{
		#ifdef FLAT_SHADED
			vec3 hN=normalize(cross(dFdx(vViewPosition),dFdy(vViewPosition)));
		#else
			vec3 hN=normalize(vNormal);
		#endif
		hN*=gl_FrontFacing?1.0:-1.0;
		vec3 hBase=diffuse;
		#ifdef USE_COLOR
			hBase*=vColor.rgb;
		#endif
		vec3 hView=normalize(vViewPosition);
		vec3 hSun=normalize((viewMatrix*vec4(uToonSun,0.0)).xyz);
		vec3 hUp=normalize((viewMatrix*vec4(0.0,0.0,1.0,0.0)).xyz);
		// world height of the fragment → fake ambient occlusion near the ground
		vec3 hWorld=cameraPosition+transpose(mat3(viewMatrix))*(-vViewPosition);
		float hAo=mix(0.62,1.0,smoothstep(0.0,2.2,hWorld.z));
		#ifdef HERO_SHEEN
			float hSheen=HERO_SHEEN;
		#else
			float hSheen=0.25;
		#endif
		vec3 hCol=heroLight(hBase,hN,hView,hSun,hUp,hAo,hSheen);
		#ifdef TOON_EMISSIVE
			hCol+=emissive;
		#endif
		hCol=heroFilmic(hCol);
		#if defined(USE_FOG)&&!defined(FOG_EXP2)
			hCol=mix(hCol,fogColor,smoothstep(fogNear,fogFar,vFogDepth)*0.92);
		#endif
		gl_FragColor=linearToOutputTexel(vec4(hCol,opacity));
		return;
	}`;
const TOON_KINDS=new Set(["MeshStandardMaterial","MeshPhysicalMaterial","MeshLambertMaterial","MeshPhongMaterial","MeshToonMaterial"]);
const UNIFORM_DECL="uniform vec3 uToonSun;uniform vec3 uToonSky;uniform vec3 uToonGround;uniform vec3 uToonSunColor;\n";
function heroMaterial(material){
  if(processed.has(material))return;processed.add(material);stripTextures(material);
  if(!TOON_KINDS.has(material.type))return;
  const previous=material.onBeforeCompile,previousKey=material.customProgramCacheKey;
  const sheen=material.type==="MeshStandardMaterial"||material.type==="MeshPhysicalMaterial"?Math.max(0,Math.min(1,(1-(material.roughness??1))*1.2+(material.metalness??0)*.4)):material.type==="MeshPhongMaterial"?.5:.12;
  material.onBeforeCompile=function(shader,renderer){
    previous?.call(this,shader,renderer);
    if(!/void\s+main\s*\(\s*\)\s*\{/.test(shader.fragmentShader)||!shader.fragmentShader.includes("vViewPosition"))return;
    Object.assign(shader.uniforms,toonUniforms);
    const emissive=/uniform\s+vec3\s+emissive\s*;/.test(shader.fragmentShader);
    shader.fragmentShader=(emissive?"#define TOON_EMISSIVE\n":"")+`#define HERO_SHEEN ${sheen.toFixed(3)}\n`+UNIFORM_DECL+STYLE_GLSL+shader.fragmentShader.replace(/void\s+main\s*\(\s*\)\s*\{/,"void main() {"+TOON_MAIN);
  };
  material.customProgramCacheKey=function(){return `${previousKey?previousKey.call(this):""}|${STYLIZED_STYLE_VERSION}|${sheen.toFixed(2)}`;};
  material.needsUpdate=true;
}
// The big ground box: grass with large soft colour variation (procedural
// value noise in world space — no texture), darker in "fields".
function grassGround(material){
  if(material.userData.heroGround)return;material.userData.heroGround=true;material.color.set(STYLE_PALETTE.ground);
  const previous=material.onBeforeCompile;
  material.onBeforeCompile=function(shader,renderer){previous?.call(this,shader,renderer);
    shader.fragmentShader=shader.fragmentShader.replace("vec3 hBase=diffuse;",`vec3 hBase=diffuse;{
      vec3 gw=cameraPosition+transpose(mat3(viewMatrix))*(-vViewPosition);
      vec2 p=gw.xy*0.018;vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
      float a=fract(sin(dot(i,vec2(127.1,311.7)))*43758.55),b=fract(sin(dot(i+vec2(1,0),vec2(127.1,311.7)))*43758.55),c=fract(sin(dot(i+vec2(0,1),vec2(127.1,311.7)))*43758.55),d=fract(sin(dot(i+vec2(1,1),vec2(127.1,311.7)))*43758.55);
      float nz=mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
      float fine=fract(sin(dot(floor(gw.xy*0.35),vec2(12.99,78.23)))*43758.5);
      hBase*=mix(vec3(0.84,0.9,0.78),vec3(1.08,1.05,0.92),nz)*(0.96+0.06*fine);
    }`);};
  const key=material.customProgramCacheKey;material.customProgramCacheKey=function(){return `${key?key.call(this):""}|grass-v1`;};material.needsUpdate=true;
}
function materialsOf(mesh){return(Array.isArray(mesh.material)?mesh.material:[mesh.material]).filter(Boolean);}
function skip(node){for(let n=node;n;n=n.parent){const u=n.userData||{};if(u.nukeWeaponPart||u.styleSkip||u.neonSkip||u.worldBuildingDepthOccluder||u.vsPeerHitProxy||u.vsCombatHitbox)return true;}return false;}
function convert(node){
  node.userData.stylized=STYLIZED_STYLE_VERSION;node.userData.stylizedMaterial=node.material;
  if(node.isSprite){for(const m of materialsOf(node))stripTextures(m);return;}
  if(!node.isMesh||skip(node))return;
  for(const m of materialsOf(node)){if(m.visible===false||m.colorWrite===false)continue;heroMaterial(m);}
  converted++;
}
function needsWork(node){return(node.isMesh||node.isSprite)&&(node.userData.stylized!==STYLIZED_STYLE_VERSION||node.userData.stylizedMaterial!==node.material);}

// Painted sky: zenith → horizon gradient with a warm sun glow, computed per
// pixel on a dome that follows the camera.
function ensureSky(scene){
  if(sky?.parent===scene)return sky;
  const geometry=new THREE.SphereGeometry(1,32,16);geometry.rotateX(Math.PI/2);
  const material=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,depthTest:false,fog:false,toneMapped:false,
    uniforms:{uZen:{value:new THREE.Color(STYLE_PALETTE.skyZenith)},uHor:{value:new THREE.Color(STYLE_PALETTE.skyHorizon)},uSun:{value:SUN_DIR.clone()}},
    vertexShader:"varying vec3 vDir;void main(){vDir=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
    fragmentShader:`uniform vec3 uZen;uniform vec3 uHor;uniform vec3 uSun;varying vec3 vDir;void main(){vec3 d=normalize(vDir);float h=clamp(d.z,0.0,1.0);
      vec3 c=mix(uHor,uZen,pow(h,0.55));float s=max(dot(d,normalize(uSun)),0.0);c+=vec3(1.0,0.86,0.6)*(pow(s,9.0)*0.35+pow(s,600.0)*2.0);
      c=mix(c,uHor*0.96,smoothstep(0.0,-0.25,d.z));gl_FragColor=linearToOutputTexel(vec4(c,1.0));}`});
  sky=new THREE.Mesh(geometry,material);sky.name="HERO_SKY";sky.renderOrder=-10000;sky.frustumCulled=false;sky.userData.styleSkip=true;sky.userData.flightFireIgnore=true;sky.raycast=()=>{};
  sky.onBeforeRender=(r,s,camera)=>{sky.position.copy(camera.position);sky.scale.setScalar(Math.min(camera.far*.9,1800));};
  scene.add(sky);return sky;
}
// Puffy clouds: a few instanced low-poly blobs on a ring far away, drifting.
function ensureClouds(scene){
  if(clouds?.parent===scene)return clouds;
  const blob=new THREE.IcosahedronGeometry(1,1),count=14*6,mesh=new THREE.InstancedMesh(blob,new THREE.MeshLambertMaterial({color:0xffffff,emissive:0x8899aa,fog:false}),count),m=new THREE.Matrix4(),q=new THREE.Quaternion(),p=new THREE.Vector3(),s=new THREE.Vector3();let k=0;
  for(let c=0;c<14;c++){const a=c/14*Math.PI*2+Math.random()*.3,r=900+Math.random()*250,cx=Math.cos(a)*r,cy=Math.sin(a)*r,cz=170+Math.random()*120,size=40+Math.random()*35;
    for(let b=0;b<6;b++){p.set(cx+(b-2.5)*size*.55+Math.random()*10,cy+(Math.random()-.5)*size*.6,cz+(b%2)*size*.2);const sc=size*(.55+Math.random()*.45)*(b===2||b===3?1.25:1);s.set(sc,sc*.8,sc*.62);m.compose(p,q,s);mesh.setMatrixAt(k++,m);}}
  mesh.instanceMatrix.needsUpdate=true;mesh.frustumCulled=false;mesh.renderOrder=-9990;mesh.userData.flightFireIgnore=true;mesh.raycast=()=>{};mesh.name="HERO_CLOUDS";
  clouds=new THREE.Group();clouds.add(mesh);clouds.userData.flightFireIgnore=true;
  clouds.onBeforeRender=()=>{};scene.add(clouds);return clouds;
}
function followSky(now){const c=bridge()?.threeCamera;if(clouds&&c){clouds.position.set(c.position.x,c.position.y,0);clouds.rotation.z=now*.0000035;}}
function styleScene(scene){
  ensureSky(scene);ensureClouds(scene);if(styledScene===scene)return;styledScene=scene;
  const haze=new THREE.Color(STYLE_PALETTE.haze);scene.background=new THREE.Color(STYLE_PALETTE.skyHorizon);
  if(scene.fog){scene.fog.color.copy(haze);if(scene.fog.isFog){scene.fog.near=FOG_NEAR;scene.fog.far=FOG_FAR;}}else scene.fog=new THREE.Fog(haze,FOG_NEAR,FOG_FAR);
  const renderer=bridge()?.threeRenderer;if(renderer){renderer.shadowMap.enabled=false;renderer.toneMapping=THREE.NoToneMapping;}
  scene.traverse(n=>{if(n.isMesh&&n.parent===scene&&n.geometry?.type==="BoxGeometry"&&(n.geometry.parameters?.width||0)>1000&&n.material?.color){heroMaterial(n.material);grassGround(n.material);}});
}

// Performance: actors far away leave the render layer (a few pixels tall).
const ACTOR_CULL_M=260,CULL_INTERVAL_MS=400,cullPos=new THREE.Vector3();
function setLayer(root,on){root.traverse(n=>{if(on)n.layers.enable(0);else n.layers.disable(0);});}
function cullActors(scene,now){
  if(now-lastCull<CULL_INTERVAL_MS)return;lastCull=now;const camera=bridge()?.threeCamera;if(!camera)return;let roots=0,culled=0;
  const actorId=n=>String(n?.userData?.worldPopulationId||n?.userData?.worldLifeId||"");
  scene.traverse(n=>{const id=actorId(n);if(!id||actorId(n.parent)===id)return;const u=n.userData;roots++;n.getWorldPosition(cullPos);const far=cullPos.distanceTo(camera.position)>ACTOR_CULL_M;if(Boolean(u.styleCulled)!==far){u.styleCulled=far;setLayer(n,!far);}if(far)culled++;});
  const view=viewport();if(view){const s=`${roots}/${culled}`;if(view.dataset.stylePerfCull!==s)view.dataset.stylePerfCull=s;}
}
function frame(now){
  const scene=bridge()?.threeScene;
  if(scene){
    styleScene(scene);followSky(now);cullActors(scene,now);
    if(!queue.length&&now-lastScan>SCAN_INTERVAL_MS){lastScan=now;scene.traverse(node=>{if(needsWork(node))queue.push(node);});}
    const menuEl=document.getElementById("gameMenu"),covered=Boolean(menuEl&&!menuEl.hidden),deadline=performance.now()+(covered?14:FRAME_BUDGET_MS);
    while(queue.length&&performance.now()<deadline){const node=queue.pop();if(node.parent)convert(node);}
    const view=viewport();if(view){const value=String(converted);if(view.dataset.stylizedMeshes!==value)view.dataset.stylizedMeshes=value;}
  }
  requestAnimationFrame(frame);
}
globalThis.__arondightNeonStyle={pending:()=>queue.length,lastScan:()=>lastScan};
globalThis.__arondightStylizedStyle={version:STYLIZED_STYLE_VERSION,palette:STYLE_PALETTE,uniforms:toonUniforms,pending:()=>queue.length};
export function installStylizedWorldStyle(){
  if(installed||typeof window==="undefined")return;installed=true;
  document.documentElement.classList.add("stylized-world");
  const view=viewport();if(view)view.dataset.visualStyle=STYLIZED_STYLE_VERSION;
  requestAnimationFrame(frame);
}
installStylizedWorldStyle();

export const NEON_BUILDING_EXTRUSION_COLOR="#d9cdb8";
export function applyNeonMapStyle(){return 0;}
