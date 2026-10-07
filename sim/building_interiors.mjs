import * as THREE from "three";
import {FACADE_GLSL,CUTOUT_GLSL,facadeCutouts,facadeParams,MAX_FACADE_CUTOUTS} from "./world_city_buildings.mjs";
import {buildingDamage} from "./world_destruction_state.mjs";

// Walkable buildings. Every real building of the map can be entered on foot
// through its front door(s): storeys that line up with the facade windows,
// a switchback stairwell from the lobby up to the roof, furnished floors
// (offices, apartments, a lobby with reception), window openings that look
// out onto the real city, ceiling lights and a stair house on the roof.
//
// Performance: only ONE interior exists at a time — the building the player
// is in or walking up to (built in a few milliseconds when it becomes the
// nearest one, ~2–6 draw calls). Nearby buildings only show their closed
// front doors (two instanced draw calls for all of them). Interior walls
// reuse the facade shader, so the window openings inside are exactly where
// the windows are outside; the exterior gets a real hole for the open door
// and the roof hatch (shared cutout uniforms).
//
// Walking: the walk controller asks resolveMove()/feetHeightAt() first.
// Collision is 2-D against wall segments (inner wall faces, door reveals,
// the stair core, furniture circles); the height is the walkable surface
// closest to the feet among floors, landings and stair ramps, and a step of
// more than STEP_MAX is a wall — that single rule keeps the player on the
// stairs, out of the stairwell void and off the edge of the roof hatch.

export const BUILDING_INTERIORS_VERSION="walkable-interiors-v1";
const ACTIVATE_M=30,DOORS_RADIUS_M=95,MAX_CLOSED_DOORS=24,DOOR_W=1.8,DOOR_H=2.55,WALL_IN=.3,R_PLAYER=.3,STEP_MAX=.55;
const LANE=1.2,CORE_W=2*LANE+.2,LAND=1.3,RUN=3.6,CORE_L=2*LAND+RUN,GROUND_STOREY=4,SLAB=.25,MAX_LEVELS=12,ROOF_HOUSE=2.7;
const K={wall:0,wood:1,tile:2,ceil:3,stone:4,metal:5,lamp:6,plain:7,concrete:8,carpet:9,accent:10,woodTrim:11,stairWall:12,riser:13};
const bridge=()=>globalThis.__arondightRealWorld||null;
const walk=()=>globalThis.__arondightWalkMode||null;
const viewport=()=>document.getElementById("viewport");
const setData=(k,v)=>{const el=viewport();if(el)el.dataset[k]=String(v);};

// ------------------------------------------------------------------ geometry utils
const area2=r=>{let a=0;for(let i=0,j=r.length-1;i<r.length;j=i++)a+=(r[j][0]-r[i][0])*(r[j][1]+r[i][1]);return a/2;}; // >0 = CCW
function cleanRing(points){const r=[];for(const p of points||[]){const x=+p[0],y=+p[1];if(!Number.isFinite(x)||!Number.isFinite(y))continue;const q=r.at(-1);if(q&&Math.hypot(q[0]-x,q[1]-y)<.05)continue;r.push([x,y]);}if(r.length>2&&Math.hypot(r[0][0]-r.at(-1)[0],r[0][1]-r.at(-1)[1])<.05)r.pop();return r;}
function pip(x,y,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],c=ring[j];if(((a[1]>y)!==(c[1]>y))&&x<(c[0]-a[0])*(y-a[1])/((c[1]-a[1])||1e-9)+a[0])inside=!inside;}return inside;}
function segDist(px,py,ax,ay,bx,by){const dx=bx-ax,dy=by-ay,l=dx*dx+dy*dy||1e-9,t=Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/l));return Math.hypot(px-ax-dx*t,py-ay-dy*t);}
function ringDist(x,y,ring){let d=Infinity;for(let i=0,j=ring.length-1;i<ring.length;j=i++)d=Math.min(d,segDist(x,y,ring[j][0],ring[j][1],ring[i][0],ring[i][1]));return d;}
// Offset to the LEFT of the travel direction (inside of a CCW outer ring,
// solid side of a CW hole ring) with clamped miters.
function offsetRing(r,d){const n=r.length,out=[];for(let i=0;i<n;i++){const p=r[(i+n-1)%n],c=r[i],q=r[(i+1)%n];let ax=c[0]-p[0],ay=c[1]-p[1],bx=q[0]-c[0],by=q[1]-c[1];const la=Math.hypot(ax,ay)||1,lb=Math.hypot(bx,by)||1;ax/=la;ay/=la;bx/=lb;by/=lb;const n0x=-ay,n0y=ax,n1x=-by,n1y=bx,dot=n0x*n1x+n0y*n1y;let mx=n0x+n1x,my=n0y+n1y;const k=1/Math.max(.25,1+dot);mx*=k;my*=k;out.push([c[0]+mx*d,c[1]+my*d]);}return out;}
function hashKey(s){let h=2166136261;for(const ch of String(s))h=Math.imul(h^ch.charCodeAt(0),16777619);return h>>>0;}
function rng(seed){let s=seed>>>0||1;return()=>{s^=s<<13;s>>>=0;s^=s>>>17;s^=s<<5;s>>>=0;return s/4294967296;};}

// ------------------------------------------------------------------ shell builder
class Shell{
  constructor(b){this.b=b;this.pos=[];this.nrm=[];this.wall=[];this.kind=[];this.local=[];}
  v(p,n,k,w,l){this.pos.push(p[0],p[1],p[2]);this.nrm.push(n[0],n[1],n[2]);this.kind.push(k);this.wall.push(w?w[0]:-3,w?w[1]:0,w?w[2]:0,w?w[3]:0);this.local.push(l??99);}
  // a,b,c,d counter-clockwise as seen from the visible side
  quad(a,b,c,d,k,o={}){const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];let nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;const l=Math.hypot(nx,ny,nz)||1;const n=[nx/l,ny/l,nz/l];
    const W=o.wall?o.wall:null,L=o.local;const pts=[a,b,c,a,c,d],ws=W?[W[0],W[1],W[2],W[0],W[2],W[3]]:[],ls=L?[L[0],L[1],L[2],L[0],L[2],L[3]]:[];
    for(let i=0;i<6;i++)this.v(pts[i],n,k,W?ws[i]:null,L?ls[i]:99);}
  tri(a,b,c,k){const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];let nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;const l=Math.hypot(nx,ny,nz)||1;const n=[nx/l,ny/l,nz/l];this.v(a,n,k);this.v(b,n,k);this.v(c,n,k);}
  // horizontal polygon (outer CCW + holes), facing up or down
  slab(outer,holes,z,k,up=true){if(outer.length<3)return;const c=outer.map(p=>new THREE.Vector2(p[0],p[1])),h=holes.filter(r=>r.length>2).map(r=>r.map(p=>new THREE.Vector2(p[0],p[1])));let tris;try{tris=THREE.ShapeUtils.triangulateShape(c,h);}catch{return;}const all=[...c,...h.flat()];
    for(const t of tris){let a=all[t[0]],b=all[t[1]],d=all[t[2]];const cw=(b.x-a.x)*(d.y-a.y)-(b.y-a.y)*(d.x-a.x)<0;if(cw===up)[b,d]=[d,b];this.tri([a.x,a.y,z],[b.x,b.y,z],[d.x,d.y,z],k);}}
  // oriented box around the segment p0→p1 (any slope), width w (horizontal), height h (vertical, centred)
  beam(p0,p1,w,h,k){const dx=p1[0]-p0[0],dy=p1[1]-p0[1],l=Math.hypot(dx,dy)||1,sx=-dy/l*w/2,sy=dx/l*w/2,hz=h/2;
    const c=(p,s,t)=>[p[0]+sx*s,p[1]+sy*s,p[2]+hz*t];const A=[c(p0,-1,-1),c(p0,1,-1),c(p0,1,1),c(p0,-1,1)],B=[c(p1,-1,-1),c(p1,1,-1),c(p1,1,1),c(p1,-1,1)];
    this.quad(A[3],A[2],B[2],B[3],k);this.quad(A[1],A[0],B[0],B[1],k);this.quad(A[0],A[3],B[3],B[0],k);this.quad(A[2],A[1],B[1],B[2],k);this.quad(A[0],A[1],A[2],A[3],k);this.quad(B[1],B[0],B[3],B[2],k);}
  geometry(){const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(this.pos,3));g.setAttribute("normal",new THREE.Float32BufferAttribute(this.nrm,3));g.setAttribute("aWall",new THREE.Float32BufferAttribute(this.wall,4));g.setAttribute("aKind",new THREE.Float32BufferAttribute(this.kind,1));g.setAttribute("aLocal",new THREE.Float32BufferAttribute(this.local,1));g.computeBoundingSphere();return g;}
}

