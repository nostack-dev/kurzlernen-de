// Deformable ground: one height function shared by physics, rendering and
// the walking player, so a nuke crater is real terrain — the drone can fly
// down into it, the camera and rangefinder see it, the pilot walks the bowl.
//
// Physics (Box3D): the flat ground used to be one 20 km box. It is now the
// same box minus axis-aligned holes under each crater (rectangle sweep, a
// handful of hulls), and every hole is filled with a grid of convex slabs
// whose tops follow the crater surface — a concave bowl built from convex
// pieces. Rebuilt only when a crater appears or the world resets.

export const TERRAIN_CRATERS_VERSION="box3d-tiled-crater-terrain-v1";
export const CRATER_R=210,CRATER_DEPTH=22,CRATER_RIM=7;
const SLAB_CELLS=16,SLAB_BOTTOM_Z=-90,GROUND_THICKNESS=.1,MAX_CRATERS=3;

const craters=[];const listeners=new Set();

// Bowl + raised rim, 0 beyond CRATER_R. r in metres from the centre.
export function craterProfile(r){
  const bowl=CRATER_R*.5;if(r<bowl)return -CRATER_DEPTH*(1-(r/bowl)**2);
  if(r>=CRATER_R)return 0;const x=(r-bowl)/(CRATER_R-bowl),k=(x-.12)/.14;return CRATER_RIM*Math.exp(-(k*k))*(1-x);
}
export function groundHeightAt(x,y){let h=0;for(const c of craters){const r=Math.hypot(x-c.x,y-c.y);if(r<CRATER_R)h+=craterProfile(r);}return h;}
export function terrainCraters(){return craters.map(c=>({...c}));}
export function addCrater(x,y){craters.push({x:Number(x)||0,y:Number(y)||0});while(craters.length>MAX_CRATERS)craters.shift();notify();}
export function clearCraters(){if(!craters.length)return;craters.length=0;notify();}
export function onTerrainChange(fn){listeners.add(fn);return()=>listeners.delete(fn);}
function notify(){for(const fn of listeners){try{fn(terrainCraters());}catch(error){console.warn("terrain listener",error);}}}

// Ground box minus the crater squares, as non-overlapping rectangles.
function groundRectangles(half,holes){
  if(!holes.length)return[[-half,-half,half,half]];
  const xs=[...new Set([-half,half,...holes.flatMap(h=>[h[0],h[2]])])].sort((a,b)=>a-b),out=[];
  for(let i=0;i<xs.length-1;i++){const x0=xs[i],x1=xs[i+1];if(x1-x0<1e-6)continue;const mid=(x0+x1)/2;
    const blocked=holes.filter(h=>h[0]<mid&&h[2]>mid).map(h=>[h[1],h[3]]).sort((a,b)=>a[0]-b[0]);let y=-half;
    for(const[y0,y1]of blocked){if(y0>y)out.push([x0,y,x1,y0]);y=Math.max(y,y1);}if(y<half)out.push([x0,y,x1,half]);}
  return out;
}
function box(x0,y0,z0,x1,y1,z1){return[x0,y0,z0,x1,y0,z0,x1,y1,z0,x0,y1,z0,x0,y0,z1,x1,y0,z1,x1,y1,z1,x0,y1,z1];}

// Creates the static terrain body. Returns {body,shapeCount}.
export function createTerrainBody(b3,world,shapeDef,half){
  const bodyDef=b3.b3DefaultBodyDef();bodyDef.type=b3.b3BodyType.b3_staticBody;bodyDef.position=[0,0,0];const body=b3.b3CreateBody(world,bodyDef);let shapeCount=0;
  const hull=vertices=>{const h=b3.b3CreateHull(vertices);if(!h)return;try{b3.b3CreateHullShape(body,shapeDef,h);shapeCount++;}finally{b3.b3DestroyHull(h);}};
  const holes=craters.map(c=>[c.x-CRATER_R,c.y-CRATER_R,c.x+CRATER_R,c.y+CRATER_R]);
  for(const[x0,y0,x1,y1]of groundRectangles(half,holes))hull(box(x0,y0,-GROUND_THICKNESS,x1,y1,0));
  const step=CRATER_R*2/SLAB_CELLS,done=new Set();
  for(const c of craters)for(let i=0;i<SLAB_CELLS;i++)for(let j=0;j<SLAB_CELLS;j++){
    const x0=c.x-CRATER_R+i*step,y0=c.y-CRATER_R+j*step,x1=x0+step,y1=y0+step,key=`${x0.toFixed(1)},${y0.toFixed(1)}`;if(done.has(key))continue;done.add(key);
    const top=[[x0,y0],[x1,y0],[x1,y1],[x0,y1]].map(([x,y])=>[x,y,groundHeightAt(x,y)]);
    hull([...top.flat(),x0,y0,SLAB_BOTTOM_Z,x1,y0,SLAB_BOTTOM_Z,x1,y1,SLAB_BOTTOM_Z,x0,y1,SLAB_BOTTOM_Z]);
  }
  return{body,shapeCount};
}
