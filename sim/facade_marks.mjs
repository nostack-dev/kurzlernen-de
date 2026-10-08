import * as THREE from "three";
import {facadeGlassAt,facadeParams,facadeCutouts} from "./world_city_buildings.mjs";
import {staticGroundHeightAt} from "./terrain_craters.mjs";

// Marks on the real, rendered facades:
//  * glass cracks — a bullet that hits a window pane leaves a spider-web
//    crack (radial + ring fractures, a tiny pit) on the pane; the glass never
//    shatters. Visible from outside and, through the interior glass, from
//    inside (the crack sits on the outer wall plane, drawn double-sided).
//  * blast soot on walls — irregular, soft-edged scorch clipped to the wall
//    it sits on (never wider than the wall, never above the roof edge), so
//    nothing hangs in the air.
// Walls are looked up from the same footprints, orientation and facade
// coordinates the building mesh uses (world_city_buildings.mjs), so marks
// line up with what is drawn — no separate collision proxy is trusted.
// Cost: 2 instanced draw calls for all marks.

export const FACADE_MARKS_VERSION="glass-cracks+clipped-wall-soot-v1";
const CRACKS=160,SOOTS=48;
const Z=new THREE.Vector3(0,0,1),q=new THREE.Quaternion(),sp=new THREE.Quaternion(),p=new THREE.Vector3(),s=new THREE.Vector3(),n=new THREE.Vector3(),m4=new THREE.Matrix4(),col=new THREE.Color(),ZERO=new THREE.Matrix4().makeScale(0,0,0);
const bridge=()=>globalThis.__arondightRealWorld||null;

// ------------------------------------------------------------ wall index
let indexed=null,items=[];
function ringOf(points){const r=(points||[]).map(v=>new THREE.Vector2(+v[0],+v[1])).filter(v=>Number.isFinite(v.x)&&Number.isFinite(v.y));if(r.length>1&&r[0].distanceToSquared(r.at(-1))<1e-10)r.pop();return r;}
function index(){
  const fps=globalThis.__arondightCityBuildings?.footprints?.()||[];if(fps===indexed)return items;indexed=fps;items=[];
  for(const fp of fps){const outer=ringOf(fp.outer);if(outer.length<3)continue;if(THREE.ShapeUtils.isClockWise(outer))outer.reverse();
    const holes=(fp.holes||[]).map(ringOf).filter(r=>r.length>2);for(const r of holes)if(!THREE.ShapeUtils.isClockWise(r))r.reverse();
    let cx=0,cy=0;for(const v of outer){cx+=v.x/outer.length;cy+=v.y/outer.length;}let rad=0;for(const v of outer)rad=Math.max(rad,Math.hypot(v.x-cx,v.y-cy));
    const edges=[];for(const ring of[outer,...holes])for(let k=0;k<ring.length;k++){const a=ring[k],b=ring[(k+1)%ring.length],dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);if(len<.05)continue;edges.push({ax:a.x,ay:a.y,dx:dx/len,dy:dy/len,len,nx:dy/len,ny:-dx/len});}
    const prm=facadeParams(String(fp.key));items.push({key:String(fp.key),base:Number(fp.base)||0,cx,cy,rad,edges,seed:prm.seed,floorH:prm.floorH});}
  return items;
}
function vertical(it){const r=globalThis.__arondightCityBuildings?.ranges?.()?.get?.(it.key);if(!r)return null;return{z0:(+r.elev||0)+(+r.base||it.base),z1:(+r.elev||0)+(+r.top||0),H:(+r.top||0)-(+r.base||it.base)};}
// nearest rendered wall to a point: facade coordinates + outward normal
export function wallAt(x,y,maxDist=.45){
  let best=null;
  for(const it of index()){if(Math.hypot(x-it.cx,y-it.cy)>it.rad+maxDist)continue;
    for(const e of it.edges){const rx=x-e.ax,ry=y-e.ay,u=rx*e.dx+ry*e.dy;if(u<-.02||u>e.len+.02)continue;const d=Math.abs(rx*e.nx+ry*e.ny);if(d<=maxDist&&(!best||d<best.d))best={it,e,u:Math.max(0,Math.min(e.len,u)),d};}}
  if(!best)return null;const v=vertical(best.it);if(!v)return null;return{...best,...v};
}
// open doorways cut into the facade (same test as CUTOUT_GLSL)
function inCutout(x,y,z){const N=facadeCutouts.uCutN.value|0;for(let i=0;i<N;i++){const a=facadeCutouts.uCutA.value[i],b=facadeCutouts.uCutB.value[i];if(b.w>=.5)continue;const dx=a.z-a.x,dy=a.w-a.y,L=Math.hypot(dx,dy)||1e-4,ux=dx/L,uy=dy/L,rx=x-a.x,ry=y-a.y,t=rx*ux+ry*uy,sd=Math.abs(rx*uy-ry*ux);if(t>0&&t<L&&sd<b.z+.35&&z>b.x&&z<b.y)return true;}return false;}
// Is this world point on a window pane? Returns the wall hit (with .glass) or null.
export function glassAt(point){
  if(!point||!Number.isFinite(point.x))return null;const w=wallAt(point.x,point.y);if(!w)return null;
  const zl=point.z-w.z0;if(zl<0||zl>w.H||inCutout(point.x,point.y,point.z))return null;
  w.glass=facadeGlassAt(w.u,w.e.len,zl,w.H,w.it.seed,w.it.floorH);return w;
}

