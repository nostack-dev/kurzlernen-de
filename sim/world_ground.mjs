import * as THREE from "three";
import {patchShockMaterial} from "./nuke_shock_field.mjs";
import {craterHeightAt,groundHeightAt,onTerrainChange} from "./terrain_craters.mjs";

// Real-world ground coloured from satellite imagery — used only indirectly:
// the aerial tiles around the player are averaged down to one colour per
// 10 m cell (never shown as a texture), normalised to a plausible albedo
// (shadows and haze removed, saturation kept natural) and baked into the
// vertex colours of a ground grid. Grass, fields, plazas, gravel and sand
// therefore show up where they really are. Fine detail comes from a cheap
// procedural variation in the shader. Rebuilt after 350 m of travel; if the
// imagery can't be loaded the ground falls back to a natural grass/soil mix.

export const WORLD_GROUND_VERSION="satellite-albedo-ground-v2-depth-base";
const SIZE_M=1600,CELLS=320,ZOOM=15,REBUILD_MOVE_M=350; // 5 m cells on the 5 m DEM / physics nodes
const TILE_URL=(z,x,y)=>`https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
let installed=false,mesh=null,center=[Infinity,Infinity],busy=false,lastTry=-Infinity,tileCache=new Map();
const bridge=()=>globalThis.__arondightRealWorld||null;

function lonLatToTile(lon,lat,z){const n=2**z,x=(lon+180)/360*n,r=lat*Math.PI/180,y=(1-Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2*n;return[x,y];}
function loadTile(z,x,y){const key=`${z}/${x}/${y}`;if(tileCache.has(key))return tileCache.get(key);
  const p=new Promise(resolve=>{const img=new Image();img.crossOrigin="anonymous";img.decoding="async";img.onload=()=>resolve(img);img.onerror=()=>resolve(null);img.src=TILE_URL(z,x,y);setTimeout(()=>resolve(null),9000);});tileCache.set(key,p);if(tileCache.size>64)tileCache.delete(tileCache.keys().next().value);return p;}

// Satellite RGB → albedo: lift shadows, remove haze, clamp to plausible
// natural ranges, slightly desaturate concrete greys.
function albedo(r,g,b,out){
  const l=.2126*r+.7152*g+.0722*b,target=Math.min(.24,Math.max(.07,l*.8+.03)),k=target/Math.max(.02,l);
  let R=r*k,G=g*k,B=b*k;const m=(R+G+B)/3,sat=Math.max(R,G,B)-Math.min(R,G,B);if(sat<.05){R=R*.85+m*.15;G=G*.85+m*.15;B=B*.85+m*.15;}
  if(B>G&&B>R&&sat>.04){B*=.85;} // haze / water-ish blue cast → calmer
  out[0]=Math.min(.45,R);out[1]=Math.min(.45,G);out[2]=Math.min(.45,B);return out;
}
async function sampleColors(b,cx,cy){
  const half=SIZE_M/2,[lon0,lat0]=b.unprojectMeters(cx-half,cy+half),[lon1,lat1]=b.unprojectMeters(cx+half,cy-half);
  const [tx0,ty0]=lonLatToTile(lon0,lat0,ZOOM),[tx1,ty1]=lonLatToTile(lon1,lat1,ZOOM),ix0=Math.floor(tx0),iy0=Math.floor(ty0),ix1=Math.floor(tx1),iy1=Math.floor(ty1);
  const nx=ix1-ix0+1,ny=iy1-iy0+1;if(nx*ny>25)return null;
  const tiles=await Promise.all(Array.from({length:nx*ny},(_,i)=>loadTile(ZOOM,ix0+i%nx,iy0+Math.floor(i/nx))));if(tiles.every(t=>!t))return null;
  // small mosaic: 64 px per tile is enough for 10 m cells
  const P=64,canvas=document.createElement("canvas");canvas.width=nx*P;canvas.height=ny*P;const ctx=canvas.getContext("2d",{willReadFrequently:true});ctx.imageSmoothingQuality="high";
  tiles.forEach((img,i)=>{if(img)ctx.drawImage(img,(i%nx)*P,Math.floor(i/nx)*P,P,P);});let data;try{data=ctx.getImageData(0,0,canvas.width,canvas.height).data;}catch{return null;}
  const colors=new Float32Array((CELLS+1)*(CELLS+1)*3),c=[0,0,0],lin=v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;};
  for(let j=0;j<=CELLS;j++)for(let i=0;i<=CELLS;i++){const x=cx-half+i/CELLS*SIZE_M,y=cy+half-j/CELLS*SIZE_M,[lon,lat]=b.unprojectMeters(x,y),[tx,ty]=lonLatToTile(lon,lat,ZOOM),px=Math.max(0,Math.min(canvas.width-1,Math.floor((tx-ix0)*P))),py=Math.max(0,Math.min(canvas.height-1,Math.floor((ty-iy0)*P)));
    let r=0,g=0,bb=0,n=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const qx=Math.max(0,Math.min(canvas.width-1,px+dx)),qy=Math.max(0,Math.min(canvas.height-1,py+dy)),o=(qy*canvas.width+qx)*4;if(data[o+3]<10)continue;r+=lin(data[o]);g+=lin(data[o+1]);bb+=lin(data[o+2]);n++;}
    if(!n){r=.12;g=.16;bb=.08;n=1;}albedo(r/n,g/n,bb/n,c);const k=(j*(CELLS+1)+i)*3;colors[k]=c[0];colors[k+1]=c[1];colors[k+2]=c[2];}
  return colors;
}
function fallbackColors(cx,cy){const colors=new Float32Array((CELLS+1)*(CELLS+1)*3);for(let k=0;k<colors.length;k+=3){colors[k]=.16;colors[k+1]=.2;colors[k+2]=.1;}return colors;}
function ensureMesh(scene){
  if(mesh?.parent===scene)return mesh;const g=new THREE.PlaneGeometry(SIZE_M,SIZE_M,CELLS,CELLS);
  const m=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.95,metalness:0,polygonOffset:true,polygonOffsetFactor:4,polygonOffsetUnits:8});
  m.onBeforeCompile=shader=>{shader.vertexShader=shader.vertexShader.replace("void main() {","varying vec3 vGW;\nvoid main() {").replace("#include <begin_vertex>","#include <begin_vertex>\nvGW=(modelMatrix*vec4(transformed,1.0)).xyz;");
    shader.fragmentShader=shader.fragmentShader.replace("void main() {","varying vec3 vGW;\nfloat gh(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.55);}\nfloat gn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(gh(i),gh(i+vec2(1,0)),f.x),mix(gh(i+vec2(0,1)),gh(i+vec2(1,1)),f.x),f.y);}\nvoid main() {")
      .replace("#include <color_fragment>","#include <color_fragment>\n{float n=gn(vGW.xy*.35)*.5+gn(vGW.xy*1.7)*.3+gn(vGW.xy*7.0)*.2;diffuseColor.rgb*=0.86+0.28*n;}");};
  m.customProgramCacheKey=()=>"world-ground-v1";patchShockMaterial(m);
  mesh=new THREE.Mesh(g,m);mesh.name="WORLD_GROUND";mesh.receiveShadow=true;mesh.frustumCulled=false;mesh.renderOrder=1;mesh.userData.flightFireIgnore=true;mesh.userData.styleSkip=true;mesh.raycast=()=>{};mesh.visible=false;scene.add(mesh);center=[Infinity,Infinity];return mesh;
}
function applyHeights(){if(!mesh)return;const p=mesh.geometry.attributes.position;for(let i=0;i<p.count;i++)p.setZ(i,craterHeightAt(p.getX(i)+mesh.position.x,p.getY(i)+mesh.position.y));p.needsUpdate=true;mesh.geometry.computeVertexNormals();}
async function rebuild(b,cx,cy){
  busy=true;try{const colors=(await sampleColors(b,cx,cy).catch(()=>null))||fallbackColors(cx,cy);ensureMesh(b.threeScene);mesh.position.set(cx,cy,0);mesh.geometry.setAttribute("color",new THREE.Float32BufferAttribute(colors,3));applyHeights();mesh.visible=true;
    const v=document.getElementById("viewport");if(v){v.dataset.worldGround=WORLD_GROUND_VERSION;v.dataset.worldGroundSource=colors.length&&colors[0]!==.16?"satellite-albedo":"fallback";}}
  finally{busy=false;}
}
function frame(now){
  requestAnimationFrame(frame);const b=bridge();if(!b?.active||!b.threeScene||typeof b.unprojectMeters!=="function"){if(mesh)mesh.visible=false;return;}
  if(mesh&&mesh.parent!==b.threeScene)mesh=null;ensureMesh(b.threeScene);
  // Depth precision: a 1 cm near plane leaves ~25 cm depth steps at 200 m, so
  // ground, roads and facades z-fight. Near is 6 cm on foot (weapon in view)
  // and 25 cm otherwise — 6–25× finer depth everywhere.
  {const c=b.threeCamera,want=globalThis.__arondightWalkMode?.mode==="foot"?.06:.25;if(c&&Math.abs(c.near-want)>1e-4){c.near=want;c.updateProjectionMatrix();}}
  const cam=b.threeCamera;if(!cam||busy||now-lastTry<1500)return;if(Math.hypot(cam.position.x-center[0],cam.position.y-center[1])<REBUILD_MOVE_M&&mesh.visible)return;lastTry=now;center=[Math.round(cam.position.x/10)*10,Math.round(cam.position.y/10)*10];rebuild(b,center[0],center[1]);
}
// The view never goes underground: chase / orbit / menu cameras on hills,
// in craters or under a heaving shock wave are kept above the visible surface.
function keepCameraAboveGround(scene,camera){if(!camera||globalThis.__arondightWalkMode?.mode==="foot")return;if(camera.parent&&camera.parent!==scene)return;const min=groundHeightAt(camera.position.x,camera.position.y)+.35;if(camera.position.z<min){camera.position.z=min;camera.updateMatrixWorld();}}
export function installWorldGround(){if(installed||typeof window==="undefined")return;installed=true;onTerrainChange(()=>applyHeights());requestAnimationFrame(frame);
  const attach=()=>{const b=bridge();if(typeof b?.addPreRenderHook!=="function")return requestAnimationFrame(attach);b.addPreRenderHook(keepCameraAboveGround);};attach();}
installWorldGround();
