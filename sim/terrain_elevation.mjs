// Real terrain elevation (metres above the world origin) from the public
// Terrarium elevation tiles (AWS Open Data, SRTM/3DEP/… merged DEM). The
// tiles around the player are decoded once into a regular height grid
// (ELEV_STEP_M spacing); elevationAt() is a bilinear lookup — cheap enough
// for every walker, animal, car and vertex. Heights are relative to the
// elevation at the world origin, so the origin stays at z = 0. Reloaded
// when the player has travelled far. Every consumer (ground mesh, roads,
// water, buildings, physics height field, walking, crowds) follows through
// terrain_craters.mjs.

export const TERRAIN_ELEVATION_VERSION="terrarium-bare-earth-grid-v2";
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
function bilinear(h,n,fx,fy){fx=Math.max(0,Math.min(n-1.001,fx));fy=Math.max(0,Math.min(n-1.001,fy));const i=fx|0,j=fy|0,tx=fx-i,ty=fy-j,k=j*n+i;return(h[k]*(1-tx)+h[k+1]*tx)*(1-ty)+(h[k+n]*(1-tx)+h[k+n+1]*tx)*ty;}

// The public DEM is a *surface* model in cities (SRTM / EU-DEM radar sees
// roofs and tree canopies): building blocks show up as 5–20 m bumps, which
// would put streets on fake hills and bury houses. A morphological opening
// (min filter, then max filter over OPEN_M) removes every raised feature
// smaller than a city block while keeping real hills, valleys and river
// banks; a light separable blur (two box passes ≈ Gaussian) then removes the
// 30 m DEM stair-steps. Result: bare-earth metres, smooth and physical.
const OPEN_M=160,BLUR_M=30;
function slide(src,dst,n,stride,lineStride,r,op){
  // sliding-window min/max along lines (monotonic deque), window 2r+1, clipped at the edges
  const q=new Int32Array(n);
  for(let l=0;l<n;l++){const base=l*lineStride;let qh=0,qt=0;
    for(let i=0,j=0;i<n;i++){const hi=Math.min(n-1,i+r);for(;j<=hi;j++){const v=src[base+j*stride];while(qt>qh&&(op>0?src[base+q[qt-1]*stride]<=v:src[base+q[qt-1]*stride]>=v))qt--;q[qt++]=j;}
      while(q[qh]<i-r)qh++;dst[base+i*stride]=src[base+q[qh]*stride];}}
}
function boxBlur(src,dst,n,stride,lineStride,r){
  for(let l=0;l<n;l++){const base=l*lineStride;let sum=0,cnt=0;for(let j=0;j<=Math.min(n-1,r);j++){sum+=src[base+j*stride];cnt++;}
    for(let i=0;i<n;i++){dst[base+i*stride]=sum/cnt;const add=i+r+1,rem=i-r;if(add<n){sum+=src[base+add*stride];cnt++;}if(rem>=0){sum-=src[base+rem*stride];cnt--;}}}
}
export function bareEarth(h,n,step=ELEV_STEP_M){
  const t=new Float32Array(h.length),ro=Math.max(1,Math.round(OPEN_M/step/2)),rb=Math.max(1,Math.round(BLUR_M/step/2));
  slide(h,t,n,1,n,ro,-1);slide(t,h,n,n,1,ro,-1);   // erode (min) rows, columns
  slide(h,t,n,1,n,ro,1);slide(t,h,n,n,1,ro,1);     // dilate (max)
  for(let p=0;p<2;p++){boxBlur(h,t,n,1,n,rb);boxBlur(t,h,n,n,1,rb);}
  return h;
}
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
    // absolute DEM heights on the grid, then surface model -> bare ground
    const h=new Float32Array(n*n);let last=null;
    for(let j=0;j<n;j++){for(let i=0;i<n;i++){const[lon,lat]=b.unprojectMeters(x0+i*ELEV_STEP_M,y0+j*ELEV_STEP_M),v=sample(lon,lat);if(v!==null)last=v;h[j*n+i]=last??NaN;}if(j%60===59)await new Promise(r=>setTimeout(r,0));}
    {let first=NaN;for(const v of h)if(Number.isFinite(v)){first=v;break;}if(!Number.isFinite(first))return false;for(let k=0;k<h.length;k++)if(!Number.isFinite(h[k]))h[k]=first;}
    bareEarth(h,n);await new Promise(r=>setTimeout(r,0));
    if(refHeight===null){const fx=(0-x0)/ELEV_STEP_M,fy=(0-y0)/ELEV_STEP_M;refHeight=fx>=0&&fy>=0&&fx<=n-1&&fy<=n-1?bilinear(h,n,fx,fy):bilinear(h,n,(n-1)/2,(n-1)/2);}
    for(let k=0;k<h.length;k++)h[k]-=refHeight;
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
