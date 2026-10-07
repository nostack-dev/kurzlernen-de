import * as THREE from "three";
import {patchShockMaterial} from "./nuke_shock_field.mjs";
import {groundHeightAt,onTerrainChange} from "./terrain_craters.mjs";

// One visible terrain, one physical terrain. No imagery, no textures, no second
// decorative ground plane. The same 5 m node field that feeds Box3D deforms
// this mesh; the neon grid is generated in the material from world XY so it
// bends into every crater instead of floating across valleys.

export const WORLD_GROUND_VERSION="mesh-is-collision-v1";
const SIZE_M=1600,CELLS=320,REBUILD_MOVE_M=350,GRID_M=16;
let installed=false,mesh=null,center=[Infinity,Infinity],lastTry=-Infinity;
const bridge=()=>globalThis.__arondightRealWorld||null;

function makeMaterial(){
  const m=new THREE.MeshBasicMaterial({color:0x02140c,toneMapped:false,fog:true,polygonOffset:true,polygonOffsetFactor:4,polygonOffsetUnits:8});
  m.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader
      .replace("void main() {","varying vec3 vGroundWorld;\nvoid main() {")
      .replace("#include <begin_vertex>","#include <begin_vertex>\nvGroundWorld=(modelMatrix*vec4(transformed,1.0)).xyz;");
    shader.fragmentShader=shader.fragmentShader
      .replace("void main() {","varying vec3 vGroundWorld;\nvoid main() {")
      .replace("#include <color_fragment>","#include <color_fragment>\n{\n  vec2 gp=vGroundWorld.xy/16.0;\n  vec2 fw=max(fwidth(gp),vec2(0.0005));\n  vec2 d=abs(fract(gp-.5)-.5)/fw;\n  float minor=1.0-min(min(d.x,d.y),1.0);\n  vec2 mg=vGroundWorld.xy/64.0;\n  vec2 mfw=max(fwidth(mg),vec2(0.0005));\n  vec2 md=abs(fract(mg-.5)-.5)/mfw;\n  float major=1.0-min(min(md.x,md.y),1.0);\n  float line=clamp(minor*.28+major*.52,0.0,1.0);\n  vec3 base=vec3(0.003,0.020,0.012);\n  vec3 neon=vec3(0.120,0.820,0.340);\n  diffuseColor.rgb=mix(base,neon,line);\n}");
  };
  m.customProgramCacheKey=()=>"shared-neon-terrain-grid-v4-readable";
  return patchShockMaterial(m);
}
function ensureMesh(scene){
  if(mesh?.parent===scene)return mesh;
  if(mesh?.parent)mesh.parent.remove(mesh);
  const g=new THREE.PlaneGeometry(SIZE_M,SIZE_M,CELLS,CELLS),m=makeMaterial();
  // Match staticGroundHeightAt: per cell a=min-x/min-y, b=max-x/min-y, c=min-x/max-y, d=max-x/max-y;
  // triangles (a,b,d) and (a,c,d) so the shared diagonal is the u>=v split.
  {const gridX=CELLS,gridY=CELLS,gridX1=gridX+1,idx=[];
    for(let iy=0;iy<gridY;iy++)for(let ix=0;ix<gridX;ix++){
      const c=ix+gridX1*iy,a=ix+gridX1*(iy+1),d=(ix+1)+gridX1*iy,b=(ix+1)+gridX1*(iy+1);
      idx.push(a,b,d,a,d,c); // (a,c,d) wound CCW so it faces +z
    }
    g.setIndex(idx);}
  mesh=new THREE.Mesh(g,m);mesh.name="WORLD_GROUND";mesh.frustumCulled=false;mesh.renderOrder=1;mesh.userData.flightFireIgnore=true;mesh.userData.styleSkip=true;mesh.userData.neonSkip=true;mesh.raycast=()=>{};mesh.visible=false;scene.add(mesh);center=[Infinity,Infinity];return mesh;
}
function applyHeights(){
  if(!mesh)return;const a=mesh.geometry.attributes.position.array,ox=mesh.position.x,oy=mesh.position.y;
  for(let i=0;i<a.length;i+=3)a[i+2]=groundHeightAt(a[i]+ox,a[i+1]+oy);
  mesh.geometry.attributes.position.needsUpdate=true;
  mesh.geometry.computeBoundingSphere();
}
function rebuild(b,cx,cy){
  ensureMesh(b.threeScene);mesh.position.set(cx,cy,0);applyHeights();mesh.visible=true;
  const v=document.getElementById("viewport");if(v){v.dataset.worldGround=WORLD_GROUND_VERSION;v.dataset.worldGroundSource="shared-physical-terrain";v.dataset.worldGroundTexture="none";v.dataset.worldGroundGrid="procedural-on-deformed-mesh";}
}
function frame(now){
  requestAnimationFrame(frame);const b=bridge();if(!b?.active||!b.threeScene){if(mesh)mesh.visible=false;return;}
  if(mesh&&mesh.parent!==b.threeScene)mesh=null;ensureMesh(b.threeScene);
  {const camera=b.threeCamera,want=globalThis.__arondightWalkMode?.mode==="foot"?.06:.25;if(camera&&Math.abs(camera.near-want)>1e-4){camera.near=want;camera.updateProjectionMatrix();}}
  const cam=b.threeCamera;if(!cam||now-lastTry<250)return;
  if(Math.hypot(cam.position.x-center[0],cam.position.y-center[1])<REBUILD_MOVE_M&&mesh.visible)return;
  lastTry=now;center=[Math.round(cam.position.x/5)*5,Math.round(cam.position.y/5)*5];rebuild(b,center[0],center[1]);
}
function keepCameraAboveGround(scene,camera){
  if(!camera||globalThis.__arondightWalkMode?.mode==="foot")return;if(camera.parent&&camera.parent!==scene)return;
  const min=groundHeightAt(camera.position.x,camera.position.y)+.35;if(camera.position.z<min){camera.position.z=min;camera.updateMatrixWorld();}
}
export function installWorldGround(){
  if(installed||typeof window==="undefined")return;installed=true;
  onTerrainChange(()=>applyHeights());requestAnimationFrame(frame);
  const attach=()=>{const b=bridge();if(typeof b?.addPreRenderHook!=="function")return requestAnimationFrame(attach);b.addPreRenderHook(keepCameraAboveGround);};attach();
}
installWorldGround();
