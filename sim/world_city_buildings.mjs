import * as THREE from "three";
import {buildingFootprintsFromFeatures,buildingFootprintHash} from "./world_building_collisions.mjs";
import {buildingDamage,destructionRevision,onDestruction} from "./world_destruction_state.mjs";
import {NEON_DEBUG_PALETTE,fatLineMaterial,fatLineGeometry,fatLineSegments} from "./box3d_collider_debug.mjs";
import {patchShockMaterial} from "./nuke_shock_field.mjs";
import {STYLE_GLSL,toonUniforms} from "./stylized_world_style.mjs";

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

export const CITY_BUILDINGS_VERSION="world-map-neon-city-v2-instant-damage";
const VISUAL_RADIUS_M=900,LINE_RADIUS_M=420,FAT_RADIUS_M=220,MAX_FOOTPRINTS=2600,MAX_VERTICES=96;
const RESYNC_MOVE_M=140,RESYNC_MS=2500,SLICE_MS=4;
// Hero-stylized palette: sandstone, brick, plaster, blue-grey, mustard,
// sage and concrete facades; slate / terracotta roofs.
const WALLS=["#cdb99a","#b4634a","#e6e0d2","#7f9bb3","#d6a54c","#6f9e8c","#a9a49a","#c98d6b"],ROOFS=["#5b5f66","#7a4a3a","#4d5a63","#6b6e72"],SUN=(()=>{const x=-.55,y=-.83,l=Math.hypot(x,y);return[x/l,y/l];})();