// ------------------------------------------------------------ meshes
const VS=`varying vec2 vUv;varying vec2 vSeed;
void main(){vUv=uv;
#ifdef USE_INSTANCING_COLOR
vSeed=instanceColor.rg;
#else
vSeed=vec2(.5,1.);
#endif
gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.0);}`;
const CRACK_FS=`varying vec2 vUv;varying vec2 vSeed;
float h(float n){return fract(sin(n)*43758.5453);}
void main(){vec2 p=vUv*2.0-1.0;float r=length(p);if(r>1.0)discard;float a=atan(p.y,p.x),sd=vSeed.x*97.0;
  float N=11.0,sec=floor((a+3.14159265)/6.2831853*N);
  float ca=(sec+0.5+(h(sec+sd)-0.5)*0.7)/N*6.2831853-3.14159265;
  float wob=0.035*sin(r*23.0+sec*3.1+sd)*r;float da=abs(sin(a-ca))*r+wob;
  float reach=0.45+0.55*h(sec*3.7+sd*1.3);
  float spoke=smoothstep(0.016,0.0,abs(da))*step(r,reach)*(1.0-r*0.5);
  float ring=0.0;for(int i=0;i<3;i++){float fi=float(i);float rr=0.18+fi*0.2+0.04*sin(a*5.0+sd+fi);float gate=step(0.45,h(floor((a+3.14159265)/6.2831853*N*1.0)+fi*17.0+sd));ring=max(ring,smoothstep(0.012,0.0,abs(r-rr))*gate*step(rr,reach+0.1));}
  float frost=smoothstep(0.16,0.02,r)*0.55;float pit=smoothstep(0.05,0.025,r);
  float crack=max(max(spoke,ring*0.8),frost);
  vec3 c=mix(vec3(0.86,0.92,0.97),vec3(0.05,0.06,0.07),pit);
  float al=max(crack*0.9,pit)*vSeed.y;if(al<0.02)discard;gl_FragColor=vec4(c,al);}`;
const SOOT_FS=`varying vec2 vUv;varying vec2 vSeed;
float h(vec2 p){return fract(sin(dot(p,vec2(41.3,289.1)))*43758.5);}
void main(){vec2 p=vUv*2.0-1.0;float r=length(p),a=atan(p.y,p.x),seed=vSeed.x*10.0;
  float edge=0.74+0.13*sin(a*5.0+seed*7.0)+0.08*sin(a*11.0+seed*3.0)+0.05*sin(a*23.0+seed);if(r>edge)discard;
  float k=r/edge;float soot=0.6+0.4*h(floor(p*11.0+seed));
  vec3 c=mix(vec3(0.07,0.06,0.05),vec3(0.015,0.012,0.01),smoothstep(1.0,0.3,k))*soot;
  gl_FragColor=vec4(c,vSeed.y*0.88*smoothstep(1.0,0.55,k));}`;