// One shell per storey (index F = roof parts) so only the storeys around the
// player are drawn — no overdraw from the floors above and below.
class LevelShells{
  constructor(b){this.b=b;this.m=new Map();this.k=0;}
  at(k){this.k=k;return this;}
  cur(){let s=this.m.get(this.k);if(!s){s=new Shell(this.b);this.m.set(this.k,s);}return s;}
  quad(...a){this.cur().quad(...a);}tri(...a){this.cur().tri(...a);}slab(...a){this.cur().slab(...a);}beam(...a){this.cur().beam(...a);}
  geometries(){return[...this.m].map(([k,s])=>[k,s.geometry()]);}
}
// ------------------------------------------------------------------ interior material
const interiorUniforms={vSeed:{value:.5},vFloorH:{value:3.3},uWallColor:{value:new THREE.Color("#e9e4da")},uAccent:{value:new THREE.Color("#7f9a8a")},uAxis:{value:new THREE.Vector2(1,0)}};
let shellMaterial=null;
function getShellMaterial(){
  if(shellMaterial)return shellMaterial;
  const m=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.85,metalness:0,side:THREE.DoubleSide});
  m.onBeforeCompile=shader=>{Object.assign(shader.uniforms,facadeCutouts,interiorUniforms);
    shader.vertexShader=shader.vertexShader.replace("void main() {","attribute vec4 aWall;attribute float aKind;attribute float aLocal;varying vec3 vWinPos;varying vec4 vWall;varying float vKind;varying float vLocal;\nvoid main() {vWall=aWall;vKind=aKind;vLocal=aLocal;")
      .replace("#include <begin_vertex>","#include <begin_vertex>\nvWinPos=(modelMatrix*vec4(transformed,1.0)).xyz;");
    shader.fragmentShader=shader.fragmentShader.replace("void main() {",`varying vec3 vWinPos;varying vec4 vWall;varying float vKind;varying float vLocal;uniform float vSeed;uniform float vFloorH;uniform vec3 uWallColor;uniform vec3 uAccent;uniform vec2 uAxis;
float fh(float n){return fract(sin(n*127.1)*43758.5453);}
float ih(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float inoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(ih(i),ih(i+vec2(1,0)),f.x),mix(ih(i+vec2(0,1)),ih(i+vec2(1,1)),f.x),f.y);}
${CUTOUT_GLSL}
void main() {float iRough=0.85,iMetal=0.0;vec3 iEmit=vec3(0.0);`)
      .replace("#include <color_fragment>",`#include <color_fragment>
{
  float kd=vKind;vec3 P=vWinPos;vec2 q=vec2(dot(P.xy,uAxis),dot(P.xy,vec2(-uAxis.y,uAxis.x)));
  if(kd<0.5){
    if(facadeCutout(P,false))discard;
    float facGlass=0.0,facRough=0.88;
    ${FACADE_GLSL.replace("float aa=clamp(1.6-fwidth(u)*1.2,0.0,1.0);","float aa=1.0;")}
    if(facGlass>0.5)discard;
    float n=inoise(P.xy*1.7+P.z*2.3)*0.5+inoise(vec2(q.x,P.z)*7.0)*0.5;
    vec3 c=uWallColor*(0.94+0.08*n);
    c=mix(c,vec3(0.24,0.18,0.13),step(vLocal,0.11));
    diffuseColor.rgb=c;iRough=0.9;
  }else if(kd<1.5){
    float row=floor(q.y/0.19),off=fh(row*1.37)*1.6,pl=floor((q.x+off)/1.55),hv=ih(vec2(row,pl));
    float gx=fract((q.x+off)/1.55),gy=fract(q.y/0.19);float gap=step(gx,0.006)+step(0.985,gy);
    vec3 oak=mix(vec3(0.42,0.27,0.15),vec3(0.62,0.43,0.26),hv);oak*=0.9+0.12*inoise(vec2(q.x*9.0,row*3.1));
    diffuseColor.rgb=mix(oak,oak*0.45,clamp(gap,0.0,1.0));iRough=0.42+0.1*hv;
  }else if(kd<2.5){
    vec2 t=q/0.6;vec2 f=fract(t);float grout=step(f.x,0.012)+step(f.y,0.012);float hv=ih(floor(t));
    vec3 st=mix(vec3(0.44,0.41,0.37),vec3(0.54,0.51,0.46),hv)*(0.93+0.1*inoise(q*3.0));
    diffuseColor.rgb=mix(st,vec3(0.35,0.34,0.32),clamp(grout,0.0,1.0));iRough=0.3;
  }else if(kd<3.5){
    vec2 cell=(fract(q/3.6)-0.5)*3.6;float panel=step(abs(cell.x),0.7)*step(abs(cell.y),0.3);
    diffuseColor.rgb=vec3(0.93,0.92,0.89);iRough=0.95;iEmit=vec3(2.4,2.2,1.9)*panel+vec3(0.30,0.28,0.25);
  }else if(kd<4.5){
    diffuseColor.rgb=vec3(0.30,0.26,0.22)*(0.9+0.14*inoise(P.xy*4.0));iRough=0.5;
  }else if(kd<5.5){
    diffuseColor.rgb=vec3(0.11,0.12,0.13);iRough=0.35;iMetal=0.7;
  }else if(kd<6.5){
    diffuseColor.rgb=vec3(1.0,0.92,0.75);iEmit=vec3(3.2,2.7,1.9);
  }else if(kd<7.5){
    vec3 c=uWallColor*(0.92+0.06*inoise(P.xy*1.3+P.z*1.9));
    c=mix(c,uAccent,0.0);c=mix(c,vec3(0.24,0.18,0.13),step(vLocal,0.11));diffuseColor.rgb=c;iRough=0.9;
  }else if(kd<8.5){
    diffuseColor.rgb=vec3(0.46,0.46,0.45)*(0.9+0.12*inoise(P.xy*5.0+P.z));iRough=0.8;
  }else if(kd<9.5){
    float n=inoise(q*14.0)*0.6+inoise(q*2.0)*0.4;diffuseColor.rgb=mix(vec3(0.30,0.32,0.35),vec3(0.38,0.40,0.43),n);iRough=0.98;
  }else if(kd<10.5){
    vec3 c=uAccent*(0.94+0.06*inoise(P.xy*1.3+P.z*1.9));diffuseColor.rgb=mix(c,vec3(0.24,0.18,0.13),step(vLocal,0.11));iRough=0.88;
  }else if(kd<11.5){
    diffuseColor.rgb=vec3(0.40,0.27,0.17)*(0.9+0.15*inoise(vec2(q.x*20.0,P.z*3.0)));iRough=0.5;
  }else if(kd<12.5){
    float dado=step(fract(P.z/max(vFloorH,2.5))*max(vFloorH,2.5),1.1);diffuseColor.rgb=mix(vec3(0.86,0.85,0.82),uAccent*0.85,dado)*(0.95+0.05*inoise(P.xy*2.0+P.z));iRough=0.85;
  }else{
    diffuseColor.rgb=vec3(0.66,0.64,0.60)*(0.95+0.06*inoise(P.xy*6.0));iRough=0.8;
  }
  // indoor light: pools under the ceiling panels on floors, contact shadow
  // where walls meet the floor, a warm fill so rooms never go black
  float pool=1.0;if(kd>0.5&&kd<2.5||kd>8.5&&kd<9.5){vec2 cl=(fract(q/3.6)-0.5)*3.6;pool=0.72+0.5*exp(-dot(cl,cl)*0.35);}
  float ao=vLocal<50.0?mix(0.72,1.0,smoothstep(0.0,0.7,vLocal)):1.0;
  diffuseColor.rgb*=ao;
  iEmit+=diffuseColor.rgb*vec3(0.17,0.15,0.12)*pool;diffuseColor.rgb*=mix(1.0,pool,0.6);
}`)
      .replace("#include <roughnessmap_fragment>","#include <roughnessmap_fragment>\nroughnessFactor=iRough;")
      .replace("#include <metalnessmap_fragment>","#include <metalnessmap_fragment>\nmetalnessFactor=iMetal;")
      .replace("#include <emissivemap_fragment>","#include <emissivemap_fragment>\ntotalEmissiveRadiance+=iEmit;")
      .replace("#include <lights_fragment_end>","#include <lights_fragment_end>\nreflectedLight.indirectDiffuse*=vec3(0.66,0.56,0.45);reflectedLight.indirectSpecular*=0.5;");
  };
  m.envMapIntensity=.35;
  m.customProgramCacheKey=()=>"building-interior-shell-v4";
  shellMaterial=m;return m;
}

