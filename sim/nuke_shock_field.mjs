// no three.js import: the field is also read headless by the terrain physics;
// the uniform only needs x,y,z,w (three uploads any {x,y,z,w} as a vec4)
class Vec4{constructor(x=0,y=0,z=0,w=0){this.x=x;this.y=y;this.z=z;this.w=w;this.isVector4=true;}set(x,y,z,w){this.x=x;this.y=y;this.z=z;this.w=w;return this;}}

// The nuke's pressure wave as a field the whole world reacts to. One set of
// uniforms (centre, front radius, heave height, glow) drives a vertex
// displacement that every patched material shares: the ground grid heaves
// up and rolls outward like a wave, the city lifts and drops as the front
// passes under it, and the lines flare where the front is. No textures —
// only geometry moving and line colour.
//
// Front speed is the same 343 m/s that nuke_destruction.mjs uses, so the
// visible wave and the buildings being torn away stay in lock-step.

export const SHOCK_FIELD_VERSION="ground-heave-shock-field-v1";
export const SHOCK_SPEED_MPS=343;
const MAX_RADIUS_M=1560,HEAVE_M=7.5,FRONT_WIDTH_M=22;

export const shockUniforms={
  uShock:{value:new Vec4(0,0,-1e6,0)},   // x,y centre · z front radius · w heave (m)
  uShockGlow:{value:0},
};
let active=null,installed=false;

const VERTEX_HELPER=`
uniform vec4 uShock;uniform float uShockGlow;varying float vShockFront;
float shockHeave(vec2 p){float d=distance(p,uShock.xy)-uShock.z;float front=exp(-(d*d)/(${FRONT_WIDTH_M.toFixed(1)}*${FRONT_WIDTH_M.toFixed(1)}));float trail=d<0.0?exp(-((d+46.0)*(d+46.0))/900.0):0.0;return front-.42*trail;}
`;
// Patches a built-in material (MeshBasic / LineBasic / LineMaterial) so its
// vertices follow the pressure wave. Safe to call more than once.
export function patchShockMaterial(material,{lines=false}={}){
  if(!material||material.userData?.shockPatched)return material;material.userData.shockPatched=true;
  const previous=material.onBeforeCompile;
  material.onBeforeCompile=(shader,renderer)=>{
    previous?.call(material,shader,renderer);
    Object.assign(shader.uniforms,shockUniforms);
    let vs=shader.vertexShader;vs=vs.replace("void main() {",`${VERTEX_HELPER}\nvoid main() {`);
    if(lines&&vs.includes("vec4 start = modelViewMatrix * vec4( instanceStart, 1.0 );")){
      vs=vs.replace("vec4 start = modelViewMatrix * vec4( instanceStart, 1.0 );",`vec3 shockA=instanceStart;vec4 shockWA=modelMatrix*vec4(shockA,1.0);float shockHA=shockHeave(shockWA.xy);shockA.z+=uShock.w*shockHA;vShockFront=max(0.0,shockHA);\n\t\t\tvec4 start = modelViewMatrix * vec4( shockA, 1.0 );`)
        .replace("vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );",`vec3 shockB=instanceEnd;vec4 shockWB=modelMatrix*vec4(shockB,1.0);shockB.z+=uShock.w*shockHeave(shockWB.xy);\n\t\t\tvec4 end = modelViewMatrix * vec4( shockB, 1.0 );`);
    }else if(vs.includes("#include <begin_vertex>")){
      vs=vs.replace("#include <begin_vertex>",`#include <begin_vertex>\n{vec4 shockW=modelMatrix*vec4(transformed,1.0);float shockH=shockHeave(shockW.xy);transformed.z+=uShock.w*shockH;vShockFront=max(0.0,shockH);}`);
    }else{vs=vs.replace("void main() {","void main() {\nvShockFront=0.0;");}
    shader.vertexShader=vs;
    let fs=shader.fragmentShader;
    fs=fs.replace("void main() {","uniform float uShockGlow;varying float vShockFront;\nvoid main() {");
    if(fs.includes("#include <tonemapping_fragment>"))fs=fs.replace("#include <tonemapping_fragment>","gl_FragColor.rgb+=vec3(1.0,.92,.75)*vShockFront*uShockGlow*.6;\n#include <tonemapping_fragment>");
    shader.fragmentShader=fs;
  };
  const key=material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey=()=>`${key?key():""}|${SHOCK_FIELD_VERSION}${lines?"-l":""}`;
  material.needsUpdate=true;return material;
}

function start(position){
  const p=Array.isArray(position)?position:[position?.x,position?.y];const x=Number(p[0]),y=Number(p[1]);if(!Number.isFinite(x)||!Number.isFinite(y))return;
  active={x,y,born:performance.now()};shockUniforms.uShock.value.set(x,y,0,0);
}
function frame(now){
  if(active){
    const age=(now-active.born)/1000,radius=age*SHOCK_SPEED_MPS,fall=Math.max(0,1-radius/MAX_RADIUS_M);
    if(fall<=0){active=null;shockUniforms.uShock.value.set(0,0,-1e6,0);shockUniforms.uShockGlow.value=0;}
    else{shockUniforms.uShock.value.set(active.x,active.y,radius,HEAVE_M*fall**1.4*Math.min(1,age/.12));shockUniforms.uShockGlow.value=1.4*fall;}
    const v=document.getElementById("viewport");if(v){const s=active?radius.toFixed(0):"0";if(v.dataset.nukeShockFieldRadiusM!==s)v.dataset.nukeShockFieldRadiusM=s;}
  }
  requestAnimationFrame(frame);
}
// CPU twin of the shader heave: walkers, pedestrians, animals and birds ride
// the same ground wave that the ground, roads and city visibly do.
export function shockHeightAt(x,y){const u=shockUniforms.uShock.value;if(u.w<=0||u.z<0)return 0;const d=Math.hypot(x-u.x,y-u.y)-u.z;const front=Math.exp(-(d*d)/(FRONT_WIDTH_M*FRONT_WIDTH_M)),trail=d<0?Math.exp(-((d+46)*(d+46))/900):0;return u.w*(front-.42*trail);}
export function shockFieldState(){return active?{...active,radius:shockUniforms.uShock.value.z,heave:shockUniforms.uShock.value.w}:null;}
export function installShockField(){
  if(installed||typeof window==="undefined")return;installed=true;
  window.addEventListener("arondight:nuke-impact",event=>start(event?.detail?.position));
  window.addEventListener("arondight:world-reset",()=>{active=null;shockUniforms.uShock.value.set(0,0,-1e6,0);shockUniforms.uShockGlow.value=0;});
  const v=document.getElementById("viewport");if(v)v.dataset.nukeShockField=SHOCK_FIELD_VERSION;
  requestAnimationFrame(frame);
}
installShockField();
