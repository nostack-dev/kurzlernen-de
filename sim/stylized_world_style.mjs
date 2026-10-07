import * as THREE from "three";
import "./neon_ui_theme.mjs";
import "./emp_button_layout.mjs";
import {groundHeightAt,onTerrainChange} from "./terrain_craters.mjs";
import {patchShockMaterial} from "./nuke_shock_field.mjs";

// Stylized world look ("toon / cel"): bright, friendly, flat-shaded, no
// textures — and cheap. Every lit material keeps its own colour but its
// fragment shader is replaced by a tiny cel model that returns early:
//   * two-band sun term + hemisphere sky/ground ambient + soft rim light,
//   * optional emissive, linear fog into the sky colour,
//   * no PBR, no shadow maps, no light loops, no textures.
// The shader compiler drops the unused PBR code, so a MeshStandardMaterial
// costs about as much as MeshBasic. Shadow maps are switched off entirely
// (the shadow pass re-rendered the whole scene).
// The sky is a vertex-coloured dome (zenith → horizon) that follows the
// camera; fog fades the city into the horizon colour.

export const STYLIZED_STYLE_VERSION="synthwave-cel-v2";
// Synthwave night: deep violet sky fading into a hot pink horizon, cyan key
// light, magenta bounce, neon rim on every object.
export const STYLE_PALETTE=Object.freeze({
  skyZenith:0x07041a,skyMid:0x2a0c4e,skyHorizon:0xff3d8b,fog:0x3a1450,
  hemiSky:0x5a6cff,hemiGround:0xff2d95,sun:0x9fe8ff,rim:0xff4fd8,
  ground:0x150a26,grid:0xff2bd6,
});
const SUN_DIR=new THREE.Vector3(-.45,-.62,.64).normalize();
const FOG_NEAR=160,FOG_FAR=1150,GRID_SIZE_M=720,GRID_STEP_M=10;
const SCAN_INTERVAL_MS=300,FRAME_BUDGET_MS=2.5;

// Shared uniforms: every patched program reads the same objects.
export const toonUniforms={
  uToonSun:{value:SUN_DIR.clone()},
  uToonSky:{value:new THREE.Color(STYLE_PALETTE.hemiSky)},
  uToonGround:{value:new THREE.Color(STYLE_PALETTE.hemiGround)},
  uToonSunColor:{value:new THREE.Color(STYLE_PALETTE.sun)},
  uToonRim:{value:new THREE.Color(STYLE_PALETTE.rim)},
};

let installed=false,queue=[],lastScan=-Infinity,styledScene=null,sky=null,converted=0,lastCull=-Infinity;
const processed=new WeakSet();
const bridge=()=>globalThis.__arondightRealWorld||null;
const viewport=()=>document.getElementById("viewport");

const TEXTURE_SLOTS=["map","emissiveMap","aoMap","lightMap","bumpMap","normalMap","displacementMap","roughnessMap","metalnessMap","specularMap","envMap","gradientMap","matcap","clearcoatMap","sheenColorMap","alphaMap"];
export function stripTextures(material){let changed=false;for(const slot of TEXTURE_SLOTS)if(material[slot]){material[slot]=null;changed=true;}if(changed)material.needsUpdate=true;return changed;}

const TOON_MAIN=`
	{
		#ifdef FLAT_SHADED
			vec3 toonN=normalize(cross(dFdx(vViewPosition),dFdy(vViewPosition)));
		#else
			vec3 toonN=normalize(vNormal);
		#endif
		toonN*=gl_FrontFacing?1.0:-1.0;
		vec3 toonBase=diffuse;
		#ifdef USE_COLOR
			toonBase*=vColor.rgb;
		#endif
		vec3 toonSun=normalize((viewMatrix*vec4(uToonSun,0.0)).xyz);
		vec3 toonUp=normalize((viewMatrix*vec4(0.0,0.0,1.0,0.0)).xyz);
		float toonD=dot(toonN,toonSun);
		float toonBand=toonD>0.5?1.0:(toonD>0.05?0.74:0.5);
		float toonHemi=dot(toonN,toonUp)*0.5+0.5;
		vec3 toonAmb=mix(uToonGround,uToonSky,toonHemi);
		float toonRim=pow(1.0-max(dot(toonN,normalize(vViewPosition)),0.0),3.0);
		vec3 toonCol=toonBase*(toonAmb*0.42+uToonSunColor*toonBand*0.6)+toonRim*0.55*uToonRim;
		#ifdef TOON_EMISSIVE
			toonCol+=emissive;
		#endif
		#if defined(USE_FOG)&&!defined(FOG_EXP2)
			toonCol=mix(toonCol,fogColor,smoothstep(fogNear,fogFar,vFogDepth));
		#endif
		gl_FragColor=linearToOutputTexel(vec4(toonCol,opacity));
		return;
	}`;
