import * as THREE from "three";
import {patchShockMaterial} from "./nuke_shock_field.mjs";
import {staticGroundHeightAt,terrainNodeHeightAt,groundHeightAt,onTerrainChange} from "./terrain_craters.mjs";

// Real-world ground coloured from satellite imagery — used only indirectly:
// the aerial tiles around the player are averaged down to one colour per
// 10 m cell (never shown as a texture), normalised to a plausible albedo
// (shadows and haze removed, saturation kept natural) and baked into the
// vertex colours of a ground grid. Grass, fields, plazas, gravel and sand
// therefore show up where they really are. Fine detail comes from a cheap
// procedural variation in the shader. Rebuilt after 350 m of travel; if the
// imagery can't be loaded the ground falls back to a natural grass/soil mix.
//
// Geometry = the physics: vertices are the 5 m terrain nodes of the Box3D
// height-field tiles (terrain_tiles.mjs) with the same triangle diagonal,
// so what you see is exactly what you stand, drive and collide on.

export const WORLD_GROUND_VERSION="satellite-albedo-ground-v4-mesh-is-collision-chunked";
// 8×8 chunks (200 m each): only the chunks in view are drawn; normals come
// from the shared height grid so chunk seams are invisible.
const CH=8;
const SIZE_M=1600,CELLS=320,ZOOM=15,REBUILD_MOVE_M=350; // 5 m cells on the 5 m DEM / physics nodes
const TILE_URL=(z,x,y)=>`https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
let installed=false,mesh=null,center=[Infinity,Infinity],busy=false,lastTry=-Infinity,tileCache=new Map();
const bridge=()=>globalThis.__arondightRealWorld||null;
const yieldMain=()=>globalThis.scheduler?.yield?globalThis.scheduler.yield():new Promise(resolve=>setTimeout(resolve,0));

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
  for(let j=0;j<=CELLS;j++){for(let i=0;i<=CELLS;i++){const x=cx-half+i/CELLS*SIZE_M,y=cy+half-j/CELLS*SIZE_M,[lon,lat]=b.unprojectMeters(x,y),[tx,ty]=lonLatToTile(lon,lat,ZOOM),px=Math.max(0,Math.min(canvas.width-1,Math.floor((tx-ix0)*P))),py=Math.max(0,Math.min(canvas.height-1,Math.floor((ty-iy0)*P)));
    let r=0,g=0,bb=0,n=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const qx=Math.max(0,Math.min(canvas.width-1,px+dx)),qy=Math.max(0,Math.min(canvas.height-1,py+dy)),o=(qy*canvas.width+qx)*4;if(data[o+3]<10)continue;r+=lin(data[o]);g+=lin(data[o+1]);bb+=lin(data[o+2]);n++;}
    if(!n){r=.12;g=.16;bb=.08;n=1;}albedo(r/n,g/n,bb/n,c);const k=(j*(CELLS+1)+i)*3;colors[k]=c[0];colors[k+1]=c[1];colors[k+2]=c[2];}if((j&7)===7)await yieldMain();}
  return colors;
}
// Map areas (parks, woods, pitches, sand) tint the ground's vertex colours —
// the ground already is the surface, so they cost no triangles at all.
let areas=[],baseColors=null,fullColors=null,H=null;
function pip(x,y,r){let ins=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],c=r[j];if(((a[1]>y)!==(c[1]>y))&&x<(c[0]-a[0])*(y-a[1])/((c[1]-a[1])||1e-9)+a[0])ins=!ins;}return ins;}
function paintAreas(){
  if(!mesh||!baseColors)return;const out=fullColors||(fullColors=new Float32Array(baseColors.length));out.set(baseColors);const ox=mesh.position.x,oy=mesh.position.y,half=SIZE_M/2,st=SIZE_M/CELLS,tc=new THREE.Color();
  for(const a of areas){let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;for(const p of a.outer){x0=Math.min(x0,p[0]);y0=Math.min(y0,p[1]);x1=Math.max(x1,p[0]);y1=Math.max(y1,p[1]);}
    tc.set(a.color);const i0=Math.max(0,Math.floor((x0-(ox-half))/st)),i1=Math.min(CELLS,Math.ceil((x1-(ox-half))/st)),j0=Math.max(0,Math.floor(((oy+half)-y1)/st)),j1=Math.min(CELLS,Math.ceil(((oy+half)-y0)/st));
    for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){const x=ox-half+i*st,y=oy+half-j*st;if(!pip(x,y,a.outer)||a.holes.some(h=>pip(x,y,h)))continue;const k=(j*(CELLS+1)+i)*3;out[k]=out[k]*.45+tc.r*.55;out[k+1]=out[k+1]*.45+tc.g*.55;out[k+2]=out[k+2]*.45+tc.b*.55;}}
  distributeColors();
}
function setAreas(list){areas=Array.isArray(list)?list:[];paintAreas();}
function fallbackColors(cx,cy){const colors=new Float32Array((CELLS+1)*(CELLS+1)*3);for(let k=0;k<colors.length;k+=3){colors[k]=.16;colors[k+1]=.2;colors[k+2]=.1;}return colors;}
function ensureMesh(scene){
  if(mesh?.parent===scene)return mesh;if(mesh?.parent)mesh.parent.remove(mesh);
  const m=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.95,metalness:0,polygonOffset:true,polygonOffsetFactor:4,polygonOffsetUnits:8});
  m.onBeforeCompile=shader=>{shader.vertexShader=shader.vertexShader.replace("void main() {","varying vec3 vGW;\nvoid main() {").replace("#include <begin_vertex>","#include <begin_vertex>\nvGW=(modelMatrix*vec4(transformed,1.0)).xyz;");
    shader.fragmentShader=shader.fragmentShader.replace("void main() {","varying vec3 vGW;\nfloat gh(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.55);}\nfloat gn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(gh(i),gh(i+vec2(1,0)),f.x),mix(gh(i+vec2(0,1)),gh(i+vec2(1,1)),f.x),f.y);}\nvoid main() {")
      .replace("#include <color_fragment>","#include <color_fragment>\n{float n=gn(vGW.xy*.35)*.5+gn(vGW.xy*1.7)*.3+gn(vGW.xy*7.0)*.2;diffuseColor.rgb*=0.86+0.28*n;}");};
  m.customProgramCacheKey=()=>"world-ground-v2-real";patchShockMaterial(m);
  mesh=new THREE.Group();mesh.name="WORLD_GROUND";mesh.renderOrder=1;mesh.userData.flightFireIgnore=true;mesh.userData.styleSkip=true;mesh.visible=false;
  const CC=CELLS/CH,st=SIZE_M/CELLS,half=SIZE_M/2,X1=CC+1;
  // Match staticGroundHeightAt / Box3D: triangles (a,b,d),(a,d,c) share the u>=v diagonal.
  const idx=[];for(let iy=0;iy<CC;iy++)for(let ix=0;ix<CC;ix++){const c=ix+X1*iy,a=ix+X1*(iy+1),d=(ix+1)+X1*iy,b=(ix+1)+X1*(iy+1);idx.push(a,b,d,a,d,c);}
  for(let cj=0;cj<CH;cj++)for(let ci=0;ci<CH;ci++){const g=new THREE.BufferGeometry(),pos=new Float32Array(X1*X1*3);
    for(let j=0;j<=CC;j++)for(let i=0;i<=CC;i++){const k=(j*X1+i)*3;pos[k]=-half+(ci*CC+i)*st;pos[k+1]=half-(cj*CC+j)*st;}
    g.setAttribute("position",new THREE.BufferAttribute(pos,3));g.setAttribute("normal",new THREE.BufferAttribute(new Float32Array(X1*X1*3),3));g.setAttribute("color",new THREE.BufferAttribute(new Float32Array(X1*X1*3),3));g.setIndex(idx);
    const c=new THREE.Mesh(g,m);c.name="WORLD_GROUND_CHUNK";c.userData.ci=ci;c.userData.cj=cj;c.receiveShadow=true;c.frustumCulled=true;c.renderOrder=1;c.userData.flightFireIgnore=true;c.userData.styleSkip=true;c.raycast=()=>{};mesh.add(c);}
  scene.add(mesh);center=[Infinity,Infinity];H=new Float32Array((CELLS+1)*(CELLS+1));return mesh;
}
function chunkRange(ci,cj){const CC=CELLS/CH;return[ci*CC,cj*CC,ci*CC+CC,cj*CC+CC];}
function distributeColors(){if(!mesh||!fullColors)return;const CC=CELLS/CH,X1=CC+1,W=CELLS+1;for(const c of mesh.children){const a=c.geometry.attributes.color.array,[i0,j0]=chunkRange(c.userData.ci,c.userData.cj);for(let j=0;j<=CC;j++){const src=((j0+j)*W+i0)*3;a.set(fullColors.subarray(src,src+X1*3),j*X1*3);}c.geometry.attributes.color.needsUpdate=true;}}
// Static node heights (the nuke pressure wave comes from the shared shock shader, as on the physics tiles).
function applyHeights(regions=null){if(!mesh||!H)return;const W=CELLS+1,st=SIZE_M/CELLS,half=SIZE_M/2,ox=mesh.position.x,oy=mesh.position.y;
  // grid index ranges touched (whole grid when no regions)
  let rs=regions?regions.map(r=>[Math.max(0,Math.floor((r[0]-5-(ox-half))/st)),Math.max(0,Math.floor(((oy+half)-(r[3]+5))/st)),Math.min(CELLS,Math.ceil((r[2]+5-(ox-half))/st)),Math.min(CELLS,Math.ceil(((oy+half)-(r[1]-5))/st))]).filter(r=>r[0]<=r[2]&&r[1]<=r[3]):[[0,0,CELLS,CELLS]];if(!rs.length)return;
  for(const[i0,j0,i1,j1]of rs)for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){const x=ox-half+i*st,y=oy+half-j*st;H[j*W+i]=terrainNodeHeightAt(Math.round(x/5)*5,Math.round(y/5)*5);}
  const CC=CELLS/CH,X1=CC+1,hAt=(i,j)=>H[Math.min(CELLS,Math.max(0,j))*W+Math.min(CELLS,Math.max(0,i))];
  for(const c of mesh.children){const[ci0,cj0,ci1,cj1]=chunkRange(c.userData.ci,c.userData.cj);if(!rs.some(r=>r[0]<=ci1+1&&r[2]>=ci0-1&&r[1]<=cj1+1&&r[3]>=cj0-1))continue;
    const pa=c.geometry.attributes.position.array,na=c.geometry.attributes.normal.array;let zmin=Infinity,zmax=-Infinity;
    for(let j=0;j<=CC;j++)for(let i=0;i<=CC;i++){const gi=ci0+i,gj=cj0+j,k=(j*X1+i)*3,z=hAt(gi,gj);pa[k+2]=z;if(z<zmin)zmin=z;if(z>zmax)zmax=z;
      // normal from the shared grid (central differences): seamless across chunks
      const dx=(hAt(gi+1,gj)-hAt(gi-1,gj))/(2*st),dy=(hAt(gi,gj-1)-hAt(gi,gj+1))/(2*st),l=Math.hypot(dx,dy,1);na[k]=-dx/l;na[k+1]=-dy/l;na[k+2]=1/l;}
    c.geometry.attributes.position.needsUpdate=true;c.geometry.attributes.normal.needsUpdate=true;
    const cx=(pa[0]+pa[(X1*X1-1)*3])/2,cy=(pa[1]+pa[(X1*X1-1)*3+1])/2;c.geometry.boundingSphere=new THREE.Sphere(new THREE.Vector3(cx,cy,(zmin+zmax)/2),Math.hypot(CC*st/2*Math.SQRT2,(zmax-zmin)/2)+40);} // +40 m: nuke heave margin
}
async function rebuild(b,cx,cy){
  busy=true;try{const colors=(await sampleColors(b,cx,cy).catch(()=>null))||fallbackColors(cx,cy);ensureMesh(b.threeScene);mesh.position.set(cx,cy,0);baseColors=Float32Array.from(colors);fullColors=null;paintAreas();if(!areas.length){fullColors=Float32Array.from(colors);distributeColors();}applyHeights();mesh.visible=true;
    const v=document.getElementById("viewport");if(v){v.dataset.worldGround=WORLD_GROUND_VERSION;v.dataset.worldGroundSource=colors.length&&colors[0]!==.16?"satellite-albedo":"fallback";}}
  finally{busy=false;}
}
function frame(now){
  requestAnimationFrame(frame);const b=bridge();if(!b?.active||!b.threeScene||typeof b.unprojectMeters!=="function"){if(mesh)mesh.visible=false;return;}
  if(mesh&&mesh.parent!==b.threeScene)mesh=null;ensureMesh(b.threeScene);
  // Depth precision: a 1 cm near plane leaves ~25 cm depth steps at 200 m, so
  // ground, roads and facades z-fight. Near is 6 cm on foot (weapon in view)
  // and 25 cm otherwise — 6–25× finer depth everywhere.
  {const c=b.threeCamera,want=globalThis.__jetMode?.active?1:globalThis.__arondightWalkMode?.mode==="foot"?.06:.25;if(c&&Math.abs(c.near-want)>1e-4){c.near=want;c.updateProjectionMatrix();}}
  const cam=b.threeCamera;if(!cam||busy||now-lastTry<1500)return;if(Math.hypot(cam.position.x-center[0],cam.position.y-center[1])<REBUILD_MOVE_M&&mesh.visible)return;lastTry=now;center=[Math.round(cam.position.x/10)*10,Math.round(cam.position.y/10)*10];rebuild(b,center[0],center[1]);
}
// The view never goes underground: chase / orbit / menu cameras on hills,
// in craters or under a heaving shock wave are kept above the visible surface.
function keepCameraAboveGround(scene,camera){if(!camera||globalThis.__arondightWalkMode?.mode==="foot")return;if(camera.parent&&camera.parent!==scene)return;const min=groundHeightAt(camera.position.x,camera.position.y)+.35;if(camera.position.z<min){camera.position.z=min;camera.updateMatrixWorld();}}
export function installWorldGround(){if(installed||typeof window==="undefined")return;installed=true;globalThis.__worldGround={setAreas};onTerrainChange((_c,regions)=>applyHeights(regions??null));requestAnimationFrame(frame);
  const attach=()=>{const b=bridge();if(typeof b?.addPreRenderHook!=="function")return requestAnimationFrame(attach);b.addPreRenderHook(keepCameraAboveGround);};attach();}
installWorldGround();
