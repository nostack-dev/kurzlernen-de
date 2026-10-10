import * as THREE from "three";
import {patchShockMaterial} from "./nuke_shock_field.mjs";
import {staticGroundHeightAt as groundHeightAt,onTerrainChange,setRoadCorridors} from "./terrain_craters.mjs";
import {drapeTerrainTriangle} from "./terrain_surface.mjs";

// The real streets, parks and water of the map as stylized 3D ground:
//   * roads: asphalt ribbons sized by class, a lighter sidewalk band on both
//     sides, rounded joints, dashed centre lines on the bigger roads,
//   * parks / woods / grass areas: lush darker green; water: blue.
// One merged mesh (vertex colours, lit by the hero style like everything
// else), rebuilt time-sliced when the player has moved far. No textures.

export const CITY_ROADS_VERSION="map-roads-sidewalks-parks-v3-terrain-draped";
const RADIUS_M=720,REBUILD_MOVE_M=260,MAX_FEATURES=2200,SLICE_MS=4;
const Z_AREA=.05,Z_SIDEWALK=.09,Z_ROAD=.112,Z_MARKING=.135,AREA_EDGE_M=8,ROAD_SEG_M=6;
const WIDTH={motorway:14,trunk:12,primary:11,secondary:9,tertiary:8,minor:6.5,service:4.2,track:3,path:2.2,pedestrian:3.6,raceway:8,busway:7};
const C={asphalt:0x3c3f44,asphaltMajor:0x34373c,sidewalk:0x86837c,line:0xe6e4dc,lineYellow:0xd6b54a,park:0x4f6e35,wood:0x3a5729,water:0x2f5f86,pitch:0x4f7a35,sand:0xc9b88f};
const CHUNK_M=420;let material=null;
let installed=false,mesh=null,sceneRef=null,center=[Infinity,Infinity],building=null,lastTry=-Infinity,builtCount=0;
const bridge=()=>globalThis.__arondightRealWorld||null;

// MapLibre answers only for the tiles it holds at that instant, so features
// are accumulated across queries (keyed by geometry) and pruned when far.
const cache=new Map();
function firstPoint(c){while(Array.isArray(c?.[0]))c=c[0];return c;}
function pointCount(c){return Array.isArray(c[0])?c.reduce((n,x)=>n+pointCount(x),0):1;}
function features(b,layer){
  let m=cache.get(layer);if(!m){m=new Map();cache.set(layer,m);}
  let fresh=[];try{fresh=b.map.querySourceFeatures(b.buildingSourceId,{sourceLayer:layer})||[];}catch{}
  for(const f of fresh){let g;try{g=f.geometry;}catch{continue;}if(!g?.coordinates?.length)continue;const p=firstPoint(g.coordinates);if(!p)continue;const key=`${g.type}:${(+p[0]).toFixed(6)},${(+p[1]).toFixed(6)}:${pointCount(g.coordinates)}`;if(!m.has(key))m.set(key,{properties:{...f.properties},geometry:{type:g.type,coordinates:g.coordinates}});}
  if(m.size>9000&&b.threeCamera){const c=b.threeCamera.position;for(const[k,f]of m){const q=firstPoint(f.geometry.coordinates),[x,y]=b.projectLngLat(q[0],q[1]);if(Math.hypot(x-c.x,y-c.y)>3000)m.delete(k);}}
  return[...m.values()];
}
function lines(geometry){if(!geometry)return[];if(geometry.type==="LineString")return[geometry.coordinates];if(geometry.type==="MultiLineString")return geometry.coordinates;return[];}
function polys(geometry){if(!geometry)return[];if(geometry.type==="Polygon")return[geometry.coordinates];if(geometry.type==="MultiPolygon")return geometry.coordinates;return[];}

