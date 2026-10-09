import * as THREE from "three";
// Shader prewarm: no first-use shader stalls in the middle of the action.
//
// WebGL compiles a material's program the first time it is drawn — a nuke,
// a police raid, the first ragdoll or explosion then freezes the frame while
// dozens of programs compile. Shortly after the game starts (and once more a
// bit later, when pools exist) this module
//   1. asks effect modules for representative objects (registered factories:
//      nuke fireball/shock rings, police cruiser, jets, ragdolls, sandbox
//      enemies …) and puts them, tiny and far below the world, into the scene,
//   2. makes every hidden pooled object visible for one compile call,
//   3. compiles everything with renderer.compileAsync (parallel compile where
//      the browser supports it), then restores visibility and removes the
//      samples. Nothing is drawn in between, so nothing flickers.
// Modules register with:  (globalThis.__prewarmFactories??=[]).push(() => object3D)

// The extra variants (side x fog clones, sprite/point families: ~180
// programs) are NOT compiled in one go — that froze slow phones for seconds
// right after the start. They trickle in, a few objects per idle slot,
// compiled against the main scene's lights and fog (same program keys).
// Where programs are compiled: only for the target the scene is really drawn into (the bloom
// target, which is now the constant output path; the screen only while side-by-side stereo is
// on). Compiling the screen variants as well doubled the work for programs never used.
// When: the main pass runs while the start menu is still up (nothing to interrupt). Runs and
// the variant trickle during play only happen where the GPU compiles in parallel
// (KHR_parallel_shader_compile); without it every compile blocks the frame — a constant
// trickle of them was a constant stutter.
export const SHADER_PREWARM_VERSION="compileAsync-v5-real-target+menu-time+parallel-only-trickle";
function parallelCompile(renderer){try{return Boolean(renderer?.extensions?.has?.("KHR_parallel_shader_compile"));}catch{return false;}}
function targets(renderer){const bloom=globalThis.__arondightNeonBloom?.target||null,out=[];if(bloom)out.push(bloom);if(!bloom||globalThis.__stereoSBS?.active)out.push(null);return out;}
const TRICKLE_BATCH=2,TRICKLE_GAP_MS=180;let trickleQueue=[],trickling=false;
function idle(fn){setTimeout(()=>{if(typeof requestIdleCallback==="function")requestIdleCallback(fn,{timeout:600});else fn();},TRICKLE_GAP_MS);}
function trickle(){
  if(trickling||!trickleQueue.length)return;if(!parallelCompile(bridge()?.threeRenderer)){trickleQueue.length=0;return;}trickling=true;
  idle(async()=>{const b=bridge(),renderer=b?.threeRenderer,scene=b?.threeScene,camera=b?.threeCamera;
    try{if(renderer&&scene&&camera){const batch=trickleQueue.splice(0,TRICKLE_BATCH),g=new THREE.Group();for(const o of batch)g.add(o);g.updateMatrixWorld(true);
      const compile=()=>typeof renderer.compileAsync==="function"?renderer.compileAsync(g,camera,scene):(renderer.compile(g,camera,scene),Promise.resolve());
      const prev=renderer.getRenderTarget(),jobs=[];try{for(const t of targets(renderer)){renderer.setRenderTarget(t);jobs.push(compile());}}finally{renderer.setRenderTarget(prev);}
      await Promise.all(jobs.map(j=>j.catch(()=>{})));const v=document.getElementById("viewport");if(v){v.dataset.shaderPrewarmTrickle=String(trickleQueue.length);v.dataset.shaderPrewarmPrograms2=String(renderer.info.programs?.length||0);}}}
    catch(e){console.warn("prewarm trickle",e);}finally{trickling=false;if(trickleQueue.length)trickle();}});
}
const bridge=()=>globalThis.__arondightRealWorld||null;
let runs=0,busy=false;

let tex=null,pg=null;
function basicFamilies(){
  const g=new THREE.Group();g.name="PREWARM_FAMILIES";
  if(!tex){tex=new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1);tex.needsUpdate=true;}
  if(!pg){pg=new THREE.BufferGeometry();pg.setAttribute("position",new THREE.Float32BufferAttribute([0,0,0],3));pg.setAttribute("color",new THREE.Float32BufferAttribute([1,1,1],3));}
  for(const fog of[true,false])for(const toneMapped of[true,false]){
    for(const map of[null,tex])g.add(new THREE.Sprite(new THREE.SpriteMaterial({map,transparent:true,depthWrite:false,fog,toneMapped})));
    for(const vertexColors of[false,true])for(const sizeAttenuation of[true,false])g.add(new THREE.Points(pg,new THREE.PointsMaterial({size:.1,vertexColors,sizeAttenuation,transparent:true,depthWrite:false,fog,toneMapped})));}
  g.traverse(n=>{n.frustumCulled=false;});return g;}
