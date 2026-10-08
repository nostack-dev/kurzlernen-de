import {triangleHeightAt} from "./terrain_surface.mjs";
import {shockHeightAt} from "./nuke_shock_field.mjs";
import {elevationAt,onElevationChange,elevationCenter} from "./terrain_elevation.mjs";
// Deformable ground: one height function shared by physics, rendering and
// the walking player, so a nuke crater is real terrain — the drone can fly
// down into it, the camera and rangefinder see it, the pilot walks the bowl.
//
// Physics (Box3D): the flat ground used to be one 20 km box. It is now the
// same box minus axis-aligned holes under each crater (rectangle sweep, a
// handful of hulls), and every hole is filled with a grid of convex slabs
// whose tops follow the crater surface — a concave bowl built from convex
// pieces. Rebuilt only when a crater appears or the world resets.

export const TERRAIN_CRATERS_VERSION="mesh-is-collision-v1";
export const CRATER_R=210,CRATER_DEPTH=22,CRATER_RIM=7;
const SLAB_CELLS=16,SLAB_BOTTOM_Z=-90,GROUND_THICKNESS=.1,MAX_CRATERS=3;

const craters=[];const listeners=new Set();

// Bowl + raised rim, 0 beyond CRATER_R. r in metres from the centre.
export function craterProfile(r){
  const bowl=CRATER_R*.5;if(r<bowl)return -CRATER_DEPTH*(1-(r/bowl)**2);
  if(r>=CRATER_R)return 0;const x=(r-bowl)/(CRATER_R-bowl),k=(x-.12)/.14;return CRATER_RIM*Math.exp(-(k*k))*(1-x);
}
// ---- water: rivers, canals and lakes from the map are real basins.
// The water module registers axis-aligned rectangles (greedy-merged grid
// cells); the terrain gets a hole there with a bed WATER_BED_M deep, and
// the water surface sits at WATER_LEVEL_M. A coarse bucket hash keeps the
// point query O(1).
export const WATER_LEVEL_M=-.18,WATER_BED_M=2.6;
let waterRects=[],waterBuckets=new Map(),waterFlow=null;const WB=24;
export function setWaterRegions(rects,flowFn=null){
  waterRects=(rects||[]).filter(r=>r.x1>r.x0&&r.y1>r.y0);waterFlow=flowFn;waterBuckets=new Map();
  for(const r of waterRects)for(let bx=Math.floor(r.x0/WB);bx<=Math.floor(r.x1/WB);bx++)for(let by=Math.floor(r.y0/WB);by<=Math.floor(r.y1/WB);by++){const k=bx*73856093^by*19349663;let l=waterBuckets.get(k);if(!l){l=[];waterBuckets.set(k,l);}l.push(r);}
  notify();
}
// Bridge decks over water: oriented boxes (centre, half length/width, yaw)
// that keep a solid road surface at ground level across the basin.
let bridges=[];
export function setBridgeDecks(list){bridges=(list||[]).filter(b=>b.hl>.1&&b.hw>.1);}
export function bridgeDecks(){return bridges;}
function onBridge(x,y){for(const b of bridges){const dx=x-b.cx,dy=y-b.cy,c=Math.cos(b.yaw),s=Math.sin(b.yaw),u=dx*c+dy*s,v=-dx*s+dy*c;if(Math.abs(u)<=b.hl&&Math.abs(v)<=b.hw)return true;}return false;}
export function craterHeightAt(x,y){let h=elevationAt(x,y);for(const c of craters){const r=Math.hypot(x-c.x,y-c.y);if(r<CRATER_R)h+=craterProfile(r);}return h;}
export function waterAt(x,y){const l=waterBuckets.get(Math.floor(x/WB)*73856093^Math.floor(y/WB)*19349663);if(!l)return false;for(const r of l)if(x>=r.x0&&x<r.x1&&y>=r.y0&&y<r.y1)return true;return false;}
export function waterFlowAt(x,y){return waterFlow&&waterAt(x,y)?waterFlow(x,y):null;}
export function waterRegions(){return waterRects;}
// Static ground (real elevation + craters + river/lake beds), without the transient pressure wave.
// ---- building pads: every building stands on a levelled pad, as real ones
// do on a slope (cut on the uphill side, fill on the downhill side). The pad
// is part of the terrain itself — physics tiles, rendered ground, roads and
// walkers all see it — and blends back into the natural slope over
// PAD_BLEND_M around the footprint. So a house is never tilted into the
// hill nor hanging over the valley side.
export const PAD_BLEND_M=6;
let pads=new Map(),padBuckets=new Map();const PB=48;
const padBucketKey=(bx,by)=>bx*73856093^by*19349663;
function ringDistance(x,y,r){let d=Infinity;for(let i=0,j=r.length-1;i<r.length;j=i++){const ax=r[j][0],ay=r[j][1],bx=r[i][0],by=r[i][1],dx=bx-ax,dy=by-ay,l=dx*dx+dy*dy,t=l>0?Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/l)):0;d=Math.min(d,Math.hypot(x-ax-dx*t,y-ay-dy*t));}return d;}
function insideRing(x,y,r){let inside=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],c=r[j];if((a[1]>y)!==(c[1]>y)&&x<(c[0]-a[0])*(y-a[1])/(c[1]-a[1])+a[0])inside=!inside;}return inside;}
function padBlend(x,y,e){const l=padBuckets.get(padBucketKey(Math.floor(x/PB),Math.floor(y/PB)));if(!l)return e;let best=0,z=e;
  for(const p of l){const b=p.bb;if(x<b[0]||x>b[2]||y<b[1]||y>b[3])continue;let w;if(insideRing(x,y,p.ring))w=1;else{const d=ringDistance(x,y,p.ring);if(d>=PAD_BLEND_M)continue;const t=1-d/PAD_BLEND_M;w=t*t*(3-2*t);}if(w>best){best=w;z=p.z;if(w>=1)break;}}
  return e+(z-e)*best;}