let installed=false,group=null,solid=null,edgeGlow=null,edges=null,thinEdges=null,sceneRef=null,lastCenter=[Infinity,Infinity],lastSyncAt=-Infinity,currentHash="",building=null,lastFeatureCount=-1;
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
function heroFacades(material){
  const previous=material.onBeforeCompile;
  material.onBeforeCompile=(shader,renderer)=>{previous?.call(material,shader,renderer);
    Object.assign(shader.uniforms,toonUniforms);
    shader.vertexShader=shader.vertexShader.replace("void main() {","attribute vec4 aWall;attribute float aSeed;varying vec3 vWinPos;varying vec4 vWall;varying float vSeed;\nvoid main() {vWall=aWall;vSeed=aSeed;").replace("#include <begin_vertex>","#include <begin_vertex>\nvWinPos=(modelMatrix*vec4(transformed,1.0)).xyz;");
    shader.fragmentShader="uniform vec3 uToonSun;uniform vec3 uToonSky;uniform vec3 uToonGround;uniform vec3 uToonSunColor;\n"+STYLE_GLSL+shader.fragmentShader.replace("void main() {","varying vec3 vWinPos;varying vec4 vWall;varying float vSeed;\nfloat fh(float n){return fract(sin(n*127.1)*43758.5453);}\nvoid main() {").replace("#include <opaque_fragment>",FACADE_GLSL+"\n#include <opaque_fragment>");
  };
  const key=material.customProgramCacheKey?.bind(material);material.customProgramCacheKey=()=>`${key?key():""}|hero-facades-v2`;return material;
}
// Facade composition per wall (in metres along the wall, so windows are
// centred and never cut at corners): corner pilasters, a ground-floor shop
// band with storefront glass and a coloured awning, upper floors with
// framed windows and sills (style varies per building), glass curtain
// walls on towers; roofs with a subtle tar texture-free tint. Glass mixes
// a dark interior with sky reflection by view angle (fresnel).
const FACADE_GLSL=`{
  vec3 wn=normalize(cross(dFdx(vWinPos),dFdy(vWinPos)));
  vec3 viewDir=normalize(cameraPosition-vWinPos);if(dot(wn,viewDir)<0.0)wn=-wn;
  vec3 base=outgoingLight;float sheen=0.06;
  float ao=mix(0.58,1.0,smoothstep(0.0,3.2,vWall.z));
  float u=vWall.x,len=vWall.y,z=vWall.z,H=vWall.w;
  if(u>=0.0&&abs(wn.z)<0.5){
    float fres=pow(1.0-max(dot(wn,viewDir),0.0),2.0);
    vec3 skyR=mix(vec3(0.55,0.72,0.9),vec3(0.86,0.93,1.0),clamp(viewDir.z*-1.0+0.5,0.0,1.0));
    vec3 glass=mix(vec3(0.10,0.16,0.24),skyR,0.35+0.55*fres);
    float aa=clamp(1.6-fwidth(u)*1.2,0.0,1.0);
    float pil=1.0-step(0.38,u)*step(u,len-0.38);
    float tower=step(26.0,H);
    float pitch=mix(2.7,3.7,fh(vSeed*7.0)),floorH=mix(3.1,3.6,fh(vSeed*3.0));
    float nWin=max(1.0,floor((len-0.8)/pitch)),margin=(len-nWin*pitch)*0.5;
    float lu=(u-margin)/pitch,col=floor(lu),fu=fract(lu),inRow=step(0.0,lu)*step(lu,nWin);
    if(z<4.0&&len>3.0){
      // shop band
      float sp=4.4,ns=max(1.0,floor(len/sp)),sm=(len-ns*sp)*0.5,su=fract((u-sm)/sp),inS=step(0.0,u-sm)*step(u-sm,ns*sp);
      float win=inS*step(.08,su)*step(su,.92)*step(.35,z)*step(z,3.0);
      float frame=inS*step(.05,su)*step(su,.95)*step(.25,z)*step(z,3.1)-win;
      base=mix(base*0.86,base*0.55,frame*aa);
      base=mix(base,glass*mix(vec3(1.0),vec3(1.15,1.05,0.9),step(z,1.6)),win*aa);sheen=mix(sheen,0.9,win*aa);
      vec3 awn=fh(vSeed*11.0)<.25?vec3(0.75,0.18,0.15):fh(vSeed*11.0)<.5?vec3(0.15,0.45,0.3):fh(vSeed*11.0)<.75?vec3(0.15,0.3,0.6):vec3(0.85,0.62,0.15);
      float stripes=step(0.5,fract(u*1.4));
      base=mix(base,awn*mix(1.0,1.25,stripes),step(3.15,z)*step(z,3.75)*aa);
      base=mix(base,base*0.75,step(3.75,z)*step(z,4.0));
    }else if(tower>0.5){
      // curtain wall: glass ribbons with spandrels and mullions
      float fz=fract((z-4.0)/floorH),mull=step(.94,fract(u/1.6));
      float spandrel=step(.78,fz);
      vec3 cw=mix(glass*1.05,base*0.9,spandrel);cw=mix(cw,base*0.7,mull*(1.0-spandrel));
      base=mix(base,cw,aa*(1.0-pil));sheen=mix(sheen,0.8,(1.0-spandrel)*aa*(1.0-pil));
    }else{
      float fz=fract((z-4.0)/floorH),row=floor((z-4.0)/floorH);
      float ww=mix(.38,.62,fh(vSeed*5.0)),wh=mix(.42,.62,fh(vSeed*9.0));
      float inTop=step(z,H-1.2);
      float win=inRow*inTop*step(.5-ww*.5,fu)*step(fu,.5+ww*.5)*step(.3,fz)*step(fz,.3+wh);
      float frame=inRow*inTop*step(.5-ww*.5-.06,fu)*step(fu,.5+ww*.5+.06)*step(.24,fz)*step(fz,.36+wh)-win;
      float sill=inRow*inTop*step(.5-ww*.5-.1,fu)*step(fu,.5+ww*.5+.1)*step(.2,fz)*step(fz,.25);
      float lit=step(.86,fh(dot(vec2(col,row),vec2(17.0,31.0))+vSeed*13.0));
      vec3 frameC=mix(vec3(0.95,0.94,0.9),base*0.6,step(.5,fh(vSeed*17.0)));
      base=mix(base,frameC,(frame+sill)*aa);
      base=mix(base,glass+vec3(0.35,0.28,0.12)*lit,win*aa)+vec3(0.04)*(1.0-aa);sheen=mix(sheen,0.9,win*aa);
      base*=1.0-0.1*step(.96,fz)*aa;
    }
    base=mix(base,base*0.82,pil*aa);
  }else if(u<-1.5){base*=1.0;sheen=0.05;}
  else if(abs(wn.z)>=0.5){float t=fract(sin(dot(floor(vWinPos.xy*0.5),vec2(12.99,78.23)))*43758.5);base*=0.92+0.08*t;sheen=0.03;ao=1.0;}
  outgoingLight=heroFilmic(heroLight(base,wn,viewDir,normalize(uToonSun),vec3(0.0,0.0,1.0),ao,sheen));
}`;
function ensureMeshes(scene){
  if(group?.parent===scene)return;
  if(group?.parent)group.parent.remove(group);
  group=new THREE.Group();group.name="WORLD_CITY_BUILDINGS";
  solid=new THREE.Mesh(new THREE.BufferGeometry(),patchShockMaterial(heroFacades(new THREE.MeshBasicMaterial({vertexColors:true,toneMapped:false,fog:true,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:2}))));solid.name="WORLD_CITY_SOLIDS";solid.frustumCulled=false;
  const empty=fatLineGeometry([0,0,0,0,0,0]);
  edgeGlow=fatLineSegments(empty,patchShockMaterial(fatLineMaterial(0x29e6ff,{width:7,opacity:.2,additive:true,depthTest:true}),{lines:true}));edgeGlow.name="WORLD_CITY_EDGES_GLOW";edgeGlow.frustumCulled=false;
  edges=fatLineSegments(empty,patchShockMaterial(fatLineMaterial(0x7ff3ff,{width:2.4,opacity:1,additive:true,depthTest:true}),{lines:true}));edges.name="WORLD_CITY_EDGES";edges.frustumCulled=false;
  // Far outlines stay native 1 px for performance, but use a bright phosphor core.
  thinEdges=new THREE.LineSegments(new THREE.BufferGeometry(),patchShockMaterial(new THREE.LineBasicMaterial({color:0x29e6ff,toneMapped:false,fog:true,transparent:true,opacity:.55,blending:THREE.AdditiveBlending,depthTest:true,depthWrite:false})));thinEdges.name="WORLD_CITY_EDGES_FAR";thinEdges.frustumCulled=false;
  for(const node of[group,solid,edgeGlow,edges,thinEdges]){node.userData.neonSkip=true;node.userData.flightFireIgnore=true;node.userData.worldCityBuildings=true;}
  delete edgeGlow.userData.neonEdge;delete edges.userData.neonEdge;
  // No outlines in the hero-stylized look (and no line draw calls).
  edgeGlow.visible=edges.visible=thinEdges.visible=false;
  group.add(solid,edgeGlow,edges,thinEdges);scene.add(group);sceneRef=scene;currentHash="";
}