// ------------------------------------------------------------------ props (instanced furniture)
function propGeometry(parts){
  const pos=[],nrm=[],col=[],c=new THREE.Color();
  const face=(a,b,cc,d,n,color)=>{for(const p of[a,b,cc,a,cc,d]){pos.push(...p);nrm.push(...n);col.push(color.r,color.g,color.b);}};
  for(const part of parts){c.set(part.c);const color=c.clone();
    if(part.box){const[x,y,z,sx,sy,sz]=part.box,rz=part.rz||0,cs=Math.cos(rz),sn=Math.sin(rz),P=(dx,dy,dz)=>[x+dx*cs-dy*sn,y+dx*sn+dy*cs,z+dz],N=(nx,ny,nz)=>[nx*cs-ny*sn,nx*sn+ny*cs,nz];const hx=sx/2,hy=sy/2,hz=sz/2;
      face(P(-hx,-hy,hz),P(hx,-hy,hz),P(hx,hy,hz),P(-hx,hy,hz),N(0,0,1),color);face(P(-hx,hy,-hz),P(hx,hy,-hz),P(hx,-hy,-hz),P(-hx,-hy,-hz),N(0,0,-1),color);
      face(P(-hx,-hy,-hz),P(hx,-hy,-hz),P(hx,-hy,hz),P(-hx,-hy,hz),N(0,-1,0),color);face(P(hx,hy,-hz),P(-hx,hy,-hz),P(-hx,hy,hz),P(hx,hy,hz),N(0,1,0),color);
      face(P(hx,-hy,-hz),P(hx,hy,-hz),P(hx,hy,hz),P(hx,-hy,hz),N(1,0,0),color);face(P(-hx,hy,-hz),P(-hx,-hy,-hz),P(-hx,-hy,hz),P(-hx,hy,hz),N(-1,0,0),color);}
    else if(part.cyl){const[x,y,z0,r,h,seg=10,r2=r]=part.cyl;for(let i=0;i<seg;i++){const a0=i/seg*Math.PI*2,a1=(i+1)/seg*Math.PI*2,c0=Math.cos(a0),s0=Math.sin(a0),c1=Math.cos(a1),s1=Math.sin(a1),am=(a0+a1)/2;
        face([x+c0*r,y+s0*r,z0],[x+c1*r,y+s1*r,z0],[x+c1*r2,y+s1*r2,z0+h],[x+c0*r2,y+s0*r2,z0+h],[Math.cos(am),Math.sin(am),0],color);
        pos.push(x,y,z0+h,x+c0*r2,y+s0*r2,z0+h,x+c1*r2,y+s1*r2,z0+h);for(let k=0;k<3;k++){nrm.push(0,0,1);col.push(color.r,color.g,color.b);}}}
    else if(part.ico){const[x,y,z,r,sz=1]=part.ico,g=new THREE.IcosahedronGeometry(r,0).toNonIndexed();g.scale(1,1,sz);g.computeVertexNormals();const p=g.attributes.position,n=g.attributes.normal;for(let i=0;i<p.count;i++){pos.push(p.getX(i)+x,p.getY(i)+y,p.getZ(i)+z);nrm.push(n.getX(i),n.getY(i),n.getZ(i));col.push(color.r,color.g,color.b);}g.dispose();}}
  const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));g.setAttribute("normal",new THREE.Float32BufferAttribute(nrm,3));g.setAttribute("color",new THREE.Float32BufferAttribute(col,3));g.computeBoundingSphere();return g;
}
// Local frame: x across, y = depth (front faces −y), z up; origin on the floor.
const OAK="#b98b5c",WALNUT="#5e3f2a",DARK="#24262a",STEEL="#8b9096",WHITE="#eeece6",FABRIC="#f2f2f2";
const PROP_DEFS={
  desk:{r:.95,parts:[{box:[0,0,.735,1.6,.8,.04],c:OAK},...[[-.74,-.34],[.74,-.34],[-.74,.34],[.74,.34]].map(([x,y])=>({box:[x,y,.36,.04,.04,.72],c:DARK})),{box:[0,.22,1.03,.62,.035,.38],c:"#111214"},{box:[0,.22,1.03,.58,.02,.34],c:"#2b3a4c"},{box:[0,.25,.8,.06,.06,.12],c:DARK},{box:[0,.25,.76,.22,.16,.015],c:DARK},{box:[0,-.12,.765,.46,.15,.02],c:"#2e3033"},{box:[.55,.1,.82,.08,.08,.14],c:"#c95a3a"}]},
  chair:{r:.36,parts:[{box:[0,0,.46,.5,.5,.08],c:"#3a3f47"},{box:[0,.23,.78,.48,.06,.52],c:"#3a3f47"},{cyl:[0,0,.08,.03,.38,6],c:STEEL},{box:[0,0,.06,.62,.06,.04],c:DARK},{box:[0,0,.06,.62,.06,.04],rz:Math.PI/2,c:DARK}]},
  sofa:{r:1.1,tint:true,parts:[{box:[0,0,.22,2.1,.92,.3],c:FABRIC},{box:[-.5,-.05,.45,.98,.78,.14],c:FABRIC},{box:[.5,-.05,.45,.98,.78,.14],c:FABRIC},{box:[0,.36,.66,2.1,.2,.5],c:FABRIC},{box:[-1.0,0,.4,.16,.92,.46],c:FABRIC},{box:[1.0,0,.4,.16,.92,.46],c:FABRIC},...[[-.95,-.4],[.95,-.4],[-.95,.4],[.95,.4]].map(([x,y])=>({box:[x,y,.04,.05,.05,.08],c:WALNUT}))]},
  art:{r:0,tint:true,parts:[{box:[0,.02,1.55,1.04,.035,.76],c:"#2a2522"},{box:[0,-.002,1.55,.94,.03,.66],c:FABRIC},{box:[-.18,-.02,1.6,.36,.01,.3],c:"#e8dcc4"},{box:[.2,-.02,1.45,.26,.01,.22],c:"#1f2f3c"},{box:[.05,-.022,1.72,.5,.01,.06],c:"#c4553b"}]},
  armchair:{r:.55,tint:true,parts:[{box:[0,0,.22,.86,.84,.3],c:FABRIC},{box:[0,-.04,.42,.62,.7,.12],c:FABRIC},{box:[0,.34,.66,.86,.18,.56],c:FABRIC},{box:[-.38,0,.48,.12,.84,.38],c:FABRIC},{box:[.38,0,.48,.12,.84,.38],c:FABRIC},...[[-.36,-.36],[.36,-.36],[-.36,.36],[.36,.36]].map(([x,y])=>({box:[x,y,.035,.05,.05,.07],c:WALNUT}))]},
  lounge:{r:1.25,tint:true,parts:[{box:[0,0,.006,2.7,1.9,.012],c:FABRIC},{box:[0,0,.4,1.0,.55,.04],c:WALNUT},...[[-.44,-.22],[.44,-.22],[-.44,.22],[.44,.22]].map(([x,y])=>({box:[x,y,.2,.04,.04,.38],c:DARK})),{box:[-.2,.05,.45,.25,.18,.05],c:"#d9c39a"},{cyl:[.25,-.05,.42,.06,.12,8],c:"#e8e1d5"}]},
  dining:{r:1.25,parts:[{box:[0,0,.75,1.8,.9,.05],c:WALNUT},...[[-.82,-.38],[.82,-.38],[-.82,.38],[.82,.38]].map(([x,y])=>({box:[x,y,.37,.06,.06,.74],c:WALNUT})),...[[-.45,-.68,0],[.45,-.68,0],[-.45,.68,Math.PI],[.45,.68,Math.PI]].flatMap(([x,y,r])=>{const s=r?-1:1;return[{box:[x,y,.45,.44,.42,.05],c:OAK},{box:[x,y-.19*s,.72,.44,.05,.5],c:OAK},{box:[x-.18,y,.22,.04,.04,.44],c:OAK},{box:[x+.18,y,.22,.04,.04,.44],c:OAK}];}),{cyl:[0,0,.775,.08,.18,8,.05],c:"#dfe6e9"},{ico:[0,0,1.0,.12],c:"#4f7d3a"}]},
  shelf:{r:.62,parts:[{box:[-.58,0,.95,.03,.36,1.9],c:WHITE},{box:[.58,0,.95,.03,.36,1.9],c:WHITE},{box:[0,.17,.95,1.16,.02,1.9],c:WHITE},...[.04,.5,.95,1.4,1.88].map(z=>({box:[0,0,z,1.16,.36,.025],c:WHITE})),...Array.from({length:14},(_,i)=>{const sh=[.06,.52,.97,1.42][i%4],x=-.5+((i*.37)%1)*.95,h=.22+((i*.53)%1)*.12;return{box:[x,0,sh+h/2,.06+((i*.29)%1)*.05,.24,h],c:["#a33b2f","#2f5d8a","#d8b14a","#2e6b4f","#e7e2d6","#3a3a3a"][i%6]};})]},
  plant:{r:.32,parts:[{cyl:[0,0,0,.2,.42,10,.24],c:"#d9d4ca"},{cyl:[0,0,.42,.21,.03,10],c:"#3b2b1f"},{ico:[0,0,.85,.36,1.25],c:"#3d6b33"},{ico:[.12,-.08,1.15,.26,1.2],c:"#4d7f3d"},{ico:[-.1,.1,1.3,.2,1.3],c:"#5b8f45"}]},
  lamp:{r:.25,parts:[{cyl:[0,0,0,.16,.03,12],c:DARK},{cyl:[0,0,.03,.015,1.45,6],c:DARK},{cyl:[0,0,1.42,.24,.26,12,.14],c:"#f4e4c2"}]},
  bed:{r:1.25,tint:true,parts:[{box:[0,0,.18,1.72,2.18,.3],c:WALNUT},{box:[0,-.02,.43,1.62,2.04,.22],c:WHITE},{box:[0,-.45,.55,1.66,1.2,.06],c:FABRIC},{box:[-.4,.78,.6,.6,.36,.14],c:WHITE},{box:[.4,.78,.6,.6,.36,.14],c:WHITE},{box:[0,1.07,.6,1.74,.08,1.0],c:WALNUT},{box:[-1.15,.85,.28,.45,.4,.56],c:OAK},{cyl:[-1.15,.85,.56,.07,.25,8,.12],c:"#f4e4c2"}]},
  counter:{r:.55,parts:[{box:[0,0,.45,2.4,.6,.86],c:WHITE},{box:[0,-.01,.9,2.44,.64,.04],c:"#3d3f42"},{box:[.55,-.02,.905,.5,.38,.02],c:"#b9bec3"},{cyl:[.55,.2,.92,.02,.3,6],c:STEEL},{box:[-.6,-.02,.93,.55,.45,.03],c:"#222"},...[-.9,-.3,.3,.9].map(x=>({box:[x,-.305,.6,.3,.01,.02],c:STEEL}))]},
  reception:{r:1.5,parts:[{box:[0,0,.55,2.8,.75,1.1],c:WALNUT},{box:[0,-.05,1.12,2.9,.85,.05],c:"#d9d6cf"},{box:[0,.3,.76,2.6,.2,.04],c:"#d9d6cf"},{box:[-.6,.15,1.32,.5,.03,.32],c:"#111214"},{box:[0,-.39,.55,2.6,.01,.5],c:"#c7a35a"}]},
  bench:{r:.9,parts:[{box:[0,0,.44,1.9,.46,.06],c:OAK},{box:[-.8,0,.21,.06,.4,.42],c:DARK},{box:[.8,0,.21,.06,.4,.42],c:DARK}]},
  ac:{r:1.0,parts:[{box:[0,0,.55,1.5,1.1,1.1],c:"#a9adb1"},{cyl:[0,0,1.1,.4,.05,14],c:"#2c2f33"},{box:[0,-.56,.55,1.3,.02,.8],c:"#7f8489"}]},
  table:{r:.55,parts:[{cyl:[0,0,.72,.45,.04,16],c:"#efe9df"},{cyl:[0,0,.04,.05,.68,8],c:DARK},{cyl:[0,0,0,.25,.04,12],c:DARK},{ico:[0,0,.86,.1],c:"#7a9b55"}]},
};
let propGeos=null;const propMaterial=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.7,metalness:0,envMapIntensity:.35});
propMaterial.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace("#include <lights_fragment_end>","#include <lights_fragment_end>\nreflectedLight.indirectDiffuse*=vec3(0.66,0.56,0.45);").replace("#include <emissivemap_fragment>","#include <emissivemap_fragment>\ntotalEmissiveRadiance+=diffuseColor.rgb*vec3(0.15,0.135,0.11);");};
propMaterial.customProgramCacheKey=()=>"interior-props-v2";
const TINTS=["#4f6d7a","#8a4f3c","#c2a15c","#5a6b4a","#6f6a8f","#9b9a96","#2f4a66","#b87a5a"];

// door unit (local: x along the wall, y outward, z up; origin bottom centre at the facade)
let doorGeo=null,leafGeo=null;const doorMaterial=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.45,metalness:.35});
function doorGeometries(){if(doorGeo)return;const W=DOOR_W,H=DOOR_H;
  doorGeo=propGeometry([{box:[-W/2-.05,.04,H/2,.1,.14,H],c:"#1d1f22"},{box:[W/2+.05,.04,H/2,.1,.14,H],c:"#1d1f22"},{box:[0,.04,H+.06,W+.2,.14,.12],c:"#1d1f22"},{box:[0,.6,H+.42,W+.9,1.2,.08],c:"#2a2c30"},{box:[0,.75,H+.36,.3,.08,.04],c:"#fff2cf"},{box:[0,.02,.01,W+.3,.3,.02],c:"#6d6a64"},{box:[-W/2-.42,.04,H*.55,.16,.06,.5],c:"#3a3d42"}]);
  leafGeo=propGeometry([{box:[-W/4,.01,H/2,W/2-.04,.04,H-.04],c:"#1e2a33"},{box:[W/4,.01,H/2,W/2-.04,.04,H-.04],c:"#1e2a33"},{box:[-.08,.05,1.05,.03,.06,.5],c:"#9aa0a6"},{box:[.08,.05,1.05,.03,.06,.5],c:"#9aa0a6"}]);}

