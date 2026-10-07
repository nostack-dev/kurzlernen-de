import * as THREE from "three";
import {buildingFootprintsFromFeatures,buildingFootprintHash} from "./world_building_collisions.mjs";
import {buildingDamage,destructionRevision,onDestruction} from "./world_destruction_state.mjs";
import {NEON_DEBUG_PALETTE,fatLineMaterial,fatLineGeometry,fatLineSegments} from "./box3d_collider_debug.mjs";
import {patchShockMaterial} from "./nuke_shock_field.mjs";
import {elevationAt,onElevationChange} from "./terrain_elevation.mjs";
// Buildings stand on the real terrain: the footprint's lowest ground point.
export function buildingTerrainBase(outer){let m=Infinity;for(const p of outer||[]){const x=Array.isArray(p)?p[0]:p.x,y=Array.isArray(p)?p[1]:p.y,e=elevationAt(+x,+y);if(e<m)m=e;}return Number.isFinite(m)?m:0;}

// The real city from the world map, drawn in the neon look.
// Every building footprint of the loaded map tiles within VISUAL_RADIUS_M is
// rendered as an opaque solid (baked sun shading) with neon outlines — the
// same real geometry (footprint, holes, height, min height) MapLibre would
// extrude, but owned by three.js so it never clips and never blinks in.
// Collision is separate (the nearest buildings, world_building_collisions);
// destruction applies to both through the shared damage state.
//
// Rebuilds are incremental: geometry for a new footprint set is assembled
// over several frames (time-sliced) and swapped in once complete, so moving
// through the city never stalls a frame and nothing pops in piecemeal.
//
// Destruction is instant: every building remembers its vertex ranges in the
// merged solid / outline buffers, so when the shock front reaches it its
// roof drops to the damaged height in the same frame (only that range is
// rewritten) — no wait for a rebuild. Buildings the wave hits but does not
// break sway outward and settle (decaying oscillation of their upper
// vertices). The full rebuild later produces the same shapes from the
// shared damage state.

export const CITY_BUILDINGS_VERSION="world-map-green-neon-v5-registered-outline";
const VISUAL_RADIUS_M=900,LINE_RADIUS_M=600,FAT_RADIUS_M=180,MAX_FOOTPRINTS=2600,MAX_VERTICES=96;
const RESYNC_MOVE_M=140,RESYNC_MS=2500,SLICE_MS=4;
// Realistic urban palette: plaster, sandstone, brick, concrete, painted
// render; dark slate / bitumen / terracotta roofs.
const WALLS=["#c9bfae","#b9a88c","#8e5443","#9c9a94","#d8d2c4","#a87c5f","#7d8590","#cbb79a"],ROOFS=["#4a4c50","#3b3d40","#6e4334","#55585c"],SUN=(()=>{const x=-.55,y=-.83,l=Math.hypot(x,y);return[x/l,y/l];})();

// The city is split into CHUNK_M tiles, one mesh each, so the camera and the
// sun's shadow camera only draw the tiles they actually see (the merged mesh
// used to be drawn whole — 900 m of city — twice per frame).
const CHUNK_M=360;
let chunks=[],solidMaterial=null;
let installed=false,group=null,solid=null,edgeGlow=null,edges=null,thinEdges=null,sceneRef=null,lastCenter=[Infinity,Infinity],lastSyncCheck=-Infinity,lastSyncAt=-Infinity,currentHash="",building=null,lastFeatureCount=-1;
const viewport=()=>document.getElementById("viewport");
const bridge=()=>globalThis.__arondightRealWorld||null;
function setData(key,value){const v=viewport();if(v){const s=String(value);if(v.dataset[key]!==s)v.dataset[key]=s;}}
function hash(value){let h=2166136261;for(const ch of String(value||""))h=Math.imul(h^ch.charCodeAt(0),16777619);return h>>>0;}