// Time-sliced geometry builder.
function* buildSteps(footprints,center){
  const pos=[],col=[],wa=[],ws=[],lines=[],thin=[],ranges=[],c=new THREE.Color(),wall=new THREE.Color(),roof=new THREE.Color(),plinth=new THREE.Color(),trim=new THREE.Color();
  // wa = facade coordinates per vertex: (u along the wall [m], wall length,
  // height above the building base, building height); u<0 marks roof (-1)
  // and cornice trim (-2). ws = per-building seed for style variation.
  let W=[-1,0,0,0],S=0;
  const push=(x,y,z,k)=>{pos.push(x,y,z);col.push(k.r,k.g,k.b);wa.push(W[0],W[1],W[2],W[3]);ws.push(S);};
  let i=0;
  for(const fp of footprints){
    const d=buildingDamage(fp.key),base=Number(fp.base)||0,fullTop=Math.max(base+.5,Number(fp.top)||8),top=d?Math.max(base+.3,Math.min(fullTop,d.top)):fullTop,h=hash(fp.key);
    wall.set(d?.leveled?"#8d8378":WALLS[h%WALLS.length]);roof.set(d?.leveled?"#7a7066":d?"#8a7d70":ROOFS[(h>>>8)%ROOFS.length]);
    const outer=(fp.outer||[]).map(p=>new THREE.Vector2(+p[0],+p[1])),holes=(fp.holes||[]).map(r=>r.map(p=>new THREE.Vector2(+p[0],+p[1])));
    if(outer.length<3)continue;const dist=Math.hypot(outer[0].x-center[0],outer[0].y-center[1]),near=dist<FAT_RADIUS_M,mid=!near&&dist<LINE_RADIUS_M;if(outer[0].distanceToSquared(outer.at(-1))<1e-10)outer.pop();for(const r of holes)if(r.length&&r[0].distanceToSquared(r.at(-1))<1e-10)r.pop();
    if(THREE.ShapeUtils.isClockWise(outer))outer.reverse();for(const r of holes)if(!THREE.ShapeUtils.isClockWise(r))r.reverse();
    S=(h%997)/997;const H=top-base;trim.copy(wall).lerp(new THREE.Color("#f4efe4"),.45);
    const all=[...outer,...holes.flat()],range={key:String(fp.key),base,top,fullTop,cx:0,cy:0,p0:pos.length/3,l0:lines.length/6,t0:thin.length/3};for(const v of outer){range.cx+=v.x/outer.length;range.cy+=v.y/outer.length;}
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
        if(near){lines.push(a.x,a.y,top,b.x,b.y,top);const p=ring[(k+ring.length-1)%ring.length],ex=a.x-p.x,ey=a.y-p.y,el=Math.hypot(ex,ey)||1;if(Math.abs((ex*dx+ey*dy)/(el*len))<.94)lines.push(a.x,a.y,base,a.x,a.y,top);}
        else if(mid)thin.push(a.x,a.y,top,b.x,b.y,top);}
    }
    range.p1=pos.length/3;range.l1=lines.length/6;range.t1=thin.length/3;ranges.push(range);
    if(++i%40===0)yield;
  }
  return{pos,col,wa,ws,lines,thin,ranges};
}