function* build(b,cx,cy){
  const buckets=new Map(),c=new THREE.Color(),seen=new Set();let n=0;
  // chunked output (frustum culling) — every triangle goes to the tile of its first vertex
  const bucket=(x,y)=>{const k=`${Math.floor(x/CHUNK_M)},${Math.floor(y/CHUNK_M)}`;let bk=buckets.get(k);if(!bk){bk={pos:[],col:[]};buckets.set(k,bk);}return bk;};let cur=null;
  const project=(lon,lat)=>b.projectLngLat(lon,lat);
  const push=(x,y,z,color)=>{cur.pos.push(x,y,z);c.set(color);cur.col.push(c.r,c.g,c.b);};
  // Everything is draped on the terrain: every vertex gets its own ground
  // height (+ a small layer offset), long edges are subdivided first.
  // Streets sit on level road corridors (terrain_craters.setRoadCorridors), so
  // per-vertex draping on short segments matches the ground exactly enough;
  // no grid-clipping (that turned the road net into 650k triangles).
  const tri=(ax,ay,bx,by,qx,qy,z,color)=>{cur=bucket(ax,ay);push(ax,ay,h(ax,ay)+z,color);push(bx,by,h(bx,by)+z,color);push(qx,qy,h(qx,qy)+z,color);};
  const drape=(ax,ay,bx,by,qx,qy,z,color,depth=0)=>{
    const gx=(ax+bx+qx)/3,gy=(ay+by+qy)/3,rr=Math.max(Math.hypot(ax-gx,ay-gy),Math.hypot(bx-gx,by-gy),Math.hypot(qx-gx,qy-gy));if(Math.hypot(gx-cx,gy-cy)-rr>RADIUS_M+40)return;
    const ab=Math.hypot(bx-ax,by-ay),bq=Math.hypot(qx-bx,qy-by),qa=Math.hypot(ax-qx,ay-qy),m=Math.max(ab,bq,qa);
    if(m<=AREA_EDGE_M||depth>18){tri(ax,ay,bx,by,qx,qy,z,color);return;}
    if(m===ab){const mx=(ax+bx)/2,my=(ay+by)/2;drape(ax,ay,mx,my,qx,qy,z,color,depth+1);drape(mx,my,bx,by,qx,qy,z,color,depth+1);}
    else if(m===bq){const mx=(bx+qx)/2,my=(by+qy)/2;drape(ax,ay,bx,by,mx,my,z,color,depth+1);drape(ax,ay,mx,my,qx,qy,z,color,depth+1);}
    else{const mx=(qx+ax)/2,my=(qy+ay)/2;drape(ax,ay,bx,by,mx,my,z,color,depth+1);drape(mx,my,bx,by,qx,qy,z,color,depth+1);}};
  const quad=(a,b2,c2,d,z,color)=>{tri(a[0],a[1],b2[0],b2[1],c2[0],c2[1],z,color);tri(a[0],a[1],c2[0],c2[1],d[0],d[1],z,color);};
  const disk=(x,y,r,z,color,seg=8)=>{for(let i=0;i<seg;i++){const a0=i/seg*Math.PI*2,a1=(i+1)/seg*Math.PI*2;tri(x,y,x+Math.cos(a0)*r,y+Math.sin(a0)*r,x+Math.cos(a1)*r,y+Math.sin(a1)*r,z,color);}};
  const near=(x,y)=>Math.hypot(x-cx,y-cy)<RADIUS_M;
  const h=(x,y)=>groundHeightAt(x,y);
  // areas (parks, woods, pitches, sand): painted into the ground's own colours (no extra triangles)
  const areas=[],meadows=[];
  for(const layer of["park","landcover","landuse"]){
    for(const f of features(b,layer)){
      const cls=String(f.properties?.class||f.properties?.subclass||layer).toLowerCase();let color=null,z=Z_AREA;
      if(layer==="water"){color=C.water;z=Z_AREA+.012;}else if(/park|garden|grass|meadow|recreation|cemetery|village_green/.test(cls))color=C.park;else if(/wood|forest|scrub/.test(cls))color=C.wood;else if(/pitch|playground|stadium/.test(cls))color=C.pitch;else if(/sand|beach/.test(cls))color=C.sand;
      const pasture=/meadow|grass|farmland|village_green|pasture/.test(cls)&&!/park|garden|cemetery|recreation/.test(cls);
      if(!color&&!pasture)continue;
      for(const poly of polys(f.geometry)){const outer=(poly[0]||[]).map(p=>project(p[0],p[1]));if(outer.length<3||!outer.some(p=>near(p[0],p[1])))continue;const key=`${layer}:${Math.round(outer[0][0])},${Math.round(outer[0][1])}:${outer.length}`;if(seen.has(key))continue;seen.add(key);
        const v=outer.map(p=>new THREE.Vector2(p[0],p[1])),holes=poly.slice(1).map(r=>r.map(p=>{const m=project(p[0],p[1]);return new THREE.Vector2(m[0],m[1]);}));
        // pastures (meadow, grassland, farmland): where cows graze (cows.mjs); keyed by geo so every player gets the same herd
        if(pasture){const g0=poly[0][0];meadows.push({key:`${cls}:${(+g0[0]).toFixed(5)},${(+g0[1]).toFixed(5)}:${outer.length}`,cls,outer,holes:holes.map(r=>r.map(q=>[q.x,q.y]))});}
        if(color)areas.push({outer,holes:holes.map(r=>r.map(q=>[q.x,q.y])),color});
        if(++n%30===0)yield;}
    }
  }
  globalThis.__worldGround?.setAreas?.(areas);globalThis.__worldMeadows=meadows;try{window.dispatchEvent(new CustomEvent("arondight:world-meadows",{detail:{count:meadows.length}}));}catch{}
  // roads: sidewalk band, then asphalt, then markings
  const roads=[];
  for(const f of features(b,"transportation")){
    const cls=String(f.properties?.class||"minor").toLowerCase();if(cls==="rail"||cls==="transit"||cls==="ferry"||cls==="aerialway")continue;if(f.properties?.brunnel==="tunnel")continue;
    const w=WIDTH[cls]??5;for(const line of lines(f.geometry)){const pts=line.map(p=>project(p[0],p[1]));if(pts.length<2||!pts.some(p=>near(p[0],p[1])))continue;const key=`${cls}:${Math.round(pts[0][0])},${Math.round(pts[0][1])}:${Math.round(pts.at(-1)[0])},${Math.round(pts.at(-1)[1])}`;if(seen.has(key))continue;seen.add(key);roads.push({cls,w,pts});if(roads.length>=MAX_FEATURES)break;}
  }
  // level road corridors in the terrain (drivable, flat across); the roads are draped after the change
  setRoadCorridors(roads.filter(r=>r.cls!=="path"&&r.cls!=="track").map(r=>({pts:r.pts,w:r.w+3.4})));
  globalThis.__streetLamps?.setRoads?.(roads,cx,cy);
  const ribbon=(pts,w,z,color,caps=true)=>{for(let i=0;i<pts.length-1;i++){const a=pts[i],b2=pts[i+1],dx=b2[0]-a[0],dy=b2[1]-a[1],l=Math.hypot(dx,dy);if(l<.05)continue;const nx=-dy/l*w/2,ny=dx/l*w/2,k=Math.max(1,Math.ceil(l/ROAD_SEG_M));for(let s=0;s<k;s++){const t0=s/k,t1=(s+1)/k,p0x=a[0]+dx*t0,p0y=a[1]+dy*t0,p1x=a[0]+dx*t1,p1y=a[1]+dy*t1;quad([p0x+nx,p0y+ny],[p0x-nx,p0y-ny],[p1x-nx,p1y-ny],[p1x+nx,p1y+ny],z,color);}}if(caps)for(let i=0;i<pts.length;i++){const p=pts[i];if(i>0&&i<pts.length-1){const a=pts[i-1],q=pts[i+1],ax=p[0]-a[0],ay=p[1]-a[1],bx=q[0]-p[0],by=q[1]-p[1],cosT=(ax*bx+ay*by)/((Math.hypot(ax,ay)*Math.hypot(bx,by))||1);if(cosT>.966)continue;}disk(p[0],p[1],w/2,z,color,i===0||i===pts.length-1?8:6);}};
  for(const r of roads){if(r.cls==="path"||r.cls==="track"||r.cls==="service")continue;ribbon(r.pts,r.w+3.4,Z_SIDEWALK,C.sidewalk);if(++n%40===0)yield;}
  // Layers are drawn in buffer order without depth writes (see material): a
  // later layer always covers an earlier one where they overlap, so crossing
  // paths, roads and junction caps never z-fight. Order: footpaths/tracks,
  // service, minor roads, major roads, then markings.
  const rank=r=>r.cls==="path"||r.cls==="track"?0:r.cls==="service"||r.cls==="pedestrian"?1:/motorway|trunk|primary|secondary/.test(r.cls)?3:2;
  for(let layer=0;layer<4;layer++)for(const r of roads){if(rank(r)!==layer)continue;const major=layer===3;ribbon(r.pts,r.w,Z_ROAD,r.cls==="path"||r.cls==="track"?0xc9b892:major?C.asphaltMajor:C.asphalt);if(++n%40===0)yield;}
  for(const r of roads){if(!/motorway|trunk|primary|secondary|tertiary/.test(r.cls))continue;const color=/motorway|trunk/.test(r.cls)?C.lineYellow:C.line;
    for(let i=0;i<r.pts.length-1;i++){const a=r.pts[i],b2=r.pts[i+1],dx=b2[0]-a[0],dy=b2[1]-a[1],l=Math.hypot(dx,dy);if(l<1)continue;const ux=dx/l,uy=dy/l,nx=-uy*.09,ny=ux*.09;for(let s=1;s+3<l;s+=7){const x0=a[0]+ux*s,y0=a[1]+uy*s,x1=x0+ux*3,y1=y0+uy*3;quad([x0+nx,y0+ny],[x0-nx,y0-ny],[x1-nx,y1-ny],[x1+nx,y1+ny ],Z_MARKING,color);}}
    if(++n%40===0)yield;}
  return{buckets:[...buckets.values()],roads:roads.length};
}
// Asphalt is never one flat grey: patches of older/newer tarmac (≈3 m) and fine grain (≈25 cm, faded
// out with distance so it never shimmers), in world space so it lies still under the car.
function asphalt(material){const prev=material.onBeforeCompile;material.onBeforeCompile=(shader,renderer)=>{prev?.call(material,shader,renderer);
  shader.vertexShader=shader.vertexShader.replace("void main() {","varying vec2 vRoadW;\nvoid main() {").replace("#include <begin_vertex>","#include <begin_vertex>\nvRoadW=(modelMatrix*vec4(transformed,1.0)).xy;");
  shader.fragmentShader=shader.fragmentShader.replace("void main() {","varying vec2 vRoadW;\nfloat rdh(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.55);}\nfloat rdn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(rdh(i),rdh(i+vec2(1,0)),f.x),mix(rdh(i+vec2(0,1)),rdh(i+vec2(1,1)),f.x),f.y);}\nvoid main() {")
    .replace("#include <color_fragment>","#include <color_fragment>\n{vec2 q=mod(vRoadW,4096.0);float big=rdn(q*0.33),fine=rdn(q*4.0),fade=clamp(1.0-length(fwidth(q*4.0))*0.7,0.0,1.0);diffuseColor.rgb*=0.9+0.15*big+0.1*(fine-0.5)*fade;}");};
  const key=material.customProgramCacheKey;material.customProgramCacheKey=function(){return `${key?key.call(this):""}|asphalt-v1`;};return material;}