const TOON_KINDS=new Set(["MeshStandardMaterial","MeshPhysicalMaterial","MeshLambertMaterial","MeshPhongMaterial","MeshToonMaterial"]);
function toonMaterial(material){
  if(processed.has(material))return;processed.add(material);stripTextures(material);
  if(!TOON_KINDS.has(material.type))return;
  const previous=material.onBeforeCompile,previousKey=material.customProgramCacheKey;
  material.onBeforeCompile=function(shader,renderer){
    previous?.call(this,shader,renderer);
    if(!/void\s+main\s*\(\s*\)\s*\{/.test(shader.fragmentShader)||!shader.fragmentShader.includes("vViewPosition"))return;
    Object.assign(shader.uniforms,toonUniforms);
    const emissive=/uniform\s+vec3\s+emissive\s*;/.test(shader.fragmentShader);
    shader.fragmentShader=(emissive?"#define TOON_EMISSIVE\n":"")+"uniform vec3 uToonSun;uniform vec3 uToonSky;uniform vec3 uToonGround;uniform vec3 uToonSunColor;uniform vec3 uToonRim;\n"+shader.fragmentShader.replace(/void\s+main\s*\(\s*\)\s*\{/,"void main() {"+TOON_MAIN);
  };
  material.customProgramCacheKey=function(){return `${previousKey?previousKey.call(this):""}|${STYLIZED_STYLE_VERSION}`;};
  material.needsUpdate=true;
}
function materialsOf(mesh){return(Array.isArray(mesh.material)?mesh.material:[mesh.material]).filter(Boolean);}
function skip(node){for(let n=node;n;n=n.parent){const u=n.userData||{};if(u.nukeWeaponPart||u.styleSkip||u.neonSkip||u.worldBuildingDepthOccluder||u.vsPeerHitProxy||u.vsCombatHitbox)return true;}return false;}
function convert(node){
  node.userData.stylized=STYLIZED_STYLE_VERSION;node.userData.stylizedMaterial=node.material;
  if(node.isSprite){for(const m of materialsOf(node))stripTextures(m);return;}
  if(!node.isMesh||skip(node))return;
  for(const m of materialsOf(node)){if(m.visible===false||m.colorWrite===false)continue;toonMaterial(m);}
  converted++;
}
function needsWork(node){return(node.isMesh||node.isSprite)&&(node.userData.stylized!==STYLIZED_STYLE_VERSION||node.userData.stylizedMaterial!==node.material);}

// Sky dome: two colours blended per vertex, follows the camera, drawn first.
function ensureSky(scene){
  if(sky?.parent===scene)return sky;
  const geometry=new THREE.SphereGeometry(1,32,24),pos=geometry.attributes.position,colors=new Float32Array(pos.count*3),zen=new THREE.Color(STYLE_PALETTE.skyZenith),mid=new THREE.Color(STYLE_PALETTE.skyMid),hor=new THREE.Color(STYLE_PALETTE.skyHorizon),c=new THREE.Color();
  // three's sphere is Y-up; the world is Z-up.
  geometry.rotateX(Math.PI/2);
  for(let i=0;i<pos.count;i++){const z=pos.getZ(i);if(z<0)c.copy(hor).lerp(new THREE.Color(STYLE_PALETTE.fog),Math.min(1,-z*4));else if(z<.18)c.copy(hor).lerp(mid,(z/.18)**.7);else c.copy(mid).lerp(zen,Math.min(1,(z-.18)/.55)**.8);colors[i*3]=c.r;colors[i*3+1]=c.g;colors[i*3+2]=c.b;}
  geometry.setAttribute("color",new THREE.BufferAttribute(colors,3));
  sky=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.BackSide,depthWrite:false,depthTest:false,fog:false,toneMapped:false}));
  sky.name="STYLIZED_SKY";sky.renderOrder=-10000;sky.frustumCulled=false;sky.userData.styleSkip=true;sky.userData.flightFireIgnore=true;sky.raycast=()=>{};sky.onBeforeRender=(r,s,camera)=>{sky.position.copy(camera.position);const far=Math.min(camera.far*.9,1800);sky.scale.setScalar(far);};
  scene.add(sky);return sky;
}
// Neon ground grid (synthwave floor), world-anchored and draped over the
// terrain craters; rebuilt when the camera moves 30 m. One draw call.
let grid=null,gridAnchor=[Infinity,Infinity];
function ensureGrid(scene){
  if(grid?.parent===scene)return grid;
  const material=patchShockMaterial(new THREE.LineBasicMaterial({color:STYLE_PALETTE.grid,vertexColors:true,transparent:true,opacity:.55,blending:THREE.AdditiveBlending,depthWrite:false,fog:true,toneMapped:false}));
  grid=new THREE.LineSegments(new THREE.BufferGeometry(),material);grid.name="SYNTH_GRID";grid.frustumCulled=false;grid.renderOrder=-5;grid.userData.styleSkip=true;grid.userData.flightFireIgnore=true;grid.raycast=()=>{};scene.add(grid);gridAnchor=[Infinity,Infinity];return grid;
}
let terrainVersion=0,gridTerrain=-1;onTerrainChange(()=>{terrainVersion++;});
function followGrid(){
  const camera=bridge()?.threeCamera;if(!grid||!camera)return;const cx=camera.position.x,cy=camera.position.y;
  if(Math.hypot(cx-gridAnchor[0],cy-gridAnchor[1])<30&&gridTerrain===terrainVersion)return;gridAnchor=[cx,cy];gridTerrain=terrainVersion;
  const half=GRID_SIZE_M/2,step=GRID_STEP_M,x0=Math.round((cx-half)/step)*step,y0=Math.round((cy-half)/step)*step,n=Math.round(GRID_SIZE_M/step),pos=[],col=[];
  const h=(x,y)=>groundHeightAt(x,y)+.04;
  for(let i=0;i<=n;i++){const f=i*step;for(let k=0;k<n;k++){const a=k*step,b=a+step;pos.push(x0+a,y0+f,h(x0+a,y0+f),x0+b,y0+f,h(x0+b,y0+f),x0+f,y0+a,h(x0+f,y0+a),x0+f,y0+b,h(x0+f,y0+b));}}
  for(let i=0;i<pos.length;i+=3){const d=Math.hypot(pos[i]-cx,pos[i+1]-cy),f=Math.max(0,1-d/half)**1.3;col.push(f,f,f);}
  const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));g.setAttribute("color",new THREE.Float32BufferAttribute(col,3));grid.geometry.dispose();grid.geometry=g;
}
function styleScene(scene){
  ensureSky(scene);ensureGrid(scene);followGrid();if(styledScene===scene)return;styledScene=scene;
  const horizon=new THREE.Color(STYLE_PALETTE.fog);scene.background=new THREE.Color(STYLE_PALETTE.skyZenith);
  if(scene.fog){scene.fog.color.copy(horizon);if(scene.fog.isFog){scene.fog.near=FOG_NEAR;scene.fog.far=FOG_FAR;}}else scene.fog=new THREE.Fog(horizon,FOG_NEAR,FOG_FAR);
  const renderer=bridge()?.threeRenderer;if(renderer){renderer.shadowMap.enabled=false;renderer.toneMapping=THREE.NoToneMapping;}
  scene.traverse(n=>{if(n.isMesh&&n.parent===scene&&n.geometry?.type==="BoxGeometry"&&(n.geometry.parameters?.width||0)>1000&&n.material?.color)n.material.color.set(STYLE_PALETTE.ground);});
}

