import * as THREE from "three";

// A fixed pool of point lights that never leaves the scene.
//
// three.js bakes the number of lights into every lit shader program: a light
// appearing (a police drone's flasher, a blast, a jet's afterburner) or
// disappearing (its group hidden) recompiles every lit material in view —
// the classic freeze when a nuke goes off and the police arrive. Effects
// therefore never own lights: each frame they *request* light at a world
// position; the pool gives its POOL lights to the brightest requests near
// the camera and parks the rest at intensity 0. The light count is constant
// from the first frame, so no program is ever recompiled because of lights.

export const DYNAMIC_LIGHTS_VERSION="constant-pool-v1";
const MOBILE=typeof navigator!=="undefined"&&/android|iphone|ipad|mobile/i.test(navigator.userAgent||"");
// street lamps at night, muzzle flashes, blasts, headlights and jetpack flames share the pool
const POOL=MOBILE?4:6,requests=[];let lights=[],sceneRef=null,hooked=null;
const tmp=new THREE.Vector3();
const bridge=()=>globalThis.__arondightRealWorld||null;

function ensure(scene){
  if(scene===sceneRef&&lights.length&&lights[0].parent===scene)return true;sceneRef=scene;for(const l of lights)l.parent?.remove(l);
  lights=Array.from({length:POOL},(_,i)=>{const l=new THREE.PointLight(0xffffff,0,30,2);l.name=`DYNAMIC_LIGHT_${i}`;l.userData.dynamicLightPool=true;l.position.set(0,0,-5000);scene.add(l);return l;});return true;
}
// position: Vector3 or [x,y,z]; call every frame while the light should shine
export function requestLight(position,{color=0xffffff,intensity=10,distance=30}={}){
  if(!position||intensity<=0)return;const x=Array.isArray(position)?position[0]:position.x,y=Array.isArray(position)?position[1]:position.y,z=Array.isArray(position)?position[2]:position.z;
  if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(z))return;if(requests.length<64)requests.push({x,y,z,color,intensity,distance});
}
function resolve(scene,camera){
  if(!scene||!ensure(scene))return;const cam=camera?.position;
  for(const r of requests)r.score=r.intensity/(1+(cam?Math.hypot(r.x-cam.x,r.y-cam.y,r.z-cam.z):0)/Math.max(4,r.distance));
  requests.sort((a,b)=>b.score-a.score);
  for(let i=0;i<POOL;i++){const l=lights[i],r=requests[i];if(r){l.position.set(r.x,r.y,r.z);l.color.setHex(r.color);l.intensity=r.intensity;l.distance=r.distance;}else{l.intensity=0;}l.visible=true;}
  requests.length=0;
}
export function installDynamicLights(){
  if(globalThis.__dynamicLights||typeof window==="undefined")return;globalThis.__dynamicLights={request:requestLight,version:DYNAMIC_LIGHTS_VERSION};
  const attach=()=>{const b=bridge();if(typeof b?.addPreRenderHook!=="function")return requestAnimationFrame(attach);if(hooked===b)return;hooked=b;b.addPreRenderHook((scene,camera)=>resolve(scene||b.threeScene,camera||b.threeCamera));
    if(b.threeScene)ensure(b.threeScene);};attach();
}
installDynamicLights();