let sceneRef=null,cracks=null,soots=null,crackCursor=0,sootCursor=0;
function makeMesh(fs,count,name,order){
  const m=new THREE.ShaderMaterial({vertexShader:VS,fragmentShader:fs,transparent:true,depthWrite:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-4,polygonOffsetUnits:-4});
  const mesh=new THREE.InstancedMesh(new THREE.PlaneGeometry(2,2),m,count);mesh.name=name;mesh.frustumCulled=false;mesh.renderOrder=order;mesh.raycast=()=>{};Object.assign(mesh.userData,{flightFireIgnore:true,neonSkip:true,styleSkip:true});
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);for(let i=0;i<count;i++){mesh.setMatrixAt(i,ZERO);mesh.setColorAt(i,col.setRGB(.5,1,0));}return mesh;
}
function ensure(){
  const scene=bridge()?.threeScene;if(!scene)return false;if(scene===sceneRef&&cracks?.parent===scene)return true;
  cracks?.parent?.remove(cracks);soots?.parent?.remove(soots);sceneRef=scene;
  cracks=makeMesh(CRACK_FS,CRACKS,"WORLD_GLASS_CRACKS",5);soots=makeMesh(SOOT_FS,SOOTS,"WORLD_WALL_SOOT",4);scene.add(cracks,soots);return true;
}
function place(mesh,i,x,y,z,nx,ny,size,seed,strength){
  n.set(nx,ny,0);q.setFromUnitVectors(Z,n);sp.setFromAxisAngle(Z,Math.random()*6.283);q.multiply(sp);p.set(x,y,z);s.set(size,size,size);m4.compose(p,q,s);
  mesh.setMatrixAt(i,m4);mesh.setColorAt(i,col.setRGB(seed,strength,0));mesh.instanceMatrix.needsUpdate=true;mesh.instanceColor.needsUpdate=true;
}
// crack on the pane at the hit (w from glassAt); the pane is the outer wall plane
export function addGlassCrack(w,point,size=.16+Math.random()*.1){
  if(!w||!ensure())return false;const e=w.e,x=e.ax+e.dx*w.u+e.nx*.006,y=e.ay+e.dy*w.u+e.ny*.006;
  place(cracks,crackCursor++%CRACKS,x,y,point.z,e.nx,e.ny,size,Math.random(),1);return true;
}
// soot on the walls around a blast at (x,y,z) with blast radius r
export function addWallSoot(x,y,z,r,maxWalls=2){
  if(!ensure())return 0;const cand=[];
  for(const it of index()){if(Math.hypot(x-it.cx,y-it.cy)>it.rad+r)continue;
    for(const e of it.edges){const rx=x-e.ax,ry=y-e.ay,u=rx*e.dx+ry*e.dy,side=rx*e.nx+ry*e.ny;if(side<=.05||u<0||u>e.len)continue;if(side<r*.55)cand.push({it,e,u,d:side});}}
  cand.sort((a,b)=>a.d-b.d);let placed=0;
  for(const c of cand){if(placed>=maxWalls)break;const v=vertical(c.it);if(!v)continue;const e=c.e,px=e.ax+e.dx*c.u,py=e.ay+e.dy*c.u,ground=staticGroundHeightAt(px+e.nx*.3,py+e.ny*.3);
    let rr=Math.min(r*.42,c.u,e.len-c.u,(v.z1-ground)*.5)*(1-c.d/(r*.55)*.35);if(!(rr>=.45))continue;
    const zc=Math.min(Math.max(z,ground+rr*.35),v.z1-rr);if(zc+rr>v.z1+1e-3||zc<ground-rr*.5)continue;
    place(soots,sootCursor++%SOOTS,px+e.nx*.01,py+e.ny*.01,zc,e.nx,e.ny,rr,Math.random(),Math.max(.45,1-c.d/(r*.55)));placed++;}
  return placed;
}
export function clearFacadeMarks(){for(const m of[cracks,soots]){if(!m)continue;for(let i=0;i<m.count;i++)m.setMatrixAt(i,ZERO);m.instanceMatrix.needsUpdate=true;}}
if(typeof window!=="undefined"){window.addEventListener("arondight:world-reset",clearFacadeMarks);
  globalThis.__facadeMarks={glassAt,wallAt,crack:addGlassCrack,soot:addWallSoot,clear:clearFacadeMarks,version:FACADE_MARKS_VERSION};}