export function padHeight(key){return pads.get(String(key))?.z;}
// footprints: [{key, outer:[[x,y],...]}]. Only changed pads re-shape the terrain.
// Terrain pads are disabled: re-shaping the ground under every streamed
// building made the streets between houses bumpy (pads of neighbours blend
// into the road) and rebuilt physics tiles on every city sync, which left the
// roads undrivable. Buildings instead stand on their lowest outline point
// (buildingGroundBase) like a house with a basement on a slope.
export const BUILDING_PADS_ENABLED=false;
export function setBuildingPads(footprints){if(!BUILDING_PADS_ENABLED){if(pads.size){const regions=[...pads.values()].map(p=>p.bb);pads=new Map();padBuckets=new Map();notify(regions,"pads");}return false;}
  const next=new Map(),regions=[];
  for(const fp of footprints||[]){if((Number(fp.base)||0)>.6)continue;const ring=(fp.outer||[]).map(p=>Array.isArray(p)?[+p[0],+p[1]]:[+p.x,+p.y]).filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1]));if(ring.length<3)continue;const key=String(fp.key??`${ring[0][0].toFixed(1)},${ring[0][1].toFixed(1)}`),old=pads.get(key);
    if(old&&old.n===ring.length&&Math.abs(old.ring[0][0]-ring[0][0])<.01&&Math.abs(old.ring[0][1]-ring[0][1])<.01){next.set(key,old);continue;}
    let cx=0,cy=0;const hs=[];for(const p of ring){cx+=p[0];cy+=p[1];hs.push(elevationAt(p[0],p[1]));}hs.push(elevationAt(cx/ring.length,cy/ring.length));hs.sort((a,b)=>a-b);
    const bb=[Infinity,Infinity,-Infinity,-Infinity];for(const p of ring){bb[0]=Math.min(bb[0],p[0]);bb[1]=Math.min(bb[1],p[1]);bb[2]=Math.max(bb[2],p[0]);bb[3]=Math.max(bb[3],p[1]);}bb[0]-=PAD_BLEND_M;bb[1]-=PAD_BLEND_M;bb[2]+=PAD_BLEND_M;bb[3]+=PAD_BLEND_M;
    const pad={key,ring,n:ring.length,z:hs[hs.length>>1],bb};next.set(key,pad);regions.push(bb);}
  for(const[key,old]of pads)if(!next.has(key))regions.push(old.bb);
  if(!regions.length)return false;
  pads=next;padBuckets=new Map();
  for(const p of pads.values())for(let bx=Math.floor(p.bb[0]/PB);bx<=Math.floor(p.bb[2]/PB);bx++)for(let by=Math.floor(p.bb[1]/PB);by<=Math.floor(p.bb[3]/PB);by++){const k=padBucketKey(bx,by);let l=padBuckets.get(k);if(!l){l=[];padBuckets.set(k,l);}l.push(p);}
  notify(regions,"pads");return true;
}
// Where a building stands: the lowest ground along its outline (its pad,
// lowered by any crater) — never floating, at most a few cm into the ground.
export function buildingGroundBase(outer){let m=Infinity;const r=(outer||[]).map(p=>Array.isArray(p)?[+p[0],+p[1]]:[+p.x,+p.y]);
  for(let i=0;i<r.length;i++){const a=r[i],b=r[(i+1)%r.length];if(!Number.isFinite(a[0])||!Number.isFinite(a[1]))continue;m=Math.min(m,staticGroundHeightAt(a[0],a[1]),staticGroundHeightAt((a[0]+b[0])/2,(a[1]+b[1])/2));}
  return Number.isFinite(m)?m:0;}
