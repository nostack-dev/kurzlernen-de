import * as THREE from "three";
import {groundHeightAt} from "./terrain_craters.mjs";

// The real streets, parks and water of the map as stylized 3D ground:
//   * roads: asphalt ribbons sized by class, a lighter sidewalk band on both
//     sides, rounded joints, dashed centre lines on the bigger roads,
//   * parks / woods / grass areas: lush darker green; water: blue.
// One merged mesh (vertex colours, lit by the hero style like everything
// else), rebuilt time-sliced when the player has moved far. No textures.

export const CITY_ROADS_VERSION="map-roads-sidewalks-parks-v1";
const RADIUS_M=720,REBUILD_MOVE_M=260,MAX_FEATURES=2200,SLICE_MS=4;
const WIDTH={motorway:14,trunk:12,primary:11,secondary:9,tertiary:8,minor:6.5,service:4.2,track:3,path:2.2,pedestrian:3.6,raceway:8,busway:7};
const C={asphalt:0x3c3f44,asphaltMajor:0x34373c,sidewalk:0x9d9a93,line:0xe6e4dc,lineYellow:0xd6b54a,park:0x4f6e35,wood:0x3a5729,water:0x2f5f86,pitch:0x4f7a35,sand:0xc9b88f};
let installed=false,mesh=null,sceneRef=null,center=[Infinity,Infinity],building=null,lastTry=-Infinity;
const bridge=()=>globalThis.__arondightRealWorld||null;

function features(b,layer){try{return b.map.querySourceFeatures(b.buildingSourceId,{sourceLayer:layer})||[];}catch{return[];}}
function lines(geometry){if(!geometry)return[];if(geometry.type==="LineString")return[geometry.coordinates];if(geometry.type==="MultiLineString")return geometry.coordinates;return[];}
function polys(geometry){if(!geometry)return[];if(geometry.type==="Polygon")return[geometry.coordinates];if(geometry.type==="MultiPolygon")return geometry.coordinates;return[];}