// ------------------------------------------------------------------ building analysis
function doorsFor(outer,area){
  const edges=[];for(let i=0;i<outer.length;i++){const a=outer[i],b=outer[(i+1)%outer.length],dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);if(len<DOOR_W+1.4)continue;edges.push({i,a,b,len,dx:dx/len,dy:dy/len,nx:dy/len,ny:-dx/len});}
  edges.sort((p,q)=>q.len-p.len);const out=[];if(!edges.length)return out;
  const mk=e=>{const t=e.len/2;return{edge:e.i,t,len:e.len,ax:e.a[0],ay:e.a[1],dx:e.dx,dy:e.dy,nx:e.nx,ny:e.ny,cx:e.a[0]+e.dx*t,cy:e.a[1]+e.dy*t};};
  out.push(mk(edges[0]));if(area>260){const second=edges.find(e=>e!==edges[0]&&e.nx*edges[0].nx+e.ny*edges[0].ny<-.3);if(second)out.push(mk(second));}
  return out;
}
function findCore(inner,innerHoles,holes,doors,centroid,axis){
  let bx0=Infinity,by0=Infinity,bx1=-Infinity,by1=-Infinity;for(const p of inner){bx0=Math.min(bx0,p[0]);bx1=Math.max(bx1,p[0]);by0=Math.min(by0,p[1]);by1=Math.max(by1,p[1]);}
  const span=Math.max(bx1-bx0,by1-by0),step=Math.max(.8,span/18),cands=[];
  for(let x=bx0;x<=bx1;x+=step)for(let y=by0;y<=by1;y+=step)cands.push([x,y,Math.hypot(x-centroid[0],y-centroid[1])]);cands.sort((a,b)=>a[2]-b[2]);
  const okPoint=(x,y,clear)=>pip(x,y,inner)&&!innerHoles.some(h=>pip(x,y,h))&&ringDist(x,y,inner)>=clear&&innerHoles.every(h=>ringDist(x,y,h)>=clear);
  const dirs=[[axis[0],axis[1]],[-axis[0],-axis[1]],[-axis[1],axis[0]],[axis[1],-axis[0]]];
  for(const[cx,cy]of cands.slice(0,500)){
    if(doors.some(d=>Math.hypot(d.cx-cx,d.cy-cy)<CORE_L*.5+3.2))continue;
    for(const[vx,vy]of dirs){const ux=-vy,uy=vx,ox=cx-ux*CORE_W/2-vx*CORE_L/2,oy=cy-uy*CORE_W/2-vy*CORE_L/2,P=(u,v)=>[ox+ux*u+vx*v,oy+uy*u+vy*v];
      const pts=[P(0,0),P(CORE_W,0),P(0,CORE_L),P(CORE_W,CORE_L),P(CORE_W/2,CORE_L/2),P(0,CORE_L/2),P(CORE_W,CORE_L/2)];if(!pts.every(p=>okPoint(p[0],p[1],.12)))continue;
      const front=P(CORE_W/2,-1.4);if(!okPoint(front[0],front[1],.7))continue;
      const rect=[P(0,0),P(CORE_W,0),P(CORE_W,CORE_L),P(0,CORE_L)];if(holes.some(h=>h.some(p=>pip(p[0],p[1],rect))))continue;
      return{ox,oy,ux,uy,vx,vy,W:CORE_W,L:CORE_L,P,rect};}
  }
  return null;
}

// ------------------------------------------------------------------ interior build
let active=null,group=null,shellMeshes=[],propMeshes=[],doorMesh=null,leafMesh=null,sceneRef=null;
function disposeActive(){for(const m of shellMeshes){m.geometry.dispose();m.parent?.remove(m);}shellMeshes=[];for(const m of propMeshes){m.parent?.remove(m);m.dispose?.();}propMeshes=[];active=null;facadeCutouts.uCutN.value=0;setData("buildingInterior","none");}
function ensureGroup(scene){if(group?.parent===scene)return group;group?.parent?.remove(group);group=new THREE.Group();group.name="BUILDING_INTERIORS";scene.add(group);sceneRef=scene;doorMesh=leafMesh=null;shellMeshes=[];propMeshes=[];return group;}

function buildInterior(fp){
  const key=String(fp.key),params=facadeParams(key),seed=hashKey(key),R=rng(seed^0x9e3779b9);
  let outer=cleanRing(fp.outer);if(outer.length<3)return null;if(area2(outer)<0)outer.reverse();
  const holes=(fp.holes||[]).map(cleanRing).filter(r=>r.length>2).map(r=>area2(r)>0?r.reverse():r);
  const area=Math.abs(area2(outer))-holes.reduce((s,h)=>s+Math.abs(area2(h)),0);if(area<24||area>40000)return null;
  const base=Number(fp.base)||0,top=Math.max(base+3,Number(fp.fullTop??fp.top)||8);if(base>.6)return null;
  const inner=offsetRing(outer,WALL_IN),innerHoles=holes.map(h=>offsetRing(h,WALL_IN));
  let cx=0,cy=0;for(const p of outer){cx+=p[0]/outer.length;cy+=p[1]/outer.length;}
  let best=null;for(let i=0;i<outer.length;i++){const a=outer[i],b=outer[(i+1)%outer.length],l=Math.hypot(b[0]-a[0],b[1]-a[1]);if(!best||l>best.l)best={l,dx:(b[0]-a[0])/l,dy:(b[1]-a[1])/l};}
  const axis=[best.dx,best.dy];
  const doors=doorsFor(outer,area);if(!doors.length)return null;
  // storeys aligned with the facade (ground storey 4 m, then the facade's storey height)
  const floorH=params.floorH,levels=[base+.03];let z=base+GROUND_STOREY,capped=false;
  const core=top-base>GROUND_STOREY+2.7?findCore(inner,innerHoles,holes,doors,[cx,cy],axis):null;
  if(core){while(z+2.7<=top-.05){if(levels.length>=MAX_LEVELS){capped=true;break;}levels.push(z);z+=floorH;}}
  const F=levels.length,roofAccess=Boolean(core)&&!capped&&top-levels[F-1]<=floorH+1.8&&area<12000;
  // top storey ceiling: under the roof, under the next (unreachable) storey when
  // capped, or the ground storey's ceiling in a tall building without a core
  const ceilTop=capped?levels[F-1]+floorH-SLAB:F===1&&top-base>GROUND_STOREY+.5?base+GROUND_STOREY-SLAB:top-.3;
  const ceilOf=k=>k<F-1?levels[k+1]-SLAB:ceilTop;
  const stairs=[];if(core){for(let k=0;k<F-1;k++)stairs.push({z0:levels[k],R:levels[k+1]-levels[k]});if(roofAccess)stairs.push({z0:levels[F-1],R:top-levels[F-1]});}
  const topWalk=roofAccess?top:levels[F-1];
  const b={key,outer,holes,inner,innerHoles,base,top,area,axis,doors,core,levels,stairs,roofAccess,roofZ:roofAccess?top:null,ceilOf,topWalk,params,cx,cy,furniture:[],props:[]};
  placeProps(b,R);b.shell=buildShell(b);return b;
}