// Performance: actors far away are dropped from the render layer (a few
// pixels tall). Layers instead of .visible so population code is never fought.
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
    styleScene(scene);cullActors(scene,now);
    if(!queue.length&&now-lastScan>SCAN_INTERVAL_MS){lastScan=now;scene.traverse(node=>{if(needsWork(node))queue.push(node);});}
    const menuEl=document.getElementById("gameMenu"),covered=Boolean(menuEl&&!menuEl.hidden),deadline=performance.now()+(covered?14:FRAME_BUDGET_MS);
    while(queue.length&&performance.now()<deadline){const node=queue.pop();if(node.parent)convert(node);}
    const view=viewport();if(view){const value=String(converted);if(view.dataset.stylizedMeshes!==value)view.dataset.stylizedMeshes=value;}
  }
  requestAnimationFrame(frame);
}
// Kept for modules that wait for the style pass to settle (auto_flight_start).
globalThis.__arondightNeonStyle={pending:()=>queue.length,lastScan:()=>lastScan};
globalThis.__arondightStylizedStyle={version:STYLIZED_STYLE_VERSION,palette:STYLE_PALETTE,uniforms:toonUniforms,pending:()=>queue.length};
export function installStylizedWorldStyle(){
  if(installed||typeof window==="undefined")return;installed=true;
  document.documentElement.classList.add("stylized-world");
  const view=viewport();if(view)view.dataset.visualStyle=STYLIZED_STYLE_VERSION;
  requestAnimationFrame(frame);
}
installStylizedWorldStyle();

// The MapLibre map is a data source only (never drawn); these exports stay
// for the modules that still call them.
export const NEON_BUILDING_EXTRUSION_COLOR="#d9cdb8";
export function applyNeonMapStyle(){return 0;}
