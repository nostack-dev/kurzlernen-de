import * as THREE from "three";

// Cheap neon bloom for the synthwave look. The main scene render is
// redirected into an offscreen target; only the bright parts (neon lines,
// lit windows, explosions) are extracted at quarter resolution, blurred in
// two small levels (1/4 and 1/8) and added back in one full-screen pass.
// Cost ≈ one extra full-screen pass + tiny low-res passes.
// Guarded by the frame time: if the device can't keep up it switches itself
// off for the session (performance first).

export const NEON_BLOOM_VERSION="quarter-res-two-level-bloom-v2-crisp";
const DISABLE_FRAME_MS=27,DISABLE_AFTER_MS=3500,STRENGTH_NEAR=.13,STRENGTH_WIDE=.08,THRESHOLD=.88;

let installed=false,enabled=true,state=null,slowSince=0,frameAvg=16,lastFrameAt=0;
const bridge=()=>globalThis.__arondightRealWorld||null;

const VERT="varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}";
function pass(fragmentShader,uniforms,toneMapped=false){return new THREE.ShaderMaterial({vertexShader:VERT,fragmentShader,uniforms,depthTest:false,depthWrite:false,toneMapped});}
function makeState(renderer){
  const target=opts=>new THREE.WebGLRenderTarget(1,1,{depthBuffer:false,stencilBuffer:false,...opts});
  const quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2)),scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);quad.frustumCulled=false;scene.add(quad);
  const s={renderer,quad,scene,camera,size:new THREE.Vector2(),
    main:new THREE.WebGLRenderTarget(1,1,{depthBuffer:true,stencilBuffer:false,type:THREE.HalfFloatType}),a1:target(),b1:target(),a2:target(),b2:target(),
    bright:pass(`uniform sampler2D tSrc;uniform float uThreshold;varying vec2 vUv;void main(){vec3 c=texture2D(tSrc,vUv).rgb;float m=max(c.r,max(c.g,c.b));gl_FragColor=vec4(c*smoothstep(uThreshold,uThreshold+.35,m),1.0);}`,{tSrc:{value:null},uThreshold:{value:THRESHOLD}}),
    blur:pass(`uniform sampler2D tSrc;uniform vec2 uDir;varying vec2 vUv;void main(){vec3 c=texture2D(tSrc,vUv).rgb*.2270;c+=texture2D(tSrc,vUv+uDir*1.3846).rgb*.3162;c+=texture2D(tSrc,vUv-uDir*1.3846).rgb*.3162;c+=texture2D(tSrc,vUv+uDir*3.2308).rgb*.0703;c+=texture2D(tSrc,vUv-uDir*3.2308).rgb*.0703;gl_FragColor=vec4(c,1.0);}`,{tSrc:{value:null},uDir:{value:new THREE.Vector2()}}),
    copy:pass(`uniform sampler2D tSrc;varying vec2 vUv;void main(){gl_FragColor=vec4(texture2D(tSrc,vUv).rgb,1.0);}`,{tSrc:{value:null}}),
    combine:pass(`uniform sampler2D tScene;uniform sampler2D tB1;uniform sampler2D tB2;uniform float uS1;uniform float uS2;varying vec2 vUv;void main(){vec3 c=texture2D(tScene,vUv).rgb+texture2D(tB1,vUv).rgb*uS1+texture2D(tB2,vUv).rgb*uS2;gl_FragColor=vec4(c,1.0);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`,{tScene:{value:null},tB1:{value:null},tB2:{value:null},uS1:{value:STRENGTH_NEAR},uS2:{value:STRENGTH_WIDE}},true),
  };
  return s;
}
function resize(s){
  s.renderer.getDrawingBufferSize(s.size);const w=Math.max(1,s.size.x|0),h=Math.max(1,s.size.y|0);
  if(s.main.width===w&&s.main.height===h)return;
  s.main.setSize(w,h);const q=[Math.max(1,w>>2),Math.max(1,h>>2)],e=[Math.max(1,w>>3),Math.max(1,h>>3)];s.a1.setSize(...q);s.b1.setSize(...q);s.a2.setSize(...e);s.b2.setSize(...e);
}
function draw(s,material,target){s.quad.material=material;s.renderer.setRenderTarget(target);s.renderer.render(s.scene,s.camera);}
function blur(s,src,tmp,w,h){s.blur.uniforms.tSrc.value=src.texture;s.blur.uniforms.uDir.value.set(1/w,0);draw(s,s.blur,tmp);s.blur.uniforms.tSrc.value=tmp.texture;s.blur.uniforms.uDir.value.set(0,1/h);draw(s,s.blur,src);}

function trackFrame(now){
  if(lastFrameAt){const dt=now-lastFrameAt;if(dt<200)frameAvg+=(dt-frameAvg)*.05;}lastFrameAt=now;
  if(document.hidden){slowSince=0;return;}
  if(frameAvg>DISABLE_FRAME_MS){slowSince||=now;if(now-slowSince>DISABLE_AFTER_MS){enabled=false;const v=document.getElementById("viewport");if(v)v.dataset.neonBloom="off-slow-device";}}else slowSince=0;
}
function install(renderer){
  if(installed||!renderer)return;installed=true;
  const original=renderer.render.bind(renderer);let inside=false;
  renderer.render=function(scene,camera){
    const main=bridge()?.threeScene;
    if(inside||!enabled||globalThis.__stereoSBS?.active||scene!==main||renderer.getRenderTarget()!==null||renderer.xr?.isPresenting)return original(scene,camera);
    inside=true;
    try{
      state??=makeState(renderer);const s=state;resize(s);trackFrame(performance.now());
      renderer.setRenderTarget(s.main);renderer.clear();original(scene,camera);
      const autoClear=renderer.autoClear;renderer.autoClear=true;
      s.bright.uniforms.tSrc.value=s.main.texture;draw(s,s.bright,s.a1);
      blur(s,s.a1,s.b1,s.a1.width,s.a1.height);
      s.copy.uniforms.tSrc.value=s.a1.texture;draw(s,s.copy,s.a2);
      blur(s,s.a2,s.b2,s.a2.width,s.a2.height);
      s.combine.uniforms.tScene.value=s.main.texture;s.combine.uniforms.tB1.value=s.a1.texture;s.combine.uniforms.tB2.value=s.a2.texture;
      draw(s,s.combine,null);renderer.autoClear=autoClear;
    }catch(error){enabled=false;console.warn("neon bloom disabled",error);renderer.setRenderTarget(null);original(scene,camera);}
    finally{inside=false;}
  };
  const v=document.getElementById("viewport");if(v)v.dataset.neonBloom=NEON_BLOOM_VERSION;
}
function wait(){const r=bridge()?.threeRenderer;if(r)install(r);else requestAnimationFrame(wait);}
if(typeof window!=="undefined"&&!/[?&]nobloom=1/.test(location.search))requestAnimationFrame(wait);
// the offscreen target the scene really renders into while bloom is on (shader prewarm compiles for it)
globalThis.__arondightNeonBloom={get target(){if(!enabled)return null;const r=bridge()?.threeRenderer;if(!state&&r)state=makeState(r);if(state)resize(state);return state?.main||null;},get enabled(){return enabled;},set enabled(v){enabled=Boolean(v);},version:NEON_BLOOM_VERSION};
