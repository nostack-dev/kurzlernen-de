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

export const SHADER_PREWARM_VERSION="force-visible-compileAsync-v1";
const bridge=()=>globalThis.__arondightRealWorld||null;
let runs=0,busy=false;

async function prewarm(reason){
  const b=bridge(),renderer=b?.threeRenderer,scene=b?.threeScene,camera=b?.threeCamera;if(!renderer||!scene||!camera||busy)return false;busy=true;const t0=performance.now();
  let samples=0;
  try{
    // 1. samples from the effect modules
    const objs=[];for(const f of globalThis.__prewarmFactories||[]){try{const o=f();if(o)objs.push(o);}catch(e){console.warn("prewarm factory",e);}}
    const added=[];for(const o of objs){o.position.z-=4000;o.scale?.multiplyScalar?.(.01);o.traverse?.(n=>{n.frustumCulled=false;});scene.add(o);added.push(o);samples++;}
    // 2. hidden pooled objects visible for the compile
    // (lights keep their real on/off state: the light count is part of every program)
    const effVisible=n=>{for(let o=n;o;o=o.parent)if(o.visible===false)return false;return true;};const darkLights=[];scene.traverse(n=>{if(n.isLight&&!effVisible(n))darkLights.push(n);});
    const flipped=[];scene.traverse(n=>{if(n.visible===false&&n!==scene&&!n.isLight){n.visible=true;flipped.push(n);}});const lightsOff=[];for(const l of darkLights)if(l.visible){l.visible=false;lightsOff.push(l);}
    const before=renderer.info.programs?.length||0;
    // 3. compile (async where KHR_parallel_shader_compile exists)
    const p=typeof renderer.compileAsync==="function"?renderer.compileAsync(scene,camera):(renderer.compile(scene,camera),Promise.resolve());
    for(const n of flipped)n.visible=false;for(const l of lightsOff)l.visible=true;
    await p.catch(()=>{});
    for(const o of added)o.parent?.remove(o);
    const after=renderer.info.programs?.length||0,v=document.getElementById("viewport");runs++;
    if(v){v.dataset.shaderPrewarm=SHADER_PREWARM_VERSION;v.dataset.shaderPrewarmRuns=String(runs);v.dataset.shaderPrewarmPrograms=`${before}->${after}`;v.dataset.shaderPrewarmSamples=String(samples);v.dataset.shaderPrewarmMs=String(Math.round(performance.now()-t0));v.dataset.shaderPrewarmReason=reason;}
    return true;
  }finally{busy=false;}
}
export function installShaderPrewarm(){
  if(globalThis.__shaderPrewarm||typeof window==="undefined")return;
  globalThis.__shaderPrewarm={run:prewarm,version:SHADER_PREWARM_VERSION};
  const schedule=()=>{setTimeout(()=>prewarm("start+3s"),3000);setTimeout(()=>prewarm("start+14s"),14000);};
  window.addEventListener("arondight:game-start",schedule,{once:true});
  // fallback when the menu is skipped
  setTimeout(()=>{if(!runs)prewarm("load+25s");},25000);
}
installShaderPrewarm();