// Road corridors: streets are level across and smooth along (drivable, like
// real road construction). Every node within a road (+ sidewalks) takes the
// height of the road's smoothed centre line, blending back to the natural
// ground over a few metres. Physics, ground mesh, roads and walkers all read
// this same height — one truth.
const RG=24,ROAD_BLEND_M=4.5;let roadGrid=new Map(),roadHash="";
const roadKey=(ix,iy)=>ix*73856093^iy*19349663;
export function setRoadCorridors(roads){
  const list=(roads||[]).filter(r=>Array.isArray(r?.pts)&&r.pts.length>1&&r.w>0);
  let hash=String(list.length);for(const r of list){const a=r.pts[0],b=r.pts.at(-1);hash+=`|${Math.round(a[0])},${Math.round(a[1])},${Math.round(b[0])},${Math.round(b[1])},${r.w}`;}
  if(hash===roadHash)return false;roadHash=hash;const grid=new Map();let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(const r of list){
    // centre line resampled every 5 m, heights smoothed over ±15 m
    const pts=[];for(let i=0;i<r.pts.length-1;i++){const a=r.pts[i],b=r.pts[i+1],l=Math.hypot(b[0]-a[0],b[1]-a[1]),k=Math.max(1,Math.ceil(l/5));for(let s=0;s<k;s++)pts.push([a[0]+(b[0]-a[0])*s/k,a[1]+(b[1]-a[1])*s/k]);}pts.push(r.pts.at(-1));
    const raw=pts.map(p=>elevationAt(p[0],p[1])),hs=raw.map((_,i)=>{let sum=0,n=0;for(let k=-3;k<=3;k++){const v=raw[i+k];if(v!==undefined){const w=4-Math.abs(k);sum+=v*w;n+=w;}}return sum/n;});
    const half=r.w/2,reach=half+ROAD_BLEND_M;
    for(let i=0;i<pts.length-1;i++){const a=pts[i],b=pts[i+1],dx=b[0]-a[0],dy=b[1]-a[1],l2=dx*dx+dy*dy;if(l2<1e-4)continue;const seg={ax:a[0],ay:a[1],dx,dy,l2,ha:hs[i],hb:hs[i+1],half};
      const sx0=Math.min(a[0],b[0])-reach,sx1=Math.max(a[0],b[0])+reach,sy0=Math.min(a[1],b[1])-reach,sy1=Math.max(a[1],b[1])+reach;x0=Math.min(x0,sx0);y0=Math.min(y0,sy0);x1=Math.max(x1,sx1);y1=Math.max(y1,sy1);
      for(let gx=Math.floor(sx0/RG);gx<=Math.floor(sx1/RG);gx++)for(let gy=Math.floor(sy0/RG);gy<=Math.floor(sy1/RG);gy++){const k=roadKey(gx,gy);let c=grid.get(k);if(!c){c=[];grid.set(k,c);}c.push(seg);}}
  }
  roadGrid=grid;notify(Number.isFinite(x0)?[[x0,y0,x1,y1]]:null,"roads");return true;
}
function roadLevel(x,y,h){
  if(!roadGrid.size)return h;const segs=roadGrid.get(roadKey(Math.floor(x/RG),Math.floor(y/RG)));if(!segs)return h;let best=0,bh=h;
  for(const s of segs){const t=Math.max(0,Math.min(1,((x-s.ax)*s.dx+(y-s.ay)*s.dy)/s.l2)),px=s.ax+s.dx*t,py=s.ay+s.dy*t,d=Math.hypot(x-px,y-py),w=d<=s.half?1:d>=s.half+ROAD_BLEND_M?0:1-(d-s.half)/ROAD_BLEND_M;if(w>best){best=w;bh=s.ha+(s.hb-s.ha)*t;if(w>=1)break;}}
  const k=best*best*(3-2*best);return k>0?h+(bh-h)*k:h;
}
export function terrainNodeHeightAt(x,y){const e=elevationAt(x,y);let h=roadLevel(x,y,padBlend(x,y,e));for(const c of craters){const r=Math.hypot(x-c.x,y-c.y);if(r<CRATER_R)h+=craterProfile(r);}if(waterRects.length&&waterAt(x,y)&&!onBridge(x,y))return Math.min(h,e-WATER_BED_M);return h;}
const terrainCellCache=new Map();
function terrainCell(ix,iy){
  let col=terrainCellCache.get(ix);if(!col){col=new Map();terrainCellCache.set(ix,col);}
  let cell=col.get(iy);if(cell)return cell;
  const st=TERRAIN_FIELD_STEP_M,x0=ix*st,y0=iy*st;
  cell=[terrainNodeHeightAt(x0,y0),terrainNodeHeightAt(x0+st,y0),terrainNodeHeightAt(x0,y0+st),terrainNodeHeightAt(x0+st,y0+st)];
  col.set(iy,cell);return cell;
}
export function staticGroundHeightAt(x,y){
  const st=TERRAIN_FIELD_STEP_M,ix=Math.floor(x/st),iy=Math.floor(y/st),x0=ix*st,y0=iy*st,u=(x-x0)/st,v=(y-y0)/st,[a,b,c,d]=terrainCell(ix,iy);
  return u>=v?a+(b-a)*(u-v)+(d-a)*v:a+(c-a)*(v-u)+(d-a)*u;
}
// Ray against the one terrain surface (static height incl. pads, craters,
// basins): adaptive march (step <= height above ground, the surface is never
// steeper than ~45°) + bisection. o/d: {x,y,z}. Returns distance or null.
export function terrainRayDistance(o,d,max=2000){
  const ox=+o.x,oy=+o.y,oz=+o.z,dx=+d.x,dy=+d.y,dz=+d.z;if(![ox,oy,oz,dx,dy,dz].every(Number.isFinite))return null;
  let prev=0,above=oz-staticGroundHeightAt(ox,oy);if(above<0)return null;
  for(let t=0,i=0;t<max&&i<600;i++){const step=Math.max(.4,Math.min(12,above*.7));t=Math.min(max,t+step);const z=oz+dz*t-staticGroundHeightAt(ox+dx*t,oy+dy*t);
    if(z<=0){let a=prev,b=t;for(let k=0;k<14;k++){const m=(a+b)/2;if(oz+dz*m-staticGroundHeightAt(ox+dx*m,oy+dy*m)>0)a=m;else b=m;}return(a+b)/2;}
    prev=t;above=z;if(t>=max)break;}
  return null;
}
export function terrainNormalAt(x,y){const e=.5,hx=staticGroundHeightAt(x+e,y)-staticGroundHeightAt(x-e,y),hy=staticGroundHeightAt(x,y+e)-staticGroundHeightAt(x,y-e),l=Math.hypot(hx,hy,2*e);return[-hx/l,-hy/l,2*e/l];}
export function groundHeightAt(x,y){return staticGroundHeightAt(x,y)+shockHeightAt(x,y);}
// Underground guard. The collision terrain is a thin triangulated height
// field: a body that ends up beneath it (spawned before the DEM arrived, the
// terrain rose under it on reload / origin change, tunnelled through at high
// speed) would otherwise be trapped below the surface for good. Returns the
// z to lift a body centre to when (x,y,z) is certainly below the physical
// surface, else null. "Certainly": below the lowest corner of its 5 m field
// cell (the triangles never dip below it) or clearly below the interpolated
// surface. The lift goes above the highest corner so the body lands on top.
export function terrainRescueZ(x,y,z,clearance=.5){
  if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(z))return null;
  const st=5,ix=Math.floor(x/st)*st,iy=Math.floor(y/st)*st,a=staticGroundHeightAt(ix,iy),b=staticGroundHeightAt(ix+st,iy),c=staticGroundHeightAt(ix,iy+st),d=staticGroundHeightAt(ix+st,iy+st),here=staticGroundHeightAt(x,y);
  const lo=Math.min(a,b,c,d,here),hi=Math.max(a,b,c,d,here);
  return z<Math.max(lo-.05,here-.35)?hi+clearance:null;
}
// Water surface follows the terrain (rivers sit at the local ground level).
export function waterLevelAt(x,y){return elevationAt(x,y)+WATER_LEVEL_M;}
export function terrainCraters(){return craters.map(c=>({...c}));}
const craterRect=c=>[c.x-CRATER_R,c.y-CRATER_R,c.x+CRATER_R,c.y+CRATER_R];
// Deformations report the rectangle they changed, so the shared terrain tiles
// (physics height fields and the rendered ground) rebuild only what moved.
export function addCrater(x,y){const c={x:Number(x)||0,y:Number(y)||0},rects=[craterRect(c)];craters.push(c);while(craters.length>MAX_CRATERS)rects.push(craterRect(craters.shift()));notify(rects);}
export function clearCraters(){if(!craters.length)return;const rects=craters.map(craterRect);craters.length=0;notify(rects);}
export function onTerrainChange(fn){listeners.add(fn);return()=>listeners.delete(fn);}
onElevationChange(()=>notify());
// regions: null = everything changed, else [[x0,y0,x1,y1],...] that changed
function notify(regions=null,source="terrain"){terrainCellCache.clear();for(const fn of listeners){try{fn(terrainCraters(),regions,source);}catch(error){console.warn("terrain listener",error);}}}