function buildShell(b){
  const S=new LevelShells(b),{outer,inner,holes,innerHoles,base,top,levels,core,doors}=b,H=top-base,F=levels.length;
  const exteriorEdge=i=>{const a=outer[i],c=outer[(i+1)%outer.length],l=Math.hypot(c[0]-a[0],c[1]-a[1])||1;return{a,l,dx:(c[0]-a[0])/l,dy:(c[1]-a[1])/l};};
  const holeEdge=(h,i)=>{const r=holes[h],a=r[i],c=r[(i+1)%r.length],l=Math.hypot(c[0]-a[0],c[1]-a[1])||1;return{a,l,dx:(c[0]-a[0])/l,dy:(c[1]-a[1])/l};};
  const coreHole=core?[...core.rect].reverse():null;
  // walls (inner faces, facade window openings via the shared shader)
  const wallRing=(ring,edgeOf)=>{for(let i=0;i<ring.length;i++){const A=ring[i],B=ring[(i+1)%ring.length],e=edgeOf(i),uA=Math.max(.001,Math.min(e.l-.001,(A[0]-e.a[0])*e.dx+(A[1]-e.a[1])*e.dy)),uB=Math.max(.001,Math.min(e.l-.001,(B[0]-e.a[0])*e.dx+(B[1]-e.a[1])*e.dy));
    for(let k=0;k<F;k++){const z0=k===0?base:levels[k],z1=b.ceilOf(k)+.02;S.at(k).quad([B[0],B[1],z0],[A[0],A[1],z0],[A[0],A[1],z1],[B[0],B[1],z1],K.wall,{wall:[[uB,e.l,z0-base,H],[uA,e.l,z0-base,H],[uA,e.l,z1-base,H],[uB,e.l,z1-base,H]],local:[z0-levels[k],z0-levels[k],z1-levels[k],z1-levels[k]]});}}};
  wallRing(inner,i=>exteriorEdge(i));innerHoles.forEach((r,h)=>wallRing(r,i=>holeEdge(h,i)));
  // floors and ceilings
  for(let k=0;k<F;k++){const floorKind=k===0?K.tile:((b.params.seed*7+k)%2<1?K.wood:K.carpet);
    const hs=[...innerHoles];if(core&&k>0)hs.push(coreHole);S.at(k).slab(inner,hs,levels[k],floorKind,true);
    const ch=[...innerHoles];if(core&&(k<F-1||b.roofAccess))ch.push(coreHole);S.slab(inner,ch,b.ceilOf(k),K.ceil,false);}
  // roof parapet when the roof is walkable
  S.at(F);if(b.roofAccess){for(let i=0;i<inner.length;i++){const A=inner[i],B=inner[(i+1)%inner.length];S.quad([B[0],B[1],top],[A[0],A[1],top],[A[0],A[1],top+.95],[B[0],B[1],top+.95],K.plain);const C=outer[i],D=outer[(i+1)%outer.length];S.quad([B[0],B[1],top+.95],[A[0],A[1],top+.95],[C[0],C[1],top+.95],[D[0],D[1],top+.95],K.concrete);}}
  // doors: reveal tunnel, threshold, interior trim
  S.at(0);for(const d of doors){const t0=d.t-DOOR_W/2,t1=d.t+DOOR_W/2,P=(t,o,z)=>[d.ax+d.dx*t-d.nx*o,d.ay+d.dy*t-d.ny*o,z],z0=levels[0],zt=z0+DOOR_H;
    S.quad(P(t0,0,base),P(t0,WALL_IN+.02,base),P(t0,WALL_IN+.02,zt),P(t0,0,zt),K.plain,{local:[0,0,9,9]});
    S.quad(P(t1,WALL_IN+.02,base),P(t1,0,base),P(t1,0,zt),P(t1,WALL_IN+.02,zt),K.plain,{local:[0,0,9,9]});
    S.quad(P(t0,0,zt),P(t0,WALL_IN+.02,zt),P(t1,WALL_IN+.02,zt),P(t1,0,zt),K.plain);
    S.quad(P(t0,-.25,z0),P(t1,-.25,z0),P(t1,WALL_IN+.02,z0),P(t0,WALL_IN+.02,z0),K.stone);
    S.beam(P(t0-.05,WALL_IN+.03,z0),P(t0-.05,WALL_IN+.03,zt+.08),.1,.06,K.metal);S.beam(P(t1+.05,WALL_IN+.03,z0),P(t1+.05,WALL_IN+.03,zt+.08),.1,.06,K.metal);
    S.beam(P(t0-.1,WALL_IN+.03,zt+.05),P(t1+.1,WALL_IN+.03,zt+.05),.06,.1,K.metal);}
  // partition walls with doorways (rooms on the upper storeys)
  (b.partitions||[]).forEach((parts,k)=>{if(!parts?.length||k>=F)return;S.at(k);const z0=levels[k],z1=b.ceilOf(k)+.02;
    for(const w of parts){const dx=w.x1-w.x0,dy=w.y1-w.y0,l=Math.hypot(dx,dy)||1,nx=-dy/l*.06,ny=dx/l*.06,kind=w.accent?K.accent:K.plain,loc=[0,0,z1-z0,z1-z0];
      S.quad([w.x0+nx,w.y0+ny,z0],[w.x1+nx,w.y1+ny,z0],[w.x1+nx,w.y1+ny,z1],[w.x0+nx,w.y0+ny,z1],kind,{local:loc});
      S.quad([w.x1-nx,w.y1-ny,z0],[w.x0-nx,w.y0-ny,z0],[w.x0-nx,w.y0-ny,z1],[w.x1-nx,w.y1-ny,z1],K.plain,{local:loc});
      for(const[ex,ey]of[[w.x0,w.y0],[w.x1,w.y1]])S.quad([ex-nx,ey-ny,z0],[ex+nx,ey+ny,z0],[ex+nx,ey+ny,z1],[ex-nx,ey-ny,z1],K.plain,{local:loc});}
    for(const g of b.gaps?.[k]||[]){const hx=g.dx*.58,hy=g.dy*.58,nx=-g.dy*.07,ny=g.dx*.07,zl=z0+2.15;
      if(z1>zl+.02){S.quad([g.x-hx+nx,g.y-hy+ny,zl],[g.x+hx+nx,g.y+hy+ny,zl],[g.x+hx+nx,g.y+hy+ny,z1],[g.x-hx+nx,g.y-hy+ny,z1],K.plain);S.quad([g.x+hx-nx,g.y+hy-ny,zl],[g.x-hx-nx,g.y-hy-ny,zl],[g.x-hx-nx,g.y-hy-ny,z1],[g.x+hx-nx,g.y+hy-ny,z1],K.plain);S.quad([g.x-hx-nx,g.y-hy-ny,zl],[g.x+hx-nx,g.y+hy-ny,zl],[g.x+hx+nx,g.y+hy+ny,zl],[g.x-hx+nx,g.y-hy+ny,zl],K.plain);}
      for(const s2 of[-1,1])S.beam([g.x+g.dx*.58*s2,g.y+g.dy*.58*s2,z0],[g.x+g.dx*.58*s2,g.y+g.dy*.58*s2,zl+.04],.07,.16,K.woodTrim);
      S.beam([g.x-g.dx*.62,g.y-g.dy*.62,zl+.04],[g.x+g.dx*.62,g.y+g.dy*.62,zl+.04],.16,.07,K.woodTrim);}
  });
  if(core)buildCore(S,b);
  return S.geometries();
}
function buildCore(S,b){
  const c=b.core,{levels,stairs,top}=b,F=levels.length,P=(u,v,z)=>{const p=c.P(u,v);return[p[0],p[1],z];};
  const coreTop=b.roofAccess?top+ROOF_HOUSE:b.ceilOf(F-1)+.02,zBase=b.base,W=c.W,L=c.L,T=.075;
  // shaft walls (outside face towards the floors with skirting, inside face plain), per storey
  const spans=[];for(let k=0;k<F;k++)spans.push([k===0?zBase:levels[k],k<F-1?levels[k+1]:(b.roofAccess?top:coreTop),levels[k],k]);if(b.roofAccess)spans.push([top,coreTop,top,F]);
  for(const[z0,z1,lz,sk]of spans){S.at(sk);
    S.quad(P(-T,L,z0),P(-T,0,z0),P(-T,0,z1),P(-T,L,z1),K.accent,{local:[z0-lz,z0-lz,z1-lz,z1-lz]});S.quad(P(T,0,z0),P(T,L,z0),P(T,L,z1),P(T,0,z1),K.stairWall);
    S.quad(P(W+T,0,z0),P(W+T,L,z0),P(W+T,L,z1),P(W+T,0,z1),K.accent,{local:[z0-lz,z0-lz,z1-lz,z1-lz]});S.quad(P(W-T,L,z0),P(W-T,0,z0),P(W-T,0,z1),P(W-T,L,z1),K.stairWall);
    S.quad(P(-T,L+T,z0),P(W+T,L+T,z0),P(W+T,L+T,z1),P(-T,L+T,z1),K.accent,{local:[z0-lz,z0-lz,z1-lz,z1-lz]});S.quad(P(W,L-T,z0),P(0,L-T,z0),P(0,L-T,z1),P(W,L-T,z1),K.stairWall);
    // central wall between the flights
    S.quad(P(W/2-.06,LAND+RUN,z0),P(W/2-.06,LAND,z0),P(W/2-.06,LAND,z1),P(W/2-.06,LAND+RUN,z1),K.stairWall);S.quad(P(W/2+.06,LAND,z0),P(W/2+.06,LAND+RUN,z0),P(W/2+.06,LAND+RUN,z1),P(W/2+.06,LAND,z1),K.stairWall);
    S.quad(P(W/2-.06,LAND,z0),P(W/2+.06,LAND,z0),P(W/2+.06,LAND,z1),P(W/2-.06,LAND,z1),K.plain);S.quad(P(W/2+.06,LAND+RUN,z0),P(W/2-.06,LAND+RUN,z0),P(W/2-.06,LAND+RUN,z1),P(W/2+.06,LAND+RUN,z1),K.plain);
    // lintel over the open side (both faces) and the wall ends
    const lt=Math.min(z1,lz+2.4);if(z1>lt+.02){S.quad(P(-T,-T*0,lt),P(W+T,0,lt),P(W+T,0,z1),P(-T,0,z1),K.plain);S.quad(P(W+T,.02,lt),P(-T,.02,lt),P(-T,.02,z1),P(W+T,.02,z1),K.plain);S.quad(P(-T,.02,lt),P(W+T,.02,lt),P(W+T,0,lt),P(-T,0,lt),K.plain);}
    S.quad(P(-T,0,z0),P(T,0,z0),P(T,0,z1),P(-T,0,z1),K.plain);S.quad(P(W-T,0,z0),P(W+T,0,z0),P(W+T,0,z1),P(W-T,0,z1),K.plain);
  }
  // stair house roof
  if(b.roofAccess){S.at(F);S.slab([P(-T,-T,0),P(W+T,-T,0),P(W+T,L+T,0),P(-T,L+T,0)].map(p=>[p[0],p[1]]),[],coreTop,K.concrete,true);S.slab([P(0,0,0),P(W,0,0),P(W,L,0),P(0,L,0)].map(p=>[p[0],p[1]]),[],coreTop-.01,K.ceil,false);}
  // flights, landings, soffits, handrails
  for(let k=0;k<stairs.length;k++){S.at(k);const{z0,R}=stairs[k],half=R/2,n=Math.max(6,Math.round(half/.175)),rs=half/n,tr=RUN/n,uA0=.02,uA1=W/2-.07,uB0=W/2+.07,uB1=W-.02;
    for(let i=0;i<n;i++){const va=LAND+i*tr,vb=va+tr,za=z0+i*rs,zb=za+rs;
      S.quad(P(uA0,va,zb),P(uA1,va,zb),P(uA1,vb,zb),P(uA0,vb,zb),K.stone);S.quad(P(uA1,va,za),P(uA0,va,za),P(uA0,va,zb),P(uA1,va,zb),K.riser);
      const wb=LAND+RUN-i*tr,wa=wb-tr,zc=z0+half+i*rs,zd=zc+rs;S.quad(P(uB0,wa,zd),P(uB1,wa,zd),P(uB1,wb,zd),P(uB0,wb,zd),K.stone);S.quad(P(uB0,wb,zc),P(uB1,wb,zc),P(uB1,wb,zd),P(uB0,wb,zd),K.riser);}
    S.quad(P(uA0,LAND+RUN,z0+half-.22),P(uA1,LAND+RUN,z0+half-.22),P(uA1,LAND,z0-.22),P(uA0,LAND,z0-.22),K.concrete);
    S.quad(P(uB0,LAND,z0+R-.22),P(uB1,LAND,z0+R-.22),P(uB1,LAND+RUN,z0+half-.22),P(uB0,LAND+RUN,z0+half-.22),K.concrete);
    // far landing (with a ceiling light underneath)
    S.quad(P(0,LAND+RUN,z0+half),P(W,LAND+RUN,z0+half),P(W,L,z0+half),P(0,L,z0+half),K.stone);S.quad(P(0,L,z0+half-.2),P(W,L,z0+half-.2),P(W,LAND+RUN,z0+half-.2),P(0,LAND+RUN,z0+half-.2),K.ceil);
    S.quad(P(W,LAND+RUN,z0+half-.2),P(0,LAND+RUN,z0+half-.2),P(0,LAND+RUN,z0+half),P(W,LAND+RUN,z0+half),K.concrete);
    // near landing of the storey above
    const zt=z0+R;S.quad(P(0,0,zt),P(W,0,zt),P(W,LAND,zt),P(0,LAND,zt),K.stone);S.quad(P(0,LAND,zt-SLAB),P(W,LAND,zt-SLAB),P(W,0,zt-SLAB),P(0,0,zt-SLAB),K.ceil);S.quad(P(0,LAND,zt-SLAB),P(0,LAND,zt),P(W,LAND,zt),P(W,LAND,zt-SLAB),K.concrete);
    // handrails on the central wall and the shaft walls
    for(const u of[W/2-.12,.1])S.beam(P(u,LAND,z0+.92),P(u,LAND+RUN,z0+half+.92),.05,.05,K.metal);
    for(const u of[W/2+.12,W-.1])S.beam(P(u,LAND+RUN,z0+half+.92),P(u,LAND,z0+R+.92),.05,.05,K.metal);}
  // guard rail across the top flight opening
  const zt=b.topWalk;S.at(b.roofAccess?F:F-1);S.beam(P(.05,LAND+.04,zt+1.0),P(W/2-.08,LAND+.04,zt+1.0),.05,.05,K.metal);S.beam(P(.05,LAND+.04,zt+.5),P(W/2-.08,LAND+.04,zt+.5),.03,.03,K.metal);
  for(const u of[.08,W/4,W/2-.1])S.beam(P(u,LAND+.04,zt),P(u,LAND+.04,zt+1.0),.04,.04,K.metal);
}