// Stylized facades without textures (hero-shooter look): the fragment
// shader lights every wall/roof with the same model as all other objects
// (stylized_world_style.mjs: wrapped sun, sky/ground bounce, ground AO,
// filmic curve) and cuts windows, floor trims and a ground-floor shop band
// out of the walls from their world position. Far away the window grid
// fades to an average tone so it never shimmers.
// Realistic facades on a PBR material (MeshStandard: sun, soft shadows and
// sky reflections from the environment map). The shader composes each wall
// in metres along the wall: corner pilasters, a ground-floor shop band with
// storefront glass and awnings, framed windows with sills (style varies per
// building), glass curtain walls on towers. Glass is dark, smooth and
// partly metallic so it reflects the sky; frames, trims and plaster differ
// in roughness. Roofs get a subtle tar/gravel variation.
// Openings cut into facades at runtime (building_interiors.mjs): doorways
// (a vertical band along a wall segment) and the roof hatch over a stair
// core (a rotated rectangle). Shared by the exterior and interior shaders.
export const MAX_FACADE_CUTOUTS=6;
export const facadeCutouts={uCutN:{value:0},uCutA:{value:Array.from({length:MAX_FACADE_CUTOUTS},()=>new THREE.Vector4())},uCutB:{value:Array.from({length:MAX_FACADE_CUTOUTS},()=>new THREE.Vector4())}};
export const CUTOUT_GLSL=`uniform int uCutN;uniform vec4 uCutA[${MAX_FACADE_CUTOUTS}];uniform vec4 uCutB[${MAX_FACADE_CUTOUTS}];
bool facadeCutout(vec3 P,bool roofHoles){
  for(int i=0;i<${MAX_FACADE_CUTOUTS};i++){if(i>=uCutN)break;vec4 a=uCutA[i],b=uCutB[i];
    if(b.w<0.5){vec2 d=a.zw-a.xy;float L=length(d);vec2 dir=d/max(L,1e-4);vec2 r=P.xy-a.xy;float t=dot(r,dir),s=abs(r.x*dir.y-r.y*dir.x);if(t>0.0&&t<L&&s<b.z&&P.z>b.x&&P.z<b.y)return true;}
    else if(roofHoles){vec2 r=P.xy-a.xy,vd=a.zw,ud=vec2(-vd.y,vd.x);float u=dot(r,ud),v=dot(r,vd);if(u>0.0&&u<b.z&&v>0.0&&v<b.w-1.0&&P.z>b.x&&P.z<b.y)return true;}}
  return false;}`;