async function prewarm(reason){
  const b=bridge(),renderer=b?.threeRenderer,scene=b?.threeScene,camera=b?.threeCamera;if(!renderer||!scene||!camera||busy)return false;busy=true;const t0=performance.now();
  let samples=0;
  try{
    // 1. samples from the effect modules
    const objs=[];for(const f of globalThis.__prewarmFactories||[]){try{const o=f();if(o)objs.push(o);}catch(e){console.warn("prewarm factory",e);}}
    // sprite / point pools (smoke puffs, sparks, blood) are created lazily on
    // their first use: compile their program families up front
    // effects flip material.side (camera inside a shock sphere) and fog at run time: those variants (and the
    // sprite/point families) are queued for the trickle compile below (once)
    const extras=[];const seen=new Set(),keys=new Set();let nv=0;
    // many clones end in the same program: compile each combination once
    const progKey=(n,m,side,fog)=>[m.type,side,fog,!!m.map,!!m.alphaMap,!!m.envMap,m.vertexColors,m.transparent,m.alphaTest>0,m.toneMapped,m.flatShading,m.sizeAttenuation,m.dashed,m.worldUnits,m.customProgramCacheKey?.()||"",m.onBeforeCompile&&String(m.onBeforeCompile).length,m.defines?JSON.stringify(m.defines):"",m.vertexShader?.length||0,m.fragmentShader?.length||0,!!n.isInstancedMesh,!!n.isSkinnedMesh,!!n.geometry?.attributes?.color,!!n.geometry?.morphAttributes?.position].join("|");
    for(const o of objs)o.traverse?.(n=>{const mats=Array.isArray(n.material)?n.material:n.material?[n.material]:[];if(!(n.isMesh||n.isSprite||n.isPoints||n.isLine||n.isLineSegments))return;for(const m of mats){if(!m||seen.has(m.uuid)||nv>240)continue;seen.add(m.uuid);
      for(const side of[THREE.FrontSide,THREE.BackSide,THREE.DoubleSide])for(const fog of[true,false]){if(side===m.side&&fog===m.fog)continue;if(n.isSprite&&side!==m.side)continue;const pk=progKey(n,m,side,fog);if(keys.has(pk))continue;keys.add(pk);let c;try{c=m.clone();}catch{continue;}c.side=side;c.fog=fog;let v;try{v=n.isSprite?new THREE.Sprite(c):new n.constructor(n.geometry,c);}catch{continue;}v.frustumCulled=false;extras.push(v);nv++;}}});
    if(runs===0){for(const f of basicFamilies().children.slice())extras.push(f);trickleQueue.push(...extras);}
    const added=[];for(const o of objs){o.position.z-=4000;o.scale?.multiplyScalar?.(.01);o.traverse?.(n=>{n.frustumCulled=false;});scene.add(o);added.push(o);samples++;}
    // 2. hidden pooled objects visible for the compile
    // (lights keep their real on/off state: the light count is part of every program)
    const effVisible=n=>{for(let o=n;o;o=o.parent)if(o.visible===false)return false;return true;};const darkLights=[];scene.traverse(n=>{if(n.isLight&&!effVisible(n))darkLights.push(n);});
    const flipped=[];scene.traverse(n=>{if(n.visible===false&&n!==scene&&!n.isLight){n.visible=true;flipped.push(n);}});const lightsOff=[];for(const l of darkLights)if(l.visible){l.visible=false;lightsOff.push(l);}
    const before=renderer.info.programs?.length||0;
    // 3. compile (async where KHR_parallel_shader_compile exists)
    // A program depends on where it is drawn: the screen (sRGB + tone mapping)
    // or the bloom target the scene really renders into while bloom is on
    // (linear, no tone mapping). Compile for both, else every effect compiles
    // again on first use (the nuke stutter: ~24 programs at impact).
    const compile=()=>typeof renderer.compileAsync==="function"?renderer.compileAsync(scene,camera):(renderer.compile(scene,camera),Promise.resolve());
    const prevTarget=renderer.getRenderTarget();const jobs=[];
    try{for(const t of targets(renderer)){renderer.setRenderTarget(t);jobs.push(compile());}}finally{renderer.setRenderTarget(prevTarget);}
    const p=Promise.all(jobs.map(j=>j.catch(()=>{})));
    for(const n of flipped)n.visible=false;for(const l of lightsOff)l.visible=true;
    await p.catch(()=>{});
    for(const o of added)o.parent?.remove(o);
    const after=renderer.info.programs?.length||0,v=document.getElementById("viewport");runs++;
    if(v){v.dataset.shaderPrewarm=SHADER_PREWARM_VERSION;v.dataset.shaderPrewarmRuns=String(runs);v.dataset.shaderPrewarmPrograms=`${before}->${after}`;v.dataset.shaderPrewarmSamples=String(samples);v.dataset.shaderPrewarmMs=String(Math.round(performance.now()-t0));v.dataset.shaderPrewarmReason=reason;}
    trickle();return true;
  }finally{busy=false;}
}
export function installShaderPrewarm(){
  if(globalThis.__shaderPrewarm||typeof window==="undefined")return;
  globalThis.__shaderPrewarm={run:prewarm,version:SHADER_PREWARM_VERSION};
  // main pass while the start menu is up: as soon as the simulator is ready
  const menuTime=()=>{const st=document.getElementById("status")?.textContent||"";if(!st.includes("SIM ready")||!bridge()?.threeRenderer)return setTimeout(menuTime,250);setTimeout(()=>prewarm("menu"),400);};menuTime();
  // pools created on first use during play: a second pass only where compiling is parallel
  window.addEventListener("arondight:game-start",()=>setTimeout(()=>{if(parallelCompile(bridge()?.threeRenderer))prewarm("start+14s");},14000),{once:true});
}
installShaderPrewarm();