function* build(b,cx,cy){
  const pos=[],col=[],nrm=[],c=new THREE.Color(),seen=new Set();let n=0;
  const project=(lon,lat)=>b.projectLngLat(lon,lat);
  const push=(x,y,z,color)=>{pos.push(x,y,z);c.set(color);col.push(c.r,c.g,c.b);nrm.push(0,0,1);};
  const tri=(ax,ay,bx,by,qx,qy,z,color)=>{push(ax,ay,z,color);push(bx,by,z,color);push(qx,qy,z,color);};
  const quad=(a,b2,c2,d,z,color)=>{tri(a[0],a[1],b2[0],b2[1],c2[0],c2[1],z,color);tri(a[0],a[1],c2[0],c2[1],d[0],d[1],z,color);};
  const disk=(x,y,r,z,color,seg=8)=>{for(let i=0;i<seg;i++){const a0=i/seg*Math.PI*2,a1=(i+1)/seg*Math.PI*2;tri(x,y,x+Math.cos(a0)*r,y+Math.sin(a0)*r,x+Math.cos(a1)*r,y+Math.sin(a1)*r,z,color);}};
  const near=(x,y)=>Math.hypot(x-cx,y-cy)<RADIUS_M;
  const h=(x,y)=>groundHeightAt(x,y);
  // areas first (lowest): parks, woods, pitches, water
  for(const layer of["park","landcover","landuse","water"]){
    for(const f of features(b,layer)){
      const cls=String(f.properties?.class||f.properties?.subclass||layer).toLowerCase();let color=null,z=.012;
      if(layer==="water"){color=C.water;z=.016;}else if(/park|garden|grass|meadow|recreation|cemetery|village_green/.test(cls))color=C.park;else if(/wood|forest|scrub/.test(cls))color=C.wood;else if(/pitch|playground|stadium/.test(cls))color=C.pitch;else if(/sand|beach/.test(cls))color=C.sand;
      if(!color)continue;
      for(const poly of polys(f.geometry)){const outer=(poly[0]||[]).map(p=>project(p[0],p[1]));if(outer.length<3||!outer.some(p=>near(p[0],p[1])))continue;const key=`${layer}:${Math.round(outer[0][0])},${Math.round(outer[0][1])}:${outer.length}`;if(seen.has(key))continue;seen.add(key);
        const v=outer.map(p=>new THREE.Vector2(p[0],p[1])),holes=poly.slice(1).map(r=>r.map(p=>{const m=project(p[0],p[1]);return new THREE.Vector2(m[0],m[1]);}));
        try{const all=[...v,...holes.flat()];for(const t of THREE.ShapeUtils.triangulateShape(v,holes)){const a=all[t[0]],bb=all[t[1]],cc=all[t[2]];let A=a,B=bb,Cc=cc;if((B.x-A.x)*(Cc.y-A.y)-(B.y-A.y)*(Cc.x-A.x)<0)[B,Cc]=[Cc,B];tri(A.x,A.y,B.x,B.y,Cc.x,Cc.y,z+h(A.x,A.y),color);}}catch{}
        if(++n%30===0)yield;}
    }
  }
  // roads: sidewalk band, then asphalt, then markings
  const roads=[];
  for(const f of features(b,"transportation")){
    const cls=String(f.properties?.class||"minor").toLowerCase();if(cls==="rail"||cls==="transit"||cls==="ferry"||cls==="aerialway")continue;if(f.properties?.brunnel==="tunnel")continue;
    const w=WIDTH[cls]??5;for(const line of lines(f.geometry)){const pts=line.map(p=>project(p[0],p[1]));if(pts.length<2||!pts.some(p=>near(p[0],p[1])))continue;const key=`${cls}:${Math.round(pts[0][0])},${Math.round(pts[0][1])}:${Math.round(pts.at(-1)[0])},${Math.round(pts.at(-1)[1])}`;if(seen.has(key))continue;seen.add(key);roads.push({cls,w,pts});if(roads.length>=MAX_FEATURES)break;}
  }
  const ribbon=(pts,w,z,color,caps=true)=>{for(let i=0;i<pts.length-1;i++){const a=pts[i],b2=pts[i+1],dx=b2[0]-a[0],dy=b2[1]-a[1],l=Math.hypot(dx,dy);if(l<.05)continue;const nx=-dy/l*w/2,ny=dx/l*w/2;quad([a[0]+nx,a[1]+ny],[a[0]-nx,a[1]-ny],[b2[0]-nx,b2[1]-ny],[b2[0]+nx,b2[1]+ny],z+h(a[0],a[1]),color);}if(caps)for(const p of pts)disk(p[0],p[1],w/2,z+h(p[0],p[1]),color);};
  for(const r of roads){if(r.cls==="path"||r.cls==="track"||r.cls==="service")continue;ribbon(r.pts,r.w+3.4,.02,C.sidewalk);if(++n%40===0)yield;}
  for(const r of roads){const major=/motorway|trunk|primary|secondary/.test(r.cls);ribbon(r.pts,r.w,.03,r.cls==="path"?0xc9b892:major?C.asphaltMajor:C.asphalt);if(++n%40===0)yield;}
  for(const r of roads){if(!/motorway|trunk|primary|secondary|tertiary/.test(r.cls))continue;const color=/motorway|trunk/.test(r.cls)?C.lineYellow:C.line;
    for(let i=0;i<r.pts.length-1;i++){const a=r.pts[i],b2=r.pts[i+1],dx=b2[0]-a[0],dy=b2[1]-a[1],l=Math.hypot(dx,dy);if(l<1)continue;const ux=dx/l,uy=dy/l,nx=-uy*.09,ny=ux*.09;for(let s=1;s+3<l;s+=7){const x0=a[0]+ux*s,y0=a[1]+uy*s,x1=x0+ux*3,y1=y0+uy*3;quad([x0+nx,y0+ny],[x0-nx,y0-ny],[x1-nx,y1-ny],[x1+nx,y1+ny],.04+h(x0,y0),color);}}
    if(++n%40===0)yield;}
  return{pos,col,nrm,roads:roads.length};
}
function ensureMesh(scene){
  if(mesh?.parent===scene)return mesh;mesh=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshStandardMaterial({vertexColors:true,roughness:.93,metalness:0,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-2}));
  mesh.name="WORLD_CITY_ROADS";mesh.frustumCulled=false;mesh.receiveShadow=true;mesh.renderOrder=-2;mesh.userData.flightFireIgnore=true;mesh.raycast=()=>{};scene.add(mesh);sceneRef=scene;center=[Infinity,Infinity];return mesh;
}
function frame(now){
  requestAnimationFrame(frame);const b=bridge();if(!b?.active||!b.threeScene||!b.map||!b.buildingSourceId||typeof b.projectLngLat!=="function"){if(mesh)mesh.visible=Boolean(b?.active);return;}
  ensureMesh(b.threeScene);mesh.visible=true;
  if(building){const until=performance.now()+SLICE_MS;let r;while(performance.now()<until){r=building.next();if(r.done)break;}
    if(r?.done){const{pos,col,nrm,roads}=r.value;const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));g.setAttribute("color",new THREE.Float32BufferAttribute(col,3));g.setAttribute("normal",new THREE.Float32BufferAttribute(nrm,3));mesh.geometry.dispose();mesh.geometry=g;building=null;const v=document.getElementById("viewport");if(v){v.dataset.worldCityRoads=String(roads);v.dataset.worldCityRoadsVersion=CITY_ROADS_VERSION;}}
    return;}
  const cam=b.threeCamera;if(!cam||now-lastTry<1500)return;const moved=Math.hypot(cam.position.x-center[0],cam.position.y-center[1]);if(moved<REBUILD_MOVE_M)return;
  lastTry=now;if(!features(b,"transportation").length)return;center=[cam.position.x,cam.position.y];building=build(b,center[0],center[1]);
}
export function installCityRoads(){if(installed||typeof window==="undefined")return;installed=true;requestAnimationFrame(frame);}
installCityRoads();