// Per-building facade parameters (seed for the window style, storey height):
// the interior generator uses the same values so floors line up with windows.
export function facadeParams(key){const h=hash(key);return{seed:(h%997)/997,floorH:3.1+.5*(((h>>>12)%1000)/1000),wallIndex:h%WALLS.length};}
function realFacades(material){
  const previous=material.onBeforeCompile;
  material.onBeforeCompile=(shader,renderer)=>{previous?.call(material,shader,renderer);
    Object.assign(shader.uniforms,facadeCutouts);
    shader.vertexShader=shader.vertexShader.replace("void main() {","attribute vec4 aWall;attribute float aSeed;attribute float aFloorH;varying vec3 vWinPos;varying vec4 vWall;varying float vSeed;varying float vFloorH;\nvoid main() {vWall=aWall;vSeed=aSeed;vFloorH=aFloorH;").replace("#include <begin_vertex>","#include <begin_vertex>\nvWinPos=(modelMatrix*vec4(transformed,1.0)).xyz;");
    shader.fragmentShader=shader.fragmentShader.replace("void main() {","varying vec3 vWinPos;varying vec4 vWall;varying float vSeed;varying float vFloorH;\nfloat fh(float n){return fract(sin(n*127.1)*43758.5453);}\n"+CUTOUT_GLSL+"\nvoid main() {if(facadeCutout(vWinPos,true))discard;float facGlass=0.0,facRough=0.88;")
      .replace("#include <color_fragment>","#include <color_fragment>\n"+FACADE_GLSL)
      .replace("#include <roughnessmap_fragment>","#include <roughnessmap_fragment>\nroughnessFactor=mix(facRough,0.07,facGlass);")
      .replace("#include <metalnessmap_fragment>","#include <metalnessmap_fragment>\nmetalnessFactor=mix(0.0,0.35,facGlass);")
      // glass always mirrors some sky (Fresnel), even where the env map is dim
      .replace("#include <emissivemap_fragment>","#include <emissivemap_fragment>\n{float fr=pow(1.0-abs(dot(normalize(vViewPosition),normal)),3.0);totalEmissiveRadiance+=facGlass*mix(vec3(0.05,0.07,0.09),vec3(0.32,0.4,0.5),fr);}");
  };
  const key=material.customProgramCacheKey?.bind(material);material.customProgramCacheKey=()=>`${key?key():""}|real-facades-v5-floors-cutouts`;return material;
}
export const FACADE_GLSL=`{
  vec3 wn=normalize(cross(dFdx(vWinPos),dFdy(vWinPos)));
  vec3 base=diffuseColor.rgb;
  float u=vWall.x,len=vWall.y,z=vWall.z,H=vWall.w;
  if(u>=0.0&&abs(wn.z)<0.5){
    vec3 glassC=vec3(0.2,0.26,0.32);
    float aa=clamp(1.6-fwidth(u)*1.2,0.0,1.0);
    float pil=1.0-step(0.38,u)*step(u,len-0.38);
    float tower=step(26.0,H);
    float pitch=mix(2.7,3.7,fh(vSeed*7.0)),floorH=vFloorH;
    float nWin=max(1.0,floor((len-0.8)/pitch)),margin=(len-nWin*pitch)*0.5;
    float lu=(u-margin)/pitch,fu=fract(lu),inRow=step(0.0,lu)*step(lu,nWin);
    float gl=0.0,trimM=0.0;
    if(z<4.0&&len>3.0){
      float sp=4.4,ns=max(1.0,floor(len/sp)),sm=(len-ns*sp)*0.5,su=fract((u-sm)/sp),inS=step(0.0,u-sm)*step(u-sm,ns*sp);
      float win=inS*step(.08,su)*step(su,.92)*step(.35,z)*step(z,3.0);
      float frame=inS*step(.05,su)*step(su,.95)*step(.25,z)*step(z,3.1)-win;
      base=mix(base*0.9,vec3(0.12,0.12,0.13),frame*aa);trimM=frame;gl=win*aa;
      float k=fh(vSeed*11.0);vec3 awn=k<.25?vec3(0.45,0.09,0.07):k<.5?vec3(0.08,0.24,0.15):k<.75?vec3(0.08,0.15,0.32):vec3(0.5,0.36,0.08);
      float aw=step(3.15,z)*step(z,3.75)*aa;base=mix(base,awn*mix(1.0,1.15,step(0.5,fract(u*1.4))),aw);
      base=mix(base,base*0.78,step(3.75,z)*step(z,4.0));
    }else if(tower>0.5){
      float fz=fract((z-4.0)/floorH),mull=step(.95,fract(u/1.6)),spandrel=step(.8,fz);
      gl=(1.0-spandrel)*(1.0-mull)*aa*(1.0-pil);base=mix(base,base*0.85,spandrel*aa);trimM=mull;
    }else{
      float fz=fract((z-4.0)/floorH);
      float ww=mix(.38,.6,fh(vSeed*5.0)),wh=mix(.42,.6,fh(vSeed*9.0)),inTop=step(z,H-1.2);
      float win=inRow*inTop*step(.5-ww*.5,fu)*step(fu,.5+ww*.5)*step(.3,fz)*step(fz,.3+wh);
      float frame=inRow*inTop*step(.5-ww*.5-.05,fu)*step(fu,.5+ww*.5+.05)*step(.25,fz)*step(fz,.35+wh)-win;
      float sill=inRow*inTop*step(.5-ww*.5-.09,fu)*step(fu,.5+ww*.5+.09)*step(.2,fz)*step(fz,.25);
      vec3 frameC=fh(vSeed*17.0)<.5?vec3(0.85,0.84,0.8):vec3(0.14,0.14,0.15);
      base=mix(base,frameC,frame*aa);base=mix(base,base*1.12+0.04,sill*aa);trimM=frame+sill;gl=win*aa;
      base*=1.0-0.08*step(.965,fz)*aa;
    }
    base=mix(base,base*0.86,pil*aa);
    base=mix(base,glassC,gl);facGlass=gl;facRough=mix(0.9,0.45,clamp(trimM,0.0,1.0));
    base*=mix(0.72,1.0,smoothstep(0.0,2.5,z)); // grime / contact darkening near the ground
  }else if(u<-1.5){facRough=0.7;}
  else if(abs(wn.z)>=0.5){float t=fract(sin(dot(floor(vWinPos.xy*0.7),vec2(12.99,78.23)))*43758.5);base*=0.88+0.12*t;facRough=0.95;}
  diffuseColor.rgb=base;
}`;
function ensureMeshes(scene){
  if(group?.parent===scene)return;
  if(group?.parent)group.parent.remove(group);
  group=new THREE.Group();group.name="WORLD_CITY_BUILDINGS";
  solidMaterial=patchShockMaterial(new THREE.MeshBasicMaterial({color:0x061d14,toneMapped:false,fog:true,polygonOffset:true,polygonOffsetFactor:3,polygonOffsetUnits:6}));solid=new THREE.Group();chunks=[];solid.castShadow=false;solid.receiveShadow=false;solid.name="WORLD_CITY_SOLIDS";solid.frustumCulled=false;
  const empty=fatLineGeometry([0,0,0,0,0,0]);
  edgeGlow=fatLineSegments(empty,patchShockMaterial(fatLineMaterial(0x39ff14,{width:3.0,opacity:.035,additive:true,depthTest:true}),{lines:true}));edgeGlow.name="WORLD_CITY_EDGES_GLOW";edgeGlow.frustumCulled=false;
  edges=fatLineSegments(empty,patchShockMaterial(fatLineMaterial(0x3dff8a,{width:1.45,opacity:.96,additive:false,depthTest:true}),{lines:true}));edges.name="WORLD_CITY_EDGES";edges.frustumCulled=false;
  // Far outlines stay native 1 px for performance, but use a bright phosphor core.
  thinEdges=new THREE.LineSegments(new THREE.BufferGeometry(),patchShockMaterial(new THREE.LineBasicMaterial({color:0x3dff8a,toneMapped:false,fog:true,transparent:true,opacity:.52,blending:THREE.NormalBlending,depthTest:true,depthWrite:false})));thinEdges.name="WORLD_CITY_EDGES_FAR";thinEdges.frustumCulled=false;
  for(const node of[group,solid,edgeGlow,edges,thinEdges]){node.userData.neonSkip=true;node.userData.flightFireIgnore=true;node.userData.worldCityBuildings=true;}
  delete edgeGlow.userData.neonEdge;delete edges.userData.neonEdge;
  // The green neon outline is the world look: three shared draw calls for the whole city.
  edgeGlow.visible=false;edges.visible=thinEdges.visible=true;
  group.add(solid,edgeGlow,edges,thinEdges);scene.add(group);sceneRef=scene;currentHash="";
}