// ---- instant damage & sway on the live buffers
let rangeByKey=new Map(),sways=[];
function solidAttr(){return solid?.geometry?.attributes?.position||null;}
function edgeBuffer(){const a=edges?.geometry?.attributes?.instanceStart;return a?.data||null;}
function thinAttr(){return thinEdges?.geometry?.attributes?.position||null;}
function installRanges(ranges){
  rangeByKey=new Map();for(const r of ranges)rangeByKey.set(r.key,r);
  // Keep the original (undamaged-at-build) z values for sway/clamp.
  const sp=solidAttr(),eb=edgeBuffer(),tp=thinAttr();
  for(const r of ranges){r.solidZ=sp?Float32Array.from({length:r.p1-r.p0},(_,i)=>sp.getZ(r.p0+i)):null;r.edgeZ=eb?Float32Array.from({length:(r.l1-r.l0)*2},(_,i)=>eb.array[(r.l0+(i>>1))*6+(i&1)*3+2]):null;r.thinZ=tp?Float32Array.from({length:r.t1-r.t0},(_,i)=>tp.getZ(r.t0+i)):null;}
  sways=[];
  // Damage applied while this build was being assembled.
  for(const r of ranges){const d=buildingDamage(r.key);if(d&&d.top<r.top-.01)clampRange(r,d.top);}
}
function markDirty(attr,from,count){if(!attr)return;attr.needsUpdate=true;}
// Drops every vertex of the building above newTop to newTop (roof follows).
function clampRange(r,newTop){
  const sp=solidAttr(),eb=edgeBuffer(),tp=thinAttr();r.top=Math.min(r.top,newTop);
  if(sp&&r.solidZ){for(let i=r.p0;i<r.p1;i++){const z=Math.min(r.solidZ[i-r.p0],newTop);sp.setZ(i,z);}markDirty(sp);}
  if(eb&&r.edgeZ){const a=eb.array;for(let k=r.l0;k<r.l1;k++){a[k*6+2]=Math.min(r.edgeZ[(k-r.l0)*2],newTop);a[k*6+5]=Math.min(r.edgeZ[(k-r.l0)*2+1],newTop);}eb.needsUpdate=true;}
  if(tp&&r.thinZ){for(let i=r.t0;i<r.t1;i++)tp.setZ(i,Math.min(r.thinZ[i-r.t0],newTop));markDirty(tp);}
}
function swayRange(r,ox,oy){
  const sp=solidAttr(),eb=edgeBuffer(),h=Math.max(1,r.fullTop-r.base);
  // Offset grows with height: the base stays, the top leans.
  if(sp&&r.solidX===undefined){r.solidX=Float32Array.from({length:r.p1-r.p0},(_,i)=>sp.getX(r.p0+i));r.solidY=Float32Array.from({length:r.p1-r.p0},(_,i)=>sp.getY(r.p0+i));}
  if(eb&&r.edgeXY===undefined){const a=eb.array;r.edgeXY=Float32Array.from({length:(r.l1-r.l0)*4},(_,i)=>{const k=r.l0+(i>>2),j=i&3;return a[k*6+(j<2?j:j+1)];});}
  if(sp)for(let i=r.p0;i<r.p1;i++){const w=Math.max(0,(sp.getZ(i)-r.base)/h)**1.3;sp.setX(i,r.solidX[i-r.p0]+ox*w);sp.setY(i,r.solidY[i-r.p0]+oy*w);}
  if(eb){const a=eb.array;for(let k=r.l0;k<r.l1;k++){const o=(k-r.l0)*4,w0=Math.max(0,(a[k*6+2]-r.base)/h)**1.3,w1=Math.max(0,(a[k*6+5]-r.base)/h)**1.3;a[k*6]=r.edgeXY[o]+ox*w0;a[k*6+1]=r.edgeXY[o+1]+oy*w0;a[k*6+3]=r.edgeXY[o+2]+ox*w1;a[k*6+4]=r.edgeXY[o+3]+oy*w1;}}
}
function stepSways(now){
  if(!sways.length)return;const sp=solidAttr(),eb=edgeBuffer();
  for(let i=sways.length-1;i>=0;i--){const s=sways[i],t=(now-s.born)/1000;const done=t>s.life;const a=done?0:s.amp*Math.exp(-t*2.2)*Math.sin(t*s.freq*Math.PI*2+Math.PI/2*0)*(t<.12?t/.12:1);
    swayRange(s.r,s.dx*a,s.dy*a);if(done)sways.splice(i,1);}
  if(sp)sp.needsUpdate=true;if(eb)eb.needsUpdate=true;
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
  const{pos,col,wa,ws,lines,thin,ranges}=r.value,geometry=new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));geometry.setAttribute("color",new THREE.Float32BufferAttribute(col,3));geometry.setAttribute("aWall",new THREE.Float32BufferAttribute(wa,4));geometry.setAttribute("aSeed",new THREE.Float32BufferAttribute(ws,1));if(pos.length)geometry.computeBoundingSphere();
  solid.geometry.dispose();solid.geometry=geometry;
  const outline=fatLineGeometry(lines.length?lines:[0,0,0,0,0,0]);edges.geometry.dispose?.();edges.geometry=outline;if(edgeGlow)edgeGlow.geometry=outline;
  const far=new THREE.BufferGeometry();far.setAttribute("position",new THREE.Float32BufferAttribute(thin,3));thinEdges.geometry.dispose();thinEdges.geometry=far;
  installRanges(ranges);
  currentHash=building.key;setData("worldCityBuildings",building.count);setData("worldCityBuildingsVersion",CITY_BUILDINGS_VERSION);setData("worldCityLook","hero-stylized-facades-v1");building=null;
}