// Furniture and rooms. Upper storeys are divided by partition walls (across
// the building's long axis, each with a doorway) into rooms; every room gets
// a theme — living room, bedroom, kitchen/dining, or an office with desks —
// the lobby gets a reception and seating groups, the roof AC units.
// Everything placed is a collision circle; partitions are collision walls.
function scanLine(rings,ax,ay,a){const px=-ay,py=ax,cs=[];for(const r of rings)for(let i=0,j=r.length-1;i<r.length;j=i++){const p=r[j],q=r[i],pa=p[0]*ax+p[1]*ay,qa=q[0]*ax+q[1]*ay;if((pa-a)*(qa-a)<0){const t=(a-pa)/(qa-pa),pc=p[0]*px+p[1]*py,qc=q[0]*px+q[1]*py;cs.push(pc+(qc-pc)*t);}}cs.sort((m,n)=>m-n);const out=[];for(let i=0;i+1<cs.length;i+=2)out.push([cs[i],cs[i+1]]);return out;}
function placeProps(b,R){
  const{inner,innerHoles,levels,core,doors,axis}=b,ax=axis[0],ay=axis[1],px=-ay,py=ax,props=b.props,F=levels.length,W=(a,c)=>[ax*a+px*c,ay*a+py*c];
  b.partitions=[];b.gaps=[];
  const coreBlock=(x,y,m)=>{if(!core)return false;const rx=x-core.ox,ry=y-core.oy,u=rx*core.ux+ry*core.uy,v=rx*core.vx+ry*core.vy;return u>-m&&u<core.W+m&&v>-m-2.4&&v<core.L+m;};
  const nearWalls=(x,y,r,k)=>(b.partitions[k]||[]).some(w=>segDist(x,y,w.x0,w.y0,w.x1,w.y1)<r+.35)||(b.gaps[k]||[]).some(g=>Math.hypot(g.x-x,g.y-y)<r+1.0);
  const free=(x,y,r,k,clear=.55)=>pip(x,y,inner)&&!innerHoles.some(h=>pip(x,y,h))&&ringDist(x,y,inner)>=r+clear&&innerHoles.every(h=>ringDist(x,y,h)>=r+clear)&&!coreBlock(x,y,r+.4)&&!(k===0&&doors.some(d=>Math.hypot(d.cx-x,d.cy-y)<r+3.6))&&!nearWalls(x,y,r,k)&&!b.furniture.some(f=>f.k===k&&Math.hypot(f.x-x,f.y-y)<f.r+r+.6);
  const z=k=>k>=F?b.top:levels[k];
  const add=(type,x,y,k,yaw,tint=null,solid=true)=>{const def=PROP_DEFS[type];props.push({type,x,y,z:z(k),yaw,tint:tint??(def.tint?TINTS[(R()*TINTS.length)|0]:null),k});if(solid)b.furniture.push({x,y,r:def.r,k});};
  const fwd=yaw=>[Math.sin(yaw),-Math.cos(yaw)]; // where a prop's front points
  let bx0=Infinity,by0=Infinity,bx1=-Infinity,by1=-Infinity;for(const p of inner){const a=p[0]*ax+p[1]*ay,c=p[0]*px+p[1]*py;bx0=Math.min(bx0,a);bx1=Math.max(bx1,a);by0=Math.min(by0,c);by1=Math.max(by1,c);}
  const yaw0=Math.atan2(ay,ax),residential=b.params.seed>.45;let total=0;
  const rings=[inner,...innerHoles];
  for(let k=0;k<=F;k++){
    if(k===F&&!b.roofAccess)break;const roof=k===F,lobby=k===0,office=!lobby&&!roof&&(!residential||k%4===1);
    // partitions
    const cuts=[];b.partitions[k]=[];b.gaps[k]=[];
    if(!lobby&&!roof){const spacing=office?12.5:6.8;for(let a=bx0+spacing*(.8+R()*.4);a<bx1-spacing*.55;a+=spacing*(.85+R()*.3)){let used=false;
      for(const[c0,c1]of scanLine(rings,ax,ay,a)){if(c1-c0<2.6)continue;let hitCore=false;for(let c=c0;c<=c1;c+=.5){const p=W(a,c);if(coreBlock(p[0],p[1],1.4)){hitCore=true;break;}}if(hitCore)continue;
        const gw=1.1,gc=c0+.75+gw/2+R()*Math.max(0,c1-c0-1.5-gw),g0=gc-gw/2,g1=gc+gw/2,accent=R()<.35,P0=W(a,c0),P1=W(a,g0),P2=W(a,g1),P3=W(a,c1);
        if(g0-c0>.1)b.partitions[k].push({x0:P0[0],y0:P0[1],x1:P1[0],y1:P1[1],accent});if(c1-g1>.1)b.partitions[k].push({x0:P2[0],y0:P2[1],x1:P3[0],y1:P3[1],accent});
        const G=W(a,gc);b.gaps[k].push({x:G[0],y:G[1],dx:px,dy:py});used=true;}if(used)cuts.push(a);}}
    const roomOf=a=>{let i=0;for(const c of cuts)if(a>c)i++;return i;};
    const roomUse=new Map(),theme=room=>office?"office":["living","bed","kitchen"][(room+k+Math.floor(b.params.seed*9))%3];
    if(lobby){const c=[b.cx,b.cy];if(free(c[0],c[1],1.5,k))add("reception",c[0],c[1],k,yaw0+Math.PI*(R()<.5?0:1));}
    const step=roof?6.5:lobby?5.2:office?3.4:2.6,off=R()*step,grid=[];
    for(let a=bx0+off+1.0;a<bx1-.8;a+=step)for(let c=by0+off*.7+1.0;c<by1-.8;c+=step)grid.push([a,c]);
    for(let i=grid.length-1;i>0;i--){const j=(R()*(i+1))|0;[grid[i],grid[j]]=[grid[j],grid[i]];}
    const budget=Math.min(roof?6:70,Math.max(8,Math.round(b.area/(office?14:20))));let n=0;
    for(const[a,c]of grid.slice(0,700)){if(n>=budget||total>620)break;const[x,y]=W(a,c),r=R(),flip=R()<.5?0:Math.PI,yaw=yaw0+flip;
      if(roof){if(free(x,y,1.0,k,.9)){add("ac",x,y,k,yaw0);n++;}continue;}
      if(lobby){if(r<.45&&free(x,y,1.6,k)){add("lounge",x,y,k,yaw,null,false);const f=fwd(yaw);if(free(x-f[0]*1.35,y-f[1]*1.35,1.0,k,.2))add("sofa",x-f[0]*1.35,y-f[1]*1.35,k,yaw);for(const s2 of[-1,1]){const ex=x+f[0]*1.3+Math.cos(yaw)*s2*.6,ey=y+f[1]*1.3+Math.sin(yaw)*s2*.6;if(free(ex,ey,.5,k,.1))add("armchair",ex,ey,k,yaw+Math.PI+s2*.25);}b.furniture.push({x,y,r:.6,k});n++;total++;}
        else if(r<.7&&free(x,y,.4,k)){add("plant",x,y,k,R()*6);n++;}else if(r<.85&&free(x,y,.95,k)){add("bench",x,y,k,yaw);n++;}else if(free(x,y,.6,k)){add("table",x,y,k,0);for(const s2 of[0,1,2]){const aa=s2*2.1+R()*.4,ex=x+Math.cos(aa)*.9,ey=y+Math.sin(aa)*.9;if(free(ex,ey,.36,k,0))add("chair",ex,ey,k,Math.atan2(x-ex,-(y-ey)));}n++;}
        continue;}
      const room=roomOf(a),th=theme(room),used=roomUse.get(room)||{};const has=t=>(used[t]||0)>0;roomUse.set(room,used);let type=null;
      if(th==="office")type=r<.7?"desk":r<.8?"plant":r<.9?"shelf":"dining";
      else if(th==="living")type=!has("sofa")?"sofa":!has("shelf")&&r<.4?"shelf":r<.55?"lamp":r<.75?"plant":"armchair";
      else if(th==="bed")type=!has("bed")?"bed":r<.4?"lamp":r<.7?"plant":"armchair";
      else type=!has("dining")?"dining":r<.5?"plant":r<.7?"table":null;
      const LIMIT={plant:2,lamp:1,table:1,armchair:2,shelf:1,dining:1,sofa:1,bed:1,desk:99};if(!type||(used[type]||0)>=(LIMIT[type]??1))continue;const def=PROP_DEFS[type];if(!free(x,y,def.r,k))continue;
      if(type==="desk"){add("desk",x,y,k,yaw);const f=fwd(yaw);props.push({type:"chair",k,x:x+f[0]*.72,y:y+f[1]*.72,z:levels[k],yaw:yaw+Math.PI+(R()-.5)*.6});}
      else if(type==="sofa"){add("sofa",x,y,k,yaw);const f=fwd(yaw);if(free(x+f[0]*1.35,y+f[1]*1.35,.9,k,.15)){add("lounge",x+f[0]*1.35,y+f[1]*1.35,k,yaw,null,false);b.furniture.push({x:x+f[0]*1.35,y:y+f[1]*1.35,r:.55,k});}const ex=x+f[0]*1.4+Math.cos(yaw)*1.5,ey=y+f[1]*1.4+Math.sin(yaw)*1.5;if(free(ex,ey,.5,k,.1))add("armchair",ex,ey,k,yaw-Math.PI/2);}
      else if(type==="bed"){add("bed",x,y,k,yaw);const f=fwd(yaw),lx=x+Math.cos(yaw)*1.3-f[0]*.75,ly=y+Math.sin(yaw)*1.3-f[1]*.75;if(free(lx,ly,.25,k,.05))add("lamp",lx,ly,k,0);}
      else add(type,x,y,k,type==="plant"||type==="lamp"||type==="table"?R()*6:yaw);
      used[type]=(used[type]||0)+1;n++;total++;}
    // pictures on the partition walls (both faces)
    for(const w of b.partitions[k]){const dx=w.x1-w.x0,dy=w.y1-w.y0,l=Math.hypot(dx,dy);if(l<1.7)continue;const nx=-dy/l,ny=dx/l,mx=(w.x0+w.x1)/2,my=(w.y0+w.y1)/2;
      for(const sd of[-1,1]){if(R()<.3)continue;const x=mx+nx*sd*.08,y=my+ny*sd*.08;props.push({type:"art",k,x,y,z:levels[k],yaw:Math.atan2(nx*sd,-ny*sd),tint:TINTS[(R()*TINTS.length)|0]});}}
    // wall pieces: kitchen counters, shelves, plants along the outer walls
    if(!roof){for(let i=0;i<inner.length;i++){const A=inner[i],B=inner[(i+1)%inner.length],dx=B[0]-A[0],dy=B[1]-A[1],l=Math.hypot(dx,dy);if(l<4)continue;const ux=dx/l,uy=dy/l,nx=-uy,ny=ux;
      for(let t=1.8;t<l-1.8;t+=R()<.5?4.5:6.5){const x0=A[0]+ux*t,y0=A[1]+uy*t,room=roomOf(x0*ax+y0*ay),th=lobby?"lobby":theme(room),r=R();
        const type=th==="lobby"?(r<.55?"plant":null):th==="office"?(r<.45?"shelf":r<.7?"plant":null):th==="kitchen"?(r<.75?"counter":"plant"):th==="living"?(r<.45?"shelf":r<.7?"plant":null):(r<.4?"shelf":r<.6?"plant":null);if(!type)continue;
        const depth=type==="counter"?.32:type==="shelf"?.2:.35,x=x0+nx*(depth+.05),y=y0+ny*(depth+.05),def=PROP_DEFS[type];
        if(!pip(x,y,inner)||coreBlock(x,y,def.r+.3)||nearWalls(x,y,Math.min(def.r,.6),k)||(k===0&&doors.some(d=>Math.hypot(d.cx-x,d.cy-y)<3.6))||b.furniture.some(f=>f.k===k&&Math.hypot(f.x-x,f.y-y)<f.r+def.r+.3))continue;
        props.push({type,k,x,y,z:levels[k],yaw:Math.atan2(nx,-ny)});b.furniture.push({x,y,r:Math.min(def.r,.5),k});}}}
  }
}
// Furniture is drawn only for the storey the player is on and the ones
// directly above/below (the rest is hidden behind slabs anyway), so a
// 12-storey tower costs the same as a 3-storey house.
let shownLevel=-99;
function buildPropMeshes(b){
  propGeos??=Object.fromEntries(Object.entries(PROP_DEFS).map(([k,d])=>[k,propGeometry(d.parts)]));
  const byType=new Map();for(const p of b.props){let l=byType.get(p.type);if(!l){l=[];byType.set(p.type,l);}l.push(p);}
  for(const[type,list]of byType){const mesh=new THREE.InstancedMesh(propGeos[type],propMaterial,list.length);mesh.name=`INTERIOR_PROPS_${type}`;mesh.receiveShadow=true;mesh.castShadow=false;mesh.userData.styleSkip=true;mesh.userData.props=list;mesh.count=0;propMeshes.push(mesh);group.add(mesh);}
  shownLevel=-99;
}
function showPropLevels(level){
  if(level===shownLevel)return;shownLevel=level;
  const F=active?.levels.length??0;for(const m of shellMeshes){const k=m.userData.level;m.visible=Math.abs(k-level)<=1||k===F;}
  const m4=new THREE.Matrix4(),q=new THREE.Quaternion(),s=new THREE.Vector3(1,1,1),v=new THREE.Vector3(),zAxis=new THREE.Vector3(0,0,1),c=new THREE.Color();
  for(const mesh of propMeshes){let n=0;for(const p of mesh.userData.props){if(Math.abs(p.k-level)>1)continue;q.setFromAxisAngle(zAxis,p.yaw);m4.compose(v.set(p.x,p.y,p.z),q,s);mesh.setMatrixAt(n,m4);mesh.setColorAt(n,c.set(p.tint||"#ffffff"));n++;}
    mesh.count=n;mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;mesh.computeBoundingSphere();}
}
function currentLevel(b,feet){let best=0,d=Infinity;const zs=[...b.levels];if(b.roofZ!=null)zs.push(b.roofZ);zs.forEach((z,i)=>{const e=Math.abs(z-feet);if(e<d){d=e;best=i;}});return best;}
function activate(fp,scene){
  const b=buildInterior(fp);if(!b)return false;disposeActive();ensureGroup(scene);active=b;
  interiorUniforms.vSeed.value=b.params.seed;interiorUniforms.vFloorH.value=b.params.floorH;interiorUniforms.uAxis.value.set(b.axis[0],b.axis[1]);
  interiorUniforms.uWallColor.value.set(["#ece7dd","#e6e1d6","#dfe3e0","#efe9df","#e4ddd2","#e9e6e1"][hashKey(b.key)%6]);interiorUniforms.uAccent.value.set(["#7f9a8a","#b0705a","#5f7590","#c9a35e","#8a7aa0","#6f8f7a","#a6644f","#4f6a7c"][(hashKey(b.key)>>>5)%8]);
  for(const[k,g]of b.shell){const m=new THREE.Mesh(g,getShellMaterial());m.name=`BUILDING_INTERIOR_SHELL_${k}`;m.userData.level=k;m.receiveShadow=true;m.castShadow=false;m.userData.styleSkip=true;group.add(m);shellMeshes.push(m);}
  buildPropMeshes(b);showPropLevels(0);
  // open doorways + roof hatch in the exterior
  let n=0;for(const d of b.doors){if(n>=MAX_FACADE_CUTOUTS)break;const t0=d.t-DOOR_W/2,t1=d.t+DOOR_W/2;facadeCutouts.uCutA.value[n].set(d.ax+d.dx*t0,d.ay+d.dy*t0,d.ax+d.dx*t1,d.ay+d.dy*t1);facadeCutouts.uCutB.value[n].set(b.base-2,b.levels[0]+DOOR_H,.85,0);n++;}
  if(b.roofAccess&&n<MAX_FACADE_CUTOUTS){const c=b.core;facadeCutouts.uCutA.value[n].set(c.ox,c.oy,c.vx,c.vy);facadeCutouts.uCutB.value[n].set(b.top-.4,b.top+.8,c.W,1+c.L);n++;}
  facadeCutouts.uCutN.value=n;
  setData("buildingInterior",`${b.levels.length}F${b.roofAccess?"+roof":""}/${b.props.length}p`);setData("buildingInteriorVersion",BUILDING_INTERIORS_VERSION);
  return true;
}