// Time-sliced geometry builder.
function* buildSteps(footprints,center){
  const lines=[],thin=[],ranges=[],buckets=new Map();let pos,col,wa,ws,wf,ci=0;const bucketOf=(x,y)=>{const k=`${Math.floor(x/CHUNK_M)},${Math.floor(y/CHUNK_M)}`;let bk=buckets.get(k);if(!bk){bk={pos:[],col:[],wa:[],ws:[],wf:[],index:buckets.size};buckets.set(k,bk);}return bk;};const c=new THREE.Color(),wall=new THREE.Color(),roof=new THREE.Color(),plinth=new THREE.Color(),trim=new THREE.Color();
  // wa = facade coordinates per vertex: (u along the wall [m], wall length,
  // height above the building base, building height); u<0 marks roof (-1)
  // and cornice trim (-2). ws = per-building seed for style variation.
  let W=[-1,0,0,0],S=0,FL=3.3,E=0;
  const worldZ=z=>z+E;const push=(x,y,z,k)=>{pos.push(x,y,worldZ(z));col.push(k.r,k.g,k.b);wa.push(W[0],W[1],W[2],W[3]);ws.push(S);wf.push(FL);};
  let i=0;
  for(const fp of footprints){
    const d=buildingDamage(fp.key),base=Number(fp.base)||0,fullTop=Math.max(base+.5,Number(fp.top)||8),top=d?Math.max(base+.3,Math.min(fullTop,d.top)):fullTop,h=hash(fp.key);
    wall.set(d?.leveled?"#8d8378":WALLS[h%WALLS.length]);roof.set(d?.leveled?"#7a7066":d?"#8a7d70":ROOFS[(h>>>8)%ROOFS.length]);
    const outer=(fp.outer||[]).map(p=>new THREE.Vector2(+p[0],+p[1])),holes=(fp.holes||[]).map(r=>r.map(p=>new THREE.Vector2(+p[0],+p[1])));
    if(outer.length<3)continue;const dist=Math.hypot(outer[0].x-center[0],outer[0].y-center[1]),near=dist<FAT_RADIUS_M,mid=!near&&dist<LINE_RADIUS_M;if(outer[0].distanceToSquared(outer.at(-1))<1e-10)outer.pop();for(const r of holes)if(r.length&&r[0].distanceToSquared(r.at(-1))<1e-10)r.pop();
    if(THREE.ShapeUtils.isClockWise(outer))outer.reverse();for(const r of holes)if(!THREE.ShapeUtils.isClockWise(r))r.reverse();
    S=(h%997)/997;FL=3.1+.5*(((h>>>12)%1000)/1000);E=buildingTerrainBase(outer);const H=top-base;trim.copy(wall).lerp(new THREE.Color("#f4efe4"),.45);
    let mx=0,my=0;for(const v of outer){mx+=v.x/outer.length;my+=v.y/outer.length;}const bk=bucketOf(mx,my);({pos,col,wa,ws,wf}=bk);ci=bk.index;
    const all=[...outer,...holes.flat()],range={key:String(fp.key),chunk:ci,elev:E,base,top,fullTop,cx:0,cy:0,p0:pos.length/3,l0:lines.length/6,t0:thin.length/3};for(const v of outer){range.cx+=v.x/outer.length;range.cy+=v.y/outer.length;}
    W=[-1,0,H,H];for(const f of THREE.ShapeUtils.triangulateShape(outer,holes)){const a=all[f[0]];let b=all[f[1]],cc=all[f[2]];if((b.x-a.x)*(cc.y-a.y)-(b.y-a.y)*(cc.x-a.x)<0)[b,cc]=[cc,b];push(a.x,a.y,top,roof);push(b.x,b.y,top,roof);push(cc.x,cc.y,top,roof);}
    for(const ring of[outer,...holes]){
      for(let k=0;k<ring.length;k++){const a=ring[k],b=ring[(k+1)%ring.length],dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1,nx=dy/len,ny=-dx/len,light=.9+.25*Math.max(0,-(nx*SUN[0]+ny*SUN[1]));
        c.copy(wall);plinth.copy(wall);/* lighting + AO happen in the facade shader */
        const Wa=[0,len,0,H],Wb=[len,len,0,H],Wat=[0,len,H,H],Wbt=[len,len,H,H];
        W=Wa;push(a.x,a.y,base,plinth);W=Wb;push(b.x,b.y,base,plinth);W=Wbt;push(b.x,b.y,top,c);W=Wa;push(a.x,a.y,base,plinth);W=Wbt;push(b.x,b.y,top,c);W=Wat;push(a.x,a.y,top,c);
        // Cornice: an outset trim band + lip along the top of every wall.
        if(len>1.2&&H>3.5){const o=.24,ax=a.x+nx*o,ay=a.y+ny*o,bx=b.x+nx*o,by=b.y+ny*o,z0=top-.55,z1=top+.1;W=[-2,len,H,H];
          push(ax,ay,z0,trim);push(bx,by,z0,trim);push(bx,by,z1,trim);push(ax,ay,z0,trim);push(bx,by,z1,trim);push(ax,ay,z1,trim);
          push(a.x,a.y,z1,trim);push(ax,ay,z1,trim);push(bx,by,z1,trim);push(a.x,a.y,z1,trim);push(bx,by,z1,trim);push(b.x,b.y,z1,trim);
          push(ax,ay,z0,trim);push(a.x,a.y,z0,trim);push(b.x,b.y,z0,trim);push(ax,ay,z0,trim);push(b.x,b.y,z0,trim);push(bx,by,z0,trim);}
        // Roof outline + corner verticals (ground edges are hidden by the
        // ground anyway); far buildings are silhouettes only.
        // Cartoon outline: roof edge + real corners (thin native lines, cheap).
        // Neon outline: roof edge + real corners; glowing fat lines near,
        // cheap 1 px lines further out.
        const zTop=worldZ(top),zBase=worldZ(base);if(near){lines.push(a.x,a.y,zTop,b.x,b.y,zTop);const p=ring[(k+ring.length-1)%ring.length],ex=a.x-p.x,ey=a.y-p.y,el=Math.hypot(ex,ey)||1;if(Math.abs((ex*dx+ey*dy)/(el*len))<.94)lines.push(a.x,a.y,zBase,a.x,a.y,zTop);}
        else if(mid)thin.push(a.x,a.y,zTop,b.x,b.y,zTop);}
    }
    range.p1=pos.length/3;range.l1=lines.length/6;range.t1=thin.length/3;ranges.push(range);
    if(++i%40===0)yield;
  }
  return{buckets:[...buckets.values()],lines,thin,ranges};
}

