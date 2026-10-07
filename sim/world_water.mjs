import * as THREE from "three";
import {setWaterRegions,setBridgeDecks,WATER_LEVEL_M} from "./terrain_craters.mjs";

// Real water from the map: rivers, canals, streams (waterway lines with a
// width per class) and lakes/ponds/harbours (water polygons).
//  * Geometry: the water area is rasterised onto a 3 m grid around the
//    player; a distance transform gives every vertex its distance to the
//    shore, and every cell gets the flow direction of the nearest waterway
//    (rivers flow, lakes are calm).
//  * Physics (Box3D, not faked): the cells are greedy-merged into
//    rectangles that become real basins in the shared terrain
//    (terrain_craters.mjs) — ground removed, a bed 2.6 m down. Bodies sink
//    in, get Archimedes buoyancy, water drag and the current
//    (world_rigid_body_physics.mjs); bridges keep solid decks.
//  * Look: a PBR surface (sky reflections from the environment map, sun
//    glints) with animated wave normals scrolling along the flow, depth
//    tint from the shore distance and foam at banks and in fast water.
// Rebuilt time-sliced after 300 m of travel. One draw call.

export const WORLD_WATER_VERSION="map-water-basins-buoyancy-v1";
const RADIUS_M=1000,CELL=4,REBUILD_MOVE_M=420,SLICE_MS=5;
const WIDTH={river:18,canal:12,stream:4.5,drain:2.4,ditch:2.2,brook:3};
let lastHarvest=-Infinity,installed=false,mesh=null,material=null,center=[Infinity,Infinity],job=null,lastTry=-Infinity,builtCount=0,builtRoads=0;
const bridge=()=>globalThis.__arondightRealWorld||null;
export const waterUniforms={uTime:{value:0}};

function features(b,layer){try{return b.map.querySourceFeatures(b.buildingSourceId,{sourceLayer:layer})||[];}catch{return[];}}
// MapLibre only answers for the tiles it holds at that instant (the set
// flickers while the hidden map streams), so water and bridge features are
// harvested into a cache across frames and the build works on a snapshot.
const cache={water:new Map(),waterway:new Map(),transportation:new Map()};
function pointCount(c){return Array.isArray(c[0])?c.reduce((n,x)=>n+pointCount(x),0):1;}
function firstPoint(c){while(Array.isArray(c[0]))c=c[0];return c;}
function harvest(b){
  let added=0;for(const layer of Object.keys(cache)){const m=cache[layer];
    for(const f of features(b,layer)){if(layer==="transportation"&&f.properties?.brunnel!=="bridge")continue;let g;try{g=f.geometry;}catch{continue;}if(!g?.coordinates?.length)continue;
      const p=firstPoint(g.coordinates),key=`${g.type}:${(+p[0]).toFixed(6)},${(+p[1]).toFixed(6)}:${pointCount(g.coordinates)}`;if(m.has(key))continue;m.set(key,{properties:{...f.properties},geometry:{type:g.type,coordinates:g.coordinates}});added++;}
    if(m.size>4000){const cam=b.threeCamera;for(const[k,f]of m){const q=firstPoint(f.geometry.coordinates),[x,y]=b.projectLngLat(q[0],q[1]);if(Math.hypot(x-cam.position.x,y-cam.position.y)>3500)m.delete(k);}}}
  return added;
}
const cached=layer=>[...cache[layer].values()];
function pip(x,y,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const xi=ring[i][0],yi=ring[i][1],xj=ring[j][0],yj=ring[j][1];if(((yi>y)!==(yj>y))&&x<(xj-xi)*(y-yi)/((yj-yi)||1e-9)+xi)inside=!inside;}return inside;}