function ensureMesh(scene){
  if(mesh?.parent===scene)return mesh;material??=patchShockMaterial(asphalt(new THREE.MeshStandardMaterial({vertexColors:true,roughness:.93,metalness:0,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-4,depthWrite:false})));mesh=new THREE.Group();
  mesh.name="WORLD_CITY_ROADS";mesh.receiveShadow=true;mesh.renderOrder=2;/* group order: after the ground (1) — roads do not write depth */mesh.userData.flightFireIgnore=true;mesh.raycast=()=>{};scene.add(mesh);sceneRef=scene;center=[Infinity,Infinity];return mesh;
}
function frame(now){
  requestAnimationFrame(frame);const b=bridge();if(!b?.active||!b.threeScene||!b.map||!b.buildingSourceId||typeof b.projectLngLat!=="function"){if(mesh)mesh.visible=Boolean(b?.active);return;}
  ensureMesh(b.threeScene);
  if(building){const until=performance.now()+SLICE_MS;let r;while(performance.now()<until){r=building.next();if(r.done)break;}
    if(r?.done){const{buckets,roads}=r.value;for(const old of[...mesh.children]){old.geometry.dispose();mesh.remove(old);}
      for(const bk of buckets){const g=new THREE.BufferGeometry(),nv=bk.pos.length/3;g.setAttribute("position",new THREE.Float32BufferAttribute(bk.pos,3));g.setAttribute("color",new THREE.Float32BufferAttribute(bk.col,3));g.setAttribute("normal",new THREE.Float32BufferAttribute(new Float32Array(nv*3).map((_,i)=>i%3===2?1:0),3));g.computeBoundingSphere();const m=new THREE.Mesh(g,material);m.name="WORLD_CITY_ROADS_CHUNK";m.receiveShadow=true;m.renderOrder=2;m.matrixAutoUpdate=false;m.userData.flightFireIgnore=true;m.raycast=()=>{};mesh.add(m);}
      mesh.visible=true;building=null;if(!roads)center=[Infinity,Infinity];const v=document.getElementById("viewport");if(v){v.dataset.worldCityRoads=String(roads);v.dataset.worldCityRoadsVersion=CITY_ROADS_VERSION;}}
    return;}
  // Rebuild when the player moved far, or when more map tiles have loaded
  // since the last build (the first build often sees only a few tiles).
  const cam=b.threeCamera,focus=globalThis.__arondightStreamFocus?.()||cam?.position;if(!cam||!focus||now-lastTry<(globalThis.__jetMode?.active?900:2500))return;lastTry=now;const moved=Math.hypot(focus.x-center[0],focus.y-center[1]),count=features(b,"transportation").length+features(b,"park").length+features(b,"landcover").length+features(b,"landuse").length;
  if(!count)return;if(moved<REBUILD_MOVE_M&&count<=builtCount*1.15+5)return;builtCount=count;center=[focus.x,focus.y];building=build(b,center[0],center[1]);
}
export function installCityRoads(){if(installed||typeof window==="undefined")return;installed=true;onTerrainChange((_c,_r,source)=>{if(source==="roads"){center=[Infinity,Infinity];lastTry=-Infinity;return;}building=null;center=[Infinity,Infinity];builtCount=0;lastTry=-Infinity;if(mesh)mesh.visible=false;});requestAnimationFrame(frame);}
installCityRoads();