// Ground box minus the crater squares, as non-overlapping rectangles.
function groundRectangles(half,holes){
  if(!holes.length)return[[-half,-half,half,half]];
  // x-slab sweep; identical y-pieces of neighbouring slabs are merged so the
  // rectangle count stays ~linear in the number of hole edges
  const xs=[...new Set([-half,half,...holes.flatMap(h=>[h[0],h[2]])])].sort((a,b)=>a-b),out=[];let open=new Map();
  for(let i=0;i<xs.length-1;i++){const x0=xs[i],x1=xs[i+1];if(x1-x0<1e-6)continue;const mid=(x0+x1)/2;
    const blocked=holes.filter(h=>h[0]<mid&&h[2]>mid).map(h=>[h[1],h[3]]).sort((a,b)=>a[0]-b[0]);let y=-half;const pieces=[];
    for(const[y0,y1]of blocked){if(y0>y)pieces.push([y,y0]);y=Math.max(y,y1);}if(y<half)pieces.push([y,half]);
    const next=new Map();for(const[y0,y1]of pieces){const key=`${y0},${y1}`,r=open.get(key);if(r&&Math.abs(r[2]-x0)<1e-6){r[2]=x1;next.set(key,r);open.delete(key);}else{const nr=[x0,y0,x1,y1];out.push(nr);next.set(key,nr);}}
    open=next;}
  return out;
}

