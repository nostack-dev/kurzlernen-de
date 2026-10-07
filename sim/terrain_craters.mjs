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

// Creates the static terrain. Flat ground pieces are plain Box3D box shapes
// (one static body per rectangle, centred on it — like the original single
// ground box); only the small crater cells use convex hulls.
// Returns {bodies,shapeCount}.
export function createTerrainBody(b3,world,shapeDef,half){
  const bodies=[];let shapeCount=0;
  const staticBody=position=>{const def=b3.b3DefaultBodyDef();def.type=b3.b3BodyType.b3_staticBody;def.position=position;const body=b3.b3CreateBody(world,def);bodies.push(body);return body;};
  const holes=craters.map(c=>[c.x-CRATER_R,c.y-CRATER_R,c.x+CRATER_R,c.y+CRATER_R]);
  for(const[x0,y0,x1,y1]of groundRectangles(half,holes)){const hx=(x1-x0)/2,hy=(y1-y0)/2;if(hx<.01||hy<.01)continue;const body=staticBody([x0+hx,y0+hy,-GROUND_THICKNESS/2]);b3.b3CreateBoxShape(body,shapeDef,hx,hy,GROUND_THICKNESS/2);shapeCount++;}
  if(craters.length){
    const step=CRATER_R*2/SLAB_CELLS,done=new Set();
    for(const c of craters)for(let i=0;i<SLAB_CELLS;i++)for(let j=0;j<SLAB_CELLS;j++){
      // Hull vertices relative to the cell centre keep Box3D's hull builder
      // well-conditioned (no 10 km offsets inside the hull).
      const x0=c.x-CRATER_R+i*step,y0=c.y-CRATER_R+j*step,x1=x0+step,y1=y0+step,key=`${x0.toFixed(1)},${y0.toFixed(1)}`;if(done.has(key))continue;done.add(key);
      const cx=(x0+x1)/2,cy=(y0+y1)/2,cell=staticBody([cx,cy,0]),verts=[];
      for(const[x,y]of[[x0,y0],[x1,y0],[x1,y1],[x0,y1]])verts.push(x-cx,y-cy,groundHeightAt(x,y));
      for(const[x,y]of[[x0,y0],[x1,y0],[x1,y1],[x0,y1]])verts.push(x-cx,y-cy,SLAB_BOTTOM_Z);
      const hull=b3.b3CreateHull(verts);if(!hull)continue;try{b3.b3CreateHullShape(cell,shapeDef,hull);shapeCount++;}finally{b3.b3DestroyHull(hull);}
    }
  }
  return{bodies,shapeCount};
}