// ---- instant damage & sway on the live buffers
let rangeByKey=new Map(),sways=[];
function solidAttr(r){return chunks[r?.chunk]?.geometry?.attributes?.position||null;}
function edgeBuffer(){const a=edges?.geometry?.attributes?.instanceStart;return a?.data||null;}
function thinAttr(){return thinEdges?.geometry?.attributes?.position||null;}
function installRanges(ranges){
  rangeByKey=new Map();for(const r of ranges)rangeByKey.set(r.key,r);
  // Keep the original (undamaged-at-build) z values for sway/clamp.
  const eb=edgeBuffer(),tp=thinAttr();
  for(const r of ranges){const sp=solidAttr(r);r.solidZ=sp?Float32Array.from({length:r.p1-r.p0},(_,i)=>sp.getZ(r.p0+i)):null;r.edgeZ=eb?Float32Array.from({length:(r.l1-r.l0)*2},(_,i)=>eb.array[(r.l0+(i>>1))*6+(i&1)*3+2]):null;r.thinZ=tp?Float32Array.from({length:r.t1-r.t0},(_,i)=>tp.getZ(r.t0+i)):null;}
  sways=[];
  // Damage applied while this build was being assembled.
  for(const r of ranges){const d=buildingDamage(r.key);if(d&&d.top<r.top-.01)clampRange(r,d.top);}
}
function markDirty(attr,from,count){if(!attr)return;attr.needsUpdate=true;}
// Drops every vertex of the building above newTop to newTop (roof follows).
function clampRange(r,newTop){
  const sp=solidAttr(r),eb=edgeBuffer(),tp=thinAttr();r.top=Math.min(r.top,newTop);
  if(sp&&r.solidZ){for(let i=r.p0;i<r.p1;i++){const z=Math.min(r.solidZ[i-r.p0],newTop+(r.elev||0));sp.setZ(i,z);}markDirty(sp);}
  if(eb&&r.edgeZ){const a=eb.array;for(let k=r.l0;k<r.l1;k++){a[k*6+2]=Math.min(r.edgeZ[(k-r.l0)*2],newTop+(r.elev||0));a[k*6+5]=Math.min(r.edgeZ[(k-r.l0)*2+1],newTop+(r.elev||0));}eb.needsUpdate=true;}
  if(tp&&r.thinZ){for(let i=r.t0;i<r.t1;i++)tp.setZ(i,Math.min(r.thinZ[i-r.t0],newTop+(r.elev||0)));markDirty(tp);}
}
function swayRange(r,ox,oy){
  const sp=solidAttr(r),eb=edgeBuffer(),h=Math.max(1,r.fullTop-r.base);
  // Offset grows with height: the base stays, the top leans.
  if(sp&&r.solidX===undefined){r.solidX=Float32Array.from({length:r.p1-r.p0},(_,i)=>sp.getX(r.p0+i));r.solidY=Float32Array.from({length:r.p1-r.p0},(_,i)=>sp.getY(r.p0+i));}
  if(eb&&r.edgeXY===undefined){const a=eb.array;r.edgeXY=Float32Array.from({length:(r.l1-r.l0)*4},(_,i)=>{const k=r.l0+(i>>2),j=i&3;return a[k*6+(j<2?j:j+1)];});}
  if(sp)for(let i=r.p0;i<r.p1;i++){const w=Math.max(0,(sp.getZ(i)-r.base-(r.elev||0))/h)**1.3;sp.setX(i,r.solidX[i-r.p0]+ox*w);sp.setY(i,r.solidY[i-r.p0]+oy*w);}
  if(eb){const a=eb.array;for(let k=r.l0;k<r.l1;k++){const o=(k-r.l0)*4,w0=Math.max(0,(a[k*6+2]-r.base-(r.elev||0))/h)**1.3,w1=Math.max(0,(a[k*6+5]-r.base-(r.elev||0))/h)**1.3;a[k*6]=r.edgeXY[o]+ox*w0;a[k*6+1]=r.edgeXY[o+1]+oy*w0;a[k*6+3]=r.edgeXY[o+2]+ox*w1;a[k*6+4]=r.edgeXY[o+3]+oy*w1;}}
}
function stepSways(now){
  if(!sways.length)return;const eb=edgeBuffer();
  for(let i=sways.length-1;i>=0;i--){const s=sways[i],t=(now-s.born)/1000;const done=t>s.life;const a=done?0:s.amp*Math.exp(-t*2.2)*Math.sin(t*s.freq*Math.PI*2+Math.PI/2*0)*(t<.12?t/.12:1);
    swayRange(s.r,s.dx*a,s.dy*a);const sp=solidAttr(s.r);if(sp)sp.needsUpdate=true;if(done)sways.splice(i,1);}
  if(eb)eb.needsUpdate=true;
}
// Public API used by the nuke shock front (nuke_destruction.mjs).
function damageNow(key,newTop){const r=rangeByKey.get(String(key));if(!r||!(newTop<r.top-.01))return false;clampRange(r,newTop);return true;}
function sway(key,dirX,dirY,amplitudeM){const r=rangeByKey.get(String(key));if(!r)return false;const l=Math.hypot(dirX,dirY)||1,old=sways.findIndex(s=>s.r===r);if(old>=0)sways.splice(old,1);if(sways.length>=90)return false;
  const h=Math.max(1,r.fullTop-r.base);sways.push({r,dx:dirX/l,dy:dirY/l,amp:Math.min(amplitudeM,h*.18),freq:.9+3.5/Math.sqrt(h),born:performance.now(),life:2.6});return true;}