// Creates the static terrain. Flat ground pieces are plain Box3D box shapes
// (one static body per rectangle, centred on it — like the original single
// ground box); only the small crater cells use convex hulls.
// Returns {bodies,shapeCount}.
export const TERRAIN_FIELD_HALF_M=1200,TERRAIN_FIELD_STEP_M=5;
export function createTerrainBody(b3,world,shapeDef,half){
  const bodies=[];let shapeCount=0;
  const staticBody=(position,rotation=null)=>{const def=b3.b3DefaultBodyDef();def.type=b3.b3BodyType.b3_staticBody;def.position=position;if(rotation)def.rotation=rotation;const body=b3.b3CreateBody(world,def);bodies.push(body);return body;};
  // (Height-field terrain lives in terrain_tiles.mjs; this is the fallback
  // for Box3D builds without height fields.)
  const holes=[...craters.map(c=>[c.x-CRATER_R,c.y-CRATER_R,c.x+CRATER_R,c.y+CRATER_R]),...waterRects.map(r=>[r.x0,r.y0,r.x1,r.y1])];
  for(const[x0,y0,x1,y1]of groundRectangles(half,holes)){const hx=(x1-x0)/2,hy=(y1-y0)/2;if(hx<.01||hy<.01)continue;const body=staticBody([x0+hx,y0+hy,-GROUND_THICKNESS/2]);b3.b3CreateBoxShape(body,shapeDef,hx,hy,GROUND_THICKNESS/2);shapeCount++;}
  for(const br of bridges){const body=staticBody([br.cx,br.cy,-.25],[0,0,Math.sin(br.yaw/2),Math.cos(br.yaw/2)]);b3.b3CreateBoxShape(body,shapeDef,br.hl,br.hw,.25);shapeCount++;}
  for(const r of waterRects){const hx=(r.x1-r.x0)/2,hy=(r.y1-r.y0)/2;if(hx<.01||hy<.01)continue;const body=staticBody([r.x0+hx,r.y0+hy,-WATER_BED_M-.1]);b3.b3CreateBoxShape(body,shapeDef,hx,hy,.1);shapeCount++;}
  if(craters.length){
    const step=CRATER_R*2/SLAB_CELLS,done=new Set();
    for(const c of craters)for(let i=0;i<SLAB_CELLS;i++)for(let j=0;j<SLAB_CELLS;j++){
      const x0=c.x-CRATER_R+i*step,y0=c.y-CRATER_R+j*step,x1=x0+step,y1=y0+step,key=`${x0.toFixed(1)},${y0.toFixed(1)}`;if(done.has(key))continue;done.add(key);
      const cx=(x0+x1)/2,cy=(y0+y1)/2,cell=staticBody([cx,cy,0]),verts=[];
      for(const[x,y]of[[x0,y0],[x1,y0],[x1,y1],[x0,y1]])verts.push(x-cx,y-cy,staticGroundHeightAt(x,y));
      for(const[x,y]of[[x0,y0],[x1,y0],[x1,y1],[x0,y1]])verts.push(x-cx,y-cy,SLAB_BOTTOM_Z);
      const hull=b3.b3CreateHull(verts);if(!hull)continue;try{b3.b3CreateHullShape(cell,shapeDef,hull);shapeCount++;}finally{b3.b3DestroyHull(hull);}
    }
  }
  return{bodies,shapeCount};
}
if(typeof window!=="undefined")globalThis.__terrain=Object.freeze({staticGroundHeightAt,groundHeightAt,terrainRayDistance});