// ------------------------------------------------------------------ walking
function local(b,x,y){const c=b.core;if(!c)return null;const rx=x-c.ox,ry=y-c.oy;return{u:rx*c.ux+ry*c.uy,v:rx*c.vx+ry*c.vy};}
function ramp(u,v,R){const half=R/2;if(u<CORE_W/2){if(v<=LAND)return 0;if(v>=LAND+RUN)return half;return(v-LAND)/RUN*half;}if(v>=LAND+RUN)return half;if(v<=LAND)return R;return half+(LAND+RUN-v)/RUN*half;}
function surfaces(b,x,y){
  const out=[],l=local(b,x,y),inCore=l&&l.u>=0&&l.u<=CORE_W&&l.v>=0&&l.v<=CORE_L;
  if(!inCore||l.v<LAND){for(const z of b.levels)out.push(z);if(b.roofZ!=null)out.push(b.roofZ);}
  if(inCore)for(const s of b.stairs)out.push(s.z0+ramp(l.u,l.v,s.R));
  return out;
}
function bestSurface(b,x,y,feet){let best=null,d=Infinity;for(const z of surfaces(b,x,y)){const e=Math.abs(z-feet);if(e<d){d=e;best=z;}}return best;}
function region(b,x,y){if(!pip(x,y,b.outer)||b.holes.some(h=>pip(x,y,h)))return"out";if(pip(x,y,b.inner)&&!b.innerHoles.some(h=>pip(x,y,h)))return"in";return"wall";}
function inDoorTunnel(b,x,y){for(const d of b.doors){const rx=x-d.ax,ry=y-d.ay,t=rx*d.dx+ry*d.dy,o=-(rx*d.nx+ry*d.ny);if(Math.abs(t-d.t)<DOOR_W/2-R_PLAYER+.02&&o>-1&&o<WALL_IN+.6)return true;}return false;}
function nearDoor(b,x,y,m=2.8){return b.doors.some(d=>Math.hypot(x-d.cx,y-d.cy)<m);}
function collides(b,x,y,feet){
  const ground=feet<b.levels[0]+1.2,c=b.core;
  if(c){const l=local(b,x,y),z=feet,coreTop=b.roofAccess?b.top+ROOF_HOUSE:b.ceilOf(b.levels.length-1);if(z<coreTop&&l.u>-R_PLAYER-.08&&l.u<CORE_W+R_PLAYER+.08&&l.v>-R_PLAYER&&l.v<CORE_L+R_PLAYER+.08){
      const wall=(u0,v0,u1,v1)=>segDist(l.u,l.v,u0,v0,u1,v1)<R_PLAYER+.07;if(wall(0,0,0,CORE_L)||wall(CORE_W,0,CORE_W,CORE_L)||wall(0,CORE_L,CORE_W,CORE_L)||wall(CORE_W/2,LAND,CORE_W/2,LAND+RUN))return true;}}
  for(let k=0;k<(b.partitions||[]).length;k++){const lz=k>=b.levels.length?b.top:b.levels[k];if(Math.abs(lz-feet)>1)continue;for(const w of b.partitions[k])if(segDist(x,y,w.x0,w.y0,w.x1,w.y1)<R_PLAYER+.06)return true;}
  for(const f of b.furniture){const fz=f.k>=b.levels.length?b.top:b.levels[f.k];if(Math.abs(fz-feet)<1&&Math.hypot(f.x-x,f.y-y)<f.r+R_PLAYER*.6)return true;}
  return false;
}
function valid(b,x,y,feet){
  const reg=region(b,x,y),ground=feet<b.levels[0]+1.2;
  if(reg==="out")return ground&&nearDoor(b,x,y,3.4)?{z:null}:null;
  if(reg==="wall")return ground&&inDoorTunnel(b,x,y)?{z:b.levels[0]}:null;
  // inside: keep off the inner walls (door openings excepted at street level)
  const dIn=ringDist(x,y,b.inner);if(dIn<R_PLAYER&&!(ground&&inDoorTunnel(b,x,y)))return null;if(b.innerHoles.some(h=>ringDist(x,y,h)<R_PLAYER))return null;
  const z=bestSurface(b,x,y,feet);if(z==null||Math.abs(z-feet)>STEP_MAX)return null;
  if(collides(b,x,y,z))return null;return{z};
}
function resolveMove(from,to,feet){
  const b=active;if(!b||walk()?.mode!=="foot")return null;
  const rf=region(b,from.x,from.y),rt=region(b,to.x,to.y);
  if(rf==="out"&&rt==="out"&&!nearDoor(b,from.x,from.y)&&!nearDoor(b,to.x,to.y))return null;
  if(rf==="out"&&!nearDoor(b,from.x,from.y))return null;
  for(const p of[[to.x,to.y],[to.x,from.y],[from.x,to.y]]){const r=valid(b,p[0],p[1],feet);if(r){if(r.z===null&&region(b,p[0],p[1])==="out"&&!nearDoor(b,p[0],p[1],2.2))return null;return{x:p[0],y:p[1]};}}
  return{x:from.x,y:from.y};
}
function feetHeightAt(x,y,feet){
  const b=active;if(!b||walk()?.mode!=="foot")return null;const reg=region(b,x,y);if(reg==="out")return null;if(reg==="wall")return b.levels[0];
  const z=bestSurface(b,x,y,feet);return z;
}

