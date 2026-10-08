import * as THREE from "three";
import {staticGroundHeightAt} from "./terrain_craters.mjs";

// Street lamps along the real streets: dark steel poles with a lamp head on
// both sides of every road (alternating, ~34 m apart). At dusk the heads
// start to glow sodium-warm and each throws a soft pool of light onto the
// street (additive ground decal — no real light, so 600 lamps cost 4 draw
// calls and no shader recompiles).

export const STREET_LAMPS_VERSION="instanced-sodium-lamps-v1";
const SPACING=34,MAX=900,POLE_H=6.2;
let sceneRef=null,group=null,poles=null,heads=null,pools=null,count=0,lastNight=-1;
const bridge=()=>globalThis.__arondightRealWorld||null;
const poolUniforms={uNight:{value:0}};
const headMat=new THREE.MeshStandardMaterial({color:0x2a2a28,emissive:0xffb35a,emissiveIntensity:0,roughness:.4,metalness:.3});
function ensure(){
  const scene=bridge()?.threeScene;if(!scene)return false;if(scene===sceneRef&&group?.parent===scene)return true;group?.parent?.remove(group);sceneRef=scene;group=new THREE.Group();group.name="STREET_LAMPS";group.userData.flightFireIgnore=true;
  const poleG=new THREE.CylinderGeometry(.07,.11,POLE_H,7);poleG.rotateX(Math.PI/2);poleG.translate(0,0,POLE_H/2);
  const armG=new THREE.BoxGeometry(1.5,.09,.09);armG.translate(.72,0,POLE_H-.1);const pg=mergeSimple([poleG,armG]);
  const headG=new THREE.BoxGeometry(.6,.26,.14);headG.translate(1.42,0,POLE_H-.2);
  const poolG=new THREE.PlaneGeometry(1,1);
  const poolMat=new THREE.ShaderMaterial({uniforms:poolUniforms,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,polygonOffset:true,polygonOffsetFactor:-6,polygonOffsetUnits:-6,
    vertexShader:"varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.0);}",
    fragmentShader:"uniform float uNight;varying vec2 vUv;void main(){float r=length(vUv-.5)*2.0;float a=smoothstep(1.0,0.0,r);a*=a*uNight*.55;if(a<.003)discard;gl_FragColor=vec4(vec3(1.0,.72,.38)*a,1.0);}"});
  poles=new THREE.InstancedMesh(pg,new THREE.MeshStandardMaterial({color:0x2b2e31,roughness:.55,metalness:.6}),MAX);heads=new THREE.InstancedMesh(headG,headMat,MAX);pools=new THREE.InstancedMesh(poolG,poolMat,MAX);
  for(const m of[poles,heads,pools]){m.count=0;m.frustumCulled=false;m.raycast=()=>{};m.userData.flightFireIgnore=true;m.userData.styleSkip=true;group.add(m);}poles.castShadow=true;pools.renderOrder=3;
  scene.add(group);return true;
}
function mergeSimple(list){const pos=[],idx=[];let o=0;for(const g of list){const p=g.attributes.position.array;for(let i=0;i<p.length;i++)pos.push(p[i]);const ix=g.index?g.index.array:[...Array(p.length/3).keys()];for(const i of ix)idx.push(i+o);o+=p.length/3;}const out=new THREE.BufferGeometry();out.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));out.setIndex(idx);out.computeVertexNormals();return out;}
// roads: [{cls,w,pts:[[x,y],...]}]
export function setLampRoads(roads,cx=0,cy=0){
  if(!ensure())return;const m4=new THREE.Matrix4(),q=new THREE.Quaternion(),p=new THREE.Vector3(),s=new THREE.Vector3(1,1,1),Z=new THREE.Vector3(0,0,1),sp=new THREE.Vector3();let n=0;const seen=new Set();
  const list=roads.filter(r=>!/path|track/.test(r.cls)).map(r=>({r,d:Math.hypot(r.pts[0][0]-cx,r.pts[0][1]-cy)})).sort((a,b)=>a.d-b.d).map(e=>e.r);
  for(const r of list){let carry=SPACING*.5,side=1;
    for(let i=0;i<r.pts.length-1&&n<MAX;i++){const a=r.pts[i],b=r.pts[i+1],dx=b[0]-a[0],dy=b[1]-a[1],l=Math.hypot(dx,dy);if(l<.5)continue;const ux=dx/l,uy=dy/l,nx=-uy,ny=ux;
      for(let t=carry;t<l&&n<MAX;t+=SPACING){side=-side;const off=r.w/2+1.15,x=a[0]+ux*t+nx*off*side,y=a[1]+uy*t+ny*off*side,key=`${Math.round(x/8)},${Math.round(y/8)}`;if(seen.has(key))continue;seen.add(key);
        const z=staticGroundHeightAt(x,y),yaw=Math.atan2(-ny*side,-nx*side);q.setFromAxisAngle(Z,yaw);m4.compose(p.set(x,y,z),q,s);poles.setMatrixAt(n,m4);heads.setMatrixAt(n,m4);
        const hx=x+Math.cos(yaw)*1.42,hy=y+Math.sin(yaw)*1.42;m4.compose(p.set(hx,hy,staticGroundHeightAt(hx,hy)+.14),q.identity(),sp.set(13,13,1));pools.setMatrixAt(n,m4);n++;}
      carry=((carry-l)%SPACING+SPACING)%SPACING;}}
  count=n;for(const m of[poles,heads,pools]){m.count=n;m.instanceMatrix.needsUpdate=true;}
  const v=document.getElementById("viewport");if(v)v.dataset.streetLamps=String(n);
}
function frame(){requestAnimationFrame(frame);if(!group)return;const night=Number(globalThis.__dayNight?.state?.night)||0,glow=Math.min(1,Math.max(0,(night-.15)/.5));if(Math.abs(glow-lastNight)<.01)return;lastNight=glow;headMat.emissiveIntensity=glow*3.2;poolUniforms.uNight.value=glow;pools.visible=glow>.01;}
export function installStreetLamps(){if(globalThis.__streetLamps||typeof window==="undefined")return;globalThis.__streetLamps={setRoads:setLampRoads,version:STREET_LAMPS_VERSION};requestAnimationFrame(frame);}
installStreetLamps();