function features(b){
  if(!b?.map||!b.buildingSourceId)return[];
  try{const list=b.map.querySourceFeatures?.(b.buildingSourceId,{sourceLayer:"building"});if(Array.isArray(list))return list;}catch{}return[];
}
function sync(now){
  const b=bridge();if(!b?.active||!b.threeScene||!Number.isFinite(b.originLon)){if(group)group.visible=false;return;}
  ensureMeshes(b.threeScene);group.visible=true;
  const air=b.airframeFor?.(b.threeScene),walk=globalThis.__arondightWalkMode,p=walk?.mode==="foot"&&walk.position?walk.position:air?.position;if(!p)return;
  const moved=Math.hypot(p.x-lastCenter[0],p.y-lastCenter[1]);
  if(building||(moved<RESYNC_MOVE_M&&now-lastSyncAt<RESYNC_MS))return;
  const list=features(b);if(!list.length)return;
  if(moved<RESYNC_MOVE_M&&list.length===lastFeatureCount&&currentHash.endsWith(`#d${destructionRevision()}`))return;
  lastSyncAt=now;lastFeatureCount=list.length;lastCenter=[p.x,p.y];
  const project=(lon,lat)=>b.projectLngLat(lon,lat);
  const footprints=buildingFootprintsFromFeatures(list,{project,center:[p.x,p.y],radiusM:VISUAL_RADIUS_M,maxFootprints:MAX_FOOTPRINTS,maxVertices:MAX_VERTICES});
  const key=`${buildingFootprintHash(footprints)}#d${destructionRevision()}`;if(key===currentHash)return;
  startBuild(footprints,key);
}
function frame(now){try{stepSways(now);sync(now);pumpBuild();}catch(error){console.warn("city buildings",error);building=null;}requestAnimationFrame(frame);}
export function installCityBuildings(){
  if(installed)return;installed=true;
  // The live buffers already show the damage instantly; the authoritative
  // rebuild follows ~1.5 s after the last change (not every frame of a wave).
  onDestruction(()=>{lastSyncAt=performance.now()-RESYNC_MS+1500;lastFeatureCount=-1;currentHash="";});
  requestAnimationFrame(frame);
}
installCityBuildings();