let lastFootprints=[];
function startBuild(footprints,key){
  const steps=buildSteps(footprints,lastCenter);building={steps,key,count:footprints.length};lastFootprints=footprints;
}
globalThis.__arondightCityBuildings={footprints:()=>lastFootprints,version:CITY_BUILDINGS_VERSION,damageNow,sway,ranges:()=>rangeByKey};
function pumpBuild(){
  if(!building)return;const until=performance.now()+SLICE_MS;let r;
  while(performance.now()<until){r=building.steps.next();if(r.done)break;}
  if(!r?.done)return;
  const{buckets,lines,thin,ranges}=r.value;
  for(const c of chunks){c.geometry.dispose();c.parent?.remove(c);}chunks=[];
  for(const bk of buckets){const geometry=new THREE.BufferGeometry();
    geometry.setAttribute("position",new THREE.Float32BufferAttribute(bk.pos,3));geometry.setAttribute("color",new THREE.Float32BufferAttribute(bk.col,3));geometry.setAttribute("aWall",new THREE.Float32BufferAttribute(bk.wa,4));geometry.setAttribute("aSeed",new THREE.Float32BufferAttribute(bk.ws,1));geometry.setAttribute("aFloorH",new THREE.Float32BufferAttribute(bk.wf,1));
    if(bk.pos.length){geometry.computeVertexNormals();geometry.computeBoundingSphere();geometry.boundingSphere.radius+=30;} // margin for sway / shock heave
    const m=new THREE.Mesh(geometry,solidMaterial);m.name="WORLD_CITY_CHUNK";m.castShadow=true;m.receiveShadow=true;m.frustumCulled=true;m.matrixAutoUpdate=false;Object.assign(m.userData,{neonSkip:true,flightFireIgnore:true,worldCityBuildings:true});chunks[bk.index]=m;solid.add(m);}
  setData("worldCityChunks",chunks.length);
  const outline=fatLineGeometry(lines.length?lines:[0,0,0,0,0,0]);edges.geometry.dispose?.();edges.geometry=outline;if(edgeGlow)edgeGlow.geometry=outline;
  const far=new THREE.BufferGeometry();far.setAttribute("position",new THREE.Float32BufferAttribute(thin,3));thinEdges.geometry.dispose();thinEdges.geometry=far;
  installRanges(ranges);
  currentHash=building.key;setData("worldCityBuildings",building.count);setData("worldCityBuildingsVersion",CITY_BUILDINGS_VERSION);setData("worldCityLook","structured-dark-solids+registered-1.45px-green-v5");building=null;
}