// ------------------------------------------------------------------ closed doors on nearby buildings
const doorCache=new Map();
function updateDoors(scene,player,list){
  doorGeometries();ensureGroup(scene);
  if(!doorMesh){doorMesh=new THREE.InstancedMesh(doorGeo,doorMaterial,MAX_CLOSED_DOORS*2);doorMesh.name="BUILDING_DOOR_FRAMES";doorMesh.count=0;doorMesh.frustumCulled=false;doorMesh.receiveShadow=true;doorMesh.userData.styleSkip=true;group.add(doorMesh);
    leafMesh=new THREE.InstancedMesh(leafGeo,doorMaterial,MAX_CLOSED_DOORS*2);leafMesh.name="BUILDING_DOOR_LEAVES";leafMesh.count=0;leafMesh.frustumCulled=false;leafMesh.userData.styleSkip=true;group.add(leafMesh);}
  const near=[];for(const fp of list){const c=fp.center||fp.outer?.[0];if(!c)continue;const d=Math.hypot(c[0]-player.x,c[1]-player.y);if(d<DOORS_RADIUS_M+40)near.push([d,fp]);}near.sort((a,b)=>a[0]-b[0]);
  const m4=new THREE.Matrix4(),q=new THREE.Quaternion(),s=new THREE.Vector3(1,1,1),v=new THREE.Vector3(),zAxis=new THREE.Vector3(0,0,1);let nf=0,nl=0;
  for(const[,fp]of near){if(nf>=MAX_CLOSED_DOORS*2-2)break;const key=String(fp.key);if((Number(fp.base)||0)>.6)continue;const dmg=buildingDamage(key);if(dmg&&dmg.top<(Number(fp.top)||8)-.3)continue;
    let doors=doorCache.get(key);if(!doors){let outer=cleanRing(fp.outer);if(outer.length<3){doorCache.set(key,[]);continue;}if(area2(outer)<0)outer.reverse();const area=Math.abs(area2(outer));doors=area>=24&&area<=40000?doorsFor(outer,area):[];doorCache.set(key,doors);if(doorCache.size>3000)doorCache.delete(doorCache.keys().next().value);}
    const isActive=active?.key===key;
    for(const d of doors){q.setFromAxisAngle(zAxis,Math.atan2(d.dy,d.dx)+Math.PI);m4.compose(v.set(d.cx,d.cy,(Number(fp.base)||0)+.03),q,s);doorMesh.setMatrixAt(nf++,m4);if(!isActive)leafMesh.setMatrixAt(nl++,m4);}}
  doorMesh.count=nf;leafMesh.count=nl;doorMesh.instanceMatrix.needsUpdate=true;leafMesh.instanceMatrix.needsUpdate=true;
}

// ------------------------------------------------------------------ driver
let lastTick=-Infinity,lastDoors=-Infinity,installed=false,pinUntil=-Infinity;
function polyDistance(fp,x,y){const r=fp.outer||[];if(r.length<3)return Infinity;return pip(x,y,r)?0:ringDist(x,y,r);}
function tick(now){
  requestAnimationFrame(tick);if(now-lastTick<250)return;lastTick=now;
  const b=bridge(),w=walk();if(!b?.active||!b.threeScene){if(active)disposeActive();return;}
  if(group&&group.parent!==b.threeScene){disposeActive();group=null;}
  const list=globalThis.__arondightCityBuildings?.footprints?.()||[];
  if(w?.mode!=="foot"){if(active)disposeActive();if(group)group.visible=false;return;}
  ensureGroup(b.threeScene);group.visible=true;
  const p=w.position;if(!p)return;
  if(now-lastDoors>900){lastDoors=now;try{updateDoors(b.threeScene,p,list);}catch(e){console.warn("doors",e);}}
  if(active){const d=buildingDamage(active.key);if(d&&d.top<active.top-.3){disposeActive();return;}}
  const inActive=active&&region(active,p.x,p.y)!=="out";if(active){showPropLevels(inActive?currentLevel(active,p.z-1.68):0);const seen=inActive||nearDoor(active,p.x,p.y,18);for(const m of propMeshes)m.visible=seen;}if(inActive||(active&&now<pinUntil))return;
  // stay with the current building while standing at its door / along its walls
  if(active&&polyDistance({outer:active.outer},p.x,p.y)<7)return;
  let best=null,bd=Infinity;for(const fp of list){const c=fp.center||fp.outer?.[0];if(!c||Math.hypot(c[0]-p.x,c[1]-p.y)>ACTIVATE_M+160)continue;const d=polyDistance(fp,p.x,p.y);if(d<bd){bd=d;best=fp;}}
  if(!best||bd>ACTIVATE_M){if(active&&polyDistance({outer:active.outer},p.x,p.y)>ACTIVATE_M+12)disposeActive();return;}
  if(active?.key===String(best.key))return;
  if(active&&polyDistance({outer:active.outer},p.x,p.y)<bd-2)return;
  const dmg=buildingDamage(String(best.key));if(dmg&&dmg.top<(Number(best.top)||8)-.3)return;
  try{if(activate(best,b.threeScene))lastDoors=-Infinity;}catch(e){console.warn("interior",e);disposeActive();}
}
// Diagnostics/teleport helper: put the player at the door, inside, on the stairs, upstairs or on the roof.
function placePlayer(where="door"){
  const w=walk(),b=active;if(!w||!b)return null;const d=b.doors[0];let x=d.cx+d.nx*4,y=d.cy+d.ny*4,z=b.levels[0],yaw=Math.atan2(-d.nx,-d.ny);
  if(where==="inside"){x=d.cx-d.nx*3.2;y=d.cy-d.ny*3.2;}
  if(b.core&&(where==="stairs"||where==="upper"||where==="roof")){const c=b.core,P=(u,v)=>c.P(u,v);let u=CORE_W*.25,v=LAND+RUN*.4,k=0;if(where==="upper"){k=Math.min(2,b.levels.length-1);u=CORE_W/2;v=-2.2;}if(where==="roof"&&b.roofAccess){u=CORE_W/2;v=-2.6;}
    const p=P(u,v);x=p[0];y=p[1];z=where==="roof"&&b.roofAccess?b.top:where==="upper"?b.levels[k]:b.stairs[0].z0+ramp(u,v,b.stairs[0].R);yaw=Math.atan2(where==="stairs"?c.vx:-c.vx,where==="stairs"?c.vy:-c.vy);}
  pinUntil=performance.now()+20000;w.setPose({x,y,yaw,pitch:where==="roof"?-.15:-.05});w.position.z=z+1.68;return{x,y,z,where,levels:b.levels.length,roof:b.roofAccess};
}
// Diagnostics: activate the nearest enterable building regardless of distance
// (prefers multi-storey ones with a stairwell).
function activateNearest(){
  const b=bridge(),w=walk(),p=w?.position;if(!b?.threeScene||!p)return null;const list=globalThis.__arondightCityBuildings?.footprints?.()||[];
  const ranked=list.map(fp=>[polyDistance(fp,p.x,p.y),fp]).filter(([d])=>Number.isFinite(d)).sort((a,c)=>a[0]-c[0]).slice(0,40);
  for(const pass of[0,1])for(const[,fp]of ranked){const top=Number(fp.top)||0,base=Number(fp.base)||0,ar=Math.abs(area2(cleanRing(fp.outer)));if(pass===0&&(top-base<12||ar<150||ar>4000))continue;try{if(activate(fp,b.threeScene)&&(pass===1||active.core)){lastDoors=-Infinity;return globalThis.__buildingInteriors.active;}}catch(e){console.warn(e);}}
  return null;
}
export function installBuildingInteriors(){
  if(installed||typeof window==="undefined")return;installed=true;
  globalThis.__buildingInteriors={version:BUILDING_INTERIORS_VERSION,resolveMove,feetHeightAt,placePlayer,activateNearest,get _debug(){return active;},get active(){return active?{key:active.key,levels:active.levels.length,roof:active.roofAccess,props:active.props.length,core:Boolean(active.core)}:null;}};
  requestAnimationFrame(tick);
}
installBuildingInteriors();
