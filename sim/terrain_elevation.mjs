// Real terrain elevation (metres above the world origin) from the public
// Terrarium elevation tiles (AWS Open Data, SRTM/3DEP/… merged DEM). The
// tiles around the player are decoded once into a regular height grid
// (ELEV_STEP_M spacing); elevationAt() is a bilinear lookup — cheap enough
// for every walker, animal, car and vertex. Heights are relative to the
// elevation at the world origin, so the origin stays at z = 0. Reloaded
// when the player has travelled far. Every consumer (ground mesh, roads,
// water, buildings, physics height field, walking, crowds) follows through
// terrain_craters.mjs.

export const TERRAIN_ELEVATION_VERSION="terrarium-dem-grid-v1";
const ZOOM=14,SIZE_M=2600,ELEV_STEP_M=5,RELOAD_MOVE_M=750;
const TILE_URL=(z,x,y)=>`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
let grid=null,refHeight=null,loading=false,listeners=new Set(),tileCache=new Map();
const bridge=()=>globalThis.__arondightRealWorld||null;

export function elevationAt(x,y){
  const g=grid;if(!g)return 0;const fx=Math.max(0,Math.min(g.n-1.001,(x-g.x0)/g.step)),fy=Math.max(0,Math.min(g.n-1.001,(y-g.y0)/g.step)),i=fx|0,j=fy|0,tx=fx-i,ty=fy-j,h=g.h,n=g.n,k=j*n+i;
  return(h[k]*(1-tx)+h[k+1]*tx)*(1-ty)+(h[k+n]*(1-tx)+h[k+n+1]*tx)*ty;
}
export function elevationGrid(){return grid;}
export function onElevationChange(fn){listeners.add(fn);return()=>listeners.delete(fn);}
export function elevationCenter(){return grid?[grid.cx,grid.cy]:[0,0];}
// Installs a height grid directly (tests / offline tools); same notification
// path as a DEM load. g = {x0,y0,step,n,h:Float32Array(n*n),cx,cy} or null.
export function setElevationGrid(g){grid=g;for(const fn of listeners){try{fn(grid);}catch(e){console.warn("elevation listener",e);}}}

function lonLatToTile(lon,lat,z){const n=2**z,x=(lon+180)/360*n,r=lat*Math.PI/180,y=(1-Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2*n;return[x,y];}
function loadTile(x,y){const key=`${x}/${y}`;if(tileCache.has(key))return tileCache.get(key);
  const p=new Promise(resolve=>{const img=new Image();img.crossOrigin="anonymous";img.decoding="async";let done=false;const finish=v=>{if(!done){done=true;resolve(v);}};
    img.onload=()=>{try{const c=document.createElement("canvas");c.width=img.width;c.height=img.height;const ctx=c.getContext("2d",{willReadFrequently:true});ctx.drawImage(img,0,0);finish({w:img.width,h:img.height,data:ctx.getImageData(0,0,img.width,img.height).data});}catch{finish(null);}};
    img.onerror=()=>finish(null);img.src=TILE_URL(ZOOM,x,y);setTimeout(()=>finish(null),12000);});
  tileCache.set(key,p);if(tileCache.size>24)tileCache.delete(tileCache.keys().next().value);return p;}
function terrarium(d,o){return d[o]*256+d[o+1]+d[o+2]/256-32768;}

const originKey=b=>`${Number(b?.originLon).toFixed(7)},${Number(b?.originLat).toFixed(7)}`;
let refOrigin="";
async function load(cx,cy){
  const b=bridge();if(!b||typeof b.unprojectMeters!=="function")return false;loading=true;const origin=originKey(b);
  try{
    const half=SIZE_M/2,n=Math.round(SIZE_M/ELEV_STEP_M)+1,x0=cx-half,y0=cy-half;
    const[lonA,latA]=b.unprojectMeters(x0,y0+SIZE_M),[lonB,latB]=b.unprojectMeters(x0+SIZE_M,y0);
    const[tx0,ty0]=lonLatToTile(lonA,latA,ZOOM),[tx1,ty1]=lonLatToTile(lonB,latB,ZOOM),ix0=Math.floor(tx0),iy0=Math.floor(ty0),ix1=Math.floor(tx1),iy1=Math.floor(ty1);
    if((ix1-ix0+1)*(iy1-iy0+1)>16)return false;
    const tiles=new Map();await Promise.all([...Array((ix1-ix0+1)*(iy1-iy0+1)).keys()].map(async k=>{const x=ix0+k%(ix1-ix0+1),y=iy0+Math.floor(k/(ix1-ix0+1));tiles.set(`${x}/${y}`,await loadTile(x,y));}));
    if([...tiles.values()].every(t=>!t))return false;
    const sample=(lon,lat)=>{const[fx,fy]=lonLatToTile(lon,lat,ZOOM),tx=Math.floor(fx),ty=Math.floor(fy),t=tiles.get(`${tx}/${ty}`);if(!t)return null;const px=Math.min(t.w-1.001,(fx-tx)*t.w),py=Math.min(t.h-1.001,(fy-ty)*t.h),i=px|0,j=py|0,ax=px-i,ay=py-j,o=(j*t.w+i)*4,w=t.w*4;
      return(terrarium(t.data,o)*(1-ax)+terrarium(t.data,o+4)*ax)*(1-ay)+(terrarium(t.data,o+w)*(1-ax)+terrarium(t.data,o+w+4)*ax)*ay;};
    if(refOrigin!==origin){refHeight=null;refOrigin=origin;}
    if(refHeight===null){const[lon0,lat0]=b.unprojectMeters(0,0);refHeight=sample(lon0,lat0);if(refHeight===null){const[lc,la]=b.unprojectMeters(cx,cy);refHeight=sample(lc,la)??0;}}
    const h=new Float32Array(n*n);let last=0;
    for(let j=0;j<n;j++){for(let i=0;i<n;i++){const[lon,lat]=b.unprojectMeters(x0+i*ELEV_STEP_M,y0+j*ELEV_STEP_M),v=sample(lon,lat);last=v===null?last:v-refHeight;h[j*n+i]=last;}if(j%60===59)await new Promise(r=>setTimeout(r,0));}
    if(originKey(bridge())!==origin)return false; // world origin moved while loading: stale
    grid={x0,y0,step:ELEV_STEP_M,n,h,cx,cy,origin};
    const v=document.getElementById("viewport");if(v){let mn=Infinity,mx=-Infinity;for(const z of h){mn=Math.min(mn,z);mx=Math.max(mx,z);}v.dataset.terrainElevation=`${TERRAIN_ELEVATION_VERSION} ref=${refHeight.toFixed(1)}m range=${mn.toFixed(1)}..${mx.toFixed(1)}`;}
    for(const fn of listeners){try{fn(grid);}catch(e){console.warn("elevation listener",e);}}
    return true;
  }finally{loading=false;}
}
let lastTry=-Infinity,installed=false,failures=0;
function frame(now){
  requestAnimationFrame(frame);if(loading||now-lastTry<1500)return;const b=bridge(),cam=b?.threeCamera;if(!b?.active||!cam)return;
  // A new world origin (GPS fix, shared multiplayer origin, other city) makes
  // the old grid meaningless: drop it at once (flat until the new DEM is in),
  // so nothing is placed against a terrain from somewhere else.
  if(grid&&grid.origin!==originKey(b)){grid=null;failures=0;for(const fn of listeners){try{fn(null);}catch(e){console.warn("elevation listener",e);}}}
  const p=globalThis.__arondightWalkMode?.mode==="foot"?globalThis.__arondightWalkMode.position:cam.position;
  if(grid&&Math.hypot(p.x-grid.cx,p.y-grid.cy)<RELOAD_MOVE_M)return;if(failures>4&&now-lastTry<60000)return;lastTry=now;
  load(Math.round(p.x/50)*50,Math.round(p.y/50)*50).then(ok=>{failures=ok?0:failures+1;}).catch(()=>{failures++;});
}
export function installTerrainElevation(){if(installed||typeof window==="undefined")return;installed=true;globalThis.__terrainElevation={elevationAt,get grid(){return grid;},version:TERRAIN_ELEVATION_VERSION};requestAnimationFrame(frame);}
installTerrainElevation();