// The map can hold the same building from several tile zoom levels (slightly
// differently simplified) — two nearly coplanar facades flicker (z-fighting
// windows). Per OSM id keep the largest copy and drop copies whose centre lies
// inside an already kept one; tile-clipped fragments (side by side) survive.
// Outlines that have separate building:parts are flagged hide_3d and skipped.
function pipRing(x,y,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],c=ring[j];if(((a[1]>y)!==(c[1]>y))&&x<(c[0]-a[0])*(y-a[1])/((c[1]-a[1])||1e-9)+a[0])inside=!inside;}return inside;}
function dedupeOverlaps(footprints){
  const byId=new Map(),out=[];for(const f of footprints){const id=String(f.key).startsWith("geometry:")?null:String(f.key).split(":")[0];if(!id){out.push(f);continue;}let g=byId.get(id);if(!g){g=[];byId.set(id,g);}g.push(f);}
  for(const g of byId.values()){g.sort((a,b)=>b.area-a.area);const kept=[];for(const f of g){if(kept.some(k=>pipRing(f.center[0],f.center[1],k.outer)))continue;kept.push(f);}out.push(...kept);}
  return out.sort((a,b)=>a.distance-b.distance);
}
function features(b){
  if(!b?.map||!b.buildingSourceId)return[];
  try{const list=b.map.querySourceFeatures?.(b.buildingSourceId,{sourceLayer:"building"});if(Array.isArray(list))return list;}catch{}return[];
}
function sync(now){
  if(now-lastSyncCheck<200)return;lastSyncCheck=now;const b=bridge();if(!b?.active||!b.threeScene||!Number.isFinite(b.originLon)){if(group)group.visible=false;return;}
  ensureMeshes(b.threeScene);group.visible=true;
  const air=b.airframeFor?.(b.threeScene),walk=globalThis.__arondightWalkMode,p=walk?.mode==="foot"&&walk.position?walk.position:air?.position;if(!p)return;
  const moved=Math.hypot(p.x-lastCenter[0],p.y-lastCenter[1]);
  if(building||(moved<RESYNC_MOVE_M&&now-lastSyncAt<RESYNC_MS))return;
  const list=features(b);if(!list.length)return;
  if(moved<RESYNC_MOVE_M&&list.length===lastFeatureCount&&currentHash.endsWith(`#d${destructionRevision()}`))return;
  lastSyncAt=now;lastFeatureCount=list.length;lastCenter=[p.x,p.y];
  const project=(lon,lat)=>b.projectLngLat(lon,lat);
  const footprints=dedupeOverlaps(buildingFootprintsFromFeatures(list.filter(f=>!f.properties?.hide_3d),{project,center:[p.x,p.y],radiusM:VISUAL_RADIUS_M,maxFootprints:MAX_FOOTPRINTS,maxVertices:MAX_VERTICES}));
  const key=`${buildingFootprintHash(footprints)}#d${destructionRevision()}`;if(key===currentHash)return;
  startBuild(footprints,key);
}
function frame(now){try{stepSways(now);sync(now);pumpBuild();}catch(error){console.warn("city buildings",error);building=null;}requestAnimationFrame(frame);}
export function installCityBuildings(){
  if(installed)return;installed=true;
  // The live buffers already show the damage instantly; the authoritative
  // rebuild follows ~1.5 s after the last change (not every frame of a wave).
  onDestruction(()=>{lastSyncAt=performance.now()-RESYNC_MS+1500;lastFeatureCount=-1;currentHash="";});
  onElevationChange(()=>{lastSyncAt=-Infinity;lastFeatureCount=-1;currentHash="";});
  requestAnimationFrame(frame);
}
installCityBuildings();