function* build(b,cx,cy){
  const project=(lon,lat)=>b.projectLngLat(lon,lat),N=Math.ceil(RADIUS_M*2/CELL),x0=cx-RADIUS_M,y0=cy-RADIUS_M;
  const water=new Uint8Array(N*N),flowX=new Float32Array(N*N),flowY=new Float32Array(N*N),speed=new Float32Array(N*N);let steps=0;const stats={cx:Math.round(cx),cy:Math.round(cy),N,polys:0,rings:0,bbox:null};const countWater=()=>{let n=0;for(let k=0;k<water.length;k++)n+=water[k];return n;};
  const cellOf=(x,y)=>[Math.floor((x-x0)/CELL),Math.floor((y-y0)/CELL)];
  // polygons
  for(const f of cached("water")){
    const geom=f.geometry,polys=geom?.type==="Polygon"?[geom.coordinates]:geom?.type==="MultiPolygon"?geom.coordinates:[];
    // scanline fill (even-odd over all rings → holes handled): O(rows × edges)
    for(const poly of polys){const rings=poly.map(r=>r.map(p=>project(p[0],p[1])));const outer=rings[0];stats.polys++;if(!outer||outer.length<3)continue;stats.rings+=rings.length;if(!stats.bbox)stats.bbox=[outer[0][0],outer[0][1],typeof outer[0][0],Array.isArray(outer[0])];
      let minY=Infinity,maxY=-Infinity;for(const p of outer){minY=Math.min(minY,p[1]);maxY=Math.max(maxY,p[1]);}
      const ja=Math.max(0,cellOf(0,minY)[1]),jb=Math.min(N-1,cellOf(0,maxY)[1]),xs=[];
      for(let j=ja;j<=jb;j++){const y=y0+(j+.5)*CELL;xs.length=0;
        for(const ring of rings)for(let a=0,c=ring.length-1;a<ring.length;c=a++){const ya=ring[a][1],yc=ring[c][1];if((ya>y)!==(yc>y))xs.push(ring[a][0]+(y-ya)/(yc-ya)*(ring[c][0]-ring[a][0]));}
        xs.sort((p,q)=>p-q);for(let k=0;k+1<xs.length;k+=2){const ia=Math.max(0,Math.ceil((xs[k]-x0)/CELL-.5)),ib=Math.min(N-1,Math.floor((xs[k+1]-x0)/CELL-.5));for(let i=ia;i<=ib;i++)water[i*N+j]=1;}
        if(++steps%60===0)yield;}}
  }
  // waterways (lines with width): mark cells and record the flow direction
  stats.polyCells=countWater();
  const ways=[];
  for(const f of cached("waterway")){const cls=String(f.properties?.class||"stream").toLowerCase(),w=WIDTH[cls]??4;if(f.properties?.brunnel==="tunnel")continue;const geom=f.geometry,lines=geom?.type==="LineString"?[geom.coordinates]:geom?.type==="MultiLineString"?geom.coordinates:[];
    for(const line of lines){const pts=line.map(p=>project(p[0],p[1]));for(let k=0;k<pts.length-1;k++){const a=pts[k],c=pts[k+1],dx=c[0]-a[0],dy=c[1]-a[1],l=Math.hypot(dx,dy);if(l<.2)continue;ways.push({a,c,ux:dx/l,uy:dy/l,l,w,v:cls==="river"?1.6:cls==="canal"?.5:1.1});}}}
  for(const s of ways){const r=s.w/2+CELL,minX=Math.min(s.a[0],s.c[0])-r,maxX=Math.max(s.a[0],s.c[0])+r,minY=Math.min(s.a[1],s.c[1])-r,maxY=Math.max(s.a[1],s.c[1])+r,[i0,j0]=cellOf(minX,minY),[i1,j1]=cellOf(maxX,maxY);
    for(let i=Math.max(0,i0);i<=Math.min(N-1,i1);i++)for(let j=Math.max(0,j0);j<=Math.min(N-1,j1);j++){const x=x0+(i+.5)*CELL,y=y0+(j+.5)*CELL,t=Math.max(0,Math.min(s.l,(x-s.a[0])*s.ux+(y-s.a[1])*s.uy)),px=s.a[0]+s.ux*t,py=s.a[1]+s.uy*t,d=Math.hypot(x-px,y-py);if(d<=s.w/2)water[i*N+j]=1;if(d<s.w/2+30&&speed[i*N+j]<s.v*(1-d/(s.w/2+30))){flowX[i*N+j]=s.ux;flowY[i*N+j]=s.uy;speed[i*N+j]=s.v*(1-d/(s.w/2+30));}}
    if(++steps%60===0)yield;}
  stats.ways=ways.length;stats.wayCells=countWater();
  // shore distance (two-pass chamfer distance transform, in cells)
  const dist=new Float32Array(N*N);for(let k=0;k<N*N;k++)dist[k]=water[k]?1e6:0;
  for(let i=0;i<N;i++)for(let j=0;j<N;j++){const k=i*N+j;if(!water[k])continue;let d=dist[k];if(i>0)d=Math.min(d,dist[k-N]+1);if(j>0)d=Math.min(d,dist[k-1]+1);if(i>0&&j>0)d=Math.min(d,dist[k-N-1]+1.414);if(i>0&&j<N-1)d=Math.min(d,dist[k-N+1]+1.414);dist[k]=i===0||j===0?Math.min(d,1):d;}
  yield;
  for(let i=N-1;i>=0;i--)for(let j=N-1;j>=0;j--){const k=i*N+j;if(!water[k])continue;let d=dist[k];if(i<N-1)d=Math.min(d,dist[k+N]+1);if(j<N-1)d=Math.min(d,dist[k+1]+1);if(i<N-1&&j<N-1)d=Math.min(d,dist[k+N+1]+1.414);if(i<N-1&&j>0)d=Math.min(d,dist[k+N-1]+1.414);dist[k]=d;}
  yield;
  // mesh: one quad per water cell, vertex attributes shared per corner
  const pos=[],shore=[],flow=[],idx=[],corner=new Map();
  const vtx=(ci,cj)=>{const key=ci*(N+1)+cj;let v=corner.get(key);if(v!==undefined)return v;let d=0,fx=0,fy=0,sp=0,n=0;for(const[di,dj]of[[0,0],[-1,0],[0,-1],[-1,-1]]){const i=ci+di,j=cj+dj;if(i<0||j<0||i>=N||j>=N)continue;const k=i*N+j;if(!water[k])continue;d+=dist[k];fx+=flowX[k];fy+=flowY[k];sp+=speed[k];n++;}
    const allWater=n===4;v=pos.length/3;pos.push(x0+ci*CELL,y0+cj*CELL,.03);shore.push(allWater?d/n*CELL:0);flow.push(n?fx/n*sp/n:0,n?fy/n*sp/n:0);corner.set(key,v);return v;};
  let cells=0;for(let i=0;i<N;i++){for(let j=0;j<N;j++){if(!water[i*N+j])continue;const a=vtx(i,j),bb=vtx(i+1,j),c=vtx(i+1,j+1),d=vtx(i,j+1);idx.push(a,bb,c,a,c,d);cells++;}if(i%24===0)yield;}
  // physics basins: greedy-merge cells into rectangles (rows, then stacked)
  // (on an 8 m grid — a block counts as water when ≥3 of its 4 cells are —
  //  so the physics stays a few dozen boxes even for a big river)
  const M=Math.ceil(N/2),coarse=new Uint8Array(M*M);
  for(let i=0;i<N;i++)for(let j=0;j<N;j++)if(water[i*N+j])coarse[(i>>1)*M+(j>>1)]++;
  for(let k=0;k<M*M;k++)coarse[k]=coarse[k]>=3?1:0;
  const rects=[],used=new Uint8Array(M*M),PC=CELL*2;
  for(let j=0;j<M;j++)for(let i=0;i<M;i++){const k=i*M+j;if(!coarse[k]||used[k])continue;let w=1;while(i+w<M&&coarse[(i+w)*M+j]&&!used[(i+w)*M+j])w++;let h=1;outer:while(j+h<M){for(let t=0;t<w;t++){const kk=(i+t)*M+j+h;if(!coarse[kk]||used[kk])break outer;}h++;}for(let a=0;a<w;a++)for(let c=0;c<h;c++)used[(i+a)*M+j+c]=1;rects.push({x0:x0+i*PC,y0:y0+j*PC,x1:x0+(i+w)*PC,y1:y0+(j+h)*PC});}
  // bridges: road segments flagged as bridges that cross water
  const decks=[];
  for(const f of cached("transportation")){const cls=String(f.properties?.class||"minor"),w={motorway:14,trunk:12,primary:11,secondary:9,tertiary:8}[cls]??6.5,geom=f.geometry,lines=geom?.type==="LineString"?[geom.coordinates]:geom?.type==="MultiLineString"?geom.coordinates:[];
    for(const line of lines){const pts=line.map(p=>project(p[0],p[1]));for(let k=0;k<pts.length-1;k++){const a=pts[k],c=pts[k+1],l=Math.hypot(c[0]-a[0],c[1]-a[1]);if(l<.5)continue;decks.push({cx:(a[0]+c[0])/2,cy:(a[1]+c[1])/2,hl:l/2+1,hw:w/2+1.5,yaw:Math.atan2(c[1]-a[1],c[0]-a[0])});}}}
  // flow field query for the physics (nearest cell)
  const flowAt=(x,y)=>{const i=Math.floor((x-x0)/CELL),j=Math.floor((y-y0)/CELL);if(i<0||j<0||i>=N||j>=N)return[0,0];const k=i*N+j;return[flowX[k]*speed[k],flowY[k]*speed[k]];};
  return{pos,shore,flow,idx,rects,decks,flowAt,cells,stats};
}
function makeMaterial(){
  const m=new THREE.MeshStandardMaterial({color:0x1d4d63,roughness:.06,metalness:0,transparent:true,opacity:.92,depthWrite:false,envMapIntensity:1.25});
  m.onBeforeCompile=shader=>{Object.assign(shader.uniforms,waterUniforms);
    shader.vertexShader=shader.vertexShader.replace("void main() {","attribute float aShore;attribute vec2 aFlow;varying float vShore;varying vec2 vFlow;varying vec3 vWP;\nvoid main() {vShore=aShore;vFlow=aFlow;").replace("#include <begin_vertex>","#include <begin_vertex>\nvWP=(modelMatrix*vec4(transformed,1.0)).xyz;");
    shader.fragmentShader=shader.fragmentShader.replace("void main() {",`uniform float uTime;varying float vShore;varying vec2 vFlow;varying vec3 vWP;
vec2 waveGrad(vec2 p,vec2 dir,float k,float sp,float a){float ph=dot(p,dir)*k-uTime*sp;return dir*cos(ph)*k*a;}
float wh(vec2 p){return fract(sin(dot(floor(p),vec2(41.3,289.1)))*43758.5);}
float wn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(wh(i),wh(i+vec2(1,0)),f.x),mix(wh(i+vec2(0,1)),wh(i+vec2(1,1)),f.x),f.y);}
void main() {`).replace("#include <color_fragment>",`#include <color_fragment>
  float fl=length(vFlow);vec2 fd=fl>0.01?vFlow/fl:normalize(vec2(0.8,0.6));vec2 side=vec2(-fd.y,fd.x);
  vec2 adv=vWP.xy-vFlow*uTime*2.2;
  float wDepth=clamp(vShore/9.0,0.0,1.0);
  diffuseColor.rgb=mix(vec3(0.16,0.36,0.38),vec3(0.05,0.17,0.24),wDepth);
  float foam=smoothstep(0.55,0.95,wn(adv*0.6+uTime*0.15))*(1.0-smoothstep(0.0,2.4,vShore))+smoothstep(0.75,1.0,wn(adv*1.3))*smoothstep(0.6,1.6,fl)*0.6;
  diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.9,0.94,0.95),clamp(foam,0.0,0.85));
  diffuseColor.a=mix(0.55,0.94,smoothstep(0.0,3.0,vShore));`).replace("#include <normal_fragment_maps>",`#include <normal_fragment_maps>
  {vec2 g=waveGrad(adv,fd,0.9,2.1,0.05)+waveGrad(adv,normalize(fd+side*0.6),1.7,3.0,0.03)+waveGrad(adv,normalize(side-fd*0.3),2.9,4.2,0.018)+waveGrad(vWP.xy,normalize(vec2(0.6,-0.8)),5.3,6.0,0.008);
   vec3 wN=normalize(vec3(-g.x,-g.y,1.0));normal=normalize((viewMatrix*vec4(wN,0.0)).xyz);}`)
      .replace("#include <roughnessmap_fragment>","#include <roughnessmap_fragment>\nroughnessFactor=mix(0.05,0.6,clamp(foam,0.0,1.0));");
  };
  m.customProgramCacheKey=()=>"world-water-v1";return m;
}
function ensureMesh(scene){
  if(mesh?.parent===scene)return mesh;material??=makeMaterial();mesh=new THREE.Mesh(new THREE.BufferGeometry(),material);mesh.name="WORLD_WATER";mesh.frustumCulled=false;mesh.renderOrder=-1;mesh.receiveShadow=true;mesh.userData.flightFireIgnore=true;mesh.userData.styleSkip=true;mesh.raycast=()=>{};scene.add(mesh);center=[Infinity,Infinity];return mesh;
}
function frame(now){
  requestAnimationFrame(frame);waterUniforms.uTime.value=now/1000;const b=bridge();
  if(!b?.active||!b.threeScene||!b.map||!b.buildingSourceId||typeof b.projectLngLat!=="function"){if(mesh)mesh.visible=false;return;}
  ensureMesh(b.threeScene);mesh.visible=true;
  if(now-lastHarvest>600){lastHarvest=now;harvest(b);}
  if(job){const until=performance.now()+SLICE_MS;let r;try{while(performance.now()<until){r=job.next();if(r.done)break;}}catch(error){job=null;center=[Infinity,Infinity];const view=document.getElementById("viewport");if(view)view.dataset.worldWaterState=`error:${String(error?.message||error).slice(0,80)}`;console.warn("world water build failed",error);return;}
    if(r?.done){const v=r.value,g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(v.pos,3));g.setAttribute("normal",new THREE.Float32BufferAttribute(new Float32Array(v.pos.length).map((_,i)=>i%3===2?1:0),3));g.setAttribute("aShore",new THREE.Float32BufferAttribute(v.shore,1));g.setAttribute("aFlow",new THREE.Float32BufferAttribute(v.flow,2));g.setIndex(v.idx);mesh.geometry.dispose();mesh.geometry=g;
      setBridgeDecks(v.decks);setWaterRegions(v.rects,v.flowAt);job=null;const view=document.getElementById("viewport");if(view){view.dataset.worldWaterCells=String(v.cells);view.dataset.worldWaterBasins=String(v.rects.length);view.dataset.worldWaterBridges=String(v.decks.length);view.dataset.worldWater=WORLD_WATER_VERSION;view.dataset.worldWaterState=`done:${builtCount}`;try{view.dataset.worldWaterStats=JSON.stringify(v.stats);}catch{}}}
    return;}
  const cam=b.threeCamera;if(!cam||now-lastTry<3000)return;lastTry=now;const count=cache.water.size+cache.waterway.size,roads=cache.transportation.size;
  if(!roads&&!count)return;const moved=Math.hypot(cam.position.x-center[0],cam.position.y-center[1]);if(moved<REBUILD_MOVE_M&&count<=builtCount*1.15+2&&roads<=builtRoads*1.3+20)return;builtCount=count;builtRoads=roads;center=[cam.position.x,cam.position.y];job=build(b,center[0],center[1]);const view=document.getElementById("viewport");if(view)view.dataset.worldWaterState=`building:${count}`;
}
export function installWorldWater(){if(installed||typeof window==="undefined")return;installed=true;globalThis.__worldWater={level:WATER_LEVEL_M,version:WORLD_WATER_VERSION};requestAnimationFrame(frame);}
installWorldWater();
